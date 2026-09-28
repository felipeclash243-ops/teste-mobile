/**
 * Banco local (IndexedDB).
 *
 * Stores:
 *  - registros: cada foto tirada, com metadados e status de sincronização.
 *  - meta: chave/valor para sessão, catálogo e preferências.
 */
const DB_NOME = 'auditoria-mobile';
const DB_VERSAO = 1;

export const STATUS = Object.freeze({
  PENDENTE: 'pendente',
  SINCRONIZANDO: 'sincronizando',
  SINCRONIZADO: 'sincronizado',
  ERRO: 'erro',
});

let dbPromise = null;

export function abrirDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NOME, DB_VERSAO);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('registros')) {
          const s = db.createObjectStore('registros', { keyPath: 'id' });
          s.createIndex('status', 'status');
          s.createIndex('unidadeTeste', ['unidadeId', 'testeId']);
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'chave' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Banco local bloqueado. Feche outras abas da aplicação.'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

/**
 * Executa `fn(store)` em uma transação e resolve somente após o commit,
 * garantindo que o dado está gravado antes de a interface confirmar ao usuário.
 */
async function executar(nomeStore, modo, fn) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(nomeStore, modo);
    const resultado = fn(tx.objectStore(nomeStore));
    tx.oncomplete = () => resolve(resultado && 'result' in resultado ? resultado.result : resultado);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Operação no banco local cancelada.'));
  });
}

function notificar() {
  window.dispatchEvent(new Event('registros:alterados'));
}

export function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Registros ---------- */

export async function salvarRegistro({ unidade, teste, usuario, itemId, observacao, foto, largura, altura }) {
  const agora = new Date().toISOString();
  const registro = {
    id: novoId(),
    unidadeId: unidade.id,
    unidadeNome: unidade.nome,
    testeId: teste.id,
    testeNome: teste.nome,
    usuario,
    itemId: itemId || '',
    observacao: observacao || '',
    criadoEm: agora,
    atualizadoEm: agora,
    status: STATUS.PENDENTE,
    tentativas: 0,
    ultimoErro: null,
    sincronizadoEm: null,
    foto,
    fotoTipo: foto.type,
    fotoTamanho: foto.size,
    largura,
    altura,
  };
  await executar('registros', 'readwrite', (s) => s.add(registro));
  notificar();
  return registro;
}

export async function atualizarRegistro(id, alteracoes) {
  await executar('registros', 'readwrite', (s) => {
    const req = s.get(id);
    req.onsuccess = () => {
      if (req.result) s.put({ ...req.result, ...alteracoes, atualizadoEm: new Date().toISOString() });
    };
  });
  notificar();
}

/** Exclui um registro. Recusa exclusão durante o envio para não gerar inconsistência. */
export async function excluirRegistro(id) {
  await executar('registros', 'readwrite', (s) => {
    const req = s.get(id);
    req.onsuccess = () => {
      if (req.result && req.result.status !== STATUS.SINCRONIZANDO) s.delete(id);
    };
  });
  notificar();
}

export function obterRegistro(id) {
  return executar('registros', 'readonly', (s) => s.get(id));
}

export async function listarPorTeste(unidadeId, testeId) {
  const lista = await executar('registros', 'readonly', (s) =>
    s.index('unidadeTeste').getAll(IDBKeyRange.only([unidadeId, testeId])));
  return lista.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

export function listarPorStatus(status) {
  return executar('registros', 'readonly', (s) => s.index('status').getAll(status));
}

/** Fila de envio: pendentes e com erro, do mais antigo para o mais novo. */
export async function listarParaEnvio() {
  const [pendentes, erros] = await Promise.all([listarPorStatus(STATUS.PENDENTE), listarPorStatus(STATUS.ERRO)]);
  return [...pendentes, ...erros].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export async function contarPorStatus() {
  const db = await abrirDB();
  const status = Object.values(STATUS);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('registros', 'readonly');
    const indice = tx.objectStore('registros').index('status');
    const contagem = {};
    status.forEach((st) => {
      const req = indice.count(st);
      req.onsuccess = () => { contagem[st] = req.result; };
    });
    tx.oncomplete = () => resolve(contagem);
    tx.onerror = () => reject(tx.error);
  });
}

/** Resumo por unidade/teste: { 'unidade|teste': { total, pendentes } }. */
export async function resumoPorUnidadeTeste() {
  const resumo = {};
  await executar('registros', 'readonly', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      const r = cursor.value;
      const chave = `${r.unidadeId}|${r.testeId}`;
      resumo[chave] ??= { total: 0, pendentes: 0 };
      resumo[chave].total++;
      if (r.status !== STATUS.SINCRONIZADO) resumo[chave].pendentes++;
      cursor.continue();
    };
  });
  return resumo;
}

/** Remove do aparelho as fotos já sincronizadas (libera espaço). Retorna a quantidade removida. */
export async function excluirSincronizados() {
  let removidos = 0;
  await executar('registros', 'readwrite', (s) => {
    const req = s.index('status').openCursor(IDBKeyRange.only(STATUS.SINCRONIZADO));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      removidos++;
      cursor.continue();
    };
  });
  if (removidos) notificar();
  return removidos;
}

/**
 * Registros que ficaram "sincronizando" porque a aplicação foi fechada
 * no meio do envio voltam para "pendente". O servidor deduplica pelo id.
 */
export async function recuperarInterrompidos() {
  const presos = await listarPorStatus(STATUS.SINCRONIZANDO);
  for (const r of presos) {
    await atualizarRegistro(r.id, { status: STATUS.PENDENTE });
  }
  return presos.length;
}

/* ---------- Meta (chave/valor) ---------- */

export async function getMeta(chave) {
  const item = await executar('meta', 'readonly', (s) => s.get(chave));
  return item ? item.valor : undefined;
}

export function setMeta(chave, valor) {
  return executar('meta', 'readwrite', (s) => s.put({ chave, valor }));
}

export function delMeta(chave) {
  return executar('meta', 'readwrite', (s) => s.delete(chave));
}
