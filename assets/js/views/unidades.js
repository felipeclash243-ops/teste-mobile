/** Seleção da unidade auditada. */
import { listarUnidades } from '../catalogo.js';
import { resumoPorUnidadeTeste } from '../db.js';
import { sairComConfirmacao } from '../auth.js';
import { $, esc, icone, normalizar, plural } from '../ui.js';

export async function render(el, { sessao, definirCabecalho }) {
  definirCabecalho({ titulo: 'Unidades', subtitulo: `Auditado: ${sessao.nome}` });

  const unidades = listarUnidades();
  const resumo = await resumoPorUnidadeTeste();
  const pendentesDa = (u) => u.testes.reduce((soma, t) => soma + (resumo[`${u.id}|${t}`]?.pendentes || 0), 0);

  el.innerHTML = `
    <section>
      <p class="instrucao">Selecione a unidade onde a auditoria está sendo realizada.</p>

      <label class="busca">
        ${icone('busca')}
        <input type="search" id="busca" placeholder="Buscar unidade" aria-label="Buscar unidade" autocomplete="off">
      </label>

      <ul class="lista" id="lista">
        ${unidades.map((u) => {
          const pend = pendentesDa(u);
          return `
            <li data-busca="${esc(normalizar(`${u.nome} ${u.uf}`))}">
              <a class="item" href="#/u/${encodeURIComponent(u.id)}">
                <span class="item-icone">${icone('local')}</span>
                <span class="item-texto">
                  <strong>${esc(u.nome)}</strong>
                  <small>${esc(u.uf)} · ${plural(u.testes.length, 'teste', 'testes')}</small>
                </span>
                ${pend ? `<span class="pill pill-pendente" title="Fotos não sincronizadas">${pend}</span>` : ''}
                ${icone('seta', 'item-seta')}
              </a>
            </li>`;
        }).join('')}
      </ul>
      <p class="vazio-inline" id="sem-resultado" hidden>Nenhuma unidade encontrada.</p>

      <button type="button" class="btn btn-texto" id="btn-sair">${icone('sair')} Sair</button>
    </section>`;

  const itens = [...el.querySelectorAll('#lista li')];
  $('#busca', el).addEventListener('input', (ev) => {
    const termo = normalizar(ev.target.value.trim());
    let visiveis = 0;
    itens.forEach((li) => {
      const mostrar = li.dataset.busca.includes(termo);
      li.hidden = !mostrar;
      if (mostrar) visiveis++;
    });
    $('#sem-resultado', el).hidden = visiveis > 0;
  });

  $('#btn-sair', el).addEventListener('click', sairComConfirmacao);
}
