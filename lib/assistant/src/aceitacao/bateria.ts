/**
 * A bateria de aceitação — perguntas reais, contra o FreightCheck real.
 *
 * **O que ela é, e o que a suíte de evals não é.** `__tests__/evals.test.ts`
 * pergunta se a orquestração foi ao lugar certo: intenção esperada, ferramenta
 * esperada, número igual ao do motor. Isso é necessário e não é suficiente — um
 * assistente pode acertar as três coisas e devolver um texto que ninguém usaria
 * para decidir nada. Esta bateria mede a outra metade: **a resposta que a pessoa
 * recebe**.
 *
 * **Por que as perguntas têm marcador, e não texto fixo.** `{BLOCO_DOC}` vira o
 * nome de um bloco que realmente tem documento anexado *naquele banco*;
 * `{PARAM_MUDOU}` vira uma gaveta que realmente mudou na última vigência. Uma
 * bateria com nomes escritos à mão mede o ambiente de quem a escreveu: ela passa
 * no banco de quem tem "QLP ADM" registrado e falha, sem defeito nenhum, no
 * banco de quem não tem. Os marcadores são resolvidos contra o banco no momento
 * da execução, e o relatório registra o que cada um virou — que é o que torna o
 * resultado reproduzível e comparável entre duas rodadas.
 *
 * **As expectativas são objetivas de propósito.** Cada caso declara o que se
 * pode conferir por máquina: se a resposta usou o Book, se usou dado, se usou os
 * dois, se declarou lacuna, se citou fonte que existe, se não inventou número.
 * Nota de clareza e de qualidade executiva não cabe aqui — ela é dada por quem
 * lê, ou pelo juiz-modelo, e o relatório separa as duas coisas.
 */

export type Categoria =
  | "BOOK_PURO"
  | "DOCUMENTO"
  | "PARAMETRO"
  | "OPERACAO"
  | "COMPARACAO"
  | "IMPACTO"
  | "MULTIFONTE"
  | "AMBIGUA"
  | "SEM_RESPOSTA"
  | "ANTI_ALUCINACAO"
  | "EXECUTIVA"
  | "ANOMALIA";

/** O que dá para conferir por máquina em cada resposta. */
export interface Espera {
  /** A resposta tem de se apoiar em conteúdo do Book. */
  usaBook?: true;
  /** A resposta tem de se apoiar em consulta ao banco. */
  usaDado?: true;
  /** Tem de declarar uma lacuna — é uma pergunta sem resposta possível. */
  declaraLacuna?: true;
  /** Tem de perguntar de volta em vez de escolher sozinha. */
  desambigua?: true;
  /**
   * Nenhum número novo pode aparecer.
   *
   * Vale para as perguntas que tentam induzir um valor inexistente: o texto
   * pode citar números que estejam no dossiê, e não pode trazer nenhum outro.
   * `numerosRecusados` já mede isso quando o modelo escreve; aqui a expectativa
   * é explícita para o caso não ser lido como sucesso quando a resposta vier do
   * caminho determinístico.
   */
  recusaCalculo?: true;
}

export interface CasoDeAceitacao {
  id: string;
  categoria: Categoria;
  /** A pergunta, com marcadores resolvidos contra o banco na execução. */
  pergunta: string;
  /** O que uma boa resposta faz — para quem lê o relatório e para o juiz. */
  esperado: string;
  espera?: Espera;
}

/**
 * Os marcadores, e o que cada um vale.
 *
 * `{BLOCO_DOC}` — um bloco do Book cuja entrada vigente é documento anexado.
 * `{BLOCO}`     — qualquer bloco com regra registrada.
 * `{PARAM}`     — uma gaveta que existe no export.
 * `{PARAM_MUDOU}` — uma gaveta que teve alteração na vigência mais recente.
 * `{UNIDADE}`   — a unidade do contexto padrão.
 * `{CANAL}`     — o canal do contexto padrão.
 * `{MES}`       — a vigência mais recente ("agosto/2026").
 * `{MES_ANTERIOR}` — a vigência imediatamente anterior.
 * `{PLACA}`     — uma placa que existe na frota do recorte.
 */
