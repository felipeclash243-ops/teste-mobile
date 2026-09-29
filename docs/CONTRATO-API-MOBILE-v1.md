# API Mobile — contrato de integração (v1)
**Versão do contrato:** 1.0 · **Atualizado:** 29/09/2026

Contrato entre o **app mobile de captura de fotos** e o **SIAC**. Cobre login,
filiais, testes, envio de fotos e sincronização offline.

> **Estado atual — leia antes de começar**
>
> Nenhum endpoint deste documento existe ainda. Hoje o SIAC só tem rotas web
> (HTML + cookie de sessão + CSRF) e o `captura_fotos/` também é web e somente
> leitura. Este documento é o **contrato a implementar**: o time mobile pode
> desenvolver contra ele (com mock) enquanto o backend é construído.
>
> Tudo aqui foi derivado das regras que o sistema já aplica (escopo de filial,
> status `pending_unit`, extensões permitidas, tabelas de anexo). As
> referências de código ficam na seção 11.

---

## 1. Onde a API roda

**Decisão recomendada:** a API fica **dentro da plataforma principal**, como um
blueprint Flask em `/api/mobile/v1`, e não no `captura_fotos/`.

Motivo: os anexos são gravados em **disco local** da plataforma principal
(`AUDITORIA_DATA_DIR`) e registrados nas tabelas `*_attachments`. Um serviço
separado no Render não consegue gravar nesse disco (Render Disk não é
compartilhado entre serviços). Colocando a API na plataforma, a foto enviada
pelo celular cai **no mesmo lugar** que um anexo enviado pela web — o auditor
vê sem nenhuma tela nova.

| Ambiente | Base URL |
|---|---|
| Produção | `https://<dominio-da-plataforma>/api/mobile/v1` *(a definir)* |
| Homologação | `https://<dominio-homolog>/api/mobile/v1` *(a definir)* |
| Local | `http://localhost:5000/api/mobile/v1` |

Somente HTTPS fora do ambiente local.

---

## 2. Convenções

| Item | Regra |
|---|---|
| Formato | JSON UTF-8 (`Content-Type: application/json`), exceto upload (`multipart/form-data`) |
| Autenticação | `Authorization: Bearer <access_token>` em todas as rotas, exceto `/health` e `/auth/*` |
| Datas | ISO 8601 com fuso: `2026-09-29T14:03:00-03:00`. Datas sem hora: `2026-09-29` |
| Nomes de campo | `snake_case`, em português onde o domínio já é português |
| Identificação do app | Enviar sempre `X-App-Version: 1.4.0` e `X-Device-Id: <uuid do aparelho>` |
| Versionamento | Quebra de contrato gera `/v2`. Campos novos podem aparecer em `/v1` a qualquer momento — **o app deve ignorar campos desconhecidos** |
| CSRF | Não se aplica às rotas `/api/mobile/*` (autenticação é por token, não por cookie) |

### Identificador de teste

Os testes estão em **cinco tabelas diferentes** e os `id` se repetem entre elas.
Um teste é identificado sempre pelo par **`modulo` + `id`**:

| `modulo` | Tabela | Nome exibido |
|---|---|---|
| `avarias` | `avarias_tests` | Avarias |
| `sf` | `sf_tests` | Sobras e Faltas |
| `gar` | `gar_tests` | Garantia |
| `cl` | `cl_tests` | Check List Instalação |
| `gt` | `gt_tests` | vem de `test_type` (ex.: Inventário Rotativo) |

Para facilitar chave local no celular, a API devolve também `ref` = `"<modulo>:<id>"`
(ex.: `"gt:812"`).

### Formato de erro

Todo erro (4xx/5xx) tem o mesmo corpo:

```json
{
  "erro": {
    "codigo": "teste_indisponivel",
    "mensagem": "Este teste não está mais aguardando a filial.",
    "detalhes": {}
  }
}
```

`mensagem` é texto pronto para mostrar ao usuário. O app decide o que fazer
pelo `codigo` (tabela completa na seção 8), nunca pela mensagem.

---

