# Arquitetura

## Visão geral

```
 Celular (navegador)                                            SIAC
┌─────────────────────────────────────────────────┐        ┌──────────────────────┐
│ Telas (views/)                                  │        │ /api/mobile/v1       │
│   login → filiais → testes → teste (fotos)      │        │                      │
│                              ↓                  │        │ POST /auth/login     │
│ imagem.js  comprime (1600 px, JPEG 80%) + SHA-256│        │ POST /auth/refresh   │
│                              ↓                  │  HTTPS │ GET  /filiais        │
│ db.js      IndexedDB ── registros (fotos) ──────┼───────►│ GET  /filiais/{id}/testes
│                     └─ meta (sessão, listas)    │ sync.js│ POST /testes/{m}/{id}/fotos
│ api.js     tokens, cabeçalhos, erros padrão     │ api.js │ GET  /fotos/{uuid}   │
│ sw.js      cache dos arquivos (offline)         │        │ POST .../fotos/concluir
└─────────────────────────────────────────────────┘        └──────────────────────┘
```

O aparelho é a **fonte primária** da foto até o SIAC confirmar o recebimento.
Contrato completo: [CONTRATO-API-MOBILE-v1.md](CONTRATO-API-MOBILE-v1.md).
Sem `API_BASE_URL`, o `api.js` usa o servidor simulado `api-mock.js`, com as mesmas respostas.

## Banco local (IndexedDB `auditoria-mobile`)

### Store `registros` (uma linha por foto)

| Campo | Descrição |
|---|---|
| `id` | UUID gerado na captura. É o `client_uuid` do contrato (chave de idempotência) |
| `unidadeId` / `unidadeNome` | Filial (`branch_id`) |
| `testeId` | `ref` do teste (`"<modulo>:<id>"`, ex.: `avarias:1201`) |
| `modulo` / `testeNumId` / `testeNome` | Identificação do teste no SIAC |
| `usuario` / `usuarioNome` | E-mail e nome do auditado logado |
| `itemId` | Código do produto / NF (obrigatório em Avarias) |
| `observacao` | Observação opcional |
| `criadoEm` | Momento da captura (`capturada_em`) |
| `foto` / `sha256` | JPEG comprimido e seu hash, calculado na captura |
| `status` | `pendente` · `sincronizando` · `sincronizado` · `erro` · `rejeitada` |
| `tentativas` / `ultimoErro` / `erroCodigo` | Histórico de falhas (`codigo` do erro da API) |
| `verificarAntes` | O último envio caiu sem resposta: conferir `GET /fotos/{uuid}` antes de reenviar |
| `anexoId` / `sincronizadoEm` | Confirmação do SIAC |
| `notificadoEm` | Auditor já avisado por `/fotos/concluir` |

Índices: `status` e `[unidadeId, testeId]`.

### Store `meta` (chave/valor)

`sessao` (usuário + refresh token), `deviceId`, `ultimoEmail`, `filiais`, `testes:<filial>`, `teste:<ref>` (orientação).

## Ciclo de vida de uma foto

```
 captura ─► PENDENTE ─(sincronizar)─► SINCRONIZANDO ─(200/201)─► SINCRONIZADO ─(fila do teste vazia)─► auditor avisado
               ▲                            │
               │                            ├─(rede, timeout, 5xx, 422)─► ERRO ─(próxima sincronização)─┐
               │                            │                                                          │
               │                            ├─(409 teste_indisponivel, 404, 415, 409 uuid_reutilizado)─► REJEITADA (não reenvia)
               ├─(app fechado no meio / sessão expirada)─┘                                             │
               └────────────────────────────────────────────────────────────────────────────────────────┘
```

## Cenários de falha

| Situação | Comportamento |
|---|---|
| Sem internet | Fotos salvas como `pendente`; filiais, testes e orientação vêm do que já foi baixado; botão de sincronizar desabilitado. |
| Internet instável | Uma foto por requisição. Se a rede cair, a foto vira `erro` e a fila para; o resto continua `pendente`. |
| Envio caiu sem resposta | A foto é marcada para conferência: na próxima vez o app pergunta `GET /fotos/{uuid}` e só reenvia se o SIAC não tiver recebido. |
| Mesma foto enviada duas vezes | O SIAC responde `200` com a foto já gravada (mesmo `client_uuid` e `sha256`); nada é duplicado. |
| Arquivo corrompido no caminho | `422 hash_divergente` → `erro`, reenviada na próxima sincronização. |
| Teste fechou antes do envio | `409 teste_indisponivel` → `rejeitada`, com o motivo no painel. A foto não é reenviada. |
| Acesso expirado (1 h) | `401 token_expirado` → o app renova com `/auth/refresh` e repete a mesma chamada. |
| Sessão expirada (30 dias ou revogada) | `401 sessao_expirada` → volta ao login; a fila é mantida e enviada depois do novo login. |
| App fechado no meio do envio | Ao reabrir, fotos presas em `sincronizando` voltam para `pendente`. |
| Versão do app antiga | `426 versao_desatualizada` → aviso; a nova versão entra ao reabrir o app. |
| Pouco espaço no aparelho | Erro claro ao salvar; o painel mostra o uso e permite remover as fotos já sincronizadas. |

## Offline da própria aplicação

O `sw.js` guarda todos os arquivos do app na instalação e sempre os serve do cache.
A versão fica em `assets/js/versao.js`: ao mudar, o navegador baixa a nova versão e ela passa a valer quando o app é reaberto.
