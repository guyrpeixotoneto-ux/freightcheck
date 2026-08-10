#!/bin/bash
set -e

# Dependências entre pacotes do workspace mudam sem que o package.json da raiz
# mude, então o install roda sempre.
pnpm install --frozen-lockfile

# `drizzle-kit push` não é usado neste projeto: ele difere contra o estado vivo
# do banco, o que deixaria a deriva de um ambiente virar schema sem migration.
# Ver o comentário em lib/db/src/migrate.ts.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/db run migrate
else
  echo "post-merge: DATABASE_URL não definido; migrations não aplicadas."
fi
