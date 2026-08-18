# O grão do Trecho — levantamento, medição e desenho

Este documento responde a três perguntas, nesta ordem: **qual é a chave do
trecho**, **o que no produto assume hoje que toda linha tem placa**, e **o que
precisa mudar para que remuneração por viagem seja classificada sem gambiarra
mensal**.

Ele não implementa nada. O que já foi implementado — a recusa do arquivo que não
produz fato — está em `lib/ingest/src/sem-fatos.ts` e é assunto encerrado; a
partir daqui é desenho, com as medições que existem e as que faltam nomeadas
como tal.

---

## 1. O que o arquivo de trecho entrega

O repositório não tem o `Modelo Trecho.xlsx`. Tem, em `docs/planilha-atributos-frete-dre.xlsx`,
o **dicionário** dessa tabela: 110 colunas, com nome gerencial, descrição e
categoria de DRE por coluna. É evidência de primeira mão sobre o layout, e é dela
que sai tudo o que segue. O que ela **não** dá é a distribuição dos valores — e é
disso que depende a escolha da chave.

O grão está declarado na descrição da própria coluna `Vigencia`:

> "Quinzena de validade da linha da tabela. Toda a tabela é versionada por
> vigência: **a mesma origem–destino** pode ter preço e parâmetros diferentes em
> quinzenas diferentes."

As colunas que descrevem a identidade da linha:

| Coluna | Nome gerencial | O que é |
|---|---|---|
| `chaveTrecho` | Chave do trecho - campo chave | o cadastro declara esta como a chave |
| `_id` | Identificador do registro | id do registro na origem |
| `Origem`, `origem SAP`, `origem TMS` | unidade de origem | três codificações do mesmo lugar |
| `Destino`, `destino SAP`, `destino TMS` | unidade de destino | idem |
| `Unidade - CNPJ`, `Operador - CNPJ`, `Unidade - Regional` | escopo | já são escopo hoje (`SCOPE_COLUMNS`) |
| `Capacidade` | Capacidade de pallet | direcionador operacional — **pode partir a rota em duas linhas** |
| `turnoEmpurrada`, `regiaoEmpurrada` | modelo de remuneração / região | idem |

E a natureza econômica da tabela, que é o que a torna diferente de cavalo e
carreta: **as colunas de dinheiro vêm em duas famílias**, e as duas estão no
dicionário lado a lado —

- `freteReaisKM*` — R$ **por km** (diesel, pedágio, pneu, seguro, lavagem, manutenção…)
- `freteReaisViagem*` — R$ **por viagem** (as mesmas rubricas, na outra base)

mais os direcionadores que convertem uma na outra: `kmIda`, `kmVolta`,
`kmRodado`, `previsaoViagens`, `kmRodadoMesPorEquipe`, `diasMes`.

Isso importa para a seção 4: **nenhuma dessas colunas é R$/mês**.

---

## 2. A chave — o que falta para decidir, e como ela será decidida

**Não escolhi a chave, e não vou escolher por leitura.** `chaveTrecho` está
descrita como "campo chave", e isso é o que o *cadastro* chama de chave. O que a
importação precisa saber é outra coisa: se ela identifica uma linha dentro de
uma vigência **sem repetir e sem faltar**, e se ela **permanece** entre
quinzenas. As duas perguntas se respondem contando linhas, não lendo descrições.

Por que isso não é preciosismo: escolher a chave errada não dá erro, dá dado
errado em silêncio. Uma chave que repete faz duas rotas virarem a mesma entidade
— a segunda linha é recusada como duplicata conflitante ou sobrescreve a
primeira. Uma chave instável entre vigências faz a mesma rota virar entidade nova
a cada quinzena, e a comparação passa a dizer que a malha inteira foi criada e
apagada. É a mesma classe de erro que produziu `MODELOCARRETA`.

O suspeito concreto de repetição está no próprio dicionário: `Capacidade`,
`turnoEmpurrada` e `Operador - CNPJ` descrevem **como** a rota é operada. Se a
mesma origem–destino aparece com duas capacidades de pallet, `chaveTrecho`
repete — e a chave passa a ser composta.

### O instrumento

`lib/ingest/src/cli/medir-grao.ts` — não escreve nada, não precisa de banco:

```
pnpm --filter @workspace/ingest exec tsx src/cli/medir-grao.ts "Modelo Trecho.xlsx" \
  --composta "chaveTrecho,Capacidade" \
  --composta "Origem,Destino" \
  --composta "Origem,Destino,Capacidade" \
  --composta "Origem,Destino,Operador - CNPJ"
```

Para cada candidata ele imprime preenchimento, chaves distintas, quantas linhas
repetem, a maior repetição e quanto das chaves reaparece em todas as vigências.

E, para as que passam no teste de chave, a **estabilidade semântica**: o que
acompanha aquela chave sem mudar ao longo do arquivo. Unicidade e permanência
são perguntas sobre a chave; esta é sobre o que ela carrega, e é a única das
três que pega a chave **reaproveitada** — o cadastro aposenta Camaçari→Salvador
e reusa `CAM-SSA-01` para Camaçari→Feira no mês seguinte. Nas outras duas isso
passa limpo: não repete, e reaparece em todas as vigências. E é a pior das três
falhas, porque a comparação atribuiria a variação de preço de uma rota à outra.

- **âncoras** — colunas constantes por chave em todas as vigências. Se a chave
  não tem nenhuma, ela nomeia uma linha, não uma coisa.
- **quase-âncoras** — constantes em 90%+ das chaves e discordantes no resto,
  com o valor divergente impresso. É o rastro exato do reaproveitamento.

No `Modelo_Cavalo.xlsx`, `Placa` traz 46 âncoras (unidade, operador, regional,
CNPJs) e as quase-âncoras que ela expõe são legítimas: `Placa Carreta` muda em
7,8% dos cavalos, porque o cavalo troca de implemento. No trecho, a pergunta que
essa coluna responde é direta — `Origem` e `Destino` são âncoras de
`chaveTrecho`, ou só quase?

**Validação do instrumento contra o que já se sabe.** Rodado no
`attached_assets/Modelo_Cavalo.xlsx` de verdade, ele redescobre sozinho a
resposta conhecida:

```
── aba "Modelo_Cavalo" — 558 linhas, 77 colunas
   CANDIDATA                  PREENCH  DISTINTAS  REPETE  MAIOR  ESTÁVEL
   Placa                       100.0%        558       0      0    93.8%
   chassi                      100.0%        558       0      0    93.8%
   _id                         100.0%        558       0      0    93.8%
   odometroEntrada             100.0%        558       0      0     0.0%
   finameCavalo                100.0%        149     409     20    52.9%
```

Placa identifica e permanece; `odometroEntrada` identifica e **não** permanece —
e o CLI marca isso explicitamente, porque uma coluna assim seria uma identidade
que mata e recria a frota toda quinzena.

### O que está bloqueado

Preciso do `Modelo Trecho.xlsx` (ou de qualquer export real de trecho) para
rodar a medição. Sem ele, a chave fica com **candidatas ordenadas e nenhuma
decidida**. É o único ponto deste documento que não pode ser fechado por
raciocínio.

Hipótese de trabalho, a ser confirmada ou derrubada pela medição — e nada será
implementado sobre ela antes disso: `chaveTrecho` sozinha, com queda para
`chaveTrecho + Capacidade` se ela repetir. `_id` é o candidato a evitar: ele
identifica o **registro** na origem, não o trecho no negócio, e um recadastro da
mesma rota produziria um id novo — a instabilidade que arruína a comparação.

---

## 3. Mapa: tudo que assume (vigência, placa)

19 ocorrências em 17 arquivos de produção. Agrupadas pelo tipo de mudança que
cada uma exige.

### 3.1 O leitor — onde a planilha de trecho morre hoje

| Lugar | Hoje | Precisa virar |
|---|---|---|
| `lib/ingest/src/workbook.ts:14` | `REQUIRED_KEY_COLUMNS = ["vigencia", "placa"]` | grão por tipo: `vigencia` + a chave daquele tipo |
| `workbook.ts:198-206` | sem as duas → `role: "PIVOT"`, aba descartada | descartar só quando **nenhum** grão conhecido bate |
| `workbook.ts:235` | `roleReason` cita `vigencia + placa` | citar o grão que bateu |

