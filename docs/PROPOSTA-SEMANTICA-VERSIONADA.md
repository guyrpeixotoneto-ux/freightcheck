# Proposta — semântica versionada por vigência

> Desenho para aprovação. **Nenhum código escrito.**
>
> Problema: hoje `attribute.unit`, `.periodicity`, `.aggregation`,
> `.is_monetary` e `.taxonomy_node_id` são valores únicos e atemporais. Se a
> Ambev mudar o significado de uma coluna no meio da série, o modelo não tem
> onde guardar isso — e, pior, a comparação financeira entre as duas metades
> da série ficaria silenciosamente errada.

---

## 1. A distinção que sustenta o desenho

Uma versão nova de semântica pode nascer por **dois motivos completamente
diferentes**, e confundi-los seria o pior erro possível:

| Origem | O que aconteceu | Efeito no tempo | Aparece em Alterações? |
|---|---|---|---|
| `SOURCE_SEMANTICS_CHANGE` | A fonte mudou o significado a partir de uma vigência | **Divide** a linha do tempo em duas versões | **Sim** — é notícia |
| `CURATION_CORRECTION` | Nós entendemos errado; o significado nunca mudou | **Corrige a versão existente** inteira | **Não** — é `CURATION_CHANGE` |

Se eu descobrir amanhã que `custoFixo` sempre foi trimestral, isso não é uma
mudança da Ambev — é um erro meu, e vale para toda a história. Tratá-lo como
versão nova faria o produto anunciar uma alteração de contrato que nunca
existiu. É exatamente o tipo de falso positivo que destrói a confiança.

---

## 2. O modelo

### Tabela nova: `attribute_semantics`

```
attribute_semantics
  id                    uuid
  attribute_id          uuid  -> attribute
  version               int         -- 1..n por atributo

  -- Vigência na linha do tempo DA FONTE, não na nossa.
  -- Casa com snapshot.effective_date.
  effective_from        date        -- inclusivo
  effective_until       date NULL   -- exclusivo; NULL = versão corrente

  -- A semântica em si
  unit                  text NULL
  periodicity           text NULL
  aggregation           text NULL
  is_monetary           boolean NULL
  taxonomy_node_id      uuid NULL

  -- NOVO: a base de cálculo (ver §4)
  calculation_basis     text NULL

  -- Status e responsabilidade (mesmas regras de F2)
  semantics_status      UNKNOWN | PRESUMED | CONFIRMED
  confirmed_by          text NULL
  confirmed_at          timestamptz NULL
  rationale             text

  -- Por que esta versão existe
  change_origin         SOURCE_SEMANTICS_CHANGE | CURATION_CORRECTION | INITIAL
  supersede_reason      text NULL
  -- De onde veio a evidência da mudança, quando houver
  evidence_snapshot_id  uuid NULL -> snapshot

  created_at            timestamptz
```

**Invariantes, no banco e não por convenção:**

- Períodos **não se sobrepõem** por atributo:
  `EXCLUDE USING gist (attribute_id WITH =, daterange(effective_from, effective_until) WITH &&)`
  (requer `btree_gist`).
- No máximo **uma** versão corrente por atributo:
  índice único parcial em `(attribute_id) WHERE effective_until IS NULL`.
- As mesmas duas travas de F2 migram para cá: `CONFIRMED` exige responsável;
  monetário `CONFIRMED` exige unidade, periodicidade e agregação.

### `attribute` continua existindo — como projeção da versão corrente

As colunas atuais **permanecem**, refletindo sempre a versão sem
`effective_until`. É isso que faz a migração não quebrar nada: a tela de
Curadoria, o registro de confirmações e o motor de F3 continuam lendo
`attribute.unit` e recebendo a resposta certa para "hoje".

Escrita passa a ser sempre pela API de curadoria, que grava em
`attribute_semantics` e atualiza a projeção na mesma transação.

---

## 3. Como cada requisito seu é atendido

### 1. Preservar o significado antigo

A linha antiga nunca é sobrescrita: ganha `effective_until` e fica. Uma versão
`CONFIRMED` só é editada por `CURATION_CORRECTION`, e mesmo aí o antes/depois
vai para `curation_event`.

### 2. Registrar o significado novo

Linha nova, `version + 1`, `effective_from` = a vigência em que passa a valer.

### 3. Identificar a mudança de semântica como uma alteração

Categoria nova em `change`, ao lado das três de F3:

```
SOURCE_CHANGE | FLEET_CHANGE | LAYOUT_CHANGE | SEMANTICS_CHANGE
```

Emitida quando, ao comparar A e B, as semânticas resolvidas nas duas datas
diferem **e** a versão nova tem `change_origin = SOURCE_SEMANTICS_CHANGE`.
`entity_id` nulo, `attribute_id` preenchido, `value_before`/`value_after` com a
tupla semântica. Uma linha por atributo — não uma por ativo.

Uma versão criada por `CURATION_CORRECTION` **não** emite `SEMANTICS_CHANGE`.

### 4. Impedir comparação financeira inválida

O ponto mais importante. Ao comparar, o motor resolve a semântica **na data de
cada lado** e aplica:

| O que difere entre A e B | Valor comparável? | Impacto calculável? | Como aparece |
|---|---|---|---|
| `unit` | **não** | **não** | `INCONCLUSIVE` — "a unidade mudou de R$ para R$/km entre as vigências; a diferença numérica não representa variação real" |
| `periodicity` | **não** | **não** | `INCONCLUSIVE` — "antes mensal, agora anual: 1.000 → 12.000 não é aumento" |
| `is_monetary` | **não** | **não** | `INCONCLUSIVE` |
| `calculation_basis` | **não** | **não** | `INCONCLUSIVE` — "a base de cálculo mudou" |
| `aggregation` | sim | **não** | comparável, mas fora da soma |
| `taxonomy_node_id` | sim | sim | comparável, com aviso de reclassificação |

