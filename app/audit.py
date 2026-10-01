"""Registro de auditoria (gravado no banco junto com a operação auditada)."""
from flask import current_app, has_request_context, request
from flask_login import current_user

from .extensions import db
from .models import AuditLog


def _limpar(texto, limite):
    if texto is None:
        return None
    # Remove quebras de linha para evitar falsificação de entradas de log
    return str(texto).replace("\r", " ").replace("\n", " ")[:limite]


def audit(acao: str, alvo: str | None = None, detalhe: str | None = None, usuario=None, email=None):
    """Adiciona uma entrada à sessão do banco; o commit é feito pela rota."""
    if usuario is None and has_request_context() and current_user.is_authenticated:
        usuario = current_user
    registro = AuditLog(
        usuario_id=getattr(usuario, "id", None),
        email=_limpar(email or getattr(usuario, "email", None), 255),
        acao=acao,
        alvo=_limpar(alvo, 100),
        detalhe=_limpar(detalhe, 1000),
        ip=request.remote_addr if has_request_context() else None,
    )
    db.session.add(registro)
    current_app.logger.info(
        "AUDIT acao=%s alvo=%s usuario=%s ip=%s", acao, registro.alvo, registro.email, registro.ip
    )
    return registro
