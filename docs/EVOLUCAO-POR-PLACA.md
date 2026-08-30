# Evolução por Placa

O Dashboard e a Linha do Tempo respondem *o que aconteceu em cada vigência*.
Esta tela responde a outra pergunta, com os mesmos dados e sem uma segunda régua:

> **Quais placas estão sendo afetadas ao longo do tempo, como estão evoluindo, e
> quais merecem minha atenção agora?**

A unidade de análise passa a ser o **ativo**; o tempo vira o eixo horizontal.

---

## 1. A investigação que veio antes do código

O que foi apurado no sistema antes de escrever a leitura, e o que cada achado
decidiu:

| Pergunta | O que o sistema já responde | Onde |
|---|---|---|
| Como uma placa é identificada? | `entity.id` (UUID) é a identidade; a placa é um **identificador** com histórico de validade | `lib/db/src/schema/canonical.ts` |
| Qual é a identidade estável ao longo das vigências? | `entity.id`. Um reemplacamento fecha a linha antiga de `entity_identifier` e abre outra; os fatos não se movem | idem |
| Como placa, veículo, snapshot, vigência, unidade, canal e import_run se ligam? | `fact(entity_id, attribute_id, snapshot_id)`; `snapshot(scope_hash, canal, dataset_family, effective_date, import_run_id, status)` | `canonical.ts`, `series.ts` |
| Como o sistema calcula impacto, ganho, perda e sem valoração? | `assessImpact` decide se há preço; `criarDeduplicador` decide o que entra na soma; `resumirImpacto` soma por periodicidade | `impact.ts`, `deduplicacao.ts` |
| Qual é a "vigência anterior"? | O motor a escolhe (`findPreviousSnapshot`) e a materializa em `change_set(snapshot_a_id, snapshot_b_id)` | `engine.ts` |
| Que regras de visibilidade existem? | `alteracao_visivel` / `fato_visivel` (importação com `hidden_at`), `snapshot.status <> 'SUPERSEDED'` | `lib/db/src/fato-visivel.ts` |
| O que já dá para reaproveitar? | Toda a montagem da janela de intervalo de `getRangeAnalysis` | `families-view.ts` |
| A mesma placa pode aparecer em várias unidades/canais? | Sim, e a leitura é **de um contexto por vez** (`contextFilter`) | `series.ts` |

**Risco encontrado e corrigido durante a implementação.** A primeira versão
descartava, em silêncio, alterações com preço em *outra* periodicidade: a célula
anunciava 7 alterações e explicava 6. Hoje existe o balde
`outraPeriodicidade`, e a identidade `valoradas + semValoracao + foraDoTotal +
outraPeriodicidade = alteracoes` é um teste.

---

## 2. As decisões

1. **A linha da matriz é o ativo canônico** (`entity.id`); o rótulo é a placa
   **corrente**, e as placas anteriores viajam em `placasAnteriores`. Agrupar
   pela placa escrita na alteração (`change.entity_label`) partiria o histórico
   de um ativo reemplacado em duas linhas, cada uma com metade da perda.
2. **A janela e o dinheiro saem da mesma autoridade que a Linha do Tempo usa.**
   `abrirJanelaDeComparacoes` (extraído de `getRangeAnalysis` para que as duas
   leituras não tenham cópias que envelhecem) decide quais comparações pertencem
   a quais vigências, quais linhas existem dentro delas e qual índice de dupla
   contagem decide o que entra na soma.
3. **Periodicidade nunca soma.** A matriz é desenhada numa grandeza por vez; a
   tela oferece a troca. A grandeza padrão é a de maior peso no intervalo — a
   mesma régua do Radar da Gestão à Vista.
4. **Sem valoração não é R$ 0**, e **ausência não é zero**: célula esparsa com
   travessão para "não mudou", âmbar para "mudou e não sabemos quanto".
5. **A tela não soma dinheiro.** Todo número financeiro chega pronto do
   servidor; o frontend ordena, filtra, busca e pinta.

