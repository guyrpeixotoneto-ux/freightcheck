import { Router, type IRouter } from "express";
import { db, type Database } from "@workspace/db";
import {
  CODIGOS_DO_DETALHE,
  CODIGOS_DO_DETALHE_DE_ALUGUEL,
  CODIGOS_DO_DETALHE_DE_AQUISICAO,
  CODIGOS_DO_DETALHE_DE_CONSUMO,
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  CODIGOS_DO_DETALHE_DE_IPVA,
  CODIGOS_DO_DETALHE_DE_KM,
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  CODIGOS_DO_DETALHE_DE_MANUTENCAO,
  CODIGOS_DO_DETALHE_DE_PNEU,
  CODIGOS_DO_DETALHE_DE_SEGURO,
  CODIGOS_DO_DETALHE_DE_VELOCIDADE,
  CODIGOS_LIDOS_DO_TMA,
  MODULOS_DO_MONITOR,
  SEM_IMPACTO_DE_TMA,
  SEM_IMPACTO_FINANCEIRO,
  TIPOS_DE_EQUIPAMENTO,
  TIPO_DO_CONSUMO,
  TIPO_DO_QUADRO,
  agruparPorArea,
  cartaoAusente,
  cartaoDeEquipe,
  cartaoDeRubrica,
  cartaoDoCustoFixo,
  codigosDoQuadro,
  computeChangeSet,
  getChangeSetForPair,
  impactoDeAquisicao,
  impactoDeConsumo,
  impactoDeKm,
  impactoDeManutencao,
  impactoDePneu,
  impactoDeSeguro,
  impactoDeVelocidade,
  linhasDeAquisicao,
  linhasDeConsumo,
  linhasDeKm,
  linhasDeManutencao,
  linhasDePneu,
  linhasDeQlpComparado,
  linhasDeSeguro,
  linhasDeVelocidade,
  listChanges,
  listComparableSnapshots,
  modulosDoQlp,
  motivoSemPar,
  normalizarLinhasDeEquipe,
  operacaoDoSnapshot,
  rotaDoModuloDeEquipe,
  resumirModulosDeEquipe,
  datasDoAcervo,
  paresDoMestre,
  variaveisAlteradasDeTma,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
  type AlteracaoDoMotor,
  type CartaoDeModulo,
  type CoberturaDoCatalogo,
  type Operacao,
  type ParDoCartao,
  type QuadroDeQlp,
  type VigenciaEmparelhavel,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import { classificarFalha } from "../lib/classificar-falha";
import {
  ORCAMENTO_DE_CANDIDATAS_MS,
  TETO_DE_CANDIDATAS_MS,
  type BaldeDoImpacto,
  type CandidatasDoPar,
  type NumerosDoPar,
} from "../lib/candidatas-do-par";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { consolidadoDosModulos } from "./monitor-custo-fixo";

/**
 * ALTERAÇÕES POR MÓDULO — as três famílias de custo numa resposta só.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota também é curta
 * ---------------------------------------------------------------------------
 * Pela mesma razão que a do Monitor Custo Fixo e a do Monitor Equipe: ela não
 * compara e não soma. O motor compara, `listChanges` lê, cada recorte de
 * rubrica traduz, `alteracoes-por-modulo.ts` compõe o cartão — e aqui só se
 * costura. O custo fixo, aliás, nem isso: ele passa por
 * `consolidadoDosModulos`, a **mesma função** que o Monitor chama, para que as
 * duas telas não tenham como divergir num número.
 *
 * ---------------------------------------------------------------------------
 * Três coberturas, três (ou quatro) pares — e nunca um par da tela
 * ---------------------------------------------------------------------------
 * O motor recusa um par entre coberturas diferentes, e esta leitura atravessa
 * quatro delas: equipamento (custo fixo inteiro e manutenção), trecho (consumo,
 * pneu, km rodado, velocidade média e TMA) e os dois quadros do QLP. Então cada
 * cobertura tem o par dela, pedido no endereço, e cada cartão carrega o par
 * contra o qual **ele** foi apurado.
 *
 * Nenhum par é obrigatório. Sem nenhum, a resposta é o catálogo inteiro dizendo,
 * módulo a módulo, por que não há o que mostrar — que é diferente de uma tela
 * vazia, e é a diferença que interessa a quem audita.
 *
 * ---------------------------------------------------------------------------
 * Uma leitura por cobertura, e não uma por módulo
 * ---------------------------------------------------------------------------
 * Os módulos de uma mesma cobertura leem o mesmo `change_set`: pedir as mesmas
 * linhas uma vez por rubrica daria a mesma resposta doze vezes mais devagar. O
 * recorte é a união dos catálogos, e cada `linhasDeX` filtra o que é dele — a
 * mesma decisão que `routes/monitor-custo-fixo.ts` documenta.
 */
const router: IRouter = Router();

/** O teto de linhas por leitura — o mesmo dos dois Monitores. */
export const TETO_DE_LINHAS = 5000;

/** O recorte da cobertura de equipamento: custo fixo inteiro e manutenção. */
export const CODIGOS_DE_EQUIPAMENTO = [
  ...new Set([
    ...CODIGOS_DO_DETALHE,
    ...CODIGOS_DO_DETALHE_DE_ALUGUEL,
    ...CODIGOS_DO_DETALHE_DE_IPVA,
    ...CODIGOS_DO_DETALHE_DE_IMPOSTOS,
    ...CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
    ...CODIGOS_DO_DETALHE_DE_AQUISICAO,
    ...CODIGOS_DO_DETALHE_DE_SEGURO,
    ...CODIGOS_DO_DETALHE_DE_MANUTENCAO,
  ]),
];

/**
 * Os códigos de cada módulo, por módulo — o recorte que "Ver histórico" leva.
 *
 * As listas já existiam, cada uma no arquivo da rubrica dela; o que faltava era
 * a chave. Ela mora aqui, e não no pacote de domínio, pelo mesmo motivo que
 * `RUBRICAS_DE_TRECHO`: o que ela junta é a tradução de uma rubrica com o
 * endereço da tela dela, e a costura é trabalho desta rota.
 *
 * Um módulo esquecido aqui não erra número nenhum — ele só abre o histórico sem
 * recorte, que é a leitura inteira e não uma leitura errada.
 */
export const CODIGOS_POR_MODULO: Record<string, readonly string[]> = {
  FINAME: CODIGOS_DO_DETALHE,
  ALUGUEL: CODIGOS_DO_DETALHE_DE_ALUGUEL,
  IPVA: CODIGOS_DO_DETALHE_DE_IPVA,
  IMPOSTOS: CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  LUCRO_FIXO: CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  AQUISICAO: CODIGOS_DO_DETALHE_DE_AQUISICAO,
  SEGURO: CODIGOS_DO_DETALHE_DE_SEGURO,
  MANUTENCAO: CODIGOS_DO_DETALHE_DE_MANUTENCAO,
  CONSUMO: CODIGOS_DO_DETALHE_DE_CONSUMO,
  PNEU: CODIGOS_DO_DETALHE_DE_PNEU,
  KM_RODADO: CODIGOS_DO_DETALHE_DE_KM,
  VELOCIDADE_MEDIA: CODIGOS_DO_DETALHE_DE_VELOCIDADE,
  TMA: CODIGOS_LIDOS_DO_TMA,
};

/** O recorte da cobertura de trecho: as cinco rubricas que leem a malha. */
export const CODIGOS_DE_TRECHO = [
  ...new Set([
    ...CODIGOS_DO_DETALHE_DE_CONSUMO,
    ...CODIGOS_DO_DETALHE_DE_PNEU,
    ...CODIGOS_DO_DETALHE_DE_KM,
    ...CODIGOS_DO_DETALHE_DE_VELOCIDADE,
    ...CODIGOS_LIDOS_DO_TMA,
  ]),
];

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/** O par que o endereço pede para uma cobertura, quando pede os dois lados. */
function parPedido(
  query: Record<string, unknown>,
  sufixo: string,
): { base: string; comparada: string } | null {
  const base = texto(query[`base${sufixo}`]);
  const comparada = texto(query[`comparada${sufixo}`]);
  return base && comparada ? { base, comparada } : null;
}

/**
 * Por que esta cobertura não entrou — a frase, e não um booleano.
 *
 * `motivoSemPar` separa "não importaram" de "importaram uma só" de "são de
 * unidades diferentes", e cada um pede uma frase diferente de quem lê. A quarta
 * razão não vem dele: é o par que a tela **não escolheu**, e ela é a mais comum
 * aqui — um link antigo nomeia o par de equipamento e cala sobre o de trecho.
 */
export function motivoDaCoberturaAusente(
  nome: string,
  vigencias: readonly VigenciaEmparelhavel[],
): string {
  const motivo = motivoSemPar(vigencias);
  if (!motivo) return `Nenhum par de ${nome} foi escolhido nesta leitura.`;
  switch (motivo.motivo) {
    case "LISTA_VAZIA":
      return `Nenhuma vigência de ${nome} foi importada ainda.`;
    case "UMA_SO":
      return `Só uma vigência de ${nome} foi importada — comparar exige duas.`;
    case "UNIDADES_DIFERENTES":
      return (
        `As vigências de ${nome} desta lista são de unidades diferentes, e o motor ` +
        `não compara unidades distintas. Escolha uma unidade na lateral.`
      );
    default:
      return (
        `As vigências de ${nome} chegaram cobrindo conjuntos diferentes de entidade ` +
        `(${motivo.coberturas.join(" e ")}), e o motor só compara vigências de mesma ` +
        `cobertura.`
      );
  }
}

/** O par de um cartão, montado com os rótulos que o acervo deu às duas pontas. */
function parDoCartao(
  par: { base: string; comparada: string },
  vigencias: readonly { id: string; sourceLabel: string | null; effectiveDate: string }[],
): ParDoCartao {
  const a = vigencias.find((v) => v.id === par.base);
  const b = vigencias.find((v) => v.id === par.comparada);
  return {
    baseId: par.base,
    comparadaId: par.comparada,
    baseRotulo: a?.sourceLabel ?? null,
    comparadaRotulo: b?.sourceLabel ?? null,
    baseData: a?.effectiveDate ?? null,
    comparadaData: b?.effectiveDate ?? null,
  };
}

/**
 * O catálogo das rubricas de trecho — o que cada uma lê, e como ela se chama.
 *
 * A lista mora aqui e não no pacote de domínio porque o que ela junta é a
 * **tradução de cada rubrica com o endereço da tela dela**: `linhasDeX` e
 * `impactoDeX` são do domínio, o endereço é da interface, e a costura é o
 * trabalho desta rota. Acrescentar rubrica é acrescentar uma linha — e uma
 * rubrica esquecida aparece na tela como cartão que não existe, não como número
 * errado.
 */
const RUBRICAS_DE_TRECHO = [
  {
    modulo: "CONSUMO",
    rotulo: "Consumo",
    rota: "/custo-variavel-consumo",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeConsumo(rows),
    impacto: (linhas: ReturnType<typeof linhasDeConsumo>) => {
      const i = impactoDeConsumo(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.razoesAlteradas, frase: "parcelas de R$/km se moveram" },
          { quantidade: i.rendimentosAlterados, frase: "rendimentos se moveram" },
          { quantidade: i.perdasAlteradas, frase: "perdas de rendimento se moveram" },
        ],
      };
    },
  },
  {
    modulo: "PNEU",
    rotulo: "Pneu",
    rota: "/custo-variavel-pneu",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDePneu(rows),
    impacto: (linhas: ReturnType<typeof linhasDePneu>) => {
      const i = impactoDePneu(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.razoesAlteradas, frase: "parcelas de R$/km se moveram" },
          { quantidade: i.vidasAlteradas, frase: "vidas úteis se moveram" },
          { quantidade: i.unitariosAlterados, frase: "valores unitários se moveram" },
        ],
      };
    },
  },
  {
    modulo: "KM_RODADO",
    rotulo: "Km Rodado",
    rota: "/custo-variavel-km-rodado",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeKm(rows),
    impacto: (linhas: ReturnType<typeof linhasDeKm>) => {
      const i = impactoDeKm(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.razoesAlteradas, frase: "parcelas de R$/km se moveram" },
          { quantidade: i.distanciasAlteradas, frase: "distâncias se moveram" },
        ],
      };
    },
  },
  {
    modulo: "VELOCIDADE_MEDIA",
    rotulo: "Velocidade Média",
    rota: "/custo-variavel-velocidade-media",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeVelocidade(rows),
    impacto: (linhas: ReturnType<typeof linhasDeVelocidade>) => {
      const i = impactoDeVelocidade(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.paradasAlteradas, frase: "minutos de parada se moveram" },
          { quantidade: i.velocidadesAlteradas, frase: "velocidades declaradas se moveram" },
          {
            quantidade: i.versaoLucroAlterada,
            frase: "alterações na versão lucro — o tempo que remunera",
          },
        ],
      };
    },
  },
] as const;

