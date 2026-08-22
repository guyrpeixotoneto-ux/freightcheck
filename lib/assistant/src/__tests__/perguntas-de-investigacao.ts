/**
 * As 78 perguntas do diagnóstico, e a bateria funda de investigação.
 *
 * **Por que elas ficam num arquivo do repositório.** Elas foram escritas
 * durante o diagnóstico e mediram o "antes"; guardá-las fora do código faria a
 * comparação antes × depois depender de um arquivo de rascunho que ninguém
 * versionou. Uma medida cuja linha de base não é versionada é uma medida que
 * não se pode refazer.
 *
 * **O que este arquivo não é.** Não é gabarito. Nenhuma resposta esperada está
 * escrita aqui, e nenhuma pergunta daqui é tratada de forma especial por
 * nenhuma parte do produto — a busca por qualquer uma destas frases no resto do
 * código não encontra nada. Elas são entrada de medição, e só.
 */

/** As 78 perguntas do diagnóstico, por família. */
export const DIAGNOSTICO: Record<string, readonly string[]> = {
  explicacao: [
    "O que é o Book do Operador?",
    "Como funciona o preço de combustível?",
    "Me explique como funciona essa verba.",
    "Explique isso como se eu não entendesse nada de remuneração.",
    "Agora explique tecnicamente.",
    "O que significa semântica não confirmada?",
  ],
  remuneracao: [
    "Qual a composição da remuneração do cavalo ABC1D23?",
    "Quais verbas compõem a remuneração?",
    "Quanto a frota de cavalos rende por mês?",
    "Quais são os custos fixos do cavalo?",
    "E os custos variáveis?",
  ],
  regra: [
    "Qual regra está sendo usada?",
    "Essa regra mudou?",
    "O que o Book diz sobre IPVA?",
    "Qual a periodicidade da auditoria QLP ADM?",
  ],
  alteracao: [
    "O que mudou?",
    "O que mudou nos cavalos?",
    "Liste as alterações",
    "Liste as alterações dos cavalos",
    "Teve alteração na remuneração?",
    "Quantas alterações houve nesta vigência?",
  ],
  vigencia: [
    "Quais vigências existem?",
    "Desde quando?",
    "Que regra estava vigente antes?",
    "Qual está vigente agora?",
    "A partir de quando essa mudança vale?",
  ],
  veiculo: [
    "Quais veículos foram afetados?",
    "Quais veículos usam essa regra?",
    "Quantos cavalos foram atingidos?",
    "O que mudou na placa ABC1D23?",
  ],
  impacto: [
    "Qual mudança teve maior impacto financeiro?",
    "Onde perdemos mais dinheiro?",
    "O que mais impactou negativamente nesta vigência?",
    "Quanto essa alteração representa por mês e por ano?",
    "Existe alguma mudança que está me fazendo perder dinheiro?",
  ],
  comparacao: [
    "O que mudou entre julho e agosto?",
    "Compare julho com agosto",
    "Por que minha remuneração mudou de julho para agosto?",
    "Compare esta vigência com a anterior",
  ],
  fechamento: [
    "Como ficou o fechamento da segunda quinzena de agosto?",
    "Quanto a Ambev demonstrou pagar nessa competência?",
    "O valor demonstrado pela Ambev bate com o que deveria ser pago?",
    "Quais divergências apareceram na conciliação?",
    "Qual o total de descontos da quinzena?",
  ],
  documento: [
    "Qual documento trouxe esse valor?",
    "Quais documentos comprovam isso?",
    "De qual arquivo veio o seguro da placa ABC1D23?",
  ],
  divergencia: [
    "Existe alguma inconsistência nesse fechamento?",
    "Onde está a diferença?",
    "Há veículos sem preço apurado?",
  ],
  auditoria: [
    "Me mostre o cálculo.",
    "Tem certeza?",
    "Quais são suas evidências?",
    "De onde saiu esse R$ 327.503,60?",
    "Quais informações ainda faltam para você concluir o impacto total?",
  ],
  historico: [
    "Quais foram as 10 alterações mais relevantes dos últimos 12 meses?",
    "Como o IPVA andou ao longo do ano?",
    "Monte a série histórica do consumo",
  ],
  gestao: [
    "Resuma agosto para a diretoria",
    "O que eu deveria investigar primeiro?",
    "Quais parâmetros eu deveria discutir com o cliente?",
    "Esse aumento de combustível é bom ou ruim para mim?",
  ],
  investigacao: [
    "Por que a remuneração caiu este mês?",
    "Por que o valor está diferente?",
    "Investigue por que o impacto caiu e me diga em quais veículos",
    "Por quê?",
  ],
  conversa: [
    "Só Camaçari.",
    "E somente cavalos.",
    "Qual teve maior perda?",
    "Me mostre os 5 seguintes.",
  ],
  calculo: [
    "Me dá a média mensal de impacto por veículo desta vigência",
    "Converte esse impacto mensal para anual, por favor",
  ],
  adversarial: [
    "O que mudou em fevereiro de 1998?",
    "Quanto mudou o pedágio?",
    "O que mudou na placa ZZZ9Z99?",
    "O que mudou em Xique-Xique?",
    "Qual o QLP administrativo desta unidade?",
    "E se eu tirar o FINAME, quanto muda?",
  ],
};

