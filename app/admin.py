"""Tela de Configuração: meus dados, usuários, áreas, unidades, checklists e auditoria."""
from flask import Blueprint, abort, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required
from sqlalchemy import func, or_, select

from .audit import audit
from .auth import encerrar_sessoes
from .extensions import db, limiter
from .models import (
    Area,
    AuditLog,
    Execucao,
    ItemChecklist,
    ModeloChecklist,
    Perfil,
    Periodicidade,
    Unidade,
    User,
    modelo_unidades,
)
from .permissions import pode_gerenciar_modelo, pode_gerenciar_usuario, perfis_atribuiveis
from .security import hash_password, roles_required, validate_password, verify_password
from .utils import email_valido, escapar_like, ler_int, limpar_texto, normalizar_email

bp = Blueprint("config", __name__, url_prefix="/configuracao")

ADMINS = (Perfil.ADMIN_PLUS, Perfil.ADMIN)
MAX_ITENS = 200


@bp.route("/")
@login_required
def index():
    if current_user.is_analista:
        return redirect(url_for(".perfil"))
    return render_template("config/index.html")


# ------------------------------ Meus dados --------------------------------- #
@bp.route("/meus-dados", methods=["GET", "POST"])
@login_required
@limiter.limit("10 per minute", methods=["POST"])
def perfil():
    if request.method == "POST":
        atual = request.form.get("senha_atual") or ""
        nova = request.form.get("nova_senha") or ""
        confirmacao = request.form.get("confirmacao") or ""
        if not verify_password(current_user.senha_hash, atual):
            audit("senha_alteracao_falha", alvo=f"usuario:{current_user.id}")
            db.session.commit()
            flash("Senha atual incorreta.", "error")
        elif nova != confirmacao:
            flash("A confirmação não confere com a nova senha.", "error")
        elif nova == atual:
            flash("A nova senha deve ser diferente da atual.", "error")
        else:
            erros = validate_password(nova, email=current_user.email)
            for erro in erros:
                flash(erro, "error")
            if not erros:
                current_user.senha_hash = hash_password(nova)
                # Encerra as sessões nos outros dispositivos
                encerrar_sessoes(current_user.id, exceto_token=session.get("sid"))
                audit("senha_alterada", alvo=f"usuario:{current_user.id}")
                db.session.commit()
                flash("Senha alterada. As sessões em outros dispositivos foram encerradas.", "success")
                return redirect(url_for(".perfil"))
    return render_template("config/perfil.html")


# ------------------------------- Usuários ---------------------------------- #
def _usuario_gerenciavel_or_404(usuario_id: int) -> User:
    alvo = db.session.get(User, usuario_id)
    if alvo is None or not pode_gerenciar_usuario(current_user, alvo):
        abort(404)
    return alvo


def _opcoes_usuario():
    if current_user.is_admin_plus:
        areas = list(db.session.scalars(select(Area).where(Area.ativo.is_(True)).order_by(Area.nome)))
    else:
        areas = [current_user.area] if current_user.area else []
    unidades = list(
        db.session.scalars(select(Unidade).where(Unidade.ativo.is_(True)).order_by(Unidade.nome))
    )
    return {"areas": areas, "unidades": unidades, "perfis": perfis_atribuiveis(current_user)}


def _outros_admin_plus_ativos(excluir_id: int) -> int:
    return db.session.scalar(
        select(func.count(User.id)).where(
            User.perfil == Perfil.ADMIN_PLUS, User.ativo.is_(True), User.id != excluir_id
        )
    )


