# O `RESUMO GERAL`, linha por linha — de onde sai cada número

Rastreamento das fórmulas da `Fechamento_Remuneracao.xlsb` (44 abas), feito
sobre o fechamento real de **julho/2026 — CDD Belém · Horizonte**. Cada
afirmação daqui foi reproduzida em código e está sob teste em
`lib/fechamento/src/__tests__/mapa-rota.test.ts`.

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

As duas leituras não competem, e é bom que existam as duas: esta diz **quanto é
devido pelo contrato**, a do de-para diz **quanto foi demonstrado**. A diferença
entre elas é o que se discute na mesa.

## A cadeia

```
Resumo Geral!AI7:AI17   ──►  Mapa Rota!AI131..AI140   ──►  Cadastro!C9..C50   (1ª quinzena)
Resumo Geral!AJ7:AJ17   ──►  Mapa Rota!AJ131..AJ140   ──►  Cadastro!F9..F50   (2ª quinzena)
Resumo Geral!AI29       ──►  Outros Custos!F4
Resumo Geral!AI38       ──►  Abertura!F45              (o lado da transportadora)
```

A coluna `C` do `Cadastro` é a 1ª quinzena; a `F`, a 2ª. Os valores são
**mensais** e cada linha divide por dois.

## O fator de imposto — o "1,366960" que não tinha origem

O produto registrava que a coluna `TOTAL GERAL UNIDADE` usava "um fator de
conversão digitado (1,366960) que não sai de arquivo nenhum". **Sai.** É

```
fator = fatiaDentroDoMunicípio / (1 − PIS − COFINS − ISS)
      + fatiaForaDoMunicípio  / (1 − PIS − COFINS − ICMS)
```

Com as alíquotas de julho/2026 (PIS 0,65 %, COFINS 8,6 %, ICMS 17,84 %, ISS
5,9 %) dá **1,365455** na 1ª quinzena e **1,366960** na 2ª — a diferença é só a
fatia de documentos emitidos dentro do município (3,16 % contra 2,38 %).

## As cinco linhas de custo fixo

Nenhuma passa por relatório. Todas reproduzem **ao centavo**.

| Linha | Conta | 1ª quinzena |
|---|---|---|
| `CUSTO FIXO PADRONIZADO` | `(frota ativa + equipe + QLP adm. + outras despesas) ÷ 2 × veículos ativos × fator` | 731.502,84 |
| `CUSTO FIXO INATIVOS` | `remuneração da frota inativa ÷ 2 × veículos inativos × fator` | 9.017,30 |
| `CUSTO VANS INATIVAS` | `remuneração das vans inativas ÷ 2 × vans inativas × fator` | 13.088,62 |
| `CUSTO FIXO - ESPECIAIS` | `noturna × fator ÷ 2 × rotas noturnas + marketing × fator ÷ 2` | 5.938,28 |
| `CUSTO FIXO - VANS` | `(custo fixo da van + equipe da van) × vans × fator ÷ 2` | 42.745,64 |

Isto responde à nota que o de-para trazia — de que padronizado, especiais e vans
seriam "o mesmo dinheiro do 03.08.20 partido por tipo de frota, uma divisão que
o relatório não faz". Não é divisão nenhuma: são cinco fórmulas independentes
sobre o cadastro.

## Os três descontos

Chegam **sem imposto** — acumulados na última coluna de dia da quinzena — e
entram negativos:

- `DESCONTO DE DEVOLUÇÃO %` — `−base × fator`
- `DESCONTO DE DISPONIBILIDADE` — `−base × fator`
- `DESCONTO COMPLEMENTAR NEGATIVO` — `−base`, **sem** o fator

A assimetria do terceiro é da planilha, e é deliberada: ele já vem no valor em
que é descontado.

## O lado variável — o único que sai da operação

| Linha | Regra | Confere? |
|---|---|---|
| `CUSTO VARIÁVEL (AGREGADO)` | soma do `VALOR FATURADO` das viagens de frota `Spot` | exato nas duas quinzenas |
| `Vans` | soma do faturado das viagens de frota `Fixo` (é assim que o 2Art nomeia a van) | exato |
| `Recarga / Noturna` | soma do faturado das viagens de frota `Padrao` com `CARGA ATUAL` de recarga ou noturna | exato na 2ª quinzena |
| `CUSTO VARIÁVEL (FROTA FIXA)` | `(custo variável previsto ÷ 25) ÷ divisor` pelo split de emissão, × mapas fechados | ±0,05 % |

`TOTAL REMUNERAÇÃO ROTA DVS` é a soma das quatro — a planilha o traz de `Mapa
Rota!131`, cujo rótulo é literalmente `Custo Variável =>`. A sigla continua sendo
da Ambev e não foi expandida; o que deixou de ser desconhecido é o **número**.

## Onde a própria planilha se contradiz

Registrado para que a conferência contra o `.xlsb` saiba de antemão onde vai
discordar. O código **não** imita nenhum destes.

1. **`Mapa Rota!AJ133` lê a célula errada.** A fórmula do custo fixo padronizado
   da 2ª quinzena usa `AJ119` — a fatia de emissão calculada do diário — onde a
   da 1ª usa `Cadastro!C50`, a digitada. As duas quase coincidem, e a diferença
   é de **R$ 128,05**, que atravessa até o `TOTAL GERAL UNIDADE`. O código usa o
   cadastro nas duas quinzenas, que é a única das duas leituras que o contrato
   sustenta.

2. **`Resumo Geral!AI30` e `AJ30` são fórmulas quebradas.** `TOTAL OUTROS
   CUSTOS` soma `AI1048605:AI1048605` — uma linha que não existe, resto de uma
   exclusão. A fórmula devolve zero; o que a planilha mostra (R$ 358.530,22) é
   valor de cache, e ele ainda alimenta o `TOTAL GERAL UNIDADE`.

3. **`Mapa Rota!129` está quebrada em todos os dias.** O `Custo Variável
   (Recarga e Noturna)` diário aponta para `D1048619:D1048629`. Os valores
   exibidos são cache. Na 2ª quinzena o cache coincide com a soma correta
   (3.957,82); na 1ª **não**: a planilha mostra 11.574,83 e a soma das viagens
   de recarga e noturna dá 5.230,05.

## O que o sistema ainda não tem

A aba `Cadastro` **não existe como fonte** no fechamento — nenhum dos seis
relatórios da Ambev traz frota contratada nem tarifa por veículo. Sem ela, dois
terços do dinheiro do mês não podem ser reconstruídos.

`lib/fechamento/src/leitores/cadastro.ts` lê essa aba direto da `.xlsb` do
usuário, por rótulo e não por endereço de célula. O que falta para o fechamento
rodar fim a fim é o cadastro virar documento importável como os outros — uma
sétima fonte, com vigência por quinzena.
