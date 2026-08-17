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

**Portas de entrada autorizadas — as três, e o que cada uma recebe:**

| Porta | Recebe | Escreve no canônico operacional? |
|---|---|---|
| **Importações** | dados operacionais canônicos | **sim** — é a origem do fato |
| **Alterações → Chamados** | dados e anexos de chamados | não o núcleo; escreve `ticket*` |
| **Book do Operador** | domínio documental separado | **não** — nunca |

> **Todo o restante do FreightCheck é consumidor.**

### A.3 O Book do Operador, formalmente

Registro da decisão, para que ela pare de depender de quem lembra dela:

1. **O Book pertence a outro domínio.** As portas `IMPORTAÇÕES` e `CHAMADOS`
   recebem *medida* — o que o ativo custa, o que foi pedido, o que voltou
   aplicado. O Book recebe *regra*: o contrato, o manual, a planilha de apoio, o
   texto escrito à mão no cartão do bloco. É o que o export do Freightec não
   traz, e é o que responde "em que isso se apoia?" quando alguém aponta para
   uma linha de remuneração.
2. **Não escreve no canônico operacional.** `book_entry` é a única tabela que
   ele toca. Nenhum motor de cálculo — `comparison`, `coverage`, `composition`,
   `dre`, `balance`, `simulation`, `curation`, `ingest` — a lê. Seus únicos
   leitores são a tela do Book e o índice do Assistente, que a **citam** como
   fonte de regra, com link, nunca como parcela de uma soma.
3. **Não é uma terceira porta de ingestão.** Importar arquivo por ali continua
   sendo o comportamento correto e deve ser preservado; o que ele nunca faz é
   virar número. A regra "duas portas" vale para o **canônico operacional**, e o
   Book está fora dela por natureza do que recebe, não por exceção concedida.
4. **A separação é protegida por teste, pelos dois lados.**
   `fronteira-do-book.test.ts` prova que a porta continua aceitando PDF, XLSX,
   DOCX e texto — para que ela não seja fechada por engano junto com as portas
   indevidas, com que se parece na superfície — **e** que nenhum motor de
   cálculo referencia `book_entry`, com caso de controle para que a asserção de
   ausência não passe fingindo.

### A.4 Fleet Analysis — o que preservar, ao migrar

> O mapa completo saiu daqui e virou ADR: **`docs/ADR-FLEET-ANALYSIS-CANONICO.md`**,
> com o de-para campo a campo, os quatro pontos onde a migração pode errar e o
> critério de aceitação. O resumo abaixo fica como índice.

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

### A.5 A autoridade de escrita — como a regra deixa de ser convenção

Implementada no PR-2 (`lib/db/src/autoridade.ts`). O contrato das duas portas
passa a ser conferido **no driver**: uma escrita numa tabela protegida só chega
ao Postgres se, naquele instante, existir uma autoridade declarada capaz de
fazê-la.

| Conjunto | Tabelas | Quem pode escrever |
|---|---|---|
| **Núcleo canônico** | `fact`, `snapshot`, `snapshot_scope`, `snapshot_attribute`, `snapshot_entity_type`, `snapshot_merge`, `entity`, `entity_identifier`, `scope` | `INGESTAO` |
| **Dicionário e classificação** | `attribute`, `attribute_alias`, `taxonomy_node` | `INGESTAO` ou `CURADORIA` |
| **Todo o resto** | `import_run`, `raw_*`, `staged_fact`, `change*`, `ticket*`, `coverage_expectation`, `book_entry`, … | livre |

**Por que duas autoridades e não uma.** A distinção é do domínio: a importação
*descobre* que existe uma coluna nova; a curadoria decide *o que ela significa*
e onde ela mora na árvore. Um fato não tem esse segundo dono — ninguém decide um
fato depois que ele foi lido —, e por isso `CURADORIA` nunca alcança o núcleo.
Uma autoridade única seria uma chave mestra.

