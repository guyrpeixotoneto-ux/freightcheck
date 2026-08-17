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
  /*
    O mesmo runtime de JSX que o app usa — `@vitejs/plugin-react` em
    `vite.config.ts` é automático, e aqui o padrão do esbuild é o clássico, que
    compila para `React.createElement` sem importar React.

    A diferença só aparecia quando um módulo avaliava JSX no topo, e não dentro
    de uma função: um `Record<Corte, React.ReactNode>` em escopo de módulo
    derrubava o arquivo inteiro com `React is not defined` no import — o que
    tornava as funções puras de um componente intestáveis por acidente de onde a
    constante estava escrita, e não por serem impuras.
  */
  esbuild: { jsx: "automatic" },
});
