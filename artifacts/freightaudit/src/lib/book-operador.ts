/**
 * O Book do Operador — o índice dos blocos, como o Freightech os publica.
 *
 * **O que este módulo é.** O Freightech mantém, ao lado das telas de dado, uma
 * base de blocos que descreve *as regras*: como cada linha da planilha de
 * remuneração é composta, de onde vem cada número, o que a transportadora
 * precisa entregar para ser paga. É o documento do modelo de negócio assinado
 * entre Ambev e transportadoras — o próprio Freightech chama um dos blocos de
 * "Book do operador" e o descreve exatamente assim.
 *
 * **Por que ele faz falta aqui.** `docs/ARQUITETURA.md` abre com o achado que
 * organizou este produto inteiro: *o Freightec não exporta regras, exporta o
 * cadastro remunerado da frota, congelado por vigência*. Todo o resto do
 * FreightCheck vive desse export — 99 atributos por placa, sem uma linha que
 * diga o que qualquer um deles significa. É daí que vêm as armadilhas
 * catalogadas lá: `ipvaLicenciamentoMensal` que é 4–12× maior que o suposto
 * anual, `finameCavalo` que zera e volta ao valor cheio, `Custo Variável
 * Simulado` em R$/km que ninguém pode somar. Nenhuma dessas perguntas se
 * responde com mais planilha. Elas se respondem com o Book.
 *
 * **O que existe aqui e o que ainda não existe.** Este arquivo é o índice: a
 * categoria, o título e a descrição de cada bloco, transcritos da tela do
 * Freightech. O **conteúdo** de cada bloco — o documento em si, que é o que
 * permitiria ao FreightCheck sustentar uma regra de remuneração — não foi
 * importado, e a tela diz isso em vez de simular que foi. O índice sozinho já
 * vale: ele nomeia, em vocabulário do Freightech, o assunto de cada regra, e é
 * por esse nome que alguém vai pedir o documento que falta.
 *
 * **Por que os dados moram na interface, e não no banco.** Mesma razão do
 * `freightech-catalogo.ts` ao lado: este é o mapa do sistema de origem, não uma
 * projeção dos nossos fatos. Ele precisa existir com o banco vazio, que é
 * justamente quando a pessoa está tentando descobrir o que pedir. Quando os
 * documentos forem importados de verdade, eles ganham tabela, migration e rota
 * — o índice continua aqui, porque continua sendo transcrição de tela.
 *
 * **Fonte.** Base de blocos do Freightech, capturada em 13/08/2026, ordenada
 * como lá (6 por página, 11 páginas). A tela informa **66 resultados**; 63
 * estão transcritos abaixo. Os 3 que faltam são o rabo da página 11, que a
 * captura não alcançou — e é por isso que `TOTAL_DECLARADO_FREIGHTECH` existe
 * como constante separada da contagem do array. A tela mostra as duas e a
 * diferença, porque "63 blocos" sem essa ressalva seria a mesma mentira por
 * omissão que este produto passa o tempo todo evitando.
 */

export interface BlocoBook {
  /** A categoria como o Freightech a escreve, em cima do título e em laranja. */
  categoria: string;
  /**
   * O título, literal.
   *
   * A caixa é irregular na origem — `PNEU` e `MANUTENÇÃO` em versal, `Limpa
   * Pautas` e `Modelo de precificação` em caixa mista — e fica como está. Quem
   * procura um bloco procura pelo nome que viu, e uniformizar a caixa aqui
   * tornaria a busca por texto pior sem tornar a tela melhor.
   */
  titulo: string;
  /** A descrição, literal, incluindo os emoji e os erros de digitação de lá. */
  descricao: string;
  /**
   * A descrição foi cortada na captura e o texto acima está incompleto.
   *
   * Existe para não completar frase por conta própria. "das operaçõe…" vira
   * "das operações" com 99% de chance, e é exatamente esse 1% que este produto
   * não gasta: a tela marca o corte e quem tiver a tela de lá aberta completa.
   */
  truncada?: true;
}

