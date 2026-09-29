/**
 * Regras de tela por módulo do SIAC (campo `modulo` dos testes).
 * O contrato não traz essas regras; elas são do app e podem ser ajustadas aqui.
 *
 * - icone: ícone do teste nas listas (ver ui.js)
 * - rotuloItem: rótulo do campo de identificação de cada foto
 * - itemObrigatorio: se a foto só pode ser salva com esse campo preenchido
 */
export const MODULOS = {
  avarias: { icone: 'alerta', rotuloItem: 'Código do produto / NF', itemObrigatorio: true },
  sf: { icone: 'caixa', rotuloItem: 'Código do produto', itemObrigatorio: false },
  gar: { icone: 'prancheta', rotuloItem: 'Código do produto / NF', itemObrigatorio: false },
  cl: { icone: 'grade', rotuloItem: 'Item do check list', itemObrigatorio: false },
  gt: { icone: 'camera', rotuloItem: 'Identificação', itemObrigatorio: false },
};

export const MODULO_PADRAO = { icone: 'camera', rotuloItem: 'Identificação', itemObrigatorio: false };

export function regrasDoModulo(modulo) {
  return MODULOS[modulo] || MODULO_PADRAO;
}
