# Proposta — O Assistente como agente Claude

> Auditoria e desenho. Nenhum código do produto foi alterado.

O assistente não usa o Claude como cérebro. Ele decide tudo em código, fecha um
dossiê, e usa o modelo — quando usa — como redator do que já foi decidido. Este
documento mede isso, diz onde exatamente está a trava, e propõe a menor
arquitetura que dá ao Claude autonomia de investigação sem perder a
auditabilidade do número.

---

## 0. O achado que resolve o print

Antes de qualquer discussão de arquitetura: as respostas do relato não são
"respostas ruins de um modelo". Elas são a **redação determinística**, montada
em código. Rastreei cada trecho até o arquivo que o escreve, e não sobrou
nenhuma frase de autoria do modelo — nem parcial.

| Trecho que apareceu na tela | Quem escreveu |
| --- | --- |
| "Alterações são aplicadas para a vigência atual da tratativa do chamado", "Responsável pela atualização: Transportadora", "Fluxograma de atualização do processo" | Transcrição crua de 2 trechos do Book — `resposta.ts:364-373`, teto de 1.000 caracteres |
| "Dá para ver o que mudou, mas não quanto isso vale em dinheiro… seria chute. A confirmação é feita na tela de Curadoria" | Lacuna `DADO_SEM_PRECO`, string fixa — `orquestrador.ts:1350-1354` |
| "alterações: 244 (0% do que mudou tem impacto calculável (0 de 244)); veículos afetados: 62 (…); impacto apurado: não apurável…" | Loop de fatos unidos por `join("; ")` — `resposta.ts:419-423` + `formato.ts:60` |
| "ativos distintos — o mesmo caminhão não conta duas vezes" | Campo `detalhe` fixo — `ferramentas.ts:327` |
| "a primeira mede a agitação do caminho, a segunda o saldo entre as pontas" | Campo `nota` fixo — `ferramentas.ts:677` |

O formato `rótulo: valor (detalhe); rótulo: valor … [4].` é literalmente o
`join("; ")` de `resposta.ts:420`.

### Três causas, três ações opostas

O produto cai na redação determinística em três situações que a tela mostra
igual. `tecnico.ia.desfecho` já distingue as três, e é a primeira coisa a olhar:

- **`SEM_CHAVE`** — não há `ANTHROPIC_API_KEY` no processo. Confira
  `GET /api/assistant/capabilities`. É configuração, não código.
- **`DESCARTADA`** — o modelo escreveu e a trava de lastro descartou (mais de um
  terço das frases com número sem evidência). Sintoma de dossiê pobre.
- **`ERRO` / `RECUSA`** — a chamada falhou, ou o classificador recusou.

Isso se diagnostica em minutos com `scripts/diagnostico-assistente.mjs`. Mas
resolvê-lo **não conserta a resposta**, e é aí que começa o problema de
arquitetura.

### Mesmo com a chave ligada, "liste as alterações" não teria resposta

A pergunta cai na necessidade `MOVIMENTO`, que dispara uma consulta:
`resumoDaVigencia`, que devolve três agregados (244 · 62 · não apurável). A
lista das 244 alterações existe no banco e alimenta a tela de Alterações via
`getGroupedView` — mas **nenhuma ferramenta a entrega ao modelo, e o modelo não
pode pedir**. Ele está proibido de inventar e não tem como consultar. A única
saída honesta dele é repetir o agregado. Foi o que aconteceu.

---

## 1. Auditoria — o caminho da pergunta

Sete etapas entre o que se digita e o que se lê. O modelo entra na sexta, quando
todas as decisões já foram tomadas.

```
Pergunta → interpretar → planejar → consultar → DOSSIÊ FECHADO → Claude → trava → Resposta
             23 int.     18 detec.  20 consultas                   redige
                                                                      ↑
                                                        entra aqui, sem poder pedir nada
```

