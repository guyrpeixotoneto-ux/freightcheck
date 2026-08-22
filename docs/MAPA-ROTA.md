# O `RESUMO GERAL`, linha por linha — de onde sai cada número

Rastreamento das fórmulas da `Fechamento_Remuneracao.xlsb` (44 abas), feito
sobre o fechamento real de **julho/2026 — CDD Belém · Horizonte**. Cada
afirmação daqui é reproduzida em código e está sob teste:

- `lib/fechamento/src/mapa-rota.ts` — o motor, a única implementação da conta;
- `lib/fechamento/src/reconciliacao.ts` — a prova, planilha contra motor;
- `lib/fechamento/src/reconciliar-planilha-cli.ts` — roda a prova contra a `.xlsb`;
- `lib/fechamento/src/__tests__/reconciliacao.test.ts` — o gate de regressão.

Para refazer a prova contra o arquivo de verdade:

```
pnpm --filter @workspace/fechamento exec tsx \
  ./src/reconciliar-planilha-cli.ts caminho/Fechamento_Remuneracao.xlsb \
  --amostra ./src/__tests__/amostras/julho-2026.json
```

## A descoberta que muda o desenho

**O `RESUMO GERAL` não lê nenhuma linha sua de um relatório da Ambev.** Não há
aba `03.08.20` na pasta. Cada célula do resumo aponta para uma linha do `Mapa
Rota`, e cada linha do `Mapa Rota` é uma fórmula sobre a aba `Cadastro` — a
frota contratada, a tarifa por veículo, as alíquotas — ou sobre o diário
operacional (abas `01`…`31`).

O de-para que o produto tinha traduzia as mesmas dezoito linhas **a partir do
03.08.20**. Por isso o painel inteiro dependia de um relatório que a planilha
nunca abre: sem ele, `lerDeParaDaCompetencia` devolve `null` e a aba `Planilha`
não tem o que mostrar.

As duas leituras não competem: esta diz **quanto é devido pelo contrato**, a do
de-para diz **quanto foi demonstrado**. A diferença é o que se discute na mesa.

## Proveniência — arquivo → célula → regra → cálculo → resumo

`AI` é a coluna da 1ª quinzena, `AJ` a da 2ª, `AK` o total. Os valores do
cadastro são **mensais**; toda linha fixa divide por dois.

| Linha do resumo | Célula | Origem | Regra |
|---|---|---|---|
| `TOTAL REMUNERAÇÃO ROTA DVS` | `AI7` ← `Mapa Rota!131` | abas `01`…`31` + `Cadastro!C20`,`C23` | soma das quatro parcelas variáveis abaixo |
| `CUSTO FIXO PADRONIZADO` | `AI8` ← `Mapa Rota!133` | `Cadastro!C18,C19,C21,C22,C13` | `(soma das 4 parcelas ÷ 2) × veículos ativos × fator` |
| `CUSTO FIXO INATIVOS` | `AI9` ← `Mapa Rota!136` | `Cadastro!C27,C14` | `(remuneração inativa ÷ 2) × veículos inativos × fator` |
| `CUSTO VANS INATIVAS` | `AI10` ← `Mapa Rota!137` | `Cadastro!C37,C36` | `(remuneração vans inativas ÷ 2) × vans inativas × fator` |
| `INDISPONIBILIDADE` | `AI11` ← `Mapa Rota!132` | abas diárias, coluna `BP` | soma do faturado das viagens com tipo de indisponibilidade |
| `CUSTO FIXO - ESPECIAIS` | `AI12` ← `Mapa Rota!134` | `Cadastro!C41,C40,C45` | `(noturna × fator ÷ 2) × rotas + (marketing × fator ÷ 2)` |
| `CUSTO FIXO - VANS` | `AI13` ← `Mapa Rota!135` | `Cadastro!C31,C32,C30` | `(custo fixo + equipe) × vans × fator ÷ 2` |
| `DESCONTO DE DEVOLUÇÃO %` | `AI14` ← `Mapa Rota!138` | `Mapa Rota!R138` (último dia) | `−base sem imposto × fator` |
| `DESCONTO DE DISPONIBILIDADE` | `AI15` ← `Mapa Rota!139` | `Mapa Rota!R139` (03.08.18) | `−base sem imposto × fator` |
| `DESCONTO COMPLEMENTAR NEGATIVO` | `AI16` ← `Mapa Rota!140` | `Mapa Rota!R140` | `−base`, **sem** fator |
| `TOTAL REMUNERAÇÃO ROTA` | `AI17` | — | soma de `AI7:AI16` |
| `CUSTO VARIÁVEL (FROTA FIXA)` | `AI21` ← `Mapa Rota!127` | abas diárias + `Cadastro!C20,C23` | por dia: `(previsto ÷ 25) ÷ divisor` pelo split do dia `×` mapas fechados |
| `CUSTO VARIÁVEL (AGREGADO)` | `AI22` ← `Mapa Rota!128` | abas diárias, coluna `AI` | soma do faturado das viagens de frota `Spot` |
| *(dentro do DVS)* `Recarga / Noturna` | `Mapa Rota!129` | abas diárias | soma do faturado de frota `Padrao` com carga `Recarga`/`Noturna` |
| *(dentro do DVS)* `Vans` | `Mapa Rota!130` | abas diárias | soma do faturado das viagens de frota `Fixo` |
| `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS` | `AI29` ← `Outros Custos!F4` | 03.08.12.09 | total de outros custos da quinzena |
| `TOTAL GERAL UNIDADE` | `AI36` | — | `AI17 + AI30 + AI34` |
| `TOTAL GERAL SRTRANS` | `AI38` ← `Abertura!F45` | transportadora | o lado que a SRTrans apresenta |

