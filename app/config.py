"""Configuração da aplicação. Todos os segredos vêm de variáveis de ambiente (.env)."""
import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on", "sim")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


class Config:
    # Segredo usado para assinar o cookie de sessão e os tokens CSRF.
    SECRET_KEY = os.environ.get("SECRET_KEY")

    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL") or (
        f"sqlite:///{(BASE_DIR / 'instance' / 'checklist.db').as_posix()}"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Uploads (fora de static/, servidos apenas por rota autenticada)
    UPLOAD_FOLDER = os.environ.get("UPLOAD_FOLDER") or str(BASE_DIR / "uploads")
    MAX_CONTENT_LENGTH = _int("MAX_REQUEST_MB", 50) * 1024 * 1024
    MAX_PHOTO_MB = _int("MAX_PHOTO_MB", 8)
    MAX_PHOTOS_PER_ITEM = _int("MAX_PHOTOS_PER_ITEM", 3)
    PHOTO_MAX_DIMENSION = 1600

    # Cookie de sessão: HttpOnly + Secure + SameSite
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", True)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE
    REMEMBER_COOKIE_SAMESITE = "Lax"
    # Expiração por inatividade (o cookie é renovado a cada requisição)
    SESSION_IDLE_MINUTES = _int("SESSION_IDLE_MINUTES", 60)
    # Expiração absoluta: após esse tempo é obrigatório logar de novo
    SESSION_ABSOLUTE_HOURS = _int("SESSION_ABSOLUTE_HOURS", 12)
    PERMANENT_SESSION_LIFETIME = timedelta(minutes=SESSION_IDLE_MINUTES)
    SESSION_REFRESH_EACH_REQUEST = True

    # CSRF: token vinculado à sessão (expira junto com ela)
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = None
    WTF_CSRF_SSL_STRICT = SESSION_COOKIE_SECURE

    # Proteção contra força bruta
    LOGIN_MAX_ATTEMPTS = _int("LOGIN_MAX_ATTEMPTS", 5)
    LOGIN_LOCK_MINUTES = _int("LOGIN_LOCK_MINUTES", 15)
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_ENABLED = True

    # Cabeçalhos
    HSTS_ENABLED = _bool("HSTS_ENABLED", SESSION_COOKIE_SECURE)

    # Número de proxies reversos confiáveis (Nginx/Caddy). 0 = nenhum.
    TRUST_PROXY = _int("TRUST_PROXY", 0)

    APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "America/Sao_Paulo")
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
