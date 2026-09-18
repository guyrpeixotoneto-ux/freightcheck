import { Router, type IRouter } from "express";
import { db, type Database } from "@workspace/db";
import {
  TIPOS_DE_EQUIPAMENTO,
  TIPO_DO_CONSUMO,
  TIPO_DO_QUADRO,
  agruparEmAbas,
  apuracaoDoCartao,
  assuntosDoQuadro,
  cartaoDoModulo,
  cartaoDoQuadro,
  changeSetsDosPares,
  codigosDaRubrica,
  codigosDoQuadro,
  listChanges,
  listComparableSnapshots,
  moduloResolvido,
  paresConsecutivos,
  vigenciasDaUnidade,
  vigenciasQueCobrem,
  type ApuracaoDoPar,
  type CartaoDeModulo,
  type CartaoDeUltimaAlteracao,
  type CoberturaDoCatalogo,
  type LacunaDeCalculo,
  type ParDoCartao,
  type VarreduraDoCartao,
  type VigenciaEmparelhavel,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import { classificarFalha } from "../lib/classificar-falha";
import { operacaoDaConsulta } from "../lib/operacao";
import {
  CODIGOS_DE_EQUIPAMENTO,
  CODIGOS_DE_TRECHO,
  CODIGOS_POR_MODULO,
  TETO_DE_LINHAS,
  cartoesDeEquipamentoDasLinhas,
  cartoesDeEquipeDasLinhas,
  cartoesDeTrechoDasLinhas,
  moldesDeEquipe,
  motivoDaCoberturaAusente,
} from "./alteracoes-por-modulo";

/**
 * ÚLTIMAS ALTERAÇÕES — um par por módulo, e nenhum escolhido por quem lê.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota existe ao lado de `/consolidado`, e não no lugar dela
 * ---------------------------------------------------------------------------
 * As duas respondem perguntas diferentes, e é por isso que as duas ficam.
 *
 * `/consolidado` responde *"o que mudou entre estas duas vigências?"* — e
 * alguém escolheu as duas. Toda auditoria do produto volta para ela por link,
 * com o par no endereço, e o seletor mestre continua sendo a única coisa que
 * escreve par ali.
 *
 * Esta responde *"quando foi a última vez que cada módulo se moveu?"*, que não
 * tem par para escolher: ela **descobre** o par de cada módulo. Trocar uma pela
 * outra quebraria todo link que nomeia vigência; fundi-las numa rota só faria
 * uma consulta com dois contratos.
 *
 * ---------------------------------------------------------------------------
 * A varredura, e por que ela não é um N+1
 * ---------------------------------------------------------------------------
 * O erro fácil aqui é perguntar por cartão: treze módulos × doze pares seriam
 * mais de cem idas ao banco para desenhar uma tela. A varredura é por
 * **cobertura**, que é a mesma divisão que `/consolidado` já faz — os módulos de
 * uma cobertura leem o mesmo `change_set`, então um `listChanges` por par
 * visitado produz *todos* os cartões daquela cobertura de uma vez, em memória.
 *
 * Antes disso, uma consulta só (`changeSetsDosPares`) diz quais dos pares
 * consecutivos das quatro coberturas já têm comparação calculada. A varredura
 * lê só esses — ela nunca manda o motor comparar, porque abrir uma página não
 * pode disparar um cálculo que leva minutos. O par elegível sem comparação é uma
 * **lacuna**, e a lacuna é dita em voz alta.
 *
 * E ela para cedo: assim que todo cartão de uma cobertura resolveu, os pares
 * mais antigos daquela cobertura não são lidos. Numa operação que mexe em tudo
 * toda quinzena, a varredura custa um `listChanges` por cobertura.
 *
 * ---------------------------------------------------------------------------
 * Nenhuma conta mora aqui
 * ---------------------------------------------------------------------------
 * Nem o impacto, nem o "antes", nem a variação. Os cartões saem das **mesmas**
 * funções que `/consolidado` chama (`cartoesDeEquipamentoDasLinhas` e as duas
 * irmãs), que por sua vez chamam as funções de impacto de cada módulo. O que
 * este arquivo faz é escolher qual par vira cartão — e a escolha é
 * `ultimaAlteracaoFinanceira`, no pacote de domínio, testada sem Postgres.
 */

const router: IRouter = Router();

/**
 * Quantos pares uma varredura lê, no máximo, por cobertura.
 *
 * Não é paginação: é o teto do custo de abrir a tela. Um acervo de três anos
 * tem setenta e duas quinzenas, e varrer todas atrás de um módulo que nunca se
 * moveu gastaria setenta e dois `listChanges` para escrever a mesma frase que o
 * décimo segundo já escreveria. O intervalo varrido vai na resposta justamente
 * para que "sem alteração" nunca seja uma afirmação maior do que a leitura.
 */
const TETO_DE_PARES = 12;

/** Uma vigência do acervo, como as duas listas a entregam. */
type Vigencia = VigenciaEmparelhavel & { sourceLabel: string | null };

/** O par consecutivo de uma cobertura, com as duas vigências inteiras. */
interface ParDeVigencias {
  base: Vigencia;
  comparada: Vigencia;
}

/**
 * O par de molde, para quando a varredura não leu par nenhum.
 *
 * Existe para que o catálogo de cartões apareça mesmo sem acervo: a lista de
 * módulos é do produto, e não da comparação. Um módulo que some quando não há
 * vigência faria "ainda não importamos trecho" parecer "este produto não audita
 * trecho".
 */
function parVazio(): ParDoCartao {
  return {
    baseId: "",
    comparadaId: "",
    baseRotulo: null,
    comparadaRotulo: null,
    baseData: null,
    comparadaData: null,
  };
}

function parDoCartao(base: Vigencia, comparada: Vigencia): ParDoCartao {
  return {
    baseId: base.id,
    comparadaId: comparada.id,
    baseRotulo: base.sourceLabel,
    comparadaRotulo: comparada.sourceLabel,
    baseData: base.effectiveDate,
    comparadaData: comparada.effectiveDate,
  };
}

/**
 * A varredura de uma cobertura — o coração desta rota.
 *
 * Recebe os pares consecutivos já ordenados e uma função que, dadas as linhas de
 * um par, devolve **todos** os cartões daquela cobertura. Devolve, por módulo, a
 * lista de apurações do mais recente ao mais antigo — parando assim que todo
 * módulo já tiver o que precisa.
 */
async function varrer(
  banco: Database,
  pares: readonly ParDeVigencias[],
  calculados: Map<string, { id: string; status: string }>,
  attributeCodes: string[],
  montar: (
    rows: Awaited<ReturnType<typeof listChanges>>["rows"],
    cartao: ParDoCartao,
    changeSetId: string,
  ) => CartaoDeModulo[],
): Promise<{
  apuracoes: Map<string, ApuracaoDoPar[]>;
  varredura: VarreduraDoCartao;
  moldes: CartaoDeModulo[];
}> {
  const apuracoes = new Map<string, ApuracaoDoPar[]>();
  const lacunas: LacunaDeCalculo[] = [];
  let moldes: CartaoDeModulo[] = [];
  let lidos = 0;
  let de: string | null = null;
  let ate: string | null = null;

  for (const { base, comparada } of pares) {
    const set = calculados.get(chaveDoPar(base.id, comparada.id));
    if (!set || set.status !== "DONE") {
      /*
        Lacuna: o par existe no acervo e ninguém o comparou. Ela entra na
        resposta e **não** é varrida — calcular aqui faria a abertura da página
        disparar minutos de motor.
      */
      lacunas.push({
        baseId: base.id,
        comparadaId: comparada.id,
        baseData: base.effectiveDate,
        comparadaData: comparada.effectiveDate,
      });
      continue;
    }

    const { rows } = await listChanges(banco, set.id, {
      attributeCodes,
      limit: TETO_DE_LINHAS,
    });
    const cartoes = montar(rows, parDoCartao(base, comparada), set.id);
    if (moldes.length === 0) moldes = cartoes;

    lidos++;
    ate ??= comparada.effectiveDate;
    de = base.effectiveDate;

    for (const cartao of cartoes) {
      const lista = apuracoes.get(cartao.modulo) ?? [];
      lista.push(apuracaoDoCartao(cartao, set.id));
      apuracoes.set(cartao.modulo, lista);
    }

    /*
      A parada antecipada: se todo módulo desta cobertura já resolveu, os pares
      mais antigos não têm o que acrescentar. Cada módulo é medido pela régua
      dele — dinheiro nos financeiros, movimento nos demais —, que é a mesma
      distinção que o cartão publica.
    */
    const faltando = cartoes.some((c) => !moduloResolvido(c, apuracoes.get(c.modulo) ?? []));
    if (!faltando) break;
  }

  return { apuracoes, varredura: { pares: lidos, de, ate, lacunas }, moldes };
}

const chaveDoPar = (base: string, comparada: string) => `${base}${comparada}`;

/**
 * `GET /alteracoes-por-modulo/ultimas-alteracoes`
 *
 * Sem par no endereço, e de propósito: o par de cada cartão é descoberto. O
 * recorte continua sendo o da lateral — `scopeHash` e `canal` —, porque uma
 * varredura que atravessasse unidades compararia acervos que o motor recusa.
 */
router.get("/alteracoes-por-modulo/ultimas-alteracoes", async (req, res, next) => {
  const query = req.query as Record<string, unknown>;
  const scopeHash = typeof query.scopeHash === "string" ? query.scopeHash : null;
  const operacao = operacaoDaConsulta(query);

  try {
    const [daFrota, doQuadro] = await Promise.all([
      listComparableSnapshots(db, { operacao }),
      listComparableSnapshots(db, {
        datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
        operacao,
      }),
    ]);

    const frota = vigenciasDaUnidade(daFrota as Vigencia[], scopeHash) as Vigencia[];
    const listas: Record<CoberturaDoCatalogo, Vigencia[]> = {
      EQUIPAMENTO: vigenciasQueCobrem(frota, TIPOS_DE_EQUIPAMENTO) as Vigencia[],
      TRECHO: vigenciasQueCobrem(frota, TIPO_DO_CONSUMO) as Vigencia[],
      QLP_OPERACIONAL: vigenciasQueCobrem(
        doQuadro as Vigencia[],
        TIPO_DO_QUADRO.OPERACIONAL,
      ) as Vigencia[],
      QLP_ADMINISTRATIVO: vigenciasQueCobrem(
        doQuadro as Vigencia[],
        TIPO_DO_QUADRO.ADMINISTRATIVO,
      ) as Vigencia[],
    };

    const pares: Record<CoberturaDoCatalogo, ParDeVigencias[]> = {
      EQUIPAMENTO: paresConsecutivos(listas.EQUIPAMENTO, TETO_DE_PARES),
      TRECHO: paresConsecutivos(listas.TRECHO, TETO_DE_PARES),
      QLP_OPERACIONAL: paresConsecutivos(listas.QLP_OPERACIONAL, TETO_DE_PARES),
      QLP_ADMINISTRATIVO: paresConsecutivos(listas.QLP_ADMINISTRATIVO, TETO_DE_PARES),
    };

    /*
      A consulta única que evita o N+1: todas as comparações já calculadas dos
      pares das quatro coberturas, de uma vez. Nada é calculado aqui.
    */
    const calculados = await changeSetsDosPares(
      db,
      Object.values(pares)
        .flat()
        .map((p) => ({ base: p.base.id, comparada: p.comparada.id })),
    );

    const cartoes: CartaoDeUltimaAlteracao[] = [];

    // ---- equipamento: o custo fixo inteiro, mais a manutenção ----------------
    {
      const ausente =
        pares.EQUIPAMENTO.length === 0
          ? motivoDaCoberturaAusente("equipamento", listas.EQUIPAMENTO)
          : null;
      const { apuracoes, varredura, moldes } = await varrer(
        db,
        pares.EQUIPAMENTO,
        calculados,
        CODIGOS_DE_EQUIPAMENTO,
        (rows, cartao, id) => cartoesDeEquipamentoDasLinhas(rows, cartao, id),
      );
      const catalogo =
        moldes.length > 0 ? moldes : cartoesDeEquipamentoDasLinhas([], parVazio(), "");
      for (const molde of catalogo) {
        cartoes.push(
          cartaoDoModulo(
            molde,
            apuracoes.get(molde.modulo) ?? [],
            varredura,
            ausente,
            CODIGOS_POR_MODULO[molde.modulo] ?? [],
          ),
        );
      }
    }

    // ---- trecho: as quatro rubricas da malha, mais o TMA ---------------------
    {
      const ausente =
        pares.TRECHO.length === 0
          ? motivoDaCoberturaAusente("trecho", listas.TRECHO)
          : null;
      const { apuracoes, varredura, moldes } = await varrer(
        db,
        pares.TRECHO,
        calculados,
        CODIGOS_DE_TRECHO,
        (rows, cartao) => cartoesDeTrechoDasLinhas(rows, cartao),
      );
      const catalogo = moldes.length > 0 ? moldes : cartoesDeTrechoDasLinhas([], parVazio());
      for (const molde of catalogo) {
        cartoes.push(
          cartaoDoModulo(
            molde,
            apuracoes.get(molde.modulo) ?? [],
            varredura,
            ausente,
            CODIGOS_POR_MODULO[molde.modulo] ?? [],
          ),
        );
      }
    }

    // ---- os dois quadros: um cartão cada, com os assuntos dentro -------------
    for (const quadro of ["OPERACIONAL", "ADMINISTRATIVO"] as const) {
      const cobertura: CoberturaDoCatalogo =
        quadro === "OPERACIONAL" ? "QLP_OPERACIONAL" : "QLP_ADMINISTRATIVO";
      const ausente =
        pares[cobertura].length === 0
          ? motivoDaCoberturaAusente(
              quadro === "OPERACIONAL" ? "quadro operacional" : "quadro administrativo",
              listas[cobertura],
            )
          : null;
      const { apuracoes, varredura } = await varrer(
        db,
        pares[cobertura],
        calculados,
        codigosDoQuadro(quadro),
        (rows, cartao, id) => cartoesDeEquipeDasLinhas(rows, quadro, cartao, id),
      );
      /*
        O catálogo de assuntos **não** sai da varredura, e é a diferença que
        importa: `resumirModulosDeEquipe` devolve só quem se moveu, e um assunto
        parado tem de aparecer dizendo que está parado. Os moldes vêm do
        catálogo do produto; a varredura só preenche o que achou.
      */
      const catalogo = moldesDeEquipe(quadro);

      cartoes.push(
        cartaoDoQuadro({
          quadro,
          rotulo: quadro === "OPERACIONAL" ? "Quadro Operacional" : "Quadro Administrativo",
          rota: quadro === "OPERACIONAL" ? "/qlp-operacional" : "/qlp-administrativo",
          cobertura,
          assuntos: assuntosDoQuadro(catalogo, apuracoes, ausente, (assunto) =>
            codigosDaRubrica(quadro, assunto),
          ),
          varredura,
          ausente,
        }),
      );
    }

    res.json({ abas: agruparEmAbas(cartoes) });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Últimas alterações recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
