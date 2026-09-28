# Arquitetura

## Visão geral

```
 Celular (navegador)                                       Sistema web
┌──────────────────────────────────────────────┐        ┌───────────────┐
│ Telas (views/)                               │        │               │
│   login → unidades → testes → teste (fotos)  │        │  API mobile   │
│                               ↓              │        │  (docs/API.md)│
│ imagem.js  comprime (1600px, JPEG 80%)       │        │               │
│                               ↓              │  HTTPS │               │
│ db.js      IndexedDB  ── registros ──────────┼───────►│ POST /registros│
│                       └─ meta (sessão, cat.) │ sync.js│ GET  /catalogo │
│                                              │        │ POST /auth/login│
│ sw.js      cache dos arquivos (offline)      │        │               │
└──────────────────────────────────────────────┘        └───────────────┘
```

O aparelho é a **fonte primária** do registro até a sincronização. Nada depende de internet, exceto o primeiro login (com API) e o envio.

## Banco local (IndexedDB `auditoria-mobile`)

### Store `registros` (uma linha por foto)

| Campo            | Descrição                                                     |
|------------------|---------------------------------------------------------------|
| `id`             | UUID gerado no aparelho; também é a chave de idempotência      |
| `unidadeId` / `unidadeNome` | Unidade auditada                                   |
| `testeId` / `testeNome`     | Teste de auditoria                                 |
| `usuario`        | Auditado logado                                               |
| `itemId`         | Identificação do item (opcional; ex.: código, NF, setor)       |
| `observacao`     | Observação (opcional)                                         |
| `criadoEm`       | Data/hora da captura (ISO 8601)                               |
| `status`         | `pendente` \| `sincronizando` \| `sincronizado` \| `erro`       |
| `tentativas`     | Quantidade de envios com falha                                |
| `ultimoErro`     | Mensagem do último erro                                       |
| `sincronizadoEm` | Data/hora da confirmação do servidor                          |
| `foto`           | Blob JPEG comprimido                                          |
| `fotoTamanho`, `largura`, `altura` | Metadados do arquivo                        |

Índices: `status` e `[unidadeId, testeId]`.

### Store `meta` (chave/valor)

`sessao`, `ultimoUsuario`, `catalogo`.

## Ciclo de vida de um registro

```
  captura ──► PENDENTE ──(sincronizar)──► SINCRONIZANDO ──(200/201/409)──► SINCRONIZADO
                 ▲                              │
                 │                              ├──(falha de rede/servidor)──► ERRO ──┐
                 │                              │                                     │
                 ├──(app fechado no meio)───────┘                                     │
                 ├──(401: sessão expirada)──────┘                                     │
                 └───────────────────(próxima sincronização reenvia)──────────────────┘
```

## Cenários de falha

| Situação | Comportamento |
|---|---|
| Celular sem internet | Fotos salvas como `pendente`; barra "Sem internet" no topo; botão de sincronizar desabilitado. |
| Internet instável | Cada foto é enviada isoladamente, com timeout (`SYNC_TIMEOUT_MS`). Falha marca `erro` naquela foto; se a conexão cair, a sincronização para e o restante continua `pendente`. |
| Aplicação fechada antes de sincronizar | Os dados já estão no IndexedDB (a gravação é confirmada antes do aviso "Foto salva"). Nada se perde. |
| Foto tirada, ainda não sincronizada | Contador no ícone de sincronização; aviso ao sair; a exclusão pede confirmação explícita. |
| Sincronização interrompida | Ao reabrir, registros presos em `sincronizando` voltam para `pendente` (`recuperarInterrompidos`). |
| Foto já enviada ao servidor | Marcada `sincronizado`; não entra mais na fila. Pode ser removida do aparelho para liberar espaço. |
| Reenvio de foto já sincronizada (ex.: o servidor gravou, mas a resposta não chegou) | O `id` vai no header `Idempotency-Key`; o servidor deve responder `200` ou `409` sem duplicar. O app trata ambos como sucesso. |
| Sessão expirada durante o envio | O registro volta a `pendente` e o usuário é levado ao login; as fotos permanecem no aparelho. |
| Pouco espaço no aparelho | Erro claro ao salvar; tela de sincronização mostra o uso e permite remover as fotos já sincronizadas. O app solicita armazenamento persistente (`navigator.storage.persist`) para o navegador não apagar os dados. |

## Offline da própria aplicação

O `sw.js` pré-carrega todos os arquivos na instalação e sempre os serve do cache, então a aplicação abre sem internet. As versões são controladas por `assets/js/versao.js`: ao alterar esse arquivo, o navegador instala a nova versão em segundo plano e a aplicação oferece "Atualizar". Assim, arquivos de versões diferentes nunca se misturam.

## Próximas etapas sugeridas

1. Implementar a API no sistema web ([API.md](API.md)) e configurar `API_BASE_URL`.
2. Catálogo por usuário: o servidor devolve apenas as unidades/testes em que o auditado atua.
3. Itens pré-definidos por teste (ex.: lista de avarias a conferir) baixados para uso offline.
4. Sincronização automática ao reconectar (opcional; hoje é manual para não consumir dados móveis sem aviso).