| Etapa | Onde | O que faz |
| --- | --- | --- |
| 1. Rota | `routes/assistant.ts` | 8 endpoints. `POST /assistant/ask` é genérico (pergunta, `conversationId`, recorte, SSE). **Nenhum endpoint foi criado para pergunta específica.** |
| 2. Interpretar | `interpretacao.ts` | Classifica a frase em 1 de **23 intenções** por regex. Determinístico por decisão de projeto documentada no cabeçalho do arquivo. |
| 3. Herança | `conversa.ts` | `EstadoDaConversa`: assunto, período, intervalo, bloco do Book, recorte. Resolve "e julho?" em código, sem modelo. |
| 4. Planejar | `plano.ts` | **18 detectores regex** viram um conjunto de necessidades; a lista `ORDEM` decide qual nomeia a resposta. É aqui que mora a decisão que deveria ser do Claude. |
| 5. Consultar | `ferramentas.ts`, `governanca.ts`, `indice-book.ts` | **20 funções** de consulta, disparadas por um `switch` sobre as necessidades. Rodam em paralelo, colhidas em ordem fixa (numeração das citações). |
| 6. Redigir | `llm.ts` | Uma chamada. `claude-opus-5`, esforço `medium`, teto 16k, streaming. System prompt de **211 linhas** com cache. Histórico: 8 turnos × 3.000 caracteres. **Zero ferramentas.** |
| 7. Travar | `resposta.ts` + `orquestrador.ts` | Confere cada número do texto contra os do dossiê. Poda frase a frase; acima de ⅓ podado, descarta tudo e usa `redacaoDeterministica`. |

### O que o Claude recebe

Um bloco de texto com quatro seções — CONCEITO, BOOK DO OPERADOR, EVIDÊNCIA,
LACUNAS — montado por `emTexto()`. Cada item numerado para citação. Fatos
marcados como `interno` são filtrados antes. Anexos PDF/imagem vão como blocos
nativos.

É um bom pacote. O problema não é a qualidade do dossiê: é que ele é **fechado
antes de o modelo ver a pergunta**, e o modelo não tem como dizer "isto não
responde, me dá as linhas".

### Recuperação de documentos

`indice-book.ts` — busca léxica sobre índice em memória, pontuação explicável,
dois limiares: `0,35` para exibir e `0,525` para deixar a regra *definir* a
pergunta. Sem embeddings, por decisão registrada.

Foi esse caminho que trouxe o texto sobre "tratativa do chamado" para uma
pergunta sobre alterações de vigência: casamento léxico na palavra *alterações*,
que no documento significa outra coisa. Semelhança acha; ela não conclui — e não
há ninguém depois dela para julgar se aquilo responde.

---

## 2. Diagnóstico — as sete perguntas

### 2.1 O assistente já funciona como um agente Claude de verdade?

**Não.** Não existe tool use no repositório. Varredura de `lib/` e `artifacts/`
por `tools:`, `tool_use`, `tool_choice` e `input_schema`: zero ocorrências. Há
exatamente duas chamadas à Anthropic no produto — `llm.ts` (redigir a resposta)
e `formula.ts` (parafrasear uma fórmula) — e ambas são geração de texto de um
turno sobre contexto pré-montado.

### 2.2 Ou estamos usando o Claude como gerador de texto?

Exatamente isso, e o código diz com todas as letras. Primeira linha de `llm.ts`:
*"O modelo não é a fonte da resposta; ele é a redação dela."* Não é um desvio da
intenção original — é a intenção original, executada com rigor. O que mudou é o
que se quer do produto.

### 2.3 Quanto da inteligência está no código?

Praticamente toda.

| Decisão | Quem decide hoje | Deveria decidir |
| --- | --- | --- |
| O que a pergunta quer | código — 23 intenções, regex | Claude |
| Que dados consultar | código — 18 detectores → switch | Claude |
| Se a 1ª consulta bastou | ninguém — não há 2ª rodada | Claude |
| Qual documento responde | código — limiar 0,35 | Claude (código recupera candidatos) |
| O que "e nos cavalos?" quer dizer | código — `EstadoDaConversa` | Claude |
| Que ressalva declarar | código — 4 tipos de `Lacuna`, texto fixo | Claude, sobre metadado estruturado |
| Qual número é o impacto | código — motor de impacto | **código — permanece** |
| Se a semântica autoriza somar | código — portão `CONFIRMED` | **código — permanece** |
| Redigir o texto | Claude, quando há chave | Claude |

### 2.4 O que nos obriga a ensinar pergunta por pergunta

Quatro mecanismos, todos com o mesmo formato: uma lista fechada que precisa
crescer quando aparece uma pergunta nova.

1. **Os 18 detectores de `plano.ts`.** Pergunta que não casa nenhum recebe o
   "plano padrão" (investigar o recorte). Foi o que aconteceu com "liste as
   alterações": casou `MOVIMENTO` pela palavra *alterações*, e o verbo *liste*
   não significou nada.
2. **O enum `Intencao` com 23 valores** e os conjuntos `INTENCOES_COM_RECORTE`,
   `INTENCOES_COM_PARAMETRO`, `INTENCOES_QUE_HERDAM_ASSUNTO`. Uma capacidade
   nova exige tocar em quatro lugares.
