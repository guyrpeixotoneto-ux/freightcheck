# A reconciliação do FINAME — do cartão ao saldo da frota

## A pergunta

A tela do FINAME publicava dois números de dinheiro a um palmo um do outro:

- o cartão **Impacto financeiro**: −R$ 17.171,54 por mensal;
- o painel **Evolução entre as duas vigências**: +R$ 90.844,71 na carreta e
  +R$ 23.548,67 no cavalo.

E explicava a distância com uma observação: *"R$ 12.973,33 por mensal do que a
parcela moveu é rubrica de outro módulo — e está somado lá. É essa a diferença
entre este cartão e o painel."*

A observação era verdadeira e não servia para conferir nada. Quem fecha o mês
precisa **sair do número do topo e chegar ao de baixo somando linhas**, e abrir
cada linha até a placa quando ela não convencer.

## O par medido

Tudo abaixo é o par da tela que originou a pergunta, com dado real:
**2ª quinzena de junho/2026 → 1ª quinzena de setembro/2026**, fonte Remunerado,
recorte Cavalo + Carreta (`EMPURRADA_2_6_2026` → `EMPURRADA_1_9_2026`).

| leitura | número |
| --- | --- |
| Impacto financeiro (cartão) | −R$ 17.171,54 / mês |
| `impacto.porOutroModulo` | +R$ 12.973,33 / mês |
| Parcela alterada — cavalo | −R$ 4.198,21 (10 veíc.) |
| Parcela alterada — carreta | R$ 0,00 (0 veíc.) |
| Entradas — cavalo / carreta | +R$ 27.746,88 (2) / +R$ 197.732,40 (24) |
| Saídas — carreta | R$ 106.887,69 (24) |
| Saldo base (cavalo + carreta) | R$ 875.951,31 + R$ 254.748,52 = **R$ 1.130.699,83** |
| Saldo comparada | R$ 899.499,98 + R$ 345.593,23 = **R$ 1.245.093,21** |

## A ponte, com os dados reais

Convenção de sinais, **a mesma nos dois blocos**: positivo aumenta o custo da
vigência comparada; a saída de frota é negativa.

| degrau | valor | veíc. |
| --- | ---: | ---: |
| Saldo na vigência base | R$ 1.130.699,83 | 133 |
| + Alterações em veículos comparados *(= o cartão)* | −R$ 17.171,54 | 10 |
| + Reclassificado para outro módulo | +R$ 12.973,33 | 3 |
| + Movimento sem efeito na parcela | R$ 0,00 | 0 |
| + Diferença não explicada | R$ 0,00 | 0 |
| **= Frota existente** | **−R$ 4.198,21** | 10 |
| + Entradas de frota | +R$ 225.479,28 | 26 |
| + Saídas de frota | −R$ 106.887,69 | 24 |
| **= Saldo na vigência comparada** | **R$ 1.245.093,21** | 135 |

`1.130.699,83 − 4.198,21 + 225.479,28 − 106.887,69 = 1.245.093,21`. Fecha na
casa do centavo.

### Cada degrau, aberto

**Alterações em veículos comparados (−R$ 17.171,54).** Três quitações e sete
reajustes, todos no cavalo:

| placa | rubrica | base | comparada | no degrau |
| --- | --- | ---: | ---: | ---: |
| QYP3G72 | Amortização + Juros | 9.847,35 | 0,00 | −9.847,35 |
| QYX1E78 | Amortização + Juros | 10.003,89 | 0,00 | −10.003,89 |
| QYX1E98 | Amortização + Juros | 10.003,89 | 0,00 | −10.003,89 |
| QYW2D78 | Parcela FINAME | 0,00 | 4.395,36 | +4.395,36 |
| QYW2F98 | Parcela FINAME | 0,00 | 4.395,36 | +4.395,36 |
| QYP0I48 | Parcela FINAME | 3.323,86 | 4.103,53 | +779,67 |
| QYQ6A80 · B30 · C20 · H14 | Parcela FINAME | 3.318,01 | 4.096,31 | +778,30 cada |

