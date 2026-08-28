/**
 * MODO MONITORAMENTO — o coletor, e nada além dele.
 *
 * O que existe aqui: o contrato de uma medição, o registro que diz quem responde
 * por qual chave, a colheita que sobrevive a um coletor quebrado, a apuração do
 * farol por etapa e o diagnóstico de cobertura.
 *
 * O que **não** existe aqui, e é decisão e não pendência:
 *
 * - **nenhuma migration.** A colheita é feita na hora, na leitura da tela, a
 *   partir do que os coletores respondem. Uma tabela de medições seria a segunda
 *   cópia de um número que já tem dono, e teria de ser desenhada antes de existir
 *   um só coletor para dizer qual é o formato dele. O dia em que houver histórico
 *   para guardar, a tabela nasce com o caso de uso na mão;
 * - **nenhum coletor de verdade.** `coletorFixo` é o de teste. Ligar o primeiro
 *   coletor real é o passo seguinte, e agora é uma classe com três membros;
 * - **nenhuma tela e nenhum item de menu.** A regra da lateral continua valendo:
 *   nenhum item leva a lugar nenhum nem a número inventado. O Modo Monitoramento
 *   entra como sétima visualização do fluxo, e o Farol dos Processos como item
 *   de **Processos**, abaixo de Fluxos Operacionais — os dois no dia em que
 *   houver o que mostrar.
 */
export * from "./contrato";
export * from "./chaves";
export * from "./registro";
export * from "./colheita";
export * from "./farol";
export * from "./monitorar";
export * from "./cobertura";
export * from "./fixo";
