import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
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
  variaveisAlteradasDeTma,
  vigenciasQueCobrem,
  type AlteracaoDoMotor,
  type CartaoDeModulo,
  type CoberturaDoCatalogo,
  type ParDoCartao,
  type QuadroDeQlp,
  type VigenciaEmparelhavel,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import { classificarFalha } from "../lib/classificar-falha";
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
const TETO_DE_LINHAS = 5000;

/** O recorte da cobertura de equipamento: custo fixo inteiro e manutenção. */
const CODIGOS_DE_EQUIPAMENTO = [
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

/** O recorte da cobertura de trecho: as cinco rubricas que leem a malha. */
const CODIGOS_DE_TRECHO = [
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
      ...(await cartoesDeEquipamento(pares.equipamento, deEquipamento, changeSets)),
    );
    cartoes.push(...(await cartoesDeTrecho(pares.trecho, deEquipamento, changeSets)));
    for (const quadro of ["OPERACIONAL", "ADMINISTRATIVO"] as const) {
      cartoes.push(...(await cartoesDeEquipe(quadro, pares[quadro], doQuadro, changeSets)));
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

  const cartao = parDoCartao(par, vigencias);

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
    changeSet.id,
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

  const cartao = parDoCartao(par, vigencias);

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

  const cartao = parDoCartao(par, vigencias);
  const linhas = normalizarLinhasDeEquipe(
    linhasDeQlpComparado(rows, quadro),
    { quadro, ...cartao },
    changeSet.id,
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

export default router;
