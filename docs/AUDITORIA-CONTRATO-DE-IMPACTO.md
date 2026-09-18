# Auditoria — as quatro leituras de impacto que discordavam entre si

> **Como reproduzir tudo o que está abaixo:**
>
> ```
> node scripts/prova-local.mjs subir
> DATABASE_URL=postgresql://postgres@localhost/freightcheck_dev?host=/tmp/pgsock&port=5433 \
>   pnpm --filter @workspace/api-server exec tsx src/cli/prova-impacto.ts
> ```
>
> O CLI não escreve no banco. Ele imprime, lado a lado, o que cada superfície
> publicaria sobre o mesmo dado — e os números deste documento saíram dele.
>
> **Base da medição.** Os exports reais da Freightec de `attached_assets`,
> importados pelo pipeline e curados por `dev:seed`: 9 vigências
> (2025-12-16 → 2026-08-01), 8 comparações canônicas, 18 snapshots,
> 138 atributos classificados (60 `CONFIRMED`, 65 `PRESUMED`, 13 `UNKNOWN`).

---

## 1. O que foi relatado

Uma tela do Panorama publicava, ao mesmo tempo, sobre a mesma unidade:

| Superfície | O que mostrava |
|---|---|
| seletor de vigências | `R$ 43.556` |
| cartão do resultado | "Impacto líquido apurado: **Nenhum valor apurado**" |
| gráfico | seis vigências coladas no zero, eixo em R$/ano |
| rodapé do cartão | "300 alterações detectadas · 0% de cobertura" |

A hipótese inicial — nove parâmetros pendentes de curadoria explicariam as 300
alterações — **não foi aceita sem prova**, e a §3 mostra que ela está errada em
número e em forma: no dado real são dezesseis atributos e até **quatro** classes
de motivo distintas, que pedem ações diferentes — e só uma delas é curadoria.

---

## 2. Inventário — quem calcula, quem projeta, quem redige

### 2.1 A aritmética já era única (e continua)

Nenhum dos defeitos abaixo é erro de soma. O dinheiro tem **uma** autoridade, e
ela está sob teste:

| Camada | Arquivo | Papel |
|---|---|---|
| portão do dinheiro | `lib/curation/src/agregacao.ts` → `viraDinheiro` | `CONFIRMED` + monetário + somável. Único. |
| preço de uma linha | `lib/comparison/src/impact.ts` → `assessImpact` | `CALCULATED` ou `NOT_CALCULABLE` **com motivo**. Único. |
| soma e dupla contagem | `lib/comparison/src/deduplicacao.ts` → `resumirImpacto` | Único. `bruto − Σdegraus = oficial`, invariante sob teste. |
| a porta do SQL | `lib/comparison/src/impacto-apurado.ts` | Os quatro `sum(impact_amount)` crus já haviam sido eliminados. |

Grep de confirmação: `sum(impact_amount)` não aparece em nenhum SQL do produto —
só em dois comentários que narram a remoção.

### 2.2 Onde as leituras divergiam

O problema mora **acima** da soma: em qual recorte cada superfície lê, qual
periodicidade escolhe, e qual política de estado aplica.

