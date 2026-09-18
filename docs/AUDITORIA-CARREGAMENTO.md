# Auditoria de carregamento do FreightCheck — diagnóstico

**Data:** 18/09/2026 · **Escopo:** o produto inteiro, 65 rotas · **Método:** medição
num FreightCheck de verdade, não leitura de código.

> **Esta etapa não altera nada.** Nenhuma linha de código de produto, nenhum
> índice, nenhuma configuração de cache e nenhuma mudança de infraestrutura foi
> feita. O que está aqui é diagnóstico e plano; a implementação espera
> aprovação.

## Ambiente medido

| | |
|---|---|
| Banco | Postgres 16 local, **124.632 fatos · 144 ativos · 138 atributos · 18 vigências · 1 unidade · 114 MB** |
| Origem dos dados | os dois workbooks do Freightec importados pelo caminho do produto (`prova-local.mjs subir`) |
| API | `artifacts/api-server/dist/index.mjs`, **NODE_ENV=production**, compilada nesta revisão |
| Interface | **bundle de produção** (`vite build`), servido por um host estático com gzip e reescrita `/*→/index.html`, espelhando `artifact.toml` |
| Navegador | Chromium real dirigido por Playwright, 1500×1000 |
| Máquina | 4 núcleos, 16 GB |

**Instrumentação inteiramente fora da árvore do repositório.** Cinco harnesses
(`medir.mjs`, `medir-api.mjs`, `carga.mjs`, `proxy-defeito.mjs`,
`cenario-troca.mjs`), o log de consultas do Postgres
(`log_min_duration_statement = 0`) como testemunha da contagem de SQL, e
`EXPLAIN (ANALYZE, BUFFERS)` nas consultas que o log apontou. Nenhuma operação
destrutiva: o único ajuste no banco foi ligar e desligar o log.

**Amostra:** 195 medições de recarga (65 rotas × 3), 390 de navegação interna e
revisita, 55 endpoints × 10 execuções cada, 6 cenários de troca de recorte,
3 cenários de defeito injetado, 4 perfis de rede, 4 níveis de concorrência.

---

## 1. Resumo executivo

A lentidão **não tem uma causa só, e nenhuma delas é o React**. O bloqueio da
main thread não aparece em tela nenhuma; o SQL de quase toda a superfície
responde em dezenas de milissegundos. O que faz o produto parecer lento são
**cinco coisas somadas**, e elas se distribuem assim:

1. **Um piso de ~400 ms em toda tela, pago antes de qualquer dado.** É o bundle
   único de **3,87 MB** (1.009 KB na rede) mais a casca de 6 chamadas que toda
   rota refaz. Nenhuma tela do produto pode ser mais rápida do que isso hoje.
2. **Voltar a uma tela custa o mesmo que abri-la pela primeira vez.** 176 das
   216 consultas do produto não declaram `staleTime`. Medido: `/dre` 561 ms na
   primeira visita e **363 ms na revisita**; `/gestao-a-vista` 262 → **276 ms**;
   `/curadoria` 283 → **313 ms**. O cache existe e funciona — ele só está vazio
   quase sempre.
3. **Um endpoint com defeito segura a tela em esqueleto por 13,2 s — e, se ele
   pendurar, por até ~238 s, calados.** Medido com 503 injetado: a DRE fica em
   esqueleto **13.747 ms** antes de dizer qualquer coisa. Com o endpoint
   pendurado, a primeira tentativa só desiste aos **45,4 s**, e há cinco.
   **É isto que o usuário descreve como "travado".**
4. **Três consultas de banco por requisição, sempre, antes da rota começar.**
   Sessão + duas leituras de escopo. Até `/api/build`, que não lê dado nenhum,
   custa 3. Uma tela com 14 chamadas paga 42 consultas de pedágio.
5. **Duas consultas SQL caras, com causa conhecida e correção provada.** A do
   Rastreio de Dados executa em **592 ms** por um laço aninhado de 387.387
   iterações; reescrita, dá o mesmo resultado em **63 ms** (9,4×), sem índice
   novo.

**Nenhum esqueleto infinito foi reproduzido** em 65 rotas × 3 cenários. Os dois
candidatos que a análise estática apontou estão guardados por outra condição —
está no §7.4, com a prova. A percepção de "tela travada" vem do item 3.

### O que mudou desde as auditorias anteriores

| Achado de 26/08 e 29/08 | Hoje |
|---|---|
| Google Fonts bloqueando a primeira pintura (+12.412 ms) | **Corrigido** — fontes servidas do próprio bundle |
| API sem compressão (até 31,7× de banda) | **Corrigido** — `compression()` ativo; medido 1,0× a 19,9× |
| `toLocaleString` por chamada (44,5× mais caro) | **Corrigido** — `Intl.NumberFormat` reaproveitado |
| JIT do Postgres dominando `/api/balance` | **Não é mais fator** — `jit=on` 574 ms vs `jit=off` 572 ms; a causa hoje é outra (§6.1) |
| `staleTime: 0` na maioria das consultas | **Persiste, e piorou em número absoluto**: 176 de 216 (era 127 de 153) |
| Bundle único sem code splitting: 2,54 MB | **Piorou: 3,87 MB** (+52% em três semanas), ainda um chunk só |
| Cascata artificial na DRE do veículo (`enabled: Boolean(data)`) | **Persiste**, intacta |
| Pool de conexões como gargalo | **Continua descartado** |

---

## 2. Ranking dos 10 maiores gargalos

| # | Gargalo | Impacto medido | Abrangência | Evidência | Confiança |
|--:|---|---|---|---|---|
| 1 | **Toda revisita refaz tudo** — 176/216 consultas sem `staleTime` | `/dre` 561→363 ms · `/gestao-a-vista` 262→276 ms · `/curadoria` 283→313 ms na volta | **Global** | §4.2, tabela de 1ª visita × revisita | **COMPROVADO** |
| 2 | **Bundle único de 3,87 MB sem code splitting** | 1.009 KB na rede · tela útil 984 ms local, **1.896 ms em 4G**, **7.727 ms em 3G** | **Global** | §5.1 | **COMPROVADO** |
| 3 | **Política de repetição: 13,2 s de esqueleto calado, até ~238 s se pendurar** | 503 injetado → erro só aos **13.747 ms**; pendurado → 1ª desistência aos **45,4 s** | **Global** | §7.1–7.3 | **COMPROVADO** |
| 4 | **Casca de 6 chamadas refeita em toda rota** | piso de **~400 ms** em 65/65 rotas, mesmo nas que não pedem dado nenhum | **Global** | §4.1 | **COMPROVADO** |
| 5 | **3 consultas de pedágio por requisição** (sessão + 2 de escopo) | `/api/build` sem dado nenhum custa 3 consultas; `/api/auth/session` custa **10**, com a sessão lida **duas vezes** | **Global** | §6.3, log do Postgres | **COMPROVADO** |
| 6 | **A consulta do Rastreio de Dados** — laço aninhado de 387.387 iterações | **592 ms → 63 ms** reescrita (9,4×), resultado idêntico, sem índice novo | `/rastreio-de-dados` | §6.1, dois `EXPLAIN` | **COMPROVADO** |
| 7 | **`/api/dre/history`: 18 vigências lidas em série** | 447 ms, **50 consultas**, 191 ms de SQL e **256 ms fora do banco** para devolver 1 KB | `/dre`, `/dre/:id`, `/analise-equipamentos` | §6.2 | **COMPROVADO** |
| 8 | **Um `GET /api/build` extra por chamada resiliente bem-sucedida** | até **6 `/build` numa tela só**; foi a chamada mais lenta de `/monitoramento-de-chamados` (105 ms) | 14 pontos de chamada | §4.3 | **COMPROVADO** |
| 9 | **Panorama: 10 chamadas em 3 ondas para trocar de competência** | 611 ms com esqueleto visível · 2 chamadas disparadas com a janela **antiga** · 1 duplicata exata | `/panorama` | §4.4 | **COMPROVADO** |
| 10 | **`/integracoes` está quebrada: 12 chamadas com `/api` dobrado** | `GET /api/api/integracoes` → **404**; o endpoint certo responde 200 | `/integracoes` | §5.4 | **COMPROVADO** |

### Investigado e **DESCARTADO**

| Suspeita | Veredito | Evidência |
|---|---|---|
| Esqueleto que nunca termina | **Não existe** | 65 rotas × 3 cenários, 585 medições: nenhum. Os 2 candidatos estáticos estão guardados (§7.4) |
| React renderizando demais / falta de `useMemo` | **Descartado** | Nenhuma tela passa de 145 ms de navegação interna quente; o tempo está na rede |
| Listas grandes sem virtualização | **Descartado** | Há paginação; nenhuma tela mostra custo de render |
| Pool de conexões pequeno | **Descartado** | Saturação é de CPU: vazão trava em ~40 req/s dos 5 aos 20 usuários, com o pool intocado |
| JIT do Postgres | **Não é mais fator** | `jit=on` 574 ms · `jit=off` 572 ms na consulta mais cara |
| `NOT IN` da view `fato_visivel` | **Não confirmado** | 36,6 ms vs 36,7 ms contra `NOT EXISTS`. Pode voltar a importar com importações ocultas — hoje há zero |
| Partida a frio do processo | **Pequena, localmente** | 532 ms até `/healthz`, **582 ms até produto**. O cold start do Autoscale do Replit **não foi medido** (§8) |
| Chamadas canceladas ou penduradas por defeito do cliente | **Não existem** | zero cancelamentos em 585 medições |

---

## 3. Inventário — o grafo real

65 rotas navegáveis, 55 arquivos de rota no servidor, **326 endpoints**
declarados, 216 chamadas de `useQuery` no cliente.

### 3.1 A casca, que toda rota paga

Seis chamadas saem em **toda** navegação, antes e independentemente do que a
tela precisa:

| Chamada | Quem dispara | `staleTime` | Custo medido |
|---|---|--:|--:|
| `/api/auth/session` | `lib/auth.tsx` | 30 s | 4 ms · **10 consultas** |
| `/api/contexts` | `useContextosDaCasca` (lateral) | 60 s | 4 ms · 4 consultas |
| `/api/change-sets` | contador do menu | 60 s | 4 ms · 3 consultas |
| `/api/imports` | contador do menu | 30 s | 4 ms · 3 consultas |
| `/api/curation/summary` | contador do menu | 60 s | 3 ms · 3 consultas |
| `/api/build` | `chamadaResiliente`, **uma vez por chamada bem-sucedida** | — | 2 ms · 3 consultas |

