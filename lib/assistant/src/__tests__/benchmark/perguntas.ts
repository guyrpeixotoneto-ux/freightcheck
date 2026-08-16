/**
 * O BENCHMARK — 110 perguntas reais, com critérios verificáveis.
 *
 * **Por que não comparação de texto.** Uma resposta boa e uma resposta ruim
 * podem ter a mesma redação; o que as separa é onde o assistente foi procurar,
 * o que ele recuperou e o que ele se permitiu afirmar. Cada caso aqui declara
 * expectativas sobre o **pipeline**, não sobre a prosa: a intenção resolvida, a
 * fonte consultada, a evidência que tinha de aparecer, e o que a resposta não
 * pode conter.
 *
 * **Um caso pode declarar mais de uma intenção aceitável.** "Por que o custo do
 * cavalo aumentou?" é legitimamente PROCEDENCIA ou CONCEITUAL conforme o que
 * estiver disponível; travar numa só transformaria o benchmark num registro da
 * implementação de hoje, que é o oposto de proteção contra regressão.
 *
 * **Os casos que falham hoje continuam aqui.** Um benchmark que só contém o que
 * passa mede a suíte, não o produto.
 */

export type Fonte = "DADO" | "BOOK" | "CONCEITO" | "NENHUMA";

export interface CasoDeBenchmark {
  pergunta: string;
  categoria:
    | "alteracoes"
    | "parametros"
    | "impacto"
    | "equipamentos"
    | "combustivel"
    | "book"
    | "comparacao"
    | "cruzada"
    | "informal"
    | "followup"
    | "impossivel"
    | "executiva";
  /** Uma destas intenções é aceitável. */
  intencao: string[];
  /** As fontes que a resposta precisa ter consultado. */
  fontes: Fonte[];
  /** Pelo menos uma destas ferramentas tinha de rodar. */
  ferramentas?: string[];
  /** A lacuna que a resposta é obrigada a declarar. */
  lacuna?: string;
  /** O assistente não pode terminar sem evidência nenhuma. */
  exigeEvidencia?: boolean;
  /** O termo que deveria ter sido reconhecido como assunto. */
  assunto?: string | null;
  /** Comentário sobre o que este caso protege. */
  nota?: string;
}

