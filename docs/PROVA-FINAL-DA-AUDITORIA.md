# Prova final consolidada — ingestão e propagação

> **O que este documento é.** A resposta às sete perguntas que encerram a
> auditoria, cada uma com o teste ou a medição ao lado. Não é o resumo dos
> vinte PRs — isso está em `LEDGER-DA-AUDITORIA.md` —, e não é "todos os testes
> passaram". É a tentativa de responder, de forma verificável, o que o produto
> agora garante e o que ele continua não garantindo.
>
> **A forma de cada resposta.** Três partes, sempre: a **resposta**, a **prova**
> (arquivo de teste, com a contagem medida) e o **limite da prova** — o que
> aquela evidência não cobre. A terceira parte não é modéstia: uma prova sem
> limite declarado é uma prova que alguém vai citar em situação onde ela não
> vale.
>
> **Objetivo original.** *"Depois disto tem de ser impossível um módulo dizer
> 'não há dados' simplesmente porque interpretou disponibilidade de maneira
> diferente dos outros módulos."* As sete perguntas existem para verificar se
> isso foi alcançado, e não para declarar que foi.

Medições desta página feitas em 17/08/2026, sobre `cbf859d`..`0022`, com Postgres 16
local e a suíte inteira verde: **1.441 testes em 103 arquivos**, mais os 209
do `assistant` (com 119 que se auto-pulam por falta de chave de API do modelo).

Esta página é conferida por `artifacts/api-server/src/__tests__/prova-final.test.ts`
(6 testes): os testes citados aqui existem, as listas de tabelas são as que a
autoridade protege, os estados do vazio são os que `vazio.ts` declara, as
contagens são as que a matriz exercita. A guarda não confere a prosa — isso é
revisão humana, e está dito dentro dela.

---

## 1. Quais são todas as portas de entrada?

**Resposta.** Três entradas, e duas delas são portas de dado operacional.

| Entrada | Endereço | Dono no código | O que ela cria |
|---|---|---|---|
| **Porta 1 — Importações** | `POST /imports`, `POST /imports/:id/promote` | `artifacts/api-server/src/routes/imports.ts` → `lib/ingest` | fato, vigência, entidade, escopo — o núcleo canônico |
| **Porta 2 — Alterações · Chamados** | `POST /ticket-imports` | `artifacts/api-server/src/routes/tickets.ts` → `lib/ingest` | `ticket_change` e anexos de chamado |
| **Book do operador** *(não é porta de dado operacional)* | `book_entry` | `artifacts/api-server/src/routes/book.ts` | documento: contrato, manual, planilha de apoio |

A regra do produto não é "duas portas e ponto" — é mais precisa, e é a precisão
que a torna sustentável:

> Dado que vira número entra por duas portas — Importações e Chamados. Regra que
> sustenta número entra pelo Book. Nenhum documento do Book escreve fato
> canônico, e nenhum número do produto sai dele.

O Book fica, e foi decisão declarada (16/08/2026, `AUDITORIA-INGESTAO-PROPAGACAO.md`,
Parte 1.3). A semelhança superficial com uma porta — também recebe arquivo em
base64 — é justamente o que faz alguém fechá-lo por engano ao fechar as outras.

**Prova.** `artifacts/api-server/src/routes/__tests__/fronteira-de-ingestao.test.ts`
(**21 testes**) e `fronteira-do-book.test.ts` (**12 testes**). O segundo tranca a
regra do Book **nas duas direções**: que ninguém o feche achando que é porta
indevida, e que ninguém ligue `book_entry` a uma soma porque "o número está no
contrato".

**Limite da prova.** As três entradas são as que existem no repositório em
17/08/2026. Nada aqui prova que um dado não chegue ao banco por fora da
aplicação — um `psql` na mão, um restore, um ETL de terceiro. A defesa contra
isso é a identidade canônica do Postgres (pergunta 3), que recusa a linha
malformada venha ela de onde vier, e não esta varredura.

---

## 2. Existe alguma terceira porta escondida?

**Resposta.** **Existia.** A auditoria encontrou uma viva no repositório:
`routes/overview.ts` reimplementava `POST /imports` e `POST /imports/:id/promote`
inteiros, e o que a mantinha inalcançável era **uma linha de ordem** em
`routes/index.ts`. Uma regra que depende da ordem de montagem de um arquivo não
é uma regra: é uma coincidência que ainda não foi desfeita. Foi removida no PR-1
(`b51175c`).

