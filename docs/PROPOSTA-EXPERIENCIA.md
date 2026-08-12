# FreightCheck — Auditoria de experiência e proposta de simplificação

> **Status:** proposta. Nenhum código de produção escrito, nenhum schema tocado,
> nenhuma migration, nenhum dado alterado.
>
> **Base empírica:** um Postgres descartável, alimentado pelo próprio pipeline do
> produto (`pnpm dev:seed` → `receiveFile → captureRaw → stage → preview →
> promote`) a partir de `attached_assets/Modelo_Carreta.xlsx` e
> `Modelo_Cavalo.xlsx`, seguido de `compare-all`. Resultado: **18 vigências**
> (9 CARRETA + 9 CAVALO, de 2025-12-02 a 2026-08-01), **144 ativos**, **83.241
> fatos**, **138 atributos**, **16 comparações**, **3.224 alterações**.
> Todo número citado aqui foi extraído desse banco. Não há dado inventado.

---

## 1. Como o FreightCheck funciona hoje

### O fluxo, de ponta a ponta

```
Importações (upload .xlsx)
   └─ receiveFile (SHA-256, recusa duplicata)
      └─ captureRaw   → raw_sheet / raw_row / raw_cell   [imutável, trigger]
         └─ stage     → staged_fact + validation_issue   [descartável]
            └─ preview → aceitos / rejeitados / avisos    [aceite explícito]
               └─ promote → snapshot + entity + fact      [CLOSED, imutável]
                  ├─ seedTaxonomy        (22 nós)
                  ├─ runProposalPass     (semântica PRESUMED, nunca CONFIRMED)
                  ├─ applyConfirmations  (registro versionado em código)
                  ├─ backfillSemantics   (attribute_semantics v1)
                  └─ computeMissingChangeSets  ← roda destacado, em background
```

Depois disso, tudo é leitura. O motor de comparação (`lib/comparison`) pareia
`(entity_id, attribute_id)` entre dois snapshots da **mesma série** (mesmo
`scope_hash` + `entity_type_set`) e emite quatro eixos: `SOURCE_CHANGE`,
`FLEET_CHANGE`, `SEMANTICS_CHANGE`, `LAYOUT_CHANGE`. O impacto é apurado por
`assessImpact`, que só produz um número quando a semântica é `CONFIRMED`, o
atributo é monetário e a agregação é `SUM` — caso contrário devolve
`NOT_CALCULABLE` **com motivo em português**.

### As telas

Doze rotas em `App.tsx`; oito no menu.

| Rota | No menu | Estado | O que responde hoje |
|---|---|---|---|
| `/` **Painel de Impacto** | sim | vivo | contadores **vitalícios** + card "última comparação" |
| `/alteracoes` **Alterações** | sim | vivo | lista consolidada do período mais recente |
| `/comparar` **Comparar Vigências** | sim | vivo | mesma tabela, par escolhido à mão |
| `/curadoria` **Curadoria** | sim | vivo | fila de 121 atributos sem semântica confirmada |
| `/versoes` **Versões** | sim | vivo | linha do tempo do *significado* de um atributo |
| `/vigencias` **Vigências** | sim | vivo | lista de snapshots, rótulo + data + contagens |
| `/importacoes` **Importações** | sim | vivo | histórico de execuções, SHA-256, abas |
| `/analise-equipamentos` **Análise de Frota** | sim | vivo, **fora do modelo** | lê o `.xlsx` do disco, sem rastreabilidade |
| `/simulacao` **Simulação** | travado | **morto** | chama `/simulations`, removida com o schema antigo |
| `/snapshots`, `/snapshots/:id` | não | **morto** | chamam `/snapshots/{id}/parameters`, removida |
| `/apresentacao` | não | vídeo institucional | — |

`lib/api-spec/openapi.yaml` ainda declara 19 caminhos, dos quais 15 não existem
mais no servidor (`/dashboard/*`, `/parameters`, `/diffs*`, `/shipments*`,
`/alerts*`, `/simulations*`, `/snapshots/{id}/*`). O cliente gerado em
`lib/api-client-react` continua exportando hooks para eles — é o que as três
telas mortas consomem.

---

## 2. O que já existe tecnicamente e a interface não usa

Esta é a parte mais importante da auditoria: **quase tudo que a nova experiência
precisa já está no banco ou já está numa função exportada.** O problema é de
apresentação, hierarquia e fluxo — não de capacidade.

