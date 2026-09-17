# Auditoria do Assistente de IA — 17/09/2026

> Diagnóstico medido contra o ambiente real (Postgres semeado, API de pé, suíte
> completa executada), e a Fase 0 do plano de correção já aplicada. O que está
> aqui é o estado **antes** da Fase 0, a medição que o sustenta, e o que a
> Fase 0 fechou.

---

## 0. A pergunta, e a resposta

**"O Assistente é um chatbot ligado ao banco, ou um copiloto de auditoria?"**

Nem um nem outro, e a distância entre os dois explica o resto deste documento.

A camada de lastro — nenhum número no texto sem evidência que o autorize,
proveniência até linha e coluna da planilha, recorte imposto pelo executor e não
pelo prompt — é **melhor** do que a dos assistentes de dados de mercado. Não é
chatbot.

Mas o modelo não decide nada. `GET /api/assistant/capabilities` responde
`"cerebro": "PLANEJADOR"`: quem escolhe o que consultar é um planejador de
expressões regulares, e o Claude recebe um dossiê fechado para redigir
(`lib/assistant/src/llm.ts`). O laço de agente existe, tem 12 ferramentas e está
testado — e está atrás de `ASSISTENTE_AGENTE`, desligada
(`lib/assistant/src/agente.ts`). Não é copiloto.

**É um painel excelente com uma camada de redação por cima.**

---

## 1. O que foi medido, e como

Ambiente: `node scripts/prova-local.mjs subir` — 18 vigências, 8 conjuntos de
alteração, 60 atributos com semântica confirmada de 138. Sem
`ANTHROPIC_API_KEY`: **nenhuma medição deste documento envolve o modelo**, e é
essa a primeira conclusão da auditoria (ver §6).

### 1.1. 62 perguntas pelo caminho de produção

Executadas direto contra `orquestrar`, cobrindo as doze classes que o produto
promete responder.

| | resultado |
| --- | ---: |
| perguntas com **zero fontes** (resposta é "não encontrei") | **11 / 62 — 18%** |
| intenção resolvida como `DESCONHECIDA` | **16 / 62 — 26%** |
| latência do dossiê: p50 / p95 / p99 | **95 / 210 / 366 ms** |
| tokens do dossiê: p50 / p95 / máx | **475 / 1.365 / 1.838** |

As que falham incluem perguntas que o produto existe para responder:

```
"Quais foram os 10 maiores aumentos?"            → DESCONHECIDA · 0 fontes
"Mostre os 10 maiores impactos financeiros."     → DESCONHECIDA · 0 fontes
"Qual unidade teve maior aumento percentual?"    → DESCONHECIDA · 0 fontes
"Quais rubricas ainda não estão explicadas?"     → DESCONHECIDA · 0 fontes
"O que mudou no cavalo <placa> entre jul e ago?" → COMPARACAO   · 0 fontes
"Qual o FINAME do <placa> em agosto?"            → BOOK         · 0 fontes
"what changed in august?"                        → DESCONHECIDA · 0 fontes
```

A placa usada é uma do banco semeado, omitida aqui. A interpretação é só de
português.

### 1.2. As mesmas capacidades, pelas ferramentas do agente

Cada ferramenta do registro, executada direto contra o mesmo banco:

| ferramenta | ok | ms | evidências | tokens devolvidos |
| --- | --- | ---: | ---: | ---: |
| `recortes` | sim | 24 | 1 | 80 |
| `parametros {busca:"FINAME"}` | sim | 9 | **0** | 919 |
| `serie` | sim | 12 | 1 | 358 |
| `comparar` | sim | 147 | 1 | 184 |
| `ordenacao {por:dinheiro}` | sim | 133 | 1 | 140 |
| `ordenacao {por:criticidade}` | sim | 98 | 1 | 463 |
| `veiculos` | sim | 93 | 1 | 180 |
| `resultado {placa}` | sim | 241 | 0 | 14 |
| `alteracoes {nivel:grupos}` | sim | 86 | 1 | 689 |
| `documentos {busca:"pneu"}` | sim | 11 | 2 | 394 |
| `estado_do_dado {celula}` | sim | 62 | 1 | 377 |
| `proveniencia {}` / `calculo {}` | recusa | 0 | 0 | 62 |

**O dado existe, a consulta existe, e ela é rápida. O que falta é o modelo poder
pedi-la.** É a frase que resume a auditoria.

### 1.3. Latência ponta a ponta, por HTTP

Três execuções por pergunta, sem modelo no caminho:

