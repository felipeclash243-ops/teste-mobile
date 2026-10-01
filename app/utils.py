"""Funções auxiliares: datas/fuso horário e leitura de formulários."""
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import current_app

from .models import Periodicidade, utcnow

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def fuso() -> ZoneInfo:
    return ZoneInfo(current_app.config["APP_TIMEZONE"])


def para_local(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).astimezone(fuso())


def formatar_data_hora(dt: datetime | None) -> str:
    local = para_local(dt)
    return local.strftime("%d/%m/%Y %H:%M") if local else "—"


def local_para_utc(local: datetime) -> datetime:
    return local.astimezone(timezone.utc).replace(tzinfo=None)


def inicio_do_dia_utc(dia: date) -> datetime:
    return local_para_utc(datetime.combine(dia, time.min, tzinfo=fuso()))


def inicio_do_periodo(periodicidade: str, agora: datetime | None = None) -> datetime | None:
    """Início (UTC) do período atual de um checklist periódico."""
    hoje = para_local(agora or utcnow()).date()
    if periodicidade == Periodicidade.DIARIO:
        return inicio_do_dia_utc(hoje)
    if periodicidade == Periodicidade.SEMANAL:
        return inicio_do_dia_utc(hoje - timedelta(days=hoje.weekday()))
    if periodicidade == Periodicidade.MENSAL:
        return inicio_do_dia_utc(hoje.replace(day=1))
    return None


def ler_data(valor: str | None) -> date | None:
    try:
        return date.fromisoformat((valor or "").strip())
    except ValueError:
        return None


def ler_int(valor) -> int | None:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def limpar_texto(valor: str | None, limite: int) -> str:
    return (valor or "").strip()[:limite]


def normalizar_email(valor: str | None) -> str:
    return (valor or "").strip().lower()[:255]


def email_valido(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 255


def escapar_like(termo: str) -> str:
    return termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