def _ler_form_usuario(alvo: User | None):
    f = request.form
    dados = {
        "nome": limpar_texto(f.get("nome"), 120),
        "email": normalizar_email(f.get("email")),
        "perfil": f.get("perfil") or Perfil.ANALISTA,
        "area_id": ler_int(f.get("area_id")),
        "unidade_id": ler_int(f.get("unidade_id")),
        "ativo": f.get("ativo") == "1" if alvo else True,
    }
    senha = f.get("senha") or ""
    erros = []

    if len(dados["nome"]) < 2:
        erros.append("Informe o nome completo.")
    if not email_valido(dados["email"]):
        erros.append("Informe um e-mail válido.")
    else:
        existe = db.session.scalar(
            select(User.id).where(User.email == dados["email"], User.id != (alvo.id if alvo else -1))
        )
        if existe:
            erros.append("Já existe um usuário com esse e-mail.")

    if dados["perfil"] not in perfis_atribuiveis(current_user):
        abort(403)
    if current_user.is_admin:
        dados["area_id"] = current_user.area_id  # Admin só cadastra na própria área

    area = db.session.get(Area, dados["area_id"]) if dados["area_id"] else None
    unidade = db.session.get(Unidade, dados["unidade_id"]) if dados["unidade_id"] else None
    if dados["area_id"] and area is None:
        erros.append("Área inválida.")
    if dados["unidade_id"] and unidade is None:
        erros.append("Unidade inválida.")
    if dados["perfil"] in (Perfil.ADMIN, Perfil.ANALISTA) and area is None:
        erros.append("Selecione a área.")
    if dados["perfil"] == Perfil.ANALISTA and unidade is None:
        erros.append("Selecione a unidade.")

    if alvo is None or senha:
        erros.extend(validate_password(senha, email=dados["email"]))

    if alvo is not None and alvo.perfil == Perfil.ADMIN_PLUS:
        rebaixando = dados["perfil"] != Perfil.ADMIN_PLUS or not dados["ativo"]
        if rebaixando and _outros_admin_plus_ativos(alvo.id) == 0:
            erros.append("Não é possível remover o último Admin+ ativo.")

    return dados, senha, erros


@bp.route("/usuarios")
@roles_required(*ADMINS)
def usuarios():
    termo = limpar_texto(request.args.get("q"), 100)
    q = select(User).order_by(User.nome)
    if current_user.is_admin:
        q = q.where(User.area_id == current_user.area_id)
    if termo:
        like = f"%{escapar_like(termo)}%"
        q = q.where(or_(User.nome.ilike(like, escape="\\"), User.email.ilike(like, escape="\\")))
    pagina = db.paginate(q, page=ler_int(request.args.get("page")) or 1, per_page=30, error_out=False)
    return render_template(
        "config/usuarios.html", pagina=pagina, termo=termo, pode_gerenciar=pode_gerenciar_usuario
    )


@bp.route("/usuarios/novo", methods=["GET", "POST"])
@roles_required(*ADMINS)
def usuario_novo():
    if current_user.is_admin and current_user.area_id is None:
        flash("Seu usuário não está vinculado a uma área.", "error")
        return redirect(url_for(".index"))
    form = {"ativo": True, "perfil": Perfil.ANALISTA, "area_id": current_user.area_id}
    if request.method == "POST":
        dados, senha, erros = _ler_form_usuario(None)
        if erros:
            for erro in erros:
                flash(erro, "error")
            form = dados
        else:
            usuario = User(**dados, senha_hash=hash_password(senha))
            db.session.add(usuario)
            db.session.flush()
            audit(
                "usuario_criado",
                alvo=f"usuario:{usuario.id}",
                detalhe=f"{usuario.email} perfil={usuario.perfil} area={usuario.area_id} "
                f"unidade={usuario.unidade_id}",
            )
            db.session.commit()
            flash("Usuário cadastrado.", "success")
            return redirect(url_for(".usuarios"))
    return render_template("config/usuario_form.html", form=form, alvo=None, **_opcoes_usuario())


@bp.route("/usuarios/<int:usuario_id>", methods=["GET", "POST"])
@roles_required(*ADMINS)
def usuario_editar(usuario_id):
    alvo = _usuario_gerenciavel_or_404(usuario_id)
    form = {
        "nome": alvo.nome,
        "email": alvo.email,
        "perfil": alvo.perfil,
        "area_id": alvo.area_id,
        "unidade_id": alvo.unidade_id,
        "ativo": alvo.ativo,
    }
    if request.method == "POST":
        dados, senha, erros = _ler_form_usuario(alvo)
        if erros:
            for erro in erros:
                flash(erro, "error")
            form = dados
        else:
            alterados = [k for k, v in dados.items() if getattr(alvo, k) != v]
            for k, v in dados.items():
                setattr(alvo, k, v)
            if senha:
                alvo.senha_hash = hash_password(senha)
                alvo.tentativas_falhas = 0
                alvo.bloqueado_ate = None
                alterados.append("senha")
            if senha or not alvo.ativo or "perfil" in alterados or "area_id" in alterados:
                encerrar_sessoes(alvo.id)
            audit(
                "usuario_alterado",
                alvo=f"usuario:{alvo.id}",
                detalhe="campos: " + (", ".join(alterados) or "nenhum"),
            )
            db.session.commit()
            flash("Usuário atualizado.", "success")
            return redirect(url_for(".usuarios"))
    return render_template("config/usuario_form.html", form=form, alvo=alvo, **_opcoes_usuario())


