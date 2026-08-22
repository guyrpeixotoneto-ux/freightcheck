# A linhagem do `RESUMO GERAL` — de onde sai cada número, e o que ainda não fecha

Este documento descreve **comportamento implementado e sob teste**, não um
diagnóstico. Cada afirmação aqui é reproduzida por código no repositório e
verificada contra os relatórios reais de **julho/2026 — CDD Belém · Horizonte**.

Para rodar o gate contra o material de verdade:

```
pnpm --filter @workspace/fechamento exec tsx ./src/reconciliar-real-cli.ts \
  --gabarito ./src/__tests__/amostras/julho-2026.json \
  --q1 2art=…,pagamento=…,disponibilidade=…,ctes=…,conciliacao=… \
  --q2 2art=…,pagamento=…,disponibilidade=…,requisicoes=…,ctes=…,conciliacao=…
```

O gate de regressão é `__tests__/gate-real.test.ts`, que roda o mesmo caminho
quando os arquivos estão em `__tests__/amostras/operacional/` e **nomeia o que
falta** quando não estão.

## A regra do documento

**A `.xlsb` não é fonte de cálculo.** Ela entra por uma porta só — a coluna de
referência, contra a qual se mede. Todo número do sistema sai dos relatórios
importados e do cadastro contratual da unidade.

## A natureza de cada linha

Antes de perguntar *bate?*, a matriz pergunta *de que natureza é este número?*.
São quatro, e cada uma manda a conferência para um lugar diferente:

| Origem | O que significa | Quando discorda, confira |
|---|---|---|
| `CAD` | sai do cadastro contratual | o contrato da unidade |
| `DOC` | sai de um relatório, no máximo brutada | o relatório |
| `CALC` | o sistema calcula de documento e/ou cadastro | a regra |
| `SUB` | é soma de outras linhas | **nada** — ela herda; procurar erro nela é procurar no lugar errado |

Está em `OrigemDaLinha`, em `matriz.ts`, e toda linha declara também as
`dependencias` — o que precisa existir para ela ter número.

## A matriz — julho/2026, coluna do mês

| # | Linha | Origem | Sistema | Referência XLSB | Diferença | Status |
|---|---|---|---:|---:|---:|---|
| 7 | TOTAL REMUNERAÇÃO ROTA DVS | CALC | 635.168,85 | 640.822,46 | −5.653,61 | divergência da planilha |
| 8 | CUSTO FIXO PADRONIZADO | CAD | 1.470.904,89 | 1.470.776,84 | 128,05 | divergência da planilha |
| 9 | CUSTO FIXO INATIVOS | CAD | 32.852,12 | 32.852,12 | 0,00 | **OK** |
| 10 | CUSTO VANS INATIVAS | CAD | 26.191,67 | 26.191,68 | −0,01 | divergência da planilha |
| 11 | INDISPONIBILIDADE | CALC | 0,00 | 0,00 | 0,00 | **OK** |
| 12 | CUSTO FIXO - ESPECIAIS | CAD | 11.883,11 | 11.883,11 | 0,00 | **OK** |
| 13 | CUSTO FIXO - VANS | CAD | 85.538,41 | 85.538,41 | 0,00 | **OK** |
| 14 | DESCONTO DE DEVOLUÇÃO % | DOC | −39.747,42 | −39.747,43 | 0,01 | divergência da planilha |
| 15 | DESCONTO DE DISPONIBILIDADE | CALC | −125.271,68 | −141.179,05 | 15.907,37 | divergência da planilha |
| 16 | DESCONTO COMPLEMENTAR NEGATIVO | DOC | −25.700,41 | −14.050,54 | −11.649,87 | divergência da planilha |
| 17 | TOTAL REMUNERAÇÃO ROTA | SUB | 2.071.819,54 | 2.073.087,59 | −1.268,05 | herdada |
| 21 | CUSTO VARIÁVEL (FROTA FIXA) | CALC | 356.233,82 | 355.542,76 | 691,06 | divergência da planilha |
| 22 | CUSTO VARIÁVEL (AGREGADO) | DOC | 252.380,53 | 252.380,42 | 0,11 | divergência da planilha |
| 23 | DESCONTO DE DEVOLUÇÃO | DOC | −39.747,42 | −39.747,43 | 0,01 | divergência da planilha |
| 24 | INDISPONIBILIDADE (variável) | CALC | −125.271,68 | −141.179,05 | 15.907,37 | divergência da planilha |
| 25 | TOTAL REMUNERAÇÃO ROTA (variável) | SUB | 443.595,25 | 426.996,71 | 16.598,54 | herdada |
| 29 | TOTAL REM. ROTA OUTROS CUSTOS | DOC | 109.695,38 | 358.530,22 | −248.834,84 | reagrupamento |
| 30 | TOTAL OUTROS CUSTOS | SUB | 109.695,38 | 358.530,22 | −248.834,84 | herdada |
| 34 | REM. VARIÁVEL - EQUIPE DE ENTREGA | DOC | 248.834,84 | — | — | regra a definir |
| 36 | TOTAL GERAL UNIDADE | SUB | 2.430.349,76 | 2.431.617,82 | −1.268,06 | herdada |
| 38 | TOTAL GERAL SRTRANS | DOC | 2.440.263,06 | 2.440.263,06 | 0,00 | **OK** |
| 40 | DIFERENÇA - TOTAL GERAL | SUB | 9.913,30 | 8.645,24 | 1.268,06 | herdada |

