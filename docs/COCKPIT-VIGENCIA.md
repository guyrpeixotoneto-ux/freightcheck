# O cockpit da vigência (tela Acompanhamento)

A tela lia como uma lista técnica de diferenças: os números viviam dentro de
frases, todos os cartões tinham o mesmo peso, o valor cru da planilha aparecia
na primeira linha e o texto mais destacado da página era **"nenhum valor
apurável"** — uma frase sobre o que o produto não conseguiu fazer, escrita em
cima de 267 alterações que ele acabara de encontrar.

Este documento registra o que passou a existir e, principalmente, **a única
regra de negócio nova**: a criticidade.

## O que já existia e continua sendo a fonte

Nada abaixo recalcula comparação, impacto ou classificação. Tudo vem de
`getGroupedView` (`lib/comparison/src/grouped.ts`), que já entregava:

| dado | de onde vem |
| --- | --- |
| alterações, pontos alterados, veículos tocados | `totals` |
| impacto por periodicidade, excluído por dupla contagem, sem preço | `impact` |
| selo (`DINHEIRO`, `RUPTURA`, `COBERTURA`, `MOVIMENTO`, `TRAVADO`, `FORMATO`, `SEM_SINAL`) | `pickBadge` |
| abrangência (`TOTAL`, `MAIORIA`, `PARCIAL`) e frota | `buildGroup` |
| anomalia de formato, sua explicação e se ela é **só** formato | `anomalies.ts` |
| padrões "antes → depois" e o dominante | `buildGroup` |
| motivo de não haver preço | `impact.reason` |
| acumulado histórico, num campo próprio | `accumulated` |

Dois campos foram **acrescentados** ao grupo, e ambos são contagem direta do que
já estava carregado: `changes` (linhas do grupo — a soma fecha com
`totals.changes`) e `natureCodes` (as naturezas sem tradução, para que a regra
não dependa de um rótulo de tela).

## O que é derivado (`lib/comparison/src/cockpit.ts`)

Projeção pura sobre os grupos, sem consulta ao banco: KPIs, panorama,
diagnóstico em português, frase executiva e fila de prioridades. Viaja na mesma
resposta de `/changes/grouped`, em `cockpit` — uma requisição, nenhum N+1.

A frase executiva é **composição determinística**, não modelo: a mesma entrada
produz sempre o mesmo texto, e há teste para isso.

## A regra nova: criticidade

Antes existiam *selo* (que tipo de sinal) e *abrangência* (em quanto da frota).
Nenhum dos dois ordena uma fila de trabalho — "Ruptura" não diz se vem antes de
"Dinheiro". A criticidade é a composição dos dois com magnitude e dinheiro, e é
**aditiva e explicável**: cada critério vale pontos, cada ponto vira uma frase
em `reasons`, e a tela mostra a soma inteira dentro do item.

| critério | pontos |
| --- | --- |
| selo RUPTURA | 35 |
| natureza dura (zerou, saiu de zero, sumiu, passou a existir, mudou de tipo, motivo de ausência, significado mudou) | 10 |
| anomalia de formato | 10 |
| impacto financeiro apurado (≠ 0) | 35 |
| valor apurado, fora do total por dupla contagem | 20 |
| abrangência TOTAL / MAIORIA / PARCIAL | 30 / 18 / fatia × 20 |
| variação ≥ 100% / ≥ 50% / ≥ 20% | 20 / 12 / 6 |
| preço travado (monetário sem semântica confirmada) | 5 |

Uma exceção **substitui** a tabela: um ponto de troca de formato pura
(`ChangeGroup.formatOnly` — todas as linhas são a mesma data escrita de outro
jeito) vale 5 pontos fixos, com esse motivo escrito. Nenhum critério da tabela
descreve o que houve ali, porque não houve mudança de valor: somá-los dava 85
pontos ao `data_fim_contrato` de ago/2026 e o punha em primeiro lugar, acima do
IPVA que custou R$ 144 mil.

**Cortes:** ≥ 70 crítico · ≥ 45 alto · ≥ 25 médio · abaixo, baixo.

**Desempate**, nesta ordem: veículos, valor absoluto do impacto, chave do grupo.
A chave é única e estável, então duas leituras da mesma vigência devolvem a
mesma fila — há teste para isso também.

Exemplos sobre o export real:

- `cavalo.data_fim_contrato` (ago/2026): **5, baixo** — troca de formato pura nos
  62 cavalos. Já valeu 85 e abria a fila; ver a exceção acima.
- `cavalo.combustivel_consumo_neg` (jul/2026): 35 + 10 + 30 + 6 = **81, crítico**.
- `cavalo.ipva_licenciamento` (jul/2026): 35 + 30 + 6 = **71, crítico** —
  −R$ 144.874,50/ano nos 62 cavalos.
- `cavalo.combustivel_consumo_benchmark` (ago/2026): 35 + 10 + 3 + 20 = **68,
  alto** — zeramento em 16% da frota.

O que a criticidade **não** faz: filtrar. Todo grupo recebe uma, todo grupo
continua na fila, e "baixo" nunca é sinônimo de escondido.

## As recusas que continuam de pé

1. **Nunca somar periodicidades.** R$/mês e R$/ano em linhas próprias, sempre.
2. **"Sem preço" nunca vira R$ 0,00.** São campos diferentes, contados em
   lugares diferentes: o KPI mostra `—` e diz quantas alterações estão sem
   preço; o filtro "Sem preço" recorta por `impact.amount === null`, então um
   impacto apurado de zero não cai nele.
3. **Alteração, ponto e veículo são grandezas distintas**, e cada bloco escreve
   qual está contando.
4. **Vigência ≠ histórico.** O acumulado ficou no rodapé, com o período escrito,
   e some quando há uma comparação só ("histórico ainda insuficiente").
5. **Zero alterações tem duas causas opostas.** `cockpit.baseline` distingue
   "nada mudou" de "não há vigência anterior com que comparar".
6. **O valor cru não sobe para a camada executiva.** `2028-07-01T12:00:00Z →
   46935.5` continua inteiro — em "O que mudou", dentro da investigação.
7. **Indício é dito como indício — e conclusão, como conclusão.** Onde formato e
   valor mudaram na mesma célula, o diagnóstico usa "compatível com", "indício",
   e não afirma. Onde o número é o mesmo instante da data do outro lado ao
   milissegundo, ele afirma: hesitar ali manda alguém conferir 62 contratos que
   não mudaram.
8. **Troca de formato não é alteração contratual, e não some por isso.** O ponto
   sai da faixa crítica, ganha selo próprio e vai para o fim da fila; as linhas
   continuam contadas em `totals.changes`, ditas à parte em
   `totals.formatOnlyChanges`, e rastreáveis até a célula.

## Onde estão os testes

- `lib/comparison/src/__tests__/cockpit.test.ts` — score, cortes, ordenação,
  KPIs, panorama, diagnóstico, narrativa e histórico, sobre grupos fabricados.
- `lib/comparison/src/__tests__/cockpit-real.test.ts` — os mesmos números contra
  o export real: os KPIs batem com `totals`, a soma dos grupos fecha com a
  vigência, as três situações de preço somam o total, a fila tem um item por
  grupo e a ordem é estável.
- `artifacts/freightaudit/src/lib/__tests__/cockpit.test.ts` — o que a tela
  decide sozinha: junção fila × grupos, filtros e contagens dos botões.