/** As rubricas de equipamento que o Monitor Custo Fixo não consolida. */
const RUBRICAS_DE_EQUIPAMENTO = [
  {
    modulo: "AQUISICAO",
    rotulo: "Aquisição",
    rota: "/custo-fixo-aquisicao",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeAquisicao(rows),
    impacto: (linhas: ReturnType<typeof linhasDeAquisicao>) => {
      const i = impactoDeAquisicao(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.notasAlteradas, frase: "notas de compra mudaram de valor" },
          {
            quantidade: i.valoresNegativos,
            frase: "com uma das pontas negativa — estorno ou erro de cadastro",
          },
        ],
      };
    },
  },
  {
    modulo: "SEGURO",
    rotulo: "Seguro e Aparato",
    rota: "/custo-fixo-seguro",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeSeguro(rows),
    impacto: (linhas: ReturnType<typeof linhasDeSeguro>) => {
      const i = impactoDeSeguro(linhas);
      return {
        impacto: i,
        notas: [
          {
            quantidade: i.alteracoesDeTaxa,
            frase: "em coluna de taxa — a tabela mudou, e não um ativo",
          },
        ],
      };
    },
  },
  {
    modulo: "MANUTENCAO",
    rotulo: "Manutenção",
    rota: "/custo-variavel-manutencao",
    linhas: (rows: readonly AlteracaoDoMotor[]) => linhasDeManutencao(rows),
    impacto: (linhas: ReturnType<typeof linhasDeManutencao>) => {
      const i = impactoDeManutencao(linhas);
      return {
        impacto: i,
        notas: [
          { quantidade: i.alteracoesDeReaisKm, frase: "alterações em R$/km" },
        ],
      };
    },
  },
] as const;