**Onde a proteção mora.** No `pg.Pool` criado por `createDb`, e nos clientes que
saem dele — o que cobre a transação, que é por onde a promoção escreve tudo.
Guardar só o pool teria deixado passar exatamente o caminho que mais importa.
Como a conferência é sobre o **statement**, ela é indiferente à forma: drizzle,
SQL cru, helper genérico ou string montada em tempo de execução chegam todos ao
mesmo ponto.

**O que ela deliberadamente não faz.** Não bloqueia leitura. Não bloqueia
migration nem a ponte de deploy — as duas abrem o próprio `pg.Pool`, fora de
`createDb`, e é correto: uma migration é a autoridade que muda a *forma* do
canônico, e submetê-la à autoridade que protege o *conteúdo* inverteria a
hierarquia. E não substitui as garantias do banco: a vigência ativa única, a
imutabilidade do RAW e a identidade canônica continuam sendo do Postgres. A
autoridade protege *quem escreve*; o banco protege *o que fica escrito*.

**A concessão de teste é da conexão, não do ambiente.** `createTestDatabase`
concede `FIXTURE_DE_TESTE` ao banco descartável que cria, porque os fixtures
montam a camada canônica direto. Um processo de produção não tem como obtê-la —
nada lá chama aquela função. Amarrá-la a `NODE_ENV` teria deixado a porta aberta
para qualquer processo que exportasse a variável errada.

**As duas camadas de enforcement, e por que ambas.**

| | `fronteira-de-ingestao.test.ts` | `autoridade.ts` |
|---|---|---|
| Quando recusa | no CI, antes de existir execução | em runtime, quando o caminho roda |
| O que examina | o código-fonte | o statement |
| Ponto fraco | textual: não segue indireção nem string montada em runtime | só aparece quando alguém executa aquele caminho |
| O que entrega | **nomeia o arquivo** que não pode existir | não tem como ser contornada |

Uma pega antes; a outra pega sempre.

---

### A.6 Dívidas com prazo — aceitas até um PR nomeado, e não além

Uma dívida sem dono e sem prazo é uma decisão tomada por omissão. As que a
sequência está carregando, com o PR que as encerra:

| Dívida | Desde | Encerra em | Por que é aceitável até lá |
|---|---|---|---|
| ~~**`coverage` recorta por `scope_hash` cru**~~ | PR-7 | **PR-10 — encerrada** | Migrada de uma vez, sem solução intermediária: o pacote passou a depender de `@workspace/availability`, o recorte é `chaveDeEscopoSql`, a inferência recorta por `filtroDeSerie` e a disponibilidade por `filtroDeVigenciaDisponivel`. Nenhuma tradução de `scope_hash` foi criada dentro de `coverage` |
| ~~**`entity_type_set` na identidade da série**~~ | — | **PR-9 — encerrada** | Saiu da série no PR-9, junto com a comparação por componente. A cobertura de equipamento recorta o que duas vigências comparam entre si, e o que ficou de fora volta nomeado no resultado |
| **`scope_hash` legado aceito em `resolveContext`** | PR-7 | **PR-14** | Links e favoritos anteriores à mudança carregam o hash cru. Sai quando o front-end passar a usar o identificador novo explicitamente |

---

## Parte B — As definições concorrentes de série

`Arquivo/função | Como define a série | Campos utilizados | Módulos consumidores | Divergência possível | Definição correta proposta`

