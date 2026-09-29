# Pedido ao SIAC: API mobile, fase 1 (somente leitura)

> Copie este texto e entregue à IA ou ao desenvolvedor do SIAC. Ele complementa o
> contrato `CONTRATO-API-MOBILE-v1.md` que vocês mesmos escreveram.

O app mobile já está pronto e publicado em `https://felipeclash243-ops.github.io`, seguindo o
contrato v1. Hoje ele roda com dados simulados porque a API ainda não existe.

**Nesta fase o app não grava nada no SIAC.** Ele só consulta. Implementem, dentro da plataforma
principal, no blueprint `/api/mobile/v1`, apenas:

| Rota | Seção do contrato |
|---|---|
| `POST /auth/login` | 3.1 |
| `POST /auth/refresh` | 3.2 |
| `POST /auth/logout` | 3.3 |
| `GET /filiais` | 4 |
| `GET /filiais/{branch_id}/testes` | 5.1 |
| `GET /testes/{modulo}/{id}` (o app usa só os dados do teste e a `orientacao`; `fotos` pode vir vazio) | 5.2 |
| `GET /health` → `200 {"status":"ok"}` | 2 |

Fora desta fase: rotas de foto (seção 6) e a tabela `mobile_uploads`.

## Obrigatório para funcionar

**CORS.** O app roda no navegador do celular, em outra origem. Sem CORS o navegador bloqueia tudo.
Nas rotas `/api/mobile/*`:

- responder o preflight `OPTIONS` com `204`;
- `Access-Control-Allow-Origin: https://felipeclash243-ops.github.io` (lista configurável por variável de ambiente; incluir `http://localhost:8080` em homologação);
- `Access-Control-Allow-Headers: Authorization, Content-Type, X-App-Version, X-Device-Id`;
- `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`;
- `Access-Control-Expose-Headers: Retry-After`;
- `Access-Control-Max-Age: 600`.

**HTTPS** e **acesso pela internet** (o celular usa 4G, fora da rede interna).

## Decisões que preciso de vocês

1. **Endereço** da API em homologação e em produção.
2. **Login com AD** (pendência 1 do contrato): se a API não alcançar o servidor AD, qual o caminho?
3. **Tokens:** o contrato grava `mobile_tokens` e `access_logs` no login. Se a regra desta fase for
   não gravar nada no banco, digam; a alternativa é um token assinado sem registro no banco
   (perde-se a revogação por aparelho).
4. **Onde guardar o refresh token:** no app web ele fica no banco local do navegador (não existe
   Keychain/Keystore em página web). Confirmar que é aceito.

## Como conferir antes de me avisar

```bash
API=https://<dominio>/api/mobile/v1

curl -i -X OPTIONS "$API/filiais" \
  -H "Origin: https://felipeclash243-ops.github.io" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,x-app-version,x-device-id"
# esperado: 204 com os cabeçalhos Access-Control-* acima

TOKEN=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"<usuario>","senha":"<senha>","device_id":"00000000-0000-4000-8000-000000000000","device_nome":"teste"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s "$API/filiais" -H "Authorization: Bearer $TOKEN"
curl -s "$API/filiais/<id>/testes" -H "Authorization: Bearer $TOKEN"
```

Quando isso responder, me passem o endereço: o app é ligado trocando uma linha de configuração.
