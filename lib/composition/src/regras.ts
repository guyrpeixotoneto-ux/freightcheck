/**
 * As regras de composição da remuneração, por tipo de equipamento.
 *
 * Este arquivo responde a uma pergunta só: **de tudo o que a fonte entrega
 * sobre um ativo, o que compõe o que ele recebe?** É a diferença entre um
 * atributo do equipamento e um componente financeiro da remuneração — e o
 * módulo inteiro existe para ensinar essa diferença em vez de somar tudo o que
 * é número.
 *
 * Fica em código, e não em tabela, pelo mesmo motivo que `CONFIRMED_SEMANTICS`
 * em `@workspace/curation` e `COMPOSITIONS` em `@workspace/comparison`: cada
 * linha carrega a medição que a sustenta, e uma medição revista num pull
 * request é auditável de um jeito que um `UPDATE` não é. Nenhuma entrada aqui
 * foi deduzida de nome de coluna.
 *
 * **A regra que este arquivo não pode violar.** Nada aqui promove um atributo a
 * calculável. O portão continua sendo o mesmo do resto do produto — semântica
 * CONFIRMADA, monetário, somável — e é conferido em `motor.ts` a cada leitura,
 * contra a versão da semântica vigente **na data daquela vigência**. O que este
 * registro faz é o passo seguinte: entre os que passaram no portão, quais são
 * do equipamento, quais são parcela de outro, e quais nem sequer são dele.
 */

import {
  COMPOSITIONS,
  ESCOPOS_DE_CONJUNTO,
  type Composition,
} from "@workspace/comparison";

// ---------------------------------------------------------------------------
// Por que um componente ficou de fora
// ---------------------------------------------------------------------------

/**
 * O vocabulário fechado das exclusões.
 *
 * Fechado de propósito: "não calculável" sem motivo nomeado é a mesma coisa que
 * uma célula vazia, e uma célula vazia numa tela de auditoria é lida como
 * "zero" por quem está com pressa. Todo componente que não entra na soma sai
 * daqui com um destes rótulos e com a frase que o explica.
 */
export type MotivoDeExclusao =
  | "SEMANTICA_NAO_CONFIRMADA"
  | "NAO_MONETARIO"
  | "NAO_SOMAVEL"
  | "SEM_PERIODICIDADE"
  | "PERIODICIDADE_NAO_MENSAL"
  | "PARCELA_DE_TOTAL"
  | "ESCOPO_DE_CONJUNTO"
  | "BASE_AUSENTE"
  | "VALOR_AUSENTE"
  | "VALOR_NAO_NUMERICO";

/** O rótulo curto do motivo, para a coluna "Motivo" da tela. */
export const ROTULO_DO_MOTIVO: Record<MotivoDeExclusao, string> = {
  SEMANTICA_NAO_CONFIRMADA: "Semântica não confirmada",
  NAO_MONETARIO: "Não monetário",
  NAO_SOMAVEL: "Não somável",
  SEM_PERIODICIDADE: "Periodicidade não definida",
  PERIODICIDADE_NAO_MENSAL: "Outra periodicidade",
  PARCELA_DE_TOTAL: "Já contido no total",
  ESCOPO_DE_CONJUNTO: "Remunera o conjunto",
  BASE_AUSENTE: "Base operacional ausente",
  VALOR_AUSENTE: "Sem valor nesta vigência",
  VALOR_NAO_NUMERICO: "Valor não numérico",
};

/*
  A base que faltaria para transformar uma razão em dinheiro mudou de casa: está
  em `baseQueFalta`, no `@workspace/curation`, ao lado das outras respostas sobre
  agregação. A pergunta é sobre a semântica do atributo, e não sobre a composição
  da remuneração — a curadoria e o cockpit querem a mesma frase que este módulo.
*/

// ---------------------------------------------------------------------------
// O que não é do equipamento
// ---------------------------------------------------------------------------

/**
 * Um atributo que aparece na linha do ativo e remunera outra coisa.
 *
 * A `evidencia` vai para a tela como está — sem `**` nem crases, ao contrário
 * das de `COMPOSITIONS`, que foram escritas para um pull request e passam por
 * `semMarcacao` no motor. Quem escrever uma entrada nova aqui está escrevendo
 * para quem confere a planilha, não para quem revisa o código.
 */
