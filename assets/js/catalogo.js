/**
 * Filiais e testes do usuário (contrato, seções 4 e 5).
 *
 * As listas vêm do SIAC e ficam guardadas no aparelho para uso offline.
 * As telas mostram primeiro o que está guardado e atualizam quando há internet.
 */
import { requisicao } from './api.js';
import { getMeta, setMeta } from './db.js';

/** { filiais: [...], atualizadoEm } ou null se nunca baixou. */
export function filiaisSalvas() {
  return getMeta('filiais').then((v) => v || null);
}

export async function atualizarFiliais() {
  const r = await requisicao('/filiais');
  const dados = { filiais: r.filiais || [], atualizadoEm: new Date().toISOString() };
  await setMeta('filiais', dados);
  return dados;
}

/** { filial, disponiveis, indisponiveis, atualizadoEm } ou null. */
export function testesSalvos(filialId) {
  return getMeta(`testes:${filialId}`).then((v) => v || null);
}

export async function atualizarTestes(filialId) {
  const r = await requisicao(`/filiais/${encodeURIComponent(filialId)}/testes`);
  const dados = {
    filial: r.filial,
    disponiveis: r.disponiveis || [],
    indisponiveis: r.indisponiveis || [],
    atualizadoEm: new Date().toISOString(),
  };
  await setMeta(`testes:${filialId}`, dados);
  return dados;
}

/** Detalhe do teste (orientação), guardado para uso offline. */
export function detalheSalvo(ref) {
  return getMeta(`teste:${ref}`).then((v) => v || null);
}

export async function atualizarDetalhe(modulo, id) {
  const r = await requisicao(`/testes/${encodeURIComponent(modulo)}/${encodeURIComponent(id)}`);
  await setMeta(`teste:${r.ref}`, r);
  return r;
}

export function todosOsTestes(dados) {
  return dados ? [...dados.disponiveis, ...dados.indisponiveis] : [];
}
