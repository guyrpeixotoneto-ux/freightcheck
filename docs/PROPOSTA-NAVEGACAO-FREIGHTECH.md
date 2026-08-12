# FreightCheck — Navegação familiar ao Freightech

> **Status:** investigação e proposta. Nenhum código de produção escrito, nenhum
> schema tocado, nenhuma migration, nenhum dado alterado, nenhuma regra de
> comparação modificada.
>
> **Pergunta que orienta o documento:** como fazer o FreightCheck usar o mesmo
> modelo mental que o usuário já aprendeu no Freightech, e transformar essa
> familiaridade numa ferramenta muito superior para descobrir, entender e decidir
> sobre alterações na remuneração.
>
> **Base empírica desta investigação:**
> 1. Leitura do código de `lib/db`, `lib/ingest`, `lib/curation`, `lib/comparison`,
>    `artifacts/api-server` e `artifacts/freightaudit`.
> 2. Releitura dos arquivos reais em `attached_assets/` — as 65 colunas de
>    `carretas`, as 77 de `cavalos`, e a contagem de vigências, unidades,
>    operadores e regionais em cada um. **Esses números foram remedidos agora.**
> 3. Números do banco (fatos, alterações, comparações) citados de
>    `docs/PROPOSTA-EXPERIENCIA.md`, que os mediu num Postgres alimentado pelo
>    próprio pipeline. **Não havia banco disponível nesta sessão**, então esses
>    números são citados como medição anterior, não remedidos aqui — e estão
>    marcados como tal em cada lugar onde aparecem.
>
> **Nomenclatura:** *Freightech* (grafado *Freightec* em documentos anteriores
> deste repositório) = sistema da Ambev, a fonte. *FreightCheck* = este produto.

---

## 1. Como o FreightCheck funciona hoje

### 1.1 As quatro camadas, e por que elas não mudam

```
RAW          source_file · import_run · raw_sheet · raw_row · raw_cell
             imutável por trigger — nunca reprocessado, nunca reescrito
   ↓
STAGING      staged_fact · validation_issue · column_mapping
             tipado, validado, descartável
   ↓
CANÔNICO     snapshot · entity · attribute · fact · taxonomy_node · scope
             grão único: (snapshot, entidade, atributo) → valor
   ↓
COMPARAÇÃO   change_set · change
             derivado; pode ser apagado e reconstruído a qualquer momento
```

Toda a proposta deste documento vive **acima** dessa pilha. Nada do que se
segue exige tocar em RAW, STAGING ou no grão do CANÔNICO.

### 1.2 Como as vigências são armazenadas

`snapshot` guarda duas coisas separadas, de propósito:

| Coluna | Conteúdo | Exemplo real |
|---|---|---|
| `source_label` | o rótulo literal da fonte, nunca interpretado | `EMPURRADA_1_8_2026` |
| `effective_date` | data derivada por regra explícita e testada | `2026-08-01` |

A chave de negócio é `source_system + source_label + scope_hash +
entity_type_set + revision`, com um índice único parcial que garante **um
snapshot vivo por chave**. Reentrega da mesma vigência com correção é uma
revisão explícita (`supersedes_snapshot_id`), nunca uma edição no lugar.

O parser está em `lib/ingest/src/vigencia.ts`:

```ts
const LABEL_PATTERN = /^EMPURRADA_(\d{1,2})_(\d{1,2})_(\d{4})$/;
```

**Este é o achado mais importante do cruzamento com as screenshots** — ver §2.2.

### 1.3 Como unidades e operações são representadas

`scope` é multi-valor desde o primeiro dia, com `(scope_type, code)` único, e
`snapshot_scope` liga cada vigência aos seus escopos. O pipeline extrai três
tipos, por nome de coluna (`lib/ingest/src/pipeline.ts:54`):

```ts
"unidade - cnpj"     → UNIDADE   (nome vem de "unidade - nome")
"operador - cnpj"    → OPERADOR  (nome vem de "operador - nome")
"unidade - regional" → REGIONAL
```

O `scope_hash` do snapshot é o hash determinístico desse conjunto — e é ele que
o motor usa para **recusar comparar séries de escopos diferentes**
(`lib/comparison/src/engine.ts:134`).

**O que existe e o que falta:** o escopo está modelado corretamente e é usado
para *proteger* a comparação. Ele **não é exposto em nenhuma rota de leitura,
nenhum filtro e nenhuma tela**. Hoje isso não produz erro porque só há uma
unidade; na primeira importação multi-unidade, produz — ver §9, R1.

### 1.4 Como cavalo, carreta e demais entidades estão modelados

- `entity` tem identidade própria (UUID). Placa e chassi são *identificadores*
  com histórico em `entity_identifier`, não a chave. Reemplacamento fecha uma
  linha e abre outra; o histórico de fatos não é tocado.
- `entity.entity_type` é **texto livre** — `CAVALO`, `CARRETA`, e um terceiro
  tipo de equipamento não exige migration.
- **Carreta e cavalo são séries independentes.** Cada uma gera seu próprio
  snapshot, é comparada contra a sua própria vigência anterior e tem sua própria
  frota. O "consolidado" é projeção de leitura (`consolidated.ts`), nunca uma
  entidade gravada.
- O vínculo entre os dois existe como atributo (`cavalo.placa_carreta`), e o
  motor tem natureza própria para quando ele muda.

### 1.5 Como atributos e parâmetros estão armazenados

Não existe "tabela de parâmetros". O grão é:

```
fact (snapshot_id, entity_id, attribute_id) → value_numeric | value_text
                                            | value_boolean | value_date
                                            | is_null + null_reason
      + value_hash (diff por JOIN)
      + raw_cell_id (rastreabilidade obrigatória até a célula)
      UNIQUE (snapshot_id, entity_id, attribute_id)
      CHECK  (exatamente um value_* preenchido OU is_null)
```

O `attribute` é o dicionário: `code` interno (`cavalo.ipva_licenciamento`),
`source_name` literal (`ipvaLicenciamento`), `entity_type`, `data_type`, `unit`,
`periodicity`, `aggregation`, `is_monetary`, `taxonomy_node_id` e —
o campo que protege o sistema inteiro — `semantics_status`
(`UNKNOWN | PRESUMED | CONFIRMED`).

`snapshot_attribute` registra quais colunas o layout carregou em cada vigência,
o que é o que distingue "a coluna sumiu" de "esta placa não tem valor".

### 1.6 Como funciona a taxonomia hoje

`taxonomy_node` é auto-referente, com `path` materializado e profundidade livre.
A árvore semeada (`lib/curation/src/taxonomy.ts`) tem **22 nós** e é organizada
por **classe de custo**:

```
Remuneração
├── Custo Fixo        (costClass FIXO, herdado pelos filhos)
│   ├── Frota — Cavalo · Frota — Carreta · Financiamento e juros
│   ├── Depreciação e amortização · Remuneração de capital
│   ├── Seguros e tributos · Pessoal e encargos · Outros custos fixos
├── Custo Variável    (costClass VARIAVEL)
│   ├── Combustível · Manutenção · Pneus · Lucro variável · Outros
├── Cadastral (não remuneratório)
│   └── Identificação · Escopo · Contrato e vigência · Especificação técnica
└── Não classificado
```

**Este é o ponto conceitual central desta proposta.** A taxonomia atual responde
*"isto é custo fixo ou variável?"* — uma pergunta contábil, que alimenta regra
de agregação e de impacto. O Freightech agrupa por *"de que assunto operacional
isto trata?"* — Frota, Equipe, Uniformes. **São dois eixos diferentes, e os dois
são legítimos.** Nenhum é substituto do outro (§3.4).

### 1.7 Como funciona a importação

