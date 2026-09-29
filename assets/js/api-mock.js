/**
 * Servidor simulado do SIAC, usado no modo demonstração (API_BASE_URL vazia).
 * Responde exatamente como o contrato v1 (docs/CONTRATO-API-MOBILE-v1.md),
 * inclusive idempotência por client_uuid, conferência do sha256 e erros padronizados.
 *
 * O "banco" do servidor fica no localStorage deste navegador (chave mock-servidor).
 */
import { CONFIG } from './config.js';
import { sha256Hex } from './imagem.js';

const CHAVE = 'mock-servidor';
const DIA = 24 * 3600 * 1000;

const FILIAIS = [
  { id: 12, codigo: 'BEL', nome: 'Belém' },
  { id: 18, codigo: 'CGR', nome: 'Campo Grande' },
  { id: 23, codigo: 'LDB', nome: 'Londrina' },
  { id: 31, codigo: 'RIO', nome: 'Rio de Janeiro' },
  { id: 37, codigo: 'SPO', nome: 'São Paulo' },
  { id: 44, codigo: 'THE', nome: 'Teresina' },
  { id: 52, codigo: 'VIX', nome: 'Vitória' },
];

const MODELOS = [
  { modulo: 'avarias', nome: 'Avarias', status: 'pending_unit', prazo: 7, iniciado: 2,
    orientacao: {
      o_que_e_realizado: 'Conferência dos produtos avariados registrados no período.',
      como_realizar: 'Fotografe cada produto avariado com a etiqueta visível.\nInforme o código do produto ou a NF em cada foto.',
      informacoes_importantes: null,
      resultado_esperado: 'Uma foto legível por produto avariado.',
    } },
  { modulo: 'gt', nome: 'Inventário Rotativo', status: 'pending_unit', prazo: 5, iniciado: 4,
    orientacao: { como_realizar: 'Fotografe as etiquetas das posições listadas no e-mail.' } },
  { modulo: 'sf', nome: 'Sobras e Faltas', status: 'pending_unit', prazo: null, iniciado: 6, orientacao: null },
  { modulo: 'cl', nome: 'Check List Instalação', status: 'sent', prazo: null, iniciado: 12, orientacao: null },
  { modulo: 'gar', nome: 'Garantia', status: 'evaluated', prazo: null, iniciado: 30, orientacao: null },
];

const ROTULOS = {
  pending_unit: 'Aguardando a filial',
  draft: 'Rascunho',
  sent: 'Enviado — aguardando auditor',
  evaluated: 'Avaliado',
};

/* ---------- Estado persistido ---------- */

function estado() {
  let e = {};
  try { e = JSON.parse(localStorage.getItem(CHAVE)) || {}; } catch { /* sem storage */ }
  e.uploads ??= {};      // client_uuid -> foto
  e.status ??= {};       // ref -> status (sobrepõe o modelo; usado para simular teste fechado)
  e.refresh ??= {};      // refresh_token -> { usado, email }
  e.notificados ??= {};  // client_uuid -> true
  e.seq ??= 4400;
  e.chamadas ??= {};     // contador por rota, para conferência
  return e;
}

function salvar(e) {
  try { localStorage.setItem(CHAVE, JSON.stringify(e)); } catch { /* sem storage */ }
}

/* ---------- Dados ---------- */

const iso = (ms) => new Date(ms).toISOString();

function testesDa(filial, e) {
  const base = Date.parse('2026-09-29T12:00:00Z');
  return MODELOS.map((m, i) => {
    const id = filial.id * 100 + i + 1;
    const ref = `${m.modulo}:${id}`;
    const status = e.status[ref] || m.status;
    const fotos = Object.values(e.uploads).filter((u) => u.ref === ref);
    return {
      ref, modulo: m.modulo, id, nome: m.nome,
      status, status_rotulo: ROTULOS[status] || status,
      aceita_fotos: status === 'pending_unit',
      iniciado_em: iso(base - m.iniciado * DIA),
      prazo_filial: m.prazo ? iso(base + m.prazo * DIA) : null,
      fotos_enviadas: fotos.length,
      atualizado_em: fotos.length ? fotos[fotos.length - 1].recebida_em : iso(base - m.iniciado * DIA),
      orientacao: m.orientacao,
      filial: { id: filial.id, codigo: filial.codigo, nome: filial.nome },
    };
  });
}