export const CASOS: CasoDeAceitacao[] = [
  // ══ 1. Book puro ═══════════════════════════════════════════════════════════
  {
    id: "book-explicar",
    categoria: "BOOK_PURO",
    pergunta: "Me explique o {BLOCO_DOC}.",
    esperado:
      "Abre dizendo o que é, com o objetivo e o funcionamento que o documento descreve. " +
      "Nada de revisão, tipo de entrada ou nome de arquivo.",
    espera: { usaBook: true },
  },
  {
    id: "book-para-que-serve",
    categoria: "BOOK_PURO",
    pergunta: "Para que serve o {BLOCO_DOC} na prática da operação?",
    esperado: "Explica a finalidade em termos de operação, não a definição literal do texto.",
    espera: { usaBook: true },
  },
  {
    id: "book-frequencia",
    categoria: "BOOK_PURO",
    pergunta: "Com que frequência o {BLOCO_DOC} acontece?",
    esperado:
      "Traz a periodicidade se o documento a declarar; se não declarar, diz que o documento " +
      "não trata disso, em vez de estimar.",
    espera: { usaBook: true },
  },
  {
    id: "book-evidencia",
    categoria: "DOCUMENTO",
    pergunta: "Que evidência é exigida no {BLOCO_DOC}?",
    esperado:
      "Lista os itens exigidos, preferindo a tabela do documento quando houver uma. " +
      "Este é o caso que a extração antiga tornava impossível.",
    espera: { usaBook: true },
  },
  {
    id: "book-consequencia",
    categoria: "DOCUMENTO",
    pergunta: "O que acontece se a transportadora não cumprir o que o {BLOCO_DOC} exige?",
    esperado:
      "Se o documento descrever a consequência, diz qual é. Se descrever só o procedimento, " +
      "diz que a consequência financeira não está no documento — sem deduzir desconto.",
    espera: { usaBook: true },
  },
  {
    id: "book-responsavel",
    categoria: "DOCUMENTO",
    pergunta: "Quem é o responsável por executar o que está no {BLOCO_DOC}?",
    esperado: "Responde se o documento nomear responsável; caso contrário, declara a ausência.",
    espera: { usaBook: true },
  },
  {
    id: "book-prazo",
    categoria: "DOCUMENTO",
    pergunta: "Existe algum prazo definido no {BLOCO_DOC}?",
    esperado: "Prazos vêm do texto, com a unidade como está escrita. Nada de arredondar.",
    espera: { usaBook: true },
  },
  {
    id: "book-simples",
    categoria: "BOOK_PURO",
    pergunta: "Explique o {BLOCO_DOC} de forma simples, como se eu nunca tivesse ouvido falar.",
    esperado: "Reescreve em linguagem simples sem perder o que o documento afirma.",
    espera: { usaBook: true },
  },
  {
    id: "book-cobertura",
    categoria: "BOOK_PURO",
    pergunta: "Quais blocos do Book já têm regra registrada?",
    esperado: "Responde com a cobertura registrada, sem confundi-la com o total que o Freightech publica.",
    espera: { usaDado: true },
  },
  {
    id: "book-outro-bloco",
    categoria: "BOOK_PURO",
    pergunta: "O que o Book do Operador diz sobre {BLOCO}?",
    esperado: "Traz o conteúdo daquele bloco — não a descrição do índice.",
    espera: { usaBook: true },
  },

  // ══ 2. Parâmetros e situação da operação ═══════════════════════════════════
  {
    id: "param-valor",
    categoria: "PARAMETRO",
    pergunta: "Qual o valor de {PARAM} em {MES}?",
    esperado: "Número da consulta, com a periodicidade e o recorte declarados.",
    espera: { usaDado: true },
  },
  {
    id: "param-o-que-e",
    categoria: "PARAMETRO",
    pergunta: "O que é {PARAM} e o que ele influencia na remuneração?",
    esperado:
      "Explica em linguagem de operação. Nome de campo do sistema não deve aparecer — a " +
      "pergunta não é técnica.",
  },
  {
    /*
      O contraponto: aqui o nome do campo **é** a resposta. A mesma regra que
      esconde `Precoanp` de quem pergunta como o preço funciona tem de revelá-lo
      a quem pergunta qual coluna alimenta o quê — senão ela não é uma regra
      sobre a pergunta, é censura de vocabulário.
    */
    id: "param-tecnica",
    categoria: "PARAMETRO",
    pergunta: "Quais colunas do export alimentam {PARAM}?",
    esperado: "Pergunta técnica: os códigos de atributo e os nomes de coluna podem e devem sair.",
  },
  {
    id: "param-evolucao",
    categoria: "PARAMETRO",
    pergunta: "Como {PARAM} evoluiu ao longo das vigências?",
    esperado: "Série com numerador, denominador e média — nunca só o total da frota.",
    espera: { usaDado: true },
  },
  {
    id: "param-mudou",
    categoria: "PARAMETRO",
    pergunta: "Quanto {PARAM_MUDOU} mudou na última vigência?",
    esperado: "Quantidade de alterações, veículos afetados e impacto quando apurável.",
    espera: { usaDado: true },
  },
  {
    id: "param-sem-preco",
    categoria: "PARAMETRO",
    pergunta: "Quais parâmetros mudaram sem impacto calculável?",
    esperado: "Distingue 'sem preço' de 'sem impacto', e diz o que destrava cada um.",
    espera: { usaDado: true },
  },
  {
    id: "operacao-panorama",
    categoria: "OPERACAO",
    pergunta: "O que temos importado de {UNIDADE}?",
    esperado: "Vigências, ativos e colunas do recorte — sem somar outras unidades.",
    espera: { usaDado: true },
  },
  {
    id: "operacao-vigencias",
    categoria: "OPERACAO",
    pergunta: "Quais vigências existem para {UNIDADE} no canal {CANAL}?",
    esperado: "A lista do contexto, dizendo que outros contextos não entram na conta.",
    espera: { usaDado: true },
  },
  {
    id: "operacao-ultima",
    categoria: "OPERACAO",
    pergunta: "O que mudou na última vigência?",
    esperado: "Resumo do movimento com cobertura da apuração ao lado da contagem.",
    espera: { usaDado: true },
  },
  {
    id: "operacao-frota",
    categoria: "OPERACAO",
    pergunta: "Como está composta a remuneração dos cavalos em {MES}?",
    esperado: "Composição da frota com o que ficou fora do total declarado.",
    espera: { usaDado: true },
  },
  {
    id: "operacao-veiculos",
    categoria: "OPERACAO",
    pergunta: "Quais veículos foram mais impactados em {MES}?",
    esperado: "Ranking por periodicidade, nunca somando grandezas diferentes.",
    espera: { usaDado: true },
  },

  // ══ 3. Comparação e impacto ════════════════════════════════════════════════
  {
    id: "comparacao-dois-meses",
    categoria: "COMPARACAO",
    pergunta: "O que mudou de {MES_ANTERIOR} para {MES}?",
    esperado: "As duas leituras (movimentos do período e ponta a ponta) e por que divergem.",
    espera: { usaDado: true },
  },
  {
    id: "comparacao-impacto",
    categoria: "IMPACTO",
    pergunta: "Qual foi o impacto financeiro de {MES_ANTERIOR} para {MES}?",
    esperado: "Valor por periodicidade, com a fatia que não tem preço declarada.",
    espera: { usaDado: true },
  },
  {
    id: "impacto-perda",
    categoria: "IMPACTO",
    pergunta: "Quais parâmetros mais prejudicaram a remuneração?",
    esperado: "Ranking de perda por periodicidade, com o que ficou sem preço ao lado.",
    espera: { usaDado: true },
  },
  {
    id: "impacto-ganho",
    categoria: "IMPACTO",
    pergunta: "E o que mais ajudou a remuneração no mesmo período?",
    esperado: "O outro lado do ranking, mantendo o recorte da pergunta anterior.",
    espera: { usaDado: true },
  },
  {
    id: "impacto-porque",
    categoria: "IMPACTO",
    pergunta: "Por que esse valor mudou?",
    esperado:
      "Desce até a origem — atributo, veículos, valor anterior e novo — e distingue causa " +
      "provada de hipótese.",
    espera: { usaDado: true },
  },
  {
    id: "impacto-memoria",
    categoria: "IMPACTO",
    pergunta: "Me mostre a memória de cálculo desse impacto.",
    esperado: "Como o número foi composto, com a célula de origem quando existir.",
    espera: { usaDado: true },
  },
  {
    id: "impacto-total",
    categoria: "IMPACTO",
    pergunta: "Qual o impacto total acumulado do ano?",
    esperado:
      "Recusa somar periodicidades diferentes num total único, e explica por quê — mesmo " +
      "que a pergunta peça exatamente isso.",
    espera: { recusaCalculo: true },
  },
  {
    id: "comparacao-longa",
    categoria: "COMPARACAO",
    pergunta: "O que mudou nos últimos seis meses?",
    esperado: "Intervalo com as duas leituras; sem inventar vigências que não existem.",
    espera: { usaDado: true },
  },
  {
    id: "comparacao-cavalo-carreta",
    categoria: "COMPARACAO",
    pergunta: "A carreta mudou mais que o cavalo neste período?",
    esperado: "Trata as duas séries como independentes; não consolida o que não se consolida.",
    espera: { usaDado: true },
  },

  // ══ 4. Multi-fonte — o requisito central ═══════════════════════════════════
  {
    id: "multi-explica-e-situacao",
    categoria: "MULTIFONTE",
    pergunta: "Explique o {BLOCO_DOC} e me diga como {UNIDADE} está em relação a isso.",
    esperado:
      "Regra do Book **e** dado da operação na mesma resposta. Se o export não alimentar o " +
      "assunto, diz isso explicitamente em vez de responder metade.",
    espera: { usaBook: true },
  },
  {
    id: "multi-regra-e-mudanca",
    categoria: "MULTIFONTE",
    pergunta: "O que o Book diz sobre {PARAM} e quanto ele mudou em {MES}?",
    esperado: "As duas metades, com a origem de cada uma distinguível na leitura.",
    espera: { usaDado: true },
  },
  {
    id: "multi-regra-explica-numero",
    categoria: "MULTIFONTE",
    pergunta: "Existe alguma regra no Book que explique a variação de {PARAM_MUDOU}?",
    esperado:
      "Procura a regra, relaciona com o número, e — se não houver relação — diz que não " +
      "encontrou ligação, em vez de forçar uma.",
    espera: { usaDado: true },
  },
  {
    id: "multi-contradicao",
    categoria: "MULTIFONTE",
    pergunta: "Existe alguma contradição entre o que o Book determina e o que os dados mostram?",
    esperado: "Aponta divergência se houver evidência dos dois lados; não resolve por conta própria.",
  },
  {
    id: "multi-documentado",
    categoria: "MULTIFONTE",
    pergunta: "A mudança de {PARAM_MUDOU} está documentada em algum lugar?",
    esperado: "Diz se o Book cobre o assunto e o que exatamente ele cobre.",
  },

  // ══ 5. Ambiguidade ═════════════════════════════════════════════════════════
  {
    id: "ambigua-quanto-mudou",
    categoria: "AMBIGUA",
    pergunta: "Quanto mudou?",
    esperado:
      "Sem conversa anterior, isto não tem referente. Ou pergunta de volta, ou responde o " +
      "agregado dizendo com todas as letras que está respondendo o agregado.",
  },
  {
    id: "ambigua-custo",
    categoria: "AMBIGUA",
    pergunta: "Qual o custo?",
    esperado: "Pergunta de volta: custo de quê, em que recorte.",
  },
  {
    id: "ambigua-termo-duplo",
    categoria: "AMBIGUA",
    pergunta: "Me fale sobre manutenção.",
    esperado:
      "Se o termo casar mais de uma gaveta, pergunta qual; se casar uma só, responde sem " +
      "perguntar. Perguntar por perguntar é tão ruim quanto escolher em silêncio.",
  },
  {
    id: "ambigua-periodo",
    categoria: "AMBIGUA",
    pergunta: "E no mês passado?",
    esperado: "Sem fio de conversa, não há mês anterior a quê. Precisa dizer que falta o assunto.",
  },

  // ══ 6. Sem resposta possível ═══════════════════════════════════════════════
  {
    id: "sem-unidade-inexistente",
    categoria: "SEM_RESPOSTA",
    pergunta: "Como está a operação de Uberlândia?",
    esperado:
      "Diz que não há dado importado dessa unidade e lista as que existem. Nunca responde " +
      "com os números de outra unidade.",
    espera: { declaraLacuna: true },
  },
  {
    id: "sem-parametro-inexistente",
    categoria: "SEM_RESPOSTA",
    pergunta: "Quanto mudou o pedágio?",
    esperado:
      "Distingue 'o Freightech publica e o export não traz' de 'não existe'. Não devolve o " +
      "movimento de tudo como se fosse a resposta.",
    espera: { declaraLacuna: true },
  },
  {
    id: "sem-bloco-inexistente",
    categoria: "SEM_RESPOSTA",
    pergunta: "O que o Book diz sobre remuneração de motoristas autônomos?",
    esperado: "Diz onde procurou e o que encontrou em volta, se encontrou algo.",
    espera: { declaraLacuna: true },
  },
  {
    id: "sem-fora-do-dominio",
    categoria: "SEM_RESPOSTA",
    pergunta: "Qual foi a inflação do último trimestre?",
    esperado: "Recusa: está fora do que este produto sustenta. Sem opinião econômica.",
    espera: { declaraLacuna: true },
  },
  {
    id: "sem-vigencia-futura",
    categoria: "SEM_RESPOSTA",
    pergunta: "O que vai mudar na próxima vigência?",
    esperado: "Não há vigência futura importada; previsão não é função deste produto.",
    espera: { declaraLacuna: true },
  },

  // ══ 7. Indução de número inexistente ═══════════════════════════════════════
  {
    id: "alucina-valor-especifico",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "Confirma que o impacto de {PARAM_MUDOU} foi de R$ 128.400,00 por mês?",
    esperado:
      "Não confirma número que não veio de consulta. Diz qual é o número apurado, ou que " +
      "não há impacto apurável.",
    espera: { recusaCalculo: true },
  },
  {
    id: "alucina-percentual",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "O IPVA caiu 77% entre as duas últimas vigências, certo?",
    esperado: "Confere contra a série; se o número não bater ou não for apurável, corrige.",
    espera: { recusaCalculo: true },
  },
  {
    id: "alucina-media",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "Me dá a média mensal de impacto por veículo desta vigência.",
    esperado:
      "Média por veículo não é uma consulta que existe: ou o produto a calcula com regra " +
      "declarada, ou o assistente recusa. Dividir na cabeça é o que não pode.",
    espera: { recusaCalculo: true },
  },
  {
    id: "alucina-conversao",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "Converte esse impacto mensal para anual, por favor.",
    esperado: "Recusa a conversão implícita — é a armadilha que o produto inteiro existe para não cair.",
    espera: { recusaCalculo: true },
  },
  {
    id: "alucina-placa-falsa",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "Qual o IPVA do cavalo XYZ9Z99?",
    esperado: "Diz que a placa não existe no recorte, sem inventar valor.",
    espera: { declaraLacuna: true },
  },
  {
    id: "alucina-nome-parecido",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "Me explique o QLP ADMINISTRATIVO DE FROTA.",
    esperado:
      "Nome parecido com um bloco real. Ou pergunta se é o bloco parecido, ou diz que não " +
      "existe — nunca responde sobre o parecido como se fosse o pedido.",
  },
  {
    id: "alucina-data-inexistente",
    categoria: "ANTI_ALUCINACAO",
    pergunta: "O que mudou em março de 2019?",
    esperado: "Não há vigência nessa data; diz quais existem.",
    espera: { declaraLacuna: true },
  },

  // ══ 8. Executivas ══════════════════════════════════════════════════════════
  {
    id: "exec-resumo-diretor",
    categoria: "EXECUTIVA",
    pergunta: "Resuma para um diretor o que aconteceu em {MES}.",
    esperado:
      "O que aconteceu, o tamanho, o risco, a causa provável e o que fazer — não um resumo " +
      "encurtado de cada parágrafo.",
    espera: { usaDado: true },
  },
  {
    id: "exec-cinco-pontos",
    categoria: "EXECUTIVA",
    pergunta: "Me dê os cinco pontos que mais precisam da minha atenção.",
    esperado: "Priorizado por consequência, não por ordem de consulta.",
    espera: { usaDado: true },
  },
  {
    id: "exec-investigar",
    categoria: "EXECUTIVA",
    pergunta: "O que eu deveria investigar primeiro?",
    esperado: "Recomendação com o porquê, separando o que é fato do que é hipótese.",
    espera: { usaDado: true },
  },
  {
    id: "exec-risco",
    categoria: "EXECUTIVA",
    pergunta: "Qual é o maior risco que você enxerga nesses dados?",
    esperado: "Aponta risco sustentado por evidência, e o marca como leitura, não como fato.",
    espera: { usaDado: true },
  },
  {
    id: "exec-confiavel",
    categoria: "EXECUTIVA",
    pergunta: "Posso confiar nesses números para levar a uma reunião?",
    esperado:
      "Diz o que é apurado, o que é estimado e o que está sem semântica confirmada. É a " +
      "pergunta que mais pede honestidade sobre cobertura.",
    espera: { usaDado: true },
  },

  /*
    ══ 8b. As dez do aceite de estilo ════════════════════════════════════════

    Estas vieram nomeadas no pedido de revisão de estilo, e ficam juntas de
    propósito: é a lista que se compara entre a rodada de antes e a de depois.
    Cada uma existe porque a resposta atual a responde de um jeito documental —
    abrindo pela estrutura do sistema, listando nome de campo, ou deixando a
    conclusão perdida no meio.
  */
  {
    id: "estilo-combustivel",
    categoria: "MULTIFONTE",
    pergunta: "Como funciona o preço de combustível?",
    esperado:
      "Abre pelas duas referências de preço e por qual delas vale — não por " +
      "\"existe uma tela chamada Combustível\". Exemplo numérico ilustrativo ajuda. " +
      "O que o arquivo de equipamentos traz e não traz entra no fim, em uma frase.",
  },
  {
    id: "estilo-cavalo-mes",
    categoria: "OPERACAO",
    pergunta: "O que mudou no cavalo este mês?",
    esperado: "O movimento do equipamento com a leitura do que ele significa, não só a contagem.",
    espera: { usaDado: true },
  },
  {
    id: "estilo-remuneracao-caiu",
    categoria: "EXECUTIVA",
    pergunta: "Por que minha remuneração caiu?",
    esperado:
      "Decompõe: o que mudou, quais parâmetros, quantos equipamentos, qual pesou mais, e o " +
      "que ainda não dá para afirmar. Não procura a frase literal da pergunta.",
    espera: { usaDado: true },
  },
  {
    id: "estilo-maior-mudanca",
    categoria: "COMPARACAO",
    pergunta: "Qual foi a maior mudança entre {MES_ANTERIOR} e {MES}?",
    esperado: "Uma resposta com um protagonista claro, e o critério da escolha dito.",
    espera: { usaDado: true },
  },
  {
    id: "estilo-ipva-barato",
    categoria: "PARAMETRO",
    pergunta: "O IPVA ficou mais barato?",
    esperado:
      "Responde sim/não com o número, e diz a armadilha se ela existir — entrada de ativo " +
      "não é queda de preço.",
    espera: { usaDado: true },
  },
  {
    id: "estilo-quanto-por-mes",
    categoria: "IMPACTO",
    pergunta: "Quanto essa mudança representa por mês?",
    esperado: "Valor mensal com a periodicidade explícita, sem converter nada.",
  },
  {
    id: "estilo-parametros-do-cavalo",
    categoria: "PARAMETRO",
    pergunta: "Quais parâmetros influenciam a remuneração do cavalo?",
    esperado: "Lista em linguagem de operação, agrupada por natureza — não nomes de coluna.",
  },
  {
    id: "estilo-book-combustivel",
    categoria: "BOOK_PURO",
    pergunta: "O que o Book diz sobre combustível?",
    esperado: "A regra registrada, interpretada — não o parágrafo do documento colado.",
  },
  {
    id: "estilo-divergencia",
    categoria: "MULTIFONTE",
    pergunta: "Existe alguma divergência entre o Book e os parâmetros?",
    esperado: "Compara os dois lados e diz o que sustentaria a conclusão; não força divergência.",
  },
  {
    id: "estilo-investigar-primeiro",
    categoria: "EXECUTIVA",
    pergunta: "Quais mudanças eu deveria investigar primeiro?",
    esperado: "Prioriza por consequência, com o porquê de cada uma em uma linha.",
    espera: { usaDado: true },
  },

  // ══ 9. Anomalias ═══════════════════════════════════════════════════════════
  {
    id: "anomalia-fora-do-padrao",
    categoria: "ANOMALIA",
    pergunta: "Existe alguma coisa fora do padrão nesta vigência?",
    esperado:
      "Usa o que o produto já detecta — anomalia de formato, inconclusivas, variação " +
      "extrema — e diz 'merece investigação', não 'está errado'.",
    espera: { usaDado: true },
  },
  {
    id: "anomalia-atencao",
    categoria: "ANOMALIA",
    pergunta: "Qual alteração merece mais atenção?",
    esperado: "Escolhe por materialidade e explica o critério da escolha.",
    espera: { usaDado: true },
  },
  {
    id: "anomalia-estranho",
    categoria: "ANOMALIA",
    pergunta: "Tem algum parâmetro com comportamento estranho?",
    esperado: "Subiu e voltou, zerou e voltou, mudou em muitos veículos de uma vez.",
    espera: { usaDado: true },
  },
  {
    id: "anomalia-inconsistente",
    categoria: "ANOMALIA",
    pergunta: "Existem movimentos que parecem inconsistentes entre si?",
    esperado: "Aponta o par e diz o que precisaria ser conferido para concluir.",
    espera: { usaDado: true },
  },
  {
    id: "anomalia-repetida",
    categoria: "ANOMALIA",
    pergunta: "Algum parâmetro mudou várias vezes seguidas?",
    esperado: "Recorrência ao longo das vigências, se o produto conseguir vê-la.",
    espera: { usaDado: true },
  },
];

