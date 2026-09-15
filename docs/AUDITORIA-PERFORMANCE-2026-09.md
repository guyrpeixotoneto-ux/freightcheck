# AUDITORIA DE PERFORMANCE — FREIGHTCHECK

**Data:** 15/09/2026 · **Método:** medição, não intuição · **Nada foi implementado.**

Esta auditoria é a **segunda**. A primeira (`docs/AUDITORIA-PERFORMANCE.md`,
26–27/08/2026) mediu, corrigiu seis coisas e deixou uma lista de pendências.
Em obediência ao pedido — *"se descobrir que o FreightCheck já possui
determinada otimização, não recrie"* — o primeiro trabalho foi **conferir o que
sobreviveu**, e só depois medir o que mudou. Desde então entraram **109
commits**, três módulos de Auditoria novos (FINAME, IPVA, Lucro Fixo) e
**+24,6% de bundle**.

Ambiente: Postgres 16 local, os dois workbooks do Freightec importados pelo
caminho do produto (`pnpm dev:seed`) — **124.632 fatos, 144 ativos, 138
atributos, 18 vigências, 110 MB** —, a API compilada em modo produção e o bundle
de produção servido a um Chromium real dirigido por Playwright. É **o mesmo
acervo da auditoria de agosto**, de propósito: os números são comparáveis linha
a linha.

