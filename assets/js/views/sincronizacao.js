/** Painel de sincronização: resumo por status, envio, erros e armazenamento. */
import { MODO_DEMO } from '../config.js';
import { STATUS, contarPorStatus, listarPorStatus, excluirSincronizados } from '../db.js';
import { sair, sairComConfirmacao } from '../auth.js';
import { atualizarCatalogoDoServidor } from '../catalogo.js';
import { sincronizar, sincronizacaoEmAndamento, ErroAutenticacao } from '../sync.js';
import {
  $, esc, icone, toast, confirmar, formatarDataHora, formatarBytes, plural, ROTULO_STATUS,
} from '../ui.js';

export async function render(el, { sessao, definirCabecalho }) {
  definirCabecalho({
    titulo: 'Sincronização',
    subtitulo: MODO_DEMO ? 'Modo demonstração' : 'Envio ao sistema web',
    voltar: '#/unidades',
  });

  el.innerHTML = `
    <section class="sync">
      <div class="resumo-status" id="resumo"></div>

      <div class="card sync-acao">
        <p id="sync-msg" class="texto-suave"></p>
        <div class="progresso" id="progresso" hidden><div class="progresso-barra" id="barra"></div></div>
        <button type="button" class="btn btn-primario btn-grande" id="btn-sincronizar">
          ${icone('sync')} <span>Sincronizar agora</span>
        </button>
      </div>

      ${MODO_DEMO ? `
        <p class="aviso">
          <strong>Modo demonstração:</strong> nenhum servidor configurado. A sincronização é simulada
          e as fotos não saem do aparelho. Configure <code>API_BASE_URL</code> em <code>assets/js/config.js</code>.
        </p>` : ''}

      <div id="lista-erros"></div>

      <div class="card">
        <h2 class="secao">Armazenamento no aparelho</h2>
        <p id="armazenamento" class="texto-suave">Calculando…</p>
        <button type="button" class="btn btn-secundario" id="btn-limpar" hidden>Remover fotos já sincronizadas</button>
      </div>

      <button type="button" class="btn btn-texto" id="btn-sair">${icone('sair')} Sair (${esc(sessao.nome)})</button>
    </section>`;

  const btnSync = $('#btn-sincronizar', el);
  const msg = $('#sync-msg', el);
  const progresso = $('#progresso', el);
  const barra = $('#barra', el);
  let textoProgresso = '';

  async function atualizar() {
    const c = await contarPorStatus();
    const fila = c.pendente + c.erro;
    const rodando = sincronizacaoEmAndamento();

    $('#resumo', el).innerHTML = Object.values(STATUS).map((st) => `
      <div class="status-card status-${st}">
        <strong>${c[st]}</strong><span>${ROTULO_STATUS[st]}</span>
      </div>`).join('');

    if (rodando) msg.textContent = textoProgresso || 'Enviando fotos… mantenha a aplicação aberta.';
    else if (!navigator.onLine) msg.textContent = 'Sem internet. Conecte-se para sincronizar.';
    else if (fila === 0) msg.textContent = 'Tudo sincronizado.';
    else msg.textContent = `${plural(fila, 'foto aguardando', 'fotos aguardando')} envio.`;

    btnSync.disabled = rodando || !navigator.onLine || fila === 0;
    $('span', btnSync).textContent = rodando ? 'Sincronizando…' : 'Sincronizar agora';
    progresso.hidden = !rodando;

    const erros = await listarPorStatus(STATUS.ERRO);
    $('#lista-erros', el).innerHTML = erros.length ? `
      <div class="card card-erro">
        <h2 class="secao">${plural(erros.length, 'foto com erro', 'fotos com erro')}</h2>
        <p class="texto-suave">Serão reenviadas na próxima sincronização.</p>
        <ul class="lista-erros">
          ${erros.map((r) => `
            <li>
              <strong>${esc(r.unidadeNome)} · ${esc(r.testeNome)}</strong>
              <small>${formatarDataHora(r.criadoEm)}${r.itemId ? ` · ${esc(r.itemId)}` : ''} · ${plural(r.tentativas, 'tentativa', 'tentativas')}</small>
              <small class="texto-erro">${esc(r.ultimoErro || 'Erro desconhecido')}</small>
            </li>`).join('')}
        </ul>
      </div>` : '';

    const btnLimpar = $('#btn-limpar', el);
    btnLimpar.hidden = c.sincronizado === 0;
    btnLimpar.textContent = `Remover ${plural(c.sincronizado, 'foto já sincronizada', 'fotos já sincronizadas')}`;

    await atualizarArmazenamento();
  }

  async function atualizarArmazenamento() {
    const info = $('#armazenamento', el);
    if (!navigator.storage?.estimate) {
      info.textContent = 'Informação de espaço indisponível neste navegador.';
      return;
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const protegido = await navigator.storage.persisted?.();
    info.textContent = `${formatarBytes(usage)} usados de ${formatarBytes(quota)} disponíveis`
      + (protegido ? ' · armazenamento protegido' : ' · armazenamento não protegido');
  }

  btnSync.addEventListener('click', async () => {
    try {
      atualizarCatalogoDoServidor(sessao.token);
      const r = await sincronizar();
      if (!r) return;
      if (r.falhas) toast(`${r.enviados} enviada(s), ${r.falhas} com erro.`, { tipo: 'erro', duracao: 5000 });
      else toast(`${plural(r.enviados, 'foto sincronizada', 'fotos sincronizadas')}.`, { tipo: 'sucesso' });
    } catch (e) {
      toast(e.message, { tipo: 'erro', duracao: 5000 });
      if (e instanceof ErroAutenticacao) {
        await sair();
        location.hash = '#/login';
      }
    } finally {
      atualizar();
    }
  });

  $('#btn-limpar', el).addEventListener('click', async () => {
    const ok = await confirmar({
      titulo: 'Liberar espaço?',
      mensagem: 'As fotos já enviadas ao sistema web serão removidas deste aparelho. Fotos pendentes não serão afetadas.',
      rotuloConfirmar: 'Remover',
    });
    if (!ok) return;
    const n = await excluirSincronizados();
    toast(`${plural(n, 'foto removida', 'fotos removidas')} do aparelho.`);
  });

  $('#btn-sair', el).addEventListener('click', sairComConfirmacao);

  const aoProgresso = (ev) => {
    const { total, feitos } = ev.detail;
    barra.style.width = total ? `${Math.round((feitos / total) * 100)}%` : '0%';
    textoProgresso = `Enviando ${Math.min(feitos + 1, total)} de ${total}… mantenha a aplicação aberta.`;
    msg.textContent = textoProgresso;
  };
  let agendado = false;
  const aoAlterar = () => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; atualizar(); });
  };

  window.addEventListener('sync:progresso', aoProgresso);
  window.addEventListener('registros:alterados', aoAlterar);
  window.addEventListener('sync:fim', aoAlterar);
  window.addEventListener('online', aoAlterar);
  window.addEventListener('offline', aoAlterar);

  await atualizar();

  return () => {
    window.removeEventListener('sync:progresso', aoProgresso);
    window.removeEventListener('registros:alterados', aoAlterar);
    window.removeEventListener('sync:fim', aoAlterar);
    window.removeEventListener('online', aoAlterar);
    window.removeEventListener('offline', aoAlterar);
  };
}
