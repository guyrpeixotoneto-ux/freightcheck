import { centavos } from "./dominio";
import {
  montarMapaDaQuinzena,
  somarVariavel,
  type BasesDaQuinzena,
  type FatiaDoPadronizado,
  type ParametrosDoCadastro,
  type ViagemDoMapa,
} from "./mapa-rota";

/**
 * A PROVA — o `RESUMO GERAL` da planilha contra o motor, linha a linha.
 *
 * Este módulo não calcula remuneração: ele **confronta**. Pega um fechamento
 * inteiro como a `.xlsb` o traz — parâmetros do cadastro, viagens dos trinta e
 * um dias, bases dos descontos e os números que o resumo imprime — roda o motor
 * sobre as mesmas entradas e devolve as três colunas lado a lado com a
 * diferença nomeada.
 *
 * **Por que a prova mora no pacote e não num script solto.** Um script que
 * confere uma vez prova uma vez. Aqui a mesma função serve ao CLI, que roda
 * contra o `.xlsb` de verdade, e ao teste de regressão, que roda contra a
 * amostra fiel extraída dele — e é a mesma comparação nos dois. Se o motor
 * mudar e passar a discordar da planilha, o teste diz em que linha e em quanto,
 * sem ninguém precisar reabrir o Excel.
 *
 * **A regra: a prova não conserta nada.** Onde a planilha se contradiz, a
 * diferença aparece com o motivo escrito em {@link DIVERGENCIAS_CONHECIDAS} —
 * não é absorvida, não é arredondada para zero e não faz o motor mudar de
 * conta. Um gate que se ajusta ao resultado não é gate.
 */

/** Uma viagem repetida, como a amostra a guarda: a tupla e quantas vezes ela ocorre. */
export type ViagemAgrupada = [
  frota: string,
  cargaAtual: string,
  tipoDeImposto: string,
  valorFaturado: number,
  quantidade: number,
];

/**
 * Um dia de operação, agrupado.
 *
 * Agrupar é **exato**, não uma aproximação: {@link somarVariavel} só conta e
 * soma, e nunca olha a ordem nem a identidade de uma viagem. Duas viagens com a
 * mesma frota, carga, imposto e faturado são indistinguíveis para a conta, e
 * guardá-las como `(tupla, 2)` devolve o mesmo número que guardá-las duas
 * vezes — com um arquivo que cabe no repositório.
 */
export interface DiaDaPlanilha {
  dia: number;
  viagens: ViagemAgrupada[];
}

/**
 * As bases como a `.xlsb` as traz: cinco números digitados numa célula.
 *
 * É de propósito que este tipo exista ao lado de `BasesDaQuinzena`, em vez de
 * ser ele. As duas do fim — outros custos e indisponibilidade — passaram a
 * carregar **procedência** no motor: quantas requisições entraram na soma,
 * quantas viagens tinham marca. Uma célula da planilha não tem nada disso; ela
 * tem um número que alguém digitou. Reaproveitar o tipo do motor aqui obrigaria
 * a inventar um denominador para a célula — "0 de 0 viagens" — e a memória de
 * cálculo passaria a afirmar uma contagem que ninguém fez.
 *
 * A conversão é {@link basesDoMotor}, e ela marca as duas como `PLANILHA`.
 */
export interface BasesDaPlanilha {
  devolucao: number | null;
  disponibilidade: number | null;
  complementarNegativo: number | null;
  outrosCustos: number | null;
  indisponibilidade: number | null;
}

/** As bases da planilha na forma que o motor consome, com a fonte declarada. */
function basesDoMotor(b: BasesDaPlanilha): BasesDaQuinzena {
  return {
    devolucao: b.devolucao,
    disponibilidade: b.disponibilidade,
    complementarNegativo: b.complementarNegativo,
    outrosCustos:
      b.outrosCustos === null ? null : { fonte: "PLANILHA", valor: b.outrosCustos },
    indisponibilidade:
      b.indisponibilidade === null ? null : { fonte: "PLANILHA", valor: b.indisponibilidade },
  };
}

