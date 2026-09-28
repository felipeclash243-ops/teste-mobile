/**
 * Processamento de fotos: redimensiona e comprime em JPEG antes de salvar,
 * reduzindo o uso de espaço no aparelho e o tempo de envio.
 */

function carregarComoImagem(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Arquivo de imagem inválido.')); };
    img.src = url;
  });
}

export async function comprimirImagem(arquivo, { maxLado, qualidade }) {
  if (!arquivo.type.startsWith('image/')) throw new Error('O arquivo selecionado não é uma imagem.');

  let fonte;
  try {
    fonte = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    fonte = await carregarComoImagem(arquivo);
  }

  const larguraOriginal = fonte.naturalWidth || fonte.width;
  const alturaOriginal = fonte.naturalHeight || fonte.height;
  const escala = Math.min(1, maxLado / Math.max(larguraOriginal, alturaOriginal));
  const largura = Math.round(larguraOriginal * escala);
  const altura = Math.round(alturaOriginal * escala);

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext('2d').drawImage(fonte, 0, 0, largura, altura);
  fonte.close?.();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a foto.'))),
      'image/jpeg',
      qualidade,
    );
  });
  canvas.width = canvas.height = 0; // libera memória no iOS

  return { blob, largura, altura };
}
