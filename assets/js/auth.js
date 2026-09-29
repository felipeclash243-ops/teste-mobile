/**
 * Login e sessão (contrato, seção 3).
 *
 * A sessão local guarda o usuário e o refresh_token (30 dias, rotativo).
 * Enquanto o refresh_token for válido, o app abre mesmo sem internet;
 * o access_token é obtido sob demanda quando houver conexão.
 */
import { CONFIG } from './config.js';
import { getMeta, setMeta, contarPorStatus } from './db.js';
import { requisicao, guardarTokens, apagarSessaoLocal, obterDeviceId, nomeDoAparelho } from './api.js';
import { confirmar, plural, toast } from './ui.js';

export async function obterSessao() {
  const sessao = await getMeta('sessao');
  if (!sessao?.refresh_token || !sessao.usuario) return null;
  if (Date.parse(sessao.refresh_expira_em) < Date.now()) {
    await apagarSessaoLocal();
    return null;
  }
  return sessao;
}

export async function entrar(email, senha) {
  email = email.trim().toLowerCase();
  if (!email || !senha) throw new Error('Informe e-mail e senha.');
  const r = await requisicao('/auth/login', {
    metodo: 'POST',
    autenticar: false,
    json: { email, senha, device_id: await obterDeviceId(), device_nome: nomeDoAparelho() },
  });
  await guardarTokens(r);
  await setMeta('ultimoEmail', email);

  // Pede ao navegador para não apagar o banco local em caso de pouco espaço.
  navigator.storage?.persist?.().catch(() => {});
  return obterSessao();
}

/** Encerra a sessão. As fotos não sincronizadas permanecem salvas no aparelho. */
export async function sair() {
  if (navigator.onLine) {
    try {
      await requisicao('/auth/logout', { metodo: 'POST', timeout: 5000 });
    } catch { /* sem conexão ou sessão já expirada: basta apagar localmente */ }
  }
  await apagarSessaoLocal();
}

export async function sairComConfirmacao() {
  const c = await contarPorStatus();
  // Na fase somente leitura nada é enviado, então não há o que perder ao sair.
  const naoEnviadas = CONFIG.ENVIAR_FOTOS ? c.pendente + c.erro : 0;
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

/**
 * Trata erros de sessão vindos da API em qualquer tela.
 * Retorna true se o erro foi tratado (o chamador deve parar).
 */
export async function tratarErroDeSessao(erro) {
  if (erro?.codigo === 'sessao_expirada' || erro?.codigo === 'conta_bloqueada') {
    const msg = erro.codigo === 'conta_bloqueada'
      ? erro.message
      : 'Sua sessão expirou. Entre novamente; as fotos continuam salvas no aparelho.';
    toast(msg, { tipo: 'erro', duracao: 6000 });
    await apagarSessaoLocal();
    location.hash = '#/login';
    return true;
  }
  if (erro?.codigo === 'versao_desatualizada') {
    toast(erro.message || 'Esta versão do app está desatualizada. Feche e abra novamente para atualizar.', { tipo: 'erro', duracao: 8000 });
    return true;
  }
  return false;
}

export function ultimoEmail() {
  return getMeta('ultimoEmail');
}