| Capacidade | Onde já existe | Onde aparece hoje |
|---|---|---|
| Série histórica de um atributo nas 9 vigências (soma, contagem, por vigência) | `getAttributeDetail(...).history`, `lib/curation/src/engine.ts:510` | **só na Curadoria**, escondida atrás de escolher o atributo numa fila de 121 |
| Rastreabilidade até a célula, dos dois lados | `getChangeProvenance`, `GET /changes/:id/provenance` | expandindo linha a linha na tabela |
| Classe de custo herdada pela taxonomia (FIXO/VARIÁVEL) | `classification.ts`, lateral join por `path` | badge por linha; nunca como agrupador |
| `taxonomy_path` gravado em cada alteração | `change.taxonomy_path` | **não usado em nenhuma tela** |
| Natureza da mudança (`ZEROING`, `FROM_ZERO`, `TYPE_CHANGE`, `APPEARED`, `NULL_REASON`) | `classifyChange`, coluna `change.nature` | badge cinza, sem peso na ordenação |
| Motivo do "não calculável", frase por frase | `change.impact_reason` | tooltip |
| Semântica vigente **na data de cada lado** | `loadAttributeClassificationsAt` | usado pelo motor; invisível na tela |
| Versões de semântica com `effective_from` e `calculation_basis` | `attribute_semantics`, `getSemanticsHistory` | tela `/versoes`, separada |
| Séries ausentes num período, nomeadas | `getConsolidated(...).missing` | banner âmbar |
| Quebra por classe / tipo / semântica | `getChangeSetBreakdown` | contadores nos chips de filtro |
| Conversão de periodicidade com recusa declarada, e horizonte partido por semântica | `lib/simulation` (`periodicity.ts`, `horizon.ts`) — **completo e testado** | **nenhuma tela consome** |
| Índice `fact_entity_attribute_idx` = histórico de uma variável num ativo | `canonical.ts:388` | nenhuma tela |

**O que realmente não existe:**

1. **Agrupamento.** Toda a API de leitura é linha a linha. Não há endpoint que
   devolva "IPVA — Cavalo — 62 veículos — −R$ 144.874,50/ano".
2. **Estado de decisão.** Nenhuma tabela, coluna ou rota registra "já analisei
   isto". A pergunta 7 do briefing é hoje **irrespondível**.
3. **Ligação entre alteração e histórico.** Da linha de uma alteração não há
   caminho para a série do atributo; é preciso sair para a Curadoria.

---

## 3. Onde está a complexidade desnecessária

### O percurso real do cenário "chegou uma vigência nova"

Simulei o usuário com os dados de **Ago/2026** (`EMPURRADA_1_8_2026`), a vigência
mais recente do banco.

**Tela 1 — `/` Painel de Impacto.** Quatro tiles: *Vigências 18 · Ativos 144 ·
Fatos 83.241 · Alterações 3.202*. Nenhum deles é sobre a vigência que acabou de
chegar; são contagens vitalícias. O card "Impacto apurado até aqui" mostra
**−R$ 87.808,57/mensal** e **−R$ 735.312,15/anual** — o acumulado das 16
comparações desde Dez/2025, apresentado sem essa palavra. Quem abre depois de uma
vigência nova lê isso como o impacto da vigência nova. Não é.

O card "Última comparação" mostra `EMPURRADA_2_7_2026 → EMPURRADA_1_8_2026`,
**244 valores alterados**. Mas há **duas** comparações com a mesma
`effective_date` — CAVALO (244 alterações, +R$ 6.747,20/mês) e CARRETA (23
alterações, **+R$ 33.189,08/mês**). A query ordena só por data e pega `LIMIT 1`;
o desempate é o que o Postgres devolver. **O painel mostra a série de menor
impacto e omite a de maior, e não diz que omitiu.**

**Tela 2 — `/alteracoes`.** Aqui está a informação certa, e ela chega assim:
cinco tiles, até três faixas de aviso, uma barra com **doze chips de filtro** e
dois campos de texto, e então uma tabela de **267 linhas × 8 colunas**. A
ordenação por materialidade funciona — as 19 linhas com impacto apurado sobem ao
topo. Depois delas vêm 248 linhas sem preço, na ordem em que caírem.

Dessas 248, **62 são a mesma coisa**: `cavalo.data_fim_contrato` mudou de
`2028-07-01T12:00:00Z` para `46935.5` em todos os 62 cavalos. É um serial do
Excel entrando onde antes vinha data — um fato de qualidade de dado, **uma**
notícia, que ocupa 62 linhas idênticas marcadas "inconclusiva".

**Tela 3 — expandir uma linha.** Duas requisições, e vem a proveniência dos dois
lados. Isso é bom e deve ser mantido. Mas para responder *"foi geral ou
específico?"* é preciso digitar o nome do atributo na busca e **contar as linhas
do resultado**. O sistema sabe contar; hoje quem conta é o usuário.

**Tela 4 — `/curadoria`.** Para saber se a queda do IPVA é nova ou vem se
repetindo, é preciso sair, achar o atributo numa fila de 121, abrir, e ler a
série. **Tela 5 — `/versoes`** para saber se o significado mudou.

**Resultado: 4 a 5 telas, ~12 cliques, e a pergunta "o que eu já analisei?" não
tem resposta em lugar nenhum.**

### Os problemas concretos, com evidência

**P1 — Registros onde deveriam existir conclusões.** As 267 linhas de Ago/2026
colapsam em **20 grupos** por atributo. Na série CAVALO, 244 linhas viram 15
grupos. No mês mais movimentado (Jul/2026), 593 linhas viram 25 grupos. Isto foi
medido, não estimado:

| Vigência | Linhas | Grupos (atributo) | Grupos (atributo + antes→depois exato) |
|---|--:|--:|--:|
| CAVALO Jan/2026 | 347 | 16 | 80 |
| CAVALO Jul/2026 | 431 | 19 | 147 |
| CAVALO Ago/2026 | 244 | 15 | 56 |
| CARRETA Ago/2026 | 23 | 5 | 18 |

