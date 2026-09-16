# Achado: o total composto da carreta entra na soma do intervalo

**Medido em 16/09/2026**, sobre a base curada (`Modelo_Carreta` + `Modelo_Cavalo`,
9 vigências de 16/12/2025 a 01/08/2026, contexto `CAMAÇARI · EMPURRADA`).

Levantado ao construir o portão da Evolução anual do FINAME, antes de a tela
existir. **Nada foi corrigido**: este documento registra a medição, e o defeito
continua de pé.

---

## O que foi confrontado

O FINAME tem duas implementações da mesma regra de dupla contagem:

| régua | onde | sobre | quem usa |
|---|---|---|---|
| `impactoPorPeriodicidade` | `lib/comparison/src/finame.ts` | `LinhaDeFiname` | Auditoria de FINAME (comparação entre duas vigências) |
| `criarDeduplicador` | `lib/comparison/src/deduplicacao.ts` | `LinhaDeMudanca` | Linha do Tempo, Evolução por Placa, consolidados |

O cabeçalho de `impactoPorPeriodicidade` afirma que a regra dela "é a mesma que
`deduplicacao.ts` aplica". A afirmação nunca teve teste que a amarrasse.

---

## O resultado

Com o universo `CODIGOS_DA_TABELA` (as 12 variáveis que a tabela soma), as duas
réguas **respondem o mesmo nos 8 pares**, ao centavo. É o que
`evolucao-de-finame-real.test.ts` amarra.

Com o universo `CODIGOS_DO_DETALHE` (as 18, incluindo `carreta.finame`), elas
divergem em **2 dos 8 pares**:

| par | `impactoPorPeriodicidade` | `deduplicacao.ts` | diferença |
|---|---|---|---|
| 2025-12-16 → 2026-01-16 | −57.800,80 | −75.902,96 | **−18.102,16** |
| 2026-04-16 → 2026-05-16 | +5,85 | +70.454,04 | **+70.448,19** |

Periodicidade: `MENSAL` nos dois casos. Nas demais grandezas não há divergência.

**A diferença é integralmente de um único atributo: `carreta.finame`** (a
variável `finame_total` do catálogo). Nenhuma outra linha diverge — a partição
foi conferida linha a linha.

---

## Os veículos, e as duas formas do defeito

### Caso A — dupla contagem (dez/2025 → jan/2026)

Cinco carretas em que `carreta.finame_implemento` se moveu e o cavalo vinculado
não:

| placa | `carreta.finame` contado | partes do implemento contadas |
|---|---|---|
| QYQ8F84 | −3.662,04 | −3.662,05 |
| QYQ8F54 | −3.743,10 | −3.743,10 |
| QYQ3F63 | −3.743,10 | −3.743,10 |
| QYQ8G14 | −3.210,82 | −3.210,82 |
| QYO6D17 | −3.743,10 | −3.743,10 |

O mesmo dinheiro entra duas vezes: uma dentro de `carreta.finame`, outra pelas
parcelas (`carreta.amortizacao_implemento` + `carreta.juros_finame_implemento`),
que entram porque `carreta.finame_implemento` foi corretamente excluído como
`COBERTO_POR_PARCELAS`.

### Caso B — impacto fantasma por troca de composição (abr → mai/2026)

Cinco carretas cujo `carreta.finame` saltou sem que implemento nem cavalo
mudassem de valor:

| placa | `carreta.finame` | de → para | o que de fato mudou |
|---|---|---|---|
| RZF8B28 | +16.769,83 | 5.982,50 → 22.752,33 | RPG1J60 passou de OTI4A85 para RZF8B28 |
| RZF7H88 | +15.905,65 | 5.982,50 → 21.888,15 | RPH1D94 passou de OTI3G45 para RZF7H88 |
| RZF8D48 | +17.227,35 | 5.982,50 → 23.209,85 | RPG3A49 passou de ORE0690 para RZF8D48 |
| RZM0C41 | +17.227,35 | 6.094,94 → 23.322,29 | RPG8B78 passou de OTX7582 para RZM0C41 |
| RZF9F30 | +3.318,01 | 5.631,50 → 8.949,51 | QYQ6A80 passou de OTX7592 para RZF9F30 |