| # | Consumidor | Arquivo | Endpoint | Recorte | Periodicidade — régua | Estado — política |
|---|---|---|---|---|---|---|
| 1 | Coluna do seletor de vigências | `hooks/use-resumo-por-vigencia.ts` → `resumirIntervalo` | `/changes/range` | **vigência vs. anterior** | **presença** (em quantas vigências o balde existe) | própria: `impacto: null` vs. número |
| 2 | Cartão do Panorama | `components/panorama/veredito.tsx` + `lib/panorama.ts` | `/changes/families` ou `/changes/families/par` | **par aberto** (pode ser salteado/invertido) | `sides[0]` — **zeros descartados** | `situacaoDaApuracao` (4 estados) |
| 3 | Gráfico "Impacto por vigência" | `components/dashboard/grafico-de-impacto.ts` → `pontosDeImpacto` | `/changes/range` | **intervalo desenhado** | preferida **se o balde existir**, senão magnitude bruta | nenhuma — desenha 0 |
| 4 | Cartão da janela | `lib/panorama.ts` → `janelaDoImpacto` | `/changes/range` | intervalo desenhado | preferida **se o balde existir** (`!== undefined`) | nenhuma |
| 5 | Manchete do Impacto Apurado | `components/impacto-apurado/manchete.tsx` | `/changes/families` | vigência | `sides[0]` | `situacaoDaApuracao` |
| 6 | Resumo executivo / Cockpit | `components/vigencia/resumo.tsx`, `vigencia/panorama.tsx` | `/changes/grouped` | vigência | **alfabética** (`localeCompare`) | nenhuma |
| 7 | Linha do Tempo consolidada | `components/linha-do-tempo/linha-do-tempo-consolidada.tsx` | `/changes/range/overview` | intervalo | `aba ?? principal ?? periodicidades[0]` | nenhuma |
| 8 | 16 auditorias de rubrica (FINAME, seguro, IPVA…) | `lib/comparison/src/politica-do-impacto.ts` | `/<rubrica>/comparacao` | par escolhido | por rubrica | **`leituraDoImpacto`** — 3 estados |
| 9 | Assistente IA | `lib/assistant/src/formato.ts` → `impactoEmTexto` | várias | a da ferramenta | todas, filtrando zeros | `null` ⇒ "não apurável" |
| 10 | Exportação `/impacto/exportacao.xlsx` | `routes/impacto.ts` | `/impacto/quinzenas` | **nenhum** — lê o fato de cada vigência | n/a | n/a (declarado no cabeçalho da rota) |

**Duas políticas de estado conviviam.** `politica-do-impacto.ts` (3 estados,
domínio, usada por 16 auditorias de rubrica) e `situacaoDaApuracao` (4 estados,
React, usada pelo Panorama e pelo Impacto Apurado). Nenhuma das duas sabia da
outra, e nenhuma delas alcançava o gráfico, a janela, o resumo executivo ou a
Linha do Tempo — que não tinham política nenhuma e desenhavam `0`.

**Sete réguas de periodicidade** para a mesma pergunta: presença, magnitude
bruta, preferência-por-existência (duas vezes), `sides[0]`, alfabética, e
`periodicidades[0]`.

### 2.3 O `?? 0` espalhado

Grep de `byPeriodicity[...] ?? 0` e `amount ?? 0` na interface: **32 ocorrências
em 12 arquivos** (`linha-do-tempo-de-impacto.tsx` sozinho tem 11). Cada uma
transforma "este recorte não tem esta grandeza" em "este recorte vale zero".

### 2.4 Duas fontes que discordam por construção

| Campo | Onde | Comportamento com R$ 0,00 |
|---|---|---|
| `impact.byPeriodicity` | `resumirImpacto` | **mantém** o balde zerado |
| `summary.sides` | `families-view.ts`, `buildSummary` | **descarta** (`if (amount === 0) continue` — "zero não é lado nenhum") |

As duas decisões estão certas isoladamente. Juntas, produzem o efeito de que uma
vigência inteira apurada em R$ 0,00 chega às telas com `sides: []` — do mesmo
feitio de uma vigência sem preço nenhum — enquanto o gráfico, que lê
`byPeriodicity`, vê um balde e o escolhe.

---

## 3. Prova sobre o dado real

### 3.1 A coluna do seletor — cada vigência contra a anterior dela

```
2026-08-01  alt= 267  {MENSAL=11916.70}                      calc=19  naoCalc=248
2026-07-16  alt= 593  {ANUAL=-144874.50  MENSAL=-11712.30}   calc=76  naoCalc=517
2026-06-16  alt= 269  {MENSAL=-20996.90}                     calc=22  naoCalc=247
2026-05-16  alt= 383  {MENSAL=73772.05}                      calc=14  naoCalc=369
2026-04-16  alt= 402  {MENSAL=16588.35}                      calc=51  naoCalc=351
2026-03-16  alt= 400  {}                                     calc=0   naoCalc=400
2026-02-16  alt= 350  {MENSAL=427.34}                        calc=40  naoCalc=310
2026-01-16  alt= 560  {ANUAL=-590437.65  MENSAL=-44463.50}   calc=130 naoCalc=430
```