/** Uma quinzena inteira, como a planilha a traz. */
export interface QuinzenaDaPlanilha {
  quinzena: 1 | 2;
  parametros: ParametrosDoCadastro;
  custoVariavelPrevistoPor25Viagens: number;
  bases: BasesDaPlanilha;
  dias: DiaDaPlanilha[];
  /**
   * A fatia de documentos emitidos **fora** do município que o diário calcula
   * — `Mapa Rota!AI119` e `AJ119`. Só o custo fixo padronizado da 2ª quinzena a
   * usa, e é dela que sai a divergência de R$ 128,05.
   */
  foraDoMunicipioNoDiario: number;
  /** O que o `RESUMO GERAL` imprime, por chave de linha do motor. */
  resumoGeral: Record<string, number>;
  /** Os totais que o `RESUMO GERAL` fecha. */
  totais: {
    remuneracao: number;
    variavel: number;
    outrosCustos: number;
    geral: number;
  };
}

export interface FechamentoDaPlanilha {
  /** O fechamento de onde a amostra saiu, para quem for conferir. */
  competencia: string;
  arquivo: string;
  quinzenas: QuinzenaDaPlanilha[];
}

/**
 * Interpreta a amostra vinda de JSON, conferindo o que o tipo promete.
 *
 * Um `import` de JSON chega ao TypeScript como `(string | number)[][]`, e um
 * `as FechamentoDaPlanilha` por cima disso não confere nada — aceitaria uma
 * amostra truncada e só quebraria dentro da conta, longe da causa. Esta função
 * é a porta: valida a aridade de cada tupla de viagem e recusa alto, com o dia
 * e a posição, quando a amostra não é o que diz ser.
 *
 * Vale também como guarda do arquivo versionado: se alguém editar
 * `amostras/julho-2026.json` à mão e errar uma coluna, o teste diz onde.
 */
export function interpretarAmostra(bruto: unknown): FechamentoDaPlanilha {
  const raiz = bruto as FechamentoDaPlanilha;
  if (!raiz || !Array.isArray(raiz.quinzenas) || raiz.quinzenas.length === 0) {
    throw new Error("A amostra não traz `quinzenas`.");
  }
  for (const q of raiz.quinzenas) {
    if (!Array.isArray(q.dias)) {
      throw new Error(`A ${q.quinzena}ª quinzena da amostra não traz \`dias\`.`);
    }
    for (const dia of q.dias) {
      dia.viagens.forEach((v, i) => {
        if (
          !Array.isArray(v) ||
          v.length !== 5 ||
          typeof v[0] !== "string" ||
          typeof v[1] !== "string" ||
          typeof v[2] !== "string" ||
          typeof v[3] !== "number" ||
          typeof v[4] !== "number"
        ) {
          throw new Error(
            `A viagem ${i} do dia ${dia.dia} não é uma tupla ` +
              `(frota, carga, imposto, faturado, quantidade): ${JSON.stringify(v)}`,
          );
        }
      });
    }
  }
  return raiz;
}

/** Uma linha da tabela de reconciliação. */
export interface LinhaReconciliada {
  chave: string;
  rotulo: string;
  quadro: string;
  planilha: { primeira: number; segunda: number; total: number };
  motor: { primeira: number | null; segunda: number | null; total: number | null };
  diferenca: { primeira: number | null; segunda: number | null; total: number | null };
  /** A conta do motor, por quinzena — a memória de cálculo. */
  memoria: { primeira: string; segunda: string };
  /** O motivo, quando a diferença é conhecida. `null` quando ela fecha em zero. */
  divergencia: string | null;
}

/**
 * As diferenças que a planilha produz sozinha, e o porquê de cada uma.
 *
 * Estão nomeadas aqui — e não escondidas numa tolerância — porque uma
 * divergência explicada é um achado e uma tolerância é um tapete. A chave é a
 * da linha do motor; o texto é o que a tabela imprime ao lado do número.
 */