Hoje, por quatro medições independentes, **nenhuma outra é encontrada**.

| Altura | O que ela pega | Medição de hoje |
|---|---|---|
| **1. A rota** | a porta com o **mesmo** endereço, alcançável por reordenação | nenhum par (método, caminho) registrado 2× em mais de 50 rotas |
| **2. A superfície** | a porta com **outro** endereço — `POST /upload`, `POST /v2/imports` | só `imports.ts` alcança o pipeline de vigência; só `tickets.ts` o de chamados |
| **3. A tabela** | o que não passa por rota nenhuma: um job, um script, um `INSERT` dentro de um módulo de leitura | varredura de todo `src/` de `lib/`, `artifacts/` e `scripts/`: **4 arquivos** autorizados a escrever no núcleo canônico, **7** no dicionário |
| **4. A prisão** | a escrita montada em tempo de execução, que varredura textual não segue | `lib/db/src/autoridade.ts`, conferindo o **statement** no driver do pg |

As três primeiras são rede; a quarta é prisão. Elas convivem de propósito: a
autoridade recusa em runtime, o que só aparece quando alguém executa o caminho;
a varredura recusa no CI, antes de existir execução, e **nomeia o arquivo** — que
é o que transforma "algo quebrou em produção" em "esta linha não pode existir".

**Prova.** `fronteira-de-ingestao.test.ts` (**21**), `lib/db/src/__tests__/autoridade.test.ts`
(**17**), `lib/ingest/src/__tests__/autoridade-do-pipeline.test.ts` (**3** — o
pipeline real roda por conexão sem concessão nenhuma).

Cada altura vem com **caso de controle**, porque uma asserção de ausência que não
sabe encontrar presença não prova nada. Foi o controle que revelou que
`pipeline.ts` — o escritor mais importante do sistema — **não estava sendo visto**
pelas duas primeiras formas de escrita procuradas: ele insere fato por um helper
genérico e por SQL com o símbolo interpolado. A varredura passou a reconhecer
quatro formas por causa disso.

**Limite da prova.** A altura 3 é varredura **textual**, não análise de AST: ela
não seguiria uma escrita passada por três camadas de indireção. Quem fecha essa
diferença é a autoridade em runtime — e ela, por sua vez, **não protege migration
nem DDL**, por decisão declarada: uma migration é a autoridade que muda a *forma*
do canônico, e submetê-la à autoridade que protege o *conteúdo* inverteria a
hierarquia. O que protege as migrations é serem versionadas e revisadas.

---

## 3. Qual é a autoridade canônica?

**Resposta.** Não é uma — são três, com donos diferentes, e confundi-las foi
parte do problema original.

### 3.1 A identidade: o Postgres

```
canonical_snapshot_key = freightcheck_snapshot_key(
    source_system, dataset_family, canal, effective_date, canonical_scope)
```

Coluna **gerada**, com índice único `snapshot_canonical_live_uq` sobre a vigência
viva. O escopo é normalizado por `freightcheck_canonical_scope` e serializado por
`freightcheck_serialize_scope`; o canal, por `freightcheck_norm_canal`. Migrations
`0015_canonical_identity.sql` e `0016_canonical_identity_enforcement.sql`.

Isto é o que faz a identidade não depender de nenhum código de aplicação estar
correto. É também o que fundiu as vigências historicamente duplicadas —
`EMPURRADA_1_8_2026` e `EMPURRADA_01_8_2026`, o mesmo dado com o rótulo escrito
de dois jeitos — registrando cada fusão em `snapshot_merge`.

**Prova.** `lib/db/src/__tests__/canonical-identity-migration.test.ts` (**20**),
`lib/ingest/src/__tests__/canonical-identity-sql.test.ts`,
`identidade-por-conteudo.test.ts`.

### 3.2 A escrita: `lib/db/src/autoridade.ts`

Três autoridades, conferidas no choke point do driver: `INGESTAO` (as duas
portas — a única sobre o núcleo canônico), `CURADORIA` (dicionário e
classificação) e `FIXTURE_DE_TESTE` (concedida pela *conexão*, só por
`createTestDatabase`, e não por variável de ambiente — amarrá-la a `NODE_ENV`
teria deixado a porta aberta para qualquer processo que exportasse a variável
errada).

