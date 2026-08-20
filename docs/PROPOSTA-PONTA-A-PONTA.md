# FreightCheck — Situação da remuneração, ponta a ponta

> **Status: primeira versão implementada.** O desenho abaixo foi aprovado e
> construído, com o caminho **(3c)** do §7.2 — só os atributos que mudaram, com
> o contador honesto "X de Y". Nenhum schema tocado, nenhuma migration, nenhuma
> regra de comparação alterada; o que mudou foi um defeito de índice corrigido
> (§6) e dois campos novos na leitura de posição.
>
> **O que existe hoje:** `/posicao` (`artifacts/freightaudit/src/pages/posicao.tsx`),
> alimentada por `byAttribute` e `universo` em `EndToEndAnalysis`. O cartão da
> Visão Gerencial passou a abrir esta tela, com as duas pontas do ano no
> endereço.
>
> **O que ficou por fazer, deliberadamente:** a rota que devolve o estado por
> atributo de uma célula de cobertura — o caminho **(3a)**. Sem ela, um atributo
> que não se mexeu não tem linha, e a tela diz isso em vez de o pintar de verde.
>
> Este documento continua a valer como o registo do desenho e da proveniência.
> As citações de linha referem-se ao código **anterior** à implementação; o que
> mudou desde então está nas duas secções marcadas abaixo.
>
> **Pergunta que orienta o documento:** o dono da operação abre a unidade e quer
> saber *como estava a remuneração dele no início do período e como está hoje,
> parâmetro a parâmetro* — sem perder a notícia de que houve movimento no
> caminho.
>
> **Base empírica:** leitura de `lib/comparison`, `lib/coverage`,
> `lib/composition`, `lib/ingest`, `artifacts/api-server/src/routes` e
> `artifacts/freightaudit/src`. Todas as afirmações deste documento citam
> arquivo e linha. **Não havia banco disponível nesta sessão** — nenhum número
> de negócio foi medido aqui, e nenhum é citado como se tivesse sido.

---

## 1. O que a tela é, e o que ela não é

### 1.1 A pergunta

> Como estava minha remuneração no início do ano e como está hoje, parâmetro a
> parâmetro?

É uma pergunta de **posição**, e o produto já tem o motor dela: a leitura ponta
a ponta de `getEndToEndAnalysis` (`lib/comparison/src/end-to-end.ts:184`).

### 1.2 O que ela não é

**Não é a decomposição das "3.202 alterações" do cartão da Visão Gerencial.** As
duas leituras são incomparáveis por construção, e o código diz isso nos dois
lados:

- O cartão anual lê `cs.impacto_oficial_by_periodicity` — coluna **gravada** por
  comparação canônica, somada sobre as vigências do ano
  (`lib/comparison/src/gerencial.ts:198` e `:257`).
- O ponta a ponta **não grava nada**: reaproveita `diffSnapshots` sem persistir
  `change_set`, e a recusa está escrita com o motivo — gravar o par
  janeiro→agosto faria a tela de agosto apanhá-lo pelo `snapshot_b` e somar oito
  meses de movimento ao total de um mês (`end-to-end.ts:56-60`).

Portanto a tela **não abre atrás do número 3.202**, não promete somar de volta
para ele, e não usa a palavra "alterações" para o que publica. O que ela publica
é *posição*, e o movimento entra como uma coluna própria — nunca como o total.

### 1.3 De onde se chega nela

Do cartão da unidade na Visão Gerencial da Auditoria. Ele apontava para o Resumo
executivo com `period: null` — isto é, para a vigência mais recente, enquanto o
cartão fala do ano inteiro; quem clicava num número do ano lia um número de um
mês. A troca de destino resolve essa incoerência de recorte, e era o argumento
independente para fazê-la. **Feito:** o cartão passa por `linkDaPosicao`, com as
duas pontas do ano no endereço (`lib/recorte.ts`), e a decisão 3 do cabeçalho de
`visao-gerencial.tsx` foi reescrita com o motivo da mudança.

---

## 2. O desenho