function acharTeste(modulo, id, e) {
  for (const f of FILIAIS) {
    const t = testesDa(f, e).find((x) => x.modulo === modulo && x.id === Number(id));
    if (t) return t;
  }
  return null;
}

function resumoTeste({ orientacao, filial, ...t }) { return t; }

/* ---------- Respostas ---------- */

function responder_(status, corpo, headers = {}) {
  return new Response(corpo == null ? null : JSON.stringify(corpo), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function erro(status, codigo, mensagem, detalhes = {}) {
  return responder_(status, { erro: { codigo, mensagem, detalhes } });
}

function novosTokens(usuario, e) {
  const refresh = `rt_demo_${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
  e.refresh[refresh] = { usado: false, email: usuario.email };
  const agora = Date.now();
  return {
    access_token: `demo_${crypto.getRandomValues(new Uint32Array(2)).join('')}`,
    access_expira_em: iso(agora + 3600 * 1000),
    refresh_token: refresh,
    refresh_expira_em: iso(agora + 30 * DIA),
    usuario,
  };
}

function usuarioDe(email) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ');
  const nome = local.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return { id: 57, nome, email, perfil: 'unidade' };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ponto de entrada: recebe o que seria a requisição HTTP e devolve um Response.
 */
export async function responder(metodo, caminho, { headers, body }) {
  await esperar(120 + Math.random() * 250);
  const e = estado();
  const rota = `${metodo} ${caminho.replace(/\/[0-9a-f-]{36}(?=\/|$)/, '/{uuid}').replace(/\/\d+(?=\/|$)/g, '/{id}')}`;
  e.chamadas[rota] = (e.chamadas[rota] || 0) + 1;
  const json = typeof body === 'string' ? JSON.parse(body) : null;

  try {
    /* --- Autenticação --- */
    if (metodo === 'POST' && caminho === '/auth/login') {
      const email = String(json?.email || '').trim().toLowerCase();
      if (!email.includes('@')) return erro(400, 'requisicao_invalida', 'Informe um e-mail válido.');
      if (json?.senha !== CONFIG.DEMO_SENHA) return erro(401, 'credenciais_invalidas', 'E-mail ou senha incorretos.');
      return responder_(200, novosTokens(usuarioDe(email), e));
    }
    if (metodo === 'POST' && caminho === '/auth/refresh') {
      const reg = e.refresh[json?.refresh_token];
      if (!reg || reg.usado) return erro(401, 'sessao_expirada', 'Sua sessão expirou. Entre novamente.');
      reg.usado = true; // rotativo
      return responder_(200, novosTokens(usuarioDe(reg.email), e));
    }

    const token = headers.Authorization?.replace(/^Bearer /, '');
    if (!token || token === 'null') return erro(401, 'sessao_expirada', 'Sua sessão expirou. Entre novamente.');
    // Simulação de acesso vencido: o teste automatizado liga "expirarProximo".
    if (e.expirarProximo) { e.expirarProximo = false; e.tokenVencido = token; }
    if (token === e.tokenVencido) return erro(401, 'token_expirado', 'Acesso expirado.');

    if (metodo === 'POST' && caminho === '/auth/logout') return responder_(204, null);

    /* --- Filiais e testes --- */
    if (metodo === 'GET' && caminho === '/filiais') {
      return responder_(200, {
        filiais: FILIAIS.map((f) => {
          const t = testesDa(f, e);
          return { ...f, testes_disponiveis: t.filter((x) => x.aceita_fotos).length, testes_total: t.length };
        }),
      });
    }

    let m = caminho.match(/^\/filiais\/(\d+)\/testes$/);
    if (metodo === 'GET' && m) {
      const filial = FILIAIS.find((f) => f.id === Number(m[1]));
      if (!filial) return erro(403, 'filial_fora_do_escopo', 'Você não tem acesso a esta filial.');
      const t = testesDa(filial, e).sort((a, b) => b.iniciado_em.localeCompare(a.iniciado_em));
      return responder_(200, {
        filial,
        disponiveis: t.filter((x) => x.aceita_fotos).map(resumoTeste),
        indisponiveis: t.filter((x) => !x.aceita_fotos).map(resumoTeste).slice(0, 30),
      });
    }

    m = caminho.match(/^\/testes\/(\w+)\/(\d+)$/);
    if (metodo === 'GET' && m) {
      const t = acharTeste(m[1], m[2], e);
      if (!t) return erro(404, 'teste_nao_encontrado', 'Teste não encontrado.');
      // Mesmo formato do SIAC: texto com um bloco por parte + as partes separadas.
      const titulos = { o_que_e_realizado: 'O que é realizado', como_realizar: 'Como realizar',
        informacoes_importantes: 'Informações importantes', resultado_esperado: 'Resultado esperado' };
      const partes = t.orientacao || null;
      const texto = partes ? Object.entries(titulos).filter(([k]) => partes[k]).map(([k, tt]) => `${tt}:\n${partes[k]}`).join('\n\n') : null;
      return responder_(200, {
        ...t, orientacao: texto, orientacao_partes: partes,
        fotos: Object.values(e.uploads).filter((u) => u.ref === t.ref).map((u) => u.foto),
      });
    }

    /* --- Fotos --- */
    m = caminho.match(/^\/testes\/(\w+)\/(\d+)\/fotos$/);
    if (metodo === 'POST' && m) {
      const t = acharTeste(m[1], m[2], e);
      if (!t) return erro(404, 'teste_nao_encontrado', 'Teste não encontrado.');
      const arquivo = body.get('arquivo');
      const uuid = body.get('client_uuid');
      const sha = body.get('sha256');
      if (!arquivo || !uuid || !sha || !body.get('capturada_em')) {
        return erro(400, 'requisicao_invalida', 'Envio incompleto.');
      }
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(arquivo.type)) {
        return erro(415, 'formato_nao_permitido', 'Formato de arquivo não permitido.');
      }
      if (arquivo.size > 15 * 1024 * 1024) return erro(413, 'arquivo_grande_demais', 'Arquivo acima de 15 MB.');
      if (await sha256Hex(arquivo) !== sha) return erro(422, 'hash_divergente', 'O arquivo chegou corrompido. Ele será reenviado.');

      const existente = e.uploads[uuid];
      if (existente) {
        if (existente.sha256 !== sha) return erro(409, 'uuid_reutilizado', 'Identificador de foto repetido.');
        return responder_(200, existente.foto);
      }
      if (!t.aceita_fotos) {
        return erro(409, 'teste_indisponivel', 'Este teste não está mais aguardando a filial.', { status: t.status });
      }
      const foto = {
        client_uuid: uuid,
        anexo_id: ++e.seq,
        nome_arquivo: `${uuid}.jpg`,
        tamanho_bytes: arquivo.size,
        legenda: body.get('legenda') || null,
        capturada_em: body.get('capturada_em'),
        recebida_em: new Date().toISOString(),
        enviada_por: usuarioDe('demo@demo').nome,
        miniatura_url: `/api/mobile/v1/fotos/${uuid}/miniatura`,
      };
      e.uploads[uuid] = { ref: t.ref, sha256: sha, recebida_em: foto.recebida_em, foto };
      return responder_(201, foto);
    }

    m = caminho.match(/^\/fotos\/([0-9a-f-]{36})$/);
    if (m && metodo === 'GET') {
      const u = e.uploads[m[1]];
      return u ? responder_(200, u.foto) : erro(404, 'foto_nao_encontrada', 'Foto não encontrada no servidor.');
    }
    if (m && metodo === 'DELETE') {
      if (!e.uploads[m[1]]) return erro(404, 'foto_nao_encontrada', 'Foto não encontrada no servidor.');
      delete e.uploads[m[1]];
      return responder_(204, null);
    }

    m = caminho.match(/^\/testes\/(\w+)\/(\d+)\/fotos\/concluir$/);
    if (metodo === 'POST' && m) {
      const novos = (json?.client_uuids || []).filter((u) => e.uploads[u] && !e.notificados[u]);
      novos.forEach((u) => { e.notificados[u] = true; });
      return responder_(200, { notificado: novos.length > 0, quantidade: novos.length });
    }

    if (metodo === 'GET' && caminho === '/me') {
      const reg = Object.values(e.refresh).at(-1);
      return responder_(200, usuarioDe(reg?.email || 'demo@demo'));
    }

    return erro(404, 'rota_inexistente', `Rota não existe no servidor simulado: ${metodo} ${caminho}`);
  } finally {
    salvar(e);
  }
}