**Placar: 5 OK · 16 divergência da planilha comprovada · 0 dado ausente ·
1 regra a definir · 0 erro do sistema.**

## De onde sai cada número

| Linha | Fonte | Campo / registros | Fórmula |
|---|---|---|---|
| DVS | 2Art + Cadastro | as quatro parcelas do variável | frota fixa + agregado + recarga/noturna + vans |
| 5 linhas de custo fixo | **Cadastro** | frota contratada, tarifa, alíquotas | `(valor mensal ÷ 2) × veículos × fator` |
| INDISPONIBILIDADE | 2Art | `TipoIndisp`, `ValorFaturado` | soma do faturado das viagens de Rota com marca |
| DESCONTO DE DEVOLUÇÃO % | 03.08.20 | `Desconto Devolucao` | `−base × fator` |
| DESCONTO DE DISPONIBILIDADE | **03.08.18** | `Desconto Total`, `FF` + `Van`, **mês inteiro** | `−total do mês × fator`, aplicado na 2ª quinzena |
| DESCONTO COMPLEMENTAR NEGATIVO | 03.08.20 | `Desconto Frete mínimo` | `−base`, **sem** fator |
| CUSTO VARIÁVEL (FROTA FIXA) | 2Art + Cadastro | mapas fechados e split ISS/ICMS por dia | `Σ (previsto÷25) × (pISS/dentro + pICMS/fora) × mapas` |
| CUSTO VARIÁVEL (AGREGADO) | 2Art | `Frota = Spot` | soma do `ValorFaturado` |
| OUTROS CUSTOS | 03.08.12.09 | aprovadas, **exceto** `VBZ 06` | `Σ sem imposto × fator` |
| EQUIPE DE ENTREGA | 03.08.12.09 | aprovadas da **`VBZ 06`** | `Σ sem imposto × fator` |
| TOTAL GERAL SRTRANS | 03.08.20 | `Total Remuneração` | publicado |

O fator de imposto sai das alíquotas do cadastro e da fatia de emissão:
`fatia dentro ÷ (1−PIS−COFINS−ISS) + fatia fora ÷ (1−PIS−COFINS−ICMS)`. Em
julho/2026 dá **1,365455** na 1ª quinzena e **1,366960** na 2ª — os mesmos que a
planilha aplica.

## O que o Cadastro guarda, e por quê

