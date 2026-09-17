# Avaliação do Assistente — harness, resultados e comparação

> Estado: **harness entregue e executado.** A execução desta sessão é **parcial
> por ausência de `ANTHROPIC_API_KEY`** — o que está medido é o pipeline; o que
> depende do modelo está declarado como não medido, e não como zero.

---

## 1. O que faltava, e o que este harness resolve

Antes dele, a decisão de ligar `ASSISTENTE_AGENTE` não tinha número:

| medição existente | o que ela vê | o que ela não vê |
| --- | --- | --- |
| `benchmark/` (110 perguntas, em CI) | intenção, fonte, ferramenta | **o texto** |
| `comparativo*.json` (A/B) | o texto, por leitura | eixo, repetição, custo, laço |
| bateria de aceitação (73 provas) | forma da resposta | custo, rodadas, injeção |

Nenhuma responde quanto custa uma pergunta, quantas rodadas ela gasta, se o
agente repete consulta, ou se ele resiste a uma injeção. `src/avaliacao/` roda o
**mesmo conjunto nos dois cérebros, no mesmo banco**, e colhe a instrumentação
que o produto já produz (`Resposta.tecnico`).

```bash
ASSISTANT_EVAL_DATABASE_URL=… pnpm --filter @workspace/assistant avaliacao
# opções: --eixos=ranking,placa   --saida=caminho.md
```

Escreve `.md` (leitura humana) e `.json` (regressão e comparação entre rodadas).

## 2. A separação que decide a leitura

Cada um dos 61 casos declara a sua natureza:

- **`DETERMINISTICO`** (28) — existe trajetória certa e número certo. O
  planejador tem tanta obrigação de acertar quanto o agente. Falha aqui é
  defeito, e uma perda do agente aqui significa que ele custa mais do que
  entrega.
- **`RACIOCINIO`** (33) — a resposta depende de escolher a segunda consulta a
  partir do resultado da primeira, cruzar duas fontes, ou perceber que a
  pergunta não tem resposta. **O planejador não pode acertar por construção** —
  ele fecha a trajetória antes de ver qualquer resultado.

Sem essa separação, um placar agregado diria "o agente ganhou por pouco" sem
dizer que ele ganhou exatamente onde o outro não tinha como jogar. É essa a
única informação que a decisão precisa.

## 3. Resultados — execução de 17/09/2026, sem chave

> **PARCIAL.** Sem `ANTHROPIC_API_KEY` o produto cai na redação determinística e
> `investigar` devolve `SEM_CHAVE` na primeira rodada: **o agente não chega a
> existir**. Por isso as duas colunas abaixo são idênticas — isso é ausência de
> medição, não empate.

| | planejador | agente |
| --- | ---: | ---: |
| casos que passaram | 49/61 | 49/61 |
| determinísticos | 20/28 | 20/28 |
| exigem raciocínio | 29/33 | 29/33 |
| intenção resolvida | 75% | 75% |
| resposta com lastro | 75% | 75% |
| sem número podado pela trava | 100% | 100% |
| ferramenta esperada rodou | 56% | 56% |
| respostas escritas pelo modelo | 0/61 | 0/61 |
| latência de orquestração p50 / p95 | 77 / 261 ms | 75 / 189 ms |

### Por eixo

| eixo | passou | leitura |
| --- | ---: | --- |
| lookup · comparacao · agregacao · temporal · diagnostico · explicacao · estado · multi_ferramenta | 4/4 | o núcleo responde |
| ambiguidade · adversarial | 3/3 | recusa premissa falsa sem inventar |
| injecao · isolamento | 2/2 | contenção de prompt e de recorte |
| evidencia | 2/3 | proveniência por célula falha |
| **ranking** | **2/5** | "os 10 maiores" não tem resposta |
| **idioma** | **2/4** | inglês devolve nada |
| **sem_dado** | **1/3** | responde outra pergunta com número certo |
| **placa** | **0/4** | eixo inteiro em aberto, com placa real |

### As falhas que mais importam

**Eixo `placa` — 0/4.** Com `QYN7B31`, placa real do banco: "o que mudou",
"qual o FINAME", "por que o custo fixo aumentou" e "dá dinheiro" respondem sem
fonte nenhuma. O produto tem `resultado {placa}` e `estado_do_dado {celula}`,
que respondem essas perguntas em 62–241 ms quando chamadas direto. O planejador
não as chama.

**`sem_dado` — os dois achados novos, e são da pior classe:**

- *"Quanto será o custo daqui a seis meses?"* → intenção `MOVIMENTO`, **4
  fontes**. Responde uma pergunta de projeção com o movimento atual: número
  verdadeiro, pergunta errada.
- *"Qual foi o impacto em janeiro de 2019?"* → `MOVIMENTO`, 2 fontes. Responde
  com dado de outro período.

Nenhum dos dois é alucinação — os números têm lastro. São respostas **corretas
para outra pergunta**, e a trava de lastro não as pega por construção: ela
confere se o número existe, não se ele responde ao que foi perguntado.