export const DIVERGENCIAS_CONHECIDAS: Record<string, string> = {
  custo_fixo_padronizado:
    "Mapa Rota!AJ133 pesa o lado de dentro pelo cadastro (F49) e o de fora pelo diário " +
    "(AJ119) — duas fontes na mesma soma, com pesos que fecham em 0,9998274 e não em 1. " +
    "A 1ª quinzena não tem o defeito: AI133 pesa os dois lados pelo cadastro.",
  custo_variavel_frota_fixa:
    "As colunas auxiliares BM/BN do diário não foram preenchidas em três dias (12, 15 e " +
    "27): a viagem conta como mapa e some do rateio ISS/ICMS. Nos 31 dias a contagem de " +
    "mapas bate; só o rateio desses três dias diverge.",
  custo_variavel_agregado:
    "A planilha soma o agregado por tabela de tarifa (SUMPRODUCT), e viagens Spot com " +
    "faturado fora da tabela — seis de R$ 0,01 na 2ª quinzena — não entram. O motor soma " +
    "o faturado das viagens de frota Spot.",
  rota_dvs:
    "Herda as duas diferenças do variável, mais o `Custo Variável (Recarga e Noturna)`: " +
    "a fórmula diária dele aponta para a linha 1.048.619, que não existe, e o valor " +
    "exibido é cache. Na 2ª quinzena o cache coincide com a soma correta; na 1ª, não.",
};

/**
 * A diferença de um centavo que aparece só na coluna do total.
 *
 * A planilha soma as duas quinzenas **antes** de arredondar: a coluna `AK` é a
 * soma de dois intermediários com dez casas. O motor arredonda cada quinzena a
 * centavo e soma o que cada uma de fato paga. Onde as duas metades caem perto
 * de meio centavo, os dois caminhos diferem em R$ 0,01.
 *
 * A escolha do motor é deliberada e não é estética: a quinzena é faturada e
 * paga sozinha, e ninguém paga R$ 13.088,6240. O total do mês é a soma do que
 * foi pago, não o arredondamento de uma soma que nunca existiu como dinheiro.
 */
export const ARREDONDAMENTO_DO_TOTAL =
  "As duas quinzenas fecham ao centavo; só a coluna do total diverge. A planilha soma os " +
  "dois valores não arredondados (dez casas) e arredonda no fim; o motor arredonda cada " +
  "quinzena — que é o que se fatura — e soma. Diferença de R$ 0,01, sem efeito no que se paga.";

/** As linhas do resumo, na ordem da planilha, com o quadro de cada uma. */
const LINHAS: { chave: string; rotulo: string; quadro: 0 | 1 | 2 }[] = [
  { chave: "rota_dvs", rotulo: "TOTAL REMUNERAÇÃO ROTA DVS", quadro: 0 },
  { chave: "custo_fixo_padronizado", rotulo: "CUSTO FIXO PADRONIZADO", quadro: 0 },
  { chave: "custo_fixo_inativos", rotulo: "CUSTO FIXO INATIVOS", quadro: 0 },
  { chave: "custo_vans_inativas", rotulo: "CUSTO VANS INATIVAS", quadro: 0 },
  { chave: "indisponibilidade_fixo", rotulo: "INDISPONIBILIDADE", quadro: 0 },
  { chave: "custo_fixo_especiais", rotulo: "CUSTO FIXO - ESPECIAIS", quadro: 0 },
  { chave: "custo_fixo_vans", rotulo: "CUSTO FIXO - VANS", quadro: 0 },
  { chave: "desconto_devolucao_percentual", rotulo: "DESCONTO DE DEVOLUÇÃO %", quadro: 0 },
  { chave: "desconto_disponibilidade", rotulo: "DESCONTO DE DISPONIBILIDADE", quadro: 0 },
  { chave: "desconto_complementar_negativo", rotulo: "DESCONTO COMPLEMENTAR NEGATIVO", quadro: 0 },
  { chave: "custo_variavel_frota_fixa", rotulo: "CUSTO VARIÁVEL (FROTA FIXA)", quadro: 1 },
  { chave: "custo_variavel_agregado", rotulo: "CUSTO VARIÁVEL (AGREGADO)", quadro: 1 },
  { chave: "indisponibilidade_variavel", rotulo: "INDISPONIBILIDADE (variável)", quadro: 1 },
  { chave: "outros_custos", rotulo: "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS", quadro: 2 },
];

const NOME_DO_QUADRO = ["Rota — remuneração", "Rota — variável", "Outros custos"];

