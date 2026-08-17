# Composição — diagnóstico e desenho

> **Status:** implementado. `lib/composition`, `/api/composition/*`, telas
> `/composicao` e `/composicao/:id`.
> **Base da investigação:** o banco reconstruído do export real
> (`Remuneração_Equipamento_Análise_FT`), 9 vigências, 83.241 fatos, 144 ativos,
> 138 atributos, medido em 14/08/2026.

O módulo responde a uma pergunta: **por que este equipamento recebe este valor
nesta vigência?** Não é uma tela de parâmetros com outro nome — é a memória de
cálculo da remuneração, e a diferença está em que cada número exibido pode ser
refeito por quem lê, até a célula da planilha de origem.

---

## 1. O que já existia, e foi reaproveitado

Nada aqui é modelagem financeira nova. O módulo é uma leitura do canônico.

| O que | De onde | Para quê na Composição |
|---|---|---|
| `snapshot` / `entity` / `attribute` / `fact` | `lib/db` | O grão. Nenhuma tabela nova foi criada. |
| `loadAttributeClassificationsAt` | `lib/comparison/classification` | Semântica **na data da vigência**, não a de hoje. |
| `attribute_semantics` (versionada) | migration 0005 | Detecta que o significado mudou entre duas vigências. |
| `COMPOSITIONS` | `lib/comparison/composition` | A árvore total → parcelas, que evita a dupla contagem. |
| `resolveContext` / `contextFilter` | `lib/comparison/series` | Unidade + canal. Uma vigência é de alguém. |
| `attributeLabel` / `equipmentLabel` | `lib/comparison/labels` | O vocabulário de leitura, um só no produto inteiro. |
| `placementOf` (famílias Freightech) | `lib/comparison/families` | Agrupamento alternativo na aba Parâmetros. |
| `computeChangeSet` / `listChanges` | `lib/comparison/engine`, `query` | A aba Alterações **lê** o motor de comparação; não o reimplementa. |
| `CONFIRMED_SEMANTICS` | `lib/db/semantica-confirmada` (reexportado por `lib/curation/confirmations`) | O portão: só CONFIRMADA entra em total. Aplicado pela **promoção**, na mesma transação de `garantirSemanticaInicial` — antes só a curadoria o aplicava, e uma planilha importada pela tela chegava aqui sem significado nenhum. |
| Taxonomia (22 nós), `raw_cell`, proveniência | `lib/db/taxonomia-canonica` (reexportada por `lib/curation/taxonomy`) | Categoria e rastreabilidade célula a célula. Garantida pela **promoção**, antes das confirmações — é o nó que elas vinculam. |

**Uma tabela nova: nenhuma. Uma migration nova: nenhuma.**

---

## 2. O achado que definiu a modelagem

Ao conferir a aritmética das colunas monetárias confirmadas, apareceu isto:

```
carreta.finame − carreta.finame_implemento = cavalo.finame_cavalo
```

do cavalo que aponta aquela carreta em `cavalo.placa_carreta`. **558 de 558
linhas** (vigência × carreta com cavalo vinculado), tolerância de R$ 0,01, zero
exceções. Nas 99 linhas de carreta sem cavalo vinculado, a diferença é
exatamente zero.

Como `carreta.custo_fixo = carreta.finame + carreta.lucro_fixomodelo_novo_ciclo`
fecha em 657 de 657 linhas, a conclusão é direta e desconfortável:

> **`custoFixo` não é o custo fixo da carreta. É o do conjunto cavalo + carreta.**

Somar `cavalo.finame_cavalo` da frota de cavalos com `carreta.custo_fixo` da
frota de carretas contaria cada cavalo duas vezes — **R$ 1.048.665,73/mês** em
agosto/2026, sobre um total de frota de R$ 1.204.664. O erro sobreviveria a
qualquer revisão que olhasse só para os nomes das colunas.

A decomposição que o módulo usa, medida par a par nas 9 vigências, **558 de 558
pares fecham**:

```
(finame_implemento + lucro_fixomodelo_novo_ciclo) + finame_cavalo = custo_fixo
 \______________ carreta ______________/           \__ cavalo __/   \ conjunto /
```

É **exaustiva** (nada do conjunto fica sem dono) e **disjunta** (nenhum real tem
dois donos). É por causa dela que somar a frota de cavalos com a de carretas
passou a ser legítimo — e é ela que o teste de regressão reproduz.

As duas colunas de conjunto **não somem da tela**: aparecem na ficha da carreta,
com o valor e com esta medição escrita ao lado, porque quem confere a planilha
vai encontrá-las lá.

---

## 3. O que é financeiramente apurável hoje

Dos 138 atributos, **17 têm semântica confirmada**. Destes, o que entra num
total:

### Cavalo — R$ 867.860,23/mês nos 62 ativos (ago/2026)

| Componente | Unidade | Periodicidade | Papel |
|---|---|---|---|
| `finame_cavalo` | BRL | MENSAL | **raiz** — a remuneração mensal do cavalo |
| ↳ `amortizacao_cavalo` | BRL | MENSAL | parcela, absorvida |
| ↳ `juros_finame_cavalo` | BRL | MENSAL | parcela, absorvida |
| ↳ `lucro_fixomodelo_novo_ciclo_cavalo` | BRL | MENSAL | parcela, absorvida |
| `ipva_licenciamento` | BRL | ANUAL | gaveta anual, **nunca dividido por 12** |
| `valor_nf_compra`, `valor_pis_cofins` | BRL | PONTUAL | aquisição, **nunca remuneração** |