| pergunta | classe | s |
| --- | --- | --- |
| "o que é lucro fixo?" | conceitual | 0,033 / 0,030 / 0,030 |
| "o que mudou?" | agregação | 0,115 / 0,142 / 0,112 |
| "compare julho com agosto." | comparação | 0,160 / 0,157 / 0,153 |
| "qual a evolução do pneu?" | série | 0,251 / 0,188 / 0,200 |
| "onde perdemos mais dinheiro?" | ranking + descida | 0,236 / 0,215 / 0,203 |
| "tem algo estranho nesses dados?" | multi-hop (5 consultas) | 0,273 / 0,266 / 0,283 |

O gargalo é inteiramente o modelo. O backend não é o problema deste produto.

### 1.4. Suítes

`lib/assistant`: **731 testes, 58 arquivos, todos passando** contra o banco
semeado — inclui a bateria de 73 provas, o benchmark de 110 perguntas com piso
103/103 e os 7 casos novos de injeção. `artifacts/api-server`, nas suítes de
permissão e isolamento: **108 testes passando**.

---

## 2. Arquitetura, como ela é hoje

```
Usuário
 → pages/assistente.tsx           SSE · ditado · fontes · voto · copiar
 → POST /api/assistant/ask?operacao=&ambiente=
     ├ requireSession                        401 para anônimo
     ├ portaoDePermissao                     EDITAR em /assistente e no ambiente
     └ tetoDoAssistente                      30 perguntas / 5 min · 2 em voo   ← Fase 0
 → responder()
     ├── PLANEJADOR  (produção)
     │     interpretar → 25 intenções por regex
     │     herdar estado (assunto, período, equipamento, recorte)
     │     planejar → necessidades → switch → 20 consultas
     │     DOSSIÊ FECHADO
     │     Claude Opus 5 · effort medium · 16k · SEM ferramentas
     │     TRAVA DE LASTRO por frase → poda; acima de ⅓, descarta
     │
     └── AGENTE  (ASSISTENTE_AGENTE — desligada)
           até 6 rodadas · 400k tokens de entrada · 12 ferramentas
 → persistência + SSE (etapa · texto · resposta)
```

| item | valor | onde |
| --- | --- | --- |
| modelo | `claude-opus-5` | `llm.ts` |
| esforço | `medium` | `llm.ts` |
| teto de saída | 16.000 (inclui raciocínio) | `llm.ts` |
| histórico | 8 turnos × 3.000 caracteres | `llm.ts` |
| cache | `ephemeral` na instrução | `llm.ts` |
| timeout / retries | 120 s · 1 | `llm.ts` |
| instrução (planejador) | 9.245 caracteres ≈ 2.312 tokens | `llm.ts` |
| instrução (agente) | 6.292 caracteres ≈ 1.573 tokens | `agente.ts` |
| cancelamento | **não existe** | — |
| cache de resultado | **não existe** | — |
| telemetria durável | **não** — anel de 500 em memória | `observabilidade.ts` |

### Custo por pergunta

Planejador: ~3–9k de entrada e 0,5–1,5k de saída ⇒ **US$ 0,03 a US$ 0,08**.
Agente: o teto de 400.000 tokens de entrada acumulados é **US$ 2,40 por
pergunta** na tabela de `observabilidade.ts`. Não há teto em dólar — só em token.

---

## 3. O achado P0 — bypass do portão de ambiente

**Reproduzido por HTTP contra o servidor real, com conta restrita.** A
reprodução detalhada não está escrita aqui de propósito: ela vive nos casos de
regressão de `routes/__tests__/permissoes.test.ts`, que é onde ela serve para
alguma coisa e onde reprova se a correção for desfeita.

A causa, que é o que importa registrar: dois carimbos, ambos escritos pelo
cliente e nunca confrontados. `?ambiente=` era o que o portão autorizava;
`?operacao=` era o que recortava o dado. Uma conta recusada num ambiente recebia
o acervo dele declarando outro ambiente — ou nenhum —, com a resposta completa e
nenhum sinal de que algo tinha sido atravessado.

Severidade P0 por três razões: o Assistente é uma das poucas leituras que passa
por `POST` e portanto **parece** protegida; ele **agrega**, então o que vaza é o
panorama financeiro do acervo numa frase, e não uma linha de tabela; e não exige
conhecimento nenhum do schema.

**Corrigido na Fase 0.** `ambienteDoAcervo`, em `lib/permissoes.ts`, deriva o
ambiente dono da operação pedida — família vinda do ambiente declarado, e
`auditoria` como padrão, que é o que o cliente carimba fora dos prefixos de
fechamento. O portão passa a exigir os dois. Depois da correção, contra o mesmo
servidor:

```
operacao=EMPURRADA&ambiente=auditoria       → 403 (ambiente: auditoria)
operacao=EMPURRADA&ambiente=auditoria-rota  → 403 (ambiente: auditoria)
operacao=EMPURRADA                          → 403 (ambiente: auditoria)
operacao=empurrada                          → 403 (a caixa não decide nada)
operacao=ROTA&ambiente=auditoria-rota       → 200 (o legítimo continua passando)
```

