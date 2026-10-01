from app.extensions import db
from app.models import Execucao, Perfil, User

from .conftest import SENHA, iniciar_execucao


def test_analista_nao_acessa_administracao(entrar):
    c = entrar("ana@ex.com")
    assert c.get("/configuracao/usuarios").status_code == 403
    assert c.get("/configuracao/checklists").status_code == 403
    assert c.get("/configuracao/areas").status_code == 403
    assert c.post("/configuracao/areas", data={"nome": "Hack"}).status_code == 403
    # A tela de configuração do analista mostra só os próprios dados
    resp = c.get("/configuracao/")
    assert resp.status_code == 302 and resp.headers["Location"].endswith("/configuracao/meus-dados")


def test_admin_so_cria_analista_da_propria_area(entrar, ids, banco):
    c = entrar("admin.eng@ex.com")
    base = {"nome": "Novo", "senha": SENHA, "unidade_id": ids["belem"]}

    # Tenta criar um Admin+ -> proibido
    r = c.post("/configuracao/usuarios/novo", data=dict(base, email="x1@ex.com", perfil=Perfil.ADMIN_PLUS))
    assert r.status_code == 403

    # Tenta criar na área de T.I. -> área é forçada para Engenharia
    r = c.post(
        "/configuracao/usuarios/novo",
        data=dict(base, email="x2@ex.com", perfil=Perfil.ANALISTA, area_id=ids["ti"]),
    )
    assert r.status_code == 302
    with banco() as s:
        novo = s.scalar(db.select(User).where(User.email == "x2@ex.com"))
        assert novo.area_id == ids["eng"] and novo.perfil == Perfil.ANALISTA


def test_admin_nao_edita_usuario_de_outra_area(entrar, ids):
    c = entrar("admin.eng@ex.com")
    assert c.get(f"/configuracao/usuarios/{ids['tiago@ex.com']}").status_code == 404
    assert c.post(f"/configuracao/usuarios/{ids['tiago@ex.com']}/remover").status_code == 404
    # Nem outro Admin da mesma área
    assert c.get(f"/configuracao/usuarios/{ids['admin.ti@ex.com']}").status_code == 404


def test_admin_nao_gerencia_checklist_de_outra_area(entrar, ids):
    c = entrar("admin.ti@ex.com")
    assert c.get(f"/configuracao/checklists/{ids['modelo']}").status_code == 404
    assert c.post(f"/configuracao/checklists/{ids['modelo']}/remover").status_code == 404


def test_idor_execucao_de_outra_unidade(entrar, ids):
    ex_id = iniciar_execucao(entrar("ana@ex.com"), ids["modelo"])

    # Analista de outra unidade da mesma área
    c = entrar("vitor@ex.com")
    assert c.get(f"/execucoes/{ex_id}").status_code == 404
    assert c.post(f"/execucoes/{ex_id}/preencher", data={}).status_code == 404
    # Admin de outra área
    assert entrar("admin.ti@ex.com").get(f"/execucoes/{ex_id}").status_code == 404
    # Admin da área e Admin+ enxergam
    assert entrar("admin.eng@ex.com").get(f"/execucoes/{ex_id}").status_code == 200
    assert entrar("root@ex.com").get(f"/execucoes/{ex_id}").status_code == 200
    # Admin vê mas não preenche o checklist de outra pessoa
    resp = entrar("admin.eng@ex.com").post(f"/execucoes/{ex_id}/preencher", data={})
    assert resp.status_code == 302 and resp.headers["Location"].endswith(f"/execucoes/{ex_id}")


def test_historico_filtra_por_unidade(entrar, ids):
    iniciar_execucao(entrar("ana@ex.com"), ids["modelo"])
    html = entrar("vitor@ex.com").get("/realizados").get_data(as_text=True)
    assert "Nenhum checklist encontrado" in html


def test_analista_nao_inicia_checklist_de_outra_area_ou_unidade(entrar, ids, banco):
    assert entrar("tiago@ex.com").post(f"/checklists/{ids['modelo']}/iniciar").status_code == 404
    # Tenta forçar outra unidade: ignorado, usa a própria
    ex_id = iniciar_execucao(entrar("ana@ex.com"), ids["modelo"], unidade_id=ids["vitoria"])
    with banco() as s:
        assert s.get(Execucao, ex_id).unidade_id == ids["belem"]


def test_admin_plus_nao_gerencia_a_si_mesmo(entrar, ids):
    c = entrar("root@ex.com")
    assert c.get(f"/configuracao/usuarios/{ids['root@ex.com']}").status_code == 404
