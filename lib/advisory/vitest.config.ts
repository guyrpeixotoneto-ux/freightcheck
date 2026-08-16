import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // A suíte é de função pura — sem banco, sem preparo, sem arquivo pesado.
    // Não há razão para serializar arquivos aqui.
    testTimeout: 30_000,
  },
});
