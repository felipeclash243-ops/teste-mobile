"""Cria o banco, as áreas/unidades iniciais e o primeiro Admin+.

Uso:
    python seed.py              # pergunta o que faltar (e-mail, senha)
    python seed.py --exemplo    # também cria um checklist de exemplo

Variáveis de ambiente opcionais (.env): ADMIN_EMAIL, ADMIN_NAME,
ADMIN_PASSWORD, SEED_AREAS, SEED_UNIDADES. Depois de rodar, apague
ADMIN_PASSWORD do .env.
"""
import sys

from app import create_app
from app.cli import run_seed

if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        run_seed(interativo=sys.stdin.isatty(), exemplo="--exemplo" in sys.argv)
