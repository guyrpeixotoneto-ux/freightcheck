# Auditoria de Performance do FreightCheck — o caminho até "Zero Loading"

**Data:** 29/08/2026 · **Método:** medição, não leitura de código.

Ambiente: Postgres 16 local, **6 unidades · 108 vigências · 747.792 fatos ·
578 MB**, importadas pelo caminho do produto (`pnpm dev:seed`), API compilada em
modo produção, bundle de produção servido a um Chromium real dirigido por
Playwright. 4 núcleos, 16 GB.

> **Por que 6 unidades.** O seed do repositório tem **uma** unidade. A auditoria
> anterior (`docs/AUDITORIA-PERFORMANCE.md`, §20) declarou isso como a sua
> limitação mais importante, e ela é decisiva aqui: o custo da Visão Geral é
> **por unidade**. Para esta auditoria foram geradas 5 unidades sintéticas a
> partir dos mesmos workbooks (unidade, placas e chassis trocados, valores
> deslocados) e importadas **pelo caminho do produto**. Toda tabela abaixo diz
> se o número é de N=1 ou N=6, e a inclinação entre os dois é o que permite
> projetar para a operação real.

Onde uma medição não foi possível, está em [§13 Limitações](#13-limitações).
Nenhuma conclusão depende de uma medição que não existe.

---

## 1. Veredito

### Estado atual

O FreightCheck **não é lento por causa do React, nem do bundle, nem do
Postgres**. As três suspeitas foram medidas e as três foram descartadas:

- bloqueio da main thread: **0 ms em 6 das 9 telas medidas**, máximo 51 ms;
- o SQL das telas que travam responde em 55–190 ms;
- o bundle custa 143 ms de download local e 208 ms até a primeira pintura.

O que faz aparecer "Carregando o Dashboard…" é **uma coisa só, medida**:

> **Toda tela analítica recalcula tudo, do zero, a cada requisição — e o
> cliente não tem nada em cache para mostrar enquanto isso.**

O número que resume a auditoria inteira:

| Endpoint | Linhas lidas do Postgres **por requisição** | Resposta (br) | Razão |
|---|--:|--:|--:|
| `/api/balance` | **1.023.433** | 2.501 B | 409 linhas por byte |
| `/api/changes/families/overview` | **531.433** | 5.623 B | 95 linhas por byte |
| `/api/changes/grouped` | **240.480** | 7.660 B | 31 linhas por byte |
| `/api/gerencial/vigencias` | **128.717** | 2.470 B | 52 linhas por byte |
| `/api/dre/history` | **124.492** | 251 B | **496 linhas por byte** |
| `/api/contexts` | 25.864 | 696 B | 37 linhas por byte |
| `/api/changes/families` | 21.354 | 9.554 B | 2 linhas por byte |

*(`tup_returned` de `pg_stat_database`, com `pg_stat_reset()` antes e média de
5 requisições. É "linhas devolvidas pelos scans", que é a pergunta do §7 do
pedido: quantas linhas o banco examina para produzir a resposta.)*

**O Dashboard lê meio milhão de linhas para escrever 5,6 KB.** O Resumo
executivo lê um milhão para escrever 2,5 KB. Nada disso é guardado: a próxima
pessoa que abrir a mesma tela, na mesma competência, com os mesmos dados, paga
tudo de novo.

### Principal gargalo

**`getFamiliesOverview` roda a comparação completa de cada unidade, em cada
requisição** (`lib/comparison/src/families-view-overview.ts:626`, um
`Promise.all` sobre `candidatas`). Medido:

| | N=1 unidade | N=6 unidades | inclinação |
|---|--:|--:|--:|
| Consultas por requisição | 11 | **46** | +7 por unidade |
| SQL somado | 163 ms | **1.046 ms** | +177 ms por unidade |
| p50 (sozinho, sem concorrência) | 188 ms | 243 ms | +11 ms por unidade |
| p50 (com o `/changes/range/overview` junto, como o Dashboard faz) | — | **625 ms** | — |

O p50 sozinho cresce pouco porque as 46 consultas correm em paralelo — e é
exatamente isso que quebra sob concorrência (§4.3): a vazão da API cai de
~47 req/s (N=1, auditoria anterior) para **8,5 req/s** (N=6), e o p95 vai de
380 ms com 1 usuário para **3.044 ms com 10**.

### Potencial para experiência instantânea

**Alto, e a maior parte não depende de arquitetura nova.** Duas evidências:

1. **A revisita a uma tela já visitada já é instantânea hoje** — 0 requisições,
   0 ms, nenhum loader (§4.2, passos 3 e 7). Onde há `staleTime`, o produto já
   entrega o alvo. O problema é que **só 26 das 153 consultas o declaram**.
2. **Voltar para uma competência já vista é instantâneo** — 0 requisições
   (§5.1, 4ª troca). O cache funciona; ele só está vazio quase sempre.

O que falta não é uma reescrita. É: (a) tirar o recálculo por unidade do caminho
da requisição, (b) declarar cache onde ele já seria seguro, (c) manter o
conteúdo anterior visível durante a troca, (d) antecipar o previsível.

---

## 2. Jornada medida — abertura do Dashboard (Visão Geral)

Mediana de 3, cache do navegador frio, servidor quente, N=6, localhost.
Marcação por `requestAnimationFrame` (±16 ms).

```
0 ms      navegação
+4 ms     TTFB do index.html
+10 ms    o JS começa a baixar
+143 ms   JS pronto (3,09 MB · 133 ms)
+188 ms   DOMContentLoaded
+208 ms   FCP — a primeira pintura
+251 ms   a casca está desenhada  →  "Carregando o Dashboard…" APARECE
+195 ms   GET /api/auth/session                    (12 ms)
+242 ms   GET /contexts /change-sets /imports      (46 ms, em paralelo)
          /curation/summary
+289 ms   GET /build                               (15 ms)
+296 ms   GET /changes/families/overview  ─┐  as duas em paralelo,
+297 ms   GET /changes/range/overview     ─┘  e disputando os mesmos 4 núcleos
+921 ms   a última responde                        (625 ms)
+958 ms   "Carregando o Dashboard…" SOME — o conteúdo aparece
```

| Etapa | Tempo | % do total | Evidência |
|---|--:|--:|---|
| Download + parse + primeira pintura do bundle | 208 ms | 22% | `navigation` + `paint` do Chromium |
| Casca do produto renderizada | 43 ms | 4% | marcação a 16 ms no DOM |
| **Espera pelo `/contexts` antes de poder pedir a competência** | **54 ms** | **6%** | `dashboard.tsx:141-158` — cascata artificial |
| **Os dois endpoints de overview** | **625 ms** | **65%** | waterfall do navegador |
| Render do conteúdo + gráfico | 37 ms | 4% | TBT medido: 0 ms |
| **Total até conteúdo útil** | **958 ms** | 100% | |

**65% do tempo é um endpoint.** 4% é o React. A conta não deixa dúvida sobre
onde trabalhar.

### As mesmas etapas em rede real

Primeira carga completa (login → Dashboard pronto), bundle de produção:

| Perfil de rede | FCP sem gzip | FCP com gzip | Tela útil sem gzip | Tela útil com gzip |
|---|--:|--:|--:|--:|
| sem limite (localhost) | 160 ms | 196 ms | 932 ms | 1.385 ms |
| 20 Mb/s | 1.480 ms | **508 ms** | 2.389 ms | **1.389 ms** |
| 4G (9 Mb/s, 85 ms) | 3.224 ms | **1.052 ms** | 4.454 ms | **1.959 ms** |
| 3G (1,6 Mb/s, 300 ms) | 17.292 ms | **5.116 ms** | 18.814 ms | **6.691 ms** |

O JS são **3.022 KB sem compressão e 833 KB com gzip**. A API já comprime
(`compression()` em `app.ts:99`, confirmado: `content-encoding: br` em todos os
endpoints medidos). **O que não dá para conferir daqui é se o host estático do
Replit comprime o bundle** — `serve = "static"` no `artifact.toml`. É a primeira
coisa a medir em produção: um `curl -H 'accept-encoding: gzip' -I` responde em
dez segundos, e a diferença é de **2,2 s em 4G**.

---

## 3. Waterfall de requests

### 3.1 Abertura do Dashboard (N=6, cache frio)

| # | Endpoint | Dispara | Duração | Resposta | Bloqueia? | Depende de | Poderia ser |
|--:|---|--:|--:|--:|---|---|---|
| 1 | `/auth/session` | 195 ms | 12 ms | 0 KB | não | — | — |
| 2 | `/contexts` | 242 ms | 45 ms | 0,7 KB | **sim (indireto)** | sessão | prefetch na casca |
| 3 | `/change-sets` | 243 ms | 36 ms | 0 KB | não | sessão | contador do menu |
| 4 | `/imports` | 244 ms | 45 ms | 1,5 KB | não | sessão | contador do menu |
| 5 | `/curation/summary` | 244 ms | 44 ms | 1 KB | não | sessão | contador do menu |
| 6 | `/build` | 289 ms | 15 ms | 0 KB | não | — | 1× por sessão |
| 7 | **`/changes/families/overview`** | **296 ms** | **625 ms** | **5,6 KB** | **SIM** | `/contexts` | **agregado pronto** |
| 8 | `/changes/range/overview` | 297 ms | 607 ms | 2,4 KB | não (cartão lateral) | `/contexts` | fora do caminho crítico |

**Achados do waterfall:**

- **Nenhuma requisição duplicada.** Medido em 11 navegações: zero duplicatas.
- **Uma cascata artificial, medida:** #7 e #8 só podem sair depois do #2, porque
  a competência a pedir vem de `contextos.periodosDisponiveis`
  (`dashboard.tsx:158`). Custa 54 ms no localhost; em produção custa 1 RTT extra.
- **Duas requisições caras disputando os mesmos 4 núcleos.** Sozinhas custam
  243 ms e 21 ms; juntas, **625 ms e 607 ms**. O `/changes/range/overview`
  alimenta um cartão lateral ("Onde está o impacto?") e **2,5× o custo do
  conteúdo principal** por estar no mesmo instante.
- **N+1 de requests: não existe.** 33 das telas disparam tudo numa onda só.
- **N+1 de SQL: existe, dentro de um endpoint.** `/dre/history` faz 49 consultas
  por requisição; `/changes/families/overview` faz 46 com 6 unidades (11 com 1).

### 3.2 O que cada tela pede, por visita (N=6, SPA, warm)

| Tela | 1ª visita | Revisita < 60 s | Revisita > 60 s |
|---|---|---|---|
| `/dashboard?visaoGeral=1` | 2 req · 299 ms · loader 265 ms | **0 req · 0 ms · sem loader** | 6 req · 349 ms |
| `/visao-gerencial` (Painel de Unidades) | 1 req · 48 ms | **1 req · 55 ms** (sempre) | 2 req · 107 ms |
| `/resumo-executivo` | 2 req · **2.402 ms** | 1 req · 80 ms | — |
| `/linha-do-tempo` | **0 req · 0 ms** | 0 req | 0 req |
| `/vigencia` (Acompanhamento) | 2 req · 236 ms | **1 req · 214 ms** (sempre) | — |
| `/composicao` | 1 req · 165 ms · loader 130 ms | **1 req · 182 ms** (sempre) | — |
| `/dre` | 2 req · 988 ms | — | — |

**A linha que importa é a do Dashboard: 0 requisições na revisita.** É o produto
já entregando "zero loading" — para as 26 consultas que declaram `staleTime`.
As outras 127 refazem tudo a cada montagem.

---

## 4. Backend

### 4.1 Endpoints, N=1 → N=6

p50 de 7–9 execuções aquecidas, requisições serializadas, contagem de consultas
conferida contra o log do Postgres (`log_min_duration_statement = 0`).

| Endpoint | p50 N=1 | p50 N=6 | fator | Consultas N=6 | SQL N=6 | Payload (br) |
|---|--:|--:|--:|--:|--:|--:|
| `/balance` | 349 ms | **2.251 ms** | **6,4×** | 6 | 2.259 ms | 2,5 KB |
| `/dre/history` | 613 ms | 588 ms | 1,0× | **49** | 143 ms | 251 B |
| `/changes/families/overview` | 188 ms | 243 ms | 1,3× | **46** | 1.046 ms | 5,6 KB |
| `/dre/fleet` | 170 ms | 151 ms | 0,9× | 14 | 35 ms | 10 KB |
| `/changes/grouped` | 187 ms | 149 ms | 0,8× | 10 | 123 ms | 7,7 KB |
| `/changes/families` | 191 ms | 145 ms | 0,8× | 11 | 124 ms | 9,6 KB |
| `/composition/fleet` | 77 ms | 73 ms | 0,9× | 12 | 21 ms | 2,8 KB |
| `/changes/range/overview` | 9 ms | 21 ms | 2,3× | 21 | 4 ms | 2,4 KB |
| `/gerencial/vigencias` | 7 ms | 14 ms | 2,0× | 4 | 3 ms | 2,5 KB |
| `/contexts` | 7 ms | 11 ms | 1,6× | 3 | 2 ms | 0,7 KB |
| `/imports`, `/change-sets`, `/curation/summary`, `/build` | 2–5 ms | 3–7 ms | — | 1–3 | ≤ 2 ms | ≤ 1 KB |

**Metas do §16 do pedido, hoje:** API simples p95 < 200 ms — **cumprida** em
todas as rotas leves. API analítica p95 < 500 ms — **falha** em `/balance`
(2,3 s), `/dre/history` (588 ms) e no par de overview do Dashboard (625 ms).

### 4.2 Onde a CPU da API é gasta

Perfil de CPU do processo Node (`--cpu-prof`), 25 requisições, janela de
13.113 ms, 8,1 s de CPU:

| Função | ms | % | O que é |
|---|--:|--:|---|
| `parseRow` (driver `pg`) | 940 | 7,2% | ┐ |
| `utf8Slice` | 591 | 4,5% | │ **transformar linhas do Postgres** |
| `slice` (`node:buffer`) | 404 | 3,1% | │ **em objetos JavaScript** |
| `parseDataRowMessage` | 357 | 2,7% | │ |
| `handleDataRow` | 75 | 0,6% | ┘ **= 2.367 ms · 29%** |
| `comporDeFatos` (`composition/motor.ts`) | 826 | 6,3% | ┐ |
| (anônima, mesmo arquivo) | 797 | 6,1% | │ **recompor e comparar fatos** |
| `ordenarPorPlaca` | 292 | 2,2% | │ **linha a linha, em Node** |
| `lerFatosDaVigencia` | 272 | 2,1% | ┘ **= 2.187 ms · 27%** |
| coletor de lixo | 652 | 5,0% | pressão dos objetos acima |
| `attributeLabel` + `humanise` | 292 | 2,2% | rótulos |
| (ocioso) | 4.982 | 38,0% | esperando o banco |

**56% da CPU da API é ler linhas do banco e recompô-las em Node.** Não é uma
consulta lenta: é uma arquitetura em que a agregação acontece no Node sobre
centenas de milhares de linhas trazidas do Postgres.

### 4.3 Concorrência

Mix real de uma navegação (`families/overview`, `range/overview`,
`gerencial/vigencias`, `contexts`, `imports`), 12 s por nível, N=6:

| Usuários | p50 | p95 | p99 | Pior | Vazão | Erros |
|--:|--:|--:|--:|--:|--:|--:|
| 1 | 12 ms | 380 ms | 393 ms | 393 ms | 7,6 req/s | 0 |
| 3 | 146 ms | 939 ms | 1.090 ms | 1.124 ms | 8,5 req/s | 0 |
| 5 | 347 ms | 1.445 ms | 1.557 ms | 1.786 ms | 8,4 req/s | 0 |
| 10 | **893 ms** | **3.044 ms** | 3.487 ms | 3.512 ms | 8,0 req/s | 0 |

**A vazão satura em ~8,5 req/s a partir de 3 usuários.** A auditoria anterior
mediu ~47 req/s com N=1 no mesmo hardware. A queda é praticamente o fator de
unidades: cada requisição da Visão Geral agora carrega o trabalho de seis.

**Com 10 pessoas usando o produto ao mesmo tempo, o p95 é 3 segundos.** Isto,
e não a rede, é o que fará o produto parecer lento quando a Ambev colocar mais
gente dentro dele.

---

## 5. PostgreSQL

### 5.1 A consulta mais cara do Dashboard

`EXPLAIN (ANALYZE, BUFFERS)` da contagem de entidades por vigência
(`snaps`/`por_entidade`, uma por unidade):

```
Planning Time: 12.404 ms
Execution Time: 186.732 ms

GroupAggregate  (actual time=127.838..143.121 rows=18)
  →  Sort  (actual time=126.812..131.935 rows=83241)
       Sort Key: sn.d, e.entity_type, f.entity_id
       Sort Method: quicksort  Memory: 8275kB
       →  Hash Join  (rows estimated 3537, actual rows 83241)   ← erro de 23×
            →  Bitmap Heap Scan on fact  (rows=9249, loops=9)
                 →  Bitmap Index Scan on fact_snapshot_entity_idx
Buffers: shared hit=1777 read=2
```

Três fatos:

1. **83.241 linhas ordenadas para produzir 18 números.** `count(DISTINCT
   f.entity_id)` obriga o Postgres a ordenar cada fato, com 8,2 MB de quicksort.
2. **A estimativa erra por 23×** (3.537 previstas, 83.241 reais). É por isso que
   o planejador escolhe `GroupAggregate` sobre `Sort` em vez de `HashAggregate`.
3. **Buffers: 1.777 hit, 2 read.** Não é I/O. É CPU de ordenação.

**A/B da reescrita** (`DISTINCT (d, entity_id)` num CTE, depois `count(*)`),
mesmas 18 linhas de saída, mediana de 3:

| | Execution Time |
|---|--:|
| Como está hoje | 137,7 / 137,1 / 148,0 ms |
| `SELECT DISTINCT` + `count(*)` | **55,3 / 56,2 / 55,6 ms** |
| | **−60%** |

O plano da versão reescrita usa `HashAggregate` (105 kB de sort em vez de
8.275 kB).

### 5.2 Índices

**Nenhum índice novo é recomendado, e nenhum foi criado.** Os planos usam os
índices que existem (`fact_snapshot_entity_idx`, `snapshot_effective_date_idx`,
`attribute_code_uq`, `entity_identifier` por `PLACA`). Os `Seq Scan` que
aparecem são sobre `snapshot` (108 linhas), `import_run` (10) e `entity` (672) —
tabelas onde o índice é mais caro que a varredura. O alinhamento pedido no §8
do pedido (empresa/unidade/competência/canal/snapshot/import_run/scope/status)
está coberto: `scope_hash`, `effective_date`, `status`, `import_run_id` e
`snapshot_id` todos têm índice e todos aparecem sendo usados.

**O problema não é falta de índice. É a forma da consulta e o volume que ela
traz para o Node.**

### 5.3 `/balance` — a consulta sem recorte

`lib/balance` faz o censo de **todas as células cruas de todas as importações**:

```sql
WITH aba AS (SELECT … FROM raw_sheet s)          -- sem WHERE
     celula AS (… JOIN raw_row … JOIN raw_cell …)
     preparado AS (… FROM staged_fact …)
```

| Tabela | Linhas | Tamanho |
|---|--:|--:|
| `fact` | 747.792 | 301 MB |
| `raw_cell` | 514.878 | 74 MB |
| `staged_fact` | 499.446 | 180 MB |

**1.023.433 linhas lidas para produzir 2,5 KB.** E cresce com **cada
importação**, para sempre — não com o tamanho da tela. Hoje custa 2.251 ms; com
um ano de importações mensais de 6 unidades, custa minutos.

Isso alimenta **um** cartão de percentual de cobertura no Resumo executivo
(`pages/inicio.tsx:226`, `IndicadoresDaVisaoGeral`).

### 5.4 Consultas repetidas dentro de uma requisição

| Endpoint | Repetição | Vezes (N=6) |
|---|---|--:|
| `/dre/history` | catálogo de atributos / identidade / fatos | 18× cada |
| `/changes/families/overview` | a leitura de vigência por unidade | 6× (uma por unidade) |
| `/changes/range/overview` | análise de intervalo por unidade × contexto | 6× |

O caso do `/dre/history` é o mesmo catálogo relido uma vez por vigência — 18
vigências, catálogo idêntico nas 18. A auditoria anterior já o descreveu; ele
**continua exatamente igual**.

---

## 6. Frontend

### 6.1 Render: descartado como causa

Bloqueio da main thread (`longtask`) na troca de tela, N=6:

| Tela | Tarefas longas | TBT | Maior tarefa | Nós no DOM |
|---|--:|--:|--:|--:|
| `/dashboard` | 0 | **0 ms** | 0 ms | 440 |
| `/visao-gerencial` | 0 | **0 ms** | 0 ms | 690 |
| `/resumo-executivo` | 0 | **0 ms** | 0 ms | 577 |
| `/linha-do-tempo` | 0 | **0 ms** | 0 ms | 314 |
| `/vigencia` | 0 | **0 ms** | 0 ms | 373 |
| `/composicao` | 0 | **0 ms** | 0 ms | 1.474 |
| `/dre` | 1 | 10 ms | 60 ms | 1.783 |
| `/parametros` | 1 | 2 ms | 52 ms | 1.018 |
| `/alteracoes` | 1 | **51 ms** | 101 ms | 3.807 |

**Não recomendo `useMemo`, `React.memo` nem virtualização em lugar nenhum.**
Não há evidência de que rendam nada. As tabelas já são paginadas.

### 6.2 Cache do React Query — o diagnóstico central

`App.tsx` define `PADRAO_DAS_CONSULTAS` sem `staleTime`, então o padrão do
React Query (`staleTime: 0`) vale para a maioria das consultas.

| | Contagem |
|---|--:|
| `useQuery` no produto | **153** |
| Declaram `staleTime` | **26** (17× 60 s, 3× 30 s, 2× 15 s, 1× 5 min, 1× `Infinity`, 2× 0) |
| Declaram `placeholderData` / `keepPreviousData` | **4** (3 componentes + o padrão resiliente) |
| Declaram `gcTime` | **2** (ambos `gcTime: 0`) |
| Declaram `initialData` | **0** |
| Usam `prefetchQuery` / `ensureQueryData` | **1** (`pages/linha-do-tempo.tsx:125`) |
| `refetchOnWindowFocus` | `false` global; 4 exceções declaradas |
| `refetchOnReconnect` | `true` global |
| `React.lazy` / `<Suspense>` | **0** |

**`staleTime` por tela principal:**

| Tela | `useQuery` | com `staleTime` |
|---|--:|--:|
| `pages/inicio.tsx` (Resumo executivo) | 4 | 4 ✅ |
| `pages/gestao-a-vista.tsx` | 4 | 3 |
| `pages/linha-do-tempo.tsx` | 1 | ✅ |
| `pages/dashboard.tsx` | 3 | 1 (só a Visão Geral; **modo unidade não tem**) |
| `pages/visao-gerencial.tsx` (Painel de Unidades) | 1 | **0** ❌ |
| `pages/vigencia.tsx` (Acompanhamento) | 1 | **0** ❌ |
| `pages/composicao.tsx` | 2 | **0** ❌ |
| `pages/dre.tsx` | 2 | **0** ❌ |
| `pages/parametros.tsx` | 1 | **0** ❌ |

### 6.3 Isolamento de escopo no cache: **está correto hoje**

Verificado nas 247 declarações de `queryKey`: as consultas escopadas carregam o
recorte na chave — `consulta.toString()` (que é `period` + `scopeHash` + `canal`),
ou `period`, ou `scopeHash` explícito. As chaves sem recorte
(`["curation", …]`, `["imports"]`, `["assistant-conversations"]`) são de
endpoints que **não** têm recorte de unidade.

O produto **não tem inquilinos hoje** — está escrito no schema e em
`artifacts/api-server/src/lib/empresa-da-requisicao.ts`: "não há coluna de
empresa em lugar nenhum". O isolamento que existe e que precisa ser preservado
é o de **unidade / canal / competência**, e as chaves o respeitam.

**Consequência para o plano:** cache no cliente é seguro de aumentar hoje.
Cache no servidor precisa ter unidade + canal + competência + operação **na
chave**, e invalidação por importação/ocultação (§10 do pedido, tratado em §9.3).

### 6.4 Bundle

`dist/public/assets/index-*.js`: **3.094 KB (847 KB gzip), um único chunk.**
Cresceu 22% desde a auditoria anterior (2.540 KB). `App.tsx` importa as ~60
páginas estaticamente; **`React.lazy` e `<Suspense>` não aparecem uma única vez
no produto**.

Composição (atribuição byte a byte pelo sourcemap):

| Origem | KB | % |
|---|--:|--:|
| `recharts` | 287 | 9,5% |
| `src/lib` | 178 | 5,9% |
| `react-dom` | 171 | 5,7% |
| `pages/fechamento` (12 telas) | 171 | 5,7% |
| `components/changes` | 164 | 5,5% |
| `components/fluxos` | 94 | 3,1% |
| `motion-dom` (framer-motion) | 91 | 3,0% |
| `@xyflow/react` + `@xyflow/system` | 122 | 4,1% |
| `components/parametros` | 74 | 2,5% |
| `components/configuracoes` | 59 | 2,0% |
| `lucide-react` | 46 | 1,5% |

**`@xyflow` (122 KB) serve só a Fluxos Operacionais. `pages/fechamento` +
`components/fechamento` (227 KB) servem só o módulo Fechamento. `recharts`
(287 KB) não é usado na primeira tela que a maioria abre.** Quem abre o
Dashboard baixa os três.

Com um único chunk e imports estáticos, **o módulo de topo de todas as ~60
páginas é avaliado na partida**, mesmo o das 59 que não estão na tela.

---

## 7. Por que aparecem os loaders — cada causa, concreta

Catálogo: **69 ocorrências do texto "Carregando"** e **322 usos de
`isLoading`/`isPending`** em `pages/` e `components/`.

Classificação das telas principais (A = inevitável · B = cache existente ·
C = `keepPreviousData` · D = prefetch · E = parcial · F = eliminável na origem):

| Tela | Loader | Linha | Quando aparece | Medido | Classe |
|---|---|---|---|---|--:|
| Dashboard (Visão Geral) | "Carregando o Dashboard…" | `dashboard.tsx:297` | cache vazio da competência | **707 ms** (frio) | **F** |
| Dashboard (unidade) | "Carregando a vigência…" | `dashboard.tsx:318` | **toda troca de unidade** | **147–163 ms** | **C** |
| Dashboard (unidade) | idem | idem | **toda troca de competência** | **197–212 ms** | **C** |
| Painel de Unidades | "Carregando…" | `visao-gerencial.tsx:403` | toda montagem (sem `staleTime`) | 33 ms | **B** |
| Resumo executivo | "Carregando a Visão Geral…" | `inicio.tsx:422` | cache vazio | — | **D** |
| Linha do Tempo | "Carregando a Visão Geral…" | `linha-do-tempo.tsx:197` | cache vazio | 0 ms (já tem `staleTime`) | **B** |
| Acompanhamento | `<Esqueleto />` | `vigencia.tsx:188` | toda montagem (sem `staleTime`) | — | **B** |
| Composição | "Carregando…" | `composicao.tsx:258` | toda montagem (sem `staleTime`) | **130–184 ms** | **B** |
| DRE | `<Esqueleto />` | `dre.tsx:174` | toda montagem | — | **B + E** |
| Parâmetros | "Carregando…" | `parametros.tsx:578` | toda montagem | — | **B** |

**As três causas, em ordem de peso medido:**

**Causa 1 — O recálculo por unidade está no caminho da requisição (F).**
O Dashboard em Visão Geral não tem o que mostrar porque ninguém guardou o
resultado: 531.433 linhas lidas e a comparação de 6 unidades refeita para
produzir 5,6 KB que serão idênticos até a próxima importação. Nenhum cache do
cliente resolve a **primeira** pessoa do dia, nem a **primeira** competência que
alguém abre. Só pré-computação resolve.

**Causa 2 — A troca de recorte cria uma chave nova, e chave nova não tem
cache (C).** Medido, troca de unidade no Dashboard:

| Troca | Conteúdo some em | Fica sem conteúdo por | Requisições |
|---|--:|--:|--:|
| CAMAÇARI → JAGUARIUNA | **17 ms** | **147 ms** | 3 |
| JAGUARIUNA → TERESINA | **16 ms** | **163 ms** | 3 |
| TERESINA → CAMAÇARI (já visitada) | — | **0 ms** | 1 |
| CAMAÇARI → JAGUARIUNA (já visitada) | — | **0 ms** | 1 |

E troca de competência:

| Troca | Fica sem conteúdo por | Requisições |
|---|--:|--:|
| ago → jul/2026 | **197 ms** | 1 |
| jul → jun/2026 | **197 ms** | 1 |
| jun → mai/2026 | **212 ms** | 1 |
| mai → jul/2026 (já visitada) | **0 ms** | **0** |

**A leitura exata do experimento:** o conteúdo desaparece 16 ms depois do
clique, o loader ocupa a tela por 150–210 ms, e o novo conteúdo entra. Voltar
para um recorte já visitado é **instantâneo, com zero requisições** — o cache
funciona perfeitamente; ele só está vazio na primeira vez, e o produto trata
"vazio" como "apague a tela".

O conserto não é esconder o loader. É `placeholderData: keepPreviousData`, que
existe no produto — em **3 componentes**, nenhum deles nestas telas.

**Causa 3 — `staleTime: 0` em 127 das 153 consultas (B).** Medido, A→B→A→B
rápido:

| # | Tela | Requisições | O que refez |
|--:|---|--:|---|
| 1 | Dashboard | 2 | 1ª visita |
| 2 | Painel de Unidades | 1 | 1ª visita |
| 3 | Dashboard | **0** | ✅ nada |
| 4 | Painel de Unidades | **1** | `/gerencial/vigencias` — **de novo** |
| 5 | Dashboard | 1 | `/imports` |
| 6 | Acompanhamento | 1 | `/changes/grouped` (240.480 linhas) |
| 7 | Dashboard | **0** | ✅ nada |
| 8 | Composição | 5 | `/composition/fleet` + 4 da casca |
| 9 | Dashboard | 3 | `staleTime` de 60 s expirou |

O Painel de Unidades relê 128.717 linhas do banco **toda vez que alguém passa
por ele**, para um conteúdo que não mudou.

---

## 8. Quick wins

Mudanças pequenas, ganho medido, risco baixo. Nenhuma altera o que a tela diz.

| # | Mudança | Arquivos | Ganho medido | Risco |
|--:|---|---|--:|---|
| **Q1** | `placeholderData: keepPreviousData` nas consultas de recorte do Dashboard, Painel, Acompanhamento, Composição, Parâmetros | `dashboard.tsx`, `visao-gerencial.tsx`, `vigencia.tsx`, `composicao.tsx`, `parametros.tsx` | **elimina 147–212 ms de tela vazia** em toda troca de unidade e competência | Nenhum — o dado anterior continua correto até o novo chegar; a chave garante o escopo |
| **Q2** | `staleTime: 60_000` nas consultas que hoje não declaram nada nas 5 telas acima | os mesmos 5 arquivos | **−1 requisição e −128.717 a −240.480 linhas de banco por revisita** | Baixo — invalidar nas mutações que já existem |
| **Q3** | Conferir e ligar compressão do host estático | `artifact.toml` / configuração do Replit | **−2.172 ms de FCP em 4G** (3.224 → 1.052 ms) | Nenhum |
| **Q4** | Tirar `/changes/range/overview` do instante do carregamento (disparar depois do conteúdo principal) | `dashboard.tsx` | **−382 ms** no `/changes/families/overview` (625 → 243 ms), medido isolando os dois | Nenhum — alimenta um cartão lateral |
| **Q5** | Reescrever `count(DISTINCT f.entity_id)` como `DISTINCT` + `count(*)` | `lib/comparison` (a consulta `snaps`) | **−60%** na consulta (137 → 55 ms), × 6 unidades no overview | Baixo — saída idêntica, conferir com `cmp` |
| **Q6** | Passar a competência inicial pelo `/contexts` que a casca já carregou, em vez de esperar por ele | `dashboard.tsx:141-158` | **−54 ms** local, −1 RTT em produção | Nenhum |
| **Q7** | Ler o catálogo uma vez por requisição em `/dre/history` em vez de por vigência | `lib/dre` | −36 das 49 consultas | Baixa |

**Q1 + Q2 juntos entregam, hoje, a maior parte do "zero loading" percebido nas
trocas** — sem tocar em arquitetura, sem esconder nada, sem mostrar dado velho
por tempo indefinido (o novo chega em 150–250 ms e substitui).

---

## 9. Mudanças estruturais

Só as que a medição justifica.

### 9.1 Agregados da Visão Geral pré-calculados na importação (P0)

**Evidência:** 531.433 linhas lidas · 46 consultas · 1.046 ms de SQL · 56% da
CPU da API · 625 ms no caminho crítico do Dashboard · vazão de 8,5 req/s.
E o resultado **não muda entre uma importação e a seguinte**.

**Comparação das estratégias do §9 do pedido:**

| Estratégia | Latência do Dashboard | Invalidação | Complexidade | Veredito |
|---|--:|---|---|---|
| A. calcular a cada request (hoje) | 625 ms | — | — | é o problema |
| B. cache em memória no processo | ~2 ms (hit) | por importação | baixa | **bom paliativo, morre no restart e não é compartilhado entre instâncias** |
| C. materialized view | ~ | `REFRESH` inteiro | média | **não** — a comparação é código TypeScript, não SQL |
| D. tabela de agregados | ~5 ms | por unidade × competência | média | **sim** |
| E. calcular na importação | ~5 ms | naturalmente correta | média | **sim — a mesma coisa que D, pelo gatilho certo** |
| F. incremental | — | — | alta | desnecessário: a importação já é o grão |
| G. combinação | — | — | — | **D+E: a importação grava o agregado; a leitura só lê** |

**Recomendação: D+E.** Uma tabela `familias_agregado (scope_hash, canal,
competencia, dataset_family, operacao, payload jsonb, import_run_id,
calculado_em)`, gravada ao fim de `promote()`, lida por `getFamiliesOverview` e
`getFamiliesView`. O `import_run_id` na linha é o que faz **ocultar uma
importação invalidar o agregado** — o mesmo mecanismo que `origin_import_run_id`
já usa nos fatos.

**Ganho projetado:** 625 ms → ~10 ms no Dashboard; vazão de 8,5 → dezenas de
req/s; a Visão Geral deixa de escalar com o número de unidades. **Este é o único
item que resolve a Causa 1**, e é o que permite prometer "abrir o produto e já
ver informação".

**Não é Redis.** Não há evidência para Redis: o dado cabe numa tabela, a
invalidação é um evento do próprio produto (a importação), e uma dependência de
infraestrutura nova não se paga aqui.

### 9.2 `/balance` com recorte, ou fora do caminho da tela (P0)

**Evidência:** 1.023.433 linhas para 2,5 KB; 2.251 ms; cresce com o histórico de
importações, não com a tela; alimenta **um cartão de percentual**.

Duas saídas, ambas legítimas:
- gravar o censo por `import_run` no fim da importação (é quando ele é barato:
  os dados estão na mão) e somar as linhas na leitura; ou
- tirar o cartão do caminho crítico do Resumo executivo e carregá-lo depois do
  resto (§9.4).

A primeira é a certa. A segunda é a que dá para fazer hoje.

### 9.3 Cache HTTP nos endpoints analíticos (P1)

Depois de 9.1, `ETag` + `Cache-Control: private, max-age=…` nos endpoints de
overview fecha o ciclo: o `304` custa 2 ms e o navegador nem precisa do corpo.
A chave do `ETag` tem de ser o mesmo que a chave do agregado —
`scope_hash + canal + competencia + operacao + import_run_id` — e é o
`import_run_id` que garante que uma importação nova ou uma ocultação produzam um
`ETag` diferente. **Sem 9.1 isso não vale a pena**: o servidor ainda pagaria os
625 ms para descobrir que podia responder 304.

### 9.4 Renderização progressiva (P1)

Hoje o Dashboard e o Resumo executivo esperam 100% dos dados para mostrar 1%
da tela. Medido, o que **poderia** aparecer antes:

| Tela | Bloqueia hoje em | Poderia aparecer em | O que fica esperando |
|---|--:|--:|---|
| Dashboard (Visão Geral) | 958 ms | **~300 ms** (cabeçalho, seletor, esqueleto dos cartões com os totais que `/contexts` já traz) | os quatro indicadores e o gráfico |
| Resumo executivo | 2.402 ms | **~250 ms** | só o cartão de cobertura (`/balance`) |
| DRE | 988 ms | **~541 ms** (`/dre/fleet` chega primeiro) | o histórico de 251 B que custa 588 ms |

**A regra:** só bloqueia a tela a consulta que responde a pergunta principal
dela. Cartões laterais, percentuais de qualidade e históricos entram quando
chegarem.

### 9.5 Code splitting por rota (P1)

**Evidência:** 3.094 KB num chunk só, 0 usos de `lazy`, `@xyflow` (122 KB) e
`pages/fechamento` (227 KB) baixados por quem abre o Dashboard, FCP de 1.052 ms
em 4G **com** gzip.

`lazy()` nas ~60 rotas de `App.tsx`, isolando `recharts`, `@xyflow` e o módulo
Fechamento. **Ganho estimado** (não medido — exigiria construir a variante):
a primeira tela precisa de ~35% do bundle, o que projeta FCP de ~1.050 → ~450 ms
em 4G. Fica declarado como estimativa.

### 9.6 Prefetch (P1) — com custo-benefício, não indiscriminado

O produto tem **um** `prefetchQuery` (`linha-do-tempo.tsx:125`). Onde vale:

| Gatilho | O que buscar | Custo | Vale? |
|---|---|--:|---|
| Depois que o Dashboard termina de carregar (`requestIdleCallback`) | as competências vizinhas da atual | 1 req de 243 ms (10 ms depois de 9.1) | **Sim** — é o clique mais provável |
| `onMouseEnter` no item do menu | a consulta da rota | 1 req | **Sim** — o hover precede o clique em ~200 ms, que é a latência inteira |
| `onMouseEnter` no seletor de unidade | a unidade sob o cursor | 1 req por hover | **Sim, com `staleTime`** |
| Ao abrir o Dashboard, buscar Painel + Resumo + Linha do Tempo + Acompanhamento | 4 endpoints | 4 req, sendo uma de 2,3 s (`/balance`) | **Não antes de 9.1 e 9.2.** Hoje isso multiplicaria por 4 a carga de um servidor que satura com 3 usuários |

**A ordem importa:** prefetch antes de 9.1 piora o p95 de todo mundo. Depois de
9.1, cada prefetch custa ~10 ms de servidor e o argumento se inverte.

---

## 10. Plano para "Zero Loading"

### Fase 1 — parar de apagar a tela (1–2 dias)

**Alterações:** Q1, Q2, Q4, Q6 do §8.

**Ganho esperado:**
- troca de unidade: **147–163 ms de tela vazia → 0 ms** (indicador discreto de
  atualização no lugar);
- troca de competência: **197–212 ms de tela vazia → 0 ms**;
- revisita a Painel, Acompanhamento, Composição, Parâmetros: **1 requisição e
  128k–240k linhas de banco → 0**;
- abertura do Dashboard: **958 → ~580 ms** (Q4 + Q6).

**Risco:** baixo. `keepPreviousData` mostra o recorte anterior por 150–250 ms
enquanto o novo chega — nunca indefinidamente, e nunca de outro escopo (a chave
carrega `scopeHash`, `canal` e `period`).

**Como validar:** o harness de `troca` deste relatório mede `msSemConteudo` e
`msComLoader` amostrando o DOM a 16 ms. A meta é `msSemConteudo = 0` nas quatro
trocas. Os testes de `freightaudit` (978 passando) devem continuar passando.

### Fase 2 — tirar o recálculo do caminho da requisição (1–2 semanas)

**Alterações:** 9.1 (agregados na importação), 9.2 (`/balance` por
`import_run`), Q5, Q7.

**Ganho esperado:**
- `/changes/families/overview`: **243 ms → ~10 ms**, e para de crescer com o
  número de unidades;
- `/balance`: **2.251 ms → ~20 ms**, e para de crescer com o histórico;
- vazão da API: **8,5 → dezenas de req/s**; p95 com 10 usuários: **3.044 ms →
  centenas de ms**;
- abertura do Dashboard: **~580 → ~300 ms**;
- Resumo executivo: **2.402 → ~250 ms**.

**Risco:** médio, e concentrado num ponto: **a invalidação**. O agregado tem de
morrer quando a importação de origem é ocultada, quando uma vigência é
substituída, quando uma classificação muda. O `import_run_id` na linha do
agregado é o que torna isso mecânico em vez de disciplinar.

**Como validar:** a resposta do endpoint com agregado tem de ser **byte a byte
idêntica** à de hoje (`cmp`), nas 6 unidades × 9 competências. Depois: importar,
ocultar, reimportar e conferir que o agregado acompanha. É o teste que decide se
a fase pode ir para produção.

### Fase 3 — antecipação e progressividade (1 semana)

**Alterações:** 9.4 (renderização progressiva), 9.5 (code splitting), 9.6
(prefetch por hover e por idle), 9.3 (`ETag`).

**Ganho esperado:**
- primeira carga em 4G: **1.959 → ~900 ms**;
- navegação para tela já visitada: já é 0 ms; passa a ser 0 ms **também na
  primeira**, para as telas prefetchadas;
- troca de competência sem cache: **~10 ms**, porque a vizinha já foi buscada
  no ocioso.

**Risco:** baixo, exceto o prefetch — que **não pode** ser feito antes da Fase 2.

**Como validar:** o harness de `spa` deste relatório, medindo `msComLoader` em
sequências de 11 navegações. A meta é `msComLoader = 0` em todas.

---

## 11. Meta de performance

| Métrica | Hoje (medido, N=6) | Meta | Como chegar | Realista? |
|---|--:|--:|---|---|
| Navegação para tela já visitada | **0 ms** (com `staleTime`) · 130–214 ms (sem) | < 100 ms | Fase 1 (Q2) | **Sim — já é assim onde há `staleTime`** |
| Troca de unidade | **147–163 ms de tela vazia** | 0 ms de tela vazia | Fase 1 (Q1) | **Sim** |
| Troca de competência | **197–212 ms de tela vazia** | 0 ms de tela vazia | Fase 1 (Q1) | **Sim** |
| Troca para recorte já visitado | **0 ms, 0 req** | manter | — | **Já cumprida** |
| Conteúdo principal de tela nova | **958 ms** (Dashboard) | < 500 ms | Fases 1 + 2 | **Sim** |
| Primeira carga, 4G | **1.959 ms** (com gzip) · 4.454 ms (sem) | < 1.500 ms | Q3 + Fase 3 | **Sim** |
| API simples, p95 | 11–14 ms | < 200 ms | — | **Já cumprida** |
| API analítica, p95 | **2.251 ms** (`/balance`) · 625 ms (overview) | < 500 ms | Fase 2 | **Sim** |
| p95 com 10 usuários | **3.044 ms** | < 800 ms | Fase 2 | **Sim** |
| Primeira pessoa do dia, cache vazio | **958 ms** | < 400 ms | Fase 2 | **Sim** |

**Onde a meta não é realista, e por quê:** "zero loading absoluto" não existe
para a **primeiríssima** requisição depois de um deploy, e não deveria. Medido:
o primeiro `families/overview` de um processo Node recém-subido custa 239 ms
contra 195 ms dos seguintes — 44 ms de aquecimento de JIT, irrelevante. O que
**não** dá para eliminar é a rede: cada tela nova precisa de pelo menos 1 RTT.
Numa rede corporativa com 60 ms de RTT, o piso de uma tela sem cache é ~120 ms —
e é aí que o prefetch da Fase 3 deixa de ser luxo.

---

## 12. Top 10 ações, por impacto / esforço / risco

| # | Ação | Impacto medido | Esforço | Risco | Arquivos |
|--:|---|---|---|---|---|
| 1 | `placeholderData: keepPreviousData` nas telas de recorte | **−147 a −212 ms de tela vazia** em toda troca de unidade e competência | 1 h | Nenhum | `dashboard.tsx`, `visao-gerencial.tsx`, `vigencia.tsx`, `composicao.tsx`, `parametros.tsx` |
| 2 | Agregados da Visão Geral gravados na importação | **625 → ~10 ms**; vazão 8,5 → dezenas de req/s; para de escalar com unidades | 1–2 sem | Médio (invalidação) | `lib/comparison`, `lib/ingest`, `lib/db/schema` |
| 3 | `/balance` por `import_run`, somado na leitura | **2.251 → ~20 ms**; para de crescer com o histórico | 3–5 d | Médio | `lib/balance`, `lib/ingest` |
| 4 | `staleTime: 60_000` nas 5 telas sem cache | **−1 req e −128k a −240k linhas de banco** por revisita | 1 h | Baixo | os mesmos 5 arquivos |
| 5 | Conferir/ligar compressão do host estático | **−2.172 ms de FCP em 4G** | 10 min | Nenhum | configuração |
| 6 | `/changes/range/overview` fora do instante do load | **−382 ms** no endpoint principal | 1 h | Nenhum | `dashboard.tsx` |
| 7 | Code splitting por rota (`lazy` nas ~60 páginas) | ~−600 ms de FCP em 4G (estimado) | 2–3 d | Baixo | `App.tsx` |
| 8 | Reescrever `count(DISTINCT)` → `DISTINCT` + `count(*)` | **−60%** na consulta (137 → 55 ms), × unidades | 2 h | Baixo | `lib/comparison` |
| 9 | Renderização progressiva no Dashboard, Resumo e DRE | conteúdo útil em ~300 ms em vez de 958–2.402 ms | 2–3 d | Baixo | `dashboard.tsx`, `inicio.tsx`, `dre.tsx` |
| 10 | Prefetch por hover no menu e no seletor de unidade | troca percebida em ~0 ms | 1 d | Baixo — **só depois da #2** | `sidebar.tsx`, `lib/contextos.ts` |

---

## 13. Limitações

Declarado, e nenhuma conclusão acima depende disto:

1. **As 5 unidades são sintéticas.** Foram geradas dos mesmos workbooks com
   unidade, placas, chassis e valores trocados, e importadas pelo caminho do
   produto. A **forma** dos dados é real; a **variedade** entre unidades não é.
   Onde isso importa: a inclinação por unidade (§4.1) é confiável; o custo
   absoluto de uma unidade com o dobro da frota, não.
2. **Um canal só** (`EMPURRADA`) e uma `dataset_family`. O produto segmenta por
   canal e o custo por canal não foi medido.
3. **Latência real até o Neon.** Tudo aqui é localhost (RTT ~0). A auditoria
   anterior mediu a *sensibilidade* — ~1 ms por consulta por ms de RTT. Com **46
   consultas** no `families/overview`, um Neon a 15 ms de distância acrescenta
   ~700 ms; a 60 ms, ~2,8 s. **Cronometrar `SELECT 1` do processo da API contra o
   Neon continua sendo o teste de cinco minutos mais valioso que existe.**
4. **Compressão do host estático do Replit.** Não observável daqui. Os dois
   cenários estão medidos (§2), a diferença é de 2,2 s em 4G, e a resposta é um
   `curl -I`.
5. **Replit, ReplShield, proxy, gateway.** Este ambiente não é o Replit.
6. **Telas sem dado no seed:** Radar de Trechos, QLP Administrativo e o módulo
   Fechamento inteiro não puderam ser medidos com carga real.
7. **O ganho do code splitting é estimado**, não medido — exigiria construir e
   medir a variante com `lazy`, o que é implementação, e este relatório é
   diagnóstico.
8. **`tup_returned`** conta linhas devolvidas por scans e leituras de índice, e
   inclui as linhas das consultas internas da própria conexão. Os números do §1
   são a média de 5 requisições com `pg_stat_reset()` antes, num banco sem
   outra atividade — a ordem de grandeza é sólida, o dígito final não.

---

## Apêndice — como reproduzir

```bash
# banco com 6 unidades
initdb -D "$PGDATA" -U freight --auth=trust      # port=55432, log_min_duration_statement=0
createdb -h 127.0.0.1 -p 55432 -U freight freightcheck
DATABASE_URL=postgres://freight@127.0.0.1:55432/freightcheck pnpm run dev:seed
DATABASE_URL=… pnpm run dev:seed <workbooks das unidades sintéticas>

# API em modo produção + bundle de produção
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/freightaudit run build
DATABASE_URL=… PORT=8080 NODE_ENV=production node artifacts/api-server/dist/index.mjs
```

Instrumentação usada, **toda fora da árvore do repositório** — nenhuma linha de
código de produto foi alterada nesta auditoria:

| Ferramenta | O que mede |
|---|---|
| `nav.mjs` | cenários `cold`, `spa`, `troca`: waterfall, ondas, duplicatas, e **amostragem do DOM a 16 ms** para saber quanto tempo a tela fica sem conteúdo e com "Carregando" |
| `jornada.mjs` | decomposição fina da abertura, com marcação por `requestAnimationFrame` |
| `api.mjs` | p50/p95/p99/frio por endpoint, com o log do Postgres como testemunha da contagem de consultas |
| `carga.mjs` | primeira carga em 4 perfis de rede, com e sem gzip |
| `carga-concorrente.mjs` | 1/3/5/10 usuários sobre o mix real de uma navegação |
| `render.mjs` | `longtask` / TBT / maior tarefa por tela |
| `bundle.mjs` | atribuição byte a byte do bundle aos arquivos-fonte, pelo sourcemap |
| `prof.mjs` + `--cpu-prof` | perfil de CPU do processo da API |
| `pg_stat_reset()` + `pg_stat_database.tup_returned` | linhas lidas do banco por requisição |

---

## Anexo — a pergunta principal, respondida

### "Por que o FreightCheck ainda precisa mostrar 'Carregando...'?"

Por três motivos, nesta ordem de peso, todos medidos:

1. **Porque nada está pronto quando alguém chega.** O Dashboard lê 531.433
   linhas e refaz a comparação das 6 unidades para escrever 5,6 KB que serão
   idênticos até a próxima importação. Não há agregado, não há cache de
   servidor, e por isso a primeira pessoa do dia — e a primeira que abre cada
   competência — espera 625 ms de recálculo puro.

2. **Porque trocar de recorte cria uma chave de cache nova, e o produto trata
   "sem cache" como "apague a tela".** O conteúdo some 16 ms depois do clique e
   volta 150–210 ms depois. `placeholderData: keepPreviousData` existe no
   produto, em 3 componentes, e em nenhuma das telas onde se troca de unidade ou
   competência.

3. **Porque 127 das 153 consultas têm `staleTime: 0`.** Voltar ao Painel de
   Unidades relê 128.717 linhas do banco; voltar ao Acompanhamento relê 240.480.
   Todas as vezes.

O que **não** é a causa, e foi medido: o React (TBT de 0 ms em 6 das 9 telas),
os índices do Postgres (todos usados, nenhum faltando), o pool de conexões, a
compressão da API (já existe), as fontes (já resolvidas), requisições duplicadas
(zero em 11 navegações) e cascatas de requisição (uma só, de 54 ms).

### "O que seria necessário para o usuário praticamente nunca mais ver uma tela de carregamento?"

Quatro coisas, e só a segunda é grande:

1. **Nunca desmontar o que já está na tela.** `keepPreviousData` nas consultas
   de recorte. Custo: 1 hora. Resolve troca de unidade e de competência hoje.

2. **Gravar o resultado da comparação quando a importação acontece, em vez de
   recalculá-lo quando alguém olha.** Uma tabela de agregados por
   `unidade × canal × competência × import_run`. É a única mudança que faz o
   produto abrir pronto — inclusive para quem chega primeiro. Custo: 1–2 semanas.
   É o item que decide se o resto vale.

3. **Guardar o que não muda.** `staleTime` nas telas que hoje não declaram nada.
   Custo: 1 hora.

4. **Antecipar o previsível** — hover no menu, competência vizinha no tempo
   ocioso. Só **depois** de (2): hoje o servidor satura com 3 usuários, e
   prefetch antes disso piora o p95 de todo mundo.

Com (1) e (3), as trocas ficam instantâneas nesta semana. Com (2), a **entrada**
fica instantânea. Com (4), a navegação inteira fica.

---

# Parte II — Fase 1, implementada e medida

**Data:** 29/08/2026 · mesmo ambiente da Parte I (Postgres 16 local com 6
unidades, 747.792 fatos, API em modo produção, bundle de produção num Chromium
real). O "antes" foi remedido **hoje**, no mesmo processo e no mesmo banco do
"depois" — não são os números da Parte I reaproveitados.

## 14. O que foi feito

Só a Fase 1 do §10. Nada da Fase 2: nenhum agregado persistido, nenhuma
mudança na importação, nenhum índice, nenhum Redis, nenhuma alteração no
algoritmo de comparação, nenhum prefetch. **Nenhuma linha de servidor mudou** —
e a tabela de endpoints do §17 é a prova disso.

| # | Mudança | Onde |
|--:|---|---|
| 1 | `placeholderData: keepPreviousData` nas leituras cuja chave carrega o recorte | 7 telas |
| 2 | `staleTime` classificado (`APURACAO_FECHADA`, 60 s) nas que não declaravam nenhum | 6 telas |
| 3 | `/changes/range/overview` fora do caminho crítico da abertura | `pages/dashboard.tsx` |
| 4 | Indicador discreto de atualização + atenuação do conteúdo anterior | `components/ui/em-atualizacao.tsx` |
| 5 | Invalidação da apuração quando a Curadoria muda uma semântica | `pages/curadoria.tsx`, `pages/categorias.tsx` |

## 15. Resultado: o critério principal

**Troca de unidade** (`/dashboard?scopeHash=…`), amostragem do DOM a 16 ms:

| Troca | Tela vazia antes | Tela vazia depois | Loader antes | Loader depois | Requisições |
|---|--:|--:|--:|--:|--:|
| CAMAÇARI → JAGUARIUNA | **147 ms** | **0 ms** | 147 ms | 0 ms | 3 → 3 |
| JAGUARIUNA → TERESINA | **163 ms** | **0 ms** | 163 ms | 0 ms | 3 → 3 |
| → CAMAÇARI (já visitada) | 0 ms | 0 ms | 0 ms | 0 ms | **1 → 0** |
| → JAGUARIUNA (já visitada) | 0 ms | 0 ms | 0 ms | 0 ms | **1 → 0** |

**Troca de competência** (Visão Geral):

| Troca | Tela vazia antes | Tela vazia depois | Requisições |
|---|--:|--:|--:|
| ago → jul/2026 | **243 ms** | **0 ms** | 1 → 1 |
| jul → jun/2026 | **251 ms** | **0 ms** | 1 → 1 |
| jun → mai/2026 | **246 ms** | **0 ms** | 1 → 1 |
| mai → jul/2026 (já visitada) | 0 ms | 0 ms | 0 → 0 |

**Troca de competência dentro de uma unidade:** 147 ms e 163 ms → **0 ms**.

**A meta era 147–212 ms → 0 ms. Cumprida em todos os dez cenários, sem
exceção.** E a revisita a um recorte já visitado deixou de fazer requisição
nenhuma.

## 16. Resultado: a abertura do Dashboard

Mediana de 3 rodadas × 3 navegações, cache do navegador frio, servidor quente.

| Marco | Antes | Depois | Ganho |
|---|--:|--:|--:|
| FCP | 196 ms | 196 ms | — |
| Casca desenhada (o loader aparece) | 245 ms | 239 ms | — |
| **Conteúdo útil (o loader some)** | **951 ms** | **569 ms** | **−40%** |

A projeção do §10 era ~580 ms. Medido: **569 ms.**

O waterfall diz de onde vieram os 382 ms:

```
ANTES  (conteúdo aos 990 ms)              DEPOIS  (conteúdo aos 559 ms)
 294 → 950   656ms  families/overview      261 → 523   261ms  families/overview
 295 → 879   584ms  range/overview         536 → 936   400ms  range/overview
 └── as duas juntas, disputando            └── a segunda só depois de a
     4 núcleos e o mesmo pool                  primeira ter entregado a tela
```

`/changes/families/overview` **não ficou mais rápido**: ficou sozinho.
656 ms → 261 ms é a disputa que sumiu, não uma consulta otimizada. O
`range/overview` continua custando 400 ms — mas agora depois de a tela estar
pronta, onde ninguém o espera.

## 17. O que **não** mudou (e é assim que se prova que nada de servidor mudou)

p50 de 7 execuções aquecidas, mesmos endpoints, mesmo banco, antes e depois:

| Endpoint | p50 antes | p50 depois | Consultas |
|---|--:|--:|--:|
| `/changes/families/overview` | 257 ms | 247 ms | 52 → 52 |
| `/changes/families` | 171 ms | 171 ms | 17 → 17 |
| `/changes/grouped` | 172 ms | 176 ms | 16 → 16 |
| `/balance` | 2.373 ms | 2.267 ms | 6 → 6 |
| `/dre/history` | 596 ms | 584 ms | 49 → 49 |
| `/composition/fleet` | 81 ms | 82 ms | 12 → 12 |
| `/gerencial/vigencias` | 10 ms | 11 ms | 4 → 4 |
| as outras 8 rotas | 2–349 ms | 3–354 ms | idênticas |

Tudo dentro do ruído, nenhuma contagem de consulta alterada. **`/balance` com
2,3 s e `/dre/history` com 49 consultas continuam exatamente onde estavam** —
são Fase 2, e a Fase 2 não foi antecipada.

## 18. Navegação quente

Sequência de 11 navegações (Dashboard ⇄ Painel ⇄ Acompanhamento ⇄ Composição
⇄ Parâmetros):

| | Antes | Depois |
|---|--:|--:|
| Requisições no total | 15 | **14** |
| Bytes no total | 400 KB | **365 KB** |
| Tempo total com "Carregando" em tela | **1.031 ms** | **641 ms** |
| 1ª visita ao Dashboard — loader | 669 ms | **278 ms** |
| Revisita ao Painel de Unidades | 1 req · 34 KB | **0 req · 0 KB** |

As três telas que ainda mostram loader na tabela (Composição 167 ms,
Parâmetros 180 ms, 1ª visita do Dashboard 278 ms) são **primeiras visitas** —
não há conteúdo anterior a preservar, e o loader ali é a resposta correta. É a
Fase 2 que os elimina, tornando a resposta rápida o bastante para não precisar
de aviso.

## 19. Corretude: o que foi verificado, e como

O risco desta mudança não é performance — é a tela afirmar o que não é. Foi
verificado no produto rodando, amostrando o DOM a 16 ms durante três trocas de
unidade e comparando três fontes: **o que a URL diz, o que a lateral diz e o
que o título diz**.

| Troca | Tela vazia | Quadros com a unidade anterior | Desses, **sem** o aviso | Título final |
|---|--:|--:|--:|---|
| CAMAÇARI → JAGUARIUNA | 0 ms | 10 | **1** | Dashboard — JAGUARIUNA |
| JAGUARIUNA → TERESINA | 0 ms | 11 | **1** | Dashboard — TERESINA |
| TERESINA → SETE LAGOAS | 0 ms | 13 | **1** | Dashboard — SETE LAGOAS |

O quadro sem aviso é sempre **um só**, e a amostragem quadro a quadro mostra
qual é:

| t | URL diz | Lateral diz | Título diz | Aviso |
|--:|---|---|---|---|
| 0 ms | CAMAÇARI | CAMAÇARI | CAMAÇARI | não |
| 18 ms | JAGUARIUNA | JAGUARIUNA | **CAMAÇARI** | **sim** |
| … | JAGUARIUNA | JAGUARIUNA | **CAMAÇARI** | **sim** |
| 182 ms | JAGUARIUNA | JAGUARIUNA | **JAGUARIUNA** | não |

O quadro sem aviso é o `t = 0` — **antes de o clique ser processado**, quando a
URL, a lateral e o título ainda dizem a mesma coisa. Ali não há nada a
declarar. Do primeiro quadro depois do clique até a resposta chegar, o aviso
está ligado; e aos 182 ms o título e os números viram **juntos**, num quadro
só.

**Não existe um quadro em que a tela mostre os números de uma unidade sob o
nome de outra sem dizer que está atualizando.**

### As cinco garantias pedidas

| Garantia | Como está sustentada |
|---|---|
| Empresa/inquilino nunca reaproveita cache de outra | Não há inquilinos hoje (`artifacts/api-server/src/lib/empresa-da-requisicao.ts`: "não há coluna de empresa em lugar nenhum"). O isolamento que existe é o de unidade/canal/competência, abaixo |
| Unidade A nunca usa como **resultado final** dados de B | A `queryKey` carrega `scopeHash` e `canal` — ela *é* a identidade da consulta. O placeholder some no instante em que a chave nova responde; o teste `dispara a consulta da chave nova, e só dela` confere o cache das duas chaves separadamente |
| Competência A nunca usa como final dados de B | Idem, `period` na chave. Verificado nas três trocas de competência |
| Ocultar/importar continua invalidando | `pages/importacoes.tsx` chama `invalidateQueries()` **sem chave** ao promover, excluir e ocultar; `pages/versoes.tsx` idem. Nenhum `staleTime` sobrevive a isso |
| Erro não deixa dado velho passando por atual | `placeholderData` só vale com status `pending`. No erro o status vira `error` e `data` volta a `undefined`. Provado em `não apresenta o dado anterior como atual quando a nova chave falha` |

### A invalidação que a mudança passou a exigir

Confirmar uma semântica na Curadoria muda o impacto apurado. Antes, as telas se
corrigiam **por acidente**: com `staleTime: 0`, a próxima montagem refazia a
chamada de qualquer jeito. Com o minuto declarado, o acidente acabou — então a
invalidação virou obrigatória e foi escrita (`invalidarApuracao`, em
`lib/frescor-das-leituras.ts`, chamada de `curadoria.tsx` e `categorias.tsx`).
**Nenhum `staleTime` entrou sem a invalidação que o sustenta.**

## 20. Testes

| Suíte | Resultado |
|---|---|
| `@workspace/freightaudit` completa | **100 arquivos · 1.528 testes · 0 falhas** |
| Typecheck do pacote | limpo |
| Typecheck do workspace (`tsc --build`) | limpo |
| Novos: `frescor-das-leituras.tela.test.tsx` | **9 testes**, num DOM real |

Os nove testes novos exercitam **o comportamento da tela**, não o do hook — e
o objeto de opções que eles montam é o `LEITURA_DE_APURACAO` exportado, não uma
cópia dele escrita no teste:

1. o conteúdo existente permanece durante a troca de recorte;
2. o novo conteúdo substitui o anterior quando chega, junto com o título;
3. mudar a chave dispara a consulta **da chave nova**, e o cache das duas não se
   mistura;
4. um erro na chave nova **remove** o conteúdo anterior e mostra o aviso;
5. a tela declara que o que está à vista é o anterior (`role="status"`);
6. voltar a um recorte já visitado não refaz a chamada;
7. `invalidarApuracao` alcança as chaves das oito telas de apuração.

## 21. Regressões encontradas

**Uma, encontrada na revisão do próprio diff e corrigida antes da medição
final.** Envolver os filhos de um contêiner `space-y-*` num `<div>` quebra o
espaçamento entre eles — o `space-y` só alcança filhos diretos. As seis
envoltórias de atenuação passaram a repetir a classe do pai
(`cn("space-y-5", classeDeAtualizacao(…))`), e o build medido no §15–16 é o
corrigido.

**Nenhuma outra.** Duas consequências fora do recorte pedido, ambas
verificadas e ambas benignas:

- **Gestão à Vista** usa `useFamiliesOverviewQuery` e herdou o
  `placeholderData`. O telão nomeia a competência a partir da **resposta**
  (`overview?.period`, `gestao-a-vista.tsx:252`), então durante uma troca ele
  mostra os números anteriores sob o rótulo anterior — consistente. O
  `refetchInterval: 30_000` é independente de `staleTime` e continua disparando.
- **Parâmetros** recebeu o indicador no título, mas não a atenuação do corpo
  (a grade é grande e a mudança visual seria maior que o necessário). Está
  registrado como diferença deliberada, não como esquecimento.

## 22. O que a Fase 1 **não** resolveu

Fica dito para não haver ilusão sobre o que se ganhou:

- **A primeira pessoa do dia continua esperando 569 ms** no Dashboard, e
  2,3 s no Resumo executivo (`/balance`). Cache do cliente não alcança quem
  chega primeiro.
- **A primeira visita a cada tela continua mostrando loader** — Composição
  167 ms, Parâmetros 180 ms. Correto, e só a Fase 2 os torna curtos o bastante
  para não precisarem de aviso.
- **A vazão da API continua em ~8,5 req/s** e o p95 com 10 usuários continua em
  3 s. Nada aqui tocou nisso.
- **O `gcTime` continua no padrão de 5 minutos**: sair de uma tela por mais de
  cinco minutos descarta o cache dela, e a volta mostra o loader de novo. Não
  foi alterado nesta rodada.

Tudo isso é §9.1 e §9.2 — a Fase 2.
