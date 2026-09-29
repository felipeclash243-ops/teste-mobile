/** Testes da filial (contrato, seção 5.1: GET /filiais/{id}/testes). */
import { filiaisSalvas, testesSalvos, atualizarTestes } from '../catalogo.js';
import { CONFIG } from '../config.js';
import { resumoPorUnidadeTeste } from '../db.js';
import { tratarErroDeSessao } from '../auth.js';
import { regrasDoModulo } from '../data/modulos.js';
import { $, esc, icone, plural, formatarData, textoAtualizado, toast } from '../ui.js';

export async function render(el, { params, definirCabecalho }) {
  const filialId = params.unidadeId;
  const nomeSalvo = (await filiaisSalvas())?.filiais.find((f) => String(f.id) === filialId)?.nome;
  definirCabecalho({ titulo: nomeSalvo || 'Filial', subtitulo: 'Selecione o teste', voltar: '#/unidades' });

  el.innerHTML = `
    <section>
      <div class="atualizacao">
        <span id="atualizado" class="texto-suave"></span>
        <button type="button" class="btn-link" id="btn-atualizar">${icone('sync')} Atualizar</button>
      </div>
      <div id="conteudo"></div>
    </section>`;

  const conteudo = $('#conteudo', el);
  const btnAtualizar = $('#btn-atualizar', el);

  function item(t, resumo) {
    const r = resumo[`${filialId}|${t.ref}`] || { total: 0, pendentes: 0, rejeitadas: 0 };
    const detalhes = [
      t.aceita_fotos && t.prazo_filial ? `Prazo ${formatarData(t.prazo_filial)}` : null,
      t.fotos_enviadas ? `${plural(t.fotos_enviadas, 'foto no SIAC', 'fotos no SIAC')}` : null,
      r.pendentes ? `<span class="texto-pendente">${r.pendentes} ${CONFIG.ENVIAR_FOTOS ? 'a sincronizar' : 'no aparelho'}</span>` : null,
      r.rejeitadas ? `<span class="texto-erro">${plural(r.rejeitadas, 'rejeitada', 'rejeitadas')}</span>` : null,
    ].filter(Boolean).join(' · ');
    return `
      <li>
        <a class="item${t.aceita_fotos ? '' : ' item-inativo'}" href="#/u/${encodeURIComponent(filialId)}/t/${encodeURIComponent(t.ref)}">
          <span class="item-icone item-icone-teste">${icone(regrasDoModulo(t.modulo).icone)}</span>
          <span class="item-texto">
            <strong>${esc(t.nome)}</strong>
            <small><span class="chip chip-teste${t.aceita_fotos ? ' chip-teste-aberto' : ''}">${esc(t.status_rotulo)}</span></small>
            ${detalhes ? `<small class="item-contagem">${detalhes}</small>` : ''}
          </span>
          ${icone('seta', 'item-seta')}
        </a>
      </li>`;
  }

  async function desenhar(dados) {
    $('#atualizado', el).textContent = textoAtualizado(dados?.atualizadoEm);
    if (!dados) {
      conteudo.innerHTML = `<p class="vazio-inline">${navigator.onLine
        ? 'Carregando testes…'
        : 'Sem internet. Conecte-se para baixar os testes desta filial.'}</p>`;
      return;
    }
    if (dados.filial?.nome) definirCabecalho({ titulo: dados.filial.nome, subtitulo: 'Selecione o teste', voltar: '#/unidades' });
    const resumo = await resumoPorUnidadeTeste();

    conteudo.innerHTML = `
      <h2 class="secao">Aguardando a filial</h2>
      ${dados.disponiveis.length
        ? `<ul class="lista">${dados.disponiveis.map((t) => item(t, resumo)).join('')}</ul>`
        : '<p class="vazio-inline">Nenhum teste aguardando fotos desta filial.</p>'}
      ${dados.indisponiveis.length ? `
        <h2 class="secao">Outros testes</h2>
        <p class="texto-suave dica-secao">Estes testes não aceitam fotos no momento.</p>
        <ul class="lista">${dados.indisponiveis.map((t) => item(t, resumo)).join('')}</ul>` : ''}`;
  }

  async function atualizar() {
    if (!navigator.onLine) return;
    btnAtualizar.disabled = true;
    try {
      await desenhar(await atualizarTestes(filialId));
    } catch (e) {
      if (await tratarErroDeSessao(e)) return;
      if (e.codigo === 'filial_fora_do_escopo') {
        toast(e.message, { tipo: 'erro' });
        location.hash = '#/unidades';
        return;
      }
      $('#atualizado', el).textContent = `Não foi possível atualizar: ${e.message}`;
    } finally {
      btnAtualizar.disabled = false;
    }
  }

  btnAtualizar.addEventListener('click', atualizar);
  await desenhar(await testesSalvos(filialId));
  atualizar();
}
