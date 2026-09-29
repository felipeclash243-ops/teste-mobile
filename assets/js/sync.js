/**
 * Sincronização das fotos com o SIAC (contrato, seções 6 e 7).
 *
 *  - Uma foto por vez, da mais antiga para a mais nova.
 *  - client_uuid (id do registro) + sha256 tornam o reenvio seguro: o servidor
 *    responde 200 com a mesma foto e não duplica.
 *  - Se um envio caiu sem resposta, antes de reenviar pergunta GET /fotos/{uuid}.
 *  - Erro temporário -> "erro" (tenta de novo); erro definitivo -> "rejeitada".
 *  - Sessão expirada: para, mantém a fila e pede login.
 *  - Quando um teste não tem mais fotos na fila -> POST .../fotos/concluir
 *    (uma notificação ao auditor por lote).
 */
import { CONFIG } from './config.js';
import { STATUS, listarParaEnvio, listarPorStatus, atualizarRegistro } from './db.js';
import { requisicao, ErroApi } from './api.js';
import { sha256Hex } from './imagem.js';

/** Erros definitivos: a foto não será aceita mesmo reenviando. */
const DEFINITIVOS = new Set([
  'teste_indisponivel', 'teste_nao_encontrado', 'uuid_reutilizado',
  'formato_nao_permitido', 'arquivo_grande_demais', 'sem_permissao',
  'filial_fora_do_escopo', 'requisicao_invalida', 'registro_antigo',
]);

/** Erros que interrompem a fila inteira (a foto volta para pendente). */
const INTERROMPEM = new Set([
  'sessao_expirada', 'conta_bloqueada', 'versao_desatualizada', 'ad_indisponivel',
]);

/** Falhas em que o servidor pode ter recebido a foto sem conseguirmos a resposta. */
const SEM_RESPOSTA = new Set(['tempo_esgotado', 'sem_rede']);

let emAndamento = false;

export function sincronizacaoEmAndamento() {
  return emAndamento;
}

function emitir(nome, detail) {
  window.dispatchEvent(new CustomEvent(nome, { detail }));
}

function legendaDe(r) {
  const partes = [r.itemId, r.observacao].map((s) => (s || '').trim()).filter(Boolean);
  return partes.join(' | ').slice(0, 500);
}

async function enviarRegistro(r) {
  if (!r.modulo || !r.testeNumId) {
    throw new ErroApi(0, 'registro_antigo', 'Foto registrada em uma versão de testes anterior; não pode ser enviada.');
  }

  // O envio anterior caiu sem resposta: confere se a foto já chegou.
  if (r.verificarAntes) {
    try {
      return await requisicao(`/fotos/${r.id}`);
    } catch (e) {
      if (e.codigo !== 'foto_nao_encontrada') throw e;
    }
  }

  const form = new FormData();
  form.append('arquivo', r.foto, `${r.id}.jpg`);
  form.append('client_uuid', r.id);
  form.append('capturada_em', r.criadoEm);
  form.append('sha256', r.sha256 || await sha256Hex(r.foto));
  const legenda = legendaDe(r);
  if (legenda) form.append('legenda', legenda);

  return requisicao(`/testes/${encodeURIComponent(r.modulo)}/${encodeURIComponent(r.testeNumId)}/fotos`, {
    metodo: 'POST', form, timeout: CONFIG.SYNC_TIMEOUT_MS,
  });
}

/** Avisa o auditor dos testes cuja fila esvaziou (uma vez por lote). */
async function concluirTestes() {
  const naFila = new Set((await listarParaEnvio()).map((r) => r.testeId));
  const aAvisar = (await listarPorStatus(STATUS.SINCRONIZADO)).filter((r) => !r.notificadoEm && r.modulo);

  const porTeste = new Map();
  aAvisar.forEach((r) => {
    if (naFila.has(r.testeId)) return;
    if (!porTeste.has(r.testeId)) porTeste.set(r.testeId, []);
    porTeste.get(r.testeId).push(r);
  });

  for (const registros of porTeste.values()) {
    const { modulo, testeNumId } = registros[0];
    try {
      await requisicao(`/testes/${encodeURIComponent(modulo)}/${encodeURIComponent(testeNumId)}/fotos/concluir`, {
        metodo: 'POST', json: { client_uuids: registros.map((r) => r.id) },
      });
      const agora = new Date().toISOString();
      for (const r of registros) await atualizarRegistro(r.id, { notificadoEm: agora });
    } catch (e) {
      // Sem aviso agora; tenta de novo na próxima sincronização. As fotos já estão no SIAC.
      console.warn('Falha ao avisar o auditor:', e);
    }
  }
}

/**
 * Envia todas as fotos pendentes ou com erro.
 * Retorna { total, enviados, falhas, rejeitadas } ou null se já havia uma sincronização em andamento.
 * Lança ErroApi quando a fila precisa parar (sem internet, sessão expirada, versão desatualizada).
 */
export async function sincronizar() {
  if (emAndamento) return null;
  if (!navigator.onLine) throw new ErroApi(0, 'sem_rede', 'Sem conexão com a internet.');

  emAndamento = true;
  const resultado = { total: 0, enviados: 0, falhas: 0, rejeitadas: 0, interrompida: null };
  try {
    const fila = await listarParaEnvio();
    resultado.total = fila.length;
    emitir('sync:progresso', { ...resultado, feitos: 0 });

    for (const registro of fila) {
      await atualizarRegistro(registro.id, { status: STATUS.SINCRONIZANDO });
      try {
        const foto = await enviarRegistro(registro);
        await atualizarRegistro(registro.id, {
          status: STATUS.SINCRONIZADO,
          sincronizadoEm: new Date().toISOString(),
          anexoId: foto?.anexo_id ?? null,
          ultimoErro: null,
          erroCodigo: null,
          verificarAntes: false,
        });
        resultado.enviados++;
      } catch (falha) {
        const e = falha instanceof ErroApi ? falha : new ErroApi(0, 'erro_app', falha.message);
        if (INTERROMPEM.has(e.codigo)) {
          await atualizarRegistro(registro.id, { status: STATUS.PENDENTE });
          throw e;
        }
        const definitivo = DEFINITIVOS.has(e.codigo);
        await atualizarRegistro(registro.id, {
          status: definitivo ? STATUS.REJEITADA : STATUS.ERRO,
          tentativas: (registro.tentativas || 0) + 1,
          ultimoErro: e.message,
          erroCodigo: e.codigo,
          verificarAntes: registro.verificarAntes || SEM_RESPOSTA.has(e.codigo),
        });
        if (definitivo) resultado.rejeitadas++;
        else resultado.falhas++;

        // Rede caiu, servidor fora do ar ou limite de tentativas: para e deixa o resto na fila.
        if (SEM_RESPOSTA.has(e.codigo) || e.status >= 500 || e.status === 429) {
          resultado.interrompida = e.message;
          break;
        }
      }
      emitir('sync:progresso', { ...resultado, feitos: resultado.enviados + resultado.falhas + resultado.rejeitadas });
    }

    await concluirTestes();
  } finally {
    emAndamento = false;
    emitir('sync:fim', resultado);
  }
  return resultado;
}
