"""Gera os ícones PNG do PWA (192, 512, maskable e apple-touch) com o Pillow.

Uso: python scripts/gerar_icones.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

AZUL = (31, 111, 235, 255)
BRANCO = (255, 255, 255, 255)
DESTINO = Path(__file__).resolve().parent.parent / "static" / "icons"


def desenhar(tamanho: int, maskable: bool = False) -> Image.Image:
    escala = 4  # desenha maior e reduz, para bordas suaves
    t = tamanho * escala
    img = Image.new("RGBA", (t, t), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, t, t], fill=AZUL)
        margem = t * 0.2  # área segura do ícone maskable
    else:
        d.rounded_rectangle([0, 0, t - 1, t - 1], radius=int(t * 0.22), fill=AZUL)
        margem = t * 0.1
    u = (t - 2 * margem) / 64  # unidade baseada no viewBox 64x64 do SVG

    def p(x, y):
        return (margem + x * u, margem + y * u)

    d.rounded_rectangle([*p(17, 13), *p(47, 53)], radius=int(5 * u), outline=BRANCO, width=int(4 * u))
    d.rectangle([*p(26, 11), *p(38, 17)], fill=BRANCO)
    d.line([p(24, 34), p(30, 40), p(41, 28)], fill=BRANCO, width=int(4.5 * u), joint="curve")
    return img.resize((tamanho, tamanho), Image.LANCZOS)


def main():
    DESTINO.mkdir(parents=True, exist_ok=True)
    desenhar(192).save(DESTINO / "icon-192.png")
    desenhar(512).save(DESTINO / "icon-512.png")
    desenhar(512, maskable=True).save(DESTINO / "icon-maskable-512.png")
    fundo = Image.new("RGBA", (180, 180), AZUL)
    fundo.alpha_composite(desenhar(180, maskable=True))
    fundo.convert("RGB").save(DESTINO / "apple-touch-icon.png")
    print(f"Ícones gerados em {DESTINO}")


if __name__ == "__main__":
    main()