export interface ForaDoEscopo {
  code: string;
  /** CONJUNTO — o valor cobre cavalo + carreta juntos. */
  escopo: "CONJUNTO";
  /** A medição que sustenta a exclusão. Sem ela, isto seria um palpite. */
  evidencia: string;
}

/** O modelo de remuneração de um tipo de equipamento. */
export interface RegraDeEquipamento {
  entityType: string;
  /** Nome de leitura, no singular. */
  rotulo: string;
  foraDoEscopo: ForaDoEscopo[];
  /**
   * O atributo que carrega a remuneração do conjunto, quando a fonte entrega
   * um.
   *
   * Não entra em total nenhum **deste** equipamento — é escopo de conjunto, e é
   * `foraDoEscopo` que o mantém fora. Quem o lê é a aba Conjuntos
   * (`conjunto.ts`), para confrontá-lo com a soma que as duas fichas apuram; a
   * leitura passa por `aprovados`, isto é, pelo mesmo portão de semântica que
   * todo o resto, e não pelo fato cru.
   */
  totalDoConjunto?: string;
}

/**
 * O achado que define a modelagem da carreta.
 *
 * Medido em 14/08/2026 sobre as 9 vigências do export real, cruzando cada
 * carreta com o cavalo que a aponta em `cavalo.placa_carreta`:
 *
 * ```
 * carreta.finame − carreta.finame_implemento = cavalo.finame_cavalo
 * ```
 *
 * **558 de 558 linhas (vigência × carreta com cavalo vinculado) fecham**, com
 * tolerância de R$ 0,01 e zero exceções. Nas 99 linhas de carreta sem cavalo
 * vinculado, a diferença é exatamente zero — isto é, `finame` e
 * `finameImplemento` coincidem, que é o que se espera quando não há cavalo para
 * somar.
 *
 * A conclusão é dura e muda o produto: **`carreta.finame` já contém o cavalo.**
 * E como `carreta.custo_fixo = carreta.finame + carreta.lucro_fixomodelo_novo_ciclo`
 * fecha em 657 de 657 linhas, `custoFixo` — a coluna que o nome convida a ler
 * como "o custo fixo da carreta" — é o custo fixo do **conjunto**.
 *
 * Somar `cavalo.finame_cavalo` da frota de cavalos com `carreta.custo_fixo` da
 * frota de carretas contaria cada cavalo duas vezes. Sobre a última vigência
 * isso seriam R$ 1,05 milhão/mês de cavalo dentro do número das carretas.
 *
 * Por isso as duas colunas ficam **fora** do total próprio da carreta — sem
 * sumir da tela: aparecem na composição com este motivo escrito, porque quem
 * confere a planilha vai encontrá-las lá e precisa saber por que o produto não
 * as somou.
 *
 * **A identidade que fecha a conta — e a metade dela que era falsa.** Medida nas
 * 9 vigências, 558 de 558 pares cavalo–carreta, tolerância de R$ 0,01:
 *
 * ```
 * (finameImplemento + lucroFixomodeloNovoCiclo) + finameCavalo = custoFixo
 * ```
 *
 * Ela fecha, e por isso foi lida como prova de que a decomposição era
 * **exaustiva** (nada do conjunto sem dono) e **disjunta** (nenhum real com dois
 * donos). A primeira metade é verdadeira. A segunda não é, e uma identidade que
 * fecha não podia prová-la: `lucroFixomodeloNovoCiclo` contém o lucro fixo do
 * cavalo (ver acima), e `finameCavalo` **é** esse mesmo lucro nos 51 pares em
 * que o financiamento do cavalo já se encerrou — amortização e juros e lucro do
 * novo ciclo nunca coexistem, medido em 558 linhas, 0 coexistências. Nesses 51
 * pares o `custoFixo` da fonte soma o mesmo real duas vezes.
 *
 * A identidade disjunta, que é a que este módulo passa a sustentar:
 *
 * ```
 * (finameImplemento + lucroFixomodeloNovoCicloCarreta) + finameCavalo
 *  \____________ carreta ____________/                  \_ cavalo _/
 * ```
 *
 * Ela **não** reproduz o `custoFixo` da fonte — fica abaixo dele por exatamente
 * o lucro fixo do cavalo repetido (507 dos 558 pares fecham; os 51 que faltam
 * são os que o dobro explica). Reproduzir a fonte deixou de ser o contrato: a
 * fonte conta duas vezes, e copiá-la seria propagar o erro com a nossa
 * assinatura. O teste que guarda as duas afirmações está em
 * `__tests__/composicao-real.test.ts`.
 *
 * **A armadilha era outra, e este parágrafo já esteve errado.** Ele dizia que
 * `lucroFixomodeloNovoCiclo` da carreta *não* era o lucro fixo do cavalo, e
 * citava a placa RZM0B31 em ago/2026 — R$ 4.677,85 dos dois lados — como
 * coincidência de valor. A contagem que sustentava a frase estava certa: entre
 * as 284 linhas em que a coluna não é zero, 233 batem com
 * `lucroFixomodeloNovoCicloCarreta` e 15 com a do cavalo. A pergunta é que
 * estava errada. "De qual das duas ela copia?" tem uma terceira resposta que
 * ninguém testou: **de nenhuma — ela é a soma das duas.**
 *
 * Medido em 18/08/2026: `lucroFixomodeloNovoCiclo = lucroFixomodeloNovoCicloCarreta
 * + lucroFixomodeloNovoCicloCavalo` em **284 de 284** pares, zero exceções. As
 * 233 e as 15 são os casos em que uma das parcelas é zero; o que decide são as
 * **36 linhas em que as duas são não nulas ao mesmo tempo**, e a identidade
 * fecha em todas. Numa coincidência de valor elas seriam exceções.
 *
 * A consequência é dinheiro: a coluna era somada na linha da carreta e carregava
 * o lucro fixo do cavalo junto — R$ 34.793,84/mês em ago/2026. Ela está agora em
 * `ESCOPOS_DE_CONJUNTO`, e quem passou a ser a linha da carreta é a parcela
 * própria dela, `lucro_fixomodelo_novo_ciclo_carreta`.
 */
