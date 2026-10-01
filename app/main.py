"""Home, preenchimento de checklists, histórico, fotos e rotas do PWA."""
from datetime import timedelta

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from flask_login import current_user, login_required
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from .audit import audit
from .extensions import db
from .models import (
    Area,
    Execucao,
    Foto,
    ModeloChecklist,
    Periodicidade,
    Resposta,
    StatusExecucao,
    StatusItem,
    Unidade,
    User,
    utcnow,
)
from .permissions import (
    filtro_execucoes,
    pode_editar_execucao,
    pode_executar,
    pode_reabrir_execucao,
    pode_ver_execucao,
)
from .uploads import UploadError, caminho_seguro, pasta_uploads, processar_foto, remover_arquivo
from .utils import inicio_do_dia_utc, inicio_do_periodo, ler_data, ler_int, limpar_texto

bp = Blueprint("main", __name__)


# ------------------------------ Auxiliares --------------------------------- #
def _execucao_visivel_or_404(execucao_id: int) -> Execucao:
    ex = db.session.get(Execucao, execucao_id)
    if ex is None or not pode_ver_execucao(current_user, ex):
        abort(404)
    return ex


def _modelos_para_usuario() -> list[ModeloChecklist]:
    q = (
        select(ModeloChecklist)
        .where(ModeloChecklist.ativo.is_(True))
        .options(selectinload(ModeloChecklist.unidades), selectinload(ModeloChecklist.itens))
        .order_by(ModeloChecklist.titulo)
    )
    if not current_user.is_admin_plus:
        if current_user.area_id is None:
            return []
        q = q.where(ModeloChecklist.area_id == current_user.area_id)
    modelos = list(db.session.scalars(q))
    if current_user.is_analista:
        modelos = [m for m in modelos if m.unidade_permitida(current_user.unidade_id)]
    return modelos


def _unidades_para_modelo(modelo: ModeloChecklist, unidades_ativas: list[Unidade]) -> list[Unidade]:
    if current_user.is_analista:
        return [u for u in unidades_ativas if u.id == current_user.unidade_id]
    if modelo.unidades:
        return [u for u in modelo.unidades if u.ativo]
    return unidades_ativas


# -------------------------------- Home ------------------------------------- #
@bp.route("/")
@login_required
def home():
    rascunhos = list(
        db.session.scalars(
            select(Execucao)
            .where(
                Execucao.usuario_id == current_user.id,
                Execucao.status == StatusExecucao.EM_ANDAMENTO,
            )
            .order_by(Execucao.atualizado_em.desc())
        )
    )
    modelos = _modelos_para_usuario()
    unidades_ativas = list(
        db.session.scalars(select(Unidade).where(Unidade.ativo.is_(True)).order_by(Unidade.nome))
    )

    # Última conclusão de cada modelo na unidade do usuário
    ultima_conclusao = {}
    if current_user.unidade_id:
        linhas = db.session.execute(
            select(Execucao.modelo_id, func.max(Execucao.concluido_em))
            .where(
                Execucao.unidade_id == current_user.unidade_id,
                Execucao.status == StatusExecucao.CONCLUIDO,
            )
            .group_by(Execucao.modelo_id)
        )
        ultima_conclusao = dict(linhas.all())

    pendentes, disponiveis = [], []
    for m in modelos:
        card = {
            "modelo": m,
            "unidades": _unidades_para_modelo(m, unidades_ativas),
            "ultima": ultima_conclusao.get(m.id),
        }
        inicio = inicio_do_periodo(m.periodicidade)
        if (
            current_user.unidade_id
            and m.unidade_permitida(current_user.unidade_id)
            and inicio is not None
            and (card["ultima"] is None or card["ultima"] < inicio)
        ):
            pendentes.append(card)
        else:
            disponiveis.append(card)

    return render_template(
        "main/home.html", rascunhos=rascunhos, pendentes=pendentes, disponiveis=disponiveis
    )