/**
 * O que a paginação do Freightech declara no rodapé: "de 66 resultados".
 *
 * Fica separado do `.length` de propósito. São dois números diferentes — o que
 * eles publicam e o que nós transcrevemos — e igualá-los no código apagaria a
 * única evidência de que falta coisa.
 */
export const TOTAL_DECLARADO_FREIGHTECH = 66;

/**
 * Os blocos, na ordem em que a base do Freightech os listava na captura.
 *
 * A ordem não é alfabética nem por categoria, e foi preservada mesmo assim —
 * mas **não confie nela como endereço**. Duas capturas do mesmo dia mostraram a
 * lista deslocada em três posições: PGR, STRESS TEST EMPILHADEIRAS e PLANO DE
 * SAÚDE apareceram em 58-60 numa e em 61-63 na outra. Seja porque blocos
 * entraram no meio, seja porque a ordenação de lá não é determinística, o
 * efeito é o mesmo: "o bloco tal está na página 10" é verdade sobre um
 * instante, não sobre a base.
 *
 * Isto fica escrito porque a suposição contrária custou caro uma vez — a
 * captura da página 11 foi pedida para completar o índice e voltou repetindo
 * três blocos que já estavam aqui, enquanto os três que faltam tinham ido
 * parar na página anterior. A busca desta tela existe justamente para não
 * depender de posição; quem procura um bloco digita o nome.
 */