O 403 nomeia o **dono do acervo**, e não o ambiente declarado: nomear o declarado
mandaria procurar permissão no lugar errado. Dez casos em
`routes/__tests__/permissoes.test.ts`, incluindo os que provam que a correção não
recusa quem está no lugar certo — o Fechamento Empurrada continua sendo outro
ambiente, e operação desconhecida não inventa dono.

---

## 4. Os demais achados de segurança

| Sev | Achado | Estado |
| --- | --- | --- |
| P0 | Bypass do portão de ambiente | **corrigido na Fase 0** |
| P0 | Nenhum teste de injeção pelo Book | **suíte criada na Fase 0** |
| P1 | Sem teto de perguntas — DoS de custo | **corrigido na Fase 0** |
| P1 | `scopeHash` vem do corpo sem ACL de unidade | **aberto** |

### Injeção pelo Book

O Book é o único conteúdo que uma pessoa de fora da engenharia coloca dentro do
contexto do modelo — texto digitado e documentos anexados. A defesa era só de
prompt, e nunca fora exercitada.

`lib/assistant/src/__tests__/injecao-pelo-book.test.ts` planta uma ordem numa
revisão nova de um bloco — o fluxo real de atualização — e prova a **contenção**,
que é a parte que não depende de o modelo se comportar: o texto chega como
conteúdo dentro da seção do Book e não como seção do dossiê; nenhuma seção do
material nasce do texto plantado; o recorte das evidências não muda; o resultado
de ferramenta sai numerado como fonte, com os fatos marcados como internos; e a
trajetória de consultas da mesma pergunta é idêntica à de antes do
envenenamento.

**O limite, registrado como teste que reprova se mudar:** um número escrito no
Book **ganha lastro**. É o preço assumido em `orquestrador.ts` para o Book poder
sustentar as regras que carrega, e a consequência é que **quem escreve no Book
decide o que o assistente pode afirmar como número**. Não é defeito de código — é
a fronteira de confiança do produto, e ela não estava escrita em lugar nenhum.

### ACL por unidade — o que continua aberto

`scopeHash` chega no corpo da requisição e nada confere se aquela conta pode ver
aquela unidade. Hoje isso não é brecha, é **ausência de modelo**: não existe
permissão por unidade em lugar nenhum do produto. No dia em que a instalação
servir mais de uma transportadora, vira vazamento no primeiro pedido. É a decisão
de produto que a Fase 0 deixa explicitamente para trás — e ela precisa ser tomada
**antes** do segundo cliente, não depois.

---

## 5. Prompts

A instrução de produção cobre quase tudo o que se pede de um assistente de
auditoria: fonte única, proibição de cálculo, fato separado de inferência,
ausência de evidência como resposta específica, citação por afirmação, e cláusula
anti-injeção. Dois achados:

- **P2 — regra impossível de cumprir.** "Cálculo é feito no backend" manda o
  modelo a um lugar que, no caminho ligado, não existe: a ferramenta `calculo` só
  está no registro do agente. Percentual, média e projeção não têm como ser
  respondidos em produção — o modelo não pode calcular e o backend não calculou.
- **P3 — documentação fora de sincronia.** `registro.ts` diz "as dez
  capacidades", `catalogo.ts` diz "as oito restantes", e o registro tem **12**.

---

## 6. O gap que decide todos os outros

Existe benchmark, ele roda em CI com banco real, tem piso por categoria em
103/103 sem folga, e isso é melhor do que a maioria dos times faz. Mas ele mede o
**pipeline** — intenção, fonte, ferramenta, lacuna — e **nunca o texto**. O CI não
tem `ANTHROPIC_API_KEY` (`grep ANTHROPIC .github/workflows/` não devolve nada).

Consequência direta: *answer correctness*, *groundedness* do texto gerado,
*citation correctness*, *tool selection accuracy* e *hallucination rate* **não
têm número neste produto**. E é por isso que a decisão mais importante — ligar ou
não o agente — não pode ser tomada hoje: a única medição que existe é o A/B de
`lib/assistant/comparativo*.json`, e ele diz que o agente **ainda perde**:

```
antes:  agente  4 · planejador 19 · empate 16 · indeciso 6
depois: agente 11 · planejador 17 · empate 11 · indeciso 6
```

O agente melhorou 175% e continua atrás. Não é o modelo que está devendo — é o
material que chega até ele (`parametros` sem evidência, nenhuma ferramenta de
chamados). **Ligar a flag hoje pioraria a experiência média.**

---

## 7. Comparação por capacidade

A = ausente · B = básico · C = funcional · D = avançado · E = estado da arte
interno para o caso de uso.