# --------------------------- Execução de checklist ------------------------- #
@bp.route("/checklists/<int:modelo_id>/iniciar", methods=["POST"])
@login_required
def iniciar(modelo_id):
    modelo = db.session.get(ModeloChecklist, modelo_id)
    if current_user.is_analista:
        unidade_id = current_user.unidade_id
    else:
        unidade_id = ler_int(request.form.get("unidade_id")) or current_user.unidade_id
    unidade = db.session.get(Unidade, unidade_id) if unidade_id else None

    if modelo is None or not pode_executar(current_user, modelo, unidade_id):
        abort(404)
    if unidade is None or not unidade.ativo:
        flash("Selecione uma unidade válida.", "error")
        return redirect(url_for(".home"))
    if not modelo.itens:
        flash("Este checklist ainda não tem itens cadastrados.", "error")
        return redirect(url_for(".home"))

    existente = db.session.scalar(
        select(Execucao).where(
            Execucao.modelo_id == modelo.id,
            Execucao.unidade_id == unidade.id,
            Execucao.usuario_id == current_user.id,
            Execucao.status == StatusExecucao.EM_ANDAMENTO,
        )
    )
    if existente:
        return redirect(url_for(".preencher", execucao_id=existente.id))

    ex = Execucao(
        modelo_id=modelo.id,
        usuario_id=current_user.id,
        unidade_id=unidade.id,
        area_id=modelo.area_id,
        titulo=modelo.titulo,
        status=StatusExecucao.EM_ANDAMENTO,
    )
    for i, item in enumerate(modelo.itens, start=1):
        ex.respostas.append(Resposta(item_id=item.id, ordem=i, item_texto=item.texto))
    db.session.add(ex)
    db.session.flush()
    audit("execucao_iniciada", alvo=f"execucao:{ex.id}", detalhe=f"{modelo.titulo} / {unidade.nome}")
    db.session.commit()
    return redirect(url_for(".preencher", execucao_id=ex.id))


@bp.route("/execucoes/<int:execucao_id>/preencher", methods=["GET", "POST"])
@login_required
def preencher(execucao_id):
    ex = _execucao_visivel_or_404(execucao_id)
    if not pode_editar_execucao(current_user, ex):
        flash("Este checklist não pode mais ser alterado.", "info")
        return redirect(url_for(".detalhe", execucao_id=ex.id))

    if request.method == "POST":
        acao = request.form.get("acao", "salvar")
        erros = []
        arquivos_salvos = []
        max_fotos = current_app.config["MAX_PHOTOS_PER_ITEM"]
        arquivos_para_apagar = []

        try:
            # Remoção de fotos marcadas. Só são consideradas fotos desta execução;
            # campos de outras execuções enviados no formulário são ignorados.
            remover_ids = {ler_int(v) for v in request.form.getlist("remover_foto")}
            for r in ex.respostas:
                for foto in list(r.fotos):
                    if foto.id in remover_ids:
                        arquivos_para_apagar.append(foto.arquivo)
                        r.fotos.remove(foto)

            for numero, r in enumerate(ex.respostas, start=1):
                status = request.form.get(f"status_{r.id}") or None
                if status is not None and status not in StatusItem.TODOS:
                    abort(400)
                r.status = status
                r.observacao = limpar_texto(request.form.get(f"obs_{r.id}"), 2000) or None

                novos = [f for f in request.files.getlist(f"fotos_{r.id}") if f and f.filename]
                if len(r.fotos) + len(novos) > max_fotos:
                    erros.append(f"Item {numero}: máximo de {max_fotos} fotos por item.")
                    continue
                for arquivo in novos:
                    try:
                        nome, tamanho = processar_foto(arquivo)
                    except UploadError as e:
                        erros.append(f"Item {numero}: {e}")
                        continue
                    arquivos_salvos.append(nome)
                    r.fotos.append(
                        Foto(arquivo=nome, tamanho=tamanho, enviado_por_id=current_user.id)
                    )

            if acao == "concluir":
                faltando = [str(i) for i, r in enumerate(ex.respostas, 1) if not r.status]
                nc_sem_obs = [
                    str(i)
                    for i, r in enumerate(ex.respostas, 1)
                    if r.status == StatusItem.NAO_CONFORME and not r.observacao
                ]
                if faltando:
                    erros.append("Responda todos os itens. Faltam: " + ", ".join(faltando) + ".")
                if nc_sem_obs:
                    erros.append(
                        "Descreva o problema nos itens não conformes: " + ", ".join(nc_sem_obs) + "."
                    )
                if not erros:
                    ex.status = StatusExecucao.CONCLUIDO
                    ex.concluido_em = utcnow()
                    audit("execucao_concluida", alvo=f"execucao:{ex.id}", detalhe=ex.titulo)

            ex.atualizado_em = utcnow()
            db.session.commit()
        except Exception:
            db.session.rollback()
            for nome in arquivos_salvos:
                remover_arquivo(nome)
            raise

        for nome in arquivos_para_apagar:
            remover_arquivo(nome)

        if ex.concluido:
            flash("Checklist concluído com sucesso.", "success")
            return redirect(url_for(".detalhe", execucao_id=ex.id))
        for erro in erros:
            flash(erro, "error")
        if not erros:
            flash("Rascunho salvo.", "success")
        return redirect(url_for(".preencher", execucao_id=ex.id))

    return render_template(
        "main/preencher.html", ex=ex, max_fotos=current_app.config["MAX_PHOTOS_PER_ITEM"]
    )


