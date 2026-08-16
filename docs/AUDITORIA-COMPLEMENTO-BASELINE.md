# Complemento da auditoria — o baseline arquitetural

> **O que este documento é:** a classificação corrigida das entradas, o
> diagnóstico completo das definições concorrentes de série, e o **desenho** da
> autoridade central — contrato, não implementação.
> **O que ele não faz:** nenhuma linha de comportamento muda aqui. Nenhum helper
> novo foi espalhado. Nenhum dado histórico foi tocado. A semântica do canônico
> está intacta.
> **Base:** `docs/AUDITORIA-INGESTAO-PROPAGACAO.md`, cujas divergências D1–D3
> estão reproduzidas em banco e presas por teste.

---

## Parte A — Classificação corrigida

A auditoria anterior usava uma classe só para duas coisas diferentes, e a
diferença muda o que se faz com cada uma. **Uma porta se fecha; uma fonte
paralela se redireciona.** A taxonomia passa a ter cinco classes:

| Classe | Definição | Ação |
|---|---|---|
| `IMPORTAÇÕES` | porta oficial de entrada de **dado canônico** | preservar |
| `CHAMADOS` | porta oficial de entrada de **chamados** | preservar |
| `BOOK` | porta **documental** explicitamente permitida | preservar como está |
| `PORTA DE ENTRADA INDEVIDA` | **grava** dado por um caminho que não é porta | desativar |
| `FONTE PARALELA DE LEITURA INDEVIDA` | **lê** de fora do canônico; não grava | migrar a fonte, **preservar a funcionalidade** |

### A.1 A tabela corrigida

| # | Entrada / fonte | Rota | Grava? | Onde | Classe | Ação |
|---|---|---|---|---|---|---|
| 1 | Upload de vigência | `POST /imports` | sim | `source_file`, `raw_*`, `staged_fact` | **`IMPORTAÇÕES`** | preservar |
| 2 | Promoção | `POST /imports/:id/promote` | sim | `snapshot`, `entity`, `attribute`, **`fact`**, `snapshot_*` | **`IMPORTAÇÕES`** | preservar |
| 3 | Exclusão de importação | `DELETE /imports/:id` | sim | apaga canônico; grava `import_deletion` | **`IMPORTAÇÕES`** | preservar |
| 4 | Upload de chamados | `POST /ticket-imports` | sim | `ticket_import`, `ticket`, `ticket_change` | **`CHAMADOS`** | preservar |
| 5 | Exclusão de envio | `DELETE /ticket-imports/:id` | sim | apaga chamados; grava `ticket_import_deletion` | **`CHAMADOS`** | preservar |
| 6 | Documento / regra do bloco | `POST /book/entries` | sim | `book_entry` | **`BOOK`** | **preservar exatamente como está** |
| 7 | Upload-sombra | `POST /imports` em `routes/overview.ts` | sim | `source_file`, `raw_*`, `staged_fact` | **`PORTA DE ENTRADA INDEVIDA`** | desativar |
| 8 | Promoção-sombra | `POST /imports/:id/promote` em `routes/overview.ts` | sim | canônico | **`PORTA DE ENTRADA INDEVIDA`** | desativar |
| 9 | Análise de frota | `GET /fleet-analysis/*` | **não** | — lê `attached_assets/*.xlsx` do disco | **`FONTE PARALELA DE LEITURA INDEVIDA`** | **migrar a fonte; manter a tela** |
| 10 | Leituras duplicadas | `GET /imports`, `/imports/:id`, `/imports/:id/status` em `overview.ts` | não | — | fonte paralela **interna** (formato divergente) | desativar |
| 11 | Semeadura de dev | `pnpm dev:seed` | sim | canônico, **pelo mesmo pipeline** | `IMPORTAÇÕES` (CLI) | preservar |
| 12 | Curadoria, versões, cobertura, comparações | `POST /curation/*`, `/coverage/*`, `/change-sets` | sim | camadas **derivadas** | derivado | preservar |
| 13 | Identidade e conversa | `/auth/*`, `/users`, `/assistant/*` | sim | fora do domínio | não é dado de negócio | preservar |

### A.2 O contrato, na forma exata

> **Números entram por duas portas — Importações e Chamados.**
> **Regra que sustenta número entra pelo Book, e nunca vira número.**
> **Todo o resto do FreightCheck é consumidor de uma única realidade canônica.**

`BOOK` não enfraquece a regra: ela não recebe medida, recebe a regra que
justifica a medida. A fronteira está trancada por teste pelos dois lados —
`fronteira-do-book.test.ts` prova que ela continua aceitando arquivo **e** que
nenhum motor de cálculo lê `book_entry`.

### A.3 Fleet Analysis — o que preservar, ao migrar

