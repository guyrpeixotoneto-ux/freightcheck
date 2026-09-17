# Diagnóstico de escala do FreightCheck

**Data:** 16/09/2026 · **Método:** medição em ambiente controlado, leitura de
código e do catálogo do Postgres. Nada foi executado contra produção. Nenhuma
linha de código, schema ou infraestrutura foi alterada.

**Ambiente da medição:** Postgres 16.13 local (socket `/tmp/pgsock:5433`,
`max_connections=200`, `pg_stat_statements` ligado), Node 22.22.2, **4 vCPU /
16 GB**, disco local. Banco do produto semeado pelo caminho real
(`scripts/prova-local.mjs subir`): **124.632 fatos, 138 atributos, 18 vigências,
8 change sets, 114 MB**. API compilada e servida em `:8080`.

**Ambiente de produção (declarado no repositório, não medido aqui):** Replit
`deploymentTarget = "autoscale"` (`.replit`), Postgres **Neon 16.15**
(`docs/PLANO-INCHACO-DOS-INDICES.md`), banco de **590 MB** depois da
reindexação de 15/09/2026, **3 importações vivas / 391.824 fatos**
(`docs/CRESCIMENTO-MEDIDO.md`).

---

# 1. Resumo executivo

**O FreightCheck não está pronto para o crescimento descrito, e o motivo não é
o que costuma ser.** O código é maduro, medido e bem documentado; o banco tem
migrations versionadas, imutabilidade por trigger e backup com prova de
restauração. O que falta é **arquitetura de escala** — as três coisas que um
sistema de ingestão precisa ter antes do volume chegar e que este não tem:
fila, workers separados do servidor web, e agregados pré-calculados.

**O principal gargalo, medido:** toda leitura de fato do produto passa pela view
`fato_visivel`, cuja cláusula `NOT (origin_import_run_id IN (SELECT …))`
**anula os dez índices de `fact`**. `EXPLAIN (ANALYZE)` mostra `Seq Scan on
fact` varrendo as 124.632 linhas (2.239 buffers, 27,4 ms) onde a mesma consulta
sem a view faz `Bitmap Heap Scan` de 9.123 linhas (201 buffers, 2,7 ms) —
**10× o tempo e 11× o I/O**. O custo dessa varredura cresce com a tabela
inteira, não com a vigência consultada. É o gargalo que transforma crescimento
de histórico em lentidão de dashboard.

**O maior risco:** a importação roda **dentro do processo do servidor web**
(`void readInBackground(...)`, `routes/imports.ts:619`), sem fila, sem worker e
sem teto de concorrência, num deployment `autoscale` cujo `SIGTERM` chama
`process.exit(0)` imediatamente (`index.ts`). Uma importação de 500 mil linhas
mede **819,8 s e 6,05 GB de RSS** — mais tempo e mais memória do que uma
instância de autoscale sobrevive.

**Volume que o sistema aparenta suportar hoje, com segurança:**
arquivos de até **~50 mil linhas** (63 s, 1,08 GB de RSS, medido), até
**~10 usuários simultâneos** (33,6 req/s, p95 736 ms, medido), e um histórico
na ordem de **1 a 2 milhões de fatos** antes de a varredura de `fato_visivel`
passar de 1 s por consulta.

**Antes do aumento de volume** — corrigir `fato_visivel` (P0), tirar a
importação do processo web (P0), pôr teto de linhas e de bytes no upload (P0).

**Antes da API** — fila com dead-letter, `Idempotency-Key`, rate limit e cota
por chave, e atualizar o `xlsx` 0.18.5 (duas CVEs altas, confirmadas por
`pnpm audit`), que passará a ler arquivo de origem que ninguém desta casa
enviou.

---

# 2. Nota de maturidade

| Dimensão | Nota | Por quê, objetivamente |
|---|:--:|---|
| Arquitetura | **6** | Monorepo limpo, camadas RAW→staging→canônico→analítico bem separadas, contrato de erro único, `/healthz` `/readyz` `/startupz`. Perde por não ter fila, worker nem cache de servidor — três ausências estruturais, não de acabamento. |
| Importação de dados | **5** | Pipeline correto, retomável, cancelável, idempotente por SHA-256, com barra de progresso e varredura de órfãs. Perde por ser **síncrono em memória** (`readFileSync` + `XLSX.read`, `workbook.ts:305`), sem streaming, sem teto de tamanho e dentro do processo web. 6,05 GB de RSS em 500 mil linhas. |
| Banco de dados | **6** | 102 migrations versionadas aplicadas uma a uma, imutabilidade por trigger, `NUMERIC(18,6)`, `CHECK` no grão do fato. Perde por **zero particionamento** (a própria `docs/ARQUITETURA.md` §5 o previu e ele não existe), zero política de retenção, e 10 índices em `fact` (33 MB de índice para 17 MB de heap). |
| Performance das consultas | **3** | `Seq Scan` em toda leitura de fato. A consulta mais cara do produto devolve **9.124 linhas por chamada** e as três primeiras somam 99,8 s de 176 s de tempo total de banco sob carga. Zero materialized view, zero tabela agregada, zero cache. |
| Escalabilidade | **3** | Processo Node único, sem `cluster` nem `worker_threads` (verificado). Vazão satura em **~34 req/s a partir de 10 usuários** e não sobe mais até 500. Sem fila, o pico de importação vira pico de servidor. |
| Qualidade dos dados | **9** | O ponto mais forte do produto. `semantics_status` bloqueia soma de atributo não confirmado, rastreabilidade até a célula (`raw_cell`), linhagem completa (arquivo, aba, linha, coluna, ator, data), `import_deletion` permanente por desenho, reprocessamento com motivo obrigatório. |
| Segurança | **5** | scrypt (N=16384) nas senhas, token de sessão em SHA-256, chave de API só como hash + prefixo, cofre AES-256-GCM. Perde por **não existir isolamento entre clientes** (`empresa-da-requisicao.ts` declara: "toda pessoa autenticada pode operar qualquer empresa"), por `xlsx@0.18.5` com CVE-2023-30533 (CVSS 7,8) e CVE-2024-22363, e por não haver rate limit em lugar nenhum. |
| Observabilidade | **6** | Logs estruturados (pino) com `requestId`, `pid`, `revision`; instrumentação de `close_before_finish`; custo por resposta de IA em tokens e reais; `/healthz` publica atraso de backup. Perde por **não existir métrica agregada, dashboard técnico nem alerta** — tudo é log, nada é série temporal. |
| Preparação para API | **4** | `/api/v1` existe, com chave, escopo, versão no caminho, registro de toda chamada e fronteira clara (nenhuma chave promove). Falta tudo o que sustenta volume: fila, DLQ, `Idempotency-Key`, rate limit, cota, webhook, backoff. Documentado como ausente em `docs/INTEGRACOES.md`, não esquecido. |
| Continuidade e recuperação | **7** | `pg_dump -Fc` agendado, retenção 14, e — o que quase ninguém tem — **teste de restauração em CI** (`backup-restore.test.ts`), que já pegou um defeito real na `0036`. Perde porque o RPO é de 24 h por padrão e `BACKUP_DIR` em autoscale é disco efêmero se ninguém montar volume. |

**Média ponderada pelo risco de crescimento: 5,4/10.**

---

# 3. Mapa do fluxo de dados

## 3.1 Fluxo atual (medido)

```
 NAVEGADOR                        API (1 processo Node, event loop único)
 ─────────                        ───────────────────────────────────────
 POST /api/imports                express.json({limit:"64mb"})     SÍNCRONO, memória
 { filename,                 →    decodeUpload(): base64 → Buffer  SÍNCRONO, memória
   contentBase64 }                writeFileSync(os.tmpdir()/sha)   SÍNCRONO, disco efêmero
                                  receiveFile() → 201 ao cliente   3 idas ao banco
                                         │
                                  void readInBackground()  ◄── NÃO É FILA. É uma promise
                                         │                       solta no mesmo processo.
     ┌───────────────────────────────────┼───────────────────────────────────┐
     │  captureRaw   readFileSync + XLSX.read: ARQUIVO INTEIRO NA MEMÓRIA     │
     │               → raw_sheet / raw_row / raw_cell, INSERT…unnest de 20k   │
     │  stage        → staged_fact, tipagem, sentinelas, apontamentos          │
     │  preview      → contagens; para em PREVIEWED                            │
     └───────────────────────────────────┬───────────────────────────────────┘
                                         │  ← DECISÃO HUMANA (clique)
 POST /imports/:id/promote                │
                                  reservarPromocao()  CAS: PREVIEWED→PROMOTING (commit)
                                  promote() em UMA transação:
                                    SELECT * FROM staged_fact WHERE run=…  ◄── TUDO EM RAM
                                    → snapshot, entity, fact (unnest)
                                  garantirComparacoesDaPromocao() → change_set / change

 LEITURA
 GET /api/changes/*               fato_visivel  ◄── Seq Scan em fact, SEMPRE
 GET /api/dre/*         →         agregação em SQL e em Node
 GET /api/composition/*           sem cache, sem materialized view
                                  compression() gzip na saída
```