A separação é do domínio, e não de conveniência: a importação **descobre** que
existe uma coluna nova; a curadoria decide **o que ela significa**. Um fato não
tem esse segundo dono — ninguém "decide" um fato depois que ele foi lido —, e é
por isso que a curadoria nunca alcança o núcleo.

**Núcleo canônico (9 tabelas):** `fact`, `snapshot`, `snapshot_scope`,
`snapshot_attribute`, `snapshot_entity_type`, `snapshot_merge`, `entity`,
`entity_identifier`, `scope`.
**Dicionário (3):** `attribute`, `attribute_alias`, `taxonomy_node`.

### 3.3 A disponibilidade, o escopo e a série: `@workspace/availability`

| Pergunta | Quem responde |
|---|---|
| esta vigência está disponível? | `filtroDeVigenciaDisponivel` — `status = 'CLOSED'`, afirmação e não exclusão |
| qual é o escopo desta vigência? | `chaveDeEscopoSql` — sha256 do escopo **canônico**, não `scope_hash` |
| qual é o contexto? | `chaveDeContextoSql` / `filtroDeContexto` |
| qual é a série? | `chaveDeSerieSql` / `filtroDeSerie` |
| que equipamentos existem? | `equipamentosDisponiveis` |
| qual é a vigência anterior a esta? | `vigenciaAnterior` |

**Medição de adoção, hoje:** **67** chamadas de `filtroDeVigenciaDisponivel` em
código de produção; **44** de `contextFilter`; **18** de `chaveDeSerieSql` /
`filtroDeSerie`. A auditoria contou o predicado `status <> 'SUPERSEDED'` copiado
à mão em **46** lugares de leitura, e mediu o custo da cópia: `getOverview`
esquecera-o em cinco contadores, e o Painel contava os fatos de revisões
substituídas. **Hoje sobram zero cópias em caminho de leitura** — as duas
ocorrências literais restantes são o predicado de um índice parcial no schema
(`lib/db/src/schema/canonical.ts:211`) e a ponte de deploy (`lib/db/src/bridge.ts:250`),
e as duas de `deletion.ts` são `= 'SUPERSEDED'`, escrita que restaura revisão,
não leitura.

**Prova.** `lib/availability/src/__tests__/fronteira-da-disponibilidade.test.ts`
(**3** — a varredura que recusa a 47ª cópia, nomeando arquivo e linha),
`disponibilidade.test.ts` (**20**), `export-real.test.ts` (**9**, medidos contra o
export real).

**Limite da prova.** Aqui **não há prisão em runtime**, e é uma diferença que
importa. Um predicado ausente não é um erro que dê para recusar: é um `WHERE` que
traz linhas a mais, e ninguém percebe, porque o número continua aparecendo — só
está errado. A defesa é a varredura no CI, e ela reconhece a comparação por
exclusão em quatro grafias; **não** procura `= 'CLOSED'` escrito à mão, porque
alargar o padrão a esse ponto traria os índices parciais do schema junto. Uma
segunda definição escrita na forma afirmativa passaria.

---

## 4. Quais módulos consomem cada tipo de dado?

**Resposta.** Vinte e três leituras, medidas pela matriz de propagação — não
declaradas, **exercitadas**: um arquivo real entra pela porta, e cada módulo é
perguntado sobre o que enxerga.

### Porta 1 — Importações: 16 consumidores

| Módulo | Elo | Veredito |
|---|---|---|
| Vigências | `listComparableSnapshots` | RECEBEU |
| Seletor de contexto | `listContexts` | RECEBEU |
| Cobertura | `vigenciasObservadas` | RECEBEU |
| Cobertura · matriz | `visaoDaCobertura` | RECEBEU |
| Painel | `getOverview` | RECEBEU |
| Alterações · anterior | `findPreviousSnapshot` | RECEBEU |
| Alterações · planilha | `getGroupedView` | RECEBEU |
| Alterações · comparação | `computeChangeSet` | RECEBEU |
| Alterações · panorama | `getPanoramaDeAlteracoes` | RECEBEU |
| Parâmetros | `getFamiliesView` | RECEBEU |
| Impacto | `getQuinzenaMatrix` | RECEBEU |
| Composição | `montarComposicao` | RECEBEU |
| DRE · Cavalo | `getDREDaFrota(CAVALO)` | RECEBEU |
| DRE · Carreta | `getDREDaFrota(CARRETA)` | RECEBEU |
| Chamados | `listTicketChanges` | **NAO_APLICAVEL** — *"chamado é dado da porta 2; uma vigência importada não abre chamado"* |
| Book do operador | `book_entry` | **NAO_APLICAVEL** — *"domínio documental separado, que não lê nem escreve o canônico operacional"* |

