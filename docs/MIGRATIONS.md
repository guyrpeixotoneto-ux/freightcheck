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
`lib/db/drizzle-kit.config.ts`, antes de abrir conexão. `generate`, `check` e
`up` continuam liberados: eles mexem em arquivo do repositório, que é onde a
decisão de schema é tomada e revisada.

**A configuração não se chama `drizzle.config.ts`, e o nome é o ponto.** O
Publishing decide que um projeto "usa Drizzle" procurando por esse nome; achando
um, ele acrescenta ao deploy um passo próprio de migração de schema — derivado
do `schema.ts`, aplicado direto em produção, sem passar pela configuração e
portanto sem esbarrar nas proibições acima. Aqui esse passo não tinha como
funcionar: `snapshot.canonical_snapshot_key` é gerada por
`freightcheck_snapshot_key(...)`, o drizzle modela a coluna e não a função, e o
DDL dele morria em

```
ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
  GENERATED ALWAYS AS (freightcheck_snapshot_key(...)) STORED;
ERROR: function freightcheck_snapshot_key(text, text, text, date, jsonb) does not exist
```

com a tela oferecendo, como saída, copiar o banco de desenvolvimento por cima do
de produção. Com o arquivo fora do nome procurado, o passo não é montado. O
`generate` continua inteiro: o `package.json` o chama com `--config` explícito.

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

O que ela mostra, porém, é informação boa de graça: a lista de diferenças diz o
que o **schema** de produção tem, que é outra pergunta. Uma pergunta sobre
`ticket` perdendo `parameter_label`, `attribute_code`, `requested_value_*`,
`applied_value_*` e `impact_*` e ganhando `changed_parameter_count` é a `0013`
inteira — o schema de lá é anterior a ela.

Isso **não** diz em que migration produção está: o registro é o que responde
isso, e ele pode estar vazio com o schema inteiro de pé (foi o caso em
15/08/2026 — ver a seção seguinte). As duas conferências, somente leitura:

```sql
-- o registro
SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
```

De fora, sem credencial, `/api/healthz` responde o mesmo em `database.migrations`
— `applied`, `pending` pelo nome, e onde a última tentativa parou. Se a
publicação estiver atrás de um gate de autenticação, o `curl` leva 307 e o
navegador logado não.

## Um banco que tem o schema e não tem o registro

Acontece: `drizzle.__drizzle_migrations` vazio num banco inteiro de pé. Foi o
estado de produção em 15/08/2026 — `/api/healthz` respondendo `applied: 0` com
todas as telas funcionando.

Isso **não trava mais a fila**. Toda migration, da `0000` à `0019`, atravessa um
banco que já a contém: tipo, tabela, índice, coluna, constraint e gatilho são
procurados antes de criados, e o que já está lá é deixado como está. Rodar a
fila sobre um banco existente é trabalho repetido, não erro — o servidor faz
isso sozinho na partida e o registro se recompõe.

O que a reentrância **não** faz é inventar backfill. Uma migration que converte
dado roda o `UPDATE` de novo; todos eles são escritos com `WHERE` que os torna
inócuos quando o dado já está convertido, e é isso que os testes de
`registro-perdido.test.ts` e `canonical-identity-migration.test.ts` prendem.

`migrate:adotar` continua existindo para o caso oposto — quando se quer
**registrar sem rodar**, por saber que aquele estado já foi alcançado. É
declaração de quem opera, não conserto de partida, e não é mais pré-requisito
para destravar nada.

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

Migration já aplicada não se reescreve por conveniência — o registro em
`drizzle.__drizzle_migrations` é por carimbo (`when`), então um arquivo editado
não roda de novo em quem já o aplicou, e os dois ambientes passam a ter
histórias diferentes. As exceções são as correções de segurança que **não mudam
o resultado final** em quem já rodou, como a reentrância da `0015`.