**P2 — A lista trunca e não avisa direito.** `limit` é 300 em
`change-table.tsx`. Jul/2026 consolidado tem **593 linhas**. Quase metade da
vigência mais dramática do arquivo só é alcançável filtrando.

**P3 — O impacto agregado conta o mesmo dinheiro duas vezes.** Em Ago/2026 o
total apurado é **+R$ 39.936,28/mês**. Dentro dele:

```
carreta.custo_fixo                    +16.594,54   ← o total
carreta.finame                        +11.916,69   ← parcela
carreta.lucro_fixomodelo_novo_ciclo    +4.677,85   ← parcela
                                       ─────────
                          11.916,69 + 4.677,85 =  16.594,54   (exato, nas 5 placas)
```

O registro de confirmações declara essa identidade
(`custoFixo = finame + lucroFixomodeloNovoCiclo`, 611 de 657 linhas), e os três
atributos estão `CONFIRMED · BRL · MENSAL · SUM`. O motor soma os três. **O
titular está inflado em 71%: o número honesto é +R$ 23.341,74/mês.** O mesmo
padrão existe no cavalo (`finame_cavalo = amortizacao_cavalo + juros_finame_cavalo`
— confere exatamente na placa QYP3G72: 7.700,16 + 2.147,19 = 9.847,35).

Isto não é um detalhe de tela: é o único número financeiro que o produto exibe
com destaque, e ele soma pai com filho. É o P0 mais urgente desta auditoria.

**P4 — Informação técnica que não ajuda a decidir.** O usuário vê
`cavalo.ipva_licenciamento`, `SEMANTICS_DRIFT`, `PRESUMED`, `SEM_CLASSE`,
`entityTypeSet`, `CARRETA+CAVALO`. São nomes do schema. O briefing pede
explicitamente que ninguém precise conhecê-los.

**P5 — 84% das alterações não têm preço, e sempre pelo mesmo motivo.** Das 3.224
alterações, **2.720 (84%)** são `NOT_CALCULABLE` porque a semântica não foi
confirmada — 2.284 `PRESUMED` e 436 `UNKNOWN`. Só **345** têm impacto apurado.
O gargalo tem nome e é curto:

| Atributo | Alterações bloqueadas | Estado |
|---|--:|---|
| `cavalo.manutencao_vida_meses` | 494 | PRESUMED |
| `cavalo.combustivel_vida_cavalo` | 494 | PRESUMED |
| `cavalo.custo_variavel_simulado` | 428 | UNKNOWN |
| `cavalo.combustivel_consumo_neg` | 240 | PRESUMED |
| `carreta.ipva_licenciamento_mensal` | 149 | PRESUMED |
| `carreta.ipva_licenciamento` | 144 | PRESUMED |
| `carreta.lucro_variavel_previsto` | 113 | PRESUMED |

Confirmar **sete** atributos destravaria 2.062 das 2.720 alterações sem preço.
A tela não diz isso em lugar nenhum — a Curadoria ordena por magnitude
monetária, não por quantas alterações cada confirmação desbloqueia.

**P6 — Funcionalidade fragmentada e duplicada.** `/alteracoes` e `/comparar`
renderizam **o mesmo componente** (`ChangeTable` + `FilterBar`) com a mesma API;
a única diferença é quem escolhe o par. São duas entradas de menu para uma
ferramenta. `/vigencias` e o seletor de `/comparar` listam a mesma coisa.
`/analise-equipamentos` responde perguntas parecidas lendo o `.xlsx` do disco —
números que **não passam pela curadoria, não têm rastreabilidade e podem
divergir do canônico sem que nada acuse**.

**P7 — Ferramentas de operação misturadas com ferramentas de decisão.** No menu
atual, "Importações" (operação) tem o mesmo peso visual de "Alterações"
(decisão). E "Painel de Impacto", que devia ser a tela de decisão, é a que menos
decide.

---

## 4. O que eu manteria — sem tocar

- **O modelo de dados inteiro.** Grão `(snapshot, entidade, atributo)`,
  imutabilidade por trigger, `is_null` com motivo, `NUMERIC(18,6)`. É o que torna
  tudo o mais possível.
- **A regra do impacto.** `assessImpact` recusando produzir número sem semântica
  confirmada, com motivo escrito. Isso não é fricção: é o produto.
- **"Impacto não calculável" como estado de primeira classe**, com frase própria.
- **A separação de eixos** (valor / frota / layout / significado) e a supressão
  de filhos quando um ativo entra ou sai — é o que faz Abr→Mai render 65 linhas
  em vez de ~700.
- **Impacto por periodicidade, nunca somado entre elas.**
- **A recusa de comparar séries diferentes**, com mensagem escrita para quem lê.
- **A proveniência até a célula**, expandindo a linha.
- **Curadoria e Versões** como atos distintos, com botões distintos.
- **Importações** exatamente como está — é ferramenta operacional e cumpre bem.
- **O tom dos textos.** As frases do produto explicam em vez de rotular. Isso é
  raro e deve ser preservado ao pé da letra.