As cinco primeiras declaram `staleTime` e são as que *não* são o problema. A
sexta é a do §4.3.

### 3.2 Rota → endpoints próprios

Fora a casca. Derivado das 195 medições de recarga (as chamadas que saíram
depois de a tela ficar utilizável estão marcadas com `→`).
| Rota | Endpoints próprios |
|---|---|
| /visao-gerencial | /gerencial/vigencias |
| /panorama | /changes/families, /changes/range, /qlp/auditoria, /balance/recorte, /changes/grouped |
| /resumo-executivo | /balance, /changes/range, /changes/families, /changes/grouped |
| /dashboard | /changes/families, /changes/range |
| /alteracoes | /tickets, /changes/consolidated |
| /alteracoes-por-modulo | /snapshots |
| /impacto-financeiro | /tickets, → /impacto/panorama |
| /impacto-apurado | /changes/families, /changes/range |
| /gestao-a-vista | /changes/families, /changes/range |
| /linha-do-tempo | /changes/families, /changes/range, /changes/range/overview |
| /evolucao-por-placa | /changes/evolucao-por-placa |
| /ativos-e-parados | /fechamento/frota/quinzenas |
| /vigencia | /changes/grouped, → /assets/jetbrains-mono-variavel-latin-6fWv1k7M.woff2 |
| /vigencias | /snapshots |
| /dados | → /coverage |
| /parametros | /changes/families, → /changes/range |
| /remunerado | → /compras/remunerado/frota/matriz |
| /monitoramento-de-chamados | /monitoramento-de-chamados/series, /monitoramento-de-chamados/dias, /monitoramento-de-chamados/dia/2026-09-18/chamados, /monitoramento-de-chamados/dia/2026-09-18 |
| /conciliacao-de-chamados | /monitoramento-de-chamados/series, /conciliacao-de-chamados/resumo, /conciliacao-de-chamados/linhas, /conciliacao-de-chamados/opcoes |
| /justificativas | /change-sets/tipos, /justificativas, /change-sets/eb2b7b97-90ce-4c82-99ae-ce570557abe4/changes |
| /painel-de-justificativas | /justificativas/painel |
| /book-operador | /book/entries |
| /assistente | /assistant/capabilities, /assistant/conversations |
| /cavalo-360 | /tickets, → /frota/panorama |
| /carreta-360 | /tickets, → /frota/panorama |
| /trecho-360 | /tickets, → /frota/panorama |
| /radar-trechos | /trechos/radar, /readyz |
| /comparar | /snapshots |
| /monitor-custo-fixo | /snapshots, → /monitor-custo-fixo/candidatos, → /monitor-custo-fixo/consolidado |
| /custo-fixo-finame | /snapshots, → /finame/candidatos |
| /custo-fixo-ipva | /snapshots, → /ipva/candidatos |
| /custo-fixo-aquisicao | /snapshots, → /aquisicao/candidatos |
| /custo-fixo-aluguel | /snapshots, → /aluguel/candidatos |
| /custo-fixo-lucro-fixo | /snapshots, → /lucro-fixo/candidatos |
| /custo-fixo-impostos | /snapshots, → /impostos/candidatos |
| /custo-fixo-seguro | /snapshots, → /seguro/candidatos |
| /custo-variavel-manutencao | /snapshots, → /manutencao/candidatos |
| /custo-variavel-km-rodado | /snapshots |
| /custo-variavel-pneu | /snapshots |
| /custo-variavel-consumo | /snapshots |
| /custo-variavel-velocidade-media | /snapshots |
| /custo-variavel-tma | /snapshots |
| /monitor-equipe | /snapshots |
| /qlp-administrativo | /qlp/administrativo, /qlp/administrativo/inconsistencias |
| /qlp-operacional | /snapshots |
| /importacoes | — (só a casca) |
| /integracoes | /api/integracoes, /readyz |
| /composicao | /composition/fleet |
| /dre | /dre/fleet, → /dre/history |
| /rastreio-de-dados | /balance, → /balance/0ac5db5f-db0f-4529-b15b-b2d075a7842c, → /assets/jetbrains-mono-variavel-latin-6fWv1k7M.woff2 |
| /analise-equipamentos | /fleet-analysis/summary |
| /curadoria | /curation/queue, → /assets/jetbrains-mono-variavel-latin-6fWv1k7M.woff2 |
| /categorias | /curation/categorias |
| /versoes | /curation/versions |
| /unidades | /unidades/canonicas |
| /configuracoes | /users, /papeis, /modulos-universais |
| /configuracoes/unidades | /unidades/canonicas |
| /configuracoes/usuarios | /users |
| /configuracoes/permissoes | /papeis, /modulos-universais, /papeis/5079d2ce-b43e-49e2-8278-a3528b6c4cbe |
| /configuracoes/papeis | /papeis, /modulos-universais, /papeis/5079d2ce-b43e-49e2-8278-a3528b6c4cbe |
| /fechamento | /fechamento/apuracoes |
| /fechamento/competencias | /unidades/canonicas, /fechamento/competencias, /fechamento/partes |
| /fechamento/remuneracao | → /remuneracao/situacao |
| /fechamento/frotas | /fechamento/competencias |
| /fechamento/disponibilidades | — (só a casca) |

> `/fechamento/disponibilidades` não é rota do produto — foi um erro da minha
> lista de alvos, e a tela que responde é o 404. Fica registrado para que os
> "∞" dela nas tabelas seguintes não sejam lidos como defeito.

### 3.3 Os gargalos **compartilhados** — o que explica vários módulos de uma vez

| Peça compartilhada | Quantas telas | Consequência medida |
|---|--:|---|
| A casca de 6 chamadas | **65/65** | piso de ~400 ms em toda rota |
| `requireSession` + `escopoEmObservacao` | **toda requisição** | 3 consultas de pedágio; 42 numa tela de 14 chamadas |
| `PADRAO_DAS_CONSULTAS` sem `staleTime` | **176 de 216 consultas** | revisita custa o mesmo que a primeira visita |
| `deveTentarDeNovo` / `esperaDaTentativa` | **todas as consultas** | 13,2 s de esqueleto calado num endpoint com defeito |
| `chamadaResiliente` → `/api/build` | **14 pontos** | até 6 requisições extras numa tela |
| `/api/*/candidatos` (10 rotas de rubrica) | **10 telas** | **31 consultas cada**, com o mesmo formato e o mesmo custo |
| `lerMaterial` (`lib/dre/src/apuracao.ts:167`) | DRE, DRE do veículo, Análise | relido **uma vez por vigência**, em série |
| O bundle único | **65/65** | 1.009 KB antes da primeira pintura |

**É esta coluna do meio que responde à pergunta do pedido.** A lentidão não está
espalhada por sessenta telas independentes: sete peças compartilhadas
respondem por quase todo o tempo medido.

---

## 4. Medição por rota

### 4.1 Cenário 1 — abertura direta (F5), cache do navegador vazio

Mediana de 3, servidor quente, localhost. "Utilizável" = nenhum esqueleto na
tela, nenhum "Carregando", e conteúdo de texto presente — amostrado a cada
80 ms. "Payload" é o que trafegou / o que a API produziu antes da compressão.

