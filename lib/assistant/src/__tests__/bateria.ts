/**
 * A bateria — as perguntas, e o que cada uma tem de fazer.
 *
 * Vive fora do arquivo de teste porque duas coisas a consomem: a suíte, que a
 * roda como asserção, e `tabela.mts`, que a roda como relatório. Uma tabela de
 * confronto gerada de uma lista diferente da que os testes usam descreveria um
 * assistente que ninguém verificou.
 *
 * `esperado` é a única coluna escrita por humano: é o que a pessoa que
 * perguntou tinha direito de receber, em português. Ela não é executável de
 * propósito — o que é executável são `intencao`, `ferramentas`, `lacuna` e as
 * demais, e é contra elas que a suíte decide se passou.
 */

import type { Intencao } from "../interpretacao";

export interface Caso {
  pergunta: string;
  intencao: Intencao;
  /** Pelo menos uma destas ferramentas tem de ter sido chamada. */
  ferramentas?: string[];
  /** A resposta precisa citar este texto. */
  contem?: string[];
  /** A resposta não pode citar nenhum destes. */
  naoContem?: string[];
  /** Esta lacuna precisa ter sido declarada. */
  lacuna?: string;
  /** Nenhuma lacuna pode ser declarada: a pergunta foi respondida inteira. */
  semLacuna?: boolean;
  /** A resposta é conceitual e não pode carregar recorte de vigência. */
  semRecorte?: boolean;
  /** O termo casa mais de uma gaveta e o assistente tem de perguntar de volta. */
  desambigua?: boolean;
  /** O que quem perguntou tinha direito de receber. */
  esperado: string;
}

