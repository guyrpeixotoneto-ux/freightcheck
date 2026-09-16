# Onde iam os vinte minutos de uma importação

**Data:** 16/09/2026 · **Método:** medição, não intuição.

Um arquivo de **51.600 linhas** — a frota inteira, o cenário que o cliente
descreveu como "trava depois dos 60%" — foi importado de ponta a ponta contra um
Postgres 16 local, pelo mesmo caminho do produto (`receiveFile` → `captureRaw` →
`stage` → `preview` → `promote`), com o driver instrumentado para contar idas ao
banco e um perfil de CPU do Node por cima. Os números abaixo são desse arquivo.

---

## 1. O que foi medido

| etapa         | antes     | depois   | idas ao banco (antes → depois) |
| ------------- | --------- | -------- | ------------------------------ |
| `receiveFile` | 0,09 s    | 0,10 s   | 3 → 3                          |
| `captureRaw`  | 11,6 s    | 11,8 s   | 55 → 55                        |
| `stage`       | 20,6 s    | 21,1 s   | 59 → 59                        |
| `preview`     | 1,9 s     | 1,8 s    | 11 → 11                        |
| **`promote`** | **1257,9 s** | **44,0 s** | **51.844 → 161**          |
| **TOTAL**     | **1292,0 s** (21 min 32 s) | **78,8 s** | 51.972 → 289 |

**16,4× no total; 28,6× na aprovação.** As quatro primeiras etapas não foram
tocadas: elas já eram lineares, escrevem em massa e gastam o tempo dentro do
Postgres, que é onde o tempo de uma escrita de 413 mil fatos deve estar.

A aprovação era outra história. Dos 1.258 s, **48 s** estavam dentro do driver:
os outros **1.210 s eram JavaScript** — o processo a 98% de CPU, o banco parado
em `idle in transaction`, e a barra de progresso imóvel, porque a promoção só a
move quando grava fatos e esse trabalho todo vem antes. É literalmente o sintoma
relatado: parada, sem nada acontecendo do lado do banco.

## 2. Os três gargalos, por ordem de tamanho

**1. Uma varredura quadrática na resolução de escopos (≈1.200 s).** Para cada
linha que declara unidade, `resolveScopes` fazia um `facts.find` no lote inteiro
para achar o nome daquela unidade. Com 413 mil fatos no lote, são 51.600
varreduras de 413 mil elementos. O perfil de CPU mostrava `resolveScopes` com
44% do tempo total de relógio do processo; `groupFactsByEntityScope` varria o
mesmo lote uma vez por coluna de escopo, e cada passagem refazia o
`attributeCode.split(".")` de todo fato. Agora uma passada indexa os fatos pelo
sufixo do atributo, e as duas leituras pedem só as linhas que lhes interessam.

**2. Um `INSERT … RETURNING` por veículo novo (51.600 idas ao banco).** No
primeiro arquivo de uma frota toda placa é nova, e cada uma pedia a sua linha em
`entity` numa ida própria, em série, dentro da transação. Custava 13,2 s num
socket local — e, num banco a 25 ms de distância, mais de **vinte minutos** só de
latência. O id não precisava vir do banco para ser um id: `entity.id` é um `uuid`
com `defaultRandom()`, então ele é gerado aqui e as entidades entram em lote,
pelo mesmo caminho `unnest` que já grava os fatos.

**3. Consultas de uma linha dentro de laços por atributo (≈130 idas por
promoção).** O nome da coluna, o nome da aba e a localização da célula eram três
`SELECT` de uma linha chamados por atributo e por vigência gravada; a existência
de cada atributo, mais um. Viraram uma consulta por laço. Na mesma linha, o
registro de semânticas confirmadas (`aplicarConfirmacoesCanonicas`, que roda
dentro da transação de toda promoção) fazia três consultas de uma linha **por
entrada** — 60 idas ao banco que não dependem do tamanho do arquivo. Viraram
três.

## 3. O que **não** foi mudado, e por quê

- **A transação única da promoção fica.** Dividi-la em lotes transacionais
  tornaria visível uma vigência pela metade, e é justamente isso que
  `prova-de-atomicidade.ts` existe para impedir. A granularidade de parar já é
  outra: cada statement em massa publica progresso e lê o pedido de
  cancelamento, e um `ROLLBACK` desfaz o que ninguém chegou a enxergar.
- **A escrita continua em série dentro da transação.** Os statements de uma
  transação correm numa conexão só; dispará-los concorrentes os enfileiraria na
  mesma conexão. `IMPORT_CONEXOES_DE_ESCRITA` existe para a captura, fora de
  transação, e está documentado onde mora.
- **Os índices ficam como estão.** Os caminhos quentes da importação —
  `entity_identifier` por (tipo, valor, corrente), `raw_cell` pela linha,
  `raw_row` pela aba, `staged_fact` pelo run — já são servidos por índice. O que
  sobra de custo em `stage` é escrita de índice, não busca: reduzi-la seria
  apagar índice que outra tela usa.
- **A semeadura da taxonomia (46 idas, fixas) fica.** É uma árvore inserida em
  profundidade, onde o id do pai é entrada do filho; achatá-la em lote é um
  refatoramento de risco desproporcional a 46 statements que não crescem com o
  arquivo.

## 4. O que já existia e continua de pé

Nada disto precisou ser construído — vale registrar para quem for medir de novo:
a leitura já roda fora do ciclo da requisição (`readInBackground`), o mesmo
arquivo já é recusado por `sha256` antes de ser aberto, a barra já publica por
passo e por tempo em vez de por linha, o cancelamento já é lido de graça na
mesma escrita da barra, os apontamentos já são por linha sem derrubar a
importação, e uma leitura interrompida já é retomável (`recuperacao.ts`,
`reprocessImportRun`).

## 5. Como refazer estes números

```
pnpm --filter @workspace/ingest exec tsx src/cli/perfil-de-importacao.ts \
  --linhas 51600 --repeticoes 1 --rtt 0
```

O perfil agora mede as **cinco** etapas, `promote` inclusive — enquanto ele ia
só até o `preview`, o trecho onde a importação passava 97% do tempo ficava fora
do número. `--rtt 25` transforma a contagem de idas ao banco na grandeza que ela
é num banco de rede, que é onde o gargalo nº 2 cobrava caro.

O que a forma da aprovação afirma está travado por teste, e não por medição:
`promocao-em-lote.test.ts` dobra o número de veículos novos e exige que o número
de statements fique onde estava.