As cinco linhas de custo fixo e a parte contratual do custo variável **não saem
de relatório nenhum**. Testei: nenhum subconjunto de até quatro termos das 24
células do 03.08.20 nem das 6 do 03.08.15 — com ou sem o fator — produz
731.502,84, 9.017,30, 13.088,62, 5.938,28 ou 42.745,64. Elas são contrato, e é
por isso que o cadastro é fonte e não conveniência.

O modelo **já guarda por vigência e, quando preciso, por quinzena**:
`vigenciaQueResponde` (`lib/remuneracao/src/contrato.ts`) escolhe a vigência da
própria quinzena quando ela existe e cai na da quinzena irmã quando não —
marcando `herdadaDaOutraQuinzena`, que é o que a tela mostra ao lado do número.
Nenhuma correção estrutural foi necessária.

## As divergências, uma a uma

Nenhuma é do sistema. Todas têm causa nomeada em `DIVERGENCIAS_CONHECIDAS`
(`reconciliacao.ts`) ou são herança aritmética de quem tem.

### Defeitos da `.xlsb`

| Valor | Linha | Causa |
|---:|---|---|
| −6.344,78 | DVS (1ª) | `Mapa Rota!129` aponta para a linha 1.048.619, que não existe; o valor exibido é **cache**. Na 2ª o cache coincide com a conta certa; na 1ª, não |
| +691,06 | CUSTO VARIÁVEL (FROTA FIXA) | as colunas auxiliares `BM`/`BN` não foram arrastadas nos dias 12, 15 e 27: a viagem conta como mapa e some do rateio |
| +128,05 | CUSTO FIXO PADRONIZADO (2ª) | `AJ133` mistura peso de cadastro (`F49 = 0,0238`) com peso do diário (`AJ119 = 0,97602740`) — somam 0,9998274, não 1 |
| +0,11 | CUSTO VARIÁVEL (AGREGADO) | a planilha soma por tabela de tarifa; 5 viagens `Spot` de R$ 0,01 na 1ª e 6 na 2ª não estão na tabela |
| ±0,01 | VANS INATIVAS, DEVOLUÇÃO | a planilha soma as duas quinzenas com dez casas e arredonda no fim; o motor arredonda cada quinzena, que é o que se fatura |

### Inconsistência da 1ª quinzena — a mesma verba nas duas linhas

| Linha | Diferença |
|---|---:|
| DESCONTO DE DISPONIBILIDADE | +15.907,37 |
| DESCONTO COMPLEMENTAR NEGATIVO | −11.649,87 |

São a **mesma verba**. O 03.08.20 da 1ª quinzena não traz bloco de
disponibilidade, e a planilha lança ali os R$ 11.649,87 do `Desconto Frete
mínimo`. Ela ainda bruta essa linha pelo fator (`11.649,87 × 1,365455 =
15.907,37`) e não bruta o complementar — daí os **R$ 4.257,50** de erro
adicional. O sistema põe o frete mínimo no complementar, que é onde o relatório
o declara, nas duas quinzenas.

### Reagrupamento da `VBZ 06` — não é dinheiro

O 03.08.20 e a planilha lançam a remuneração variável da equipe **dentro** do
bloco de outros custos. O sistema a põe no quadro próprio — o que a planilha
reserva em `AI34` e nunca preenche. A identidade que prova que nada entra nem
sai, presa em teste:

```
109.695,38  (outros custos)  +  248.834,84  (equipe)  =  358.530,22
                                                          = Resumo Geral AJ29
```

## O que ainda não é reproduzível

**Uma linha: `REM. VARIÁVEL - EQUIPE DE ENTREGA` (34).** Não por falta de dado —
o sistema calcula R$ 248.834,84 do 03.08.12.09 — mas porque **a planilha não tem
célula** ali para comparar. `AI34` e `AJ34` não existem; só `AK34 = SUM(AI34+AJ34)`
existe, somando dois vazios. Enquanto a `.xlsb` for a referência, esta linha não
tem contra o que fechar. A decisão pendente é de domínio, não de código: *a Ambev
reconhece essa verba como quadro próprio ou como outros custos?*

