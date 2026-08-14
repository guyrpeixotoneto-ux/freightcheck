import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
      Estes testes não tocam o banco: eles cobrem a recuperação e a redação, que
      são código puro. Por isso não herdam os tempos generosos dos outros
      pacotes — um teste de busca que demora trinta segundos está quebrado, não
      lento.
    */
    testTimeout: 20_000,
  },
});