| dimensão | nota | por quê |
| --- | :---: | --- |
| compreensão de linguagem | **B** | 25 intenções por regex; 26% em `DESCONHECIDA`; inglês devolve nada |
| raciocínio e planejamento | **B** | `switch` sobre necessidades; o agente existe e está desligado |
| uso de ferramentas | **D** | 12 ferramentas bem desenhadas e medidas — nunca chamadas por um modelo em produção |
| multi-hop | **C** | encadeia até 5 consultas, mas por regra fixa |
| contexto conversacional | **D** | herança de 7 dimensões, testada em 10 turnos |
| grounding | **E** | trava por token, por frase, por identificador e por vínculo |
| evidência e proveniência | **E** | chega a linha e coluna da planilha, com link para a tela |
| interface | **C** | SSE, fontes, voto, ditado — sem cancelar, sem exportar, sem tabela interativa |
| velocidade | **D** | p95 de 210 ms no backend |
| recuperação de erro | **D** | nunca lança; falha de ferramenta volta ao modelo; redação determinística de reserva |
| segurança | **C** | era B; a Fase 0 fechou o bypass e o teto, a ACL por unidade continua aberta |
| observabilidade | **C** | rica, mas volátil e sem `user_id` nem versão de prompt |
| avaliação contínua | **C** | 183 casos em CI — nenhum mede o texto |

---

## 8. Roadmap

**Fase 0 — segurança. Aplicada.**
Correlação `operacao` ↔ `ambiente` no portão, com dez casos de regressão · suíte
de contenção de injeção pelo Book, com o limite de lastro registrado · teto de
perguntas por conta, com os dois limites que são dois jeitos diferentes de
gastar. Decisão pendente, e é de produto: ACL por unidade.

**Fase 1 — confiabilidade.** Evidência em `parametros` · corrigir a regra do
cálculo no prompt · *golden set* de 250 casos com `respostaEsperada`,
`evidenciaEsperada` e `toleranciaNumerica` · harness que roda o modelo, nightly,
fora do caminho do PR · telemetria durável com `user_id` e versão de prompt.

**Fase 2 — inteligência.** Ligar o agente por conta e medir até ele vencer o
placar · ferramenta de chamados · cobrir ranking, por-placa e inglês · refutação
ativa de premissa falsa (consultar e contrapor, em vez de responder "não
encontrei") · desambiguação que pergunta de volta.

**Fase 3 — UX.** Cancelamento · tabela interativa · "Abrir em Alterações" com os
mesmos filtros · CSV e XLSX · três níveis de profundidade explícitos.

**Fase 4 — escala.** Carga de 1 a 100 · cache de resultado por (recorte,
vigência, ferramenta, argumentos) · mais de um processo.

**Fase 5 — avaliação contínua.** Benchmark noturno com modelo, regressão por
métrica, painel de desfechos.

---

## 9. Definition of Done

O Assistente está pronto para uso enterprise quando:

1. Acesso não autorizado = 0, provado por suíte que cruza `ambiente × operacao ×
   scopeHash` — **a primeira metade está feita; a de unidade depende do modelo de
   ACL**.
2. A suíte de injeção cobre Book, nome de parâmetro e descrição de coluna, e está
   verde — **Book feito**.
3. O *golden set* de 250 roda com o modelo e publica: groundedness ≥ 98%,
   citação correta ≥ 99%, precisão numérica 100% nos casos determinísticos,
   alucinação crítica = 0, escolha de ferramenta ≥ 97%, multi-hop ≥ 95%.
4. Cobertura de pergunta ≥ 97% — hoje **82%**.
5. Teto de custo em dólar por pergunta, além do teto de volume — **volume feito**.
6. Telemetria durável com `request_id`, `user_id`, `operacao`, `scopeHash`,
   versão de prompt, ferramentas, tokens, custo e desfecho.
7. p95 por classe, medido **com o modelo ligado**: consulta ≤ 4 s, agregação
   ≤ 8 s, multi-hop ≤ 20 s.
8. Toda resposta monetária com fonte clicável até a origem.

---

## 10. O que falta para não sentir perda diante dos melhores

Quatro coisas, nesta ordem — e velocidade não é uma delas, porque 210 ms de p95
no backend já é melhor do que a régua de mercado:

1. **O agente ligado.** É a diferença entre "não encontrei" e uma investigação.
2. **Eval que roda o modelo.** Sem ela, ligar o agente é troca de aposta, não
   decisão. É o único item que não dá para pular.
3. **Cobertura de linguagem.** 26% de `DESCONHECIDA` e inglês zerado é onde a
   diferença aparece na primeira frase.
4. **Ação na resposta.** Tabela que ordena, filtro que abre a tela, exportação. É
   o que separa ler um relatório de trabalhar com um copiloto.