@bp.route("/execucoes/<int:execucao_id>/descartar", methods=["POST"])
@login_required
def descartar(execucao_id):
    ex = _execucao_visivel_or_404(execucao_id)
    if not pode_editar_execucao(current_user, ex):
        abort(403)
    arquivos = [f.arquivo for r in ex.respostas for f in r.fotos]
    audit("execucao_descartada", alvo=f"execucao:{ex.id}", detalhe=ex.titulo)
    db.session.delete(ex)
    db.session.commit()
    for nome in arquivos:
        remover_arquivo(nome)
    flash("Rascunho descartado.", "info")
    return redirect(url_for(".home"))


@bp.route("/execucoes/<int:execucao_id>")
@login_required
def detalhe(execucao_id):
    ex = _execucao_visivel_or_404(execucao_id)
    return render_template(
        "main/detalhe.html",
        ex=ex,
        resumo=ex.resumo(),
        pode_editar=pode_editar_execucao(current_user, ex),
        pode_reabrir=pode_reabrir_execucao(current_user, ex),
    )


@bp.route("/execucoes/<int:execucao_id>/reabrir", methods=["POST"])
@login_required
def reabrir(execucao_id):
    ex = _execucao_visivel_or_404(execucao_id)
    if not pode_reabrir_execucao(current_user, ex):
        abort(403)
    ex.status = StatusExecucao.EM_ANDAMENTO
    ex.concluido_em = None
    audit("execucao_reaberta", alvo=f"execucao:{ex.id}", detalhe=ex.titulo)
    db.session.commit()
    flash("Checklist reaberto. O responsável pelo preenchimento já pode alterá-lo.", "info")
    return redirect(url_for(".detalhe", execucao_id=ex.id))


# ------------------------------ Histórico ---------------------------------- #
@bp.route("/realizados")
@login_required
def historico():
    condicoes = filtro_execucoes(current_user)
    q = select(Execucao).where(*condicoes)

    filtros = {}
    data_ini = ler_data(request.args.get("de"))
    data_fim = ler_data(request.args.get("ate"))
    unidade_id = ler_int(request.args.get("unidade"))
    area_id = ler_int(request.args.get("area"))
    usuario_id = ler_int(request.args.get("responsavel"))
    status = request.args.get("status") or ""

    data_ref = func.coalesce(Execucao.concluido_em, Execucao.iniciado_em)
    if data_ini:
        q = q.where(data_ref >= inicio_do_dia_utc(data_ini))
        filtros["de"] = data_ini.isoformat()
    if data_fim:
        q = q.where(data_ref < inicio_do_dia_utc(data_fim + timedelta(days=1)))
        filtros["ate"] = data_fim.isoformat()
    if unidade_id:
        q = q.where(Execucao.unidade_id == unidade_id)
        filtros["unidade"] = unidade_id
    if area_id:
        q = q.where(Execucao.area_id == area_id)
        filtros["area"] = area_id
    if usuario_id:
        q = q.where(Execucao.usuario_id == usuario_id)
        filtros["responsavel"] = usuario_id
    if status in StatusExecucao.LABELS:
        q = q.where(Execucao.status == status)
        filtros["status"] = status

    q = q.options(selectinload(Execucao.respostas)).order_by(data_ref.desc(), Execucao.id.desc())
    pagina = db.paginate(q, page=ler_int(request.args.get("page")) or 1, per_page=20, error_out=False)

    # Opções dos filtros, sempre limitadas ao que o usuário pode ver
    if current_user.is_admin_plus:
        areas = list(db.session.scalars(select(Area).order_by(Area.nome)))
    else:
        areas = [current_user.area] if current_user.area else []
    if current_user.is_analista:
        unidades = [current_user.unidade] if current_user.unidade else []
    else:
        unidades = list(db.session.scalars(select(Unidade).order_by(Unidade.nome)))
    ids_resp = select(Execucao.usuario_id).where(*condicoes).distinct()
    responsaveis = list(db.session.scalars(select(User).where(User.id.in_(ids_resp)).order_by(User.nome)))

    return render_template(
        "main/historico.html",
        pagina=pagina,
        filtros=filtros,
        areas=areas,
        unidades=unidades,
        responsaveis=responsaveis,
    )


# -------------------------------- Fotos ------------------------------------ #
@bp.route("/fotos/<int:foto_id>")
@login_required
def foto(foto_id):
    registro = db.session.get(Foto, foto_id)
    if registro is None or not pode_ver_execucao(current_user, registro.resposta.execucao):
        abort(404)
    try:
        caminho_seguro(registro.arquivo)
    except UploadError:
        abort(404)
    resp = send_from_directory(
        pasta_uploads(), registro.arquivo, mimetype="image/jpeg", conditional=True, max_age=0
    )
    resp.headers["Cache-Control"] = "private, max-age=300"
    resp.headers["Content-Disposition"] = "inline"
    return resp


# --------------------------------- PWA ------------------------------------- #
@bp.route("/sw.js")
def service_worker():
    resp = send_from_directory(current_app.static_folder, "sw.js", mimetype="text/javascript")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@bp.route("/offline")
def offline():
    return render_template("offline.html")
