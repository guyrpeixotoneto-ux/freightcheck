# Migrations: uma autoridade só

O schema do FreightCheck muda por **migration versionada** em
`lib/db/migrations/*.sql`, aplicada por `runMigrations()`
(`lib/db/src/migrate.ts`), uma transação por migration. Não há segunda via.

Onde isso roda:

| momento | quem aplica |
| --- | --- |
| partida do servidor | `artifacts/api-server/src/index.ts` chama `runMigrations()` em segundo plano; o estado sai em `/api/healthz` |
| post-merge do Replit | `scripts/post-merge.sh` |
| desenvolvimento | `scripts/dev.mjs` |
| à mão | `pnpm --filter @workspace/db run migrate` |
| testes | cada banco de teste nasce das migrations, nunca de push |

## Por que não existe uma segunda autoridade

Um diff de schema sabe copiar estrutura. Ele não sabe nada do que sustenta essa
estrutura neste projeto:

- as funções `IMMUTABLE` (`freightcheck_snapshot_key` e companhia) de que a
  coluna gerada `canonical_snapshot_key` depende;
- o backfill que converte as vigências históricas antes de `dataset_family`,
  `canal` e `canonical_scope` poderem ficar `NOT NULL`;
- a validação que recusa canal vazio e escopo vazio **antes** do `NOT NULL`;
- a fusão das vigências duplicadas da `0016`, com `snapshot_merge` guardando
  para onde os dados de cada origem foram;
- as três views de diagnóstico e os gatilhos de imutabilidade.

Aplicado sozinho, o diff não é uma versão mais rápida da migration: é um banco
num estado que nenhuma das duas autoridades reconhece. O caso concreto: o diff
propõe `ALTER TABLE snapshot ADD COLUMN dataset_family text NOT NULL` numa
tabela que já tem linhas — sem backfill, e com a coluna gerada apontando para
uma função que ele não cria.

### O que está trancado, e onde

**`drizzle-kit push`, `migrate` e `drop` abortam** em
`lib/db/drizzle.config.ts`, antes de abrir conexão. `generate`, `check` e `up`
continuam liberados: eles mexem em arquivo do repositório, que é onde a decisão
de schema é tomada e revisada.

**A configuração não vai para a imagem publicada** (`.replitignore`), de modo
que nenhum passo de publicação consiga usá-la de dentro do contêiner.

**O `meta/` do drizzle está alinhado com o disco** — ver a seção seguinte. Era
daí que vinha a proposta fantasma: o último snapshot era o `0011`, e qualquer
ferramenta que diferencia `schema.ts` contra o `meta/` concluía que as seis
migrations seguintes nunca tinham existido e propunha refazê-las.

### O que **não** está trancado, e é decisão de quem publica

O Publishing do Replit monta a proposta dele comparando o **banco de
desenvolvimento com o de produção**, no navegador, fora do repositório. Não há
interruptor deste lado para aquela comparação. Enquanto produção estiver atrás
de desenvolvimento — o que é o normal no instante do deploy —, ele vai encontrar
diferença e oferecer aplicá-la.

**Recuse a proposta.** Publique só build e start: o servidor aplica a fila
versionada na partida e `/api/healthz` mostra o resultado. Aceitar a proposta é
o único jeito de este projeto ficar com dois schemas.

Ela costuma aparecer como uma pergunta de *renomeação* — "Detected potential
conflicts: essas colunas foram removidas e essa foi adicionada; alguma delas foi
renomeada?". É o resolvedor de conflitos do drizzle-kit, e a pergunta não tem
resposta certa **nenhuma**: as opções todas terminam em aplicar DDL fora da fila.
Não há como responder "isso já está tratado numa migration" — só cancelar.

O que ela mostra, porém, é informação boa de graça: a lista de diferenças diz
exatamente **quanto produção está atrás**. Uma pergunta sobre `ticket` perdendo
`parameter_label`, `attribute_code`, `requested_value_*`, `applied_value_*` e
`impact_*` e ganhando `changed_parameter_count` é a `0013` inteira — ou seja,
produção ainda está na `0012`.

A conferência que vale é esta, somente leitura, contra o banco de produção:

```sql
SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

### Como reconhecer que a proposta foi aceita

Um deploy parou assim:

```
function freightcheck_snapshot_key(text, text, text, date, jsonb) does not exist
```

no comando:

```sql
ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
GENERATED ALWAYS AS (
  freightcheck_snapshot_key(
    source_system, dataset_family, canal, effective_date, canonical_scope)
) STORED;
```

**Esse comando não existe neste repositório**, e dá para provar isso lendo o
próprio comando. A `0015` cria a mesma coluna com os identificadores **entre
aspas**, numa linha só, dentro de um `DO $$` — e trezentas linhas depois de
criar as funções, na mesma transação. A forma sem aspas, em caixa baixa e
quebrada em várias linhas é exatamente o que `pg_get_expr()` devolve ao ler a
expressão de uma coluna gerada de um banco **vivo**:

```
freightcheck_snapshot_key(source_system, dataset_family, canal, effective_date, canonical_scope)
```

Ou seja: aquele DDL foi derivado por **introspecção do banco de
desenvolvimento** e aplicado em produção. Ele copia a coluna gerada e não copia
as funções — o modelo de snapshot do drizzle não representa função nenhuma — e
produção, que ainda não tinha rodado a `0015`, não tinha o que a coluna chama.

**O tell, em uma linha:** identificadores sem aspas no `GENERATED ALWAYS AS`
quer dizer introspecção de banco; com aspas, quer dizer repositório.

O conserto não é aplicar a função à mão em produção nem copiar o banco de
desenvolvimento: é deixar a fila versionada rodar. Ela atravessa até o banco em
que a proposta morreu no meio — as três colunas de identidade acrescentadas e
mais nada —, porque cada objeto da `0015` é procurado antes de ser criado.
Coberto em `canonical-identity-migration.test.ts`, no bloco *o DDL do deploy, e
a fila que não precisa dele*.

## O `meta/` do drizzle, e o que ele não representa

`migrations/meta/*.json` são a fotografia que o drizzle-kit usa como base do
próximo diff. Existe um snapshot por entrada do `_journal.json`, e o último tem
de descrever exatamente o `schema.ts` de hoje — senão o diff volta a propor o
que já existe.

Os snapshots `0012`–`0014` foram reconstruídos a partir do `schema.ts` de cada
commit que introduziu a migration correspondente (`231133f`, `2b8b50c`,
`8318985`). Os de `0015`–`0017` foram derivados do `schema.ts` atual desfazendo
o que `0016` e `0017` acrescentam — as três migrations da identidade canônica
foram escritas num commit só (`ecf2a85`), e não existe um `schema.ts` histórico
para cada uma. Cada snapshot é conferido contra um banco real em
`src/__tests__/meta-snapshots.test.ts`: a derivação não vale por si, vale porque
passa nessa conferência.

**O que o snapshot não modela**, e que por isso é autoridade exclusiva do SQL:

- funções (`freightcheck_*`);
- gatilhos e as funções de gatilho (`0001`);
- views (`freightcheck_snapshot_ativo_duplicado`, `freightcheck_fato_duplicado`,
  `freightcheck_identidade_vigencia`);
- índices parciais que o `schema.ts` não declara, como `fact_inherited_idx`;
- todo o SQL procedural — backfill, fusão, validação, `COMMENT ON`.

Consequência prática: um `drizzle-kit push` não veria nenhum desses objetos e os
trataria como ausentes. É mais um motivo para ele estar desligado.

## Alterar o schema

1. edite `lib/db/src/schema/*.ts`;
2. `pnpm --filter @workspace/db run generate` — o SQL sai em
   `lib/db/migrations`, com o snapshot correspondente;
3. **leia e reescreva o SQL gerado.** Ele é um rascunho: coluna obrigatória em
   tabela com dado exige coluna nullable → backfill → validação explícita →
   `NOT NULL` → constraints, nessa ordem, e nada disso o gerador escreve;
4. rode os testes de migration (`pnpm --filter @workspace/db test`);
5. commite SQL e snapshot juntos. Um sem o outro é o começo da divergência.

## As constraints da identidade, e a `0018`

A validação explícita do backfill e as quatro constraints que fecham identidade
vazia (`snapshot_canal_nao_vazio_ck`, `snapshot_dataset_family_nao_vazio_ck`,
`snapshot_canonical_scope_ck`, `snapshot_canonical_scope_nao_vazio_ck`) entraram
na `0015`. Um banco que ainda não a aplicou — produção — recebe tudo por lá.

Um banco que já a aplicou, não: o registro é por carimbo, e migration aplicada
não roda de novo. A `0018` existe só para esse caso, e é escrita para os dois:
onde as constraints já estão, ela confere e não faz nada; onde faltam, ela
valida o dado e as cria. É a diferença entre corrigir uma migration e deixar
desenvolvimento e produção com schemas diferentes.

## O `search_path` das funções da identidade, e a `0020`

As onze funções `freightcheck_*` da identidade nasceram na `0015` sem `SET
search_path`. Numa função `LANGUAGE sql` de corpo textual, os nomes de dentro do
corpo são resolvidos **na primeira chamada de cada sessão**, com o `search_path`
de quem chamou — não com o de quem a criou:

```sql
SET search_path = '';
SELECT public.freightcheck_snapshot_key('FREIGHTEC','X','E','2026-08-01','[]');
-- ERROR:  function freightcheck_norm_canal(text) does not exist
-- CONTEXT: SQL function "freightcheck_snapshot_key" during startup
```

E `freightcheck_snapshot_key` não é chamada só por quem quer: ela é a expressão
da coluna **gerada** `snapshot.canonical_snapshot_key`, avaliada em todo
`INSERT` e todo `UPDATE`; `freightcheck_canonical_scope` é a expressão do `CHECK
snapshot_canonical_scope_ck`. Uma conexão cujo `search_path` não inclua `public`
— um pooler que o redefine, um papel de deploy com `search_path` próprio — não
perde uma consulta: perde o caminho de escrita inteiro de `snapshot`.

A `0020` pina o `search_path` das onze, com os corpos idênticos, e prova que
nenhuma identidade já gravada mudou de valor: ela recalcula a chave de cada
vigência e compara com a que está na coluna, abortando a transação inteira se
alguma divergir. `CREATE OR REPLACE` substitui no lugar — o OID não muda, e a
expressão gravada da coluna gerada guarda o OID, não o nome —, de modo que
nenhuma linha é reescrita e nenhum índice é refeito.

Como a `0018`, ela vale para os dois lados: onde as funções já estão pinadas,
confere e não faz nada.

Migration já aplicada não se reescreve por conveniência — o registro em
`drizzle.__drizzle_migrations` é por carimbo (`when`), então um arquivo editado
não roda de novo em quem já o aplicou, e os dois ambientes passam a ter
histórias diferentes. As exceções são as correções de segurança que **não mudam
o resultado final** em quem já rodou, como a reentrância da `0015`.
