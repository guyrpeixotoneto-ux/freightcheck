import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The acceptance suite imports a real 628 KB workbook and writes ~83k
    // facts; the default 5s timeout is not meaningful here.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Os arquivos rodam em paralelo — o `fileParallelism: false` que estava aqui
      custava mais da metade do tempo desta suíte e não protegia nada.

      A justificativa dele era "cada arquivo cria o seu banco descartável, então
      os arquivos não podem correr". A premissa não se sustenta: o pool padrão
      do vitest é `forks` com `isolate: true`, de modo que dois arquivos
      concorrentes vivem sempre em **processos** distintos; o nome do banco é
      `fc_test_<nome>_<pid>` e os 29 `<nome>` de `createTestDatabase` são
      únicos em todo o workspace. Não existe par de arquivos capaz de pedir o
      mesmo nome, com ou sem paralelismo.

      Medido nesta suíte, com cache de durações limpo — que é a condição do CI,
      onde `node_modules` nasce a cada job: 213.21s em série contra 96.91s em
      paralelo (média de três execuções, desvio de 0.91s). Os mesmos 289 testes,
      os mesmos 9 bancos, nenhum vazamento, nenhuma falha.
    */
  },
});
