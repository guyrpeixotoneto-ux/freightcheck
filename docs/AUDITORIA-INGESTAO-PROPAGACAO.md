# Auditoria de ingestão e propagação de dados

> **Escopo:** todas as entradas de dados do FreightCheck e o caminho que cada
> dado percorre até as telas que o consomem.
> **Método:** leitura do repositório inteiro + reprodução em banco. As
> divergências da Parte 3 não são leitura de código — cada uma foi reproduzida
> contra Postgres e está presa por teste em
> `artifacts/api-server/src/routes/__tests__/propagacao-divergencias.test.ts`.
> **Estado:** nenhum comportamento foi alterado. Este documento é a prova que
> precede a correção.

---

## Sumário executivo

O produto **tem** as duas portas de dado que deveria ter, e elas funcionam: o
pipeline de vigência (`POST /imports` → `POST /imports/:id/promote`) e o de
chamados (`POST /ticket-imports`). O `fact` — o grão do sistema — é escrito por
um único arquivo, `lib/ingest/src/pipeline.ts`, e por nenhum outro. Isso foi
verificado exaustivamente e é a boa notícia desta auditoria: **não existe
gravação clandestina no canônico**.

Ao lado delas há uma terceira entrada, `BOOK` (`POST /book/entries`), que
**continua existindo por decisão** e não é defeito: ela recebe *regra* —
contrato, manual, planilha de apoio — e nunca escreve fato canônico. A regra do
produto, na forma exata, é **dado que vira número entra por duas portas; regra
que sustenta número entra pelo Book** (Parte 1.3).

O que existe é outra coisa, e é pior de detectar:

1. **Uma fonte paralela de leitura, no menu, servindo dado que nunca passou
   pelo canônico** — `Análise de frota` lê um `.xlsx` do disco do servidor. Não
   é porta de ingestão: ela não grava nada. É pior de outro jeito — hoje devolve
   **tela vazia** com 124 mil fatos no banco. A funcionalidade **se preserva**;
   o que muda é de onde ela lê.
2. **Uma porta-sombra completa** — `routes/overview.ts` reimplementa
   `POST /imports` e `POST /imports/:id/promote` com validação mais fraca. Está
   inalcançável **por ordem de montagem**, e por nada mais.