| # | Arquivo / função | Como define a série | Campos utilizados | Módulos consumidores | Divergência possível | Definição correta proposta |
|---|---|---|---|---|---|---|
| **B1** | `comparison/series.ts` → `listContexts`, `contextFilter` | "contexto" = unidade + canal; toda leitura recorta por ele | `scope_hash`, `substring(source_label …)` (**regex**), `status <> SUPERSEDED` | Alterações, Impacto, Panorama, Composição, DRE, Parâmetros, Consolidado, Assistente | **D1** CNPJ com/sem máscara parte a unidade em duas · **D2** rótulo em outra caixa parte o canal em dois | contexto = `(canonical_scope, canal)`, com `canal` lido da **coluna** |
| **B2** | ~~`comparison/series.ts` → `seriesKey`~~ | chave textual de série | `scope_hash`, `channelOf(source_label)` (**regex**), `entity_type_set` | `consolidated.ts::computeMissingChangeSets` — o backfill que roda **após toda promoção** | D1, D2 e **D3**: entrega parcial cria uma segunda série, e o backfill nunca liga as duas. **E faltava `dataset_family`** — `entity_type_set` mascarava a falta, porque cavalos e carretas de famílias diferentes também diferem no conjunto de equipamentos | **removida no PR-9.** Não foi substituída por outra função em memória: os três agrupamentos leem `chaveDeSerieSql` do banco, junto da vigência |
| **B3** | `comparison/engine.ts` → `findPreviousSnapshot` | a viva mais recente que precede, "da mesma série" | `source_system`, `scope_hash`, `entity_type_set`, `channelOf(source_label)`, `status`, `effective_date <` | `/changes/latest`, `grouped`, `families`, `end-to-end`, Painel, Acompanhamento | D1, D2, **D3** — devolve `null` e a tela diz "não há anterior" | `previousSnapshot()` = mesma série (B2) + viva + `max(effective_date) < alvo` |
| **B4** | `comparison/engine.ts` → guardas de `computeChangeSet` | recusa comparar pares "incomparáveis" | `scope_hash` igual, `entity_type_set` igual, `channelOf` igual | qualquer chamada a `computeChangeSet` | **D3**: recusa um par legítimo quando a cobertura de equipamento cresceu | guarda passa a ser `serieDe(a) === serieDe(b)`; equipamento presente só de um lado vira **componente não entregue**, não frota que mudou |
| **B5** | `routes/changes.ts:139` (`/changes/latest`) | agrupa snapshots em séries para escolher "a mais recente" | `scope_hash`, `entity_type_set` — **sem canal** | Alterações (aba Planilha), na abertura da tela | com dois canais na mesma unidade, agrupa canais diferentes e pode escolher a série errada | delegar a `serieDe()` |
| **B6** | ~~`ingest/chamados.ts` → `valoresVigentes`~~ | "a vigência mais recente da série", p/ dar o *antes* a um chamado | `DISTINCT ON (scope_hash, entity_type_set) … ORDER BY effective_date DESC` — **sem canal** | Chamados: `before_source = 'VIGENCIA'`, `before_reference`, impacto | buscava o *antes* numa vigência de **outro canal**, e gravava a procedência como se fosse a certa · com `entity_type_set` misto, elegia **duas** "mais recentes" que se sobrescreviam na ordem física das linhas | **migrado no PR-11**, e a pergunta mudou junto: não é "qual é a última de cada série", é **"qual foi o último valor desta placa"** — que é o que a chave de leitura `placa\|parâmetro` sempre assumiu. Disponibilidade e série vêm da autoridade; placa em mais de uma série **não tem antes** |
| **B7** | ~~`coverage/{observado,esperado,matriz}.ts`~~ | "recorte" da medição | `dataset_family`, `scope_hash`, `canal` (**coluna**) | Cobertura de dados (a tela inteira) | discordava de B1–B6 **no escopo**: aqui o hash cru, lá o canônico. O canal já era a coluna nos dois lados desde o PR-6 | **migrado no PR-10.** `chaveDeEscopoSql` no recorte, `filtroDeSerie` na inferência de esperado — que passou a receber a chave pronta em vez de remontá-la — e `filtroDeVigenciaDisponivel` no lugar de `status <> 'SUPERSEDED'` |
| **B8** | ~~`coverage/descoberta.ts` → `janelaDosAtributos`~~ | janela de aparição de cada atributo | `DISTINCT ON (dataset_family, effective_date)` e `lead() PARTITION BY dataset_family` — **sem escopo e sem canal** | `/coverage/discoveries`; **e o drill-down da célula** (`detalhe.ts`, que passava só `datasetFamily`) | com duas unidades, colapsava as duas na mesma data e sugeria renomeação cruzando unidades | **migrado no PR-12.** O recorte deixou de ser opcional e passou a ser a chave de série, exigida por assinatura. `descobertasDaSerie` mede uma série; `descobertas` é o único ponto que aceita filtro incompleto, e o resolve em N séries medidas separadamente — nunca sobre a união |
| **B9** | *(escrita)* `snapshot.canonical_snapshot_key` | identidade da **vigência**, coluna gerada pelo banco | `source_system`, `dataset_family`, `canal`, `effective_date`, `canonical_scope` | `pipeline.ts::promote` e os índices únicos | **nenhuma** — é a definição correta | **é ela.** A série é ela **sem** `effective_date` |
| **B11** | `comparison/end-to-end.ts` → `naPonta` | pareia as duas pontas do intervalo, "série com série" | `entity_type_set` como chave do `Map` de cada data | leitura ponta a ponta (Acompanhamento, cartão de intervalo) | **D3**, por outro caminho: abril com carretas e agosto com carretas e cavalos viram duas séries sem ponta do outro lado, e a tela diz "não há ponta inicial com que comparar" sobre um par que se compara | **encontrada durante o PR-9**, e corrigida nele: a chave passa a ser `chaveDeSerieSql`, e o que ficou de fora vem de `diff.componentes` |
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
   presente de um lado só fica **fora do recorte**, não vira `ENTITY_ADDED`.

