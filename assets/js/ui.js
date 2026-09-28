/**
 * Utilitários de interface: ícones, toasts, diálogos e formatação.
 */

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

export function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function normalizar(texto) {
  return String(texto).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/* ---------- Ícones (SVG inline, sem dependências externas) ---------- */

const ICONES = {
  voltar: '<path d="M15 18l-6-6 6-6"/>',
  seta: '<path d="M9 18l6-6-6-6"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  galeria: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  alerta: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
  grade: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  caixa: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  sair: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H4"/>',
  lixeira: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  local: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  prancheta: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 13l2 2 4-4"/>',
};

export function icone(nome, classe = '') {
  return `<svg class="ico ${classe}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome] || ICONES.camera}</svg>`;
}

/* ---------- Status de sincronização ---------- */

export const ROTULO_STATUS = {
  pendente: 'Pendente',
  sincronizando: 'Sincronizando',
  sincronizado: 'Sincronizado',
  erro: 'Erro',
};

export function chipStatus(status, compacto = false) {
  const rotulo = ROTULO_STATUS[status] || status;
  return `<span class="chip chip-${esc(status)}${compacto ? ' chip-compacto' : ''}" title="${esc(rotulo)}">${compacto && status === 'sincronizado' ? icone('check') : esc(rotulo)}</span>`;
}

/* ---------- Formatação ---------- */

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatarDataHora(iso) {
  return iso ? fmtDataHora.format(new Date(iso)) : '—';
}

export function formatarBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function plural(n, singular, pluralTexto) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

/* ---------- Toasts ---------- */

export function toast(mensagem, { tipo = 'info', duracao = 3500, acao } = {}) {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');

  const texto = document.createElement('span');
  texto.textContent = mensagem;
  el.append(texto);

  const fechar = () => {
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 200);
  };

  if (acao) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'toast-acao';
    botao.textContent = acao.rotulo;
    botao.addEventListener('click', () => { fechar(); acao.fn(); });
    el.append(botao);
  }

  $('#toasts').append(el);
  if (duracao > 0) setTimeout(fechar, duracao);
  return fechar;
}

/* ---------- Diálogos ---------- */

/** Abre um diálogo modal novo; ele é removido do DOM ao fechar. */
export function abrirDialogo(html, { aoFechar } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogo';
  dlg.innerHTML = html;
  dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    aoFechar?.();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmar({ titulo, mensagem, rotuloConfirmar = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    let confirmado = false;
    const dlg = abrirDialogo(`
      <div class="dialogo-conteudo">
        <h2>${esc(titulo)}</h2>
        <p>${esc(mensagem)}</p>
        <div class="dialogo-acoes">
          <button type="button" class="btn btn-secundario" data-r="nao">Cancelar</button>
          <button type="button" class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-r="sim">${esc(rotuloConfirmar)}</button>
        </div>
      </div>`, { aoFechar: () => resolve(confirmado) });
    $('[data-r=sim]', dlg).addEventListener('click', () => { confirmado = true; dlg.close(); });
    $('[data-r=nao]', dlg).addEventListener('click', () => dlg.close());
  });
}

export function telaVazia(mensagem, link = '#/unidades', rotuloLink = 'Voltar ao início') {
  return `
    <div class="vazio">
      <p>${esc(mensagem)}</p>
      <a class="btn btn-secundario" href="${esc(link)}">${esc(rotuloLink)}</a>
    </div>`;
}
