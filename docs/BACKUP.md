# Backup e restauração

O dado deste produto — decisão humana em registro append-only, evidência RAW
imutável — vivia numa cópia só: o Postgres da plataforma. O Provision de
17/08/2026 provou o custo disso. Este documento é o caminho da segunda cópia, e
da volta.

## O que existe

- **`lib/db/src/backup.ts`** — `pg_dump -Fc` (schema + dados + funções +
  triggers + views), escrita em duas etapas (`.parcial` → nome final), poda por
  retenção (14 por padrão).
- **Agendador** (`artifacts/api-server/src/lib/backup-agendado.ts`) — com
  `BACKUP_DIR` definido, toda partida e toda hora conferem a idade do último
  dump; passou de `BACKUP_INTERVALO_HORAS` (24 por padrão), um novo é feito.
  A partida entra na conta porque em autoscale um timer só vive enquanto a
  instância vive.
- **`/api/healthz`** publica `backup: { configurado, ultimo, idadeHoras,
  atrasado }` — nunca o caminho. Cópia atrasada é observável de fora antes de
  fazer falta.
- **CLI** (`lib/db`):
  - `BACKUP_DIR=… DATABASE_URL=… pnpm --filter @workspace/db run backup`
  - `BACKUP_DIR=… pnpm --filter @workspace/db run backup:listar`
  - `DATABASE_URL=<banco novo e VAZIO> pnpm --filter @workspace/db run backup:restaurar -- <arquivo>`

## O contrato operacional

1. **`BACKUP_DIR` precisa apontar para armazenamento durável.** Num deployment
   autoscale o disco local é efêmero — um dump nele morre com a instância.
   Aponte para um volume montado, um bucket com montagem de arquivo, ou o disco
   de uma VM reservada. Sem `BACKUP_DIR` em produção, o boot avisa alto que o
   ambiente roda com uma cópia só.
2. **RPO = `BACKUP_INTERVALO_HORAS`** (24h por padrão). O que aconteceu depois
   do último dump se perde num desastre — encurte o intervalo se isso doer.
3. **Restauração é sempre em banco novo e vazio.** `restaurarBackup` se recusa
   a limpar um banco vivo: crie um banco, restaure nele, confira pelas telas ou
   pelo `/api/healthz`, e só então troque a `DATABASE_URL` do deployment.
   Decidir o destino do banco antigo é ato de gente, com o dado à vista.

## A prova

`lib/db/src/__tests__/backup-restore.test.ts` roda o ciclo inteiro em CI:
migra → escreve (inclusive bytea) → dump → restore em banco vazio → confere
linhas, bytes, funções, o registro de migrations e o trigger de imutabilidade
funcionando no banco restaurado.

Foi essa prova que pegou o defeito da `0036`: as funções da identidade
canônica chamavam funções irmãs sem schema, o `pg_restore` roda com
`search_path` vazio, e o COPY de `snapshot` morria avaliando a coluna gerada —
ou seja, **nenhum backup anterior à `0036` era restaurável por caminho
padrão**. Um backup que nunca voltou é fé, não cópia; a prova existe para essa
classe de defeito não voltar.