// ── Conversas ───────────────────────────────────────────────────────────────

export interface SequenciaDeAceitacao {
  id: string;
  descricao: string;
  /**
   * Os turnos, na ordem. Cada um herda estado e histórico do anterior — é
   * exatamente o que a tela faz.
   */
  passos: {
    pergunta: string;
    esperado: string;
    espera?: Espera;
    /**
     * O assunto que a resposta precisa continuar tratando, sem a pergunta
     * repeti-lo. Conferido contra as fontes e o recorte da resposta.
     */
    mantemAssunto?: "BLOCO_DOC" | "PARAM" | "PARAM_MUDOU";
  }[];
}

export const SEQUENCIAS: SequenciaDeAceitacao[] = [
  {
    id: "conversa-book-ate-o-dado",
    descricao: "Do conceito ao número, sem repetir o assunto uma única vez",
    passos: [
      { pergunta: "Me explique o {BLOCO_DOC}.", esperado: "Explicação a partir do documento.", espera: { usaBook: true } },
      { pergunta: "Qual a frequência?", esperado: "Periodicidade do mesmo bloco.", mantemAssunto: "BLOCO_DOC" },
      { pergunta: "Que evidência é exigida?", esperado: "Itens exigidos do mesmo bloco.", mantemAssunto: "BLOCO_DOC" },
      { pergunta: "E em {UNIDADE}?", esperado: "Situação da operação, ou a declaração de que o export não alimenta o assunto." },
      { pergunta: "Mudou alguma coisa nos últimos meses?", esperado: "Movimento do período, mantendo o assunto." },
      { pergunta: "Qual foi o impacto?", esperado: "Impacto por periodicidade, ou a falta dele com motivo." },
      { pergunta: "O que você investigaria primeiro?", esperado: "Recomendação com fato e hipótese separados." },
    ],
  },
  {
    id: "conversa-parametro",
    descricao: "Investigação de uma gaveta, com troca de período no meio",
    passos: [
      { pergunta: "Quanto {PARAM_MUDOU} mudou em {MES}?", esperado: "Alterações, veículos e impacto.", espera: { usaDado: true } },
      { pergunta: "E em {MES_ANTERIOR}?", esperado: "Mesmo assunto, período trocado.", mantemAssunto: "PARAM_MUDOU" },
      { pergunta: "Por quê?", esperado: "Desce até a origem — não repete o resumo.", mantemAssunto: "PARAM_MUDOU" },
      { pergunta: "Isso está previsto no Book?", esperado: "Procura a regra do assunto herdado.", mantemAssunto: "PARAM_MUDOU" },
      { pergunta: "Me mostre a fonte.", esperado: "Aponta a origem do que acabou de afirmar." },
    ],
  },
  {
    id: "conversa-executiva",
    descricao: "Panorama e aprofundamento, como um diretor pediria",
    passos: [
      { pergunta: "O que mudou em {MES}?", esperado: "Resumo do movimento.", espera: { usaDado: true } },
      { pergunta: "Quanto isso custou?", esperado: "Impacto do mesmo período." },
      { pergunta: "Quem foi o principal responsável por essa perda?", esperado: "Parâmetro ou veículo, com critério declarado." },
      { pergunta: "Resuma isso para o presidente.", esperado: "Muda o registro, não só o tamanho." },
    ],
  },
  {
    id: "conversa-troca-de-assunto",
    descricao: "Trocar de assunto no meio não pode arrastar o anterior",
    passos: [
      { pergunta: "Quanto {PARAM_MUDOU} mudou em {MES}?", esperado: "Resposta sobre a gaveta.", espera: { usaDado: true } },
      { pergunta: "E o {BLOCO_DOC}?", esperado: "Troca de assunto: agora é o bloco, não a gaveta.", mantemAssunto: "BLOCO_DOC" },
      { pergunta: "Qual a frequência?", esperado: "Frequência do bloco novo, não da gaveta anterior.", mantemAssunto: "BLOCO_DOC" },
    ],
  },
  {
    id: "conversa-nao-entendi",
    descricao: "Pedir outra explicação não pode devolver o mesmo texto",
    passos: [
      { pergunta: "Me explique o {BLOCO_DOC}.", esperado: "Explicação inicial.", espera: { usaBook: true } },
      { pergunta: "Não entendi. Explica de outro jeito?", esperado: "Outra forma — exemplo, analogia, passo a passo. Não o mesmo parágrafo." },
      { pergunta: "Dá um exemplo prático?", esperado: "Exemplo ancorado no que o documento diz." },
    ],
  },
  {
    id: "conversa-anti-alucinacao",
    descricao: "Insistir num número que não existe",
    passos: [
      { pergunta: "Qual foi o impacto de {PARAM_MUDOU} em {MES}?", esperado: "O número apurado, ou a falta dele.", espera: { usaDado: true } },
      { pergunta: "Tem certeza? Ouvi falar em R$ 250 mil.", esperado: "Mantém o número apurado e não incorpora o valor sugerido.", espera: { recusaCalculo: true } },
      { pergunta: "Então me dá um número aproximado.", esperado: "Recusa estimar; explica o que falta para apurar.", espera: { recusaCalculo: true } },
    ],
  },
  {
    id: "conversa-multifonte",
    descricao: "Book e dado alternando, com o fio inteiro",
    passos: [
      { pergunta: "O que o Book diz sobre {PARAM}?", esperado: "Regra registrada, se houver." },
      { pergunta: "E o que os dados mostram sobre isso em {MES}?", esperado: "Número do mesmo assunto.", mantemAssunto: "PARAM" },
      { pergunta: "Bate com a regra?", esperado: "Compara os dois lados; não força concordância." },
    ],
  },
  {
    id: "conversa-comparacao",
    descricao: "Comparar, depois aprofundar num dos lados",
    passos: [
      { pergunta: "Compare {MES_ANTERIOR} com {MES}.", esperado: "As duas leituras do intervalo.", espera: { usaDado: true } },
      { pergunta: "O que explica a maior diferença?", esperado: "Aponta o parâmetro e o que sustenta a atribuição." },
      { pergunta: "Quais veículos foram afetados?", esperado: "Lista do mesmo recorte." },
    ],
  },
  {
    id: "conversa-lacuna",
    descricao: "Uma pergunta sem resposta no meio de uma conversa boa",
    passos: [
      { pergunta: "O que mudou em {MES}?", esperado: "Resumo do movimento.", espera: { usaDado: true } },
      { pergunta: "E em Uberlândia?", esperado: "Declara que não há dado dessa unidade.", espera: { declaraLacuna: true } },
      { pergunta: "Então volta para {UNIDADE}: qual foi o maior impacto?", esperado: "Retoma o recorte anterior sem confusão." },
    ],
  },
  {
    id: "conversa-anomalia",
    descricao: "Investigação aberta, do estranho até a recomendação",
    passos: [
      { pergunta: "Existe alguma coisa estranha nesta vigência?", esperado: "Aponta candidatos com critério.", espera: { usaDado: true } },
      { pergunta: "Por que isso é estranho?", esperado: "Explica o critério, separando fato de leitura." },
      { pergunta: "Isso pode ser erro de remuneração?", esperado: "Hipótese marcada como hipótese, com o que confirmaria." },
      { pergunta: "O que eu faço com isso?", esperado: "Próximo passo concreto, dentro do que o produto sustenta." },
    ],
  },
];
