# FreightCheck — Entrega F0 + F1

> Escopo implementado: **fundação (F0)** e **ingestão (F1)**, com os 10 ajustes
> aprovados incorporados. Motor financeiro, waterfall, IA, alertas, fórmulas e
> F2+ **não** foram implementados, conforme instruído.
>
> Nomenclatura: **Freightec** = sistema da Ambev (fonte). **FreightCheck** = este produto.

---

## 1. Ajustes aprovados — onde cada um foi aplicado

| # | Ajuste | Onde |
|---|---|---|
| 1 | Baseline de F3 é 3.202, não 2.812 | `docs/ARQUITETURA.md` §2 e §11 corrigidos; a soma por transição virou contrato de regressão documentado |
| 2 | `entity` com ID interno estável; `entity_identifier` com histórico | `lib/db/src/schema/canonical.ts` — `entity` não tem coluna de placa nem chassi; `entity_identifier` tem `identifier_type`, `effective_from/until`, `is_current` |
| 3 | `source_file` ≠ `import_run` ≠ `snapshot` | Três tabelas distintas; um arquivo gera 9 snapshots (testado) |
| 4 | Chave de negócio além do SHA-256 | `snapshot_business_key_uq` e `snapshot_business_key_live_uq` sobre `(source_system, source_label, scope_hash, entity_type_set[, revision])`; revisão explícita via `promote(..., { onExistingSnapshot: "NEW_REVISION" })` |
| 5 | Sem particionamento agora | `fact` não é particionada. Índices criados com `snapshot_id` à frente, prontos para particionar quando a medição justificar |
| 6 | SOURCE / FLEET / CURATION_CHANGE | Categorização documentada em §6 abaixo; **não implementada** (é F3). O que F1 garante é a separação estrutural que a torna possível |
| 7 | ATTRIBUTE_REMOVED / VALUE_MISSING / SENTINEL / ZERO | `fact.null_reason` + `snapshot_attribute.present_in_layout`; zero real fica `is_null = false` |
| 8 | `null_reason` preservado | Coluna `text` livre (não enum) — novos estados não exigem migration |
| 9 | Nada criado só para evitar migration futura | `formula`, `formula_dependency`, `taxonomy_node`, `change*`, `impact`, `alert`, `explanation` **não** foram criados |
| 10 | Invariantes arquiteturais | Impostas por trigger de banco, não por convenção — ver §5 |

---

## 2. Schema final (18 tabelas)

### RAW — imutável
| Tabela | Papel |
|---|---|
| `source_file` | Arquivo recebido. SHA-256 único, caminho do original preservado |
| `import_run` | Tentativa de processamento. Tentativas recusadas/falhas ficam registradas |
| `raw_sheet` | Aba, com `role` (SOURCE/PIVOT/UNKNOWN) e `role_reason` textual |
| `raw_row` | Linha física, 1-based |
| `raw_cell` | Célula: coluna, letra, cabeçalho literal, valor textual, tipo original, texto formatado |

### STAGING — tipado, validado, descartável
| Tabela | Papel |
|---|---|
| `column_mapping` | Coluna → atributo, com status MAPPED/NEW/AMBIGUOUS/IGNORED e nota |
| `staged_fact` | Fato candidato, ainda chaveado pelo vocabulário da fonte |
| `validation_issue` | Tudo que não deu para fazer com confiança. Nada é engolido |
| `sentinel_rule` | Sentinelas **confirmadas**. Vazia por padrão |

### CANÔNICO — fonte da verdade
| Tabela | Papel |
|---|---|
| `entity` | Ativo remunerado. Identidade = UUID interno, e nada mais |
| `entity_identifier` | PLACA, CHASSI e futuros, com vigência e `is_current` |
| `scope` / `snapshot_scope` | Unidade, operador, regional — multi-valor desde já |
| `snapshot` | Uma vigência. Label literal + data derivada + revisão |
| `attribute` | Identidade estável da variável + semântica declarada |
| `attribute_alias` | Normalização sem perder a origem |
| `snapshot_attribute` | Que atributos o layout carregava naquela vigência |
| `fact` | O grão: `(snapshot, entity, attribute) → valor` |

