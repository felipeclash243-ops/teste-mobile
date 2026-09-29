/** Seleção da filial (contrato, seção 4: GET /filiais). */
import { filiaisSalvas, atualizarFiliais } from '../catalogo.js';
import { resumoPorUnidadeTeste } from '../db.js';
import { sairComConfirmacao, tratarErroDeSessao } from '../auth.js';
import { $, esc, icone, normalizar, plural, textoAtualizado } from '../ui.js';

export async function render(el, { sessao, definirCabecalho }) {
  definirCabecalho({ titulo: 'Filiais', subtitulo: `Auditado: ${sessao.usuario.nome}` });

  el.innerHTML = `
    <section>
      <p class="instrucao">Selecione a filial onde a auditoria está sendo realizada.</p>

      <div class="atualizacao">
        <span id="atualizado" class="texto-suave"></span>
        <button type="button" class="btn-link" id="btn-atualizar">${icone('sync')} Atualizar</button>
      </div>

      <label class="busca">
        ${icone('busca')}
        <input type="search" id="busca" placeholder="Buscar filial" aria-label="Buscar filial" autocomplete="off">
      </label>

      <ul class="lista" id="lista"></ul>
      <p class="vazio-inline" id="sem-resultado" hidden>Nenhuma filial encontrada.</p>

      <button type="button" class="btn btn-texto" id="btn-sair">${icone('sair')} Sair</button>
    </section>`;

  const lista = $('#lista', el);
  const busca = $('#busca', el);
  const btnAtualizar = $('#btn-atualizar', el);

  function filtrar() {
    const termo = normalizar(busca.value.trim());
    let visiveis = 0;
    lista.querySelectorAll('li[data-busca]').forEach((li) => {
      const mostrar = li.dataset.busca.includes(termo);
      li.hidden = !mostrar;
      if (mostrar) visiveis++;
    });
    $('#sem-resultado', el).hidden = visiveis > 0 || !lista.querySelector('li[data-busca]');
  }

  async function desenhar(dados) {
    $('#atualizado', el).textContent = textoAtualizado(dados?.atualizadoEm);
    if (!dados) {
      lista.innerHTML = `<li class="vazio-inline">${navigator.onLine
        ? 'Carregando filiais…'
        : 'Sem internet. Conecte-se uma vez para baixar a lista de filiais.'}</li>`;
      return;
    }
    if (!dados.filiais.length) {
      lista.innerHTML = '<li class="vazio-inline">Nenhuma filial vinculada ao seu usuário. Procure a Auditoria.</li>';
      return;
    }
    const resumo = await resumoPorUnidadeTeste();
    const pendentesDa = (id) => Object.entries(resumo)
      .filter(([chave]) => chave.startsWith(`${id}|`))
      .reduce((soma, [, r]) => soma + r.pendentes, 0);

    lista.innerHTML = dados.filiais.map((f) => {
      const pend = pendentesDa(f.id);
      return `
        <li data-busca="${esc(normalizar(`${f.nome} ${f.codigo}`))}">
          <a class="item" href="#/u/${encodeURIComponent(f.id)}">
            <span class="item-icone">${icone('local')}</span>
            <span class="item-texto">
              <strong>${esc(f.nome)}</strong>
              <small>${esc(f.codigo)} · ${f.testes_disponiveis
                ? `<span class="texto-destaque">${plural(f.testes_disponiveis, 'teste aguardando', 'testes aguardando')}</span>`
                : 'Nenhum teste aguardando'}</small>
            </span>
            ${pend ? `<span class="pill pill-pendente" title="Fotos neste aparelho">${pend}</span>` : ''}
            ${icone('seta', 'item-seta')}
          </a>
        </li>`;
    }).join('');
    filtrar();
  }

  async function atualizar() {
    if (!navigator.onLine) return;
    btnAtualizar.disabled = true;
    try {
      await desenhar(await atualizarFiliais());
    } catch (e) {
      if (await tratarErroDeSessao(e)) return;
      $('#atualizado', el).textContent = `Não foi possível atualizar: ${e.message}`;
    } finally {
      btnAtualizar.disabled = false;
    }
  }

  busca.addEventListener('input', filtrar);
  btnAtualizar.addEventListener('click', atualizar);
  $('#btn-sair', el).addEventListener('click', sairComConfirmacao);

  await desenhar(await filiaisSalvas());
  atualizar();
}