---

## 3. As réguas explícitas

**Tendência** (`tendenciaDoAtivo`) — conferível olhando a própria linha:

- `PIORANDO`: acumulado < 0 **e** vigências negativas ≥ positivas;
- `MELHORANDO`: acumulado > 0 **e** positivas ≥ negativas;
- `SEM_VALORACAO`: houve alteração e nenhuma tem preço;
- `ESTAVEL`: o resto.

**Recorrência**: `VIGENCIAS_PARA_RECORRENCIA = 3` — duas seguidas é o que a
piora consecutiva já mede; a terceira separa "mexeu de novo" de "mexe sempre".

**Piora consecutiva**: `VIGENCIAS_PARA_PIORA_CONSECUTIVA = 2`, medida sobre as
**colunas** do intervalo — uma vigência sem alteração interrompe a sequência.

**Score de atenção** (`pontuarAtivo`), 0–100, sem peso escondido:

```
IMPACTO            até 50  |acumulado negativo| ÷ maior perda do recorte
RECORRENCIA        até 20  vigências negativas ÷ vigências comparadas
PIORA_CONSECUTIVA  até 15  sequência negativa ÷ 3, limitada a 1
PENDENCIA          até 10  alterações sem preço ÷ maior pendência do recorte
RECENCIA            0 ou 5 mexeu-se na vigência mais recente
```

Ganho **não** pontua — o ranking é de atenção, não de tamanho. Cada parcela volta
em `motivos`, com os pontos e a frase que a explica, e a tela as mostra: é assim
que "por que esta placa está em primeiro?" tem resposta dentro do produto.

Faixas: `CRITICA` ≥ 60, `MONITORAR` ≥ 30, `ATENCAO` > 0, `POSITIVO` (ganho sem
sinal de atenção), `NEUTRA`.

---

## 4. Os contratos de reconciliação

Provados em `lib/comparison/src/__tests__/evolucao-por-placa-real.test.ts`,
contra a base real curada:

1. soma das células de uma placa = acumulado dela;
2. soma dos acumulados = impacto oficial que `getRangeAnalysis` publica para o
   mesmo intervalo e a mesma periodicidade;
3. ganhos e perdas = `gainsByPeriodicity` / `lossesByPeriodicity` da mesma leitura;
4. alteração sem valoração é contada e nunca vira R$ 0;
5. importação oculta some da matriz e volta quando reexibida;
6. unidade, canal, recorte temporal e tipo são respeitados (e um intervalo curto
   é subconjunto célula a célula do longo);
7. as vigências saem em ordem cronológica e a ponta "De" não vira coluna;
8. placa sem alteração não ganha célula fictícia;
9. linhas sem `entity_id` (eixo de atributo) contam na vigência e **não** viram
   uma placa inventada — a diferença para `range.totals.changes` é exatamente elas;
10. as rubricas de uma placa somam o acumulado dela, e as do escopo somam o líquido.

As réguas puras (tendência, score, insights, ordem, cor) têm testes sem banco em
`lib/comparison/src/__tests__/evolucao-por-placa.test.ts` e
`artifacts/freightaudit/src/lib/__tests__/evolucao-por-placa.test.ts`.

---

## 5. As três abas: Cavalo, Carreta e Conjunto

A tela tem um eixo a mais do que o recorte por equipamento: o **grão da linha**.

| Aba | Grão | Uma linha é | Medido no export real |
|---|---|---|---|
| Cavalo | `ATIVO`, `tipo=CAVALO` | uma placa de cavalo | 64 linhas |
| Carreta | `ATIVO`, `tipo=CARRETA` | uma placa de carreta | 80 linhas |
| Conjunto | `CONJUNTO` | o par cavalo+carreta **daquela vigência** | 92 linhas |

