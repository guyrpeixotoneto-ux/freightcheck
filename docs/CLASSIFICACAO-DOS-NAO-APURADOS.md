# Classificação econômica dos números sem semântica confirmada

> **Status: proposta. Nada foi aplicado.** Nenhuma entrada foi acrescentada a
> `CONFIRMED_SEMANTICS`, nenhum valor calculado mudou, nenhum total se moveu.
> O que existe de novo é uma medição e uma recomendação.
>
> **Como reproduzir tudo o que está abaixo:**
> ```
> DATABASE_URL=… pnpm --filter @workspace/composition exec tsx \
>   src/cli/inventario-sem-classificacao.ts 2026-08-01 [placa]
> ```
> O CLI não escreve no banco. Ele imprime o inventário, roda as identidades
> aritméticas e faz a reconciliação — os números deste documento saíram dele.

**Base da medição.** O export real da Freightec importado pelo pipeline de
produção (`receiveFile → captureRaw → stage → preview → promote`) mais a
curadoria (`seedTaxonomy`, `runProposalPass`, `applyConfirmations`): 9
vigências, 558 linhas de cavalo, 657 de carreta, 133 equipamentos em
agosto/2026.

**Uma diferença de contagem, dita antes de tudo.** A ficha em produção mostra
*36 sem classificação* para a QYP6C04; este export tem **34** no cavalo (e 23
na carreta). São arquivos diferentes — a base de produção é `EMPURRADA_2_8_2026`
e esta é `EMPURRADA_1_8_2026`. As duas colunas a mais precisam ser conferidas
na base de produção com o mesmo CLI; toda a análise abaixo vale coluna a
coluna, e não pela contagem.

---

## 1. Evidência ≠ interpretação

Este documento separa as duas em todas as linhas:

- **Medido** — uma conta sobre as 558/657 linhas reais, com o número de acertos.
  Reproduzível pelo CLI.
- **Declarado** — o que a própria Freightec escreve no cabeçalho gerencial da
  planilha (`docs/DICIONARIO-TABELA-DE-CAVALO.md`, coluna *Nome Gerencial*), ou
  o que o repositório já registra em `CONFIRMED_SEMANTICS`,
  `catalogo-declarado.ts`, `lib/dre/src/plano.ts`.
- **Interpretação** — leitura minha a partir dos dois acima. Nunca sozinha, e
  sempre marcada.

Nenhuma classificação abaixo saiu de ler o nome da coluna.

---

## 2. Os quatro achados que decidem o caso

### 2.1 `lucroVariavelPrevisto` é 0,65% do valor da nota — nos dois equipamentos

| Medição | Resultado |
|---|---|
| `cavalo.lucroVariavelPrevistoCavalo` = 0,65% × `valorNfCompra` | **442 de 442** linhas com valor · razão única `0,0065` · desvio 0,00 |
| `carreta.lucroVariavelPrevistoCarreta` = 0,65% × `valorNfCompra` | **589 de 589** linhas com valor · razão única `0,0065` |

Uma taxa fixa sobre o valor do ativo, idêntica nos dois tipos de equipamento, é
**regra de contrato aplicada, não valor negociado linha a linha**. É por isso
que o campo se chama *previsto*: ele é calculado, não apurado.

### 2.2 O zero desta coluna significa **veículo parado** — e não "não informado"

| `lucroVariavelPrevistoCavalo` | `ativo` | linhas |
|---|---|---|
| > 0 | `ATIVO` | **442** |
| = 0 | `PARADO` | **116** |
| qualquer outra combinação | — | **0** |

Correspondência perfeita, nas 558 linhas. E as **107 transições** que
`lib/advisory/src/transicoes.ts` registra como "zero de um dos lados" são
exatamente 51 `PARADO→ATIVO` e 56 `ATIVO→PARADO`.

> **Isto corrige o repositório.** `transicoes.ts` documenta hoje: *"a fonte
> escreve zero onde quer dizer «não informado»: `lucroVariavelPrevistoCavalo`
> tem 107 de 107 transições com zero de um dos lados"*. A observação estava
> certa; a leitura, não. O zero é um **estado operacional**, e a coluna some e
> volta porque o veículo para e volta a rodar. A consequência prática é grande:
> a variação entre vigências dessa coluna **não é lacuna de dado nem mudança de
> preço** — é frota parando. Corrigir esse comentário é a única mudança de
> código que recomendo nesta rodada, e ela não move nenhum número.

### 2.3 `carreta.lucroVariavelPrevisto` é do **conjunto** — a mesma armadilha do `custoFixo`

