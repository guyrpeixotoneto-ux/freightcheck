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
 * **Este arquivo é só o índice.** Categoria, título e descrição de cada bloco,
 * transcritos da tela do Freightech. O **conteúdo** — a regra em si — não mora
 * aqui: é registrado no produto, em `book_entry`, escrito como texto ou anexado
 * como documento. Um bloco sem regra registrada continua aparecendo, dizendo
 * que está vazio; o índice sozinho já vale, porque nomeia o assunto de cada
 * regra no vocabulário de quem vai procurá-la.
 *
 * **Por que o índice mora na interface, e não no banco.** Mesma razão do
 * `freightech-catalogo.ts` ao lado: este é o mapa do sistema de origem, não uma
 * projeção dos nossos fatos. Ele precisa existir com o banco vazio, que é
 * justamente quando a pessoa está tentando descobrir o que pedir. O conteúdo,
 * esse sim, tem tabela, migration e rota.
 *
 * **Fonte.** Base de blocos do Freightech, capturada em 13/08/2026, ordenada
 * como lá (6 por página, 11 páginas). São **66 registros e 63 títulos
 * distintos**: PGR, STRESS TEST EMPILHADEIRAS e PLANO DE SAÚDE aparecem duas
 * vezes na base, em 58-60 e de novo em 61-63.
 *
 * **A repetição foi mantida, e isso não é descuido.** O primeiro impulso — e o
 * errado — é deduplicar: a lista fica mais limpa e passa a descrever uma base
 * que não existe. São dois registros lá, cada um capaz de receber o seu
 * documento, e fundi-los faria o segundo herdar o conteúdo do primeiro sem
 * ninguém perceber. Quem quiser conferir contra a tela de origem precisa
 * encontrar aqui o mesmo número de cartões que conta lá.
 *
 * `TOTAL_DECLARADO_FREIGHTECH` continua como constante separada da contagem do
 * array. Hoje as duas batem; ela existe para o dia em que pararem de bater, que
 * é quando o índice precisa dizer isso em voz alta em vez de calar.
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
  /**
   * A posição desta aparição quando o mesmo bloco existe mais de uma vez na
   * base — `2` na segunda, ausente na primeira.
   *
   * É o que faz `chaveDoBloco` devolver chaves diferentes para cartões
   * idênticos. Sem isto, os dois PLANO DE SAÚDE dividiriam o mesmo endereço no
   * banco: enviar o documento num deles o faria aparecer no outro, e a tela
   * mostraria como conteúdo de um bloco o que foi anexado a outro — exatamente
   * o tipo de número sem lastro que este produto existe para não exibir.
   *
   * A primeira aparição fica **sem** o campo, de propósito: a chave dela
   * continua sendo `"Categoria::Título"`, e os documentos já enviados antes de
   * este campo existir continuam achando o bloco a que pertencem.
   */
  ocorrencia?: number;
}

/**
 * O que a paginação do Freightech declara no rodapé: "de 66 resultados".
 *
 * Fica separado do `.length` de propósito, mesmo agora que os dois batem. São
 * duas afirmações diferentes — o que eles publicam e o que nós transcrevemos —
 * e escrever `BLOCOS_BOOK.length` no lugar desta constante faria a tela
 * concordar consigo mesma para sempre, inclusive no dia em que a base de lá
 * ganhar um bloco. A divergência entre as duas é o alarme; um alarme que se
 * ajusta sozinho ao que está sendo medido não toca nunca.
 */
export const TOTAL_DECLARADO_FREIGHTECH = 66;

/**
 * Os blocos, na ordem em que a base do Freightech os lista.
 *
 * A ordem não é alfabética nem por categoria, e foi preservada mesmo assim:
 * quem já usa a base de lá navega por posição, e reordenar aqui trocaria um
 * mapa fiel por um mapa arrumado.
 *
 * **Uma leitura errada que vale registrar.** Ver PGR, STRESS TEST
 * EMPILHADEIRAS e PLANO DE SAÚDE nas posições 58-60 e de novo em 61-63 parece
 * paginação instável — a mesma linha exibida duas vezes na virada da página. A
 * conclusão foi tirada aqui uma vez e estava errada: a ordem é estável, e a
 * base é que tem esses três registros em duplicidade. As duas hipóteses geram a
 * mesma tela e conclusões opostas — uma diz que faltam 3 blocos, a outra que
 * não falta nenhum —, e só quem tem a tela de origem aberta consegue
 * distinguir. Quando a contagem não bater de novo, pergunte antes de deduzir.
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

  // ---- página 11 ----
  /*
    As três repetições da base. Mesma categoria, mesmo título e mesma descrição
    dos registros de 58-60 logo acima; o que muda é `ocorrencia`, e é só isso que
    separa o documento de um do documento do outro.
  */
  {
    categoria: "Geral",
    titulo: "PGR - Plano de Gerenciamento de Risco (TRANSPORTADORAS)",
    descricao: "Esse bloco objetiva compartilhar o PGR AMBEV",
    ocorrencia: 2,
  },
  {
    categoria: "Equipamentos",
    titulo: "STRESS TEST EMPILHADEIRAS",
    descricao:
      "Aba com detalhamento do processo de Stress Test de Empilhadeiras do T1 e T2",
    ocorrencia: 2,
  },
  {
    categoria: "Gente",
    titulo: "PLANO DE SAÚDE",
    descricao:
      "Detalhamento da composição do modelo de remuneração do Plano de Saúde em todos os canais de transporte",
    ocorrencia: 2,
  },
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

/**
 * A chave estável de um bloco — o endereço dele nos favoritos e no banco.
 *
 * `"Categoria::Título"`, com `#2` no fim quando a base repete o bloco. O
 * sufixo só aparece a partir da segunda aparição, e não é economia de
 * caracteres: as chaves gravadas antes de a repetição ser descoberta são as
 * sem sufixo, e mudá-las agora desligaria cada documento já enviado do cartão
 * a que ele pertence.
 */
export function chaveDoBloco(bloco: BlocoBook): string {
  const base = `${bloco.categoria}::${bloco.titulo}`;
  return bloco.ocorrencia && bloco.ocorrencia > 1
    ? `${base}#${bloco.ocorrencia}`
    : base;
}

/** Busca sem acento e sem caixa, igual à da lateral. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
