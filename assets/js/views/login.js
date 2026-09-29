/** Tela de bloqueio / login (contrato, seção 3.1). */
import { CONFIG, MODO_DEMO } from '../config.js';
import { entrar, ultimoEmail } from '../auth.js';
import { $, esc, icone } from '../ui.js';

export async function render(el, { definirCabecalho }) {
  definirCabecalho(null);
  const emailSalvo = (await ultimoEmail()) || '';

  el.innerHTML = `
    <section class="login">
      <div class="login-marca">
        <span class="login-logo">${icone('prancheta')}</span>
        <h1>${esc(CONFIG.APP_NOME)}</h1>
        <p>Registro de evidências em campo</p>
      </div>

      <form class="card login-form" novalidate>
        <label class="campo">
          <span>E-mail</span>
          <input name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none"
                 autocorrect="off" spellcheck="false" required value="${esc(emailSalvo)}">
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
          <strong>Modo demonstração</strong>: servidor simulado.
          Use qualquer e-mail e a senha <strong>${esc(CONFIG.DEMO_SENHA)}</strong>.
        </p>` : ''}

      <p class="versao">v${esc(CONFIG.VERSAO)}</p>
    </section>`;

  const form = $('form', el);
  const erro = $('.msg-erro', el);
  const botao = $('button[type=submit]', el);
  (emailSalvo ? form.senha : form.email).focus();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.hidden = true;
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    try {
      await entrar(form.email.value, form.senha.value);
      location.hash = '#/unidades';
    } catch (e) {
      erro.textContent = e.codigo === 'muitas_tentativas' && e.retryAfter
        ? `${e.message} Tente de novo em ${Math.ceil(e.retryAfter / 60)} min.`
        : e.message;
      erro.hidden = false;
      form.senha.value = '';
      form.senha.focus();
    } finally {
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });
}