```
carreta.lucroVariavelPrevisto = carreta.lucroVariavelPrevistoCarreta + cavalo.lucroVariavelPrevistoCavalo
```
**529 de 558** pares (cavalo vinculado) fecham na tolerância de R$ 0,01; as 29
restantes fecham em R$ 0,02 — arredondamento, não exceção. As 99 linhas sem
cavalo vinculado ficam de fora da conta.

É exatamente a estrutura que `docs/COMPOSICAO.md` §2 já provou para
`carreta.finame` (que contém o cavalo). Somar as três colunas contaria o lucro
variável do cavalo duas vezes — **R$ 206.800,31/mês em agosto/2026**.

### 2.4 Três colunas são cópias exatas de outras, e três são derivadas

| Medido | Resultado | Consequência |
|---|---|---|
| `manutencaoContrato` == `valorReajustado` | 558/558 | duplicata |
| `freeMaintenance` == `manutencaoFreeMaintenance` | 558/558 | duplicata |
| `anoBid` == `manutencaoAno` | 558/558 | duplicata |
| `taxaFiname` = (1+TJLP)(1+spreadBNDES)(1+spreadBanco) − 1 | **558/558** | subtotal dos três |
| `valorReajustado` = `reaiskm` × (1 + `percentualReajusteAplicado`) | 126/126 | derivado |
| `finameImplemento` = `custoAluguel` + `amortizacao` + `juros` | 651/651 | `custoAluguel` já está dentro |

Sobre a `taxaFiname`: a composição é **multiplicativa**, não a soma. A soma
simples fecha em 428 das 558 linhas e falha nas outras 130 — a composição
fecha em todas. Quem somar TJLP + spreads como se fosse a taxa erra 0,4 ponto
percentual na metade da frota.

---

## 3. Inventário — cavalo, 34 colunas (agosto/2026)

Ordenado por materialidade. `varia` = quantos dos 64 ativos mudam de valor ao
longo das 9 vigências. `dist` = valores distintos na vigência.