### Grão

```sql
fact
  UNIQUE (snapshot_id, entity_id, attribute_id)
  CHECK  (exatamente uma value_* preenchida OU is_null)
  CHECK  (is_null = true  ⟺ null_reason IS NOT NULL)
  raw_cell_id NOT NULL          -- rastreabilidade obrigatória
  value_numeric NUMERIC(18,6)   -- nunca float
```

Índices em `fact` (todos com `snapshot_id` à frente, prontos para particionamento):

- `fact_grain_uq (snapshot_id, entity_id, attribute_id)`
- `fact_snapshot_attribute_idx (snapshot_id, attribute_id, entity_id)` — "esta variável na frota inteira"
- `fact_snapshot_entity_idx (snapshot_id, entity_id)` — "tudo deste ativo"
- `fact_entity_attribute_idx (entity_id, attribute_id)` — histórico de uma variável num ativo
- `fact_raw_cell_idx (raw_cell_id)` — rastreabilidade reversa

---

## 3. Migrations

Versionadas, sem `drizzle push`. Os scripts `push` e `push-force` foram
**removidos** do `package.json` para que o atalho não exista.

| Arquivo | Conteúdo |
|---|---|
| `0000_freightcheck_foundation.sql` | 18 tabelas, 7 enums, índices, CHECKs |
| `0001_immutability_guards.sql` | Funções e triggers das invariantes |

Aplicação: `DATABASE_URL=... pnpm --filter @workspace/db run migrate`

---

## 4. Pipeline de ingestão (F1)

Cinco passos explícitos. A decisão humana fica entre o 4 e o 5.

```
receiveFile()   SHA-256, registra source_file + import_run
captureRaw()    workbook → RAW, célula a célula, com tipo original
stage()         tipagem, validação, column_mapping, staged_fact, issues
preview()       relatório; marca PREVIEWED  ← obrigatório
promote()       CANÔNICO, em transação única; snapshot fecha no fim
```

`promote()` recusa qualquer run que não esteja `PREVIEWED`. Os fatos são
inseridos enquanto o snapshot está `DRAFT`; ele é fechado por último — e a
partir daí o próprio banco recusa escrita.

### Decisões de leitura, todas registradas

- **Classificação de aba por forma, não por nome.** Uma aba é SOURCE se a
  primeira linha tem as colunas de grão (`Vigencia` + `Placa`) e ≥80% dos
  cabeçalhos preenchidos. O motivo fica em `raw_sheet.role_reason`.
- **Pivôs entram em RAW** (são evidência) e não geram nenhum fato.
- **Células ausentes são materializadas** nas abas SOURCE, para que
  VALUE_MISSING tenha uma coordenada real para apontar.
- **`Vigencia` e `Placa` não viram fatos** — viram snapshot e identidade.
  Registrado como `column_mapping.status = IGNORED` com nota.

---

## 5. Invariantes — impostas pelo banco

Os testes atacam essas garantias por SQL cru, contornando a aplicação: o que a
aplicação pode ser convencida a fazer, um script solto também pode.

| Invariante | Mecanismo |
|---|---|
| RAW é imutável | Triggers `BEFORE UPDATE OR DELETE` em `source_file`, `raw_sheet`, `raw_row`, `raw_cell` |
| Snapshot fechado é imutável | Trigger em `snapshot`: só a transição CLOSED → SUPERSEDED passa, e SUPERSEDED é terminal |
| Fatos de snapshot fechado são imutáveis | Trigger em `fact` para INSERT, UPDATE e DELETE |
| Todo número é rastreável até a célula | `fact.raw_cell_id NOT NULL` + FK |
| IA nunca produz valor financeiro | Não há IA em F0/F1 |
| Semântica não confirmada não entra em cálculo | `attribute.semantics_status` nasce `UNKNOWN`; F1 nunca promove a `CONFIRMED` |
| NUMERIC, nunca float | `NUMERIC(18,6)`; teste varre o `information_schema` e exige zero colunas `real`/`double precision` |