A tela responde quatro perguntas que nenhuma outra responde. O contrato de saída
que a migração precisa reproduzir:

| Endpoint | Entrega hoje | Fonte canônica equivalente |
|---|---|---|
| `/fleet-analysis/summary` | vigências + rótulos, resumo por vigência | `availablePeriods` + `snapshot_entity_type` |
| `/fleet-analysis/summary` | financiamento por vigência | `fact` sobre atributos de financiamento (`carreta.finame*`, `cavalo.finame*`) |
| `/fleet-analysis/summary` | contagem por modelo, por vigência | `fact` sobre o atributo de modelo |
| `/fleet-analysis/summary` | contagem por status de ativo (`ativo`) | `fact` sobre `cavalo.ativo` |
| `/fleet-analysis/carretas` / `/cavalos` | linhas cruas, filtráveis por vigência | `fact` pivotado por `(entity, attribute)` — o mesmo que `entities/table` já faz |

Três coisas mudam para melhor na migração, e nenhuma é opcional: a tela passa a
**refletir o que foi importado** (hoje ela ignora as importações), ganha
**rastreabilidade até a célula** como o resto do produto, e passa a respeitar
unidade e canal em vez de somar tudo. O parser próprio com `EMPURRADA_` fixo
desaparece junto.

---

## Parte B — As definições concorrentes de série

`Arquivo/função | Como define a série | Campos utilizados | Módulos consumidores | Divergência possível | Definição correta proposta`

| # | Arquivo / função | Como define a série | Campos utilizados | Módulos consumidores | Divergência possível | Definição correta proposta |
|---|---|---|---|---|---|---|
| **B1** | `comparison/series.ts` → `listContexts`, `contextFilter` | "contexto" = unidade + canal; toda leitura recorta por ele | `scope_hash`, `substring(source_label …)` (**regex**), `status <> SUPERSEDED` | Alterações, Impacto, Panorama, Composição, DRE, Parâmetros, Consolidado, Assistente | **D1** CNPJ com/sem máscara parte a unidade em duas · **D2** rótulo em outra caixa parte o canal em dois | contexto = `(canonical_scope, canal)`, com `canal` lido da **coluna** |
| **B2** | `comparison/series.ts` → `seriesKey` | chave textual de série | `scope_hash`, `channelOf(source_label)` (**regex**), `entity_type_set` | `consolidated.ts::computeMissingChangeSets` — o backfill que roda **após toda promoção** | D1, D2 e **D3**: entrega parcial cria uma segunda série, e o backfill nunca liga as duas | `serieDe()` = `(source_system, dataset_family, canal, canonical_scope)` — **sem** `entity_type_set` |
| **B3** | `comparison/engine.ts` → `findPreviousSnapshot` | a viva mais recente que precede, "da mesma série" | `source_system`, `scope_hash`, `entity_type_set`, `channelOf(source_label)`, `status`, `effective_date <` | `/changes/latest`, `grouped`, `families`, `end-to-end`, Painel, Acompanhamento | D1, D2, **D3** — devolve `null` e a tela diz "não há anterior" | `previousSnapshot()` = mesma série (B2) + viva + `max(effective_date) < alvo` |
| **B4** | `comparison/engine.ts` → guardas de `computeChangeSet` | recusa comparar pares "incomparáveis" | `scope_hash` igual, `entity_type_set` igual, `channelOf` igual | qualquer chamada a `computeChangeSet` | **D3**: recusa um par legítimo quando a cobertura de equipamento cresceu | guarda passa a ser `serieDe(a) === serieDe(b)`; equipamento presente só de um lado vira **componente não entregue**, não frota que mudou |
| **B5** | `routes/changes.ts:139` (`/changes/latest`) | agrupa snapshots em séries para escolher "a mais recente" | `scope_hash`, `entity_type_set` — **sem canal** | Alterações (aba Planilha), na abertura da tela | com dois canais na mesma unidade, agrupa canais diferentes e pode escolher a série errada | delegar a `serieDe()` |
| **B6** | `ingest/chamados.ts:1544` → `valoresVigentes` | "a vigência mais recente da série", p/ dar o *antes* a um chamado | `DISTINCT ON (scope_hash, entity_type_set) … ORDER BY effective_date DESC` — **sem canal** | Chamados: `before_source = 'VIGENCIA'`, `before_reference`, impacto | busca o *antes* numa vigência de **outro canal**, e grava a procedência como se fosse a certa · com `entity_type_set` misto, elege **duas** "mais recentes" e uma delas é velha | `previousSnapshot()`/`latestOfSeries()` da autoridade, respeitando o canal |
| **B7** | `coverage/{observado,esperado,matriz}.ts` | "recorte" da medição | `dataset_family`, `scope_hash`, `canal` (**coluna**) | Cobertura de dados (a tela inteira) | discorda de B1–B6 **no canal**: aqui a coluna, lá o regex. Cobertura vê a vigência; Impacto não | mesmo recorte, com `canonical_scope` no lugar de `scope_hash` |
| **B8** | `coverage/descoberta.ts` → `janelaDosAtributos` | janela de aparição de cada atributo | `DISTINCT ON (dataset_family, effective_date)` e `lead() PARTITION BY dataset_family` — **sem escopo e sem canal** | `/coverage/discoveries`; **e o drill-down da célula** (`detalhe.ts:111`, que passa só `datasetFamily`) | com duas unidades, colapsa as duas na mesma data e sugere renomeação cruzando unidades | recorte **obrigatório**: `(dataset_family, canonical_scope, canal)` |
| **B9** | *(escrita)* `snapshot.canonical_snapshot_key` | identidade da **vigência**, coluna gerada pelo banco | `source_system`, `dataset_family`, `canal`, `effective_date`, `canonical_scope` | `pipeline.ts::promote` e os índices únicos | **nenhuma** — é a definição correta | **é ela.** A série é ela **sem** `effective_date` |
| **B10** | *(legado)* `db/bridge.ts` → `INDICES_LEGADOS` | identidade **anterior** à `0015`, recriada no deploy | `source_system`, `source_label`, `scope_hash`, `entity_type_set`, `revision` | nenhum módulo — é DDL de compatibilidade de publicação | — | remover quando a ponte de deploy não for mais necessária |