Classificação por etapa:

| Etapa | Natureza | Evidência |
|---|---|---|
| Recebimento | **síncrono**, em memória | `express.json` + `Buffer.from(base64)` + `writeFileSync` |
| Leitura (captureRaw) | **assíncrono no mesmo processo**, em lote, **em memória** | `void readInBackground`; `XLSX.read(readFileSync(path))` |
| Transformação (stage) | assíncrono no mesmo processo, em lote | `pipeline.ts:1552` |
| Gravação (promote) | **síncrono no pedido HTTP**, transação única, **em memória** | `SELECT * FROM staged_fact` sem paginação |
| Comparação | síncrono dentro da promoção | `garantirComparacoesDaPromocao` |
| Consulta / dashboard | síncrono, **direto no banco, sem cache** | zero matview, zero Redis/LRU (verificado) |
| Relatório (.xlsx) | síncrono, em memória | `exceljs` `wb.xlsx.writeBuffer()` |
| IA (assistente) | síncrono, **dependente de serviço externo** | `claude-opus-5`, `lib/assistant/src/llm.ts:49` |

## 3.2 Fluxo recomendado

```
 Upload multipart (stream)            Fila durável (job por arquivo)
      │  stream direto p/ storage          │
      │  durável (S3/bucket/volume)        │  visibilidade, retry, backoff, DLQ
      ▼                                    ▼
  source_file (sha256, bytes)   →   WORKER (processo/serviço separado)
      │                                    │  1 job por vez, teto por cliente
  202 + { importRunId }                    │  streaming de linhas (sem workbook inteiro em RAM)
                                           │  COPY / unnest em lotes, checkpoint por lote
                                           ▼
                                  raw_* → staged_fact → (decisão) → fact PARTICIONADA
                                           │
                                           ▼
                                  REFRESH dos agregados da vigência tocada
                                  (tabela agregada ou matview por snapshot)
                                           │
 API de leitura  ◄── cache (ETag + TTL) ◄──┘   consultas batem no agregado,
                                                descem a `fact` só no drill-down
```

As três mudanças que o desenho novo carrega e o atual não tem: **o trabalho
pesado não mora no processo que responde HTTP**, **o arquivo nunca está inteiro
na memória**, e **o dashboard não recalcula o que não mudou**.

---

# 4. Capacidade e limites

| Componente | Capacidade atual observada | Limite estimado | Evidência | Risco |
|---|---|---|---|---|
| Importação — tempo | 1.000 linhas em **1,41 s**; 100 mil em **125,9 s**; 500 mil em **819,8 s** | ~1 M linhas ≈ **30 min** (expoente medido 1,16) | ladder próprio, §6.1 | Alto |
| Importação — memória | 1k → **590 MB**; 100k → **1,69 GB**; 500k → **6,05 GB** | **~11 KB de RSS por linha**; 1 M linhas ≈ **11,5 GB** | amostragem de RSS a cada 0,3 s | **Crítico** |
| Upload — tamanho | `express.json({limit:"64mb"})` | **~48 MB de arquivo** (base64 infla 1,33×) | `app.ts` | Médio |
| Upload — linhas | **sem teto nenhum** | o que a memória aguentar | `grep` em `pipeline.ts`/`workbook.ts`: só há teto de lote | **Crítico** |
| Formato aceito | **só `.xlsx`** em vigências (`.csv` só em chamados e fechamento) | — | `imports.ts` `decodeUpload`; `tickets.ts:133` | Médio |
| Leitura de fato | `Seq Scan` de 124.632 linhas em **27,4 ms** | ~1 s a **5 M fatos**; ~14 s a 70 M | `EXPLAIN (ANALYZE)`, §6.3 | **Crítico** |
| Vazão HTTP | **33,6 req/s** com 10 usuários; **34,5** com 100 | satura em **~34 req/s**, não sobe | teste de carga, §6.2 | Alto |
| Latência | p95 **138 ms** (1 usuário) → **7.506 ms** (100) → **30.002 ms** (500) | degradação a partir de **10**; ruptura em **~500** | teste de carga | Alto |
| Concorrência de processo | **1 processo, 1 event loop** | 1 core de JS | sem `cluster`/`worker_threads` (verificado) | Alto |
| Pool de conexões | `DB_POOL_MAX` = **10** por instância | N instâncias × 10 contra o teto do Neon | `lib/db/src/index.ts:32` | Médio |
| Importações simultâneas | **sem teto** | tantas quantas couberem na RAM | `readInBackground` sem semáforo | **Crítico** |
| Armazenamento | 500 mil linhas × 9 colunas → **3.991 MB de banco** | **~890 bytes por célula** | `pg_database_size` durante o ensaio | Alto |
| Retenção | **nenhuma** em 12+ tabelas append-only | crescimento monotônico | `docs/DIAGNOSTICO-TAMANHO-DO-BANCO.md` §1 | Alto |
| Rate limit / cota de API | **inexistente** | — | `chave-de-integracao.ts`, dito explicitamente | Alto |
| Isolamento entre clientes | **inexistente** | — | `empresa-da-requisicao.ts`, dito explicitamente | **Crítico** |

---

# 5. Gargalos encontrados