---

## 6. Categorias de mudança (§6 do pedido) — desenho, sem implementação

F3 vai gravar mudanças em três categorias que **nunca** podem se misturar:

| Categoria | Origem | Exemplo |
|---|---|---|
| `SOURCE_CHANGE` | O dado que a Ambev entregou mudou | `ipvaLicenciamento` 11.089 → 4.096 |
| `FLEET_CHANGE` | Entrada, saída ou vínculo de entidade | −9 carretas; troca de `Placa Carreta` |
| `CURATION_CHANGE` | Alteração feita **dentro do FreightCheck** | reclassificar um custo de CF para CV; confirmar uma unidade |

O que F1 já garante para que isso seja possível: taxonomia, unidade, agregação
e semântica moram em `attribute` (nosso lado), enquanto valor e layout moram em
`fact` e `snapshot_attribute` (lado da Ambev). Uma alteração de curadoria nunca
toca um `fact`, então nunca poderá aparecer como se a Ambev tivesse mexido na
remuneração.

---

## 7. Testes — 63 passando, 6 arquivos

`pnpm --filter @workspace/ingest run test`

| Arquivo | Testes | Cobre |
|---|--:|---|
| `excel-dates.test.ts` | 8 | Serial Excel → data, bug do ano 1900, fração de dia, `dataFimContrato` real |
| `vigencia.test.ts` | 5 | Label literal, derivação D_M_AAAA, as 9 vigências reais, recusa de formato desconhecido e de data impossível |
| `values.test.ts` | 11 | Zero × ausência, as 4 naturezas de ausência, sentinelas nunca adivinhadas, timestamp não truncado, normalização numérica |
| `workbook.test.ts` | 7 | Slug de camelCase e acrônimos, colunas parecidas que não podem colidir, classificação de aba por forma |
| `ingest.test.ts` | 21 | Aceite ponta a ponta contra o arquivo real |
| `immutability.test.ts` | 11 | Invariantes atacadas por SQL cru, revisão de vigência, ausência de float |

Cada arquivo provisiona o próprio banco a partir das **migrations versionadas**.
Se uma migration quebrar, os testes não rodam — que é o objetivo.

Os testes de invariante atacam o banco **por SQL cru**, contornando a
aplicação: o que a aplicação pode ser convencida a fazer, um script solto
também pode.

---

## 8. Relatório da importação do arquivo real

`Remuneração_Equipamento_Análise_FT_1786365886714.xlsx`
SHA-256 `6d03ad77ff2142a0e517335d5b923e9abf5f9b38c28ca140f4cf58faae746fca`

### Abas reconhecidas

| Papel | Aba | Dimensão | Motivo registrado |
|---|---|---|---|
| SOURCE | `carretas` | 658 × 65 | primeira linha tem `vigencia` + `placa`, 100% dos cabeçalhos preenchidos |
| SOURCE | `cavalos` | 559 × 77 | idem |
| PIVOT | `Quantidade` | 45 × 11 | primeira linha não tem as colunas de grão |
| PIVOT | `Análise Carreta` | 103 × 11 | idem |
| PIVOT | `Análise Cavalo` | 84 × 10 | idem |

### Vigências → 9 snapshots