/**
 * A manutenção é de custo **variável** e lê cobertura de **equipamento**.
 *
 * As duas coisas são verdadeiras ao mesmo tempo, e é por isso que ela viaja na
 * lista de equipamento e sai no cartão de custo variável: a família diz de que
 * se paga, a cobertura diz de que lista de vigências sai o par. Confundi-las
 * poria a manutenção na lateral errada ou a compararia contra trechos.
 */
const AREA_DA_RUBRICA_DE_EQUIPAMENTO: Record<string, "CUSTO_FIXO" | "CUSTO_VARIAVEL"> = {
  AQUISICAO: "CUSTO_FIXO",
  SEGURO: "CUSTO_FIXO",
  MANUTENCAO: "CUSTO_VARIAVEL",
};

/**
 * `GET /alteracoes-por-modulo/consolidado`
 *
 * Os pares, todos opcionais e todos por cobertura:
 * `baseEquipamento`/`comparadaEquipamento`, `baseTrecho`/`comparadaTrecho`,
 * `baseOperacional`/`comparadaOperacional` e
 * `baseAdministrativo`/`comparadaAdministrativo`.
 */
router.get("/alteracoes-por-modulo/consolidado", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;

  const pares = {
    equipamento: parPedido(query, "Equipamento"),
    trecho: parPedido(query, "Trecho"),
    OPERACIONAL: parPedido(query, "Operacional"),
    ADMINISTRATIVO: parPedido(query, "Administrativo"),
  };

  for (const par of Object.values(pares)) {
    if (!par) continue;
    for (const id of [par.base, par.comparada]) {
      await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
    }
  }

  const operacao = operacaoDaConsulta(query);

  try {
    const [deEquipamento, doQuadro] = await Promise.all([
      listComparableSnapshots(db, { operacao }),
      listComparableSnapshots(db, {
        datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
        operacao,
      }),
    ]);

    const cartoes: CartaoDeModulo[] = [];
    const changeSets: Record<string, string> = {};

    cartoes.push(
      ...(await cartoesDeEquipamento(db, pares.equipamento, deEquipamento, changeSets)),
    );
    cartoes.push(...(await cartoesDeTrecho(db, pares.trecho, deEquipamento, changeSets)));
    for (const quadro of ["OPERACIONAL", "ADMINISTRATIVO"] as const) {
      cartoes.push(...(await cartoesDeEquipe(db, quadro, pares[quadro], doQuadro, changeSets)));
    }

    res.json({ changeSets, areas: agruparPorArea(cartoes) });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Catálogo de alterações por módulo recusado");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * A cobertura de equipamento — o custo fixo inteiro mais a manutenção.
 *
 * Os cinco módulos do Monitor saem de `consolidadoDosModulos`, sem filtro
 * nenhum: é a mesma função, sobre as mesmas linhas, que a tela do Monitor chama.
 * Aquisição, seguro e manutenção saem dos recortes próprios, porque o Monitor
 * não os consolida — e não os consolida de propósito, pelas razões que os
 * cabeçalhos de `aquisicao.ts` e `seguro.ts` escrevem.
 */
async function cartoesDeEquipamento(
  db: Database,
  par: { base: string; comparada: string } | null,
  vigencias: readonly (VigenciaEmparelhavel & {
    sourceLabel: string | null;
    entityTypeSet?: string | null;
  })[],
  changeSets: Record<string, string>,
): Promise<CartaoDeModulo[]> {
  const cobertura: CoberturaDoCatalogo = "EQUIPAMENTO";
  const doTipo = vigenciasQueCobrem(vigencias, TIPOS_DE_EQUIPAMENTO);

  if (!par) {
    const ausente = motivoDaCoberturaAusente("equipamento", doTipo);
    return [
      ...MODULOS_DO_MONITOR.map((modulo) =>
        cartaoAusente({
          area: "CUSTO_FIXO",
          modulo,
          rotulo: null,
          rota: `/custo-fixo-${modulo.toLowerCase().replace("_", "-")}`,
          cobertura,
          ausente,
          rotuloDaEntidade: "Entidades",
        }),
      ),
      ...RUBRICAS_DE_EQUIPAMENTO.map((r) =>
        cartaoAusente({
          area: AREA_DA_RUBRICA_DE_EQUIPAMENTO[r.modulo] ?? "CUSTO_FIXO",
          modulo: r.modulo,
          rotulo: r.rotulo,
          rota: r.rota,
          cobertura,
          ausente,
          rotuloDaEntidade: "Veículos",
        }),
      ),
    ];
  }

  const changeSet =
    (await getChangeSetForPair(db, par.base, par.comparada)) ??
    (await computeChangeSet(db, par.base, par.comparada, {
      computedBy: "api:alteracoes-por-modulo",
    }));
  changeSets.EQUIPAMENTO = changeSet.id;

  const { rows } = await listChanges(db, changeSet.id, {
    attributeCodes: CODIGOS_DE_EQUIPAMENTO,
    limit: TETO_DE_LINHAS,
  });

  return cartoesDeEquipamentoDasLinhas(rows, parDoCartao(par, vigencias), changeSet.id);
}

/**
 * Os cartões de equipamento a partir das linhas — sem banco, e sem par a
 * escolher.
 *
 * A separação existe porque duas leituras precisam exatamente disto: o catálogo
 * por par, que chega com um par escolhido, e a varredura de última alteração,
 * que repete a montagem **por par visitado** sobre as linhas que já leu. Sem
 * ela, a varredura teria uma segunda cópia de como um cartão de FINAME nasce — e
 * as duas telas divergiriam no dia em que uma rubrica mudasse de lugar.
 */
export function cartoesDeEquipamentoDasLinhas(
  rows: readonly AlteracaoDoMotor[],
  cartao: ParDoCartao,
  changeSetId: string,
): CartaoDeModulo[] {
  const cobertura: CoberturaDoCatalogo = "EQUIPAMENTO";
  /*
    Sem filtro nenhum: o catálogo publica o módulo inteiro, e quem quiser
    recortar tem o Monitor a um clique — com o par junto.
  */
  const { resumo } = consolidadoDosModulos(
    rows,
    {
      modulos: [...MODULOS_DO_MONITOR],
      equipamento: null,
      situacoes: [],
      periodicidades: [],
      busca: null,
    },
    { ...cartao },
    changeSetId,
  );

  return [
    ...resumo.porModulo.map(cartaoDoCustoFixo),
    ...RUBRICAS_DE_EQUIPAMENTO.map((r) => {
      const linhas = r.linhas(rows);
      const { impacto, notas } = r.impacto(linhas as never);
      return cartaoDeRubrica({
        area: AREA_DA_RUBRICA_DE_EQUIPAMENTO[r.modulo] ?? "CUSTO_FIXO",
        modulo: r.modulo,
        rotulo: r.rotulo,
        rota: r.rota,
        cobertura,
        par: cartao,
        rotuloDaEntidade: "Veículos",
        linhas,
        impacto,
        notas,
      });
    }),
  ];
}

/** A cobertura de trecho — as quatro rubricas da malha, mais o TMA. */
async function cartoesDeTrecho(
  db: Database,
  par: { base: string; comparada: string } | null,
  vigencias: readonly (VigenciaEmparelhavel & { sourceLabel: string | null })[],
  changeSets: Record<string, string>,
): Promise<CartaoDeModulo[]> {
  const cobertura: CoberturaDoCatalogo = "TRECHO";
  const doTipo = vigenciasQueCobrem(vigencias, TIPO_DO_CONSUMO);

  if (!par) {
    const ausente = motivoDaCoberturaAusente("trecho", doTipo);
    return [
      ...RUBRICAS_DE_TRECHO.map((r) =>
        cartaoAusente({
          area: "CUSTO_VARIAVEL",
          modulo: r.modulo,
          rotulo: r.rotulo,
          rota: r.rota,
          cobertura,
          ausente,
          rotuloDaEntidade: "Trechos",
        }),
      ),
      cartaoAusente({
        area: "CUSTO_VARIAVEL",
        modulo: "TMA",
        rotulo: "TMA",
        rota: "/custo-variavel-tma",
        cobertura,
        ausente,
        rotuloDaEntidade: "Trechos",
      }),
    ];
  }

  const changeSet =
    (await getChangeSetForPair(db, par.base, par.comparada)) ??
    (await computeChangeSet(db, par.base, par.comparada, {
      computedBy: "api:alteracoes-por-modulo",
    }));
  changeSets.TRECHO = changeSet.id;

  const { rows } = await listChanges(db, changeSet.id, {
    attributeCodes: CODIGOS_DE_TRECHO,
    limit: TETO_DE_LINHAS,
  });

  return cartoesDeTrechoDasLinhas(rows, parDoCartao(par, vigencias));
}

/** Os cartões de trecho a partir das linhas — ver `cartoesDeEquipamentoDasLinhas`. */
export function cartoesDeTrechoDasLinhas(
  rows: readonly AlteracaoDoMotor[],
  cartao: ParDoCartao,
): CartaoDeModulo[] {
  const cobertura: CoberturaDoCatalogo = "TRECHO";

  const daMalha = RUBRICAS_DE_TRECHO.map((r) => {
    const linhas = r.linhas(rows);
    const { impacto, notas } = r.impacto(linhas as never);
    return cartaoDeRubrica({
      area: "CUSTO_VARIAVEL",
      modulo: r.modulo,
      rotulo: r.rotulo,
      rota: r.rota,
      cobertura,
      par: cartao,
      rotuloDaEntidade: "Trechos",
      linhas,
      impacto,
      notas,
    });
  });

  /*
    O TMA não passa pelo mesmo caminho, e a diferença é do domínio: a tela dele
    lê as duas pontas inteiras porque local não é entidade do acervo, e por isso
    ela não tem resumo de recorte. O que o change set responde — quantas colunas
    de porta se moveram — é exatamente o que cabe num cartão de catálogo, e é o
    mesmo número que o seletor daquela tela publica (`variaveisAlteradasDeTma`).
  */
  const codigosDoTma = new Set(CODIGOS_LIDOS_DO_TMA);
  const linhasDoTma = rows.filter(
    (r) => r.attributeCode !== null && codigosDoTma.has(r.attributeCode),
  );

  return [
    ...daMalha,
    cartaoDeRubrica({
      area: "CUSTO_VARIAVEL",
      modulo: "TMA",
      rotulo: "TMA",
      rota: "/custo-variavel-tma",
      cobertura,
      par: cartao,
      rotuloDaEntidade: "Trechos",
      linhas: linhasDoTma,
      impacto: { porPeriodicidade: {}, foraDaSoma: 0 },
      notas: [
        {
          quantidade: variaveisAlteradasDeTma(rows),
          frase: "colunas de porta se moveram",
        },
      ],
      semImpacto: SEM_IMPACTO_DE_TMA,
    }),
  ];
}

/**
 * Um quadro do QLP — e um cartão por assunto **dentro dele**.
 *
 * O Monitor Equipe resume os módulos sobre os dois quadros juntos e abre a
 * quebra dentro do cartão, porque lá os dois têm o mesmo lugar na tela. Aqui não
 * podem: o cartão do catálogo carrega o par contra o qual foi apurado, e os dois
 * quadros têm pares diferentes. Um cartão que somasse os dois teria dois pares e
 * publicaria um — então são dois cartões, cada um com o seu, distinguidos pela
 * cobertura.
 */
async function cartoesDeEquipe(
  db: Database,
  quadro: QuadroDeQlp,
  par: { base: string; comparada: string } | null,
  vigencias: readonly (VigenciaEmparelhavel & { sourceLabel: string | null })[],
  changeSets: Record<string, string>,
): Promise<CartaoDeModulo[]> {
  const cobertura: CoberturaDoCatalogo =
    quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO";
  const nome = quadro === "OPERACIONAL" ? "quadro operacional" : "quadro administrativo";
  const tipo = TIPO_DO_QUADRO[quadro];
  const doTipo = vigenciasQueCobrem(vigencias, tipo);

  if (!par) {
    /*
      Sem par, o catálogo do QLP ainda tem o que dizer: os assuntos existem no
      catálogo de colunas, e o que falta é a comparação. Um cartão por assunto
      com a frase da ausência é o que impede "o quadro não mudou" de ser lido
      onde o que houve foi uma importação que não veio.
    */
    const ausente = motivoDaCoberturaAusente(nome, doTipo);
    return modulosDoQlp().map((m) =>
      cartaoAusente({
        area: "EQUIPE",
        modulo: m.chave,
        rotulo: null,
        rota: rotaDoModuloDeEquipe(m.chave, quadro),
        cobertura,
        ausente,
        rotuloDaEntidade: "Cargos",
      }),
    );
  }

  const changeSet =
    (await getChangeSetForPair(db, par.base, par.comparada)) ??
    (await computeChangeSet(db, par.base, par.comparada, {
      computedBy: "api:alteracoes-por-modulo",
    }));
  changeSets[cobertura] = changeSet.id;

  const { rows } = await listChanges(db, changeSet.id, {
    attributeCodes: codigosDoQuadro(quadro),
    entityType: tipo,
    limit: TETO_DE_LINHAS,
  });

  return cartoesDeEquipeDasLinhas(rows, quadro, parDoCartao(par, vigencias), changeSet.id);
}

/**
 * Os dezesseis assuntos de um quadro, existam eles nas linhas ou não.
 *
 * `resumirModulosDeEquipe` devolve só os assuntos que **se moveram** — é o certo
 * para o Monitor, que lista o que aconteceu. Aqui é o contrário: o catálogo de
 * assuntos é do produto, e um assunto que some quando não mexeu faria "o
 * treinamento não mudou" e "o treinamento não existe neste quadro" virarem a
 * mesma ausência em tela. A lista vem de `modulosDoQlp()`, que é a mesma que o
 * ramo sem par de `cartoesDeEquipe` já usava.
 */
export function moldesDeEquipe(quadro: QuadroDeQlp): CartaoDeModulo[] {
  const cobertura: CoberturaDoCatalogo =
    quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO";
  return modulosDoQlp().map((m) => ({
    ...cartaoAusente({
      area: "EQUIPE",
      modulo: m.chave,
      rotulo: null,
      rota: rotaDoModuloDeEquipe(m.chave, quadro),
      cobertura,
      ausente: "",
      rotuloDaEntidade: "Cargos",
    }),
    ausente: null,
    /* A frase do QLP viaja no molde: é dela que `naturezaDoCartao` lê que este
       assunto não publica montante, sem uma segunda lista de exceções. */
    semImpacto: SEM_IMPACTO_FINANCEIRO,
  }));
}

/** Os cartões de um quadro a partir das linhas — ver `cartoesDeEquipamentoDasLinhas`. */
export function cartoesDeEquipeDasLinhas(
  rows: readonly AlteracaoDoMotor[],
  quadro: QuadroDeQlp,
  cartao: ParDoCartao,
  changeSetId: string,
): CartaoDeModulo[] {
  const cobertura: CoberturaDoCatalogo =
    quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO";
  const linhas = normalizarLinhasDeEquipe(
    linhasDeQlpComparado(rows, quadro),
    { quadro, ...cartao },
    changeSetId,
  );

  /* A ordem dos módulos é a do catálogo — ver `resumirModulosDeEquipe`. */
  return resumirModulosDeEquipe(
    linhas,
    modulosDoQlp().map((m) => m.chave),
  ).map((resumo) =>
    cartaoDeEquipe(resumo, {
      rota: rotaDoModuloDeEquipe(resumo.modulo, quadro),
      cobertura,
      par: cartao,
      semImpacto: SEM_IMPACTO_FINANCEIRO,
    }),
  );
}

// ---------------------------------------------------------------------------
// As candidatas do seletor mestre
// ---------------------------------------------------------------------------

/**
 * O que cada data candidata a "De" produz no catálogo inteiro.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é por DATA, e não por id de vigência
 * ---------------------------------------------------------------------------
 * Porque é isso que o seletor mestre oferece, e ele não tinha como oferecer
 * outra coisa: as quatro coberturas têm ids diferentes para a mesma quinzena —
 * equipamento e trecho saem de `/snapshots`, os dois quadros do QLP de outra
 * consulta. As dezesseis rotas de candidatas que já existem são todas por id
 * porque cada uma responde por **uma** cobertura; esta responde pelas quatro,
 * e a data é a única chave que as quatro compartilham.
 *
 * A tradução de data para os ids de cada cobertura é `paresDoMestre`, a
 * **mesma** função que a tela usa para escrever o par no endereço ao clicar na
 * linha. É o que garante o contrato deste menu: o número ao lado de uma data é
 * o número que o clique naquela data entrega — nunca uma segunda conta, nunca
 * um par vizinho.
 *
 * ---------------------------------------------------------------------------
 * Por que o dinheiro sai rotulado por área, e não somado
 * ---------------------------------------------------------------------------
 * Porque `alteracoes-por-modulo.ts` recusa o total geral por escrito, e a
 * recusa é do domínio: custo fixo publica reais do período, custo variável
 * publica razões (R$/km, minutos) que só viram dinheiro multiplicadas por
 * produção, e a equipe não publica dinheiro nenhum enquanto a curadoria não
 * confirmar a semântica das colunas do QLP. As três chaves de periodicidade são
 * as mesmas (`MENSAL`, `ANUAL`, `PONTUAL`), então somar balde a balde entre
 * áreas **fundiria** as réguas sem que nada na tela dissesse.
 *
 * Cada balde sai, portanto, com o nome da área junto, e a linha do menu escreve
 * uma por régua — a mesma separação que os cartões do catálogo já publicam.
 *
 * O orçamento, o reaproveitamento do que já foi comparado e o `numeros: null`
 * de quem não coube são os de `lib/candidatas-do-par.ts`, como nas dezesseis
 * outras. O que muda é a unidade de trabalho: ali uma candidata é uma
 * comparação, aqui é **até quatro** — uma por cobertura que forma o par.
 */
export function numerosDoCatalogo(cartoes: readonly CartaoDeModulo[]): NumerosDoPar {
  const baldes: BaldeDoImpacto[] = [];
  let alteracoes = 0;

  for (const area of agruparPorArea([...cartoes])) {
    alteracoes += area.alteracoes;
    for (const [periodicidade, valor] of Object.entries(area.porPeriodicidade)) {
      baldes.push({ periodicidade, valor, rotulo: area.rotulo });
    }
  }

  /*
    `R$ 0,00` só é dizível onde alguma área **mede** dinheiro.

    Um mestre que só forma par nos dois quadros do QLP apura contagem e mais
    nada: ali o balde vazio não é uma conta que deu zero, é uma conta que
    ninguém fez, e escrever `R$ 0,00` afirmaria que o dinheiro não se moveu numa
    leitura que nunca olhou para ele. É a mesma régua de `impactoPublicavel`, um
    nível acima — e a frase é a que aquelas telas já publicam.
  */
  const mede = cartoes.some((c) => c.par !== null && c.semImpacto === null);
  return baldes.length === 0 && !mede
    ? { alteracoes, impacto: { baldes }, semImpacto: SEM_IMPACTO_FINANCEIRO }
    : { alteracoes, impacto: { baldes } };
}

/**
 * `GET /alteracoes-por-modulo/candidatos?para=<YYYY-MM-DD>`
 *
 * `scopeHash` recorta a frota pela unidade aberta — e é obrigatório aqui no
 * sentido em que a tela sempre o manda quando o tem. As rotas por id não
 * precisam dele porque a unidade vem do próprio destino (`formamParDeVigencias`
 * exige mesma unidade); uma data não carrega unidade nenhuma, então sem este
 * recorte o menu ofereceria as quinzenas de Pernambuco a quem está em Camaçari
 * — e elas nem formariam par.
 */
router.get("/alteracoes-por-modulo/candidatos", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const para = texto(query.para);
  if (!para) {
    res.status(400).json({ error: "Informe a data de destino." });
    return;
  }
  const operacao = operacaoDaConsulta(query);
  const scopeHash = texto(query.scopeHash);

  try {
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoCatalogo(dbComTeto, { para, operacao, scopeHash }),
    );
    res.json(resposta);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Candidatas do catálogo recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

async function candidatasDoCatalogo(
  db: Database,
  { para, operacao, scopeHash }: {
    para: string;
    operacao: Operacao | null;
    scopeHash: string | null;
  },
): Promise<CandidatasDoPar> {
  const [daFrota, doQuadro] = await Promise.all([
    listComparableSnapshots(db, { operacao }),
    listComparableSnapshots(db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
      operacao,
    }),
  ]);

  /*
    As quatro listas, recortadas exatamente como a tela as recorta
    (`pages/alteracoes-por-modulo.tsx`). Uma divergência aqui não daria erro:
    daria um menu oferecendo datas que a tela não oferece, ou calando sobre
    datas que ela oferece — e as duas coisas se leem como número que falta.
  */
  const frota = vigenciasDaUnidade(daFrota, scopeHash);
  const listas = {
    EQUIPAMENTO: vigenciasQueCobrem(frota, TIPOS_DE_EQUIPAMENTO),
    TRECHO: vigenciasQueCobrem(frota, TIPO_DO_CONSUMO),
    QLP_OPERACIONAL: vigenciasQueCobrem(doQuadro, TIPO_DO_QUADRO.OPERACIONAL),
    QLP_ADMINISTRATIVO: vigenciasQueCobrem(doQuadro, TIPO_DO_QUADRO.ADMINISTRATIVO),
  };

  /* Da mais recente para a mais antiga: quem abre o menu olha primeiro as de
     cima, então são elas que ganham o orçamento. A mesma ordem de
     `candidatasDoPar`, e a mesma que o seletor desenha. */
  const candidatas = datasDoAcervo(listas)
    .filter((data) => data !== para)
    .map((data) => ({ data, pares: paresDoMestre({ de: data, para }, listas) }))
    /* Uma data que não forma par em cobertura nenhuma não é candidata: ela sai
       da lista em vez de voltar com `numeros: null`, que ali significaria
       "ainda não sei" e prometeria um número que nunca vem. */
    .filter(({ pares }) => Object.keys(pares).length > 0);

  const limite = Date.now() + ORCAMENTO_DE_CANDIDATAS_MS;
  const candidatos: CandidatasDoPar["candidatos"] = [];
  let pendentes = 0;

  for (const { data, pares } of candidatas) {
    const entradas = Object.entries(pares) as [
      CoberturaDoCatalogo,
      { base: string; comparada: string },
    ][];

    /*
      O orçamento é conferido por **data**, e não por cobertura.

      Uma data apurada pela metade — equipamento calculado, trecho ainda não —
      publicaria uma contagem menor do que o clique entrega, e a tela não teria
      como dizer que falta parte: a linha do menu só sabe escrever número ou
      esqueleto. Então ou a data inteira cabe, ou ela volta sem número e a
      rodada seguinte a pega do começo — barata, porque o que já foi calculado
      ficou gravado.
    */
    const gravados = await Promise.all(
      entradas.map(([, par]) => getChangeSetForPair(db, par.base, par.comparada)),
    );
    if (gravados.some((g) => !g) && Date.now() >= limite) {
      candidatos.push({ id: data, numeros: null });
      pendentes++;
      continue;
    }

    const cartoes: CartaoDeModulo[] = [];
    const changeSets: Record<string, string> = {};
    for (const [cobertura, par] of entradas) {
      if (cobertura === "EQUIPAMENTO") {
        cartoes.push(...(await cartoesDeEquipamento(db, par, frota, changeSets)));
      } else if (cobertura === "TRECHO") {
        cartoes.push(...(await cartoesDeTrecho(db, par, frota, changeSets)));
      } else {
        const quadro: QuadroDeQlp =
          cobertura === "QLP_OPERACIONAL" ? "OPERACIONAL" : "ADMINISTRATIVO";
        cartoes.push(...(await cartoesDeEquipe(db, quadro, par, doQuadro, changeSets)));
      }
    }

    candidatos.push({ id: data, numeros: numerosDoCatalogo(cartoes) });
  }

  return { para, candidatos: semRotuloRedundante(candidatos), pendentes };
}

/**
 * O rótulo da régua só existe onde há **mais de uma** — decidido sobre a lista
 * inteira, e não linha a linha.
 *
 * Ele está lá para impedir uma fusão: com custo fixo e custo variável no mesmo
 * menu, o `MENSAL` de um não pode cair na mesma linha que o `MENSAL` do outro.
 * Num acervo em que só uma área publica dinheiro — o caso comum, e o de toda
 * unidade que ainda não importou trecho — não há o que separar, e a palavra
 * vira ruído repetido em cada linha do menu, roubando a largura do número que
 * a pessoa veio ler.
 *
 * A decisão é sobre a resposta inteira pela mesma razão que o desempate dos
 * rótulos de vigência é sobre a lista inteira (`rotulosDasVigencias`): só
 * olhando as outras linhas dá para saber se **esta** precisa se distinguir.
 * Fosse por linha, uma candidata com duas áreas sairia rotulada e a de cima,
 * com uma só, sairia sem — e a ausência do rótulo passaria a significar duas
 * coisas no mesmo menu.
 */
function semRotuloRedundante(
  candidatos: CandidatasDoPar["candidatos"],
): CandidatasDoPar["candidatos"] {
  const reguas = new Set<string>();
  for (const c of candidatos) {
    for (const b of c.numeros?.impacto.baldes ?? []) if (b.rotulo) reguas.add(b.rotulo);
  }
  if (reguas.size > 1) return candidatos;

  return candidatos.map((c) =>
    c.numeros
      ? {
          ...c,
          numeros: {
            ...c.numeros,
            impacto: {
              baldes: c.numeros.impacto.baldes.map(({ rotulo: _rotulo, ...balde }) => balde),
            },
          },
        }
      : c,
  );
}

export default router;