### Porta 2 — Alterações · Chamados: 7 consumidores

| Módulo | Elo | Veredito |
|---|---|---|
| Chamados · lista | `listTicketChanges` | RECEBEU |
| Chamados · totais | `getTicketTotals` | RECEBEU |
| Chamados · o antes | `valoresVigentes` (via `readTicketImport`) | RECEBEU |
| Cobertura | `vigenciasObservadas` | **NAO_APLICAVEL** — chamado não entra no denominador |
| Impacto | `getQuinzenaMatrix` | **NAO_APLICAVEL** — a matriz é por vigência; o chamado tem a própria aba |
| Alterações · comparação | `change` | **NAO_APLICAVEL** — *e verificado*: se um chamado virasse `change`, seria alteração de vigência inventada, e o teste conta |
| DRE · Cavalo | `getDREDaFrota(CAVALO)` | **NAO_APLICAVEL** — a DRE apura a vigência; chamado é pedido de mudança |

**Zero `AUSENTE_COM_CAUSA` nas duas portas** — asserção, não observação. E nenhum
`NAO_APLICAVEL` sem justificativa escrita: a frase é obrigatória, e é ela que
impede "não se aplica" de virar o novo "sem dados".

**Prova.** `artifacts/api-server/src/routes/__tests__/matriz-de-propagacao.test.ts`
(**8**).

**Limite da prova.** A matriz exercita **um** arquivo por porta — sintético, mas
pelo pipeline real, com a mesma promoção da produção. Ela prova que a corrente
conduz; não prova que toda forma de arquivo real chegue igual. Um arquivo com
aba desconhecida, coluna nova ou vigência fora de ordem percorre os mesmos elos,
e é isso que ela garante — não que o conteúdo dele seja interpretado como se
espera.

---

## 5. Como contexto, unidade, canal, vigência e série são resolvidos?

**Resposta.** Cada um por **uma** autoridade, e nenhum por consumidor.

| Conceito | Resolvido por | O que ele deliberadamente **não** é |
|---|---|---|
| **Unidade / escopo** | `canonical_scope` → `freightcheck_serialize_scope` → sha256 (`chaveDeEscopoSql`) | não é `scope_hash`, que era hash dos códigos **como vieram** e partia a mesma unidade em duas quando o CNPJ chegava mascarado. A coluna **não existe mais** (`0022`) |
| **Canal** | a coluna `snapshot.canal`, normalizada por `freightcheck_norm_canal` | não é derivado do rótulo do arquivo (divergência **D2**, corrigida no PR-6) |
| **Contexto** | o par (chave de escopo, canal), resolvido **uma vez por leitura** por `resolveContext`; o predicado é `contextFilter` | não é `scope_hash` sozinho (divergência **D1**, PR-7); não aceita mais a grafia antiga ao lado da canônica (`0022`); não é traduzido em cada consulta, que é como uma tradução viraria oito |
| **Vigência** | `effective_date`, que é a **ordem dentro da série** e não a identidade dela; disponível = `status = 'CLOSED'` | não é o rótulo escrito no arquivo |
| **Série** | `chaveDeSerieSql` = sha256(`source_system` ⟂ `dataset_family` ⟂ canal ⟂ escopo canônico) — a identidade canônica **sem a data** | não inclui `entity_type_set` (cresce com entrega parcial — **D3**, PR-9), nem `scope_hash`, nem `source_label` |
| **Vigência anterior** | `vigenciaAnterior`, na autoridade; `findPreviousSnapshot` delega | não é "a de data menor" decidida por quem compara (PR-8) |

**O comportamento na ausência de pedido é declarado, não implícito.**
`resolveContext` sem pedido devolve o mais recente — **e a resposta diz qual
escolheu e quais outros existem**, para que escolher por padrão nunca seja
escolher em silêncio. Pedido que não existe vira `ContextNotFoundError`, que a
rota traduz em 404: uma lista vazia seria a mentira mais fácil de acreditar.

