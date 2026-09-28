/** Tela de bloqueio / login. */
import { CONFIG, MODO_DEMO } from '../config.js';
import { entrar, ultimoUsuario } from '../auth.js';
import { atualizarCatalogoDoServidor } from '../catalogo.js';
import { $, esc, icone } from '../ui.js';

export async function render(el, { definirCabecalho }) {
  definirCabecalho(null);
  const usuarioSalvo = (await ultimoUsuario()) || '';

  el.innerHTML = `
    <section class="login">
      <div class="login-marca">
        <span class="login-logo">${icone('prancheta')}</span>
        <h1>${esc(CONFIG.APP_NOME)}</h1>
        <p>Registro de evidências em campo</p>
      </div>

      <form class="card login-form" novalidate>
        <label class="campo">
          <span>Usuário</span>
          <input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off"
                 spellcheck="false" required value="${esc(usuarioSalvo)}">
        </label>
        <label class="campo">
          <span>Senha</span>
          <input name="senha" type="password" autocomplete="current-password" required>
        </label>
        <p class="msg-erro" role="alert" hidden></p>
        <button class="btn btn-primario btn-grande" type="submit">Entrar</button>
      </form>

      ${MODO_DEMO ? `
        <p class="aviso">
          <strong>Modo demonstração</strong> — servidor não configurado.
          Use qualquer usuário e a senha <strong>${esc(CONFIG.DEMO_SENHA)}</strong>.
        </p>` : ''}

      <p class="versao">v${esc(CONFIG.VERSAO)}</p>
    </section>`;

  const form = $('form', el);
  const erro = $('.msg-erro', el);
  const botao = $('button[type=submit]', el);
  (usuarioSalvo ? form.senha : form.usuario).focus();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      const sessao = await entrar(form.usuario.value, form.senha.value);
      await atualizarCatalogoDoServidor(sessao.token);
      location.hash = '#/unidades';
    } catch (e) {
      erro.textContent = e.message;
      erro.hidden = false;
      form.senha.value = '';
      form.senha.focus();
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
}
