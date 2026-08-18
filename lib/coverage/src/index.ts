/**
 * Cobertura de dados — a autoridade única.
 *
 * O módulo responde uma pergunta e as suas consequências:
 *
 *   > Com tudo que já importamos, quanto do universo de dados necessário nós
 *   > realmente possuímos?
 *
 * E, quando a resposta não é "tudo": o que falta, onde falta, desde quando
 * falta, por que acreditamos que falta, qual análise isso afeta e de qual
 * arquivo o dado veio ou viria.
 *
 * **Onde ele não pisa.** Importações responde "o que entrou"; Qualidade
 * responde "o que chegou com problema"; Curadoria responde "o que precisa de
 * decisão humana"; Fontes responde "de onde o dado se origina". Cobertura
 * responde apenas "o que já temos versus o que deveríamos ter" — e chama os
 * outros pelo nome quando a resposta pertence a eles.
 */
export * from "./modelo";
export * from "./contrato";
export * from "./esperado";
export * from "./observado";
export * from "./frota";
export * from "./agregado";
export * from "./descoberta";
export * from "./proveniencia";
export * from "./matriz";
export * from "./detalhe";