### Um achado sobre a própria medição

A régua de "afirma fato" contava a placa ecoada da pergunta como afirmação, e
reprovava uma resposta que fazia o certo — recusar a premissa repetindo a placa
para a pessoa saber de qual veículo se fala. O caso X1 reprovou por isso na
primeira execução. `afirmaFato` passou a descontar o eco, por token, e o eixo
adversarial foi de 2/3 para 3/3. Fica registrado porque uma métrica errada é
pior que métrica nenhuma: ela parece evidência.

## 4. O que a execução com chave vai acrescentar

Estas colunas do harness só ganham valor com o modelo no caminho, e hoje saem
como `—`:

| métrica | onde ela aparece |
| --- | --- |
| seleção de ferramenta pelo modelo | `ferramentas`, `ferramentaEsperadaRodou` |
| argumentos que ele manda | `argumentosInvalidos` |
| rodadas e consultas por pergunta | `rodadas`, `consultas` |
| encadeamento real × pré-planejado | `encadeamentosReais` |
| laço | `repetidas`, `pararamPorTeto` |
| precisão factual do texto | `numerosRecusados` |
| resistência a injeção | `vazou` |
| tokens e custo | anel de observabilidade |

O comando é o mesmo; basta a variável de ambiente estar presente.

---

## 5. Comparação com assistentes de alto nível

Por capacidade, com a evidência ao lado. A = ausente · B = básico · C =
funcional · D = avançado · E = estado da arte interno para o caso de uso.

| dimensão | nota | evidência |
| --- | :---: | --- |
| grounding | **E** | trava por token, por frase, por identificador e por vínculo; 100% sem número podado nas 61 |
| evidência e proveniência | **D** | chega a linha e coluna da planilha; mas o eixo `evidencia` deu 2/3 e o `placa` 0/4 |
| uso de ferramentas | **D** (latente) | 12 ferramentas medidas em 5–241 ms; **nenhuma é escolhida por modelo em produção** |
| contexto conversacional | **D** | herança de 7 dimensões, testada em 10 turnos |
| recuperação de erro | **D** | nunca lança; falha de ferramenta volta ao modelo; redação de reserva |
| velocidade | **D** | orquestração p95 de 261 ms |
| segurança | **C** | portão corrigido, injeção contida e testada, teto de custo; ACL por unidade em observação |
| compreensão de linguagem | **B** | 25% em `DESCONHECIDA`; inglês 2/4; "os 10 maiores" sem resposta |
| raciocínio e planejamento | **B** | `switch` sobre necessidades; o agente existe e está desligado |
| multi-hop | **C** | encadeia até 5 consultas, mas por regra fixa |
| interface | **C** | SSE, fontes, voto, ditado; sem cancelar, sem exportar, sem tabela interativa |
| observabilidade | **C** | rica, mas volátil e sem `user_id` nem versão de prompt |
| avaliação contínua | **C → D** | 183 casos em CI mediam só o pipeline; o harness acrescenta o eixo do modelo, e ainda não rodou com chave |

**A leitura em uma frase.** O que separa o FreightCheck dos melhores assistentes
não é a camada de confiança — ali ele está à frente, e a trava de lastro é mais
rigorosa do que a de qualquer produto de mercado. É a camada de **compreensão**:
um quarto das perguntas não é entendida, e as ferramentas que responderiam
existem, são rápidas, e ninguém as chama.

---

## 6. Checklist objetivo de pré-corte (ACL)

Nenhum item é opcional; a ordem é a de execução.

- [ ] `escopo-em-producao.sql` rodado em produção, com as seis evidências.
- [ ] Unidades canônicas cadastradas — **medido hoje: 0**.
- [ ] Hashes `SEM_VINCULO` = 0, ou cada um com exceção escrita e auditável.
- [ ] `contasSemConcessao` = 0 — toda conta ativa provisionada.
- [ ] Matriz de acessos revisada por quem responde pela operação.
- [ ] Concessões da controladoria cadastradas uma a uma, sem atalho.
- [ ] `GET /escopo/observacao` colhido com tráfego real de pelo menos um dia.
- [ ] Suítes verdes: api-server, `lib/db` com bridge, `lib/assistant`.
- [ ] Caso-marcador de `isolamento-por-unidade.test.ts` virado para `expect(403)`
      na rota que for cortada.

## 7. Plano de rollback

O corte é **uma condição no middleware**, não uma migration.

| o que | como | quando vale |
| --- | --- | --- |
| desligar o corte | variável de ambiente | no pedido seguinte, sem deploy |
| desfazer uma concessão | tela de Permissões | na hora, com autor e data |
| desfazer a estrutura | **não é necessário** | a tabela vazia não recusa nada |

Nenhum dado se perde em nenhum dos três caminhos: as concessões continuam
cadastradas depois de desligar, e religar não exige recadastro.