---

## Parte C — Por que dois módulos discordam sobre a mesma vigência anterior

A causa não é descuido espalhado. É **uma migração que aconteceu só de um lado**.

A migration `0015` trocou a identidade de vigência. Antes dela, a identidade era
o que `bridge.ts` ainda recria (B10):

```
(source_system, source_label, scope_hash, entity_type_set, revision)
     ↑              ↑              ↑            ↑
  sistema        rótulo        hash dos     conjunto de tipos
                 literal      códigos crus  que o arquivo trouxe
```

Depois dela, é a coluna gerada pelo banco (B9):

```
(source_system, dataset_family, canal, effective_date, canonical_scope)
                     ↑            ↑                          ↑
                 contrato    normalizado            normalizado, ordenado
```

Os três componentes que saíram — rótulo literal, `scope_hash` e
`entity_type_set` — saíram **exatamente porque dependiam da forma como o dado
chegou**, e o comentário do schema diz isso com todas as letras. O `promote`
migrou. **As oito leituras não.** Elas continuam falando a identidade pré-`0015`,
cada uma com um pedaço diferente dela.

O mecanismo da discordância, em três passos:

1. **A escrita normaliza; a leitura não.** `canonical_scope` põe o CNPJ mascarado
   e o sem máscara na mesma unidade; `snapshot.canal` põe `Empurrada` e
   `EMPURRADA` no mesmo canal. `scope_hash` e o regex de `source_label` não fazem
   nem uma coisa nem outra. Dois snapshots que o banco considera a mesma unidade
   e o mesmo canal são, para B1–B6, dois contextos distintos.
2. **Cada leitura escolheu um subconjunto diferente da chave velha.** B5 e B6
   esqueceram o canal; B8 esqueceu o escopo *e* o canal; B7 pegou o canal certo
   (a coluna) e o escopo errado (o hash). Nenhuma delas está "errada por
   descuido" — cada uma pegou o que precisava na hora em que foi escrita, e
   ninguém compôs as escolhas.
3. **`entity_type_set` é rótulo tratado como chave.** Ele **cresce** por
   construção (`pipeline.ts:1576`: união do que o arquivo trouxe com o que a
   revisão anterior tinha). B2, B3, B4, B5 e B6 o usam como identidade. Uma
   entrega parcial muda o rótulo e, para essas cinco, cria uma série nova.

O resultado é o que a auditoria reproduziu: Cobertura vê duas vigências, Impacto
vê uma, Alterações diz que não há anterior — **os três olhando as mesmas linhas
de `snapshot`**.

**A boa notícia, e é grande:** o banco já garante o que precisa ser garantido. O
índice `snapshot_canonical_live_uq` é `UNIQUE (canonical_snapshot_key) WHERE
status <> 'SUPERSEDED'`, e `canonical_snapshot_key` inclui `effective_date`. Logo
**existe no máximo uma vigência viva por (série, data)**. Acertada a série, "a
anterior" passa a ser não ambígua por construção — não por convenção, nem por
`ORDER BY` de desempate. Não falta garantia; falta usar a que existe.

---

## Parte D — A definição canônica de série

### D.1 As três chaves, e a relação entre elas