/**
 * A lista mora em `@workspace/comparison`, ao lado de `COMPOSITIONS`.
 *
 * Ela subiu para lá em 16/08/2026, quando a visão "tudo que mudou" passou a
 * precisar da mesma regra: um panorama que listasse `carreta.finame` e
 * `cavalo.finame_cavalo` como duas linhas econômicas independentes contaria o
 * cavalo duas vezes na tela de entrada do produto. Manter a cópia aqui faria as
 * duas divergirem no dia em que alguém medisse uma relação nova — exatamente o
 * argumento que já mantinha `COMPOSITIONS` do outro lado.
 *
 * Uma terceira coluna entrou na mudança: `carreta.lucro_variavel_previsto`,
 * com a ressalva das 99 linhas sem cavalo vinculado escrita junto.
 */
const CARRETA_FORA_DO_ESCOPO: ForaDoEscopo[] = ESCOPOS_DE_CONJUNTO.filter(
  (e) => e.entityType === "CARRETA",
).map((e) => ({ code: e.code, escopo: "CONJUNTO", evidencia: e.evidence }));

export const REGRAS: RegraDeEquipamento[] = [
  {
    entityType: "CAVALO",
    rotulo: "Cavalo",
    /*
      Nada do cavalo é escopo de conjunto: `finameCavalo` é dele, e é justamente
      a parcela que reaparece dentro de `carreta.finame`. O lado que empresta o
      número não é o que precisa se defender da dupla contagem — quem precisa é
      quem o recebe.
    */
    foraDoEscopo: [],
  },
  {
    entityType: "CARRETA",
    rotulo: "Carreta",
    foraDoEscopo: CARRETA_FORA_DO_ESCOPO,
    totalDoConjunto: "carreta.custo_fixo",
  },
  /**
   * O trecho — a perna da rota, e o lado variável da remuneração.
   *
   * Ele entra nesta lista quando ganha a tela Trecho 360°, e é preciso ser
   * exato sobre **o que esta entrada afirma e o que ela não afirma**.
   *
   * `foraDoEscopo: []` aqui não quer dizer "tudo o que vier do trecho entra na
   * soma". Quer dizer o que está literalmente escrito: **nenhuma coluna de
   * trecho foi medida como escopo de conjunto.** É a afirmação mais fraca
   * possível, e é a única que este repositório sustenta hoje — o export que
   * temos traz `Modelo_Cavalo` e `Modelo_Carreta`, e nenhuma coluna de trecho
   * chegou a ser importada. Uma relação entre colunas do trecho, quando existir,
   * se mede e se escreve aqui com a medição junto, como a identidade do FINAME
   * acima; não se deduz de nome de coluna, que é a regra do arquivo.
   *
   * O que a entrada faz de fato é **opt-in**: `TIPOS_COM_REGRA` é a lista que
   * `/frota/panorama` e `/composition/fleet` aceitam, e sem ela a grade de
   * Trecho 360° responderia 400 dizendo que o tipo não tem regra declarada.
   * `regraDe("TRECHO")` já devolvia exatamente este objeto pelo padrão
   * permissivo — o que muda é a porta, não o cálculo.
   *
   * **E o cálculo continua fechado.** Quem decide o que entra num total é o
   * portão de `motor.ts` — semântica CONFIRMADA na data da vigência, monetário,
   * somável, com periodicidade —, e nenhum atributo de trecho passou por ele
   * porque nenhum existe. A grade abre honestamente vazia, dizendo que a
   * vigência não entregou trechos, em vez de recusar-se a abrir com um erro
   * sobre regra faltando — que é uma frase sobre o nosso código onde a verdade
   * é sobre o arquivo do cliente.
   *
   * **Um aviso para quem trouxer o primeiro export de trecho.** A remuneração
   * do trecho é por viagem, não por mês. `Gaveta` só conhece MENSAL, ANUAL e
   * AQUISICAO, e uma periodicidade por viagem não é nenhuma das três: ela
   * precisa de gaveta própria antes de qualquer soma, pela mesmíssima razão que
   * mensal e anual não se somam. Enquanto ela não existir, o portão mantém
   * esses componentes fora — o que é o comportamento certo, e não uma lacuna a
   * contornar.
   */
  {
    entityType: "TRECHO",
    rotulo: "Trecho",
    foraDoEscopo: [],
  },
];