Trocar de aba mantém período, unidade, canal e grandeza — são o contexto da
pergunta. A aba Conjunto **limpa o `tipo`** e a rota descarta o recorte se ele
vier no endereço: um conjunto recortado a um dos dois lados seria a aba Cavalo
com outro nome. Nada é reaproveitado entre as abas: KPIs, insights, matriz,
ranking, detalhe e rubricas são recalculados no servidor a cada grão.

### O que a investigação do vínculo achou

Medido em 30/08/2026 sobre as 9 vigências do export real:

| Pergunta | Resposta |
|---|---|
| Existe identificador próprio de conjunto? | **Não.** O conjunto não é entidade (`tipos.ts`); é o par, declarado em `cavalo.placa_carreta` na linha do cavalo |
| O vínculo é persistido por vigência? | **Sim** — é um `fact` por (cavalo, snapshot). 60 a 64 por vigência, nenhum vazio |
| A composição pode mudar dentro da mesma vigência? | **Não.** Máximo medido: 1 carreta por cavalo por vigência |
| Um cavalo pode ter mais de uma carreta? | **Ao longo do tempo, sim**: 5 dos 64 trocaram em maio/2026 (QYQ6A80: OTX7592 → RZF9F30) |
| Uma carreta pode ter mais de um cavalo? | **Nenhuma ocorrência** nas 9 vigências — e há guarda para quando houver |
| Qual chave representa a composição? | `cavalo_entity_id \| carreta_entity_id`, **por vigência** |
| Órfãos? | Na vigência mais recente: 0 cavalos sem carreta, 9 carretas sem cavalo |

A chave é sensível à troca **de propósito**: quando o cavalo passa a puxar outra
carreta, existem dois conjuntos e a matriz mostra duas linhas. Fundi-las
esconderia exatamente o que a aba existe para mostrar; o painel traz a timeline
da composição, marcando em que vigências o par esteve junto e com quem o cavalo
esteve nas demais.

Um lado sozinho (`cavalo|` ou `|carreta`) **também é uma composição**. Não é
elegância: é o que faz a soma fechar. Se o ativo sem par ficasse de fora, o total
da aba Conjunto seria menor que o das abas Cavalo e Carreta, e ninguém saberia
dizer por quanto.

### A ambiguidade recusa em vez de escolher

Se dois cavalos declararem a mesma carreta na mesma vigência, o dinheiro dela
pertenceria a dois conjuntos. A leitura **desfaz o par** dos envolvidos naquela
vigência (cada um vira um lado sozinho) e devolve a ocorrência em
`ambiguidades`, que a tela escreve num aviso. Escolher um vencedor em silêncio
seria contar a carreta duas vezes ou perdê-la sem dizer.

---

## 6. A não duplicação, provada

**A aba Conjunto não soma "impacto do cavalo + impacto da carreta".** Ela
reagrupa as **mesmas linhas de alteração** por outra chave. A prova tem três
passos, e cada um é um teste:

1. **Cada linha de alteração tem exatamente um `entity_id`.** É a coluna
   `change.entity_id`; não existe alteração de duas entidades.
2. **Cada ativo pertence a exatamente uma composição por vigência.** Um cavalo
   declara no máximo uma carreta (medido), e uma carreta disputada por dois
   cavalos tem o par desfeito pela guarda acima. O teste
   *"é uma partição: nenhuma alteração se perde e nenhuma é contada duas vezes"*
   verifica isso linha a linha, sobre a base real.
3. **A regra de dupla contagem que já existia continua valendo por dentro.** As
   colunas da carreta que embutem o cavalo (`ESCOPOS_DE_CONJUNTO`:
   `carreta.finame`, `carreta.custo_fixo`, `carreta.lucro_variavel_previsto`,
   `carreta.lucro_fixomodelo_novo_ciclo`) seguem **fora** da soma, exatamente
   como nas abas Cavalo e Carreta. É o que impede a leitura ingênua — "o
   conjunto é o par, então some as colunas do par" — de voltar por esta porta.