**Como ficou (PR-9).** `diffSnapshots` lê `snapshot_entity_type` das duas pontas,
recorta os eixos 1 (valores), 2 (frota) e 4 (layout) aos componentes comuns e
devolve `componentes: { comuns, soEmA, soEmB }` junto do resultado. O que ficou
de fora não vira uma linha de `change` com rótulo próprio — vira **ausência de
comparação nomeada na leitura**: `grouped.ts` e `consolidated.ts` deixam
`changeSetId` nulo para esse componente e escrevem a frase que diz por quê. Foi
a escolha entre inventar uma alteração que não houve e declarar que não há
comparação; a segunda é a verdadeira, e é a que impede o zero de "não foi
comparado" de aparecer com a cara de "não mudou".

O vocabulário já existe e está testado: `impacto.ts` distingue `FORA_DA_FROTA`
(o ativo não está nesta vigência) de `NAO_ENTREGUE` (esta vigência não trouxe o
arquivo deste equipamento), e `grouped.ts` **já apresenta** o resultado por
componente. O que falta é a comparação usar a mesma distinção que a apresentação
já usa.

---

## Parte E — O contrato da autoridade central

> **Implementada no PR-5**, em `lib/availability` (`@workspace/availability`).
> Nenhum consumidor migrou. O que segue é o contrato como ele ficou, com as
> decisões que o desenho tomou e o que ainda calcula disponibilidade por conta
> própria.

### E.0 A fonte de verdade, determinada e registrada

> **Uma vigência está disponível quando existe uma linha em `snapshot` com
> `status = 'CLOSED'`.**

Não é escolha de conveniência de tela; sai do modelo, e cada alternativa foi
medida antes de ser descartada.

| Alternativa | Por que não |
|---|---|
| RAW / staging | a separação já é **estrutural**: `raw_cell` e `staged_fact` são outras tabelas, e `snapshot` só ganha linha dentro da transação de promoção. Medido num arquivo lido e conferido mas não promovido: 112 células RAW, 52 fatos em staging, `import_run` em `PREVIEWED`, **zero** linhas em `snapshot` |
| presença de fatos | uma vigência que entregou uma coluna inteira vazia continua entregue. Definir por `fact` faria "veio tudo vazio" e "não veio nada" darem a mesma resposta. Medido: 11.962 fatos declaram ausência e 17.717 são zero econômico |
| cobertura registrada | `@workspace/coverage` responde **quanto** do esperado nós temos — é medição *sobre* o disponível, e usá-la para defini-lo seria circular |
| combinação | disponibilidade é uma pergunta binária sobre existência. Misturar conteúdo nela é o que produz "não há dados" quando há |