| ID | Gargalo | Evidência | Impacto | Sev. | Prior. | Confiança |
|---|---|---|---|---|---|---|
| **G1** | `fato_visivel` anula os índices de `fact`: `NOT (origin_import_run_id IN (…))` força `Seq Scan` | `EXPLAIN (ANALYZE)`: Seq Scan 124.632 linhas / 2.239 buffers / 27,4 ms **vs** Bitmap 9.123 / 201 / 2,7 ms sem a view. Usada em **49 arquivos**; a `0061` a tornou o caminho único de leitura | Toda tela fica mais lenta a cada vigência importada, mesmo filtrando uma só | Crítica | P0 | **Alta** (medida) |
| **G2** | Importação roda no processo web, sem fila, sem worker, sem teto de concorrência | `void readInBackground(...)` em `imports.ts:619`; sem `cluster`/`worker_threads`; `SIGTERM → process.exit(0)` em `index.ts` | Import de 500k em curso morre num scale-down; N imports simultâneas competem pelo mesmo event loop e pela mesma RAM | Crítica | P0 | **Alta** (código + medida) |
| **G3** | Arquivo inteiro na memória: `XLSX.read(readFileSync(path))` e `SELECT * FROM staged_fact` sem paginação | `workbook.ts:305`; `pipeline.ts:3474`. RSS **6,05 GB** em 500k linhas; ~11 KB/linha | OOM em arquivo grande; num contêiner de 4 GB o teto real é **~320 mil linhas** | Crítica | P0 | **Alta** (medida) |
| **G4** | Sem teto de linhas no arquivo; só o de 64 MB de corpo JSON | `grep`: nenhum `maxRows`; `app.ts` | Um arquivo de 40 MB derruba o servidor **inteiro**, inclusive as telas de quem não importou nada | Crítica | P0 | **Alta** |
| **G5** | Zero isolamento entre clientes | `empresa-da-requisicao.ts`: *"toda pessoa autenticada pode operar qualquer empresa cadastrada"*; sem `empresa_id` no schema | Multi-cliente é hoje impossível sem vazamento cruzado | Crítica | P0 | **Alta** (declarada no código) |
| **G6** | Zero agregado pré-calculado e zero cache de servidor | 0 matviews (`pg_matviews` vazio); sem Redis/LRU/memoize | Cada abertura de dashboard recalcula tudo, por usuário | Alta | P1 | **Alta** |
| **G7** | Vazão satura em ~34 req/s e a latência cresce linearmente | 1/10/50/100/500 usuários: 22,2 → 33,6 → 33,9 → 34,5 → 31,8 req/s; p50 44 → 301 → 1.519 → 2.970 → 14.018 ms | 100 usuários já é inutilizável (p95 7,5 s) | Alta | P1 | **Alta** (medida) |
| **G8** | Sem timeout de servidor nem load shedding: o pedido enfileira até o cliente desistir | 500 usuários: **213 de 1.253 pedidos** (17%) estouraram 30 s; **0 erros do servidor** | Trabalho gasto em resposta que ninguém lê; a fila só cresce | Alta | P1 | **Alta** (medida) |
| **G9** | `xlsx@0.18.5` com CVE-2023-30533 (CVSS 7,8, prototype pollution ao **ler** arquivo) e CVE-2024-22363 (ReDoS) | `pnpm audit`: 17 vulnerabilidades, 11 altas. A versão corrigida não existe no npm | O parser recebe arquivo de fora; com API, de sistema que ninguém aqui controla | Crítica | P0 | **Alta** (ferramenta) |
| **G10** | `fact` não é particionada, contrariando o próprio plano | `pg_class relkind='p'` → **0**; `docs/ARQUITETURA.md` §5 previa partição por `snapshot_id` | Toda manutenção (vacuum, reindex, purge) é sobre a tabela inteira | Alta | P1 | **Alta** |
| **G11** | 10 índices em `fact` — 33 MB de índice para 17 MB de heap; `fact_snapshot_entity_idx` é **prefixo redundante** de `fact_grain_uq` | `pg_indexes` + `pg_total_relation_size` | Escrita amplificada em 10× no caminho mais quente do produto | Média | P1 | **Alta** |
| **G12** | Nenhuma política de retenção em 12+ tabelas append-only; binários `.xlsb` guardados em `bytea` para sempre | `docs/DIAGNOSTICO-TAMANHO-DO-BANCO.md` §1 | Crescimento monotônico de custo e de tempo de backup/restore | Alta | P1 | **Alta** (leitura de schema) |
| **G13** | Varredura de órfãs sem prova de vida: aborta leitura com mais de **15 min** e promoção com mais de **30 min**, sem checar se ainda rodam | `recuperacao.ts`: só `status` + timestamp | Medido: 500k linhas gastam **5,7 min** só em leitura e **7,8 min** em promoção **no socket local**. No Neon, com RTT, um arquivo grande é abortado **enquanto ainda está sendo lido** | Alta | P1 | **Alta** (código + medida) |
| **G14** | Sem rate limit, sem cota, sem `Idempotency-Key` na porta `/api/v1` | `chave-de-integracao.ts` (declara); `grep idempot` sem resultado de produção | Uma integração em laço derruba o produto; a defesa por SHA-256 não cobre payload diferente com mesmo efeito | Alta | P2 | **Alta** |
| **G15** | Paginação por `OFFSET` | `lib/comparison/src/query.ts:281-282` | Página profunda custa `OFFSET+LIMIT` linhas lidas; a última página de 1 M lê 1 M | Média | P1 | **Alta** |
| **G16** | 36 dos 43 arquivos de rota não têm paginação nenhuma | contagem de `limit`/`offset`/`cursor` por arquivo | Respostas crescem com a base; nada as limita | Média | P1 | **Média** (heurística de código) |
| **G17** | Sem métrica agregada, sem série temporal, sem alerta | ausência de `/metrics`, de cliente Prometheus/OTel; só `pino` | Degradação só é descoberta por reclamação | Média | P1 | **Alta** |
| **G18** | `BACKUP_DIR` em disco efêmero de autoscale se ninguém montar volume; RPO padrão de 24 h | `docs/BACKUP.md` §"contrato operacional" | Até 24 h de decisão de curadoria perdida num desastre | Alta | P1 | **Média** (depende do ambiente real) |
| **G19** | Dado pessoal sem política: `matricula_do_motorista` / `_ajudante_1` / `_2` ao lado de valores de remuneração | `schema/fechamento.ts:584-586,634-636` | LGPD: sem retenção, sem anonimização, sem base legal registrada | Média | P2 | **Média** |
| **G20** | 22 a 49 consultas em série por endpoint | `docs/AUDITORIA-PERFORMANCE.md` §3 (26/08/2026) — **+21 ms por ms de RTT** em `/changes/families` | Contra Neon distante, cada endpoint paga `nº de consultas × RTT` | Alta | P1 | **Alta** (medida por terceiros, reproduzível) |

---

# 6. Resultados dos testes

## 6.1 Importação — escada de volume

`pnpm --filter @workspace/ingest exec tsx src/cli/perfil-de-importacao.ts
--linhas N --repeticoes 1 --rtt 0`, com amostragem de RSS a cada 0,3 s.
Planilha sintética de **9 colunas** (6 de escopo + placa + 2 atributos).
RTT zero: os números de tempo são **piso**, não teto.

| Linhas | receive | captureRaw | stage | preview | **promote** | **TOTAL** | linhas/s | idas ao banco | tempo no PG | CPU Node | **pico RSS Node** | pico RSS PG |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1.000 | 0,01 s | 0,25 s | 0,36 s | 0,03 s | 0,76 s | **1,41 s** | 709 | 197 | 0,99 s | 0,77 s | **590 MB** | 186 MB |
| 10.000 | 0,02 s | 2,01 s | 3,38 s | 0,25 s | 6,74 s | **12,41 s** | 806 | 217 | 10,30 s | 5,27 s | **757 MB** | 322 MB |
| 50.000 | 0,08 s | 9,52 s | 16,63 s | 1,27 s | 35,54 s | **63,05 s** | 793 | 296 | 54,17 s | 24,26 s | **1.079 MB** | 536 MB |
| 100.000 | 0,14 s | 19,00 s | 33,68 s | 2,82 s | 70,26 s | **125,91 s** | 794 | 372 | 108,75 s | 47,93 s | **1.686 MB** | 627 MB |
| 500.000 | 0,89 s | 106,35 s | 237,10 s | 5,38 s | 470,05 s | **819,78 s** | 610 | 1.085 | 664,00 s | 425,38 s | **6.054 MB** | 1.028 MB |

Leituras que estes números autorizam:

- **O tempo é levemente superlinear.** 5× as linhas (100k→500k) custaram
  **6,5×** o tempo. Expoente medido **1,16**. A extrapolação para 1 M é
  `819,8 × 2^1,16 ≈ 1.830 s ≈ 30,5 min`.
- **A memória é linear e cara: ~11 KB de RSS por linha** de uma planilha de 9
  colunas. `(6.054 − 757) MB ÷ 490.000 linhas`. Projeção para 1 M: **~11,5 GB**.
- **1 M de linhas não foi executado**, e é decisão: a projeção de RSS ultrapassa
  a memória útil da máquina de teste, e um OOM mediria o limite da máquina, não
  o do produto. *Não foi possível validar 1.000.000 de linhas com os recursos
  disponíveis.*
- **As idas ao banco são sublineares** (197 → 1.085 para 500× as linhas): o
  trabalho do PR de desempenho de `docs/PERFORMANCE-DA-IMPORTACAO.md` está de
  pé e é o que impede o caso quadrático de voltar.
- **A promoção é 57% do tempo** e é uma transação única. Em 500 mil linhas ela
  segura uma transação por **7,8 minutos**.
- **Zero lock não concedido, pico de 2 conexões, fila do pool zero** em todos os
  cenários. **O banco não é o gargalo da importação; o processo Node é.**

### Teto de memória, por tamanho de contêiner

| RAM da instância | Linhas antes do OOM (9 colunas) | Base |
|---|--:|---|
| 1 GB | ~40.000 | `(1.024 − 590) ÷ 0,011` |
| 2 GB | ~130.000 | medido + projetado |
| 4 GB | **~320.000** | medido + projetado |
| 8 GB | ~680.000 | projetado |

*Não foi possível validar qual é a memória real da instância de produção do
Replit.* É a **primeira variável a levantar**, porque ela é que diz se o teto
de hoje são 130 mil ou 680 mil linhas.

## 6.2 Concorrência

`node carga.mjs` — usuários virtuais navegando entre 8 telas
(`/contexts`, `/changes/families`+`/changes/range`, `/changes/consolidated`,
`/dre/fleet`, `/changes/latest`, `/composition/fleet`, `/balance`, `/imports`),
20 s por rodada, gzip ligado, timeout de cliente 30 s.

| Usuários | req/s | p50 | p95 | p99 | máx | erros | **timeouts** | MB |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1 | 22,2 | 44 ms | 138 ms | 158 ms | 172 ms | 0 | 0 | 28,7 |
| 10 | **33,6** | 301 ms | 736 ms | 908 ms | 982 ms | 0 | 0 | 45,8 |
| 50 | 33,9 | 1.519 ms | 3.711 ms | 4.091 ms | 4.407 ms | 0 | 0 | 50,2 |
| 100 | 34,5 | 2.970 ms | 7.506 ms | 7.916 ms | 8.323 ms | 0 | 0 | 54,3 |
| 500 | 31,8 | **14.018 ms** | **30.002 ms** | 30.010 ms | 30.017 ms | 0 | **213 (17%)** | 58,1 |

- **Ponto de degradação: 10 usuários.** A vazão trava em ~34 req/s e a partir
  daí cada usuário a mais só acrescenta espera. p95 vai de 138 ms (1 usuário)
  para 736 ms (10) — **5,3×**.