const REGRA_POR_TIPO = new Map(REGRAS.map((r) => [r.entityType, r]));

export function regraDe(entityType: string): RegraDeEquipamento {
  return (
    REGRA_POR_TIPO.get(entityType) ?? {
      entityType,
      rotulo: entityType,
      foraDoEscopo: [],
    }
  );
}

/** Os tipos de equipamento que o módulo sabe compor, na ordem das abas. */
export const TIPOS_COM_REGRA: string[] = REGRAS.map((r) => r.entityType);

// ---------------------------------------------------------------------------
// A árvore: total e parcelas
// ---------------------------------------------------------------------------

/**
 * As composições vêm de `@workspace/comparison`, e não de uma cópia daqui.
 *
 * Duplicar a lista faria as duas divergirem no dia em que alguém medisse uma
 * relação nova — e as duas seriam usadas para dizer quanto uma coisa custa, uma
 * na comparação e outra na composição, com respostas diferentes.
 */
export { COMPOSITIONS };
export type { Composition };

const COMPOSICAO_POR_TOTAL = new Map(COMPOSITIONS.map((c) => [c.total, c]));

export function composicaoDoTotal(code: string): Composition | null {
  return COMPOSICAO_POR_TOTAL.get(code) ?? null;
}

/**
 * A que totais um atributo pertence como parcela.
 *
 * Um atributo pode ser parcela de mais de um total em tese; o índice devolve
 * todos e quem decide é {@link resolverRaizes}, que só absorve a parcela quando
 * o total dela de fato entrou na conta.
 */
