---
name: Development schema must not trail production
description: Publish diffs the live development schema against production, so unapplied development migrations can appear as destructive production removals.
---

Before publishing, ensure every committed versioned migration has been applied to the development database. The Publish diff uses the actual development database schema, not the migration files or TypeScript schema declarations.

**Why:** Production had already received newer versioned migrations while development remained several migrations behind. Publish therefore proposed dropping the newer production tables, columns, and foreign keys. Validation then failed while trying to drop a dependency that another generated statement had already removed through `CASCADE`.

**How to apply:** Compare the migration ledger in development and production, apply pending migrations only to development through the normal migration command, then recompute the Publish schema diff. Proceed only when removals and structural-loss warnings disappear.