```
IDENTIDADE DA VIGÊNCIA   (já existe: snapshot.canonical_snapshot_key)
  = (source_system, dataset_family, canal, effective_date, canonical_scope)
                                              │
                                              └── tirando a data ↓

SÉRIE                     (a propor: canonical_series_key)
  = (source_system, dataset_family, canal, canonical_scope)
                          │
                          └── tirando a família ↓

CONTEXTO                  (o que o seletor da tela oferece)
  = (canonical_scope, canal)
```

- **Vigência** é o que o banco já identifica, e o índice único já protege.
- **Série** é o conjunto de vigências que **se sucedem**. Dentro dela, a ordem é
  `effective_date`, e há no máximo uma viva por data.
- **Contexto** é a projeção que a pessoa escolhe na tela: unidade e canal. Um
  contexto contém uma série por família de dataset — hoje uma só
  (`REMUNERACAO_EQUIPAMENTO`), e o modelo já está pronto para a segunda.

### D.2 O que **não** entra na série, e por quê

| Campo | Por que fica de fora |
|---|---|
| `effective_date` | é a **ordem dentro** da série, não a identidade dela |
| `entity_type_set` | é rótulo descritivo que **cresce** com entrega parcial (D3) |
| `scope_hash` | é hash dos códigos crus; o próprio schema o aposentou |
| `source_label` | é o identificador da origem, guardado literal; derivar identidade dele foi o defeito original |
| `revision` | revisão é história da mesma vigência, não outra vigência |
| `import_run_id`, `source_file_id` | arquivo não é unidade de medida — a regra já vale em Cobertura |

### D.3 Entrega parcial: a metade que não pode ser esquecida

Tirar `entity_type_set` da série é **necessário e não suficiente**. Se as guardas
de `computeChangeSet` (B4) caírem sem mais nada, a primeira vigência que trouxer
cavalos vai reportar "244 cavalos entraram" como crescimento de frota — que é
precisamente o erro que `impacto.ts` descreve na regra 2 e que
`end-to-end.ts` decompõe para evitar.

A correção tem duas metades, e a segunda é a que preserva a verdade dos números:

1. a série deixa de depender de `entity_type_set`;
2. a comparação passa a ser **por componente de equipamento**, e um equipamento
   presente de um lado só é marcado **`NAO_ENTREGUE`**, não `ENTITY_ADDED`.

O vocabulário já existe e está testado: `impacto.ts` distingue `FORA_DA_FROTA`
(o ativo não está nesta vigência) de `NAO_ENTREGUE` (esta vigência não trouxe o
arquivo deste equipamento), e `grouped.ts` **já apresenta** o resultado por
componente. O que falta é a comparação usar a mesma distinção que a apresentação
já usa.

---

## Parte E — O contrato da autoridade central

Nome proposto: **`lib/availability`** (`@workspace/availability`), ou
`comparison/src/disponibilidade.ts` promovendo `series.ts`. A escolha entre as
duas é do PR-4; o contrato é o mesmo.

### E.1 A superfície

| Função proposta | Equivalente pedido | Devolve |
|---|---|---|
| `contextosDisponiveis()` | — | um por `(canonical_scope, canal)`, com rótulo, nº de períodos e a mais recente |
| `resolverContexto(pedido?)` | — | o contexto pedido, ou o mais recente **dizendo qual escolheu** |
| `vigenciasDisponiveis(contexto?)` | `availableSnapshots` | as vigências vivas, o **censo** contra o qual todo módulo se mede |
| `periodosDisponiveis(contexto)` | `availablePeriods` | as datas distintas, ordenadas |
| `equipamentosDisponiveis(contexto \| vigência)` | `availableEntityTypes` | de `snapshot_entity_type`, com contagem |
| `atributosDisponiveis(contexto, equipamento?)` | `availableAttributes` | de `snapshot_attribute` + `attribute`, com tipo e semântica |
| `serieDe(snapshot)` | — | a chave de série (Parte D) |
| `vigenciaAnterior(snapshotId)` | `previousSnapshot` | a anterior da mesma série, ou `null` **com motivo** |
| `entregasPorPorta()` | `sourceAvailability` | o que cada porta entregou: `import_run`, `import_decision`, `ticket_import` |
| `filtroDeVigenciaViva(alias)` | — | o **único** lugar onde `status <> 'SUPERSEDED'` é escrito |
| `filtroDeContexto(alias, contexto)` | — | o **único** predicado SQL de contexto |
| — | `dataCoverage` | **já existe**: `@workspace/coverage`. Passa a consumir esta autoridade em vez de montar o recorte por conta própria |

### E.2 As oito perguntas

**1. Qual tabela é autoridade para cada informação**

