/** Testes disponíveis para a unidade selecionada. */
import { obterUnidade, testesDaUnidade } from '../catalogo.js';
import { resumoPorUnidadeTeste } from '../db.js';
import { esc, icone, plural, telaVazia } from '../ui.js';

export async function render(el, { params, definirCabecalho }) {
  const unidade = obterUnidade(params.unidadeId);
  if (!unidade) {
    definirCabecalho({ titulo: 'Unidade não encontrada', voltar: '#/unidades' });
    el.innerHTML = telaVazia('Esta unidade não existe ou foi removida do catálogo.');
    return;
  }

  definirCabecalho({ titulo: unidade.nome, subtitulo: 'Selecione o teste', voltar: '#/unidades' });

  const testes = testesDaUnidade(unidade.id);
  const resumo = await resumoPorUnidadeTeste();

  if (!testes.length) {
    el.innerHTML = telaVazia('Nenhum teste disponível para esta unidade.');
    return;
  }

  el.innerHTML = `
    <section>
      <p class="instrucao">Testes disponíveis para <strong>${esc(unidade.nome)}</strong>.</p>
      <ul class="lista">
        ${testes.map((t) => {
          const r = resumo[`${unidade.id}|${t.id}`] || { total: 0, pendentes: 0 };
          return `
            <li>
              <a class="item" href="#/u/${encodeURIComponent(unidade.id)}/t/${encodeURIComponent(t.id)}">
                <span class="item-icone item-icone-teste">${icone(t.icone)}</span>
                <span class="item-texto">
                  <strong>${esc(t.nome)}</strong>
                  <small>${esc(t.descricao || '')}</small>
                  <small class="item-contagem">
                    ${r.total ? plural(r.total, 'foto', 'fotos') : 'Nenhuma foto'}
                    ${r.pendentes ? ` · <span class="texto-pendente">${r.pendentes} a sincronizar</span>` : ''}
                  </small>
                </span>
                ${icone('seta', 'item-seta')}
              </a>
            </li>`;
        }).join('')}
      </ul>
    </section>`;
}