3. **O `switch` de execução** no orquestrador: cada `case` amarra uma
   necessidade a um conjunto fixo de consultas com argumentos já escolhidos. Não
   existe caminho para uma combinação que o `case` não previu.
4. **≈94 expressões regulares** literais nos dez arquivos do núcleo — 24 em
   `interpretacao.ts`, 25 em `plano.ts`, 11 em `indice-book.ts`. Cada uma é uma
   pergunta que alguém precisou prever.

Dos exemplos levantados, os que mais expõem isso: *"esse aumento de combustível
é bom ou ruim para mim?"* (não existe detector de juízo econômico, nem metadado
de direção econômica), *"investigue por que esse número caiu"* (exige segunda
rodada de consulta) e *"quais informações ainda faltam para você concluir?"* (só
existiria se alguém escrevesse um detector para ela).

### 2.5 O que deve permanecer determinístico

É o ativo do produto e não se toca:

- cálculo de impacto por periodicidade, **nunca somado entre periodicidades**;
- o portão `CONFIRMED` — nada abaixo dele entra em agregação financeira;
- DRE, composição de remuneração, ponte de resultado, balanço de massa;
- o isolamento por recorte `(unidade, canal)`;
- a trava de lastro — com a origem dos números trocada (ver §3);
- comparação e agrupamento de alterações (`engine`, `grouped`, `cockpit`).

### 2.6 Quais capacidades deveriam virar ferramentas

Detalhado em §3.2. O resumo: quase tudo o que já existe, mais três coisas que o
assistente hoje **não alcança**:

- **as linhas de alteração** — `getGroupedView` dá os grupos com antes→depois; o
  assistente só vê o total;
- **os chamados** — `comparison/chamados.ts` tem 12 funções, nenhuma exposta;
- **a simulação** — `lib/simulation` faz conversão de periodicidade e
  contribuição por horizonte. É o que responderia "e se eu tirar FINAME?".

### 2.7 Existe duplicação entre código, prompt e semântica?

**Sim, em três eixos.**

- **Regra de negócio em dois lugares.** "Nunca somar periodicidades diferentes"
  está no motor (`simulation/periodicity.ts`), na regra nº 1 do prompt, e ainda
  no campo `detalhe` de `resumoDaVigencia`.
- **Ressalvas escritas três vezes.** As quatro `Lacuna` são parágrafos prontos
  em `orquestrador.ts`; o prompt manda o modelo reescrevê-las com as próprias
  palavras; a redação determinística as imprime literais.
- **Duas redações concorrentes.** `redacaoDeterministica` (134 linhas)
  reimplementa em código a decisão de o que abre a resposta e o que entra em
  lista. Era o piso de segurança e virou o teto de qualidade.

---

## 3. Arquitetura proposta

A menor mudança que dá autonomia de investigação com segurança: **inverter quem
chama quem**. As consultas já existem e não mudam — o que muda é que passam a
ter esquema, passam a ser chamadas pelo modelo, e podem ser chamadas de novo.

```
Chat UI
  → Assistant Orchestrator   (recorte · histórico · laço · trava)
      ⇄ Claude API           (decide o que consultar)
      ⇄ Tool Registry        (~9 ferramentas · Zod → JSON Schema)
          → FreightCheck services  (comparison · dre · composition · curation · …)
              → Banco canônico · Book · Documentos
```

### 3.1 O que muda de fato

- **O plano deixa de existir.** Nenhum detector, nenhuma `Intencao` como
  roteador. O modelo lê a pergunta e escolhe ferramentas.
- **O dossiê deixa de ser montado antes.** Passa a ser o acúmulo dos
  `tool_result` daquele turno — mesmo objeto, construído durante e não antes.
- **A trava de lastro sobrevive intacta, com outra entrada.** Hoje o conjunto de
  números autorizados vem de `dossie.evidencias`; passa a vir dos resultados de
  ferramenta do turno. Mesma função, outra lista.
- **O recorte continua no servidor.** Unidade e canal não são argumento livre do
  modelo — vêm da tela e são injetados em toda chamada de ferramenta. Preserva o
  isolamento sem depender de o modelo se comportar.
- **A herança em código encolhe.** O modelo vê o histórico e resolve "e nos
  cavalos?" sozinho. O `EstadoDaConversa` fica só com o recorte.