A coluna `C` do `Cadastro` é a 1ª quinzena; a `F`, a 2ª.

## O fecho do resumo — as três linhas que faltavam

Rastreadas depois, sobre o mesmo arquivo, com as fórmulas na mão. Elas estavam
fora do produto, e a razão registrada era que o número da transportadora "só
existe na planilha". Não é o caso.

| Linha | Célula | Fórmula | De onde sai no sistema |
|---|---|---|---|
| `REMUNERAÇÃO VARIÁVEL - EQUIPE DE ENTREGA` | `AI34` | **não existe como célula** | quadro reservado, sem linha |
| `TOTAL GERAL UNIDADE` | `AI36` | `=SUM(AI17+AI30+AI34)` | `MapaDaQuinzena.totalGeral` |
| `TOTAL GERAL SRTRANS` | `AI38` | `=Abertura!$F$45` | `Total Remuneração` do **03.08.20** |
| `DIFERENÇA - TOTAL GERAL` | `AI40` | `=AI38-AI36` | SRTrans − unidade |

**O `TOTAL GERAL SRTRANS` é o total do 03.08.20.** Na 1ª quinzena de julho/2026
o `Total Remuneração` da Rota no demonstrativo é R$ 1.084.580,45 — o mesmo
número, ao centavo, que `Abertura!F45` traz e que o resumo imprime. O relatório
**publica** o total; a `Abertura` o **reconstrói** somando documentos, e um
número publicado é fonte melhor que um remontado. Por isso a fonte canônica é o
03.08.20 e a decomposição entra como conferência (`faturado.ts`).

A decomposição da `Abertura`, conferida:

```
F16  TOTAL NF           notas fiscais de serviço da transportadora (série 748)
F29  TOTAL CT-E         os CT-es da quinzena — 03.08.15
F43  CT-E DIÁRIO TOTAL  "(RELATÓRIO 03.02.59.02)", escrito na aba
```

Na 2ª quinzena ela fecha ao centavo: `1.346.131,65 + 26.839,98 + 109,52 −
17.398,54 = 1.355.682,61`. Na 1ª sobra **R$ 8,07** — um CT-e de VBZ 05 emitido
no dia 1º que a `Abertura` não conta.

**A série 748 é o único dado do resumo sem relatório importável.** Ela não está
embutida no 03.08.15: nenhum dos treze valores de NF que a `Abertura` lista
aparece em qualquer uma das 57.012 linhas dele. São NFs de serviço — o lado ISS
do faturamento —, e o 03.08.15 traz o lado CT-e. Falta dela **não** impede o
`TOTAL GERAL SRTRANS`, que vem do 03.08.20; impede a conferência que o
decompõe. Onde informá-la está em `ONDE_INFORMAR_AS_NOTAS`.

