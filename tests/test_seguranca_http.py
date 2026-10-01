import pytest

from app import create_app
from app.config import Config

from .conftest import SENHA


def test_cabecalhos_de_seguranca(client):
    h = client.get("/login").headers
    assert "default-src 'self'" in h["Content-Security-Policy"]
    assert "frame-ancestors 'none'" in h["Content-Security-Policy"]
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert "max-age=" in h["Strict-Transport-Security"]
    assert h["Cache-Control"] == "no-store"


def test_saida_escapada_contra_xss(entrar):
    c = entrar("root@ex.com")
    payload = "<script>alert(1)</script>"
    c.post("/configuracao/areas", data={"nome": payload})
    html = c.get("/configuracao/areas").get_data(as_text=True)
    assert payload not in html
    assert "&lt;script&gt;" in html


def test_busca_com_caracteres_de_sql_nao_quebra(entrar):
    resp = entrar("root@ex.com").get("/configuracao/usuarios", query_string={"q": "' OR 1=1 --"})
    assert resp.status_code == 200
    assert "Nenhum usuário encontrado" in resp.get_data(as_text=True)


def test_erro_404_generico(client):
    resp = client.get("/nao-existe")
    assert resp.status_code == 404
    assert "Traceback" not in resp.get_data(as_text=True)


def test_csrf_obrigatorio(tmp_path):
    class CsrfConfig(Config):
        TESTING = True
        SECRET_KEY = "y" * 48
        SQLALCHEMY_DATABASE_URI = "sqlite://"
        UPLOAD_FOLDER = str(tmp_path)
        SESSION_COOKIE_SECURE = False
        WTF_CSRF_ENABLED = True
        RATELIMIT_ENABLED = False

    app = create_app(CsrfConfig)
    resp = app.test_client().post("/login", data={"email": "a@b.com", "senha": SENHA})
    assert resp.status_code == 400


def test_secret_key_obrigatoria():
    class SemSegredo(Config):
        SECRET_KEY = ""

    with pytest.raises(RuntimeError):
        create_app(SemSegredo)


def test_pwa_service_worker(client):
    resp = client.get("/sw.js")
    assert resp.status_code == 200
    assert resp.headers["Service-Worker-Allowed"] == "/"
    assert client.get("/offline").status_code == 200
    assert client.get("/static/manifest.webmanifest").status_code == 200
