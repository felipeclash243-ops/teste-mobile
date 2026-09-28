# Auditoria de Filiais — Mobile

Aplicação **mobile-first** de apoio aos testes de auditoria. O auditado usa o navegador do celular para registrar evidências fotográficas na filial, **mesmo sem internet**. Os registros ficam salvos no aparelho e são sincronizados com o sistema web quando houver conexão.

- Sem etapa de build: HTML, CSS e JavaScript puros (módulos ES).
- Funciona offline (PWA com service worker) e pode ser instalada na tela inicial do celular.
- Banco local em IndexedDB, com status de sincronização por foto.

## Fluxo

1. **Tela de bloqueio**: login do auditado.
2. **Unidade**: seleção da filial (Belém, Rio de Janeiro, Vitória…), com busca.
3. **Teste**: testes disponíveis para a unidade (Avarias, Organização, Estoque…).
4. **Fotos**: câmera ou galeria. Cada foto é comprimida e salva no aparelho com unidade, teste, data/hora, usuário, identificação do item e observação.
5. **Sincronização**: envio ao sistema web com status **Pendente → Sincronizando → Sincronizado / Erro**.

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
│       ├── config.js           Configuração (URL da API, compressão, sessão)
│       ├── db.js               Banco local (IndexedDB)
│       ├── auth.js             Login e sessão
│       ├── catalogo.js         Unidades e testes (servidor ou padrão)
│       ├── sync.js             Fila de sincronização com o sistema web
│       ├── imagem.js           Redimensionamento/compressão das fotos
│       ├── ui.js               Ícones, toasts, diálogos, formatação
│       ├── data/
│       │   └── catalogo-padrao.js   Unidades e testes padrão
│       └── views/              Uma tela por arquivo
│           ├── login.js
│           ├── unidades.js
│           ├── testes.js
│           ├── teste.js        Captura de fotos
│           └── sincronizacao.js
└── docs/
    ├── ARQUITETURA.md          Banco local, estados e cenários de falha
    └── API.md                  Contrato que o sistema web deve implementar
```

## Rodar localmente

A câmera e o service worker exigem **HTTPS** ou **localhost**. Não abra o `index.html` com duplo clique; sirva a pasta:

```bash
# Python
py -m http.server 8080
# ou Node
npx serve .
```

Acesse `http://localhost:8080`. Sem API configurada, a aplicação roda em **modo demonstração**: qualquer usuário com a senha `1234` e sincronização simulada.

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
3. Envie ao GitHub. Os celulares mostram **"Nova versão disponível → Atualizar"**.

Sem alterar a versão, os aparelhos continuam usando a versão em cache.

## Conectar ao sistema web

1. Implemente no sistema web os endpoints descritos em [`docs/API.md`](docs/API.md).
2. Preencha `API_BASE_URL` em [`assets/js/config.js`](assets/js/config.js).
3. Libere CORS no sistema web para o endereço onde a aplicação está publicada.

Com a API configurada, o modo demonstração é desativado automaticamente.

## Segurança

- No **modo demonstração**, a tela de bloqueio é apenas visual: a senha está no código. **Não use em produção sem API.**
- Com API, a autenticação é feita pelo sistema web (ex.: AD/LDAP), que devolve um token. O aparelho guarda apenas o token, nunca a senha.
- As fotos ficam no armazenamento do navegador do aparelho até serem sincronizadas e removidas.

## Unidades e testes

Enquanto a API não fornece o catálogo, edite [`assets/js/data/catalogo-padrao.js`](assets/js/data/catalogo-padrao.js) e publique uma nova versão.