No par inteiro há **uma** alteração em `cavalo.finame_cavalo` (QYP0I48:
3.318,01 → 3.323,86) e **cinco** em `cavalo.placa_carreta`. O total da carreta
subiu porque passou a embutir o financiamento de um cavalo que já existia e já
era pago. Nada encareceu; só mudou a linha que reporta o valor.

---

## A origem exata

`carreta.finame` é um **total composto**: `carreta.finame =
carreta.finame_implemento + cavalo.finame_cavalo` (medido em 558 de 558 linhas,
`ESCOPOS_DE_CONJUNTO`).

- `impactoPorPeriodicidade` **barra o total composto sempre**, em
  `linhaDaAlteracao`, pela marca `totalComposto` do catálogo. Não é uma regra
  condicional: o total nunca chega a ser somado.
- `deduplicacao.ts` não tem regra incondicional. Ele tem duas, e **nenhuma das
  duas alcança os casos acima**:
  1. `COBERTO_POR_PARCELAS` lê `COMPOSITIONS`, e **`COMPOSITIONS` não declara
     `carreta.finame`**. As entradas registradas são `carreta.custo_fixo =
     carreta.finame + carreta.lucro_fixomodelo_novo_ciclo` e
     `carreta.finame_implemento = amortizacao + juros + custo_aluguel`. A
     relação `finame = finame_implemento + finame_cavalo` **não está lá**.
  2. `ESCOPO_DE_CONJUNTO` conhece a relação, mas só exclui a linha da carreta
     **cujo cavalo mudou a coluna embutida na mesma comparação**. No caso A o
     cavalo não mudou; no caso B mudou o *vínculo*, não o valor.

A regra 2 está escrita para o que ela de fato resolve — evitar contar o cavalo
duas vezes quando ele se move. O que falta é a outra metade: o total composto
também embute o **implemento**, e essa metade não tem exclusão nenhuma.

---

## Qual régua está correta

**`impactoPorPeriodicidade` (`finame.ts`).** Um total composto não pode ser
somado ao lado das partes que o compõem, e a marca `totalComposto` do catálogo
já diz exatamente isso, com a evidência medida junto. A régua do intervalo
acerta por acidente nos pares em que uma das suas duas regras alcança o caso, e
erra nos demais.

Os dois casos confirmam: no A, o dinheiro é contado duas vezes; no B, é contado
uma vez, mas como aumento de custo quando foi só re-atribuição de linha.

---

## Quem carrega o número hoje

- **A Auditoria de FINAME (comparação entre vigências) não é afetada.** Ela usa
  a régua correta.
- **A Evolução anual do FINAME não será afetada.** Ela soma `CODIGOS_DA_TABELA`,
  que não contém `finame_total` — e isso está amarrado por teste.
- **As leituras de intervalo sem recorte são afetadas**: Linha do Tempo,
  Evolução por Placa e os consolidados leem o universo inteiro, e portanto
  incluem `carreta.finame`.

Medido sobre o intervalo inteiro (2025-12-16 → 2026-08-01, sem recorte de
rubrica, `MENSAL`), que é o que a Evolução por Placa e a Linha do Tempo somam:

| | R$/mês |
|---|---|
| líquido publicado hoje | **+25.531,74** |
| `carreta.finame` contado pelo deduplicador (10 linhas) | +52.346,03 |
| líquido depois da correção | **−26.814,29** |

**A correção inverte o sinal do intervalo**: o que hoje é publicado como aumento
de custo passa a ser redução. Não é ajuste de casas decimais — é a leitura
mudando de lado.

Por par, a correção vale −18.102,16 em dez→jan e −70.448,19 em abr→mai; os
outros 6 pares não mudam.

A Auditoria de FINAME **não muda de número** com a correção, em nenhum par: ela
já não soma o total composto.

---

## A correção provável, quando for hora

Registrar `carreta.finame` em `COMPOSITIONS` com as partes que ele de fato tem,
para que `COBERTO_POR_PARCELAS` o alcance quando o implemento se mover; e
decidir, separadamente, o que fazer quando a composição troca sem que valor
nenhum mude — que é um caso que nenhuma das duas regras cobre e que também
aparece em `carreta.custo_fixo`.

Não foi feito aqui porque muda números publicados por telas em produção, e essa
é uma decisão de produto, não de refatoração.
