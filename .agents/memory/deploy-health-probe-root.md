---
name: Deploy health probe hits service root
description: Replit's promote-step probe hits the artifact service's path root (e.g. GET /api), not only the configured health.startup path.
---

The Replit deployer probes the service's routing path root (`GET /api`) before promoting a build — in addition to (or regardless of) `[services.production.health.startup].path` in artifact.toml. Any non-200 there (401 from an auth gate, 404) fails the whole publish at "Creating Autoscale service".

**Why:** A publish failed with build success but promote failure; runtime logs showed `healthcheck /api returned status 500/401` while `/api/healthz` was 200.

**How to apply:** Every API service must answer 200 unauthenticated at its mount root. In api-server this is the `/` entry in PUBLIC_PATHS (lib/auth.ts) plus the root liveness route in routes/index.ts — don't remove them.