```
Importações (upload .xlsx pela interface — nunca por terminal)
 └─ receiveFile   SHA-256; hash repetido não reimporta
    └─ captureRaw raw_sheet / raw_row / raw_cell        [imutável, trigger]
       └─ stage   staged_fact + validation_issue        [descartável]
          └─ preview  aceitos / rejeitados / avisos     [aceite humano explícito]
             └─ promote  snapshot CLOSED + entity + fact
                ├─ seedTaxonomy          (22 nós, idempotente)
                ├─ runProposalPass       (PRESUMED, nunca CONFIRMED)
                ├─ applyConfirmations    (registro versionado em código)
                ├─ backfillSemantics     (attribute_semantics v1)
                └─ computeMissingChangeSets   (em background)
```

A classificação da aba é por **forma, não por nome**: uma aba só é fonte de
fatos se a primeira linha carrega `vigencia` + `placa` e ≥80% dos cabeçalhos
preenchidos. As tabelas dinâmicas do arquivo real (`Quantidade`, `Análise
Carreta`, `Análise Cavalo`) falham nos dois critérios e ficam de fora, com o
motivo gravado.

### 1.8 Como funciona a normalização

- `slugifyColumn` recupera fronteiras de palavra antes de dobrar
  (`ipvaLicenciamento` → `ipva_licenciamento`), preservando o literal em
  `attribute.source_name` e em `raw_cell.column_header`.
- `deriveEntityType` lê o nome da aba como frase, descarta as palavras que
  descrevem o *documento* (`modelo`, `análise`, `base`…) e singulariza — foi o
  que impediu `Modelo_Carreta` de virar uma segunda identidade `MODELOCARRETA`.
- `attribute_alias` liga nome de coluna a atributo, com confiança e confirmação
  humana. **Vínculo não confirmado não entra em cálculo.**
- Valores: sentinelas viram `is_null` com motivo; ausência nunca vira zero;
  monetário é `NUMERIC(18,6)`, `float` é proibido.

### 1.9 Como funciona o motor de comparação

Pareia `(entity_id, attribute_id)` entre dois snapshots **da mesma série** —
mesmo `scope_hash` e mesmo `entity_type_set` — e emite quatro categorias:
`SOURCE_CHANGE`, `FLEET_CHANGE`, `LAYOUT_CHANGE`, `SEMANTICS_CHANGE`.

Regras que valem citar porque a nova navegação **não pode quebrá-las**:

1. Uma placa que entra ou sai é **uma** alteração, e suprime os ~70 filhos.
2. `comparability` é `COMPARABLE` ou `INCONCLUSIVE` **com motivo escrito**;
   inconclusivo nunca é silenciosamente tratado como igual.
3. `change` guarda a classificação **como estava no momento do cálculo**
   (`cost_class`, `taxonomy_path`, `taxonomy_name`, `semantics_status`,
   `semantics_version_a/b`), para que reclassificar hoje não reescreva uma
   comparação de ontem.
4. `computeChangeSet` **apaga e reconstrói** o conjunto inteiro; `change.id` é
   `bigserial`. Nada durável pode ser amarrado a `change.id`.

### 1.10 Como os impactos são calculados

`assessImpact` (`lib/comparison/src/impact.ts`) é curto e recusa em cinco
pontos, sempre com frase em português:

```
não comparável              → NOT_CALCULABLE
semântica ≠ CONFIRMED       → NOT_CALCULABLE
não é montante financeiro   → NOT_CALCULABLE
aggregation ≠ SUM           → NOT_CALCULABLE
um dos lados não numérico   → NOT_CALCULABLE
caso contrário              → CALCULATED, amount = depois − antes,
                              expresso na periodicidade do atributo
```

E acima dele, na visão agrupada:

- **Impacto é acumulado por periodicidade, nunca somado entre elas.**
  `{"MENSAL": …, "ANUAL": …}` — nunca um escalar.
- **Dupla contagem pai/parcela é retirada por ativo** (`composition.ts`):
  `custoFixo = finame + lucroFixomodeloNovoCiclo` faz o titular sair da soma
  no ativo em que alguma parcela também mudou, com o valor excluído e o motivo
  visíveis.
- **Só soma quando `aggregation = SUM`**; caso contrário mostra média, faixa,
  numerador, denominador e nº de veículos.

**Estado atual da semântica: 17 atributos confirmados** em
`lib/curation/src/confirmations.ts`, cada um com a conta que o sustenta. Todo o
resto está `PRESUMED` ou `UNKNOWN` — e, portanto, aparece nas telas de mudança
mas não vira dinheiro.

### 1.11 Quais telas dependem dessas estruturas

| Rota | Lê | Depende de |
|---|---|---|
| `/` Início | `GET /changes/grouped` | `getGroupedView(db, period)` — período, sem escopo |
| `/alteracoes` | `GET /changes/consolidated` | `getConsolidated` + `listChanges` |
| `/comparar` | `POST /change-sets`, `GET /change-sets/pair/:a/:b` | par escolhido à mão |
| `/curadoria` | `GET /curation/*` | fila de atributos sem semântica confirmada |
| `/versoes` | `GET /curation/versions/*` | `attribute_semantics` |
| `/vigencias` | `GET /snapshots` | lista de snapshots |
| `/importacoes` | `GET/POST /imports` | pipeline F1 |
| `/analise-equipamentos` | `GET /fleet-analysis/*` | **lê o `.xlsx` do disco**, fora do canônico |

### 1.12 Quais dados reais existem

**Remedidos nesta investigação, direto dos arquivos:**

| Fato | Valor |
|---|---|
| Colunas | 65 (carretas) + 77 (cavalos) = **142** |
| Atributos derivados | 142 − 4 colunas de grão (`Vigencia`, `Placa` × 2 abas) = **138** |
| Linhas | 657 (carretas) + 558 (cavalos) = 1.215 |
| Vigências | **9**, de `EMPURRADA_2_12_2025` a `EMPURRADA_1_8_2026` |
| Unidade | **1** — `CAMAÇARI` (`07526557001505_CERV`, SAP `BR04`) |
| Operador | **1** — `OPERALOG` |
| Regional | **1** — `Geo NE` |
| Canal (prefixo da vigência) | **1** — `EMPURRADA` |
| Empresa locadora | 2 — `HORIZONTE` (639 linhas), `Vamos` (18) |
| Região (`regiaoEmpurrada`) | 2 — `SP INTERIOR` (549), `NE` (9) |
| `Modelo_Carreta.xlsx` × aba `carretas` | **colunas idênticas** (diferença: conjunto vazio) |
| `Modelo_Cavalo.xlsx` × aba `cavalos` | **colunas idênticas** |

**Citados de `docs/PROPOSTA-EXPERIENCIA.md`** (medidos num banco alimentado pelo
próprio pipeline; não remedidos aqui): 18 vigências no banco (9 CARRETA +
9 CAVALO), 144 ativos, 83.241 fatos, 138 atributos, 16 comparações,
3.224 alterações, 2.720 (84%) sem impacto apurado por falta de semântica
confirmada.

> Os **138 atributos** medidos no banco batem exatamente com os 138 derivados
> dos arquivos agora. É a confirmação de que o dicionário do FreightCheck é
> literalmente o conjunto de colunas do Freightech, sem perda e sem invenção.

### 1.13 O que já existe e a interface não usa

Esta é a parte que decide o tamanho da obra:

| Capacidade | Onde já está | Aparece hoje |
|---|---|---|
| `taxonomy_path` gravado em cada alteração | `change.taxonomy_path` | **em nenhuma tela** |
| Classe de custo herdada | `classification.ts` | badge por linha, nunca como agrupador |
| Escopo (unidade/operador/regional) por snapshot | `scope`, `snapshot_scope`, `scope_hash` | **em nenhuma rota de leitura** |
| Agrupamento por atributo × equipamento, com regra anti-mentira | `grouped.ts` (1.009 linhas) | Início |
| Série histórica de um atributo nas 9 vigências | `GET /attributes/:code/series` | Início (nível 2) e Curadoria |
| Rastreabilidade até a célula, dos dois lados | `GET /changes/:id/provenance` | expandindo linha |
| Impacto por periodicidade, sem dupla contagem | `summariseImpact` | Início |
| Conversão de periodicidade com recusa declarada | `lib/simulation` — completo e testado | **nenhuma tela consome** |