**2026-03-16 é o caso do print**: 400 alterações, nenhuma apurada. O cartão
escrevia "Nenhum valor apurado" — a mesma frase que escrevia para uma vigência
apurada em R$ 0,00.

### 3.2 O par aberto é outro recorte — e os números provam

```
[CANÔNICO]       2026-07-16 -> 2026-08-01
  totals.changes = 267   calculated = 19    notCalculable = 248
  byPeriodicity  = {MENSAL=11916.70}

[SALTEADO]       2026-06-16 -> 2026-08-01   (pula 2026-07-16)
  totals.changes = 674   calculated = 89    notCalculable = 585
  byPeriodicity  = {ANUAL=-144874.50  MENSAL=-8091.08}

[SALTEADO-LONGO] 2025-12-16 -> 2026-08-01   (pula 7 vigências)
  totals.changes = 902   calculated = 197   notCalculable = 705
  byPeriodicity  = {ANUAL=-731586.01  MENSAL=-7832.46}
```

Nenhuma das três contagens (267 / 674 / 902) aparece na coluna do seletor, e
nenhum dos valores do seletor corresponde ao par aberto. **De onde vem o número
do seletor, então:** ele é a leitura de ida da vigência daquela linha, contra a
anterior imediata dela — `RangeMovement`, montado em `getRangeAnalysis`, uma
comparação por linha. Ele **nunca** foi o par aberto, e nada na tela dizia isso.

### 3.3 O gráfico chapado no zero, reproduzido

Rodando as funções reais da interface (`resumirIntervalo`, `pontosDeImpacto`)
sobre a mesma resposta de `/changes/range`, com **2026-07-16** aberta:

```
SELETOR   periodicidade da coluna = MENSAL
          2026-07-16  →  -11.712,30

GRÁFICO   preferida = ANUAL   eixo = ANUAL
          2026-03-16:0  2026-04-16:0  2026-05-16:0
          2026-06-16:0  2026-07-16:-144.875  2026-08-01:0
```

As **duas metades do mesmo dinheiro**, cada uma invisível na superfície da
outra: o seletor escolhe por presença (MENSAL existe em 7 vigências, ANUAL em 2)
e o gráfico escolhe por magnitude (144.874,50 > 134.986,30). Nenhuma das duas
réguas está errada; ter duas é que está.

### 3.4 Por que 0% — a resposta que não é "nove parâmetros"

Par `2026-05-16 → 2026-06-16`, 269 alterações, 22 apuradas (8,2%). Os 247 sem
preço, por atributo e pelo motivo que o motor registrou:

| Atributo | n | Motivo (frase do motor) |
|---|--:|---|
| `cavalo.manutencao_vida_meses` | 62 | Não é um montante financeiro |
| `cavalo.combustivel_vida_cavalo` | 62 | Não é um montante financeiro |
| `cavalo.custo_variavel_simulado` | 55 | Semântica **desconhecida** |
| `cavalo.manutencao_reais_km` | 9 | Não é um montante financeiro |
| `cavalo.lucro_variavel_previsto_cavalo` | 8 | Semântica **presumida** |
| `cavalo.ativo` | 8 | Semântica presumida |
| `carreta.lucro_variavel_previsto` | 8 | Semântica presumida |
| `cavalo.combustivel_consumo_benchmark` | 8 | Não é um montante financeiro |
| `cavalo.combustivel_consumo_neg` | 8 | Não é um montante financeiro |
| `cavalo.manutencao_compra_fora_do_bid_autorizada` | 5 | Semântica presumida |
| `cavalo.combustivel_percentual_perda_vida` | 3 | Não é um montante financeiro |
| `carreta.lucro_variavel_previsto_carreta` | 3 | Semântica presumida |
| `carreta.status_financiamento_t1_shared` | 2 | Semântica presumida |
| `cavalo.status_financiamento_t1_shared` | 2 | Semântica presumida |
| `carreta.ciclo` | 2 | Não é um montante financeiro |
| `cavalo.ciclo` | 2 | Não é um montante financeiro |

