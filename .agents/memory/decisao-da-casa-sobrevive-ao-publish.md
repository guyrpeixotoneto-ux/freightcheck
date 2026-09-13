---
name: The house's module decision survives Publish by a mirror outside `public`
description: modulo_universal and modulo_universal_evento are restored at startup from drizzle.*__casa; never "fix" a re-enabled menu by writing rows by hand or by adding a default.
---

**Symptom whenever this breaks:** an administrator turns modules or work environments off in Configurações → Módulos Universais, the screen confirms it with author and timestamp, and some time later everything is back on with nobody having touched it.

**Root cause, unchanged across three incidents:** Replit's Publish diffs the *live* development schema against production. When development trails the versioned queue, the proposal removes from production what only production has — including the columns, indexes and primary keys of `modulo_universal` and `modulo_universal_evento`. That DDL runs outside the migration queue and takes the rows with it. The next startup finds the journal intact, concludes nothing is pending, and `reconvergencia` recreates the structure **empty**. Empty, in this layer, means "everything on".

**Why the earlier fixes were not enough:** `bridge-guarda.ts` protects the rows across the bridge's own down/up cycle, not across Publish. `problemaDaPublicacao` and `.github/workflows/publicacao.yml` *detect* the destructive proposal, but nothing forces anyone to look before pressing Publish.

**The structural defense (do not remove):** `lib/db/src/decisao-da-casa.ts` keeps a mirror of both tables in the `drizzle` schema — the schema Publish never introspects — refreshed inside the same transaction that writes every decision (`definirModulosUniversais`). At startup, `artifacts/api-server/src/index.ts` calls `protegerDecisaoDaCasaNoBanco`, which restores the rows if and only if **both** public tables are empty while the mirror has rows. That combination cannot be produced by the product: re-enabling everything empties `modulo_universal` but never the append-only event table.

**How to apply:** `public.modulo_universal` stays the only source of truth for every read. Never resolve a re-enabled menu by inserting rows by hand, by defaulting a missing row to disabled, or by caching the state in the browser. If the startup alert `DECISAO_DA_CASA_REPOSTA` fires, something ran destructive DDL outside the queue — run `pnpm --filter @workspace/db run publicar:conferir` before the next Publish and make development converge first.