**A interface tem um seletor, e não quatro.** Havia três definições rivais de
contexto na tela — `ContextBar` escrita e montada em lugar nenhum, o dropdown de
Início e a barra de filtro de Parâmetros —, e só Início sabia que trocar de
unidade apaga a vigência herdada. A regra virou função pura (`aplicarContexto`,
`enderecoComContexto`), a barra virou uma só, e uma varredura recusa a quarta.

**Medição:** `seriesKey` — a quinta definição de série, montada em memória e que
esquecia `dataset_family` — foi **apagada**: zero referências no repositório.

**Prova.** `lib/comparison/src/__tests__/series-context.test.ts`,
`propagacao-divergencias.test.ts` (**13** — as três divergências com `it.fails`
invertido), `propagacao-vigencia.test.ts` (**13**),
`artifacts/freightaudit/src/lib/__tests__/contexto.test.ts` (**8**),
`components/contexto/__tests__/fronteira-do-contexto.test.ts` (**4**),
`lib/coverage/src/__tests__/cenarios.test.ts` (**26**).

**A dívida do `scope_hash` está encerrada.** Entre o PR-7 e a `0022`,
`resolveContext` aceitou a grafia antiga ao lado da canônica — compatibilidade
de mão única para links colados. Enquanto ela existiu, "qual é o escopo desta
vigência?" teve **duas respostas certas**, que é a forma exata do defeito que
esta auditoria desfez em toda parte menos aqui.

A `0022` fechou os três lados: traduziu o recorte que as conversas do assistente
guardavam em banco, tirou a aceitação de `resolveContext` e **derrubou a coluna**
`snapshot.scope_hash`. Não sobrou coluna morta nem compatibilidade permanente: o
endereço antigo agora recebe `ContextNotFoundError`, que nomeia os contextos que
existem e que a rota traduz em 404 — recusa escrita, e não tela vazia.

A prova é `lib/db/src/__tests__/fronteira-da-identidade-de-escopo.test.ts`
(**9**), em três alturas: a coluna não existe no schema, **nenhuma função
instalada a cita** e nenhum código de produção volta a usá-la. Os testes
sintéticos deixaram de reproduzir o conceito eliminado — o fixture nascia de uma
semente que virava chave, e agora nasce de uma unidade cujo CNPJ o banco
normaliza, como na produção.

**Limite da prova.** A altura 3 é varredura de fonte e reconhece o texto
`scope_hash`; uma segunda definição de identidade escrita com outro nome
passaria. Quem cobre isso é a altura 2, que pergunta ao banco — mas só sobre
esta coluna, e não sobre a ideia.

---

## 6. Como distinguimos ZERO, AUSENTE, NÃO APLICÁVEL e dado sem comparação?

**Resposta.** Por um vocabulário compartilhado — `lib/availability/src/vazio.ts`
— e por uma regra de ouro presa por asserção.

**ZERO não é um vazio.** É `comValor(0)`: um número medido, que passou por todos
os elos e deu zero. Ele nunca entra nesta máquina de estados, e a confusão entre
os dois é a origem de metade do problema — *"ausência não pode virar zero apenas
para facilitar cálculo"*.

Os quatro vazios, na ordem em que se pergunta:

```
  existe?       ──não──▶  NAO_EXISTE       "nenhum dado importado"
     │ sim
  se aplica?    ──não──▶  NAO_SE_APLICA    "não se aplica, e por quê"
     │ sim
  é calculável? ──não──▶  NAO_CALCULAVEL   "existe, e falta isto"
     │ sim
  tem linha?    ──não──▶  FORA_DO_RECORTE  "existe, e não neste recorte"
     │ sim
  o número
```

> **A regra de ouro: um módulo só pode dizer "não há dados" quando `NAO_EXISTE`.**

`NAO_SE_APLICA` e `NAO_CALCULAVEL` jamais são traduzidos como ausência de dado. O
dado está lá nos dois casos — o que falta é pertinência num, e informação no
outro. E **só a autoridade responde `NAO_EXISTE`**: um módulo que inventasse o
próprio "não existe" estaria de novo com opinião própria sobre o censo.

