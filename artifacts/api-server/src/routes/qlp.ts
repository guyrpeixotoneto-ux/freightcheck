import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeQlp,
  codigoDoEfetivo,
  codigosDaRubrica,
  codigosDoQuadro,
  computeChangeSet,
  conferirAbono,
  conferirBenchmark,
  conferirLinha,
  distribuicaoPorEstadoDeQlp,
  frotaPorTipo,
  getChangeSetForPair,
  linhaDeQlpSemAlteracao,
  linhasDeQlpComparado,
  listChanges,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirComparacaoDeQlp,
  resumirQuadro,
  rubricasDoQuadro,
  somarEfetivo,
  resumoDasContas,
  TIPO_DO_QUADRO,
  type LinhaDeQlpComparado,
  type LinhaDoQuadro,
  type QuadroDeQlp,
  type RequestedContext,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import {
  lerQuadroParaAuditoria,
  getDetalheDoCargo,
  getEvolucaoDoQuadro,
  getInconsistenciasDoQuadro,
  getQuadroAdministrativo,
  type FiltrosDoQuadro,
} from "@workspace/qlp";

import { parseContext as parseContextoDaConsulta } from "../lib/contexto";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
/**
 * QLP Administrativo — o quadro de pessoal da estrutura administrativa.
 *
 * Quatro rotas, uma por pergunta:
 *
 * - `/qlp/administrativo` — o quadro de uma vigência: cargos por unidade, os
 *   valores que o export declarou e o resumo executivo. Efetivo e custo saem
 *   travados, com o motivo por extenso, enquanto a curadoria não confirmar a
 *   semântica — o portão é o mesmo da Composição e da DRE.
 * - `/qlp/administrativo/entidades/:entityId` — a ficha de um cargo: os fatos
 *   da vigência com a semântica de cada um e a célula de origem (arquivo, aba,
 *   linha, coluna, valor bruto), no mesmo SELECT.
 * - `/qlp/administrativo/evolucao` — a série: presença de cada cargo por
 *   quinzena e contagens de estrutura, com janela De/Até.
 * - `/qlp/administrativo/inconsistencias` — o que **não** entrou: os registros
 *   que a importação deixou em quarentena porque a planilha os trazia duas
 *   vezes com valores que discordam. É a contrapartida obrigatória da
 *   quarentena por chave — o arquivo entra, e o que ficou de fora se lê aqui.
 *
 * O que estas rotas deliberadamente **não** respondem: diferença de valor entre
 * vigências. Isso é comparação, a comparação é do motor canônico, e a tela a
 * pede pelos endpoints de change-set que já existem (`POST /change-sets`,
 * `GET /change-sets/:id/changes`, `GET /changes/:id/provenance`) — as vigências
 * de QLP são snapshots como quaisquer outros e o motor as compara entre si.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEM_QLP = "Nenhuma vigência de QLP Administrativo importada ainda.";

/**
 * O contexto pedido — **a mesma leitura de `lib/contexto.ts`**, sem a janela.
 *
 * Era uma cópia local, e a cópia era inofensiva enquanto o contexto fosse
 * unidade e canal. Deixou de ser quando a operação entrou: quatro rotas com
 * quatro parsers próprios são quatro chances de uma delas não recortar por
 * operação — e a que não recortasse mostraria, dentro da Auditoria Rota, a
 * composição, a DRE ou o balcão de compras da empurrada, sem nada na tela
 * dizendo isso. Agora o parser é um só, e é o mesmo que as onze outras rotas
 * usam.
 *
 * A janela sai porque estas leituras não a aceitam: elas respondem por **uma**
 * vigência, e um recorte de série aqui mudaria a lista do seletor sem que a
 * resposta mudasse junto — ver o cabeçalho de `routes/frota.ts`.
 */
function parseContext(query: Record<string, unknown>): RequestedContext | undefined {
  const pedido = parseContextoDaConsulta(query);
  if (pedido === undefined) return undefined;
  const { janela: _janela, ...semJanela } = pedido;
  return semJanela;
}

/**
 * A janela De/Até — só a evolução a lê. As leituras de uma vigência não
 * aceitam recorte de série de propósito: a janela mudaria a lista de vigências
 * do seletor, e um seletor que encolhe conforme o filtro é o defeito que
 * `routes/frota.ts` documenta.
 */