---

## 5. O que eu simplificaria, juntaria, esconderia ou eliminaria

| Ação | Alvo | Justificativa |
|---|---|---|
| **Juntar** | `/` + `/alteracoes` → uma tela só, que é a home | O Painel não decide nada que Alterações não decida melhor; os tiles vitalícios confundem período com histórico |
| **Juntar** | `/comparar` vira um **seletor** dentro dessa tela ("comparar com: vigência anterior ▾") | É o mesmo componente e a mesma API; a diferença é um par de IDs |
| **Juntar** | `/vigencias` vira o conteúdo desse mesmo seletor + uma aba de histórico | Hoje é uma tabela que não leva a lugar nenhum além de um link genérico para `/comparar` |
| **Rebaixar** | Curadoria e Versões saem do menu principal e passam a ser alcançadas **pelo grupo bloqueado** ("este impacto está travado — confirmar significado") | Ninguém acorda querendo curar semântica; quer-se destravar um número específico |
| **Esconder** | `/analise-equipamentos` sai do menu, vira "Legado" | Lê o Excel do disco, sem rastreabilidade. Não removo (nada é removido), mas não pode dividir menu com o dado canônico |
| **Esconder** | `/simulacao`, `/snapshots`, `/snapshots/:id` saem do roteador ativo | Chamam endpoints que não existem desde a troca de schema. Manter uma rota que só produz erro é o mesmo pecado de mostrar um número sem lastro |
| **Eliminar** | os 4 tiles vitalícios do Painel | Respondem "quanto o sistema tem", não "o que mudou" |
| **Eliminar** | a barra de 12 chips como elemento de primeira dobra | Vira "filtros ▾" recolhido; o Nível 1 já é a resposta filtrada |
| **Eliminar** | a palavra `entityTypeSet`, `CARRETA+CAVALO`, `PRESUMED`, `SEMANTICS_DRIFT`, `SEM_CLASSE` da interface | "cavalos", "carretas", "significado ainda não confirmado", "o significado da coluna mudou", "sem classificação" |
| **Corrigir** | o duplo-contagem pai/parte no total de impacto | É o único número em destaque e está 71% inflado em Ago/2026 |
| **Corrigir** | o desempate arbitrário da "última comparação" | Hoje esconde a série de maior impacto |

Menu final: **4 entradas** em vez de 8.

```
DECIDIR      Início          ← a tela
DESTRAVAR    Significados    ← Curadoria + Versões, fundidas por assunto
ORIGEM       Vigências       ← lista + histórico + rastreio
OPERAÇÃO     Importações
                             (Legado: Análise de Frota)
```

---

## 6. A arquitetura de experiência recomendada

Três níveis, **uma tela**. O aprofundamento acontece dentro dela, não navegando.

### Nível 1 — O que aconteceu?

Abre já respondido, sem escolher nada. Uma frase de veredicto, o impacto
separado por periodicidade, e **de 5 a 8 cartões de grupo** — não linhas.
O restante fica colapsado atrás de "e mais N mudanças sem sinal relevante".

**Um grupo = (atributo × tipo de equipamento × esta vigência).** É a unidade de
leitura e, mais adiante, a unidade de decisão.

Cada cartão traz: nome em português, equipamento, quantos veículos, antes →
depois (agregado **ou** faixa, conforme a regra abaixo), variação percentual,
impacto **ou** o motivo de não haver, e um selo de prioridade.

### Nível 2 — Por que isso importa?

Abrir o cartão **no lugar** (expansão, não outra página). Traz:

- **Histórico da linha nas 9 vigências** — soma, média por veículo e nº de
  placas, lado a lado. A média é obrigatória: sem ela, a entrada de dois cavalos
  entre Jan e Fev/2026 lê como aumento de custo.
- **Padrões distintos dentro do grupo** ("13 valores antes→depois diferentes"),
  para que agrupar nunca esconda dispersão.
- **Os veículos afetados**, com placa, antes, depois e link para a célula de
  origem. É a tabela de hoje, agora dentro do contexto certo.
- **Se o significado mudou** e desde quando (`attribute_semantics`).
- **Se o impacto está travado**, com o botão que o destrava.

### Nível 3 — O que vou fazer?

Um controle por grupo, com quatro estados e nada mais:

| Estado | Significado |
|---|---|
| *(sem marca)* | novo, ainda não olhado — é o padrão, não custa registro |
| **Em análise** | assumido por alguém |
| **Questionar o cliente** | vira pendência externa, com o texto da dúvida |
| **Encerrado** | resolvido — com um motivo curto: *aceito* / *corrigido* / *sem ação* |

Rejeito a lista de cinco do briefing por um motivo prático: *"ainda não
analisado"* não precisa ser um estado gravado (é a ausência de qualquer marca), e
*"aceito"* e *"resolvido"* não se distinguem em nenhuma ação subsequente — viram
motivo de encerramento, não estados próprios. Menos estados, menos ambiguidade
sobre em qual deles algo está.

