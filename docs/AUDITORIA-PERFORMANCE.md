# Auditoria de performance do FreightCheck

**Data:** 26/08/2026 · **Método:** medição, não intuição.

Tudo aqui foi medido contra um FreightCheck de verdade: Postgres 16 local com os
dois workbooks do Freightec importados pelo caminho do produto (`pnpm dev:seed`)
— **124.632 fatos, 144 ativos, 138 atributos, 18 vigências, 109 MB** —, a API
compilada em modo produção e o bundle de produção servido a um Chromium real
dirigido por Playwright.

Onde uma medição não foi possível neste ambiente, está declarado em
[§10 Limitações](#10-limitações-o-que-não-deu-para-medir). Nenhuma conclusão
depende de uma medição que não existe.

---

## 1. Resumo executivo

O FreightCheck **não é lento por causa do React nem por causa do Postgres**. As
duas suspeitas mais comuns foram medidas e descartadas: o tempo de bloqueio da
main thread é 0–33 ms em **todas** as 38 telas, e o SQL responde em 0,1–200 ms
em quase toda a superfície.

O que faz o produto parecer lento, em ordem de impacto medido:

1. **Uma folha de estilo de terceiro bloqueia a primeira pintura.** Duas
   chamadas ao Google Fonts seguram a tela em branco. Medido: **FCP 12.732 ms →
   320 ms** quando elas não bloqueiam. É o maior número da auditoria inteira.
2. **A política de retry cobra até 13,2 s de espera pura.** Uma chamada que
   falha três vezes transforma uma tela de 350 ms numa de **5.243 ms** — com o
   SQL inalterado em 180 ms. É o exemplo do §27 do pedido, medido.
3. **Cada consulta ao banco é um round trip serializado.** Endpoints fazem 22 a
   49 consultas em sequência. No localhost isso custa ~0; contra um Neon
   distante custa `nº de consultas × RTT`. Medido: `/api/changes/families` sai
   de 222 ms para 538 ms só levando o RTT de 0 a 15 ms.
4. **A API não comprime nada.** 165 KB indo pela rede onde caberiam 5 KB (31,7×).
5. **JIT do Postgres domina o Balanço de Massa:** 1.017 ms → 285 ms com `jit=off`.
6. **`toLocaleString` por chamada** custa 44,5× o de um `Intl.NumberFormat`
   reutilizado — e é o topo do perfil de CPU da DRE.

---

## 2. Ranking das telas

Navegação SPA (clique no menu → tela pronta), mediana de 3 medições, warm,
localhost. `bloqueio` é Total Blocking Time da main thread.

| # | Tela | Respostas | Texto pronto | Bloqueio | Requests | Ondas | API mais lenta | Payload | Nota |
|--:|------|----------:|-------------:|---------:|---------:|------:|---------------:|--------:|------|
| 1 | `/balanco-massa` | **1.399 ms** | 58 ms | 0 ms | 2 | 1 | 1.203 ms | 12 KB | Ruim |
| 2 | `/dre` | **1.130 ms** | 63 ms | 0 ms | 2 | 1 | 1.049 ms | 86 KB | Ruim |
| 3 | `/fechamento/remuneracao` | 284 ms | 50 ms | 0 ms | 1 | 1 | 315 ms | 8 KB | Excelente |
| 4 | `/impacto-financeiro` | 279 ms | 51 ms | 0 ms | 2 | 1 | 232 ms | 39 KB | Excelente |
| 5 | `/curadoria` | 274 ms | 274 ms | 0 ms | 3 | **2** | 298 ms | 86 KB | Excelente |
| 6 | `/dashboard` | 265 ms | 50 ms | 0 ms | 1 | 1 | 150 ms | 95 KB | Excelente |
| 7 | `/parametros` | 261 ms | 310 ms | 0 ms | 1 | 1 | 180 ms | 95 KB | Excelente |
| 8 | `/vigencia` | 248 ms | 50 ms | 0 ms | 1 | 1 | 167 ms | 50 KB | Excelente |
| 9 | `/resumo-executivo` | 235 ms | 51 ms | 0 ms | 1 | 1 | 191 ms | 95 KB | Excelente |
| 10 | `/gestao-a-vista` | 226 ms | 250 ms | 0 ms | 1 | 1 | 206 ms | 95 KB | Excelente |
| 11 | `/linha-do-tempo` | 219 ms | 87 ms | 27 ms | 1 | 1 | 156 ms | 95 KB | Excelente |
| 12 | `/cavalo-360` | 175 ms | 64 ms | 0 ms | 2 | 1 | 136 ms | 46 KB | Excelente |
| 13 | `/dados` | 146 ms | 51 ms | 0 ms | 1 | 1 | 112 ms | 62 KB | Excelente |
| 14 | `/carreta-360` | 142 ms | 196 ms | 0 ms | 7 | 1 | 132 ms | 46 KB | Excelente |
| 15 | `/composicao` | 141 ms | 57 ms | 0 ms | 1 | 1 | 97 ms | 29 KB | Excelente |
| 16 | `/justificativas` | 108 ms | 127 ms | 0 ms | 5 | **3** | 42 ms | 168 KB | Excelente |
| 17 | `/alteracoes` | 105 ms | 102 ms | 33 ms | 2 | 1 | 25 ms | 87 KB | Excelente |
| — | as outras 21 telas | < 50 ms | ~50 ms | 0 ms | 0–4 | 1–3 | < 30 ms | < 32 KB | Excelente |

**Duas telas fora da meta de 1 s, e nenhuma delas por causa do frontend.** As duas
gastam o tempo esperando um endpoint.

### E a primeira carga?

A tabela acima mede a **troca de tela**. A **entrada no produto** é outra
história, e é lá que está o pior número:

| Cenário (mesma máquina, mesmo app) | FCP | LCP | DCL | load |
|---|--:|--:|--:|--:|
| Como está hoje | **12.732 ms** | 12.812 ms | 12.689 ms | 12.693 ms |
| Sem as chamadas ao Google Fonts | **320 ms** | 408 ms | 269 ms | 270 ms |
| Google Fonts respondendo na hora | **272 ms** | 356 ms | 236 ms | 237 ms |

O JS do produto termina de baixar em **28 ms**. Entre 28 ms e 12.689 ms não há
uma única long task — a main thread está parada, esperando a rede.

---

## 3. Ranking dos 10 maiores gargalos

| # | Gargalo | Impacto medido | Evidência | Confiança |
|--:|---|--:|---|---|
| 1 | `<link>`/`@import` do Google Fonts bloqueiam a primeira pintura | **+12.412 ms** (pior caso) · +100–300 ms (caso normal) | A/B no navegador: 12.732 → 320 ms | **COMPROVADO** |
| 2 | Backoff do retry: 5 tentativas, 400/1.200/3.600/8.000 ms | **+4.893 ms** com 3 falhas · **+13.200 ms** no limite | 503 injetado: 350 → 454 → 1.706 → 5.243 ms | **COMPROVADO** |
| 3 | Round trips serializados ao banco (22–49 por endpoint) | **+21 ms por ms de RTT** em `/changes/families` | Proxy TCP com atraso: 0/5/15 ms | **COMPROVADO** |
| 4 | JIT do Postgres na consulta do Balanço de Massa | **+732 ms** em `/api/balance` | `jit=off`: 1.017 → 285 ms; `EXPLAIN`: 1.302 → 416 ms | **COMPROVADO** |
| 5 | `toLocaleString` por chamada (DRE, Composição, Frota) | **−254 a −325 ms** por endpoint da DRE | Perfil de CPU (15,9% em `formatarNumero`) + A/B | **COMPROVADO** |
| 6 | API sem compressão HTTP | 8,3× a 31,7× de banda desperdiçada | `content-encoding: nenhuma` em todos os endpoints | **COMPROVADO** |
| 7 | `staleTime: 0` em 126 das 144 consultas | 95 KB + 180 ms + 22 consultas a cada revisita | A→B→A→B: `/changes/families` refeita toda vez | **COMPROVADO** |
| 8 | Bundle único de 2,54 MB, sem code splitting | 807 ms de download em 4G · ~160–280 ms de execução | `vite build` + timings de recurso | **COMPROVADO** |
| 9 | Cascata artificial na DRE do veículo (`enabled: Boolean(data)`) | **+97 ms** | Waterfall: 1ª chamada 18→138 ms, as outras só começam em 145 ms | **COMPROVADO** |
| 10 | Saturação em ~47 req/s; p95 5× de 1 → 20 usuários | 208 → 1.006 ms (p95) | Teste 1/5/10/20 usuários | **COMPROVADO** |

### O que foi investigado e **DESCARTADO**

| Suspeita | Veredito | Evidência |
|---|---|---|
| React renderizando demais / falta `useMemo` | **DESCARTADO** | Bloqueio de 0 ms em 34 das 38 telas; máximo 33 ms |
| Tabelas grandes sem virtualização | **DESCARTADO** | Há paginação (100/página, teto 300). Virtualizar não tem o que resolver |
| Pool de conexões pequeno demais | **DESCARTADO** | `DB_POOL_MAX` 10 vs 30 com 20 usuários: p95 1.017 vs 1.056 ms — indistinguível |
| Cold start do processo Node | **DESCARTADO** | 954 ms do `exec` até `/api/contexts` responder 200 |
| Requests duplicados | **DESCARTADO** | Um único caso: `/api/build` duas vezes em `/justificativas` |
| Requests em cascata desnecessária | Quase tudo em paralelo | 33 das 38 telas disparam tudo numa onda só |
| N+1 clássico ("1 + 110 consultas") | Não existe | O pior caso é 49 consultas com 18 repetições — ruim, mas limitado |

---

## 4. Waterfall das telas críticas

### 4.1 Entrada no produto (a pior de todas)

```
0 ms     navegação
+3 ms    TTFB do index.html
+9 ms    JS começa a baixar
+28 ms   JS pronto (2,54 MB descomprimidos, 674 KB na rede)
+7 ms    <link> fonts.googleapis.com  ─┐
+18 ms   @import fonts.googleapis.com ─┤ as duas BLOQUEIAM a pintura
         ...                           │
+12.581 ms  a primeira desiste         │
+12.602 ms  a segunda desiste         ─┘
+12.689 ms  DOMContentLoaded  ← 12,5 s de tela branca, main thread parada
+12.732 ms  FCP
+12.812 ms  LCP
+13.262 ms  GET /api/auth/session
+13.312 ms  6 chamadas em paralelo (contexts, change-sets, imports, …)
+14.418 ms  a última responde (/api/balance, 1.106 ms)
──────────
TELA PRONTA: ~14.400 ms   (dos quais ~1.700 ms são o FreightCheck)
```

Sem as fontes bloqueando, a mesma sequência termina em **~1.900 ms**.

### 4.2 `/balanco-massa` — 1.399 ms

```
0 ms      troca de rota
+16 ms    GET /api/balance            ┐ as duas em paralelo (correto)
+16 ms    GET /api/balance/:importRun ┘
          dentro de /api/balance:
             3 consultas · 994 ms de SQL · 23 ms de Node
             1 consulta responde por 982 ms dela
             dessa consulta, ~790 ms são compilação JIT do Postgres
+1.399 ms última resposta
+58 ms    (o texto da tela já estava pronto desde os 58 ms)
```

Cadeia causal: **não é "Postgres lento"**. É JIT ligado sobre uma consulta cara
o bastante para acioná-lo, que roda em 416 ms quando não é compilada.

### 4.3 `/dre` e a DRE de um veículo

```
/dre:
0 ms      troca de rota
+18 ms    GET /dre/fleet     → 384 ms   (84 KB, 14 consultas, 152 ms de Node)
+18 ms    GET /dre/history   → 1.050 ms (2 KB!, 49 consultas, 642 ms de Node)
+1.130 ms TELA PRONTA        ← 2 KB de resposta custando 1 segundo

/dre/:entityId (abrir um veículo):
0 ms      clique
+31 ms    GET /dre/unit/:id            → 138 ms
+145 ms   GET /dre/unit/:id/bridge     ┐ só começam DEPOIS da primeira,
+146 ms   GET /dre/unit/:id/history    ┘ por `enabled: Boolean(data)`
+1.019 ms TELA PRONTA
```

`bridge` e `history` **não usam** o resultado da primeira chamada — só o
`entityId` e o `escopo`, que vêm da URL. A espera é gratuita: +97 ms.

Os 642 ms de Node em `/dre/history` estão perfilados em §6.

---

## 5. Frontend

### 5.1 Render React: não é o problema

| Métrica | Resultado |
|---|---|
| Bloqueio (TBT) na troca de tela | **0 ms em 34 das 38 telas**; máximo 33 ms (`/alteracoes`) |
| Maior tarefa única | 83 ms (`/alteracoes`), 77 ms (`/linha-do-tempo`), 0 ms no resto |
| Perfil de CPU de `/analise-equipamentos` numa janela de 6.018 ms | **6.007 ms de `(idle)`** |

Uma primeira versão do harness marcou `/analise-equipamentos` como a pior tela
(2.116 ms). Era erro de medição: as animações de entrada do Recharts mantêm o
DOM mudando depois de a tela estar pronta. O perfil de CPU derrubou a hipótese.
Fica registrado porque é exatamente o tipo de conclusão que uma auditoria por
intuição teria entregue como verdade.

**Não recomendo `useMemo`, `React.memo` nem virtualização.** Não há evidência de
que rendam nada, e as tabelas já são paginadas (100 por página, teto de 300).

### 5.2 Bundle

`dist/public/assets/index-*.js`: **2.540,80 KB** (689,82 KB gzip), **um único
chunk**. `App.tsx` importa as ~60 páginas estaticamente; não há `lazy`/
`dynamic import` em lugar nenhum.

| Origem | KB | % |
|---|--:|--:|
| `recharts` | 614 | 11,2% |
| `react-dom` | 527 | 9,6% |
| `pages/fechamento` | 336 | 6,1% |
| `components/changes` | 309 | 5,6% |
| `motion-dom` + `framer-motion` | 383 | 7,0% |
| `lodash` (puxado pelo recharts) | 189 | 3,4% |

Custo real medido: 85 ms de download local, 385 ms em 20 Mb/s, **807 ms em 4G**;
execução ~160–280 ms. É real, mas é o **8º** da lista — não o primeiro.

### 5.3 Formatação no cliente

`src/lib/utils.ts` cria um `Intl.NumberFormat` **por chamada** em
`formatCurrency` e `formatPercent` (o mesmo defeito do servidor, §6). Hoje não
aparece no perfil porque as tabelas são pequenas; vira problema quando crescerem.

---

## 6. Backend

Perfis com 9 execuções aquecidas cada, contagem de consultas conferida contra o
log do Postgres (`log_min_duration_statement = 0`, atividade de fundo = 0).

| Endpoint | p50 | p95 | frio | Consultas | SQL | Fora do banco | Payload |
|---|--:|--:|--:|--:|--:|--:|--:|
| `/api/balance/:id` | 1.066 ms | 1.155 ms | 1.136 ms | 7 | ~1.000 ms | ~60 ms | 6 KB |
| `/api/balance` | 1.017 ms | 1.046 ms | 1.063 ms | 3 | 994 ms | 23 ms | 6 KB |
| `/api/dre/unit/:id/history` | 753 ms | 805 ms | — | 49 | 112 ms | **641 ms** | 2 KB |
| `/api/dre/history` | 747 ms | 788 ms | 745 ms | 49 | 105 ms | **642 ms** | 2 KB |
| `/api/remuneracao/situacao` | 259 ms | 266 ms | 265 ms | 10 | 248 ms | 11 ms | 8 KB |
| `/api/impacto/panorama` | 224 ms | 242 ms | 231 ms | 10 | 201 ms | 23 ms | 38 KB |
| `/api/curation/queue` | 200 ms | 283 ms | 208 ms | 4 | 188 ms | 11 ms | 85 KB |
| `/api/changes/families` | 179 ms | 234 ms | 189 ms | 22 | 140 ms | 39 ms | 95 KB |
| `/api/dre/fleet` | 177 ms | 198 ms | 219 ms | 14 | 22 ms | **155 ms** | 84 KB |
| `/api/changes/grouped` | 171 ms | 177 ms | 175 ms | 18 | 138 ms | 33 ms | 50 KB |
| `/api/dre/unit/:id/bridge` | 139 ms | 157 ms | — | 43 | 36 ms | 104 ms | 2 KB |
| `/api/coverage?vigencias=6` | 107 ms | 111 ms | 120 ms | 27 | 70 ms | 36 ms | 62 KB |
| `/api/frota/panorama` | 95 ms | 98 ms | 96 ms | 25 | 18 ms | **76 ms** | 46 KB |
| `/api/composition/fleet` | 87 ms | 107 ms | 119 ms | 12 | 18 ms | **69 ms** | 29 KB |
| `/api/changes/consolidated` | 46 ms | 50 ms | 41 ms | 26 | 31 ms | 15 ms | 87 KB |
| as outras 23 rotas medidas | 2–26 ms | ≤ 34 ms | ≤ 38 ms | 1–11 | ≤ 8 ms | ≤ 20 ms | ≤ 165 KB |

### 6.1 Onde os 642 ms de Node da DRE são gastos

Perfil de CPU do processo (25 requisições a `/api/dre/history`, 22.047 ms
amostrados):

| Função | ms | % |
|---|--:|--:|
| `formatarNumero` (`lib/dre/src/normalizacao.ts:114`) | 3.505 | **15,9%** |
| `comporDeFatos` (`lib/composition/src/motor.ts:690`) | 2.031 | 9,2% |
| (anônima em `motor.ts`) | 1.887 | 8,6% |
| garbage collector | 1.499 | 6,8% |
| `parseRow` (driver `pg`) | 1.489 | 6,8% |
| `humanise` (`lib/comparison/src/labels.ts:91`) | 1.247 | 5,7% |
| `placementOf` (`lib/comparison/src/families.ts:464`) | 948 | 4,3% |
| `formatarNumero` (`lib/composition/src/motor.ts:932`) | 502 | 2,3% |

`formatarNumero` é, nos dois arquivos:

```ts
return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
```

`toLocaleString` **com opções constrói um `Intl.NumberFormat` novo a cada
chamada**. Medido, 200.000 chamadas:

| | tempo | por chamada |
|---|--:|--:|
| `toLocaleString(opts)` | 5.002 ms | 25,01 µs |
| `Intl.NumberFormat` reutilizado | 112 ms | 0,56 µs |
| **fator** | | **44,5×** |

Saída idêntica (`"1.234,50"` nos dois).

### 6.2 Custo fixo por requisição

Toda requisição autenticada custa **2 consultas** (`user_session ⋈ app_user`) —
e o `GET /api/auth/session` executa essa mesma consulta **duas vezes**, medido
no log do Postgres. Em números absolutos é pouco (5 ms warm), mas escala com o
RTT do banco: a 15 ms de RTT vira 36,6 ms **antes de a rota começar**.

### 6.3 Compressão: ausente

Não há middleware de compressão em `app.ts` nem a dependência no `package.json`.

| Endpoint | Enviado | Se fosse gzip | Fator |
|---|--:|--:|--:|
| `/api/change-sets/:id/changes` | 165 KB | 5 KB | **31,7×** |
| `/api/changes/consolidated` | 87 KB | 4 KB | 20,2× |
| `/api/coverage` | 62 KB | 3 KB | 20,1× |
| `/api/curation/queue` | 85 KB | 5 KB | 16,5× |
| `/api/frota/panorama` | 46 KB | 4 KB | 11,4× |
| `/api/changes/families` | 95 KB | 12 KB | 8,3× |
| `/api/dre/fleet` | 84 KB | 11 KB | 7,6× |

---

## 7. Banco

### 7.1 Round trips: o número que o localhost esconde

Um proxy TCP com atraso injetado entre o Node e o Postgres transforma "este
endpoint faz N consultas" em milissegundos:

| Endpoint | Consultas | RTT 0 ms | RTT 5 ms | RTT 15 ms | **ms por ms de RTT** |
|---|--:|--:|--:|--:|--:|
| `/api/frota/panorama` | 25 | 111 | 206 | 438 | **21,9** |
| `/api/changes/families` | 22 | 222 | 298 | 538 | **21,0** |
| `/api/coverage` | 27 | 135 | 221 | 440 | **20,4** |
| `/api/changes/consolidated` | 26 | 60 | 148 | 356 | **19,8** |
| `/api/composition/fleet` | 12 | 92 | 123 | 227 | **9,0** |
| `/api/dre/history` | 49 | 846 | 813 | 912 | 4,4 |
| `/api/contexts` | 3 | 7 | 22 | 55 | **3,2** |
| `/api/auth/session` | 2 | 7 | 15 | 37 | **2,0** |

A inclinação é praticamente **igual ao número de consultas**: nada é agrupado,
nada é pipelinado — cada consulta é uma ida e volta que espera a anterior.

**O que isso significa em produção.** Se a API e o Neon estiverem na mesma
região (RTT ~2 ms), o custo é modesto: +44 ms em `/changes/families`. Se
estiverem em regiões diferentes — o erro de configuração mais comum no Replit,
com RTT de 60 ms —, o mesmo endpoint passa de 222 ms para **~1,5 s**, e
`/frota/panorama` para **~1,4 s**, sem uma linha de código mudar.

**Esta é a primeira coisa a conferir no ambiente real** (§10).

### 7.2 A consulta do Balanço de Massa e o JIT

`EXPLAIN (ANALYZE, BUFFERS)` da consulta de `lib/balance/src/balanco.ts:169`:

| | Execution Time | Primeiro nó (`Seq Scan on raw_sheet`, 2 linhas) |
|---|--:|--:|
| Como está (`jit=on`, padrão) | **1.302 ms** | `actual time=797.225..797.232` |
| `SET jit = off` | **416 ms** | `actual time=0.010..0.011` |

797 ms de *startup* num seq scan de 2 linhas e 1 página não é I/O — é a
compilação JIT sendo contabilizada no primeiro nó executado. O custo estimado
passa de `jit_above_cost` (100.000) e o Postgres compila; o trabalho de verdade
são 416 ms.

A/B no endpoint inteiro:

| Endpoint | `jit=on` | `jit=off` | Ganho |
|---|--:|--:|--:|
| `/api/balance` | 1.017 ms | **285 ms** | **−72%** |
| `/api/balance/:id` | 1.066 ms | **468 ms** | **−56%** |
| `/api/changes/grouped` | 171 ms | 148 ms | −14% |
| `/api/changes/families` | 179 ms | 159 ms | −11% |
| todos os outros | — | — | sem diferença |

Nenhum índice foi criado, e **nenhum é recomendado**: os planos usam os índices
existentes (`validation_issue_run_code_idx` entre eles), e os seq scans que
aparecem são sobre tabelas de 2 e 142 linhas, onde índice é mais caro.

### 7.3 Consultas repetidas dentro de uma requisição

| Endpoint | Repetição | Vezes |
|---|---|--:|
| `/api/dre/history` | `SELECT e.id … entity_identifier …` | 18× |
| `/api/dre/history` | `SELECT a.id, a.code … attribute …` | 18× |
| `/api/dre/history` | `SELECT f.entity_id … fact …` | 18× |
| `/api/coverage` | `SELECT count(*) … snapshot …` | 12× |
| `/api/changes/families` | `SELECT DISTINCT snapshot_b_id …` | 6× |

São 18 vigências × a mesma leitura de catálogo. Não é o N+1 clássico de "1 + 110
consultas" — é **o mesmo catálogo relido uma vez por vigência**, e o catálogo
não muda entre elas.

### 7.4 Pool: não é o gargalo

| `DB_POOL_MAX` | 20 usuários — p50 | p95 | p99 | Vazão |
|--:|--:|--:|--:|--:|
| 10 (padrão) | 210 ms | 1.017 ms | 1.089 ms | 48,2 req/s |
| 30 | 250 ms | 1.056 ms | 1.119 ms | 47,7 req/s |

Indistinguível. **Não aumente o pool.** A saturação é de CPU (Node + Postgres em
4 núcleos), não de conexões.

### 7.5 Concorrência

| Usuários | p50 | p95 | p99 | Pior | Vazão | Erros | RSS |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 52 ms | 192 ms | 257 ms | 257 ms | 11,7 req/s | 0 | 269 MB |
| 5 | 71 ms | 296 ms | 338 ms | 339 ms | 40,8 req/s | 0 | 295 MB |
| 10 | 129 ms | 556 ms | 608 ms | 627 ms | 46,0 req/s | 0 | 361 MB |
| 20 | 210 ms | 1.017 ms | 1.089 ms | 1.139 ms | 48,2 req/s | 0 | 529 MB |

A vazão satura em ~47 req/s a partir de 10 usuários; a latência cresce
linearmente depois disso. Zero erros. ~47 req/s são ~9,5 navegações por segundo
— folgado para a operação atual, apertado se o uso crescer.

---

## 8. Cache e dados de baixa volatilidade

`App.tsx` define a política global sem `staleTime`, então o padrão do React
Query (`staleTime: 0`) vale para **126 das 144 consultas** do produto: toda
montagem refaz a chamada.

Medido, navegando A→B→A→B→A:

| Visita | Tela | Chamadas | Bytes |
|--:|---|--:|--:|
| 1ª | `/resumo-executivo` | 5 | 165 KB |
| 2ª | `/alteracoes` | 2 | 87 KB |
| 3ª | `/resumo-executivo` | **1** | **95 KB** |
| 4ª | `/alteracoes` | **2** | **87 KB** |
| 5ª | `/resumo-executivo` | **1** | **95 KB** |
| 6ª | `/dashboard` | 2 | 148 KB |
| 7ª | `/resumo-executivo` | **1** | **95 KB** |

`/api/changes/families` — 95 KB, 22 consultas, 179 ms — é refeito **toda vez**,
e é consumido por **cinco telas**: Resumo executivo, Dashboard, Linha do tempo,
Parâmetros e Gestão à Vista. Ele responde sobre vigências já fechadas: entre uma
importação e a seguinte, o resultado é idêntico.

O que **não** está errado: os contadores da lateral e o seletor de contexto já
declaram `staleTime` (30–60 s) e não refazem nada — é por isso que a 3ª visita
custa 1 chamada e não 5.

---

## 9. Infraestrutura e rede

### 9.1 O que foi comprovado

**Dependência de terceiro no caminho crítico da primeira pintura.** Duas
chamadas ao `fonts.googleapis.com`:

1. `artifacts/freightaudit/index.html:18` — `<link rel="stylesheet">` da fonte
   **Inter**, que **não é usada** (`--app-font-sans: 'Montserrat'`).
2. `artifacts/freightaudit/src/index.css:1` — `@import url(...)` de Montserrat +
   JetBrains Mono, que entra no CSS empacotado e bloqueia depois dele.

Enquanto elas não respondem, **o navegador não pinta**. Neste ambiente elas
levam 12,5 s para desistir. Na rede corporativa da Ambev — proxy, allowlist de
domínios — o comportamento tende a ser exatamente esse. Numa rede aberta, custam
100–300 ms. Não há caminho em que compensem.

**Retry: 13,2 s de espera pura.** `PADRAO_DAS_CONSULTAS` aplica a política de
`resiliencia.ts` às 144 consultas: até 5 tentativas, espera
`min(400 × 3^n, 8000)` ms.

| Tentativa | Espera | Acumulado |
|--:|--:|--:|
| 2ª | 400 ms | 400 ms |
| 3ª | 1.200 ms | 1.600 ms |
| 4ª | 3.600 ms | 5.200 ms |
| 5ª | 8.000 ms | **13.200 ms** |

Medido com 503 injetado em `/api/changes/families` (o SQL levou 180 ms nas cinco):

| Falhas | Tela pronta em |
|--:|--:|
| 0 | 350 ms |
| 1 | 454 ms |
| 2 | **1.706 ms** |
| 3 | **5.243 ms** |

A política existe por um bom motivo (um Repl acordando leva segundos). O
problema não é insistir — é **insistir em silêncio**: quem está olhando vê
5 segundos de "Carregando…" sem nenhuma pista de que houve falha e nova
tentativa.

### 9.2 Cold start (do processo)

| Marco | Tempo |
|---|--:|
| `exec` → `GET /api` responde 200 | 871 ms |
| `exec` → `GET /api/contexts` responde 200 | 954 ms |
| 1ª `/changes/families` (fria) | 237 ms |
| 2ª `/changes/families` (quente) | 188 ms |

O processo em si sobe rápido e a diferença warm/cold nas consultas é de ~50 ms.
**O cold start do Node não é gargalo.** O que não dá para medir aqui é o tempo de
provisionar o contêiner do autoscale antes do `exec` (§10).

### 9.3 Um achado de disponibilidade, não de performance

`GET /api/fleet-analysis/summary` respondeu **500** no fim da auditoria e 200 no
começo, sem mudança de código. A rota lê um `.xlsx` do disco resolvendo
`attached_assets` a partir de `process.cwd()`
(`routes/fleet-analysis.ts:16-21`) — é a única do produto que depende de um
arquivo no disco em vez do banco. No Replit, onde o disco não sobrevive a um
deploy, isso é frágil por construção. A tela **Análise de Equipamentos** depende
inteiramente dela.

---

## 10. Limitações: o que **não** deu para medir

Declarado, e nenhuma conclusão acima depende disto:

1. **Replit, ReplShield, proxy, redirects, CORS, gateway.** Este ambiente não é
   o Replit. Não houve como observar `replit.com/__replshield`, interstício de
   autenticação, redirect entre domínios, conexões encerradas pelo gateway nem
   requisições que não chegam ao Express. O mecanismo do §9.1 (navegador preso
   num recurso de terceiro) é **a mesma classe de problema** e está comprovado —
   se houver um bloqueio de shield, o sintoma será esse.
2. **Latência real até o Neon.** Medi a *sensibilidade* (§7.1), não o valor. O
   número que falta é um só: o RTT entre a região da API e a do Neon.
   `SELECT 1` cronometrado do processo da API responde isso em um minuto.
3. **Cold start do contêiner do autoscale** (antes do `exec`).
4. **Rede e máquina do usuário real.** Medi em 3 perfis (sem limite, 20 Mb/s, 4G).
5. **Telas sem dado no seed.** Radar de Trechos (404 — não há dado de TRECHO),
   QLP Administrativo (404), e todo o módulo Fechamento (sem competências) não
   puderam ser medidos com carga real. **Os números delas na tabela do §2 não
   valem como veredito.**
6. **p50/p95/p99 históricos de produção.** Não há volume histórico; os
   percentis aqui vêm de 9 execuções controladas por endpoint.
7. **Vazamento de memória.** O RSS cresce 269 → 529 MB sob 20 usuários, o que é
   esperado sob carga. Provar (ou descartar) leak exige um teste prolongado.

---

## 11. Plano de correção

Todo ganho abaixo é **medido**, exceto onde diz "estimado".

### P0 — grande impacto, correção simples e segura

| # | Correção | Gargalo | Antes | Depois | Ganho | Risco | Complexidade |
|--:|---|---|--:|--:|--:|---|---|
| 1 | Servir Inter/Montserrat/JetBrains do próprio domínio (ou `<link>` não bloqueante) e remover a Inter, que não é usada | §3.1 | FCP 12.732 ms | FCP 320 ms | **−12.412 ms** (pior caso) · −100 a −300 ms (normal) | Nenhum | 1 arquivo + fontes locais |
| 2 | `compression()` no Express | §6.3 | 165 KB | 5 KB | **até 31,7×** de banda; −160 ms em 4G por tela pesada | Nenhum | 2 linhas |
| 3 | `Intl.NumberFormat` no módulo (2 arquivos) + memoizar `humanise`/`placementOf` | §6.1 | `/dre/history` 747 ms | 492 ms | **−254 ms** · `/dre/unit/:id/history` −325 ms · `/dre/fleet` −60 ms | Nenhum (saída idêntica; `@workspace/dre` 75/75 testes) | 4 arquivos, ~15 linhas |
| 4 | `jit=off` para a conexão do FreightCheck (ou baixar o custo da consulta do Balanço) | §7.2 | `/api/balance` 1.017 ms | 285 ms | **−732 ms** · `/balance/:id` −598 ms | Baixo — confirmar que o Neon tem JIT ligado antes | 1 linha (`ALTER DATABASE … SET jit`) |
| 5 | `staleTime` nos endpoints de baixa volatilidade (`/changes/families`, `/changes/grouped`, `/snapshots`, `/curation/*`, `/contexts`) | §8 | 95 KB + 179 ms + 22 consultas por revisita | 0 | **−179 ms e −95 KB** por revisita, em 5 telas | Baixo — invalidar nas mutações que já existem | ~10 linhas |
| 6 | Tirar `enabled: Boolean(data)` de `pages/dre-veiculo.tsx:70,77` | §4.3 | 1.019 ms | ~920 ms | **−97 ms** | Nenhum — as chamadas não usam esse dado | 2 linhas |
| 7 | Mostrar que houve falha e nova tentativa durante o backoff | §9.1 | 5.243 ms em silêncio | mesma espera, com resposta visível | percepção | Nenhum | UI |

**P0 completo: −13,7 s no pior caso de primeira carga, −732 ms no Balanço,
−254 a −325 ms na DRE, −179 ms por revisita em 5 telas.**

### P1 — grande impacto, exige alteração estrutural

| # | Correção | Gargalo | Ganho esperado | Complexidade |
|--:|---|---|---|---|
| 8 | Confirmar (e corrigir) a colocação regional API↔Neon | §7.1 | até **−1,3 s** por tela se estiverem em regiões diferentes | Configuração — **medir primeiro** |
| 9 | Ler o catálogo (atributos, semânticas, identidade) uma vez por requisição em vez de por vigência | §7.3 | −18 consultas em `/dre/history`, −12 em `/coverage`; **−390 ms estimados** a 15 ms de RTT | Média |
| 10 | Code splitting por rota (`lazy` nas ~60 páginas; isolar `recharts` e o módulo Fechamento) | §5.2 | **−400 a −600 ms** estimados em 4G na primeira carga | Média — mecânica |
| 11 | Resolver a sessão uma vez por requisição (hoje `/auth/session` a resolve 2×) | §6.2 | −2 round trips por requisição (−30 ms a 15 ms de RTT) | Baixa |
| 12 | Tirar Análise de Equipamentos do `.xlsx` em disco | §9.3 | disponibilidade | Média |

### P2 — complementar

| # | Correção | Ganho |
|--:|---|---|
| 13 | `Intl` no módulo em `freightaudit/src/lib/utils.ts` | preventivo |
| 14 | Carregamento progressivo em `/dre` (a tela espera `history`, de 2 KB, por 1 s) | percepção: tela útil em ~380 ms |
| 15 | `ETag`/`Cache-Control` nos endpoints de catálogo | complementa o #5 |

### O que **não** fazer (medido, não opinado)

- **Não criar índices** — §7.2.
- **Não aumentar o pool** — §7.4.
- **Não adicionar `useMemo`/`React.memo`/virtualização** — §5.1.
- **Não remover o retry** — ele existe porque o Repl acorda devagar; o conserto é
  tornar a espera visível (#7), não abolir a insistência.
- **Não trocar o Recharts** — 614 KB é peso de bundle (P1 #10), não de render.

---

## 12. A resposta em uma tabela

> **Se eu tiver um dia para melhorar a velocidade percebida do FreightCheck,
> quais 3 mudanças faço primeiro e quantos segundos cada uma tira?**

| # | Mudança | Onde | Segundos que tira | Esforço | Evidência |
|--:|---|---|--:|---|---|
| 1 | Fontes servidas do próprio domínio; remover a Inter não usada | `index.html:16-18`, `src/index.css:1` | **até −12,4 s** na entrada (pior caso) · −0,1 a −0,3 s no caso normal | ~1 h | A/B: FCP 12.732 → 320 ms |
| 2 | `jit=off` na conexão + `compression()` no Express | `ALTER DATABASE`, `app.ts` | **−0,73 s** no Balanço de Massa · **−0,6 s** em `/balance/:id` · até 31,7× menos banda em todas as telas | ~1 h | 1.017 → 285 ms; 165 KB → 5 KB |
| 3 | `Intl.NumberFormat` no módulo + memoizar `humanise`/`placementOf` | `dre/normalizacao.ts`, `composition/motor.ts`, `comparison/labels.ts`, `comparison/families.ts` | **−0,25 s** em `/dre` · **−0,33 s** na DRE do veículo · −0,06 s no restante da DRE/Frota/Composição | ~2 h | 747 → 492 ms; 753 → 428 ms |

**Sobra do dia:** `staleTime` nos catálogos (−0,18 s por revisita em 5 telas) e
os 2 caracteres de `dre-veiculo.tsx` (−0,1 s).

E **antes de tudo**, cinco minutos que podem valer mais que os três juntos:
cronometrar `SELECT 1` do processo da API contra o Neon. Se o RTT não for de um
dígito, o item P1 #8 passa a ser o primeiro da lista — porque a 60 ms de RTT
cada tela paga entre 0,7 s e 1,5 s só em ida e volta (§7.1).

---

## Apêndice — como reproduzir

```bash
# banco real com os workbooks do produto
initdb -D "$PGDATA" -U freight --auth=trust
# postgresql.conf: port=55432, log_min_duration_statement=0, track_io_timing=on
createdb -h 127.0.0.1 -p 55432 -U freight freightcheck
DATABASE_URL=postgres://freight@127.0.0.1:55432/freightcheck pnpm run dev:seed
#   → 18 vigências · 124.632 fatos · 144 ativos

# API em modo produção
pnpm --filter @workspace/api-server run build
DATABASE_URL=... PORT=8080 NODE_ENV=production node artifacts/api-server/dist/index.mjs

# bundle de produção + Chromium real dirigido por Playwright
pnpm --filter @workspace/freightaudit run build
```

Instrumentação usada, toda **fora da árvore do repositório** (nenhuma linha de
código de produto foi alterada nesta auditoria):

| Ferramenta | O que mede |
|---|---|
| `shim.mjs` (`node --import`) | envolve cada requisição HTTP num `AsyncLocalStorage` e conta as consultas do `pg` dentro dela |
| `pgdelay.mjs` | proxy TCP com atraso injetado entre o Node e o Postgres, para converter round trips em milissegundos |
| `nav2.mjs` | navegação SPA: última resposta, texto estável, TBT, maior tarefa, ondas do waterfall |
| `carga.mjs` / `fontes.mjs` | TTFB/FCP/LCP/DCL/load em 3 perfis de rede; A/B do Google Fonts |
| `cpu.mjs` / `--cpu-prof` | perfil de CPU do navegador e do Node |
| `retry.mjs` | 503 injetado por rota, para medir o custo do backoff |
| `carga-concorrente.mjs` | 1/5/10/20 usuários: p50/p95/p99, vazão, RSS |
| `api.mjs` | p50/p95/frio por endpoint, com o log do Postgres como testemunha |

**Aviso sobre uma medição corrigida no meio do caminho.** A primeira versão do
contador de consultas envolvia `Pool.query` *e* `Client.query`, e contava cada
consulta duas vezes; uma correção seguinte passou a medir só o `Client`, e aí as
durações ficaram erradas porque o drizzle entrega um objeto *submittable* e
nesse caminho `Client.query` não devolve Promise. A versão final mede no `Pool`,
conta os dois caminhos sem duplicar, e **foi conferida contra o log do
Postgres** endpoint a endpoint (ex.: `/api/coverage` — 27 consultas nos dois).
Os números deste relatório são os da versão conferida.

---

# Parte II — implementação

Seis mudanças, seis commits independentes, cada uma medida antes e depois no
mesmo ambiente da Parte I. Reverter qualquer uma isoladamente é `git revert`.

## 13. Resultado por mudança

| Mudança | Métrica antes | Métrica depois | Ganho | Evidência | Risco |
|---|---:|---:|---:|---|---|
| **1. Fontes fora do caminho crítico** (`c906ff1`) | FCP 12.668 ms · 2 requisições externas | FCP **188 ms** · **0 externas** | **−98,5%** | A/B em Chromium com o domínio inalcançável; regressão visual pixel a pixel em 6 telas | Nenhum — 5 telas idênticas, a 6ª difere em 826 px (0,064%) porque o peso 600 da mono agora existe de verdade |
| — o mesmo, com o Google respondendo | FCP 248 ms | FCP **236 ms** | −5% | mesmo A/B, terceiro mockado | — |
| **2. Retry por classe de falha** (`0659970`) | 14.325 ms · 5 tentativas | **36 ms · 1 tentativa** | **−99,7%** | 302 para `replit.com/__replshield` reproduzido no navegador | Nenhum — as 3 classes de "origem subindo" mantêm as 5 tentativas e os 13,2 s |
| **3. Round trips de `/changes/families`** (`c13a81b`) | 22 consultas · 478 ms @RTT 15 ms | 17 consultas · **396 ms** | **−17%** | proxy TCP com atraso injetado, 0/5/15 ms | Nenhum — respostas byte a byte idênticas em 6 endpoints |
| **4. JIT do Balanço de Massa** (`4ba5121`) | 877 ms / 944 ms | **239 ms / 364 ms** | **−73% / −61%** | `EXPLAIN (ANALYZE, BUFFERS)` 1.036 → 347 ms | Baixo — `SET LOCAL`, escopo de transação |
| **5. `Intl.NumberFormat` centralizado** (`fab84bb`) | 22.047 ms de CPU / 25 req | **11.269 ms** | **−49%** | perfil de CPU do Node, antes e depois | Nenhum — 9 endpoints byte a byte idênticos |
| **6. Compressão HTTP** (`414baf7`) | 277.450 B por navegação | **29.068 B** | **9,5×** | navegação real em Chromium com banda em 2 Mb/s | Nenhum — conteúdo idêntico; +0,2 a 0,9 ms de CPU por resposta |

### O que cada uma custou de CPU sob carga

A compressão foi a única que **acrescenta** trabalho ao servidor. Medido com
20 usuários simultâneos, antes de tudo e depois de tudo:

| Usuários | p50 antes | p50 depois | p95 antes | p95 depois | Vazão antes | Vazão depois |
|--:|--:|--:|--:|--:|--:|--:|
| 1 | 52 ms | **42 ms** | 192 ms | **155 ms** | 11,7/s | **14,6/s** |
| 5 | 71 ms | **75 ms** | 296 ms | **242 ms** | 40,8/s | **45,6/s** |
| 10 | 129 ms | **134 ms** | 556 ms | **439 ms** | 46,0/s | **50,8/s** |
| 20 | 210 ms | **286 ms** | 1.017 ms | **837 ms** | 48,2/s | **51,0/s** |

O p95 melhora em toda a faixa e a vazão sobe 6%: o que a compressão cobre de
CPU é menos do que as outras cinco mudanças devolvem.

## 14. Resultado por tela

Navegação SPA (clique no menu → última resposta), mediana de 3, warm.
Telas que já respondiam abaixo de 50 ms estão omitidas.

| Tela | Antes | Depois | Ganho | Gargalo restante |
|---|---:|---:|---:|---|
| `/balanco-massa` | 1.399 ms | **411 ms** | −71% | a consulta de classificação, 347 ms de SQL real |
| `/dre` | 1.130 ms | **587 ms** | −48% | `/dre/history`: 49 consultas e 302 ms de Node |
| `/fechamento/remuneracao` | 284 ms | 237 ms | −17% | `/remuneracao/situacao`: 248 ms de SQL |
| `/curadoria` | 274 ms | 232 ms | −15% | `/curation/queue`: uma consulta de 188 ms |
| `/impacto-financeiro` | 279 ms | 202 ms | −28% | `/impacto/panorama`: 201 ms de SQL |
| `/dashboard` | 265 ms | 189 ms | −29% | `/changes/families`: 114 ms de SQL |
| `/parametros` | 261 ms | 192 ms | −26% | idem |
| `/vigencia` | 248 ms | 171 ms | −31% | `/changes/grouped`: 114 ms de SQL |
| `/resumo-executivo` | 235 ms | 185 ms | −21% | idem `/changes/families` |
| `/gestao-a-vista` | 226 ms | 195 ms | −14% | idem |
| `/linha-do-tempo` | 219 ms | 193 ms | −12% | idem |
| `/cavalo-360` | 175 ms | 125 ms | −29% | `/frota/panorama`: 25 consultas |
| `/dados` | 146 ms | 124 ms | −15% | `/coverage`: 27 consultas, 57 ms de SQL |
| `/carreta-360` | 142 ms | 102 ms | −28% | idem 360° |
| `/composicao` | 141 ms | 110 ms | −22% | — |
| `/justificativas` | 108 ms | 91 ms | −16% | 3 ondas (cascata legítima por `changeSetId`) |
| `/alteracoes` | 105 ms | 82 ms | −22% | — |

**Nenhuma tela comum passa de 600 ms**, e a meta de "utilizável em menos de 1 s
em warm" está cumprida em todas — inclusive nas duas que estavam em 1,1 s e
1,4 s. A primeira carga saiu de 12,7 s para 188 ms.

## 15. Separando o que foi corrigido do que explica a lentidão em produção

Isto precisa ficar explícito, porque as duas coisas não são a mesma.

**O que está comprovado e corrigido** é o que foi medido aqui: o bloqueio da
primeira pintura, o custo do retry sobre um desvio, os round trips
duplicados, o JIT, o formatador e a compressão. Todos reproduzidos e medidos
neste ambiente, com evidência anexada a cada commit.

**O que NÃO está corrigido, e não pode ser corrigido por código, é o desvio em
si.** A ocorrência de produção — `freightcheck.com.br/api/*` respondendo 302
para `replit.com/__replshield` — continua acontecendo exatamente como antes. O
302 é da camada de rede da publicação, e quem o resolve é a configuração dela.

O que mudou é o que o produto faz **diante** dele:

| | Antes | Depois |
|---|---|---|
| Tempo até a tela dizer algo | 14.325 ms | 36 ms |
| Tentativas gastas | 5 | 1 |
| O que a tela diz | "não foi possível montar a visão geral" | "o pedido não chegou ao FreightCheck: alguma camada entre o seu navegador e a aplicação o desviou para outro endereço. Não é a aplicação que está fora do ar — ela não chegou a ser consultada." |
| O que o console registra | `TypeError: Failed to fetch` | `[transporte] /api/… — DESVIADA, 7ms. A chamada não chegou à API.` |
| Como o diagnóstico classifica | falha de rede, indistinguível de cabo solto | `DESVIADA`, ação `DESVIO_NA_PLATAFORMA`, dirigida à plataforma |

E o mesmo mecanismo — o navegador preso num terceiro que não responde — era o
que produzia os 12,7 s de tela branca pelas fontes. Esse foi eliminado na
origem: não há mais nenhum terceiro no caminho da primeira pintura.

**A pergunta que continua aberta**: quanto da lentidão que os usuários relatam
é este desvio e quanto é o que foi corrigido aqui. Não há como responder daqui —
seria preciso a proporção de requisições que recebem 302 em produção. O que dá
para afirmar é que, quando ele acontecer, ele custará 36 ms em vez de 14 s, e
dirá o que é.

## 16. O que continua não medido

Sem mudança em relação ao §10: Replit/ReplShield na origem, a latência real até
o Neon (a inclinação medida diz que ela custa ~1 ms por consulta por ms de RTT
— com 17 consultas em `/changes/families`, um Neon a 60 ms de distância ainda
custaria ~1 s), o cold start do contêiner, e as telas sem dado no seed (Radar de
Trechos, QLP, Fechamento).

**Sobre as suítes.** `pnpm test` na raiz não completa neste ambiente, e não
completava antes destas mudanças: as suítes `-real` montam bancos descartáveis
em paralelo contra um único Postgres e colidem entre si (chave duplicada em
`snapshot`, template parcial de importação). Por isso cada etapa foi conferida
**por pacote, com e sem a mudança**, e o que este relatório afirma é a
diferença entre os dois — não um número absoluto de falhas:

| Pacote | Sem a mudança | Com a mudança |
|---|---|---|
| `freightaudit` | 952 passando | **969 passando** (17 novos) |
| `comparison` | 34 falhas | 34 falhas (+4 novos passando) |
| `api-server` | 11 falhas | 11 falhas |
| `balance` | 16 pulados | 16 pulados |
| `dre` / `composition` / `knowledge` | — | 56 / 31 / 11 passando |

Typecheck do workspace inteiro limpo em todas as etapas.