| # | Chave | Cabeçalho na planilha | Aba | Amostra | Eq. | Zeros | dist | Soma da frota | varia | Unid. hoje | Semântica hoje |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `cavalo.odometro_entrada` | `odometroEntrada` | cavalos | 544.061 | 62 | 0 | 62 | 23.650.494 | 62/64 | KM | PRESUMED |
| 2 | `cavalo.lucro_variavel_previsto_cavalo` | `lucroVariavelPrevistoCavalo` | cavalos | 5.005,00 | 62 | 16 | 7 | **206.800,31** | 34/64 | BRL | PRESUMED |
| 3 | `cavalo.ano` | `ano` | cavalos | 2025 | 62 | 0 | 4 | 125.351 | 0/64 | ANO | PRESUMED |
| 4 | `cavalo.manutencao_ano` | `manutencaoAno` | cavalos | 2025 | 62 | 0 | 3 | 125.350 | 0/64 | ANO | PRESUMED |
| 5 | `cavalo.ano_bid` | `anoBid` | cavalos | 2025 | 62 | 0 | 3 | 125.350 | 0/64 | ANO | PRESUMED |
| 6 | `cavalo.periodo_finame` | `periodoFiname` | cavalos | 60 | 62 | 0 | 1 | 3.720 | 0/64 | — | UNKNOWN |
| 7 | `cavalo.manutencao_vida_meses` | `manutencaoVidaMeses` | cavalos | 67,9 | 62 | 0 | 16 | 3.139,94 | 64/64 | MESES | PRESUMED |
| 8 | `cavalo.combustivel_capacidade` | `combustivelCapacidade` | cavalos | 42 | 62 | 0 | 2 | 1.778 | 0/64 | LITROS | PRESUMED |
| 9 | `cavalo.percentual_entrada` | `percentualEntrada` | cavalos | 20 | 62 | 0 | 1 | 1.240 | 0/64 | PERCENT | PRESUMED |
| 10 | `cavalo.taxa_finame` | `Taxa Finame (%)` | cavalos | 19,85 | 62 | 0 | 13 | 1.105,89 | 10/64 | PERCENT | PRESUMED |
| 11 | `cavalo.spread_banco` | `Spread Banco` | cavalos | 19,85 | 62 | 0 | 9 | 977,27 | 0/64 | PERCENT | PRESUMED |
| 12 | `cavalo.percentual_icms` | `percentualIcms` | cavalos | 12 | 62 | 0 | 1 | 744 | 0/64 | PERCENT | PRESUMED |
| 13 | `cavalo.percentual_reajuste_aplicado` | `percentualReajusteAplicado` | cavalos | 20,56 | 62 | 1 | 14 | 557,14 | 4/64 | PERCENT | PRESUMED |
| 14 | `cavalo.mes_de_entrada` | `mesDeEntrada` | cavalos | 12 | 62 | 0 | 10 | 528 | 0/64 | — | UNKNOWN |
| 15 | `cavalo.carencia` | `carencia` | cavalos | 6 | 62 | 10 | 5 | 284 | 0/64 | QTD | PRESUMED |
| 16 | `cavalo.custo_variavel_simulado` | `Custo Variável Simulado` | cavalos | 7,96 | 62 | 0 | 10 | 258,43 | 64/64 | — | UNKNOWN |
| 17 | `cavalo.combustivel_vida_cavalo` | `combustivelVidaCavalo` | cavalos | 5,58 | 62 | 0 | 16 | 258,22 | 64/64 | MESES | PRESUMED |
| 18 | `cavalo.free_maintenance` | `freeMaintenance` | cavalos | 6 | 62 | 24 | 2 | 228 | 0/64 | — | UNKNOWN |
| 19 | `cavalo.manutencao_free_maintenance` | `manutencaoFreeMaintenance` | cavalos | 6 | 62 | 24 | 2 | 228 | 0/64 | — | UNKNOWN |
| 20 | `cavalo.combustivel_consumo_neg` | `combustivelConsumoNeg` | cavalos | 1,96 | 62 | 0 | 4 | 112,97 | 62/64 | KM_L | PRESUMED |
| 21 | `cavalo.tjlp` | `TJLP` | cavalos | 12,07 | 62 | 48 | 7 | 106,14 | 10/64 | PERCENT | PRESUMED |
| 22 | `cavalo.combustivel_consumo_benchmark` | `combustivelConsumoBenchmark` | cavalos | 2,19 | 62 | 16 | 4 | 99,84 | 34/64 | KM_L | PRESUMED |
| 23 | `cavalo.combustivel_percentual_perda_vida` | `combustivelPercentualPerdaVida` | cavalos | −1,5 | 62 | 1 | 4 | −76,50 | 15/64 | PERCENT | PRESUMED |
| 24 | `cavalo.ciclo` | `ciclo` | cavalos | 2 | 62 | 0 | 2 | 72 | 10/64 | QTD | PRESUMED |
| 25 | `cavalo.operador_promax` | `Operador - Promax` | cavalos | 1 | 62 | 0 | 1 | 62 | 0/64 | — | UNKNOWN |
| 26 | `cavalo.manutencao_bid` | `manutencaoBid` | cavalos | 0,54 | 62 | 0 | 9 | 23,47 | 1/64 | BRL_KM | PRESUMED |
| 27 | `cavalo.spread_bndes` | `Spread BNDES` | cavalos | 1,3 | 62 | 48 | 3 | 16,25 | 0/64 | PERCENT | PRESUMED |
| 28 | `cavalo.manutencao_reais_km` | `manutencaoReaisKm` | cavalos | 0,48 | 62 | 16 | 9 | 15,84 | 35/64 | BRL_KM | PRESUMED |
| 29 | `cavalo.valor_reajustado` | `valorReajustado` | cavalos | 0,34 | 62 | 48 | 2 | 4,76 | 0/64 | — | UNKNOWN |
| 30 | `cavalo.manutencao_contrato` | `manutencaoContrato` | cavalos | 0,34 | 62 | 48 | 2 | 4,76 | 0/64 | — | UNKNOWN |
| 31 | `cavalo.reaiskm` | `reaiskm` | cavalos | 0,32 | 62 | 48 | 2 | 4,48 | 0/64 | BRL_KM | PRESUMED |
| 32 | `cavalo.custo_aluguel` | `custoAluguel` | cavalos | 0 | 62 | 62 | 1 | 0,00 | 0/64 | BRL | PRESUMED |
| 33 | `cavalo.valor_icms` | `valorIcms` | cavalos | 0 | 62 | 62 | 1 | 0,00 | 0/64 | BRL | PRESUMED |
| 34 | `cavalo.valor_pneu` | `valorPneu` | cavalos | 0 | 62 | 62 | 1 | 0,00 | 0/64 | BRL | PRESUMED |

**Onde cada chave é usada hoje no código** (nenhuma delas alimenta um total).
Todas as 57 aparecem em `lib/curation/src/catalogo-declarado.ts` (nome
gerencial e seção da DRE declarados pela planilha do time), em
`lib/comparison/src/families.ts` e `labels.ts` (agrupamento e vocabulário de
tela) e em `lib/curation/src/semantics.ts` (a dedução de unidade que produziu o
`PRESUMED` atual). Além dessas:

| Chave | Onde mais aparece |
|---|---|
| todas | `lib/composition/src/motor.ts` — o portão que as recusa e produz a contagem "sem classificação" |
| todas do cavalo | `docs/DICIONARIO-TABELA-DE-CAVALO.md` — a descrição escrita pelo time |
| `lucroVariavelPrevistoCavalo` | `lib/advisory/src/transicoes.ts` (coluna intermitente) · `lib/advisory/src/__tests__/recomendacao.test.ts` · `lib/remuneracao/src/catalogo.ts`, onde a linha "Lucro Operacional Variável (previsto)" está declarada **sem origem**, esperando exatamente esta confirmação · `lib/composition/src/__tests__/importacao-limpa.test.ts` e `composicao-real.test.ts`, que prendem o comportamento atual (fora do total) |
| `manutencaoReaisKm`, `manutencaoBid` | `lib/dre/src/plano.ts` — citadas como as colunas de custo variável que esperam a quilometragem. `reaiskm`, `valorReajustado` e `custoVariavelSimulado` **não são citadas em lugar nenhum além do catálogo e do vocabulário de tela** |
| `combustivelConsumoNeg`, `combustivelConsumoBenchmark`, `combustivelCapacidade` | `lib/dre/src/plano.ts` (`variavel.diesel`) e `lib/curation/src/semantics.ts` (`guessUnit`, onde está a divergência pallets × litros) |
| `odometroEntrada`, `ciclo` | `lib/comparison/src/__tests__/panorama-real.test.ts` e `cockpit.test.ts` — medições da série já registradas |
| `operadorPromax` | `lib/curation/src/direcao-economica-trecho.ts` e `families.ts` — tratado como código de cadastro, nunca como quantidade |
| `carreta.seguro` | `lib/advisory/src/__tests__/recomendacao.test.ts` e `lib/curation/src/__tests__/curation.test.ts` — o exemplo canônico de "semântica presumida" |

### Anexo — carreta, 23 colunas

| Chave | Cabeçalho | Soma ago/2026 | dist | Observação medida |
|---|---|---|---|---|
| `carreta.lucro_variavel_previsto` | `lucroVariavelPrevisto` | **290.740,11** | 22 | **escopo de conjunto** (§2.3) |
| `carreta.ano` | `ano` | 143.498 | 5 | ano de calendário |
| `carreta.lucro_variavel_previsto_carreta` | `lucroVariavelPrevistoCarreta` | **100.373,34** | 16 | 0,65% × NF, 589/589 |
| `carreta.seguro` | `seguro` | **36.568,99** | 33 | fora de `custoFixo`; 0 negativos; R$ 97,93–789,62 |
| `carreta.ipva_licenciamento_mensal` | `ipvaLicenciamentoMensal` | **23.343,88** | 20 | homônimo; 6 valores negativos |
| `carreta.revestimento` | `revestimento` | 19.733,74 | 1 | R$ 277,94 igual para toda a frota |
| `carreta.ipva_licenciamento` | `ipvaLicenciamento` | 10.875,69 | 8 | homônimo; 15 negativos |
| `carreta.periodo_finame` | `periodoFiname` | 4.200 | 2 | prazo em meses |
| `carreta.percentual_entrada` | `percentualEntrada` | 1.400 | 2 | alíquota |
| `carreta.tacografo` | `tacografo` | 1.303,86 | 2 | R$ 21,03 ou zero |
| `carreta.percentual_icms` | `percentualIcms` | 1.278 | 1 | alíquota |
| `carreta.faixa_reflexiva` | `faixaReflexiva` | 1.131,74 | 1 | R$ 15,94 igual para toda a frota |
| `carreta.taxa_finame` | `Taxa Finame (%)` | 1.046,65 | 17 | subtotal dos três spreads |
| `carreta.spread_banco` | `Spread Banco` | 784,97 | 16 | alíquota |
| `carreta.mes_de_entrada` | `mesDeEntrada` | 571 | 7 | mês de calendário |
| `carreta.carencia` | `carencia` | 413 | 3 | meses |
| `carreta.tjlp` | `TJLP` | 210,20 | 5 | alíquota |
| `carreta.ciclo` | `ciclo` | 104 | 2 | contador de ciclo |
| `carreta.operador_promax` | `Operador - Promax` | 71 | 1 | **código**, não quantidade |
| `carreta.spread_bndes` | `Spread BNDES` | 39,80 | 5 | alíquota |
| `carreta.rastreador` | `rastreador` | 0,00 | 1 | zerada na série inteira |
| `carreta.valor_icms` | `valorIcms` | 0,00 | 1 | zerada na série inteira |
| `carreta.valor_pneus` | `valorPneus` | 0,00 | 1 | zerada na série inteira |

---

## 4. A tabela final — classificação proposta

`Monetário` = é um **montante em reais** (uma razão R$/km não é: é preço por
unidade de uma base que o export não traz). `Direção` = ganho para quem opera o
ativo / perda / neutro. As quatro colunas são independentes de propósito: um
campo pode ser monetário e não entrar na remuneração.