**Sem framework.** O laço de tool use são ~80 linhas: chamar, ver se veio
`tool_use`, executar, devolver `tool_result`, repetir até `end_turn` ou o teto de
rodadas. Não precisa de LangChain nem de orquestrador genérico. O
`@anthropic-ai/sdk` já está no `package.json`.

### 3.2 As ferramentas propostas

Nove, não vinte. O critério: cada uma é um **eixo de consulta** com parâmetros
que compõem — nunca uma pergunta. Onde hoje há três funções que diferem só no
filtro, há uma ferramenta com um argumento a mais.

| Ferramenta | Argumentos que compõem | Já existe em | Estado |
| --- | --- | --- | --- |
| `recortes` | — | `listContexts`, `listPeriods` | existe |
| `parametros` | busca · equipamento · família · status de semântica | `parametros.ts` + `attribute_semantics` | existe |
| `alteracoes` | **`nivel`: total │ grupos │ linhas** · vigência · parâmetro · equipamento · natureza · ordenar por (impacto, criticidade, veículos) · limite | `getGroupedView`, `buildCockpit`, `veiculosDoGrupo` | **só o total é exposto** |
| `serie` | atributo ou placa · janela de vigências | `serieDoParametro`, `getHistoricoDaDRE` | existe |
| `comparar` | vigência A · vigência B · filtro de parâmetros | `compararIntervalo`, `end-to-end` | existe |
| `resultado` | escopo (cavalo │ carreta │ conjunto) · placa · vigência · `explicar` | `getDREDaFrota`, `getPonteDaDRE`, `composicaoDaFrota` | existe |
| `documentos` | consulta · corpus · bloco · `inteiro` | `indice-book.ts`, `corpus.ts` | existe |
| `chamados` | parâmetro · classe · período · placa | `comparison/chamados.ts` — 12 funções prontas | **não exposto** |
| `estado_do_dado` | aspecto · parâmetro | `governanca.ts`, `lib/coverage`, `lib/balance` | existe |
| `simular` | atributos a incluir/excluir · horizonte · periodicidade alvo | `lib/simulation` — `contributionOverHorizon` | **não exposto** |

**O teste do `nivel`.** Uma única ferramenta `alteracoes` com
`nivel: "total" | "grupos" | "linhas"` responde "o que mudou?", "liste as
alterações", "o que mudou nos cavalos?", "o que mais impactou negativamente?" e
"existe alguma inconsistência nessa vigência?" — sem uma linha de código por
pergunta. É esse desenho que separa nove ferramentas de vinte.

### 3.3 A semântica precisa de um campo novo

Quase tudo já está no banco, versionado por vigência: `unit`, `periodicity`,
`aggregation`, `is_monetary`, `taxonomy_node_id`, `definition`,
`calculation_basis`, `semantics_status`, `semantics_rationale`, `display_name`,
aliases de origem. O `attribute_semantics` inclusive guarda o histórico do que a
coluna significava em cada janela — exatamente o que impede leitura anacrônica.

**O que falta é a direção econômica.** Nada no schema diz se subir é bom ou ruim
para a transportadora. Sem isso, "esse aumento de combustível é bom ou ruim para
mim?" só tem duas saídas: o modelo chuta a partir do conhecimento geral
(proibido), ou alguém escreve uma frase por variável no prompt (que é justamente
o que não se quer). A resposta certa é um campo:

- `economic_direction` — `HIGHER_IS_BETTER` │ `HIGHER_IS_WORSE` │ `NEUTRAL` │
  `DEPENDS_ON_FORMULA`, do ponto de vista da transportadora;
- `economic_effect` — uma frase curta do curador, do mesmo tipo do `definition`:
  *"mais km por litro reconhecido reduz o litro remunerado para a mesma
  distância"*.

Versionado junto com o resto, escrito na tela de Curadoria, devolvido pela
ferramenta `parametros`. Aí o Claude raciocina sobre o dado, e não sobre uma
instrução que alguém escreveu no prompt.

---

## 4. O que preservar, o que remover

### Preservar — é o ativo

- Motor de impacto e a regra de nunca somar periodicidades diferentes
- Portão de semântica `CONFIRMED` antes de qualquer agregação financeira
- DRE, composição, ponte de resultado, balanço, cobertura
- Isolamento por recorte, injetado no servidor
- Trava de lastro e citações numeradas — com origem trocada para os `tool_result`
- As 20 consultas de `ferramentas.ts` como **implementação** das ferramentas
- Observabilidade: `desfecho`, custo, latência, painel técnico
- Os quatro tipos de lacuna — como **metadado estruturado**, não parágrafo pronto
- Conversas e mensagens persistidas

