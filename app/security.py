"""Senhas (Argon2id), política de senha e decorators de autorização."""
import re
from functools import wraps

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from flask import abort
from flask_login import current_user, login_required

_hasher = PasswordHasher()  # Argon2id com parâmetros recomendados pela biblioteca

# Hash usado quando o e-mail não existe, para que o tempo de resposta do login
# seja o mesmo e não revele quais e-mails estão cadastrados.
DUMMY_HASH = _hasher.hash("senha-ficticia-para-tempo-constante")

SENHA_MIN = 10
SENHA_MAX = 128
SENHAS_COMUNS = {
    "1234567890",
    "12345678910",
    "senha12345",
    "senha@1234",
    "password123",
    "qwerty12345",
    "abcdef12345",
    "mudar@12345",
    "admin@12345",
    "Senha@12345",
}


def hash_password(senha: str) -> str:
    return _hasher.hash(senha)


def verify_password(senha_hash: str, senha: str) -> bool:
    try:
        return _hasher.verify(senha_hash, senha)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(senha_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(senha_hash)
    except InvalidHashError:
        return True


def validate_password(senha: str, email: str | None = None) -> list[str]:
    """Retorna a lista de problemas encontrados (vazia = senha aceita)."""
    erros = []
    senha = senha or ""
    if len(senha) < SENHA_MIN:
        erros.append(f"A senha deve ter pelo menos {SENHA_MIN} caracteres.")
    if len(senha) > SENHA_MAX:
        erros.append(f"A senha deve ter no máximo {SENHA_MAX} caracteres.")
    if not re.search(r"[a-z]", senha):
        erros.append("A senha deve ter ao menos uma letra minúscula.")
    if not re.search(r"[A-Z]", senha):
        erros.append("A senha deve ter ao menos uma letra maiúscula.")
    if not re.search(r"\d", senha):
        erros.append("A senha deve ter ao menos um número.")
    if not re.search(r"[^A-Za-z0-9]", senha):
        erros.append("A senha deve ter ao menos um símbolo (ex.: ! @ # $ %).")
    if senha.lower() in {s.lower() for s in SENHAS_COMUNS}:
        erros.append("Essa senha é muito comum. Escolha outra.")
    if email:
        local = email.split("@")[0].lower()
        if len(local) >= 4 and local in senha.lower():
            erros.append("A senha não pode conter o seu e-mail.")
    return erros


def roles_required(*perfis):
    """Exige login e um dos perfis informados. Verificado no servidor em toda chamada."""

    def decorator(view):
        @wraps(view)
        @login_required
        def wrapper(*args, **kwargs):
            if current_user.perfil not in perfis:
                abort(403)
            return view(*args, **kwargs)

        return wrapper

    return decorator
