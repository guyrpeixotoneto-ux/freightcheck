import { defineConfig } from "vitest/config";

/** Os mesmos limites de `lib/fluxos`: a bateria cria um banco descartável. */
export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
