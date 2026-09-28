# Contrato da API (sistema web)

Endpoints que o sistema web precisa expor para a aplicação mobile. Base: `CONFIG.API_BASE_URL` (ex.: `https://auditoria.suaempresa.com.br/api/mobile`).

Requisitos gerais:

- **HTTPS** obrigatório.
- **CORS** liberado para a origem da aplicação (ex.: `https://SEU-USUARIO.github.io`), com os headers `Authorization`, `Content-Type` e `Idempotency-Key`.
- Erros podem devolver `{ "erro": "mensagem legível" }`, que é exibida ao usuário.

---

## `POST /auth/login`

Valida o auditado (ex.: AD/LDAP) e devolve um token.

**Requisição** (`application/json`)

```json
{ "usuario": "fulano.silva", "senha": "••••••" }
```

**Respostas**

| Código | Corpo |
|---|---|
| `200` | `{ "token": "eyJ...", "nome": "Fulano da Silva" }` |
| `401` | Usuário ou senha inválidos |

O token deve valer pelo menos o tempo de `SESSAO_HORAS` (padrão 24 h), pois o auditado pode ficar offline durante a auditoria.

---

## `GET /catalogo`

Unidades e testes disponíveis. Header: `Authorization: Bearer <token>`.

```json
{
  "unidades": [
    { "id": "belem", "nome": "Belém", "uf": "PA", "testes": ["avarias", "organizacao"] }
  ],
  "testes": [
    {
      "id": "avarias",
      "nome": "Avarias",
      "descricao": "Produtos e embalagens avariados",
      "icone": "alerta",
      "rotuloItem": "Código do produto / NF",
      "itemObrigatorio": false
    }
  ]
}
```

Ícones disponíveis: `alerta`, `grade`, `caixa`, `camera`, `local`, `prancheta`, `galeria`.

---

## `POST /registros`

Recebe **uma foto** com seus metadados.

**Headers**

```
Authorization: Bearer <token>
Idempotency-Key: <id do registro (UUID)>
```

**Corpo** (`multipart/form-data`)

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | texto | UUID gerado no aparelho (igual ao `Idempotency-Key`) |
| `unidadeId` | texto | |
| `testeId` | texto | |
| `usuario` | texto | Usuário informado no login (o servidor deve confiar no token) |
| `itemId` | texto | Pode ser vazio |
| `observacao` | texto | Pode ser vazio |
| `criadoEm` | texto | ISO 8601, horário da captura no aparelho |
| `foto` | arquivo | JPEG, nome `<id>.jpg` |

**Respostas**

| Código | Significado para o app |
|---|---|
| `200` / `201` | Gravado → `sincronizado` |
| `409` | Já existia um registro com esse `id` → `sincronizado` (não duplica) |
| `401` | Token inválido/expirado → registro volta a `pendente`, usuário refaz login |
| outros | → `erro`, reenviado na próxima sincronização |

**Idempotência (obrigatório):** o servidor deve ter uma restrição única sobre `id`. Se a mesma foto chegar duas vezes (ex.: a resposta se perdeu na rede), a segunda deve ser ignorada e responder `200` ou `409`.
