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

Migration já aplicada não se reescreve por conveniência — o registro em
`drizzle.__drizzle_migrations` é por carimbo (`when`), então um arquivo editado
não roda de novo em quem já o aplicou, e os dois ambientes passam a ter
histórias diferentes. As exceções são as correções de segurança que **não mudam
o resultado final** em quem já rodou, como a reentrância da `0015`.
