import io
import re
from contextlib import contextmanager

import pytest
from PIL import Image

from app import create_app
from app.config import Config
from app.extensions import db
from app.models import Area, ItemChecklist, ModeloChecklist, Perfil, Periodicidade, Unidade, User
from app.security import hash_password

SENHA = "Senha-Forte#2026"


@pytest.fixture
def app(tmp_path):
    class TestConfig(Config):
        TESTING = True
        SECRET_KEY = "x" * 48
        SQLALCHEMY_DATABASE_URI = "sqlite://"
        UPLOAD_FOLDER = str(tmp_path / "uploads")
        WTF_CSRF_ENABLED = False
        SESSION_COOKIE_SECURE = False
        HSTS_ENABLED = True
        RATELIMIT_ENABLED = False

    app = create_app(TestConfig)
    with app.app_context():
        _popular()
    # Nenhum contexto fica aberto durante o teste: cada requisição ganha o
    # seu, como em produção. Consultas ao banco usam o fixture "banco".
    yield app
    with app.app_context():
        db.drop_all()


@pytest.fixture
def banco(app):
    """Uso: with banco() as s: s.scalar(...)"""

    @contextmanager
    def _banco():
        with app.app_context():
            yield db.session

    return _banco


def _popular():
    eng, ti = Area(nome="Engenharia"), Area(nome="T.I.")
    belem, vitoria = Unidade(nome="Belém"), Unidade(nome="Vitória")
    db.session.add_all([eng, ti, belem, vitoria])
    db.session.flush()
    h = hash_password(SENHA)
    db.session.add_all(
        [
            User(nome="Super Admin", email="root@ex.com", senha_hash=h, perfil=Perfil.ADMIN_PLUS),
            User(nome="Admin Eng", email="admin.eng@ex.com", senha_hash=h, perfil=Perfil.ADMIN,
                 area_id=eng.id),
            User(nome="Admin TI", email="admin.ti@ex.com", senha_hash=h, perfil=Perfil.ADMIN,
                 area_id=ti.id),
            User(nome="Ana Belem", email="ana@ex.com", senha_hash=h, perfil=Perfil.ANALISTA,
                 area_id=eng.id, unidade_id=belem.id),
            User(nome="Vitor Vitoria", email="vitor@ex.com", senha_hash=h, perfil=Perfil.ANALISTA,
                 area_id=eng.id, unidade_id=vitoria.id),
            User(nome="Tiago TI", email="tiago@ex.com", senha_hash=h, perfil=Perfil.ANALISTA,
                 area_id=ti.id, unidade_id=belem.id),
        ]
    )
    modelo = ModeloChecklist(titulo="Inspeção Gerador", area_id=eng.id,
                             periodicidade=Periodicidade.DIARIO)
    modelo.itens = [ItemChecklist(ordem=1, texto="Nível de óleo"), ItemChecklist(ordem=2, texto="Bateria")]
    db.session.add(modelo)
    db.session.commit()


def login(client, email, senha=SENHA):
    return client.post("/login", data={"email": email, "senha": senha})


@pytest.fixture
def entrar(app):
    """Retorna um cliente novo já logado com o e-mail informado."""

    def _entrar(email):
        c = app.test_client()
        resp = login(c, email)
        assert resp.status_code == 302, "login deveria redirecionar"
        return c

    return _entrar


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def ids(banco):
    with banco() as s:
        return {
            "modelo": s.scalar(db.select(ModeloChecklist.id)),
            "belem": s.scalar(db.select(Unidade.id).where(Unidade.nome == "Belém")),
            "vitoria": s.scalar(db.select(Unidade.id).where(Unidade.nome == "Vitória")),
            "eng": s.scalar(db.select(Area.id).where(Area.nome == "Engenharia")),
            "ti": s.scalar(db.select(Area.id).where(Area.nome == "T.I.")),
            **{u.email: u.id for u in s.scalars(db.select(User))},
        }


def iniciar_execucao(client, modelo_id, unidade_id=None):
    data = {"unidade_id": unidade_id} if unidade_id else {}
    resp = client.post(f"/checklists/{modelo_id}/iniciar", data=data)
    assert resp.status_code == 302
    return int(re.search(r"/execucoes/(\d+)/", resp.headers["Location"]).group(1))


def imagem_bytes(formato="PNG", tamanho=(50, 40)):
    buf = io.BytesIO()
    Image.new("RGB", tamanho, (200, 30, 30)).save(buf, formato)
    buf.seek(0)
    return buf