export const CASOS: Caso[] = [
  // ── conceitual: o caso do combustível, e o que ele exige ──────────────────
  {
    pergunta: "Como funciona preço de combustível?",
    intencao: "CONCEITUAL",
    contem: ["consumo"],
    lacuna: "CONCEITO_SEM_DADO",
    semRecorte: true,
    esperado:
      "Explicar o que o FreightCheck tem em Combustível (consumo, capacidade, vida) e dizer " +
      "que preço não vem neste export — sem citar vigência nenhuma.",
  },
  {
    pergunta: "O que é preço de combustível?",
    intencao: "CONCEITUAL",
    lacuna: "CONCEITO_SEM_DADO",
    semRecorte: true,
    esperado: "A mesma resposta conceitual, sem número de vigência.",
  },
  {
    pergunta: "Temos preço de combustível?",
    intencao: "DISPONIBILIDADE",
    lacuna: "CONCEITO_SEM_DADO",
    semRecorte: true,
    esperado: "Não — e dizer qual arquivo faltaria pedir ao Freightech.",
  },
  {
    pergunta: "O Book fala alguma coisa sobre combustível?",
    intencao: "BOOK",
    esperado:
      "Consultar o Book do Operador e responder pelo que está escrito nele.",
  },
  {
    pergunta: "Como funciona IPVA?",
    intencao: "CONCEITUAL",
    semRecorte: true,
    esperado:
      "O conceito de IPVA no produto, sem arrastar o resumo de uma vigência.",
  },
  {
    pergunta: "O que o Book diz sobre IPVA?",
    intencao: "BOOK",
    esperado:
      "O que o Book do Operador registra sobre IPVA, não o que o banco calculou.",
  },

  // ── dado: vigência, valor, série ──────────────────────────────────────────
  {
    pergunta: "O que mudou em agosto?",
    intencao: "MOVIMENTO",
    ferramentas: ["resumoDaVigencia"],
    esperado:
      "O movimento da vigência de agosto no recorte corrente, com o impacto por periodicidade.",
  },
  {
    pergunta: "Qual o valor do IPVA?",
    intencao: "VALOR",
    ferramentas: [
      "movimentoDaParametro",
      "movimentoDoParametro",
      "serieDoParametro",
    ],
    esperado:
      "O valor corrente da gaveta IPVA e licenciamento no recorte, com a coluna que o sustenta.",
  },
  {
    pergunta: "Quanto mudou o IPVA desde dezembro?",
    intencao: "EVOLUCAO",
    ferramentas: ["serieDoParametro", "compararIntervalo"],
    esperado:
      "A série de dezembro até a vigência corrente e o saldo do intervalo.",
  },
  {
    pergunta: "Compare julho com agosto.",
    intencao: "COMPARACAO",
    ferramentas: ["compararIntervalo"],
    esperado:
      "As duas leituras do intervalo — movimentos do período e ponta a ponta — e por que divergem.",
  },

  // ── análise ────────────────────────────────────────────────────────────────
  {
    pergunta: "Onde perdemos mais dinheiro?",
    intencao: "RANKING_PERDA",
    ferramentas: ["rankingDeImpacto"],
    esperado:
      "O ranking de parâmetros por impacto negativo, dentro de uma periodicidade.",
  },
  {
    pergunta: "Onde ganhamos mais dinheiro?",
    intencao: "RANKING_GANHO",
    ferramentas: ["rankingDeImpacto"],
    esperado: "O ranking de parâmetros por impacto positivo.",
  },
  {
    pergunta: "Qual parâmetro mais piorou?",
    intencao: "RANKING_PERDA",
    ferramentas: ["rankingDeImpacto"],
    esperado: "O mesmo ranking de perda, escrito de outro jeito.",
  },
  {
    pergunta: "Quais veículos foram mais impactados?",
    intencao: "VEICULOS",
    ferramentas: ["veiculosAfetados"],
    esperado: "Os ativos mais afetados na vigência, por placa.",
  },
  {
    pergunta:
      "Quais parâmetros não têm preço suficiente para calcular impacto?",
    intencao: "SEM_PRECO",
    ferramentas: ["semParaPrecificar"],
    esperado:
      "As colunas cuja semântica ainda não foi confirmada — e por isso não viram dinheiro.",
  },

  // ── panorama e contexto ───────────────────────────────────────────────────
  {
    pergunta: "O que temos importado?",
    intencao: "PANORAMA",
    ferramentas: ["panoramaDoContexto"],
    esperado:
      "O panorama do recorte corrente — e só dele, nunca do banco inteiro.",
  },
  {
    pergunta: "Quais vigências existem?",
    intencao: "CATALOGO_DE_CONTEXTO",
    ferramentas: ["listarVigencias"],
    esperado: "As vigências da unidade e canal correntes.",
  },

  // ── variações naturais: a mesma pergunta escrita de outro jeito ───────────
  {
    pergunta: "onde tivemos maior perda?",
    intencao: "RANKING_PERDA",
    ferramentas: ["rankingDeImpacto"],
    esperado:
      "O ranking de perda — a variação informal tem de cair no mesmo lugar.",
  },
  {
    pergunta: "quais placas sofreram mais alterações",
    intencao: "VEICULOS",
    ferramentas: ["veiculosAfetados"],
    esperado: "A lista de veículos afetados, dita em 'placas'.",
  },
  {
    pergunta: "me explica o índice de reajuste",
    intencao: "CONCEITUAL",
    semRecorte: true,
    esperado: "A explicação do conceito, sem número de vigência.",
  },
  {
    pergunta: "o que aconteceu na última vigência",
    intencao: "MOVIMENTO",
    ferramentas: ["resumoDaVigencia"],
    esperado: "O movimento da vigência mais recente. 'Aconteceu' é 'mudou'.",
  },
  {
    pergunta: "qual foi a evolução do pneu",
    intencao: "EVOLUCAO",
    esperado: "A série da gaveta Pneu ao longo das vigências.",
  },

  // ── sem resposta ───────────────────────────────────────────────────────────
  {
    pergunta: "qual a previsão do tempo em Salvador?",
    intencao: "DESCONHECIDA",
    lacuna: "NAO_ENCONTREI",
    esperado: "Dizer que não sabe. Não é assunto deste produto.",
  },
  {
    pergunta: "quanto mudou o pedágio?",
    intencao: "EVOLUCAO",
    naoContem: ["R$"],
    esperado:
      "Dizer que nenhuma coluna deste export alimenta pedágio — e **nenhum** valor em reais, " +
      "porque qualquer número aqui seria sobre outro assunto.",
  },

  // ── conceito de produto: o corpus responde, o banco não é consultado ───────
  {
    pergunta: "Como o FreightCheck calcula o impacto?",
    intencao: "CONCEITUAL",
    semRecorte: true,
    esperado:
      "A regra de apuração, do conhecimento do produto. Sem consultar vigência.",
  },
  {
    pergunta: "por que o impacto é acumulado por periodicidade?",
    intencao: "CONCEITUAL",
    contem: ["periodicidade"],
    semRecorte: true,
    esperado:
      "O artigo que explica por que nunca existe um total único — 'por quê' com objeto " +
      "próprio é conceito, não procedência.",
  },
  {
    pergunta: "O que significa semântica UNKNOWN?",
    intencao: "CONCEITUAL",
    semRecorte: true,
    esperado:
      "O artigo de Curadoria: UNKNOWN é resposta aceitável, certeza fabricada não é.",
  },
  {
    pergunta: "O que é o Book do Operador?",
    intencao: "BOOK",
    ferramentas: ["coberturaDoBook"],
    esperado: "O que o Book é, e quanto dele está registrado neste banco.",
  },
  {
    pergunta: "Qual a regra do bloco PNEU?",
    intencao: "BOOK",
    ferramentas: ["regraDoBook"],
    esperado:
      "O que o documento de PNEU diz — o conteúdo vem do índice do Book, e a " +
      "evidência de registro sustenta a fonte.",
  },
  {
    pergunta: "O Book cobre quantos blocos?",
    intencao: "BOOK",
    ferramentas: ["coberturaDoBook"],
    esperado: "Quantos blocos do índice têm regra registrada.",
  },

  // ── dado, escrito como quem opera escreve ─────────────────────────────────
  {
    pergunta: "Quanto mudou combustível?",
    intencao: "EVOLUCAO",
    ferramentas: ["movimentoDoParametro", "serieDoParametro"],
    lacuna: "DADO_SEM_PRECO",
    esperado:
      "O movimento de Combustível — e o aviso de que o impacto não é apurável sem preço.",
  },
  {
    pergunta: "me mostra a evolução do financiamento",
    intencao: "EVOLUCAO",
    ferramentas: ["serieDoParametro"],
    esperado: "A série do Financiamento ao longo das vigências do recorte.",
  },
  {
    pergunta: "qual o valor do pneu em julho?",
    intencao: "VALOR",
    ferramentas: ["movimentoDoParametro", "serieDoParametro"],
    esperado: "O valor da gaveta Pneu na vigência de julho.",
  },
  {
    pergunta: "quanto custa o IPVA?",
    intencao: "VALOR",
    ferramentas: ["movimentoDoParametro"],
    semLacuna: true,
    esperado:
      "O valor do IPVA, sem nota de lacuna: a gaveta tem coluna monetária, então 'custa' " +
      "não é um qualificador que falte.",
  },
  {
    pergunta: "O que mudou na última vigência?",
    intencao: "MOVIMENTO",
    ferramentas: ["resumoDaVigencia"],
    esperado: "O movimento da vigência mais recente do recorte.",
  },
  {
    pergunta: "Qual veículo foi mais afetado?",
    intencao: "VEICULOS",
    ferramentas: ["veiculosAfetados"],
    esperado: "O ativo com mais alterações na vigência.",
  },
  {
    pergunta: "Quanto perdemos?",
    intencao: "RANKING_PERDA",
    ferramentas: ["rankingDeImpacto"],
    esperado: "O total de perda por periodicidade, e onde ela se concentrou.",
  },
  {
    pergunta: "De onde veio esse número?",
    intencao: "PROCEDENCIA",
    esperado: "A origem: qual consulta, qual recorte, qual vigência.",
  },
  {
    pergunta: "Quantos veículos temos no banco?",
    intencao: "PANORAMA",
    ferramentas: ["panoramaDoContexto"],
    esperado: "A contagem de ativos do recorte — não a do banco inteiro.",
  },
  {
    pergunta: "temos dado de manutenção?",
    intencao: "DISPONIBILIDADE",
    desambigua: true,
    esperado:
      "Perguntar de volta: manutenção casa mais de uma gaveta, e escolher uma daria uma " +
      "resposta coerente sobre outro assunto.",
  },
];