| Informação | Autoridade | Por quê |
|---|---|---|
| a vigência existe | `snapshot` | — |
| a identidade dela | `snapshot.canonical_snapshot_key` | **coluna gerada pelo banco**; a aplicação não consegue escrevê-la errada |
| o canal | `snapshot.canal` | `NOT NULL` + `CHECK` de não vazio, normalizado na importação |
| o escopo | `snapshot.canonical_scope` | `CHECK` de forma canônica; `scope_hash` é **evidência**, não identidade |
| a família | `snapshot.dataset_family` | `CHECK` de não vazio; é o contrato da importação |
| quais equipamentos a vigência tem | **`snapshot_entity_type`** | contado na promoção, exato. `entity_type_set` é rótulo |
| quais colunas a vigência trouxe | `snapshot_attribute.present_in_layout` | distingue coluna ausente de valor ausente |
| o dicionário | `attribute` (+ `attribute_alias` para os nomes) | — |
| quanto do esperado nós temos | `@workspace/coverage` | já é autoridade única |
| o que cada porta entregou | `import_run` + `import_decision`; `ticket_import` | — |
| por que uma vigência sumiu | `snapshot_merge` | escrita hoje, lida por ninguém (D9) |

**2. Quais filtros globais devem existir**

Três, e nenhum escrito à mão em consulta nenhuma:

- `filtroDeVigenciaViva(alias)` — `status <> 'SUPERSEDED'`;
- `filtroDeContexto(alias, contexto)` — `canonical_scope = … AND canal = …`;
- `filtroDeSerie(alias, serie)` — o de contexto mais `dataset_family`.

**3. O que significa snapshot válido**

Três estados, e a diferença importa:

| Estado | Predicado | Quem lê |
|---|---|---|
| **existente** | linha em `snapshot` | ninguém, sozinho |
| **viva** | `status <> 'SUPERSEDED'` | **toda leitura de produto**, sempre |
| **histórica** | `status = 'SUPERSEDED'` | só quem pergunta pelo passado: histórico de lacuna, `snapshot_merge`, auditoria de revisão, exclusão |

`DRAFT` conta como viva de propósito: ela só existe dentro da transação de
promoção, e nenhum leitor a observa. O predicado é `<> 'SUPERSEDED'` e não
`= 'CLOSED'` porque é a transição que interessa, não o rótulo.

**4. Como `SUPERSEDED` entra na regra**

`SUPERSEDED` não é apagado — é a revisão anterior da **mesma** vigência. Ele
nunca entra numa contagem de "o que temos hoje" e sempre entra numa pergunta
sobre "o que tínhamos quando". Hoje o predicado está copiado à mão em ~60
consultas, e `getOverview` esqueceu-o em cinco contadores (D7): o Painel conta os
fatos das duas revisões. Uma função remove a classe inteira de erro.

**5. Como o canal é identificado**

Pela coluna `snapshot.canal`, e por mais nada. A derivação por rótulo
(`parseVigenciaLabel` → `normalizeChannel`) continua existindo **só na
importação**, que é onde o canal nasce. Os comentários de `series.ts` e
`vigencia.ts` que afirmam *"o canal não é coluna"* são anteriores à coluna e
precisam ser corrigidos junto — um comentário vencido é o que sustenta um regex
concorrente.

**6. Como o escopo é identificado**

Por `snapshot.canonical_scope`, que já tem `CHECK` de forma canônica no banco.
`scope_hash` permanece como coluna descritiva e como o que os snapshots antigos
gravaram; deixa de ser chave de leitura. Comparação de escopos é comparação do
`jsonb` canônico, não do hash.

**7. Como equipamento parcial/completo afeta a série**

**Não afeta.** A série é `(sistema, família, canal, escopo)`. Entrega parcial
afeta:

- **a comparação**, que passa a ser por componente, com `NAO_ENTREGUE` para o
  equipamento ausente de um dos lados (Parte D.3);
- **a cobertura**, que já sabe disso e já mede por equipamento;
- **o Impacto**, que já pinta a coluna como `NAO_ENTREGUE` e já está correto.

`entity_type_set` continua sendo gravado e continua sendo útil — como
**descrição** do que a vigência cobre. Só deixa de ser chave.

**8. Quem decide qual é o snapshot anterior**

`vigenciaAnterior(snapshotId)`, e ninguém mais. A regra: mesma série, viva,
`max(effective_date)` estritamente menor que a do alvo. Não há desempate porque
não pode haver empate — `snapshot_canonical_live_uq` garante no máximo uma viva
por `(série, data)`.

Quando não houver anterior, a função devolve **`null` com motivo nomeado**, e não
`null` mudo:

| Motivo | Significa |
|---|---|
| `PRIMEIRA_DA_SERIE` | é a mais antiga da série — estado legítimo |
| `SERIE_DESCONHECIDA` | o snapshot não resolve série (dado corrompido) |

A distinção existe porque hoje `null` significa as duas coisas, e a tela escreve
a mesma frase para ambas.

