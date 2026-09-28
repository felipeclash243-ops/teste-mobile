/**
 * Sincronização dos registros locais com o sistema web.
 *
 * Regras:
 *  - Envia um registro por vez, do mais antigo para o mais novo.
 *  - Estado: pendente -> sincronizando -> sincronizado | erro.
 *  - O id do registro (UUID gerado no aparelho) vai no header Idempotency-Key;
 *    o servidor deve ignorar reenvios do mesmo id (responder 200 ou 409).
 *  - Registros com erro voltam para a fila na próxima sincronização.
 *  - Se a conexão cair, a sincronização para e o restante continua pendente.
 */
import { CONFIG, MODO_DEMO } from './config.js';
import { STATUS, listarParaEnvio, atualizarRegistro } from './db.js';
import { obterSessao } from './auth.js';

export class ErroAutenticacao extends Error {}

let emAndamento = false;

export function sincronizacaoEmAndamento() {
  return emAndamento;
}

function emitir(nome, detail) {
  window.dispatchEvent(new CustomEvent(nome, { detail }));
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviarRegistro(registro, sessao) {
  if (MODO_DEMO) {
    await esperar(300 + Math.random() * 500);
    return;
  }

  const form = new FormData();
  for (const campo of ['id', 'unidadeId', 'testeId', 'usuario', 'itemId', 'observacao', 'criadoEm']) {
    form.append(campo, registro[campo] ?? '');
  }
  form.append('foto', registro.foto, `${registro.id}.jpg`);

  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), CONFIG.SYNC_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${CONFIG.API_BASE_URL}/registros`, {
      method: 'POST',
      body: form,
      headers: {
        Authorization: `Bearer ${sessao.token}`,
        'Idempotency-Key': registro.id,
      },
      signal: controle.signal,
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Tempo de envio esgotado.' : 'Falha de conexão com o servidor.');
  } finally {
    clearTimeout(limite);
  }

  // 409 = o servidor já possui este registro (reenvio): tratado como sucesso.
  if (resp.ok || resp.status === 409) return;
  if (resp.status === 401) throw new ErroAutenticacao('Sessão expirada. Entre novamente para sincronizar.');

  let mensagem = `Servidor respondeu HTTP ${resp.status}.`;
  try {
    const corpo = await resp.json();
    if (corpo?.erro) mensagem = corpo.erro;
  } catch { /* corpo sem JSON */ }
  throw new Error(mensagem);
}

/**
 * Envia todos os registros pendentes/com erro.
 * Retorna { total, enviados, falhas } ou null se já havia uma sincronização em andamento.
 */
export async function sincronizar() {
  if (emAndamento) return null;
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  const sessao = await obterSessao();
  if (!sessao) throw new ErroAutenticacao('Sessão expirada. Entre novamente.');

  emAndamento = true;
  const resultado = { total: 0, enviados: 0, falhas: 0 };
  try {
    const fila = await listarParaEnvio();
    resultado.total = fila.length;
    emitir('sync:progresso', { ...resultado, feitos: 0 });

    for (const registro of fila) {
      await atualizarRegistro(registro.id, { status: STATUS.SINCRONIZANDO });
      try {
        await enviarRegistro(registro, sessao);
        await atualizarRegistro(registro.id, {
          status: STATUS.SINCRONIZADO,
          sincronizadoEm: new Date().toISOString(),
          ultimoErro: null,
        });
        resultado.enviados++;
      } catch (erro) {
        if (erro instanceof ErroAutenticacao) {
          await atualizarRegistro(registro.id, { status: STATUS.PENDENTE });
          throw erro;
        }
        await atualizarRegistro(registro.id, {
          status: STATUS.ERRO,
          tentativas: (registro.tentativas || 0) + 1,
          ultimoErro: erro.message,
        });
        resultado.falhas++;
        if (!navigator.onLine) break;
      }
      emitir('sync:progresso', { ...resultado, feitos: resultado.enviados + resultado.falhas });
    }
  } finally {
    emAndamento = false;
    emitir('sync:fim', resultado);
  }
  return resultado;
}