**Conclusão da §1:** a camada de navegação que este documento propõe é, em
grande parte, **projeção de coisas que o banco já sabe e a interface ainda não
mostra**.

---

## 2. Como o Freightech organiza esse domínio

### 2.1 A hierarquia de seleção

```
Canal/Segmento  →  Vigência  →  Unidade  →  Parâmetro
    ROTA           ROTA_1_8_2026   CDD BELEM-HORIZONTE   (busca)
                                                    [FILTRAR]
```

Depois do filtro, os parâmetros aparecem agrupados por **família**, em cartões
com estrela de favorito. As famílias visíveis nas screenshots, com 42
parâmetros no total:

| Família | Parâmetros |
|---|---|
| GERAL | Cadastro Índice de Reajuste · Índice de Reajuste |
| DIMENSÕES | Implemento |
| FROTA | Caminhão · Caminhão Aluguel · Combustível · Consumo Benchmark · Contrato Manutenção · KM Pneu · Manutenção BID · Manutenção Carroceria · Manutenção Cavalo · Pneu |
| EQUIPE | Benefícios Equipe Entrega · Benefícios Equipe Noturna · Benefícios Remunerado · Encargos e Provisões sem Férias · Encargos e Provisões com Férias · Equipe Noturna · Equipe de Entrega · FAD · FAD - Despesa Fixa · Parâmetros Equipe Entrega · QLP ADM |
| DESPESAS | Despesas Operacionais |
| MODELOS DE REMUNERAÇÃO | Lucro Novo · Remuneração Variável Antigo · Remuneração Variável Novo |
| REMUNERAÇÃO | Faturamento · Recarga · Resumo - SRTRANS · Resumo Rota |
| PARÂMETROS GERAIS | Empresa Locadora · Fator Consumo · Fator Desgaste Piso · Parâmetros Operação · Região |
| UNIFORMES E EPIs | Cadastros EPI · Uniformes EPIs (Remuneração) · Uniformes e EPI Homologados · Uniformes e EPIs Geral · Valor Uniformes e EPIs sem ICMS |

### 2.2 O achado que o cruzamento revelou

A screenshot mostra **Canal/Segmento = ROTA** e **Vigência = `ROTA_1_8_2026`**.
O FreightCheck importa vigências chamadas **`EMPURRADA_1_8_2026`**.

Mesmo dia, mesmo mês, mesmo ano, mesma estrutura. O rótulo de vigência do
Freightech é:

```
<CANAL/SEGMENTO>_<DIA>_<MÊS>_<ANO>
```

Ou seja: **o Canal/Segmento já está dentro do dado que o FreightCheck importa há
meses** — como prefixo do `source_label`, preservado literalmente e nunca
interpretado. `EMPURRADA` é um canal, exatamente como `ROTA` é outro.

Duas consequências imediatas:

1. **O eixo Canal/Segmento não precisa ser inventado.** Ele precisa ser *lido* de
   onde já está.
2. **O parser de vigência recusaria uma vigência de ROTA hoje.** O regex é
   `^EMPURRADA_…$`. Um export do canal ROTA seria rejeitado inteiro com
   `UNRECOGNISED_FORMAT`. Isso é uma limitação real com correção pequena — e é
   também a demonstração de que o produto ainda nunca viu outro canal.

### 2.3 O que o Freightech mostra que o FreightCheck não recebe

As screenshots são do canal **ROTA**, cujo escopo de parâmetros é muito mais
largo que o export de equipamento que o FreightCheck importa: EQUIPE (11
parâmetros), UNIFORMES E EPIs (5), DESPESAS (1), REMUNERAÇÃO (4). Nada disso
existe nas 142 colunas de carretas e cavalos.

Isto **não é uma falha do FreightCheck**. É a diferença entre o escopo de um
canal e o de um arquivo. E é a razão de a regra "não criar categoria vazia só
porque existe no Freightech" ser inegociável (§6.4).

---

## 3. Mapeamento Freightech → FreightCheck

### 3.1 Os quatro eixos de seleção

| Freightech | FreightCheck hoje | Estado | Veredito |
|---|---|---|---|
| **Canal/Segmento** (`ROTA`) | prefixo de `snapshot.source_label` (`EMPURRADA`) | existe no dado, **não é campo** | **adaptar** — derivar coluna/projeção; parser precisa aceitar outros canais |
| **Vigência** (`ROTA_1_8_2026`) | `snapshot.source_label` + `effective_date` | existe, completo | **reutilizar** |
| **Unidade** (`CDD BELEM-HORIZONTE`) | `scope` tipo `UNIDADE` + `snapshot_scope` + `scope_hash` | existe, **não exposto** | **reutilizar o modelo, criar a API e o filtro** |
| **Parâmetro** (busca) | `attribute` + `taxonomy_node` | existe, com semântica diferente (§3.3) | **adaptar** |

### 3.2 As famílias

| Freightech | FreightCheck hoje | Veredito |
|---|---|---|
| Família (FROTA, EQUIPE, …) | não existe como conceito | **criar** — camada de apresentação |
| Parâmetro (Pneu, Combustível) | conjunto de `attribute` | **criar o agrupador**, reutilizando os atributos |
| Estrela / favorito | não existe | **criar** (opcional, P1) |
| Botão FILTRAR | não existe | **não copiar** (§5.3) |

### 3.3 "Parâmetro" não quer dizer a mesma coisa nos dois sistemas

No Freightech, **PNEU** é uma tabela de parâmetros — abre e mostra várias
colunas. No FreightCheck, o equivalente a uma coluna é um `attribute`; o
equivalente ao cartão PNEU é um **conjunto** de atributos
(`cavalo.valor_pneu`, `carreta.valor_pneus`, `pneu_medida_empurrada`).

> **Regra de tradução:** um cartão de parâmetro do Freightech ≡ um **nó de
> família** do FreightCheck, contendo N atributos. Nunca 1-para-1 com atributo.

### 3.4 O ponto que decide a arquitetura: dois eixos, não um

| Eixo | Pergunta | Onde vive hoje | Para que serve |
|---|---|---|---|
| **Classe de custo** | isto é custo fixo ou variável? | `taxonomy_node` (22 nós) | regra de agregação, de impacto, e o filtro FIXO/VARIÁVEL |
| **Família operacional** | de que assunto isto trata? | **não existe** | reconhecimento, navegação, resumo por assunto |

**Recomendação: acrescentar o segundo eixo sem tocar no primeiro.**

Substituir a taxonomia atual pelas famílias do Freightech seria a decisão mais
cara e mais perigosa possível: `attribute.taxonomy_node_id` alimenta
`classification.ts`, que alimenta `assessImpact`, e `change.taxonomy_path` é
gravado em cada alteração já calculada. Reclassificar 138 atributos mudaria a
classe de custo de comparações futuras e criaria divergência com as já
gravadas — exatamente o tipo de mudança silenciosa que o produto existe para
denunciar.

O eixo de família é **ortogonal**: `cavalo.ipva_licenciamento` é *Custo Fixo →
Seguros e tributos* (contábil) **e** *Tributos e seguros → IPVA e licenciamento*
(operacional). As duas coisas são verdade ao mesmo tempo.

### 3.5 Onde a família deve morar — três opções

| Opção | Como | Prós | Contras | Veredito |
|---|---|---|---|---|
| **A — mapa em código** | `lib/comparison/src/families.ts`, no mesmo espírito de `labels.ts` | zero migration; revisável em PR; reversível; não altera dado | não editável pela tela | **recomendada para a Fase 1** |
| **B — segunda árvore em `taxonomy_node`** | novo root `familias/…` + coluna `axis` | editável pela tela; usa estrutura existente | migration; `attribute` só tem **um** `taxonomy_node_id` — exigiria tabela de ligação N-N | Fase 2, se a família provar que muda com frequência |
| **C — reaproveitar `taxonomy_node_id`** | reclassificar os 138 atributos | nenhum código novo | **destrói o eixo de custo**; muda comparações; reescreve curadoria auditada | **recusada** |

