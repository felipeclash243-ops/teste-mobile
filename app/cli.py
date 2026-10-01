"""Comandos de linha (flask --app wsgi <comando>) e rotina de seed."""
import os

import click
from sqlalchemy import func, select

from .audit import audit
from .extensions import db
from .models import Area, ItemChecklist, ModeloChecklist, Perfil, Periodicidade, Sessao, Unidade, User, utcnow
from .security import hash_password, validate_password
from .utils import email_valido, normalizar_email

AREAS_PADRAO = "Engenharia,T.I.,Jurídico"
UNIDADES_PADRAO = "Belém,Vitória,Juiz de Fora"


def _lista_env(nome: str, padrao: str) -> list[str]:
    return [p.strip() for p in os.environ.get(nome, padrao).split(",") if p.strip()]


def criar_cadastros_iniciais() -> None:
    for Modelo, nomes in (
        (Area, _lista_env("SEED_AREAS", AREAS_PADRAO)),
        (Unidade, _lista_env("SEED_UNIDADES", UNIDADES_PADRAO)),
    ):
        for nome in nomes:
            existe = db.session.scalar(select(Modelo.id).where(func.lower(Modelo.nome) == nome.lower()))
            if not existe:
                db.session.add(Modelo(nome=nome))
                click.echo(f"  + {Modelo.__tablename__}: {nome}")
    db.session.commit()


def criar_admin_plus(interativo: bool = True) -> None:
    """Cria o primeiro Admin+. Usa ADMIN_EMAIL/ADMIN_NAME/ADMIN_PASSWORD do
    ambiente; se faltar algo e houver terminal, pergunta."""
    email = normalizar_email(os.environ.get("ADMIN_EMAIL"))
    nome = (os.environ.get("ADMIN_NAME") or "").strip()
    senha = os.environ.get("ADMIN_PASSWORD") or ""

    if not email and interativo:
        email = normalizar_email(click.prompt("E-mail do Admin+"))
    if not nome:
        nome = click.prompt("Nome do Admin+", default="Administrador") if interativo else "Administrador"
    if not email_valido(email):
        raise click.ClickException("Informe um e-mail válido (ADMIN_EMAIL).")

    if db.session.scalar(select(User.id).where(User.email == email)):
        click.echo(f"  = Usuário {email} já existe; nada a fazer.")
        return

    if not senha and interativo:
        senha = click.prompt("Senha do Admin+", hide_input=True, confirmation_prompt=True)
    erros = validate_password(senha, email=email)
    if erros:
        raise click.ClickException("Senha recusada: " + " ".join(erros))

    usuario = User(nome=nome, email=email, senha_hash=hash_password(senha), perfil=Perfil.ADMIN_PLUS)
    db.session.add(usuario)
    db.session.flush()
    audit("usuario_criado", alvo=f"usuario:{usuario.id}", detalhe=f"{email} perfil=admin_plus (seed)",
          usuario=usuario)
    db.session.commit()
    click.echo(f"  + Admin+ criado: {email}")


def criar_exemplo() -> None:
    area = db.session.scalar(select(Area).order_by(Area.id))
    if area is None or db.session.scalar(select(func.count(ModeloChecklist.id))):
        return
    modelo = ModeloChecklist(
        titulo="Inspeção predial mensal",
        descricao="Verificação geral das instalações da unidade.",
        area_id=area.id,
        periodicidade=Periodicidade.MENSAL,
    )
    for ordem, texto in enumerate(
        [
            "Extintores dentro da validade e sinalizados",
            "Iluminação de emergência funcionando",
            "Quadro elétrico fechado e identificado",
            "Ar-condicionado com manutenção em dia",
            "Saídas de emergência desobstruídas",
        ],
        start=1,
    ):
        modelo.itens.append(ItemChecklist(ordem=ordem, texto=texto))
    db.session.add(modelo)
    db.session.commit()
    click.echo(f"  + Checklist de exemplo criado na área {area.nome}")


def run_seed(interativo: bool = True, exemplo: bool = False) -> None:
    db.create_all()
    click.echo("Banco de dados pronto.")
    criar_cadastros_iniciais()
    criar_admin_plus(interativo=interativo)
    if exemplo:
        criar_exemplo()
    click.echo("Seed concluído.")


def registrar_comandos(app) -> None:
    @app.cli.command("init-db")
    def init_db():
        """Cria as tabelas do banco (idempotente)."""
        db.create_all()
        click.echo("Tabelas criadas.")

    @app.cli.command("seed")
    @click.option("--exemplo", is_flag=True, help="Cria também um checklist de exemplo.")
    @click.option("--sem-interacao", is_flag=True, help="Não pergunta nada (usa só variáveis de ambiente).")
    def seed(exemplo, sem_interacao):
        """Cria banco, áreas/unidades iniciais e o primeiro Admin+."""
        run_seed(interativo=not sem_interacao, exemplo=exemplo)

    @app.cli.command("create-admin")
    def create_admin():
        """Cria um usuário Admin+ (pergunta os dados)."""
        criar_admin_plus(interativo=True)

    @app.cli.command("limpar-sessoes")
    def limpar_sessoes():
        """Remove sessões expiradas."""
        n = db.session.query(Sessao).filter(Sessao.expira_em <= utcnow()).delete()
        db.session.commit()
        click.echo(f"{n} sessões removidas.")