**O quadro reservado.** `AI34` e `AJ34` não existem como célula — não são zero,
não têm fórmula. Só `AK34 = SUM(AI34+AJ34)` existe, somando dois vazios. E
mesmo assim `AI36` soma os três quadros. Enquanto o motor somava dois, os dois
lados chegavam ao mesmo número **por acaso**: o acaso de a terceira parcela
estar vazia. O conceito não é hipotético — a VBZ 06 (`Rota - Rem. Variável
Equipe Entrega`) sai em CT-e, R$ 244.753,67 na 2ª quinzena.

## O 03.08.18 **é** a fonte do desconto de disponibilidade — o mês, não a quinzena

> **Corrigido.** Este documento afirmou o contrário por duas investigações. A
> afirmação anterior — "os números desmentem a associação direta" — estava
> ancorada numa comparação errada, e a correção está provada abaixo.

A legenda de cores da planilha associa o `03.08.18` à linha
`DESCONTO DE DISPONIBILIDADE`, e a legenda está certa. O que despistou é que
**o desconto é acumulado no mês inteiro e aplicado uma vez, no demonstrativo da
2ª quinzena** — comparar a quinzena de um documento com a quinzena do outro
compara o mês com um quarto dele.

Lido pelos leitores de produção sobre os arquivos reais de julho/2026
(CDD Belém · Horizonte, canal Rota), o encaixe é ao centavo em **três linhas
independentes**:

| 03.08.18 — dias 1 a 31, abas `FF` + `Van` | | 03.08.20 da 2ª quinzena |
|---|:-:|---|
| `Desc.FF Custo Fixo` + `Equipe` + `Indiretos` = **91.321,65** | = | `Desconto FF - Equipe Entrega` = **91.321,65** |
| `Desconto FA` = **320,85** | = | `Desconto FF - Fator Ajudante` = **320,85** |
| `Desconto Total` = **91.642,50** | = | total do bloco = **91.642,50** |

Diferença R$ 0,00 nas três. O demonstrativo agrupa custo fixo, equipe e
indiretos numa linha só porque os três são subtraídos da mesma `VBZ 02`; o
03.08.18 os abre por dia, por aba e por responsabilidade.

### O "315,2%" que ficou registrado como inexplicado

A tabela que este documento trazia comparava assim:

| Candidato | 1ª quinzena | 2ª quinzena |
|---|---:|---:|
| 03.08.18 (`Desc.FF …`, só a metade do mês, só a aba `FF`) | 42.939,35 | 29.075,62 |
| planilha (`Mapa Rota!R139` / `AH139`, digitados) | 11.649,87 | 91.642,50 |

`91.642,50 ÷ 29.075,62 = 3,152`. Não é discrepância: é a razão entre o mês
inteiro (as duas quinzenas, as duas abas) e um quarto dele. A associação sempre
esteve lá; o período é que estava errado dos dois lados.

### O que isso resolve na 1ª quinzena

O 03.08.20 da 1ª quinzena **não traz bloco `DESCONTO DISPONIBILIDADE` nenhum** —
e agora sabe-se por quê: naquele momento o desconto ainda não foi aplicado. A 1ª
quinzena vale **R$ 0,00 de disponibilidade por regra**, e não por falta de
arquivo. O acumulado parcial do 03.08.18 até o dia 15 (R$ 54.155,08) é
informação, não abatimento.

O que a planilha faz ali continua sendo defeito dela: ela digita 11.649,87 na
linha da disponibilidade, e esse número **é o `Desconto Frete mínimo` do
03.08.20**. O sistema o põe no complementar negativo, que é onde o relatório o
declara — e como a planilha bruta a linha da disponibilidade pelo fator e não
bruta o complementar, são **R$ 4.257,50** de diferença no quadro, com a mesma
origem documental.

### Onde a regra mora, e o alcance dela

`descontoDeDisponibilidadeDoMes`, em `leitores/disponibilidade.ts`, com o gate
em `__tests__/disponibilidade-mensal.test.ts` — que prende as três identidades
**e** a afirmação de que nenhuma das metades sozinha reproduz o bloco. O
registro da decisão está em `DECISOES_RESOLVIDAS`, em `matriz.ts`.