| Label (literal) | Data derivada | Ativos | Fatos |
|---|---|--:|--:|
| `EMPURRADA_2_12_2025` | 2025-12-02 | 133 | 9.099 |
| `EMPURRADA_2_1_2026` | 2026-01-02 | 133 | 9.099 |
| `EMPURRADA_2_2_2026` | 2026-02-02 | 137 | 9.375 |
| `EMPURRADA_2_3_2026` | 2026-03-02 | 140 | 9.588 |
| `EMPURRADA_2_4_2026` | 2026-04-02 | 140 | 9.588 |
| `EMPURRADA_2_5_2026` | 2026-05-02 | 133 | 9.123 |
| `EMPURRADA_2_6_2026` | 2026-06-02 | 133 | 9.123 |
| `EMPURRADA_2_7_2026` | 2026-07-02 | 133 | 9.123 |
| `EMPURRADA_1_8_2026` | 2026-08-01 | 133 | 9.123 |
| **Total** | | **1.215** | **83.241** |

Os 1.215 ativos-vigência batem com o baseline (657 carretas + 558 cavalos).

### Prova de rastreabilidade

```
QYQ6A80 · cavalo.ipva_licenciamento · EMPURRADA_2_12_2025
valor canônico ...... 11089.380000
origem .............. aba "cavalos", linha 2, coluna AU ("ipvaLicenciamento")
valor original ...... 11089.38  (tipo SheetJS "n")
```

---

## 9. Contagem RAW / STAGING / CANÔNICO

| Camada | Tabela | Registros |
|---|---|--:|
| RAW | `source_file` | 1 |
| RAW | `import_run` | 2 (1 promovido + 1 recusado por duplicidade) |
| RAW | `raw_sheet` | 5 |
| RAW | `raw_row` | 1.449 |
| RAW | `raw_cell` | 88.106 |
| STAGING | `staged_fact` | 83.241 |
| STAGING | `validation_issue` | 2.952 |
| STAGING | `column_mapping` | 142 |
| CANÔNICO | `snapshot` | 9 |
| CANÔNICO | `entity` | 144 |
| CANÔNICO | `entity_identifier` | 286 (144 PLACA + 142 CHASSI) |
| CANÔNICO | `attribute` | 138 (todos `UNKNOWN`) |
| CANÔNICO | `scope` | 3 |
| CANÔNICO | `fact` | 83.241 |

**Ausência × zero:** 6.075 `EMPTY` · 1.301 `VALUE_MISSING` · **11.580 zeros econômicos reais**
(mantidos como número, não como null).

**Erros de linha: 0. Linhas rejeitadas: 0.** Todas as 1.215 linhas entraram.

---

## 10. Ambiguidades encontradas

| Código | Sev. | Qtd. | O que é |
|---|---|--:|---|
| `DATE_WITH_TIME_COMPONENT` | WARNING | 1.711 | A coluna `data` traz hora (12:00:00, 23:59:59) e a hora distingue valores. Truncar para data fundiria fatos diferentes; gravado como ISO-8601 sem perda |
| `AMBIGUOUS_DATE_SERIAL` | WARNING | 704 | `dataFimContrato` = 46935.5 é um serial Excel plausível (2028-07-01) mas o arquivo não o formatou como data. **Mantido NUMERIC**, sem conversão |
| `SUSPECTED_SENTINEL` | WARNING | 380 | `combustivelPercentualPerdaVida` = −1 provavelmente significa "não se aplica". **Mantido como −1** até existir regra confirmada |
| `NEW_ATTRIBUTE` | INFO | 138 | Toda coluna é inédita nesta primeira importação |
| `ENTITY_IDENTIFIER_CONFLICT` | **ERROR** | 18 | **Dois chassis aparecem em duas placas cada** (ver abaixo) |
| `MIXED_TYPE_COLUMN` | WARNING | 1 | `cavalo.data_fim_contrato` chega como NUMERIC *e* TEXT no mesmo import |

### Os dois achados que merecem sua atenção

**1. Chassi duplicado entre placas diferentes — 18 ocorrências**

| Chassi | Placas | Tipo |
|---|---|---|
| `979N1543DNM016344` | RZM0J21, RZM0J31 | CARRETA |
| `979N1543DNM016875` | RZM0C81, RZM0I81 | CARRETA |