/** Todas elas, achatadas — a ordem é a do diagnóstico. */
export const CASOS_DO_DIAGNOSTICO: readonly string[] = Object.values(DIAGNOSTICO).flat();

/**
 * A bateria funda — menor, e feita para exigir mudança de granularidade.
 *
 * **O que a distingue das 78.** As 78 medem cobertura: perguntas de todo tipo,
 * uma consulta cada. Estas nove medem **profundidade**: cada uma só se responde
 * bem descendo de um nível para o outro — do agregado ao grupo, do grupo à
 * linha, da linha ao fato, do fato à célula da planilha. Uma resposta certa aqui
 * com uma consulta só é uma resposta que não desceu.
 *
 * **`encadeamentosMinimos` é a régua, e ela não é sobre número de consultas.**
 * Ver `encadeamento.ts`: um encadeamento é uma consulta cujo argumento **não
 * existia** antes de outra voltar. Três consultas disparadas juntas contam zero.
 */
export interface CasoDeInvestigacao {
  pergunta: string;
  /** Quantas consultas têm de ter reagido a um resultado anterior. */
  encadeamentosMinimos: number;
  /** O que uma boa resposta alcança — para quem lê o relatório. */
  esperado: string;
}

export const INVESTIGACAO: readonly CasoDeInvestigacao[] = [
  {
    pergunta: "Por que a remuneração caiu?",
    encadeamentosMinimos: 2,
    esperado:
      "Desce do total ao grupo que mais pesou, e desse grupo aos veículos que o compõem.",
  },
  {
    pergunta: "O que mais impactou negativamente nesta vigência?",
    encadeamentosMinimos: 2,
    esperado: "Nomeia o grupo de maior impacto negativo e abre as linhas dele.",
  },
  {
    pergunta: "Qual foi a principal causa da queda?",
    encadeamentosMinimos: 2,
    esperado: "Aponta a causa com o valor dela e o que a sustenta, não o agregado.",
  },
  {
    pergunta: "Quais veículos explicam essa queda?",
    encadeamentosMinimos: 2,
    esperado: "Placas do grupo que puxou a queda — não os veículos com mais alterações.",
  },
  {
    pergunta: "O que mudou nesses veículos?",
    encadeamentosMinimos: 2,
    esperado: "O par antes → depois de cada linha, no grupo em foco.",
  },
  {
    pergunta: "Qual dessas alterações teve maior impacto?",
    encadeamentosMinimos: 2,
    esperado: "Ordena por impacto dentro do que já foi aberto, e não recomeça do agregado.",
  },
  {
    pergunta: "De onde saiu esse valor?",
    encadeamentosMinimos: 2,
    esperado: "Chega ao arquivo, à aba, à linha e à coluna que originaram o número.",
  },
  {
    pergunta: "O que eu deveria investigar primeiro nesta vigência?",
    encadeamentosMinimos: 2,
    esperado: "Fila com critério declarado, e o detalhe do primeiro da fila.",
  },
  {
    pergunta: "Tem alguma coisa fora do padrão aqui?",
    encadeamentosMinimos: 2,
    esperado: "Candidatos com o motivo de cada um, descendo ao que os põe na lista.",
  },
];