- **Ponto de ruptura: ~500 usuários.** 17% dos pedidos não recebem resposta em
  30 s. Note que **o servidor não devolve um único erro** — ele aceita tudo e
  enfileira. Sem timeout de servidor nem load shedding, a fila é o mecanismo de
  falha, e ela é invisível do lado do servidor.
- **Por endpoint a 500 usuários:** `/changes/families` p50 **30.001 ms** e
  `/changes/consolidated` p50 **30.000 ms** — os dois saturados; `/dre/fleet`
  p50 17.264 ms; `/imports` p50 1.601 ms (é o que quase não toca `fact`).
- Sob 50 usuários o processo Node fica em **1,13 GB de RSS** e os backends do
  Postgres somam ~300 MB: a pressão está no Node.

## 6.3 Importação **durante** consulta

Importação de 100 mil linhas em curso, 10 usuários navegando ao mesmo tempo:

| | Só consulta | Com importação de 100k | Diferença |
|---|--:|--:|--:|
| req/s (10 usuários) | 33,6 | **28,2** | **−16%** |
| p50 | 301 ms | **368 ms** | +22% |
| p95 | 736 ms | **857 ms** | +16% |
| Tempo da importação | 125,91 s | **132,92 s** | +5,6% |
| Tempo dentro do Postgres | 108,75 s | **220,64 s** | **+103%** |

**Ressalva honesta:** a importação do ensaio escreve num banco descartável do
mesmo cluster, não no banco das telas. O que está medido é disputa de CPU, I/O
e WAL — **não** disputa de lock nas mesmas tabelas. Na produção, com as duas
cargas no mesmo banco e no mesmo processo Node, o efeito é necessariamente
maior. *Não foi possível validar a disputa de lock com os dados disponíveis.*

## 6.4 As consultas de maior impacto

`pg_stat_statements`, banco do produto, acumulado das rodadas de carga acima.
Ordenado por tempo total.

| # | tot. (ms) | chamadas | média | máx | **linhas/chamada** | consulta |
|--:|--:|--:|--:|--:|--:|---|
| 1 | 35.965 | 876 | 41,1 ms | 197,7 ms | **9.124** | `fato_visivel` ⋈ `attribute` ⋈ `snapshot` por `effective_date` |
| 2 | 33.225 | 422 | 78,7 ms | 192,5 ms | 2 | `change_set` ⋈ `snapshot` (cabeçalho da comparação) |
| 3 | 30.668 | 850 | 36,1 ms | 243,0 ms | **4.650** | `fato_visivel` ⋈ `attribute` (variante com `display_name`) |
| 4 | 22.672 | 422 | 53,7 ms | **412,8 ms** | **3.224** | `change` completo do change set |
| 5 | 14.015 | 422 | 33,2 ms | 83,0 ms | 2 | contagem de frota por `entity_type` |
| 6 | 6.654 | 871 | 7,6 ms | 22,4 ms | 200 | página de `change` (limit 200) |
| 7 | 3.915 | 844 | 4,6 ms | 15,3 ms | 267 | `change` por atributo |
| 8–9 | 3.644 / 3.614 | 871 | 4,2 / 4,1 ms | 18,5 ms | 267 | projeções de `change` |
| 10 | 3.574 | 871 | 4,1 ms | 14,6 ms | 20 | `group by attribute_code` |
| 11 | 3.450 | 871 | 4,0 ms | 25,9 ms | 1 | `count(*)` de `change` |
| 12 | 3.341 | 871 | 3,8 ms | 18,2 ms | 1 | `count FILTER` por categoria |
| 13–16 | ~3.250 cada | 871 | ~3,8 ms | ~18 ms | 2–3 | `group by` de confiança / semântica / classe / tipo |
| 17 | 2.857 | 422 | 6,8 ms | 22,1 ms | 2 | `count(DISTINCT entity_id)` sobre `fato_visivel` |
| 18 | 2.851 | 422 | 6,8 ms | 18,6 ms | 27 | CTE de vigências |
| 19 | 1.361 | 422 | 3,2 ms | 12,6 ms | 69 | `DISTINCT` carreta ⋈ `fato_visivel` |
| 20 | 1.012 | 2.586 | 0,4 ms | 9,4 ms | 62 | idem, versão por entidade |