O precedente já existe neste repositório e está documentado em `labels.ts`: o
nome de leitura mora em código *"porque preencher aquela coluna seria alterar
dado — e porque um rótulo revisto num pull request é mais fácil de auditar do
que um `UPDATE`"*. A família é exatamente a mesma natureza de decisão.

---

## 4. Proposta de arquitetura de navegação

```
┌────────────────────────────────────────────────────────────────────────┐
│  ENTRADA                                                               │
│  Contexto  →  Unidade · Canal · Vigência atual · Comparar com          │
│  (sem botão Filtrar; já abre preenchido com o mais recente)            │
└───────────────────────────────┬────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────────┐
│  RESUMO EXECUTIVO + FAMÍLIAS                                           │
│  veredicto em uma frase · impacto por periodicidade (nunca somado)     │
│  perdas · ganhos · nº de alterações · críticas · não classificadas     │
│  ────────────────────────────────────────────────────────────────────  │
│  cartões por família, cada um com: nº de alterações · impacto ou o     │
│  motivo de não haver · nº de parâmetros tocados                        │
└───────────────────────────────┬────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────────┐
│  FAMÍLIA → PARÂMETROS                                                  │
│  FROTA → Pneu · Combustível · Manutenção Cavalo · …                    │
│  cada parâmetro com contagem, impacto e cobertura da frota             │
└───────────────────────────────┬────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────────┐
│  PARÂMETRO → ALTERAÇÕES  (os cartões de grupo que já existem)          │
│  ANTES → AGORA → VARIAÇÃO → IMPACTO, por veículo                       │
│  padrões distintos · cobertura · histórico nas 9 vigências             │
└───────────────────────────────┬────────────────────────────────────────┘
                                ↓
┌────────────────────────────────────────────────────────────────────────┐
│  ORIGEM E DECISÃO                                                      │
│  rastreabilidade até a célula · destravar semântica · marcar decisão   │
└────────────────────────────────────────────────────────────────────────┘
```

**Regra de ouro do fluxo:** cada nível é uma *redução*, nunca um *desvio*. Toda
alteração continua contada em algum lugar visível em todos os níveis, e o
usuário pode pular direto para a lista linha a linha em qualquer ponto —
`/alteracoes` e `/comparar` permanecem.

---

## 5. Proposta da tela "Seleção de Unidades"

### 5.1 O que ela é

Uma **barra de contexto persistente**, não uma tela intersticial. O usuário do
Freightech reconhece os quatro campos na mesma ordem; o FreightCheck acrescenta
o quinto — *Comparar com* — que é a razão de o produto existir.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Unidade            Canal/Segmento    Vigência atual     Comparar com        │
│  ┌──────────────┐   ┌─────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ CAMAÇARI   ▾ │   │ EMPURRADA ▾ │   │ AGO/2026   ▾ │   │ JUL/2026     ▾ │  │
│  └──────────────┘   └─────────────┘   └──────────────┘   └────────────────┘  │
│  Geo NE · OPERALOG                    EMPURRADA_1_8_2026  EMPURRADA_2_7_2026 │
│                                                                              │
│  Analisando 62 cavalos e 71 carretas · 9 vigências no histórico              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Campo a campo

| Campo | Fonte | Comportamento |
|---|---|---|
| **Unidade** | `scope` tipo `UNIDADE` com snapshot vivo | Mostra nome + regional + operador embaixo. **Com uma só unidade, o campo aparece preenchido e desabilitado, com a frase "única unidade importada"** — não finge escolha que não existe |
| **Canal/Segmento** | prefixo de `source_label` | Idem: com um canal só, preenchido e explicado. Só vira seletor quando houver dois |
| **Vigência atual** | `snapshot.effective_date` dos snapshots vivos da unidade | Padrão: **a mais recente**. Mostra o rótulo literal embaixo do rótulo amigável |
| **Comparar com** | as vigências anteriores da mesma unidade e canal | Padrão: **a imediatamente anterior**. Opções extras: "mesma vigência do ano passado", "primeira vigência" |

### 5.3 O que muda em relação ao Freightech

| Freightech | FreightCheck | Por quê |
|---|---|---|
| Botão FILTRAR obrigatório | **sem botão**; troca de campo já recarrega | O trabalho de carregar é do sistema. O estado é refletido na URL (`?unidade=…&vigencia=…&base=…`), que é compartilhável e volta ao mesmo lugar |
| Campos travados até escolher o de cima | **cascata que já vem preenchida** | Abrir uma vigência nova é o caso de 90% dos dias; ela deve estar na tela sem clique |
| Campos vazios | **última seleção lembrada** | Quem cuida de uma unidade sempre volta a ela |
| Sem informação sobre o que existe | **conta o que será analisado** antes de analisar | "62 cavalos e 71 carretas" evita a surpresa de uma série ausente |

### 5.4 As recusas honestas desta tela

1. **Vigência sem anterior** → *Comparar com* mostra "não há vigência anterior
   nesta unidade" e a tela seguinte abre em modo inventário, não em modo diff.
2. **Séries incompletas** → "nesta vigência chegou só carreta; falta cavalo" —
   já existe em `getGroupedView().missing` e deve subir para a barra.
3. **Escopos diferentes** → a comparação é recusada pelo motor. A tela não deve
   sequer oferecer o par; se oferecer, mostra a recusa escrita, não um erro.
4. **Par não calculado ainda** → diz que está calculando; não mostra zero.

---

## 6. Proposta da tela seguinte

### 6.1 Estrutura

```
Nível 0   Resumo executivo da unidade+par (o cabeçalho)
Nível 1   Cartões de família
Nível 2   Parâmetros dentro da família
Nível 3   Cartões de grupo (os que já existem hoje) + tabela por veículo
```

### 6.2 O resumo executivo

Todos os itens abaixo já são calculáveis com o que existe. O que **não** existe
hoje é "alterações críticas" e "não classificadas" como conceitos nomeados —
propostos em §6.5.

| Item | De onde vem | Já existe? |
|---|---|---|
| Impacto líquido, **por periodicidade** | `impact.byPeriodicity` | sim |
| Perdas / ganhos | mesma fonte, separando negativos de positivos **dentro de cada periodicidade** | soma existe; a separação é nova (trivial) |
| Total de alterações | `totals.changes` | sim |
| Alterações críticas | selo `DINHEIRO` + `RUPTURA` de `grouped.ts` | selos existem; o nome "crítica" é novo |
| Não classificadas | selo `TRAVADO` (monetário e somável, sem semântica confirmada) | sim |
| Parâmetros mais impactados | grupos ordenados por `abs(impacto)`, dobrados por família | sim |
| Veículos mais impactados | soma por `entity_id` **dentro de cada periodicidade** | dado existe; a agregação por veículo é nova |
| Excluído por dupla contagem | `impact.excludedByPeriodicity` | sim — e deve continuar visível |

**Nunca**: um número único de impacto. R$/mês, R$/ano e R$ pontual aparecem lado
a lado, sempre, com o rótulo. É a regra mais antiga deste produto.

