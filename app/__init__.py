"""Fábrica da aplicação Flask."""
import logging
import mimetypes
from pathlib import Path

from flask import Flask, render_template, request
from flask_login import current_user
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import BASE_DIR, Config
from .extensions import csrf, db, limiter, login_manager

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

MENSAGENS_ERRO = {
    400: "Requisição inválida.",
    403: "Você não tem permissão para acessar este recurso.",
    404: "Página não encontrada.",
    405: "Operação não permitida.",
    413: "Arquivo muito grande. Envie fotos menores ou em menor quantidade por vez.",
    429: "Muitas tentativas. Aguarde um pouco e tente novamente.",
    500: "Ocorreu um erro inesperado. Tente novamente.",
}

SEGREDOS_INVALIDOS = {"", "troque-por-um-valor-aleatorio", "changeme", "secret"}


def create_app(config_object=None) -> Flask:
    app = Flask(
        __name__,
        instance_path=str(BASE_DIR / "instance"),
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static"),
    )
    app.config.from_object(config_object or Config)
    _validar_config(app)

    logging.basicConfig(
        level=app.config.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # Cookie com prefixo __Host- só é aceito pelo navegador com Secure.
    app.config["SESSION_COOKIE_NAME"] = (
        "__Host-checklist" if app.config["SESSION_COOKIE_SECURE"] else "checklist_session"
    )

    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)

    if app.config.get("TRUST_PROXY"):
        n = app.config["TRUST_PROXY"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=n, x_proto=n, x_host=n)

    db.init_app(app)
    login_manager.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)

    from . import admin, auth, main  # noqa: E402  (registra user_loader e rotas)
    from .cli import registrar_comandos

    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)
    app.register_blueprint(admin.bp)
    registrar_comandos(app)

    _registrar_template_helpers(app)
    _registrar_cabecalhos(app)
    _registrar_erros(app)

    with app.app_context():
        db.create_all()

    return app


def _validar_config(app: Flask) -> None:
    segredo = app.config.get("SECRET_KEY") or ""
    if segredo.lower() in SEGREDOS_INVALIDOS or len(segredo) < 32:
        raise RuntimeError(
            "SECRET_KEY ausente ou fraca. Defina no .env um valor aleatório com 32+ caracteres "
            "(ex.: python -c \"import secrets; print(secrets.token_hex(32))\")."
        )


def _registrar_template_helpers(app: Flask) -> None:
    from .models import Perfil, Periodicidade, StatusExecucao, StatusItem
    from .utils import formatar_data_hora

    app.jinja_env.filters["data_hora"] = formatar_data_hora

    @app.context_processor
    def contexto_global():
        endpoint = request.endpoint or ""
        if endpoint.startswith("config."):
            aba = "config"
        elif endpoint in ("main.historico", "main.detalhe"):
            aba = "historico"
        else:
            aba = "home"
        return {
            "Perfil": Perfil,
            "Periodicidade": Periodicidade,
            "StatusExecucao": StatusExecucao,
            "StatusItem": StatusItem,
            "aba_ativa": aba,
        }


def _registrar_cabecalhos(app: Flask) -> None:
    @app.after_request
    def cabecalhos_seguranca(resp):
        h = resp.headers
        h.setdefault("Content-Security-Policy", CSP)
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "camera=(self), geolocation=(), microphone=(), payment=()")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        if app.config.get("HSTS_ENABLED"):
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        # Páginas autenticadas não devem ficar em cache (navegador/proxy)
        if request.endpoint != "static" and "Cache-Control" not in h:
            h["Cache-Control"] = "no-store"
        return resp


def _registrar_erros(app: Flask) -> None:
    def pagina_erro(codigo: int, mensagem: str | None = None):
        return (
            render_template(
                "errors/error.html",
                codigo=codigo,
                mensagem=mensagem or MENSAGENS_ERRO.get(codigo, "Não foi possível concluir a operação."),
            ),
            codigo,
        )

    @app.errorhandler(CSRFError)
    def erro_csrf(_e):
        return pagina_erro(
            400, "Sua sessão expirou ou o formulário é inválido. Recarregue a página e tente de novo."
        )

    @app.errorhandler(HTTPException)
    def erro_http(e):
        return pagina_erro(e.code or 500)

    @app.errorhandler(Exception)
    def erro_inesperado(e):
        if isinstance(e, HTTPException):
            return erro_http(e)
        db.session.rollback()
        usuario = current_user.get_id() if current_user and current_user.is_authenticated else None
        app.logger.exception("Erro não tratado em %s (usuario=%s)", request.path, usuario)
        return pagina_erro(500)
