---
name: Publish owns production schema
description: Production startup must not run migrations or reconciliation DDL because Replit Publish already owns schema changes.
---

Keep production application startup free of schema-changing work. Let the normal Replit Publish flow apply the development-to-production schema diff, and make HTTP readiness independent of database migrations.

**Why:** A publish built successfully but failed readiness while production startup was running the project’s migration/reconciliation worker. The container logs showed repeated health-check failures and a PostgreSQL error during that startup window.

**How to apply:** Explicitly disable startup migrations in the production artifact, apply committed migrations to development through the normal development flow, confirm the Publish schema diff, and then publish.