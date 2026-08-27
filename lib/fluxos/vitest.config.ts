import { defineConfig } from "vitest/config";

/**
 * Os mesmos limites dos onze pacotes que falam com o banco.
 *
 * Metade desta bateria é função pura — catálogo, validação, layout, o endereço
 * de uma ação — e roda em milissegundos. A outra metade cria um banco
 * descartável a partir das migrations para provar o isolamento entre empresas,
 * e um `DROP DATABASE` com o disco ocupado não cabe nos 10s que o vitest dá a
 * um hook por padrão. Ver `lib/fechamento/vitest.config.ts`, onde essa lição
 * está escrita.
 */
export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