/** As viagens de um dia, desagrupadas — a forma que o motor consome. */
function desagrupar(dia: DiaDaPlanilha): ViagemDoMapa[] {
  const viagens: ViagemDoMapa[] = [];
  for (const [frota, cargaAtual, tipoDeImposto, valorFaturado, quantidade] of dia.viagens) {
    for (let i = 0; i < quantidade; i += 1) {
      /*
        `caixasDeRota: null` — a amostra sai das abas diárias da própria `.xlsb`,
        que já são o 2Art **filtrado**: a viagem de AS não chega até lá. Pôr um
        número aqui fingiria uma coluna que a amostra não tem; `null` diz o que
        é verdade — não se sabe, e por isso a viagem conta, que é o certo para
        uma lista de onde o AS já saiu. Ver `ehDaRota` em `mapa-rota.ts`.
      */
      /*
        `tipoDeIndisponibilidade: ""` é inerte nesta prova, e não uma afirmação
        sobre a operação: a reconciliação passa a indisponibilidade **da célula**
        `Mapa Rota!132`, e por isso `somarIndisponibilidade` não roda aqui. A
        amostra guarda cinco campos por viagem e não tem o sexto para dar.
      */
      viagens.push({
        frota,
        cargaAtual,
        tipoDeImposto,
        valorFaturado,
        caixasDeRota: null,
        tipoDeIndisponibilidade: "",
      });
    }
  }
  return viagens;
}

/**
 * Em que regra a prova roda.
 *
 * **`REGRA_CANONICA` é a regra oficial do FreightCheck**: a autoridade sobre os
 * pesos do imposto é o `Cadastro`, nas duas quinzenas, e os pesos somam 1. É o
 * que o produto calcula quando alguém pergunta quanto é devido.
 *
 * **`PLANILHA_LEGADA` existe para reprodução histórica**, não como alternativa
 * de cálculo. Ela repete o que cada quinzena da planilha faz — o que, para a
 * 1ª, **é** pesar pelo cadastro: o defeito é só da 2ª, que lê
 * `Mapa Rota!AJ119`. Por isso o modo legado não é "usar o diário sempre", e sim
 * "usar o que aquela quinzena usou".
 *
 * As duas convivem de propósito. Corrigir o histórico em silêncio faria os
 * números de um fechamento já discutido mudarem sem aviso; manter só o legado
 * carregaria o defeito para sempre. {@link compararModos} põe os dois lado a
 * lado com a diferença nomeada, que é o que permite decidir com o número na
 * mão.
 */
export type ModoDaProva = "REGRA_CANONICA" | "PLANILHA_LEGADA";

function fatiaDoModo(q: QuinzenaDaPlanilha, modo: ModoDaProva): FatiaDoPadronizado {
  if (modo === "REGRA_CANONICA" || q.quinzena === 1) return { fonte: "CADASTRO" };
  return { fonte: "PLANILHA_LEGADA", foraDoMunicipio: q.foraDoMunicipioNoDiario };
}

const menos = (a: number | null, b: number) => (a === null ? null : centavos(a - b));
const mais = (a: number | null, b: number | null) =>
  a === null || b === null ? null : centavos(a + b);

export interface Reconciliacao {
  competencia: string;
  arquivo: string;
  modo: ModoDaProva;
  linhas: LinhaReconciliada[];
  totais: LinhaReconciliada[];
  /** Quantas células (linha × coluna) fecham em zero, e quantas não. */
  placar: { iguais: number; diferentes: number };
}

/**
 * Roda o motor sobre o fechamento da planilha e devolve a comparação.
 *
 * Não recebe nenhum número já calculado: o que entra são os parâmetros e as
 * viagens, e tudo o mais é o motor que produz. É isso que faz da tabela uma
 * prova e não um relatório — se o motor mudar, a tabela muda com ele.
 */