**Fora do `RESUMO GERAL`:** a série 748 (NFs de serviço) não está em relatório
importável nenhum — conferi as 19.876 linhas do 03.08.15 da 1ª quinzena. Ela não
impede o `TOTAL GERAL SRTRANS`, que vem do 03.08.20; impede a conferência que o
decompõe.

## O painel Devido × Demonstrado, e a coluna `Auditar`

A matriz acima confere o sistema contra a `.xlsb`. A **tela** confere outra
coisa, e é a que vale quando a planilha sair de cena: o **devido** (contrato +
diário) contra o **demonstrado** (o 03.08.20 assinado). Duas fontes
independentes, e é por isso que a diferença entre elas diz algo.

**A moeda estava errada, e a coluna `Diferença` media câmbio.** O devido sai do
motor bruto — a parcela já com o fator de imposto — e com o desconto negativo,
que é como a planilha escreve. O demonstrado saía do 03.08.20 pela coluna
`S/Imposto` e com o desconto em módulo positivo, que é como o relatório escreve.
Numa linha em que os dois lados são **a mesma verba do mesmo arquivo**, a
subtração dava `−18.199,19 − 13.328,30 = −31.527,49`.

Cada linha do mapa agora declara como o demonstrado dela se converte
(`ConversaoDoDemonstrado`: o sinal, e se sobe pelo fator); o fator é da quinzena,
não da linha; e `resumo.ts` só aplica. Em julho/2026, todas as linhas que têm os
dois lados fecham em **R$ 0,00 exatos**:

| Linha | 1ª | 2ª |
|---|---:|---:|
| `DESCONTO DE DEVOLUÇÃO %` | R$ 0,00 | R$ 0,00 |
| `DESCONTO DE DISPONIBILIDADE` | — (sem bloco no relatório) | R$ 0,00 |
| `DESCONTO COMPLEMENTAR NEGATIVO` | R$ 0,00 | R$ 0,00 |
| `DESCONTO DE DEVOLUÇÃO` (variável) | R$ 0,00 | R$ 0,00 |
| `INDISPONIBILIDADE` (variável) | — | R$ 0,00 |
| `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS` | — | **R$ 0,00** |
| `REM. VARIÁVEL - EQUIPE DE ENTREGA` | — | **R$ 0,00** |

As duas últimas são as que mais dizem: o devido delas sai do **03.08.12.09** e o
demonstrado do **03.08.20**. Dois arquivos diferentes, R$ 109.695,38 e
R$ 248.834,84, ao centavo.

**A coluna `Auditar`** é o que sobra. Ela é computada da própria subtração — não
há catálogo de exceção, e uma divergência só some de lá quando para de existir.
Preenche-se em dois casos: os dois lados existem e discordam em mais de meio
centavo, ou o devido é dinheiro e não há demonstrado nenhum. Em julho/2026 ela
tem três entradas, e essas três são **tudo** o que o sistema não consegue provar:

| O que | 1ª | 2ª | Por quê |
|---|---:|---:|---|
| `TOTAL REMUNERAÇÃO ROTA DVS` | R$ 307.746,20 | R$ 327.422,65 | O 03.08.20 não tem linha `DVS`. O motor a calcula como o custo variável inteiro, e o variável do relatório (VBZ 05 e 07) já é conferido no quadro de baixo. Entra no fechamento **sem corroboração de documento** |
| conjunto `Custo fixo bruto` | −R$ 572,27 | −R$ 574,08 | O 03.08.20 paga ~R$ 573 a mais de custo fixo do que o contrato cadastrado explica. **A planilha tem a mesma diferença** — não é defeito do motor |
| conjunto `Custo variável bruto` | −R$ 12.243,54 | −R$ 10.923,87 | O variável do 2Art e as VBZ 05/07 do 03.08.20 medem a mesma operação e não coincidem. É a divergência que este painel existe para mostrar |

