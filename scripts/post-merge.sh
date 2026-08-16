#!/bin/bash
set -e

# Dependências entre pacotes do workspace mudam sem que o package.json da raiz
# mude, então o install roda sempre.
pnpm install --force

# Migrations **não** rodam aqui, e isso é escolha.
#
# `drizzle-kit push` nunca foi usado neste projeto: ele difere contra o estado
# vivo do banco, o que deixaria a deriva de um ambiente virar schema sem
# migration. Ver o comentário em lib/db/src/migrate.ts.
#
# Mas aplicar a fila versionada automaticamente aqui tinha um custo próprio, e
# ele só ficou visível quando o Publishing começou a falhar. O passo de schema
# do Replit compara **Development com Production**; um merge que migrava o banco
# de desenvolvimento sozinho colocava Development à frente e fabricava, do nada,
# um diff que ninguém pediu — incluindo DDL destrutivo e DDL impossível (uma
# coluna gerada por função que o diff não sabe criar).
#
# A ordem correta é a inversa, e ela é deliberada: Production migra primeiro,
# por `runMigrations()` na partida do servidor; Development só depois, à mão.
# Ver docs/MIGRATIONS.md.
if [ -n "$DATABASE_URL" ]; then
  echo "post-merge: migrations NÃO aplicadas (Development só avança depois de Production)."
  echo "post-merge: para aplicar à mão: pnpm --filter @workspace/db run migrate"
fi
