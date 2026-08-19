import { defineConfig } from "vitest/config";

/**
 * Os limites de tempo desta suíte — os mesmos dos dez pacotes que falam com o
 * banco.
 *
 * Este arquivo fecha a varredura que `lib/remuneracao/vitest.config.ts` começou
 * em 19/08/2026, e a fecha porque a mesma falha voltou pelo último pacote que
 * tinha ficado de fora. O shard `unit` reprovou com **os 57 testes passando**:
 *
 *     FAIL src/__tests__/persistencia.test.ts
 *     Error: Hook timed out in 10000ms.
 *       95| afterAll(async () => {
 *       96|   await pool?.end().catch(() => {});
 *       97|   const admin = new pg.Pool({ connectionString: ADMIN });
 *
 * Quem estourou foi o desmonte, e a assinatura é idêntica à daquele commit: o
 * `afterAll` faz `DROP DATABASE`, e derrubar um banco com o disco do runner
 * ocupado não cabe nos 10 s que o vitest dá a um hook por padrão.
 *
 * **A falta era a exceção, não a regra.** `advisory`, `assistant`, `balance`,
 * `comparison`, `composition`, `coverage`, `curation`, `db`, `dre`, `ingest` e
 * `remuneracao` já declaravam `hookTimeout: 300_000`; este pacote não tinha
 * config nenhuma. E o defeito se escondia do mesmo jeito de lá: o `beforeAll`
 * de `persistencia.test.ts` carrega um `}, 120_000)` escrito à mão, o que faz o
 * preparo passar e deixa exposto só o desmonte — o hook que ninguém anota.
 *
 * Escrever o limite aqui, e não como terceiro argumento do `afterAll`, é o que
 * mantém a regra no lugar em que ela vale para o arquivo inteiro: um teste novo
 * que crie o seu próprio banco nasce coberto, em vez de nascer com a mesma
 * armadilha esperando a próxima tarde de disco ocupado.
 *
 * `testTimeout` acompanha pelo mesmo motivo dos outros: as suítes daqui montam
 * a base real antes de perguntar qualquer coisa, e um teste que faz isso não se
 * compara com os 5 s de um teste puro.
 */
export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
