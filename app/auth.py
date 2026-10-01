"""Login, logout e sessões no servidor."""
import hashlib
import secrets
from datetime import timedelta

from flask import Blueprint, current_app, flash, redirect, render_template, request, session, url_for
from flask_login import current_user, login_required, login_user, logout_user
from sqlalchemy import delete, select

from .audit import audit
from .extensions import db, limiter, login_manager
from .models import Sessao, User, utcnow
from .security import DUMMY_HASH, hash_password, needs_rehash, verify_password
from .utils import normalizar_email

bp = Blueprint("auth", __name__)

MSG_LOGIN_INVALIDO = (
    "E-mail ou senha inválidos. Após várias tentativas erradas o acesso fica "
    "bloqueado por alguns minutos."
)


# ------------------------------ Sessões ------------------------------------ #
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def criar_sessao(usuario: User) -> str:
    token = secrets.token_urlsafe(32)
    agora = utcnow()
    db.session.add(
        Sessao(
            id=_hash_token(token),
            usuario_id=usuario.id,
            criada_em=agora,
            ultimo_uso=agora,
            expira_em=agora + timedelta(hours=current_app.config["SESSION_ABSOLUTE_HOURS"]),
            ip=request.remote_addr,
            user_agent=(request.user_agent.string or "")[:255],
        )
    )
    return token


def encerrar_sessoes(usuario_id: int, exceto_token: str | None = None) -> None:
    """Revoga todas as sessões do usuário (exceto, opcionalmente, a atual)."""
    stmt = delete(Sessao).where(Sessao.usuario_id == usuario_id)
    if exceto_token:
        stmt = stmt.where(Sessao.id != _hash_token(exceto_token))
    db.session.execute(stmt)


def limpar_sessoes_expiradas() -> None:
    db.session.execute(delete(Sessao).where(Sessao.expira_em <= utcnow()))


@login_manager.user_loader
def carregar_usuario(user_id: str):
    token = session.get("sid")
    if not token or not str(user_id).isdigit():
        return None
    registro = db.session.get(Sessao, _hash_token(token))
    agora = utcnow()
    ocioso = timedelta(minutes=current_app.config["SESSION_IDLE_MINUTES"])
    valido = (
        registro is not None
        and registro.usuario_id == int(user_id)
        and registro.expira_em > agora
        and registro.ultimo_uso + ocioso > agora
    )
    if not valido:
        if registro is not None:
            db.session.delete(registro)
            db.session.commit()
        session.clear()
        return None
    usuario = db.session.get(User, registro.usuario_id)
    if usuario is None or not usuario.ativo:
        session.clear()
        return None
    if (agora - registro.ultimo_uso).total_seconds() > 60:
        registro.ultimo_uso = agora
        db.session.commit()
    return usuario


login_manager.login_view = "auth.login"
login_manager.login_message = "Faça login para continuar."
login_manager.login_message_category = "info"
login_manager.session_protection = "basic"


# ------------------------------- Rotas ------------------------------------- #
@bp.route("/login", methods=["GET", "POST"])
@limiter.limit("10 per minute;60 per hour", methods=["POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.home"))

    if request.method == "POST":
        email = normalizar_email(request.form.get("email"))
        senha = (request.form.get("senha") or "")[:256]
        agora = utcnow()
        usuario = db.session.scalar(select(User).where(User.email == email)) if email else None

        # Sempre executa a verificação de hash para manter o tempo de resposta constante.
        senha_ok = verify_password(usuario.senha_hash if usuario else DUMMY_HASH, senha)

        if usuario and usuario.esta_bloqueado(agora):
            audit("login_bloqueado", alvo=f"usuario:{usuario.id}", email=email, usuario=usuario)
            db.session.commit()
            flash(MSG_LOGIN_INVALIDO, "error")
        elif usuario and usuario.ativo and senha_ok:
            usuario.tentativas_falhas = 0
            usuario.bloqueado_ate = None
            usuario.ultimo_login = agora
            if needs_rehash(usuario.senha_hash):
                usuario.senha_hash = hash_password(senha)
            limpar_sessoes_expiradas()
            token = criar_sessao(usuario)
            # Nova sessão a cada login (evita fixação de sessão)
            session.clear()
            session["sid"] = token
            session.permanent = True
            login_user(usuario)
            audit("login_ok", alvo=f"usuario:{usuario.id}", usuario=usuario)
            db.session.commit()
            return redirect(url_for("main.home"))
        else:
            if usuario:
                usuario.tentativas_falhas = (usuario.tentativas_falhas or 0) + 1
                if usuario.tentativas_falhas >= current_app.config["LOGIN_MAX_ATTEMPTS"]:
                    usuario.bloqueado_ate = agora + timedelta(
                        minutes=current_app.config["LOGIN_LOCK_MINUTES"]
                    )
                    usuario.tentativas_falhas = 0
                    audit("login_conta_bloqueada", alvo=f"usuario:{usuario.id}", email=email,
                          usuario=usuario)
            audit("login_falha", email=email or "(vazio)", usuario=usuario)
            db.session.commit()
            flash(MSG_LOGIN_INVALIDO, "error")

    return render_template("auth/login.html")


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    token = session.get("sid")
    if token:
        db.session.execute(delete(Sessao).where(Sessao.id == _hash_token(token)))
    audit("logout", alvo=f"usuario:{current_user.id}")
    db.session.commit()
    logout_user()
    session.clear()
    flash("Você saiu com segurança.", "info")
    return redirect(url_for("auth.login"))