| Rota | Req | Ondas | Mais lenta | TTFB | Payload (rede/bruto) | FCP | Utilizável (p50) | Pior |
|---|--:|--:|---|--:|--:|--:|--:|--:|
| /panorama | 14 | 8 | /changes/grouped 175 ms | 187 | 105/2600 KB | 348 | 904 | 928 |
| /dre | 7 | 2 | /dre/fleet 396 ms | 395 | 17/99 KB | 344 | 804 | 887 |
| /curadoria | 9 | 3 | /curation/queue 252 ms | 246 | 12/75 KB | 340 | 707 | 710 |
| /linha-do-tempo | 9 | 3 | /changes/families 114 ms | 113 | 45/651 KB | 348 | 693 | 699 |
| /resumo-executivo | 11 | 3 | /changes/grouped 165 ms | 156 | 74/2198 KB | 348 | 682 | 716 |
| /monitoramento-de-chamados | 16 | 8 | /build 105 ms | 4 | 19/23 KB | 344 | 675 | 680 |
| /impacto-apurado | 8 | 3 | /changes/range 145 ms | 98 | 44/648 KB | 340 | 659 | 660 |
| /dashboard | 9 | 3 | /changes/range 162 ms | 94 | 70/1159 KB | 336 | 605 | 696 |
| /gestao-a-vista | 4 | 3 | /changes/range 116 ms | 115 | 40/633 KB | 336 | 593 | 660 |
| /justificativas | 12 | 7 | /build 63 ms | 6 | 19/214 KB | 336 | 544 | 574 |
| /vigencia | 7 | 3 | /changes/grouped 89 ms | 76 | 15/80 KB | 336 | 541 | 567 |
| /configuracoes/papeis | 9 | 3 | /build 34 ms | 3 | 8/17 KB | 348 | 537 | 540 |
| /configuracoes/permissoes | 9 | 4 | /build 34 ms | 4 | 8/17 KB | 356 | 535 | 552 |
| /composicao | 7 | 2 | /composition/fleet 67 ms | 65 | 9/44 KB | 332 | 530 | 537 |
| /parametros | 7 | 5 | /changes/families 74 ms | 81 | 18/137 KB | 336 | 526 | 534 |
| /conciliacao-de-chamados | 14 | 5 | /build 37 ms | 4 | 13/21 KB | 332 | 525 | 526 |
| /painel-de-justificativas | 11 | 3 | /justificativas/painel 56 ms | 40 | 15/103 KB | 340 | 523 | 527 |
| /analise-equipamentos | 7 | 3 | /fleet-analysis/summary 515 ms | 503 | 7/24 KB | 340 | 516 | 1051 |
| /fechamento/competencias | 8 | 3 | /fechamento/partes 26 ms | 11 | 6/15 KB | 336 | 516 | 544 |
| /importacoes | 7 | 3 | /build 25 ms | 4 | 7/25 KB | 336 | 512 | 530 |
| /fechamento | 5 | 2 | /fechamento/apuracoes 23 ms | 13 | 5/15 KB | 348 | 512 | 520 |
| /visao-gerencial | 7 | 3 | /gerencial/vigencias 28 ms | 22 | 7/22 KB | 344 | 501 | 513 |
| /evolucao-por-placa | 7 | 2 | /changes/evolucao-por-placa 34 ms | 34 | 11/170 KB | 328 | 497 | 499 |
| /categorias | 7 | 5 | /build 32 ms | 3 | 8/25 KB | 336 | 497 | 504 |
| /configuracoes/usuarios | 7 | 3 | /build 21 ms | 4 | 7/16 KB | 344 | 497 | 503 |
| /configuracoes/unidades | 7 | 3 | /curation/summary 24 ms | 16 | 6/15 KB | 336 | 496 | 532 |
| /ativos-e-parados | 7 | 4 | /build 20 ms | 3 | 6/16 KB | 340 | 490 | 490 |
| /integracoes | 8 | 4 | /readyz 35 ms | 33 | 7/17 KB | 336 | 488 | 489 |
| /unidades | 7 | 3 | /build 25 ms | 3 | 6/15 KB | 332 | 486 | 508 |
| /radar-trechos | 8 | 4 | /readyz 38 ms | 36 | 7/16 KB | 340 | 481 | 490 |
| /qlp-administrativo | 8 | 3 | /qlp/administrativo/inconsistencias 27 ms | 10 | 6/15 KB | 336 | 480 | 506 |
| /fechamento/frotas | 5 | 2 | /curation/summary 15 ms | 18 | 5/15 KB | 340 | 480 | 499 |
| /vigencias | 7 | 5 | /build 25 ms | 3 | 6/18 KB | 328 | 476 | 482 |
| /alteracoes-por-modulo | 5 | 3 | /auth/session 98 ms | 98 | 2/11 KB | 356 | 447 | 528 |
| /book-operador | 7 | 3 | /book/entries 26 ms | 5 | 6/15 KB | 344 | 441 | 465 |
| /impacto-financeiro | 6 | 4 | /auth/session 75 ms | 75 | 0/0 KB | 360 | 439 | 507 |
| /custo-fixo-ipva | 6 | 2 | /snapshots 16 ms | 6 | 6/18 KB | 340 | 429 | 436 |
| /custo-fixo-finame | 6 | 2 | /snapshots 15 ms | 4 | 6/18 KB | 340 | 427 | 437 |
| /fechamento/remuneracao | 4 | 2 | /imports 15 ms | 15 | 4/15 KB | 344 | 427 | 431 |
| /assistente | 8 | 2 | /assistant/conversations 28 ms | 18 | 7/17 KB | 336 | 426 | 476 |
| /comparar | 6 | 2 | /curation/summary 21 ms | 19 | 6/18 KB | 336 | 425 | 444 |
| /rastreio-de-dados | 7 | 3 | /build 24 ms | 3 | 7/22 KB | 360 | 425 | 442 |
| /monitor-custo-fixo | 6 | 2 | /snapshots 21 ms | 5 | 6/18 KB | 340 | 424 | 438 |
| /custo-fixo-lucro-fixo | 6 | 2 | /snapshots 15 ms | 4 | 6/18 KB | 340 | 424 | 425 |
| /custo-fixo-aquisicao | 6 | 2 | /snapshots 13 ms | 4 | 6/18 KB | 344 | 423 | 473 |
| /custo-fixo-aluguel | 6 | 2 | /snapshots 15 ms | 4 | 6/18 KB | 336 | 423 | 446 |
| /custo-fixo-seguro | 6 | 6 | /snapshots 14 ms | 4 | 6/18 KB | 336 | 422 | 430 |
| /custo-fixo-impostos | 6 | 2 | /snapshots 16 ms | 7 | 6/18 KB | 336 | 421 | 424 |
| /custo-variavel-manutencao | 6 | 2 | /contexts 14 ms | 14 | 6/18 KB | 344 | 421 | 431 |
| /custo-variavel-pneu | 6 | 2 | /change-sets 16 ms | 19 | 6/18 KB | 340 | 421 | 424 |
| /custo-variavel-velocidade-media | 6 | 2 | /contexts 15 ms | 16 | 6/18 KB | 340 | 420 | 420 |
| /monitor-equipe | 6 | 2 | /contexts 14 ms | 10 | 6/15 KB | 340 | 420 | 420 |
| /configuracoes | 8 | 2 | /modulos-universais 25 ms | 17 | 8/17 KB | 340 | 420 | 431 |
| /alteracoes | 7 | 3 | /changes/consolidated 64 ms | 69 | 6/15 KB | 344 | 419 | 465 |
| /carreta-360 | 6 | 3 | /curation/summary 30 ms | 22 | 6/15 KB | 344 | 418 | 418 |
| /custo-variavel-tma | 6 | 3 | /build 17 ms | 5 | 6/18 KB | 340 | 416 | 417 |
| /custo-variavel-km-rodado | 6 | 2 | /contexts 14 ms | 10 | 6/18 KB | 340 | 413 | 421 |
| /custo-variavel-consumo | 6 | 5 | /contexts 21 ms | 13 | 6/18 KB | 332 | 409 | 410 |
| /qlp-operacional | 6 | 3 | /build 22 ms | 3 | 6/15 KB | 340 | 408 | 430 |
| /remunerado | 5 | 2 | /imports 29 ms | 17 | 5/15 KB | 332 | 407 | 425 |
| /cavalo-360 | 6 | 2 | /contexts 21 ms | 12 | 6/15 KB | 344 | 407 | 408 |
| /versoes | 6 | 2 | /curation/versions 17 ms | 13 | 8/48 KB | 340 | 407 | 416 |
| /dados | 5 | 2 | /curation/summary 13 ms | 11 | 5/15 KB | 344 | 403 | 410 |
| /trecho-360 | 6 | 3 | /change-sets 17 ms | 18 | 6/15 KB | 340 | 399 | 416 |
| /fechamento/disponibilidades | 4 | 2 | /imports 24 ms | 26 | 4/15 KB | 340 | ∞ | — |

**Leitura.** O piso é ~400 ms e ele é do bundle, não dos dados: `/dados`,
`/importacoes` e `/fechamento/remuneracao` não pedem nada além da casca e mesmo
assim custam 403–512 ms. O teto é `/panorama`, com 904 ms e **8 ondas** de
chamadas. A compressão está funcionando: `/panorama` manda 105 KB pela rede
onde a API produziu 2.600 KB (**24,8×**).

### 4.2 Cenários 3, 4 e 8 — navegação interna, revisita e cache quente

Partindo sempre do Painel de Unidades. "1ª visita" é a primeira vez na sessão;
"revisita" é a segunda passada pela mesma rota, depois de percorrer as outras 64;
"repetição imediata" é entrar de novo poucos segundos depois.

| Rota | Casca | 1ª visita | Req | Revisita | Req | Repetição imediata | Req |
|---|--:|--:|--:|--:|--:|--:|--:|
| /dre | 21 | 561 | 2 | 363 | 2 | 101 | 2 |
| /curadoria | 21 | 283 | 3 | 313 | 5 | 74 | 3 |
| /gestao-a-vista | 13 | 262 | 3 | 276 | 3 | 28 | 1 |
| /monitoramento-de-chamados | 68 | 259 | 8 | 157 | 8 | 46 | 8 |
| /resumo-executivo | 23 | 201 | 4 | 140 | 4 | 53 | 0 |
| /linha-do-tempo | 18 | 188 | 2 | 163 | 2 | 83 | 0 |
| /composicao | 23 | 156 | 1 | 147 | 1 | 75 | 0 |
| /monitor-custo-fixo | 46 | 149 | 3 | 142 | 3 | 74 | 2 |
| /parametros | 29 | 140 | 3 | 200 | 2 | 61 | 0 |
| /justificativas | 19 | 137 | 6 | 126 | 6 | 88 | 7 |
| /importacoes | 40 | 124 | 1 | 118 | 1 | 39 | 1 |
| /vigencia | 22 | 122 | 1 | 130 | 1 | 35 | 0 |
| /configuracoes/permissoes | 30 | 119 | 3 | 142 | 3 | 87 | 3 |
| /fechamento | 29 | 114 | 5 | 109 | 4 | 21 | 1 |
| /ativos-e-parados | 24 | 112 | 1 | 101 | 1 | 28 | 1 |
| /fechamento/competencias | 25 | 111 | 4 | 114 | 4 | 28 | 4 |
| /painel-de-justificativas | 25 | 108 | 8 | 110 | 3 | 44 | 3 |
| /radar-trechos | 18 | 108 | 2 | 103 | 2 | 103 | 1 |
| /unidades | 23 | 108 | 3 | 111 | 3 | 26 | 3 |
| /fechamento/frotas | 20 | 108 | 1 | 99 | 1 | 19 | 1 |
| /categorias | 17 | 104 | 1 | 101 | 1 | 27 | 1 |
| /evolucao-por-placa | 17 | 103 | 1 | 99 | 3 | 50 | 0 |
| /qlp-administrativo | 17 | 101 | 2 | 104 | 2 | 20 | 2 |
| /configuracoes/papeis | 83 | 98 | 3 | 81 | 3 | 122 | 3 |
| /dashboard | 73 | 80 | 0 | 62 | 1 | 74 | 0 |
| /panorama | 66 | 70 | 0 | 56 | 0 | 62 | 0 |
| /analise-equipamentos | 20 | 61 | 1 | 100 | 1 | 50 | 5 |
| /impacto-apurado | 54 | 59 | 0 | 55 | 0 | 43 | 0 |
| /custo-fixo-aluguel | 54 | 59 | 2 | 41 | 2 | 30 | 1 |
| /visao-gerencial | 51 | 53 | 1 | 32 | 0 | 37 | 0 |
| /custo-fixo-lucro-fixo | 30 | 48 | 2 | 32 | 2 | 31 | 1 |
| /custo-fixo-seguro | 41 | 47 | 2 | 31 | 2 | 30 | 1 |
| /alteracoes | 34 | 43 | 2 | 25 | 2 | 145 | 2 |
| /custo-fixo-finame | 34 | 38 | 2 | 36 | 2 | 40 | 1 |
| /custo-variavel-manutencao | 34 | 38 | 2 | 33 | 2 | 32 | 1 |
| /conciliacao-de-chamados | 31 | 34 | 4 | 25 | 4 | 24 | 4 |
| /carreta-360 | 22 | 34 | 2 | 18 | 2 | 103 | 2 |
| /custo-fixo-aquisicao | 30 | 34 | 2 | 33 | 2 | 33 | 1 |
| /custo-fixo-impostos | 31 | 34 | 2 | 33 | 2 | 34 | 1 |
| /cavalo-360 | 27 | 32 | 2 | 21 | 2 | 123 | 2 |
| /book-operador | 28 | 31 | 1 | 26 | 1 | 27 | 1 |
| /assistente | 25 | 31 | 3 | 26 | 3 | 32 | 3 |
| /custo-fixo-ipva | 28 | 31 | 2 | 32 | 2 | 30 | 2 |
| /monitor-equipe | 26 | 31 | 1 | 30 | 1 | 26 | 1 |
| /integracoes | 17 | 30 | 2 | 104 | 2 | 105 | 1 |
| /comparar | 26 | 29 | 1 | 28 | 1 | 31 | 1 |
| /custo-variavel-km-rodado | 27 | 29 | 1 | 23 | 1 | 22 | 1 |
| /vigencias | 24 | 28 | 1 | 33 | 2 | 25 | 1 |
| /custo-variavel-tma | 25 | 28 | 1 | 23 | 1 | 33 | 1 |
| /configuracoes/usuarios | 25 | 28 | 1 | 28 | 1 | 23 | 1 |
| /alteracoes-por-modulo | 25 | 27 | 4 | 122 | 4 | 56 | 3 |
| /impacto-financeiro | 20 | 26 | 2 | 18 | 2 | 63 | 2 |
| /remunerado | 22 | 26 | 1 | 23 | 1 | 138 | 1 |
| /configuracoes | 23 | 26 | 3 | 31 | 3 | 30 | 3 |
| /trecho-360 | 23 | 24 | 2 | 22 | 2 | 36 | 2 |
| /configuracoes/unidades | 21 | 24 | 3 | 28 | 3 | 37 | 4 |
| /fechamento/remuneracao | 21 | 24 | 1 | 26 | 1 | 22 | 1 |
| /qlp-operacional | 18 | 23 | 1 | 22 | 1 | 21 | 1 |
| /dados | 20 | 22 | 1 | 18 | 1 | 60 | 1 |
| /custo-variavel-pneu | 19 | 22 | 1 | 23 | 1 | 26 | 1 |
| /custo-variavel-consumo | 18 | 22 | 1 | 20 | 1 | 28 | 1 |
| /custo-variavel-velocidade-media | 21 | 22 | 2 | 36 | 1 | 21 | 1 |
| /versoes | 16 | 20 | 1 | 43 | 1 | 41 | 1 |
| /rastreio-de-dados | 15 | 17 | 2 | 18 | 2 | 36 | 2 |
| /fechamento/disponibilidades | 15 | ∞ | 0 | ∞ | 0 | ∞ | 3 |