3. **Oito definições de leitura para "quais vigências formam uma série"**, e
   **duas autoridades divergentes sobre o canal**. É daqui que sai a classe de
   defeito que motivou esta auditoria: o dado está no banco e um módulo não sabe
   que ele existe. A contagem subiu de cinco para oito no complemento, que as
   tabela uma a uma — ver `docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte B.

As três divergências centrais **não aparecem no export real** — ele é uma
unidade, um canal, nove entregas completas escritas sempre do mesmo jeito. É o
caminho mais estreito possível pelo produto, e era o único que os testes
percorriam. Cada uma delas dispara na primeira entrega que saia desse caminho.

---

## Parte 1 — Todas as entradas de dados

### 1.1 A tabela

| Entrada | Tela/rota | Tipo de dado | Destino | Deve existir? | Classe |
|---|---|---|---|---|---|
| `POST /imports` (`routes/imports.ts`) | Importações | `.xlsx` de vigência: equipamento, remuneração, parâmetros, escopo | `source_file` → `raw_*` → `staged_fact` | **Sim** | `IMPORTACOES` |
| `POST /imports/:id/promote` (`routes/imports.ts`) | Importações | promoção do que foi conferido | `snapshot`, `entity`, `attribute`, **`fact`**, `snapshot_*` | **Sim** | `IMPORTACOES` |
| `DELETE /imports/:id` (`routes/imports.ts`) | Importações | remoção de importação | apaga canônico, grava `import_deletion` | **Sim** | `IMPORTACOES` |
| `POST /ticket-imports` (`routes/tickets.ts`) | Alterações → Chamados | `.xlsx`/`.csv` da fila do Freightech | `ticket_import`, `ticket`, `ticket_change` | **Sim** | `CHAMADOS` |
| `DELETE /ticket-imports/:id` (`routes/tickets.ts`) | Alterações → Chamados | remoção de envio | apaga chamados, grava `ticket_import_deletion` | **Sim** | `CHAMADOS` |
| `GET /fleet-analysis/*` (`routes/fleet-analysis.ts`) | **Análise de frota** (menu, 1ª seção) | planilha lida **do disco**, `attached_assets/*.xlsx` | **não grava** — serve direto à tela | funcionalidade **sim**, a fonte **não** | **`FONTE PARALELA DE LEITURA INDEVIDA`** — não é porta |
| `POST /imports` (`routes/overview.ts`) | nenhuma | `.xlsx` de vigência | `source_file` → `raw_*` → `staged_fact` | **Não** | **`INDEVIDA`** (sombra) |
| `POST /imports/:id/promote` (`routes/overview.ts`) | nenhuma | promoção | canônico | **Não** | **`INDEVIDA`** (sombra) |
| `POST /book/entries` (`routes/book.ts`) | Book do Operador | documento (PDF/DOCX/XLSX/imagem) ou texto | `book_entry` (blob no banco) | **Sim** | **`BOOK`** — terceira porta, documental e declarada |
| `pnpm dev:seed` (`lib/curation/src/cli/dev-seed.ts`) | CLI | `.xlsx` de `attached_assets` | canônico, **pelo mesmo pipeline** | Sim (dev) | `IMPORTACOES` |
| `POST /coverage/decisions` | Cobertura | decisão de curadoria sobre expectativa | `coverage_expectation` | Sim | derivado / decisão |
| `POST /coverage/contract/seed` | Cobertura (e a promoção) | contrato derivado de `lib/dre/src/plano.ts` | `coverage_expectation` | Sim | derivado de código |
| `POST /curation/attributes/:code/confirm` | Curadoria | semântica do atributo | `attribute`, `curation_event` | Sim | curadoria |
| `POST /curation/proposal-pass` | Curadoria | proposta automática de semântica | `attribute` | Sim | curadoria |
| `POST /curation/versions/:code/{source-change,correction}`, `/backfill` | Versões | versão semântica | `attribute_semantics` | Sim | curadoria |
| `POST /change-sets` | Comparar | comparação sob demanda | `change_set`, `change` | Sim | derivado |
| `POST /users`, `/users/:id/*`, `/auth/*` | Configurações, Login | identidade de operador | `app_user`, `user_session` | Sim | não é dado de negócio |
| `POST /assistant/*` | Assistente | conversa | `assistant_conversation`, `assistant_message` | Sim | não é dado de negócio |

### 1.2 O que foi verificado sobre o canônico

`fact` — o grão — é escrito **exclusivamente** por `lib/ingest/src/pipeline.ts`.
O mesmo vale para `snapshot`, `entity`, `attribute`, `scope`, `snapshot_scope`,
`snapshot_attribute`, `snapshot_entity_type` e `entity_identifier`. Nenhuma
rota, nenhum script e nenhum outro pacote insere nelas. As demais gravações do
sistema são todas em camadas declaradamente derivadas (`change_set`, `change`,
`coverage_expectation`, `attribute_semantics`, `curation_event`, `taxonomy_node`)
ou fora do domínio (`app_user`, `book_entry`, `assistant_*`).

**Conclusão da Parte 1:** as duas portas existem, são as certas, e o canônico
está fechado. O problema não é escrita clandestina — é leitura clandestina e
propagação.

### 1.3 As entradas indevidas, em detalhe

#### `PARALELA-1` — Análise de frota lê o disco do servidor

`artifacts/api-server/src/routes/fleet-analysis.ts` procura o **primeiro**
`.xlsx` que encontrar em `attached_assets/`, lê as abas literais `carretas` e
`cavalos` com SheetJS, e guarda o resultado num `_cache` de módulo que nada
invalida. Ele tem parser de vigência próprio, com `EMPURRADA_` fixo no código —
o mesmo acoplamento que `lib/ingest/src/vigencia.ts` removeu.

Isso não é dívida teórica: `docs/ARQUITETURA.md` §1 já classificou esta rota
como **absorver** — *"Lê Excel do disco, fora do Postgres, sem rastreabilidade"*.
A absorção não aconteceu, e a tela continua no menu.

**E hoje ela está vazia.** Medido neste repositório:

```
readdir order: [ 'Modelo_Carreta.xlsx', 'Modelo_Cavalo.xlsx', 'Remuneração_…' ]
escolhido:     Modelo_Carreta.xlsx
abas:          [ 'Modelo_Carreta' ]
wb.Sheets['carretas'] → undefined → 0 linhas
```

Desde que a Ambev passou a entregar um arquivo por equipamento, a aba `carretas`
deixou de existir e a rota devolve zero linhas — **sem erro**, porque
`sheet_to_json(undefined)` devolve `[]`. É o caso literal desta auditoria: o
banco tem nove vigências e 124 mil fatos, e a primeira seção do menu diz que não
há dado.

**Isto não é uma porta de entrada, e a distinção muda o que se faz com ela.**
A rota não grava nada — não escreve em `fact`, não abre `snapshot`, não cria
`entity`. Ela **lê** de um lugar que não é o canônico, e por isso a classe certa
é *fonte paralela de leitura indevida*. Uma porta indevida se fecha; uma fonte
paralela se **redireciona**.

**A funcionalidade fica.** "Análise de frota" responde perguntas que nenhuma
outra tela responde — composição de modelos, status de ativo, financiamento por
vigência —, e o defeito nunca foi a análise: foi a origem. O destino é a mesma
tela lendo `fact`/`entity`/`snapshot` pela autoridade de disponibilidade, com
rastreabilidade até a célula como todo o resto do produto tem. O mapeamento
dessa migração está no complemento desta auditoria
(`docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte I, PR-3).

#### `INDEVIDA-2` — a porta-sombra de `overview.ts`

`routes/overview.ts` define `POST /imports` e `POST /imports/:id/promote`
completos: recebe base64, escreve em `mkdtempSync(tmpdir())`, chama
`receiveFile`/`captureRaw`/`stage`/`preview`, e promove.

Diferenças em relação à porta de verdade, todas para pior:

| | `routes/imports.ts` | `routes/overview.ts` |
|---|---|---|
| base64 validado | sim | não |
| assinatura `PK` do `.xlsx` | sim | não |
| destino em disco | `ensureImportStorageDir()`, nome = sha256 | `tmpdir()`, perdido no próximo deploy |
| quem enviou | `req.user.email` | `"upload"` fixo |
| falha classificada (schema/regra/defeito) | sim | `err.message` cru para a tela |
| `onExistingSnapshot` | `"FAIL"` / `"NEW_REVISION"` | `"REJECT"` — **valor que o pipeline não conhece** |

O que hoje impede essas rotas de responder é uma linha de
`routes/index.ts`: `router.use(importsRouter)` vem antes de
`router.use(overviewRouter)`, e o Express entrega ao primeiro que casa. Reordenar
o arquivo — ou remover a rota de `imports.ts` um dia — reabre a porta em
silêncio, com validação mais fraca e sem rastro de autor.

`overview.ts` também duplica `GET /imports`, `GET /imports/:id` e
`GET /imports/:id/status`, com formatos de resposta **diferentes** dos de
`imports.ts`. Só a Visão geral (`GET /overview`) deste arquivo é usada.

#### `BOOK` — a terceira porta, documental e declarada

`POST /book/entries` aceita arquivo (PDF, DOCX, XLSX, imagem) e guarda o blob no
banco. **Ela fica como está, e importar arquivo por ali continua sendo o
comportamento correto** — decidido em 16/08/2026, e registrado aqui porque uma
regra de arquitetura que tem exceção não escrita é uma regra que alguém vai
"consertar" um dia sem saber que estava consertando o que funcionava.

O que a separa das outras duas não é o tamanho nem a importância: é a
**natureza do que entra**. As portas `IMPORTACOES` e `CHAMADOS` recebem
*medida* — o que o ativo custa, o que foi pedido, o que voltou aplicado — e o
que elas gravam alimenta número na tela. A porta `BOOK` recebe **regra**: o
contrato, o manual, a planilha de apoio, o texto escrito à mão no cartão do
bloco. É o que o export do Freightec não traz, e é o que responde "em que isso
se apoia?" quando alguém aponta para uma linha de remuneração.

Por isso ela não conflita com a regra das duas portas, e a formulação exata da
regra passa a ser esta:

> **Dado que vira número entra por duas portas — Importações e Chamados. Regra
> que sustenta número entra pelo Book. Nenhum documento do Book escreve fato
> canônico, e nenhum número do produto sai dele.**

As três invariantes que mantêm essa fronteira verdadeira, e que hoje o código
já cumpre:

1. `book_entry` **não é lida** por nenhum motor de cálculo — nem
   `@workspace/comparison`, nem `@workspace/coverage`, nem `@workspace/composition`,
   nem `@workspace/dre`. Seus únicos leitores são a tela do Book e o índice do
   Assistente (`lib/knowledge`, `lib/assistant/src/indice-book.ts`), que a citam
   como **fonte de regra**, com link para o documento — nunca como parcela de
   uma soma.
2. A porta não escreve em `fact`, `snapshot`, `entity` nem `attribute`. Isso
   está coberto pela verificação da Parte 1.2: `pipeline.ts` é o único escritor
   do canônico.
3. `POST` sempre cria a revisão seguinte e **não existe `DELETE`** nesta
   superfície — uma auditoria de seis meses atrás precisa da regra que valia
   naquele dia.

Nenhuma correção proposta nesta auditoria toca o Book, e nenhuma deve tocar. Se
alguma vez ele aparecer numa lista de "portas a fechar", esta seção é a resposta.

---

## Parte 2 — A propagação: quem consome o quê

### 2.1 Ficha de cada módulo

Sete perguntas por módulo, como pedido. `contexto` significa o par
`(scope_hash, canal derivado do rótulo)` de `lib/comparison/src/series.ts`.

| Módulo | Tabelas | Filtros | Snapshot | Entidade | Atributos | Estado válido | Devolve "sem dados" quando |
|---|---|---|---|---|---|---|---|
| **Importações** | `import_run`, `source_file`, `raw_sheet`, `snapshot`, `import_deletion` | nenhum | todos, inclusive `SUPERSEDED` | — | — | **todos** os estados de `import_run` | não há `import_run` |
| **Cobertura** | `snapshot`, `snapshot_entity_type`, `snapshot_attribute`, `attribute`, `coverage_expectation`; `fact` só p/ `null_reason` | `(dataset_family, scope_hash, canal-**coluna**)` opcional + janela de N vigências (padrão 6) | `<> SUPERSEDED` | todos os de `snapshot_entity_type` | todos os de `snapshot_attribute` | promovido | zero vigências na janela; vigência sem `snapshot_entity_type` cai em `incompleto` |
| **Alterações · Planilha** | `change_set`, `change`, `snapshot`, `fact` | contexto + **`entity_type_set`** | `<> SUPERSEDED` | `entity_type_set` da vigência | os do `change` | promovido + comparado | sem vigência (404); sem anterior na série (409) |
| **Alterações · Chamados** | `ticket_import`, `ticket`, `ticket_change`; lê `fact`/`attribute`/`entity_identifier` p/ o "antes" | **nenhum filtro de contexto** | `<> SUPERSEDED` (só na busca do "antes") | `ticket.entity_type` (texto do arquivo) | `ticket_change.attribute_code`, quando resolve | `ticket_import.status = READ` | não há envio → `200` com `import: null` |
| **Alterações · Impacto** | `snapshot`, `fact`, `attribute`, `entity`, `entity_identifier` | **contexto** | `<> SUPERSEDED` | os de `entity_type_set`, com `CAVALO` preferido | `data_type = 'NUMERIC'` **e** `attribute.entity_type = tipo` | promovido | quatro causas distintas, **uma frase só** (ver Parte 6) |
| **Comparar** | `snapshot`, `change_set` | **nenhum** | `<> SUPERSEDED` | — | — | promovido | lista vazia |
| **Vigências** | `snapshot` | **nenhum** | `<> SUPERSEDED` | — | — | promovido | lista vazia |
| **Parâmetros** | `change_set`, `change` | contexto + período | `<> SUPERSEDED` | — | por família econômica | comparado | sem comparação no período |
| **Composição** | `fact`, `attribute`, `entity`, `snapshot` | contexto | `<> SUPERSEDED` | **`CAVALO` e `CARRETA` fixos** (`regras.ts`) | `COMPOSITIONS` declarado | `semantics_status` para somar | sem contexto/vigência/identidade |
| **DRE** | idem Composição + plano | contexto | `<> SUPERSEDED` | **`CAVALO`/`CARRETA`/`CONJUNTO` fixos** (`plano.ts`) | `fontes` declaradas por componente | **só `CONFIRMED` soma** | vocabulário próprio de ausência (ver Parte 6) |
| **Balanço de massa** | `import_run`, `raw_cell`, `staged_fact`, `fact` | por `import_run` | — | — | — | qualquer run lido | sem run |
| **Curadoria** | `attribute`, `snapshot_attribute`, `curation_event`, `taxonomy_node` | nenhum | `<> SUPERSEDED` | `attribute.entity_type` | todos | qualquer | fila vazia |
| **Versões** | `attribute_semantics`, `attribute` | nenhum | — | — | todos | qualquer | sem versão |
| **Visão geral** | `snapshot`, `entity`, `fact`, `attribute`, `change*` + `/changes/grouped`, `/balance`, `/imports`, `/contexts` | **nenhum nos contadores** | **todos, inclusive `SUPERSEDED`** | — | — | qualquer | sem vigência |
| **Acompanhamento** | `/changes/grouped` | contexto | `<> SUPERSEDED` | por componente | — | comparado | sem comparação |
| **Unidades** | `/contexts` | nenhum | `<> SUPERSEDED` | — | — | promovido | sem contexto |
| **Assistente** | tudo, pelas mesmas funções | contexto | `<> SUPERSEDED` | conforme a ferramenta | conforme a ferramenta | conforme a ferramenta | responde a ausência em texto |
| **Análise de frota** | **nenhuma — lê `.xlsx` do disco** | `Vigencia` da planilha | — | abas `carretas`/`cavalos` | colunas cruas | — | **sempre, hoje** |
| **Book do Operador** | `book_entry` | por bloco | — | — | — | — | bloco sem entrada |

### 2.2 A matriz fonte × módulo

`✓` = consome hoje · `—` = não se aplica por semântica · `✗` = **deveria e não
consome** · `⚠` = consome com recorte que pode esconder dado existente.

| Fonte de dado | Importações | Vigências | Cobertura | Alterações · Planilha | Alterações · Chamados | Impacto | Comparar | Composição | DRE | Balanço | Curadoria | Visão geral | Análise de frota |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Vigência (`snapshot`) | ✓ | ✓ | ✓ | ⚠ contexto+set | — | ⚠ contexto | ✓ | ⚠ contexto | ⚠ contexto | ✓ | ✓ | ⚠ conta `SUPERSEDED` | ✗ |
| Fato de cavalo | ✓ | — | ✓ | ⚠ | — | ⚠ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | ✗ |
| Fato de carreta | ✓ | — | ✓ | ⚠ | — | ⚠ | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠ | ✗ |
| Fato de um **terceiro** equipamento | ✓ | — | ✓ | ✓ | — | ⚠ | ✓ | **✗** | **✗** | ✓ | ✓ | ✓ | — |
| Atributo / dicionário | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | ✓ | ✓ | — |
| `attribute_alias` | ✓ escreve | — | — | — | **✗** | — | — | — | — | — | — | — | — |
| Escopo (`scope`, `canonical_scope`) | ✓ | — | ✓ | ⚠ usa `scope_hash` | — | ⚠ | — | ⚠ | ⚠ | — | — | ✓ | — |
| Canal (`snapshot.canal`) | ✓ | — | ✓ **coluna** | ⚠ **regex** | — | ⚠ **regex** | — | ⚠ **regex** | ⚠ **regex** | — | — | — | — |
| `import_decision` (por que o arquivo não entrou) | **✗** | — | — | — | — | — | — | — | — | — | — | — | — |
| `snapshot_merge` (para onde foi a vigência X) | **✗** | **✗** | — | — | — | — | — | — | — | — | — | — | — |
| Chamado (`ticket`) | — | — | — | — | ✓ | — | — | — | — | — | — | — | — |
| Parâmetro de chamado (`ticket_change`) | — | — | — | — | ✓ | — | — | — | — | — | — | — | — |
| Documento do Book | — | — | — | — | — | — | — | — | — | — | — | — | — |

**Sobre os `—`, que não são omissão.** Chamado **não** entra em Cobertura: a
cobertura mede o que uma vigência entregou contra o que ela deveria entregar, e
um chamado não é entrega de vigência — contá-lo ali inflaria o denominador com
um documento de outra natureza. Chamado **não** entra em Impacto: aquela leitura
é o estado do ativo por quinzena, e um chamado é movimento pedido, não estado
apurado. Chamado **não** vira `change`: a soma da tela deixaria de fechar com a
comparação, e toda mudança pedida por chamado e depois observada na planilha
seria contada duas vezes. Essas três exclusões são corretas e estão preservadas
por teste (`propagacao-vigencia.test.ts`, bloco "porta 2").

---

## Parte 3 — Dados existentes que parecem inexistentes

Doze achados. Os três primeiros estão **reproduzidos em banco** e presos por
teste; os demais são leitura de código com o ponto exato citado.

---

### D1 · O contexto é chaveado por `scope_hash`, que o próprio modelo aposentou

> **Dado existe em:** `snapshot`, `fact` — duas vigências consecutivas da mesma
> unidade, com `canonical_scope` **idêntico**.
> **Módulo que não enxerga:** Impacto, Alterações, Composição, DRE, Parâmetros,
> Assistente — tudo que passa por `resolveContext`/`contextFilter`.
> **Motivo:** `scope_hash` é o SHA-256 dos códigos de escopo **como vieram
> escritos** (`hashScopeSet(scopeIds.descriptors)`, `pipeline.ts:1464`). O CNPJ
> chega do Excel ora `07.526.557/0015-05`, ora `07526557001505`. A identidade
> canônica normaliza os dois para a mesma unidade — é exatamente o que
> `canonical-identity.ts` existe para fazer, e o comentário de
> `schema/canonical.ts` diz com todas as letras que `scope_hash` *"não faz mais
> parte da identidade"*. Só que `series.ts` reparte o mundo por ele.
> **Filtro/query responsável:** `lib/comparison/src/series.ts` — `listContexts`
> (`GROUP BY s.scope_hash, canal`) e `contextFilter` (`s.scope_hash = …`).
> **Comportamento correto esperado:** uma unidade que é uma no canônico é uma no
> seletor. O contexto deve ser chaveado por `canonical_scope` (ou pela chave
> canônica sem a data), nunca pelo hash cru.
> **Correção sugerida:** trocar o par do contexto para
> `(canonical_scope, canal)`, mantendo `scope_hash` apenas como coluna
> descritiva. Ver Parte 4.

**Reproduzido.** Duas vigências, `ROTA_1_3_2026` e `ROTA_1_4_2026`, mesma
unidade, CNPJ escrito das duas formas:

```
2026-03-01 ROTA  scope=e3a769f5  canonical_scope=[…UNIDADE 07526557001505]
2026-04-01 ROTA  scope=6e75fbd3  canonical_scope=[…UNIDADE 07526557001505]   ← mesmo escopo canônico

contextos:  "CAMACARI · ROTA" (1 período) || "CAMACARI · ROTA" (1 período)   ← dois, com o mesmo nome
Cobertura:  2026-03-01, 2026-04-01                                          ← vê as duas
Impacto:    2026-04-01                                                      ← vê UMA
Alterações: findPreviousSnapshot = NULL para as duas                        ← "não há anterior"
```

O seletor de contexto passa a oferecer **duas entradas com rótulo idêntico**, e
não há como distinguir uma da outra na tela. Metade da história some do Impacto
sem que nada diga que sumiu.

---

### D2 · Duas autoridades divergentes sobre o canal

> **Dado existe em:** `snapshot.canal` — coluna `NOT NULL`, com `CHECK` de não
> vazio, escrita na promoção como `normalizeChannel(canal)`.
> **Módulo que não enxerga:** Alterações, Impacto, Composição, DRE, Assistente.
> **Motivo:** `lib/comparison/src/series.ts` **re-deriva** o canal do rótulo por
> regex e **sem normalizar** — `substring(source_label from '^([A-Za-z][A-Za-z0-9_]*)_…')`.
> O comentário do arquivo ainda afirma que *"o canal não é coluna"* e que
> *"`snapshot` é congelado por trigger, de modo que uma coluna nova não poderia
> ser preenchida"*. A coluna existe desde a identidade canônica. O comentário é
> anterior a ela e nunca foi revisto — `lib/ingest/src/vigencia.ts` repete a
> mesma afirmação vencida.
> **Filtro/query responsável:** `series.ts::CHANNEL_PATTERN`, `channelSql`,
> `contextFilter`; e `engine.ts::findPreviousSnapshot`, que compara
> `channelOf(...)` em vez da coluna.
> **Comportamento correto esperado:** um canal só. Quem precisa do canal lê
> `snapshot.canal`.
> **Correção sugerida:** `channelSql` passa a ler a coluna. A derivação por
> rótulo continua existindo **só** na importação, que é onde o canal nasce.

**Reproduzido.** `TRANSFERENCIA_1_5_2026` e `Transferencia_1_6_2026` — o mesmo
canal, escrito em duas caixas:

```
2026-05-01 canal=TRANSFERENCIA  derivado=TRANSFERENCIA
2026-06-01 canal=TRANSFERENCIA  derivado=Transferencia      ← a coluna normaliza; o regex não

contextos:  "CAMACARI · Transferencia" || "CAMACARI · TRANSFERENCIA"   ← dois canais
Cobertura:  um canal, duas vigências                                    ← lê a coluna
Impacto:    2026-06-01                                                  ← vê UMA
```

Um rótulo com um acento, um espaço no lugar do sublinhado ou uma letra minúscula
faz o mesmo. Pior: como `resolveContext` sem pedido devolve **o contexto mais
recente**, importar uma vigência com o rótulo escrito de outro jeito faz o
Impacto trocar silenciosamente para uma visão de uma coluna, e o histórico
inteiro do canal antigo desaparece da tela.

---

### D3 · `entity_type_set` é descritivo no modelo e identidade na comparação

> **Dado existe em:** duas vigências consecutivas, mesma unidade, mesmo canal —
> a primeira só com carretas, a segunda com carretas e cavalos.
> **Módulo que não enxerga:** Alterações (Planilha) e tudo que depende de
> `change_set` — Parâmetros, Acompanhamento, Visão geral.
> **Motivo:** `findPreviousSnapshot` exige
> `eq(snapshotTable.entityTypeSet, target.entityTypeSet)`, e `computeChangeSet`
> **recusa** o par quando os dois diferem. Mas `entity_type_set` **cresce** por
> construção: `pipeline.ts:1576` faz a união dos tipos do arquivo com os
> herdados da revisão anterior, e o comentário do schema chama o campo de
> *"descritivo, não identificador… ele varia com as abas que o arquivo trouxe"*.
> As duas leituras não podem estar certas ao mesmo tempo.
> **Filtro/query responsável:** `lib/comparison/src/engine.ts:86` e `:142`.
> **Comportamento correto esperado:** a série é `(escopo, canal)`. A cobertura de
> equipamento é atributo da entrega, e a comparação deve saber lidar com uma
> ponta que cobre mais tipos que a outra — que é precisamente o que
> `ATTRIBUTE_ADDED`/`ENTITY_ADDED` existem para representar.
> **Correção sugerida:** tirar `entity_type_set` da identidade da série e passar
> a comparar **por componente de equipamento**, que é como `grouped.ts` já
> apresenta o resultado.

**Reproduzido.**

```
2026-01-01  set=CARRETA          ← só carretas
2026-02-01  set=CARRETA+CAVALO   ← carretas e cavalos

Vigências:  2                      ← vê as duas
Cobertura:  2                      ← vê as duas
Impacto:    2 colunas, 2 tipos     ← vê as duas
Alterações: findPrevious(fev) = NULL
            → 409 "é a primeira vigência da série; não há anterior com que comparar"
```

É a sequência que a Ambev produz **toda vez** que passa a entregar um
equipamento novo a partir de certa data.

---

### D4 · Oito definições de "série", e nenhuma é a mesma

Todas resolvem a mesma pergunta — *quais vigências se sucedem?* — e nenhuma
concorda com as outras. A revisão que produziu o complemento subiu a contagem de
cinco para oito: `coverage/descoberta.ts` tinha passado despercebida, e o
`bridge` de deploy guarda a nona, que é a identidade **anterior** à `0015` e
explica de onde as outras vieram.

A tabela completa — com campos usados, módulos consumidores, divergência
possível e definição correta proposta por linha — está em
**`docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte B**. O resumo:

| Onde | Chave |
|---|---|
| `series.ts::listContexts` / `contextFilter` | `(scope_hash, canal-regex)` |
| `series.ts::seriesKey` | `(scope_hash, canal-regex, entity_type_set)` |
| `engine.ts::findPreviousSnapshot` | `(source_system, scope_hash, entity_type_set, canal-regex)` + `effective_date <` |
| `engine.ts::computeChangeSet` (guardas) | `scope_hash` = , `entity_type_set` = , `canal-regex` = |
| `routes/changes.ts:139` (`/changes/latest`) | `(scope_hash, entity_type_set)` — **sem canal** |
| `ingest/chamados.ts:1544` (`valoresVigentes`) | `(scope_hash, entity_type_set)` — **sem canal** |
| `coverage/{observado,esperado,matriz}.ts` | `(dataset_family, scope_hash, canal-**coluna**)` |
| `coverage/descoberta.ts::janelaDosAtributos` | `(dataset_family)` — **sem escopo e sem canal** |
| *(escrita)* `snapshot.canonical_snapshot_key` | `(source_system, dataset_family, canal, effective_date, canonical_scope)` — **a correta** |

As duas "sem canal" e a "sem escopo" são as mais perigosas: com dois canais na
mesma unidade, `/changes/latest` pode escolher a série errada; o "valor anterior"
de um chamado pode ser buscado numa vigência de outro canal — um número
**declarado com procedência** e vindo do lugar errado; e o candidato a renomeação
do drill-down de Cobertura pode cruzar unidades.

> **Correção sugerida:** uma função só, exportada de um lugar só, e nenhuma
> consulta montando o predicado por conta própria. `series.ts` **já se declara**
> esse lugar (*"Nenhuma consulta de leitura deve montar esse predicado por conta
> própria"*) — a regra está escrita e é violada em oito pontos.

---

### D5 · Impacto e Alterações mostram um contexto, e não há como trocar

> **Dado existe em:** qualquer vigência de uma segunda unidade ou de um segundo
> canal.
> **Módulo que não enxerga:** Alterações (as três abas) e todas as telas que
> chamam `/changes/*` sem parâmetro.
> **Motivo:** `resolveContext` sem pedido devolve `contexts[0]` — o mais
> recente. As telas de Alterações/Impacto **nunca** mandam `scopeHash` nem
> `canal`. O componente que existiria para isso,
> `components/contexto/context-bar.tsx`, **não é usado em lugar nenhum** do
> aplicativo. Só Parâmetros passa contexto.
> **Filtro/query responsável:** `pages/alteracoes.tsx`,
> `components/changes/impacto-quinzenas.tsx` — nenhum parâmetro de contexto na
> query.
> **Comportamento correto esperado:** ou a tela oferece o seletor, ou diz qual
> contexto escolheu e que existem outros. A resposta já traz `context`; a tela
> não a usa.
> **Correção sugerida:** montar `ContextBar` em Alterações/Impacto/Composição/DRE
> e propagar `scopeHash`/`canal` na URL, como Parâmetros já faz. Depois de D1 e
> D2, os contextos passam a ser os certos.

---

### D6 · Uma frase para quatro estados diferentes em Impacto

`getQuinzenaMatrix` devolve `null` em quatro situações estruturalmente
distintas, e `routes/impacto.ts` traduz as quatro em
`404 "Nenhuma vigência importada ainda."`:

| Causa | Onde | O que é de verdade |
|---|---|---|
| `resolveContext` → `null` | `impacto.ts:360` | não há vigência nenhuma — **a frase está certa** |
| `entityTypes.length === 0` | `:363` | há vigência, e nenhuma declara equipamento |
| **`parameters.length === 0`** | `:384` | **há vigência e há fato; o dicionário não tem coluna numérica para aquele equipamento** |
| `periodRows.length === 0` | `:404` | há contexto e nenhuma vigência nele |

O terceiro é o caso desta auditoria em forma pura: dado importado, promovido,
visível em Cobertura e em Vigências, e o Impacto responde "nenhuma vigência
importada ainda". Ver Parte 6.

---

### D7 · A Visão geral conta o que nenhuma outra tela conta

`getOverview` (`lib/comparison/src/query.ts:474`) faz:

```sql
(SELECT count(*) FROM snapshot WHERE status <> 'SUPERSEDED') AS vigencias,
(SELECT count(*) FROM entity)                                AS ativos,
(SELECT count(*) FROM fact)                                  AS fatos,
(SELECT count(*) FROM attribute)                             AS atributos,
(SELECT min(effective_date) FROM snapshot)                   AS primeira_vigencia,
```

`vigencias` filtra `SUPERSEDED`; `fatos`, `ativos`, `atributos`,
`primeira_vigencia` e `ultima_vigencia` **não**, e nenhum deles filtra contexto.
Depois de uma revisão, o painel conta os fatos das duas versões. O número da
Visão geral e o da Cobertura passam a divergir sem que nada explique a
diferença — e é o primeiro número que alguém lê ao abrir o produto.

---

### D8 · `import_decision`: a resposta existe e nenhuma tela a mostra

A tabela foi criada exatamente para responder *"por que esse arquivo não
entrou?"* sem ler log, e o comentário dela nomeia o caso: *"A recusa por
duplicata é o caso que mais precisa disso: ela é silenciosa por natureza… e sem
registro o operador só vê que o número dele não apareceu."*

Ela é escrita pelo pipeline e **lida por ninguém**. Nenhuma rota, nenhuma tela.
Importações mostra `import_run.failure_reason`, que é outro campo e não cobre a
decisão de duplicata de dados nem a de revisão criada.

---

### D9 · `snapshot_merge`: idem

Criada para responder *"onde foram parar os dados da vigência X"* quando uma
fusão a tirou de cena. Escrita pelo pipeline, **lida por ninguém**. Quem procurar
uma vigência que foi fundida não encontra, e o registro que explicaria o
desaparecimento está no banco, mudo.

---

### D10 · `attribute_alias` é a autoridade declarada e não é consultada

O modelo separa `attribute.source_name` (o nome literal da coluna) de
`attribute_alias` (as outras formas em que o mesmo atributo aparece). É a
autoridade de normalização de nome do produto.

`resolveAttributeCodes` (`ingest/chamados.ts:1608`), que liga o parâmetro de um
chamado ao dicionário, indexa **`source_name`, `display_name` e o código sem
prefixo** — e não `attribute_alias`. Um chamado que cite o parâmetro pelo nome
registrado como alias fica com `attribute_code = null`: o chamado continua
existindo e deixa de ser cruzável com a Planilha, com a Composição e com o
Impacto.

Hoje é **latente**: no export real há 138 aliases para 138 atributos, um por
atributo, iguais ao `source_name`. Dispara na primeira vez que a origem renomear
uma coluna. Único consumidor de `attribute_alias` no produto inteiro:
`lib/assistant/src/parametros.ts:130`.

---

### D11 · `classifyEntityType` pode absorver um equipamento novo em um existente

A identidade de uma aba é decidida pela sobreposição das colunas dela com o
dicionário (`LIMIAR_RECONHECIMENTO = 0.75`, `MARGEM_MINIMA = 0.2`), e as seis
colunas de escopo (`Unidade - CNPJ`, `Operador - Nome`, `chassi`, …) são comuns
a **todo** equipamento. Numa aba estreita elas dominam a nota.

Medido ao montar os cenários desta auditoria: uma aba `cavalos` com 6 colunas de
escopo e 2 colunas próprias pontua `6/8 = 0,75` contra o dicionário de carreta —
passa o limiar, e o cavalo entra no canônico **como carreta**, sem pendência e
sem aviso. No export real a margem é confortável (63 colunas de carreta contra
75 de cavalo, 38 em comum), e por isso o defeito não aparece lá. A folga vem do
tamanho do arquivo, não da regra.

> **Correção sugerida:** excluir as colunas de escopo da pontuação, como já se
> faz com `vigencia` e `placa` (`COLUNAS_DE_GRAO`) e pelo mesmo motivo — elas
> não descrevem o equipamento.

---

### D12 · DRE e Composição são fechadas em `CAVALO` e `CARRETA`

`entity_type` é `text` no schema com uma justificativa explícita: *"a Freightec
pode começar a exportar um terceiro tipo de equipamento sem uma migration"*. O
pipeline honra isso — `datasetFamilyFor` põe um DOLLY novo na mesma família de
propósito.

A jusante, `lib/composition/src/regras.ts` (`REGRAS`) e `lib/dre/src/plano.ts`
(`EscopoApuravel`, `FonteDoComponente`) enumeram `CAVALO` e `CARRETA` em tipo
TypeScript. Um terceiro equipamento entra no canônico, aparece em Cobertura, em
Vigências e em Impacto, e **não existe** em Composição nem em DRE.

Isto pode ser a decisão certa — pode não haver regra de composição para um DOLLY.
Mas hoje a diferença entre *"não se aplica"* e *"não há dado"* não é dita em
lugar nenhum. É o que a Parte 5 formaliza.

---

## Parte 4 — A fonte única de verdade

### 4.1 O que está duplicado

| Regra | Definições encontradas |
|---|---|
| **quais vigências existem** | `listComparableSnapshots` (sem contexto) · `vigenciasObservadas` (recorte de cobertura) · `listPeriods` · `periodRows` do Impacto · `periodRows` do Panorama · a lista de `grouped.ts` |
| **quais contextos existem** | `listContexts` (`scope_hash` + regex) · `recortes` de `matriz.ts` (`dataset_family` + `scope_hash` + coluna `canal`) |
| **qual é o canal** | `snapshot.canal` (coluna) · `channelSql`/`channelOf` (regex, sem normalizar) |
| **qual é a série comparável** | oito definições de leitura (D4) |
| **quais equipamentos existem** | `entity_type_set` (Impacto, Alterações) · `snapshot_entity_type` (Cobertura) · `entity.entity_type` (Composição, DRE) · `REGRAS`/`plano.ts` (fixos) |
| **quais atributos existem** | `attribute` por `entity_type` (Impacto) · `snapshot_attribute` (Cobertura) · `COMPOSITIONS` (Composição) · `plano.ts` (DRE) |
| **quais estados de importação valem** | `status <> 'SUPERSEDED'` repetido **em ~60 consultas SQL escritas à mão** |

### 4.2 A proposta

Um módulo de **disponibilidade** — a autoridade única sobre *o que existe*, do
mesmo jeito que `@workspace/coverage` já é a autoridade única sobre *quanto do
esperado nós temos*. Nomes ilustrativos:

```
lib/availability  (ou lib/comparison/src/disponibilidade.ts, promovendo series.ts)

  contextosDisponiveis()            → um por (canonical_scope, canal). D1 e D2 morrem aqui.
  resolverContexto(pedido?)         → o mesmo resolveContext, sobre a chave certa
  filtroDeContexto(alias, contexto) → o único predicado SQL de contexto
  filtroDeVigenciaViva(alias)       → o único lugar onde `<> 'SUPERSEDED'` é escrito
  vigenciasDisponiveis(contexto)    → o censo. Todo módulo mede-se contra ele.
  serieDe(snapshot)                 → (escopo, canal). Sem entity_type_set. D3 morre aqui.
  equipamentosDisponiveis(contexto) → de `snapshot_entity_type`, não do texto do rótulo
  atributosDisponiveis(contexto, equipamento)
  fontesImportadas()                → o que cada porta entregou, por origem
```

Três regras de uso, e todas já existem escritas no repositório — o que falta é
cumpri-las:

1. **Nenhuma consulta de leitura monta o predicado de contexto por conta
   própria.** Está em `series.ts`, violada em oito pontos (D4).
2. **Nenhuma rota calcula disponibilidade.** Está em `routes/coverage.ts`
   (*"Nenhuma rota deste arquivo calcula cobertura"*) e funciona bem lá.
3. **`status <> 'SUPERSEDED'` sai das consultas** e vira uma função. Sessenta
   cópias de um predicado são sessenta chances de esquecer uma — e `getOverview`
   já esqueceu cinco (D7).

O caminho de migração é aditivo: o módulo nasce com as funções corretas, os
consumidores migram um por vez, e cada migração é verificável pelo teste de
propagação — que compara o que o módulo enxerga com o censo do canônico.

---

## Parte 5 — Contrato de elegibilidade

Quatro estados, e a diferença entre eles é o ponto:

| Estado | Significado | O que a tela deve dizer |
|---|---|---|
| **EXISTE** | o dado está no canônico | — |
| **ELEGÍVEL** | tem significado neste módulo | mostra |
| **CALCULÁVEL** | tem significado **e** os pré-requisitos do cálculo | mostra com número |
| **NÃO SE APLICA** | não tem significado aqui | diz que não se aplica — **nunca** "sem dados" |

### 5.1 As regras, derivadas do domínio e da implementação

```
vigência (snapshot + fact)
├── Importações .......... SIM   — é o registro da entrega
├── Vigências ............ SIM   — é a lista do que existe
├── Cobertura ............ SIM   — é o denominador da medição
├── Alterações·Planilha .. SIM, se houver vigência anterior na MESMA SÉRIE
│                                 série = (escopo canônico, canal). Sem anterior:
│                                 "primeira vigência da série", não "sem dados"
├── Alterações·Chamados .. NÃO, como objeto — SIM como fonte do "antes" de um chamado
├── Impacto .............. SIM, se o equipamento tiver atributo numérico no dicionário
├── Comparar ............. SIM
├── Composição ........... SIM, se o equipamento tiver regra de composição declarada
│                                 hoje: CAVALO, CARRETA. Outro: NÃO SE APLICA
├── DRE .................. SIM, se o atributo for fonte declarada de um componente
│                                 E a semântica estiver CONFIRMED. Senão: motivo nomeado
├── Balanço de massa ..... SIM, por importação
└── Curadoria ............ SIM, enquanto a semântica não estiver confirmada

atributo
├── Cobertura ............ SIM  — sempre; presença é o que ela mede
├── Impacto .............. SIM se NUMERIC. Não numérico: NÃO SE APLICA
├── Alterações ........... SIM  — qualquer tipo produz `change`
├── Impacto financeiro ... SIM se is_monetary E aggregation=SUM E CONFIRMED
│                                 senão EXISTE + ELEGÍVEL, não CALCULÁVEL —
│                                 e a tela já sabe dizer isso (`somavel`)
├── DRE .................. SIM se for `fonte` de um componente do plano
└── Composição ........... SIM se estiver em COMPOSITIONS ou for parcela declarada

equipamento (entity_type)
├── Importações/Cobertura/Vigências/Balanço ... SIM — qualquer tipo, sempre
├── Alterações/Impacto ....................... SIM — qualquer tipo com fato
└── Composição/DRE ........................... SIM só com regra declarada
                                                sem regra: NÃO SE APLICA (não "sem dados")

chamado (ticket + ticket_change)
├── Alterações·Chamados .. SIM   — é a casa dele
├── Alterações·Planilha .. NÃO   — não é diferença apurada entre duas vigências
├── Impacto (quinzenas) .. NÃO   — aquela leitura é estado, não movimento pedido
├── Impacto do chamado ... SIM se statusBucket=ATENDIDO E houver "antes" numérico
│                                 senão NOT_CALCULABLE **com motivo escrito**
├── Cobertura ............ NÃO   — não é entrega de vigência; inflaria o denominador
├── Vigências ............ NÃO
├── Composição/DRE ....... NÃO   — nenhum dos dois soma pedido com apurado
└── Curadoria ............ INDIRETO — um parâmetro citado e não reconhecido é
                                      sinal para o dicionário, não linha de fila

documento do Book
└── Book do Operador ..... SIM, e só. Nunca alimenta número.
```

### 5.2 Onde o contrato hoje é violado

| Regra | Violação |
|---|---|
| série = (escopo canônico, canal) | oito definições concorrentes (D3, D4) |
| um contexto por realidade de negócio | `scope_hash` e o regex de canal partem contextos (D1, D2) |
| "não se aplica" ≠ "sem dados" | Impacto responde "nenhuma vigência importada" quando falta atributo (D6) |
| chamado não entra em cobertura/impacto | **respeitado** — verificado por teste |
| chamado não vira `change` | **respeitado** — verificado por teste |
| equipamento sem regra = não se aplica | Composição/DRE simplesmente não mostram, sem dizer por quê (D12) |

---

## Parte 6 — Estados vazios

### 6.1 O que já está certo, e serve de modelo

A **DRE** já tem vocabulário fechado para ausência (`lib/dre/src/plano.ts`),
com rótulo por motivo: `SEM_COLUNA_NA_FONTE`, `COLUNA_SEM_DADO`,
`SEMANTICA_NAO_CONFIRMADA`, `BASE_OPERACIONAL_AUSENTE`,
`GRANDEZA_DE_AQUISICAO`. O **Impacto** já distingue quatro estados de célula
(`VALOR`, `SEM_VALOR`, `FORA_DA_FROTA`, `NAO_ENTREGUE`) e a frase *"Nenhum ativo
mexeu neste parâmetro no período — e isso é uma resposta, não uma tabela
vazia"*. A **Cobertura** já separa vigência incompleta de vigência ausente.

O problema não é falta de vocabulário. É que os três construíram o seu, e a
fronteira entre módulos não tem nenhum.

### 6.2 Os estados que faltam, e os casos reais que os pedem

| Estado | Caso real medido | Onde hoje aparece errado |
|---|---|---|
| **Nenhum dado importado** | banco vazio | correto onde já é usado |
| **Nenhum dado aplicável a esta análise** | equipamento sem atributo numérico no dicionário | Impacto: `404 "Nenhuma vigência importada ainda."` (D6) |
| **Nenhuma alteração encontrada** | duas vigências idênticas | correto |
| **Nenhuma vigência anterior disponível** | primeira da série | correto na frase, **errado no gatilho** — hoje dispara também quando a série se partiu por `entity_type_set` (D3) |
| **Dados existentes, mas impacto não calculável** | atributo `PRESUMED`, ou chamado ainda aberto | correto — `somavel`, `NOT_CALCULABLE` com motivo |
| **Filtros atuais não retornaram resultados** | filtro de materialidade/classe na lista | correto |
| **Este módulo não se aplica a este equipamento** | terceiro `entity_type` em Composição/DRE | **não existe** (D12) |
| **Você está vendo apenas um contexto; existem outros** | segunda unidade ou segundo canal | **não existe** — a tela nem sabe que escolheu (D5) |
| **Esta vigência foi fundida em outra** | revisão parcial | **não existe** — `snapshot_merge` não é lido (D9) |
| **Este arquivo foi recusado, e o motivo é este** | duplicata de dados | **não existe** na tela — `import_decision` não é lido (D8) |

**Não implementar os textos ainda.** Cada estado acima precisa do gatilho certo
antes da frase certa: escrever "Nenhum dado aplicável" no lugar onde hoje o
gatilho é `parameters.length === 0` só troca uma frase errada por outra enquanto
D6 não separar as quatro causas.

---

## Parte 7 — Testes de propagação

### 7.1 O que foi implementado

**`artifacts/api-server/src/routes/__tests__/propagacao-vigencia.test.ts`** —
13 provas, sobre o export real, todas verdes. Prova o fluxo completo das duas
portas:

*Porta 1 — vigência:* existe no canônico (`CLOSED`, com fato e com agregado por
equipamento) → aparece na lista de vigências, **com o mesmo conjunto que o
canônico tem** → aparece no seletor de contexto, e a soma dos períodos de todos
os contextos é exatamente o número de vigências → aparece em Cobertura, todas,
sem `incompleto` → fica disponível para Alterações, e **toda vigência tem
anterior menos a primeira** → fica disponível para comparação, com alterações
apuradas → aparece em Impacto, **uma coluna por vigência do contexto** → e todo
equipamento com fato é escolhível lá, com parâmetro.

*Porta 2 — chamado:* aparece na aba Chamados → liga-se ao dicionário e busca o
"antes" na vigência que o próprio chamado nomeia → o impacto só é afirmado no
chamado atendido, e o aberto fica sem número **com motivo escrito** → **não**
vira `change` → **não** entra em Cobertura nem em Impacto.

A régua é sempre a mesma e vale a pena repetir: **o canônico é o censo**. Um
módulo pode mostrar menos, desde que o recorte seja declarado e verificável.
Onde o recorte é o mesmo, o conjunto tem de ser o mesmo. É exatamente essa
comparação que nenhum teste de módulo faz — o teste da Cobertura carrega a
Cobertura e afirma sobre o que ela vê; se o Impacto vir outro conjunto, os dois
passam.

**`artifacts/api-server/src/routes/__tests__/propagacao-divergencias.test.ts`** —
9 provas, com planilhas sintéticas, todas verdes. Cada divergência tem dois
testes:

- um `it` normal que prova que **o dado existe** e que os módulos que o enxergam
  continuam enxergando;
- um `it.fails` que afirma **o comportamento correto** e está marcado como ainda
  não verdadeiro. Ele passa enquanto o defeito existir e **vira vermelho no dia
  em que a correção entrar** — que é quando alguém vem aqui e apaga o `.fails`.

`it.fails` e não `it.skip` porque um teste pulado não avisa nada: continuaria
pulado depois da correção, e a divergência voltaria a ficar sem dono. O
mecanismo foi verificado: com a invariante satisfeita, o Vitest responde
`Error: Expect test to fail`.

**`artifacts/api-server/src/routes/__tests__/fronteira-do-book.test.ts`** —
12 provas, sem banco, todas verdes. Trancam a decisão da Parte 1.3 pelos **dois
lados**, que é o que uma fronteira exige:

- que o Book **continue recebendo arquivo** — PDF, XLSX, DOCX e a regra escrita
  à mão. É a metade que impede a porta de ser fechada por engano junto com as
  duas indevidas, com que ela se parece só na superfície ("também recebe base64");
- que **nenhum motor de cálculo leia `book_entry`** — varredura de código-fonte
  sobre `comparison`, `coverage`, `composition`, `dre`, `balance`, `simulation`,
  `curation` e `ingest`. É a única forma de provar uma ausência, e por isso vem
  com um caso de controle: `lib/knowledge` **cita** o Book, a varredura o
  encontra, e uma asserção de ausência que não sabe achar presença não provaria
  nada. Verificado plantando uma referência num motor: a prova acusa.

### 7.2 O que falta escrever

| Prova | Depende de |
|---|---|
| a Visão geral conta os mesmos fatos que a Cobertura | correção de D7 |
| a segunda unidade é alcançável a partir da tela | correção de D5 |
| Impacto responde "não aplicável" quando falta atributo, e não "sem vigência" | correção de D6 |
| o motivo da recusa de um arquivo chega à tela | leitura de `import_decision` (D8) |
| a vigência fundida é rastreável | leitura de `snapshot_merge` (D9) |
| um chamado que cite o parâmetro por um alias liga ao dicionário | correção de D10 |
| uma aba estreita de equipamento novo não é absorvida | correção de D11 |
| um terceiro equipamento diz "não se aplica" em DRE/Composição | contrato da Parte 5 |

---

## Parte 8 — O resultado, nos dez pontos pedidos

**1. As duas portas reais.**
`POST /imports` + `POST /imports/:id/promote` (`routes/imports.ts`, tela
Importações) e `POST /ticket-imports` (`routes/tickets.ts`, aba Chamados). As
duas funcionam, as duas têm exclusão auditada, e `lib/ingest/src/pipeline.ts` é
o **único** escritor do canônico.

**2. Portas indevidas, e o que não é porta.**
Porta indevida, uma só: `POST /imports` e `POST /imports/:id/promote` em
`routes/overview.ts` — pipeline-sombra completo, com validação mais fraca,
inalcançável apenas por ordem de montagem do router.

`GET /fleet-analysis/*` **não é porta**: ela não grava. É uma *fonte paralela de
leitura indevida* — lê `.xlsx` do disco, está no menu e hoje devolve tela vazia.
A funcionalidade se preserva e migra para o canônico; ver o complemento.

`POST /book/entries` **não** entra nesta lista: é a porta `BOOK`, documental e
declarada, e importar arquivo por ela continua sendo o comportamento correto
(Parte 1.3). Duas portas para dado que vira número; uma terceira para a regra
que o sustenta.

**3. Mapa de módulos consumidores.** Parte 2.1 — dezoito módulos, com tabelas,
filtros, estados aceitos e condição de vazio de cada um.

**4. Matriz fonte × módulo.** Parte 2.2.

**5. Inconsistências.** Parte 3 — doze, três reproduzidas em banco.

**6. Módulos que hoje podem dar falso "sem dados".**

| Módulo | Quando | Achado |
|---|---|---|
| **Análise de frota** | **sempre, hoje** | INDEVIDA-1 |
| **Impacto** | segunda unidade; canal escrito de outra forma; equipamento sem atributo numérico | D1, D2, D6 |
| **Alterações · Planilha** | entrega parcial; unidade/canal partidos | D1, D2, D3 |
| **Composição, DRE, Parâmetros, Acompanhamento** | mesmos recortes de contexto | D1, D2, D5 |
| **Importações** | arquivo recusado por duplicata de dados | D8 |
| **Vigências** | vigência fundida por revisão parcial | D9 |
| **Chamados** | parâmetro citado por alias | D10 |

**7. Regras duplicadas de disponibilidade.** Parte 4.1 — sete regras, com
destaque para as oito definições de série e as duas de canal.

**8. Autoridade central proposta.** Parte 4.2 — um módulo de disponibilidade
com `contextosDisponiveis`, `vigenciasDisponiveis`, `serieDe`,
`equipamentosDisponiveis`, `atributosDisponiveis`, `filtroDeVigenciaViva`, e três
regras de uso que já estão escritas no repositório e não são cumpridas.

**9. Testes necessários.** Parte 7 — 34 provas implementadas (13 de propagação
sobre o export real, 9 de divergência com dado sintético, 12 na fronteira do
Book), 8 especificadas para acompanhar cada correção.

**10. Lista priorizada de correções.**

| # | Correção | Achado | Efeito | Risco | Toca dado histórico? |
|---|---|---|---|---|---|
| **P0** | Mapear a migração de `Análise de frota` para o canônico — **sem remover a funcionalidade** | PARALELA-1 | a tela volta a ter dado, e com rastro | baixo | não |
| **P0** | Remover as rotas de escrita de `overview.ts` | INDEVIDA-2 | fecha o pipeline-sombra | **nenhum** — código morto | não |
| **P1** | Contexto por `canonical_scope` | D1 | uma unidade é uma unidade | médio | não — só leitura |
| **P1** | Canal lido da coluna, em todo lugar | D2 | um canal é um canal | médio | não — só leitura |
| **P1** | Tirar `entity_type_set` da identidade da série | D3 | entrega parcial deixa de partir a série | médio | não — só leitura |
| **P2** | Módulo único de disponibilidade; migrar as oito definições | D4 | módulos param de discordar | médio | não |
| **P2** | Separar as quatro causas de vazio do Impacto | D6 | "não aplicável" ≠ "sem dados" | baixo | não |
| **P2** | `ContextBar` nas telas que recortam por contexto | D5 | a segunda unidade fica alcançável | baixo | não |
| **P3** | `getOverview` filtra `SUPERSEDED` e contexto | D7 | o painel para de divergir da Cobertura | baixo | não |
| **P3** | Ler `import_decision` em Importações | D8 | "por que meu arquivo não apareceu" ganha resposta | baixo | não |
| **P3** | Ler `snapshot_merge` em Vigências | D9 | a vigência fundida fica rastreável | baixo | não |
| **P3** | `attribute_alias` no índice de chamados | D10 | chamado por alias liga ao dicionário | baixo | não |
| **P3** | Tirar colunas de escopo da pontuação de identidade | D11 | equipamento novo não é absorvido | baixo | **não retroage** — vale para importações futuras |
| **P4** | Contrato de elegibilidade explícito em Composição/DRE | D12 | "não se aplica" deixa de parecer "sem dado" | baixo | não |
| ~~P4~~ **feito** | Fronteira do Book presa por teste, pelos dois lados | — | a porta documental fica explícita e protegida | — | não |

**Nenhuma correção desta lista altera dado histórico nem a semântica do
canônico.** Todas as de P1 e P2 são mudanças de *leitura*: o que muda é quem o
produto consegue enxergar, não o que está gravado. É por isso que a ordem
proposta é essa — as três de P1 são as que produzem falso "sem dados" hoje, e
podem ser feitas uma de cada vez, cada uma com o seu `it.fails` virando
vermelho no fim.