### Remover — é o que engessa

- `plano.ts` inteiro — 18 detectores, `ORDEM`, `DESTAQUE`
- O enum `Intencao` como roteador e os três conjuntos `INTENCOES_*`
- O `switch` de execução do orquestrador (~260 linhas)
- "Segundo salto", "plano padrão", "família executiva" — heurísticas que existem
  para compensar a falta de segunda rodada
- Herança de assunto e período em código; fica só o recorte
- `redacaoDeterministica` como resposta de pergunta com dado — vira mensagem
  única de "sem chave configurada"
- Os parágrafos prontos das lacunas e das notas
- ~70 das 211 linhas do prompt: catálogo de blocos visuais, regra de abertura,
  checklist de sete perguntas

### Atenção à bateria de aceitação

São 1.701 linhas em `perguntas.ts`, `bateria.ts` e `banco-de-avaliacao.ts`, e
boa parte afirma **classificação** ("esta pergunta deve virar intenção X") — ou
seja, testa exatamente o que vai ser removido. Precisa ser reescrita para
afirmar **desfecho**: que ferramentas foram chamadas, que a resposta cita o
resultado certo, que nenhum número saiu sem lastro. Sem essa reescrita a
migração fica sem rede.

---

## 5. Plano de migração — oito PRs

O caminho mantém o produto no ar o tempo todo: o agente entra atrás de uma
variável de ambiente e só vira padrão quando a bateria nova aprovar.

| PR | O quê | Risco |
| --- | --- | --- |
| **0** | **Descobrir por que hoje sai determinística.** Sem código: rodar `scripts/diagnostico-assistente.mjs` contra o ambiente, ler `capabilities` e `usage`. Se for chave ausente, a correção é de configuração e vale por si. | nenhum |
| **1** | **Registro de ferramentas, sem ligar nada.** `lib/assistant/src/ferramentas/registro.ts`: esquema Zod → JSON Schema, executor com recorte injetado, erro devolvido como `{ erro: … }` em vez de lançar. Uma ferramenta só (`alteracoes`), com testes. | nulo — só adiciona |
| **2** | **O laço de tool use atrás de flag.** `ASSISTENTE_AGENTE=1` troca `redigir()` por `investigar()`: laço com teto de rodadas e de tokens, streaming preservado. Flag desligada = caminho atual byte a byte igual. | baixo — reversível por env |
| **3** | **Trava de lastro sobre os `tool_result`.** O conjunto de números autorizados passa a ser acumulado dos resultados de ferramenta do turno; citações passam a numerar chamadas. Preserva a garantia de auditoria no mundo novo. | médio — coração da promessa |
| **4** | **Bateria de aceitação por desfecho.** Trocar "esta frase vira intenção X" por "esta pergunta resulta em chamada da ferramenta Y e cita o resultado dela". Rodar contra os dois caminhos e comparar. | baixo — habilita os seguintes |
| **5** | **As ferramentas restantes**, em 2–3 PRs por afinidade: leitura de dado (`serie`, `comparar`, `resultado`); conteúdo (`documentos`, `parametros`, `recortes`); governança e novas exposições (`chamados`, `estado_do_dado`, `simular`). | baixo — independentes |
| **6** | **Direção econômica na semântica.** Migração aditiva com os dois campos, coluna na tela de Curadoria, exposição pela ferramenta `parametros`. Pode ir em paralelo desde o PR 1. | baixo |
| **7** | **Virar a chave e apagar o planejador.** Com a bateria aprovando, `ASSISTENTE_AGENTE` vira padrão e saem `plano.ts`, o `switch`, os `INTENCOES_*` e a herança em código. | médio — só depois do PR 4 |
| **8** | **Enxugar o prompt.** De 211 para ~90 linhas: papel, hierarquia de autoridade, quando usar ferramenta, nunca inventar número, distinguir fato/inferência/hipótese, investigar antes de concluir, falar como gestor. | baixo — medível pela bateria |

---

## 6. Critério de sucesso

O teste definido — uma pergunta nunca prevista, respondida sem código novo — tem
versão executável hoje, com os dados que já estão no banco:

- **"Liste as alterações."** Deve devolver os grupos com antes→depois, não três
  agregados. Hoje é impossível; depois do PR 2 é a primeira coisa a funcionar.
- **"Quais parâmetros eu deveria discutir com o cliente?"** Exige cruzar
  criticidade, impacto e status de semântica — três ferramentas, nenhuma
  pergunta prevista.