### Cavalo

| Campo | Categoria proposta | Monet. | Direção | Entra remuneração | Entra impacto | Evidência | Confiança |
|---|---|---|---|---|---|---|---|
| `lucro_variavel_previsto_cavalo` | `REMUNERACAO_VARIAVEL` | sim | ganho | **não determinado** | sim, mas por estado | Medido: 0,65% × NF (442/442); zero ⟺ PARADO (558/558); fora de todo total (0/442) | ALTA no que é · **decisão** para somar |
| `custo_variavel_simulado` | `REFERENCIA_OPERACIONAL` | não (R$/km) | perda | não | não | Medido: (cvs − `manutencaoReaisKm`) × consumo = R$ 5,78→6,42/L por vigência — é diesel/consumo + manutenção, **subtotal derivado** | MÉDIA |
| `manutencao_reais_km` | `CUSTO` | não (R$/km) | perda | não (falta km) | não | Declarado (dicionário) + unidade BRL_KM; = `valorReajustado` quando há contrato (248), senão 0,88–0,94 × `manutencaoBid` | ALTA |
| `manutencao_bid` | `CUSTO` | não (R$/km) | perda | não (falta km) | não | Declarado: R$/km da matriz do BID | ALTA |
| `reaiskm` | `CUSTO` | não (R$/km) | perda | não (falta km) | não | Declarado: R$/km do contrato | ALTA |
| `valor_reajustado` | `CUSTO` (derivado) | não (R$/km) | perda | **não — derivado** | não | Medido: = `reaiskm` × (1+reajuste), 126/126 | ALTA |
| `manutencao_contrato` | `CUSTO` (duplicata) | não (R$/km) | perda | **não — duplicata** | não | Medido: == `valorReajustado`, 558/558 | ALTA |
| `custo_aluguel` | `CUSTO` | sim | perda | não (zerado) | não | Medido: zero em 558/558 no cavalo. Na carreta o mesmo campo é confirmado e é parcela de `finameImplemento` (651/651) | ALTA (que não soma) |
| `valor_icms` | `NAO_DETERMINADO` | sim | ganho? | não (zerado) | não | Medido: zero em 558/558. Coluna sem dado, não imposto zero | BAIXA — perguntar à Ambev |
| `valor_pneu` | `NAO_DETERMINADO` | sim | perda | não (zerado) | não | Medido: zero em 558/558 | BAIXA — perguntar à Ambev |
| `taxa_finame` | `PERCENTUAL` (subtotal) | não | neutro | não | não | Medido: composição multiplicativa dos três, 558/558 | ALTA |
| `tjlp`, `spread_bndes`, `spread_banco` | `PERCENTUAL` | não | neutro | não | não | Declarado + medido como parcelas da taxa | ALTA |
| `percentual_entrada` | `PERCENTUAL` | não | neutro | não | não | Declarado; 20% em toda a frota | ALTA |
| `percentual_icms` | `PERCENTUAL` | não | neutro | não | não | Declarado; o montante é `valorIcms`. Espelha `carreta.icms`, já confirmado assim | ALTA |
| `percentual_reajuste_aplicado` | `PERCENTUAL` | não | neutro | não | sim (muda preço futuro) | Medido: entra em `valorReajustado` | ALTA |
| `combustivel_percentual_perda_vida` | `PERCENTUAL` | não | perda | não | não | Declarado; −1,5% → −2,0% em 15 cavalos | ALTA |
| `periodo_finame` | `QUANTIDADE` (meses) | não | neutro | não | não | Medido (razão 1,081 da amortização) + declarado | ALTA |
| `carencia` | `QUANTIDADE` (meses) | não | neutro | não | não | Declarado | ALTA |
| `free_maintenance` | `QUANTIDADE` (meses) | não | neutro | não | não | Declarado: carência de manutenção | ALTA |
| `manutencao_free_maintenance` | `QUANTIDADE` (duplicata) | não | neutro | não | não | Medido: == `freeMaintenance`, 558/558 | ALTA |
| `combustivel_capacidade` | `QUANTIDADE` | não | neutro | não | não | Declarado: **pallets** (o repositório registra litros — divergência já anotada no dicionário) | ALTA que não soma · MÉDIA na unidade |
| `combustivel_consumo_neg` | `REFERENCIA_OPERACIONAL` | não (km/l) | neutro | não | não | Declarado | ALTA |
| `combustivel_consumo_benchmark` | `REFERENCIA_OPERACIONAL` | não (km/l) | neutro | não | não | Declarado | ALTA |
| `combustivel_vida_cavalo` | `REFERENCIA_OPERACIONAL` | não | neutro | não | não | Medido: razão 12,17 com `manutencaoVidaMeses` — relógio, não premissa | ALTA |
| `manutencao_vida_meses` | `REFERENCIA_OPERACIONAL` | não | neutro | não | não | Idem | ALTA |
| `odometro_entrada` | `REFERENCIA_OPERACIONAL` | não (km) | neutro | não | não | Declarado: hodômetro na entrada. **Não é a quilometragem do período** — não destrava os R$/km | ALTA |
| `ciclo` | `REFERENCIA_OPERACIONAL` | não | neutro | não | não | Medido: ciclo 1 ⟺ amortização > 0 e lucro fixo = 0 (503) · ciclo 2 ⟺ amortização = 0 (55) — 554 de 558 | ALTA |
| `ano` | `IDENTIFICADOR` (ano) | não | neutro | não | não | Declarado: ano da compra | ALTA |
| `ano_bid` | `IDENTIFICADOR` (ano) | não | neutro | não | não | Declarado: linha da matriz do BID | ALTA |
| `manutencao_ano` | `IDENTIFICADOR` (duplicata) | não | neutro | não | não | Medido: == `anoBid`, 558/558 | ALTA |
| `mes_de_entrada` | `IDENTIFICADOR` (mês) | não | neutro | não | não | Declarado | ALTA |
| `operador_promax` | `IDENTIFICADOR` | não | neutro | não | não | Declarado: **código Promax do transportador**. Hoje é somado como número (62) em qualquer agregação cega | ALTA |