Uma partição não cria nem destrói dinheiro. Daí a identidade, medida:

```
CAVALO   −R$ 18.541,81/mês
CARRETA  +R$ 44.073,55/mês
                          soma = +R$ 25.531,74/mês
CONJUNTO +R$ 25.531,74/mês  ✓  (e igual ao total da aba Geral)
```

---

## 7. Reconciliação entre as três visões

**O que é aditivo** entre Cavalo, Carreta e Conjunto, no mesmo escopo e na mesma
periodicidade — e cada linha abaixo é um teste:

| Métrica | Aditiva? | Por quê |
|---|---|---|
| Impacto líquido | **Sim** | partição das mesmas linhas |
| Perda e ganho | **Sim** | idem, lado a lado |
| Nº de alterações | **Sim** | idem |
| Alterações sem valoração | **Sim** | idem |
| **Nº de linhas** (placas/conjuntos) | **Não** | 64 + 80 = 144 ativos, mas 92 composições: o par funde duas linhas em uma |
| **Denominador** (frota / composições) | **Não** | contam unidades diferentes — ativos de um lado, pares do outro |
| Acumulado de **uma** linha | **Não comparável entre abas** | um cavalo que trocou de carreta tem o acumulado dele repartido entre duas composições |
| Ranking e score | **Não comparável** | o score normaliza pela maior perda **do recorte**, e o recorte muda com a aba |

A recusa importa tanto quanto a identidade: afirmar que
"Total Cavalo + Total Carreta = Total Conjunto" só é verdade para as quatro
primeiras linhas da tabela, e é por isso que as outras quatro estão escritas.

---

## 8. Desempenho

Medido no export real (CAMAÇARI · EMPURRADA, 8 comparações, 144 ativos, 3.224
alterações), sobre `/changes/evolucao-por-placa`:

| | |
|---|---|
| Consultas ao banco | **4** (comparações, linhas, placas correntes, frota) — nenhuma por placa |
| Tempo de resposta | ~120 ms |
| Corpo | 744 KB cru, **23 KB com gzip** |
| Células | 834 (esparsas: só onde houve alteração) |

A agregação inteira é uma varredura das linhas do intervalo; as células são
esparsas, então o corpo cresce com o que **mudou**, e não com placas × vigências.
As rubricas de cada célula viajam junto de propósito: a alternativa é uma chamada
por (placa, vigência) no clique, que é o N+1 que uma matriz de 144 linhas
transformaria em centenas de idas ao banco.

---

## 9. Onde mora o código

| Camada | Arquivo |
|---|---|
| Janela do intervalo (compartilhada com a Linha do Tempo) | `lib/comparison/src/janela-de-comparacoes.ts` |
| O par declarado, e a evidência dele | `PARES_DE_CONJUNTO`, em `lib/comparison/src/composition.ts` |
| A composição de cada vigência | `lib/comparison/src/composicao-da-vigencia.ts` |
| A leitura e as réguas | `lib/comparison/src/evolucao-por-placa.ts` |
| A rota | `GET /changes/evolucao-por-placa` em `artifacts/api-server/src/routes/changes.ts` |
| Contrato, filtros, ordem, cor e série | `artifacts/freightaudit/src/lib/evolucao-por-placa.ts` |
| A tela | `artifacts/freightaudit/src/pages/evolucao-por-placa.tsx` |
| Cartões, atenção, matriz, painel, ranking, rubricas, composição | `artifacts/freightaudit/src/components/evolucao-por-placa/` |
| Navegação | `EVOLUCAO_POR_PLACA` em `lib/ambiente.ts`, item em `nav-auditoria.ts`, escopo em `navegacao-do-escopo.ts` |

Nenhuma regra de negócio existente foi alterada. A extração de
`abrirJanelaDeComparacoes` de `getRangeAnalysis` é movimentação de código com o
comportamento preso pelos testes de `range-real.test.ts`, que continuam passando.