**A ordem aqui é o problema estrutural, e não o conteúdo da lista.** O papel da
aba é decidido *antes* da identidade dela — por isso a planilha de trecho nem
chega a ser classificada, e por isso o item (2) que você aprovou (declaração de
equipamento na prévia) não a alcança. Ou o leitor passa a reconhecer o grão de
todos os tipos que conhece, ou a decisão de papel desce para depois da
classificação por colunas. Recomendo o primeiro: é menor, e mantém o papel da aba
decidido pela forma dela, que é a regra que `identity.ts` defende.

### 3.2 A staging

| Lugar | Hoje |
|---|---|
| `pipeline.ts:75` | `GRAIN_COLUMNS = { vigencia, placa }` |
| `pipeline.ts:592` | coluna é grão se for `vigencia` ou `placa` — o resto vira fato |
| `pipeline.ts:660-662` | sem coluna de placa, a aba inteira é pulada |
| `pipeline.ts:671, 763` | `entityKey = normalizeIdentifier(rawPlaca)` |
| `pipeline.ts:689` | `ROW_MISSING_GRAIN_KEY` — mensagem escrita em "Placa" |
| `pipeline.ts:819-887` | dedupe por `(label, entityType, entityKey, attributeCode)` — **já é genérico**; só a frase do erro fala "de placa X" |

Boa notícia: `staged_fact.entity_key` (`lib/db/src/schema/staging.ts:85`) e o
índice `staged_fact_grain_uq` já são por `entityKey` genérico. A chave composta
cabe aqui sem migration, desde que a serialização seja canônica — o mesmo
separador de campo (`\u001f`) que `canonical-identity.ts` já usa nas chaves
compostas.

### 3.3 A identidade canônica

| Lugar | Hoje | Nota |
|---|---|---|
| `canonical-identity.ts:334-341` | `VALOR_E_IDENTIDADE`: `placa`, `placa_carreta`, `chassi`, CNPJs | a chave do trecho entra aqui, ou o hash de conteúdo trata `CAM-SSA-01` e `camssa01` como fatos diferentes |
| `canonical-identity.ts:57-60` | `FAMILY_BY_ENTITY_TYPE` — CAVALO e CARRETA em `REMUNERACAO_EQUIPAMENTO` | **nada**, por decisão — ver 3.11 |

### 3.4 A promoção

`pipeline.ts:1797-1820` resolve a entidade por
`entity_identifier` com `identifier_type = 'PLACA'` fixo, e insere o
identificador com o mesmo literal.

### 3.5 O banco — e aqui a notícia é boa

`lib/db/src/schema/canonical.ts:66`:

> `identifierType: text("identifier_type")` — *"PLACA | CHASSI | ... — text so
> new identifier kinds need no migration."*

O índice único é `(identifier_type, identifier_value) where is_current`. Um
`identifier_type = 'TRECHO'` entra **sem migration**, sem colisão com placas, e
com o mesmo histórico de vigência que a re-placa Mercosul já usa. `entity_type`
também é texto livre. **O banco já está pronto; o que está preso é o código.**

### 3.6 A comparação

Todas com a mesma forma —
`max(ei.identifier_value) FILTER (WHERE ei.identifier_type = 'PLACA') AS placa`:

`comparison/ativos.ts:133` · `engine.ts:416, 425, 544` · `impacto.ts:786` ·
`grouped.ts:1867` · `alteracoes-do-ativo.ts:100` · `exportacao.ts:283`

Consequência de deixar como está: uma entidade TRECHO aparece com `plate = null`,
e `ativos.ts:150-167` a manda para o fim da lista sem nome. A tela abriria com
uma coluna de traços.

`comparison/escopo.ts:29-35` é o outro lado: `EscopoDeFrota { entityType, plate }`
— o recorte da tela 360° viaja como *placa*, e o mesmo texto está denormalizado
em `change.entity_label` (`schema/comparison.ts:163`) e `ticket_change.entity_label`.
Como é texto livre, ele **carrega qualquer rótulo**; o que precisa mudar é o nome
do campo e a consulta que o resolve, não o mecanismo.

### 3.7 A Curadoria

Não filtra por placa — a fila é por `entity_type`, e funciona no dia em que
existir um atributo `trecho.*`. A frase da fila vazia, que prometia um caminho
que não existe, já foi corrigida (`curadoria.tsx`).

