/* Comportamentos da interface. Sem scripts inline (compatível com a CSP). */
(function () {
  "use strict";

  // ---------- PWA ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {});
    });
  }

  // ---------- Confirmação e envio único ----------
  document.addEventListener("submit", function (e) {
    var form = e.target;
    var botao = e.submitter;
    var mensagem = (botao && botao.dataset.confirm) || form.dataset.confirm;
    if (mensagem && !window.confirm(mensagem)) {
      e.preventDefault();
      return;
    }
    if (form.dataset.enviando === "1") {
      e.preventDefault();
      return;
    }
    form.dataset.enviando = "1";
    // Mantém o valor do botão clicado (ex.: acao=concluir) antes de desabilitá-lo
    if (botao && botao.name) {
      var oculto = document.createElement("input");
      oculto.type = "hidden";
      oculto.name = botao.name;
      oculto.value = botao.value;
      form.appendChild(oculto);
    }
    form.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
  });

  // Ao voltar pelo histórico do navegador, reativa os formulários
  window.addEventListener("pageshow", function () {
    document.querySelectorAll("form[data-enviando]").forEach(function (form) {
      delete form.dataset.enviando;
      form.querySelectorAll("button").forEach(function (b) { b.disabled = false; });
    });
  });

  // ---------- Impressão ----------
  document.querySelectorAll("[data-imprimir]").forEach(function (b) {
    b.addEventListener("click", function () { window.print(); });
  });

  // ---------- Progresso e destaque de "não conforme" ----------
  var formChecklist = document.getElementById("form-checklist");
  if (formChecklist) {
    var itens = formChecklist.querySelectorAll("[data-item]");
    var barra = document.querySelector("[data-progresso] progress");
    var texto = document.querySelector("[data-progresso-texto]");
    var atualizar = function () {
      var respondidos = 0;
      itens.forEach(function (item) {
        var marcado = item.querySelector("input[type=radio]:checked");
        if (marcado) respondidos++;
        item.classList.toggle("item-nc", !!marcado && marcado.value === "NC");
      });
      if (barra) barra.value = respondidos;
      if (texto) texto.textContent = respondidos + "/" + itens.length;
    };
    formChecklist.addEventListener("change", function (e) {
      if (e.target.type === "radio") atualizar();
    });
    atualizar();
  }

  // ---------- Fotos: reduz no aparelho antes de enviar e mostra prévia ----------
  var DIMENSAO_MAX = 1600;

  function reduzirImagem(arquivo) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return resolve(arquivo);
      var url = URL.createObjectURL(arquivo);
      var img = new Image();
      img.onload = function () {
        var escala = Math.min(1, DIMENSAO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        if (escala === 1 && arquivo.size < 1.5 * 1024 * 1024) {
          URL.revokeObjectURL(url);
          return resolve(arquivo);
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * escala);
        canvas.height = Math.round(img.naturalHeight * escala);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (!blob) return resolve(arquivo);
          var nome = arquivo.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], nome, { type: "image/jpeg" }));
        }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(arquivo); };
      img.src = url;
    });
  }

  document.querySelectorAll("input[type=file][data-foto]").forEach(function (input) {
    input.addEventListener("change", function () {
      var maximo = parseInt(input.dataset.max || "3", 10);
      var arquivos = Array.prototype.slice.call(input.files || []);
      if (arquivos.length > maximo) {
        window.alert("Você pode anexar no máximo " + maximo + " foto(s) neste item.");
        arquivos = arquivos.slice(0, maximo);
      }
      var previa = input.closest("[data-item]").querySelector("[data-previa]");
      Promise.all(arquivos.map(reduzirImagem)).then(function (reduzidos) {
        try {
          var dt = new DataTransfer();
          reduzidos.forEach(function (f) { dt.items.add(f); });
          input.files = dt.files;
        } catch (err) {
          /* navegador antigo: envia o original; o servidor também reduz */
        }
        if (previa) {
          previa.textContent = "";
          reduzidos.forEach(function (f) {
            var img = document.createElement("img");
            img.alt = "Prévia da foto";
            img.src = URL.createObjectURL(f);
            previa.appendChild(img);
          });
        }
      });
    });
  });
})();
