import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Os testes da interface cobrem o que é **lógica**, não o que é pixel.
 *
 * O que a tela do Acompanhamento decide sozinha — quais itens entram no
 * recorte, quantos cada filtro entrega, com que grupo cada item da fila se
 * junta — mora em `src/lib/cockpit.ts` como função pura, e é isso que roda
 * aqui. A criticidade, a ordem e o diagnóstico não estão neste pacote: vêm de
 * `@workspace/comparison`, e são testados lá contra o export real.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