---

## Parte F — O contrato `EXISTS / ELIGIBLE / CALCULABLE / NOT_APPLICABLE`

### F.1 Os quatro estados

| Estado | Pergunta que responde | Quem decide | Regra de ouro |
|---|---|---|---|
| `EXISTS` | o dado está no canônico? | a **autoridade de disponibilidade** — e só ela | é o censo; nenhum módulo tem opinião própria |
| `ELIGIBLE` | esse dado faz sentido **neste** módulo? | o **contrato de elegibilidade** do módulo | declarado, não inferido de uma consulta vazia |
| `CALCULABLE` | há informação suficiente para o cálculo? | o **motor** do módulo | semântica confirmada, unidade, denominador, ponta anterior |
| `NOT_APPLICABLE` | o dado existe e este módulo não se aplica a ele | o contrato de elegibilidade | **nunca** é "sem dados" |

### F.2 A regra que nenhum módulo pode violar

> **`NOT_APPLICABLE` e `NOT_CALCULABLE` jamais são traduzidos como "nenhum dado
> existente".**

Corolário operacional, e é o que dá para verificar em teste: **um módulo só pode
dizer "não há dados" quando `EXISTS` for falso** — e `EXISTS` só a autoridade
responde. Se a autoridade diz que existe e o módulo mostra vazio, ou o módulo
está errado, ou ele deve `NOT_APPLICABLE`. Não há terceira saída.

### F.3 A máquina de estados, por módulo

```
                      EXISTS?  ──não──▶  "Nenhum dado importado"
                         │ sim
                         ▼
                    ELIGIBLE?  ──não──▶  "Não se aplica a esta análise"
                         │ sim                (e diz por quê)
                         ▼
                  CALCULABLE?  ──não──▶  "Existe, mas não é calculável"
                         │ sim                (e diz o que falta)
                         ▼
                    tem linha?  ──não──▶  "O filtro atual não retornou nada"
                         │ sim
                         ▼
                      o número
```

### F.4 Aplicado aos casos reais medidos

| Situação medida | Hoje | Deve ser |
|---|---|---|
| Equipamento sem atributo numérico, em Impacto | `404 "Nenhuma vigência importada ainda."` | `NOT_APPLICABLE` — "este equipamento não tem parâmetro numérico no dicionário" |
| Primeira vigência da série, em Alterações | `409 "não há anterior"` | `EXISTS` + `PRIMEIRA_DA_SERIE` — correto na frase, hoje errado no gatilho (D3) |
| Terceiro equipamento, em Composição/DRE | tela simplesmente não o mostra | `NOT_APPLICABLE` — "não há regra de composição declarada para este equipamento" |
| Chamado aberto, sem impacto | `NOT_CALCULABLE` com motivo | **já correto** |
| Atributo `PRESUMED` em Impacto financeiro | `somavel: false`, escolhível | **já correto** |
| Segunda unidade, em Alterações | invisível e silenciosa | `EXISTS` + "você está vendo um contexto; existem outros" |
| Vigência fundida por revisão parcial | some sem explicação | `EXISTS` + "fundida em X" (`snapshot_merge`) |
| Arquivo recusado por duplicata de dados | some sem explicação | `EXISTS` + o motivo de `import_decision` |

---

## Parte G — Módulos que migram para a autoridade

| Módulo | O que ele chama hoje | O que passa a chamar | Ordem |
|---|---|---|---|
| **Alterações · Planilha** | `resolveContext`, `contextFilter`, `findPreviousSnapshot`, série própria em `routes/changes.ts` | `resolverContexto`, `filtroDeContexto`, `vigenciaAnterior`, `serieDe` | PR-5→8, PR-10 |
| **Alterações · Impacto** | `resolveContext`, `contextFilter`, `entity_type_set` p/ equipamentos | idem + `equipamentosDisponiveis`, `atributosDisponiveis` | PR-5→7, PR-9 |
| **Alterações · Chamados** | `DISTINCT ON (scope_hash, entity_type_set)` próprio | `vigenciaAnterior` / `latestOfSeries` | PR-10 |
| **Cobertura** | recorte próprio `(dataset_family, scope_hash, canal)` | `filtroDeSerie` + `vigenciasDisponiveis` | PR-9 |
| **Cobertura · descobertas** | `janelaDosAtributos` sem recorte | recorte obrigatório | PR-11 |
| **Vigências** | `listComparableSnapshots` (sem recorte) | `vigenciasDisponiveis()` — sem contexto continua sendo o censo inteiro, **por escolha declarada** | PR-9 |
| **Comparar** | `listComparableSnapshots` + `computeChangeSet` | idem + guarda por `serieDe` | PR-8, PR-9 |
| **Composição** | `resolveContext`, `contextFilter`, `REGRAS` fixas | idem + `NOT_APPLICABLE` p/ equipamento sem regra | PR-5→7, PR-16 |
| **DRE** | `resolveContext`, `contextFilter`, `plano.ts` fixo | idem | PR-5→7, PR-16 |
| **Parâmetros** | `/changes/families` com contexto | autoridade | PR-9 |
| **Visão geral** | contadores sem filtro | `vigenciasDisponiveis` + `filtroDeVigenciaViva` | PR-12 |
| **Acompanhamento, Início** | `/changes/grouped` | autoridade, via as rotas acima | PR-9 |
| **Seletores (sidebar, ContextBar)** | `/contexts` | `contextosDisponiveis` | PR-13 |
| **Assistente** | `listContexts`, `resolveContext`, `contextFilter` | autoridade | PR-9 |
| **Análise de frota** | `.xlsx` do disco | `vigenciasDisponiveis` + `fact` | PR-3 (mapa), PR-14 (execução) |
| **Balanço de massa** | por `import_run` | **não migra** — a unidade dele é a importação, e está certo | — |
| **Curadoria, Versões** | dicionário, sem recorte | **não migram** — o dicionário é global por natureza | — |
| **Book do Operador** | `book_entry` | **não migra** — e não pode | — |