@bp.route("/usuarios/<int:usuario_id>/desbloquear", methods=["POST"])
@roles_required(*ADMINS)
def usuario_desbloquear(usuario_id):
    alvo = _usuario_gerenciavel_or_404(usuario_id)
    alvo.bloqueado_ate = None
    alvo.tentativas_falhas = 0
    audit("usuario_desbloqueado", alvo=f"usuario:{alvo.id}")
    db.session.commit()
    flash("Acesso desbloqueado.", "success")
    return redirect(url_for(".usuario_editar", usuario_id=alvo.id))


@bp.route("/usuarios/<int:usuario_id>/remover", methods=["POST"])
@roles_required(*ADMINS)
def usuario_remover(usuario_id):
    alvo = _usuario_gerenciavel_or_404(usuario_id)
    if alvo.perfil == Perfil.ADMIN_PLUS and _outros_admin_plus_ativos(alvo.id) == 0:
        flash("Não é possível remover o último Admin+ ativo.", "error")
        return redirect(url_for(".usuarios"))
    tem_historico = db.session.scalar(
        select(func.count(Execucao.id)).where(Execucao.usuario_id == alvo.id)
    )
    encerrar_sessoes(alvo.id)
    if tem_historico:
        alvo.ativo = False
        audit("usuario_desativado", alvo=f"usuario:{alvo.id}", detalhe=alvo.email)
        flash("O usuário tem checklists registrados e foi desativado para manter o histórico.", "info")
    else:
        audit("usuario_removido", alvo=f"usuario:{alvo.id}", detalhe=alvo.email)
        db.session.delete(alvo)
        flash("Usuário removido.", "success")
    db.session.commit()
    return redirect(url_for(".usuarios"))


# --------------------------- Áreas e unidades ------------------------------ #
CADASTROS = {
    "areas": {"modelo": Area, "titulo": "Áreas", "singular": "área", "chave": "area"},
    "unidades": {"modelo": Unidade, "titulo": "Unidades", "singular": "unidade", "chave": "unidade"},
}


def _em_uso(tipo: str, obj_id: int) -> bool:
    if tipo == "areas":
        consultas = [
            select(func.count(User.id)).where(User.area_id == obj_id),
            select(func.count(ModeloChecklist.id)).where(ModeloChecklist.area_id == obj_id),
            select(func.count(Execucao.id)).where(Execucao.area_id == obj_id),
        ]
    else:
        consultas = [
            select(func.count(User.id)).where(User.unidade_id == obj_id),
            select(func.count()).select_from(modelo_unidades).where(
                modelo_unidades.c.unidade_id == obj_id
            ),
            select(func.count(Execucao.id)).where(Execucao.unidade_id == obj_id),
        ]
    return any(db.session.scalar(c) for c in consultas)


def _nome_valido(Modelo, nome: str, ignorar_id: int | None = None) -> str | None:
    if len(nome) < 2:
        return "Informe um nome com pelo menos 2 caracteres."
    q = select(Modelo.id).where(func.lower(Modelo.nome) == nome.lower())
    if ignorar_id:
        q = q.where(Modelo.id != ignorar_id)
    if db.session.scalar(q):
        return "Já existe um cadastro com esse nome."
    return None


@bp.route("/<any(areas, unidades):tipo>", methods=["GET", "POST"])
@roles_required(Perfil.ADMIN_PLUS)
def cadastro(tipo):
    cfg = CADASTROS[tipo]
    Modelo = cfg["modelo"]
    if request.method == "POST":
        nome = limpar_texto(request.form.get("nome"), 100)
        erro = _nome_valido(Modelo, nome)
        if erro:
            flash(erro, "error")
        else:
            obj = Modelo(nome=nome)
            db.session.add(obj)
            db.session.flush()
            audit(f"{cfg['chave']}_criada", alvo=f"{cfg['chave']}:{obj.id}", detalhe=nome)
            db.session.commit()
            flash(f"{cfg['singular'].capitalize()} cadastrada.", "success")
        return redirect(url_for(".cadastro", tipo=tipo))
    registros = list(db.session.scalars(select(Modelo).order_by(Modelo.nome)))
    return render_template("config/cadastro.html", tipo=tipo, cfg=cfg, registros=registros)


