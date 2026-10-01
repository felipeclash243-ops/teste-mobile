FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY templates ./templates
COPY static ./static
COPY wsgi.py seed.py ./

# Usuário sem privilégios; só as pastas de dados são graváveis
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/instance /app/uploads \
    && chown -R appuser:appuser /app/instance /app/uploads
USER appuser

EXPOSE 8000
CMD ["waitress-serve", "--listen=0.0.0.0:8000", "--threads=8", "wsgi:app"]