**Detalhe técnico que muda o desenho:** `computeChangeSet` **apaga e reconstrói**
o change set inteiro a cada recálculo, e os `change.id` são `bigserial`. Uma
decisão amarrada a `change_id` evapora no primeiro recálculo. A chave da decisão
tem de ser estável e semântica: `(attribute_code, entity_type, effective_date da
vigência)` — que sobrevive a qualquer reconstrução e é exatamente a chave do
grupo.

### Priorização — determinística, sem scoring, sem IA

Cada grupo recebe **no máximo um selo**, pela primeira regra que casar, nesta
ordem. Todos os campos já existem em `change`.

| # | Selo | Regra | Fonte |
|---|---|---|---|
| 1 | **Dinheiro** | tem impacto apurado; ordena por `abs(impacto)` dentro da periodicidade | `impact_confidence`, `impact_amount` |
| 2 | **Toda a frota** | atinge ≥ 50% dos ativos da série naquela vigência | `count(*)` ÷ `snapshot.entity_count` |
| 3 | **Movimento grande** | `abs(Δ%)` agregado ≥ 20% | `numeric_before/after` |
| 4 | **Ruptura** | natureza `ZEROING`, `FROM_ZERO`, `TYPE_CHANGE`, `APPEARED`, `DISAPPEARED`, `NULL_REASON` | `change.nature` |
| 5 | **Preço travado** | monetário e somável, mas semântica não confirmada | `is_monetary`, `aggregation`, `semantics_status` |
| 6 | **Sem sinal** | o resto — colapsado | — |

Deixo **recorrência de fora do P0, de propósito.** Testei: "mudou em ≥3 das
últimas 4 vigências" seleciona **20 dos ~25 atributos ativos** — não separa nada.
Recorrência só vira sinal com uma definição mais dura (mesma direção, magnitude
acima de um piso), e isso precisa ser calibrado com dado real antes de virar
selo. Entra como P1.

### As regras que impedem o agrupamento de mentir

1. **Nunca agrupar através de `comparability`.** Um grupo com linhas
   comparáveis e inconclusivas se parte em dois.
2. **Nunca agrupar através de `impact_confidence`.** Idem.
3. **Nunca somar através de periodicidade.** A regra já vigente, mantida.
4. **Só somar `antes` e `depois` quando `aggregation = SUM`.** Para `AVG`,
   `WEIGHTED_AVG` e `NONE`, o cartão mostra **média e faixa**, com a frase "não
   somável". Sem isso, `cavalo.manutencao_vida_meses` exibiria "3.075,69 →
   3.139,94 meses", que não significa nada.
5. **Sempre exibir o número de padrões distintos** dentro do grupo. Se o mesmo
   atributo foi de 4.096,31 para 2.505,97 em 13 padrões diferentes, o cartão diz
   "13 padrões" e o Nível 2 os lista.
6. **Sempre exibir o nº de veículos e o total da frota.** "62 de 62 cavalos" é
   informação diferente de "5 de 71 carretas".
7. **Movimento de frota nunca entra num grupo de atributo.** Continua no seu
   próprio eixo, uma linha por ativo que entrou ou saiu.

---

## 7. Wireframe textual da experiência ideal

```
┌────────────────────────────────────────────────────────────────────────────┐
│ CABEÇALHO                                                                  │
│   Vigência de agosto/2026 · recebida em 12/08 · cavalos e carretas          │
│   [comparar com: vigência anterior (julho/2026) ▾]                          │
├────────────────────────────────────────────────────────────────────────────┤
│ VEREDICTO  (uma frase, gerada por regra, não por IA)                        │
│                                                                            │
│   O cliente mexeu em 20 pontos da sua remuneração.                         │
│   3 merecem sua atenção. 1 precisa de decisão sua.                         │
│                                                                            │
│   Custo fixo mensal    +R$ 23.342 /mês     ← só o que é somável, sem        │
│                                              contar total e parcela juntos │
│   Custo anual          sem alteração apurada                               │
│   Sem preço            248 mudanças  ·  por quê? →                         │
├────────────────────────────────────────────────────────────────────────────┤
│ MUDANÇAS QUE PRECISAM DA SUA ATENÇÃO                                        │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 💰 DINHEIRO                                                           │  │
│  │ FINAME — Carreta                            5 de 71 carretas          │  │
│  │ R$ 23.061,81 → R$ 34.978,50        +51,7%                             │  │
│  │ impacto  +R$ 11.916,69 /mês                                           │  │
│  │ 4 padrões distintos · custo fixo · financiamento                      │  │
│  │                          [ver os 5 veículos]  [em análise ▾]          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ ⚠ RUPTURA                                                             │  │
│  │ Data de fim de contrato — Cavalo           62 de 62 cavalos           │  │
│  │ vinha como data, agora vem como número (46935.5)                      │  │
│  │ impacto  não calculável — o tipo do valor mudou; não dá para           │  │
│  │          comparar as duas naturezas com segurança                     │  │
│  │                        [ver os 62 veículos]  [questionar cliente ▾]   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 🔒 PREÇO TRAVADO                                                      │  │
│  │ Lucro variável previsto — Cavalo            10 de 62 cavalos          │  │
│  │ R$ 28.119,00 → R$ 18.746,00        −33,3%                             │  │
│  │ impacto  não apurado — o significado desta coluna ainda não foi       │  │
│  │          confirmado, e somar sem isso seria adivinhação               │  │
│  │                     [confirmar significado]  [ver os 10 veículos]     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ▸ e mais 17 mudanças sem sinal relevante                                  │
├────────────────────────────────────────────────────────────────────────────┤
│ O QUE VOCÊ JÁ DECIDIU                                                       │
│   ● 1 em análise   ● 1 questionando o cliente   ● 0 encerradas              │
│   ○ 18 ainda não olhadas                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ RODAPÉ (discreto)                                                           │
│   filtros ▾ · exportar · 8.856 valores não mudaram · vigências anteriores  │
└────────────────────────────────────────────────────────────────────────────┘
```