**`DRAFT` não é observável.** Ele existe apenas dentro da transação da promoção
— ou vira `CLOSED` no mesmo commit, ou a transação volta atrás inteira. Medido:
uma promoção recusada por escopo ausente deixa zero linhas em `snapshot`. Por
isso `= 'CLOSED'` e `<> 'SUPERSEDED'` dão o mesmo conjunto, e a forma afirmativa
foi escolhida por dizer a regra em vez de listar exceções.

### E.0.1 O papel de cada tabela, verificado

| Pergunta | Autoridade | Verificado |
|---|---|---|
| a vigência existe? | `snapshot.status = 'CLOSED'` | 9 vivas / 9 substituídas no export real |
| de quem ela é? | `snapshot.canonical_scope` — **não** `scope_hash` | todas as 9 com escopo canônico não vazio |
| de que canal? | `snapshot.canal` — **não** o regex sobre o rótulo | — |
| que equipamentos entregou? | `snapshot_entity_type` — **não** `entity_type_set` | todas as 9 com agregado gravado |
| que colunas trouxe? | `snapshot_attribute.present_in_layout` | 1.809 pares, 0 fora do layout |
| como se chama a unidade? | `snapshot_scope` → `scope` | todas as 9 com escopo ligado |
| o valor de uma célula | `fact` — **conteúdo**, não existência | `fact_count` bate com `count(*)` |
| e `entity`? | **nenhum papel.** Entidade é global: as 144 do export estão nas nove vigências. Presença numa vigência é ter fato nela, e quem conta isso é `snapshot_entity_type` | 144 entidades, 144 em mais de uma vigência |

### E.0.2 O veredito, que é a razão de o módulo existir

```ts
type VeredictoDeDisponibilidade =
  | { estado: "DISPONIVEL";      vigencias: VigenciaDisponivel[] }
  | { estado: "VAZIO_GLOBAL" }                                  // o único "não há dados"
  | { estado: "VAZIO_NO_RECORTE"; existemEm: ContextoDisponivel[]; motivo: string }
```

Um módulo que recebe `VAZIO_NO_RECORTE` e escreve "não há dados" está mentindo,
e agora ele tem como saber disso — porque a resposta **diz onde o dado está**.
É o que transforma uma tela vazia numa tela que explica.

### E.0.3 Os cinco estados de uma célula

`VALOR` · `ZERO` · `NULO` · `NAO_ENTREGUE` · `INEXISTENTE` · `NAO_APLICAVEL`.
Seis, e não os quatro pedidos: o modelo canônico distingue "a coluna não veio no
layout" (`snapshot_attribute.present_in_layout`) de "a coluna veio e este ativo
não tem linha", e são as duas que os módulos mais colapsam. **Nenhum estado de
ausência devolve `0`** — há prova disso.

### E.0.4 Renomeação em relação ao esboço

`filtroDeVigenciaViva` → **`filtroDeVigenciaDisponivel`**. "Viva" era palavra
minha; "disponível" é a palavra que este PR define, e o predicado deve carregar
o nome da regra que ele aplica.

### E.0.5 Quem ainda calcula disponibilidade por conta própria

Nenhum consumidor migrou neste PR — por desenho. O inventário do que resta:

