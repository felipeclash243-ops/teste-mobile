# Integração com o SIAC

O contrato oficial está em [CONTRATO-API-MOBILE-v1.md](CONTRATO-API-MOBILE-v1.md) (v1.0, 29/09/2026).
O app já implementa o contrato inteiro e, enquanto a API não existe, conversa com um
servidor simulado ([assets/js/api-mock.js](../assets/js/api-mock.js)) que responde da mesma forma.

Para ligar no SIAC real: preencher `API_BASE_URL` em [assets/js/config.js](../assets/js/config.js).

## Fase atual: somente leitura

Por enquanto o app **não grava nada no SIAC**: `ENVIAR_FOTOS: false` em `config.js`.
As fotos ficam só no aparelho, e o cliente da API bloqueia qualquer chamada de gravação antes de sair do celular.

Para o app mostrar os dados reais, o SIAC só precisa implementar agora:

| Rota | Para quê |
|---|---|
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | Identificar o usuário (necessário para filtrar as filiais dele) |
| `GET /filiais` | Filiais do usuário |
| `GET /filiais/{branch_id}/testes` | Testes de cada filial |
| `GET /testes/{modulo}/{id}` | Orientação do auditor |

Mais CORS (item 1 abaixo). A tabela `mobile_uploads` e as rotas de foto ficam para a fase de envio.
O login ainda grava o controle de tokens (`mobile_tokens`) e o registro de acesso (`access_logs`) previstos no contrato.

Para ligar o envio depois: `ENVIAR_FOTOS: true` e o SIAC com as rotas de foto prontas.

## O que o app usa do contrato

| Rota | Onde no app |
|---|---|
| `POST /auth/login`, `/auth/refresh`, `/auth/logout` | [auth.js](../assets/js/auth.js), [api.js](../assets/js/api.js) |
| `GET /filiais` | tela de filiais |
| `GET /filiais/{id}/testes` | tela de testes da filial |
| `GET /testes/{modulo}/{id}` | orientação do auditor na tela do teste |
| `POST /testes/{modulo}/{id}/fotos` | envio de cada foto ([sync.js](../assets/js/sync.js)) |
| `GET /fotos/{client_uuid}` | conferência antes de reenviar um envio que caiu sem resposta |
| `POST /testes/{modulo}/{id}/fotos/concluir` | aviso único ao auditor quando a fila do teste esvazia |

Ainda não usados: `GET /me`, `DELETE /fotos/{uuid}`, `GET /fotos/{uuid}/miniatura`.

## Ajustes a pedir ao time do SIAC

1. **CORS (bloqueante).** O app é uma página web publicada em `https://felipeclash243-ops.github.io`,
   outra origem em relação à API. Sem CORS o navegador bloqueia todas as chamadas. O blueprint
   `/api/mobile/v1` precisa:
   - responder o preflight `OPTIONS`;
   - `Access-Control-Allow-Origin` só para as origens do app (configurável);
   - `Access-Control-Allow-Headers: Authorization, Content-Type, X-App-Version, X-Device-Id`;
   - `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`;
   - `Access-Control-Expose-Headers: Retry-After` (para o app ler o tempo de espera do `429`).
2. **Onde guardar o refresh token.** O contrato pede Keychain/Keystore, que só existem em app nativo.
   Num app web, o refresh token fica no banco local do navegador (IndexedDB) da origem do app.
   Proteções já adotadas: nenhum script de terceiros na página, access token só em memória,
   refresh rotativo com detecção de reuso e vinculado ao `device_id`. Confirmar que isso é aceito.
3. **Código do produto / NF.** No teste de Avarias o código é obrigatório em cada foto. A v1 só tem
   `legenda`, então o app envia `"<código> | <observação>"`. Pedir campos opcionais separados
   (ex.: `item_codigo` e `observacao`) para o auditor poder filtrar e conferir pelo código.
4. **Fotos e comentário por linha de tabela (pendência 3 do contrato).** Há testes com tabelas em que
   cada linha precisa de fotos e comentário. Priorizar na próxima versão: listar as linhas do teste,
   aceitar `item_id` no upload e uma rota para o comentário da linha.
5. **Active Directory (pendência 1).** Se a API rodar fora da rede interna, o login com senha do AD
   não funciona. Definir a alternativa (ex.: `POST /auth/parear`) antes da publicação.
6. **`/health`.** Citado nas convenções, mas não definido. Sugestão: `GET /health` → `200 {"status":"ok"}`.
7. **Domínios** de produção e homologação (pendência 2).