Ao expandir um cartão — **na mesma página**:

```
  FINAME — Carreta                                                    [fechar]
  ───────────────────────────────────────────────────────────────────────────
  COMO ESSA LINHA SE COMPORTOU NAS ÚLTIMAS 9 VIGÊNCIAS
    (soma da frota · média por veículo · nº de carretas)

    dez   jan   fev   mar   abr   mai   jun   jul   ago
    ●─────●─────●─────●─────●─────●─────●─────●─────●
                                              ↑ mudou aqui e no mês passado

  OS 5 VEÍCULOS AFETADOS                                    ordenar por: valor ▾
    placa     antes        agora        variação    impacto
    QYP0J87   0,00         4.147,74     —           +4.147,74 /mês   [origem ⧉]
    QYW3J49   0,00         4.395,36     —           +4.395,36 /mês   [origem ⧉]
    QYW4C69   0,00         4.395,36     —           +4.395,36 /mês   [origem ⧉]
    RZH0B37   6.575,37    10.723,11     +63,1%      +4.147,74 /mês   [origem ⧉]
    RZM0B31  16.486,44    11.316,93     −31,4%      −5.169,51 /mês   [origem ⧉]

  O QUE ESTE NÚMERO ASSUME
    Significado confirmado em 10/08/2026 por guyrpeixoto.neto@gmail.com:
    reais, mensal, somável. Impacto = valor novo − valor anterior.
    [ver a célula original]  [ver o histórico do significado]

  ⚠ ATENÇÃO: este atributo é parcela de "Custo fixo — Carreta", que também
    mudou nesta vigência. Os dois não são somados no total acima.

  SUA DECISÃO
    ( ) em análise   ( ) questionar o cliente   ( ) encerrado ▾
    [anotação opcional]
```

Nenhum gráfico foi proposto até aqui, **exceto um**: a série de 9 pontos do
histórico. A decisão que ele melhora é concreta e não tem substituto textual —
distinguir *"caiu uma vez"* de *"vem caindo há quatro meses"* de *"caiu e
voltou"*. Sem ele, o usuário precisa ler nove números e comparar de cabeça. Todo
outro gráfico fica de fora.

---

## 8. O exemplo com dados reais do banco

### 8.1 A vigência mais recente — Agosto/2026

Ao abrir o FreightCheck hoje, o Nível 1 mostraria isto (números extraídos do
banco alimentado pelos arquivos reais):

**267 alterações → 20 cartões.** 8.856 valores não mudaram.

```
Custo fixo mensal:  +R$ 23.341,74 /mês      ← soma honesta (só as parcelas)
                    (+R$ 39.936,28 é o que o sistema mostra hoje, contando
                     "Custo fixo — Carreta" junto com as suas duas parcelas)
Sem preço:          248 mudanças
```

Os cartões, na ordem em que os selos os colocariam:

| Selo | Grupo | Veículos | Antes → Depois | Impacto |
|---|---|--:|---|---|
| 💰 Dinheiro | Custo fixo — Carreta | 5 de 71 | 47.536,85 → 64.131,39 | +16.594,54/mês ⚠ contém as duas linhas abaixo |
| 💰 Dinheiro | FINAME — Cavalo | 5 de 62 | 9.847,35 → 21.764,05 | +11.916,70/mês |
| 💰 Dinheiro | FINAME — Carreta | 5 de 71 | 23.061,81 → 34.978,50 | +11.916,69/mês |
| 💰 Dinheiro | Amortização — Cavalo | 1 de 62 | 7.700,16 → 0,00 | −7.700,16/mês |
| 💰 Dinheiro | Lucro fixo novo ciclo — Cavalo | 1 de 62 | 0,00 → 4.677,85 | +4.677,85/mês |
| 💰 Dinheiro | Lucro fixo novo ciclo — Carreta | 1 de 71 | 0,00 → 4.677,85 | +4.677,85/mês |
| 💰 Dinheiro | Juros FINAME — Cavalo | 1 de 62 | 2.147,19 → 0,00 | −2.147,19/mês |
| ⚠ Ruptura | Fim de contrato — Cavalo | **62 de 62** | data → número (46935.5) | tipo mudou: incomparável |
| 🚚 Toda a frota | Vida da manutenção — Cavalo | **62 de 62** | +1,5% a +13,6% (não somável) | preço travado |
| 🚚 Toda a frota | Vida do combustível — Cavalo | **62 de 62** | +1,5% a +14,5% (não somável) | preço travado |
| 🔒 Preço travado | Lucro variável previsto — Cavalo | 10 de 62 | 28.119,00 → 18.746,00 (−33,3%) | semântica presumida |
| 🔒 Preço travado | Lucro variável previsto — Carreta | 10 de 71 | 43.032,15 → 31.516,14 (−26,8%) | semântica presumida |
| ⚠ Ruptura | Situação — Cavalo | 10 de 62 | mudou de estado | não monetário |
| ⚠ Ruptura | Financiamento — Cavalo | 1 de 62 | "FINAME" → "QUITADO" | não monetário |
| … | e mais 6 grupos menores | | | |

