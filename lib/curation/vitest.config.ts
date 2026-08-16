import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Os arquivos rodam em paralelo — ver o comentário em
      `lib/ingest/vitest.config.ts` para por que o `fileParallelism: false` que
      estava aqui não protegia nada.

      Medido: 54.05s em série contra 28.06s em paralelo, com os mesmos 45
      testes e os mesmos 2 bancos. Os dois arquivos pesados (`curation` e
      `confirmations`) importam o mesmo export real e gastam 100% do tempo em
      `beforeAll`; sobrepô-los é o único ganho disponível sem mexer no preparo.
    */
  },
});