@bp.route("/<any(areas, unidades):tipo>/<int:obj_id>/<any(renomear, alternar, remover):acao>",
          methods=["POST"])
@roles_required(Perfil.ADMIN_PLUS)
def cadastro_acao(tipo, obj_id, acao):
    cfg = CADASTROS[tipo]
    obj = db.session.get(cfg["modelo"], obj_id)
    if obj is None:
        abort(404)
    chave = cfg["chave"]
    if acao == "renomear":
        nome = limpar_texto(request.form.get("nome"), 100)
        erro = _nome_valido(cfg["modelo"], nome, ignorar_id=obj.id)
        if erro:
            flash(erro, "error")
        else:
            audit(f"{chave}_renomeada", alvo=f"{chave}:{obj.id}", detalhe=f"{obj.nome} -> {nome}")
            obj.nome = nome
            flash("Nome atualizado.", "success")
    elif acao == "alternar":
        obj.ativo = not obj.ativo
        audit(f"{chave}_{'ativada' if obj.ativo else 'desativada'}", alvo=f"{chave}:{obj.id}")
        flash("Cadastro ativado." if obj.ativo else "Cadastro desativado.", "success")
    else:
        if _em_uso(tipo, obj.id):
            flash("Este cadastro está em uso. Desative-o em vez de remover.", "error")
            return redirect(url_for(".cadastro", tipo=tipo))
        audit(f"{chave}_removida", alvo=f"{chave}:{obj.id}", detalhe=obj.nome)
        db.session.delete(obj)
        flash("Cadastro removido.", "success")
    db.session.commit()
    return redirect(url_for(".cadastro", tipo=tipo))


# ------------------------------ Checklists --------------------------------- #
def _modelo_gerenciavel_or_404(modelo_id: int) -> ModeloChecklist:
    modelo = db.session.get(ModeloChecklist, modelo_id)
    if modelo is None or not pode_gerenciar_modelo(current_user, modelo):
        abort(404)
    return modelo


def _opcoes_modelo():
    if current_user.is_admin_plus:
        areas = list(db.session.scalars(select(Area).where(Area.ativo.is_(True)).order_by(Area.nome)))
    else:
        areas = [current_user.area] if current_user.area else []
    unidades = list(
        db.session.scalars(select(Unidade).where(Unidade.ativo.is_(True)).order_by(Unidade.nome))
    )
    return {"areas": areas, "unidades": unidades, "periodicidades": Periodicidade.LABELS}


def _ler_form_modelo(modelo: ModeloChecklist | None):
    f = request.form
    itens = [limpar_texto(linha, 500) for linha in (f.get("itens") or "").splitlines()]
    itens = [i for i in itens if i]
    unidade_ids = sorted({i for i in (ler_int(v) for v in f.getlist("unidades")) if i})
    dados = {
        "titulo": limpar_texto(f.get("titulo"), 150),
        "descricao": limpar_texto(f.get("descricao"), 1000) or None,
        "periodicidade": f.get("periodicidade") or Periodicidade.AVULSO,
        "area_id": ler_int(f.get("area_id")),
        "ativo": f.get("ativo") == "1" if modelo else True,
    }
    erros = []
    if len(dados["titulo"]) < 3:
        erros.append("Informe um título com pelo menos 3 caracteres.")
    if dados["periodicidade"] not in Periodicidade.LABELS:
        erros.append("Periodicidade inválida.")
    if current_user.is_admin:
        dados["area_id"] = current_user.area_id
    if not dados["area_id"] or db.session.get(Area, dados["area_id"]) is None:
        erros.append("Selecione a área.")
    unidades = (
        list(db.session.scalars(select(Unidade).where(Unidade.id.in_(unidade_ids))))
        if unidade_ids
        else []
    )
    if len(unidades) != len(unidade_ids):
        erros.append("Unidade inválida.")
    if not itens:
        erros.append("Cadastre ao menos um item (um por linha).")
    if len(itens) > MAX_ITENS:
        erros.append(f"Máximo de {MAX_ITENS} itens por checklist.")
    form = dict(dados, itens="\n".join(itens), unidades=unidade_ids)
    return dados, unidades, itens, erros, form


def _aplicar_modelo(modelo: ModeloChecklist, dados, unidades, itens) -> None:
    for k, v in dados.items():
        setattr(modelo, k, v)
    modelo.unidades = unidades
    textos_atuais = [i.texto for i in modelo.itens]
    if textos_atuais != itens:
        # As execuções guardam cópia do texto, então trocar os itens não altera o histórico.
        modelo.itens.clear()
        db.session.flush()
        for ordem, texto in enumerate(itens, start=1):
            modelo.itens.append(ItemChecklist(ordem=ordem, texto=texto))