**As quatro primeiras somam 122,5 s dos 185,8 s** do top 20 — 66% de todo o tempo
de banco medido.
As três que passam por `fato_visivel` (#1, #3, #17) somam **69,5 s** e todas
fazem `Seq Scan`.

### As quatro críticas, uma a uma

| | Origem | Funcionalidade | Problema | Evidência | Risco | Recomendação | Ganho esperado | Complexidade |
|--:|---|---|---|---|---|---|---|---|
| **#1** | `fato_visivel` (view da `0061`), 49 arquivos | Vigência, Rastreio, Composição, Frota 360, DRE | `NOT IN (subselect)` anula índice; devolve 9.124 linhas por chamada para agregar em Node | `Seq Scan on fact rows=124632, buffers=2239` vs `Bitmap … rows=9123, buffers=201` | Cresce com a **tabela**, não com a vigência | Trocar `NOT IN` por `LEFT JOIN … IS NULL` ou por coluna `visivel` mantida na escrita; **e** agregar no banco | **10× no tempo, 11× no I/O** hoje; 50× a 5 M fatos | **Baixa** (a view é um objeto só) |
| **#2** | `comparison/query.ts` | Cabeçalho de toda tela de comparação | 78,7 ms de média para devolver **2 linhas** — o custo está no plano, não no volume | `pg_stat_statements` | Fixo por requisição, multiplica por usuário | `EXPLAIN` dirigido; provavelmente falta índice em `change_set(snapshot_a, snapshot_b)` | 78,7 → <5 ms | **Baixa** |
| **#3** | `fato_visivel`, variante | Telas de atributo | Mesmo defeito do #1 | idem | idem | idem #1 | idem | Baixa |
| **#4** | `change` completo | Central de Alterações, Impacto | Devolve **3.224 linhas** (o change set inteiro) para somar fora do banco; máx **412,8 ms** | `pg_stat_statements` | Linear no nº de alterações da vigência | Somar no banco (`SUM`/`FILTER`) e paginar o detalhe | −90% de bytes e de tempo | **Média** |

## 6.5 O que já estava medido e continua valendo

`docs/AUDITORIA-PERFORMANCE.md` (26/08/2026) mediu o que este diagnóstico não
refez, e os achados seguem de pé:

- **+21 ms por ms de RTT** em `/changes/families` (22 a 49 consultas em série
  por endpoint). Contra um Neon a 60 ms, isso é ~1 s por tela.
- **JIT do Postgres** custou +732 ms em `/api/balance` (`jit=off`: 1.017 → 285 ms).
- **Vazão saturando em ~47 req/s** com 20 usuários naquele ambiente — mesma
  forma de curva que as minhas 34 req/s medem hoje em 4 vCPU.

O que **foi corrigido desde então** e eu confirmei no código: compressão gzip
(`app.ts`), teto de tempo por rota (`comTetoDeRota`, em 9 arquivos de rota),
`staleTime` no cliente (67 usos).

---

# 7. Riscos para o aumento de volume

| Classe | Risco concreto | Gatilho |
|---|---|---|
| **Memória** | OOM do servidor **inteiro** ao ler um arquivo grande — derruba as telas de todo mundo, não só a importação | ~320 mil linhas num contêiner de 4 GB (medido/projetado) |
| **Perda de dados** | Instância reciclada pelo autoscale no meio da leitura: `SIGTERM → process.exit(0)` sem drenar. A varredura de órfãs conserta o **estado**, mas o trabalho é perdido e o usuário precisa excluir e reenviar | Qualquer deploy ou scale-down durante uma importação longa |
| **Perda de dados** | A varredura de órfãs aborta leitura viva com mais de 15 min **sem checar se ainda roda** — e 500 mil linhas gastam 5,7 min de leitura já no socket local | Arquivo grande + RTT do Neon |
| **Timeout** | 17% dos pedidos sem resposta em 30 s a 500 usuários; o servidor não recusa nada, só enfileira | ~100 usuários simultâneos já dá p95 de 7,5 s |
| **Lentidão** | `Seq Scan` em `fact` a cada leitura: o custo de abrir um dashboard cresce com **todo o histórico já importado**, inclusive vigências que ninguém está olhando | Linear e imediato, a cada importação |
| **Banco** | Sem partição, sem retenção, com binário em `bytea`: `VACUUM`, `REINDEX`, `pg_dump` e `pg_restore` passam a durar horas | ~50–100 GB |
| **Concorrência** | Duas importações grandes ao mesmo tempo somam RSS no mesmo processo; não há semáforo | 2 clientes importando de manhã |
| **Duplicidade** | A defesa é o SHA-256 do conteúdo. Ela **não** cobre o mesmo dado exportado duas vezes com bytes diferentes (timestamp de export, ordem de linha) | Integração agendada que reexporta |
| **Segurança** | `xlsx@0.18.5` faz prototype pollution ao **ler** arquivo (CVSS 7,8), e a API vai receber arquivo de terceiro | Primeira integração |
| **Segurança** | Sem isolamento entre clientes: qualquer conta autenticada opera qualquer unidade | Segundo cliente |
| **Segurança** | Sem rate limit em `/api/v1`: um laço de integração ocupa o mesmo processo que serve as telas | Primeira integração |
| **Custos** | ~890 bytes de banco por célula de planilha. Uma planilha real de 70 colunas × 500 mil linhas = 35 M células ≈ **31 GB por arquivo** | Primeira frota grande |
| **Custos** | `claude-opus-5` no assistente, a US$ 5/US$ 25 por milhão de tokens (`lib/assistant/src/observabilidade.ts`), sem cota por usuário | Uso do assistente crescendo |
| **Experiência** | Durante uma importação de 100 mil linhas, quem só quer olhar um dashboard paga **+22% de p50** | Já hoje |

---

# 8. Recomendações

| # | Ação | Problema resolvido | Benefício esperado | Esforço | Prior. | Dependências |
|--:|---|---|---|---|---|---|
| R1 | Reescrever `fato_visivel` sem `NOT IN` (`LEFT JOIN … IS NULL`, ou coluna `visivel` escrita na promoção/exclusão) | G1 | **10× no tempo e 11× no I/O** de toda leitura de fato, hoje; ganho cresce com a base | **Baixo** | **P0** | migration nova; `bridge.ts` já sabe recriar a view |
| R2 | Teto de linhas e de bytes na entrada, recusando **antes** de abrir o arquivo | G3, G4 | Elimina a classe inteira de OOM por upload | **Baixo** | **P0** | definir o teto a partir da RAM real da instância |
| R3 | Atualizar `xlsx` para 0.20.2+ (`cdn.sheetjs.com`) ou trocar por `exceljs` na leitura | G9 | Fecha CVE-2023-30533 e CVE-2024-22363 | **Médio** | **P0** | `exceljs` já é dependência de escrita |
| R4 | Semáforo de importações simultâneas por instância (`IMPORT_SIMULTANEAS`, padrão 1) | G2 | Torna o pior caso de RAM previsível sem mudar arquitetura | **Baixo** | **P0** | — |
| R5 | Tirar a importação do processo web: fila durável + worker separado | G2, G7, e o risco de perda | Pico de importação deixa de virar pico de servidor; retry e DLQ passam a existir | **Alto** | **P1** | escolher a fila; separar o deployment |
| R6 | Streaming na leitura e na promoção: ler linha a linha, promover em lotes com checkpoint | G3 | RSS deixa de crescer com o arquivo | **Alto** | **P1** | R5; rever a transação única (ver ressalva abaixo) |
| R7 | Prova de vida na varredura de órfãs (heartbeat do processo dono) | G13 | Deixa de abortar importação viva | **Baixo** | **P1** | — |
| R8 | Tabela agregada por `(snapshot, atributo, tipo)` atualizada na promoção — o modelo que `snapshot_attribute` já usa | G6, #1, #4 | Dashboard deixa de tocar `fact`; custo passa a ser constante no histórico | **Médio** | **P1** | R1 |
| R9 | `ETag` + `Cache-Control` nas leituras de vigência fechada (imutável por construção) | G6 | Revisita de tela custa 304 em vez de recálculo | **Baixo** | **P1** | — |
| R10 | Timeout de servidor + load shedding (503 com `Retry-After` acima de N em voo) | G8 | Falha explícita e barata em vez de fila invisível | **Baixo** | **P1** | — |
| R11 | Particionar `fact` (e `raw_cell`) por `snapshot_id`/data | G10, G12 | `DETACH` vira arquivamento instantâneo; vacuum e reindex por partição | **Alto** | **P1** | R1; janela de manutenção |
| R12 | Derrubar `fact_snapshot_entity_idx` (prefixo redundante de `fact_grain_uq`) e reavaliar os outros 8 | G11 | −1 índice no caminho de escrita mais quente | **Baixo** | **P1** | conferir `pg_stat_user_indexes` em produção |
| R13 | Política de retenção declarada por tabela (`integracao_chamada`, `integracao_execucao`, `assistant_message`, `raw_cell` frio) | G12, G19 | Crescimento deixa de ser monotônico | **Médio** | **P1** | decisão de negócio sobre prazos |
| R14 | Métricas em série temporal (`/metrics` Prometheus ou OTel) + painel + alertas | G17 | Degradação vira alerta, não reclamação | **Médio** | **P1** | destino das métricas |
| R15 | Paginação por keyset em vez de `OFFSET` | G15 | Página profunda deixa de custar `OFFSET` linhas | **Médio** | **P2** | — |
| R16 | Rate limit + cota por chave, com estado compartilhado | G14 | Integração em laço deixa de derrubar o produto | **Médio** | **P2** | R5 (a fila serve de estado) |
| R17 | `Idempotency-Key` no `POST /api/v1/importacoes` | G14 | Reenvio seguro independente dos bytes | **Baixo** | **P2** | — |
| R18 | `empresa_id` no schema + `podeOperar` real (o arquivo já isola o ponto de mudança) | G5 | Multi-cliente deixa de ser vazamento | **Alto** | **P2** | decisão de produto |
| R19 | Webhook de conclusão com retry e backoff | preparação para API | Integração para de fazer polling | **Médio** | **P2** | R5 |
| R20 | `BACKUP_DIR` em volume durável + RPO declarado | G18 | Cópia que sobrevive ao contêiner | **Baixo** | **P1** | infra |

**Ressalva sobre R6, e ela importa.** `docs/PERFORMANCE-DA-IMPORTACAO.md` §3
explica que a transação única da promoção existe para impedir vigência pela
metade, protegida por `prova-de-atomicidade.ts`. Quebrá-la em lotes **sem
substituir a garantia** troca um problema de memória por um de correção — que é
pior num produto de auditoria. O caminho é promover para uma partição/snapshot
em estado `RASCUNHO` e publicar por um `UPDATE` atômico no fim. Não é
refatoração de lote; é mudança de desenho, e é por isso que o esforço é alto.

---

# 9. Plano de ação

## Imediato — próximos 7 dias

1. **Levantar a RAM e o RTT reais de produção.** Dois números, uma hora de
   trabalho, e eles decidem metade das prioridades abaixo. Sem eles, o teto de
   linhas é chute. (`SELECT 1` cronometrado do processo da API responde o RTT.)
2. **R2 — teto de linhas e de bytes na entrada**, com a mensagem dizendo o
   limite e o porquê.
3. **R4 — semáforo de importações simultâneas**, padrão 1.
4. **R1 — reescrever `fato_visivel`.** Uma migration, ganho medido de 10×.
5. **R3 — atualizar o `xlsx`.**

## Curto prazo — próximos 30 dias

6. **R7** — prova de vida na varredura de órfãs.
7. **R10** — timeout de servidor e load shedding.
8. **R9** — `ETag`/`Cache-Control` em vigência fechada.
9. **R12** — derrubar o índice redundante de `fact`.
10. **R14** — métricas e o painel da §10.3 (antes da escala, não depois: sem
    linha de base, "ficou mais lento" não tem contra o que ser medido).
11. **R20** — `BACKUP_DIR` durável.

## Preparação para escala — 60 a 90 dias

12. **R5** — fila + worker separado. É o item que destrava R6, R16 e R19.
13. **R6** — streaming e promoção em lotes com a garantia de atomicidade
    preservada (ver ressalva).
14. **R8** — tabela agregada por vigência.
15. **R11** — particionar `fact` e `raw_cell`.
16. **R13** — retenção declarada.
17. **R15** — keyset.

## Antes da primeira integração por API

18. **R16** — rate limit e cota.
19. **R17** — `Idempotency-Key`.
20. **R19** — webhook com retry e backoff.
21. **R18** — isolamento entre clientes, **se** a integração for de um segundo
    cliente. Se for do mesmo cliente, pode esperar — mas então a decisão precisa
    estar escrita.

---

# 10. Arquitetura recomendada

## 10.1 Componentes

| Camada | Hoje | Recomendado | Por quê |
|---|---|---|---|
| Recebimento | JSON base64, 64 MB, em RAM | `multipart` em stream | O arquivo nunca fica inteiro na memória do processo que responde HTTP |
| Armazenamento temporário | `os.tmpdir()` (efêmero, local à instância) | bucket/volume durável, chave = SHA-256 | Em autoscale, a instância que recebeu pode não ser a que processa |
| Validação | dentro do pipeline | **mesma função**, chamada pela fila e pela tela | A `v1.ts` já compartilha `decodeUpload` — manter esse princípio |
| Fila | **não existe** | fila durável com visibilidade, retry, backoff exponencial e **DLQ** | É o que falta para importação não ser "uma promise solta" |
| Workers | **não existem** | serviço separado, N réplicas, teto de 1 job pesado por réplica | Tira o pico de CPU e de RAM de cima do servidor web |
| Processamento em lote | `unnest` de 20k (bom) | mantido + **streaming da leitura** e checkpoint por lote | O lote já está certo; o que falta é não materializar tudo antes |
| Banco | `fact` monolítica, 10 índices, sem retenção | `fact` particionada por `snapshot_id`, índices podados, retenção declarada, `raw_cell` frio após 12 meses | `docs/ARQUITETURA.md` §5 já previu isso |
| Agregados | nenhum | tabela agregada por `(snapshot, atributo, tipo)` atualizada na promoção | Dashboard para de tocar o grão |
| Cache | nenhum no servidor | `ETag` + TTL curto; vigência fechada é imutável, logo cacheável para sempre | Ganho grande e barato |
| APIs | `/api/v1` com chave e escopo | + rate limit, cota, `Idempotency-Key`, webhook, paginação por cursor | O que sustenta um chamador que ninguém controla |
| Monitoramento | log estruturado | + série temporal, painel, alertas | Log responde "o que houve"; métrica responde "está piorando" |
| Falhas | run marcado, motivo escrito | + DLQ, retry com backoff, reprocesso por item | Falha de 1 linha em 500 mil não pode custar o arquivo |
| Reprocessamento | `reprocessImportRun` com motivo | mantido, e alcançável pela fila | Já é bom |

## 10.2 O pipeline único, de arquivo e de API

A recomendação é **manter o que já existe**: `routes/v1.ts` chama o mesmo
`decodeUpload` e o mesmo `receiveFile` da tela, e para no mesmo `PREVIEWED`. É
a decisão certa e deve ser preservada quando a fila entrar — o job é o mesmo,
muda só quem o enfileira:

```
tela  ──┐
        ├─► receber + validar formato ─► enfileirar ─► worker ─► PREVIEWED ─► decisão humana ─► promote
API  ──┘
```

Duas listas de recusa seriam duas listas para divergirem, e a que ficasse para
trás deixaria entrar por API o arquivo que a tela recusa.

## 10.3 Painel técnico mínimo

| Métrica | Limiar inicial | Calibrar depois? |
|---|---|---|
| Importações iniciadas / concluídas / com erro | erro > 5% em 1 h | não |
| Tempo médio de importação | > 2× a mediana de 7 dias | **sim** |
| Linhas processadas por segundo | < 400/s (hoje: 610–806) | **sim** |
| Tamanho médio dos arquivos | informativo | **sim** |
| Registros rejeitados por importação | > 5% das linhas | **sim** |
| Profundidade da fila | > 10 jobs | **sim** |
| Tempo de espera na fila | p95 > 5 min | **sim** |
| Latência de API p50/p95/p99 | p95 > 1 s | não |
| Taxa de erro HTTP | > 1% | não |
| `close_before_finish` (cliente desistiu) | > 1% | não — já instrumentado |
| Consultas lentas (`pg_stat_statements`) | média > 100 ms | não |
| CPU do processo | > 70% por 5 min | não |
| **RSS do processo** | **> 70% da RAM da instância** | não — é o alarme de OOM |
| Disco / tamanho do banco | > 70% da cota | não |
| Conexões de banco em uso / fila do pool | fila > 0 por 1 min | não |
| Disponibilidade (`/readyz`) | < 99,5% em 24 h | não |
| Idade do último backup | > `BACKUP_INTERVALO_HORAS` × 1,5 | não — já em `/healthz` |
| Custo de IA por dia e por usuário | teto a definir | **sim** — já há token e custo por resposta |

Os marcados **sim** exigem linha de base real antes de virarem alerta. Ligar
alerta sem linha de base produz ruído, e ruído treina a equipe a ignorar
alarme — que é pior do que não ter.

---

# 11. Projeção de crescimento

**Fórmulas** (todas derivadas das medições da §6):

```
tempo_importacao_s   = 819,8 × (linhas / 500.000) ^ 1,16      [9 colunas, RTT 0]
rss_pico_MB          = 590 + 0,011 × linhas                    [9 colunas]
banco_MB             = 0,00089 × células                       [células = linhas × colunas]
vazao_maxima         = 34 req/s por instância (4 vCPU)
usuarios_confortaveis= 10 por instância (p95 < 1 s)
```

**Variáveis que faltam e que só o negócio responde** — enquanto não vierem, os
três cenários abaixo são aritmética sobre suposições declaradas, não previsão:
número de clientes, unidades por cliente, linhas e colunas por arquivo,
periodicidade das importações, retenção exigida em anos, e a RAM/RTT reais da
instância.

| | **Conservador** | **Esperado** | **Acelerado** |
|---|--:|--:|--:|
| Clientes ativos | 2 | 8 | 30 |
| Usuários simultâneos (pico) | 5 | 25 | 120 |
| Arquivos por dia | 2 | 12 | 60 |
| Linhas por arquivo | 20.000 | 60.000 | 150.000 |
| Colunas por arquivo | 70 | 70 | 70 |
| Células por mês | 84 M | 1,51 bi | 18,9 bi |
| **Tempo de importação por arquivo** | ~20 s | ~70 s | ~203 s |
| **RSS de pico por importação** | 810 MB | 1,25 GB | **2,24 GB** |
| Requisições de API/min | — | ~10 | ~120 |
| **Armazenamento/mês** | ~73 GB | **~1,3 TB** | **~16,4 TB** |
| **Crescimento/ano** | ~0,9 TB | **~16 TB** | **~197 TB** |
| Conexões de banco | 10 | 30 (3 instâncias) | 100+ |
| Custo aproximado | dezenas de US$/mês | **centenas a milhares** | **dezenas de milhares** |
| Principal risco | histórico deixando o dashboard lento | armazenamento e `Seq Scan` | inviável sem R1/R5/R6/R8/R11/R13 |
| **Saturação provável** | ~12 meses | **~2 a 3 meses** | **semanas** |

> **Ressalva nas duas linhas de importação.** Tempo e RSS saem de um ensaio de
> planilha de **9 colunas**; as linhas destes cenários têm 70. O custo transfere
> por **célula**, não por linha — então esses dois números são **piso**, não teto.
> O armazenamento, esse, já está em células e transfere direto.

**O número que salta é o armazenamento**, e ele vem da medição: **~890 bytes de
banco por célula de planilha**. A causa é o desenho — `raw_cell` guarda uma
linha por célula, `staged_fact` espelha e `fact` é densa. É o preço da
rastreabilidade célula a célula, que é uma das melhores propriedades deste
produto; mas ele **precisa** de retenção e de arquivamento frio (R13, R11) antes
do volume, ou vira a maior conta do projeto.

Onde estão os bytes, medido no banco semeado: **`fact` 45%** (51 MB),
**`staged_fact` 26%** (30 MB), **`raw_cell` 10,5%** (12 MB), o resto 18,5%.
Logo: mandar `raw_cell` para armazenamento frio após 12 meses — como
`docs/ARQUITETURA.md` §5 já prevê — tira ~10% da conta. **A alavanca maior é
`staged_fact`**, que espelha `fact` e vale ~26% — e `docs/RETENCAO-DO-STAGED-FACT.md`
explica o que quebraria ao limpá-la. Essa é a decisão de retenção que mais vale
a pena revisitar antes do volume, e ela é de produto, não de engenharia.

Hoje a produção tem **590 MB e 391.824 fatos** com 7 dias de acervo
(`docs/CRESCIMENTO-MEDIDO.md`). Nada disso é problema **ainda** — e é exatamente
por isso que é a hora de mexer.

---

# 12. Backlog técnico priorizado

### BL-01 · Reescrever `fato_visivel` sem `NOT IN`
**Descrição:** trocar `NOT (origin_import_run_id IN (SELECT …))` por
`LEFT JOIN import_run … WHERE ir.id IS NULL`, ou por uma coluna `visivel`
mantida na promoção e na exclusão. `bridge.ts` já sabe recriar a view.
**Aceite:** `EXPLAIN (ANALYZE)` da consulta #1 da §6.4 mostra acesso por índice
(`Bitmap`/`Index Scan`) em `fact`, sem `Seq Scan`; os testes de
`fato_visivel`/`fato_oculto` continuam verdes; nenhuma das 49 chamadas muda de
resultado. **Prioridade:** P0 · **Esforço:** Baixo (1–2 dias) · **Risco
mitigado:** G1 · **Dependências:** — · **Métrica:** buffers da consulta #1 de
2.239 para <300; média de 41,1 ms para <10 ms.

### BL-02 · Teto de linhas e de bytes na entrada
**Descrição:** recusar no `decodeUpload` acima de `IMPORT_MAX_BYTES`, e no
`readWorkbook` acima de `IMPORT_MAX_LINHAS`, com a mensagem dizendo o limite.
Valor inicial derivado de `rss_pico_MB = 590 + 0,011 × linhas` contra a RAM real
com margem de 50%.
**Aceite:** arquivo acima do teto é recusado com 413 e mensagem explicando o
limite, **antes** de `XLSX.read`; teste cobrindo os dois tetos.
**Prioridade:** P0 · **Esforço:** Baixo (1 dia) · **Risco mitigado:** G3, G4 ·
**Dependências:** RAM real da instância · **Métrica:** zero OOM.

### BL-03 · Atualizar `xlsx` para 0.20.2+
**Descrição:** a versão corrigida não está no npm; vem de `cdn.sheetjs.com`.
Alternativa: usar `exceljs` (já é dependência) também na leitura.
**Aceite:** `pnpm audit` sem CVE alta em dependência de runtime; suíte de
ingestão verde contra os workbooks de `attached_assets`.
**Prioridade:** P0 · **Esforço:** Médio (2–4 dias) · **Risco mitigado:** G9 ·
**Dependências:** — · **Métrica:** 11 vulnerabilidades altas → 0 em runtime.

### BL-04 · Semáforo de importações simultâneas
**Descrição:** `IMPORT_SIMULTANEAS` (padrão 1) limitando quantos
`readInBackground`/`promote` correm por instância; excedente espera e a tela diz.
**Aceite:** duas importações disparadas juntas rodam em série; o RSS de pico com
duas é o de uma.
**Prioridade:** P0 · **Esforço:** Baixo (1–2 dias) · **Risco mitigado:** G2 ·
**Dependências:** — · **Métrica:** RSS de pico previsível.

### BL-05 · Fila durável + worker separado
**Descrição:** `POST /imports` enfileira e responde 202; um serviço worker
consome, com visibilidade, retry, backoff exponencial e DLQ. O deployment do
worker é separado do web.
**Aceite:** matar o processo web no meio de uma importação não a interrompe;
job que falha 3× vai para a DLQ com o motivo; a tela mostra posição na fila.
**Prioridade:** P1 · **Esforço:** Alto (2–3 semanas) · **Risco mitigado:** G2,
G7 · **Dependências:** escolha da fila · **Métrica:** p95 de latência de
dashboard **durante** importação volta ao nível sem importação (hoje +16%).

### BL-06 · Streaming na leitura e promoção em lotes
**Descrição:** ler a planilha linha a linha; promover em lotes com checkpoint,
publicando a vigência por um `UPDATE` atômico no fim. **Não** quebrar a
atomicidade que `prova-de-atomicidade.ts` protege.
**Aceite:** RSS de pico não cresce com o tamanho do arquivo (≤1,5 GB a 1 M de
linhas); `prova-de-atomicidade.ts` verde; matar o processo no meio não deixa
vigência pela metade.
**Prioridade:** P1 · **Esforço:** Alto (3–4 semanas) · **Risco mitigado:** G3 ·
**Dependências:** BL-05 · **Métrica:** RSS/linha de 11 KB para ~0.

### BL-07 · Prova de vida na varredura de órfãs
**Descrição:** `import_run.heartbeat_em` atualizado pelo relator de progresso;
a varredura só aborta quem não bate há N minutos.
**Aceite:** importação de 500 mil linhas com 40 min de duração **não** é
abortada; importação cujo processo morreu é abortada em <5 min.
**Prioridade:** P1 · **Esforço:** Baixo (2 dias) · **Risco mitigado:** G13 ·
**Dependências:** — · **Métrica:** zero abortos de run vivo.

### BL-08 · Tabela agregada por vigência
**Descrição:** `snapshot_agregado (snapshot_id, attribute_id, entity_type,
soma, contagem, …)` escrita na promoção — mesmo modelo de `snapshot_attribute`,
que já prova que o padrão funciona (1.809 linhas para 124.632 fatos).
**Aceite:** `/dre/fleet`, `/composition/fleet` e `/changes/families` respondem
sem tocar `fact`; os números batem com o cálculo direto (teste de equivalência).
**Prioridade:** P1 · **Esforço:** Médio (1–2 semanas) · **Risco mitigado:** G6 ·
**Dependências:** BL-01 · **Métrica:** tempo de banco do top 20 de 186 s para <40 s; p95 a 50 usuários de 3.711 ms para <1.000 ms.

### BL-09 · Timeout de servidor e load shedding
**Descrição:** teto de tempo por requisição em todas as rotas de leitura
(estender `comTetoDeRota`), e 503 com `Retry-After` acima de N pedidos em voo.
**Aceite:** a 500 usuários o servidor responde 503 rápido em vez de enfileirar;
nenhum pedido passa de 10 s.
**Prioridade:** P1 · **Esforço:** Baixo (2–3 dias) · **Risco mitigado:** G8 ·
**Dependências:** — · **Métrica:** timeouts de cliente de 17% para 0; taxa de
503 explícita e observável.

### BL-10 · `ETag` e `Cache-Control` em vigência fechada
**Descrição:** vigência fechada é imutável por trigger (`snapshot_immutable`,
`0001`) — logo, cacheável indefinidamente. `ETag` derivado de
`(snapshot_id, change_set_id)`.
**Aceite:** revisita de tela devolve 304; invalidação imediata ao promover.
**Prioridade:** P1 · **Esforço:** Baixo (3 dias) · **Risco mitigado:** G6 ·
**Dependências:** — · **Métrica:** ≥50% de 304 numa sessão de navegação.

### BL-11 · Particionar `fact` e `raw_cell`
**Descrição:** partição por `snapshot_id` (ou por faixa de `effective_date`),
como `docs/ARQUITETURA.md` §5 já previu.
**Aceite:** consulta de uma vigência lê uma partição (`Partitions removed` no
`EXPLAIN`); arquivar 12 meses é um `DETACH`.
**Prioridade:** P1 · **Esforço:** Alto (2–3 semanas) · **Risco mitigado:** G10,
G12 · **Dependências:** BL-01 · **Métrica:** tempo de `REINDEX` e de `pg_dump`
por partição, não pela tabela.

### BL-12 · Podar índices de `fact`
**Descrição:** derrubar `fact_snapshot_entity_idx` (prefixo de
`fact_grain_uq`); avaliar os outros 8 por `pg_stat_user_indexes` **de produção**.
**Aceite:** nenhum índice com `idx_scan = 0` após 30 dias permanece sem
justificativa escrita; nenhuma consulta da §6.4 regride.
**Prioridade:** P1 · **Esforço:** Baixo (2 dias) · **Risco mitigado:** G11 ·
**Dependências:** leitura de `pg_stat_user_indexes` em produção ·
**Métrica:** razão índice/heap de `fact` de 1,94 para <1,5.

### BL-13 · Política de retenção declarada
**Descrição:** prazo por tabela append-only (`integracao_chamada`,
`integracao_execucao`, `assistant_message`, `curation_event`, `raw_cell` frio),
com job de expurgo e motivo registrado. Cobre também LGPD para
`matricula_do_motorista`.
**Aceite:** toda tabela append-only tem prazo escrito ou "permanente por
desenho" justificado; job roda e é observável.
**Prioridade:** P1 · **Esforço:** Médio (1–2 semanas) · **Risco mitigado:** G12,
G19 · **Dependências:** decisão de negócio · **Métrica:** crescimento do banco
deixa de ser monotônico.

### BL-14 · Métricas, painel e alertas
**Descrição:** `/metrics` (Prometheus) ou OTel com as métricas da §10.3.
**Aceite:** painel de pé com as 18 métricas; alertas dos itens "não calibrar"
ligados; os "sim" com linha de base de 30 dias antes de ligar.
**Prioridade:** P1 · **Esforço:** Médio (1–2 semanas) · **Risco mitigado:** G17 ·
**Dependências:** destino das métricas · **Métrica:** MTTD de degradação.

### BL-15 · Rate limit e cota por chave de API
**Descrição:** limite por chave com estado compartilhado (a fila ou o próprio
banco), respondendo 429 com `Retry-After`.
**Aceite:** chave acima do limite recebe 429; o limite é visível em
`GET /api/v1/ping`.
**Prioridade:** P2 · **Esforço:** Médio (1 semana) · **Risco mitigado:** G14 ·
**Dependências:** BL-05 · **Métrica:** nenhuma integração consegue passar de N
req/min.

### BL-16 · `Idempotency-Key`
**Descrição:** cabeçalho opcional no `POST /api/v1/importacoes`; a mesma chave
em 24 h devolve o mesmo `importRunId` em vez de criar outro.
**Aceite:** dois envios com a mesma chave e bytes diferentes devolvem o mesmo
run; sem a chave, o comportamento atual (409 por SHA) não muda.
**Prioridade:** P2 · **Esforço:** Baixo (3 dias) · **Risco mitigado:** G14 ·
**Dependências:** — · **Métrica:** zero duplicata por reenvio.

### BL-17 · Webhook de conclusão
**Descrição:** notificação com retry, backoff exponencial e assinatura HMAC,
em vez de polling.
**Aceite:** destino fora do ar recebe a entrega depois; 5 falhas mandam para a
DLQ e a tela de Integrações mostra.
**Prioridade:** P2 · **Esforço:** Médio (1 semana) · **Risco mitigado:** carga
de polling · **Dependências:** BL-05 · **Métrica:** chamadas de
`GET /importacoes/:id` por importação caem para ~1.

### BL-18 · Isolamento entre clientes
**Descrição:** `empresa_id` nas tabelas de dado, `podeOperar` real, chave
composta. `empresa-da-requisicao.ts` já isolou o ponto de mudança de propósito.
**Aceite:** conta vinculada à empresa A não lê nem escreve nada da B — provado
por teste que tenta e falha em toda rota.
**Prioridade:** P2 (**P0 se houver segundo cliente**) · **Esforço:** Alto (3–4
semanas) · **Risco mitigado:** G5 · **Dependências:** decisão de produto ·
**Métrica:** zero acesso cruzado no teste.

### BL-19 · Paginação por keyset
**Descrição:** trocar `OFFSET` por cursor em `comparison/query.ts` e nas rotas
de listagem.
**Aceite:** tempo da última página igual ao da primeira.
**Prioridade:** P2 · **Esforço:** Médio (1 semana) · **Risco mitigado:** G15 ·
**Dependências:** — · **Métrica:** p95 da página N independente de N.

### BL-20 · `BACKUP_DIR` durável e RPO declarado
**Descrição:** volume/bucket montado; `BACKUP_INTERVALO_HORAS` decidido com o
negócio; alerta de atraso ligado.
**Aceite:** `/healthz` mostra backup com menos de `INTERVALO` horas por 7 dias
seguidos; uma restauração de ensaio feita e cronometrada.
**Prioridade:** P1 · **Esforço:** Baixo (2 dias + infra) · **Risco mitigado:**
G18 · **Dependências:** infra · **Métrica:** RPO e RTO medidos, não presumidos.

---

# 13. Conclusão

**O FreightCheck está pronto para receber grande volume de dados?**
**Não.** Está pronto para o volume de hoje — 3 importações, 391.824 fatos,
590 MB — e para um crescimento modesto. Não está pronto para importação
recorrente e simultânea, nem para múltiplos clientes, nem para arquivo grande.
Faltam três coisas estruturais: **fila, worker separado e agregado
pré-calculado**. Nenhuma delas é conserto de bug; todas são construção.

**Qual volume foi efetivamente testado?**
Importação: **1.000 / 10.000 / 50.000 / 100.000 / 500.000 linhas** de uma
planilha de 9 colunas, ponta a ponta pelo caminho do produto, num Postgres 16
local com RTT zero. Concorrência: **1 / 10 / 50 / 100 / 500** usuários virtuais
contra a API compilada, com o acervo real de 124.632 fatos. Concorrência mista:
100 mil linhas importando enquanto 10 usuários navegam.
**1.000.000 de linhas não foi executado** — a projeção de RSS (~11,5 GB)
ultrapassa a memória útil da máquina de teste, e o que um OOM mediria seria o
limite da máquina, não o do produto.

**Qual volume pode ser suportado com segurança?**
Arquivos de até **~50 mil linhas** (63 s, 1,08 GB de RSS). Até **10 usuários
simultâneos** (33,6 req/s, p95 736 ms). **Uma** importação por vez. Histórico na
ordem de **1 a 2 milhões de fatos** antes de a varredura de `fato_visivel` passar
de 1 s por consulta. Num contêiner de 4 GB, o teto absoluto de um arquivo é de
**~320 mil linhas** — número projetado a partir dos 11 KB de RSS por linha
medidos, e que precisa da RAM real da instância para virar certeza.

**Qual é o primeiro gargalo provável?**
O `Seq Scan` de `fato_visivel`, e ele já está acontecendo. É o único gargalo
deste diagnóstico que **piora sozinho**, sem ninguém mudar nada: cada vigência
importada acrescenta linhas a uma varredura que toda tela faz. O segundo é a
memória da importação, que não piora sozinha — ela espera o primeiro arquivo
grande.

**O que precisa ser corrigido antes das novas importações?**
Quatro itens, todos de esforço baixo, todos em até duas semanas:
**BL-01** (`fato_visivel`), **BL-02** (teto de linhas e bytes), **BL-04**
(semáforo de simultâneas) e **BL-03** (`xlsx`). Sem BL-02 e BL-04, uma
importação grande derruba o servidor **de todo mundo** — não só a dela.

**O que precisa ser implementado antes da API?**
**BL-05** (fila com DLQ), **BL-15** (rate limit e cota), **BL-16**
(`Idempotency-Key`) e **BL-17** (webhook). E **BL-03** deixa de ser recomendável
para ser obrigatório: com API, o parser passa a ler arquivo que ninguém desta
casa enviou, e é exatamente esse o vetor da CVE-2023-30533. Se a integração for
de um **segundo cliente**, **BL-18** (isolamento) sobe para P0 — hoje não existe
isolamento nenhum, e isso está escrito no próprio código.

**Quais conclusões ainda dependem de testes ou informações adicionais?**

1. **A RAM e o RTT reais da instância de produção.** Dois números. Eles decidem
   o teto de linhas do BL-02 e mudam a leitura do G20. *Não foi possível validar
   com os dados disponíveis.*
2. **1 milhão de linhas** — projetado (30,5 min, ~11,5 GB), não medido.
3. **Disputa de lock entre importação e consulta na mesma tabela.** O que medi
   foi disputa de CPU/I/O; o efeito real é maior. *Não foi possível validar.*
4. **`pg_stat_user_indexes` de produção**, sem o qual a poda de índices do
   BL-12 é palpite sobre 8 dos 10 índices.
5. **Comportamento do autoscale do Replit sob carga** — quantas instâncias,
   quando recicla, e quanto tempo dá ao `SIGTERM`. Muda a gravidade do G2.
6. **O ciclo de excluir-e-reimportar** — respondido por Guy em 15/09/2026 como
   ajuste de desenvolvimento (`docs/CRESCIMENTO-MEDIDO.md`). Se voltar a
   acontecer em produção, o inchaço de índice volta com ele.
7. **Planilhas de 70 colunas.** Meus números são de 9 colunas. O custo por
   **célula** transfere (~890 bytes, ~180 µs); o custo por **linha** não.
8. **Base legal e prazo de retenção** de `matricula_do_motorista` — é decisão de
   negócio, não técnica.

---

## Como refazer estes números

```bash
# ambiente
node scripts/prova-local.mjs subir
psql "$ADMIN" -c "create extension if not exists pg_stat_statements;"
#   o cluster precisa de -c shared_preload_libraries=pg_stat_statements

# escada de importação
TEST_ADMIN_DATABASE_URL=… pnpm --filter @workspace/ingest exec \
  tsx src/cli/perfil-de-importacao.ts --linhas 500000 --repeticoes 1 --rtt 0
#   --rtt 25 transforma a contagem de idas ao banco na grandeza que ela é no Neon

# a prova do gargalo nº 1
psql "$DEV" -c "explain (analyze, buffers) select f.entity_id, a.code
  from fato_visivel f join attribute a on a.id=f.attribute_id
  join snapshot s on s.id=f.snapshot_id
  where s.effective_date=(select max(effective_date) from snapshot);"
#   compare com a mesma consulta trocando fato_visivel por fact + filtro de snapshot_id

# consultas de maior impacto
psql "$DEV" -c "select total_exec_time, calls, rows, query
  from pg_stat_statements order by total_exec_time desc limit 20;"
```

O teste de carga usado está descrito na §6.2 e é reproduzível com qualquer
gerador que dispare as 8 telas listadas com N clientes e timeout de 30 s.