### Carreta (só o que difere do cavalo)

| Campo | Categoria proposta | Monet. | Direção | Entra remuneração | Entra impacto | Evidência | Confiança |
|---|---|---|---|---|---|---|---|
| `lucro_variavel_previsto` | `REMUNERACAO_VARIAVEL` — **escopo de conjunto** | sim | ganho | **não — subtotal** | não | Medido: = carreta + cavalo, 529/558 a R$ 0,01 (as 29 restantes a R$ 0,02) | ALTA |
| `lucro_variavel_previsto_carreta` | `REMUNERACAO_VARIAVEL` | sim | ganho | **não determinado** | sim, mas por estado | Medido: 0,65% × NF, 589/589 | ALTA no que é · **decisão** para somar |
| `seguro` | `CUSTO` (ou repasse) | sim | perda | **não determinado** | sim | Medido: fora de `custoFixo` (0/657); R$ 97,93–789,62; varia em 7 dos 80 ativos | MÉDIA |
| `revestimento` | `CUSTO` | sim | perda | **não determinado** | não | Medido: R$ 277,94 idêntico em 657/657 | MÉDIA |
| `faixa_reflexiva` | `CUSTO` | sim | perda | **não determinado** | não | Medido: R$ 15,94 idêntico em 657/657 | MÉDIA |
| `tacografo` | `CUSTO` | sim | perda | **não determinado** | não | Medido: R$ 21,03 ou zero | MÉDIA |
| `ipva_licenciamento_mensal` | `CUSTO` | sim | perda | **não determinado** | sim | Medido: = anual ÷ 12 em apenas 103/657; 6 valores negativos | BAIXA — homonímia |
| `ipva_licenciamento` (carreta) | `CUSTO` | sim | perda | **não determinado** | sim | Medido: 15 negativos; razão com a NF varia (47 valores distintos), ao contrário do cavalo, onde é 1,000% fixo | BAIXA — homonímia |
| `rastreador`, `valor_icms`, `valor_pneus` | `NAO_DETERMINADO` | sim | perda | não (zerados) | não | Medido: zero em 657/657 | BAIXA — perguntar à Ambev |

---

## 5. Reconciliação financeira

### 5.1 Frota inteira — agosto/2026

**Antes (o que a Composição soma hoje)**

| Componente | Valor |
|---|---|
| `cavalo.finameCavalo` | 867.860,23 |
| `carreta.finameImplemento` | 254.748,52 |
| `carreta.lucroFixomodeloNovoCiclo` | 82.055,25 |
| **Total mensal apurado** | **1.204.664,00** |
| `cavalo.ipvaLicenciamento` (gaveta anual) | 268.951,80 /ano |
| Aquisição (NF + PIS/COFINS, cavalo e carreta) | 63.922.653,09 |

Massa numérica sem classificação, hoje: **57 colunas** — das quais **15 estão
em reais** (11 já marcadas `isMonetary` e 4 que são dinheiro sem unidade
declarada), somando **R$ 690.871,66** na vigência; as outras 42 não são
montante.

**Depois — simulação, se cada proposta fosse confirmada como mensal**