A prova é de **uma** competência. O encaixe ao centavo em três linhas
independentes é forte demais para ser acaso, mas "mês inteiro, aplicado na 2ª"
só vira regra geral com uma segunda competência — e é para isso que
`DescontoDeDisponibilidadeDoMes` carrega os dias que entraram na soma.

`Mapa Rota!R138`, `R139`, `R140`, `AH138`, `AH139` e `AH140` **não têm
fórmula**: são digitados à mão.

## Uma advertência sobre o que a reconciliação prova

A reconciliação roda o motor sobre os parâmetros, as viagens e as bases da
**própria** `.xlsb`. Isso responde *dadas as mesmas entradas, o motor chega ao
mesmo resultado?* — equivalência de fórmula — e **não** responde *os relatórios
importados mais o cadastro chegam lá?*.

As duas eram indistinguíveis na saída até `ProcedenciaDosInsumos` existir. Hoje
a matriz declara de onde cada insumo veio e só chama de ponta a ponta o que é.
O gate está em `__tests__/prova-ponta-a-ponta.test.ts`, com a lista de arquivos
que faltam para rodá-lo.

### As duas linhas que o produto passou a calcular

`INDISPONIBILIDADE` e `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS` entravam no motor
como `null` fixo — `basesDaQuinzena` as devolvia assim com um comentário dizendo
que a fonte "ainda não é somada aqui". Eram as duas únicas linhas conhecidas do
painel condenadas a não ter devido por decisão nossa, e não por falta de
documento. As duas fontes estavam na tabela acima o tempo todo:

| Linha | Fonte | Regra no produto |
|---|---|---|
| `INDISPONIBILIDADE` | 2Art, coluna `TipoIndisp` | soma o `ValorFaturado` das viagens **de Rota** com marca de indisponibilidade (`somarIndisponibilidade`, em `mapa-rota.ts`) |
| `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS` | 03.08.12.09 | soma sem imposto das requisições **aprovadas** do canal, pelo mesmo `STATUS_QUE_PAGA` da apuração |

As duas carregam o denominador junto com o número, e é o que torna um zero
conferível: *"nenhuma das 302 viagens de Rota traz marca"* e *"2 de 4
requisições aprovadas"* são afirmações que o arquivo aberto ao lado derruba num
filtro. Sem o denominador, um zero medido e um zero por ausência de arquivo
chegavam à tela como o mesmo `0,00`.

**A indisponibilidade não é o desconto de disponibilidade**, e os nomes quase
iguais são a razão de a distinção estar escrita em três lugares. A do quadro
fixo é **parcela**, sai do **2Art**, e é frete que a transportadora recebe por
viagens que rodaram no lugar de um veículo indisponível. O `DESCONTO
DISPONIBILIDADE` é **abatimento**, sai do **03.08.20**, e já está declarado na
linha de desconto. Fontes diferentes, sinais opostos, quadros diferentes.

Do lado **demonstrado** nada mudou: o 03.08.20 continua sem sustentar a
`INDISPONIBILIDADE` do fixo, e o painel dele continua dizendo `sem lastro` ali.
O que passou a existir é o **devido** — e a diferença entre os dois é
exatamente o que o painel comparado existe para mostrar.

## O fator de imposto — o "1,366960" que não tinha origem

O produto registrava que a planilha usava "um fator de conversão digitado
(1,366960) que não sai de arquivo nenhum". **Sai.** É

```
fator = fatiaDentroDoMunicípio / (1 − PIS − COFINS − ISS)
      + fatiaForaDoMunicípio  / (1 − PIS − COFINS − ICMS)
```

Com as alíquotas de julho/2026 (PIS 0,65 %, COFINS 8,6 %, ICMS 17,84 %, ISS
5,9 %) dá **1,365455** na 1ª quinzena e **1,366960** na 2ª — a diferença é só a
fatia de documentos emitidos dentro do município (3,16 % contra 2,38 %).

## Reconciliação — planilha × motor

Rodada sobre o fechamento real. Catorze linhas × três colunas = 42 células.

| Modo | Fecham em R$ 0,00 | Não fecham |
|---|---:|---:|
| `PLANILHA_LEGADA` — reproduz a planilha | **32** | 10 |
| `REGRA_CANONICA` — a regra oficial, autoridade no Cadastro | 30 | 12 |

