import io
from pathlib import Path

from PIL import Image

from app.extensions import db
from app.models import Execucao, Foto, StatusExecucao

from .conftest import imagem_bytes, iniciar_execucao


def _respostas(banco, ex_id):
    with banco() as s:
        return [r.id for r in s.get(Execucao, ex_id).respostas]


def _execucao(banco, ex_id):
    with banco() as s:
        ex = s.get(Execucao, ex_id)
        return ex.status, [r.status for r in ex.respostas]


def _campos(resposta_ids, status=None):
    return {f"status_{rid}": status for rid in resposta_ids} if status else {}


def _qtd_fotos(banco):
    with banco() as s:
        return s.scalar(db.select(db.func.count(Foto.id)))


def test_home_mostra_pendente(entrar):
    html = entrar("ana@ex.com").get("/").get_data(as_text=True)
    assert "Pendentes" in html and "Inspeção Gerador" in html


def test_fluxo_completo_e_bloqueio_apos_concluir(entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rids = _respostas(banco, ex_id)
    url = f"/execucoes/{ex_id}/preencher"

    # Concluir sem responder tudo -> continua em andamento
    c.post(url, data={"acao": "concluir"})
    assert _execucao(banco, ex_id)[0] == StatusExecucao.EM_ANDAMENTO

    # Não conforme sem observação -> recusa
    c.post(url, data=dict(_campos(rids, "NC"), acao="concluir"))
    assert _execucao(banco, ex_id)[0] == StatusExecucao.EM_ANDAMENTO

    data = dict(_campos(rids, "C"), acao="concluir")
    data[f"fotos_{rids[0]}"] = (imagem_bytes("JPEG"), "foto.jpg", "image/jpeg")
    resp = c.post(url, data=data, content_type="multipart/form-data")
    assert resp.status_code == 302
    assert _execucao(banco, ex_id) == (StatusExecucao.CONCLUIDO, ["C", "C"])

    # Depois de concluído, o analista não altera mais
    resp = c.post(url, data=_campos(rids, "NA"))
    assert resp.status_code == 302 and resp.headers["Location"].endswith(f"/execucoes/{ex_id}")
    assert _execucao(banco, ex_id) == (StatusExecucao.CONCLUIDO, ["C", "C"])
    assert c.post(f"/execucoes/{ex_id}/reabrir").status_code == 403

    # Foto é servida por rota autenticada e com nome gerado pelo servidor
    with banco() as s:
        foto = s.scalar(db.select(Foto))
        foto_id, arquivo = foto.id, foto.arquivo
    assert arquivo.endswith(".jpg") and "foto" not in arquivo
    resp = c.get(f"/fotos/{foto_id}")
    assert resp.status_code == 200 and resp.mimetype == "image/jpeg"
    assert "private" in resp.headers["Cache-Control"]

    assert "Inspeção Gerador" in c.get("/realizados").get_data(as_text=True)
    assert "Nível de óleo" in c.get(f"/execucoes/{ex_id}").get_data(as_text=True)


def test_nc_exige_observacao_e_aceita_com_ela(entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rids = _respostas(banco, ex_id)
    data = dict(_campos(rids, "NC"), acao="concluir")
    data.update({f"obs_{rid}": "Vazamento encontrado" for rid in rids})
    c.post(f"/execucoes/{ex_id}/preencher", data=data)
    assert _execucao(banco, ex_id) == (StatusExecucao.CONCLUIDO, ["NC", "NC"])


def test_admin_pode_reabrir(entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    c.post(f"/execucoes/{ex_id}/preencher",
           data=dict(_campos(_respostas(banco, ex_id), "C"), acao="concluir"))
    assert entrar("admin.eng@ex.com").post(f"/execucoes/{ex_id}/reabrir").status_code == 302
    assert _execucao(banco, ex_id)[0] == StatusExecucao.EM_ANDAMENTO


def test_upload_rejeita_arquivo_disfarcado(app, entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rid = _respostas(banco, ex_id)[0]

    casos = [
        (io.BytesIO(b"<?php system($_GET['c']); ?>"), "shell.jpg", "image/jpeg"),
        (io.BytesIO(b"MZ\x90\x00executavel"), "virus.exe", "application/octet-stream"),
        (imagem_bytes("PNG"), "png-com-extensao-errada.jpg", "image/jpeg"),
        (imagem_bytes("JPEG"), "../../etc/passwd.jpg.html", "text/html"),
        (io.BytesIO(b"<svg onload=alert(1)>"), "img.svg", "image/svg+xml"),
    ]
    for arquivo, nome, mime in casos:
        c.post(
            f"/execucoes/{ex_id}/preencher",
            data={f"fotos_{rid}": (arquivo, nome, mime)},
            content_type="multipart/form-data",
        )
    assert _qtd_fotos(banco) == 0
    assert list(Path(app.config["UPLOAD_FOLDER"]).iterdir()) == []


def test_upload_reprocessa_e_reduz(app, entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rid = _respostas(banco, ex_id)[0]
    c.post(
        f"/execucoes/{ex_id}/preencher",
        data={f"fotos_{rid}": (imagem_bytes("PNG", (3000, 2000)), "grande.png", "image/png")},
        content_type="multipart/form-data",
    )
    with banco() as s:
        arquivo = s.scalar(db.select(Foto.arquivo))
    with Image.open(Path(app.config["UPLOAD_FOLDER"]) / arquivo) as img:
        assert img.format == "JPEG"
        assert max(img.size) == app.config["PHOTO_MAX_DIMENSION"]
        assert not img.getexif()


def test_limite_de_fotos_por_item(app, entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rid = _respostas(banco, ex_id)[0]
    n = app.config["MAX_PHOTOS_PER_ITEM"] + 1
    c.post(
        f"/execucoes/{ex_id}/preencher",
        data={f"fotos_{rid}": [(imagem_bytes("JPEG"), f"{i}.jpg", "image/jpeg") for i in range(n)]},
        content_type="multipart/form-data",
    )
    assert _qtd_fotos(banco) == 0


def test_foto_de_outra_unidade_retorna_404(entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rid = _respostas(banco, ex_id)[0]
    c.post(
        f"/execucoes/{ex_id}/preencher",
        data={f"fotos_{rid}": (imagem_bytes("JPEG"), "a.jpg", "image/jpeg")},
        content_type="multipart/form-data",
    )
    with banco() as s:
        foto_id = s.scalar(db.select(Foto.id))
    assert entrar("vitor@ex.com").get(f"/fotos/{foto_id}").status_code == 404


def test_descartar_rascunho_apaga_fotos(app, entrar, ids, banco):
    c = entrar("ana@ex.com")
    ex_id = iniciar_execucao(c, ids["modelo"])
    rid = _respostas(banco, ex_id)[0]
    c.post(
        f"/execucoes/{ex_id}/preencher",
        data={f"fotos_{rid}": (imagem_bytes("JPEG"), "a.jpg", "image/jpeg")},
        content_type="multipart/form-data",
    )
    assert _qtd_fotos(banco) == 1
    assert c.post(f"/execucoes/{ex_id}/descartar").status_code == 302
    assert _qtd_fotos(banco) == 0
    assert list(Path(app.config["UPLOAD_FOLDER"]).iterdir()) == []


def test_admin_cria_checklist_e_analista_ve_na_home(entrar, ids):
    c = entrar("admin.eng@ex.com")
    resp = c.post(
        "/configuracao/checklists/novo",
        data={"titulo": "Ronda do ar-condicionado", "periodicidade": "semanal",
              "itens": "Filtro limpo\n\nDreno livre\n", "unidades": [ids["belem"]]},
    )
    assert resp.status_code == 302
    assert "Ronda do ar-condicionado" in entrar("ana@ex.com").get("/").get_data(as_text=True)
    # Restrito a Belém: analista de Vitória não vê
    assert "Ronda do ar-condicionado" not in entrar("vitor@ex.com").get("/").get_data(as_text=True)
