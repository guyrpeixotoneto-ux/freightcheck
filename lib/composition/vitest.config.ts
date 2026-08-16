import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Aqui os arquivos continuam em fila, e a razão mudou — o mesmo caso de
      `lib/dre`, ver o comentário de lá.

      A justificativa herdada ("cada arquivo cria o seu banco, então não podem
      correr") é falsa e foi descartada por medição. O que sustenta a fila agora
      é que o ganho não existe: 33.11s em série contra 30.93s em paralelo, uma
      diferença dentro do ruído da bancada. `composicao-real` responde por 27.5s
      dos 33s, e 24.5s dele são `beforeAll`.

      Um worker só aqui devolve CPU para os pacotes que rodam junto. Remedir
      quando o preparo daquele arquivo mudar.
    */
    fileParallelism: false,
  },
});