**Este é o achado número 1, e ele está inteiro nas duas colunas do meio.** A
revisita deveria ser grátis e não é: `/dre` 561 → **363 ms**, `/curadoria`
283 → **313 ms**, `/gestao-a-vista` 262 → **276 ms**, `/composicao` 156 →
**147 ms**, `/parametros` 140 → **200 ms**. A repetição imediata é rápida
(28–100 ms) porque o React Query ainda tem o dado em mãos e o mostra enquanto
refaz a chamada por baixo — mas o `staleTime` de 0 garante que essa janela
dure segundos, não minutos. Onde há `staleTime` o produto já entrega o alvo:
`/panorama` e `/impacto-apurado` fazem **zero requisições** na revisita.

A casca da tela nova aparece em **13–83 ms** em todas as rotas. O problema nunca
é o roteador nem o React: é o que vem depois.

### 4.3 Chamadas duplicadas

| Rota | Chamada repetida | Onde |
|---|---|---|
| /assistente | /api/contexts ×2 | recarga |
| /conciliacao-de-chamados | /api/build ×2 | spa, revisita |
| /conciliacao-de-chamados | /api/build ×4 | recarga |
| /curadoria | /api/build ×2 | recarga, revisita |
| /curadoria | /api/curation/summary ×2 | recarga |
| /dashboard | /api/changes/range ×2 | recarga |
| /impacto-apurado | /api/changes/range ×2 | recarga |
| /importacoes | /api/imports ×2 | recarga |
| /justificativas | /api/build ×2 | spa, revisita |
| /justificativas | /api/build ×3 | recarga |
| /justificativas | /api/change-sets ×2 | recarga |
| /monitoramento-de-chamados | /api/build ×4 | spa, revisita |
| /monitoramento-de-chamados | /api/build ×6 | recarga |
| /painel-de-justificativas | /api/build ×2 | spa |
| /painel-de-justificativas | /api/build ×3 | recarga |
| /painel-de-justificativas | /api/change-sets ×2 | recarga, spa |
| /panorama | /api/changes/range ×2 | recarga |
| /resumo-executivo | /api/changes/range ×2 | recarga |
| /resumo-executivo | /api/imports ×2 | recarga |

Há **dois** mecanismos distintos aqui, e só um é defeito:

1. **`/api/build` repetido** (até 6× numa tela) — `chamadaResiliente` lê o
   carimbo do servidor **depois de cada busca bem-sucedida**, para conseguir
   distinguir "a origem reiniciou" de "a sessão expirou"
   (`artifacts/freightaudit/src/lib/chamada-resiliente.ts:169`). O propósito é
   legítimo, e o comentário explica bem por que a leitura é `void` e fora do
   caminho crítico. O que falta é deduplicação: numa tela com seis leituras
   resilientes saem seis `/build`, cada um com as suas 3 consultas de sessão e
   escopo. Em `/monitoramento-de-chamados` o `/build` foi **a chamada mais
   lenta da tela inteira** (105 ms). É diagnóstico custando mais que o produto.

2. **`/api/changes/range`, `/api/change-sets`, `/api/imports`,
   `/api/curation/summary` e `/api/contexts` repetidos** — dois `useQuery`
   pedindo o mesmo recurso com a mesma janela sob chaves diferentes. Em
   `/panorama` a troca de competência dispara `from=2025-12-16&to=2026-07-16`
   **duas vezes, com 2 ms de diferença** (§4.4).

### 4.4 Cenário 6 — troca de vigência e competência

| Cenário | Estável em | Chamadas | Ondas | O que a tela faz no meio |
|---|--:|--:|--:|---|
| Panorama: troca de competência (ago→jul) | 611 ms | 10 | 3 | 6 esqueletos |
| Panorama: volta para a competência já vista | 698 ms | 10 | 3 | 6 esqueletos |
| DRE: troca de escopo (CONJUNTO→CAVALO) | 344 ms | 2 | 1 | 10 esqueletos |
| Composição: troca de vigência | 335 ms | 1 | 1 | conteúdo anterior preservado |
| Vigência: troca de competência | 325 ms | 0 | 0 | conteúdo anterior preservado |
| Alterações: troca de vigência | 333 ms | 1 | 1 | conteúdo anterior preservado |

**O Panorama é o pior caso, e a sequência explica por quê.** Trocar de agosto
para julho dispara, em três ondas:

```
+33 ms   /changes/range?from=2026-03-16&to=2026-08-01   ← janela ANTIGA: trabalho jogado fora
+34 ms   /changes/families?period=2026-07-16
+34 ms   /changes/grouped?period=2026-07-16
+34 ms   /changes/range?from=2025-12-16&to=2026-08-01   ← janela ANTIGA, idem
+271 ms  /changes/range?from=2025-12-16&to=2026-07-16   ┐
+272 ms  /changes/range?from=2026-03-16&to=2026-07-16   │ 2ª onda: depende da 1ª
+273 ms  /changes/grouped?period=2026-06-16             │
+273 ms  /balance/recorte?period=2026-07-16             │
+273 ms  /changes/range?from=2025-12-16&to=2026-07-16   ┘ DUPLICATA EXATA da linha 5
+521 ms  /changes/range?from=2026-02-16&to=2026-07-16   ← 3ª onda
──────
+611 ms  tela estável (6 esqueletos visíveis o tempo todo)
```

Dez chamadas, das quais **duas pedem a janela que a pessoa acabou de deixar** e
**uma é duplicata exata** de outra disparada 2 ms antes. E **voltar para a
competência já vista custa 698 ms** — mais caro do que ir, porque nada foi
guardado.

As outras cinco telas trocam de recorte em 325–344 ms, e a diferença entre elas
tem nome: `/composicao`, `/vigencia` e `/alteracoes` usam `LEITURA_DE_APURACAO`
(`staleTime` + `keepPreviousData`) e **mantêm o conteúdo anterior em tela**; a
DRE não usa, e apaga a tela inteira para 10 esqueletos enquanto troca de escopo.

### 4.5 Cenário 1 — primeira abertura depois de ocioso

| Marco | Tempo |
|---|--:|
| `exec` do processo → `/api/healthz` responde 200 | **532 ms** |
| → `/api/readyz` responde 200 | 571 ms |
| → produto (`/api/contexts`) responde 200 | **582 ms** |

Localmente a partida a frio é pequena e não explica nada. **O cold start do
Autoscale do Replit não foi medido** — ver §8.

---

## 5. Frontend

### 5.1 O bundle — o piso de toda tela

`dist/public/assets/index-*.js`: **3.866,33 KB** (1.032,50 KB gzip), **um único
chunk**. `App.tsx` importa as ~65 páginas estaticamente; não há um `lazy()` no
repositório inteiro. Em 26/08 eram 2.540 KB — **+52% em três semanas**.

Primeira carga completa do produto (`/panorama`), bundle de produção:

| Perfil de rede | FCP | DCL | JS na rede | Tela utilizável |
|---|--:|--:|--:|--:|
| sem limite (localhost) | 356 ms | 311 ms | 1.009 KB | **984 ms** |
| 20 Mb/s, 20 ms | 732 ms | 696 ms | 1.009 KB | **1.302 ms** |
| 4G (9 Mb/s, 85 ms) | 1.312 ms | 1.278 ms | 1.009 KB | **1.896 ms** |
| 3G (1,6 Mb/s, 300 ms) | 6.124 ms | 6.087 ms | 1.009 KB | **7.727 ms** |