| Onde | O que reconstrói | Migra em |
|---|---|---|
| ~~`comparison/series.ts`~~ | **migrado**: canal pela coluna (PR-6) e escopo pelo canônico (PR-7), este último via `@workspace/availability` | — |
| ~~`comparison/engine.ts` (guardas de `computeChangeSet`)~~ | **migrado**: a guarda de `entity_type_set` saiu no PR-9 e a cobertura virou recorte por componente (`componentesDaComparacao`) | — |
| ~~`routes/changes.ts` (`/changes/latest`)~~ | **migrado**: a chave de série montada à mão saiu no PR-9; a rota agrupa por `chaveDeSerieSql`, lida do banco | — |
| `ingest/chamados.ts` (`valoresVigentes`) | "a mais recente" sem canal | PR-11 |
| `coverage/{observado,esperado,matriz}.ts` | recorte por `scope_hash` | PR-10 |
| `coverage/descoberta.ts` | janela sem escopo e sem canal | PR-12 |
| `comparison/query.ts` (`getOverview`) | contadores sem filtro de vigência | PR-13 |
| ~60 consultas com `status <> 'SUPERSEDED'` à mão | o predicado | PR-10 a PR-16 |
| `routes/fleet-analysis.ts` | lê `.xlsx` do disco | PR-15 |



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
| Primeira vigência da série, em Alterações | `409 "não há anterior"` | `EXISTS` + `PRIMEIRA_DA_SERIE` — **feito no PR-9**: a frase e o motivo vêm da autoridade, e o gatilho passou a ser só a primeira da série |
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
| **Alterações · Planilha** | ~~série própria em `routes/changes.ts`~~ — **migrado no PR-9**; `resolveContext`, `contextFilter`, `findPreviousSnapshot` já delegam | `resolverContexto`, `filtroDeContexto`, `vigenciaAnterior`, `chaveDeSerieSql` | PR-5→9 |
| **Alterações · Impacto** | `resolveContext`, `contextFilter`, `entity_type_set` p/ equipamentos | idem + `equipamentosDisponiveis`, `atributosDisponiveis` | PR-5→7, PR-9 |
| ~~**Alterações · Chamados**~~ | `DISTINCT ON (scope_hash, entity_type_set)` próprio | `filtroDeVigenciaDisponivel` + `chaveDeSerieSql`, com o *antes* ranqueado por placa | **PR-11 — feito** |
| ~~**Cobertura**~~ | recorte próprio `(dataset_family, scope_hash, canal)` | `filtroDeSerie` + `chaveDeEscopoSql` + `filtroDeVigenciaDisponivel` | **PR-10 — feito** |
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
| Desativar ingestão de `overview.ts` | nenhum | tudo | **operacional baixo** — o código era inalcançável, mas inalcançável não é o mesmo que sem dependências | teste: só um handler registra `POST /imports` |
| Autoridade central de escrita | nenhum no caminho feliz; escrita fora de autoridade passa a ser recusada | números do export real | **operacional baixo** — a recusa é nova, e um escritor legítimo não declarado falharia em runtime | o pipeline real roda por conexão sem concessão (`autoridade-do-pipeline.test.ts`) |
| Preservar o Book | nenhum | tudo | nenhum | `fronteira-do-book.test.ts` (já existe) |
| Disponibilidade com dono único | leituras deixam de aceitar `DRAFT` | números do export real inalterados | **operacional baixo** — `<> 'SUPERSEDED'` incluía `DRAFT`, e `= 'CLOSED'` não. `DRAFT` só existe dentro da transação da promoção (medido: promoção recusada deixa zero linhas), então o conjunto é o mesmo; o que muda é que uma promoção interrompida deixaria de aparecer em tela em vez de aparecer pela metade | `fronteira-da-disponibilidade.test.ts`: varredura com caso de controle, e prova negativa (recopiar o predicado em `dre/apuracao.ts` faz o teste falhar nomeando arquivo e linha) |
| Mapear Fleet Analysis | nenhum — é documento | tudo | nenhum | teste de caracterização do formato de resposta atual |
| Criar a autoridade sem consumidor | nenhum | tudo | nenhum | testes próprios da autoridade |
| Canal pela coluna | contextos deixam de se partir por caixa do rótulo | números do export real | **baixo** | `it.fails` de D2 inverte; export real idêntico |
| Escopo por `canonical_scope` | unidades deixam de se partir por máscara de CNPJ | números do export real | **médio** — `scopeHash` está na URL e na resposta de `/contexts`; precisa de chave estável nova | `it.fails` de D1 inverte; export real idêntico |
| `entity_type_set` fora da série | entrega parcial deixa de quebrar a série | números do export real | **médio** — exige a metade 2 (Parte D.3), senão frota vira preço | `it.fails` de D3 inverte; **e** prova de que equipamento novo entra como `NAO_ENTREGUE`, não `ENTITY_ADDED` |
| `vigenciaAnterior` única | `/changes/latest` e chamados param de poder cruzar canal | números do export real inalterados | **operacional baixo** — o chamado sobre uma placa que vive em dois canais deixa de receber um *antes*; hoje não existe placa assim no banco, e quando existir a resposta anterior era um palpite gravado como procedência | prova de que o *antes* de um chamado não cruza canal, com prova negativa: a consulta antiga faz o cenário do canal falhar |
| Cobertura pela autoridade | Cobertura e Impacto passam a ver o mesmo censo | percentuais do export real inalterados | **operacional baixo** — o recorte por escopo muda de chave, e a tela nunca envia `escopo` para `/coverage`; quem envia é a própria matriz, com a chave que acabou de ler | prova de censo comum entre módulos, no caso misto de CNPJ, medida nos dois lados |
| `janelaDosAtributos` com recorte | sugestão de renomeação para de cruzar unidades | com uma unidade, nada | **operacional baixo** — o recorte vira obrigatório por tipo, então nenhum chamador pode omiti-lo por engano; `/coverage/discoveries` continua aceitando filtro parcial e passou a medir série a série | cinco provas de isolamento, com prova negativa: a janela antiga faz as cinco falharem |
| `getOverview` filtrado | Painel para de divergir da Cobertura | export sem revisão: nada. Com revisão substituída no banco, os fatos caem pela metade — e o número anterior é que estava errado | **operacional baixo** — a tela não envia recorte hoje, então o caminho exercitado é o censo; o que muda no censo é a exclusão do que foi substituído | `painel.test.ts`: painel == cobertura, as partes fecham com o todo, e prova negativa em três casos |
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

