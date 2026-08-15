import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada arquivo cria e migra bancos próprios; migrar quinze migrations
    // algumas vezes não cabe no timeout padrão de 5s.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // Os bancos são criados por nome; rodar em paralelo os faria disputar.
    fileParallelism: false,
  },
});
