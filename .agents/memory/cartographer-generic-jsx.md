---
name: Cartographer and generic JSX
description: Replit's visual metadata transform can make explicit generic arguments on JSX component calls fail in development.
---

Avoid explicit type arguments on JSX component invocations in the web artifact when TypeScript can infer the generic from props.

**Why:** Production Vite builds accepted the TSX, but the development metadata transform injected syntax that made Babel report `Unexpected token`, leaving the app behind a Vite error overlay.

**How to apply:** Prefer `<Component ... />` over `<Component<Type> ... />`; preserve type safety through typed props, callbacks, or a non-JSX wrapper when inference is insufficient.