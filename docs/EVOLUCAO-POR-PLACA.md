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

## 5. Desempenho

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

## 6. Onde mora o código

| Camada | Arquivo |
|---|---|
| Janela do intervalo (compartilhada com a Linha do Tempo) | `lib/comparison/src/janela-de-comparacoes.ts` |
| A leitura e as réguas | `lib/comparison/src/evolucao-por-placa.ts` |
| A rota | `GET /changes/evolucao-por-placa` em `artifacts/api-server/src/routes/changes.ts` |
| Contrato, filtros, ordem, cor e série | `artifacts/freightaudit/src/lib/evolucao-por-placa.ts` |
| A tela | `artifacts/freightaudit/src/pages/evolucao-por-placa.tsx` |
| Cartões, atenção, matriz, painel, ranking, rubricas | `artifacts/freightaudit/src/components/evolucao-por-placa/` |
| Navegação | `EVOLUCAO_POR_PLACA` em `lib/ambiente.ts`, item em `nav-auditoria.ts`, escopo em `navegacao-do-escopo.ts` |

Nenhuma regra de negócio existente foi alterada. A extração de
`abrirJanelaDeComparacoes` de `getRangeAnalysis` é movimentação de código com o
comportamento preso pelos testes de `range-real.test.ts`, que continuam passando.