**Hoje isso são 267 linhas.** A informação é exatamente a mesma; a diferença é
que uma pessoa consegue ler a tabela acima em vinte segundos.

### 8.2 O caso que prova o valor do histórico — Julho/2026

Julho é a vigência com 593 alterações (a tela atual mostra 300). O cartão que
importa é um só:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 💰 DINHEIRO                                                                 │
│ IPVA / Licenciamento — Cavalo                        62 de 62 cavalos      │
│ R$ 413.826,30 → R$ 268.951,80              −35,0%                          │
│ impacto  −R$ 144.874,50 /ano                                               │
│ 13 padrões distintos · custo fixo · seguros e tributos                     │
└────────────────────────────────────────────────────────────────────────────┘
```

E ao abrir, o histórico das 9 vigências — que já está no banco e hoje só é
alcançável pela Curadoria:

| Vigência | Placas | Soma da frota | Média por cavalo |
|---|--:|--:|--:|
| dez/2025 | 60 | 989.843,95 | 16.497,40 |
| jan/2026 | 60 | 399.406,30 | 6.656,77 |
| fev/2026 | 62 | 413.826,30 | 6.674,62 |
| mar/2026 | 64 | 413.826,30 | 6.466,04 |
| abr/2026 | 64 | 413.826,30 | 6.466,04 |
| mai/2026 | 62 | 413.826,30 | 6.674,62 |
| jun/2026 | 62 | 413.826,30 | 6.674,62 |
| **jul/2026** | 62 | **268.951,80** | **4.337,93** |
| ago/2026 | 62 | 268.951,80 | 4.337,93 |

Essa tabela conta uma história que nenhuma tela do FreightCheck conta hoje:
**duas quedas em degrau, oito meses, R$ 720.892 a menos por ano** — e a coluna
"média por cavalo" mostra que a subida de jan→fev foi entrada de dois cavalos, e
não aumento de valor. É por isso que a média é obrigatória ao lado da soma.

---

## 9. Lacunas técnicas, item a item

| # | O que proponho | Classificação | Detalhe |
|---|---|---|---|
| 1 | Agrupar por `(atributo, tipo de equipamento, vigência)` | **precisa de endpoint/query** | A query foi escrita e validada nesta auditoria; um `GROUP BY` sobre `change` com `count(DISTINCT value_before‖value_after)`. Zero mudança de schema |
| 2 | Regras anti-mentira do agrupamento (não somar `AVG`/`NONE`, partir por comparabilidade) | **precisa de endpoint/query** | `aggregation` e `comparability` já estão gravados na própria linha de `change` |
| 3 | Seis selos de prioridade | **precisa de endpoint/query** | Todos os campos existem: `impact_confidence`, `nature`, `semantics_status`, `is_monetary`, `snapshot.entity_count` |
| 4 | Tela Nível 1 com cartões + veredicto | **precisa apenas de frontend** | Consome o endpoint de (1) |
| 5 | Nível 2: veículos do grupo | **já existe** | `listChanges(changeSetId, { attributeCode })` |
| 6 | Nível 2: proveniência até a célula | **já existe** | `GET /changes/:id/provenance` |
| 7 | Nível 2: histórico das 9 vigências com **média e nº de placas** | **existe parcialmente** | `getAttributeDetail(...).history` tem soma e contagem; falta expor por rota própria (hoje só vem embutido na Curadoria) e acrescentar a média |
| 8 | Corrigir a soma pai + parcela | **precisa de endpoint/query** | `change.taxonomy_path` já está gravado; a soma passa a considerar só nós folha, e o cartão do nó pai exibe o aviso. **Não requer schema** |
| 9 | Corrigir o desempate da "última comparação" | **precisa apenas de backend** | Uma cláusula `ORDER BY` a mais em `getOverview`, e devolver as duas séries |
| 10 | Curadoria ordenada por *alterações destravadas* | **precisa de endpoint/query** | `count(*)` de `change` bloqueado por atributo — o dado está lá, a ordenação é por magnitude monetária |
| 11 | Estados de decisão por grupo | **precisa alterar modelo de dados** | Tabela nova `change_review(attribute_code, entity_type, effective_date, state, reason, actor, created_at)`. Chave semântica **obrigatoriamente**, porque `computeChangeSet` apaga e reconstrói os `change.id` |
| 12 | Fundir `/` + `/alteracoes`; `/comparar` vira seletor | **precisa apenas de frontend** | Mesmo componente, mesma API |
| 13 | Renomear vocabulário técnico na interface | **precisa apenas de frontend** | Mapa de rótulos; nada muda no banco |
| 14 | Tirar `/simulacao`, `/snapshots` do roteador ativo | **precisa apenas de frontend** | Chamam endpoints inexistentes desde a troca de schema |
| 15 | Rebaixar Análise de Frota a "Legado" | **precisa apenas de frontend** | A rota e o endpoint continuam; sai do menu principal |
| 16 | Recorrência como selo | **não recomendo fazer agora** | Testado: a definição ingênua marca 20 de ~25 atributos. Precisa de calibração com dado real antes de virar sinal |
| 17 | Waterfall de impacto | **não recomendo fazer agora** | Depende de (8) estar resolvido; um waterfall que não fecha passa confiança falsa |
| 18 | Simulação sobre `lib/simulation` | **não recomendo fazer agora** | A biblioteca está pronta e testada, mas simular antes de o impacto apurado estar correto é construir sobre o problema (8) |
| 19 | Explicações em texto por IA | **não recomendo fazer agora** | O veredicto do Nível 1 sai de regra determinística. IA só depois que a regra estiver estável |

---

## 10. Plano mínimo de implementação

### P0 — o essencial para o FreightCheck virar uma ferramenta de decisão

Cinco itens. Nenhum toca o schema.

1. **Corrigir a soma pai + parcela no impacto.** É o único número em destaque do
   produto e está 71% inflado em Ago/2026. Usa `taxonomy_path`, já gravado.
   *(backend)*
2. **Corrigir o desempate da "última comparação"** e devolver as duas séries.
   Hoje o painel esconde a série de maior impacto. *(backend, poucas linhas)*
3. **`GET /changes/grouped?period=`** — agrupamento por atributo × equipamento,
   com as sete regras anti-mentira e os seis selos. *(endpoint novo, query já
   validada)*
4. **Tela Nível 1 + Nível 2 numa página só**, substituindo `/` e absorvendo
   `/alteracoes`. Cartões, veredicto, expansão no lugar, veículos, proveniência.
   *(frontend)*
5. **Vocabulário em português na interface** e remoção das rotas mortas do
   roteador. *(frontend)*

Depois do P0, o cenário do briefing fica: **abrir → ler 5 cartões → expandir 1 →
ver os veículos e a célula.** Uma tela, dois cliques, abaixo de um minuto. Seis
das sete perguntas do briefing respondidas.

### P1 — melhora importante

6. **Estados de decisão por grupo** (`change_review`, chave semântica) e a faixa
   "o que você já decidiu". Fecha a sétima pergunta. *(schema)*
7. **Histórico das 9 vigências dentro do cartão**, com média por veículo e nº de
   placas — o gráfico único que proponho. *(endpoint + frontend)*
8. **Curadoria ordenada por quantas alterações cada confirmação destrava**, com
   entrada direta a partir do cartão travado. Sete confirmações destravam 2.062
   das 2.720 alterações sem preço. *(query + frontend)*
9. **`/comparar` vira o seletor** do cabeçalho; `/vigencias` vira a aba de
   histórico. *(frontend)*
10. **Versões fundida em "Significados"**, alcançável pelo cartão. *(frontend)*

### P2 — sofisticação futura

11. Recorrência como selo, depois de calibrada com dado real.
12. Waterfall que fecha com o total, com barra de "não atribuído".
13. Simulação sobre `lib/simulation`, já pronta e sem consumidor.
14. Aviso ativo quando uma vigência nova chega ("3 mudanças precisam de você").
15. Explicações em texto, gravadas em tabela separada, com marca visual própria.

---

## Riscos desta proposta

| Risco | Mitigação |
|---|---|
| Agrupar esconder dispersão relevante | Nº de padrões distintos, faixa mín/máx e nº de veículos sempre visíveis; agrupamento nunca atravessa comparabilidade nem confiança de impacto |
| Somar o que não é somável | Só `aggregation = SUM` produz agregado; o resto mostra média e faixa, com a frase "não somável" |
| Os selos escondendo algo importante atrás do "sem sinal" | O bloco colapsado sempre diz quantas são e abre com um clique; nenhum filtro é aplicado por padrão |
| A decisão evaporar num recálculo | Chave semântica, nunca `change_id` |
| Perder rastreabilidade ao agrupar | Todo cartão desce até a placa e daí até a célula, sem sair da página |
| Confundir "menos telas" com "menos capacidade" | Nada é removido: `/comparar`, `/vigencias`, `/versoes` continuam existindo, mudam de porta de entrada |

---

## Perguntas que preciso que você responda antes do P0

1. **A identidade `custoFixo = finame + lucroFixomodeloNovoCiclo` vale sempre?**
   Se sim, o total passa a somar só as parcelas. Se houver casos em que o total
   não é a soma, preciso saber para não trocar um erro por outro.
2. **Os quatro estados de decisão bastam?** Ou existe um passo intermediário
   real no seu processo que eu não enxerguei.
3. **O limiar de "toda a frota" é 50%?** E existe um piso de valor abaixo do qual
   você simplesmente não quer ser incomodado?
4. **"Fim de contrato" virando serial do Excel em 62 cavalos** — é erro de
   exportação do cliente ou mudança real? Muda se isso é ruptura ou ruído.