**Dezesseis atributos, três classes de motivo neste par** — e as três pedem
ações diferentes:

- **não é montante financeiro** (154 linhas): a variação existe e nunca virará
  dinheiro por si só. Curadoria **não destrava** isso. É o teto natural da
  cobertura deste export.
- **semântica desconhecida** (55): falta classificar.
- **semântica presumida** (38): classificada e **não confirmada** — é a fila da
  Curadoria, e é a única que uma decisão humana destrava.

Uma tela que escreve "300 alterações sem impacto calculável" sem essa separação
sugere um trabalho pendente que, em 63% dos casos, não existe.

Uma **quarta** classe aparece nos pares vizinhos, e ela não é de curadoria:

```
[par canônico 2026-07-16 → 2026-08-01, 267 alterações, cobertura 7,1%]
  150 · Não é um montante financeiro…                    (6 atributos)
   62 · Os dois lados não são comparáveis com segurança… (1 atributo)
   33 · Semântica presumida…                             (5 atributos)
    3 · Semântica desconhecida…                          (1 atributo)
```

"Os dois lados não são comparáveis com segurança" é a recusa de
`assessImpact` diante de uma **deriva de semântica** entre as duas pontas: o
que a coluna significa mudou no meio do caminho, e monetizar a diferença
comparia duas grandezas diferentes. Confirmar a semântica não a destrava —
só uma reconciliação da série. É o quarto tipo de trabalho escondido atrás de
um "sem preço" genérico, e o contrato agora o publica com a frase do motor.

---

## 4. As divergências, em uma frase cada

1. **Seletor × cartão**: recortes diferentes (`vigência vs. anterior` × `par
   aberto`), nenhum dos dois declarado na tela.
2. **Seletor × gráfico**: réguas de periodicidade diferentes sobre o mesmo
   intervalo — presença × magnitude.
3. **Gráfico × janela × cartão**: um balde apurado em R$ 0,00 **existe** e
   vencia a preferência, escondendo o balde que tinha o dinheiro.
4. **Zero medido × zero desconhecido**: `sides` descarta o zero,
   `byPeriodicity` o mantém; a tela não tinha como distinguir os dois.
5. **Parcial publicado como total**: 212 de 300 alterações apuradas produziam um
   número sem nenhuma ressalva ao lado dele.
6. **Falha técnica → zero**: 32 `?? 0` na interface.
7. **Duas políticas de estado**: `politica-do-impacto.ts` (domínio, 3 estados) e
   `situacaoDaApuracao` (React, 4 estados), sem nenhuma ponte.
8. **Assistente IA**: `impactoEmTexto` devolvia `null` tanto para "nada apurado"
   quanto para "apurado em R$ 0,00", e as ferramentas escreviam "não apurável"
   nos dois.

---

## 5. A correção

`lib/comparison/src/contrato-de-impacto.ts` — uma `LeituraDeImpacto` que declara
recorte, as duas pontas com rótulo, se o par é consecutivo, **todas** as
periodicidades, o estado (`SEM_ALTERACAO` / `NAO_CALCULAVEL` /
`PARCIALMENTE_CALCULADO` / `CALCULADO`), a cobertura e as pendências com o motivo
do motor.

Ela é montada no servidor e viaja na resposta (`FamiliesView.leitura`,
`RangeMovement.leitura`, `RangeAnalysis.leitura`). A interface consome frases
(`lib/impacto/contrato.ts`), e não recalcula nada — `CARREGANDO` e `ERRO` moram
só lá, porque não são estados do dado.

O que **não** mudou: a aritmética. `resumirImpacto`, `assessImpact` e
`viraDinheiro` continuam sendo a autoridade única, e o contrato é uma projeção
sobre o que eles já decidiram.


