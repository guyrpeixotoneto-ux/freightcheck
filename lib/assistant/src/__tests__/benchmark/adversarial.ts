import type { Necessidade } from "../../plano";

/**
 * A bateria adversarial — escrita **depois** de a de 103 fechar, e por isso.
 *
 * Um benchmark que chega a 103/103 deixa de medir o produto e passa a medir a
 * si mesmo: cada correção da Fase 6 foi feita olhando para as oito perguntas
 * que faltavam, e nada nelas prova que a correção foi da *razão* e não daquelas
 * oito frases. Estas perguntas existem para responder essa dúvida, e **nenhuma
 * delas foi consultada durante a correção** — foram escritas de uma vez, depois
 * do fecho, a partir das razões e não dos casos.
 *
 * Cinco eixos, e cada um ataca uma das correções por um lado que ela não viu:
 *
 * 1. **informal** — a expansão de abreviações resolve `qnt`; e `qto`, `tb`,
 *    `pq`, a frase sem acento, sem pontuação, toda em maiúscula?
 * 2. **sinonimo** — VALOR aprendeu `preço`, `custo` e `tarifa`; o vocabulário
 *    do domínio tem mais formas de dizer a mesma coisa.
 * 3. **negativa** — MOVIMENTO aprendeu a forma de igualdade; a negação tem
 *    outras formas, e algumas invertem o sentido de novo.
 * 4. **composta** — a oração declarativa fez a pergunta de duas orações
 *    funcionar; três orações, orações em ordem invertida, e a pergunta que
 *    muda de assunto no meio.
 * 5. **fora** — o que o produto não tem. É o eixo que não pode ceder: uma
 *    resposta inventada aqui vale mais que dez acertos nos outros quatro.
 *
 * O que se mede é o mesmo do benchmark — o caminho, não a prosa. `fontes`
 * aceita qualquer uma das listadas; `proibidas` é o que **não** pode aparecer,
 * e é o que dá dente ao eixo `fora`.
 */

export type Fonte = "DADO" | "BOOK" | "CONCEITO" | "NENHUMA";

export interface CasoAdversarial {
  pergunta: string;
  eixo: "informal" | "sinonimo" | "negativa" | "composta" | "fora";
  /** A necessidade principal aceitável. Uma lista, porque há empates legítimos. */
  intencao: Necessidade[];
  fontes: Fonte[];
  /** Ferramentas que esta pergunta não pode disparar. */
  proibidas?: string[];
  /** Exige que alguma consulta tenha devolvido número. */
  exigeEvidencia?: boolean;
  nota?: string;
}