| Bloco | Valor/mês | Entra? |
|---|---|---|
| Remuneração fixa (hoje) | 1.204.664,00 | já entra |
| **A** — Remuneração variável prevista: cavalo 206.800,31 + carreta 100.373,34 | **307.173,65** | decisão |
| **A′** — o mesmo dinheiro pelo escopo de conjunto (`carreta.lucroVariavelPrevisto`) | 290.740,11 | **nunca** — dupla contagem |
| **B** — Seguro e acessórios da carreta | 58.738,33 | decisão |
| **C** — IPVA da carreta (as duas colunas homônimas) | 34.219,57 | decisão |
| Itens monetários deliberadamente fora: aquisição, R$/km sem km, colunas zeradas | — | não |
| **Total proposto (A+B+C)** | **1.604.795,55** | |
| **Diferença para hoje** | **+400.131,55/mês (+33,2%)** | |

### 5.2 Uma placa real — conjunto RZW6G32 (cavalo) + RPO6D01 (carreta)

| Linha | Hoje | Proposto |
|---|---|---|
| `cavalo.finameCavalo` (= amortização 10.266,67 + juros 5.352,41) | 15.619,08 | 15.619,08 |
| `carreta.finameImplemento` | 12.190,22 | 12.190,22 |
| `cavalo.lucroVariavelPrevistoCavalo` (0,65% × R$ 770.000) | — | 5.005,00 |
| `carreta.lucroVariavelPrevistoCarreta` (0,65% × NF) | — | 3.207,01 |
| `carreta.lucroVariavelPrevisto` (conjunto: 5.005,00 + 3.207,01 = 8.212,01) | — | **excluído** |
| `carreta.seguro` · `revestimento` · `tacografo` · `faixaReflexiva` | — | 1.104,53 |
| `carreta.ipvaLicenciamentoMensal` + `ipvaLicenciamento` | — | 738,14 |
| **Total do conjunto** | **27.809,30** | **37.863,98 (+36,2%)** |

O `carreta.custoFixo` declarado pela fonte para este conjunto é **27.809,30** —
exatamente o total de hoje. **A fonte concorda com o número atual**, e é isso
que torna a decisão sobre A, B e C uma decisão de negócio e não de dado: o que
está sendo perguntado é se a remuneração do conjunto é o `custoFixo` que a
planilha declara, ou o `custoFixo` **mais** rubricas que a planilha traz em
colunas separadas e não soma em lugar nenhum.

---

## 6. Risco de dupla contagem — a prova exigida antes de somar qualquer coisa

| Campo candidato | É subtotal? | É % de outra rubrica? | Duplica cavalo/carreta? | Está dentro de um total já somado? | Veredito |
|---|---|---|---|---|---|
| `cavalo.lucroVariavelPrevistoCavalo` | não | é 0,65% de `valorNfCompra`, que é **grandeza de aquisição** e nunca entra na remuneração | não | não (0/442 contra `finameCavalo`) | **Somável sem dupla contagem** |
| `carreta.lucroVariavelPrevistoCarreta` | não | idem | não | não | **Somável sem dupla contagem** |
| `carreta.lucroVariavelPrevisto` | **sim** — soma dos dois acima | — | **sim** | — | **Nunca somar** |
| `carreta.seguro`, `revestimento`, `tacografo`, `faixaReflexiva` | não | não | não | não (0/657 dentro de `custoFixo`) | Somável **se** a periodicidade for confirmada |
| `carreta.ipvaLicenciamentoMensal` / `ipvaLicenciamento` | — | — | — | não | **As duas juntas, nunca** — são homônimas, e somar as duas conta o IPVA duas vezes em alguma medida desconhecida |
| `cavalo.taxaFiname` | **sim** — composição de TJLP + spreads | — | não | — | Não somável (e é alíquota) |
| `cavalo.valorReajustado` / `manutencaoContrato` | derivado de `reaiskm` / duplicata | é `reaiskm` × (1+reajuste) | não | — | Não somável |
| `cavalo.custoVariavelSimulado` | **provável** — diesel/consumo + manutenção | — | não | — | Não somável até a fórmula ser confirmada |
| `cavalo.custoAluguel` | é parcela de `finameImplemento` na carreta (651/651) | — | — | sim, na carreta | Não somável separadamente |
| `anoBid`/`manutencaoAno`, `freeMaintenance`/`manutencaoFreeMaintenance` | duplicatas | — | — | — | Não somáveis (e não são dinheiro) |

Método: varredura de identidades sobre a matriz inteira — todas as colunas
numéricas × todas as linhas (558 cavalo, 657 carreta), testando igualdade,
razão constante e soma de subconjuntos de até 4 parcelas com tolerância de
R$ 0,02. As identidades que sobreviveram estão codificadas como hipóteses
nomeadas no CLI, com a contagem de acertos ao lado — para poderem ser
refutadas por um dado novo, e não apenas repetidas.

---