O que **vai** aparecer no dia seguinte à primeira importação: ~110 colunas de
trecho na fila, contra 120 de cavalo+carreta hoje. Vale decidir antes se a
curadoria delas entra em lote pela planilha de atributos (que já existe e já
aceita recorte por equipamento).

### 3.8 Trecho 360°

`artifacts/api-server/src/routes/frota.ts` → `listarFrota` (3.6) e
`getVisaoDeFrota` (`composition/frota.ts:126`, `motor.ts:306`, `ficha.ts:141, 354, 588`).
Todos leem placa/chassi. A tela existe e está ligada (`App.tsx:139`,
`TIPOS_COM_REGRA` inclui TRECHO desde `composition/regras.ts:235`) — ela abre
vazia hoje porque não há entidade, não porque falte rota.

### 3.9 DRE e Composição

`dre/apuracao.ts:72` lê placa do mesmo jeito. O portão financeiro
(`composition/motor.ts:360-380`) **não** olha placa: ele olha semântica
confirmada, monetário, somável e periodicidade. É a seção 4.

### 3.10 Cobertura, assistente, chamados

`coverage/observado.ts:304`, `coverage/proveniencia.ts:90`,
`assistant/ferramentas.ts:1604` (mais `FORMA_DE_PLACA`, o regex que reconhece
placa em pergunta livre), `ingest/chamados.ts:1575`.

### 3.11 A família de dataset — decidido: nada muda agora

**TRECHO é, antes de tudo, um tipo de entidade.** A família de dataset descreve
a natureza e a origem do conjunto de dados; o grão da entidade não é razão para
abrir uma. Decisão de 18/08/2026, e ela derruba a recomendação que este
documento trazia antes.

Na prática **nada muda**, e é esse o ponto: `datasetFamilyFor`
(`canonical-identity.ts:73`) já devolve `REMUNERACAO_EQUIPAMENTO` para qualquer
tipo não mapeado, por um padrão inclusivo deliberado. TRECHO entra nele hoje,
sem uma linha de código.

O que **não** vai ser feito, e agora está preso por teste
(`canonical-identity.test.ts`): pôr TRECHO em `FAMILY_BY_ENTITY_TYPE` com valor
próprio. Isso faria `datasetFamilyOfSet` (`canonical-identity.ts:80`) lançar num
arquivo que trouxesse cavalo e trecho juntos — uma restrição nova ao que o
cliente pode entregar, criada de lado, por uma linha num mapa. Os dois testes
novos prendem a consequência, e não o valor da constante.

A pergunta fica aberta para depois da medição: **existe razão concreta, medida
no arquivo real, para o conjunto de trecho ser outra família?** Escopo diferente
do que `SCOPE_COLUMNS` declara, cadência de entrega diferente, ou origem que não
seja o mesmo Freightec seriam razões. Periodicidade não é — a §4 resolve isso
sem tocar em família.

---

## 4. Remuneração por viagem — o que muda, e o que já está resolvido

Você pediu "suporte semântico a POR_VIAGEM (ou nomenclatura equivalente)". A
apuração do repositório muda a pergunta, e vale ler antes de decidir.

### 4.1 O modelo já classifica R$/viagem — e já diz o que falta

Três achados, todos verificáveis:

1. `lib/curation/src/significado.ts:167` — o vocabulário de bases **já** conhece
   `viagem: "VIAGEM"`.
2. `lib/db/migrations/0028_significado_economico.sql:135` — o catálogo semântico
   já traz a linha semeada:
   `('taxa_viagem','R$ por viagem','TAXA','VIAGEM','BRL_VIAGEM',NULL,'NONE',false,'BRL','RATE','VIAGEM')`.
3. `lib/curation/src/agregacao.ts:138-145` — `baseQueFalta` responde, para
   `BRL_VIAGEM`: **"a quantidade de viagem do período, por ativo"**.

Ou seja: hoje, `freteReaisViagemDiesel` seria curada como **taxa**, com
periodicidade nula, e excluída de todo total pelo motivo nomeado `BASE_AUSENTE`
(`composition/motor.ts:369-372`). Não é uma lacuna silenciosa: é uma recusa com
o nome do que falta escrito nela.

E isso está economicamente certo pelo próprio modelo: uma taxa "vira dinheiro
quando multiplicada pela base", e é o montante resultante que se acumula. R$/km
tem exatamente o mesmo estado hoje — `manutencaoReaisKm` já vive assim, no cavalo.

