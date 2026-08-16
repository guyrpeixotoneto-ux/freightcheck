import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Os arquivos rodam em paralelo — ver `lib/ingest/vitest.config.ts` para por
      que o `fileParallelism: false` que estava aqui não protegia nada.

      O ganho é menor que nos outros: 59.33s em série contra 46.59s em paralelo,
      com os mesmos 16 testes. São dois arquivos, e `balanco-real` sozinho leva
      57s — 39s deles em `beforeAll`. Paralelizar arquivos não encurta o arquivo
      mais longo; aqui ele só deixa de esperar o `perdas` terminar. O resto
      depende de o preparo daquele arquivo ficar mais barato.
    */
  },
});