## 7. Conclusão

### Pode classificar automaticamente — impacto financeiro **R$ 0,00**

**29 colunas do cavalo e 12 da carreta — 41 ao todo**, todas com confiança ALTA
e todas não-monetárias ou não-somáveis: os percentuais (`taxaFiname`, `tjlp`, os dois
spreads, `percentualEntrada`, `percentualIcms`, `percentualReajusteAplicado`,
`combustivelPercentualPerdaVida`), as quantidades (`periodoFiname`, `carencia`,
`freeMaintenance` e sua duplicata, `combustivelCapacidade`), as referências
operacionais (os dois consumos, os dois relógios de vida, `odometroEntrada`,
`ciclo`, `custoVariavelSimulado`), os identificadores (`ano`, `anoBid`,
`manutencaoAno`, `mesDeEntrada`, `operadorPromax`) e as razões em R$/km
(`manutencaoReaisKm`, `manutencaoBid`, `reaiskm`, `valorReajustado`,
`manutencaoContrato`).

Confirmá-las **não muda nenhum total** — todas já estão fora, e a confirmação
só troca "ninguém olhou" por "alguém decidiu que não é dinheiro". O ganho é na
tela: a pendência do cavalo cai de 34 para **5** — lucro variável previsto,
custo variável simulado e as três colunas zeradas —, e o que sobra na contagem
passa a ser exatamente o que espera decisão humana.

**Mesmo assim, não apliquei.** A instrução desta rodada foi não alterar
produção, e uma entrada em `CONFIRMED_SEMANTICS` é aplicada em produção pela
promoção e pela curadoria. As 38 linhas estão prontas para virar um commit
assim que você aprovar — e esse commit não move um centavo.

### Precisa de decisão de negócio

1. **A remuneração do conjunto é o `custoFixo` da fonte, ou `custoFixo` +
   lucro variável previsto?** É a pergunta de R$ 307.173,65/mês. O dado prova
   *o que a coluna é* (0,65% do valor do ativo, enquanto ele roda); não prova
   *que a Ambev paga isso*. Um "previsto" pode ser projeção interna que nunca
   vira pagamento.
2. **Qual a periodicidade do lucro variável previsto?** Sem ela não há gaveta.
   0,65% ao mês são 7,8% ao ano sobre o valor do ativo — plausível como
   remuneração de capital variável, e é conta que precisa de confirmação, não
   de dedução.
3. **`seguro`, `revestimento`, `tacografo`, `faixaReflexiva` são pagos além do
   `custoFixo`?** R$ 58.738,33/mês. Estão fora de todo total declarado, e
   `revestimento` e `faixaReflexiva` são idênticos para a frota inteira — o que
   parece rateio, não custo do ativo.
4. **As duas colunas de IPVA da carreta medem o quê?** `ipvaLicenciamentoMensal`
   não é `ipvaLicenciamento`/12 (só 103 de 657), e as duas têm valores
   negativos. O `DISTINCT_BASES` da curadoria já apontou a homonímia.
5. **`valorIcms`, `valorPneu`, `rastreador` zeradas na série inteira:** a coluna
   parou de ser preenchida ou o custo é zero mesmo? Zero somado afirma que o
   custo não existe.

### Suspeita de subtotal / duplicação — não somar até prova

`carreta.lucroVariavelPrevisto` (conjunto), `cavalo.taxaFiname`,
`cavalo.valorReajustado`, `cavalo.manutencaoContrato`,
`cavalo.custoVariavelSimulado`, `cavalo.anoBid`/`manutencaoAno`,
`cavalo.freeMaintenance`/`manutencaoFreeMaintenance`.

### Impacto potencial

| Cenário | Efeito no total mensal da frota |
|---|---|
| Aplicar **todas** as classificações de confiança ALTA | **R$ 0,00** — 1.204.664,00 continua 1.204.664,00 |
| Aprovar A (lucro variável, sem o conjunto) | +307.173,65 → 1.511.837,65 (**+25,5%**) |
| Aprovar A + B | +365.911,98 → 1.570.575,98 (**+30,4%**) |
| Aprovar A + B + C | +400.131,55 → 1.604.795,55 (**+33,2%**) |
| Somar `carreta.lucroVariavelPrevisto` junto de A | erro de +290.740,11 — **dupla contagem** |

### A única mudança de código que recomendo agora

Corrigir o comentário de `lib/advisory/src/transicoes.ts`, que hoje afirma que
o zero de `lucroVariavelPrevistoCavalo` é "não informado". É "veículo parado",
com 558/558 de correspondência. O texto orienta leitura humana e já orientou
uma decisão de produto (contar o zero à parte); mantê-lo errado custa mais que
a linha que ele economiza. Nenhum número muda.
