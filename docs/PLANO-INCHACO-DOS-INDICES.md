# Inchaço dos índices: evidência, plano e recomendação

**Nada aqui foi executado.** Nenhum `REINDEX`, nenhuma extensão instalada,
nenhuma escrita no banco. Este documento é a proposta que precisa de aprovação
antes de qualquer uma dessas coisas.

A leitura que o sustenta foi feita em 15/09/2026 pelo dono do banco, no shell do
Replit, com `scripts/diagnostico/tamanho-do-banco.sql`.

---

## 1. A evidência

### A composição do banco

```
heap (dados)    141 MB    11%
índices        1115 MB    87%   ←
TOAST            14 MB     1%
               ────────
total          1270 MB
```

`pg_database_size` dá 1.344.618.496 bytes = 1,2524 GiB — é o "1,26 GB" do
painel. Os outros bancos do servidor somam 15 MB e o WAL 16 MB, então **o painel
mede só o `neondb`**: nada de backup, réplica ou log entra nessa conta. (O
Postgres por trás do Replit é o **Neon**, versão 16.15.)

### A prova de que é inchaço, e não chave larga

`change_pkey` resolve a questão sozinha:

| | |
|---|--:|
| Linhas vivas em `change` | 5.616 |
| Tamanho de `change_pkey` | 3.712 kB |
| Por linha | **660 bytes**, para uma chave `uuid` |

Uma entrada de btree sobre `uuid` ocupa ~30 bytes. 5.616 linhas caberiam em
~200 kB. São ~20x. E por ser índice **único de coluna única**, nenhuma
explicação de deduplicação ou chave composta se aplica.

O mesmo padrão nos grandes:

| Índice | Real | Chave × linhas vivas | Fator |
|---|--:|--:|--:|
| `staged_fact_grain_uq` | 355 MB | ~25 MB | ~14x |
| `fact_grain_uq` | 172 MB | ~17 MB | ~10x |
| `fact_snapshot_attribute_idx` | 159 MB | ~20 MB | ~8x |
| `fact_raw_cell_idx` | 60 MB | ~7 MB | ~9x |
| `raw_cell_row_column_uq` | 53 MB | ~8 MB | ~6x |

> **Medido em 15/09/2026, 18h40**, com a seção 2 de
> `scripts/diagnostico/densidade-dos-indices.sql`. A tabela completa está na
> seção 1.1 abaixo.
>
> `pgstattuple` está **disponível (1.5) mas não instalada** neste banco, então
> `pgstatindex` não rodou — instalar é DDL e não foi feito. A aproximação por
> catálogo bastou: ela chegou a ~881 MB recuperáveis contra os ~865 MB que a
> estimativa à mão previa, pelos dois caminhos independentes.

### 1.1 A medição, índice a índice

`fator` é quantas vezes o índice é maior que o mínimo teórico das chaves vivas.

| Índice | Real | Linhas vivas | Mínimo | Fator | Recuperável |
|---|--:|--:|--:|--:|--:|
| `staged_fact_grain_uq` | 355 MB | 274.995 | 34 MB | **10,3x** | 320 MB |
| `fact_grain_uq` | 172 MB | 274.995 | 17 MB | **9,9x** | 155 MB |
| `fact_snapshot_attribute_idx` | 159 MB | 274.995 | 17 MB | **9,1x** | 142 MB |
| `fact_raw_cell_idx` | 60 MB | 274.995 | 5,8 MB | **10,2x** | 54 MB |
| `raw_cell_row_column_uq` | 53 MB | 430.978 | 11 MB | 4,8x | 42 MB |
| `fact_pkey` | 42 MB | 274.995 | 5,8 MB | 7,3x | 37 MB |
| `raw_cell_pkey` | 37 MB | 430.978 | 9,1 MB | 4,1x | 28 MB |
| `staged_fact_raw_cell_idx` | 35 MB | 274.995 | 5,8 MB | 6,0x | 29 MB |
| `staged_fact_pkey` | 35 MB | 274.995 | 5,8 MB | 6,0x | 29 MB |
| `fact_entity_attribute_idx` | 35 MB | 274.995 | 13 MB | 2,7x | 22 MB |
| `fact_snapshot_entity_idx` | 20 MB | 274.995 | 13 MB | 1,6x | 7,4 MB |
| `fact_attribute_idx` | 15 MB | 274.995 | 8,2 MB | 1,8x | 6,6 MB |
| `fact_origin_import_run_idx` | 13 MB | 274.995 | 8,2 MB | 1,6x | 4,6 MB |
| `staged_fact_run_label_idx` | 12 MB | 274.995 | 14 MB | 0,9x | — |
| `staged_fact_run_idx` | 11 MB | 274.995 | 8,2 MB | 1,3x | 2,4 MB |
| `raw_cell_row_idx` | 11 MB | 430.978 | 9,1 MB | 1,2x | 2,1 MB |
| | | | | | **~881 MB** |

