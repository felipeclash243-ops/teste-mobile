/** Registro de fotos de um teste: câmera, galeria e lista de fotos com status. */
import { CONFIG } from '../config.js';
import { obterUnidade, obterTeste } from '../catalogo.js';
import { STATUS, salvarRegistro, listarPorTeste, obterRegistro, excluirRegistro } from '../db.js';
import { comprimirImagem } from '../imagem.js';
import {
  $, esc, icone, toast, chipStatus, formatarDataHora, formatarBytes,
  abrirDialogo, confirmar, telaVazia, plural,
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
          <span>${esc(rotuloItem)} ${teste.itemObrigatorio ? '<strong class="obrigatorio">*</strong>' : '<em>(opcional)</em>'}</span>
          <input id="item" autocomplete="off" autocapitalize="characters" enterkeyhint="done"
                 aria-describedby="item-erro" ${teste.itemObrigatorio ? 'required aria-required="true"' : ''}
                 placeholder="${teste.itemObrigatorio ? 'Preencha antes de cada foto' : 'Aplicado à próxima foto'}">
          <small class="campo-erro" id="item-erro" hidden>Preencha este campo antes de tirar a foto.</small>
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
      <p class="dica">Na galeria, selecione várias fotos e identifique uma por uma em seguida.<br>
        As fotos ficam salvas neste aparelho até a sincronização.</p>

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
          <span class="foto-status">${chipStatus(r.status, true)}</span>
          <span class="foto-rodape">
            <span class="foto-item">${esc(r.itemId || formatarDataHora(r.criadoEm))}</span>
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

  const erroItem = $('#item-erro', el);

  function mostrarErroItem(mostrar) {
    erroItem.hidden = !mostrar;
    inputItem.toggleAttribute('aria-invalid', mostrar);
  }

  /** Campo obrigatório vazio: mostra o erro e devolve o foco ao campo. */
  function itemValido() {
    if (!teste.itemObrigatorio || inputItem.value.trim()) return true;
    mostrarErroItem(true);
    inputItem.focus();
    return false;
  }

  inputItem.addEventListener('input', () => {
    if (inputItem.value.trim()) mostrarErroItem(false);
  });

  /**
   * Comprime e grava as fotos no banco local.
   * itens: [{ arquivo, itemId, observacao }]. Retorna quantas foram salvas.
   */
  async function salvarFotos(itens) {
    definirOcupado(true);
    let salvas = 0;
    let ultimoErro = null;
    try {
      for (const { arquivo, itemId, observacao } of itens) {
        try {
          const { blob, largura, altura } = await comprimirImagem(arquivo, {
            maxLado: CONFIG.FOTO_MAX_LADO,
            qualidade: CONFIG.FOTO_QUALIDADE,
          });
          await salvarRegistro({
            unidade, teste,
            usuario: sessao.usuario,
            itemId, observacao,
            foto: blob, largura, altura,
          });
          salvas++;
        } catch (e) {
          console.error(e);
          ultimoErro = e;
          if (e?.name === 'QuotaExceededError') break;
        }
      }
    } finally {
      definirOcupado(false);
      await carregarGrade();
    }

    if (ultimoErro) {
      const motivo = ultimoErro.name === 'QuotaExceededError'
        ? 'Sem espaço no aparelho. Sincronize e remova as fotos já enviadas.'
        : ultimoErro.message;
      const falhas = itens.length - salvas;
      toast(`${plural(falhas, 'foto não foi salva', 'fotos não foram salvas')}: ${motivo}`, { tipo: 'erro', duracao: 6000 });
    } else {
      toast(salvas === 1 ? 'Foto salva no aparelho.' : `${salvas} fotos salvas no aparelho.`, { tipo: 'sucesso' });
    }
    return salvas;
  }

  /* ---------- Câmera: identificação digitada antes da foto ---------- */

  const inputCamera = $('#in-camera', el);

  // Valida antes de abrir a câmera, para o auditado não perder a foto tirada.
  inputCamera.addEventListener('click', (ev) => {
    if (!itemValido()) ev.preventDefault();
  });

  inputCamera.addEventListener('change', async () => {
    const [arquivo] = inputCamera.files;
    inputCamera.value = '';
    if (!arquivo || !itemValido()) return;
    const salvas = await salvarFotos([{
      arquivo,
      itemId: inputItem.value.trim(),
      observacao: inputObs.value.trim(),
    }]);
    if (salvas) {
      // Cada foto exige uma nova identificação: os campos voltam em branco.
      inputItem.value = '';
      inputObs.value = '';
    }
  });

  /* ---------- Galeria: seleciona várias e identifica uma por uma ---------- */

  const inputGaleria = $('#in-galeria', el);

  inputGaleria.addEventListener('change', async () => {
    const arquivos = [...inputGaleria.files];
    inputGaleria.value = '';
    if (!arquivos.length) return;
    const itens = await identificarFotos(arquivos);
    if (itens?.length) await salvarFotos(itens);
  });

  /**
   * Tela cheia que percorre as fotos selecionadas, uma por vez, pedindo
   * a identificação de cada uma. Resolve com os itens ou null se cancelado.
   */
  function identificarFotos(arquivos) {
    return new Promise((resolve) => {
      const fotos = arquivos.map((arquivo) => ({ arquivo, itemId: '', observacao: '' }));
      let atual = 0;
      let urlAtual = null;
      let resultado = null;

      const dlg = abrirDialogo(`
        <form class="identificar" novalidate>
          <div class="identificar-topo">
            <button type="button" class="icon-btn" data-acao="cancelar" aria-label="Cancelar seleção">${icone('fechar')}</button>
            <div class="identificar-titulo">
              <strong>Identificar fotos</strong>
              <small id="id-posicao"></small>
            </div>
          </div>
          <div class="progresso"><div class="progresso-barra" id="id-barra"></div></div>

          <div class="identificar-foto"><img id="id-img" alt=""></div>

          <div class="identificar-campos">
            <label class="campo">
              <span>${esc(rotuloItem)} ${teste.itemObrigatorio ? '<strong class="obrigatorio">*</strong>' : '<em>(opcional)</em>'}</span>
              <input id="id-item" autocomplete="off" autocapitalize="characters" aria-describedby="id-erro"
                     ${teste.itemObrigatorio ? 'required aria-required="true"' : ''}>
              <small class="campo-erro" id="id-erro" hidden>Preencha este campo para continuar.</small>
            </label>
            <label class="campo">
              <span>Observação <em>(opcional)</em></span>
              <textarea id="id-obs" rows="2"></textarea>
            </label>

            <div class="dialogo-acoes">
              <button type="button" class="btn btn-secundario" data-acao="anterior">Anterior</button>
              <button type="submit" class="btn btn-primario" id="id-avancar">Próxima</button>
            </div>
            <button type="button" class="btn btn-texto btn-remover" data-acao="remover">${icone('lixeira')} Remover esta foto da seleção</button>
          </div>
        </form>`, {
        classe: 'dialogo-tela-cheia',
        fecharNoFundo: false,
        aoFechar: () => {
          if (urlAtual) URL.revokeObjectURL(urlAtual);
          resolve(resultado);
        },
      });

      const form = $('form', dlg);
      const campoItem = $('#id-item', dlg);
      const campoObs = $('#id-obs', dlg);
      const erro = $('#id-erro', dlg);
      const img = $('#id-img', dlg);
      const btnAnterior = $('[data-acao=anterior]', dlg);
      const btnAvancar = $('#id-avancar', dlg);

      function guardarAtual() {
        fotos[atual].itemId = campoItem.value.trim();
        fotos[atual].observacao = campoObs.value.trim();
      }

      function mostrarErro(mostrar) {
        erro.hidden = !mostrar;
        campoItem.toggleAttribute('aria-invalid', mostrar);
      }

      function exibir() {
        const f = fotos[atual];
        const ultima = atual === fotos.length - 1;
        if (urlAtual) URL.revokeObjectURL(urlAtual);
        urlAtual = URL.createObjectURL(f.arquivo);
        img.src = urlAtual;
        img.alt = `Foto ${atual + 1} de ${fotos.length}`;
        $('#id-posicao', dlg).textContent = `Foto ${atual + 1} de ${fotos.length}`;
        $('#id-barra', dlg).style.width = `${((atual + 1) / fotos.length) * 100}%`;
        campoItem.value = f.itemId;
        campoObs.value = f.observacao;
        campoItem.enterKeyHint = ultima ? 'done' : 'next';
        mostrarErro(false);
        btnAnterior.disabled = atual === 0;
        btnAvancar.textContent = ultima
          ? `Salvar ${plural(fotos.length, 'foto', 'fotos')}`
          : 'Próxima';
        campoItem.focus();
      }

      async function cancelar() {
        const ok = await confirmar({
          titulo: 'Descartar a seleção?',
          mensagem: `${plural(fotos.length, 'foto selecionada não será salva', 'fotos selecionadas não serão salvas')}.`,
          rotuloConfirmar: 'Descartar',
          perigo: true,
        });
        if (ok) dlg.close();
      }

      campoItem.addEventListener('input', () => {
        if (campoItem.value.trim()) mostrarErro(false);
      });

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        guardarAtual();
        if (teste.itemObrigatorio && !fotos[atual].itemId) {
          mostrarErro(true);
          campoItem.focus();
          return;
        }
        if (atual < fotos.length - 1) {
          atual++;
          exibir();
          return;
        }
        resultado = fotos;
        dlg.close();
      });

      btnAnterior.addEventListener('click', () => {
        guardarAtual();
        atual--;
        exibir();
      });

      $('[data-acao=remover]', dlg).addEventListener('click', () => {
        fotos.splice(atual, 1);
        if (!fotos.length) {
          dlg.close();
          return;
        }
        atual = Math.min(atual, fotos.length - 1);
        exibir();
      });

      $('[data-acao=cancelar]', dlg).addEventListener('click', cancelar);

      // Botão "voltar" do Android / tecla Esc: pede confirmação em vez de fechar.
      dlg.addEventListener('cancel', (ev) => {
        ev.preventDefault();
        cancelar();
      });

      exibir();
    });
  }

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