| PR | O quê | Estado | Toca comportamento? |
|---|---|---|---|
| **PR-1** | Remover de `routes/overview.ts` os dois `POST` e as três leituras duplicadas; deixar só `GET /overview`. Enforcement em três alturas: rota, superfície e tabela | **feito** | não — o código era inalcançável |
| **PR-2** | **A autoridade central de escrita.** `fact`, `snapshot`, `entity`, `scope`, `entity_identifier` e `snapshot_*` só aceitam escrita sob autoridade declarada, conferida no driver. `CURADORIA` modelada à parte, para o dicionário. Formalização do Book (Parte A.3) | **feito** | sim, no caminho de recusa |
| **PR-3** | *(sem código)* O Book fica como está — a decisão está registrada na Parte A.3 e presa por `fronteira-do-book.test.ts`. Incorporado ao PR-2 | **feito** | não |
| **PR-4** | **Mapa** da migração de Fleet Analysis: `docs/ADR-FLEET-ANALYSIS-CANONICO.md` + `fleet-analysis-contrato.test.ts`, onde o de-para mora e é conferido. **Sem trocar a fonte** | **feito** | não |

A autoridade central subiu de P1 para P0 por decisão de 16/08/2026: a varredura
de código do PR-1 é uma boa rede e não pode ser a garantia arquitetural
definitiva, e a diferença entre as duas não devia ficar em aberto pela duração
de toda a sequência.

### P1 — autoridade da série e da disponibilidade

| PR | O quê | Inverte |
|---|---|---|
| **PR-5** | Criar a autoridade de **disponibilidade** com o contrato da Parte E e testes próprios. **Nenhum consumidor migra** — **feito** | — |
| **PR-6** | Canal passa a ser lido de `snapshot.canal` em `listContexts`/`contextFilter`/`findPreviousSnapshot`/`seriesKey`. Comentários vencidos de `series.ts` e `vigencia.ts` corrigidos — **feito** | `it.fails` de **D2** ✔ invertido |
| **PR-7** | Contexto passa a ser `(canonical_scope, canal)`; identificador novo, com o `scope_hash` antigo aceito por `resolveContext` — **feito** | `it.fails` de **D1** ✔ invertido |
| **PR-8** | `vigenciaAnterior` na autoridade; `findPreviousSnapshot` delega. Motivo nomeado no `null`, com `COBERTURA_DE_EQUIPAMENTO_DIFERENTE` tornando D3 legível. **Guarda de `entity_type_set` ainda de pé** — **feito** | — |
| **PR-9** | `entity_type_set` sai da série **e** comparação por componente — as duas metades juntas, nunca separadas. `seriesKey` deixa de existir: os três agrupamentos leem `chaveDeSerieSql` do banco — **feito** | `it.fails` de **D3** ✔ invertido |