- **"Investigue por que esse número caiu."** Exige segunda rodada: ver o total,
  escolher o grupo, abrir as linhas. É o teste do laço.
- **"Esse aumento de combustível é bom ou ruim para mim?"** Só passa depois do
  PR 6. É o teste de a semântica ser dado e não prompt.
- **"Quais informações ainda faltam para você concluir?"** O modelo tem de saber
  o que **não** consultou. Só é respondível quando ele é quem escolhe as
  consultas.

### Dois riscos que valem ser ditos agora

**Custo e latência sobem.** Hoje é uma chamada com prefixo cacheado. O laço faz
de duas a cinco, e o contexto cresce a cada `tool_result`. Mitigação: teto de
rodadas, resultados paginados com `limite` obrigatório, e cache no prefixo do
sistema — que já está ligado.

**A reprodutibilidade cai, de propósito.** A escolha de fonte deixa de ser
determinística — que era o argumento explícito no cabeçalho de
`interpretacao.ts`. É uma troca consciente: ganha-se autonomia de investigação,
perde-se o "mesma pergunta, mesmo caminho, sempre". O que **não** se perde é a
auditabilidade do número, porque a trava e as citações continuam. Essa decisão
merece ficar registrada no `replit.md` junto com a mudança.

---

## 7. A virada de chave — o procedimento

Os PRs 0 a 6 e o 8 estão feitos e a flag continua desligada. O que falta é uma
decisão, e ela é medida — não é código.

**O agente nunca executou contra o modelo real.** Todo o caminho foi construído
e testado sem chave: o laço é exercitado com um cliente simulado, as dez
ferramentas rodam contra o banco, e a bateria por desfecho mede o planejador.
O que nenhum desses prova é a única coisa que o agente existe para fazer —
**o modelo escolher as ferramentas certas**. Virar a chave antes dessa medida
seria trocar o caminho que está em produção por um que nunca rodou.

### Os três comandos

```bash
pnpm --filter @workspace/assistant run desfecho -- --saida=antes
ASSISTENTE_AGENTE=1 pnpm --filter @workspace/assistant run desfecho -- --saida=depois
pnpm --filter @workspace/assistant run comparar -- antes.json depois.json
```

E, para ver a trajetória com os argumentos que o modelo escolheu:

```bash
ASSISTENTE_AGENTE=1 pnpm --filter @workspace/assistant run trajetoria
```

### O critério, e por que ele é assimétrico

`comparar` aplica três transições e ignora todo o resto — o texto muda a cada
rodada de um modelo, e comparar texto mediria ruído:

| transição | significado |
| --- | --- |
| `PASSOU → REPROVOU` | regressão — **bloqueia sozinha** |
| `DEFEITO_CONHECIDO → PASSOU` | correção — é o que justifica a virada |
| caso que sumiu | conta como regressão |

Uma regressão bloqueia por si, e nenhuma quantidade de correção a compensa. É a
mesma regra que este produto aplica a número sem lastro: exibir uma resposta
pior do que a de ontem não se paga com duas melhores noutras perguntas, porque
quem faz a pergunta que regrediu não vê as outras duas.

Um caso que sumiu conta como regressão porque a forma mais fácil de uma migração
parecer boa é o caso difícil deixar de ser executado.

O comando sai com código 1 quando reprova, então serve de último passo de um
script de promoção.

### O baseline de hoje

| medida | planejador |
| --- | ---: |
| casos verdes | 1 de 9 |
| defeitos conhecidos | 8 |
| respostas distintas | 6 de 9 |
| trajetórias distintas | 2 de 9 |

### Se aprovar

1. `ASSISTENTE_AGENTE=1` no ambiente — **só isso**. A virada não tem migração,
   não tem deploy de schema e não perde conversa: os dois caminhos gravam o
   mesmo `EstadoDaConversa`, e uma conversa aberta atravessa a virada nos dois
   sentidos (exercitado em `__tests__/reversibilidade.test.ts`).
2. Apagar a linha `defeitoConhecido` dos casos que passaram a verde, na mesma
   mudança — senão a bateria passa a exigir que eles voltem a falhar.
3. Observar `GET /api/assistant/usage` e o painel técnico. Descarte subindo é
   sinal de dossiê pobre chegando ao modelo, não de modelo pior.
4. Só então apagar o planejador: `plano.ts`, o `switch` do orquestrador, os
   conjuntos `INTENCOES_*` e a herança em código. **Esta é a única etapa
   irreversível**, e ela não precisa acontecer no mesmo dia da virada — deixar o
   caminho antigo de pé por uma semana custa código morto e compra a volta por
   variável de ambiente.

