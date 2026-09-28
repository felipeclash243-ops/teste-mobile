/**
 * Catálogo padrão de unidades e testes.
 * Usado enquanto o sistema web não fornece o catálogo (GET /catalogo).
 * Quando a API estiver configurada, o catálogo do servidor é salvo no aparelho e substitui este.
 */
export const TESTES = [
  {
    id: 'avarias',
    nome: 'Avarias',
    descricao: 'Produtos e embalagens avariados',
    icone: 'alerta',
    rotuloItem: 'Código do produto / NF',
    itemObrigatorio: false,
  },
  {
    id: 'organizacao',
    nome: 'Organização',
    descricao: 'Arrumação, limpeza e layout',
    icone: 'grade',
    rotuloItem: 'Local / setor',
    itemObrigatorio: false,
  },
  {
    id: 'estoque',
    nome: 'Estoque',
    descricao: 'Contagem e armazenagem',
    icone: 'caixa',
    rotuloItem: 'Código do produto / endereço',
    itemObrigatorio: false,
  },
  {
    id: 'evidencias',
    nome: 'Evidências gerais',
    descricao: 'Outras evidências fotográficas',
    icone: 'camera',
    rotuloItem: 'Referência',
    itemObrigatorio: false,
  },
];

const TODOS = TESTES.map((t) => t.id);

export const UNIDADES = [
  { id: 'belem', nome: 'Belém', uf: 'PA', testes: TODOS },
  { id: 'blumenau', nome: 'Blumenau', uf: 'SC', testes: TODOS },
  { id: 'campo-grande', nome: 'Campo Grande', uf: 'MS', testes: TODOS },
  { id: 'chapeco', nome: 'Chapecó', uf: 'SC', testes: TODOS },
  { id: 'londrina', nome: 'Londrina', uf: 'PR', testes: TODOS },
  { id: 'rio-de-janeiro', nome: 'Rio de Janeiro', uf: 'RJ', testes: TODOS },
  { id: 'sao-paulo', nome: 'São Paulo', uf: 'SP', testes: TODOS },
  { id: 'teresina', nome: 'Teresina', uf: 'PI', testes: TODOS },
  { id: 'uberlandia', nome: 'Uberlândia', uf: 'MG', testes: TODOS },
  { id: 'vitoria', nome: 'Vitória', uf: 'ES', testes: TODOS },
];
