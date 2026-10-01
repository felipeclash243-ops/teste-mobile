"""Modelos do banco de dados (SQLAlchemy ORM).

Todas as datas são gravadas em UTC (sem fuso) e convertidas para o fuso
configurado (APP_TIMEZONE) apenas na exibição.
"""
import sqlite3
from datetime import datetime, timezone

from flask_login import UserMixin
from sqlalchemy import event
from sqlalchemy.engine import Engine

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    """Liga a verificação de chaves estrangeiras no SQLite (desligada por padrão)."""
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


# --------------------------------------------------------------------------- #
# Constantes de domínio
# --------------------------------------------------------------------------- #
class Perfil:
    ADMIN_PLUS = "admin_plus"
    ADMIN = "admin"
    ANALISTA = "analista"
    TODOS = (ADMIN_PLUS, ADMIN, ANALISTA)
    LABELS = {ADMIN_PLUS: "Admin+", ADMIN: "Admin", ANALISTA: "Analista de filial"}


class Periodicidade:
    AVULSO = "avulso"
    DIARIO = "diario"
    SEMANAL = "semanal"
    MENSAL = "mensal"
    LABELS = {
        AVULSO: "Sob demanda",
        DIARIO: "Diário",
        SEMANAL: "Semanal",
        MENSAL: "Mensal",
    }


class StatusExecucao:
    EM_ANDAMENTO = "em_andamento"
    CONCLUIDO = "concluido"
    LABELS = {EM_ANDAMENTO: "Em andamento", CONCLUIDO: "Concluído"}


class StatusItem:
    CONFORME = "C"
    NAO_CONFORME = "NC"
    NAO_SE_APLICA = "NA"
    TODOS = (CONFORME, NAO_CONFORME, NAO_SE_APLICA)
    LABELS = {CONFORME: "Conforme", NAO_CONFORME: "Não conforme", NAO_SE_APLICA: "Não se aplica"}


# --------------------------------------------------------------------------- #
# Estrutura organizacional
# --------------------------------------------------------------------------- #
class Area(db.Model):
    __tablename__ = "areas"

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(100), nullable=False, unique=True)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow)


class Unidade(db.Model):
    __tablename__ = "unidades"

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(100), nullable=False, unique=True)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow)


# --------------------------------------------------------------------------- #
# Usuários e sessões
# --------------------------------------------------------------------------- #
class User(UserMixin, db.Model):
    __tablename__ = "usuarios"

    id = db.Column(db.Integer, primary_key=True)
    nome = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    senha_hash = db.Column(db.String(255), nullable=False)
    perfil = db.Column(db.String(20), nullable=False, default=Perfil.ANALISTA)
    area_id = db.Column(db.Integer, db.ForeignKey("areas.id"), nullable=True)
    unidade_id = db.Column(db.Integer, db.ForeignKey("unidades.id"), nullable=True)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    tentativas_falhas = db.Column(db.Integer, nullable=False, default=0)
    bloqueado_ate = db.Column(db.DateTime, nullable=True)
    ultimo_login = db.Column(db.DateTime, nullable=True)
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow)

    area = db.relationship("Area")
    unidade = db.relationship("Unidade")

    @property
    def is_active(self) -> bool:  # usado pelo Flask-Login
        return bool(self.ativo)

    @property
    def is_admin_plus(self) -> bool:
        return self.perfil == Perfil.ADMIN_PLUS

    @property
    def is_admin(self) -> bool:
        return self.perfil == Perfil.ADMIN

    @property
    def is_analista(self) -> bool:
        return self.perfil == Perfil.ANALISTA

    @property
    def perfil_label(self) -> str:
        return Perfil.LABELS.get(self.perfil, self.perfil)

    def esta_bloqueado(self, agora=None) -> bool:
        agora = agora or utcnow()
        return self.bloqueado_ate is not None and self.bloqueado_ate > agora


class Sessao(db.Model):
    """Sessão ativa no servidor. O cookie guarda apenas um token aleatório;
    aqui fica o hash SHA-256 dele, o que permite logout real e revogação."""

    __tablename__ = "sessoes"

    id = db.Column(db.String(64), primary_key=True)
    usuario_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    criada_em = db.Column(db.DateTime, nullable=False, default=utcnow)
    ultimo_uso = db.Column(db.DateTime, nullable=False, default=utcnow)
    expira_em = db.Column(db.DateTime, nullable=False)
    ip = db.Column(db.String(45))
    user_agent = db.Column(db.String(255))