**E a mesma medição com o host estático *sem* compressão** — que é exatamente o
que não dá para conferir daqui sobre o `serve = "static"` do Replit:

| Perfil de rede | FCP | JS na rede | Tela utilizável | Diferença |
|---|--:|--:|--:|--:|
| sem limite | 256 ms | 3.776 KB | 872 ms | — |
| 20 Mb/s | **1.884 ms** | 3.776 KB | **2.440 ms** | +1.138 ms |
| 4G | **4.012 ms** | 3.776 KB | **4.603 ms** | **+2.707 ms** |
| 3G | **21.228 ms** | 3.776 KB | **22.820 ms** | **+15.093 ms** |

**Esta é a medição mais importante que ainda falta fazer em produção, e ela
custa dez segundos:** um `curl -I -H 'accept-encoding: gzip'` contra o bundle
publicado. Se o host não comprimir, a primeira abertura em 4G custa 4,6 s em vez
de 1,9 s, e nenhuma correção de backend muda isso.

### 5.2 Render: não é o problema

Nenhuma tela passa de **145 ms** de navegação interna com cache quente, e a
casca da tela nova aparece em **13–83 ms** em 65 de 65 rotas. Não recomendo
`useMemo`, `React.memo` nem virtualização: não há evidência de que rendam nada.

### 5.3 Cache: 176 de 216 consultas sem política

| | Consultas |
|---|--:|
| Declaram `staleTime` diretamente | 23 |
| Usam `LEITURA_DE_APURACAO` (`staleTime` 60 s + `keepPreviousData`) | 17 |
| **Sem política de frescor nenhuma** | **176** |
| Total | 216 |

`PADRAO_DAS_CONSULTAS` (`lib/chamada-resiliente.ts:56`) declara `retry`,
`retryDelay`, `refetchOnWindowFocus`, `refetchOnReconnect` e `queryKeyHashFn` —
e **não** declara `staleTime`. O padrão do React Query é 0, e o próprio
`App.tsx` registra a consequência por escrito: *"`staleTime` é 0 por padrão
neste app, então `refetchOnMount` continua refazendo a consulta a cada
navegação"*. A tabela do §4.2 é essa frase medida.

O desenho para resolver isto **já existe e já está provado no produto**:
`lib/frescor-das-leituras.ts` monta `staleTime` e invalidação em par, com a
regra escrita (*"nenhum `staleTime` entra sem a invalidação que o sustenta"*).
Ele só alcança 17 das 216.

### 5.4 `/integracoes` está quebrada

`pages/integracoes.tsx` chama `fetchJson(getApiUrl("/integracoes"))` em **12
pontos**. `fetchJson` já aplica `getApiUrl` internamente
(`lib/api.ts:215`), então o endereço final é `/api/api/integracoes`:

```
GET /api/api/integracoes  → 404
GET /api/integracoes      → 200
```

Medido nas três repetições da rota. A tela não fica em esqueleto — ela abre e
mostra o estado vazio —, então o defeito é **funcional**, não de performance;
aparece aqui porque a auditoria o encontrou e porque ele produz erro de console
em toda abertura. É o único arquivo do repositório com esse padrão.

### 5.5 Cascatas artificiais

| Onde | O que espera o quê | Custo |
|---|---|--:|
| `pages/dre-veiculo.tsx:71,78` | `bridge` e `history` têm `enabled: Boolean(data)` e **não usam** `data` — só o `entityId` e o `escopo`, que vêm da URL | 1 ida e volta inteira |
| `pages/panorama.tsx:323,357,364` | procedência e os dois quadros de QLP esperam `principalPronto` | deliberado e documentado — mas soma a 3ª onda |
| `/panorama` troca de competência | a 2ª e a 3ª ondas dependem da resposta da 1ª | +477 ms dos 611 ms |

A primeira é gratuita: `bridge` e `history` poderiam sair junto com a primeira
chamada. As outras duas são decisões declaradas no código, com razão escrita —
mas o custo delas é mensurável e entra no orçamento do §10.

---

## 6. APIs e banco

10 execuções por endpoint, servidor quente, com o log do Postgres
(`log_min_duration_statement = 0`) contando as consultas. "SQL somado" é a soma
das durações; ele pode passar do tempo total porque consultas correm em
paralelo em conexões diferentes.

| Endpoint | p50 | p95 | pior | frio | Consultas | SQL somado | Rede | Bruto | Fator |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| /balance/0ac5db5f-db0f-4529-b15b-b2d075a7842c (?) | 482 | 530 | 530 | 497 | 14 | 866.7 ms | 2 KB | 6 KB | 2.7× |
| /dre/history (?) | 447 | 483 | 483 | 489 | 50 | 191.1 ms | 1 KB | 2 KB | 3.0× |
| /remuneracao/situacao (?) | 282 | 286 | 286 | 286 | 11 | 271.7 ms | 1 KB | 9 KB | 11.6× |
| /impacto/panorama (?) | 229 | 245 | 245 | 241 | 12 | 211.6 ms | 5 KB | 38 KB | 7.6× |
| /curation/queue | 220 | 224 | 224 | 221 | 4 | 164.2 ms | 3 KB | 57 KB | 17.0× |
| /monitor-custo-fixo/candidatos (?) | 145 | 161 | 161 | 164 | 31 | 64.4 ms | 0 KB | 2 KB | 3.2× |
| /dre/fleet (?) | 108 | 123 | 123 | 105 | 15 | 39.7 ms | 11 KB | 84 KB | 7.4× |
| /ipva/candidatos (?) | 112 | 120 | 120 | 110 | 31 | 57.3 ms | 0 KB | 1 KB | 2.9× |
| /finame/candidatos (?) | 102 | 112 | 112 | 96 | 31 | 50.3 ms | 0 KB | 1 KB | 2.9× |
| /changes/grouped (?) | 78 | 110 | 110 | 119 | 18 | 47.3 ms | 13 KB | 90 KB | 6.9× |
| /coverage (?) | 96 | 106 | 106 | 101 | 28 | 70.4 ms | 3 KB | 62 KB | 19.9× |
| /manutencao/candidatos (?) | 101 | 104 | 104 | 101 | 31 | 52.1 ms | 1 KB | 1 KB | 1.0× |
| /changes/range (?) | 90 | 93 | 93 | 102 | 11 | 50.6 ms | 50 KB | 511 KB | 10.2× |
| /seguro/candidatos (?) | 84 | 88 | 88 | 81 | 31 | 46.2 ms | 1 KB | 2 KB | 4.2× |
| /lucro-fixo/candidatos (?) | 85 | 87 | 87 | 79 | 31 | 47 ms | 0 KB | 1 KB | 3.0× |
| /impostos/candidatos (?) | 72 | 86 | 86 | 78 | 31 | 40.2 ms | 1 KB | 1 KB | 1.0× |
| /aquisicao/candidatos (?) | 76 | 80 | 80 | 77 | 31 | 42.3 ms | 1 KB | 1 KB | 1.0× |
| /frota/panorama (?) | 71 | 76 | 76 | 72 | 26 | 26.8 ms | 4 KB | 46 KB | 11.2× |
| /frota/panorama (?) | 71 | 72 | 72 | 71 | 26 | 26.7 ms | 4 KB | 40 KB | 10.0× |
| /aluguel/candidatos (?) | 68 | 70 | 70 | 70 | 31 | 37.2 ms | 1 KB | 1 KB | 1.0× |
| /changes/families (?) | 69 | 70 | 70 | 70 | 18 | 38.2 ms | 17 KB | 121 KB | 7.2× |
| /composition/fleet (?) | 58 | 69 | 69 | 59 | 13 | 23 ms | 3 KB | 28 KB | 8.6× |
| /compras/remunerado/frota/matriz (?) | 61 | 68 | 68 | 76 | 12 | 20.7 ms | 8 KB | 115 KB | 14.0× |
| /changes/range/overview (?) | 42 | 46 | 46 | 42 | 10 | 29.6 ms | 1 KB | 1 KB | 1.0× |
| /changes/consolidated (?) | 40 | 45 | 45 | 49 | 27 | 27.5 ms | 5 KB | 86 KB | 18.5× |
| /justificativas/painel (?) | 22 | 35 | 35 | 35 | 6 | 13.8 ms | 2 KB | 28 KB | 17.1× |
| /frota/panorama (?) | 28 | 30 | 30 | 26 | 26 | 8.3 ms | 1 KB | 1 KB | 2.3× |
| /monitor-custo-fixo/consolidado (?) | 17 | 19 | 19 | 16 | 8 | 5.8 ms | 4 KB | 77 KB | 17.3× |
| /gerencial/vigencias | 6 | 7 | 7 | 6 | 5 | 0.6 ms | 1 KB | 7 KB | 6.1× |
| /auth/session | 4 | 5 | 5 | 7 | 9 | 0.1 ms | 0 KB | 0 KB | 1.0× |

### 6.1 A consulta mais cara do produto — `/api/balance/:importRunId`

482 ms de resposta, **866 ms de SQL em 14 consultas**: uma delas responde por
tudo. É o terceiro subselect de `lib/balance` — o `com_lastro`, que conta os
fatos com célula de origem nesta importação.

`EXPLAIN (ANALYZE, BUFFERS)`, dados reais:

```
Index Scan using snapshot_effective_date_idx on snapshot s  (actual time=68.101..589.748 rows=9)
  Buffers: shared hit=1174801
  SubPlan 3
    ->  Nested Loop  (cost=11.90..282.74 rows=25) (actual rows=4650 loops=9)
          Buffers: shared hit=1171271
          ->  Nested Loop  (actual rows=43043 loops=9)
          ->  Index Scan using fact_raw_cell_idx on fact f_2
                (actual time=0.001..0.001 rows=0 loops=387387)   ← 387.387 iterações
Execution Time: 592.272 ms
```

**A causa é uma estimativa errada, não um índice faltando.** O planejador prevê
25 linhas e saem 4.650 — **186× menos** —, escolhe laço aninhado, e acaba
sondando o `fact` uma vez por célula: 387.387 vezes, 1.171.271 páginas lidas do
buffer. Os índices certos existem e estão sendo usados.