Onde não foi possível medir, está dito em [§10](#10-infraestrutura). Nenhuma
conclusão depende de uma medição que não existe.

**Convenção de evidência**, usada em todo o documento:

| Marca | Quer dizer |
|---|---|
| **[MEDIDO]** | número obtido neste ambiente, com a ferramenta nomeada |
| **[CÓDIGO]** | fato lido no código, com arquivo e linha |
| **[HIPÓTESE]** | ainda não medido; o que falta para medir está dito |
| **[RECOMENDAÇÃO]** | decisão proposta, com a evidência que a sustenta |

---

## 1. Resumo executivo

*Esta seção é para ser lida sem conhecimento técnico.*

### Estado atual

**O FreightCheck está rápido na máquina onde foi medido.** Abrir qualquer uma
das 40 telas leva entre **0,16 e 0,78 segundo**. A primeira imagem aparece em
0,1 a 0,2 segundo. O navegador praticamente não trabalha: o tempo em que a tela
fica travada é **zero em 30 das 40 telas**, e no pior caso 62 milissegundos.

As seis correções de agosto **continuam todas no lugar** e continuam funcionando.
A tela do Rastreio de Dados, que custava 1,4 segundo, custa 0,63. A tela branca
de 12 segundos na entrada não existe mais.

Então por que não parece instantâneo? Por três motivos, e **nenhum deles é o
React nem o Postgres**.

### Maior gargalo — o produto inteiro é baixado de uma vez

O FreightCheck é entregue ao navegador como **um único arquivo de 849 KB
comprimido** (3,17 MB abertos). Não há divisão por tela: quem abre o Resumo
Executivo baixa também o módulo de Fechamento, a tela de Permissões e os
gráficos — tudo, antes de ver qualquer coisa.

Na máquina de teste isso é invisível. Numa rede de verdade, não:

| Rede | Tempo até a primeira imagem |
|---|--:|
| Sem limite (o teste) | **0,2 s** |
| 20 Mb/s (escritório bom) | **0,5 s** |
| 4G | **2,0 s** |
| 3G | **4,8 s** |

Para efeito de comparação: **todos os dados** da tela mais pesada do produto
somam 88 KB. O programa que os desenha pesa 849 KB — **dez vezes mais que o
dado**. Este é o maior item da auditoria, e cresceu 24,6% em três semanas sem
que nada segurasse esse crescimento.

### Segundo maior gargalo — a mesma informação é pedida duas vezes

Em **quatro telas** (Resumo Executivo, Dashboard, Panorama, Impacto Apurado), o
FreightCheck pede ao servidor **exatamente o mesmo endereço, duas vezes**, no
mesmo carregamento. Não é parecido: é o mesmo endereço, letra por letra. O
servidor responde as duas, do zero, gastando ~175 milissegundos em cada uma.

E a resposta é grande porque carrega peso morto: cada uma das 176 linhas dela
traz um bloco de detalhe de 3.856 bytes que **só é usado se a pessoa clicar
naquela linha específica** — e que o próprio código depois usa apenas para
copiar cinco palavras dele.

Somados, os dois defeitos: dessas quatro telas, **59% de tudo que trafega são
essas duas cópias**. Corrigir os dois deixa a resposta **14 vezes menor**.

### Risco futuro

Duas coisas funcionam hoje e vão piorar quando o volume crescer:

1. **Publicar uma vigência (`promote`) leva 3,8 segundos** e roda dentro de uma
   única operação do banco, presa ao clique de quem apertou o botão. É
   proporcional ao tamanho da frota. Com dez vezes mais veículos serão ~38
   segundos — e aí o clique começa a estourar o tempo limite dos servidores no
   caminho, e a pessoa vê "erro" numa importação que na verdade deu certo.
2. **Uma tela lê 83 mil linhas do banco para devolver 2,3 KB.** É a DRE. O
   número de linhas cresce com frota × vigências: hoje 83 mil, com dez vezes a
   frota e o dobro do histórico passam de 1,6 milhão.

### Maior oportunidade

**Descobrir a distância entre a API e o banco em produção.** Esta é a mesma
pergunta que a auditoria de agosto deixou aberta, e ela continua aberta — mas
agora está *quantificada*. Medimos quanto cada tela custa por milissegundo de
distância:

| Tela / consulta | Custo por ms de distância |
|---|--:|
| Dados (`/coverage`) | **24,3 ms** |
| DRE (`/dre/history`) | **19,0 ms** |
| Alterações (`/changes/consolidated`) | **17,3 ms** |

Traduzindo: se a API e o banco estiverem na mesma região (2 ms de distância), o
custo é de 40 a 50 ms — desprezível. Se estiverem em regiões diferentes (60 ms,
o erro de configuração mais comum), **a mesma tela passa de 0,1 s para 1,6 s**,
sem uma linha de código mudar.

**Isso se responde em cinco minutos**, cronometrando uma consulta trivial a
partir do processo da API em produção. Enquanto esse número não existir,
qualquer otimização de código pode estar economizando 30 ms num lugar onde se
perdem 1.500.

---

## 2. Arquitetura observada

Lida no código, não suposta.

### Forma geral

**Monorepo pnpm** com 23 bibliotecas em `lib/` e 3 aplicações em `artifacts/`.
1.460 arquivos TypeScript.

```
NAVEGADOR                         SERVIDOR                      BANCO
┌────────────────────┐   HTTP    ┌──────────────────┐   pg     ┌──────────┐
│ artifacts/         │ ────────► │ artifacts/       │ ───────► │ Postgres │
│   freightaudit     │  /api/*   │   api-server     │  pool 10 │  (Neon)  │
│                    │           │                  │          └──────────┘
│ React 19 + Vite 7  │           │ Express 5        │
│ wouter (rotas)     │           │ 274 rotas        │
│ TanStack Query     │           │ drizzle-orm      │
│ Recharts, Radix    │           │ pino / pino-http │
│ Tailwind 4         │           │ compression()    │
└────────────────────┘           └──────────────────┘
        │                                 │
        │                                 └── lib/: comparison, dre, composition,
        │                                     balance, ingest, fechamento, curation,
        │                                     coverage, remuneracao, assistant, …
        └── mesma origem: `serve = "static"` para o bundle,
            `/api/*` roteado para a API (`.replit-artifact/artifact.toml`)
```

| Camada | Onde | Fato |
|---|---|---|
| **Frontend** | `artifacts/freightaudit` | React 19, Vite 7, wouter, TanStack Query, Recharts, Radix, Tailwind 4. **~70 páginas, 172 `useQuery`.** |
| **Backend/API** | `artifacts/api-server` | Express 5, **274 rotas** em 37 arquivos. `app.ts` monta: pino-http → carimbo → CORS → **compression()** → json(64mb) → prontidão → sessão → permissão. |
| **Banco** | Postgres (Neon em produção) | **92 tabelas.** Modelo em 4 camadas: RAW → STAGING → CANÔNICO → ANALÍTICO (`docs/ARQUITETURA.md` §4). |
| **ORM** | `drizzle-orm` + `pg` | Pool declarado em `lib/db/src/index.ts:30-36`: `max 10`, connect 10 s, idle 30 s, **statement_timeout 120 s**. |
| **Autenticação** | `lib/session.ts` + `middlewares/require-session.ts` | Cookie `freightcheck_session`, TTL 7 dias absoluto. Portão fecha por padrão; abrir exige entrar em `isPublicPath`. |
| **Armazenamento** | disco + banco | Workbooks gravados como `<sha256>.xlsx`; o resto é banco. |
| **Importação** | `lib/ingest/src/pipeline.ts` (4.382 linhas) | `receiveFile → captureRaw → stage → preview → promote`. |
| **Snapshots/vigências** | tabela `snapshot` | Grão `(snapshot, entidade, atributo) → valor` na tabela `fact`. |
| **Comparação** | `lib/comparison` (29.305 linhas, 50 módulos) | `computeChangeSet` grava em `change_set`/`change`; leitura por `listChanges`, `getGroupedView`, `getFamiliesView`, `getRangeAnalysis`. |
| **Dashboards** | `/resumo-executivo`, `/dashboard`, `/panorama`, `/gestao-a-vista` | Todos consomem `/changes/families` + `/changes/range`. |
| **Balanço / Rastreio** | `lib/balance` | `/api/balance`, `/api/balance/:importRunId`. |
| **FINAME / IPVA / Lucro Fixo** | `routes/finame.ts`, `ipva.ts`, `lucro-fixo.ts` | **Novos desde agosto.** Cada um: `/comparacao`, `/totais`; só FINAME tem `/candidatos`. |
| **Filtros** | frontend | **[MEDIDO]** Aplicar filtro dispara **0 requisições** — é recorte no cliente sobre dado já carregado. |
| **Tabelas** | `components/changes/change-table.tsx` | Paginação **server-side**: `limit`, `total` na resposta. |
| **Gráficos** | Recharts | **287 KB do bundle** (9,3%). |
| **Exports** | `exceljs`, `xlsx` | Geração sob demanda. |
| **Build** | esbuild (API, bundle único) · Vite (web) | Web: **1 chunk, 0 `lazy`, 0 `import()` dinâmico**. |
| **Deploy** | Replit autoscale | Web: `serve = "static"`. API: processo Node. |
| **Jobs** | — | **Não há fila nem worker.** O único trabalho de fundo é `readInBackground` (`routes/imports.ts:454`), no mesmo processo. |

### Onde cada coisa é calculada

| Cálculo | Onde acontece | Evidência |
|---|---|---|
| Classificação de células (Rastreio) | **banco**, uma CTE grande | `lib/balance/src/classificacao.ts`, com `SET LOCAL jit = off` |
| Censo da importação | **banco**, 3 subconsultas correlacionadas | `lib/balance/src/balanco.ts` |
| Comparação entre vigências | **banco** (leitura) + **API** (agrupamento, impacto) | `lib/comparison/src/engine.ts`, `grouped.ts` |
| DRE | **API**, sobre fatos lidos crus | `lib/dre/src/apuracao.ts`, `historico.ts` |
| Composição | **API** (`comporDeFatos`) | `lib/composition/src/motor.ts` |
| Filtros de tela | **frontend** | **[MEDIDO]** 0 requisições |
| Ordenação de tabela | **frontend**, sobre a página corrente | `change-table.tsx` |
| Séries dos gráficos | **API**, já agregadas | `/changes/range` devolve `movements`/`byParameter` prontos |

### O que a auditoria de agosto corrigiu e **continua no lugar** [CÓDIGO]

Conferido arquivo por arquivo. **Nada disto deve ser refeito.**

| # | Correção de agosto | Estado hoje |
|--:|---|---|
| 1 | Fontes servidas do próprio domínio | ✅ `index.html` sem terceiros; `src/fontes.css` local |
| 2 | `compression()` no Express | ✅ `app.ts:100` — **[MEDIDO]** 7,4× a 24,2× |
| 3 | `Intl.NumberFormat` centralizado | ✅ `lib/knowledge/src/formato.ts` — ⚠️ com regressão parcial (§6.4) |
| 4 | `jit = off` na consulta do Balanço | ✅ `lib/balance/src/classificacao.ts:170`, `censo.ts:123` — `SET LOCAL`, escopo de transação |
| 5 | `staleTime` nas leituras de apuração | ⚠️ parcial — `lib/frescor-das-leituras.ts` existe, cobre 49 de 172 `useQuery` (§8.3) |
| 6 | Retry por classe de falha | ✅ `App.tsx:129-160` |
| — | Round trips de `/changes/families` | ✅ 22 → 17 consultas |
| — | `ETag`/304 (era P2 #15) | ✅ ativo (padrão do Express 5) — mas **só economiza banda**, não trabalho (§6.3) |
| — | Bulk insert por `unnest` na importação | ✅ `pipeline.ts:407-440` — **não há "milhares de inserts unitários"** |
| — | Upload fora da request | ✅ `routes/imports.ts:543` responde **202** e processa em segundo plano |

---

## 3. Baseline

### 3.1 Entrada fria em cada tela

Chromium real, bundle de produção, mediana de 3, servidor quente, localhost.
**"Pronta"** = da navegação até a última resposta de `/api` terminar.

| Tela | Pronta | FCP | DCL | Chamadas | KB (cru) | Bloqueio | Ondas | Endpoint mais lento |
|---|--:|--:|--:|--:|--:|--:|--:|---|
| `/panorama` | **776 ms** | 144 | 127 | 11 | 608 | 29 | 2 | `/changes/families` 325 ms |
| `/dre` | **759 ms** | 112 | 100 | 8 | 91 | 0 | 1 | `/dre/history` 610 ms |
| `/impacto-apurado` | **741 ms** | 228 | 193 | 9 | 592 | 28 | 2 | `/changes/families` 313 ms |
| `/resumo-executivo` | **636 ms** | 116 | 101 | 12 | 609 | 13 | 2 | `/changes/families` 273 ms |
| `/rastreio-de-dados` | **628 ms** | 116 | 99 | 8 | 17 | 0 | 1 | `/balance/:id` 451 ms |
| `/dashboard` | 515 ms | 164 | 104 | 9 | 592 | 4 | 2 | `/changes/families` 247 ms |
| `/parametros` | 514 ms | 116 | 101 | 8 | 440 | 0 | 2 | `/changes/families` 227 ms |
| `/linha-do-tempo` | 509 ms | 116 | 102 | 9 | 441 | 62 | 2 | `/changes/families` 242 ms |
| `/gestao-a-vista` | 473 ms | 140 | 127 | 4 | 436 | 0 | 2 | `/changes/families` 220 ms |
| `/impacto-financeiro` | 370 ms | 120 | 106 | 8 | 43 | 0 | 1 | `/impacto/panorama` 228 ms |
| `/vigencia` | 368 ms | 120 | 104 | 7 | 158 | 0 | 1 | `/changes/grouped` 218 ms |
| `/curadoria` | 366 ms | 128 | 106 | 9 | 63 | 0 | 2 | `/curation/queue` 190 ms |
| `/monitoramento-de-chamados` | 320 ms | 124 | 113 | 16 | 9 | 26 | 2 | — |
| `/cavalo-360` | 287 ms | 132 | 115 | 8 | 51 | 0 | 1 | `/frota/panorama` 131 ms |
| `/carreta-360` | 262 ms | 144 | 125 | 8 | 45 | 0 | 1 | `/frota/panorama` 100 ms |
| `/dados` | 259 ms | 120 | 99 | 7 | 67 | 0 | 1 | `/coverage` 100 ms |
| `/remunerado` | 248 ms | 128 | 100 | 7 | 120 | 21 | 1 | `/compras/.../matriz` 96 ms |
| `/custo-fixo-ipva` | 248 ms | 116 | 102 | 9 | 9 | 0 | 1 | `/ipva/totais` 51 ms |
| `/custo-fixo-lucro-fixo` | 246 ms | 124 | 100 | 9 | 11 | 2 | 1 | `/lucro-fixo/totais` 62 ms |
| `/evolucao-por-placa` | 233 ms | 132 | 115 | 7 | 410 | 0 | 1 | `/changes/evolucao-por-placa` 78 ms |
| `/custo-fixo-finame` | 233 ms | 116 | 102 | 9 | 42 | 9 | 1 | `/finame/totais` 50 ms |
| `/alteracoes` | 205 ms | 112 | 98 | 8 | 91 | 0 | 1 | `/changes/consolidated` 62 ms |
| as outras 18 telas | 164–228 ms | 116–132 | 99–109 | 7–14 | ≤ 37 | 0–5 | 1–2 | ≤ 39 ms |

**Nenhuma tela passa de 0,8 s.** O bloqueio da main thread é **0 ms em 30 das
40 telas** e abaixo de 5 ms em 33; o pior é 62 ms. **[MEDIDO]**

### 3.2 O que trafega de verdade (comprimido)

| Tela | API na rede | API descomprimido | Fator | Maior endpoint |
|---|--:|--:|--:|---|
| `/resumo-executivo` | **88 KB** | 1.414 KB | 16,1× | `/changes/range` 26 KB (**×2**) |
| `/panorama` | 88 KB | 1.414 KB | 16,1× | idem |
| `/dashboard` | 75 KB | 1.317 KB | 17,6× | idem |
| `/impacto-apurado` | 75 KB | 1.317 KB | 17,6× | idem |
| `/linha-do-tempo` | 50 KB | 810 KB | 16,2× | `/changes/range` 26 KB |
| `/parametros` | 49 KB | 807 KB | 16,5× | idem |
| `/gestao-a-vista` | 46 KB | 795 KB | 17,3× | idem |
| `/dre` | 15 KB | 99 KB | 6,6× | `/dre/fleet` 11 KB |
| `/alteracoes` | 8 KB | 98 KB | 12,3× | `/changes/consolidated` 4 KB |
| `/custo-fixo-finame` | 6 KB | 50 KB | 8,3× | `/finame/comparacao` 2 KB |

A compressão faz um trabalho de 6,6× a 17,6×. **Ela já está lá e está certa.**

### 3.3 Primeira carga por perfil de rede

O bundle é servido como estático. **Se o estático for comprimido:**

| Rede | TTFB | FCP | DCL | Tela pronta | JS na rede |
|---|--:|--:|--:|--:|---|
| sem limite | 3 ms | **200 ms** | 187 ms | 813 ms | 105 ms / 829 KB |
| 20 Mb/s | 2 ms | **524 ms** | 510 ms | 1.134 ms | 445 ms / 829 KB |
| 4G (4 Mb/s) | 2 ms | **2.008 ms** | 1.993 ms | 2.774 ms | 1.872 ms / 829 KB |
| 3G (1,6 Mb/s) | 2 ms | **4.784 ms** | 4.763 ms | 5.768 ms | 4.559 ms / 829 KB |

**Se o estático NÃO for comprimido** (3.093 KB na rede):

| Rede | FCP | Tela pronta | vs. comprimido |
|---|--:|--:|--:|
| sem limite | 128 ms | 888 ms | — |
| 20 Mb/s | **1.492 ms** | 2.293 ms | **2,8×** |
| 4G | **6.996 ms** | 7.723 ms | **3,5×** |
| 3G | **17.276 ms** | 18.181 ms | **3,6×** |

**NÃO FOI POSSÍVEL MEDIR** se o `serve = "static"` do Replit comprime. É um
`curl -H 'accept-encoding: gzip' -I` contra produção. **Até 3,6× de primeira
carga depende dessa resposta.**

### 3.4 Endpoints (p50 de 7, quente, contagem de consultas pelo log do Postgres)

| Endpoint | frio | p50 | p95 | Consultas | SQL | KB (cru) |
|---|--:|--:|--:|--:|--:|--:|
| `/balance/:importRunId` | 443 | **436** | 495 | 13 | 847¹ | 5,9 |
| `/dre/history` | 395 | **405** | 423 | **49** | 92 | **2,3** |
| `/changes/families` | 245 | **229** | 244 | 17 | 138 | 284,0 |
| `/impacto/panorama` | 222 | 211 | 219 | 10 | 187 | 38,1 |
| `/curation/queue` | 177 | 177 | 240 | 4 | 172 | 57,2 |
| `/changes/grouped` | 124 | 127 | 160 | 13 | 82 | 8,8 |
| `/dre/fleet` | 130 | 105 | 116 | 14 | 20 | 84,0 |
| `/changes/range` | 117 | 103 | 127 | 9 | 46 | **522,5** |
| `/changes/range/overview` | 141 | 105 | 108 | 9 | 44 | 1,0 |
| `/coverage` | 102 | 98 | 106 | **27** | 68 | 62,1 |
| `/changes/evolucao-por-placa` | 114 | 74 | 87 | 10 | 20 | 405,2 |
| `/frota/panorama` | 104 | 69 | 70 | 25 | 17 | 46,2 |
| `/compras/remunerado/frota/matriz` | 76 | 61 | 67 | 11 | 15 | 115,1 |
| `/changes/consolidated` | 45 | 44 | 47 | **26** | 35 | 85,8 |
| `/ipva/totais` | 42 | 42 | 49 | **36** | 4,6 | **1,0** |
| `/lucro-fixo/totais` | 49 | 40 | 45 | **36** | 4,7 | **0,4** |
| `/finame/totais` | 38 | 39 | 41 | **36** | 3,1 | **0,3** |
| `/finame/candidatos` (frio) | **1.921** | 85² | — | ~40 | — | 1,4 |
| `/auth/session` | 79 | 7,4 | 8,3 | 8 | 0,1 | 0,2 |
| as outras 34 rotas | ≤ 26 | ≤ 24 | ≤ 35 | 1–12 | ≤ 11 | ≤ 164 |

¹ SQL > p50 porque as consultas rodam **em paralelo** (`Promise.all`): a soma das
durações excede o relógio. É prova de que o paralelismo existe, não erro.
² quente, depois de as comparações estarem gravadas.

### 3.5 Concorrência

Uma "navegação" = as 3 a 5 chamadas que uma tela real dispara. 12 s por degrau.

| Usuários | p50 | p95 | p99 | Pior | Navegações/s | Erros | RSS |
|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 108 ms | 259 ms | 420 ms | 420 ms | 8,0 | 0 | 384 MB |
| 5 | 272 ms | 580 ms | 682 ms | 725 ms | **17,3** | 0 | 440 MB |
| 10 | 514 ms | 1.178 ms | 1.333 ms | 1.367 ms | 17,1 | 0 | 697 MB |
| 20 | 1.057 ms | **2.704 ms** | 2.861 ms | 2.952 ms | 18,2 | 0 | **907 MB** |

A vazão satura em **~17–18 navegações/s a partir de 5 usuários**; depois disso
só a latência cresce. **Zero erros.** O RSS vai de 384 MB a 907 MB — num
contêiner com teto de 1 GB isso é apertado. **[MEDIDO]**

### 3.6 O que NÃO foi possível medir neste ambiente

1. **A latência real API ↔ Neon.** Medida a *sensibilidade* (§5.2), não o valor.
2. **Se o estático do Replit é comprimido** (§3.3) — até 3,6× de primeira carga.
3. **ReplShield, proxy, redirects, gateway, cold start do contêiner.**
4. **Telas sem dado no seed**: Radar de Trechos, QLP Administrativo, o módulo
   Fechamento inteiro. **Os números delas em §3.1 não valem como veredito.**
5. **p50/p95/p99 históricos de produção** — não há série temporal (§11).
6. **Vazamento de memória** — o RSS de §3.5 é esperado sob carga; provar ou
   descartar exige teste prolongado.
7. **Troca de vigência como interação** (§4, fluxo C) — o seletor é um menu
   dentro do cabeçalho e o harness não conseguiu acioná-lo. O custo do endpoint
   por trás dele **está** medido (`/finame/candidatos`, §7.2).

---

## 4. Top 10 gargalos

Ordenados por impacto. Cada um traz onde, evidência, causa, o que o usuário
sente, proposta e risco.

---

### Gargalo 1 — Bundle único de 849 KB, sem divisão por rota

**Onde:** `artifacts/freightaudit/src/App.tsx` · `vite.config.ts`

**Evidência [MEDIDO]:** `dist/public/assets/index-*.js` = **3.166.864 bytes**
(848.957 gzip), **um chunk**. `grep -c "React.lazy\|import("` em `App.tsx` = **0**.
Atribuição byte a byte pelo sourcemap:

| Origem | KB | % |
|---|--:|--:|
| `npm:recharts` | 287,2 | 9,3% |
| `npm:react-dom` | 171,1 | 5,6% |
| `app:pages/fechamento` | 168,4 | 5,5% |
| `app:components/changes` | 162,8 | 5,3% |
| `app:components/configuracoes` | 94,1 | 3,1% |
| `npm:motion-dom` | 91,3 | 3,0% |
| `app:components/parametros` | 73,9 | 2,4% |
| `app:components/inicio` | 67,3 | 2,2% |
| `app:components/fechamento` | 56,4 | 1,8% |
| **soma das ~47 páginas** | **796,0** | **25,9%** |

Em agosto eram 2.540 KB / 690 KB gzip. **+24,6% em três semanas.**

**Causa:** todas as ~70 páginas são importadas estaticamente. O Fechamento
(224 KB entre páginas e componentes) e Configurações (94 KB) viajam para quem
nunca os abre.

**Impacto:** FCP de **2,0 s em 4G e 4,8 s em 3G** (§3.3). É o maior número da
auditoria fora do laboratório.

**Solução [RECOMENDAÇÃO]:** `React.lazy` por rota, começando pelos três blocos
que ninguém abre na primeira tela — Fechamento, Configurações, Recharts. Um
`Suspense` com o esqueleto que já existe. Mecânico, sem mudança de arquitetura.

**Risco:** BAIXO. Mudança local, reversível, com teste visual por tela.

---

### Gargalo 2 — `/api/changes/range` é pedido duas vezes, em quatro telas

**Onde:** `lib/serie-de-impacto.ts:101` vs `hooks/use-resumo-por-vigencia.ts:121`
e `lib/intervalo-da-linha-do-tempo.ts:54`

**Evidência [MEDIDO]:** mesma tela, mesmo carregamento, `performance.getEntriesByType('resource')`:

```json
[{"n":"/changes/range?from=2025-12-16&to=2026-08-01&operacao=EMPURRADA&ambiente=auditoria",
  "rede":26712,"cru":522544,"ms":198},
 {"n":"/changes/range?from=2025-12-16&to=2026-08-01&operacao=EMPURRADA&ambiente=auditoria",
  "rede":26712,"cru":522544,"ms":153}]
```

Endereço **idêntico letra por letra**, duas respostas 200 completas. Ocorre em
**`/resumo-executivo`, `/dashboard`, `/panorama`, `/impacto-apurado`**.
**52 KB dos 88 KB de API da tela — 59% — são essas duas cópias.**

**Causa [CÓDIGO]:** duas chaves de cache diferentes para a mesma URL.

```ts
// lib/serie-de-impacto.ts:101
queryKey: ["changes-range", "dashboard-impacto", chave, janela?.[0] ?? "", ate ?? ""]
// hooks/use-resumo-por-vigencia.ts:121 · lib/intervalo-da-linha-do-tempo.ts:54
queryKey: ["changes-range", query.toString()]
```

O React Query não sabe que produzem a mesma chamada, então dispara as duas.

**Impacto:** +26,7 KB e +~175 ms de servidor por carregamento, em 4 telas. A
60 ms de RTT até o banco, a segunda cópia custa também **9 consultas a mais**.

**Solução [RECOMENDAÇÃO]:** uma chave só, montada num lugar só —
`opcoesDoIntervalo` em `lib/intervalo-da-linha-do-tempo.ts` já existe para isso
e foi criada em agosto exatamente com este propósito (Parte III §18). O
`serie-de-impacto.ts` ficou de fora.

**Risco:** BAIXO. É unificar uma chave; a resposta é a mesma.

---

### Gargalo 3 — `entries[]` de `/changes/range` carrega o `group` inteiro

**Onde:** `lib/comparison/src/families-view.ts:493` (`getRangeAnalysis`)

**Evidência [MEDIDO]:** peso de cada campo de `entries[0]`:

| Campo | bytes |
|---|--:|
| `group` | **3.856** |
| todos os outros 17 campos somados | **595** |

176 entries × 2.836 bytes de média = **499.094 bytes**, que são **95,5% do
payload de 522,5 KB**. Removendo só o campo `group`:

| | antes | depois | ganho |
|---|--:|--:|--:|
| entry média | 2.836 B | 595 B | **−79%** |
| payload gzip | 52.501 B | 7.309 B | **−86%** |

> ⚠️ **CORRIGIDO NA PARTE II (§21.2). O parágrafo abaixo estava errado.** A
> busca que o sustenta cobriu apenas `components/linha-do-tempo` e
> `components/inicio`, e concluiu sobre o produto inteiro. O `group` é lido em
> mais lugares — `lib/analise.ts:453-460,628,746-760` e
> `components/parametros/analise.tsx:1739-1748,1860,1867` usam `aggregate`,
> `dominantPattern` e `fleet`. O ganho real, removendo só o campo que de fato
> ninguém lê (`entityIds`), é **−42% de gzip**, não −86%.

**Causa [CÓDIGO]:** `components/linha-do-tempo/detalhe-do-intervalo.tsx:352`
usa `entrada.group` — mas **só dentro de uma gaveta que abre no clique**, e só
para montar uma query string. `lib/recorte.ts:139-158` mostra que ele lê
exatamente **cinco campos escalares**: `attributeCode`, `entityType`,
`changeType`, `comparability`, `impact.confidence` (mais `group.key` para a
chave de cache).

Ou seja: **3.856 bytes viajam, 176 vezes, para que ~120 bytes sejam usados se
alguém clicar.**

**Impacto:** somado ao Gargalo 2, as quatro telas carregam **105 KB
comprimidos** onde 7 bastariam — **14×**.

**Solução [RECOMENDAÇÃO]:** trocar `group` por esses seis campos
(`groupKey`, `attributeCode`, `entityType`, `changeType`, `comparability`,
`impactConfidence`) em `entries[]`. A gaveta continua funcionando sem pedir
nada novo.

**Risco:** BAIXO-MÉDIO. Muda o contrato do endpoint; exige acertar
`detalhe-do-intervalo.tsx` junto. Coberto por
`lib/comparison/src/__tests__/range-real.test.ts`.

---

### Gargalo 4 — Toda tela carrega o produto inteiro antes do primeiro dado

**Onde:** consequência do Gargalo 1, medida separadamente.

**Evidência [MEDIDO]:** em §3.1, a **primeira chamada de API** só parte entre
104 e 199 ms depois da navegação, em todas as 40 telas — mesmo nas que fazem
uma chamada de 13 ms. É o tempo de baixar, compilar e executar os 849 KB antes
de o React montar e o React Query disparar.

**Impacto:** um piso de ~105 ms em localhost; em 4G esse piso é de **~1.900 ms**
(§3.3), antes de o servidor ser consultado.

**Solução [RECOMENDAÇÃO]:** o code splitting do Gargalo 1 resolve o grosso.
Complementarmente, `<link rel="modulepreload">` do chunk da rota.

**Risco:** BAIXO.

---

### Gargalo 5 — `/api/balance/:importRunId`: uma subconsulta correlacionada responde por 99,7% do trabalho

**Onde:** `lib/balance/src/balanco.ts` (o campo `com_lastro`)

**Evidência [MEDIDO]** — `EXPLAIN (ANALYZE, BUFFERS)` real:

```
Index Scan using snapshot_effective_date_idx on snapshot s
  (actual time=63.337..538.845 rows=9 loops=1)
  Buffers: shared hit=1174807
  SubPlan 1  →  1,642 ms × 9 loops   (promovidos)
  SubPlan 2  →  1,449 ms × 9 loops   (herdados)
  SubPlan 3  →  56,761 ms × 9 loops  (com_lastro)   Buffers: shared hit=1171271
Execution Time: 535.095 ms
```

**SubPlan 3 sozinho toca 1.171.271 dos 1.174.807 buffers — 99,7%.** É o
`fact → raw_cell → raw_row → raw_sheet` refeito uma vez por vigência. O
planejador estima 25 linhas e encontra 4.650.

**Reescrita equivalente medida** (uma CTE agregada em vez de subconsulta por
linha):

| | Execution Time | Buffers |
|---|--:|--:|
| como está | **535,1 ms** | 1.174.807 |
| reescrita | **110,1 ms** | 132.402 |
| **ganho** | **−79%** | **−89%** |

Saída conferida: `diff` das 9 linhas — **idênticas**.

**Impacto:** `/rastreio-de-dados` é a 5ª tela mais lenta (628 ms) e 451 ms são
esta consulta.

**Solução [RECOMENDAÇÃO]:** a reescrita acima. Nenhum índice novo.

**Risco:** BAIXO. Saída provada idêntica; `lib/balance/src/__tests__/censo.test.ts`
e `balanco-real.test.ts` cobrem.

---

### Gargalo 6 — `/api/dre/history`: 49 consultas, 18 delas o mesmo catálogo

**Onde:** `lib/dre/src/historico.ts:77` e `lib/dre/src/apuracao.ts:172-176`

**Evidência [CÓDIGO]:**

```ts
// historico.ts:77 — laço serial sobre as vigências
for (const vigencia of vigencias.todas) {
  const material = await lerMaterial(db, vigencia.effectiveDate, context);
  …
}
// apuracao.ts:172 — o que lerMaterial lê a cada volta
const [classificacoes, fatosPorAtivo, cavalos, carretas] = await Promise.all([
  loadAttributeClassificationsAt(db, effectiveDate),  // varia por data — legítimo
  lerFatosDaVigencia(db, effectiveDate, context),     // varia por data — legítimo
  lerIdentidades(db, "CAVALO"),                       // NÃO varia — relido 9×
  lerIdentidades(db, "CARRETA"),                      // NÃO varia — relido 9×
]);
```

**Evidência [MEDIDO]** — log do Postgres, consultas repetidas numa requisição:

| Vezes | Consulta |
|--:|---|
| **18×** | `SELECT e.id::text AS entity_id, e.entity_type, max(ei.identifier_value) …` |
| 9× | `SELECT a.id, a.code, … FROM attribute …` |
| 9× | `SELECT v.attribute_id, v.version, … ` |
| 9× | `SELECT f.entity_id::text, a.id::text, … FROM fact …` |

**18 das 49 consultas são a mesma leitura de identidade**, repetida uma vez por
vigência, sobre um catálogo que não muda entre elas.

E o volume: `pg_stat_statements` mostra a leitura de fatos devolvendo **9.242
linhas por chamada** (545 chamadas, 5.036.673 linhas). Com 9 vigências,
**`/dre/history` lê ~83.000 linhas para devolver 2,3 KB.**

**Perfil de CPU do Node** (25 requisições, 36.921 ms amostrados):

| Função | ms | % |
|---|--:|--:|
| `(idle)` — esperando o banco | 25.205 | 68,3% |
| `parseRow` + `parseDataRowMessage` + `utf8Slice` + `slice` (driver `pg`) | **3.369** | **9,1%** |
| anônima em `composition/motor.ts` | 1.365 | 3,7% |
| `comporDeFatos` | 1.234 | 3,3% |
| garbage collector | 1.177 | 3,2% |
| `ordenarPorPlaca` | 481 | 1,3% |
| `formatarNumero` | 75 | 0,2% |

**O maior custo de CPU é arrancar linhas do driver** — consequência direta de
ler 83 mil linhas.

**Impacto:** `/dre` é a 2ª tela mais lenta (759 ms), 610 ms são este endpoint.
E é o endpoint com **maior sensibilidade a distância depois do `/coverage`**:
19,0 ms por ms de RTT (§5.2).

**Solução [RECOMENDAÇÃO]:** duas, independentes, em ordem de esforço:
1. Ler o catálogo de identidades **uma vez por requisição** e passá-lo a
   `lerMaterial` — o parâmetro `preloaded` já existe em `getFamiliesView`
   (`families-view.ts:253`) exatamente com esse padrão. **−18 consultas.**
   > ⚠️ **CORRIGIDO NA PARTE II (§21.1).** A estimativa de "~−340 ms a 15 ms de
   > RTT" que aparece no §11 para este item **estava errada**: as 18 consultas já
   > rodavam dentro do mesmo `Promise.all` da leitura de fatos, concorrentes com
   > ela. Elas custavam trabalho de banco, não espera. O ganho é de −37% de
   > consultas por requisição, não de latência.
2. **[HIPÓTESE]** Uma leitura de fatos para todas as vigências de uma vez, em
   vez de uma por vigência. Reduz 9 idas a 1 e corta o custo de driver. Precisa
   de benchmark antes: pode aumentar o pico de memória.

**Risco:** BAIXO para (1); MÉDIO para (2). `lib/dre/src/__tests__` cobre.

---

### Gargalo 7 — `/changes/families` serializa os mesmos 46 grupos duas vezes

**Onde:** `lib/comparison/src/families-view.ts:242` (`getFamiliesView`)

**Evidência [MEDIDO]:** decomposição do payload de 289.200 bytes:

| Chave | bytes |
|---|--:|
| `groups` (topo) | 109.747 |
| `families[].parameters[].groups` | 128.703 |
| `cockpit` | 28.887 |
| todo o resto | 21.863 |

Conferência: os **46 grupos de dentro são idênticos aos 46 do topo — 100%**,
**109.700 bytes de duplicação exata (38% do payload)**.

Removendo a cópia interna:

| | antes | depois | ganho |
|---|--:|--:|--:|
| cru | 289.200 B | 179.267 B | −38,0% |
| gzip | 36.856 B | 22.604 B | **−38,7%** |
| `JSON.parse` | 0,97 ms | 0,60 ms | −38% |

**Impacto:** `/changes/families` é consumido por **6 telas** (Resumo executivo,
Dashboard, Panorama, Impacto apurado, Gestão à Vista, Parâmetros, Linha do
tempo) e é o endpoint mais lento das quatro primeiras (220–325 ms).

**Solução [RECOMENDAÇÃO]:** `parameters[].groupKeys: string[]` no lugar de
`parameters[].groups`, com o cliente reidratando do `groups` do topo.
**Atenção:** o frontend usa `parametro.groups` em 4 lugares
(`lib/drill-da-familia.ts:179`, `lib/escopos.ts:203`, `lib/visao-geral.ts:1237`,
`pages/parametros.tsx:1471`) — não é remoção, é reidratação.

**Risco:** MÉDIO. Muda contrato e toca 4 pontos do cliente. Cobertura em
`lib/comparison/src/__tests__/verdade-unica.test.ts` e
`lib/__tests__/visao-geral.test.ts`.

---

### Gargalo 8 — Endpoints de Auditoria: 36 consultas para menos de 1 KB

**Onde:** `routes/finame.ts:215`, `routes/ipva.ts:221`, `routes/lucro-fixo.ts:213`

**Evidência [MEDIDO]:** `/finame/totais` **36 consultas / 0,3 KB** ·
`/ipva/totais` **36 / 1,0 KB** · `/lucro-fixo/totais` **36 / 0,4 KB**.
É a pior relação consultas-por-byte do produto inteiro.

**Causa [CÓDIGO]** — `finame.ts:243-252`, laço aninhado com `await` dentro:

```ts
for (const { ponta, snapshot } of pontas) {        // 2 pontas
  for (const entityType of ["CAVALO","CARRETA"]) { // × 2 tipos
    const tabela = await getEntityTable(db, entityType, [code], undefined, snapshot.effectiveDate);
```

Quatro `getEntityTable` em série, cada um gastando ~9 consultas.

**Impacto:** em localhost são 40 ms — irrelevante. **A 60 ms de RTT, 36
consultas em série custam ~2,2 s** para devolver 300 bytes. As três telas de
Auditoria são novas e ninguém as mediu contra um banco distante.

**Solução [RECOMENDAÇÃO]:** (a) `Promise.all` nas quatro leituras — são
independentes; (b) verificar se `getEntityTable` pode receber os dois
`entityType` de uma vez.

**Risco:** BAIXO para (a). O `Promise.all` não muda resultado, só ordem de
espera; com pool de 10 e 4 chamadas não há pressão.

---

### Gargalo 9 — `/finame/candidatos` calcula até N comparações dentro de uma request

**Onde:** `routes/finame.ts:326-395`

**Evidência [MEDIDO]:** com `change_set` vazio, `GET /finame/candidatos?para=…`
respondeu em **1.921 ms** para **1.422 bytes**, calculando 8 comparações.
Repetição quente: **85 ms**. **[CÓDIGO]** `ORCAMENTO_MS = 8_000`,
`TETO_DE_CANDIDATOS_MS = 12_000`.

**Causa:** laço `for` sobre as vigências candidatas; quem não tem `change_set`
gravado é calculado ali mesmo.

**Impacto:** quem abre o seletor de vigência logo depois de uma importação
espera até 8 s. **[CÓDIGO]** O cliente já mitiga: `enabled: menuDeAberto`,
`staleTime: 5 min`, e um `refetchInterval` que continua de onde parou
(`pages/custo-fixo-finame.tsx:247-260`). **Este desenho é bom e não deve ser
desfeito.**

**Solução [RECOMENDAÇÃO]:** não mexer no endpoint. Aquecer as comparações
**no fim da promoção de uma vigência** — o momento em que o dado nasce e
ninguém está esperando. Reaproveita `computeChangeSet`, que já grava.

**Risco:** MÉDIO — acrescenta trabalho ao `promote`, que já é o passo mais caro
da importação (§9). Fazer **depois** de tirar o `promote` da request, não antes.

---

### Gargalo 10 — `promote` roda dentro da request, numa transação só

**Onde:** `routes/imports.ts:725` (`await promote(db, req.params.id, …)`) ·
`lib/ingest/src/pipeline.ts:3240`

**Evidência [MEDIDO]**, um workbook (658 linhas, 42.770 células, 9 vigências):

| Etapa | ms | % | Onde roda |
|---|--:|--:|---|
| `migrations` | 853 | — | partida |
| `receiveFile` | 20 | 0,3% | **na request** (responde 202) |
| `captureRaw` | 847 | 12,8% | segundo plano |
| `stage` | 1.888 | 28,5% | segundo plano |
| `preview` | 98 | 1,5% | segundo plano |
| **`promote`** | **3.770** | **56,9%** | **na request, 1 transação** |
| total | 6.623 | | |

RSS 210 → 320 MB por workbook.

**Causa [CÓDIGO]:** `promote` é `db.transaction(async (tx) => { … })` envolvendo
a promoção inteira. Dentro dela, o Postgres ainda roda **132.672 verificações de
chave estrangeira** (`SELECT 1 FROM ONLY "entity" … FOR KEY SHARE`) — uma por
fato inserido.

**Impacto hoje:** aceitável — 3,8 s e `statement_timeout` de 120 s.
**Impacto futuro [HIPÓTESE]:** é linear no tamanho da frota. Com 10× os
veículos são ~38 s numa transação só, presos a um clique. Proxies costumam
cortar em 30–60 s, e a pessoa veria "erro" numa importação que funcionou.

**Solução [RECOMENDAÇÃO]:** **não mudar agora.** Documentar o limite e medir
com frota sintética 10× antes de decidir. Se confirmar, o caminho é o mesmo
`readInBackground` que o upload já usa — a infraestrutura existe.

**Risco de mexer agora:** ALTO. `promote` é o ponto onde a integridade da
vigência é garantida; quebrar a transação é mexer em correção, não em
performance.

---

## 5. Banco de dados

### 5.1 Consultas mais caras (`pg_stat_statements`, sessão inteira)

| Chamadas | Total | Média | Linhas | Consulta |
|--:|--:|--:|--:|---|
| 66 | 5.069 ms | 76,8 ms | 432 | `SELECT cs.id … change_set ⋈ snapshot` (comparações) |
| 18 | 4.013 ms | 223,0 ms | 83.241 | `insert into "fact"` (importação) |
| **6** | **2.612 ms** | **435,4 ms** | **54** | **censo do Rastreio — Gargalo 5** |
| 27 | 2.076 ms | 76,9 ms | 166.023 | `fact ⋈ entity ⋈ entity_identifier ⋈ attribute` |
| 100 | 1.789 ms | 17,9 ms | 588.200 | `listChanges` |
| 9 | 1.544 ms | 171,6 ms | 1.242 | inventário de atributos (`/curation/queue`) |
| **545** | — | **10,5 ms** | **5.036.673** | **`lerFatosDaVigencia` — 9.242 linhas/chamada** |
| 132.672 | 507 ms | 0,004 ms | 132.672 | `SELECT 1 FROM ONLY "entity" … FOR KEY SHARE` (FK na importação) |
| 132.639 | 470 ms | 0,004 ms | 132.639 | idem para `attribute` |

### 5.2 Sensibilidade ao RTT — o número que o localhost esconde

Proxy TCP com atraso injetado entre o Node e o Postgres. Mesma API, mesmo banco,
mesmos dados; só a distância muda. **[MEDIDO]**

| Endpoint | Consultas | RTT 0 | RTT 5 | RTT 15 | **ms por ms de RTT** |
|---|--:|--:|--:|--:|--:|
| `/coverage` | 27 | 290 ms | 403 ms | 654 ms | **24,3** |
| `/dre/history` | 49 | 765 ms | 796 ms | 1.050 ms | **19,0** |
| `/changes/consolidated` | 26 | 86 ms | 144 ms | 345 ms | **17,3** |
| `/changes/grouped` | 13 | 132 ms | 217 ms | 328 ms | **13,1** |
| `/changes/families` | 17 | 302 ms | 315 ms | 494 ms | **12,8** |
| `/auth/session` | 8 | 9 ms | 44 ms | 124 ms | **7,7** |
| `/contexts` | 3 | 7 ms | 19 ms | 49 ms | **2,9** |

Projeção a 60 ms (regiões diferentes) **[HIPÓTESE, extrapolação linear da
medição acima]**:

| Endpoint | hoje (localhost) | a 60 ms de RTT |
|---|--:|--:|
| `/coverage` | 290 ms | **~1.750 ms** |
| `/dre/history` | 765 ms | **~1.900 ms** |
| `/changes/consolidated` | 86 ms | **~1.125 ms** |
| `/finame/totais` (36 consultas) | 39 ms | **~2.200 ms** |

**Este é o único número que pode inverter toda a ordem de prioridade deste
documento.** Ele se obtém em cinco minutos (§16).

### 5.3 Índices

**Nenhum índice novo é recomendado. [MEDIDO]**

Os planos das consultas quentes usam os índices existentes
(`fact_snapshot_entity_idx`, `snapshot_effective_date_idx`,
`change_set_idx`, …). Os `Seq Scan` que aparecem são sobre `raw_row` (1.217
linhas) e `raw_sheet` (2 linhas), onde índice é mais caro que varrer.

O Gargalo 5 **não é falta de índice**: o plano já usa índice. É a *forma* da
consulta — subconsulta correlacionada em vez de agregação única.

**Sobre índices "não usados":** `pg_stat_user_indexes` lista 12 com `idx_scan = 0`
(entre eles `fact_grain_uq`, 11 MB, e `staged_fact_grain_uq`, 12 MB). **Não
recomendo derrubar nenhum:** são restrições de unicidade que sustentam
correção, e o zero reflete esta sessão de auditoria, não produção.

### 5.4 O que foi procurado e **não existe**

| Suspeita do pedido | Veredito | Evidência |
|---|---|---|
| Full table scans problemáticos | **NÃO** | seq scans só em tabelas de 2 e 1.217 linhas |
| Índices ausentes | **NÃO** | planos usam os existentes |
| `SELECT *` | **NÃO** | consultas listam colunas |
| Casts/funções anulando índice | **NÃO** | `::text` aparece na projeção, não no `WHERE` |
| OFFSET alto | **NÃO** | paginação por `limit` + `total` |
| Paginação inadequada | **NÃO** | server-side: 200 de 267 linhas **[MEDIDO]** |
| N+1 clássico (1 + N por linha) | **NÃO** | o padrão é catálogo relido por vigência (Gargalo 6) — limitado e conhecido |
| Inserts unitários na importação | **NÃO** | `unnest` por coluna, `pipeline.ts:407-440` |
| Pool pequeno demais | **NÃO** | medido em agosto: 10 vs 30 indistinguível; a saturação é de CPU (§3.5) |

---

## 6. Backend / API

### 6.1 Contagem de consultas — o eixo que importa em produção

| Consultas | Endpoints |
|--:|---|
| **36** | `/finame/totais`, `/ipva/totais`, `/lucro-fixo/totais` |
| **49** | `/dre/history` |
| **27** | `/coverage` |
| **26** | `/changes/consolidated` |
| **25** | `/frota/panorama` |
| **17** | `/changes/families` |
| 2–14 | as outras 47 rotas medidas |

Em localhost, contagem de consultas é quase invisível. Em produção ela **é** a
latência (§5.2).

### 6.2 Concorrência: em geral já está certa

**[CÓDIGO]** `Promise.all` aparece em 12 arquivos de rota. `/api/balance/:id`
dispara 5 leituras concorrentes — e a prova está na medição: o SQL somado
(847 ms) **excede** o relógio (436 ms), o que só acontece se rodarem em
paralelo. **[MEDIDO]**

Os dois lugares onde falta são o Gargalo 6 (laço serial por vigência) e o
Gargalo 8 (quatro `getEntityTable` em série).

### 6.3 ETag/304: economiza banda, não trabalho

**[MEDIDO]** No log do shim: `304 /changes/families … 92,27 ms, 11 consultas`.
**[CÓDIGO]** Não há código de ETag no repositório — é o padrão do Express 5,
que calcula o hash **sobre o corpo já pronto**.

Ou seja: um 304 roda as 17 consultas, monta os 289 KB, e só então descobre que
não precisava mandar. **Está certo assim** — trocar por um ETag barato (versão
da importação) é o P2 #15 de agosto, e continua valendo, mas depois dos
gargalos 1 a 3.

### 6.4 `toLocaleString` por chamada: regressão medida, mas **fria**

**[CÓDIGO]** A correção de agosto centralizou o formatador em
`lib/knowledge/src/formato.ts`. Desde então, **21 novos sítios** voltaram a
chamar `toLocaleString("pt-BR", { … })` por chamada:

| Arquivo | Ocorrências |
|---|--:|
| `lib/composition/src/conjunto.ts` | 3 |
| `lib/fechamento/src/matriz.ts` | 2 |
| `lib/composition/src/status.ts` | 2 |
| `lib/comparison/src/cockpit.ts` | 2 |
| `lib/assistant/src/orquestrador.ts` | 2 |
| outros 10 arquivos | 1 cada |

**[MEDIDO]** nesta máquina, 200.000 chamadas: `toLocaleString(opts)` 23,37 µs ·
`Intl.NumberFormat` reaproveitado 0,52 µs — **44,6×**, saída idêntica.

**[MEDIDO] MAS:** no perfil de CPU de `/dre/history`, `formatarNumero` aparece
com **75 ms de 36.921 (0,2%)**. **Não é gargalo hoje.**

**[RECOMENDAÇÃO]** Não priorizar. Vale como higiene — trocar os 21 sítios pelo
formatador que já existe é mecânico e sem risco — e como prevenção para quando
as tabelas crescerem. **Não entra nos quick wins porque a evidência não o
sustenta.**

### 6.5 Custo fixo por requisição

**[MEDIDO]** `/auth/session` faz **8 consultas** e tem inclinação de **7,7 ms
por ms de RTT**. A 60 ms isso é **~460 ms antes de qualquer rota começar**.
Vale confirmar quantas dessas 8 são a resolução de sessão propriamente dita e
quantas são da rota — **[HIPÓTESE]**, não medido separadamente.

---

## 7. Motor de comparação

### 7.1 Complexidade: **não há O(n²)**

**[CÓDIGO]** Leitura de `engine.ts` (948 linhas), `grouped.ts` (2.310),
`families-view.ts` (1.014), `impacto.ts` (984), `panorama.ts` (960).

| O que se procurou | Achado |
|---|---|
| Laço dentro de laço sobre o mesmo conjunto | **não** |
| `.find()`/`.filter()` dentro de laço sobre N | **não** nos caminhos quentes |
| Estruturas usadas | `Map`/`Set` por chave — `groupsByParameter`, `rowsByParameter`, `identidades`, `aprovadosPorAtivo` |
| Passes sobre os dados | um por finalidade, não aninhados |
| Cópias de objetos | `flatMap` na montagem final — linear |

`getFamiliesView` (`families-view.ts:242`) é **um passe** para agrupar por
parâmetro, **um** para agrupar linhas, e **um** por família. É O(n).

**[RECOMENDAÇÃO] Não reescrever o motor.** O custo não está no algoritmo.

### 7.2 Onde o custo do motor realmente está

Três coisas, todas medidas, nenhuma algorítmica:

1. **Leitura de linhas.** 9.242 linhas por vigência (§5.1); no perfil de CPU o
   maior grupo é o *driver* do Postgres desserializando (9,1%), não o motor.
2. **Recomputação por vigência** em vez de por requisição (Gargalo 6).
3. **Serialização.** 38% do payload de `/changes/families` é duplicação exata
   (Gargalo 7); 95,5% do de `/changes/range` é um campo que quase ninguém lê
   (Gargalo 3).

**O motor de comparação não é o gargalo. A forma como o resultado dele é lido e
serializado, é.**

### 7.3 Reaproveitamento já existente — **não recriar**

**[CÓDIGO]** `getChangeSetForPair` responde por quem já foi comparado; só quem
nunca foi passa por `computeChangeSet` (`routes/finame.ts:355-368`). O resultado
fica gravado em `change_set`/`change`. Há também o parâmetro `preloaded` em
`getFamiliesView` (`families-view.ts:253`), criado em agosto para não reler
contexto e inventário por unidade.

Esse mesmo padrão `preloaded` é a solução do Gargalo 6.

---

## 8. Frontend

### 8.1 Render: **não é o problema** — confirmado pela segunda vez

**[MEDIDO]** Bloqueio da main thread (TBT) na entrada fria:

| | Resultado |
|---|---|
| TBT = 0 ms | **30 das 40 telas** |
| TBT ≤ 5 ms | **33 das 40 telas** |
| Pior TBT | **62 ms** (`/linha-do-tempo`) |
| As 10 telas com TBT > 0 | 62, 29, 28, 26, 21, 13, 9, 5, 4, 2 ms |

**[RECOMENDAÇÃO] Não adicionar `useMemo`, `React.memo` nem virtualização.**
Não há evidência de que rendam nada. É a mesma conclusão de agosto, reconfirmada
com um bundle 24,6% maior e três módulos novos.

### 8.2 Tabelas: **não estamos trazendo dados demais**

**[MEDIDO]** `/change-sets/:id/changes` devolve `rows: 200` com `total: 267` —
paginação server-side real. Cada linha pesa ~798 bytes.

**[MEDIDO]** Aplicar um filtro dispara **0 requisições** (305 ms para abrir o
menu, 193 ms para aplicar). O recorte é no cliente, sobre dado já carregado.
**Não há "um filtro provoca consulta inteira nova".**

A resposta à pergunta do §8 do pedido — *"estamos trazendo dados demais para o
navegador?"* — é: **não em linhas de tabela; sim em campos por linha**
(Gargalo 3: 3.856 bytes de `group` por entry).

### 8.3 Cache de leitura: cobertura parcial

**[MEDIDO]** 172 `useQuery` no produto; **49 declaram uma política de frescor**
(`staleTime` ou `LEITURA_DE_APURACAO`), **123 não**. O padrão global segue
`staleTime: 0` — **[CÓDIGO]** `App.tsx:156`: *"`staleTime` é 0 por padrão neste
app, então `refetchOnMount` continua refazendo a consulta a cada navegação"*.

A política existe e está bem desenhada (`lib/frescor-das-leituras.ts`, com
invalidação por evento em vez de relógio). **Não recriar — estender.**

### 8.4 Gráficos

**[CÓDIGO]** O backend já devolve série agregada: `/changes/range` traz
`movements`, `byParameter`, `lossesByPeriodicity` prontos. **Não há agregação
refeita no cliente.**

O custo do Recharts é **de bundle (287 KB, 9,3%), não de render** — TBT 0 ms nas
telas com gráfico. **[RECOMENDAÇÃO]** Não trocar de biblioteca; isolar em chunk
próprio (Gargalo 1).

### 8.5 Requisições duplicadas — mapa completo **[MEDIDO]**

| Tela | Chamadas | Duplicadas | Desperdício (cru) |
|---|--:|--:|--:|
| `/resumo-executivo` | 12 | `/changes/range` **2×**, `/imports` **2×** | **512,1 KB** |
| `/panorama` | 11 | `/changes/range` **2×** | 510,3 KB |
| `/dashboard` | 9 | `/changes/range` **2×** | 510,3 KB |
| `/impacto-apurado` | 9 | `/changes/range` **2×** | 510,3 KB |
| `/justificativas` | 12 | `/change-sets` 2×, `/build` 3× | 9,3 KB |
| `/linha-do-tempo` | 9 | — | 0 |
| `/gestao-a-vista` | 4 | — | 0 |
| `/parametros` | 8 | — | 0 |
| `/alteracoes` | 8 | — | 0 |
| `/custo-fixo-finame` | 9 | — | 0 |

### 8.6 Mapa Tela → endpoints → custo

| Tela | Endpoints | Consultas somadas | Wire | Maior custo |
|---|---|--:|--:|---|
| Resumo executivo | `session`, `contexts`, `change-sets`, `imports`×2, `build`, `curation/summary`, `balance`, **`changes/range`×2**, `changes/families`, `changes/grouped` | ~70 | 88 KB | `families` 273 ms |
| Dashboard | idem sem `balance` | ~60 | 75 KB | `families` 247 ms |
| DRE | `session`, `contexts`, …, `dre/fleet`, `dre/history` | ~70 | 15 KB | `dre/history` 610 ms |
| Rastreio de Dados | `session`, `contexts`, …, `balance`, `balance/:id` | ~25 | 7 KB | `balance/:id` 451 ms |
| Dados | `session`, `contexts`, …, `coverage` | ~35 | — | `coverage` 100 ms |
| Custo Fixo FINAME | `session`, …, `finame/totais`, `finame/comparacao` (+ `candidatos` no clique) | ~50 | 6 KB | `totais` **36 consultas** |

---

## 9. Importação

**[MEDIDO]**, um workbook: 658 linhas, 42.770 células, 9 vigências, 41.391 fatos.

| Etapa | ms | % | Roda onde | Veredito |
|---|--:|--:|---|---|
| `receiveFile` | 20 | 0,3% | request → **202** | ✅ correto |
| `captureRaw` | 847 | 12,8% | segundo plano | ✅ |
| `stage` | 1.888 | 28,5% | segundo plano | ✅ |
| `preview` | 98 | 1,5% | segundo plano | ✅ |
| **`promote`** | **3.770** | **56,9%** | **request, 1 transação** | ⚠️ Gargalo 10 |

RSS 210 → 320 MB. Seed completo (2 workbooks, 124.632 fatos): **22,8 s**.

**O que já está certo e não deve ser mexido [CÓDIGO]:**

- **Bulk insert por `unnest`** (`pipeline.ts:407-440`): uma array por coluna em
  vez de um parâmetro por célula. O próprio comentário registra a medição que o
  motivou (33 s → menos de 1 s). **Não há milhares de inserts unitários.**
- **Upload não bloqueia** (`routes/imports.ts:543`): responde 202 e chama
  `readInBackground`.
- **Lotes de 20.000 linhas**, com paralelismo declarado.

**O que merece atenção:**

- `promote` é 57% do custo e roda **na request, numa transação só** (Gargalo 10).
- **132.672 verificações de FK** durante a inserção dos fatos — 507 ms + 470 ms.
  É o Postgres fazendo o trabalho dele; só vale saber que existe e que cresce
  linearmente.
- `readInBackground` roda **no mesmo processo** que atende requisições. Com a
  vazão saturando em ~17 navegações/s (§3.5), uma importação de 2,8 s de CPU
  degrada todo mundo. **[HIPÓTESE]** — não medido sob carga simultânea.

---

## 10. Infraestrutura

### 10.1 Como está montado **[CÓDIGO]**

- **Web:** `serve = "static"`, `publicDir = artifacts/freightaudit/dist/public`,
  rewrite `/* → /index.html` (`.replit-artifact/artifact.toml`).
- **API:** processo Node, porta 8080, `deploymentTarget = "autoscale"`.
- **Banco:** Neon (`DATABASE_URL`). Pool `max: 10`, `statement_timeout` 120 s.
- **Compressão da API:** ✅ `app.ts:100`.
- **HTTP keep-alive:** padrão do Node/Express — não alterado.
- **Cold start do processo:** medido em agosto, 954 ms. Não é gargalo.

### 10.2 As duas perguntas de infraestrutura que **decidem** esta auditoria

| # | Pergunta | Como responder | O que está em jogo |
|--:|---|---|---|
| 1 | **Qual o RTT entre a API e o Neon?** | Cronometrar `SELECT 1` do processo da API, logar na partida | de −40 ms a **−1.500 ms por tela** (§5.2) |
| 2 | **O estático do Replit comprime?** | `curl -H 'accept-encoding: gzip' -sI https://freightcheck.com.br/assets/index-*.js` | **até 3,6×** na primeira carga (§3.3) |

Cinco minutos cada. **Juntas valem mais do que qualquer item de código deste
documento.**

### 10.3 O que continua não medido daqui

ReplShield, proxy, interstício de autenticação, redirects entre domínios,
conexões encerradas pelo gateway, cold start do contêiner do autoscale, rede e
máquina do usuário real. **Sem mudança em relação a agosto.**

---

## 11. Quick wins

Impacto alto, esforço baixo, risco baixo — **e todos com evidência medida**.

| # | Melhoria | Impacto | Esforço | Risco | Evidência | Ganho esperado |
|--:|---|---|---|---|---|---|
| **1** | Medir RTT API↔Neon e conferir compressão do estático | **CRÍTICO** | baixo | nenhum | §5.2, §3.3 | **decide a ordem de tudo**; não é ganho, é informação |
| **2** | Unificar a chave de `/changes/range` (`serie-de-impacto.ts` ↔ `intervalo-da-linha-do-tempo.ts`) | **alto** | baixo | baixo | §4 G2 — 2 respostas 200 idênticas medidas | **−26,7 KB e −175 ms** por carga, em 4 telas — *feito, `9ab7755`* |
| **3** | Tirar `entityIds` de `entries[].group` em `/changes/range` | **alto** | baixo | baixo | §4 G3 · §21.2 — 2.419 B de 3.856 não lidos | **payload −42%** (52,5 → 30,5 KB gzip) — *feito, `a2c8c4c`* |
| **4** | Reescrever `com_lastro` como agregação única | **alto** | baixo | baixo | §4 G5 — `EXPLAIN ANALYZE`, saída idêntica | **535 → 110 ms** (−79%); endpoint −60% — *feito, `9c7c3c2`* |
| **5** | Ler o catálogo de identidades 1× por requisição em `/dre/history` | **médio** | baixo | baixo | §4 G6 · §21.1 — 18× a mesma consulta no log | **−19 consultas (−37%)**; sem ganho de latência — *feito, `b45dbb6`* |
| **6** | `Promise.all` nas 4 leituras de `*/totais` | **médio** | baixo | baixo | §4 G8 — 36 consultas em série | ~−1,6 s a 60 ms de RTT |
| **7** | Reidratar `parameters[].groups` de `/changes/families` | **médio** | baixo | médio | §4 G7 — 109.700 B duplicados, 100% idênticos | **gzip −38,7%** |
| **8** | Estender `LEITURA_DE_APURACAO` às 123 `useQuery` sem política | **médio** | baixo | baixo | §8.3 | elimina refetch por navegação |
| **9** | Remover as duplicatas menores (`/imports` 2×, `/change-sets` 2×, `/build` 3×) | **baixo** | baixo | baixo | §8.5 | −9,3 KB e 4 chamadas |

**Fora dos quick wins de propósito:** a troca dos 21 `toLocaleString` (§6.4). É
barata e sem risco, mas o perfil de CPU mostra 0,2% — **a evidência não a
sustenta como prioridade.** Entra como higiene na Fase 3.

---

## 12. Melhorias estruturais

Separadas dos quick wins porque exigem decisão de arquitetura.

| # | Melhoria | Impacto | Esforço | Risco | Evidência | Quando |
|--:|---|---|---|---|---|---|
| **E1** | **Code splitting por rota** (`React.lazy` nas ~70 páginas; isolar Fechamento, Configurações e Recharts) | **CRÍTICO** | médio | baixo | §4 G1 — 849 KB, 1 chunk, FCP 2,0 s em 4G | Fase 3 |
| **E2** | Leitura de fatos **de todas as vigências numa consulta** em `/dre/history` | alto | médio | médio | §4 G6 — 9 idas, 83 mil linhas | Fase 4, **só com benchmark antes** |
| **E3** | Aquecer as comparações **no fim do `promote`** | médio | médio | médio | §4 G9 — 1.921 ms a frio | Fase 4, **depois de E4** |
| **E4** | Tirar o `promote` da request | médio hoje, **alto no futuro** | alto | alto | §4 G10 — 3,8 s, linear na frota | Fase 4, **só se o teste 10× confirmar** |
| **E5** | `ETag` barato (versão da importação) antes de montar a resposta | médio | médio | baixo | §6.3 — 304 custa 92 ms e 11 consultas | Fase 4 |
| **E6** | Orçamento de bundle no CI (falhar se passar de X KB) | preventivo | baixo | nenhum | §4 G1 — +24,6% sem ninguém notar | Fase 1 |

### O que **NÃO** fazer

- **Não criar índices.** §5.3 — os planos já usam os existentes.
- **Não derrubar índices "não usados".** §5.3 — são restrições de unicidade.
- **Não aumentar o pool.** Medido em agosto (10 vs 30, indistinguível); a
  saturação é de CPU (§3.5).
- **Não adicionar `useMemo`/`React.memo`/virtualização.** §8.1 — TBT 0 ms em 36
  de 40 telas.
- **Não reescrever o motor de comparação.** §7.1 — é O(n); o custo é leitura e
  serialização.
- **Não trocar o Recharts.** §8.4 — é peso de bundle (E1), não de render.
- **Não criar cache de aplicação agora.** §13.
- **Não mexer no `promote`** sem o teste de volume (§14).
- **Não desfazer o desenho de `/finame/candidatos`** — o orçamento, o
  `staleTime` de 5 min e a retomada por `refetchInterval` estão certos.

---

## 13. Cache — onde faria sentido, e por que não é a primeira resposta

Classificação pedida no §11 do pedido. **Nenhum destes é recomendado para a
Fase 1**: os Gargalos 2, 3, 5 e 7 são *desperdício*, e cache sobre desperdício
guarda o desperdício.

| Classe | Candidato | Chave | Duração | Invalidação | Risco | Ganho esperado |
|---|---|---|---|---|---|---|
| **Seguro** (imutável por vigência) | `/changes/families`, `/changes/grouped` por `(snapshotA, snapshotB)` | par de ids + hash da curadoria | até nova importação | já existe: `invalidarApuracao` + os 4 eventos de `frescor-das-leituras.ts` | **baixo** | precisa de benchmark |
| **Por contexto** | `/coverage`, `/frota/panorama` | operação + unidade + canal + vigência | 60 s | mesma | **médio** — errar a chave mistura unidades | precisa de benchmark |
| **Derivado** | KPIs de `/changes/range` (`impact`, `totals`, `byParameter`) sobre vigências fechadas | mesma do seguro | até nova importação | mesma | baixo | precisa de benchmark |
| **Perigoso — NÃO fazer** | `/auth/session`, `/contexts`, `/curation/summary`, qualquer coisa por usuário | — | — | — | **ALTO** — mistura tenant/operação/permissão | — |

**A regra:** o §25 do pedido é explícito — isolamento por tenant, operação,
unidade e permissões não podem regredir. Cache por contexto é exatamente o lugar
onde isso quebra em silêncio. **Cache entra na Fase 4, depois que o desperdício
sair.**

---

## 14. Problemas que crescem com o volume

| O que cresce | Hoje **[MEDIDO]** | 10× frota **[HIPÓTESE]** | Por quê | Gravidade |
|---|--:|--:|---|---|
| `promote` de uma vigência | 3.770 ms | **~38 s** | linear nos fatos; 1 transação na request | **ALTA** — cruza timeout de proxy |
| Linhas lidas por `/dre/history` | 83.178 | **~832.000** | 9.242 linhas/vigência × frota × vigências | **ALTA** |
| Verificações de FK na importação | 132.672 | ~1.330.000 | uma por fato | média |
| `/finame/candidatos` a frio | 1.921 ms (8 pares) | cresce com **nº de vigências** | `computeChangeSet` por par | média — já tem orçamento |
| `entries[]` de `/changes/range` | 176 × 2.836 B | cresce com **nº de alterações** | Gargalo 3 | média — Quick Win 3 resolve |
| RSS sob 20 usuários | 907 MB | — | — | **ALTA** se o contêiner tiver 1 GB |
| Bundle | 849 KB gzip | +24,6% a cada 3 semanas | sem orçamento no CI | **ALTA** — E6 |

**[NÃO MEDIDO]** Nenhum teste com frota sintética 1k/10k/100k foi feito — não há
gerador de volume no repositório e construir um seria trabalho de dias. As
projeções acima são **extrapolações lineares de custos unitários medidos**, e
estão marcadas como hipótese. **A recomendação é construir esse gerador antes da
Fase 4**, não antes da Fase 1.

---

## 15. Performance percebida

Depois dos gargalos reais, e **não no lugar deles**.

| Onde | O que fazer | Por que agora | Evidência |
|---|---|---|---|
| Entrada em qualquer tela | Esqueleto por rota durante o chunk lazy (E1) | Com code splitting há uma espera nova, curta e por rota | §4 G1 |
| `/finame/candidatos` | Progresso visível ("calculando 3 de 8…") | **1.921 ms a frio** num clique; o `pendentes` da resposta já dá o número | §4 G9 |
| `/dre` | Carregamento progressivo: `dre/fleet` (105 ms) pinta antes de `dre/history` (405 ms) | A tela espera 610 ms por um payload de 2,3 KB | §3.4 |
| Troca de vigência / filtros | `keepPreviousData` — já existe como `MANTER_ENQUANTO_CARREGA` (`frescor-das-leituras.ts:108`) | Evita a tela piscar vazia | §8.3 |
| Prefetch | Ao passar o mouse na lateral, `prefetchQuery` da rota | O padrão já existe na Linha do Tempo (agosto, Parte III §18) | — |

**Nada disto substitui os Gargalos 1 a 3.** O §26 do pedido é explícito, e é a
regra certa: maquiagem de UX sobre backend lento é dívida com juros.

---

## 16. Plano de implementação

### Fase 0 — Instrumentação e informação (antes de tocar em código)

| # | Ação | Esforço |
|--:|---|---|
| 0.1 | **Cronometrar `SELECT 1` do processo da API contra o Neon** e logar na partida | 5 min |
| 0.2 | **Conferir se o estático do Replit é comprimido** (`curl -sI -H 'accept-encoding: gzip'`) | 5 min |
| 0.3 | Ligar `pg_stat_statements` no Neon e guardar o top 20 semanal | 30 min |
| 0.4 | Publicar `nQueries` e `dbMs` por requisição no log — **estendendo o `iniciarFase` que já existe** (`lib/observabilidade.ts`), não uma plataforma nova | 2 h |

**O que já existe e não precisa ser recriado:** `pino-http` já loga
`responseTime` e `req.id` por requisição; `carimboDaApi` já devolve o id no
cabeçalho; `iniciarFase` já mede fases em 4 rotas; `/healthz`, `/readyz`,
`/startupz`, `/build` já existem.

### Fase 1 — Quick wins (a ordem exata depende de 0.1)

Quick Wins 2, 3, 4, 5 e 9. Cada um num commit, cada um com o benchmark antes e
depois do §17. **Se 0.1 revelar RTT alto**, os itens 5 e 6 (contagem de
consultas) sobem à frente dos de payload.

### Fase 2 — Banco e API

Quick Wins 6 e 7. E6 (orçamento de bundle no CI) entra aqui, porque é o que
impede a Fase 3 de ser desfeita em três semanas.

### Fase 3 — Frontend

E1 (code splitting) — o maior item isolado da auditoria. Quick Win 8
(`staleTime`). Higiene dos 21 `toLocaleString` (§6.4).

### Fase 4 — Arquitetura, **somente se os benchmarks justificarem**

E2, E5, gerador de volume (§14), depois E4 e E3 nessa ordem, e só então a
avaliação de cache (§13).

---

## 17. Como provar que melhorou

Todo o instrumental desta auditoria está em
`/tmp/…/scratchpad/harness` e **nenhuma linha de código de produto foi alterada
para medir**. Para repetir:

```bash
# banco real com os workbooks do produto
initdb -D "$PGDATA" -U freight --auth=trust
# postgresql.conf: port=55432, log_min_duration_statement=0,
#                  shared_preload_libraries='pg_stat_statements', track_io_timing=on
createdb -h 127.0.0.1 -p 55432 -U freight freightcheck
DATABASE_URL=postgres://freight@127.0.0.1:55432/freightcheck pnpm run dev:seed
#   → 18 vigências · 124.632 fatos · 144 ativos · 110 MB

pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/freightaudit run build
```

| Ferramenta | O que mede | Número de referência a bater |
|---|---|---|
| `nav.mjs` (MODO=frio) | tela pronta, FCP, DCL, TBT, ondas, por rota | §3.1 — nenhuma tela > 800 ms |
| `bytes.mjs` | bytes na rede por tela | §3.2 — `/resumo-executivo` 88 KB |
| `dup.mjs` | requisições idênticas por tela | §8.5 — **tem de chegar a zero** |
| `api.mjs` | p50/p95/frio + **contagem de consultas pelo log do Postgres** | §3.4 |
| `rtt.sh` + `pgdelay.mjs` | ms por ms de RTT | §5.2 |
| `rede.mjs` | FCP/DCL em 4 perfis de rede | §3.3 — FCP em 4G |
| `carga.mjs` | p50/p95/p99, vazão, RSS em 1/5/10/20 | §3.5 |
| `prof.mjs` + `--cpu-prof` | perfil de CPU do Node por função | §4 G6 |
| `bundle.mjs` | atribuição do bundle por módulo, via sourcemap | §4 G1 |
| `EXPLAIN (ANALYZE, BUFFERS)` | plano executado | §4 G5 |

**Regra de aceitação, por mudança (§24 do pedido):**

1. **ANTES** — rodar o benchmark da tabela acima que corresponde à mudança.
2. **ALTERAÇÃO** — uma mudança controlada, um commit.
3. **DEPOIS** — o mesmo benchmark, mesmo ambiente.
4. **Correção** — a resposta do endpoint tem de ser **byte a byte idêntica**
   (`cmp`), exceto quando a mudança é declaradamente de contrato (QW 3 e 7) — e
   aí o teste de contrato é que decide.
5. **Antes de enxugar qualquer payload** — `grep -rn "\.<campo>" artifacts/freightaudit/src`
   **sem recorte de diretório**, e conferir também os `as unknown as` que entregam
   o objeto a outro componente. Foi a falta deste passo que produziu a afirmação
   errada do §4 Gargalo 3 (ver §21.2).

**Suítes a rodar** (524 arquivos de teste, CI em 5 shards, todos com Postgres —
`scripts/ci/shards.mjs`):

| Mudança | Suítes obrigatórias |
|---|---|
| QW 2, 3 (`/changes/range`) | `@workspace/comparison` (`range-real.test.ts`, `families-view-overview.test.ts`, `contexto-do-nivel-2.test.ts`), `@workspace/freightaudit` |
| QW 4 (censo) | `@workspace/balance` (`censo.test.ts`, `balanco-real.test.ts`, `proveniencia.test.ts`) |
| QW 5, E2 (DRE) | `@workspace/dre`, `@workspace/composition` |
| QW 6 (totais) | `@workspace/comparison`, `@workspace/api-server` |
| QW 7 (`/changes/families`) | `@workspace/comparison` (`verdade-unica.test.ts`), `@workspace/freightaudit` (`visao-geral.test.ts`, `escopos.test.ts`) |
| E1 (code splitting) | `@workspace/freightaudit` inteiro + conferência visual por rota |
| **Qualquer uma** | **typecheck do workspace** + o shard `unit` (que inclui `shards.test.mjs`, o teste que reprova pacote sem shard) |

**Isolamento (§25 do pedido).** Toda mudança acima preserva contexto:
`operacao`, `ambiente`, `unidade` e `canal` continuam na chave de cache do
cliente (`queryKeyHashFn`, `App.tsx`) e no recorte do servidor
(`parseContextoDaConsulta`). **Nenhum quick win toca cálculo financeiro,
permissão, auditoria ou rastreabilidade.** Os dois que mudam contrato (QW 3 e 7)
mudam *forma de transporte*, não valor.

---

## 18. Performance alvo

Derivadas do que foi medido, não copiadas.

### Navegação (localhost, entrada fria, mediana de 3)

| Métrica | Hoje | Alvo | Como |
|---|--:|--:|---|
| Tela mediana pronta | 248 ms | **< 250 ms** | já cumprido — **manter** |
| Pior tela pronta | 776 ms | **< 500 ms** | QW 4, 5; G2, G3 |
| Telas acima de 600 ms | 5 | **0** | idem |
| Bloqueio (TBT) | 0 ms em 30/40 | **0 ms em 40/40** | manter |

### API (p50/p95, quente)

| Endpoint | p50 hoje | p50 alvo | p95 alvo |
|---|--:|--:|--:|
| `/balance/:id` | 436 ms | **< 150 ms** | < 200 ms |
| `/dre/history` | 405 ms | **< 200 ms** | < 260 ms |
| `/changes/families` | 229 ms | **< 180 ms** | < 240 ms |
| mediana das 53 rotas | 11 ms | **< 15 ms** | < 40 ms |

### Consultas por requisição (o eixo de produção)

| Hoje | Alvo |
|---|---|
| máximo 49 (`/dre/history`) | **≤ 20 em qualquer rota** |
| 36 nos três `*/totais` | **≤ 12** |
| 27 (`/coverage`), 26 (`/consolidated`) | ≤ 20 |

### Payload

| Endpoint | Wire hoje | Alvo |
|---|--:|--:|
| `/changes/range` | 26,7 KB **× 2** | **≤ 8 KB × 1** |
| `/changes/families` | 36,9 KB | **≤ 23 KB** |
| API por tela (pior) | 88 KB | **≤ 35 KB** |

### Frontend

| Métrica | Hoje | Alvo |
|---|--:|--:|
| Chunk inicial (gzip) | 849 KB | **≤ 350 KB** |
| FCP em 4G | 2.008 ms | **≤ 1.000 ms** |
| FCP em 20 Mb/s | 524 ms | **≤ 300 ms** |
| Requisições duplicadas por tela | até 2 | **0** |

### Concorrência

| Métrica | Hoje | Alvo |
|---|--:|--:|
| p95 com 10 usuários | 1.178 ms | **≤ 800 ms** |
| Vazão de saturação | 17–18 nav/s | **≥ 25 nav/s** |
| RSS com 20 usuários | 907 MB | **≤ 700 MB** |

---

## 19. Veredito

### O que eu faria primeiro — no máximo 5 ações

| # | Ação | Por quê | Esforço |
|--:|---|---|---|
| **1** | **Cronometrar `SELECT 1` API→Neon e conferir a compressão do estático** | Dez minutos que podem valer mais que os outros quatro juntos. A 60 ms de RTT cada tela paga 0,7 a 2,2 s só em ida e volta (§5.2); sem compressão estática a primeira carga custa 3,6× (§3.3). **Enquanto esses dois números não existirem, toda prioridade abaixo é provisória.** | 10 min |
| **2** | **Matar a duplicata de `/changes/range` e enxugar `entries[]`** | Dois defeitos no mesmo endpoint, em 4 telas: 2 respostas 200 idênticas de 26,7 KB, e 95,5% do payload num campo usado por clique. Juntos: **105 KB → 7 KB, 14×.** É o maior ganho por linha de código da auditoria. | ~4 h |
| **3** | **Reescrever `com_lastro` como agregação única** | `EXPLAIN (ANALYZE, BUFFERS)`: **535 → 110 ms**, buffers **1.174.807 → 132.402**, saída provada idêntica por `diff`. Uma consulta, nenhum índice, nenhum contrato. | ~2 h |
| **4** | **Ler o catálogo de identidades 1× por requisição em `/dre/history`** | 18 das 49 consultas são a mesma leitura repetida por vigência. O padrão da solução (`preloaded`) **já existe** em `families-view.ts:253`. **−18 consultas** na rota mais sensível a RTT depois do `/coverage`. | ~3 h |
| **5** | **Code splitting por rota + orçamento de bundle no CI** | 849 KB num chunk = FCP de 2,0 s em 4G. É o maior número desta auditoria fora do laboratório. O orçamento no CI vai junto: o bundle cresceu 24,6% em três semanas sem ninguém notar, e sem ele isto se desfaz sozinho. | 2–3 dias |

### O que eu **NÃO** faria agora

| Não fazer | Por quê |
|---|---|
| Criar índices | §5.3 — os planos já usam os existentes; o Gargalo 5 é forma de consulta, não falta de índice |
| Derrubar índices "não usados" | §5.3 — são restrições de unicidade; o `idx_scan = 0` é desta sessão, não de produção |
| Aumentar o pool | medido em agosto: 10 vs 30 indistinguível; a saturação é de CPU |
| `useMemo` / `React.memo` / virtualização | §8.1 — TBT 0 ms em 30 de 40 telas, pior caso 62 ms, duas auditorias seguidas |
| Reescrever o motor de comparação | §7.1 — é O(n); o custo é leitura de linhas e serialização |
| Trocar o Recharts | §8.4 — 287 KB é peso de bundle (E1), não de render |
| Camada de cache de aplicação | §13 — os Gargalos 2, 3, 5 e 7 são desperdício; cache sobre desperdício guarda o desperdício |
| Tirar o `promote` da transação | §4 G10 — é o ponto de integridade da vigência; mexer antes do teste 10× é trocar performance por correção |
| Perseguir os 21 `toLocaleString` | §6.4 — 44,6× por chamada, mas **0,2% do perfil de CPU**. Higiene, não prioridade |
| Trocar tecnologia, framework ou banco | nada na medição aponta para isso |

### Maior hipótese a validar

> **Quanto da lentidão que o usuário relata é distância até o banco, e quanto é
> o que este documento mede?**

Tudo nesta auditoria foi medido com a API e o Postgres na mesma máquina — RTT
zero. Nesse regime o FreightCheck é rápido: nenhuma tela passa de 0,8 s.

Mas a inclinação medida diz que **cada consulta custa ~1 ms por ms de distância**,
e há rotas com 27, 36 e 49 consultas. Se a API e o Neon estiverem em regiões
diferentes, `/coverage` sai de 0,29 s para ~1,75 s e `/finame/totais` de 0,04 s
para ~2,2 s — **sem uma linha de código mudar, e sem que nada neste documento
apareça como culpado.**

A segunda incerteza, menor mas da mesma natureza: **se o estático do Replit não
comprime**, a primeira carga custa 7,0 s em 4G em vez de 2,0 s, e o item 5 do
veredito vira o item 1.

**As duas se respondem em dez minutos, e nenhuma otimização de código deveria
começar antes delas.**

---

# Parte II — implementação dos quick wins 2, 3, 4 e 5

**Data:** 15/09/2026 · mesmo ambiente da Parte I, mesmo acervo, mesmo banco
congelado (`pg_dump` antes da primeira mudança, para que antes e depois sejam
medidos sobre dados idênticos).

Quatro mudanças, quatro commits independentes, cada uma medida antes e depois.
Reverter qualquer uma isoladamente é `git revert`.

**Duas previsões da Parte I estavam erradas, e estão corrigidas abaixo.** Elas
ficam registradas com o motivo, porque o erro é instrutivo: nos dois casos a
Parte I mediu o *sintoma* certo e errou a *causa*, e só a implementação revelou
a diferença.

## 20. Resultado por mudança

| Mudança | Métrica | Antes | Depois | Ganho |
|---|---|--:|--:|--:|
| **QW4** — censo por agregação (`4dce62c`→`9c7c3c2`) | `/balance/:importRunId` p50 | 445,3 ms | **177,5 ms** | **−60%** |
| | p95 | 490,5 ms | **197,6 ms** | −60% |
| | consulta isolada | 535,1 ms | **110,1 ms** | −79% |
| | buffers | 1.174.807 | **132.402** | −89% |
| **QW5** — catálogo uma vez (`b45dbb6`) | `/dre/history` consultas | 52 | **33** | **−37%** |
| | `/dre/fleet` consultas | 14 | **12** | −14% |
| | `/dre/history` p50 | 433 ms | 417 ms | −4% |
| **QW2** — chave única do intervalo (`9ab7755`) | `/changes/range` por carga | **2×** | **1×** | −1 requisição |
| | `/resumo-executivo` na rede | 88 KB | **62 KB** | −30% |
| | `/dashboard` na rede | 75 KB | **49 KB** | −35% |
| **QW3** — `entityIds` fora das entradas (`a2c8c4c`) | `/changes/range` cru | 522.544 B | **383.970 B** | −26,5% |
| | `/changes/range` gzip | 52.501 B | **30.473 B** | **−42,0%** |
| | entrada média | 2.836 B | **2.048 B** | −28% |

### Os quatro somados, por tela

Bytes de API que atravessam a rede numa entrada fria (comprimidos):

| Tela | Antes | Depois | Ganho |
|---|--:|--:|--:|
| `/resumo-executivo` | 88 KB | **57 KB** | **−35%** |
| `/panorama` | 88 KB | **56 KB** | −36% |
| `/dashboard` | 75 KB | **43 KB** | **−43%** |
| `/impacto-apurado` | 75 KB | **43 KB** | −43% |
| `/linha-do-tempo` | 50 KB | **44 KB** | −12% |
| `/parametros` | 49 KB | **43 KB** | −12% |
| `/gestao-a-vista` | 46 KB | **40 KB** | −13% |

E descomprimidos — o que o navegador de fato precisa desserializar:

| Tela | Antes | Depois | Ganho |
|---|--:|--:|--:|
| `/resumo-executivo` | 1.414 KB | **769 KB** | **−46%** |
| `/dashboard` | 1.317 KB | **671 KB** | **−49%** |
| `/panorama` | 1.414 KB | **768 KB** | −46% |
| `/impacto-apurado` | 1.317 KB | **671 KB** | −49% |

### Duplicatas

| Tela | Antes | Depois |
|---|---|---|
| `/resumo-executivo` | `/changes/range` **2×** (510 KB), `/imports` 2× | só `/imports` 2× (1,8 KB) |
| `/dashboard`, `/panorama`, `/impacto-apurado` | `/changes/range` **2×** | **nenhuma** |
| `/justificativas` | `/change-sets` 2×, `/build` 3× | inalterado (fora do escopo) |

### O que estas medições **não** dizem

**Nenhum ganho de tempo-de-tela ponta a ponta é reivindicado aqui.** A tabela
do §3.1 (entrada fria por rota) foi levantada no início da auditoria, quando o
banco tinha 1 comparação gravada; ao longo do trabalho o produto calculou outras
13, e as telas passaram a desenhar dado de verdade onde antes havia zeros.
Comparar aquela tabela com uma de agora mediria a diferença de **acervo**, não a
das mudanças — e foi exatamente o que uma primeira tentativa produziu, com
telas "engordando" de 608 para 768 KB.

Os números do §20 são todos de medições feitas **hoje, sobre o mesmo banco
congelado** (`pg_dump` antes da primeira mudança), com minutos de diferença
entre o antes e o depois: bytes na rede por tela (`bytes.mjs`), duplicatas por
tela (`dup.mjs`), p50/p95 e contagem de consultas por endpoint (`api.mjs`, com o
log do Postgres como testemunha), e o tamanho dos payloads (`cmp` e `gzip` sobre
as respostas gravadas).

Refazer a tabela do §3.1 como linha de base nova, agora que o acervo tem 14
comparações, é o primeiro passo de qualquer medição futura — e é o que o §17
manda fazer antes da próxima mudança.

## 21. As duas previsões que estavam erradas

### 21.1 QW5 não rende os ~340 ms de RTT que a Parte I anunciou

A Parte I ([§4 Gargalo 6](#gargalo-6--apidrehistory-49-consultas-18-delas-o-mesmo-catálogo))
escreveu: *"−18 consultas; ~−340 ms estimados a 15 ms de RTT"*. A parte das
consultas está certa — são 19 a menos, conferidas no log do Postgres. **A dos
milissegundos estava errada.**

O motivo, visível no código e confirmado na medição: aquelas 18 consultas
rodavam **dentro do mesmo `Promise.all`** da leitura de fatos
(`apuracao.ts:172`), concorrentes com ela. Elas custavam conexão e trabalho de
banco — não espera. Não havia 340 ms de ida e volta para economizar, porque elas
nunca foram uma ida e volta em série.

O erro da Parte I foi tratar "número de consultas" como proxy de "número de
idas e voltas". Para as rotas onde as consultas são serializadas, os dois
coincidem; onde há `Promise.all`, não.

**O que QW5 entrega, então:** 19 consultas a menos por requisição (−37% de
trabalho de banco), e uma serialização de verdade removida em `frota.ts`, onde
duas leituras de vigência independentes esperavam uma pela outra.

### 21.2 QW3 rende −42%, não os −86% que a Parte I anunciou

A Parte I ([§4 Gargalo 3](#gargalo-3--entries-de-changesrange-carrega-o-group-inteiro))
afirmou que o cliente lia do `group` "exatamente cinco campos escalares", e
projetou −86% de gzip removendo o campo inteiro.

**A afirmação era falsa, e a busca que a sustentou foi estreita demais:** ela
procurou `entry.group` em `components/linha-do-tempo` e `components/inicio` e
concluiu sobre o produto inteiro. O grupo é lido em mais lugares —
`lib/analise.ts:453-460,628,746-760` e `components/parametros/analise.tsx:1739-1748,1860,1867`
usam `aggregate`, `dominantPattern` e `fleet`. Remover o campo inteiro quebraria
a Análise de Parâmetros.

O que dava para tirar com segurança era **um** campo: `entityIds`, 2.419 dos
3.856 bytes do grupo (63%), que o tipo declarado do cliente
(`ChangeGroupLite`) sequer conhece. Ganho real: **−42,0% de gzip**, não −86%.

**A lição, para as próximas:** uma afirmação sobre "o que o cliente usa" só vale
se a busca cobriu o cliente inteiro. A checagem barata que teria pego isto é
`grep -rn "\.group" artifacts/freightaudit/src` sem recorte de diretório — e ela
está agora no §17 como passo obrigatório antes de enxugar qualquer payload.

### 21.3 Uma ferramenta da Parte I não serve para A/B de concorrência

`pgdelay.mjs` atrasa **cada bloco TCP, por socket** — não cada ida e volta.
Enquanto o número de consultas concorrentes não muda, ele é um emulador de RTT
útil, e as inclinações do [§5.2](#52-sensibilidade-ao-rtt--o-número-que-o-localhost-esconde)
continuam valendo. Quando a mudança **altera** a concorrência, ele deixa de ser
comparável.

Medido durante a implementação do QW5: a **mesma** consulta de classificação,
sem nenhuma alteração, passou de 30,4 ms para 53,0 ms de média — só porque
perdeu sockets vizinhos com que sobrepor o atraso. Sob o proxy, `/dre/history`
"piorava" de 995 ms para 1.358 ms; na conexão direta, melhorava de 433 ms para
417 ms. O número honesto é o da conexão direta.

Por isso os ganhos da tabela do §20 são todos de conexão direta, e por isso
nenhuma afirmação de RTT foi feita sobre QW5.

## 22. Regressão

**Respostas byte a byte idênticas** (`cmp`), onde a mudança não é de contrato:

| Endpoint | Bytes | Veredito |
|---|--:|---|
| `/api/balance/:importRunId` (QW4) | 5.995 | ✅ idêntico |
| `/api/dre/history` (QW5) | 2.355 | ✅ idêntico |
| `/api/dre/fleet` (QW5) | 86.040 | ✅ idêntico |

Além disso, as 9 linhas da consulta do censo foram comparadas por `diff` entre a
forma antiga e a nova: **iguais coluna por coluna**.

**Onde o contrato muda (QW3)**, a conferência é mais fina: o payload de
`/changes/range` é idêntico em tudo fora de `entries`, e as 176 entradas são
idênticas **a menos de `entityIds`** — conferido campo a campo, não por amostra.

**Suítes:**

| Pacote | Resultado |
|---|---|
| `@workspace/freightaudit` | **133 arquivos, 1.795 testes, todos passando** |
| typecheck do workspace inteiro | **limpo** (libs, api-server, freightaudit, scripts, mockup-sandbox) |
| `@workspace/balance` | não roda neste ambiente — **e não rodava antes**: 5 arquivos falhando, 1 teste falhando, 1 passando, 30 pulados, **idêntico com e sem a mudança**, a partir de banco e templates limpos |
| `@workspace/comparison` | **inútil como sinal neste ambiente**: roda um número diferente de testes a cada execução (278 e 467 pulados em duas medições), e `range-real.test.ts` pula os seus 26 por falha de fixture |

As falhas de `balance` e `comparison` são as que a auditoria de agosto já
descrevia: as suítes `-real` montam bancos descartáveis contra um único Postgres
e colidem em conteúdo (`SKIPPED_DUPLICATE`, `snapshot_canonical_live_uq`).
Serializar com `--no-file-parallelism` não resolve, porque a colisão é de
fixture, não de paralelismo.

**É por isso que o CI é o portão que falta aqui**, e é ele que tem de rodar
antes destes quatro commits entrarem na `main`: lá o template é construído uma
vez, íntegro, e as suítes `-real` de fato executam.

## 23. Isolamento e correção (§25 do pedido)

Nenhuma das quatro mudanças toca cálculo financeiro, permissão, auditoria,
rastreabilidade ou isolamento:

- **QW4** troca a forma de três contagens por vigência. A regra de negócio —
  fatos herdados fora das duas primeiras contagens — está preservada, com o
  comentário que a explica. `LEFT JOIN` + `COALESCE(…, 0)` mantêm a distinção
  entre "zero" e "ausente", que é o que a tela existe para mostrar.
- **QW5** passa adiante um catálogo em vez de relê-lo. Não é cache: não há
  invalidação, prazo nem estado entre requisições — é um argumento, com o tempo
  de vida da requisição que o criou.
- **QW2** unifica uma chave de cache do cliente. O recorte (`operacao`,
  `ambiente`, `scopeHash`, canal) continua dentro da chave, pelo mesmo caminho
  de sempre (`opcoesDoIntervalo` + `queryKeyHashFn`).
- **QW3** remove um campo não lido de um payload. A lista continua saindo em
  `/changes/families` e `/changes/grouped`, onde é lida.

## 24. O que sobra

Os quick wins **6, 7, 8 e 9** e as melhorias estruturais **E1 a E6** continuam
como o §16 os deixou. A ordem não mudou — e a Fase 0 continua sendo o primeiro
item, pelo mesmo motivo: **as duas medições de dez minutos contra produção**
(RTT até o Neon, compressão do estático) continuam sem resposta, e continuam
podendo inverter a prioridade de tudo o que vem depois.

O maior item isolado da auditoria — **E1, o code splitting** — segue intocado. O
bundle continua em 849 KB gzip num chunk só, e continua sendo o que decide a
primeira carga em qualquer rede real.

---

# Parte III — E1, o code splitting

**Data:** 15/09/2026 · mesmo ambiente das Partes I e II.

O maior item isolado da auditoria ([§4 Gargalo 1](#gargalo-1--bundle-único-de-849-kb-sem-divisão-por-rota)),
e o único cuja previsão a implementação **confirmou** em vez de corrigir.

## 25. O que mudou

As 58 páginas eram `import` estático em `App.tsx`. Agora cada rota é um
`import()`, com um `<Suspense>` só, no `Gate`, usando o mesmo spinner que ele já
mostrava enquanto conferia a sessão.

Quatro continuam adiantados, e cada um por um motivo declarado no arquivo:
`Login` (é decidido fora do `<Suspense>`, e é a tela de quem precisa dela
imediatamente), `NotFound` (é o fundo do `Switch`), e os catálogos
`TELAS_EM_PREPARO` e `etapasDoFechamento`, que são **dado e não tela** — o
roteador os percorre para montar as rotas, antes de qualquer navegação.

**`manualChunks` não foi usado, e não resolveria.** Ele agruparia as bibliotecas
em pedaços nomeados, mas continuaria mandando todos eles na primeira carga,
porque o grafo estático não muda: quem importa tudo estaticamente baixa tudo, em
um arquivo ou em oito. O que tira um módulo do caminho crítico é ele deixar de
ser **alcançável a partir da entrada**. O Rollup cuida do compartilhamento
sozinho — um módulo que duas rotas usam vira um pedaço comum, baixado uma vez —
e por isso não há lista de chunks aqui para envelhecer.

## 26. Resultado

| | Antes | Depois | Ganho |
|---|--:|--:|--:|
| Pedaço de entrada (cru) | 3.166.845 B | **548.777 B** | **−83%** |
| Pedaço de entrada (gzip) | 848.948 B | **174.782 B** | **−79%** |
| Número de pedaços | 1 | 184 | — |
| JS na primeira carga (rede) | 829 KB | **353 KB** | **−57%** |

Primeira carga num Chromium real, com o estático comprimido, medindo
`/resumo-executivo`:

| Rede | FCP antes | FCP depois | Ganho | Tela pronta antes | depois |
|---|--:|--:|--:|--:|--:|
| sem limite | 272 ms | **64 ms** | **−76%** | 2.425 ms | 1.020 ms |
| 20 Mb/s | 520 ms | **160 ms** | **−69%** | 1.213 ms | 1.094 ms |
| 4G (4 Mb/s) | 1.976 ms | **596 ms** | **−70%** | 2.783 ms | 1.992 ms |
| 3G (1,6 Mb/s) | 4.776 ms | **1.384 ms** | **−71%** | 5.767 ms | 3.952 ms |

E a tela de login — a primeira de quem chega sem sessão — passou a baixar
**1 pedaço de JS** em vez do produto inteiro.

### A distribuição dos pedaços

| Pedaço | gzip | O que é |
|---|--:|---|
| `index` (entrada) | 174.782 B | React, roteador, casca, `components/ui` |
| `generateCategoricalChart` | 101.012 B | Recharts — compartilhado, só quem tem gráfico puxa |
| `ApresentacaoVideo` | 46.452 B | a tela de vídeo |
| `parametros` | 31.002 B | a maior página |
| `configuracoes` | 29.372 B | Configurações, que antes viajava para todo mundo |
| mediana dos 184 | **1.255 B** | — |

## 27. Regressão

**Um `lazy()` quebrado não falha no build nem no typecheck: falha no clique, e
só naquela rota.** Por isso a conferência foi rota a rota, com o mesmo harness
contra os dois builds — 55 rotas, incluindo as quatro auditorias prefixadas
(`/auditoria-rota/…`, `/auditoria-as/…`) e o Fechamento:

| | Renderizaram | Mudaram de estado | 404 de chunk |
|---|--:|--:|--:|
| sem code splitting | **55/55** | — | — |
| com code splitting | **55/55** | **0** | **0** |

O critério não é "não explodiu": é **ter renderizado** — sem erro de página, sem
erro de console que não seja 404 de API, com conteúdo na tela, e sem cair no
`NotFound`.

As 8 respostas 404 observadas são todas de `/api` e **idênticas nos dois lados**:
são as telas sem dado no seed ([§3.6](#36-o-que-não-foi-possível-medir-neste-ambiente))
— QLP Administrativo, Radar de Trechos, Conciliação de Chamados — mais um achado
novo, registrado e **não corrigido aqui**: a tela de Integrações pede
`/api/api/integracoes`, com o prefixo duplicado. Ele já existia antes desta
mudança.

Além disso: o caminho de quem **não** tem sessão foi conferido à parte, porque o
`Login` é a única tela que ficou fora do `<Suspense>` — abre, mostra o campo de
senha, zero erros de console, 1 pedaço de JS.

`@workspace/freightaudit`: **133 arquivos, 1.795 testes, todos passando**.
Typecheck do workspace inteiro limpo.

## 28. O que sobra, e o que isto não resolve

**O pedaço de entrada ainda tem 174.782 bytes gzip**, e o Recharts virou um
compartilhado de 101.012 que toda tela com gráfico puxa. Os dois são os próximos
alvos naturais, e nenhum é urgente perto do que esta mudança já resolveu: a meta
do [§18](#18-performance-alvo) era **≤ 350 KB** de chunk inicial, e o resultado é
metade disso.

**O que continua sem orçamento é o crescimento.** O bundle cresceu 24,6% em três
semanas sem ninguém notar, e nada impede que os 184 pedaços voltem a inchar —
basta um `import` estático de página entrar em `App.tsx` por distração. **E6 (o
orçamento de bundle no CI) é o que trava isto, e não foi implementado.** Sem ele,
esta Parte III tem prazo de validade.

**E a Fase 0 continua sem resposta.** As duas medições de dez minutos contra
produção — RTT até o Neon, e **se o estático do Replit comprime** — continuam
pendentes. A segunda vale ainda mais agora: todos os números do §26 são com o
estático comprimido; sem compressão, 353 KB de JS viram ~1,2 MB na rede, e boa
parte do ganho desta mudança some antes de chegar ao usuário.