export const BLOCOS_BOOK: BlocoBook[] = [
  // ---- página 1 ----
  {
    categoria: "Equipamentos",
    titulo: "PNEU",
    descricao:
      "Detalhamento da composição do modelo de remuneração de pneus para as transportadoras nos canais de transporte",
  },
  {
    categoria: "Lucro",
    titulo: "LUCRO - ARMAZÉM",
    descricao:
      "Detalhamento da composição do Lucro remunerado as transportadoras de Armazém via modelo de remuneração",
  },
  {
    categoria: "Funcionalidades do sistema",
    titulo: "Personalização de Tabelas",
    descricao:
      "Configurar tabelas visualizadas no sistema: seleção de colunas visíveis e modelos 💻",
  },
  {
    categoria: "Equipamentos",
    titulo: "CIVF - CONSERVAÇÃO DA IDENTIDADE VISUAL DA FROTA",
    descricao:
      "Aba com detalhamento do processo de conservação da Identidade Visual das frotas do T2",
  },
  {
    categoria: "Geral",
    titulo: "CUSTOS PRÉ-OPERACIONAIS",
    descricao:
      "Detalhamento dos custos que são desembolsados antes do início das operações",
  },
  {
    categoria: "Histórico",
    titulo: "Gestão por Exceção",
    descricao:
      "Dashboard de acompanhamento de indicadores de aderência do 2nd Tier 💁",
  },

  // ---- página 2 ----
  {
    categoria: "Geral",
    titulo: "OUTROS CUSTOS",
    descricao: "Detalhamento do lançamento de custos não planilhados",
  },
  {
    categoria: "Geral",
    titulo: "FECHAMENTOS APOIO, 1st TIER E 2nd TIER",
    descricao:
      "Detalhamento das regras e informações do fluxo de fechamento do Armazém, 1st Tier e 2nd Tier.",
  },
  {
    categoria: "Equipamentos",
    titulo: "CONSUMO",
    descricao:
      "Detalhamento de todas as regras de consumo, metodologia da obtenção dos dados e solução de pagamentos.",
  },
  {
    categoria: "Gente",
    titulo: "DIRETRIZES DE GENTE",
    descricao:
      "Detalhamento da obrigatoriedade da utilização dos sistemas de gestão Ambev conforme diretrizes determinadas",
  },
  {
    categoria: "Gente",
    titulo: "EQUIPE DISTRIBUIÇÃO URBANA",
    descricao:
      "Detalhamento de como é realizado a remuneração da equipe de entrega do T2",
  },
  {
    categoria: "Menu",
    titulo: "Alteração em lote",
    descricao: "Altere um grande conjunto de dados com um único processamento",
  },

  // ---- página 3 ----
  {
    categoria: "Geral",
    titulo: "WORKFLOW DE CHAMADOS",
    descricao:
      "Detalhamento do fluxo e responsáveis pelos chamados do Freightech",
  },
  {
    categoria: "Equipamentos",
    titulo: "CUSTO FIXO DE EQUIPAMENTOS",
    descricao:
      "Detalhamento da composição do modelo de remuneração dos custos fixos dos equipamentos",
  },
  {
    categoria: "Funcionalidades do sistema",
    titulo: "Abertura de chamados",
    descricao: "Como abrir e acompanhar um chamado no Freightech",
  },
  {
    categoria: "Equipamentos",
    titulo: "INCLUSÃO E REMOÇÃO DE EQUIPAMENTOS",
    descricao:
      "Detalhamento de todas as informações necessárias para a inclusão e remoção de equipamentos na planilha de remuneração",
  },
  {
    categoria: "Gente",
    titulo: "BENEFÍCIOS",
    descricao:
      "Detalhamento dos Benefícios Remunerados na planilha de remuneração",
  },
  {
    categoria: "Lucro",
    titulo: "LUCRO - TRANSPORTES T1",
    descricao:
      "Detalhamento da composição do Lucro remunerado as transportadoras de Transportes T1 via modelo de remuneração",
  },

  // ---- página 4 ----
  {
    categoria: "Menu",
    titulo: "Usuário",
    descricao:
      "Passo a passo para a configuração do meu usuário, como senha e unidades de acesso 👤",
  },
  {
    categoria: "Freightech",
    titulo: "Modelo de precificação",
    descricao:
      "Detalhamento do modelo de remuneração acordado de Planilha Aberta entre transportadora e Ambev",
  },
  {
    categoria: "Menu",
    titulo: "Exportação",
    descricao:
      "Extração de dados em massa das tabelas e personalização de modelos de exportação",
  },
  {
    categoria: "Equipamentos",
    titulo: "CONSUMO DE COMBUSTÍVEIS",
    descricao:
      "Detalhamento de como é realizada a atualização do consumo de combustível em cada planilha de remuneração",
  },
  {
    categoria: "Gente",
    titulo: "DESCONTO FALTA DE MOTORISTAS - T1",
    // "contratdo" é como está escrito lá. Corrigir aqui faria a busca por texto
    // divergir da tela de origem sem avisar ninguém.
    descricao:
      "Detalhamento das análise realizadas para o desconto da indisponibilidade de motoristas versus o contratdo para as operações de transportes T1",
  },
  {
    categoria: "Gente",
    titulo: "ENCARGOS E PROVISÕES",
    descricao:
      "Tabela em que detalha todo o cálculo dos Encargos e Provisões que incidem sobre a remuneração final de Gente aos transportadores via modelo de remuneração",
  },

  // ---- página 5 ----
  {
    categoria: "Gente",
    titulo: "QLP ADM",
    descricao:
      "Detalhamento da composição do modelo de remuneração da estrutura administrativa das transportadoras",
  },
  {
    /*
      O bloco que dá nome ao módulo. No Freightech ele é um bloco entre os
      outros, e continua sendo um aqui — promovê-lo a capítulo faria a tela
      deixar de espelhar a de lá logo no item que mais precisa ser reconhecido.
    */
    categoria: "Freightech",
    titulo: "Book do operador",
    descricao:
      "Detalhamento do modelo de negócio assinado em contrato entre Ambev e Transportadoras",
  },
  {
    categoria: "Geral",
    titulo: "DIMENSIONAMENTO 2nd TIER E 3rd TIER",
    descricao:
      "Divulgação oficial e detalhamento das informações do dimensionamento da Rota e ASCD",
  },
  {
    categoria: "Equipamentos",
    titulo: "MANUTENÇÃO",
    descricao:
      "Detalhamento de como é realizada a remuneração do custo variável de manutenção via modelo de remuneração",
  },
  {
    categoria: "Equipamentos",
    titulo: "PREÇO COMBUSTÍVEIS",
    descricao:
      "Detalhamento das regras que regem a atualização do preço remunerado por litro de diesel",
  },
  {
    categoria: "Lucro",
    titulo: "LUCRO - DISTRIBUIÇÃO",
    descricao:
      "Detalhamento da composição do lucro remunerado as transportadoras da Rota e ASCD via modelo de remuneração",
  },

  // ---- página 6 ----
  {
    categoria: "Menu",
    titulo: "Limpa Pautas",
    descricao:
      "Detalhamento do processo de Limpa Pautas no sistema Freightech",
  },
  {
    /*
      Há dois blocos "Outros Custos": este, em Menu, e o de GERAL na página 2.
      São blocos distintos na origem — descrições diferentes, categorias
      diferentes — e continuam dois aqui. Fundi-los daria uma lista mais limpa e
      um mapa errado.
    */
    categoria: "Menu",
    titulo: "Outros Custos",
    descricao: "Descrição do fluxo e regras de negócio",
  },
  {
    categoria: "Funcionalidades do sistema",
    titulo: "Atendimento Chamados NOW",
    descricao:
      "Abertura de fila de chamados do Freightech para atendimento do time de suporte via Service Now",
  },
  {
    categoria: "Equipamentos",
    titulo: "MOVIMENTAÇÃO DE FROTAS",
    descricao:
      "Detalhamento do processo de movimentação de equipamentos dentro do freightech.",
  },
  {
    categoria: "Equipamentos",
    titulo: "STRESS TEST VEICULOS",
    descricao:
      "Aba com detalhamento do processo de Stress Test de Caminhões do T1 e T2",
  },
  {
    categoria: "Equipamentos",
    titulo: "PASSO A PASSO - SISTEMA CIVF",
    descricao:
      "Realizar um checklist com todos os itens de segurança e qualidade de cada equipamento da opera… dias com 6 fotos do veículos",
    truncada: true,
  },

  // ---- página 7 ----
  {
    categoria: "Funcionalidades do sistema",
    titulo: "Criação de usuário",
    descricao: "Passo a passo para criação de novos usuários no sistema 👩",
  },
  {
    categoria: "Gente",
    titulo: "BANCO DE HORAS",
    descricao:
      "Detalhamento da remuneração de Horas Extras nas operações logísticas",
  },
  {
    categoria: "Menu",
    titulo: "Acompanhamento de chamados",
    descricao: "Verificando o status do processamento de chamados",
  },
  {
    categoria: "Geral",
    titulo: "RECARGA",
    descricao:
      "Detalhamento sobre os custos de Recarga remunerados em caso de necessidade",
  },
  {
    categoria: "Histórico",
    titulo: "Aluguel de Frotas | 2nd Tier",
    descricao:
      "Como utilizar o novo módulo de aluguel de caminhões e vans no T2",
  },
  {
    categoria: "Gente",
    titulo: "EQUIPE NOTURNA",
    descricao:
      "Detalhamento de como é realizada a remuneração dos custos das equipes noturnas das operaçõe…",
    truncada: true,
  },

  // ---- página 8 ----
  {
    categoria: "Gente",
    titulo: "DESCONTO QLP ADM",
    descricao:
      "Detalhamento da auditoria do QLP ADM realizada bimestralmente em todas as operações Ambev",
  },
  {
    categoria: "Equipamentos",
    titulo: "ATIVAÇÃO E DESATIVAÇÃO FROTA",
    descricao:
      "Detalhamento da regra de ativação e desativação de frota mensalmente",
  },
  {
    categoria: "Gente",
    titulo: "NEGOCIAÇÕES SINDICAIS",
    descricao: "Detalhamento do processo de negociação sindical",
  },
  {
    categoria: "Gente",
    titulo: "TURN OVER",
    descricao:
      "Detalhamento da remuneração dos valores de turn over das operações",
  },
  {
    /*
      "Sem categoria" é o rótulo que o Freightech imprime, não a nossa forma de
      dizer que não sabemos. Fica literal, e a tela filtra por ele como por
      qualquer outro.
    */
    categoria: "Sem categoria",
    titulo: "Histórico de chamados",
    descricao: "Como consultar o histórico de chamados 📁",
  },
  {
    categoria: "Menu",
    titulo: "Chamados: Aprovações",
    descricao: "Processando múltiplos chamados de uma vez",
  },

  // ---- página 9 ----
  {
    categoria: "Controle Estoques",
    titulo: "Padrões de Controle",
    descricao: "Detalhamento dos fluxos descontos de Controle de Estoques",
  },
  {
    categoria: "Gente",
    titulo: "EQUIPE ARMAZÉM",
    descricao:
      "Detalhamento de como é realizada a remuneração da equipe operacional de Armazém",
  },
  {
    categoria: "Equipamentos",
    titulo: "EMPILHADEIRAS",
    descricao:
      "Detalhamento das informações relacionadas ao modelo de remuneração das Empilhadeiras via modelo de remuneração",
  },
  {
    categoria: "Gente",
    titulo: "UNIFORME E EPIs",
    descricao:
      "Detalhamento da composição da remuneração dos EPIs dentro da remuneração",
  },
  {
    categoria: "Gente",
    titulo: "EQUIPE DE TRANSPORTES - T1",
    descricao:
      "Detalhamento de como é realizada a remuneração da equipe de transportes do T1",
  },
  {
    categoria: "Histórico",
    titulo: "Transferências",
    descricao: "Como funciona transferir frotas entre unidades",
  },

  // ---- página 10 ----
  {
    categoria: "Histórico",
    titulo: "Manual Scorecard Operadores 2024",
    descricao: "Manual Completo - MCRS e Scorecard",
  },
  {
    categoria: "Equipamentos",
    titulo: "DISPONIBILIDADE - ARMAZÉM",
    descricao:
      "Detalhamento do modelo de apuração da disponibilidade de empilhadeiras",
  },
  {
    categoria: "Equipamentos",
    titulo: "EMPRESTIMO DE FROTA T1",
    descricao: "Padrão paliativo",
  },
  {
    categoria: "Geral",
    titulo: "PGR - Plano de Gerenciamento de Risco (TRANSPORTADORAS)",
    descricao: "Esse bloco objetiva compartilhar o PGR AMBEV",
  },
  {
    categoria: "Equipamentos",
    titulo: "STRESS TEST EMPILHADEIRAS",
    descricao:
      "Aba com detalhamento do processo de Stress Test de Empilhadeiras do T1 e T2",
  },
  {
    categoria: "Gente",
    titulo: "PLANO DE SAÚDE",
    descricao:
      "Detalhamento da composição do modelo de remuneração do Plano de Saúde em todos os canais de transporte",
  },

  // ---- página 11 (parcial: 3 dos 6) ----
  {
    categoria: "Menu",
    titulo: "Outros Custos (Empurrada)",
    descricao:
      "Descrição do fluxo de outros custos de empurrada, regras de negócio, evidências e templates obrigatórios",
  },
  {
    categoria: "Vale Pedágio",
    titulo: "BOOK VALE PEDÁGIO",
    descricao: "MANUAL VALE PEDÁGIO",
  },
  {
    categoria: "Menu",
    titulo: "Outros Custos (Insumos)",
    descricao:
      "Descrição do fluxo, regras de negócio, evidências e templates obrigatórios",
  },
];

/**
 * As categorias, na ordem da primeira aparição.
 *
 * Alfabética seria arbitrária de outro jeito: a ordem de aparição preserva
 * quais categorias dominam o começo da base, que é informação sobre a origem.
 */
export function categoriasDoBook(): string[] {
  const vistas: string[] = [];
  for (const bloco of BLOCOS_BOOK) {
    if (!vistas.includes(bloco.categoria)) vistas.push(bloco.categoria);
  }
  return vistas;
}

/** A chave estável de um bloco — para favoritar sem depender da posição. */
export function chaveDoBloco(bloco: BlocoBook): string {
  return `${bloco.categoria}::${bloco.titulo}`;
}

/** Busca sem acento e sem caixa, igual à da lateral. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
