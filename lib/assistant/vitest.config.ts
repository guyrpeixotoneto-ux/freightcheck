import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
      A recuperação e a redação são código puro, e um teste de busca que demora
      trinta segundos está quebrado, não lento. Por isso o teto por teste é
      curto: ele existe para reprovar lentidão, não para tolerá-la.
    */
    testTimeout: 20_000,
    /*
      Os `beforeAll`, não. Quatro arquivos desta suíte falam com o banco de
      avaliação, e o do benchmark faz ali dentro o trabalho todo: 103
      orquestrações, uma por pergunta, antes que o primeiro `it` rode. Isso não
      é um hook de preparo demorando demais — é a medição inteira, e ela leva o
      que leva.

      O padrão do vitest são 10 segundos, e o CI mostrou onde isso encosta: o
      mesmo arquivo passou no passo de testes e reprovou no passo do benchmark,
      na mesma execução, com `Hook timed out in 10000ms`. Um limite que decide
      por milissegundos de diferença não está medindo nada — só produz vermelho
      alternado.
    */
    hookTimeout: 300_000,
  },
});