# --------------------------------------------------------------------------- #
# Modelos de checklist
# --------------------------------------------------------------------------- #
modelo_unidades = db.Table(
    "modelo_unidades",
    db.Column(
        "modelo_id",
        db.Integer,
        db.ForeignKey("modelos_checklist.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    db.Column(
        "unidade_id", db.Integer, db.ForeignKey("unidades.id", ondelete="CASCADE"), primary_key=True
    ),
)


class ModeloChecklist(db.Model):
    __tablename__ = "modelos_checklist"

    id = db.Column(db.Integer, primary_key=True)
    titulo = db.Column(db.String(150), nullable=False)
    descricao = db.Column(db.Text)
    area_id = db.Column(db.Integer, db.ForeignKey("areas.id"), nullable=False, index=True)
    periodicidade = db.Column(db.String(20), nullable=False, default=Periodicidade.AVULSO)
    ativo = db.Column(db.Boolean, nullable=False, default=True)
    criado_por_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True
    )
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow)
    atualizado_em = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    area = db.relationship("Area")
    criado_por = db.relationship("User")
    # Sem unidades vinculadas = disponível para todas as unidades da área
    unidades = db.relationship("Unidade", secondary=modelo_unidades, order_by="Unidade.nome")
    itens = db.relationship(
        "ItemChecklist",
        order_by="ItemChecklist.ordem",
        cascade="all, delete-orphan",
        back_populates="modelo",
    )

    @property
    def periodicidade_label(self) -> str:
        return Periodicidade.LABELS.get(self.periodicidade, self.periodicidade)

    def unidade_permitida(self, unidade_id) -> bool:
        return not self.unidades or any(u.id == unidade_id for u in self.unidades)


class ItemChecklist(db.Model):
    __tablename__ = "itens_checklist"

    id = db.Column(db.Integer, primary_key=True)
    modelo_id = db.Column(
        db.Integer,
        db.ForeignKey("modelos_checklist.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ordem = db.Column(db.Integer, nullable=False)
    texto = db.Column(db.String(500), nullable=False)

    modelo = db.relationship("ModeloChecklist", back_populates="itens")


# --------------------------------------------------------------------------- #
# Execuções (checklists preenchidos)
# --------------------------------------------------------------------------- #
class Execucao(db.Model):
    __tablename__ = "execucoes"

    id = db.Column(db.Integer, primary_key=True)
    modelo_id = db.Column(
        db.Integer, db.ForeignKey("modelos_checklist.id"), nullable=False, index=True
    )
    usuario_id = db.Column(db.Integer, db.ForeignKey("usuarios.id"), nullable=False, index=True)
    unidade_id = db.Column(db.Integer, db.ForeignKey("unidades.id"), nullable=False, index=True)
    area_id = db.Column(db.Integer, db.ForeignKey("areas.id"), nullable=False, index=True)
    # Cópia do título no momento da execução (o modelo pode mudar depois)
    titulo = db.Column(db.String(150), nullable=False)
    status = db.Column(
        db.String(20), nullable=False, default=StatusExecucao.EM_ANDAMENTO, index=True
    )
    iniciado_em = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    concluido_em = db.Column(db.DateTime, nullable=True, index=True)
    atualizado_em = db.Column(db.DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    modelo = db.relationship("ModeloChecklist")
    usuario = db.relationship("User")
    unidade = db.relationship("Unidade")
    area = db.relationship("Area")
    respostas = db.relationship(
        "Resposta",
        order_by="Resposta.ordem",
        cascade="all, delete-orphan",
        back_populates="execucao",
    )

    @property
    def concluido(self) -> bool:
        return self.status == StatusExecucao.CONCLUIDO

    @property
    def status_label(self) -> str:
        return StatusExecucao.LABELS.get(self.status, self.status)

    def resumo(self) -> dict:
        contagem = {s: 0 for s in StatusItem.TODOS}
        pendentes = 0
        for r in self.respostas:
            if r.status in contagem:
                contagem[r.status] += 1
            else:
                pendentes += 1
        contagem["pendentes"] = pendentes
        contagem["total"] = len(self.respostas)
        return contagem


class Resposta(db.Model):
    __tablename__ = "respostas"

    id = db.Column(db.Integer, primary_key=True)
    execucao_id = db.Column(
        db.Integer, db.ForeignKey("execucoes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id = db.Column(
        db.Integer, db.ForeignKey("itens_checklist.id", ondelete="SET NULL"), nullable=True
    )
    ordem = db.Column(db.Integer, nullable=False)
    # Cópia do texto do item no momento da execução
    item_texto = db.Column(db.String(500), nullable=False)
    status = db.Column(db.String(2), nullable=True)
    observacao = db.Column(db.Text, nullable=True)

    execucao = db.relationship("Execucao", back_populates="respostas")
    fotos = db.relationship(
        "Foto", order_by="Foto.id", cascade="all, delete-orphan", back_populates="resposta"
    )

    @property
    def status_label(self) -> str:
        return StatusItem.LABELS.get(self.status, "Sem resposta")


class Foto(db.Model):
    __tablename__ = "fotos"

    id = db.Column(db.Integer, primary_key=True)
    resposta_id = db.Column(
        db.Integer, db.ForeignKey("respostas.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Nome aleatório (UUID) gerado pelo servidor; nunca o nome enviado pelo usuário
    arquivo = db.Column(db.String(64), nullable=False, unique=True)
    tamanho = db.Column(db.Integer, nullable=False)
    enviado_por_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True
    )
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow)

    resposta = db.relationship("Resposta", back_populates="fotos")


# --------------------------------------------------------------------------- #
# Auditoria
# --------------------------------------------------------------------------- #
class AuditLog(db.Model):
    __tablename__ = "auditoria"

    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(
        db.Integer, db.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True, index=True
    )
    email = db.Column(db.String(255))
    acao = db.Column(db.String(50), nullable=False, index=True)
    alvo = db.Column(db.String(100))
    detalhe = db.Column(db.String(1000))
    ip = db.Column(db.String(45))
    criado_em = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