**"Dado sem comparação"** é `NAO_CALCULAVEL` com o campo `oQueFalta` preenchido —
e na Análise de frota tem forma tipada: `manutencaoCavalos: number | null` com
`naoCalculavel: Record<string, string>` ao lado, em vez de dividir por 12 um
valor cuja periodicidade nunca foi confirmada.

**O que isso corrigiu, medido.** `getQuinzenaMatrix` devolvia `null` nas quatro
situações, e a rota traduzia todas em `404 "Nenhuma vigência importada ainda."` —
a forma mais convincente de mentir que uma tela tem, porque é verdadeira num dos
quatro casos. E Composição e DRE não mostravam **frase nenhuma** para um terceiro
equipamento: as abas estavam escritas à mão, e `/composition/equipment-types` e
`/dre/plano` não eram chamados por tela alguma. Não havia sequer a frase errada
para corrigir — havia o silêncio.

**Prova.** `vazio-do-impacto.test.ts` (**5** — as quatro causas nomeadas, e a
regra de ouro por asserção: com a frase única reinstalada, três casos falham),
`terceiro-equipamento.test.ts` (**6**), `fleet-analysis-contrato.test.ts` (**18**),
`lib/dre/src/__tests__/ausencia.test.ts`.

**Limite da prova.** O vocabulário existe e é usado nos pontos que os PRs 18 e 19
migraram — Impacto, Composição, DRE, Análise de frota. **Não há varredura que
obrigue um módulo novo a usá-lo**: nada impede alguém de escrever `return null` e
deixar a rota inventar um 404. A regra de ouro está presa dentro de `vazio.ts`,
para quem já o usa; ela não alcança quem não o importa.

---

## 7. Se um dado não aparecer na DRE Cavalo, qual teste ou diagnóstico mostra onde a propagação parou?

**Resposta.** `ondeAPropagacaoParou(db, "CAVALO", contexto)`, em
`matriz-de-propagacao.test.ts`. Ele percorre a corrente na ordem, mede cada elo e
**para no primeiro que não fecha, nomeando-o**. Cada elo pergunta ao dono dele —
ingestão, autoridade de disponibilidade, curadoria, DRE — e o valor está em
juntá-los numa resposta só.

| # | Elo | O que ele mede | A frase quando ele quebra |
|---|---|---|---|
| 1 | `ARQUIVO_RECEBIDO` | `import_run` promovidos | "Nenhum arquivo foi promovido. A propagação parou antes de começar." |
| 2 | `PROMOVIDO` | vigências disponíveis | "Há arquivo promovido e nenhuma vigência disponível — a promoção não fechou snapshot." |
| 3 | `EQUIPAMENTO_NO_CANONICO` | vigências que entregaram CAVALO | "Nenhuma vigência entregou CAVALO. Falta importar o arquivo desse equipamento — não é defeito de leitura." |
| 4 | `EQUIPAMENTO_NO_RECORTE` | cavalos **na vigência que a DRE apura**, no contexto pedido | "Existe CAVALO no canônico, e nenhum no contexto pedido (escopo …, canal …). O dado está noutra unidade ou noutro canal." |
| 5 | `SEMANTICA_CONFIRMADA` | parâmetros monetários confirmados | "Há CAVALO com fato e nenhum parâmetro monetário confirmado. A DRE se recusa a somar o que não sabe medir — é o comportamento certo, e a saída é a curadoria." |
| 6 | `APURADO` | veículos no ranking | "Todos os elos anteriores fecham e a DRE não apurou. Isto é defeito do motor, e não falta de dado." |

Antes disto, a tela dizia a mesma coisa para cinco causas diferentes, e descobrir
qual era levava horas de leitura de código.

**Os quatro cenários exercitados.** Corrente inteira (nenhum elo apontado);
nenhum arquivo (para no 1); carreta importada e cavalo não (para no 3, nomeando o
equipamento); cavalo importado e semântica não confirmada (para no 5, apontando a
curadoria).

**Uma asserção que o diagnóstico ganhou por ter errado.** A primeira versão do
elo 4 contava o equipamento em **todas** as vigências, e o número não batia com o
do elo 6: 64 cavalos contra 62 no ranking. Não era defeito do produto — dois
cavalos saíram da frota antes da última vigência —, era defeito do diagnóstico.
Um elo que mede coisa diferente do elo seguinte não sabe dizer onde a corrente
parou: ele **inventa** uma diferença e obriga quem lê a investigá-la. Hoje há
asserção de que os dois falam do mesmo conjunto.