export function reconciliar(
  fechamento: FechamentoDaPlanilha,
  modo: ModoDaProva = "REGRA_CANONICA",
): Reconciliacao {
  const mapas = new Map(
    fechamento.quinzenas.map((q) => [
      q.quinzena,
      montarMapaDaQuinzena({
        quinzena: q.quinzena,
        parametros: q.parametros,
        variavel: somarVariavel(
          q.dias.map((d) => ({ viagens: desagrupar(d) })),
          q.parametros,
          q.custoVariavelPrevistoPor25Viagens,
        ),
        bases: basesDoMotor(q.bases),
        fatiaDoPadronizado: fatiaDoModo(q, modo),
      }),
    ]),
  );

  const daPlanilha = new Map(fechamento.quinzenas.map((q) => [q.quinzena, q]));
  const linhaDoMotor = (q: 1 | 2, quadro: number, chave: string) =>
    mapas.get(q)?.quadros[quadro]?.linhas.find((l) => l.chave === chave) ?? null;

  let iguais = 0;
  let diferentes = 0;
  const contar = (dif: number | null) => {
    if (dif !== null && Math.abs(dif) < 0.005) iguais += 1;
    else diferentes += 1;
  };

  const linhas = LINHAS.map((l): LinhaReconciliada => {
    const p1 = daPlanilha.get(1)?.resumoGeral[l.chave] ?? 0;
    const p2 = daPlanilha.get(2)?.resumoGeral[l.chave] ?? 0;
    const m1 = linhaDoMotor(1, l.quadro, l.chave);
    const m2 = linhaDoMotor(2, l.quadro, l.chave);
    const total = mais(m1?.valor ?? null, m2?.valor ?? null);
    const diferenca = {
      primeira: menos(m1?.valor ?? null, p1),
      segunda: menos(m2?.valor ?? null, p2),
      total: menos(total, centavos(p1 + p2)),
    };
    contar(diferenca.primeira);
    contar(diferenca.segunda);
    contar(diferenca.total);
    /*
      Três estados, e não dois: uma linha cujas duas quinzenas fecham e cujo
      total não fecha tem um problema diferente — e menor — do que uma linha
      que erra a quinzena. Colapsar os dois num "não fecha" faria o centavo de
      arredondamento parecer da mesma família que os R$ 772,06 do rateio.
    */
    const zero = (n: number | null) => n !== null && Math.abs(n) < 0.005;
    const quinzenasFecham = zero(diferenca.primeira) && zero(diferenca.segunda);
    const divergencia = quinzenasFecham
      ? zero(diferenca.total)
        ? null
        : ARREDONDAMENTO_DO_TOTAL
      : (DIVERGENCIAS_CONHECIDAS[l.chave] ?? null);
    return {
      chave: l.chave,
      rotulo: l.rotulo,
      quadro: NOME_DO_QUADRO[l.quadro]!,
      planilha: { primeira: p1, segunda: p2, total: centavos(p1 + p2) },
      motor: { primeira: m1?.valor ?? null, segunda: m2?.valor ?? null, total },
      diferenca,
      memoria: { primeira: m1?.memoria ?? "", segunda: m2?.memoria ?? "" },
      divergencia,
    };
  });

  const totais = (
    [
      ["TOTAL REMUNERAÇÃO ROTA", "remuneracao", (q: 1 | 2) => mapas.get(q)?.quadros[0]?.total ?? null],
      ["TOTAL REMUNERAÇÃO ROTA (variável)", "variavel", (q: 1 | 2) => mapas.get(q)?.quadros[1]?.total ?? null],
      ["TOTAL OUTROS CUSTOS", "outrosCustos", (q: 1 | 2) => mapas.get(q)?.quadros[2]?.total ?? null],
      ["TOTAL GERAL UNIDADE", "geral", (q: 1 | 2) => mapas.get(q)?.totalGeral ?? null],
    ] as const
  ).map(([rotulo, campo, doMotor]): LinhaReconciliada => {
    const p1 = daPlanilha.get(1)?.totais[campo] ?? 0;
    const p2 = daPlanilha.get(2)?.totais[campo] ?? 0;
    const m1 = doMotor(1);
    const m2 = doMotor(2);
    const total = mais(m1, m2);
    return {
      chave: campo,
      rotulo,
      quadro: "Totais",
      planilha: { primeira: p1, segunda: p2, total: centavos(p1 + p2) },
      motor: { primeira: m1, segunda: m2, total },
      diferenca: {
        primeira: menos(m1, p1),
        segunda: menos(m2, p2),
        total: menos(total, centavos(p1 + p2)),
      },
      memoria: { primeira: "soma do quadro", segunda: "soma do quadro" },
      divergencia: null,
    };
  });

  return {
    competencia: fechamento.competencia,
    arquivo: fechamento.arquivo,
    modo,
    linhas,
    totais,
    placar: { iguais, diferentes },
  };
}