O `DVS` também impede o **total do quadro do fixo** de existir: uma linha com
devido em dinheiro e sem demonstrado anula a soma, porque a soma de parte das
linhas não é o total, e a diferença contra ela mediria a lacuna do painel em vez
da divergência dos documentos. `QuadroComparado.semDemonstrado` nomeia quem
faltou.

## Os defeitos que este trabalho encontrou

Todos só existiam **entre o arquivo e o motor** — a reconciliação alimentava
pela célula da planilha e os testes de unidade montavam a base à mão, de modo
que nenhum dos dois lados os via.

| Defeito | Custo | Onde |
|---|---:|---|
| o corte do canal testava só `CxRota`, não a conjunção com `CxAS` | R$ 1.727,06 | `ehDaRota` |
| `TipoIndisp = 0` lido como marca de indisponibilidade | R$ 636.580,47 no mês | `comoMarca` |
| outros custos não brutados quando vêm do 03.08.12.09 | R$ 29.447,72 | `montarMapaDaQuinzena` |
| `BasesDaPlanilha` recebia valor de relatório sem converter a moeda | idem | `basesDosRelatorios` |
| a mensagem de falta apontava o 03.08.18 enquanto o valor vinha do 03.08.20 | — | `linhasDeDesconto` |
| a herança do total geral não somava a parcela que a planilha não escreve | R$ 248.834,84 | `contribuicao` |
| o demonstrado comparado sem converter moeda nem sinal | R$ 31.527,49 numa linha só | `compararPaineis` |
| `rota_dvs` no conjunto do fixo — o variável somado dentro do fixo | R$ 307.173,93 (1ª) · R$ 326.848,57 (2ª) | `GRUPOS_DA_PLANILHA` |
| o bruto do conjunto perguntava à planilha de qual verba o desconto saiu, e o relatório diz | R$ 30.442,73 (1ª) · R$ 157.743,78 (2ª) | `descontosDasVerbas` |
| a `VBZ 06` dentro de `outros_custos`, sem o quadro que a planilha reserva | R$ 248.834,84 | `RECORTE_DO_QUADRO` |
| duas chaves que nunca se encontravam (`desconto_devolucao`, `outros_custos`) | as linhas apareciam sem demonstrado | `mapa-rota.ts` · `de-para.ts` |
| o total do quadro lido do relatório: outra lista de linhas, outra moeda | R$ 505.534,69 num quadro cujas linhas fechavam | `totalDemonstradoDoQuadro` |

## Onde cada coisa mora

| Arquivo | O quê |
|---|---|
| `mapa-rota.ts` | o motor — a única implementação da conta |
| `leitores/disponibilidade.ts` | o 03.08.18 e a regra mensal do desconto |
| `persistencia.ts` | `basesDaQuinzena`, `disponibilidadeDoMes` |
| `matriz.ts` | as 22 linhas com origem, status e causa |
| `reconciliacao.ts` | `DIVERGENCIAS_CONHECIDAS` — a causa de cada diferença |
| `prova-ponta-a-ponta.ts` | os relatórios e o cadastro, sem a planilha no meio |
| `reconciliar-real-cli.ts` | o gate e a matriz em texto |
| `__tests__/gate-real.test.ts` | o gate como regressão |
| `__tests__/corte-do-canal.test.ts` | os três casos do corte, e as seis viagens |
| `__tests__/disponibilidade-mensal.test.ts` | a regra do mês, e que nenhuma metade a reproduz |
| `__tests__/marca-de-indisponibilidade.test.ts` | o zero que não é marca |
| `__tests__/moeda-do-devido.test.ts` | a conversão, o total do quadro e a coluna `Auditar` |
| `resumo.ts` | `compararPaineis`, `comAuditoria`, `totalDemonstradoDoQuadro` |
| `de-para.ts` | os vinte rótulos, os conjuntos e o bruto por VBZ |
| `components/fechamento/resumo-geral.tsx` | a coluna `Auditar` na tela |