---

## Parte H — Impacto esperado de cada mudança

Uma propriedade vale para tudo abaixo, e é o que torna a sequência segura: **no
export real, nenhuma destas mudanças altera um único número.** Lá
`scope_hash` ↔ `canonical_scope`, `canal` ↔ regex e `entity_type_set` são todos
constantes — é por isso que as divergências não aparecem nele. Logo cada PR tem
um critério de aceitação objetivo: *as provas sobre o export real devem produzir
resultados idênticos aos de hoje.* O que muda é o que o produto passa a enxergar
**fora** desse caminho estreito.

| Mudança | Impacto visível | Não muda | Risco | Como se verifica |
|---|---|---|---|---|
| Desativar ingestão de `overview.ts` | nenhum | tudo | **nenhum** — código inalcançável | teste: só um handler registra `POST /imports` |
| Preservar o Book | nenhum | tudo | nenhum | `fronteira-do-book.test.ts` (já existe) |
| Mapear Fleet Analysis | nenhum — é documento | tudo | nenhum | teste de caracterização do formato de resposta atual |
| Criar a autoridade sem consumidor | nenhum | tudo | nenhum | testes próprios da autoridade |
| Canal pela coluna | contextos deixam de se partir por caixa do rótulo | números do export real | **baixo** | `it.fails` de D2 inverte; export real idêntico |
| Escopo por `canonical_scope` | unidades deixam de se partir por máscara de CNPJ | números do export real | **médio** — `scopeHash` está na URL e na resposta de `/contexts`; precisa de chave estável nova | `it.fails` de D1 inverte; export real idêntico |
| `entity_type_set` fora da série | entrega parcial deixa de quebrar a série | números do export real | **médio** — exige a metade 2 (Parte D.3), senão frota vira preço | `it.fails` de D3 inverte; **e** prova de que equipamento novo entra como `NAO_ENTREGUE`, não `ENTITY_ADDED` |
| `vigenciaAnterior` única | `/changes/latest` e chamados param de poder cruzar canal | números do export real | baixo | prova de que o *antes* de um chamado vem do mesmo canal |
| Cobertura pela autoridade | Cobertura e Impacto passam a ver o mesmo censo | percentuais do export real | baixo | prova de censo comum entre módulos |
| `janelaDosAtributos` com recorte | sugestão de renomeação para de cruzar unidades | com uma unidade, nada | baixo | prova de isolamento de escopo (já existe uma para `descobertas`) |
| `getOverview` filtrado | Painel para de divergir da Cobertura | export sem revisão: nada | baixo | prova: painel == cobertura |
| `ContextBar` montado | a segunda unidade fica alcançável | com uma unidade, nada | baixo | prova de tela |
| Fleet Analysis no canônico | a tela **volta a ter dado** | — | médio | teste de caracterização do PR-3 |
| Estados vazios | frases passam a distinguir os casos | números | baixo | uma prova por estado |

**Sobre o risco médio de `scope_hash`:** ele é hoje chave de URL
(`?scopeHash=…`), campo de resposta de `/contexts`, `/dre`, `/composition` e
`/coverage`, e estado de tela em Parâmetros e no seletor da sidebar. A migração
precisa de um identificador de contexto **estável e opaco** — o hash do
`canonical_scope` serializado serve, e nasce estável porque o escopo canônico é
ordenado e normalizado. O campo antigo pode continuar sendo aceito na query por
uma versão, mapeado para o novo, para não quebrar link colado.

---

## Parte I — A ordem exata dos PRs