## 3. Autenticação

Tokens em dois níveis:

| Token | Validade | Onde guardar no celular |
|---|---|---|
| `access_token` | 1 hora | memória |
| `refresh_token` | 30 dias, **rotativo** (cada uso gera um novo e invalida o anterior) | Keychain (iOS) / Keystore (Android) — nunca em armazenamento comum |

### 3.1 `POST /auth/login`

```json
{
  "email": "fulano@comolatti.com.br",
  "senha": "********",
  "device_id": "3f1c9a2e-8a41-4a57-9d0b-7c0e2b1f5a10",
  "device_nome": "Galaxy A54 — Loja Campinas"
}
```

**200**

```json
{
  "access_token": "eyJhbGciOi...",
  "access_expira_em": "2026-09-29T15:03:00-03:00",
  "refresh_token": "rt_9b2f...",
  "refresh_expira_em": "2026-10-29T14:03:00-03:00",
  "usuario": {
    "id": 57,
    "nome": "Fulano de Tal",
    "email": "fulano@comolatti.com.br",
    "perfil": "unidade"
  }
}
```

Regras (as mesmas do `captura_fotos/auth.py`, que já foram decididas):

- Credencial validada contra a tabela `users` do SIAC. O app **não** cria nem
  altera usuários.
- Mensagem genérica `credenciais_invalidas` para e-mail inexistente **e** senha
  errada — não revelar quais e-mails existem.
- Conta com `users.locked_at` preenchido → `403 conta_bloqueada`. A API
  **respeita** o bloqueio, mas **não** incrementa `failed_login_count`, para que
  erro de digitação no celular não tranque o acesso web.
- Limite de 8 tentativas por IP em 5 minutos → `429 muitas_tentativas`
  (com cabeçalho `Retry-After` em segundos).
- Login bem-sucedido é gravado em `access_logs`, como na web.
- Se `app_config.ad_enabled = '1'`, a senha válida é a do Active Directory. A
  plataforma principal consegue validar AD quando roda na rede interna; se a
  instância não alcançar o servidor AD, responde `503 ad_indisponivel`
  (ver pendência 1 na seção 10).

### 3.2 `POST /auth/refresh`

```json
{ "refresh_token": "rt_9b2f...", "device_id": "3f1c9a2e-..." }
```

**200** — mesmo corpo do login (novo par de tokens). **401 `sessao_expirada`**
se o refresh for inválido, expirado, já usado ou de outro `device_id`: o app
deve voltar à tela de login **sem apagar a fila de fotos**.

> Reuso de um refresh já usado revoga **todos** os tokens daquele aparelho
> (sinal de token vazado).

### 3.3 `POST /auth/logout`

Revoga o refresh token do aparelho. **204**.
O app deve avisar se houver fotos na fila antes de permitir sair.

### 3.4 `GET /me`

Devolve o objeto `usuario` (igual ao do login). Útil ao abrir o app para
confirmar que o token ainda vale e que o usuário não foi removido.

---

## 4. Filiais

### `GET /filiais`

Filiais no escopo do usuário, com contagem de testes.

- Perfil `unidade`: só as filiais em `user_branches`.
- Demais perfis: todas as filiais cadastradas.

**200**

```json
{
  "filiais": [
    {
      "id": 12,
      "codigo": "CPS",
      "nome": "Campinas",
      "testes_disponiveis": 2,
      "testes_total": 14
    }
  ]
}
```

Ordenado por `nome`. Filial sem nenhum teste aparece com zeros.

---

## 5. Testes

### Regra de disponibilidade

Um teste está **disponível** (aceita fotos) quando o status é `pending_unit` —
o único momento do fluxo em que a filial responde e anexa evidências.

| `status` | `status_rotulo` | Aceita fotos |
|---|---|---|
| `pending_unit` | Aguardando a filial | **sim** |
| `draft` | Rascunho | não |
| `sent` | Enviado — aguardando auditor | não |
| `evaluated` | Avaliado | não |

Outros valores podem surgir; o app deve exibir `status_rotulo` e confiar em
`aceita_fotos`, nunca montar a regra sozinho.