const TOTAIS_QUE_CONTEM = new Map<string, string[]>();
for (const composicao of COMPOSITIONS) {
  for (const parte of composicao.parts) {
    const lista = TOTAIS_QUE_CONTEM.get(parte) ?? [];
    lista.push(composicao.total);
    TOTAIS_QUE_CONTEM.set(parte, lista);
  }
}

export function totaisQueContem(code: string): string[] {
  return TOTAIS_QUE_CONTEM.get(code) ?? [];
}

/**
 * Quais dos componentes elegíveis entram na soma, e quais são absorvidos.
 *
 * A regra, em uma frase: **entra quem não é parcela de um total que também
 * entrou.** Ela resolve os dois casos reais deste export de uma vez só:
 *
 * - No cavalo, `finameCavalo` entra e as suas três parcelas (amortização,
 *   juros e lucro fixo do novo ciclo) são absorvidas — somar as quatro daria o
 *   dobro do que o cavalo recebe.
 * - Na carreta, `custoFixo` está fora do escopo (é do conjunto), então ele não
 *   entra — e a sua parcela `lucroFixomodeloNovoCiclo` **volta a ser raiz**, em
 *   vez de sumir junto com o total que a continha. Uma exclusão de escopo não
 *   pode levar embora dinheiro que é do equipamento.
 *
 * `elegiveis` já vem filtrado pelo portão da semântica e pelo escopo; esta
 * função não decide nada sobre significado.
 */
export function resolverRaizes(elegiveis: string[]): {
  raizes: string[];
  absorvidas: Map<string, string>;
} {
  const presentes = new Set(elegiveis);
  const absorvidas = new Map<string, string>();

  for (const composicao of COMPOSITIONS) {
    if (!presentes.has(composicao.total)) continue;
    for (const parte of composicao.parts) {
      if (presentes.has(parte)) absorvidas.set(parte, composicao.total);
    }
  }

  return {
    raizes: elegiveis.filter((code) => !absorvidas.has(code)),
    absorvidas,
  };
}

// ---------------------------------------------------------------------------
// Periodicidade
// ---------------------------------------------------------------------------

/**
 * As gavetas em que um componente calculável pode cair.
 *
 * Três, e nunca uma só. Mensal e anual não se somam, e o produto já foi mordido
 * por isso — `change_set.impacto_oficial_by_periodicity` existe porque um
 * escalar único uma vez apresentou "R$ −757.009,57" para um conjunto que era
 * R$ −735 mil por ano mais R$ −88 mil por mês. Anualizar exige uma regra
 * confirmada que ainda não temos, então a tela mostra as três lado a lado.
 */
export type Gaveta = "MENSAL" | "ANUAL" | "AQUISICAO";

/**
 * Em que gaveta cai uma periodicidade confirmada.
 *
 * `PONTUAL` vira AQUISIÇÃO e nunca remuneração: as duas colunas pontuais deste
 * export — `valorNfCompra` e `valorPisCofins` — foram confirmadas em 10/08/2026
 * justamente como "grandeza de aquisição, não fluxo periódico". Colocá-las num
 * total mensal somaria o preço do caminhão à conta do mês.
 */
export function gavetaDe(periodicity: string | null): Gaveta | null {
  switch (periodicity) {
    case "MENSAL":
      return "MENSAL";
    case "ANUAL":
      return "ANUAL";
    case "PONTUAL":
      return "AQUISICAO";
    default:
      return null;
  }
}

export const ROTULO_DA_GAVETA: Record<Gaveta, string> = {
  MENSAL: "Remuneração mensal",
  ANUAL: "Componentes anuais",
  AQUISICAO: "Valores de aquisição",
};

export const NOTA_DA_GAVETA: Record<Gaveta, string> = {
  MENSAL: "O que o equipamento recebe por mês nesta vigência.",
  ANUAL:
    "Valores confirmados como anuais. Não são divididos por doze: converter " +
    "exigiria uma regra de rateio que ninguém confirmou.",
  AQUISICAO:
    "Grandezas de aquisição — o valor da nota e os tributos sobre ela. " +
    "Descrevem quanto o ativo custou, não quanto ele recebe.",
};
