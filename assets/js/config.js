/**
 * Configuração central da aplicação.
 * É o único arquivo que precisa ser alterado para apontar para o SIAC.
 */
export const CONFIG = {
  APP_NOME: 'Auditoria de Filiais',

  // Definida em assets/js/versao.js (altere lá a cada publicação).
  // Vai no cabeçalho X-App-Version de toda requisição.
  VERSAO: self.APP_VERSAO || 'dev',

  // Endereço da API mobile do SIAC (docs/CONTRATO-API-MOBILE-v1.md).
  // Vazio = modo demonstração: um servidor simulado dentro do app responde pelo contrato.
  // Ex.: 'https://<dominio-da-plataforma>/api/mobile/v1'
  API_BASE_URL: '',

  // Senha aceita no modo demonstração (qualquer e-mail).
  DEMO_SENHA: '1234',

  // Compressão das fotos antes de salvar no aparelho (contrato: ~1600 px, JPEG ~80).
  FOTO_MAX_LADO: 1600,
  FOTO_QUALIDADE: 0.8,

  // Tempo máximo das requisições comuns e do envio de uma foto.
  API_TIMEOUT_MS: 20000,
  SYNC_TIMEOUT_MS: 60000,
};

export const MODO_DEMO = !CONFIG.API_BASE_URL;