export const ADVERSARIAL: CasoAdversarial[] = [
  // ── 1. informal ───────────────────────────────────────────────────────────
  {
    pergunta: "qto foi o impacto de agosto?",
    eixo: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "PQ O PNEU MUDOU?",
    eixo: "informal",
    intencao: ["PROCEDENCIA", "CONCEITUAL", "MOVIMENTO", "EVOLUCAO"],
    fontes: ["DADO", "BOOK", "CONCEITO"],
  },
  {
    pergunta: "oq mudou esse mes",
    eixo: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "sem acento, sem pontuação",
  },
  {
    pergunta: "me diz oq mudou tb no combustivel",
    eixo: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "td bem, qnt custa o ipva?",
    eixo: "informal",
    intencao: ["VALOR"],
    fontes: ["DADO", "BOOK", "CONCEITO"],
  },
  {
    pergunta: "quais placa mudaram mais",
    eixo: "informal",
    intencao: ["VEICULOS"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "concordância errada",
  },

  // ── 2. sinônimo ───────────────────────────────────────────────────────────
  {
    pergunta: "Qual o montante do IPVA?",
    eixo: "sinonimo",
    intencao: ["VALOR", "CONCEITUAL", "DISPONIBILIDADE"],
    fontes: ["DADO", "BOOK", "CONCEITO"],
  },
  {
    pergunta: "Quanto sai o pneu por mês?",
    eixo: "sinonimo",
    intencao: ["VALOR", "MOVIMENTO", "CONCEITUAL"],
    fontes: ["DADO", "BOOK", "CONCEITO"],
  },
  {
    pergunta: "O que o contrato determina sobre manutenção?",
    eixo: "sinonimo",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
    nota: "contrato = Book",
  },
  {
    pergunta: "Que normas existem para o QLP ADM?",
    eixo: "sinonimo",
    intencao: ["BOOK", "CONCEITUAL", "DISPONIBILIDADE"],
    fontes: ["BOOK", "CONCEITO"],
  },
  {
    pergunta: "Onde a receita encolheu?",
    eixo: "sinonimo",
    intencao: ["RANKING_PERDA", "MOVIMENTO", "DRE"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que se modificou na vigência?",
    eixo: "sinonimo",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── 3. negativa ───────────────────────────────────────────────────────────
  {
    pergunta: "Nada mudou em agosto?",
    eixo: "negativa",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Não teve nenhuma alteração no pneu?",
    eixo: "negativa",
    intencao: ["MOVIMENTO", "EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Continua tudo do mesmo jeito?",
    eixo: "negativa",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Nenhum veículo foi afetado?",
    eixo: "negativa",
    intencao: ["VEICULOS", "MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O combustível ficou estável?",
    eixo: "negativa",
    intencao: ["MOVIMENTO", "EVOLUCAO", "VALOR"],
    fontes: ["DADO", "BOOK"],
  },

  // ── 4. composta ───────────────────────────────────────────────────────────
  {
    pergunta: "O pneu subiu, e o que o Book diz sobre isso?",
    eixo: "composta",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
    nota: "fonte nomeada manda, e o dado acompanha",
  },
  {
    pergunta: "Compare julho com agosto e me diga onde perdemos mais.",
    eixo: "composta",
    intencao: ["COMPARACAO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto mudou o IPVA e quais veículos isso atingiu?",
    eixo: "composta",
    intencao: ["EVOLUCAO", "MOVIMENTO", "VEICULOS"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Me explique a regra do pneu e depois diga quanto ele mudou.",
    eixo: "composta",
    intencao: ["BOOK", "CONCEITUAL", "MOVIMENTO", "EVOLUCAO"],
    fontes: ["BOOK", "DADO"],
  },
  {
    pergunta: "Tem algo fora do padrão e, se tiver, está previsto no contrato?",
    eixo: "composta",
    intencao: ["BOOK"],
    fontes: ["BOOK", "DADO"],
  },

  // ── 5. fora do domínio ────────────────────────────────────────────────────
  // Nenhuma destas pode receber número, e nenhuma pode receber conceito de
  // consolação. O produto tem uma resposta certa aqui, e ela é dizer que não sabe.
  {
    pergunta: "Qual o CPF do motorista da placa XYZ9A88?",
    eixo: "fora",
    intencao: ["DESCONHECIDA"],
    fontes: ["NENHUMA"],
    proibidas: ["resumoDaVigencia", "rankingDeImpacto", "filaDeInvestigacao"],
  },
  {
    pergunta: "Quantos funcionários a transportadora tem?",
    eixo: "fora",
    intencao: ["DESCONHECIDA", "CONCEITUAL", "DISPONIBILIDADE", "BOOK"],
    fontes: ["NENHUMA", "BOOK", "CONCEITO"],
    proibidas: ["resumoDaVigencia", "rankingDeImpacto"],
  },
  {
    pergunta: "Qual a previsão do tempo em Camaçari amanhã?",
    eixo: "fora",
    intencao: ["DESCONHECIDA"],
    fontes: ["NENHUMA"],
    proibidas: ["resumoDaVigencia", "rankingDeImpacto", "filaDeInvestigacao"],
  },
  {
    pergunta: "Me dá o telefone do fornecedor de pneus.",
    eixo: "fora",
    intencao: ["DESCONHECIDA", "BOOK", "CONCEITUAL", "VALOR", "MOVIMENTO"],
    fontes: ["NENHUMA", "BOOK", "CONCEITO"],
    proibidas: ["resumoDaVigencia"],
    nota: "cita pneu, e mesmo assim não é sobre pneu",
  },
  {
    pergunta: "Qual o endereço da garagem?",
    eixo: "fora",
    intencao: ["DESCONHECIDA"],
    fontes: ["NENHUMA"],
    proibidas: ["resumoDaVigencia", "rankingDeImpacto"],
  },
  {
    pergunta: "Quem é o diretor da Ambev?",
    eixo: "fora",
    intencao: ["DESCONHECIDA", "CONCEITUAL"],
    fontes: ["NENHUMA", "CONCEITO"],
    proibidas: ["resumoDaVigencia", "rankingDeImpacto"],
  },
];