---

## 6. Migração dos consumidores

| # | Consumidor | Antes | Depois | Contrato usado |
|---|---|---|---|---|
| 1 | Coluna do seletor (`seletor-do-par.tsx`) | número sem rótulo de recorte; segunda periodicidade invisível | cabeçalho "**vs. vigência anterior** — não é o resultado do par aberto"; sufixo `/mês` colado; linha `+ R$/ano` quando há outra grandeza | `tambemEmOutraPeriodicidade` sobre `RangeMovement` |
| 2 | Cartão do Panorama (`veredito.tsx`) | "Nenhum valor apurado" para dois fatos opostos; par nunca nomeado | par escrito sob o rótulo; frase por estado; linha de parcialidade; aviso de salteado/invertido; outras grandezas | `FamiliesView.leitura` → `fraseDaLeitura`, `rotuloDoPar`, `avisoDeSalteado` |
| 3 | Gráfico (`grafico-de-impacto.tsx`) | preferida vencia pela **existência** do balde → eixo parado, pontos em zero; a outra grandeza nunca aparecia | preferida só vence com movimento; senão, maior movimento **bruto**; e, com duas grandezas em movimento, um **botão R$/mês · R$/ano** troca a série (a escolha vira gesto, e o cartão "O que puxou a janela" troca junto) | `periodicidadePrincipal` + `disponiveis` |
| 4 | Janela do impacto (`lib/panorama.ts`) | mesmo defeito (`!== undefined`) | mesma função do gráfico | `periodicidadePrincipal` |
| 5 | Manchete (`impacto-apurado/manchete.tsx`) | idem cartão | idem cartão | `FamiliesView.leitura` |
| 6 | `situacaoDaApuracao` (`lib/impacto-apurado.ts`) | escada de `if` própria — 2ª política de estado | tradução dos 4 estados do contrato para o vocabulário antigo | `estadoDaApuracao` |
| 7 | `coberturaApurada` / `qualidadeDaCobertura` | divisão e cortes duplicados na interface | delegam ao domínio | `coberturaDaApuracao`, `qualidadeDaCobertura` |
| 8 | Assistente IA (`ferramentas.ts`, 4 sítios) | "não apurável" para zero apurado **e** para nada apurado; parcial sem ressalva | quatro frases, uma por estado, com a cobertura no detalhe | `impactoDescrito` → `estadoDaApuracao` |
| 9 | `FamiliesView` do front (`components/inicio/types.ts`) | tipo redeclarado à mão | `leitura` **importada** do pacote — não pode divergir | `LeituraDeImpacto` |
| 10 | Exportação `/impacto/exportacao.xlsx` | — | **não migrada, e de propósito**: essa rota não lê `change_set` nem impacto apurado (o cabeçalho dela já dizia). Não há o que reconciliar. | n/a |

### O que ainda não foi migrado

Honestidade sobre o alcance desta entrega:

- **`linha-do-tempo-de-impacto.tsx` e `detalhe-do-intervalo.tsx`** concentram 22
  dos 32 `?? 0`. Eles leem `byParameter`/`entries` (rollups por parâmetro), e
  não uma `LeituraDeImpacto` — migrá-los exige estender o contrato para o
  recorte "parâmetro dentro de um intervalo", que é trabalho de outra entrega.
  O `?? 0` deles é sobre um **rollup**, não sobre o resultado de uma
  comparação, e nenhum deles alimenta o cartão, o gráfico ou o seletor.
- **`components/vigencia/resumo.tsx` e `vigencia/panorama.tsx`** ainda ordenam
  periodicidade alfabeticamente. Eles publicam **todas** as periodicidades (não
  escolhem uma), então a ordem é cosmética e não esconde dinheiro — mas a régua
  deveria ser a mesma.
- **As 16 auditorias de rubrica** continuam em `politica-do-impacto.ts`. Os três
  estados dela são um subconjunto coerente dos quatro do contrato; unificá-las
  é uma migração própria, com 16 telas a reconferir.
