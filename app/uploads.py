"""Upload seguro de fotos.

1. Extensão e MIME declarados precisam estar na lista permitida.
2. O conteúdo real é identificado pelo Pillow (assinatura do arquivo) e
   precisa corresponder à extensão.
3. Tamanho máximo por arquivo e limite de pixels (proteção contra
   "decompression bomb").
4. A imagem é decodificada e regravada como JPEG novo: metadados (EXIF/GPS)
   e qualquer conteúdo embutido são descartados.
5. Nome aleatório (UUID) gerado pelo servidor; o nome original é ignorado,
   o que impede path traversal.
6. A pasta fica fora de static/ e as fotos só saem por rota autenticada.
"""
import io
import os
import re
import uuid
from pathlib import Path

from flask import current_app
from PIL import Image, ImageOps, UnidentifiedImageError

FORMATOS = {
    "JPEG": {".jpg", ".jpeg"},
    "PNG": {".png"},
    "WEBP": {".webp"},
}
EXTENSOES = set().union(*FORMATOS.values())
MIMES = {"image/jpeg", "image/png", "image/webp", "image/pjpeg"}
MAX_PIXELS = 40_000_000
NOME_SEGURO = re.compile(r"^[0-9a-f]{32}\.jpg$")

Image.MAX_IMAGE_PIXELS = MAX_PIXELS


class UploadError(ValueError):
    """Erro com mensagem segura para mostrar ao usuário."""


def pasta_uploads() -> Path:
    return Path(current_app.config["UPLOAD_FOLDER"]).resolve()


def caminho_seguro(nome: str) -> Path:
    if not NOME_SEGURO.match(nome or ""):
        raise UploadError("Nome de arquivo inválido.")
    pasta = pasta_uploads()
    destino = (pasta / nome).resolve()
    if destino.parent != pasta:
        raise UploadError("Nome de arquivo inválido.")
    return destino


def processar_foto(arquivo) -> tuple[str, int]:
    """Valida e regrava a foto. Retorna (nome_gerado, tamanho_em_bytes)."""
    nome_original = arquivo.filename or ""
    extensao = os.path.splitext(nome_original)[1].lower()
    if extensao not in EXTENSOES:
        raise UploadError("Formato não permitido. Envie JPG, PNG ou WEBP.")
    if (arquivo.mimetype or "").lower() not in MIMES:
        raise UploadError("Formato não permitido. Envie JPG, PNG ou WEBP.")

    limite = current_app.config["MAX_PHOTO_MB"] * 1024 * 1024
    dados = arquivo.stream.read(limite + 1)
    if not dados:
        raise UploadError("Arquivo vazio.")
    if len(dados) > limite:
        raise UploadError(f"Foto muito grande (máximo {current_app.config['MAX_PHOTO_MB']} MB).")

    try:
        with Image.open(io.BytesIO(dados)) as teste:
            formato = teste.format
            largura, altura = teste.size
            teste.verify()
        if formato not in FORMATOS or extensao not in FORMATOS[formato]:
            raise UploadError("O conteúdo do arquivo não corresponde à extensão.")
        if largura * altura > MAX_PIXELS:
            raise UploadError("Imagem com resolução grande demais.")

        with Image.open(io.BytesIO(dados)) as imagem:
            imagem.load()
            imagem = ImageOps.exif_transpose(imagem)
            if imagem.mode in ("RGBA", "LA", "P"):
                imagem = imagem.convert("RGBA")
                fundo = Image.new("RGB", imagem.size, (255, 255, 255))
                fundo.paste(imagem, mask=imagem.split()[-1])
                imagem = fundo
            else:
                imagem = imagem.convert("RGB")
            dimensao = current_app.config["PHOTO_MAX_DIMENSION"]
            imagem.thumbnail((dimensao, dimensao))

            nome = f"{uuid.uuid4().hex}.jpg"
            destino = caminho_seguro(nome)
            destino.parent.mkdir(parents=True, exist_ok=True)
            # Sem o parâmetro exif=..., nenhum metadado é gravado.
            imagem.save(destino, "JPEG", quality=85, optimize=True)
    except UploadError:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError, SyntaxError):
        raise UploadError("Imagem inválida ou corrompida.")

    return nome, destino.stat().st_size


def remover_arquivo(nome: str) -> None:
    try:
        caminho_seguro(nome).unlink(missing_ok=True)
    except (UploadError, OSError):
        current_app.logger.warning("Não foi possível remover o arquivo de foto %s", nome)
