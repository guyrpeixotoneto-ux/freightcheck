import { defineConfig } from "vitest/config";

/**
 * Os limites de tempo desta suíte — os mesmos dos outros pacotes que falam com
 * o banco.
 *
 * Este arquivo dizia, em duas linhas, que a suíte era "de função pura — sem
 * banco, sem preparo, sem arquivo pesado". Era verdade quando foi escrito e
 * deixou de ser: `pauta-do-ativo.test.ts` monta um banco sintético descartável
 * a partir das migrations, e o `afterAll` dele derruba esse banco. O
 * `testTimeout` de 30 s ficou como estava, e o `hookTimeout` nunca foi
 * declarado — então o desmonte continuou vivendo nos 10 s que o vitest dá a um
 * hook por padrão.
 *
 * Em 20/08/2026 o shard `unit` reprovou com **os 40 testes passando**:
 *
 *     FAIL src/__tests__/pauta-do-ativo.test.ts
 *     Error: Hook timed out in 10000ms.
 *        98| afterAll(async () => {
 *        99|   await ctx?.drop();
 *
 * É a terceira vez que este mesmo descompasso aparece — `remuneracao` e
 * `fechamento` o tiveram antes, e o argumento está escrito nos dois arquivos
 * vizinhos: `ctx.drop()` é um `DROP DATABASE`, e num runner com o disco
 * ocupado ele não cabe em dez segundos. `advisory` era a exceção que faltava
 * alinhar; os 300_000 são o número que todos os outros já declaram.
 *
 * `testTimeout` acompanha pelo mesmo motivo dos outros: um teste que monta a
 * base real antes de perguntar qualquer coisa não se compara com um teste puro.
 * A metade pura desta suíte — `recomendacao.test.ts`, 28 testes em 23 ms — não
 * perde nada com isso: limite alto não torna teste lento, só deixa de reprovar
 * o que estava certo.
 *
 * Sem `fileParallelism: false`, como já era: os dois arquivos daqui não
 * disputam nada, e o que fala com banco pede um cujo nome carrega o PID.
 */
export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
