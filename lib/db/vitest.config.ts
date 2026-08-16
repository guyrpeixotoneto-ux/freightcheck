import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada arquivo cria e migra bancos próprios; migrar quinze migrations
    // algumas vezes não cabe no timeout padrão de 5s.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Os arquivos rodam em paralelo. "Os bancos são criados por nome; rodar em
      paralelo os faria disputar" era a justificativa do `fileParallelism:
      false`, e ela descreve um perigo que não existe: com o pool `forks` e
      `isolate: true`, arquivos concorrentes estão em processos diferentes, e
      todo nome daqui carrega o PID (`fc_bridge_<pid>_N`, `fc_mig_<pid>_N`,
      `fc_meta_<pid>_N`). Dois arquivos não conseguem colidir.

      Esta é a suíte que mais cria bancos — 59 numa execução, contados por dois
      métodos independentes — e por isso era a mais temida. Medida: 40.34s em
      série contra 18.37s em paralelo, com os mesmos 66 testes, os mesmos 59
      bancos e nenhum vazamento.
    */
  },
});