### Se reprovar

O relatório nomeia cada regressão com a pergunta, as falhas e as consultas que o
agente fez. O padrão mais comum não se corrige no prompt: é o modelo chamar o
nível certo e esquecer o filtro, e isso se conserta na **descrição do argumento**
da ferramenta, que é o texto pelo qual ele decide. Corrija, rode de novo, compare
de novo. A flag continua desligada o tempo todo.


### A rodada, num comando

```bash
DATABASE_URL=… ANTHROPIC_API_KEY=… node scripts/pr7.mjs
```

Ele faz os quatro passos na ordem, escreve tudo em `relatorios-pr7/`, e roda a
bateria exploratória **só se o portão aprovar** — medir como o agente conversa
sobre um agente que regrediu produz sete turnos de leitura agradável sobre algo
que não vai entrar, e é assim que uma decisão ruim ganha material de apoio.

A variável do agente é posta por processo filho, não no ambiente: é o que
garante que o passo 1 mediu o planejador de verdade e não um ambiente já
contaminado por uma tentativa anterior. O script **não vira a chave** — ele
escreve o veredito e para.

### A bateria exploratória

`run exploratoria` roda uma conversa de sete turnos com estado e histórico
atravessando, e mede nove sinais por turno: consultou, encadeou, continuou,
exerceu capacidade nova, reconheceu o que falta, não inventou número, citou
evidência, distinguiu inferência. Um sinal é `—` quando o turno não o exige —
"não exigido" e "exigido e falhou" são leituras opostas.

Baseline do planejador, medido:

| turno | falha |
| --- | --- |
| `por quê?` | não encadeou — uma consulta só, sem descer abaixo do agregado |
| `e julho?` | não continuou — repetiu o turno anterior |
| `o que você ainda não consegue concluir?` | não reconheceu a falta |
| todos | nenhum marcador de inferência (a redação em código não hesita — ela é template) |

`distingueInferencia` é **indício**, não veredito: ele acha por marcador
linguístico, e marcador não prova que a distinção foi feita. Serve para achar o
turno que merece leitura humana.

---

## 8. O critério de pronto, revisado

O critério anterior — "o agente escolhe as próprias consultas" — media capacidade
de investigação e parava aí. O que se quer é outra coisa: **um assistente que
interpreta economicamente o FreightCheck**. Escolher consulta é meio; entender o
que o número significa para quem opera é o fim.

Ligar o agente em definitivo exige que ele, diante de uma pergunta não prevista:
decida sozinho o que investigar, consulte os dados certos, **entenda o sentido
econômico das variáveis**, calcule ou simule quando necessário, cite de onde
tirou cada conclusão, e declare explicitamente o que não consegue provar.

A ordem abaixo é de prioridade, e ela vale depois do veredito do PR 7.

### 8.1 A causa da poda — sem afrouxar a trava

Dois terços das respostas do caminho atual (6 de 9, medido) têm frase removida
por citar número sem lastro. A leitura fácil é "o modelo alucina"; a leitura que
os dados sustentam é outra: ele tenta usar informação que a pergunta pede e o
dossiê não traz.

O que se quer saber, por caso: **qual número ele tentou usar, e por que ele não
estava disponível.** A resposta a isso é uma lista de capacidades a enriquecer,
não um limiar a relaxar. Afrouxar a trava trocaria um problema visível — a
frase some — por um invisível — o número errado fica.

### 8.2 Uma autoridade só para semântica econômica

Hoje há duas, e a culpa é deste trabalho: `economic_direction` no banco (PR 6) e
`lib/knowledge/src/economia.ts` na `main`. Elas respondem a mesma pergunta.

**A modelagem que sobrevive não pode derivar direção do sinal matemático.**
Aumentar `combustivel_vida_cavalo` é ganho de eficiência e **reduz** o litro
remunerado; reduzir a taxa FINAME reduz o custo financeiro e **reduz** a
remuneração. Nos dois casos, o movimento "bom" no sentido comum empurra a
remuneração para baixo. Uma coluna `HIGHER_IS_BETTER` no atributo não alcança
isso, porque a direção não é propriedade da variável — é propriedade do **par
(variável, fórmula em que ela entra)**.

É o que `PapelEconomico`, em `economia.ts`, já separa e o meu desenho não. A
convergência tem de preservar essa distinção, e o lugar dela é o banco: uma
tabela de 31 parâmetros em código não alcança os 138 e exige deploy para mudar.