**Todas as linhas de custo fixo e todos os descontos fecham ao centavo nas duas
quinzenas.** O que não fecha está inteiramente contido em quatro causas, todas
da própria planilha, e nenhuma é absorvida pelo motor.

### 1. `Mapa Rota!AJ133` mistura duas fontes na mesma soma — R$ 128,05

```
AI133 (1ª)  base × Cadastro!$C$49 ÷ dentro  +  base × Cadastro!$C$50 ÷ fora
AJ133 (2ª)  base × Cadastro!$F$49 ÷ dentro  +  base × Mapa Rota!AJ119 ÷ fora
```

A 1ª pesa os dois lados pelo cadastro, e `C49 + C50 = 1` por construção. A 2ª
pesa o lado de dentro pelo cadastro (`F49 = 0,0238`) e o de fora pelo diário
(`AJ119 = 0,97602740`).

**O defeito não é a fonte escolhida, é a mistura:** `0,0238 + 0,97602740 =
0,9998274`. Os pesos não fecham em 1, e a fórmula desconta silenciosamente
0,0173 % da base.

| | Valor | Diferença |
|---|---:|---:|
| Planilha (`AJ133`) e modo `PLANILHA_LEGADA` | 739.274,00 | — |
| Modo `REGRA_CANONICA` (pesos do cadastro, somando 1) | 739.402,05 | **+128,05** |

Os R$ 128,05 atravessam o `TOTAL REMUNERAÇÃO ROTA` e o `TOTAL GERAL UNIDADE`.

**A regra oficial do FreightCheck é `REGRA_CANONICA`: a autoridade sobre os
pesos é o `Cadastro`, nas duas quinzenas.** O comportamento da 2ª quinzena da
planilha é tratado como inconsistência dela, não como regra.

`PLANILHA_LEGADA` permanece — para **reprodução histórica**, não como
alternativa de cálculo. O histórico não é corrigido em silêncio:
`compararModos()` devolve Legado × Canônica × diferença por linha, e o CLI a
imprime. Em julho/2026 a troca toca uma linha só:

| Linha | Legado 2ª | Canônica 2ª | Efeito |
|---|---:|---:|---:|
| `CUSTO FIXO PADRONIZADO` | 739.274,00 | 739.402,05 | **+128,05** |
| `TOTAL REMUNERAÇÃO ROTA` | 991.501,67 | 991.629,72 | +128,05 |
| `TOTAL GERAL UNIDADE` | 1.350.031,89 | 1.350.159,94 | +128,05 |

Nenhuma outra linha muda.

### 2. Colunas auxiliares não preenchidas em três dias — R$ 772,06 e −R$ 81,01

`Mapa Rota!112` e `113` contam viagens `NF-ISS` e `CTRC-ICMS` somando as colunas
auxiliares `BM`/`BN` das abas diárias. Em três dias essas fórmulas **não foram
arrastadas**:

| Dia | O que falta | Efeito |
|---|---|---:|
| 12 | `BM` e `BN` ausentes nas 3 linhas | 3 mapas somem do rateio → `D125 = 0` → +R$ 851,99 |
| 15 | `BM` ausente em 2 linhas `NF-ISS` | 2 viagens ISS viram fora do município → −R$ 79,93 |
| 27 | `BM` ausente em 2 linhas `NF-ISS` | idem → −R$ 81,01 |

A viagem continua contada como **mapa** (`Mapa Rota!121` usa `COUNTIF` sobre a
coluna `E`, que não depende de `BM`/`BN`) e some do **rateio**. Nos 31 dias a
contagem de mapas do motor bate com a da planilha em **31 de 31**; só o rateio
desses três dias diverge, e a soma das diferenças dá exatamente
`+772,06` e `−81,01` — **R$ 691,06 no mês**.

**O motor não é calibrado para repetir célula vazia.** Estes três dias são
defeitos demonstrados da planilha: a regra está certa, o preenchimento é que
falhou. O motor calcula pela regra e a reconciliação explica a diferença, nos
dois modos.

### 3. `Mapa Rota!129` aponta para uma linha que não existe — R$ 6.344,78

A fórmula diária do `Custo Variável (Recarga e Noturna)` é
`SUMPRODUCT($B$43:$B$53, D1048619:D1048629)` — resto de uma exclusão de linha.
Ela devolve zero, e o que a planilha exibe é **valor de cache**.