### 4.2 Os dois caminhos

**Caminho A — `POR_VIAGEM` como periodicidade nova.**

Trata R$/viagem como montante numa gaveta própria. O que muda:

*Tabelas:* nenhuma estrutura. `attribute.periodicity` e
`attribute_semantics.periodicity` são `text` sem CHECK de domínio
(`0000:219`, `0005:8`); `change_set.calculated_impact_by_periodicity` é
`jsonb Record<string, number>` (`schema/comparison.ts:66`). Uma linha nova no
catálogo `semantic_meaning` (`montante_viagem`) via migration de seed, no mesmo
molde da 0028 — e ela precisa passar na constraint
`semantic_meaning_semantica_coerente` (0028:190).

*Invariantes de código — o custo real:*

| Lugar | Invariante que quebra |
|---|---|
| `simulation/periodicity.ts:16` | `type Periodicity = MENSAL\|ANUAL\|PONTUAL` |
| `simulation/periodicity.ts:83-118` | a tabela 3×3 vira 4×4 — e a célula POR_VIAGEM→MENSAL **não tem fator constante**: depende de viagens/mês, que é dado da linha. `convertPeriodicity(from, to)` é hoje pura em duas periodicidades e teria de receber um direcionador |
| `composition/regras.ts:346, 356` | `Gaveta` e `gavetaDe` — quarta gaveta, e `ordem` em `motor.ts:812` |
| `dre/normalizacao.ts:78` | a lista literal que aceita MENSAL/ANUAL/PONTUAL |
| `dre/normalizacao.ts:24` | `CompetenciaDaDRE = "MENSAL"` — a DRE é mensal; um componente por viagem só entra nela convertido, o que devolve ao problema do fator |
| `curation/significado.ts:253` | derivação de MONTANTE por base |
| `curation/significado.ts:352-368` | `PERIODOS_EM_ABERTO` — os três botões que a tela oferece. **É aqui que a gambiarra mensal acontece hoje**: quem quiser ver R$/viagem num total marca "Todo mês" |
| `db/semantica-confirmada.ts:63` | `Periodicity` (segunda declaração do mesmo tipo) |
| `advisory/motor.ts:276`, `advisory/recomendacao.ts:238`, `comparison/panorama.ts:710`, `comparison/labels.ts:192`, `comparison/cockpit.ts:738`, `assistant/semantica.ts:83`, `assistant/formato.ts:28` | ordens e rótulos por periodicidade |
| `freightaudit/components/composicao/tipos.ts:11, 285, 291` | `Gaveta` e rótulos, do lado da tela |
| `impacto-quinzenas.tsx:289`, `impacto-panorama.tsx:184`, `cliente-recomendacoes.tsx:184` | `POR_PERIODO` — três mapas de rótulo |

**Caminho B — a quantidade da base (o que o modelo já aponta).**

R$/viagem continua taxa. O que entra é o conceito que falta: **declarar qual
atributo entrega a quantidade da base no período**, para um tipo de equipamento
— `previsaoViagens` é viagens/mês; `kmRodadoMesPorEquipe` é km/mês. Com isso,
`taxa × base = montante mensal`, com a transformação registrada do mesmo jeito
que `dre/normalizacao.ts` já registra a conversão de periodicidade (valor
original preservado, fator, natureza, explicação na tela).

*Tabelas:* uma tabela nova pequena — o vínculo (entityType, unidade da taxa,
atributo que dá a quantidade, quem declarou, desde quando) — ou uma coluna em
`semantic_meaning`. É a única mudança estrutural do documento inteiro.

*Invariantes:* `podeSomar`/`baseQueFalta` (`agregacao.ts:138, 216`) passam a ter
um terceiro estado — "a base existe e está declarada"; `motor.ts:369` deixa de
devolver `BASE_AUSENTE` quando há vínculo; `UNIDADES_DE_DINHEIRO`
(`motor.ts:391`) hoje é `{BRL, BRL_KM}` e precisa incluir `BRL_VIAGEM` de
qualquer forma. `Periodicity`, `Gaveta`, a tabela de conversão e os treze
arquivos de rótulo **não são tocados**.

### 4.3 Decidido: caminho B, e ele já está modelado

