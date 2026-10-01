"""Regras de autorização por perfil, área e unidade.

Toda rota que acessa um registro específico passa por estas funções. Quando o
usuário não tem acesso, as rotas respondem 404 (e não 403) para não revelar
que o registro existe (proteção contra IDOR / enumeração).
"""
from sqlalchemy import false

from .models import Execucao, ModeloChecklist, Perfil, StatusExecucao, User


# ------------------------------- Usuários ---------------------------------- #
def perfis_atribuiveis(ator: User) -> tuple[str, ...]:
    if ator.is_admin_plus:
        return Perfil.TODOS
    if ator.is_admin:
        # Admin cadastra apenas analistas da própria área (menor privilégio).
        return (Perfil.ANALISTA,)
    return ()


def pode_gerenciar_usuario(ator: User, alvo: User) -> bool:
    if ator.id == alvo.id:
        return False  # os próprios dados são alterados em "Meus dados"
    if ator.is_admin_plus:
        return True
    if ator.is_admin:
        return (
            ator.area_id is not None
            and alvo.area_id == ator.area_id
            and alvo.perfil == Perfil.ANALISTA
        )
    return False


# ------------------------------ Modelos ------------------------------------ #
def pode_gerenciar_modelo(usuario: User, modelo: ModeloChecklist) -> bool:
    if usuario.is_admin_plus:
        return True
    if usuario.is_admin:
        return usuario.area_id is not None and modelo.area_id == usuario.area_id
    return False


def pode_executar(usuario: User, modelo: ModeloChecklist, unidade_id: int | None) -> bool:
    if not modelo.ativo or unidade_id is None:
        return False
    if not usuario.is_admin_plus and modelo.area_id != usuario.area_id:
        return False
    if usuario.is_analista and unidade_id != usuario.unidade_id:
        return False
    return modelo.unidade_permitida(unidade_id)


# ------------------------------ Execuções ---------------------------------- #
def filtro_execucoes(usuario: User) -> list:
    """Condições SQL que limitam as execuções visíveis ao usuário."""
    if usuario.is_admin_plus:
        return []
    if usuario.area_id is None:
        return [false()]
    if usuario.is_admin:
        return [Execucao.area_id == usuario.area_id]
    if usuario.unidade_id is None:
        return [false()]
    return [Execucao.area_id == usuario.area_id, Execucao.unidade_id == usuario.unidade_id]


def pode_ver_execucao(usuario: User, ex: Execucao) -> bool:
    if usuario.is_admin_plus:
        return True
    if usuario.area_id is None or ex.area_id != usuario.area_id:
        return False
    if usuario.is_admin:
        return True
    return usuario.unidade_id is not None and ex.unidade_id == usuario.unidade_id


def pode_editar_execucao(usuario: User, ex: Execucao) -> bool:
    """Apenas quem iniciou edita, e somente enquanto não estiver concluída."""
    return (
        ex.status == StatusExecucao.EM_ANDAMENTO
        and ex.usuario_id == usuario.id
        and pode_ver_execucao(usuario, ex)
    )


def pode_reabrir_execucao(usuario: User, ex: Execucao) -> bool:
    if ex.status != StatusExecucao.CONCLUIDO:
        return False
    if usuario.is_admin_plus:
        return True
    return usuario.is_admin and ex.area_id == usuario.area_id