| Quinzena | Planilha (cache) | Soma real das viagens | Diferença |
|---|---:|---:|---:|
| 1ª | 11.574,83 | 5.230,05 | **−6.344,78** |
| 2ª | 3.957,82 | 3.957,82 | 0,00 |

Na 2ª o cache coincide com a conta certa; na 1ª, não. Esta é a maior divergência
do mês e a única que muda o total em milhares.

### 4. `CUSTO VARIÁVEL (AGREGADO)` por tabela de tarifa — R$ 0,06

A planilha soma o agregado com `SUMPRODUCT(tarifas × contagem de viagens com
aquele faturado)`. Seis viagens `Spot` de **R$ 0,01** na 2ª quinzena têm um
faturado que não está na tabela e por isso não entram. O motor soma o faturado
das viagens de frota `Spot`, e as pega.

### 5. Arredondamento na coluna do total — R$ 0,01

A planilha soma as duas quinzenas com dez casas e arredonda no fim; o motor
arredonda cada quinzena — que é o que se fatura — e soma. Duas linhas de
julho/2026 caem perto de meio centavo. **As duas quinzenas fecham ao centavo; só
o total diverge.** Ninguém paga R$ 13.088,6240.

### Outras fórmulas quebradas, sem efeito no resultado

`Resumo Geral!AI30`/`AJ30` (`TOTAL OUTROS CUSTOS`) somam `AI1048605:AI1048605`,
uma linha inexistente. O valor exibido é cache, e ele alimenta o `TOTAL GERAL
UNIDADE`. Coincide com `Outros Custos!F4`/`G4`, que é o que o motor usa.

## As bases dos descontos não têm origem rastreável na planilha

Investigado a pedido, para fechar o elo até o documento de origem. **O elo não
existe dentro da pasta.**

As seis bases — devolução, disponibilidade e complementar, nas duas quinzenas —
são **digitadas à mão** em `Mapa Rota!R138:R140` e `AH138:AH140`. Nenhuma delas
tem fórmula:

| Célula | Valor | Fórmula |
|---|---:|---|
| `R138` devolução 1ª | 13.328,30 | *(nenhuma — digitado)* |
| `R139` disponibilidade 1ª | 11.649,87 | *(nenhuma — digitado)* |
| `AH138` devolução 2ª | 15.763,61 | *(nenhuma — digitado)* |
| `AH139` disponibilidade 2ª | 91.642,50 | *(nenhuma — digitado)* |
| `AH140` complementar 2ª | 14.050,54 | *(nenhuma — digitado)* |

A aba `Justificativa` parece a origem, e não é: ela **lê de volta** do `Mapa
Rota` (`='Mapa Rota'!R138`) e traz uma cópia das colunas do 03.08.18.

O teste decisivo é contra o próprio 03.08.18, que está na pasta como aba. Ele foi
feito **quinzena contra quinzena**, e é aí que ele erra:

| | 03.08.18 `Desconto Total` (só a metade, só `FF`) | Base digitada | Relação |
|---|---:|---:|---|
| 1ª quinzena | 42.939,35 | 11.649,87 | 27,1 % |
| 2ª quinzena | 29.075,62 | 91.642,50 | 315,2 % |

> **Corrigido.** A conclusão que se tirou daqui — "a derivação acontece fora do
> arquivo" — era falsa para a disponibilidade. Somado o **mês inteiro**, nas
> **duas abas**, o 03.08.18 reproduz `AH139` ao centavo: 91.642,50. Os 315,2 %
> são a razão entre o mês e um quarto dele. Ver a seção *O 03.08.18 **é** a
> fonte do desconto de disponibilidade*, acima.

Para a **devolução** e o **complementar** a conclusão continua de pé: nenhuma
coluna do 03.08.18 ou da `Justificativa` as reproduz, e elas saem mesmo do
03.08.20.

### Onde ela acontece: as cinco bases são o 03.08.20

O elo não está na pasta porque o 03.08.20 **não tem aba nela**. Está no
relatório, e fecha ao centavo nas cinco células digitadas:

| Célula | Digitado | Linha do 03.08.20 | Valor |
|---|---:|---|---:|
| `R138` devolução 1ª | 13.328,30 | `Desconto Devolucao` | 13.328,30 |
| `R139` disponibilidade 1ª | 11.649,87 | `Desconto Frete mínimo` | 11.649,87 |
| `AH138` devolução 2ª | 15.763,61 | `Desconto Devolucao` | 15.763,61 |
| `AH139` disponibilidade 2ª | 91.642,50 | bloco `DESCONTO DISPONIBILIDADE` (91.321,65 + 320,85) | 91.642,50 |
| `AH140` complementar 2ª | 14.050,54 | `Desconto Frete mínimo` | 14.050,54 |

Cinco de cinco, sem fator, sem resto. A resposta à pergunta que ficara em
aberto — *o que a transportadora usou para chegar aos números digitados* — é:
ela copiou o demonstrativo à mão.

**A 1ª quinzena expõe uma inconsistência da planilha.** O 03.08.20 daquela
quinzena **não tem** bloco `DESCONTO DISPONIBILIDADE` — só devolução e frete
mínimo. A planilha põe o frete mínimo (11.649,87) na linha da *disponibilidade*
e deixa o complementar em zero; na 2ª quinzena põe a disponibilidade na
disponibilidade e o frete mínimo no complementar. São duas regras para o mesmo
desconto, em duas metades do mesmo mês.

O produto adota **uma só**: o frete mínimo é o complementar negativo, nas duas
quinzenas (`basesDaQuinzena`, em `persistencia.ts`). O efeito é visível e
deliberado — na 1ª quinzena o devido mostra R$ 11.649,87 onde a planilha mostra
zero, e a disponibilidade fica vazia porque o relatório não a traz. Reproduzir a
inconsistência faria os dois lados concordarem por construção, que é o oposto do
que este painel existe para fazer.

### O fio que faltava ligar, e que a regra mensal liga

O sistema já lê o 03.08.18 e extrai, por dia e por canal,
`descontos: { custoFixo, equipe, indiretos, fatorAjudante, total }`
(`leitores/disponibilidade.ts`). Ele tem, portanto, o material para **calcular**
a disponibilidade em vez de recebê-la do 03.08.20 — o que nem a planilha faz.

A pergunta que travava esse fio era *por que o demonstrativo e o 03.08.18
discordam nessa ordem de grandeza*. **Eles não discordam**: somado o mês inteiro,
o 03.08.18 dá exatamente o bloco do 03.08.20 (`descontoDeDisponibilidadeDoMes`).
O que discordava era o recorte de período usado na comparação.

Com a regra mensal, calcular do 03.08.18 deixa de ser uma mudança de número e
passa a ser uma mudança de **procedência**: o mesmo R$ 91.642,50 na 2ª quinzena,
mas derivado dos 29 dias que o produziram em vez de copiado do demonstrativo que
ele deveria auditar. E a 1ª quinzena passa a valer **zero por regra** — com a
razão escrita — em vez de vazia por falta de bloco.

As demais bases seguem entrando no motor como parâmetro (`BasesDaQuinzena`), com
o mesmo tratamento de ausência: `null`, nunca zero.

## O corte que faltava no diário: `CxRota > 0`

O 2Art traz numa lista só as viagens da **Rota** e as do **AS**, e a coluna que
as separa é `CxRota`: a viagem de AS vem com `CxRota = 0` e `CxAS > 0`. O motor
somava as duas.

Conferido linha a linha contra as abas diárias `01`..`31` da `.xlsb`, que são o
2Art já filtrado: das dezoito viagens que a planilha descartou no mês, as
dezesseis de frota padrão têm `CxRota = 0` e `CxAS > 0`. Nenhuma exceção.

O efeito, em julho/2026:

| Linha | sem o corte (1ª) | com o corte (1ª) | sem o corte (2ª) | com o corte (2ª) |
|---|---:|---:|---:|---:|
| Custo Variável (Frota Fixa) | +2.540,23 | **+0,01** | +2.006,25 | −1.723,03 |
| Custo Variável (Extra e Spot) | +38.473,58 | **+0,05** | +47.098,45 | **+0,06** |
| Vans | **0,00** | **0,00** | **0,00** | **0,00** |
| Recarga e Noturna | −6.344,78 | −6.344,78 | **0,00** | **0,00** |