A correção é de formulação. Agregando por `snapshot_id` de uma vez, em vez de
três subselects correlacionados por linha:

| | Execution Time | Resultado |
|---|--:|---|
| Como está | **592,3 ms** | 9 linhas |
| Reescrita (CTE + `count(*) FILTER`) | **63,3 ms** | **9 linhas idênticas, conferidas coluna a coluna** |
| | **−89% (9,4×)** | |

**Nenhum índice novo, nenhuma mudança de schema.** O JIT foi testado e
**descartado**: `jit=on` 574 ms contra `jit=off` 572 ms — o achado de 26/08
sobre o JIT nesta rota não se sustenta mais, a causa hoje é o laço.

### 6.2 `/api/dre/history` — 18 vigências lidas em série

447 ms, **50 consultas**, 191 ms de SQL e **256 ms fora do banco**, para
devolver **1 KB**. A causa está escrita no código, em
`lib/dre/src/historico.ts:77`:

```ts
for (const vigencia of vigencias.todas) {
  const material = await lerMaterial(db, vigencia.effectiveDate, context);
  ...
}
```

`lerMaterial` (`lib/dre/src/apuracao.ts:167`) faz 4 consultas em paralelo — mas
o laço é **serial**, e 3 dessas 4 leituras são de catálogo
(`loadAttributeClassificationsAt`, `lerIdentidades('CAVALO')`,
`lerIdentidades('CARRETA')`) que **não mudam entre vigências**. São 18
releituras do mesmo catálogo e 18 recomposições completas de fatos.

Três correções independentes, em ordem de risco:

1. içar as três leituras de catálogo para fora do laço — **−54 consultas**;
2. trocar o laço serial por `Promise.all` com limite de concorrência;
3. guardar o resultado: o histórico de vigências fechadas não muda.

### 6.3 O pedágio de 3 consultas por requisição

Toda requisição autenticada paga, antes de a rota começar:

| Middleware | Consultas | O que faz |
|---|--:|---|
| `requireSession` | 1 | `user_session ⋈ app_user` |
| `escopoEmObservacao` → `escopoEfetivo` | 2 | `acesso_a_unidade` e `remuneracao_unidade` inteira |

Medido, com o log como testemunha, num `GET /api/build` — rota **pública**, que
não lê dado nenhum e devolve 5 campos de `process`:

```
0.035 ms  select … from user_session inner join app_user …
0.005 ms  select unidade_id from acesso_a_unidade where user_id = $1
0.066 ms  select scope_hash, unidade_id from remuneracao_unidade
```

`requireSession` resolve a sessão **mesmo em caminho público**, porque o
navegador manda o cookie. E `escopoEmObservacao` — que por desenho *"calcula,
classifica, registra e deixa passar"*, sem recusar nada — cobra duas leituras de
toda requisição, inclusive das que nunca pedem `scopeHash`.

`GET /api/auth/session` custa **10 consultas**, com a sessão lida **duas vezes**:

```
1  user_session ⋈ app_user          ← requireSession
2  acesso_a_unidade                 ← escopoEmObservacao
3  remuneracao_unidade              ← escopoEmObservacao
4  user_session ⋈ app_user          ← DE NOVO, dentro da rota
5  app_user.papel_id
6  papel_permissao
7  papel.nivel_padrao
8  permissao_de_modulo
9  modulo_universal
10 app_user ⋈ papel
```

Em localhost isso some no ruído (4 ms). **Contra um Neon a 15 ms de distância,
as 3 consultas de pedágio viram 45 ms por requisição** — e uma tela como o
`/panorama`, com 14 chamadas, paga **630 ms só de pedágio**, antes de qualquer
dado. É o multiplicador que o localhost esconde.

### 6.4 As dez telas de rubrica compartilham um mesmo custo

`/api/{finame,ipva,aquisicao,aluguel,lucro-fixo,impostos,seguro,manutencao,…}/candidatos`
e `/api/monitor-custo-fixo/candidatos`: **31 consultas cada**, 68–161 ms, para
devolver 1–2 KB. Onze endpoints com o mesmo formato, o mesmo custo e a mesma
oportunidade — é uma correção que rende em onze telas.

### 6.5 Banco: o que **não** é problema

| Verificado | Resultado |
|---|---|
| Índices usados | Sim, os planos usam `fact_snapshot_entity_idx`, `fact_raw_cell_idx`, `raw_sheet_run_idx` |
| Sequential scans caros | Só em tabelas de 1.217 linhas (`raw_row`), onde índice é mais caro |
| Sorts em disco | Nenhum |
| Estatísticas | A estimativa errada do §6.1 é de correlação entre tabelas, não de `ANALYZE` atrasado — reescrita, a mesma estatística dá bom plano |
| Materializações / pré-agregação | **Não existem**: zero materialized views, nenhuma cache no servidor (só `lib/balance/src/classificacao.ts`) |
| Pool | 10 conexões (`DB_POOL_MAX`), `max_connections` 200. Nunca foi o limite |
| Índices no total | 336, 61 MB sobre um banco de 114 MB. `fact_grain_uq` (11 MB) e `fact_inherited_idx` (304 KB) com **0 varreduras** — é escrita paga sem leitura, mas não é causa de lentidão de tela |

**Nenhum índice novo é recomendado.** As duas consultas caras têm correção de
formulação, com plano antes e depois.

### 6.6 Concorrência

Mix real de uma navegação (12 endpoints), 15 s por nível:

| Usuários | p50 | p95 | p99 | Pior | Vazão | Erros |
|--:|--:|--:|--:|--:|--:|--:|
| 1 | 54 ms | 223 ms | 239 ms | 278 ms | 18,5 req/s | 0 |
| 5 | 119 ms | 324 ms | 404 ms | 487 ms | 38,3 req/s | 0 |
| 10 | 226 ms | 577 ms | 724 ms | 852 ms | 40,0 req/s | 0 |
| 20 | **441 ms** | **1.163 ms** | **1.692 ms** | 1.823 ms | 39,2 req/s | 0 |

**A vazão trava em ~40 req/s a partir de 5 usuários** e o p95 cresce 5,2× de 1
para 20. A saturação é de CPU (4 núcleos dividindo Node e Postgres), não de
conexões: o pool ficou intocado o tempo todo. RSS da API: 237 MB.

---

## 7. Estados de carregamento, erro e vazio

### 7.1 Cenário 10 — endpoint devolvendo erro

`/api/dre/fleet` respondendo **503**, tela `/dre`, DOM amostrado a cada 250 ms:

| Tempo | Esqueletos | Erro em tela | O que se vê |
|--:|--:|---|---|
| 34 ms | 0 | não | tela em branco |
| **582 ms** | **10** | não | esqueleto |
| … | **10** | **não** | **esqueleto, calado, por 13 segundos** |
| **13.747 ms** | 0 | **sim** | o painel de erro finalmente aparece |

Tentativas em 431 / 840 / 2.044 / 5.648 / 13.653 ms — a progressão
400/1.200/3.600/8.000 de `esperaDaTentativa`, exatamente como projetada.

**A política está certa e o comportamento está errado.** 13,2 s de insistência
faz sentido para um Repl acordando; o que não faz sentido é **não dizer nada
durante esses 13,2 s**. Quem olha lê "travou" aos 4 segundos e recarrega a
página — que zera o contador e recomeça os 13,2 s.

### 7.2 Cenário 9 — endpoint lento

O mesmo endpoint com 6 s de atraso injetado:

| Tempo | Esqueletos | O que se vê |
|--:|--:|---|
| 582 ms | 10 | esqueleto |
| **6.654 ms** | 0 | conteúdo completo |

Seis segundos de esqueleto **sem um único sinal** de que está demorando mais que
o normal. O esqueleto é honesto — a tela realmente está carregando — mas é mudo.

### 7.3 O pior caso: endpoint que não responde

O mesmo endpoint **pendurado** (aceita a conexão e nunca responde):

```
+422 ms     a chamada sai
+45.413 ms  o navegador aborta — é o TEMPO_LIMITE_MS de 45 s de lib/api.ts:139
+45.814 ms  a 2ª tentativa sai
+58.000 ms  fim da observação: 10 esqueletos, nenhuma palavra em tela
```

Com 5 tentativas de 45 s e 13,2 s de espera entre elas, o teto é
**5 × 45 s + 13,2 s ≈ 238 s** — quase quatro minutos de esqueleto silencioso
antes de a tela dizer qualquer coisa. **É esta a "tela travada" do pedido.**

### 7.4 Esqueleto infinito: procurado, e não existe

Duas buscas independentes:

1. **Empírica.** 65 rotas × 3 cenários × 3 repetições = 585 medições, cada uma
   esperando até 40 s pelo fim do esqueleto. **Zero rotas ficaram presas.** A
   única linha com "∞" nas tabelas é `/fechamento/disponibilidades`, que não é
   rota do produto (é o 404, e o 404 tem 107 caracteres de texto — abaixo do
   limiar da minha sonda).

2. **Estática.** Um detector varreu as 216 consultas atrás do padrão que
   produziria um: uma consulta com `enabled:` cujo esqueleto é mantido por
   `isPending` ou `!data` — os dois ficam presos para sempre quando `enabled` é
   falso, porque aí `isLoading` é falso e `data` é `undefined`. Cinco
   candidatos, todos conferidos um a um:

| Candidato | Veredito |
|---|---|
| `pages/panorama.tsx:407` — `recorteDaProcedencia.isPending` com `enabled: … && !visaoGeral` | **Guardado.** O cartão só é montado sob `{view !== null && …}` (linha 1132), e `view` é nulo exatamente na Visão Geral. Conferido no navegador: 0 esqueletos após 15 s nos dois modos |
| `components/finame/confronto.tsx:179` — `confronto.isLoading \|\| !confronto.data` | **Guardado.** `competenciaReconciliada` (`pages/custo-fixo-finame.tsx:258`) reescreve a URL para uma competência da lista. Conferido com `?competencia=2030-01` e `?competencia=2025-12`: 0 esqueletos, tela normal |
| `linha-do-tempo-de-alteracoes.tsx:146` | Falso positivo — `!movimentos.data` cai no texto "Nenhuma alteração encontrada" |
| `pages/composicao.tsx:307` | Falso positivo — `frota.data` só condiciona conteúdo, não esqueleto |
| `pages/remunerado.tsx:345` | Falso positivo — guardado por um `if` anterior |