**As quatro últimas linhas são a razão para confiar na tabela.**
`staged_fact_run_label_idx` mediu 0,9x — abaixo do mínimo teórico — e
`raw_cell_row_idx` 1,2x. São índices saudáveis, nas mesmas tabelas, medidos pela
mesma fórmula. Um método enviesado para acusar inchaço teria acusado esses
também. (O 0,9x é o limite da aproximação: a largura média das colunas de texto
vem da amostragem do ANALYZE e superestima um pouco; leia-se "sem inchaço
mensurável".)

E o contraste que fecha o argumento: `fact_grain_uq` e `fact_snapshot_entity_idx`
estão na **mesma tabela**, com as **mesmas 274.995 linhas** — 9,9x contra 1,6x. A
diferença não pode ser volume de dado, porque o dado é o mesmo.

### 1.2 Uma variação entre as duas leituras, registrada

`raw_cell` tinha 315.038 linhas às 17h29 e 430.978 às 18h40 — ~116 mil a mais em
uma hora — enquanto `fact` ficou em 274.995 nas duas. É RAW capturado sem
promoção: ou uma importação nova parou no preview, ou a estimativa anterior
estava desatualizada.

Não muda nada deste plano. Fica registrado porque é exatamente o que a seção 1
de `crescimento.sql` existe para responder, e porque um número que muda entre
duas leituras merece ser dito, não arredondado.

### 1.3 De onde veio o churn — medido em 15/09/2026

`crescimento.sql` respondeu, e o número reenquadra tudo:

| | |
|---|--:|
| Importações vivas | **3**, somando 2.351 kB de `.xlsx` |
| Importações excluídas | **37** |
| Idade do acervo | **7 dias** |

**92,5% de todas as importações que já existiram foram excluídas**, e nada de
agosto sobreviveu. `EMPURRADA_Cavalo.xlsx` foi excluído 6 vezes e está vivo na
sétima — mesmo SHA-256, sete leituras completas do zero.

Isto não desmente nada da evidência acima; muda a história dela. O inchaço não é
subproduto de operação em regime: é resíduo de **uma semana de iteração**. O que
melhora o caso da reindexação — limpar uma vez tem chance de resolver por um bom
tempo — e desloca a pergunta estrutural de "quanto tempo até 100 GB" para "o
ciclo de excluir-e-reimportar vai continuar?".

Detalhe completo, e os dois erros que aquela rodada expôs nas minhas próprias
consultas: **`docs/CRESCIMENTO-MEDIDO.md`**.

### O mecanismo

```
raw_cell      inseridas 3.317.725   removidas 3.002.687   vivas 315.038
fact          inseridas 2.884.833   removidas 2.448.540   vivas 274.995
staged_fact   inseridas 2.876.956   removidas 2.601.961   vivas 274.995
```

~90% de tudo o que já entrou foi apagado. O heap sobreviveu — a seção 6 voltou
**vazia**, zero linhas mortas, autovacuum em dia. Os índices não: página de
btree esvaziada por `DELETE` é reaproveitada só parcialmente e nunca devolvida
ao sistema de arquivos.

---

## 2. Correção imediata — reindexação

### Quais índices, e quanto volta

Números **medidos** (seção 1.1), não mais estimados. O "estimado" de cada
linha é o mínimo teórico das chaves vivas:

| # | Índice | Hoje | Estimado | Recuperável |
|--:|---|--:|--:|--:|
| 1 | `change_pkey` | 3,7 MB | ~0,2 MB | ~3,5 MB |
| 2 | `fact_origin_import_run_idx` | 13 MB | ~6 MB | ~7 MB |
| 3 | `fact_attribute_idx` | 15 MB | ~8 MB | ~7 MB |
| 4 | `fact_entity_attribute_idx` | 35 MB | ~14 MB | ~21 MB |
| 5 | `staged_fact_pkey` | 35 MB | ~8 MB | ~27 MB |
| 6 | `staged_fact_raw_cell_idx` | 35 MB | ~8 MB | ~27 MB |
| 7 | `raw_cell_pkey` | 37 MB | ~9 MB | ~28 MB |
| 8 | `fact_pkey` | 42 MB | ~10 MB | ~32 MB |
| 9 | `raw_cell_row_column_uq` | 53 MB | ~10 MB | ~43 MB |
| 10 | `fact_raw_cell_idx` | 60 MB | ~8 MB | ~52 MB |
| 11 | `fact_snapshot_attribute_idx` | 159 MB | ~20 MB | ~139 MB |
| 12 | `fact_grain_uq` | 172 MB | ~20 MB | ~152 MB |
| 13 | `staged_fact_grain_uq` | 355 MB | ~30 MB | ~325 MB |
| | **total (13)** | **1.015 MB** | **~151 MB** | **~864 MB** |
| | **+ os 3 saudáveis** | 43 MB | 43 MB | — |
| | **soma medida (16)** | | | **~881 MB** |

O banco iria de 1.282 MB para **~400 MB** — medido, não estimado (seção 1.1).

**Os quatro últimos valem 75% do ganho.** Se a ideia for fazer o mínimo com o
máximo de retorno, são `staged_fact_grain_uq`, `fact_grain_uq`,
`fact_snapshot_attribute_idx` e `fact_raw_cell_idx`: 746 MB viram ~78 MB,
recuperando **671 MB** em quatro operações em vez de treze — 76% do ganho.

### Impacto no desempenho

O ganho real não é disco — são 865 MB num limite de 100 GB, o que não compra
nada. É I/O:

- Hoje uma varredura de `fact_grain_uq` lê 172 MB de páginas para percorrer
  ~17 MB de chave. No Neon, onde o storage é separado do compute, cada página
  fria é ida e volta pela rede.
- Os índices inchados **competem pelo cache**: 1,1 GB de índice não cabe na
  RAM de um compute pequeno; ~150 MB cabe. É a diferença entre ler do disco e
  ler da memória, na promoção e em toda tela que lê fato.
- A conferência de unicidade na promoção (`fact_grain_uq`, `staged_fact_grain_uq`)
  é o caminho que mais sofre: ela é feita por linha inserida.

Não prometo número. O que prometo é a direção, e que dá para medir antes e
depois com `EXPLAIN (ANALYZE, BUFFERS)` na mesma consulta.

### Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Índice inválido (`*_ccnew`) se a operação falhar no meio | média | É o risco real do `CONCURRENTLY`. O índice antigo **continua válido e em uso**; o resto é limpar o lixo com `DROP INDEX CONCURRENTLY <nome>_ccnew`. Conferir `pg_index.indisvalid` depois de cada um. |
| Bloqueio de escrita | **nenhum** | `CONCURRENTLY` toma `ShareUpdateExclusiveLock`: `SELECT`, `INSERT`, `UPDATE` e `DELETE` seguem normalmente. Só DDL na mesma tabela é bloqueado. |
| A operação esperar indefinidamente | baixa | Ela aguarda as transações abertas que enxergam a tabela. Uma importação longa em curso a segura. **Não rodar durante importação.** |
| Suspensão do compute no meio | baixa | Neon suspende compute ocioso, não ocupado. A operação mantém a conexão ativa. |
| Dismissal de aprovação / perda de dado | **nenhum** | `REINDEX` reconstrói; não altera uma linha de dado. |

### Tempo e espaço temporário

- **Tempo**: cada índice é uma ordenação de 275–315 mil linhas. Segundos, não
  minutos — estimo 10 a 60 s por índice, e o conjunto todo abaixo de 10 minutos.
  O maior (`staged_fact_grain_uq`) é o mais lento por ser o de chave mais larga.
- **Espaço temporário**: o novo índice é construído ao lado do antigo antes da
  troca, então o pico é `antigo + novo`. Como o novo é ~10x menor, o acréscimo
  é o tamanho do **novo** (~30 MB no pior caso) mais o espaço de ordenação
  (`maintenance_work_mem`, que transborda para arquivo temporário). **Menos de
  100 MB de pico**, contra 98 GB livres.
- Conferir antes: `SHOW maintenance_work_mem;` — se estiver muito baixo a
  ordenação vai a disco e demora mais. Não é risco, é lentidão.

### Ordem segura, um por vez

Do menor para o maior. O primeiro existe para **calibrar**: se `change_pkey`
levar 40 segundos em vez de 2, o resto da estimativa está errada e vale parar
para entender antes de tocar no de 355 MB.

```
1. change_pkey                     3,7 MB   ← prova o procedimento
   (não aparece na seção 1.1: a consulta corta em 8 MB. O fator de ~20x dele
    vem da aritmética da seção 1, e é o maior do banco.)
2. fact_origin_import_run_idx       13 MB
3. fact_attribute_idx               15 MB
4. fact_entity_attribute_idx        35 MB
5. staged_fact_pkey                 35 MB
6. staged_fact_raw_cell_idx         35 MB
7. raw_cell_pkey                    37 MB
8. fact_pkey                        42 MB
9. raw_cell_row_column_uq           53 MB
10. fact_raw_cell_idx               60 MB
11. fact_snapshot_attribute_idx    159 MB
12. fact_grain_uq                  172 MB
13. staged_fact_grain_uq           355 MB   ← o maior ganho, por último
```

Entre um e o seguinte, conferir que o anterior ficou válido e do tamanho
esperado:

```sql
SELECT c.relname, i.indisvalid, pg_size_pretty(pg_relation_size(c.oid))
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
 WHERE c.relname LIKE '%_ccnew%' OR c.relname = '<o índice que acabou de rodar>';
```

`indisvalid = false` em qualquer linha significa parar e limpar antes de seguir.

**Nunca `REINDEX TABLE CONCURRENTLY`**: ele faz a tabela inteira de uma vez,
perde-se a calibração e um erro no meio deixa vários índices inválidos.

**Nunca sem `CONCURRENTLY`**: o `REINDEX` simples toma lock exclusivo e derruba
a aplicação pelo tempo da reconstrução.

---

## 3. Correção estrutural

### Por que o fluxo apaga e reinsere tanto

Três causas, e só uma delas é acidental.

**(a) Herança de fatos na revisão** — `lib/ingest/src/pipeline.ts:3849-3868`.
Uma revisão que corrige só os cavalos copia **todas** as carretas da revisão
anterior para o snapshot novo, como linhas novas. Uma vigência de 10 mil fatos
corrigida cinco vezes produz até 50 mil linhas de `fact`, ainda que 40 mil sejam
cópias idênticas. Isso é inserção pura — não gera `DELETE`, mas multiplica
entradas de índice.

Não é defeito: é o que faz "uma vigência é completa e auto-contida" ser verdade,
e está documentado na própria função. Mexer aqui é mexer no contrato do produto.

**(b) Purge de exclusão de importação** — `lib/ingest/src/deletion.ts`. Apaga
`raw_cell`, `staged_fact`, `fact`, `change` do run. É a fonte dos 2,4 milhões de
`DELETE` em `fact`, e é o que esvazia as páginas de btree.

**(c) Reprocessamento** — um run novo, com recaptura **completa** do RAW do
mesmo arquivo. `source_file` é deduplicado por SHA-256, então os bytes são
idênticos; ainda assim a leitura grava um conjunto novo de `raw_cell`.

### Como reduzir

> **DECIDIDO EM 15/09/2026 — não implementar agora.** Guy confirmou que as 37
> exclusões foram ajuste e teste das importações durante o desenvolvimento, e
> **não representam o funcionamento esperado em produção**. Sem o ciclo, a
> otimização abaixo resolveria um problema que não vai existir.
>
> Fica registrada como **melhoria futura, condicionada a um gatilho medido**: se
> em produção os mesmos arquivos voltarem a ser excluídos e reimportados — a
> seção 2 de `crescimento.sql` mostra isso na coluna `runs` por arquivo, e a
> seção 3 na contagem de exclusões por SHA —, ela passa a ter retorno e volta
> para a mesa. O gatilho concreto: **qualquer arquivo com 3 ou mais runs, ou
> mais de uma exclusão por mês do mesmo SHA-256, em uso real.**

**(c) seria o alvo certo — o único com ganho real e risco contido.** Se o
`content_sha256` é o mesmo e a captura é determinística, o RAW do run anterior
poderia ser **reaproveitado** em vez de recapturado. Evita uma cópia inteira de
`raw_cell` por reprocessamento.

O custo: RAW passaria a ser compartilhado entre runs, e o purge precisaria de
contagem de referência para não apagar células que outro run ainda usa. É
trabalho de verdade, com migration, mas é local ao `lib/ingest` e não toca em
nenhuma regra de negócio. **É a mudança que eu proporia primeiro** — depois de
medir, pela seção 2 de `crescimento.sql`, quantos arquivos de fato são relidos.
Se forem poucos, não vale.

**(a) eu não proporia mexer.** Substituir a cópia por uma cadeia de herança
resolveria o volume e destruiria a propriedade que o schema mais protege.

**(b) não tem como reduzir**: excluir importação é função do produto.

### UPSERT resolve?

**Não, e vale dizer por quê em vez de deixar em aberto.**

`fact_grain_uq` é `(snapshot_id, entity_id, attribute_id)`. Uma revisão nova cria
um **snapshot novo**, com `snapshot_id` novo — então não há conflito sobre o que
fazer `ON CONFLICT DO UPDATE`. O `UPSERT` só ajudaria se a revisão reescrevesse o
snapshot no lugar, e é exatamente isso que o modelo de revisão existe para não
fazer.

O mesmo vale para `staged_fact_grain_uq`, que começa com `import_run_id`: cada
run é um conjunto novo por definição.

Onde `UPSERT` ajudaria de fato é no **retry de promoção** — e ali o código já
resolveu por outro caminho, documentado em `lib/ingest/src/presenca.ts`.

### `staged_fact` pode ser limpa?

Investigado em separado: **`docs/RETENCAO-DO-STAGED-FACT.md`**.

Resumo: hoje não, porque três telas vivas leem `staged_fact` depois da promoção
— e a pior consequência não seria uma tela vazia, e sim o quadro por aba do
Balanço **acusando perda de dado que não houve**. E, mais importante: depois de
reindexar, `staged_fact` cai de 509 MB para ~100 MB, e o ganho de apagá-la deixa
de justificar o trabalho.

### O que impede os índices de voltarem a inchar

Sendo honesto sobre o que funciona e o que não:

| Medida | Funciona? |
|---|---|
| Baixar `fillfactor` dos índices | **Não.** `fillfactor` reserva espaço para `UPDATE` na mesma página; o churn aqui é `DELETE` em massa. |
| Contar com a *bottom-up index deletion* do PG 14+ | **Não aqui.** Ela combate churn de `UPDATE` de coluna não indexada. O nosso é `DELETE`. |
| Autovacuum mais agressivo | **Não para isto.** O autovacuum já está em dia — zero linhas mortas. Ele marca páginas de índice reutilizáveis; não as devolve nem as compacta. |
| Reduzir o churn (item **c** acima) | **Sim**, na raiz. |
| `REINDEX CONCURRENTLY` periódico | **Sim**, como manutenção. É o que a maioria dos bancos com este perfil faz. |

**A recomendação operacional é manutenção agendada, não uma correção definitiva.**
Um banco que apaga 90% do que insere vai inflar os índices de novo; a pergunta
não é como impedir, é com que frequência reconstruir. Com o ritmo atual,
**trimestral** parece folgado — e a métrica abaixo diz quando antecipar.

### O que monitorar

| Métrica | Onde | Frequência | Alarme |
|---|---|---|---|
| `avg_leaf_density` dos 5 maiores índices | `densidade-dos-indices.sql` §1 | trimestral | < 40% → reindexar |
| Razão índice / heap do banco | `tamanho-do-banco.sql` §2 | mensal | > 3x |
| `pg_database_size` | `tamanho-do-banco.sql` §1 | mensal | curva mudando de inclinação |
| `n_tup_del` / `n_tup_ins` por tabela | `tamanho-do-banco.sql` §8 | mensal | > 0,8 sustentado |
| Exclusões de importação por mês | `crescimento.sql` §3b | mensal | salto sem explicação |
| Bytes por célula viva | `crescimento.sql` §5 | mensal | subindo = inchaço voltando |

A última é a mais barata e a mais reveladora: `pg_database_size` dividido por
células vivas. Ela sobe quando o banco cresce sem que o acervo cresça — que é a
definição de inchaço, medida sem precisar de extensão nenhuma.

---

## 3.5 Como executar a reindexação autorizada

`scripts/manutencao/reindexar-os-quatro.sh` — **e ele mora em `manutencao/`, não
em `diagnostico/`, de propósito.** Tudo em `diagnostico/` é somente leitura, e o
runner de lá recusa este arquivo por conter `REINDEX`. Essa recusa está certa e
não foi afrouxada: a operação de escrita ganhou casa própria e exige
`--confirmar` explícito.

```bash
PRODUCTION_DATABASE_URL='postgres://…' \
  ./scripts/manutencao/reindexar-os-quatro.sh --confirmar
```

Ele aborta **antes de escrever qualquer coisa** se encontrar:

| Conferência | Por quê |
|---|---|
| importação em `PENDING`, `READING` ou `PROMOTING` | trabalho em curso — o REINDEX esperaria por ela |
| importação em `STAGED` ou `PREVIEWED` | espera decisão humana e pode virar promoção a qualquer segundo |
| transação aberta há mais de 30s | `REINDEX CONCURRENTLY` aguarda as transações que enxergam a tabela |
| índice inválido preexistente | lixo de operação anterior; limpar antes |
| algum dos quatro ausente | erro de premissa |

Durante a execução, entre um índice e o seguinte, confere que o anterior ficou
`indisvalid = true` e que não sobrou nenhum `%_ccnew%`. Qualquer um dos dois
falhando **para ali**, e os índices seguintes não são tocados — o antigo
continua válido e em uso, então a aplicação não sente.

`statement_timeout = 0` é exceção deliberada: um `REINDEX` morto pelo relógio
deixa índice inválido para trás. O teto é a pessoa olhando, não o relógio.
`lock_timeout = 60s` fica, para falhar rápido e com nome em vez de pendurar em
silêncio.

## 4. Recomendação

1. ~~**Rodar `densidade-dos-indices.sql`.**~~ **Feito em 15/09/2026** — ver
   seção 1.1. Confirmado: 9 a 10x nos quatro maiores, ~881 MB recuperáveis. O
   teste que poderia ter derrubado o plano não o derrubou.
2. **Reindexar os quatro maiores**, um por vez, na ordem 11→13
   da seção 2, fora de horário de importação. **671 MB dos 881 MB — 76% do
   ganho em 4 das 16 operações.** As outras podem esperar a próxima manutenção.
3. **Não mexer em `staged_fact`** — nem na retenção, nem nas telas.
4. **Medir o reprocessamento** (`crescimento.sql` §2). Só abrir a mudança de
   reaproveitamento de RAW se os números mostrarem releitura frequente.
5. **Agendar a conferência trimestral** de densidade.

E o enquadramento que importa: **isto não é urgente.** São 1,28% de um limite de
100 GB. O que justifica agir não é espaço, é latência de I/O — e é por isso que
a recomendação é manutenção agendada, com medida antes e depois, e não um mutirão.

**Aguardando sua aprovação para qualquer passo que escreva no banco.**