export const BENCHMARK: CasoDeBenchmark[] = [
  // ── alterações (o coração do produto) ────────────────────────────────────
  {
    pergunta: "Teve alteração na remuneração?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    ferramentas: ["resumoDaVigencia"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Teve alterações na remuneração?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    ferramentas: ["resumoDaVigencia"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Mudou alguma coisa na remuneração?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou este mês?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou em agosto?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quais foram as principais alterações de agosto?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou na última vigência?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Teve mudança?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Houve alteração na remuneração",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que aconteceu na última vigência?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Tem alguma alteração relevante que eu deveria investigar?",
    categoria: "alteracoes",
    intencao: ["ATENCAO", "MOVIMENTO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "resíduo 'relevante deveria investigar' vira assunto e desliga as consultas",
  },
  {
    pergunta: "Quais são as três alterações mais importantes?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO", "ATENCAO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "resíduo 'tres' vira assunto",
  },
  {
    pergunta: "O que mudou na remuneração dos cavalos?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    assunto: "cavalo",
  },
  {
    pergunta: "O que mudou na remuneração das carretas?",
    categoria: "alteracoes",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    assunto: "carreta",
  },

  // ── parâmetros ────────────────────────────────────────────────────────────
  {
    pergunta: "Qual o valor do IPVA?",
    categoria: "parametros",
    intencao: ["VALOR"],
    fontes: ["DADO"],
    ferramentas: ["movimentoDoParametro", "serieDoParametro"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto está a manutenção?",
    categoria: "parametros",
    intencao: ["VALOR"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto mudou o pneu desde dezembro?",
    categoria: "parametros",
    intencao: ["EVOLUCAO"],
    fontes: ["DADO"],
    ferramentas: ["compararIntervalo", "serieDoParametro"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Qual foi a evolução do pneu?",
    categoria: "parametros",
    intencao: ["EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Me mostra a evolução do financiamento",
    categoria: "parametros",
    intencao: ["EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto mudou a depreciação?",
    categoria: "parametros",
    intencao: ["EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quais parâmetros impactam a remuneração do cavalo?",
    categoria: "parametros",
    intencao: ["CONCEITUAL", "COMPOSICAO"],
    fontes: ["CONCEITO"],
    nota: "hoje cai em DESCONHECIDA",
  },
  {
    pergunta: "Quais parâmetros não têm preço suficiente?",
    categoria: "parametros",
    intencao: ["SEM_PRECO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que significa semântica UNKNOWN?",
    categoria: "parametros",
    intencao: ["CONCEITUAL", "CURADORIA"],
    fontes: ["CONCEITO"],
  },
  {
    pergunta: "O que falta na curadoria?",
    categoria: "parametros",
    intencao: ["CURADORIA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── impacto ───────────────────────────────────────────────────────────────
  {
    pergunta: "Qual foi o impacto dessas alterações?",
    categoria: "impacto",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "resíduo 'dessas' vira assunto e zera as consultas",
  },
  {
    pergunta: "Qual foi o impacto?",
    categoria: "impacto",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto isso custou?",
    categoria: "impacto",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Onde perdemos mais dinheiro?",
    categoria: "impacto",
    intencao: ["RANKING_PERDA"],
    fontes: ["DADO"],
    ferramentas: ["rankingDeImpacto"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Onde ganhamos mais dinheiro?",
    categoria: "impacto",
    intencao: ["RANKING_GANHO"],
    fontes: ["DADO"],
    ferramentas: ["rankingDeImpacto"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Qual parâmetro mais piorou?",
    categoria: "impacto",
    intencao: ["RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Onde tivemos maior perda?",
    categoria: "impacto",
    intencao: ["RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quais mudanças podem reduzir minha remuneração?",
    categoria: "impacto",
    intencao: ["RANKING_PERDA", "MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto perdemos?",
    categoria: "impacto",
    intencao: ["RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "De onde veio esse número?",
    categoria: "impacto",
    intencao: ["PROCEDENCIA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── equipamentos ──────────────────────────────────────────────────────────
  {
    pergunta: "Quais veículos foram mais impactados?",
    categoria: "equipamentos",
    intencao: ["VEICULOS"],
    fontes: ["DADO"],
    ferramentas: ["veiculosAfetados"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Qual veículo foi mais afetado?",
    categoria: "equipamentos",
    intencao: ["VEICULOS"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quais placas sofreram mais alterações?",
    categoria: "equipamentos",
    intencao: ["VEICULOS"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quantos veículos temos no banco?",
    categoria: "equipamentos",
    intencao: ["PANORAMA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou no caminhão?",
    categoria: "equipamentos",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    assunto: "cavalo",
  },
  {
    pergunta: "O que mudou no implemento?",
    categoria: "equipamentos",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    assunto: "carreta",
  },
  {
    pergunta: "Qual a composição da frota?",
    categoria: "equipamentos",
    intencao: ["COMPOSICAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Me mostra a ficha do cavalo",
    categoria: "equipamentos",
    intencao: ["COMPOSICAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── combustível ───────────────────────────────────────────────────────────
  {
    pergunta: "Como funciona o preço de combustível?",
    categoria: "combustivel",
    intencao: ["CONCEITUAL"],
    fontes: ["BOOK", "CONCEITO"],
  },
  {
    pergunta: "O que é preço de combustível?",
    categoria: "combustivel",
    intencao: ["CONCEITUAL"],
    fontes: ["BOOK", "CONCEITO"],
  },
  {
    pergunta: "Temos preço de combustível?",
    categoria: "combustivel",
    intencao: ["DISPONIBILIDADE"],
    fontes: ["CONCEITO"],
    lacuna: "CONCEITO_SEM_DADO",
  },
  {
    pergunta: "Qual o preço do combustível em reais?",
    categoria: "combustivel",
    intencao: ["VALOR", "CONCEITUAL", "DISPONIBILIDADE"],
    fontes: ["CONCEITO"],
    lacuna: "CONCEITO_SEM_DADO",
  },
  {
    pergunta: "O que mudou no consumo negociado?",
    categoria: "combustivel",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quanto mudou combustível?",
    categoria: "combustivel",
    intencao: ["EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  /*
    Reclassificada na Fase 6, e a razão importa mais que o caso.

    Ela pedia `DADO` com a nota "sinônimo de domínio: diesel → combustível". Os
    dados dizem outra coisa: o catálogo do Freightech publica um campo `Diesel
    destino` que **este export não traz**, e as colunas de combustível que ele
    traz medem consumo e capacidade — não o preço do diesel. Atendê-la seria
    responder com o número certo sobre o assunto errado, que é a pior resposta
    que este produto sabe dar e a razão de o portão de assunto existir.

    O que ela mede agora é o que deve acontecer: a regra do Book responde o que
    dá, e a coluna que falta é declarada em vez de substituída.
  */
  {
    pergunta: "O que mudou no diesel?",
    categoria: "combustivel",
    intencao: ["MOVIMENTO", "BOOK"],
    fontes: ["BOOK"],
    lacuna: "CONCEITO_SEM_DADO",
    nota: "o export não traz diesel; a regra responde e a lacuna declara",
  },
  {
    pergunta: "Como funciona o crédito de imposto no diesel?",
    categoria: "combustivel",
    intencao: ["CONCEITUAL"],
    fontes: ["BOOK"],
  },

  // ── Book ──────────────────────────────────────────────────────────────────
  {
    pergunta: "O que o Book diz sobre pneu?",
    categoria: "book",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "O que o Book diz sobre remuneração de pneu?",
    categoria: "book",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
    nota: "BOOK VALE PEDÁGIO ranqueia acima de PNEU",
  },
  {
    pergunta: "O que o Book diz sobre IPVA?",
    categoria: "book",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "Qual a regra do bloco PNEU?",
    categoria: "book",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
    ferramentas: ["regraDoBook"],
  },
  {
    pergunta: "Com que frequência a auditoria QLP ADM acontece?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK"],
    nota: "não diz 'Book' — cai em DESCONHECIDA",
  },
  {
    pergunta: "Qual a evidência exigida para remunerar pneu?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "O que acontece se eu não apresentar a nota fiscal do pneu?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "Qual o prazo para contestar o desconto QLP ADM?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "O vale pedágio entra na remuneração?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL", "DISPONIBILIDADE"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "Posso somar parcelas mensais e por km?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK", "CONCEITO"],
  },
  {
    pergunta: "O Book cobre quantos blocos?",
    categoria: "book",
    intencao: ["BOOK"],
    fontes: ["DADO"],
    ferramentas: ["coberturaDoBook"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que é o Book do Operador?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["CONCEITO"],
  },
  {
    pergunta: "Qual a periodicidade da revisão de manutenção?",
    categoria: "book",
    intencao: ["BOOK", "CONCEITUAL"],
    fontes: ["BOOK"],
  },

  // ── comparação ────────────────────────────────────────────────────────────
  {
    pergunta: "Compare julho com agosto.",
    categoria: "comparacao",
    intencao: ["COMPARACAO"],
    fontes: ["DADO"],
    ferramentas: ["compararIntervalo"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Compare julho com agosto e me diga o que realmente importa.",
    categoria: "comparacao",
    intencao: ["COMPARACAO"],
    fontes: ["DADO"],
    ferramentas: ["compararIntervalo"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Julho versus agosto no pneu",
    categoria: "comparacao",
    intencao: ["COMPARACAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Qual a diferença entre junho e julho?",
    categoria: "comparacao",
    intencao: ["COMPARACAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Compare com a vigência anterior.",
    categoria: "comparacao",
    intencao: ["COMPARACAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Quais vigências existem?",
    categoria: "comparacao",
    intencao: ["CATALOGO_DE_CONTEXTO", "PANORAMA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── cruzadas (dado + Book) ────────────────────────────────────────────────
  {
    pergunta:
      "Teve alteração na remuneração de pneu e existe alguma regra do Book relacionada?",
    categoria: "cruzada",
    intencao: ["MOVIMENTO", "BOOK"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que mudou no pneu e o que o Book diz sobre isso?",
    categoria: "cruzada",
    intencao: ["MOVIMENTO", "BOOK"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O consumo negociado mudou e o Book explica por quê?",
    categoria: "cruzada",
    intencao: ["MOVIMENTO", "BOOK"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Existe alguma regra no Book relacionada a essa alteração?",
    categoria: "cruzada",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "O IPVA mudou e isso está previsto no Book?",
    categoria: "cruzada",
    intencao: ["MOVIMENTO", "BOOK"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },
  {
    pergunta: "A manutenção subiu — o Book prevê revisão trimestral?",
    categoria: "cruzada",
    intencao: ["MOVIMENTO", "BOOK", "RANKING_GANHO"],
    fontes: ["DADO", "BOOK"],
    exigeEvidencia: true,
  },

  // ── informal / typo ───────────────────────────────────────────────────────
  {
    pergunta: "rolou alguma mudança esse mês?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "me fala o que aconteceu em agosto",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "cê consegue ver o que mudou?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "tá tudo igual esse mês?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "o q mudou em agosto",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "qnt mudou o pneu?",
    categoria: "informal",
    intencao: ["EVOLUCAO", "VALOR"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "teve alteraçao na remuneraçao?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "teve alteracão na remunerção?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "um typo em 'remuneração' troca o caminho inteiro",
  },
  {
    pergunta: "mudou algo?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "e aí, o que mudou?",
    categoria: "informal",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── executivas ────────────────────────────────────────────────────────────
  {
    pergunta: "Me diga apenas o que merece minha atenção.",
    categoria: "executiva",
    intencao: ["ATENCAO", "MOVIMENTO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Tem alguma coisa fora do padrão?",
    categoria: "executiva",
    intencao: ["ATENCAO", "MOVIMENTO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O que eu deveria investigar primeiro?",
    categoria: "executiva",
    intencao: ["ATENCAO", "MOVIMENTO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Resuma agosto para a diretoria.",
    categoria: "executiva",
    intencao: ["ATENCAO", "MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta:
      "Explique isso como se estivesse falando com o diretor da operação.",
    categoria: "executiva",
    intencao: ["CONCEITUAL", "ATENCAO", "MOVIMENTO"],
    fontes: ["DADO", "CONCEITO", "BOOK"],
  },
  {
    pergunta: "Me dá um panorama de agosto.",
    categoria: "executiva",
    intencao: ["MOVIMENTO", "PANORAMA", "ATENCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Vale a pena eu me preocupar com alguma coisa?",
    categoria: "executiva",
    intencao: ["ATENCAO", "MOVIMENTO", "RANKING_PERDA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },

  // ── impossíveis / não alucinação ──────────────────────────────────────────
  {
    pergunta: "Qual a previsão do tempo em Salvador?",
    categoria: "impossivel",
    intencao: ["DESCONHECIDA"],
    fontes: ["NENHUMA"],
    lacuna: "NAO_ENCONTREI",
  },
  {
    pergunta: "Quanto mudou o pedágio?",
    categoria: "impossivel",
    intencao: ["EVOLUCAO"],
    fontes: ["BOOK", "CONCEITO"],
    nota: "pedágio existe no Book e não no export",
  },
  {
    pergunta: "Quanto custa o IPVA?",
    categoria: "impossivel",
    intencao: ["VALOR", "CONCEITUAL"],
    fontes: ["DADO", "CONCEITO"],
  },
  {
    pergunta: "O que mudou em março de 2019?",
    categoria: "impossivel",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    nota: "período sem dado — não pode responder sobre agosto em silêncio",
  },
  {
    pergunta: "Quanto vai mudar em setembro?",
    categoria: "impossivel",
    intencao: ["DESCONHECIDA", "MOVIMENTO", "EVOLUCAO"],
    fontes: ["NENHUMA", "DADO"],
    nota: "pergunta de previsão — não há dado futuro",
  },
  {
    pergunta: "Qual a margem de lucro da transportadora?",
    categoria: "parametros",
    intencao: ["DRE"],
    fontes: ["DADO"],
    exigeEvidencia: true,
    nota: "deixou de ser impossível quando o módulo de DRE entrou — o caso estava classificado como sem resposta porque, quando foi escrito, era",
  },
  {
    pergunta: "Quantos motoristas cada transportadora tem?",
    categoria: "impossivel",
    intencao: ["DESCONHECIDA", "PANORAMA", "DISPONIBILIDADE"],
    fontes: ["NENHUMA", "CONCEITO"],
  },
  {
    pergunta: "Me dá o CPF do motorista da placa ABC1D23",
    categoria: "impossivel",
    intencao: ["DESCONHECIDA", "CELULAS"],
    fontes: ["NENHUMA"],
  },
  {
    pergunta: "Por que o pneu subiu 15%?",
    categoria: "impossivel",
    intencao: ["PROCEDENCIA", "CONCEITUAL", "EVOLUCAO"],
    fontes: ["DADO"],
    nota: "premissa falsa embutida — não pode confirmar os 15%",
  },
  {
    pergunta: "Confirma que o impacto de agosto foi de R$ 50 mil?",
    categoria: "impossivel",
    intencao: ["MOVIMENTO", "DESCONHECIDA", "DISPONIBILIDADE"],
    fontes: ["DADO"],
    nota: "número falso na pergunta",
  },

  // ── follow-ups (avaliados em sequência) ───────────────────────────────────
  {
    pergunta: "E nos cavalos?",
    categoria: "followup",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Qual teve maior impacto?",
    categoria: "followup",
    intencao: ["MOVIMENTO", "RANKING_PERDA", "RANKING_GANHO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Por quê?",
    categoria: "followup",
    intencao: ["PROCEDENCIA"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "O Book fala alguma coisa sobre isso?",
    categoria: "followup",
    intencao: ["BOOK"],
    fontes: ["BOOK"],
  },
  {
    pergunta: "E julho?",
    categoria: "followup",
    intencao: ["VALOR", "MOVIMENTO", "EVOLUCAO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "E a carreta?",
    categoria: "followup",
    intencao: ["MOVIMENTO", "VALOR"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
  {
    pergunta: "Explica melhor.",
    categoria: "followup",
    intencao: ["CONCEITUAL", "DESCONHECIDA"],
    fontes: ["CONCEITO", "DADO", "BOOK"],
  },
  {
    pergunta: "Isso teve impacto?",
    categoria: "followup",
    intencao: ["MOVIMENTO"],
    fontes: ["DADO"],
    exigeEvidencia: true,
  },
];
