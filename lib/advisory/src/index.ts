/**
 * A aba Cliente — **o que levar ao cliente, e o que não levar**.
 *
 * O pacote responde uma pergunta e as consequências dela: *de tudo que mudou,
 * o que faz sentido propor que o Freightec ajuste?* A resposta honesta sobre o
 * export real é curta — na maior parte das linhas, nada —, e é justamente por
 * isso que o pacote existe separado da aba Impacto: uma tela que listasse tudo
 * que caiu proporia recompor financiamentos quitados e rejuvenescer caminhões.
 *
 * A divisão de trabalho, que nenhum arquivo daqui pode romper:
 *
 * - **`@workspace/comparison`** apura o que mudou e quanto — sob o portão de
 *   semântica, com preço já separado de tamanho de frota.
 * - **`@workspace/knowledge`** declara o comportamento econômico: para que lado
 *   a remuneração vai quando o parâmetro se move, e se cabe pedir alguma coisa.
 * - **este pacote** decide o que dizer, e ordena por prioridade econômica.
 *
 * Nenhum número financeiro nasce aqui.
 */

export * from "./recomendacao";
export * from "./transicoes";
export * from "./motor";