### 5.1 `GET /filiais/{branch_id}/testes`

**200**

```json
{
  "filial": { "id": 12, "codigo": "CPS", "nome": "Campinas" },
  "disponiveis": [
    {
      "ref": "gt:812",
      "modulo": "gt",
      "id": 812,
      "nome": "Inventário Rotativo",
      "status": "pending_unit",
      "status_rotulo": "Aguardando a filial",
      "aceita_fotos": true,
      "iniciado_em": "2026-09-22T09:10:00-03:00",
      "prazo_filial": "2026-10-06T23:59:00-03:00",
      "fotos_enviadas": 3,
      "atualizado_em": "2026-09-28T16:40:12-03:00"
    }
  ],
  "indisponiveis": [ /* mesmo formato, aceita_fotos = false */ ]
}
```

- Ambas as listas vêm do mais recente para o mais antigo (`iniciado_em`).
- `disponiveis` vem completa; `indisponiveis` traz no máximo os **30** mais
  recentes.
- `prazo_filial` pode ser `null` (nem todo módulo tem prazo gravado).
- `fotos_enviadas` conta só as fotos enviadas pela filial neste teste.
- `branch_id` fora do escopo → **403 `filial_fora_do_escopo`**. O servidor
  sempre revalida o escopo; nunca confia no id da URL.

### 5.2 `GET /testes/{modulo}/{id}`

Detalhe de um teste, com as fotos já recebidas.

**200**

```json
{
  "ref": "gt:812",
  "modulo": "gt",
  "id": 812,
  "nome": "Inventário Rotativo",
  "filial": { "id": 12, "nome": "Campinas" },
  "status": "pending_unit",
  "status_rotulo": "Aguardando a filial",
  "aceita_fotos": true,
  "iniciado_em": "2026-09-22T09:10:00-03:00",
  "prazo_filial": "2026-10-06T23:59:00-03:00",
  "orientacao": "Fotografe as etiquetas das posições listadas no e-mail.",
  "fotos": [
    {
      "client_uuid": "b3a4c1de-5f60-4c8e-9a71-2d4e6f8a0b1c",
      "anexo_id": 4410,
      "nome_arquivo": "IMG_20260928_164011.jpg",
      "tamanho_bytes": 348211,
      "legenda": "Prateleira B3",
      "capturada_em": "2026-09-28T16:40:11-03:00",
      "recebida_em": "2026-09-28T16:40:12-03:00",
      "enviada_por": "Fulano de Tal",
      "miniatura_url": "/api/mobile/v1/fotos/b3a4c1de-5f60-4c8e-9a71-2d4e6f8a0b1c/miniatura"
    }
  ]
}
```

- `orientacao` pode ser `null`.
- `fotos` lista apenas o que foi enviado pela filial (inclusive pela web).
  Fotos enviadas pela web não têm `client_uuid` (vem `null`).
- Teste fora do escopo → **404 `teste_nao_encontrado`** (não 403, para não
  confirmar que o teste existe).

---

## 6. Fotos

### 6.1 `POST /testes/{modulo}/{id}/fotos` — enviar uma foto

**Uma foto por requisição.** Em 4G instável é melhor perder e reenviar uma foto
do que um lote inteiro.

`multipart/form-data`:

| Campo | Obrigatório | Descrição |
|---|---|---|
| `arquivo` | sim | O binário da imagem |
| `client_uuid` | sim | UUID v4 **gerado no celular no momento da captura**. É a chave de idempotência |
| `capturada_em` | sim | Data/hora da captura no aparelho (ISO 8601 com fuso) |
| `sha256` | sim | Hash SHA-256 (hex minúsculo) do `arquivo` exatamente como enviado |
| `legenda` | não | Texto livre, até 500 caracteres |
| `latitude`, `longitude` | não | Se o app tiver permissão de localização |

Restrições do arquivo:

| Regra | Valor |
|---|---|
| Extensões aceitas | `.jpg` `.jpeg` `.png` `.webp` `.heic` `.heif` — **enviar JPEG sempre que possível** (o navegador do auditor não abre HEIC) |
| Tamanho máximo aceito pelo servidor | 15 MB (acima → `413 arquivo_grande_demais`) |
| Tamanho recomendado | Redimensionar no celular para o maior lado ≈ **1600 px**, JPEG qualidade ~80 (≈ 350 KB) |
| EXIF | Pode manter; o servidor não depende dele |

Respostas:

| Código | Quando | Corpo |
|---|---|---|
| **201** | Foto nova gravada | objeto `foto` (mesmo formato de 5.2) |
| **200** | `client_uuid` já recebido antes com o mesmo `sha256` — reenvio após queda de conexão | o **mesmo** objeto `foto` já gravado; nada é duplicado |
| 409 `uuid_reutilizado` | `client_uuid` já existe com `sha256` diferente | — (bug no app: gerar novo UUID) |
| 409 `teste_indisponivel` | O teste saiu de `pending_unit` entre a captura e o envio | `detalhes.status` atual |
| 422 `hash_divergente` | `sha256` não confere com o arquivo recebido (corrompido no caminho) | — reenviar |
| 415 `formato_nao_permitido` | Extensão/tipo fora da lista | — |
| 404 `teste_nao_encontrado` | Teste inexistente ou fora do escopo | — |

O que o servidor faz ao gravar (igual ao upload web):

1. Salva o arquivo com nome aleatório no diretório de anexos do módulo.
2. Insere a linha na tabela de anexos do módulo (`avarias_attachments`,
   `sf_attachments`, `gar_attachments`, `cl_attachments` ou `gt_attachments`
   com `phase = 'unit_initial'`).
3. Registra o vínculo `client_uuid → anexo` em `mobile_uploads` (seção 9).
4. Dispara o backup do anexo (`backup_attachment`).
5. **Não** notifica o auditor por foto — ver 6.3.

### 6.2 `GET /fotos/{client_uuid}` — conferir se uma foto chegou

Para reconciliar a fila depois de uma queda: se a requisição de upload caiu sem
resposta, o app pergunta antes de reenviar.

- **200** → a foto está no servidor (corpo: objeto `foto`). Marcar como enviada.
- **404 `foto_nao_encontrada`** → reenviar.

### 6.3 `POST /testes/{modulo}/{id}/fotos/concluir` — avisar o auditor

Chamado quando a fila daquele teste esvazia. Dispara **uma** notificação e
**um** e-mail ao auditor responsável ("Campinas anexou 7 foto(s)"), em vez de
um por foto.

```json
{ "client_uuids": ["b3a4c1de-...", "c7d8e9f0-..."] }
```

**200** `{ "notificado": true, "quantidade": 7 }`.
Chamar de novo com os mesmos UUIDs não notifica duas vezes.
Se o app nunca chamar (ex.: foi desinstalado), as fotos continuam visíveis
para o auditor no teste — só a notificação não sai.

> Enviar foto **não** envia o teste para avaliação. A filial continua
> usando a plataforma web para responder e clicar em "Enviar ao auditor".
> (Se isso passar a ser feito no app, entra como endpoint novo em `/v1`.)

### 6.4 `DELETE /fotos/{client_uuid}` — apagar uma foto enviada

Permitido só enquanto o teste está em `pending_unit` e só para quem enviou.
**204**, ou `409 teste_indisponivel` / `403 sem_permissao`.

### 6.5 `GET /fotos/{client_uuid}/miniatura`

JPEG com o maior lado em 320 px, para a tela de detalhe. Exige o mesmo token.
Cabeçalho `Cache-Control: private, max-age=86400`.

---

## 7. Sincronização — o que o app deve fazer

O celular está em loja com 4G fraco. A regra é: **a foto nunca se perde no
aparelho até o servidor confirmar.**

### Estados de cada foto na fila local

```
capturada ──► enviando ──► enviada
                 │  ▲
                 ▼  │ (retry com espera)
              aguardando_rede
                 │
                 ▼
             rejeitada  (erro definitivo: 409 teste_indisponivel, 415, 404, 409 uuid_reutilizado)
```