```
← Visão Gerencial

CAMAÇARI · EMPURRADA                    Período [ 2026 ▾ ]   [ jan/2026 → ago/2026 ]

  Como estava em 01/01 e como está em 01/08, parâmetro a parâmetro.
  Posição, não movimento: o que subiu e voltou aparece com delta zero
  e a coluna "no caminho" acesa.

┌─ POSIÇÃO NO PERÍODO ──────────────────────────────────────────────────────┐
│ PARÂMETROS QUE MUDARAM   ATIVOS NAS DUAS PONTAS   IMPACTO DA POSIÇÃO       │
│ 34 de 138                129                      −R$ 41,2 mil/mês (+1)    │
│                                                   ↑ nunca somado ao anual  │
│ REVERTIDOS: 6 parâmetros · 41 ativos   FROTA: +2 entraram, −2 saíram       │
│                                        (fora do dinheiro, sempre)          │
└───────────────────────────────────────────────────────────────────────────┘

CAVALO — 62 ativos · comparado 01/01 → 01/08                       [expandir]
┌───────────────────┬─────────┬──────────┬───────┬───────┬────────────┬──────────┬───────────┐
│ Atributo          │ Início  │ Hoje     │ Δ     │ Ativos│ Impacto    │Abrangência│No caminho│
├───────────────────┼─────────┼──────────┼───────┼───────┼────────────┼──────────┼───────────┤
│ FINAME            │ 887.408 │ 867.860  │ −2,2% │ 58    │ −R$ 19.548 │ COMPLETO │ 4 vig.    │
│                   │         │          │       │       │ /mês       │          │           │
│ Custo fixo    ⧉   │  —      │  —       │  —    │ 12    │ fora da    │ COMPLETO │ 2 vig.    │
│                   │         │          │       │       │ soma       │          │           │
│   ⧉ escopo de conjunto: a parcela da carreta responde por este valor                       │
│ Padrão            │ 6X2     │ 6X4      │  —    │  9    │ sem preço  │ COMPLETO │ 1 vig.    │
│                   │ dominante em 9 ativos       │       │ não somável│          │           │
│ Índice reajuste   │ 1,0000  │ 1,0000   │ 0,0%  │  0    │  —         │ COMPLETO │ 3 vig. ⚠  │
│   ⚠ voltou ao valor inicial — houve movimento em 3 vigências do período                    │
│ Consumo benchmark │  —      │  —       │  —    │  0    │  —         │ AUSENTE  │  —        │
│   a coluna não chegou em nenhuma das duas pontas — ver Cobertura de dados                  │
└───────────────────┴─────────┴──────────┴───────┴───────┴────────────┴──────────┴───────────┘

CARRETA — 71 ativos · comparado 01/01 → 01/08                      [expandir]
TRECHO — … · comparado 01/01 → 01/08                               [expandir]
QLP ADMINISTRATIVO — comparado 15/01 → 15/07                       [expandir]
   ↑ calendário próprio: QLP é outra família de dados, com vigências próprias

QLP OPERACIONAL
┌───────────────────────────────────────────────────────────────────────────┐
│ Sem dados disponíveis. O tipo de importação existe (QLP_OPERACIONAL, grão  │
│ unidade + cargo + turno) e o export ainda não chegou. Enquanto não chegar, │
│ não há quadro para mostrar — e este bloco não finge que há.                │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.1 As quatro decisões que o desenho materializa

1. **A linha é (atributo × tipo de entidade), não "parâmetro".** Ver §4.
2. **Conjunto não é bloco.** É selo de linha, e sai da autoridade de dedução que
   já existe. Ver §5.
3. **Há duas "coberturas" no código, e a tela nomeia a que publica.** A coluna
   entregue é a **abrangência** — quantos ativos da frota o valor mexeu —, que é
   o vocabulário que `grouped.ts` já usa para ela. A cobertura de **dados**
   ("temos o dado?") é outra pergunta, com outro vocabulário, e entra quando o
   caminho (3a) do §7.2 existir. Dar o mesmo nome às duas faria a tela responder
   uma e parecer responder a outra. Ver §6.
4. **"Não mudou" nunca é pintado como conferido.** A célula de estado é sempre a
   de cobertura; a ausência de diferença entre as pontas é dita com essas
   palavras, e a coluna "no caminho" é o que impede que ela seja lida como
   sossego.

---

## 3. A tabela de proveniência

Nenhuma coluna é calculada na interface. O que segue é a prova, coluna a coluna.

| Coluna | Fonte | Onde está |
|---|---|---|
| **Valor no início** | `group.aggregate.perVehicle.numeratorBefore` / `averageBefore` quando somável; `group.dominantPattern.before` quando não | `grouped.ts:540-548`; já lido por `variacoesNominais` em `artifacts/freightaudit/src/lib/analise.ts:654` |
| **Valor atual** | idem, lado `After` | idem |
| **Δ** | `group.aggregate.deltaPercent` — só existe quando `summable && totalBefore !== 0`, e é `null` de propósito fora disso | `grouped.ts:549-552` |
| **Ativos afetados** | `EndToEndEntry.vehicles` — entidades distintas cujo valor **hoje** difere da ponta inicial | `end-to-end.ts:73-74`; contagem em `grouped.ts:479-480` |
| **Impacto oficial deduplicado** | `ResumoDeImpacto.byPeriodicity`, produzido por `resumirImpacto(linhas, dedup)` | `deduplicacao.ts:512`; tipo em `:472-482`; fachada `summariseImpact` em `grouped.ts:428-444` |
| **Cobertura** | `EstadoDeCobertura` de `@workspace/coverage` | `lib/coverage/src/matriz.ts:415` (`medirCelula`); rotas em `artifacts/api-server/src/routes/coverage.ts:66` e `:82` |
| **Movimentações no período** | `count(DISTINCT sb.effective_date)` por (entidade, atributo) — **a consulta já existe** | `end-to-end.ts:410-428` |
| **Revertido** | subtração de conjuntos entre as duas leituras, já pronta | `end-to-end.ts:429-455` (`reverted[]`) |
| **Frota que entrou/saiu** | `EndToEndAnalysis.fleet` — eixo próprio, fora do dinheiro | `end-to-end.ts:114` |

### 3.1 O impacto oficial, em detalhe

É a coluna que não pode ser reconstruída, e a que mais convida a isso. Três
fatos fecham a questão:

**a) Existe uma autoridade só, e ela é `resumirImpacto` + `criarDeduplicador`.**
`ResumoDeImpacto.byPeriodicity` é descrito no próprio tipo como "a verdade
financeira — é este o *Impacto apurado*"; `brutoByPeriodicity` é conferência
técnica e "nunca rotulado Impacto apurado"; e tudo entre os dois mora em
`rastro`, que é "explicação e não valor" (`deduplicacao.ts:461-482`).

**b) O deduplicador enxerga tudo; o recorte é só o filtro do fim.** No ponta a
ponta o índice é montado sobre **todas** as linhas das séries comparadas, e só
depois o recorte do cartão é aplicado (`end-to-end.ts:344-351`, com o motivo
escrito logo acima). `summariseImpact` torna o parâmetro `dedup` obrigatório
justamente para que ninguém construa um deduplicador de fatia — e o comentário
nomeia o defeito de 71% que isso já causou uma vez (`grouped.ts:430-441`).

**c) `impactoApurado` — "a única porta para o número em dinheiro"
(`impacto-apurado.ts:1-12`) — não serve aqui.** Ele opera sobre `changeSetIds`
persistidos (`impacto-apurado.ts:122` e `:185`), e o ponta a ponta não persiste
nada. As duas portas desembocam na mesma autoridade (`resumirImpacto`), então
não há segunda definição de impacto; o que muda é de onde as linhas vêm.

> **Consequência de projeto:** a soma por linha da tela tem de sair do servidor,
> no grão em que a tela publica. Somar `group.impact.amount` de vários grupos na
> interface produziria um número que a autoridade não assinou — a exclusão é por
> ativo e depende do conjunto inteiro, e uma soma de agregados já colapsados não
> tem como perguntar isso (`impacto-apurado.ts:14-30`).

---

## 4. O grão da linha: por que não é "parâmetro"

O pedido diz "parâmetro a parâmetro". O grão que sustenta as colunas de valor,
porém, é **(atributo × tipo de entidade)** — e a razão é verificável:

1. **`parameterKey` não carrega tipo de entidade.** É `família|parâmetro`
   (`lib/comparison/src/families.ts:464-475`).
2. **E parâmetros atravessam tipos.** `carreta.custo_aluguel` e
   `cavalo.custo_aluguel` moram os dois em `FROTA|Caminhão aluguel`
   (`families.ts:188-189`). Um rollup desse parâmetro não cabe dentro do bloco
   CAVALO nem dentro do bloco CARRETA.
3. **Logo `byParameter` não pode ser a fonte das linhas** — nem o de
   `end-to-end.ts:469`, nem o de `families-view.ts:444-457`.

Fica assim: **bloco** = tipo de entidade; **linha** = atributo dentro dele; e o
nome do parâmetro vira agrupador visual dentro do bloco, com o cartão do
Freightech a um clique (é o que `/parametros` já responde).

Uma ressalva de implementação: `groupKey` inclui `changeType`, `comparability` e
`impactConfidence` além de atributo e tipo (`grouped.ts:463-471`). O mesmo
atributo pode portanto render **mais de um grupo**. A linha da tela é a união
deles — e é exatamente por isso que a união precisa ser somada no servidor, com
`summariseImpact` sobre as linhas cruas, e não na interface somando grupos.

---

## 5. Conjunto: escopo, não bloco

Não há bloco "Conjunto", e a razão é que conjunto não é um tipo de entidade
irmão dos outros:

- Os tipos de importação são cinco: `CAVALO`, `CARRETA`, `TRECHO`,
  `QLP_ADMINISTRATIVO`, `QLP_OPERACIONAL` (`lib/ingest/src/tipos.ts:83`).
- `CONJUNTO` é **escopo**: `escopo: "CONJUNTO"` quer dizer "o valor cobre cavalo
  + carreta juntos" (`lib/composition/src/regras.ts:89-90`), e
  `TIPOS_DO_CONJUNTO = ["CAVALO", "CARRETA"]`
  (`lib/composition/src/conjunto.ts:74`).
- `ESCOPO_DE_CONJUNTO` é um degrau da escada de dedução, com rótulo já escrito:
  "duplicidades entre escopos cavalo↔carreta" (`deduplicacao.ts:421-427`).

**Como o desenho sinaliza sem criar segunda verdade:**

- **Na linha:** `group.impact.excludedMotivo === "ESCOPO_DE_CONJUNTO"` acende o
  selo ⧉, e `excludedReason` já traz a frase pronta com quantos ativos ela vale
  (`grouped.ts:585-600`).
- **No bloco:** o degrau correspondente de `rastro.degraus` diz quanto saiu da
  soma e por qual regra (`deduplicacao.ts:429-447`).

Em nenhum dos dois a tela decide o que é dupla contagem. Ela repete a decisão.

---

## 6. Cobertura: existem duas, e a tela usa a certa

Este é o ponto onde a implementação erraria em silêncio.

| | `ChangeGroup.coverage` | `EstadoDeCobertura` |
|---|---|---|
| Pergunta | quanto **da frota** aquela alteração pegou | temos **o dado**? |
| Valores | `TOTAL` / `MAIORIA` / `PARCIAL` | `COMPLETO` / `PARCIAL` / `AUSENTE` / `NOVO` / `ALTERADO` / `NAO_APLICAVEL` |
| Onde | `grouped.ts:635-636` | `artifacts/freightaudit/src/components/cobertura/tipos.ts:12-19` |
| Autoridade | `buildGroup` | `@workspace/coverage` — "a autoridade única" (`routes/coverage.ts:24-28`) |

A coluna da tela é a **segunda**. É a que o pedido chama de "semântica de
cobertura já existente", e é a única que responde por um parâmetro que não
apareceu em ponta nenhuma.

> **Achado, e é um defeito real — CORRIGIDO em commit próprio.** A primeira não
> poderia ser usada aqui nem se
> quiséssemos. `buildGroup` procura a frota por uma chave composta de
> `change_set_id` + separador `U+001F` + `entity_type` (`grouped.ts:486`), mas o
> ponta a ponta indexa o mapa só pela série (`end-to-end.ts:283`) — e
> `families-view.ts:560` indexa só pelo `change_set_id`. Nos dois casos a busca
> erra, cai no `?? 0`, e `fleet` desaba para `vehicles` (`grouped.ts:484-489`):
> a razão vira 1, a cobertura vira `TOTAL` sempre, e `coverageLabel` publica
> "Toda a frota · N de N" (`grouped.ts:690`). Só `getGroupedView` monta a chave
> certa (`grouped.ts:965-967`). Isto era anterior a esta proposta e independia
> dela, e foi corrigido em mudança separada antes de a tela usar a abrangência
> como verdade: `chaveDaFrota` passou a ser a única redacção da chave, as duas
> consultas partidas passaram a contar por tipo, e
> `lib/comparison/src/__tests__/frota-do-grupo.test.ts` prende a correcção — ele
> exige que **exista** grupo com frota maior do que os ativos dele, que é o que o
> defeito tornava impossível. Sem a correcção, os quatro casos reprovam, um deles
> publicando frota 5 onde a frota de cavalo é 62.

---

## 7. O que já existe, e o que precisa ser construído

### 7.1 Já existe, e é reaproveitado inteiro

| Peça | Onde |
|---|---|
| Motor de posição, com dedup oficial aplicada | `getEndToEndAnalysis` (`end-to-end.ts:184`) |
| Rota HTTP, já aceitando unidade/canal e recorte de parâmetros | `GET /changes/end-to-end` (`artifacts/api-server/src/routes/changes.ts:347`) |
| Revertidos, com ativos e nº de vigências | `end-to-end.ts:429-455` |
| Eixo de frota fora do dinheiro | `end-to-end.ts:114` |
| Autoridade de cobertura de dados | `GET /coverage`, `GET /coverage/cell/:snapshotId/:entityType` |
| Derivações de interface para as duas leituras | `artifacts/freightaudit/src/lib/analise.ts` — `variacoesNominais:654`, `comparativoDeLeituras:581` |
| Precedente visual do mesmo assunto | `components/parametros/analise.tsx` (aba Análise do cartão) |

### 7.2 Precisa ser construído — três itens, todos no servidor

**(1) Rollup por (atributo × tipo de entidade). — FEITO.** Novo campo em
`EndToEndAnalysis`, ao lado de `byParameter`, somando com
`summariseImpact(linhas, dedup)` sobre a união dos grupos daquele par. É a peça
que impede a interface de somar dinheiro. Custo: baixo — as linhas e o
deduplicador já estão em memória no ponto certo (`end-to-end.ts:344-367`).

**(2) Expor as movimentações do caminho para todos os atributos, não só para os
revertidos. — FEITO**, com uma correcção que a investigação não tinha visto: a
consulta existente conta por (ativo, atributo), e tomar o máximo por ativo
subestima a resposta — se o ativo A se mexeu em janeiro e o B em março, o máximo
diz uma vigência e a resposta certa é duas. A contagem publicada é uma agregação
no grão do atributo. A consulta que conta `count(DISTINCT sb.effective_date)` por
(entidade, atributo) já roda (`end-to-end.ts:410-428`); hoje o resultado é
descartado para todo atributo que **ainda** está diferente, porque o laço
seguinte só guarda o que não está (`end-to-end.ts:436`). Publicar o mapa
completo é acumular antes de filtrar. Custo: quase zero, mesma consulta.

**(3) O universo das linhas. — ESCOLHIDO (3c).** É o item de verdade, e o que decide o tamanho do
trabalho: **o ponta a ponta só emite linha para atributo que difere entre as
pontas.** Um parâmetro que não se mexeu — ou que sumiu do export — não tem
entrada nenhuma, e a tela precisa mostrá-lo. O universo tem de vir da cobertura
(o esperado + o observado da vigência final), e hoje nenhuma rota devolve isso
por inteiro: `visaoDaCobertura` publica **exceções**, cortadas em
`limiteDeLacunas` (padrão 50, `matriz.ts:397`) e filtradas por criticidade;
`/coverage/cell` devolve as lacunas da célula mais contagens, não a lista
completa de atributos esperados.

> São três caminhos possíveis para o (3), e a escolha é do produto:
>
> - **(3a)** nova rota que devolva o estado por atributo de uma célula
>   (vigência × tipo), montada sobre `esperadoDaVigencia` e `medirCelula`, que já
>   calculam tudo o que ela precisa;
> - **(3b)** usar o catálogo do Freightech (`@workspace/knowledge`) como universo,
>   que é o que `/parametros` já faz — mais barato, mas o universo passa a ser o
>   do catálogo e não o do dado;
> - **(3c)** primeira versão só com quem se mexeu, com o contador honesto no topo
>   ("34 de 138 parâmetros mudaram") e o resto atrás de um "mostrar os que não
>   mudaram" que carrega depois.
>
> **Decidido: (3c) nesta entrega, (3a) em seguida.** (3c) entrega a pergunta
> principal sem rota nova, e mede se o resto é mesmo lido antes de pagar por ele.
>
> O denominador de (3c) não é o número de linhas da tela nem o catálogo: é o
> universo canônico do recorte — atributos distintos com valor na vigência mais
> recente daquele tipo, fato nulo excluído. Ver `montarUniverso` em
> `end-to-end.ts`.

---

## 8. Dois achados que condicionam o desenho

### 8.1 QLP tem calendário próprio

QLP vive na família `QUADRO_DE_PESSOAL`, separada de
`REMUNERACAO_EQUIPAMENTO`, e a separação é deliberada: sem família própria, o
arquivo de QLP da mesma unidade, data e canal teria a mesma identidade da
remuneração de equipamento e entraria como *revisão* dela
(`lib/ingest/src/canonical-identity.ts:57-81`).

Como `contextFilter` recorta por escopo e canal, e não por família
(`lib/comparison/src/series.ts:354-364`), as duas pontas escolhidas a partir das
vigências de equipamento podem não ter snapshot de QLP. O motor já trata o caso
sem mentir — a série entra em `missingSeries` com o motivo escrito
(`end-to-end.ts:243-256`).

**Consequência para a tela:** cada bloco declara no cabeçalho *quais duas
vigências ele comparou*. Não há uma ponta inicial só para a tela inteira. É a
mesma decisão que o Acompanhamento já tomou ao trocar a linha corrida por uma
ficha por série (`artifacts/freightaudit/src/pages/vigencia.tsx:313-325`).

### 8.2 QLP Operacional não tem export

O tipo de importação existe; a planilha nunca chegou
(`artifacts/freightaudit/src/pages/telas-em-preparo.ts:188-199`). O bloco aparece
com "sem dados disponíveis" e o que falta, escrito — que é a regra que
`/parametros` já segue: nenhum cartão finge cobertura.

---

## 9. As recusas

1. **Nunca somar periodicidades.** R$/mês e R$/ano em linhas próprias, no topo e
   em cada bloco.
2. **Nunca somar impacto na interface.** O número vem do rollup do servidor, ou
   não vem.
3. **"Sem preço" nunca vira zero**, e vem com o motivo (`impact.reason`).
4. **"Não mudou" nunca vira "conferido".** O estado é o de cobertura; a ausência
   de diferença é dita com essas palavras.
5. **Delta zero nunca esconde movimento.** Quem voltou ao valor inicial acende a
   marca, com quantas vigências se mexeu no caminho.
6. **Entrada e saída de frota ficam fora do dinheiro.** Frota maior não é preço
   maior — o motor já separa esse eixo, e a tela mantém a separação.
7. **A tela não é a decomposição do cartão anual**, e não usa a palavra
   "alterações" para o que publica.
