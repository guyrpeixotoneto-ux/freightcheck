# Diagnóstico de tamanho e crescimento do banco

Este documento é a **etapa 1** de uma investigação: o que o repositório
responde sozinho, sem conectar em lugar nenhum. As etapas 2 e 4 — medir o banco
e a velocidade do crescimento — dependem de uma credencial de produção que não
existe neste ambiente, e o que elas vão rodar está em
`scripts/diagnostico/tamanho-do-banco.sql`, lido e revisado antes de conectar.

Nada aqui foi executado contra produção. Nenhuma migration foi aplicada,
nenhum índice tocado, nenhum dado lido.

---

## 1. O que o repositório diz

### Banco, provedor e autoridade de schema

| Pergunta | Resposta | Onde está escrito |
| --- | --- | --- |
| Qual banco | PostgreSQL 16 | `.replit` (`modules = [… "postgresql-16"]`) |
| Provedor | Postgres gerenciado do Replit; deployment `autoscale` | `.replit`, `docs/BACKUP.md` |
| Driver | `pg` + `drizzle-orm` (`node-postgres`), pool de 10 | `lib/db/src/index.ts` |
| Conexão | `DATABASE_URL` (ambiente) — produção sob `PRODUCTION_DATABASE_URL` | `lib/db/src/index.ts`, `prova-producao.sh` |
| Schema | `lib/db/src/schema/*.ts` (28 arquivos, 92 tabelas) | — |
| Migrations | `lib/db/migrations/` — **97 arquivos versionados** | `docs/MIGRATIONS.md` |
| Quem aplica | `runMigrations()` na partida. `drizzle-kit push/migrate/drop` estão **desligados** | `lib/db/drizzle-kit.config.ts` |

A conexão de produção nunca vem de arquivo no repositório: é variável de
ambiente, e `prova-producao.sh` documenta o protocolo de acesso somente-leitura
(seis travas, `BEGIN READ ONLY`, URL nunca ecoada). O script novo deste
diagnóstico segue o mesmo protocolo.

### O que a aplicação escreve o tempo todo

O produto é um pipeline de importação de planilhas com rastreabilidade célula a
célula. Isso define a forma do banco:

**RAW — a cadeia de rastreabilidade (`lib/db/src/schema/raw.ts`)**

```
source_file → import_run → raw_sheet → raw_row → raw_cell
```

`raw_cell` guarda **uma linha por célula de planilha**, com `raw_value`,
`formatted_text`, `column_header` e `source_type` — todos `text`. É, por
construção, a maior tabela do banco: uma planilha de 30 mil linhas × 40 colunas
são 1,2 milhão de linhas em `raw_cell`, e cada reimportação do mesmo arquivo
cria um `import_run` novo com um novo conjunto completo de células. O próprio
`import_run` conta o volume que produziu (`raw_cell_count`).

O comentário do schema é explícito: *"CANONICAL from RAW; RAW itself is never
rewritten"* — RAW é evidência imutável, e a única remoção prevista é a exclusão
explícita de uma importação (`lib/ingest/src/deletion.ts`), feita por gente.

**CANONICAL — os fatos (`canonical.ts`)**: `fact`, `snapshot`,
`snapshot_attribute`, `entity`, `entity_identifier`. Crescem a cada promoção de
vigência.

**Logs append-only, sem política de retenção nenhuma.** Nenhum lugar do código
apaga destas tabelas — não há job de expurgo, não há `DELETE` por idade:

| Tabela | Uma linha por | Origem |
| --- | --- | --- |
| `integracao_chamada` | **cada chamada de API recebida** | `integracao.ts` — o próprio schema diz: *"a tabela que mais cresce deste schema, uma linha por chamada"* |
| `integracao_execucao` | **cada execução da busca agendada**, inclusive as `SEM_NOVIDADE` | `integracao.ts` — *"Só cresce, e guarda inclusive as que não trouxeram nada"* |
| `ticket_change` | cada alteração detectada em chamado | `tickets.ts` |
| `ticket_movement_day/_field/_step` | recalculadas por dia a cada envio | `monitoramento-de-chamados.ts` |
| `curation_event` | cada decisão de curadoria | `curation.ts` |
| `papel_evento`, `permissao_de_modulo_evento`, `modulo_universal_evento` | cada mudança de acesso | `papel.ts`, `permissao.ts`, `modulo-universal.ts` |
| `assistant_message` | cada pergunta/resposta do assistente, com `evidence` e `trace` em `jsonb` | `assistant.ts` |
| `import_decision`, `import_run_censo` | cada decisão do pipeline | `raw.ts` |
| `import_deletion`, `ticket_import_deletion` | permanentes **por desenho** — a auditoria sobrevive à exclusão | `deletion.ts` |