Nas três quitações a **parcela sai da soma** por estar coberta pelas partes
(`cobertasPorParcelas: 3`) — o mesmo dinheiro não é contado duas vezes.

**Reclassificado para outro módulo (+R$ 12.973,33).** As três placas quitadas:
o que a parcela deixou de pagar em amortização e juros reaparece como lucro
fixo, e quem o soma é a Auditoria de Lucro Fixo.

| placa | rubrica | base | comparada | no degrau |
| --- | --- | ---: | ---: | ---: |
| QYP3G72 | Lucro fixo do cavalo | 0,00 | 4.677,85 | +4.677,85 |
| QYX1E78 | Lucro fixo do cavalo | 0,00 | 4.147,74 | +4.147,74 |
| QYX1E98 | Lucro fixo do cavalo | 0,00 | 4.147,74 | +4.147,74 |

**Frota existente (−R$ 4.198,21).** É a soma de Δparcela das dez placas que
estão nas duas vigências — e é a única das três parcelas da evolução que a
coluna Diferença da tabela mostra.

**Fora do dinheiro.** Dez alterações de `data_fim_contrato` mudaram e não entram
em degrau nenhum: data não é dinheiro. Contadas, nunca somadas.

## Diferença conceitual, ou erro de cálculo?

**Conceitual — e só.** A identidade foi medida nos **55 pares** possíveis das 11
vigências do acervo (`EMPURRADA_2_12_2025` … `EMPURRADA_1_9_2026`), pela API de
pé:

```
impacto(MENSAL) + porOutroModulo(MENSAL) == Σ alterados   → 55/55, resíduo 0,00
base + alterados + entradas − saídas     == comparada     → 55/55
```

Nenhum par divergiu de um centavo. O que faltava não era conta: era a conta
**escrita**.

### O buraco que o acervo ainda não achou

A promessa antiga — *"a diferença entre os dois blocos é `porOutroModulo`"* —
não é verdadeira em geral. Ela falha numa placa em que **as partes se movem e a
parcela não**: amortização +R$ 600 e juros −R$ 600 entram no cartão e não mexem
no saldo; amortização +R$ 600 sozinha entra no cartão e some do saldo. Nenhum
dos dois casos existe no acervo de hoje, e nada os impedia de chegar — a
quitação de agosto na QYP3G72 é exatamente essa família de movimento, com sorte
diferente.

Por isso a escada tem duas linhas que hoje valem zero e são escritas assim
mesmo:

- **Movimento sem efeito na parcela** — o cartão somou, o saldo não viu;
- **Diferença não explicada** — o que sobra depois de todas as outras. É a única
  linha que muda de cor quando deixa de valer zero.

Sem elas, o dia em que esse movimento chegar produziria uma escada que
simplesmente não fecha, sem nome e sem dono — que é a situação que este trabalho
veio encerrar.

## Onde isso mora

| peça | arquivo |
| --- | --- |
| A escada (núcleo, puro) | `lib/comparison/src/reconciliacao-de-finame.ts` |
| O pareamento único da parcela | `parcelaPorVeiculo`, em `lib/comparison/src/finame.ts` |
| A rota | `GET /finame/reconciliacao`, em `artifacts/api-server/src/routes/finame.ts` |
| O painel | `artifacts/freightaudit/src/components/finame/reconciliacao.tsx` |
| Os testes | `lib/comparison/src/__tests__/reconciliacao-de-finame.test.ts` |

Três regras que a implementação obedece e que valem para quem for mexer nela:

1. **Nenhuma soma nova.** O degrau do cartão *é* `impactoPorPeriodicidade`; o da
   frota *é* `evolucaoPorTipo`. Uma régua própria aqui seria a terceira leitura
   a discordar das outras duas.
2. **Periodicidades não se somam.** Cada balde é uma escada. Só o balde da
   parcela tem saldo de frota; a aquisição (valor de NF, ICMS, PIS/COFINS) mostra
   o que se moveu e o módulo que o soma, e diz por extenso que não há saldo ali.
3. **Nenhum real sem linha.** A escada fecha por construção, e o que não se
   explica tem uma linha com nome em vez de virar resíduo mudo.
