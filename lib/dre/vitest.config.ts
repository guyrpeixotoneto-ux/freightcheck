import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000,
    hookTimeout: 300_000,
    /*
      Aqui os arquivos continuam em fila, e a razão mudou.

      A antiga era herdada de `lib/ingest` — "cada arquivo cria o seu banco,
      então não podem correr" —, e ela é falsa: o pool `forks` põe cada arquivo
      no seu processo e o nome do banco carrega o PID. Foi medida e descartada.

      A razão de agora é que paralelizar **não adianta nesta suíte**: 29.17s em
      série contra 29.59s em paralelo, ou seja, nada. Dos seis arquivos, só
      `dre-real` pesa (25.3s, dos quais 23.9s são `beforeAll`), e os outros
      cinco somam menos de um segundo. Paralelismo de arquivos não encurta o
      arquivo mais longo.

      Manter um worker aqui não custa tempo e devolve CPU aos pacotes que rodam
      ao mesmo tempo que este. Quando o preparo de `dre-real` deixar de
      reconstruir a base do zero, esta decisão precisa ser medida de novo.
    */
    fileParallelism: false,
  },
});
