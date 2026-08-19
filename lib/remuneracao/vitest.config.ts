import { defineConfig } from "vitest/config";

/**
 * Os limites de tempo desta suíte — os mesmos dos nove pacotes que falam com o
 * banco.
 *
 * Este arquivo nasceu de uma reprovação de CI, e a medição fica escrita porque
 * ela é o argumento. Em 19/08/2026 o shard `unit` reprovou com **os 73 testes
 * passando**:
 *
 *     FAIL src/__tests__/leitura.test.ts
 *     Error: Hook timed out in 10000ms.
 *       169| afterAll(async () => {
 *       170|   await ctx?.drop();
 *
 * Quem estourou foi o teardown. `ctx.drop()` é um `DROP DATABASE`, e no mesmo
 * job o Postgres do runner registrou um checkpoint de 8,166s (`sync files=3933`)
 * — com o disco nessa condição, derrubar o banco não cabe nos 10 s que o vitest
 * dá a um hook por padrão.
 *
 * O padrão só valia aqui porque **este pacote não tinha config nenhuma**,
 * enquanto `assistant`, `balance`, `comparison`, `composition`, `coverage`,
 * `curation`, `db`, `dre` e `ingest` — todos os outros que criam banco de teste
 * — declaram `hookTimeout: 300_000`. A falta era a exceção, não a regra, e ela
 * se manifestava de um jeito que esconde a causa: o `beforeAll` de
 * `leitura.test.ts` já carregava um `}, 300_000)` escrito à mão, o que fazia o
 * preparo passar e deixava só o desmonte exposto — o hook que ninguém anota.
 *
 * `testTimeout` acompanha pelo mesmo motivo: as suítes daqui montam a base real
 * antes de perguntar qualquer coisa, e um teste que faz isso não se compara com
 * os 5 s de um teste puro.
 *
 * Sem `fileParallelism: false`: cada arquivo já vive no seu processo (pool
 * `forks`) e pede um banco cujo nome carrega o PID, então eles não disputam
 * nada. Os cinco arquivos deste pacote somam 22 s em paralelo, e serializá-los
 * seria devolver tempo sem comprar segurança nenhuma.
 */
export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