### Carreta — R$ 336.803,77/mês nos 71 ativos (ago/2026)

| Componente | Unidade | Periodicidade | Papel |
|---|---|---|---|
| `finame_implemento` | BRL | MENSAL | **raiz** |
| ↳ `amortizacao_implemento`, `juros_finame_implemento`, `custo_aluguel` | BRL | MENSAL | parcelas, absorvidas |
| `lucro_fixomodelo_novo_ciclo` | BRL | MENSAL | **raiz** |
| `custo_fixo`, `finame` | BRL | MENSAL | **escopo de conjunto — fora do total** |
| `icms`, `pis_cofins` | PERCENT | — | alíquota, não montante |
| `valor_nf_compra`, `valor_pis_cofins` | BRL | PONTUAL | aquisição |

---

## 4. O que **não** é apurável, e o que destravaria cada caso

| Caso | Exemplo | Motivo exibido | O que resolve |
|---|---|---|---|
| Semântica presumida | `seguro`, `valorPneu`, `lucroVariavelPrevisto` | *Semântica não confirmada* | Curadoria: uma linha em `CONFIRMED_SEMANTICS` com a conta que a sustenta |
| Razão sem base | `manutencaoReaisKm` = 0,25 R$/km | *Base operacional ausente* | **Quilometragem rodada por ativo no período** — não vem neste export |
| Consumo | `combustivelConsumoNeg` km/l | *Não monetário* | Quilometragem **e** preço do litro |
| Alíquota | `icms` = 12% | *Não somável* | Nada: o montante correspondente é `valorIcms` |
| Não numérico | `chassi`, `ativo`, `dataFimContrato` | *Não monetário* | Nada: são parâmetros, não remuneração |
| Ausência | célula vazia ou sentinela | *Sem valor nesta vigência* | Reimportação com o dado, se houver |

**As bases complementares que faltam, em ordem de valor destravado:**

1. **Quilometragem mensal por placa.** Destrava `manutencaoReaisKm`,
   `manutencaoBid`, `reaiskm` e `Custo Variável Simulado` — quatro colunas em
   R$/km que hoje não viram um real.
2. **Preço do diesel no período.** Com a quilometragem, destrava combustível.
3. **A remuneração efetivamente paga** pelo Freightec/Ambev. É o que a aba
   Auditoria vai confrontar; sem ela, não há diferença a apurar.

---

## 5. As regras, em código

### O portão (`motor.ts`)

Um valor só entra num total quando **todas** valem:

1. o tipo do dado admite montante (TEXT, BOOLEAN e DATE nunca admitem);
2. a semântica está **CONFIRMADA na data daquela vigência**;
3. é monetário e somável;
4. tem periodicidade declarada;
5. o fato é numérico e não nulo;
6. não é parcela de um total que já entrou;
7. não remunera outro equipamento.

Falhando qualquer uma, o componente **não some** — vai para a lista dos não
apurados, com o motivo nomeado e a frase que o explica.

### As gavetas

MENSAL, ANUAL e AQUISIÇÃO, sempre separadas. Anualizar exigiria uma regra de
rateio que ninguém confirmou; PONTUAL é grandeza de aquisição e nunca é
remuneração.

### O farol (`status.ts`)

| Cor | Quando |
|---|---|
| ⚪ **Incompleto** | fora da vigência, ou nenhum componente mensal apurável |
| 🔴 **Crítico** | total não fecha com as parcelas, semântica mudou entre vigências, ou variação ≥ 10% |
| 🟡 **Atenção** | entrou na frota, ou a remuneração mensal mudou |
| 🟢 **Normal** | sem movimento e sem inconsistência |

**O farol não mede completude de propósito.** Praticamente todo equipamento
desta base tem componente monetário sem regra financeira; um farol sempre
amarelo não informa nada. A completude é dimensão própria — "R$ X apurados ·
Y componentes sem regra" — e melhora com a curadoria.

---

## 6. Riscos

| Risco | Sev. | Mitigação |
|---|---|---|
| Alguém voltar a somar `custoFixo` na carreta | **Alta** | Teste par a par nas 9 vigências; `regras.ts` carrega a medição |
| Semântica confirmada errada | Alta | O portão lê a versão **da data**; mudança de versão acende 🔴 |
| Nova composição total→parcela não declarada | Média | Ela some do total e a divergência aparece como inconsistência |
| Um terceiro equipamento entrar sem regra | Média | `regraDe` devolve regra vazia; a rota recusa o tipo com a lista dos conhecidos |
| Frota grande | Baixa | Duas leituras de vigência por tela, independente do nº de ativos |

---

## 7. O que ficou preparado e desligado

**Conjuntos.** O vínculo existe e é confiável: `cavalo.placa_carreta` tem valor
nos 62 cavalos da última vigência, aponta 62 placas distintas, e as 62 casam com
uma carreta do banco — um para um. `getVinculoDoCavalo` já o resolve, e a ficha
do cavalo leva à carreta. A aba não foi ligada porque a remuneração do conjunto
já vem pronta da fonte (`custoFixo`): uma aba que a repetisse não diria nada que
a ficha da carreta não diga. Ela passa a valer quando houver o que confrontar.

**Auditoria.** Esperado × recebido. Falta o recebido. A aba aparece desligada,
com o motivo, em vez de ligada e vazia.