Cada par se repete nas 9 vigências. Um chassi identifica fisicamente um
implemento; duas placas para o mesmo chassi é erro de cadastro no Freightec ou
uma duplicação de ativo. O FreightCheck **reportou e não sobrescreveu nada**:
as quatro placas seguem sendo entidades distintas identificadas por PLACA, e
essas duas carretas ficaram sem identificador CHASSI (daí 142, não 144).

**2. A mesma coluna chega com dois tipos diferentes**

`dataFimContrato` na aba `cavalos`: **496 células formatadas como data** e
**62 como serial cru**, na mesma coluna da mesma aba. Em `carretas`, todas as
642 são serial cru. Escolher um vencedor descartaria silenciosamente uma das
representações, então o atributo ficou `MIXED` e os dois formatos sobreviveram
nos fatos.

---

## 11. Divergências contra o documento de arquitetura

| # | Divergência | Situação |
|---|---|---|
| 1 | **Chave de negócio × "exatamente 9 snapshots"** — a chave inclui "tipo de entidade", mas as 9 vigências cobrem carretas *e* cavalos. Se o tipo entrasse na chave individualmente sairiam 18 snapshots | Reconciliado com `entity_type_set` = conjunto ordenado dos tipos cobertos (`"CARRETA+CAVALO"`). Dá 9 snapshots **e** mantém a chave capaz de distinguir um export só de cavalos. **Precisa da sua confirmação** |
| 2 | **138 atributos × "99 atributos distintos" da §2** | Os 99 eram a união dos nomes de coluna entre as abas. O schema escopa atributo por tipo de entidade: 63 (carretas) + 75 (cavalos) = 138. As 40 colunas homônimas **não são a mesma variável** (`ipvaLicenciamento` de um cavalo ≠ de uma carreta). Unificar alguma delas é decisão de curadoria em F2, via `attribute_alias` |
| 3 | **Dimensão das abas de pivô** diverge da §2 (45×11 vs 47×12 etc.) | SheetJS conta a partir da primeira célula usada; a análise anterior contava a partir de A1. As abas SOURCE batem exatamente (658×65, 559×77). Sem perda de dado |
| 4 | **Tipo inconsistente dentro da mesma coluna** | Não previsto na §2 — ela só registrava "data como serial Excel". Achado novo |
| 5 | **Chassi duplicado** | Não previsto. Achado novo, agora com detecção permanente |
| 6 | **Coluna `data` com hora significativa** | Não previsto. Resolvido armazenando ISO-8601 em texto, com aviso |
| 7 | **Rotas de API removidas** | Consequência dos vereditos "descartar"/"reescrever" da §1. `dashboard`, `snapshots`, `parameters`, `diffs`, `imports`, `shipments`, `simulations`, `alerts` e o `seed` foram removidos por não compilarem contra o schema novo. **A UI fica desconectada até F5** — `fleet-analysis` e `health` seguem funcionando |
| 8 | **11 erros de typecheck no `artifacts/freightaudit`** | **Pré-existentes.** Verificados em `origin/main`: os mesmos 11 erros, idênticos. Não foram introduzidos aqui e não foram corrigidos (fora do escopo de F0/F1) |

### Decisão em aberto

`preview()` calcula `blockingErrors`, mas `promote()` hoje **não** bloqueia por
causa deles — os 18 conflitos de chassi surgem durante a própria promoção.
Linhas com erro de grão já são rejeitadas antes. Se você quiser que qualquer
ERROR impeça a promoção, é uma linha de política a definir antes de F5.

---

## 12. O que **não** foi implementado

Motor financeiro · waterfall · IA · alertas · fórmulas e grafo de dependências ·
taxonomia · telas · F2 em diante.

Nenhuma tabela foi criada "por precaução": `formula`, `formula_dependency`,
`taxonomy_node`, `change_set`, `change`, `impact`, `alert` e `explanation`
ficam para quando forem construídas, com migration própria.