### Algoritmo

1. Na captura: gerar `client_uuid`, redimensionar, calcular `sha256`, gravar
   arquivo + metadados na fila local (banco local do app, **não** em cache
   temporário). Estado `capturada`.
2. Worker de envio processa **uma foto por vez**, a mais antiga primeiro.
3. Resultado do `POST /fotos`:
   - `200` ou `201` → `enviada`. Pode apagar o arquivo local depois de N dias.
   - `401 token_expirado` → `POST /auth/refresh` e repetir.
   - `401 sessao_expirada` → pausar a fila, pedir login, **manter a fila**.
   - `422 hash_divergente`, `5xx`, timeout, sem rede → `aguardando_rede`;
     nova tentativa com espera exponencial (5 s, 15 s, 45 s, 2 min, 5 min… teto
     de 15 min).
   - Timeout **sem resposta** → antes de reenviar, `GET /fotos/{client_uuid}`.
   - `409 teste_indisponivel`, `404`, `415`, `409 uuid_reutilizado` →
     `rejeitada`. Não tentar de novo; mostrar ao usuário com a `mensagem`.
4. Quando não houver mais fotos pendentes de um teste → `POST .../fotos/concluir`.
5. Ao abrir o app e ao voltar a ter rede: retomar a fila.

Como `client_uuid` torna o envio idempotente, **reenviar sempre é seguro**.

### Atualização das listas

Não há push nesta versão. O app atualiza `GET /filiais` e
`GET /filiais/{id}/testes` ao abrir a tela e com "puxar para atualizar".
Use `atualizado_em` de cada teste para saber se precisa recarregar o detalhe.

---

## 8. Códigos de erro

| HTTP | `codigo` | O que o app faz |
|---|---|---|
| 400 | `requisicao_invalida` | Bug no app; registrar e mostrar mensagem |
| 401 | `credenciais_invalidas` | Mostrar mensagem no login |
| 401 | `token_expirado` | `POST /auth/refresh` e repetir |
| 401 | `sessao_expirada` | Ir para login, manter fila |
| 403 | `conta_bloqueada` | Mostrar mensagem; admin desbloqueia pela web |
| 403 | `filial_fora_do_escopo` | Voltar para lista de filiais |
| 403 | `sem_permissao` | Mostrar mensagem |
| 404 | `teste_nao_encontrado` | Remover da tela; fotos na fila → `rejeitada` |
| 404 | `foto_nao_encontrada` | (em 6.2) reenviar |
| 409 | `teste_indisponivel` | Foto → `rejeitada`; atualizar lista |
| 409 | `uuid_reutilizado` | Bug no app; gerar novo UUID e enviar como foto nova |
| 413 | `arquivo_grande_demais` | Reduzir mais e reenviar |
| 415 | `formato_nao_permitido` | Converter para JPEG e reenviar |
| 422 | `hash_divergente` | Reenviar |
| 426 | `versao_desatualizada` | Bloquear uso e pedir atualização do app (servidor compara `X-App-Version` com a mínima aceita) |
| 429 | `muitas_tentativas` | Esperar `Retry-After` |
| 503 | `ad_indisponivel` | Mostrar mensagem; contatar Auditoria |
| 503 | `manutencao` | Tentar mais tarde; fila continua |
| 500 | `erro_interno` | Retry com espera |

---

## 9. O que o backend precisa criar

Nada nas tabelas de teste ou de anexo muda. Entram duas tabelas novas:

```sql
-- Tokens de refresh por aparelho (guardar só o hash, nunca o token)
CREATE TABLE mobile_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id       TEXT    NOT NULL,
    device_nome     TEXT,
    refresh_hash    TEXT    NOT NULL UNIQUE,
    criado_em       TIMESTAMP NOT NULL DEFAULT now(),
    expira_em       TIMESTAMP NOT NULL,
    usado_em        TIMESTAMP,          -- preenchido na rotação
    revogado_em     TIMESTAMP,
    app_version     TEXT
);
CREATE INDEX idx_mobile_tokens_user_device ON mobile_tokens (user_id, device_id);

-- Vínculo entre a foto do celular e o anexo gravado (idempotência)
CREATE TABLE mobile_uploads (
    client_uuid     UUID PRIMARY KEY,
    modulo          TEXT    NOT NULL,   -- avarias | sf | gar | cl | gt
    test_id         INTEGER NOT NULL,
    anexo_id        INTEGER NOT NULL,   -- id na tabela *_attachments do módulo
    user_id         INTEGER NOT NULL REFERENCES users(id),
    sha256          CHAR(64) NOT NULL,
    legenda         TEXT,
    capturada_em    TIMESTAMPTZ,
    recebida_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    notificado_em   TIMESTAMPTZ         -- preenchido por /fotos/concluir
);
CREATE INDEX idx_mobile_uploads_teste ON mobile_uploads (modulo, test_id);
```

Pontos de implementação:

- Reaproveitar a lógica que já existe em vez de reescrever: escopo de filial
  (`unidade_name_matches_scope` / `user_branch_names_for_filter`), resolução de
  nome da filial (`build_unidade_resolver`), diretórios de anexo
  (`_attach_dir_for` em `core/arquivos_routes.py`), `backup_attachment`,
  `push_notification` e `email_attachment_uploaded`.
- Checar status **dentro da mesma transação** do insert do anexo, para não
  aceitar foto num teste que acabou de ser enviado ao auditor.
- `cl_tests` usa `items_status` no lugar de `status`.
- Isentar `/api/mobile/*` do `@csrf_required` e do login por cookie; usar um
  decorator próprio `@token_obrigatorio`.
- Limite de tamanho da requisição no blueprint: 16 MB.
- Configuração nova: `MOBILE_JWT_SECRET`, `MOBILE_VERSAO_MINIMA`.

---

## 10. Pendências que afetam o app

1. **Active Directory.** Com `ad_enabled = '1'`, o login mobile só funciona se a
   instância da API alcançar o servidor AD (`10.10.1.41`). Se a API rodar na
   nuvem, será preciso outro caminho (ex.: código de pareamento gerado na web
   pelo usuário logado, trocado por um refresh token). Se isso for adotado,
   entra como `POST /auth/parear` sem mudar o resto do contrato.
2. **Domínios de produção e homologação** — a definir (seção 1).
3. **Anexar por item/amostra.** Os módulos têm anexo por amostra e por linha de
   planilha (ex.: `/amostra/<sample_id>/anexos`). A v1 cobre só o anexo **do
   teste**. Foto por item entra depois como campo opcional `item_id` no upload.
4. **Enviar o teste ao auditor pelo app** — fora da v1 (ver nota em 6.3).

---

## 11. Referências no código

| Assunto | Onde |
|---|---|
| Login atual do app de captura (regras de bloqueio e tentativas) | `captura_fotos/auth.py` |
| Filiais do usuário e checagem de escopo | `captura_fotos/unidades.py` → `filiais_do_usuario`, `filial_do_usuario_ou_none` |
| Listagem de testes e regra `pending_unit` | `captura_fotos/testes.py` |
| Upload web de anexo (modelo a seguir) | `core/avarias_routes.py` → `avarias_upload_anexo`; `core/generic_tests.py` → `gt_upload` |
| Diretório de anexo por módulo | `core/arquivos_routes.py` → `_attach_dir_for` |
| Extensões e tamanhos aceitos | `core/constants.py` → `ATTACH_EXT_IMAGES`, `COMMON_ALLOWED_ATTACH_EXT` |
| Tabelas de teste e anexo | `core/avarias.py`, `core/sf.py`, `core/gar.py`, `core/checklist.py`, `core/generic_tests.py` |
| Disco persistente | `core/auditoria_paths.py` → `AUDITORIA_DATA_DIR` |

---

## Histórico

| Data | Versão | Mudança |
|---|---|---|
| 29/09/2026 | 1.0 | Primeira versão do contrato |
