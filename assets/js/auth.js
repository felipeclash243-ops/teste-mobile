/**
 * Autenticação e sessão.
 *
 * Com API configurada: o login é validado no sistema web, que devolve um token.
 * Modo demonstração: aceita qualquer usuário com CONFIG.DEMO_SENHA.
 *
 * A sessão fica salva no aparelho por CONFIG.SESSAO_HORAS para permitir uso offline.
 */
import { CONFIG, MODO_DEMO } from './config.js';
import { getMeta, setMeta, delMeta, contarPorStatus } from './db.js';
import { confirmar, plural } from './ui.js';

let sessaoAtual = null;

export async function obterSessao() {
  if (!sessaoAtual) sessaoAtual = (await getMeta('sessao')) || null;
  if (sessaoAtual && sessaoAtual.expiraEm < Date.now()) {
    await sair();
  }
  return sessaoAtual;
}

export async function entrar(usuario, senha) {
  usuario = usuario.trim();
  if (!usuario || !senha) throw new Error('Informe usuário e senha.');

  let dados;
  if (MODO_DEMO) {
    if (senha !== CONFIG.DEMO_SENHA) throw new Error('Senha incorreta.');
    dados = { nome: usuario, token: null };
  } else {
    if (!navigator.onLine) throw new Error('O primeiro acesso precisa de internet.');
    let resp;
    try {
      resp = await fetch(`${CONFIG.API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
      });
    } catch {
      throw new Error('Não foi possível conectar ao servidor.');
    }
    if (resp.status === 401) throw new Error('Usuário ou senha inválidos.');
    if (!resp.ok) throw new Error(`Falha no login (HTTP ${resp.status}).`);
    dados = await resp.json();
  }

  sessaoAtual = {
    usuario,
    nome: dados.nome || usuario,
    token: dados.token || null,
    expiraEm: Date.now() + CONFIG.SESSAO_HORAS * 3600 * 1000,
  };
  await setMeta('sessao', sessaoAtual);
  await setMeta('ultimoUsuario', usuario);

  // Pede ao navegador para não apagar o banco local em caso de pouco espaço.
  navigator.storage?.persist?.().catch(() => {});

  return sessaoAtual;
}

/** Encerra a sessão. As fotos não sincronizadas permanecem salvas no aparelho. */
export async function sair() {
  sessaoAtual = null;
  await delMeta('sessao');
}

export async function sairComConfirmacao() {
  const c = await contarPorStatus();
  const naoEnviadas = c.pendente + c.erro;
  if (naoEnviadas > 0) {
    const ok = await confirmar({
      titulo: 'Sair da aplicação?',
      mensagem: `Há ${plural(naoEnviadas, 'foto não sincronizada', 'fotos não sincronizadas')}. Elas continuarão salvas neste aparelho e poderão ser enviadas no próximo acesso.`,
      rotuloConfirmar: 'Sair',
    });
    if (!ok) return;
  }
  await sair();
  location.hash = '#/login';
}

export function ultimoUsuario() {
  return getMeta('ultimoUsuario');
}