**Caminho B**, por três razões: é o que o modelo já diz em voz alta
(`baseQueFalta` já escreve a frase); resolve R$/km e R$/viagem com um mecanismo
só, e R$/km já é uma lacuna real no cavalo hoje; e não multiplica por quatro uma
enumeração que aparece em treze arquivos. O caminho A move mais código e ainda
esbarra no mesmo dado que falta — quantas viagens no mês —, só que dentro de uma
função que hoje não tem como recebê-lo.

Com B, a prova de aceite que você escreveu se cumpre inteira: remuneração por
viagem é classificada como o que ela é, entra em total quando a base está
declarada, e fica de fora com motivo nomeado enquanto não estiver. Nenhuma
gambiarra mensal em nenhum dos dois estados.

Se um dia o time quiser ver "total por viagem" como gaveta na tela, ao lado de
mensal e anual, a lista de 4.2 é o orçamento — e as duas não são excludentes: B
produz o montante, A produziria a gaveta.

### 4.4 O que foi construído (18/08/2026)

O modelo, geral e sem acoplamento a `previsaoViagens`:

- **`lib/curation/src/quantidade-da-base.ts`** — a autoridade da conta
  `R$/base × base/competência = R$/competência`. Nada nele conhece km, viagem,
  pallet ou eixo: a base é texto vindo do cadastro de significados, e
  `R$ por entrega` funciona no dia em que a operação o cadastrar. 22 testes,
  sem banco.
- **`base_quantity_source`** (migration `0030_quantidade_da_base`) — a
  declaração: `(entity_type, base, competence) → attribute_code`, com
  `entity_type = '*'` valendo para todos e o específico ganhando do geral.
  Assinada, justificada e versionada, no molde de `attribute_semantics`.
- **`nature: MEDIDA | PREVISTA`** — a decisão de desenho que não estava no
  pedido e que o dado exige. `previsaoViagens` é previsão: um total montado
  sobre ela é orçamento, e o montante derivado sai dizendo isso. Trocar a
  previsão por viagens realizadas é trocar a linha da tabela; nenhuma linha de
  cálculo muda.
- **`podeSerQuantidadeDaBase`** — recusa, antes de gravar a declaração, o que
  produziria número sem referente: coluna monetária (daria R$²), razão ou
  percentual (base é contagem, não proporção), coluna não numérica.

**A migration não semeia nenhuma declaração e não muda nenhum número.** Com a
tabela vazia, todo componente hoje excluído por `BASE_AUSENTE` continua excluído,
com a mesma frase. Falta um passo, e ele é deliberado: ligar a conta ao portão
financeiro (`composition/motor.ts:369`), que é onde um erro vira número errado —
e cujas provas são as suítes que precisam de Postgres.

---

## 5. Fases e prova de aceite

A prova que você escreveu, com o que cada fase entrega dela:

> `Modelo Trecho.xlsx` → SOURCE → fatos TRECHO → entidades TRECHO → Curadoria
> mostra atributos → Trecho 360° mostra os trechos → remuneração por viagem
> classificada sem gambiarra mensal

| Fase | Entrega | Cobre |
|---|---|---|
| **0** ✅ | recusa do arquivo sem fato; a tela para de dizer que entrou | nada da prova — tira a mentira do caminho |
| **1** | medir a chave no arquivo real e **decidir** com a tabela na mão | pré-requisito de tudo |
| **2** | grão por tipo de entidade: leitor, staging, `entityKey`, `identifier_type` | → SOURCE → fatos → entidades |
| **3** | rótulo do ativo deixa de ser "placa" nas 19 consultas e no escopo | → Curadoria, → Trecho 360° |
| **4** | quantidade da base declarada (B) — modelo pronto, falta ligar ao portão | → sem gambiarra mensal |

Fase 2 sem fase 3 já cumpre metade da prova e não quebra nada: as telas de
cavalo e carreta não mudam de comportamento, e Trecho 360° abre com entidades
sem rótulo. Fase 3 é o que dá nome aos trechos na tela.

---

## 6. O que preciso de você

**O `Modelo Trecho.xlsx`** — ou qualquer export real de trecho. É o que sobrou:
as outras duas perguntas foram respondidas em 18/08/2026 (família: TRECHO é tipo
de entidade, e nada muda agora; viagem: caminho B, modelado). Sem o arquivo a
fase 1 não roda, e a chave continua sendo hipótese.