**Prova.** `matriz-de-propagacao.test.ts` (**8**), quatro dos quais são os
cenários acima.

**Limite da prova.** O diagnóstico responde por CAVALO e CARRETA na DRE. Ele
**não** é uma ferramenta exposta na aplicação — vive no teste, e rodá-lo contra o
banco de produção exige executá-lo à mão. Transformá-lo em endpoint de
diagnóstico seria o passo natural seguinte, e não foi feito nesta sequência.

---

## O que esta auditoria continua não garantindo

Registrado aqui porque uma prova final que só lista vitórias é a peça mais fácil
de citar fora de contexto.

1. **Varredura de fonte não vê PL/pgSQL, e isso já custou.** O levantamento que
   precedeu a `0022` leu TypeScript e concluiu que `snapshot.scope_hash` tinha um
   leitor. Duas funções do próprio banco a citavam, e `DROP COLUMN ... RESTRICT`
   não avisa — o Postgres não rastreia dependência de coluna dentro de corpo de
   função. O erro só apareceria em runtime, no gatilho que roda em toda promoção.
   A `fronteira-da-identidade-de-escopo` passou a perguntar ao `pg_proc` por
   causa disso, **para esta coluna**. Nenhuma outra varredura deste repositório
   olha corpo de função.
2. **Não há varredura que obrigue um módulo novo a usar o vocabulário do vazio.**
   Um `return null` novo continua possível.
3. **A varredura de escrita é textual.** A prisão em runtime cobre a diferença,
   mas só quando o caminho executa.
4. **A varredura de disponibilidade não pega a forma afirmativa escrita à mão.**
   `= 'CLOSED'` copiado num `WHERE` passaria.
5. **`ausencias` da Análise de frota está armado e não exercitado pelo dado
   real** (PR-15, §4.4 do ADR): o export real não produziu nenhuma ausência, de
   modo que o campo existe, tem teste sintético e nunca foi visto em produção.
6. **Os 119 testes pulados do `assistant`** são `evals`, `fase1` e os dois de
   benchmark, que dependem de chave de API do modelo e se auto-pulam sem ela.
   Não são regressão desta sequência, e também não são cobertura.
7. **A matriz exercita um arquivo sintético por porta**, pelo pipeline real. Ela
   prova que a corrente conduz, não que toda forma de arquivo real seja
   interpretada como se espera.

O risco operacional residual é **baixo** — não é nulo, e não há nesta página
nenhuma afirmação de que seja.

---

## Como reproduzir

```bash
# Postgres 16 local, socket em /tmp/pgsock:5433
pnpm run typecheck

# A suíte inteira, um pacote por vez (o paralelo colide no mesmo Postgres)
for p in @workspace/db @workspace/availability @workspace/ingest @workspace/curation \
         @workspace/comparison @workspace/composition @workspace/coverage \
         @workspace/dre @workspace/balance api-server freightaudit; do
  pnpm -F "$p" test
done

# Só as provas de arquitetura desta página
pnpm -F api-server        test -- --fileParallelism=false \
  src/routes/__tests__/fronteira-de-ingestao.test.ts \
  src/routes/__tests__/fronteira-do-book.test.ts \
  src/routes/__tests__/matriz-de-propagacao.test.ts \
  src/routes/__tests__/vazio-do-impacto.test.ts \
  src/routes/__tests__/terceiro-equipamento.test.ts
pnpm -F @workspace/db           test -- src/__tests__/autoridade.test.ts
pnpm -F @workspace/availability test -- src/__tests__/fronteira-da-disponibilidade.test.ts
```

O diagnóstico do elo que parou imprime a corrente inteira no `stdout` do teste:

```
DIAGNÓSTICO · DRE Cavalo
  ✓ ARQUIVO_RECEBIDO           N run(s) promovido(s)
  ✓ PROMOVIDO                  N vigência(s) disponível(is)
  ✓ EQUIPAMENTO_NO_CANONICO    N vigência(s) com CAVALO
  ✓ EQUIPAMENTO_NO_RECORTE     N CAVALO(s) na vigência apurada
  ✓ SEMANTICA_CONFIRMADA       N de M parâmetro(s) monetário(s) confirmado(s)
  ✓ APURADO                    N veículo(s) no ranking
  → A corrente está inteira: a DRE CAVALO apurou.
```
