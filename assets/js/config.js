/**
 * Configuração central da aplicação.
 * É o único arquivo que precisa ser alterado para apontar para o sistema web.
 */
export const CONFIG = {
  APP_NOME: 'Auditoria de Filiais',

  // Definida em assets/js/versao.js (altere lá a cada publicação).
  VERSAO: self.APP_VERSAO || 'dev',

  // Endereço da API do sistema web. Vazio = modo demonstração (sem servidor).
  // Ex.: 'https://auditoria.suaempresa.com.br/api/mobile'
  API_BASE_URL: '',

  // Senha aceita no modo demonstração. Não tem efeito quando API_BASE_URL está preenchida.
  DEMO_SENHA: '1234',

  // Por quanto tempo o login vale no aparelho (inclusive offline).
  SESSAO_HORAS: 24,

  // Compressão das fotos antes de salvar no aparelho.
  FOTO_MAX_LADO: 1600,
  FOTO_QUALIDADE: 0.8,

  // Tempo máximo de envio de uma foto.
  SYNC_TIMEOUT_MS: 60000,
};

export const MODO_DEMO = !CONFIG.API_BASE_URL;