/* ---------------------------------------------------------------------------
   Legado × Canônica — o que a correção da regra muda, com o número
   ------------------------------------------------------------------------ */

/**
 * Uma linha vista pelas duas **regras**, com o efeito de trocar de uma para a outra.
 *
 * Não confundir com `LinhaComparada` de `resumo.ts`: aquela compara o devido
 * contra o demonstrado — duas **fontes**. Esta compara a mesma fonte sob duas
 * **regras**, e serve para decidir se a regra canônica vale a adoção.
 */
export interface LinhaEntreModos {
  chave: string;
  rotulo: string;
  /** O que a planilha calcula hoje — e o que o histórico já discutido mostra. */
  legado: { primeira: number | null; segunda: number | null; total: number | null };
  /** O que a regra oficial calcula, com a autoridade no Cadastro. */
  canonica: { primeira: number | null; segunda: number | null; total: number | null };
  /** `canônica − legado`. Zero quando a regra não muda nada naquela linha. */
  efeito: { primeira: number | null; segunda: number | null; total: number | null };
  /** Por que a regra muda esta linha. `null` quando não muda. */
  porque: string | null;
}

export interface ComparacaoDeModos {
  competencia: string;
  linhas: LinhaEntreModos[];
  totais: LinhaEntreModos[];
  /** As linhas em que adotar a regra canônica muda algum número. */
  afetadas: string[];
  /** O efeito no `TOTAL GERAL UNIDADE` do mês. */
  efeitoNoTotalGeral: number | null;
}

/**
 * Roda a prova nas duas regras e devolve o que muda de uma para a outra.
 *
 * É a resposta à pergunta que decide a adoção: *o que acontece com os números
 * já assinados se a regra passar a valer?* Sem ela, trocar a regra seria pedir
 * um voto de confiança; com ela, é uma diferença por linha que alguém confere.
 *
 * O sistema não escolhe: devolve os dois lados. Quem decide se o histórico é
 * reprocessado ou preservado é quem responde pelo contrato.
 */
export function compararModos(fechamento: FechamentoDaPlanilha): ComparacaoDeModos {
  const canonica = reconciliar(fechamento, "REGRA_CANONICA");
  const legada = reconciliar(fechamento, "PLANILHA_LEGADA");

  const efeitoDe = (a: number | null, b: number | null) =>
    a === null || b === null ? null : centavos(a - b);

  const comparar = (
    doLegado: LinhaReconciliada[],
    doCanonico: LinhaReconciliada[],
  ): LinhaEntreModos[] =>
    doCanonico.map((c) => {
      const l = doLegado.find((x) => x.chave === c.chave);
      const efeito = {
        primeira: efeitoDe(c.motor.primeira, l?.motor.primeira ?? null),
        segunda: efeitoDe(c.motor.segunda, l?.motor.segunda ?? null),
        total: efeitoDe(c.motor.total, l?.motor.total ?? null),
      };
      const muda = [efeito.primeira, efeito.segunda].some((n) => n !== null && Math.abs(n) >= 0.005);
      return {
        chave: c.chave,
        rotulo: c.rotulo,
        legado: l?.motor ?? { primeira: null, segunda: null, total: null },
        canonica: c.motor,
        efeito,
        porque: muda ? (DIVERGENCIAS_CONHECIDAS[c.chave] ?? null) : null,
      };
    });

  const linhas = comparar(legada.linhas, canonica.linhas);
  const totais = comparar(legada.totais, canonica.totais);

  return {
    competencia: fechamento.competencia,
    linhas,
    totais,
    afetadas: linhas.filter((l) => l.porque !== null).map((l) => l.rotulo),
    efeitoNoTotalGeral: totais.find((t) => t.chave === "geral")?.efeito.total ?? null,
  };
}