O caso `periodicity` é o que mata: sem essa trava, uma coluna que vira anual
apareceria como aumento de 1.100% em toda a frota. Com ela, aparece como o que
é — uma mudança de significado, sem variação a calcular.

### 5. Rastreabilidade até arquivo/aba/linha/coluna

Inalterada — `fact.raw_cell_id` dos dois lados continua sendo a autoridade. O
que a versão acrescenta é *qual semântica valia de cada lado*:

```
ANTES  EMPURRADA_2_6_2026 · aba cavalos · linha 374 · coluna AU
       semântica v1: BRL, ANUAL, SUM, base "IPVA real por veículo"
AGORA  EMPURRADA_2_7_2026 · aba cavalos · linha 436 · coluna AU
       semântica v2: BRL, ANUAL, SUM, base "0,65% do valor da NF"
```

`snapshot_attribute` já guarda a posição da coluna por snapshot, então a
origem continua exata mesmo se a coluna mudar de lugar.

### 6. Não quebrar o que já existe

Migração em quatro passos, sem downtime lógico:

1. Criar `attribute_semantics` vazia.
2. **Backfill**: uma linha por atributo, `version = 1`,
   `change_origin = INITIAL`, `effective_from` = data do snapshot mais antigo
   da série (2025-12-02), `effective_until = NULL`, copiando as colunas atuais.
3. `attribute.*` vira projeção da versão corrente. Nenhuma query existente
   muda.
4. `change` ganha `semantics_version_a` / `semantics_version_b`.

**Comparações já calculadas continuam válidas:** com uma única versão por
atributo, os dois lados resolvem para a v1, nenhuma `SEMANTICS_CHANGE` é
emitida, e recomputar qualquer change set de F3 devolve exatamente os mesmos
3.202 resultados. Isso é testável e deve ser um teste de regressão.

---

## 4. Por que `calculation_basis` entrou no desenho

Ela não estava no seu pedido. Entrou porque **os dados reais exigiram**.

O caso do IPVA dos cavalos, que a investigação anterior desenterrou:

| Vigência | Valor / NF | O que é |
|---|--:|---|
| Dez/2025 | 0,8% a 3,7% (média 2,52%) | IPVA real, calculado por veículo |
| Jan–Jun/2026 | **1,000% exato, desvio zero** | percentual fixo sobre a NF |
| Jul–Ago/2026 | 0,535% a 1,193% (média 0,651%) | outra regra |

Aqui **unidade, periodicidade e agregação não mudaram** — continua BRL, anual,
somável. O que mudou foi a **regra que produz o número**. Sem um campo para
isso, essa mudança some do modelo, e o FreightCheck reporta uma queda de
R$ 720 mil como se fosse redução de custo, quando foi troca de fórmula.

Com `calculation_basis`, o caso vira três versões e a comparação entre a
segunda e a terceira sai marcada como inconclusiva — que é a verdade.

---

## 5. Segundo exemplo real: o `custoFixo`

Suponha que a Ambev passe a entregar `custoFixo` anualizado a partir de
Set/2026. Hoje isso seria reportado como **+1.100% em 71 carretas**, com
impacto somado de mais de R$ 12 milhões. Todo o número estaria errado.

Com o modelo proposto:

```
attribute_semantics (carreta.custo_fixo)
  v1  2025-12-02 → 2026-09-01   BRL, MENSAL, SUM   CONFIRMED por você
  v2  2026-09-01 → NULL         BRL, ANUAL,  SUM   origem SOURCE_SEMANTICS_CHANGE

change (SEMANTICS_CHANGE)
  carreta.custo_fixo   periodicidade: MENSAL → ANUAL

change (SOURCE_CHANGE) × 71
  comparability     = INCONCLUSIVE
  motivo            = "a periodicidade mudou de MENSAL para ANUAL entre as
                       duas vigências; a diferença numérica não representa
                       variação real"
  impacto           = NOT_CALCULABLE
```

Uma linha de notícia verdadeira, 71 linhas honestamente marcadas, e zero reais
de impacto falso.

---

## 6. O que isto custa

| Item | Tamanho |
|---|---|
| Migration `0004` + `btree_gist` | pequena |
| Backfill idempotente | pequeno |
| `resolveSemantics(attribute, data)` + cache por change set | pequeno |
| Travas de compatibilidade no motor de comparação | médio |
| `SEMANTICS_CHANGE` no motor e na tela | médio |
| Curadoria: criar versão × corrigir versão | médio — é a parte com mais risco de UX |
| Testes | ~15 casos |

O ponto de atenção é o último da lista de código: a tela precisa deixar
**inequívoco** se você está corrigindo um engano nosso ou registrando uma
mudança da fonte. São ações com consequências opostas e não podem compartilhar
um botão.

---

## 7. Decisões que preciso de você

1. **`calculation_basis` entra?** Ela resolve o caso do IPVA, que é real e já
   custou R$ 720 mil de leitura errada. Mas é um campo a mais para curar.
2. **Vigência por data ou por revisão?** Propus data (`effective_from`), que
   casa com `snapshot.effective_date`. A alternativa é ancorar em snapshot_id,
   mais preciso mas pior de operar quando chega uma revisão retroativa.
3. **Correção retroage sempre?** Propus que `CURATION_CORRECTION` valha para
   toda a versão. Se você quiser corrigir só de uma data em diante, isso vira
   um `SOURCE_SEMANTICS_CHANGE` — e eu acho que deve mesmo, mas quero seu aval.