*(diferença contra o `RESUMO GERAL`; `somarVariavel`, com `ValorFaturado` do
próprio 2Art e o valor médio do veículo do cadastro)*

### O que é um "mapa fechado"

A contagem que multiplica o valor médio do veículo é de linhas com
`FROTA = Padrao` e `CARGA ATUAL` **diferente de** `Recarga` e `Noturna` — que
carregaram caixa de Rota. Recarga e noturna não fecham mapa: têm linha própria.

A regra reproduz a contagem da planilha em 27 dos 29 dias com movimento. Nos
dias **23 e 28** a planilha conta 3 mapas a mais do que a aba do dia tem linhas
— não é o filtro, as linhas não estão lá. Ou o 2Art da planilha era outro
snapshot, ou alguém somou à mão; vale R$ 1.723,03 na 2ª quinzena, e está na
lista de inconsistências.

### O que continua aberto

- **`Recarga e Noturna`, 1ª quinzena: R$ 6.344,78.** A regra fecha ao centavo na
  2ª e não fecha na 1ª. Combina com o que esta página já registra: a fórmula
  diária dessa linha na `.xlsb` está quebrada por exclusão de linha e sobrevive
  em valor de cache.
- **Dois mapas `Espec.` no dia 11** (186330 e 186331), com `CxRota > 0` e fora da
  aba do dia. Únicos do mês; nenhuma das quatro linhas do mapa os nomeia.

## De onde vem o dinheiro do mês

Medido sobre julho/2026, em valor absoluto:

| Fonte | Valor | Fatia |
|---|---:|---:|
| **`Cadastro` — não existe em nenhum relatório** | R$ 1.627.370,20 | **57,8 %** |
| Diário operacional (2Art/748) + tarifa prevista do `Cadastro` | R$ 635.168,80 | 22,6 % |
| 03.08.12.09 — requisições de despesa | R$ 358.530,22 | 12,7 % |
| 03.08.18 — disponibilidade | R$ 141.179,05 | 5,0 % |
| Devolução | R$ 39.747,42 | 1,4 % |
| Complementar negativo | R$ 14.050,54 | 0,5 % |

**Só as quatro últimas linhas — 19,6 % — saem inteiramente dos relatórios que a
Ambev entrega.** As outras 80,4 % tocam parâmetros que só a aba `Cadastro`
guarda.

## O que falta para o fechamento rodar fim a fim

A aba `Cadastro` **não é fonte no sistema**: nenhum dos seis relatórios traz
frota contratada, tarifa por veículo, alíquotas ou fatia de emissão.
`lib/fechamento/src/leitores/cadastro.ts` já a lê da `.xlsb` do usuário — por
rótulo, não por endereço de célula — e reconstrói o custo fixo ao centavo. O que
falta é ela virar **documento importável**, uma sétima fonte com vigência por
quinzena, ao lado das outras seis.

Enquanto isso não existe, o sistema reproduz o fechamento a partir dos
relatórios importados **mais** um cadastro fornecido à parte — e não a partir
dos relatórios sozinhos.

## O ramo `Menu!E12 <> "BELÉM"` é código morto

As linhas 127 e 128 têm um `IF(Menu!$E$12<>"BELÉM", …)` que sugere duas regras
por unidade. Verificado:

- `Menu!E12` está **vazia**. A unidade está em `Menu!D12` (`"BELÉM ROTA"`).
- A condição `"" <> "BELÉM"` é sempre verdadeira, logo o ramo tomado é o
  **"não-BELÉM"** — inclusive nesta pasta, que é de Belém.
- O termo que esse ramo acrescenta é `−D145`, e a **linha 145 está inteiramente
  vazia** (0 de 39 células ocupadas).

Ou seja: o `IF` lê a célula errada, e os dois ramos produzem o mesmo número
porque o termo que os distingue é zero. Não há regra por unidade a modelar aqui
— há uma condição quebrada que nunca teve efeito.

## Autoridade única

O gross-up e as linhas do resumo existem em `mapa-rota.ts` e em nenhum outro
lugar. API, tela, DRE e relatórios consomem o motor.
`__tests__/autoridade-unica.test.ts` varre `lib/`, `artifacts/` e `scripts/` e
falha se a aritmética do imposto for reescrita fora dele.