Cada variável precisa carregar: se aumentar é favorável, desfavorável ou depende
do contexto; **por quê**; unidade e periodicidade; e como isso chega à
remuneração.

### 8.3 `simular` é núcleo, não melhoria

As perguntas que ele existe para responder são contrafactuais sobre fato
existente — "e se FINAME cair?", "e se eu voltar esta variável para a vigência
anterior?", "quanto eu recuperaria?" —, e isso restringe o desenho de um jeito
que ajuda: **a entrada não é um valor arbitrário, é uma substituição.** O valor
alternativo quase sempre vem de outra vigência do mesmo atributo, que o banco já
tem.

Com isso, `simular` não precisa calcular nada: ela alimenta o motor de impacto
que já existe com um valor substituído e devolve o que ele apurar. A regra de
que cálculo oficial é do sistema continua intacta — o que a ferramenta
acrescenta é a substituição, não a conta.

O desenho vem antes da implementação.

### 8.4 `chamados` sem virar terceira fonte canônica

O assistente precisa ligar uma anomalia nos dados a chamados que existam sobre
ela. O que ele não pode fazer é tomar o valor de um chamado como fato: o fato
mora em `change` e `fact`, e um chamado é **evidência sobre o processo** — que
alguém pediu, quando, e o que a tratativa dizia.

A ferramenta relaciona por parâmetro e período e devolve contexto; o número
continua vindo de onde sempre veio.

### 8.5 A régua tem de exigir proveniência

`restritaA` aceita hoje o termo aparecer **no texto**. Sem modelo isso era duro;
com modelo ficou frouxo, porque o modelo sempre menciona o que a pergunta
nomeou — e "cavalo" escrito sobre dados da frota inteira passa.

A versão dura confere a **origem**: a evidência que sustenta a resposta veio de
uma chamada cujos argumentos continham o filtro? O rastro já carrega os
argumentos de cada chamada; falta a checagem os usar.

### 8.6 Streaming, depois

Nada acima depende dele.

---

**A regra que atravessa os seis.** Nenhum destes se resolve escrevendo no
prompt. Um prompt que compensa falta de dado produz uma resposta que parece
melhor e não é — e este produto inteiro existe para não fazer isso com número
de frete.

---

## 9. O norte

Não é um chatbot do FreightCheck. É um **agente especialista em remuneração
Freightec**.

Diante de uma pergunta nova, que ninguém previu no código, ele precisa: entender
a intenção; decompor o problema; escolher sozinho as ferramentas; investigar em
várias etapas; consultar fatos, séries, parâmetros, documentos e chamados;
compreender a semântica econômica de cada variável; calcular impactos; executar
simulações contrafactuais; distinguir fato, cálculo, inferência e opinião; citar
a evidência de cada conclusão relevante; reconhecer quando os dados não permitem
concluir; e manter o contexto entre turnos.

**O Claude é o motor de raciocínio.** O código fornece ferramentas, contexto,
semântica, permissões, evidências e guardrails — e não reproduz o raciocínio do
modelo em regra escrita, nem em prompt nem em `if/else`.

### A pergunta que todo PR tem de responder

> Estamos aumentando a inteligência disponível ao agente, ou estamos codificando
> antecipadamente uma resposta que ele deveria conseguir descobrir sozinho?

Ela é útil porque reprova coisas que parecem certas. Aplicada ao que já existe
aqui, ela aprova `alteracoes` com `nivel` — é um eixo, e o agente compõe — e
reprova as quatro `Lacuna` como parágrafos prontos em `orquestrador.ts`, que
continuam sendo raciocínio escrito em código.

### O que os instrumentos deste repositório provam, e o que não provam

A bateria por desfecho e a exploratória são **listas de perguntas decodificadas**.
Elas são rede de regressão — dizem que o que funcionava continua funcionando — e
por construção **não podem demonstrar o norte**, porque toda pergunta que elas
contêm foi prevista por quem as escreveu.

O teste final é outro: uma pergunta econômica nova sobre dados reais, em que o
agente investiga, encontra o que precisa, raciocina, faz as contas, explica o
significado para o negócio e diz o que investigar ou negociar — sem inventar
fato. Isso não se verifica por igualdade; verifica-se por julgamento, sobre
perguntas que nenhum autor de ferramenta escreveu.

Registrar isso importa porque a tentação é a oposta: quando a bateria fica
verde, é fácil declarar pronto. Verde ali significa que não regrediu.