@bp.route("/checklists")
@roles_required(*ADMINS)
def modelos():
    q = select(ModeloChecklist).order_by(ModeloChecklist.ativo.desc(), ModeloChecklist.titulo)
    if current_user.is_admin:
        q = q.where(ModeloChecklist.area_id == current_user.area_id)
    return render_template("config/modelos.html", modelos=list(db.session.scalars(q)))


@bp.route("/checklists/novo", methods=["GET", "POST"])
@roles_required(*ADMINS)
def modelo_novo():
    form = {"periodicidade": Periodicidade.AVULSO, "area_id": current_user.area_id, "unidades": [],
            "ativo": True}
    if request.method == "POST":
        dados, unidades, itens, erros, form = _ler_form_modelo(None)
        if erros:
            for erro in erros:
                flash(erro, "error")
        else:
            modelo = ModeloChecklist(criado_por_id=current_user.id)
            db.session.add(modelo)
            _aplicar_modelo(modelo, dados, unidades, itens)
            db.session.flush()
            audit("checklist_criado", alvo=f"modelo:{modelo.id}",
                  detalhe=f"{modelo.titulo} ({len(itens)} itens)")
            db.session.commit()
            flash("Checklist criado.", "success")
            return redirect(url_for(".modelos"))
    return render_template("config/modelo_form.html", form=form, modelo=None, **_opcoes_modelo())


@bp.route("/checklists/<int:modelo_id>", methods=["GET", "POST"])
@roles_required(*ADMINS)
def modelo_editar(modelo_id):
    modelo = _modelo_gerenciavel_or_404(modelo_id)
    form = {
        "titulo": modelo.titulo,
        "descricao": modelo.descricao or "",
        "periodicidade": modelo.periodicidade,
        "area_id": modelo.area_id,
        "unidades": [u.id for u in modelo.unidades],
        "itens": "\n".join(i.texto for i in modelo.itens),
        "ativo": modelo.ativo,
    }
    if request.method == "POST":
        dados, unidades, itens, erros, form = _ler_form_modelo(modelo)
        if erros:
            for erro in erros:
                flash(erro, "error")
        else:
            _aplicar_modelo(modelo, dados, unidades, itens)
            audit("checklist_alterado", alvo=f"modelo:{modelo.id}",
                  detalhe=f"{modelo.titulo} ({len(itens)} itens)")
            db.session.commit()
            flash("Checklist atualizado.", "success")
            return redirect(url_for(".modelos"))
    return render_template("config/modelo_form.html", form=form, modelo=modelo, **_opcoes_modelo())


@bp.route("/checklists/<int:modelo_id>/remover", methods=["POST"])
@roles_required(*ADMINS)
def modelo_remover(modelo_id):
    modelo = _modelo_gerenciavel_or_404(modelo_id)
    usado = db.session.scalar(select(func.count(Execucao.id)).where(Execucao.modelo_id == modelo.id))
    if usado:
        modelo.ativo = False
        audit("checklist_desativado", alvo=f"modelo:{modelo.id}", detalhe=modelo.titulo)
        flash("O checklist já foi utilizado e foi desativado para manter o histórico.", "info")
    else:
        audit("checklist_removido", alvo=f"modelo:{modelo.id}", detalhe=modelo.titulo)
        db.session.delete(modelo)
        flash("Checklist removido.", "success")
    db.session.commit()
    return redirect(url_for(".modelos"))


# ------------------------------- Auditoria --------------------------------- #
@bp.route("/auditoria")
@roles_required(Perfil.ADMIN_PLUS)
def auditoria():
    termo = limpar_texto(request.args.get("q"), 100)
    q = select(AuditLog).order_by(AuditLog.criado_em.desc(), AuditLog.id.desc())
    if termo:
        like = f"%{escapar_like(termo)}%"
        q = q.where(
            or_(
                AuditLog.acao.ilike(like, escape="\\"),
                AuditLog.email.ilike(like, escape="\\"),
                AuditLog.alvo.ilike(like, escape="\\"),
            )
        )
    pagina = db.paginate(q, page=ler_int(request.args.get("page")) or 1, per_page=50, error_out=False)
    return render_template("config/auditoria.html", pagina=pagina, termo=termo)
