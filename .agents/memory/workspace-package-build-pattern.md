---
name: Workspace package esbuild resolution pattern
description: Why new workspace packages must be declared as direct deps of api-server, not just transitive ones, for the esbuild bundle step to succeed.
---

# esbuild can't resolve transitive workspace deps

**Rule:** Every `@workspace/*` package that is transitively imported by `artifacts/api-server` (even through `@workspace/assistant` or another lib) must be listed as a **direct** dependency in `artifacts/api-server/package.json`. Adding it only to the intermediate lib's `package.json` is not enough.

**Why:** esbuild resolves imports relative to the source file being bundled. When it follows the chain `api-server → lib/assistant/src/corpus.ts → @workspace/knowledge`, it looks for `knowledge` in `lib/assistant/node_modules/@workspace/knowledge`. That symlink may exist locally (after `pnpm install`), but the production build environment runs a clean `pnpm install` — and pnpm only creates symlinks for **direct** workspace deps in each package's `node_modules`. Transitive workspace-to-workspace links are placed in the declaring package's `node_modules`, not hoisted.

**How to apply:** Any time a task agent adds a new `lib/*` package that `api-server` (or any artifact) imports through a chain, also add it to the artifact's `package.json` directly and commit the updated lockfile. Then run `pnpm install` locally to verify the symlink appears in `artifacts/api-server/node_modules/@workspace/`.

**Symptom:** Build fails with `Could not resolve "@workspace/<name>"` pointing to a file inside `lib/`, not inside `artifacts/`.

**Recurring pattern:** This happened twice in the same session — first with `@workspace/assistant`, then with `@workspace/knowledge`. Expect it again whenever a task agent adds a new lib package.