### P0 — fronteiras arquiteturais

| PR | O quê | Toca comportamento? |
|---|---|---|
| **PR-1** | Remover de `routes/overview.ts` os dois `POST` e as três leituras duplicadas; deixar só `GET /overview`. Teste que impede um segundo handler para `POST /imports` | não — o código é inalcançável |
| **PR-2** | **Nada a fazer.** O Book fica como está; a fronteira já está presa por teste. Listado para que a preservação seja uma decisão registrada, e não um esquecimento | não |
| **PR-3** | **Mapa** da migração de Fleet Analysis: ADR + teste de caracterização do formato de resposta atual + o de-para da Parte A.3. **Sem trocar a fonte** | não |

### P1 — autoridade da série e da disponibilidade

| PR | O quê | Inverte |
|---|---|---|
| **PR-4** | Criar a autoridade com o contrato da Parte E e testes próprios. **Nenhum consumidor migra** | — |
| **PR-5** | Canal passa a ser lido de `snapshot.canal` em `listContexts`/`contextFilter`/`findPreviousSnapshot`. Corrigir os comentários vencidos de `series.ts` e `vigencia.ts` | `it.fails` de **D2** |
| **PR-6** | Contexto passa a ser `(canonical_scope, canal)`; identificador de contexto novo, com o antigo aceito por compatibilidade | `it.fails` de **D1** |
| **PR-7** | `vigenciaAnterior` na autoridade; `findPreviousSnapshot` delega. Motivo nomeado no `null`. **Guarda de `entity_type_set` ainda de pé** | — |
| **PR-8** | `entity_type_set` sai da série **e** comparação por componente com `NAO_ENTREGUE` — as duas metades juntas, nunca separadas | `it.fails` de **D3** |

### P2 — propagação

| PR | O quê |
|---|---|
| **PR-9** | Cobertura, Vigências, Comparar, Composição, DRE, Parâmetros, Assistente passam a usar a autoridade |
| **PR-10** | `/changes/latest` e `valoresVigentes` (chamados) passam a usar `serieDe`/`vigenciaAnterior` |
| **PR-11** | `janelaDosAtributos` passa a exigir recorte |
| **PR-12** | `getOverview` filtra vivas e contexto |
| **PR-13** | `ContextBar` montado nas telas que recortam por contexto |
| **PR-14** | Fleet Analysis passa a ler o canônico, executando o mapa do PR-3 |
| **PR-15** | Remover as consultas paralelas que sobraram; teste que impede `status <> 'SUPERSEDED'` escrito à mão fora da autoridade |

### P3 — semântica de estados vazios

| PR | O quê |
|---|---|
| **PR-16** | Separar as quatro causas de vazio do Impacto; vocabulário comum de vazio |
| **PR-17** | `NOT_APPLICABLE` explícito em Composição e DRE para equipamento sem regra |
| **PR-18** | `import_decision` na tela de Importações; `snapshot_merge` em Vigências |

**Regra de sequência:** PR-4 antes de qualquer consumidor. PR-5 e PR-6 antes de
PR-7. PR-7 antes de PR-8. Nada de P2 antes de todo o P1. Cada PR de P1 fecha com
o `it.fails` correspondente **invertido** e o export real produzindo números
idênticos.

---

## Parte J — O protocolo dos `it.fails`

Eles são documentação executável de bug conhecido, e têm data de validade. Ao
corrigir cada divergência, no **mesmo PR**:

1. **apagar o `.fails`** — o teste vira `it` normal;
2. **não mexer no corpo** — ele já afirma o comportamento correto; se precisar
   ser reescrito para passar, a correção não é a correção;
3. **manter o `it` irmão**, o que prova que o dado existe no canônico. Ele não é
   redundante: é ele que impede a leitura preguiçosa de "então o arquivo não
   entrou" no dia em que o par voltar a falhar;
4. **manter o cenário sintético**, que é o que o export real não exercita.

O par sobrevive à correção e vira proteção permanente contra a regressão que
motivou tudo isto:

> *"O dado está no banco, mas determinada área do produto não sabe que ele
> existe."*

Um `it.fails` que ficasse depois da correção seria pior que inútil: o Vitest
responde `Error: Expect test to fail` quando a invariante passa a valer — ou
seja, **a suíte fica vermelha até alguém vir aqui**. É de propósito. É o
lembrete de que a divergência tem dono.

---

## O baseline, em uma frase

Importações e Chamados são as únicas portas de número; o Book é a porta
documental permitida e não vira número; Fleet Analysis é uma leitura fora do
lugar que se redireciona sem perder a tela; e as oito definições de série são
oito cópias da identidade que a `0015` aposentou — a escrita migrou, a leitura
não, e é essa defasagem que faz dois módulos discordarem sobre a mesma vigência
anterior.
