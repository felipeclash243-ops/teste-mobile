/**
 * Ponto de entrada: inicializa o banco local, o roteador (hash) e o service worker.
 *
 * Rotas:
 *   #/login                    tela de bloqueio
 *   #/unidades                 seleção da unidade
 *   #/u/:unidade               testes da unidade
 *   #/u/:unidade/t/:teste      registro de fotos do teste
 *   #/sync                     sincronização
 */
import { CONFIG } from './config.js';
import { abrirDB, recuperarInterrompidos, contarPorStatus } from './db.js';
import { obterSessao } from './auth.js';
import { carregarCatalogo } from './catalogo.js';
import { $, esc, toast } from './ui.js';
import * as telaLogin from './views/login.js';
import * as telaUnidades from './views/unidades.js';
import * as telaTestes from './views/testes.js';
import * as telaTeste from './views/teste.js';
import * as telaSincronizacao from './views/sincronizacao.js';

const ROTA_INICIAL = '#/unidades';

const ROTAS = [
  { padrao: /^#\/login$/, tela: telaLogin, publica: true },
  { padrao: /^#\/unidades$/, tela: telaUnidades },
  { padrao: /^#\/u\/([^/]+)$/, tela: telaTestes, params: ['unidadeId'] },
  { padrao: /^#\/u\/([^/]+)\/t\/([^/]+)$/, tela: telaTeste, params: ['unidadeId', 'testeId'] },
  { padrao: /^#\/sync$/, tela: telaSincronizacao },
];

let limparTela = null;
let navegacao = 0;

function definirCabecalho(opcoes) {
  const topo = $('#topbar');
  if (!opcoes) {
    topo.hidden = true;
    document.title = CONFIG.APP_NOME;
    return;
  }
  topo.hidden = false;
  $('#titulo').textContent = opcoes.titulo;
  $('#subtitulo').textContent = opcoes.subtitulo || '';
  const voltar = $('#btn-voltar');
  voltar.hidden = !opcoes.voltar;
  voltar.onclick = opcoes.voltar ? () => { location.hash = opcoes.voltar; } : null;
  $('#btn-sync').hidden = location.hash === '#/sync';
  document.title = `${opcoes.titulo} · ${CONFIG.APP_NOME}`;
}

async function navegar() {
  const id = ++navegacao;
  const hash = location.hash || ROTA_INICIAL;
  const rota = ROTAS.find((r) => r.padrao.test(hash));
  if (!rota) return location.replace(ROTA_INICIAL);

  const sessao = await obterSessao();
  if (id !== navegacao) return;
  if (!rota.publica && !sessao) return location.replace('#/login');
  if (rota.publica && sessao) return location.replace(ROTA_INICIAL);

  const valores = hash.match(rota.padrao).slice(1).map(decodeURIComponent);
  const params = Object.fromEntries((rota.params || []).map((nome, i) => [nome, valores[i]]));

  limparTela?.();
  limparTela = null;

  // Cada navegação renderiza em um elemento próprio; se o usuário trocar de tela
  // antes do fim, a renderização antiga escreve em um elemento já descartado.
  const tela = document.createElement('div');
  tela.className = 'tela';
  $('#view').replaceChildren(tela);
  window.scrollTo(0, 0);

  try {
    const limpar = await rota.tela.render(tela, { params, sessao, definirCabecalho });
    if (id !== navegacao) limpar?.();
    else limparTela = limpar || null;
  } catch (e) {
    console.error(e);
    tela.innerHTML = `
      <div class="vazio">
        <p>Não foi possível abrir esta tela.</p>
        <p class="texto-suave">${esc(e.message)}</p>
        <a class="btn btn-secundario" href="${ROTA_INICIAL}">Voltar ao início</a>
      </div>`;
  }
}

async function atualizarBadge() {
  try {
    const c = await contarPorStatus();
    const n = c.pendente + c.erro;
    const badge = $('#badge-pendentes');
    badge.hidden = n === 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    $('#btn-sync').classList.toggle('tem-erro', c.erro > 0);
    $('#btn-sync').setAttribute('aria-label', n ? `Sincronização: ${n} fotos pendentes` : 'Sincronização');
  } catch (e) {
    console.warn(e);
  }
}

function atualizarConexao() {
  $('#offline-bar').hidden = navigator.onLine;
  document.body.classList.toggle('offline', !navigator.onLine);
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const tinhaControlador = Boolean(navigator.serviceWorker.controller);
  let recarregando = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControlador || recarregando) return;
    recarregando = true;
    location.reload();
  });

  // updateViaCache 'none': o navegador sempre confere sw.js e versao.js na rede.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const avisar = (worker) => toast('Nova versão disponível.', {
        duracao: 0,
        acao: { rotulo: 'Atualizar', fn: () => worker.postMessage('SKIP_WAITING') },
      });
      if (reg.waiting && tinhaControlador) avisar(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        novo?.addEventListener('statechange', () => {
          if (novo.state === 'installed' && navigator.serviceWorker.controller) avisar(novo);
        });
      });
    })
    .catch((e) => console.warn('Service worker não registrado:', e));
}

async function iniciar() {
  try {
    await abrirDB();
    const recuperados = await recuperarInterrompidos();
    if (recuperados) console.info(`${recuperados} registro(s) de sincronização interrompida voltaram para pendente.`);
  } catch (e) {
    console.error(e);
    $('#view').innerHTML = `
      <div class="vazio">
        <p><strong>Não foi possível abrir o banco de dados local.</strong></p>
        <p class="texto-suave">Verifique se o navegador não está em modo anônimo/privado e se há espaço livre no aparelho.</p>
      </div>`;
    return;
  }

  await carregarCatalogo();

  $('#btn-sync').addEventListener('click', () => { location.hash = '#/sync'; });
  window.addEventListener('hashchange', navegar);
  window.addEventListener('online', atualizarConexao);
  window.addEventListener('offline', atualizarConexao);
  window.addEventListener('registros:alterados', atualizarBadge);

  atualizarConexao();
  atualizarBadge();
  if (!location.hash) history.replaceState(null, '', ROTA_INICIAL);
  await navegar();

  registrarServiceWorker();
}

iniciar();
