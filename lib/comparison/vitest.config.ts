import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Os arquivos rodam em paralelo. O `fileParallelism: false` que estava aqui
      foi copiado de `lib/ingest` junto com a suíte, e com ele veio uma
      justificativa que não se aplica: arquivos concorrentes vivem em processos
      distintos (pool `forks`, `isolate: true`), e cada um pede o seu banco por
      um nome único no workspace, sufixado pelo PID.

      É o maior ganho medido do repositório: 201.78s em série contra 80.60s em
      paralelo, com os mesmos 223 testes, os mesmos 11 bancos e nenhum
      vazamento. A suíte tem quinze arquivos e quatro deles reconstroem a mesma
      base real — enquanto essa duplicação existir, rodá-los ao mesmo tempo é o
      que há.
    */
  },
});