A busca agendada varre a cada 60 s (`busca-agendada.ts`) e a varredura de
leituras órfãs a cada 5 min (`api-server/src/index.ts`); só a primeira grava
linha, e só quando uma busca está vencida.

**Sessões: há limpeza, mas é oportunista.** `purgeExpiredSessions()`
(`artifacts/api-server/src/lib/session.ts:816`) apaga as sessões expiradas —
chamada no caminho de autenticação (`routes/auth.ts:388`), não por agenda. Ela
mantém `user_session` pequena, mas o `DELETE` gera linha morta, que é assunto da
seção 3.

### Binário dentro do banco — sim, existe

Duas tabelas guardam **arquivos** em coluna `bytea`, comprimidos com gzip:

- `fechamento_documento_conteudo.conteudo` — os relatórios Promax anexados a
  cada competência (seis fontes por quinzena).
- `fechamento_referencia_conteudo.conteudo` — o `.xlsb` de
  `Fechamento_Remuneracao`. O próprio schema menciona *"um arquivo de 3 MB e 44
  abas"*, e o histórico é preservado de propósito: *"Anexar de novo não
  sobrescreve: cria a versão seguinte e desativa a anterior. As inativas
  ficam."*

Ou seja: **cada reanexo de planilha de fechamento acrescenta um arquivo inteiro
ao banco, para sempre.** É decisão deliberada e documentada (a leitura de ontem
tem de continuar reconstruível), não um acidente — mas é uma fonte de
crescimento monotônico que precisa aparecer na medição.

Fora isso, arquivo não fica no banco: `source_file.storage_path` aponta para o
disco, e os backups são `pg_dump -Fc` gravados em `BACKUP_DIR`
(`lib/db/src/backup.ts`), com retenção de 14 — fora do banco.

**JSONs**: 34 colunas `jsonb` no schema. As candidatas a volume são
`assistant_message.trace`/`evidence` (rastro completo de uma resposta de IA:
consultas, argumentos, tokens, custo), `ticket_import.payload`,
`ticket_import_comparacao.diferencas`, `fechamento_*.memoria/carga_fiscal`, e
`change.calculated_impact_by_periodicity`.

---

## 2 e 4. O que falta medir — e por que ainda não foi medido

**A investigação para aqui, e a razão é a regra que você deu.** Não há
`DATABASE_URL` nem `PRODUCTION_DATABASE_URL` neste ambiente. O `psql` existe,
mas conectar exigiria uma credencial que eu não tenho — e adivinhar um destino
é exatamente o incidente que `prova-producao.sh` documenta nas travas 0 a 2:
com a URL vazia o `libpq` cai nos defaults e conecta em **outro** banco em
silêncio.

Para seguir, rode você mesmo:

```bash
PRODUCTION_DATABASE_URL='postgres://…' ./scripts/diagnostico/tamanho-do-banco.sh
```

O que o script faz, e o que ele custa, está escrito no cabeçalho dele. Em
resumo: **doze seções, todas lendo apenas catálogo e estatística** (`pg_class`,
`pg_stat_user_tables`, `pg_stat_user_indexes`, `information_schema`). Nenhuma
varre os dados de nenhuma tabela; nenhuma faz `count(*)` exato — a contagem de
linhas sai de `pg_class.reltuples`, a estimativa do planejador. São
milissegundos mesmo num banco grande, e não competem com a aplicação.

As travas são três, e nenhuma depende de eu ter escrito o SQL direito:

1. o runner recusa URL ausente, vazia, malformada, ou igual à de Development;
2. `SET default_transaction_read_only = on` vale para a sessão inteira — uma
   escrita que escapasse para o `.sql` seria recusada pelo servidor;
3. cada seção abre `BEGIN READ ONLY` próprio.

Uma transação **por seção**, e não uma para o arquivo: em banco gerenciado
`pg_ls_waldir()` costuma ser negada por permissão, e numa transação única essa
primeira recusa abortaria todas as seções seguintes.

O que cada seção responde:

| Seção | Pergunta sua |
| --- | --- |
| 0 | em que servidor estamos (host como hash curto, nada sensível) |
| 1, 1b, 1c | tamanho total; **outros bancos no mesmo servidor**; WAL acumulado |
| 2, 2b | dados × índices × TOAST, no total e por schema |
| 3 | **as 20 maiores tabelas** com heap, índices, TOAST, linhas aprox. e % do banco |
| 4 | onde o índice pesa mais que o dado |
| 5, 5b, 5c, 5d | maiores índices e uso; desde quando a estatística conta; nunca usados; **redundantes por prefixo** |
| 6 | **linhas mortas** e último autovacuum |
| 7, 7b | volume de TOAST por tabela; todas as colunas `jsonb`/`bytea` |
| 8 | inserções × remoções acumuladas — **quem só cresce** |
| 9 | tabelas sem nenhuma leitura (candidatas a órfãs) |
| 10 | **gera** o SQL das janelas de data das 15 maiores tabelas, para você ler antes de rodar |

A seção 10 gera em vez de executar de propósito: `min()`/`max()` sobre coluna
sem índice varre a tabela inteira, e essa é a única consulta cara do conjunto.

**Duplicatas e velocidade de crescimento** ficam para depois da primeira
rodada: as duas dependem de saber quais são as maiores tabelas. Contagem de
duplicatas precisa da chave de negócio de cada tabela (e o schema tem
`unique index` em quase todas as que importam — `raw_cell_row_column_uq`,
`source_file_sha256_uq`, `raw_sheet_run_index_uq`), e a taxa de crescimento sai
do histograma por mês das colunas de data que a seção 10 identificar.

**Sobre o que o painel do Replit está medindo**: `pg_database_size()` conta
heap + índices + TOAST + catálogo **deste** banco, e não conta WAL, backups,
réplicas nem logs. As seções 1b e 1c existem para fechar essa conta — se o
painel disser 1,26 GB e a soma das seções 1 e 1b der bem menos, a diferença é
do provedor, não do schema. Essa é uma pergunta para o suporte do Replit, e não
para o SQL.

---

## 3. Hipóteses, ordenadas pelo que o repositório sustenta

Nenhuma está confirmada: são o que procurar no resultado da etapa 2.

1. **`raw_cell` domina, e isso é normal.** Uma linha por célula, texto em três
   colunas, imutável por contrato. Se `raw_cell` + `raw_row` + seus índices
   forem a maior fatia de 1,26 GB, o banco está fazendo exatamente o que foi
   desenhado para fazer. **1,26 GB de 100 GB, para um produto que guarda cada
   célula de cada planilha importada, é pequeno.**
2. **Reimportações multiplicam RAW.** Cada `import_run` de um mesmo arquivo
   grava o conjunto completo de células de novo. Vale conferir quantos runs
   existem por `source_file` — a coluna `reprocessa_run_id` e
   `import_run.raw_cell_count` respondem sem varrer RAW.
3. **Logs de integração sem retenção.** `integracao_chamada` e
   `integracao_execucao` crescem por tempo, não por uso: uma busca agendada de
   15 em 15 minutos são ~35 mil linhas/ano mesmo sem nunca trazer arquivo.
   Hoje pequeno; é a tabela que vira problema em dois anos.
4. **Binário de fechamento acumulado.** Versões inativas de `.xlsb` guardadas
   para sempre — poucos MB por anexo, mas monotônico e em TOAST.
5. **Linhas mortas de exclusões de importação.** Excluir uma importação apaga
   milhões de linhas de `raw_cell`; o espaço volta para reuso do Postgres, mas
   **não** para o sistema operacional. Um banco que já teve exclusões grandes
   fica fisicamente maior que os dados vivos, e o painel mostra o tamanho
   físico. A seção 6 mede isso.
6. **Dado de teste em produção.** O repositório tem `pnpm dev:seed`
   (`lib/curation/src/cli/dev-seed.ts`) — vale conferir se alguma planilha de
   `attached_assets/` aparece em `source_file` de produção.
7. **`assistant_message.trace`.** Rastro completo por resposta, em `jsonb`,
   sem retenção. Cresce com o uso do assistente.

**O que eu não vou fazer sem sua autorização explícita**, e que este documento
deliberadamente não propõe como conclusão: nenhum `DELETE`, nenhuma política de
retenção aplicada, nenhum índice removido, nenhum `VACUUM FULL`, nenhuma
migration. Se a medição apontar para alguma dessas, ela vira uma proposta com
número ao lado — não um comando executado.
