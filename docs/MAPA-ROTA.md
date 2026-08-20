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

O teste decisivo é contra o próprio 03.08.18, que está na pasta como aba:

| | 03.08.18 `Desconto Total` | Base digitada | Relação |
|---|---:|---:|---|
| 1ª quinzena | 42.939,35 | 11.649,87 | 27,1 % |
| 2ª quinzena | 29.075,62 | 91.642,50 | 315,2 % |

Nenhuma coluna, nem soma de colunas, do 03.08.18 ou da `Justificativa`
reproduz as bases digitadas — em nenhuma das duas quinzenas, por nenhum fator
constante. **A derivação acontece fora do arquivo.**

### O que isso significa, e o que o sistema pode fazer melhor

O sistema já lê o 03.08.18 e extrai, por dia e por canal,
`descontos: { custoFixo, equipe, indiretos, fatorAjudante, total }`
(`leitores/disponibilidade.ts`), e já lê os descontos do 03.08.20 com base e
percentual (`leitores/pagamento.ts`). Ele tem, portanto, o material para
**calcular** a base em vez de recebê-la digitada — o que a planilha não faz.

Isso é uma mudança de número, não só de método: com o `Desconto Total` do
03.08.18 como base, a 1ª quinzena descontaria R$ 42.939,35 × fator em vez de
R$ 11.649,87 × fator. Antes de ligar esse fio é preciso saber **o que a
transportadora usou para chegar aos números digitados** — e essa informação não
está em nenhum arquivo entregue até aqui.

**Enquanto isso não for respondido, o fechamento não é ponta a ponta.** As
bases entram no motor como parâmetro de entrada (`BasesDaQuinzena`), com o
mesmo tratamento de ausência das demais: `null`, nunca zero.

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
