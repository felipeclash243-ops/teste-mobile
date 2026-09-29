# Auditoria de Filiais — Mobile

Aplicação **mobile-first** de apoio aos testes de auditoria. O auditado usa o navegador do celular para registrar evidências fotográficas na filial, **mesmo sem internet**. Os registros ficam salvos no aparelho e são sincronizados com o **SIAC** (sistema web de auditoria) quando houver conexão.

- Sem etapa de build: HTML, CSS e JavaScript puros (módulos ES).
- Funciona offline (PWA com service worker) e pode ser instalada na tela inicial do celular.
- Banco local em IndexedDB, com status de sincronização por foto.

## Fluxo

1. **Tela de bloqueio**: login do auditado com e-mail e senha do SIAC.
2. **Filial**: filiais vinculadas ao usuário, com busca e quantos testes aguardam a filial.
3. **Teste**: testes da filial vindos do SIAC. Só os "Aguardando a filial" aceitam fotos.
4. **Fotos**: câmera ou galeria (várias fotos, identificadas uma por uma). Cada foto é comprimida, recebe um hash SHA-256 e fica salva no aparelho.
5. **Sincronização**: envio ao SIAC com status **Pendente → Sincronizando → Sincronizado**, **Erro** (tenta de novo) ou **Rejeitada** (o SIAC não aceita, por exemplo teste já fechado).

## Estrutura

```
├── index.html                  Página única (shell da aplicação)
├── manifest.webmanifest        Metadados para instalar no celular (PWA)
├── sw.js                       Service worker (cache offline) — precisa ficar na raiz
├── assets/
│   ├── css/app.css             Estilos (mobile-first, modo claro/escuro)
│   ├── icons/                  Ícones da aplicação
│   └── js/
│       ├── app.js              Inicialização e roteador (#/rotas)
│       ├── versao.js           Versão da aplicação (alterar a cada publicação)
│       ├── config.js           Configuração (URL da API, compressão, tempos)
│       ├── db.js               Banco local (IndexedDB)
│       ├── api.js              Cliente da API do SIAC (tokens, cabeçalhos, erros)
│       ├── api-mock.js         Servidor simulado do SIAC (modo demonstração)
│       ├── auth.js             Login e sessão
│       ├── catalogo.js         Filiais e testes (baixados do SIAC, guardados offline)
│       ├── sync.js             Fila de envio das fotos ao SIAC
│       ├── imagem.js           Redimensionamento/compressão das fotos
│       ├── ui.js               Ícones, toasts, diálogos, formatação
│       ├── data/
│       │   └── modulos.js      Regras de tela por módulo (ícone, código obrigatório)
│       └── views/              Uma tela por arquivo
│           ├── login.js
│           ├── unidades.js     Filiais
│           ├── testes.js
│           ├── teste.js        Captura de fotos
│           └── sincronizacao.js
└── docs/
    ├── ARQUITETURA.md          Banco local, estados e cenários de falha
    ├── CONTRATO-API-MOBILE-v1.md  Contrato oficial da API do SIAC
    └── API.md                  Como o app usa o contrato e ajustes pendentes com o SIAC
```

## Rodar localmente

A câmera e o service worker exigem **HTTPS** ou **localhost**. Não abra o `index.html` com duplo clique; sirva a pasta:

```bash
# Python
py -m http.server 8080
# ou Node
npx serve .
```

Acesse `http://localhost:8080`. Sem API configurada, a aplicação roda em **modo demonstração**: qualquer e-mail com a senha `1234`, contra um servidor simulado que segue o contrato do SIAC.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `auditoria-filiais-mobile`).
2. Envie os arquivos desta pasta:
   - **Com Git:**
     ```bash
     git init -b main
     git add .
     git commit -m "Aplicação mobile de auditoria de filiais"
     git remote add origin https://github.com/SEU-USUARIO/auditoria-filiais-mobile.git
     git push -u origin main
     ```
   - **Sem Git:** no repositório vazio, clique em **Add file → Upload files** e arraste **o conteúdo** desta pasta (inclusive `.nojekyll`, `.gitignore` e `.gitattributes`; no Windows, habilite "Itens ocultos" no Explorer).
3. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`.
4. A aplicação ficará em `https://SEU-USUARIO.github.io/auditoria-filiais-mobile/`.

> Repositório **público** expõe o código (não há credenciais nele). Para repositório privado com Pages, é necessário plano GitHub pago. A alternativa é hospedar os arquivos estáticos no próprio servidor do sistema web.

## Publicar uma nova versão

1. Altere `self.APP_VERSAO` em [`assets/js/versao.js`](assets/js/versao.js) (ex.: `1.0.0` → `1.0.1`).
2. Se criou arquivos novos em `assets/`, adicione-os à lista `ARQUIVOS` em [`sw.js`](sw.js).
3. Envie ao GitHub. Os celulares passam a usar a versão nova quando a aplicação é reaberta.

Sem alterar a versão, os aparelhos continuam usando a versão em cache.

## Conectar ao SIAC

1. O SIAC implementa o contrato [`docs/CONTRATO-API-MOBILE-v1.md`](docs/CONTRATO-API-MOBILE-v1.md), com os ajustes listados em [`docs/API.md`](docs/API.md) (o principal é liberar CORS para o endereço do app).
2. Preencha `API_BASE_URL` em [`assets/js/config.js`](assets/js/config.js).

Com a API configurada, o modo demonstração é desativado automaticamente.

## Segurança

- No **modo demonstração**, a tela de bloqueio é apenas visual: a senha está no código. **Não use em produção sem API.**
- Com API, a autenticação é feita pelo SIAC. O aparelho nunca guarda a senha: o token de acesso fica só em memória e o token de renovação (30 dias, rotativo) no banco local.
- As fotos ficam no armazenamento do navegador do aparelho até serem sincronizadas e removidas.

## Filiais, testes e regras por módulo

Filiais e testes vêm do SIAC. O que é regra de tela do app (ícone de cada módulo, rótulo e obrigatoriedade do código do produto/NF) fica em [`assets/js/data/modulos.js`](assets/js/data/modulos.js).