**Conclusão: o esqueleto infinito não é a causa.** A percepção de tela travada
vem do §7.3, e a correção é outra.

### 7.5 Os seis estados, e quais telas os distinguem

O produto **tem** o vocabulário completo — `EstadoVazio`, `ApiErrorNotice`,
`estadoDaProcedencia` (que separa carregando / vazia / falha / sem acesso /
parcial / pronta), `avisoDoParImpossivel`, `fraseSemPar` com quatro motivos
distintos. Isto é melhor do que a média e não é onde está o problema.

O que falta é um sétimo estado, e ele é o que a auditoria expõe:

> **"está demorando mais do que deveria, e eu continuo tentando."**

Hoje esse estado é indistinguível de "carregando normalmente", e é ele que
ocupa os 13,2 s do §7.1 e os 238 s do §7.3.

### 7.6 A página inteira trava quando um cartão carrega?

**Não, e isso é bom.** `/panorama` mostra 6 esqueletos enquanto os outros
andares já têm conteúdo (3.047 caracteres de texto em tela). `/composicao`,
`/vigencia` e `/alteracoes` mantêm o conteúdo anterior inteiro durante uma troca
de recorte. A exceção é a **DRE**, que apaga a tela para 10 esqueletos ao trocar
de escopo, por não usar `keepPreviousData`.

### 7.7 404 como estado vazio

Quatro rotas produzem erro de console em toda abertura, porque o servidor
responde 404 para "ainda não há dado":

| Endpoint | Corpo do 404 |
|---|---|
| `/api/trechos/radar` | "Nenhuma vigência importada ainda." |
| `/api/conciliacao-de-chamados/resumo` e `/linhas` | "Não há envio de chamados lido neste banco." |
| `/api/qlp/administrativo` e `/inconsistencias` | "Nenhuma vigência de QLP Administrativo importada ainda." |
| `/api/qlp/auditoria?quadro=…` (2×, no Panorama) | idem |

As telas tratam corretamente (`fetchJsonOrNull` converte 404 em `null` e
desenha o estado vazio). Não é defeito de carregamento — mas polui o console de
erro em toda sessão, o que custa caro quando alguém está diagnosticando outra
coisa.

---

## 8. Replit e infraestrutura — o que deu e o que não deu para medir

**Este container não é o Replit.** Tudo abaixo separa o que foi medido aqui do
que só o ambiente publicado responde.

### Medido aqui

| | Resultado |
|---|---|
| Partida a frio do processo | **532 ms** até `/healthz`, **582 ms** até produto |
| Health check | `[services.production.health.startup] path = "/api/healthz"` — **correto**: responde 200 mesmo com o banco fora, e a prontidão fica separada em `/api/readyz` e no `portaoDeProntidao`, que recusa `/api/*` com 503 enquanto a fila de migrations não estiver aplicada. O desenho está certo e está documentado no `artifact.toml` |
| Memória da API | 237 MB de RSS em regime; 344 MB no processo com source maps |
| CPU | 4 núcleos; a saturação do §6.6 é de CPU |
| Latência até o banco | ~0 (socket unix local) |
| Pool | 10, `connectionTimeout` 10 s, `idleTimeout` 30 s, `statement_timeout` 120 s |
| Conexão reutilizada | Sim — pool único em `lib/db/src/index.ts:47` |
| Compressão da API | **Ativa** (`compression()`, `app.ts:120`); medido 1,0× a 19,9× |
| Sourcemaps publicados na web | **Não** — `dist/public/assets/` não tem um `.map`, e o bundle não traz `sourceMappingURL` |
| Sourcemaps da API | Existem em `dist/` (22 MB), mas `dist/` não é servido: só `/api/*` é roteado |
| Tamanho do bundle | 3.866 KB / 1.032 KB gzip, **um chunk** |

### **Não** medido — e como medir

| O que falta | Por quê | Como obter |
|---|---|---|
| **O host estático do Replit comprime o bundle?** | `serve = "static"` é da plataforma; não é observável daqui | `curl -sI -H 'accept-encoding: gzip' https://<app>/assets/index-*.js` e olhar `content-encoding`. **Diferença medida: +2,7 s em 4G, +15,1 s em 3G** (§5.1) |
| **Política de cache dos estáticos** | idem | o mesmo `curl`, olhando `cache-control` e `etag` |
| **Cold start do Autoscale** | O Autoscale recolhe o serviço; aqui o processo nunca é recolhido | `scripts/sonda-cold-start.mjs` já existe para isto: compara `startedAt` e `pid` de `/api/build` entre sondagens |
| **RTT da API até o Neon** | Aqui o banco é local (RTT ~0) | do processo da API: cronometrar `SELECT 1` 20 vezes. **É o teste de cinco minutos mais valioso que existe** — com 3 consultas de pedágio por requisição (§6.3), 14 chamadas numa tela e RTT de 15 ms, são 630 ms de pedágio; a 60 ms, 2,5 s |
| **Reinícios, throttling, logs de timeout** | Não há acesso ao painel nem aos logs do deployment | painel do Replit + `/api/build` amostrado |
| **Diferenças entre development, preview e deployment** | Só `production` foi medido | comparar `BUILD_REVISION` e o comportamento do `DB_MIGRATE_ON_BOOT` em cada um |
| **Custo com mais de uma unidade** | O seed tem **uma**. A auditoria de 29/08 mediu a inclinação com 6 e achou **+7 consultas e +177 ms de SQL por unidade** em `/changes/families/overview` | reproduzir as 5 unidades sintéticas daquela auditoria, ou medir em produção |
| **Troca de unidade** | `/api/contexts` devolve **um** contexto neste banco — não há segunda unidade para trocar | idem |
| **QLP, Radar de Trechos, Conciliação com carga real** | Sem dado no seed (respondem 404) | importar um arquivo de cada em Importações |
| **Concorrência real de usuários** | O teste é sintético e local | métricas do deployment |

**Não atribuo nada ao Replit.** O que a medição diz é onde o tempo está *dentro*
da aplicação, e quais dois números de fora mudariam as conclusões: a compressão
do host estático e o RTT até o banco.

---

## 9. Classificação dos achados

### 9.1 Causas-raiz

| # | Causa | Severidade | Abrangência | Evidência | Risco da correção | Esforço |
|--:|---|---|---|---|---|---|
| R1 | `PADRAO_DAS_CONSULTAS` não declara `staleTime`; 176/216 consultas sem política de frescor | **Crítico** | Global | §4.2, §5.3 | **Médio** — cache sem invalidação mostra número velho | M |
| R2 | Bundle único de 3,87 MB, sem `lazy()` em lugar nenhum | **Alto** | Global | §5.1 | Baixo | M |
| R3 | 13,2 s de insistência sem comunicar, e 45 s de teto por tentativa | **Alto** | Global | §7.1–7.3 | Baixo | P |
| R4 | 3 consultas de pedágio em toda requisição; sessão lida 2× em `/auth/session` | **Alto** (em produção; invisível em localhost) | Global | §6.3 | Baixo–Médio | M |
| R5 | `com_lastro`: subselect correlacionado com laço de 387k iterações | **Alto** | `/rastreio-de-dados` | §6.1, dois `EXPLAIN` | Baixo — resultado conferido | P |
| R6 | `getHistoricoDaDRE`: laço serial sobre 18 vigências, catálogo relido 18× | **Alto** | DRE, DRE do veículo, Análise | §6.2 | Médio | M |
| R7 | `/integracoes`: 12 chamadas com `/api` dobrado | **Alto** (funcional) | `/integracoes` | §5.4 | Muito baixo | P |

### 9.2 Amplificadores

| # | Amplificador | Severidade | O que ele multiplica |
|--:|---|---|---|
| A1 | `chamadaResiliente` pede `/api/build` a cada sucesso, sem dedup | Médio | R4 — até 6 requisições extras por tela, 18 consultas de pedágio |
| A2 | Panorama dispara 2 chamadas com a janela antiga e 1 duplicata exata na troca | Médio | R1 e R4 |
| A3 | Cascata gratuita em `dre-veiculo.tsx` (`enabled: Boolean(data)` sem usar `data`) | Médio | 1 ida e volta, ×RTT |
| A4 | 11 endpoints `/candidatos` com 31 consultas cada | Médio | R4, em 11 telas |
| A5 | Consultas duplicadas por chave inconsistente (`changes/range`, `change-sets`, `imports`, `contexts`, `curation/summary`) | Baixo | R1 |
| A6 | 336 índices / 61 MB; dois grandes sem uma única varredura | Baixo | custo de escrita na importação |

### 9.3 Sintomas visuais (não são a causa — não trocar por outro desenho)

| # | Sintoma | Causa real |
|--:|---|---|
| S1 | Esqueleto por 13 s antes de um erro | R3 |
| S2 | Tela "travada" por minutos | R3 (teto de ~238 s) |
| S3 | DRE apaga a tela ao trocar de escopo | falta `keepPreviousData` — mesma família de R1 |
| S4 | Erros 404 no console em 4 telas | 404 usado como estado vazio (§7.7) |

### 9.4 Oportunidades

| # | Oportunidade | Ganho estimado |
|--:|---|---|
| O1 | Pré-agregar o que é fechado (vigência encerrada não muda) | tira o recálculo do caminho da requisição |
| O2 | `/api/fleet-analysis/summary` lê uma planilha do disco com `XLSX.readFile` **síncrono** no caminho da requisição (515 ms na primeira chamada, depois cache em memória de módulo) — bloqueia o event loop inteiro | −515 ms no primeiro acesso após cada partida, e o fim de um bloqueio global |
| O3 | Podar `fact_grain_uq` e `fact_inherited_idx` se a unicidade puder ser garantida de outro jeito | escrita mais barata na importação |
| O4 | Dedup de `/api/build` | −5 requisições por tela |

---

## 10. Orçamento de performance proposto

Metas ajustadas ao que foi medido, não a um ideal. "Hoje" é a mediana medida
neste ambiente, com 1 unidade e 124k fatos.

