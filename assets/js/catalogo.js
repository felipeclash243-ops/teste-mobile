/**
 * Catálogo de unidades e testes.
 * Usa o catálogo do servidor salvo no aparelho; se não houver, usa o padrão.
 */
import { CONFIG, MODO_DEMO } from './config.js';
import { UNIDADES, TESTES } from './data/catalogo-padrao.js';
import { getMeta, setMeta } from './db.js';

let catalogo = { unidades: UNIDADES, testes: TESTES };

function valido(c) {
  return c && Array.isArray(c.unidades) && Array.isArray(c.testes) && c.unidades.length > 0;
}

export async function carregarCatalogo() {
  try {
    const salvo = await getMeta('catalogo');
    if (valido(salvo)) catalogo = salvo;
  } catch (e) {
    console.warn('Catálogo salvo indisponível, usando o padrão.', e);
  }
}

/** Busca o catálogo no sistema web e salva no aparelho. Falhas são silenciosas (uso offline). */
export async function atualizarCatalogoDoServidor(token) {
  if (MODO_DEMO || !navigator.onLine) return false;
  try {
    const resp = await fetch(`${CONFIG.API_BASE_URL}/catalogo`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) return false;
    const dados = await resp.json();
    if (!valido(dados)) return false;
    catalogo = { unidades: dados.unidades, testes: dados.testes };
    await setMeta('catalogo', catalogo);
    return true;
  } catch {
    return false;
  }
}

export function listarUnidades() {
  return [...catalogo.unidades].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function obterUnidade(id) {
  return catalogo.unidades.find((u) => u.id === id);
}

export function obterTeste(id) {
  return catalogo.testes.find((t) => t.id === id);
}

export function testesDaUnidade(unidadeId) {
  const unidade = obterUnidade(unidadeId);
  return unidade ? unidade.testes.map(obterTeste).filter(Boolean) : [];
}
