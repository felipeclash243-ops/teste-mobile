from app.extensions import db
from app.models import AuditLog, Sessao, User
from app.security import validate_password, verify_password

from .conftest import SENHA, login


def _usuario(s, email):
    return s.scalar(db.select(User).where(User.email == email))


def _sessoes(s):
    return s.scalar(db.select(db.func.count(Sessao.id)))


def test_senha_guardada_com_argon2(banco):
    with banco() as s:
        u = _usuario(s, "ana@ex.com")
        assert u.senha_hash.startswith("$argon2id$")
        assert SENHA not in u.senha_hash
        assert verify_password(u.senha_hash, SENHA)


def test_politica_de_senha():
    assert validate_password("curta")
    assert validate_password("semnumeros-e-maiusculas")
    assert validate_password("joao.silva#A1x", email="joao.silva@ex.com")
    assert validate_password(SENHA) == []


def test_login_ok_e_cookie_seguro(client):
    resp = login(client, "ana@ex.com")
    assert resp.status_code == 302
    cookie = resp.headers.get("Set-Cookie", "")
    assert "HttpOnly" in cookie
    assert "SameSite=Lax" in cookie
    assert client.get("/").status_code == 200


def test_login_invalido_mensagem_generica(client):
    r1 = login(client, "ana@ex.com", "errada")
    r2 = login(client, "naoexiste@ex.com", "errada")
    assert r1.status_code == r2.status_code == 200
    assert "E-mail ou senha inválidos" in r1.get_data(as_text=True)
    assert "E-mail ou senha inválidos" in r2.get_data(as_text=True)


def test_bloqueio_apos_tentativas(client, app, banco):
    for _ in range(app.config["LOGIN_MAX_ATTEMPTS"]):
        login(client, "ana@ex.com", "errada")
    # Mesmo com a senha correta, a conta fica bloqueada
    assert login(client, "ana@ex.com", SENHA).status_code == 200
    with banco() as s:
        assert _usuario(s, "ana@ex.com").bloqueado_ate is not None
        assert s.scalar(
            db.select(db.func.count(AuditLog.id)).where(AuditLog.acao == "login_conta_bloqueada")
        ) == 1


def test_usuario_inativo_nao_entra(client, banco):
    with banco() as s:
        _usuario(s, "ana@ex.com").ativo = False
        s.commit()
    assert login(client, "ana@ex.com").status_code == 200


def test_logout_revoga_sessao_no_servidor(client, banco):
    login(client, "ana@ex.com")
    with banco() as s:
        assert _sessoes(s) == 1
    assert client.post("/logout").status_code == 302
    with banco() as s:
        assert _sessoes(s) == 0
    assert client.get("/").status_code == 302


def test_cookie_antigo_nao_vale_apos_logout(client, app):
    login(client, "ana@ex.com")
    nome = app.config["SESSION_COOKIE_NAME"]
    cookie_roubado = client.get_cookie(nome).value
    client.post("/logout")
    outro = app.test_client()
    outro.set_cookie(nome, cookie_roubado)
    assert outro.get("/").status_code == 302


def test_logout_exige_post(entrar):
    c = entrar("ana@ex.com")
    assert c.get("/logout").status_code == 405


def test_troca_de_senha_encerra_outras_sessoes(entrar):
    c1, c2 = entrar("ana@ex.com"), entrar("ana@ex.com")
    nova = "Outra-Senha#2026"
    resp = c1.post(
        "/configuracao/meus-dados",
        data={"senha_atual": SENHA, "nova_senha": nova, "confirmacao": nova},
    )
    assert resp.status_code == 302
    assert c1.get("/").status_code == 200  # sessão atual continua
    assert c2.get("/").status_code == 302  # outra sessão foi encerrada


def test_paginas_exigem_login(client):
    for url in ["/", "/realizados", "/configuracao/", "/configuracao/usuarios", "/fotos/1"]:
        assert client.get(url).status_code == 302