function parseJanela(query: Record<string, unknown>): RequestedContext["janela"] {
  const de = typeof query.de === "string" && query.de !== "" ? query.de : undefined;
  const ate = typeof query.ate === "string" && query.ate !== "" ? query.ate : undefined;
  if (de === undefined && ate === undefined) return null;
  return { ...(de !== undefined ? { de } : {}), ...(ate !== undefined ? { ate } : {}) };
}

function parsePeriod(query: Record<string, unknown>): string | undefined {
  return typeof query.period === "string" && query.period !== "" ? query.period : undefined;
}

function parseFiltros(query: Record<string, unknown>): FiltrosDoQuadro {
  return {
    ...(typeof query.busca === "string" && query.busca !== "" ? { busca: query.busca } : {}),
    ...(typeof query.unidade === "string" && query.unidade !== ""
      ? { unidade: query.unidade }
      : {}),
  };
}

router.get("/qlp/administrativo", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const view = await getQuadroAdministrativo(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    filtros: parseFiltros(query),
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

router.get("/qlp/administrativo/evolucao", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const janela = parseJanela(query);
  const view = await getEvolucaoDoQuadro(db, {
    context: { ...parseContext(query), ...(janela ? { janela } : {}) },
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

/**
 * A fila do que falta, e não um retrato da vigência selecionada.
 *
 * `period` é aceito — ele decide a vigência corrente do contexto devolvido, que
 * a tela usa para se situar —, mas a lista de pendências é do contexto inteiro:
 * dado que falta não deixa de faltar por estarmos olhando outra quinzena. Ver
 * `lib/qlp/src/inconsistencias.ts`.
 */
router.get("/qlp/administrativo/inconsistencias", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const view = await getInconsistenciasDoQuadro(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

router.get("/qlp/administrativo/entidades/:entityId", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de cargo inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const detalhe = await getDetalheDoCargo(db, entityId, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!detalhe) {
    res.status(404).json({ error: "Cargo não encontrado, ou nenhum QLP importado ainda." });
    return;
  }
  res.json(detalhe);
});

/**
 * A AUDITORIA DO QUADRO — as contas que o próprio quadro declara.
 *
 * `GET /qlp/auditoria?quadro=ADMINISTRATIVO|OPERACIONAL&period=<data>`
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota não compara vigências
 * ---------------------------------------------------------------------------
 * Porque a comparação já tem dono, e está dito no cabeçalho deste arquivo: as
 * vigências de QLP são snapshots como quaisquer outros, e o motor canônico as
 * compara pelos endpoints de change-set. O que não tinha rota é a conferência
 * **dentro** de uma vigência: `quantidade × valor = despesa` no administrativo,
 * e a cadeia dos subtotais no operacional.
 *
 * Nenhuma conta mora aqui. `@workspace/comparison/qlp` confere, e esta rota lê o
 * quadro e devolve — é a mesma divisão das seis auditorias de rubrica.
 *
 * **A leitura é a do quadro** (`lerQuadroParaAuditoria`), e não a genérica de
 * entidade: o QLP forma vigências próprias, na família QUADRO_DE_PESSOAL, e a
 * leitura genérica resolve o contexto na família de equipamento — ver o
 * cabeçalho de `lib/qlp/src/auditoria.ts`. É dela que vem também o nome legível
 * de cada cargo: a chave que o acervo guarda é `20618821000799AUXILIARADM`, e
 * sem a forma legível a tela listaria trinta linhas que ninguém distingue.
 */
router.get("/qlp/auditoria", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const pedido = typeof query.quadro === "string" ? query.quadro.toUpperCase() : "";
  if (pedido !== "ADMINISTRATIVO" && pedido !== "OPERACIONAL") {
    res.status(400).json({ error: "Informe quadro=ADMINISTRATIVO ou quadro=OPERACIONAL." });
    return;
  }
  const quadro = pedido as QuadroDeQlp;

  /*
    A leitura é a do **quadro**, e não a genérica de entidade.

    `getEntityTable` resolve o contexto pelo padrão do produto, que é a família
    de equipamento: com o QLP importado, a data mais recente do contexto era a
    do cavalo e esta tela vinha vazia nos dois quadros — e, com `?period=` de
    uma quinzena de QLP, respondia 404 sobre um acervo que tinha o arquivo. Ver
    o cabeçalho de `lib/qlp/src/auditoria.ts`.
  */
  const tabela = await lerQuadroParaAuditoria(
    db,
    TIPO_DO_QUADRO[quadro],
    codigosDoQuadro(quadro),
    {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    },
  );

  /*
    404 aqui não é defeito: é "nenhuma vigência deste quadro importada ainda", e
    esse estado tem tela própria — o mesmo desenho das outras rotas deste
    arquivo. No operacional ele é a resposta esperada até o primeiro export
    chegar, e a tela diz isso em vez de mostrar um quadro vazio.
  */
  if (!tabela) {
    res.status(404).json({
      error:
        quadro === "ADMINISTRATIVO"
          ? SEM_QLP
          : "Nenhuma vigência de QLP Operacional importada ainda.",
    });
    return;
  }

  const linhas: LinhaDoQuadro[] = tabela.linhas.map((linha) => {
    const valores: Record<string, number | null> = {};
    for (const code of codigosDoQuadro(quadro)) {
      valores[code] = comoNumero(linha.valores[code] ?? null);
    }
    return { chave: linha.chave, nome: linha.nome, valores };
  });

  res.json({
    quadro,
    /* O diagnóstico da leitura viaja junto: uma tabela vazia com colunas
       desconhecidas tem duas causas com conserto oposto, e a leitura do quadro
       já as distingue. */
    serieEntregue: tabela.serieEntregue,
    colunasDesconhecidas: tabela.colunasDesconhecidas,
    resumo: resumirQuadro(linhas, quadro),
    contas: resumoDasContas(linhas, quadro),
    benchmark: quadro === "ADMINISTRATIVO" ? conferirBenchmark(linhas) : null,
    abono: quadro === "OPERACIONAL" ? conferirAbono(linhas) : null,
    linhas: linhas.map((l) => conferirLinha(l, quadro)),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * Nesta rubrica o branco decide um veredito: `Number("")` é `0`, e uma
 * quantidade zero inventada pela conversão faria a conta esperar R$ 0,00 e
 * acusar de divergência uma linha que só está incompleta.
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * A COMPARAÇÃO DO QUADRO — o recorte de rubrica, por cargo.
 *
 * `GET /qlp/comparacao?quadro=ADMINISTRATIVO|OPERACIONAL&base=<id>&comparada=<id>`
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é curta, e por que ela não soma dinheiro
 * ---------------------------------------------------------------------------
 * Curta porque não compara nada: `computeChangeSet` compara, `listChanges` lê e
 * `qlp-comparacao.ts` traduz — a mesma costura das seis auditorias de rubrica, e
 * igual a elas de propósito. Uma rota que fizesse conta própria seria a sétima
 * régua da mesma pergunta.
 *
 * E não soma dinheiro porque as colunas do QLP chegam sem semântica confirmada:
 * é o mesmo portão que trava efetivo total e custo da estrutura na aba do
 * Quadro. O único agregado monetário que as outras seis publicam — o impacto em
 * reais — aqui é uma frase que diz por que ele não existe. A soma que sobra é a
 * do efetivo, que é de gente.
 *
 * Substituiu a aba de Alterações, que mostrava o diff genérico do motor: mesma
 * comparação, mesmo `change_set`, e o grão que faltava — uma linha por cargo e
 * variável em vez de uma lista de atributos soltos.
 */
router.get("/qlp/comparacao", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const pedido = typeof query.quadro === "string" ? query.quadro.toUpperCase() : "";
  if (pedido !== "ADMINISTRATIVO" && pedido !== "OPERACIONAL") {
    res.status(400).json({ error: "Informe quadro=ADMINISTRATIVO ou quadro=OPERACIONAL." });
    return;
  }
  const quadro = pedido as QuadroDeQlp;

  const base = typeof query.base === "string" ? query.base : "";
  const comparada = typeof query.comparada === "string" ? query.comparada : "";
  if (!base || !comparada) {
    res.status(400).json({ error: "Informe base e comparada." });
    return;
  }
  for (const id of [base, comparada]) {
    await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
  }

  const comSemAlteracao = query.semAlteracao === "true";
  const tipo = TIPO_DO_QUADRO[quadro];

  /*
    O recorte por rubrica — opcional, e o que sustenta uma tela por assunto.

    Ausente, a comparação é do quadro inteiro. Presente, ela é da rubrica: os
    códigos pedidos ao motor encolhem, e os agregados saem sobre o que sobrou.
    Uma rubrica que este quadro não tem é recusa escrita, e não uma tela vazia —
    o operacional decompõe benefício em nove colunas e o administrativo não,
    então pedir "refeição" no administrativo é uma pergunta sem resposta, não
    uma resposta zero.
  */
  const rubrica = typeof query.rubrica === "string" && query.rubrica !== ""
    ? query.rubrica
    : null;
  const codigos = rubrica === null
    ? codigosDoQuadro(quadro)
    : codigosDaRubrica(quadro, rubrica);
  if (rubrica !== null && codigos.length === 0) {
    res.status(404).json({
      error:
        `O quadro ${quadro === "ADMINISTRATIVO" ? "administrativo" : "operacional"} não ` +
        `tem a rubrica "${rubrica}". Disponíveis: ${rubricasDoQuadro(quadro).join(", ")}.`,
    });
    return;
  }

  try {
    const changeSet =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:qlp-comparacao" }));

    const { rows } = await listChanges(db, changeSet.id, {
      attributeCodes: codigos,
      entityType: tipo,
      limit: 5000,
    });

    const linhas = linhasDeQlpComparado(rows, quadro);

    /*
      Os cargos de cada lado saem do acervo, e por tipo.

      `changeSet.entityCount` conta a vigência inteira, e uma vigência de QLP
      traz os dois quadros — o administrativo e o operacional entram na mesma
      família e viram revisões da mesma data. Contar por ali diria que o
      operacional comparou 47 cargos onde ele tem 6.
    */
    const porTipo = await frotaPorTipo(db, changeSet.id, comparada);
    const quadroDoPar = porTipo[tipo] ?? { comparados: 0, novos: 0, ausentes: 0 };

    const vigencias = await listComparableSnapshots(db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
      operacao: operacaoDaConsulta(query),
    });
    const rotulos = await rotulosDosCargos(tipo);
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);

    /*
      O efetivo das **duas pontas**, e não o que a lista de alterações registra.

      Um cargo que sai do quadro é uma linha só no motor — a entidade removida,
      sem atributo —, então o efetivo dele não aparece em alteração nenhuma.
      Sem esta leitura, o cartão mostrava −1 num par em que o quadro perdeu
      cinco posições. São duas consultas de uma coluna só, pela mesma leitura
      que a aba de Auditoria já faz.
    */
    const efetivo = await efetivoDasPontas(quadro, base, comparada);

    let todas = linhas;
    if (comSemAlteracao && snapshotA && snapshotB) {
      const jaListadas = new Set(
        linhas.map((l) => `${l.entityLabel}${l.attributeCode}`),
      );
      todas = [
        ...linhas,
        ...(await linhasIguaisDoQuadro(quadro, codigos, snapshotA, snapshotB, jaListadas, query)),
      ];
    }

    res.json({
      quadro,
      rubrica,
      rubricasDoQuadro: rubricasDoQuadro(quadro),
      changeSetId: changeSet.id,
      base: {
        id: base,
        sourceLabel: snapshotA?.sourceLabel ?? null,
        effectiveDate: snapshotA?.effectiveDate ?? null,
      },
      comparada: {
        id: comparada,
        sourceLabel: snapshotB?.sourceLabel ?? null,
        effectiveDate: snapshotB?.effectiveDate ?? null,
      },
      /* O resumo é sempre das alterações, com ou sem o alternador ligado: as
         linhas iguais não mudam indicador nenhum — elas só preenchem a tabela. */
      resumo: resumirComparacaoDeQlp(linhas, quadro, quadroDoPar, efetivo),
      alteracoesPorVariavel: alteracoesPorVariavelDeQlp(linhas, quadro),
      distribuicaoPorEstado: distribuicaoPorEstadoDeQlp(linhas, quadroDoPar),
      /*
        O dicionário dos rótulos, e não um rótulo por linha.

        O motor grava em `change.entity_label` a chave **normalizada** do cargo
        (`07526557001505CARGOGERENTE…`) — dívida registrada em
        `lib/qlp/src/index.ts`, e que vale para todas as séries, não só para
        esta. A forma legível existe no acervo, em
        `entity_identifier.identifier_value_raw`, e vem daqui como mapa: são 41
        cargos e 50 linhas na comparação medida, e repetir o rótulo em cada
        linha seria mandar a mesma frase várias vezes. A tela cai na chave
        quando o mapa não tem a entrada — menos bonita e igualmente verdadeira.
      */
      rotulos,
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de QLP recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O efetivo somado de cada ponta do par — **por snapshot**, e não pelo quadro.
 *
 * A leitura do quadro é consolidada por desenho: uma planilha de QLP traz
 * várias unidades, e a aba do Quadro responde por todas as autorizadas. Uma
 * **comparação** não: o motor compara duas vigências de um escopo só, e um par
 * entre escopos diferentes é o que ele recusa por construção. Medir o efetivo
 * pela leitura consolidada dava a diferença de todas as unidades ao lado de uma
 * lista de alterações de uma — o quadro perdia cinco posições e o cartão dizia
 * quatro, porque a outra unidade tinha ganhado uma.
 *
 * Então a ponta é o snapshot, que é exatamente o que o par escolheu. Ponta que
 * não trouxe a coluna volta nula, e nulo não é zero: o cartão diz que não sabe
 * em vez de dizer que não mudou.
 */
async function efetivoDasPontas(
  quadro: QuadroDeQlp,
  base: string,
  comparada: string,
): Promise<{ base: number | null; comparada: number | null }> {
  const codigo = codigoDoEfetivo(quadro);
  const ler = async (snapshotId: string) => {
    const { rows } = await db.execute<{ valor: string | null }>(sql`
      SELECT CASE WHEN f.is_null THEN NULL ELSE f.value_numeric::text END AS valor
        FROM fato_visivel f
        JOIN attribute a ON a.id = f.attribute_id
       WHERE f.snapshot_id = ${snapshotId}::uuid
         AND a.code = ${codigo}
    `);
    return somarEfetivo(rows.map((linha) => linha.valor));
  };
  const [doBase, doComparada] = await Promise.all([ler(base), ler(comparada)]);
  return { base: doBase, comparada: doComparada };
}

/**
 * Os cargos deste quadro, da chave normalizada para a forma legível.
 *
 * Uma consulta só, e não uma por linha: a tabela repete o mesmo cargo em várias
 * variáveis, e resolver o rótulo linha a linha faria a mesma leitura dezenas de
 * vezes.
 */
async function rotulosDosCargos(entityType: string): Promise<Record<string, string>> {
  const { rows } = await db.execute<{ valor: string; legivel: string | null }>(sql`
    SELECT ei.identifier_value AS valor,
           ei.identifier_value_raw AS legivel
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND e.entity_type = ${entityType}
  `);
  const rotulos: Record<string, string> = {};
  for (const linha of rows) {
    if (linha.legivel !== null && linha.legivel !== linha.valor) {
      rotulos[linha.valor] = linha.legivel;
    }
  }
  return rotulos;
}

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Desligada por padrão, e não por economia de bytes: a pergunta da tela é o que
 * mudou, e o `change_set` só guarda isso. Quando alguém quer o quadro inteiro,
 * as duas pontas são lidas pelo mesmo `lerQuadroParaAuditoria` que a aba de
 * Auditoria usa — e não por uma segunda leitura escrita aqui, que seria a
 * segunda régua do mesmo quadro.
 */
async function linhasIguaisDoQuadro(
  quadro: QuadroDeQlp,
  codigos: string[],
  snapshotA: { effectiveDate: string },
  snapshotB: { effectiveDate: string },
  jaListadas: Set<string>,
  query: Record<string, unknown>,
): Promise<LinhaDeQlpComparado[]> {
  const contexto = parseContext(query);
  const [a, b] = await Promise.all([
    lerQuadroParaAuditoria(db, TIPO_DO_QUADRO[quadro], codigos, {
      period: snapshotA.effectiveDate,
      ...(contexto !== undefined ? { context: contexto } : {}),
    }),
    lerQuadroParaAuditoria(db, TIPO_DO_QUADRO[quadro], codigos, {
      period: snapshotB.effectiveDate,
      ...(contexto !== undefined ? { context: contexto } : {}),
    }),
  ]);
  if (!a || !b) return [];

  const naBase = new Map(a.linhas.map((l) => [l.chave, l.valores]));
  const linhas: LinhaDeQlpComparado[] = [];
  for (const linha of b.linhas) {
    const anterior = naBase.get(linha.chave);
    if (!anterior) continue;
    for (const code of codigos) {
      const antes = anterior[code] ?? null;
      const depois = linha.valores[code] ?? null;
      if (antes !== depois) continue;
      // Os dois lados ausentes não são "sem alteração": são ausência nas duas
      // pontas, e o motor já não escreveu linha para eles.
      if (antes === null) continue;
      if (jaListadas.has(`${linha.chave}${code}`)) continue;
      const semAlteracao = linhaDeQlpSemAlteracao({
        entityLabel: linha.chave,
        quadro,
        attributeCode: code,
        valor: antes,
      });
      if (semAlteracao) linhas.push(semAlteracao);
    }
  }
  return linhas;
}

export default router;