| Meta | Hoje | Alvo | Como se prova |
|---|--:|--:|---|
| Casca visível em navegação interna | 13–83 ms | **≤ 200 ms** | já cumprido — manter como regressão |
| Primeira informação útil (recarga) | 336–348 ms (FCP) | **≤ 1,0 s em 4G** | hoje 1.312 ms em 4G; code splitting |
| Tela principal utilizável, cache quente, navegação interna | 20–145 ms | **≤ 500 ms** | já cumprido em 64/65 rotas |
| Tela utilizável na **revisita** | 18–363 ms, igual à 1ª visita | **≤ 100 ms e 0 requisições** | R1 |
| Tela utilizável na recarga (F5) | 403–904 ms | **≤ 1,5 s em 4G** | hoje 1.896 ms em 4G, 4.603 ms se o host não comprimir |
| Endpoints interativos, p95 | 5 de 55 acima de 200 ms | **p95 < 800 ms; nenhum acima de 250 ms** | R5, R6 |
| Nenhuma tela em esqueleto indefinidamente | **já cumprido** (§7.4) | manter | sonda de 40 s em todas as rotas, em CI |
| Erro ou demora comunicados | 13,2 s calados; até 238 s no pior caso | **aviso visível em ≤ 3 s**; erro em ≤ 15 s | R3 |
| Refetch global ao trocar de aba | **já cumprido** (`refetchOnWindowFocus: false`, 3 exceções declaradas) | manter | — |
| Navegação interna sem rebaixar dado válido | 176/216 consultas rebaixam | **≤ 20 consultas sem política declarada** | R1 |
| Vazão | trava em ~40 req/s | **≥ 80 req/s** com 20 usuários | R4, R5, R6 |
| Tamanho do bundle inicial | 3.866 KB / 1.032 KB gzip | **≤ 600 KB gzip no chunk de entrada** | R2 |

---

## 11. Plano de correção

Nada aqui foi implementado. Cada item traz o ganho esperado, como ele será
provado, e o que pode quebrar.

### Fase 0 — antes de escrever qualquer código (dez minutos, em produção)

Duas medições que podem reordenar todo o resto:

1. `curl -sI -H 'accept-encoding: gzip' https://<app>/assets/index-*.js`
   → se não houver `content-encoding`, **R2 vira o item número 1** e a correção
   é de configuração, não de código (+2,7 s em 4G, +15,1 s em 3G).
2. Do processo da API, cronometrar `SELECT 1` 20 vezes contra o banco.
   → se o RTT passar de 10 ms, **R4 sobe para crítico** e a ordem de R5/R6 muda.

### Fase 1 — correções imediatas (baixo risco, ganho medido)

| # | Correção | Ganho esperado | Como provar | Risco |
|--:|---|---|---|---|
| 1.1 | **R7** — trocar `fetchJson(getApiUrl(x))` por `fetchJson(x)` nos 12 pontos de `integracoes.tsx` | a tela volta a funcionar | as 12 chamadas respondem 200; console limpo | Muito baixo |
| 1.2 | **R5** — reescrever `com_lastro` como CTE + `count(*) FILTER` | `/api/balance/:id` **482 → ~120 ms** (−75%); a consulta **592 → 63 ms** | `EXPLAIN (ANALYZE)` antes/depois + igualdade linha a linha das 5 colunas nas 18 vigências | Baixo |
| 1.3 | **R3a** — avisar em tela quando a 2ª tentativa começar ("está demorando; continuo tentando") | o silêncio cai de **13,2 s para ~0,4 s** | reinjetar o 503 e reamostrar o DOM: o aviso tem de aparecer antes de 1 s | Baixo |
| 1.4 | **R3b** — baixar `TEMPO_LIMITE_MS` de 45 s para ~12 s nas leituras | pior caso **238 s → ~73 s** | reinjetar o endpoint pendurado | Médio — uma leitura legitimamente longa passa a falhar; medir p99 real antes |
| 1.5 | **A1** — deduplicar `/api/build` (um por janela de N segundos) | −5 requisições e −15 consultas em `/monitoramento-de-chamados` | recontar as requisições nas 65 rotas | Muito baixo |
| 1.6 | **A3** — tirar `enabled: Boolean(data)` de `dre-veiculo.tsx:71,78` | −1 ida e volta (×RTT) | waterfall: as três chamadas na mesma onda | Muito baixo |
| 1.7 | **A2** — Panorama: não disparar com a janela antiga; unificar a chave duplicada | 10 → **7 chamadas** na troca de competência | recontar o cenário do §4.4 | Baixo |
| 1.8 | **S3** — `LEITURA_DE_APURACAO` na DRE | a tela para de apagar ao trocar de escopo | 10 esqueletos → 0 | Baixo |

### Fase 2 — correções estruturais

| # | Correção | Ganho esperado | Como provar | Risco |
|--:|---|---|---|---|
| 2.1 | **R1** — estender `lib/frescor-das-leituras.ts` às 176 consultas sem política, **uma família por vez, cada uma com a invalidação que a sustenta** | revisita **363 → ~0 ms** e 0 requisições; a tabela do §4.2 inteira | reexecutar o cenário revisita nas 65 rotas | **Médio** — é o item que pode mostrar número velho. A regra do arquivo (*"nenhum `staleTime` entra sem a invalidação que o sustenta"*) é a trava |
| 2.2 | **R2** — code splitting por rota (`lazy()` + `manualChunks`) | chunk de entrada **1.032 → ~400 KB** gzip; tela útil em 4G **1.896 → ~1.100 ms** | `vite build` + os 4 perfis de rede do §5.1 | Baixo — cuidado com o `Suspense` de borda |
| 2.3 | **R4** — não recalcular `escopoEfetivo` por requisição (memória por sessão, invalidada por mudança de ACL); e não reler a sessão duas vezes em `/auth/session` | 3 → 1 consulta de pedágio; a **630 ms** de pedágio de `/panorama` a 15 ms de RTT viram ~210 ms | log do Postgres: recontar as consultas das 55 rotas | **Médio** — memória de ACL que não invalida é falha de segurança; precisa de invalidação explícita |
| 2.4 | **R6** — içar o catálogo para fora do laço de `getHistoricoDaDRE`, paralelizar as vigências | 50 → **~14 consultas**; 447 → **~150 ms** | log do Postgres + p50/p95 antes e depois | Médio |
| 2.5 | **A4** — fatorar as 31 consultas dos 11 `/candidatos` | 31 → ~8 consultas em 11 telas | idem | Médio |

### Fase 3 — otimizações posteriores

| # | Otimização | Ganho esperado | Condição |
|--:|---|---|---|
| 3.1 | **O1** — pré-agregar vigência fechada | tira o recálculo do caminho da requisição | só depois de 2.1: sem invalidação, materialização é número velho persistido |
| 3.2 | **O2** — carregar a planilha de `/fleet-analysis` fora da requisição | −515 ms no 1º acesso e fim de um bloqueio do event loop | — |
| 3.3 | Prefetch das rotas vizinhas no hover do menu | tira o custo da 1ª visita do caminho crítico | só depois de 2.1 e 2.2 |
| 3.4 | **O3** — podar os dois índices sem varredura | importação mais barata | só com prova de que a unicidade é garantida de outro jeito |
| 3.5 | **S4** — 204 em vez de 404 para "ainda não há dado" | console limpo | é mudança de contrato: precisa das telas junto |

### Riscos e testes de regressão

| Correção | O que pode quebrar | Teste que fecha a porta |
|---|---|---|
| 2.1 (`staleTime`) | **Número velho em tela** depois de uma importação, uma curadoria ou uma justificativa | Para cada família: mutar → a chave invalidada → a tela mostra o novo sem recarregar. É o que `frescor-das-leituras.ts` já faz para as 17 de hoje |
| 2.3 (memória de escopo) | **Permissão revogada continuar valendo** | Revogar acesso e conferir que a próxima requisição já recusa |
| 1.2 (reescrita SQL) | Contagem diferente do Rastreio | Igualdade das 5 colunas nas 18 vigências (**já feita**, §6.1) e as suítes de `lib/balance` |
| 1.4 (timeout menor) | Leitura legítima longa passar a falhar | Medir o p99 real de cada endpoint antes de escolher o valor |
| 2.2 (code splitting) | Tela em branco entre chunks | Abrir as 65 rotas e conferir esqueleto e console — o harness desta auditoria faz isso |
| 2.4 / 2.5 (paralelizar) | Estourar o pool sob concorrência | Repetir o teste de 20 usuários do §6.6 |
| 1.5 (dedup do `/build`) | Perder o diagnóstico de reinício | Conferir que `registro-de-falhas` ainda classifica a interrupção |

### Como provaremos que melhorou

O harness desta auditoria é reexecutável e determinístico. A prova é a mesma
tabela, lado a lado:

1. as 65 rotas × 3 cenários, com as colunas do §4.1 e §4.2;
2. os 55 endpoints com p50/p95/consultas/SQL do §6;
3. os 4 perfis de rede do §5.1;
4. os 4 níveis de concorrência do §6.6;
5. os 3 cenários de defeito do §7.

"Ficou mais rápido" não conta. Conta a mediana de 3, por rota, nas duas
colunas — antes e depois.

---

## 12. Como reproduzir

```bash
node scripts/prova-local.mjs subir                      # banco + dados + usuário + servidores
pnpm --filter @workspace/freightaudit run build         # bundle de produção
NODE_ENV=production node artifacts/api-server/build.mjs # API de produção
DATABASE_URL=… NODE_ENV=production PORT=8081 node artifacts/api-server/dist/index.mjs
```

Instrumentação (fora da árvore do repositório):

| Harness | O que mede |
|---|---|
| `medir.mjs` | 65 rotas × 3 cenários: ondas, duplicatas, pendentes, canceladas, TTFB, bytes, tempo até a casca e até a tela ficar utilizável, erros de console |
| `medir-api.mjs` | p50/p95/pior/frio por endpoint, com o log do Postgres contando consultas e SQL somado |
| `carga.mjs` | 1/5/10/20 usuários sobre o mix real de uma navegação |
| `proxy-defeito.mjs` + `cenario-defeito.mjs` | endpoint lento, com erro e pendurado, com o DOM amostrado a 250 ms |
| `cenario-troca.mjs` | troca de competência, vigência e escopo na mesma tela |
| `log_min_duration_statement = 0` + `EXPLAIN (ANALYZE, BUFFERS)` | consultas por requisição e plano das caras |
