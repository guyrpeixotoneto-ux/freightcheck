#!/bin/bash
set -e

# Dependências entre pacotes do workspace mudam sem que o package.json da raiz
# mude, então o install roda sempre.
pnpm install --force

# Migrations rodam aqui, e isso é reversão medida de uma escolha anterior.
#
# A regra "Development só avança à mão" existiu para não fabricar diff no
# Publishing enquanto Production estava atrás (era do bridge). Production
# alcançou a cabeça da fila, e a mesma regra passou a produzir o estado
# inverso — Development atrás faz o Provision propor **remover** de Production
# o que as migrations criaram, e foi o que destruiu dado real em 17 e
# 18/08/2026. Os dois sentidos não se equivalem: Development à frente produz
# proposta aditiva (pior caso: deploy recusado); Development atrás produz
# proposta destrutiva (pior caso: perda de decisão humana). Convergir aqui, no
# merge, elimina o sentido destrutivo por construção. Ver docs/MIGRATIONS.md.
#
# `drizzle-kit push` continua nunca sendo usado: a fila versionada é a única
# autoridade, e ela é idempotente e protegida por advisory lock — rodá-la num
# banco em dia não faz nada.
if [ -n "$DATABASE_URL" ]; then
  echo "post-merge: aplicando a fila versionada ao banco de desenvolvimento…"
  pnpm --filter @workspace/db run migrate
else
  echo "post-merge: DATABASE_URL ausente — nada a migrar aqui."
  echo "post-merge: para aplicar à mão: pnpm --filter @workspace/db run migrate"
fi
