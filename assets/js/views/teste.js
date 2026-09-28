/** Registro de fotos de um teste: câmera, galeria e lista de fotos com status. */
import { CONFIG } from '../config.js';
import { obterUnidade, obterTeste } from '../catalogo.js';
import { STATUS, salvarRegistro, listarPorTeste, obterRegistro, excluirRegistro } from '../db.js';
import { comprimirImagem } from '../imagem.js';
import {
  $, esc, icone, toast, chipStatus, formatarDataHora, formatarBytes,
  abrirDialogo, confirmar, telaVazia,
} from '../ui.js';

export async function render(el, { params, sessao, definirCabecalho }) {
  const unidade = obterUnidade(params.unidadeId);
  const teste = obterTeste(params.testeId);
  if (!unidade || !teste || !unidade.testes.includes(teste.id)) {
    definirCabecalho({ titulo: 'Teste não encontrado', voltar: '#/unidades' });
    el.innerHTML = telaVazia('Este teste não está disponível para a unidade.');
    return;
  }

  const voltar = `#/u/${encodeURIComponent(unidade.id)}`;
  definirCabecalho({ titulo: teste.nome, subtitulo: unidade.nome, voltar });

  const rotuloItem = teste.rotuloItem || 'Identificação do item';

  el.innerHTML = `
    <section class="captura">
      <div class="card">
        <label class="campo">
          <span>${esc(rotuloItem)} ${teste.itemObrigatorio ? '' : '<em>(opcional)</em>'}</span>
          <input id="item" autocomplete="off" autocapitalize="characters" enterkeyhint="done"
                 placeholder="Mantido para as próximas fotos">
        </label>
        <label class="campo">
          <span>Observação <em>(opcional)</em></span>
          <textarea id="obs" rows="2" placeholder="Aplicada à próxima foto"></textarea>
        </label>
      </div>

      <div class="acoes-captura">
        <label class="btn btn-primario btn-camera" id="btn-camera">
          ${icone('camera')} <span>Tirar foto</span>
          <input type="file" accept="image/*" capture="environment" class="oculto" id="in-camera">
        </label>
        <label class="btn btn-secundario btn-galeria" id="btn-galeria">
          ${icone('galeria')} <span>Galeria</span>
          <input type="file" accept="image/*" multiple class="oculto" id="in-galeria">
        </label>
      </div>
      <p class="dica">As fotos ficam salvas neste aparelho até a sincronização.</p>

      <h2 class="secao">Fotos deste teste <span id="contador"></span></h2>
      <div class="grade-fotos" id="grade"></div>
    </section>`;

  const inputItem = $('#item', el);
  const inputObs = $('#obs', el);
  const grade = $('#grade', el);
  const botoes = [$('#btn-camera', el), $('#btn-galeria', el)];
  const urls = [];

  function liberarUrls() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  }

  async function carregarGrade() {
    const registros = await listarPorTeste(unidade.id, teste.id);
    liberarUrls();
    $('#contador', el).textContent = registros.length ? `(${registros.length})` : '';
    if (!registros.length) {
      grade.innerHTML = '<p class="vazio-inline">Nenhuma foto registrada ainda.</p>';
      return;
    }
    grade.innerHTML = registros.map((r) => {
      const url = URL.createObjectURL(r.foto);
      urls.push(url);
      return `
        <button type="button" class="foto" data-id="${esc(r.id)}" aria-label="Abrir foto ${esc(r.itemId)}">
          <img src="${url}" alt="" loading="lazy">
          <span class="foto-rodape">
            <span class="foto-item">${esc(r.itemId || formatarDataHora(r.criadoEm))}</span>
            ${chipStatus(r.status, true)}
          </span>
        </button>`;
    }).join('');
  }

  function definirOcupado(ocupado) {
    botoes.forEach((b) => {
      b.classList.toggle('ocupado', ocupado);
      b.querySelector('input').disabled = ocupado;
    });
    $('#btn-camera span', el).textContent = ocupado ? 'Salvando…' : 'Tirar foto';
  }

  async function processarArquivos(arquivos) {
    if (!arquivos.length) return;
    const itemId = inputItem.value.trim();
    if (teste.itemObrigatorio && !itemId) {
      toast(`Informe: ${rotuloItem}.`, { tipo: 'erro' });
      inputItem.focus();
      return;
    }

    definirOcupado(true);
    let salvas = 0;
    try {
      for (const arquivo of arquivos) {
        const { blob, largura, altura } = await comprimirImagem(arquivo, {
          maxLado: CONFIG.FOTO_MAX_LADO,
          qualidade: CONFIG.FOTO_QUALIDADE,
        });
        await salvarRegistro({
          unidade, teste,
          usuario: sessao.usuario,
          itemId,
          observacao: inputObs.value.trim(),
          foto: blob, largura, altura,
        });
        salvas++;
      }
      inputObs.value = '';
      toast(salvas === 1 ? 'Foto salva no aparelho.' : `${salvas} fotos salvas no aparelho.`, { tipo: 'sucesso' });
    } catch (e) {
      console.error(e);
      const semEspaco = e?.name === 'QuotaExceededError';
      toast(semEspaco
        ? 'Sem espaço no aparelho. Sincronize e remova as fotos já enviadas.'
        : `Não foi possível salvar a foto: ${e.message}`, { tipo: 'erro', duracao: 6000 });
    } finally {
      definirOcupado(false);
      await carregarGrade();
    }
  }

  el.querySelectorAll('input[type=file]').forEach((input) => {
    input.addEventListener('change', async () => {
      const arquivos = [...input.files];
      input.value = '';
      await processarArquivos(arquivos);
    });
  });

  function abrirDetalhe(r) {
    const url = URL.createObjectURL(r.foto);
    const dlg = abrirDialogo(`
      <div class="detalhe">
        <img src="${url}" alt="Foto registrada">
        <dl class="meta">
          <dt>Status</dt><dd>${chipStatus(r.status)}</dd>
          ${r.itemId ? `<dt>${esc(rotuloItem)}</dt><dd>${esc(r.itemId)}</dd>` : ''}
          ${r.observacao ? `<dt>Observação</dt><dd>${esc(r.observacao)}</dd>` : ''}
          <dt>Registrada em</dt><dd>${formatarDataHora(r.criadoEm)}</dd>
          <dt>Auditado</dt><dd>${esc(r.usuario)}</dd>
          <dt>Arquivo</dt><dd>${r.largura}×${r.altura} · ${formatarBytes(r.fotoTamanho)}</dd>
          ${r.sincronizadoEm ? `<dt>Sincronizada em</dt><dd>${formatarDataHora(r.sincronizadoEm)}</dd>` : ''}
          ${r.status === STATUS.ERRO && r.ultimoErro ? `<dt>Último erro</dt><dd class="texto-erro">${esc(r.ultimoErro)}</dd>` : ''}
        </dl>
        <div class="dialogo-acoes">
          <button type="button" class="btn btn-perigo-contorno" data-acao="excluir"
                  ${r.status === STATUS.SINCRONIZANDO ? 'disabled' : ''}>${icone('lixeira')} Excluir</button>
          <button type="button" class="btn btn-primario" data-acao="fechar">Fechar</button>
        </div>
      </div>`, { aoFechar: () => URL.revokeObjectURL(url) });

    $('[data-acao=fechar]', dlg).addEventListener('click', () => dlg.close());
    $('[data-acao=excluir]', dlg).addEventListener('click', async () => {
      dlg.close();
      const ok = await confirmar({
        titulo: 'Excluir foto?',
        mensagem: r.status === STATUS.SINCRONIZADO
          ? 'Esta foto já foi enviada ao sistema web. Ela será removida apenas deste aparelho.'
          : 'Esta foto ainda NÃO foi enviada ao sistema web e será perdida definitivamente.',
        rotuloConfirmar: 'Excluir',
        perigo: true,
      });
      if (!ok) return;
      await excluirRegistro(r.id);
      toast('Foto excluída.');
      await carregarGrade();
    });
  }

  grade.addEventListener('click', async (ev) => {
    const alvo = ev.target.closest('.foto');
    if (!alvo) return;
    const registro = await obterRegistro(alvo.dataset.id);
    if (registro) abrirDetalhe(registro);
  });

  await carregarGrade();
  return liberarUrls;
}