// ── conversas: o que só existe em sequência ─────────────────────────────────

export interface Passo {
  pergunta: string;
  intencao: Intencao;
  /** Tem de herdar algo da pergunta anterior. */
  herda?: boolean;
  /** O recorte da resposta tem de casar isto. */
  recorte?: RegExp;
  /** Pelo menos uma destas ferramentas tem de ter rodado. */
  ferramentas?: string[];
  /** Precisa ter consultado alguma coisa — não basta devolver texto. */
  naoVazio?: boolean;
  /** Pergunta conceitual: não pode carregar recorte de vigência. */
  semRecorte?: boolean;
  esperado: string;
}

export const CONVERSAS: { nome: string; passos: Passo[] }[] = [
  {
    /*
      A sequência de aceite, exatamente como foi pedida.

      Ela existe porque a bateria de perguntas isoladas passava inteira
      enquanto esta quebrava em quatro dos nove turnos. Perguntas soltas
      nomeiam o próprio assunto; uma conversa de verdade usa pronome — "isso",
      "a fonte", "o impacto" — e para de nomear qualquer coisa depois do
      segundo turno. É aqui que o fio arrebenta, e é por isso que ela é o caso
      que não pode voltar a falhar.
    */
    nome: "a sequência de aceite: nove turnos sem repetir o assunto",
    passos: [
      {
        pergunta: "Como funciona combustível?",
        intencao: "CONCEITUAL",
        semRecorte: true,
        esperado: "O conceito, sem arrastar vigência nenhuma.",
      },
      {
        pergunta: "Quanto mudou em agosto?",
        intencao: "EVOLUCAO",
        herda: true,
        recorte: /agosto/i,
        esperado:
          "Quanto mudou **o combustível** em agosto. Sem herdar o assunto, respondia o " +
          "agregado da vigência — verdadeiro e sobre outra coisa.",
      },
      {
        pergunta: "E julho?",
        intencao: "VALOR",
        herda: true,
        recorte: /julho/i,
        esperado: "O mesmo assunto, no mês que a frase troca.",
      },
      {
        pergunta: "Compare.",
        intencao: "COMPARACAO",
        herda: true,
        ferramentas: ["compararIntervalo"],
        esperado:
          "Duas vigências diferentes. Herdando a vigência do fio como as duas pontas, " +
          "respondia 'julho → julho, 0 comparações' — um resultado válido e vazio.",
      },
      {
        pergunta: "Qual foi o impacto?",
        intencao: "MOVIMENTO",
        herda: true,
        ferramentas: ["movimentoDoParametro", "resumoDaVigencia"],
        esperado:
          "O impacto do que está em discussão. Antes não casava padrão nenhum, caía em " +
          "DESCONHECIDA e era respondida por um artigo, sem consultar nada.",
      },
      {
        pergunta: "Quais veículos mais sofreram?",
        intencao: "VEICULOS",
        ferramentas: ["veiculosAfetados"],
        esperado: "Os ativos afetados, no recorte que a conversa vinha usando.",
      },
      {
        pergunta: "Por quê?",
        intencao: "PROCEDENCIA",
        herda: true,
        esperado: "Refaz a consulta e desce à origem.",
      },
      {
        pergunta: "Isso está previsto no Book?",
        intencao: "BOOK",
        herda: true,
        esperado:
          "O Book — não o catálogo do Freightech. O 'isso' é o assunto do fio, e sem " +
          "resolvê-lo a resposta vinha do cartão de inventário do cavalo.",
      },
      {
        pergunta: "Me mostre a fonte.",
        intencao: "PROCEDENCIA",
        herda: true,
        naoVazio: true,
        esperado:
          "A origem do que foi dito. Antes 'fonte' e 'mostre' viravam o nome de um " +
          "parâmetro inexistente, e a resposta era uma frase solta de um artigo.",
      },
    ],
  },
  {
    nome: "IPVA, do intervalo ao mês e à origem",
    passos: [
      {
        pergunta: "Quanto mudou o IPVA desde dezembro?",
        intencao: "EVOLUCAO",
        esperado: "A série de dezembro até agora.",
      },
      {
        pergunta: "E julho?",
        intencao: "VALOR",
        herda: true,
        recorte: /julho/i,
        esperado:
          "O IPVA **em julho** — herda o assunto, troca o período. Não repete a série.",
      },
      {
        pergunta: "Por quê?",
        intencao: "PROCEDENCIA",
        herda: true,
        esperado:
          "Refaz a consulta e desce até as linhas que mudaram. Não reexibe número guardado.",
      },
      {
        /*
          "E o pneu?" troca o assunto e mantém a pergunta.

          Depois de "por quê?", ela quer dizer "e por que o pneu?" — herdar a
          intenção da vez anterior é o que faz a conversa ter fio. O parâmetro
          novo vence o do estado; tudo o mais continua.
        */
        pergunta: "E o pneu?",
        intencao: "PROCEDENCIA",
        herda: true,
        esperado:
          "Troca o assunto para Pneu, mantendo a pergunta e o recorte da conversa.",
      },
    ],
  },
];