### 6.3 O cartão de família

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ FROTA                        │   │ TRIBUTOS E SEGUROS           │
│ 4 parâmetros alterados       │   │ 1 parâmetro alterado         │
│ 118 alterações               │   │ 62 alterações                │
│ ↓ R$ 8.420,15 /mês           │   │ ↓ R$ 60.036,45 /ano          │
│ 47 sem preço · 2 travadas    │   │ significado confirmado       │
└──────────────────────────────┘   └──────────────────────────────┘
```

> Os valores acima são **ilustrativos de layout**, não medições. Nenhum número
> deste documento sai da tela sem vir do banco.

Regras do cartão:

1. Impacto sempre com periodicidade colada; **duas linhas quando há duas**.
2. "Sem preço" e "travadas" são contagens visíveis, nunca omissões.
3. Família sem alteração aparece **recolhida**, escrita "sem alterações" — não
   some (a ausência de mudança é informação).
4. Família **sem atributo nenhum** não aparece (§6.4).

### 6.4 A regra das famílias vazias

> **Uma família só existe na tela se pelo menos um atributo do FreightCheck
> pertence a ela.**

Das 42 famílias/parâmetros do Freightech: **13 têm dado**, **4 são parciais ou
ambíguos**, **25 não têm dado nenhum** (EQUIPE inteira, UNIFORMES inteira,
DESPESAS, REMUNERAÇÃO, KM Pneu, Fator Consumo, Fator Desgaste Piso, Cadastro
Índice de Reajuste). Criar cartões para os 25 seria fabricar 25 promessas que o
produto não pode cumprir.

**Onde eles aparecem, então:** numa linha discreta no rodapé da tela —
*"O Freightech também publica Equipe, Uniformes e EPIs, Despesas Operacionais e
Remuneração. Esses parâmetros não vêm no export de equipamento que o
FreightCheck recebe hoje."* Isso responde "onde está o resto?" sem simular
cobertura.

### 6.5 Vocabulário: o que **não** inventar

O produto já tem palavras para isto, e a nova tela deve usá-las tal como estão:

| Conceito | Termo do FreightCheck | **Não** usar |
|---|---|---|
| Impacto sem cálculo possível | **"Impacto não calculável"** + o motivo escrito | "impacto a verificar", "N/D", "—" |
| Bloqueado por semântica | **"Preço travado — significado ainda não confirmado"** | "pendente", "erro" |
| Não comparável | **"Inconclusiva"** + motivo | tratar como igual |
| Valor não somável | **"não somável"** + média e faixa | somar mesmo assim |

O briefing sugeriu "Impacto a verificar" como exemplo de UX. **Recomendo não
adotar**: o produto já distingue `NOT_CALCULABLE` (não dá para calcular, e o
motivo é este) de `ESTIMATED` (dá, sob premissa declarada). "A verificar" é uma
terceira coisa vaga que apagaria essa distinção.

---

## 7. Taxonomia proposta, com os dados reais

Mapeamento completo das **138 colunas** (fora `Vigencia` e `Placa`, que são o
grão). Verificado programaticamente: **nenhuma coluna ficou de fora, nenhuma
está em dois lugares**.

### 7.1 Famílias que vêm do Freightech e têm dado

| Família → Parâmetro | Nº | Atributos reais |
|---|--:|---|
| **GERAL → Índice de reajuste** | 2 | `cavalo.percentualReajusteAplicado`, `cavalo.valorReajustado` |
| **DIMENSÕES → Implemento** | 7 | `carreta`: `implemento`, `modelo`, `capacidadeEmpurrada`, `capacidadePalletsRealEmpurrada`, `eixoEmpurrada`, `tipoCarroceriaEmpurrada`, `doubleDeck` |
| **FROTA → Caminhão** | 12 | `cavalo`: `chassi`, `ano`, `montadora`, `modeloEmpurrada`, `cambio`, `Padrão`, `eixoEmpurrada`, `ativo`, `frotaEmprestada`, `odometroEntrada`, `faixaKm`, `Placa Carreta` |
| **FROTA → Carreta (ativo)** | 3 | `carreta`: `chassi`, `ano`, `frotaEmprestada` |
| **FROTA → Caminhão aluguel** | 2 | `carreta.custoAluguel`, `cavalo.custoAluguel` |
| **FROTA → Combustível** | 6 | `cavalo`: `combustivelCapacidade`, `combustivelConsumoNeg`, `combustivelConsumoNegInteiro`, `combustivelVidaCavalo`, `combustivelPercentualPerdaVida`, `tipoCombustivelEmpurrada` |
| **FROTA → Consumo benchmark** | 1 | `cavalo.combustivelConsumoBenchmark` |
| **FROTA → Contrato de manutenção** | 3 | `cavalo`: `manutencaoContrato`, `manutencaoFreeMaintenance`, `freeMaintenance` |
| **FROTA → Manutenção BID** | 5 | `cavalo`: `manutencaoBid`, `anoBid`, `Ganhador BID`, `manutencaoCompraForaDoBidAutorizada`, `manutencaoAno` |
| **FROTA → Manutenção cavalo** | 4 | `cavalo`: `manutencaoReaisKm`, `manutencaoReaisKmInteiro`, `manutencaoVidaMeses`, `reaiskm` |
| **FROTA → Manutenção carroceria** *(a confirmar)* | 4 | `carreta`: `revestimento`, `faixaReflexiva`, `tacografo`, `rastreador` |
| **FROTA → Pneu** | 4 | `cavalo.valorPneu`, `carreta.valorPneus`, `pneuMedidaEmpurrada` (ambos) |
| **MODELOS DE REMUNERAÇÃO → Lucro fixo (novo ciclo)** | 3 | `carreta.lucroFixomodeloNovoCiclo`, `carreta.lucroFixomodeloNovoCicloCarreta`, `cavalo.lucroFixomodeloNovoCicloCavalo` |
| **MODELOS DE REMUNERAÇÃO → Remuneração variável** *(ambíguo)* | 4 | `carreta.lucroVariavelPrevisto`, `carreta.lucroVariavelPrevistoCarreta`, `cavalo.lucroVariavelPrevistoCavalo`, `cavalo.Custo Variável Simulado` |
| **PARÂMETROS GERAIS → Empresa locadora** | 2 | `Empresa locadora` (ambos) |
| **PARÂMETROS GERAIS → Região** | 1 | `cavalo.regiaoEmpurrada` |
| **PARÂMETROS GERAIS → Parâmetros de operação** *(parcial)* | 4 | `Organizacao de Compras`, `Prazo Pagamento` (ambos) |

### 7.2 Famílias que o FreightCheck precisa e o Freightech (nas screenshots) não mostra

Estes 63 atributos **não podem ser descartados** — entre eles está o maior
achado financeiro já produzido pelo produto.

| Família → Parâmetro | Nº | Atributos reais |
|---|--:|---|
| **AQUISIÇÃO E FINANCIAMENTO → Financiamento** | 20 | ambos: `Spread BNDES`, `Spread Banco`, `TJLP`, `Taxa Finame (%)`, `periodoFiname`, `carencia`, `statusFinanciamentoT1Shared`; `carreta`: `statusFinanciamento`, `finame`, `finameImplemento`, `jurosFinameImplemento`; `cavalo`: `finameCavalo`, `jurosFinameCavalo` |
| **AQUISIÇÃO E FINANCIAMENTO → Aquisição** | 8 | ambos: `valorNfCompra`, `percentualEntrada`, `mesDeEntrada`, `data` |
| **AQUISIÇÃO E FINANCIAMENTO → Depreciação** | 2 | `carreta.amortizacaoImplemento`, `cavalo.amortizacaoCavalo` |
| **AQUISIÇÃO E FINANCIAMENTO → Custo fixo (total)** | 1 | `carreta.custoFixo` — **titular de composição**, ver §9 R5 |
| **TRIBUTOS E SEGUROS → IPVA e licenciamento** | 3 | `cavalo.ipvaLicenciamento`, `carreta.ipvaLicenciamento`, `carreta.ipvaLicenciamentoMensal` |
| **TRIBUTOS E SEGUROS → Seguro** | 1 | `carreta.seguro` |
| **TRIBUTOS E SEGUROS → Tributos sobre a aquisição** | 8 | ambos: `percentualIcms`, `valorIcms`, `valorPisCofins`; `carreta`: `icms`, `pisCofins` |
| **CONTRATO E CICLO → Contrato** | 4 | ambos: `dataFimContrato`, `ciclo` |
| **CONTEXTO → Escopo e identificação** | 24 | ambos: `Unidade - CNPJ/Nome/SAP/TMS/Promax UNB/Regional`, `Operador - CNPJ/Nome/SAP/TMS/Promax`, `_id` |

**Total: 138.**

### 7.3 A pergunta do briefing, respondida com o dado

> *"Quero saber se o dicionário do FreightCheck consegue representar
> **Frota → Manutenção Cavalo → IPVA/Licenciamento**."*

**Estruturalmente, sim** — a hierarquia é livre e três níveis cabem sem
migration.

**Mas o dado diz que essa colocação estaria errada, e a consequência é grande.**
`ipvaLicenciamento` do cavalo é, de Jan a Jun/2026, exatamente **1,000% de
`valorNfCompra`, com desvio 0,0000 nas 62 placas** — é tributo sobre o valor do
veículo, confirmado `ANUAL · BRL · SUM` em `confirmations.ts`. Não é manutenção.
E é o atributo do maior achado do produto: a queda de **R$ 989.844 → R$ 268.952**
documentada em `docs/ACHADO-IPVA.md`.

Colocá-lo sob *Manutenção Cavalo* faria a família Manutenção — cujos outros
atributos são R$/km e meses, **nenhum deles somável** — exibir um total anual em
reais que não pertence a ela. Recomendo **Tributos e seguros → IPVA e
licenciamento**, e, se a familiaridade com o Freightech pesar mais, um atalho
cruzado ("aparece também em Frota → Manutenção Cavalo") — sem duplicar o valor
em soma nenhuma.

> Se o Freightech de fato publica IPVA dentro de Manutenção Cavalo, isso é uma
> informação que muda a proposta e eu prefiro perguntar a adivinhar. Está na
> lista de perguntas em aberto (§11).

### 7.4 Ambiguidades que a curadoria precisa resolver

| Ambiguidade | Evidência | Proposta |
|---|---|---|
| Remuneração Variável **Antigo × Novo** | temos `lucroVariavelPrevisto`, `…Carreta`, `…Cavalo` e `Custo Variável Simulado`. Nada no dado diz qual é "antigo" | **um** parâmetro "Remuneração variável", com os quatro dentro, e a pergunta registrada |
| Manutenção Carroceria | `revestimento`, `faixaReflexiva`, `tacografo`, `rastreador` são itens de carroceria com valor em R$ | proposto, marcado "a confirmar" |
| Parâmetros Operação | `Organizacao de Compras` e `Prazo Pagamento` estão 100% vazios nos arquivos | parcial; cartão só aparece se houver valor |
| `carreta.ipvaLicenciamentoMensal` | o "mensal" é 4–12× **maior** que o suposto anual, com razão não constante | fica no parâmetro, `PRESUMED`, **fora de qualquer soma** — é o caso que originou a regra |

---

## 8. Impacto técnico

Legenda: **R** reutilizar · **A** adaptar · **C** criar.

### Banco de dados

| Item | Ação | Nota |
|---|---|---|
| `fact`, `entity`, `attribute`, `snapshot` | **R** | grão inalterado |
| `scope`, `snapshot_scope`, `scope_hash` | **R** | já multi-valor; só falta ser lido |
| `taxonomy_node` (eixo de custo) | **R** | **não tocar** — §3.4 |
| Eixo de família | **C**, mas **fora do banco na Fase 1** | mapa em código (§3.5, opção A) |
| Canal/Segmento como coluna de `snapshot` | **A** — *opcional* | derivável do `source_label`; só vira coluna se houver ≥2 canais |
| Estado de decisão por grupo | **C** — P1 | chave semântica `(unidade, canal, atributo, tipo, data)`; **nunca** `change.id` |
| Migrations | **nenhuma na Fase 1** | |

### Importação

| Item | Ação | Nota |
|---|---|---|
| Pipeline inteiro (`receiveFile → promote`) | **R** | nada muda |
| `parseVigenciaLabel` | **A** | `^EMPURRADA_…$` → `^([A-Z][A-Z0-9]*)_(\d{1,2})_(\d{1,2})_(\d{4})$`, capturando o canal. **Estritamente ampliação**: todo rótulo hoje aceito continua aceito, com o mesmo `effective_date` |
| `SCOPE_COLUMNS` | **R** | já cobre unidade, operador, regional |
| Reimportação | **nenhuma** | restrição do briefing, respeitada |

### Comparação

| Item | Ação | Nota |
|---|---|---|
| `engine.ts`, `impact.ts`, `classification.ts`, `composition.ts` | **R** | **nenhuma regra de comparação alterada** |
| `grouped.ts` — regras anti-mentira | **R** | as 7 regras seguem valendo |
| `getGroupedView(db, period)` | **A** | ganha `{ unidade?, canal?, base? }`; sem filtro, comportamento idêntico ao de hoje |
| `listPeriods` | **A** | passa a agrupar por `(scope_hash, effective_date)` — hoje agrupa só por data (§9 R1) |
| Agregação por família | **C** | soma de grupos **dentro de cada periodicidade**, reusando `summariseImpact` e a exclusão de dupla contagem |
| Agregação por veículo | **C** | idem, por `entity_id` |
| Comparação contra vigência **não adjacente** | **R** | `POST /change-sets` já faz; a Fase 1 só expõe melhor |

### APIs

| Rota | Ação |
|---|---|
| `GET /scopes` — unidades, canais, operadores, regionais com vigências | **C** |
| `GET /context` — a barra inteira já resolvida (unidade, canal, vigências, par padrão) | **C** |
| `GET /changes/families` — famílias com contagem e impacto | **C** |
| `GET /changes/grouped` | **A** — aceita `unidade`, `canal`, `base`, `family` |
| `GET /changes/summary` — resumo executivo | **C** |
| `GET /attributes/:code/series`, `/changes/:id/provenance`, `/curation/*`, `/imports/*` | **R** |
| `lib/api-spec/openapi.yaml` | **A** — já declara 15 caminhos que não existem; a limpeza entra junto |

### Frontend

| Item | Ação |
|---|---|
| Barra de contexto (unidade · canal · vigência · comparar com) | **C** |
| Tela de famílias | **C** |
| Tela de parâmetros dentro da família | **C** |
| `GroupCard` (cartão de grupo) | **R** — é exatamente o Nível 3 |
| `ChangeTable` + filtros | **R** — continua sendo o aprofundamento |
| Início atual | **A** — vira o destino do fluxo, com o contexto acima |
| `/alteracoes`, `/comparar`, `/curadoria`, `/versoes`, `/vigencias`, `/importacoes` | **R** — nada removido |
| Menu lateral | **A** — ganha o contexto no topo; **não** copiar o menu do Freightech |

### Taxonomia / curadoria

| Item | Ação |
|---|---|
| `DEFAULT_TAXONOMY` (22 nós) | **R** — intocada |
| `attribute.taxonomy_node_id` | **R** — **nenhum UPDATE** |
| `CONFIRMED_SEMANTICS` (17 entradas) | **R** |
| Mapa de famílias | **C** — arquivo novo, sem efeito em cálculo |
| Fila de curadoria ordenada por *alterações destravadas* | **C** — P1, alto retorno (7 atributos destravam 2.062 alterações, medição de `PROPOSTA-EXPERIENCIA.md`) |

---

## 9. Riscos

| # | Risco | Sev. | Evidência | Mitigação |
|---|---|---|---|---|
| **R1** | **Mistura de unidades.** `listPeriods` agrupa só por `effective_date` e `getGroupedView` seleciona change sets só por data. Duas unidades com a mesma vigência somariam num único total, sem aviso | **Alta** | `consolidated.ts:63`, `grouped.ts:650` | Chavear por `(scope_hash, effective_date)` **antes** de existir a segunda unidade. É correção, não funcionalidade |
| **R2** | **Quebrar importação ao ampliar o parser de vigência** | Alta | `LABEL_PATTERN` hoje aceita só `EMPURRADA_…` | Ampliação estritamente aditiva + teste que prova que os 9 rótulos reais produzem o mesmo `effective_date` de hoje. Sem isso, não mexer |
| **R3** | **Reclassificar atributos para caber nas famílias.** Mudaria `cost_class` de comparações futuras e divergiria do `taxonomy_path` já gravado | **Alta** | `change.taxonomy_path` é snapshotado por change set | Família em eixo separado (§3.4/3.5). **Zero UPDATE em `attribute`** |
| **R4** | **Somar naturezas diferentes para produzir um total de família.** Manutenção tem R$/km e meses; Pneu tem R$ e texto | **Alta** | regra 4 de `grouped.ts` | O total da família só soma grupos com `aggregation = SUM` e mesma periodicidade; o resto é contado e nomeado, nunca somado |
| **R5** | **Ressuscitar a dupla contagem pai/parcela** ao agregar por família. `custoFixo = finame + lucroFixo…` inflava o total em 71% em Ago/2026 | **Alta** | `composition.ts`; medição em `PROPOSTA-EXPERIENCIA.md` §P3 | A agregação por família **tem de** partir de `summariseImpact`, que já retira a dupla contagem — nunca somar `impact_amount` cru |
| **R6** | **Somar periodicidades para caber num cartão bonito** | Alta | a regra mais antiga do produto | Cartão com duas linhas quando há duas periodicidades. Se não couber, o layout muda — não o número |
| **R7** | **Perder histórico** | Média | — | Nenhuma migration, nenhuma reimportação, nenhum `UPDATE` em dado histórico. RAW segue sob trigger |
| **R8** | **Vocabulário novo apagando semântica existente.** "Impacto a verificar" apagaria a distinção `NOT_CALCULABLE` × `ESTIMATED` | Média | §6.5 | Usar o vocabulário existente; qualquer termo novo precisa de mapeamento 1-para-1 com um estado do motor |
| **R9** | **Categorias vazias virando promessa.** 25 dos 42 parâmetros do Freightech não têm dado | Média | §6.4 | Família sem atributo não aparece; a nota de rodapé explica a diferença de escopo |
| **R10** | **Familiaridade virando cópia.** Botão Filtrar, cartões gigantes, menu inteiro | Baixa | briefing | O que se copia é linguagem, hierarquia e agrupamento. Interação é do FreightCheck |
| **R11** | **Decisão amarrada a `change.id`.** `computeChangeSet` apaga e recria o conjunto | Média | `engine.ts` | Chave semântica, como já apontado em `PROPOSTA-EXPERIENCIA.md` §Nível 3 |
| **R12** | **Assumir que o canal ROTA se parece com EMPURRADA.** Nunca vimos um export de ROTA | Média | §2.3 | Não modelar EQUIPE/UNIFORMES/DESPESAS antes de ver um arquivo. O mapa de famílias aceita novas famílias sem migration |

---

## 10. Mockup textual

### 10.1 Entrada — contexto

```
┌────────────────────────────────────────────────────────────────────────────┐
│ FREIGHTCHECK                                                    Guy ▾      │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Unidade              Canal            Vigência atual      Comparar com    │
│  ┌────────────────┐   ┌────────────┐   ┌───────────────┐   ┌─────────────┐ │
│  │ CAMAÇARI       │   │ EMPURRADA  │   │ AGO/2026    ▾ │   │ JUL/2026  ▾ │ │
│  └────────────────┘   └────────────┘   └───────────────┘   └─────────────┘ │
│  Geo NE · OPERALOG    única no export   EMPURRADA_1_8_2026  EMPURRADA_2_7… │
│                                                                            │
│  62 cavalos · 71 carretas · 9 vigências no histórico                       │
└────────────────────────────────────────────────────────────────────────────┘
```

*(Unidade e Canal aparecem preenchidos e explicados porque só existe um de cada
no dado real. Viram seletores no dia em que houver dois.)*

### 10.2 Resumo executivo + famílias

```
┌────────────────────────────────────────────────────────────────────────────┐
│  De JUL/2026 para AGO/2026, o cliente mexeu em N pontos da sua remuneração.│
│  M merecem sua atenção.                                                    │
│                                                                            │
│  IMPACTO DESTA VIGÊNCIA          PERDAS         GANHOS                     │
│  R$ ______ /mês                  R$ ______      R$ ______   (por           │
│  R$ ______ /ano                  R$ ______      R$ ______    periodicidade)│
│                                                                            │
│  N alterações · C críticas · T com preço travado · X sem preço             │
│  R$ ____ excluído por já estar contado nas parcelas  ⓘ                     │
│                                                                            │
│  ⚠ Nesta vigência chegou só carreta. Falta cavalo — não contado como zero. │
└────────────────────────────────────────────────────────────────────────────┘

  FAMÍLIAS

  ┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
  │ FROTA                 │ │ TRIBUTOS E SEGUROS    │ │ AQUISIÇÃO E FINANC.   │
  │ 4 de 10 parâmetros    │ │ 1 de 3 parâmetros     │ │ 2 de 4 parâmetros     │
  │ ___ alterações        │ │ ___ alterações        │ │ ___ alterações        │
  │ ↓ R$ ____ /mês        │ │ ↓ R$ ____ /ano        │ │ ↑ R$ ____ /mês        │
  │ __ sem preço          │ │ significado confirmado│ │ __ travadas           │
  └───────────────────────┘ └───────────────────────┘ └───────────────────────┘

  ┌───────────────────────┐ ┌───────────────────────┐
  │ DIMENSÕES             │ │ MODELOS DE REMUNER.   │
  │ sem alterações        │ │ ___ alterações        │
  └───────────────────────┘ │ impacto não calculável│
                            └───────────────────────┘

  ▸ Famílias sem alteração nesta vigência (3)
  ─────────────────────────────────────────────────────────────────────────────
  O Freightech também publica Equipe, Uniformes e EPIs, Despesas Operacionais e
  Remuneração. Esses parâmetros não vêm no export de equipamento que o
  FreightCheck recebe hoje.
```

### 10.3 Família → parâmetros

```
  ← Voltar          FROTA · CAMAÇARI · JUL/2026 → AGO/2026

  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Pneu                    __ alterações   __ de 62 cavalos   ↓ R$ ____ /mês │
  ├───────────────────────────────────────────────────────────────────────────┤
  │ Combustível             __ alterações   __ de 62 cavalos   não calculável │
  │                         consumo é km/l — não somável                      │
  ├───────────────────────────────────────────────────────────────────────────┤
  │ Manutenção Cavalo       sem alterações                                    │
  ├───────────────────────────────────────────────────────────────────────────┤
  │ Manutenção BID          __ alterações   __ de 62 cavalos   preço travado  │
  │                         significado ainda não confirmado → destravar      │
  └───────────────────────────────────────────────────────────────────────────┘
```

### 10.4 Parâmetro → alterações (ANTES → AGORA → VARIAÇÃO → IMPACTO)

```
  ← Voltar    FROTA › Pneu › Pneu (valor) · cavalo

  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Pneu (valor)                                             significado ✓    │
  │ __ de 62 cavalos · __ padrões distintos antes→depois                      │
  │                                                                           │
  │ TOTAL DA FROTA   R$ ______  →  R$ ______     ____%                        │
  │ POR VEÍCULO      R$ ______  →  R$ ______     (soma ÷ __ veículos)         │
  │ IMPACTO          ↓ R$ ______ /mês            fórmula ⓘ                    │
  ├───────────────────────────────────────────────────────────────────────────┤
  │ Veículo    Anterior      Atual      Variação      Impacto                 │
  │ ABC1D23    R$ ______     R$ ______    ____%       ↓ R$ ____ /mês   célula │
  │ DEF4G56    R$ ______     R$ ______    ____%       ↑ R$ ____ /mês   célula │
  │ GHI7J89    R$ ______     ausente        —         não calculável   célula │
  │            └ o valor sumiu; ausência não é zero                           │
  ├───────────────────────────────────────────────────────────────────────────┤
  │ HISTÓRICO   dez jan fev mar abr mai jun jul ago                           │
  │             ▁▁  ▃▃  ▃▃  ▃▃  ▅▅  ▅▅  ▅▅  ▇▇  ▃▃    (soma e média/veículo)  │
  └───────────────────────────────────────────────────────────────────────────┘
```

### 10.5 Um parâmetro travado

```
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Manutenção (BID)                              preço travado               │
  │ __ de 62 cavalos · R$/km                                                  │
  │                                                                           │
  │ ANTES → AGORA          0,__ → 0,__ R$/km          ____%                   │
  │ IMPACTO                Impacto não calculável                             │
  │                        "Agregação NONE: é uma razão. Somar não faz        │
  │                         sentido e a média ponderada exigiria um peso      │
  │                         (quilometragem) que não vem neste export."        │
  │                                                                           │
  │ [ Confirmar significado ]   [ Ver as 9 vigências ]   [ Ver origem ]       │
  └───────────────────────────────────────────────────────────────────────────┘
```

---

## 11. O que eu preciso de você antes de escrever código

1. **A colocação do IPVA.** O Freightech publica IPVA/Licenciamento dentro de
   *Frota → Manutenção Cavalo*? Se sim, faço o atalho cruzado; se não, ele fica
   em *Tributos e seguros* (§7.3).
2. **Remuneração Variável: Antigo × Novo.** Qual das nossas colunas é qual? Sem
   isso, fica um parâmetro só.
3. **Manutenção Carroceria.** `revestimento`, `faixaReflexiva`, `tacografo` e
   `rastreador` pertencem a esse cartão no Freightech?
4. **Um export de outro canal ou de outra unidade.** É o único teste que valida
   R1 e R2 de verdade. Enquanto não existir, os dois riscos ficam teóricos — e é
   exatamente assim que eles costumam virar retrabalho.
5. **A lista de parâmetros do canal EMPURRADA.** As screenshots são de ROTA. Se
   o Freightech mostra famílias diferentes para EMPURRADA, o mapa de famílias
   muda antes de nascer.

---

## 12. Recomendação

Fazer em três etapas, aprovando o resultado de cada uma antes da seguinte:

| Etapa | Entrega | Custo | Risco |
|---|---|---|---|
| **E0 — correções que independem da nova UX** ✅ **feita** | chavear a leitura por `(scope_hash, canal, effective_date)`; ampliar o parser de vigência com teste de regressão | pequeno | **reduz** R1 e R2 |
| **E1 — a camada de navegação** ✅ **feita** | mapa de famílias em código; `GET /contexts` e `GET /changes/families`; barra de contexto; tela de Parâmetros com resumo executivo, famílias e parâmetros. Cartão de grupo reaproveitado como está | médio | baixo — nada abaixo da apresentação muda |
| **E2 — o que a familiaridade destrava** | fila de curadoria ordenada por alterações destravadas; estado de decisão por grupo com chave semântica; favoritos | médio | baixo |

**Nenhuma migration, nenhuma reimportação, nenhuma alteração em regra de
comparação, nenhum `UPDATE` em dado histórico em E0 e E1.**

### E0 — o que ficou pronto

| Mudança | Onde |
|---|---|
| Parser de vigência aceita qualquer canal e devolve o canal lido | `lib/ingest/src/vigencia.ts` |
| Derivação do canal em SQL, espelhando o parser, com teste que obriga os dois a concordar | `lib/comparison/src/series.ts` |
| Contexto = `(unidade, canal)`: listar, resolver, filtrar | `lib/comparison/src/series.ts` |
| Período, séries conhecidas, consolidado e backfill chaveados por contexto | `lib/comparison/src/consolidated.ts` |
| Visão agrupada, veículos do grupo, série do atributo e acumulado, idem | `lib/comparison/src/grouped.ts` |
| Vigência anterior e recusa de comparar canais diferentes | `lib/comparison/src/engine.ts` |
| `GET /contexts`; `scopeHash`/`canal` opcionais nas rotas de leitura; contexto inexistente vira 404 escrito | `artifacts/api-server/src/routes/changes.ts` |
| A tela diz de quem é a vigência, e avisa quando há contexto que não está somado ali | `artifacts/freightaudit/src/pages/inicio.tsx` |

**A prova de que nada mudou para o dado real:** as suítes `comparison-real` e
`grouped-real`, que reproduzem as contagens e os impactos das 9 vigências
importadas, continuam passando sem uma única asserção alterada.

### E1 — o que ficou pronto

| Mudança | Onde |
|---|---|
| Mapa de famílias e parâmetros, com origem declarada (Freightech × FreightCheck) e avisos de pendência | `lib/comparison/src/families.ts` |
| Agregação por família e parâmetro, resumo executivo, perdas/ganhos, top parâmetros e top veículos | `lib/comparison/src/families-view.ts` |
| `summariseImpact` aceita o índice de composição do conjunto inteiro | `lib/comparison/src/grouped.ts` |
| `GET /changes/families` | `artifacts/api-server/src/routes/changes.ts` |
| Barra de contexto: unidade · canal · vigência · comparar com, sem botão Filtrar, estado na URL | `artifacts/freightaudit/src/components/contexto/context-bar.tsx` |
| Tela **Parâmetros** | `artifacts/freightaudit/src/pages/parametros.tsx` |

**Quatro decisões que valem registro:**

1. **A soma das famílias fecha com o total da vigência**, dentro de cada
   periodicidade, e há teste sobre o dado real que prova isso. Sem ele, o
   agrupamento passaria confiança falsa.
2. **A dupla contagem sobreviveria ao agrupamento se ninguém cuidasse.**
   `carreta.custo_fixo` (Aquisição e financiamento) tem por parcela
   `lucro_fixomodelo_novo_ciclo` (Modelos de remuneração) — famílias
   *diferentes*. Uma fatia que montasse o próprio índice de composição não veria
   a parcela mudar e devolveria o titular para a soma. O índice é montado uma
   vez, sobre a vigência inteira, e passado para cada fatia.
3. **"Já contado nas parcelas" é um terceiro estado, e não "não calculável".**
   Em agosto/2026 o custo fixo mudou R$ 16.594,54/mês e ficou fora do líquido
   por isso. Chamar aquilo de não calculável seria falso; repetir o valor
   inflaria o total em 71%.
4. **"Comparar com" é um campo fixo, não um seletor.** Cada série compara contra
   a sua própria vigência anterior, e essas comparações são calculadas na
   importação. Oferecer um par arbitrário aqui faria abrir uma tela disparar
   cálculo pesado e o número passaria a depender de quem abriu primeiro — para
   escolher o par à mão existe Comparar Vigências, onde o cálculo é pedido de
   propósito.

**Onde a implementação se afasta do mockup do §10:** as famílias e os parâmetros
ficam numa página só, abrindo no lugar, em vez de cartão → página da família →
página do parâmetro. São dois cliques a menos para o mesmo destino, e o §"não
copiar a necessidade de muitos cliques" pesou mais do que o desenho em três
telas.

**Por que o canal não virou coluna:** `snapshot` é congelado por trigger quando
fecha, então uma coluna nova não poderia ser preenchida nas vigências já
importadas — e com um canal só no banco não há o que ela distinguisse. A
derivação vive em dois lugares (TypeScript na ingestão, SQL na leitura) e um
teste roda os dois sobre os mesmos rótulos para que não divirjam.

O objetivo, em uma frase: que quem abre o FreightCheck reconheça a unidade, o
canal, a vigência e as famílias que já conhece do Freightech — e, no mesmo
segundo, veja o que o Freightech nunca mostra: **o que mudou, quanto vale, e o
que ainda não dá para afirmar.**
