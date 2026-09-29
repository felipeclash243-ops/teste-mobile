/**
 * Cliente da API mobile do SIAC (docs/CONTRATO-API-MOBILE-v1.md).
 *
 * - Envia Authorization, X-App-Version e X-Device-Id em toda requisição.
 * - Converte o erro padrão { erro: { codigo, mensagem, detalhes } } em ErroApi.
 * - Guarda o access_token só em memória e o refresh_token no banco local;
 *   renova o acesso sozinho quando o servidor responde token_expirado.
 * - Sem API_BASE_URL, as requisições vão para o servidor simulado (api-mock.js).
 */
import { CONFIG, MODO_DEMO } from './config.js';
import { getMeta, setMeta, delMeta, novoId } from './db.js';

export class ErroApi extends Error {
  constructor(status, codigo, mensagem, detalhes = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/* ---------- Identificação do aparelho ---------- */

let deviceId = null;

export async function obterDeviceId() {
  if (!deviceId) {
    deviceId = await getMeta('deviceId');
    if (!deviceId) {
      deviceId = novoId();
      await setMeta('deviceId', deviceId);
    }
  }
  return deviceId;
}

export function nomeDoAparelho() {
  const ua = navigator.userAgent;
  const sistema = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : 'Navegador';
  return `${sistema} · app web ${CONFIG.VERSAO}`;
}

/* ---------- Sessão e tokens ---------- */

let accessToken = null;
let accessExpiraEm = 0;
let renovacao = null;

/** Grava o par de tokens devolvido por /auth/login ou /auth/refresh. */
export async function guardarTokens(resposta) {
  accessToken = resposta.access_token;
  accessExpiraEm = Date.parse(resposta.access_expira_em) || Date.now() + 3600 * 1000;
  const anterior = (await getMeta('sessao')) || {};
  await setMeta('sessao', {
    ...anterior,
    usuario: resposta.usuario || anterior.usuario,
    refresh_token: resposta.refresh_token,
    refresh_expira_em: resposta.refresh_expira_em,
  });
}

export async function apagarSessaoLocal() {
  accessToken = null;
  accessExpiraEm = 0;
  await delMeta('sessao');
}

async function tokenDeAcesso() {
  if (accessToken && Date.now() < accessExpiraEm - 30 * 1000) return accessToken;
  // Uma só renovação por vez, mesmo com várias requisições simultâneas.
  renovacao ??= (async () => {
    try {
      const sessao = await getMeta('sessao');
      if (!sessao?.refresh_token) throw new ErroApi(401, 'sessao_expirada', 'Sua sessão expirou. Entre novamente.');
      const r = await requisicao('/auth/refresh', {
        metodo: 'POST',
        autenticar: false,
        json: { refresh_token: sessao.refresh_token, device_id: await obterDeviceId() },
      });
      await guardarTokens(r);
      return accessToken;
    } finally {
      renovacao = null;
    }
  })();
  return renovacao;
}

/* ---------- Requisição ---------- */

async function transportar(metodo, caminho, init) {
  if (MODO_DEMO) {
    const mock = await import('./api-mock.js');
    return mock.responder(metodo, caminho, init);
  }
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), init.timeout);
  try {
    return await fetch(CONFIG.API_BASE_URL + caminho, {
      method: metodo, headers: init.headers, body: init.body, signal: controle.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new ErroApi(0, 'tempo_esgotado', 'O servidor demorou a responder.');
    throw new ErroApi(0, 'sem_rede', 'Não foi possível conectar ao servidor.');
  } finally {
    clearTimeout(limite);
  }
}

/**
 * Faz uma chamada à API. Retorna o corpo JSON (ou null em 204).
 * Lança ErroApi com status/codigo/mensagem do contrato.
 */
export async function requisicao(caminho, opcoes = {}) {
  const { metodo = 'GET', json, form, autenticar = true, timeout = CONFIG.API_TIMEOUT_MS, repetida = false } = opcoes;
  if (!navigator.onLine) throw new ErroApi(0, 'sem_rede', 'Sem conexão com a internet.');

  // Modo somente leitura: bloqueia no próprio aparelho qualquer gravação no SIAC.
  // Só o login (/auth/*) passa, porque o SIAC precisa identificar o usuário.
  if (!CONFIG.ENVIAR_FOTOS && metodo !== 'GET' && !caminho.startsWith('/auth/')) {
    throw new ErroApi(0, 'envio_desativado', 'O envio ao SIAC está desativado nesta fase. As fotos ficam salvas neste aparelho.');
  }

  const headers = {
    Accept: 'application/json',
    'X-App-Version': CONFIG.VERSAO,
    'X-Device-Id': await obterDeviceId(),
  };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (autenticar) headers.Authorization = `Bearer ${await tokenDeAcesso()}`;

  const resp = await transportar(metodo, caminho, {
    headers,
    body: json !== undefined ? JSON.stringify(json) : form,
    timeout,
  });

  if (resp.status === 204) return null;
  let corpo = null;
  try { corpo = await resp.json(); } catch { /* sem corpo JSON */ }
  if (resp.ok) return corpo ?? {};

  const e = corpo?.erro || {};
  const erro = new ErroApi(
    resp.status,
    e.codigo || `http_${resp.status}`,
    e.mensagem || `O servidor respondeu com erro (HTTP ${resp.status}).`,
    e.detalhes || {},
  );
  if (resp.status === 429) erro.retryAfter = Number(resp.headers.get('Retry-After')) || null;

  // Acesso expirado: renova uma vez e repete a mesma requisição.
  if (erro.codigo === 'token_expirado' && autenticar && !repetida) {
    accessToken = null;
    return requisicao(caminho, { ...opcoes, repetida: true });
  }
  throw erro;
}