### P2 — propagação

| PR | O quê |
|---|---|
| **PR-10** | **Cobertura** passa a usar a autoridade, encerrando a dívida do §A.6 — **feito**. Os outros consumidores daquela linha (Vigências, Comparar, Composição, DRE, Parâmetros, Assistente) saem do PR-10 e viram o **PR-10b**: sete módulos num diff só contrariam a regra de responsabilidade única, e o que tinha prazo marcado era a Cobertura |
| **PR-10b** | Vigências, Comparar, Composição, DRE, Parâmetros e Assistente passam a usar a autoridade. O que restava neles era **uma** coisa — `status <> 'SUPERSEDED'` copiado à mão —, porque o contexto canônico já lhes chegava por `contextFilter` desde o PR-7. As 46 cópias de leitura viram `filtroDeVigenciaDisponivel`, e um teste de fronteira recusa a quadragésima sétima — **feito** |
| **PR-11** | ~~`/changes/latest`~~ (feito no PR-9) e `valoresVigentes` (chamados) — **feito**. O *antes* de um chamado passa a ser o último valor **da placa**, com disponibilidade e série vindas da autoridade, e sem palpite quando a placa vive em mais de uma série |
| **PR-12** | `janelaDosAtributos` passa a exigir recorte — **feito**. A assinatura pede a chave de série, e as duas subconsultas de detalhe (entidades afetadas, rótulo da estreia), que também eram sem recorte, passaram a recortar |
| **PR-13** | `getOverview` filtra vivas e contexto — **feito**. Nove dos doze contadores liam o banco inteiro, não cinco: além dos fatos que a auditoria mediu, também os ativos (`entity` é global), as datas de primeira e última vigência, as comparações e as três contagens de alteração. Os três contadores de dicionário passaram a descrever as colunas **entregues no recorte** — mudança de significado, declarada |
| **PR-14** | `ContextBar` montado nas telas que recortam por contexto |
| **PR-15** | Fleet Analysis passa a ler o canônico, executando o mapa do PR-4 |
| **PR-16** | Remover as consultas paralelas que sobraram; teste que impede `status <> 'SUPERSEDED'` escrito à mão fora da autoridade |
| **PR-17** | **A prova de propagação por porta:** para cada dado que entra, uma prova de que todo módulo elegível o enxerga — o segundo grande objetivo da auditoria |

### P3 — semântica de estados vazios

| PR | O quê |
|---|---|
| **PR-18** | Separar as quatro causas de vazio do Impacto; vocabulário comum de vazio |
| **PR-19** | `NOT_APPLICABLE` explícito em Composição e DRE para equipamento sem regra |
| **PR-20** | `import_decision` na tela de Importações; `snapshot_merge` em Vigências |

**Regra de sequência:** PR-5 antes de qualquer consumidor. PR-6 e PR-7 antes de
PR-8. PR-8 antes de PR-9. Nada de P2 antes de todo o P1. Cada PR de P1 fecha com
o `it.fails` correspondente **invertido** e o export real produzindo números
idênticos.

**Sobre "risco nenhum".** Nenhum PR desta sequência é descrito assim, e o PR-1
foi corrigido para "risco operacional baixo". Código hoje inalcançável pode ter
dependências não percebidas — um teste que o importa, um bundle que o inclui, um
ambiente cuja ordem de montagem difere. Relatório de arquitetura não afirma
absolutos.

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
