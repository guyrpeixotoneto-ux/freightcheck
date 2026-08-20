import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { classificarFalha } from "../lib/classificar-falha";
import { parseContext } from "../lib/contexto";
import {
  computeChangeSet,
  findPreviousSnapshot,
  getAttributeDomain,
  getEntityTable,
  getAttributeSeries,
  getChangeProvenance,
  getChangeSetBreakdown,
  getChangeSetForPair,
  getFamiliesView,
  getGroupedView,
  getGroupVehicles,
  getRangeAnalysis,
  getEndToEndAnalysis,
  FREIGHTECH_SEM_DADO,
  listChangeSets,
  listChanges,
  listComparableSnapshots,
  getConsolidated,
  listContexts,
  listPeriods,
  lerEscopo,
  totaisDoEscopo,
  type ChangeFilters,
  type EscopoDeFrota,
} from "@workspace/comparison";

/**
 * Alterações e Comparar (F3).
 *
 * `/changes/latest` answers the one question the product exists for — what
 * changed since the previous vigência — without the caller having to know
 * which snapshot that was.
 */
const router: IRouter = Router();

function parseFilters(query: Record<string, unknown>): ChangeFilters {
  const str = (key: string) =>
    typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined;
  const num = (key: string) => {
    const value = str(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    costClass: str("costClass"),
    changeType: str("changeType"),
    category: str("category"),
    semanticsStatus: str("semanticsStatus"),
    comparability: str("comparability"),
    impactConfidence: str("impactConfidence"),
    attributeCode: str("attributeCode"),
    // Recorte por equipamento **dentro** da leitura pedida — ver `entityType`
    // em `ChangeFilters`. Não confundir com `entityTypeSet`, que em
    // `/changes/latest` escolhe outra comparação.
    entityType: str("entityType"),
    entityLabel: str("entityLabel"),
    search: str("search"),
    minAbsImpact: num("minAbsImpact"),
    limit: num("limit"),
    offset: num("offset"),
  };
}

/**
 * O escopo de frota que a tela 360° pede, quando pede.
 *
 * `entityType` chega pelos dois nomes de propósito: ele já era **filtro de
 * linha** em Alterações — recorte de exibição sobre uma comparação anunciada —
 * e agora é também **escopo** em Cavalo/Carreta 360°, onde a tela inteira fala
 * daquele equipamento. `escopo=1` é o que separa as duas leituras do mesmo
 * parâmetro: sem ele, a rota responde como sempre respondeu, e os totais
 * continuam sendo os da comparação inteira.
 *
 * Sem essa chave, uma tela que passasse `entityType` de repente veria os
 * cartões mudarem de significado — e toda a Visão geral manda `entityType` para
 * cá desde que existe.
 */
function pediuEscopo(query: Record<string, unknown>): boolean {
  return query.escopo === "1" || query.escopo === "true";
}

function parseEscopo(query: Record<string, unknown>): EscopoDeFrota {
  if (!pediuEscopo(query)) return {};
  return lerEscopo({ entityType: query.entityType, plate: query.placa });
}

/**
 * Os filtros com o escopo já dentro — uma consulta só para lista, painéis e
 * totais.
 *
 * O escopo é aplicado aqui, e não pela tela mandando `entityLabel` junto: as
 * três leituras da resposta têm de concordar, e três lugares aplicando o mesmo
 * recorte é o número de lugares em que eles podem discordar. A tela manda o
 * escopo uma vez; a rota o espalha.
 */
function comEscopo(filters: ChangeFilters, escopo: EscopoDeFrota): ChangeFilters {
  return {
    ...filters,
    ...(escopo.entityType ? { entityType: escopo.entityType } : {}),
    ...(escopo.plate ? { entityLabel: escopo.plate } : {}),
  };
}

/*
  O contexto e as recusas dele vêm de `../lib/contexto` — a cópia que existia
  aqui foi apagada.

  Ela era a mais antiga das três, e era inofensiva enquanto o contexto fosse só
  unidade e canal: as duas versões liam as mesmas duas chaves da mesma forma.
  Deixou de ser no dia em que o recorte De/Até entrou no contexto e a aba
  Planilha passou a oferecê-lo. Esta cópia não lia `de` nem `ate`, então o
  servidor respondia pela série inteira enquanto o seletor da tela dizia três
  vigências — dois números certos e a comparação errada, que é precisamente o
  defeito que o módulo compartilhado foi escrito para não ter.

  `sendContextError` vem junto porque é o outro lado do mesmo pedido: com a
  janela, existe uma recusa a mais — a ponta que este contexto não tem —, e ela
  é 400 com a lista das vigências que existem, não 500.
*/

/** As unidades e canais que já entregaram vigência — o seletor de contexto. */
router.get("/contexts", async (req, res): Promise<void> => {
  res.json(await listContexts(db));
});

/**
 * As vigências vivas — **de uma família por vez, a de equipamento por padrão**.
 *
 * Era a lista inteira, e quem quisesse outra família recortava no cliente. A
 * tela do quadro de pessoal fazia exatamente isso, e por isso o padrão não
 * podia ser "todas": esta rota também é de onde `/changes/latest` tira "a série
 * mais recente", e uma quinzena de cargos entrando aqui trocava qual série a
 * tela de Alterações abre. Quem lê o quadro nomeia a família dele — é a mesma
 * conversa de `/contexts`, e a mesma de `lib/qlp/src/contexto.ts`.
 */
router.get("/snapshots", async (req, res): Promise<void> => {
  const datasetFamily =
    typeof req.query.datasetFamily === "string" && req.query.datasetFamily !== ""
      ? req.query.datasetFamily
      : undefined;
  res.json(await listComparableSnapshots(db, { datasetFamily }));
});

router.get("/change-sets", async (req, res): Promise<void> => {
  res.json(await listChangeSets(db));
});

/**
 * The newest vigência against the one before it, computing the comparison on
 * demand if it has not been made yet.
 */
router.get("/changes/latest", async (req, res): Promise<void> => {
  const snapshots = await listComparableSnapshots(db);
  if (snapshots.length === 0) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }

  /**
   * Vigências only compare inside their own series. When the Ambev ships
   * carretas and cavalos as separate files there are two series, and simply
   * taking "the newest snapshot" would answer for one equipment type while
   * silently dropping the other.
   */
  const seriesKey = (s: (typeof snapshots)[number]) =>
    `${s.scopeHash}|${s.entityTypeSet}`;
  const series = [...new Set(snapshots.map(seriesKey))]
    .map((key) => {
      const members = snapshots.filter((s) => seriesKey(s) === key);
      return {
        key,
        entityTypeSet: members[0].entityTypeSet,
        latest: members[members.length - 1],
        count: members.length,
      };
    })
    // Deterministic: newest first, then by name so ties never reorder.
    .sort(
      (a, b) =>
        b.latest.effectiveDate.localeCompare(a.latest.effectiveDate) ||
        a.entityTypeSet.localeCompare(b.entityTypeSet),
    );

  const requested = req.query.entityTypeSet;
  const chosen =
    (typeof requested === "string" &&
      series.find((s) => s.entityTypeSet === requested)) ||
    series[0];
  const latest = chosen.latest;
  const previousId = await findPreviousSnapshot(db, latest.id);
  if (!previousId) {
    res.status(409).json({
      error: `"${latest.sourceLabel}" é a primeira vigência da série; não há anterior com que comparar.`,
    });
    return;
  }

  const set = await computeChangeSet(db, previousId, latest.id, {
    computedBy: "api:latest",
  });
  const escopo = parseEscopo(req.query as Record<string, unknown>);
  const filters = comEscopo(
    parseFilters(req.query as Record<string, unknown>),
    escopo,
  );
  const [changes, breakdown, totais] = await Promise.all([
    listChanges(db, set.id, filters),
    getChangeSetBreakdown(db, set.id, escopo, filters),
    /*
      Os totais saem **sempre**, e com os mesmos filtros da lista.

      Antes eles só existiam sob `escopo=1`, e sem eles a tela caía nos totais
      da comparação inteira: quem chegava do cartão "Impacto líquido" — que
      manda `impactConfidence=CALCULATED` — via a lista obedecer e o cabeçalho
      não. "19 com impacto" embaixo de "267 alterações · R$ 39.936" eram dois
      recortes empilhados, e o de cima tinha cara de total.
    */
    totaisDoEscopo(db, set.id, escopo, filters),
  ]);
  res.json({
    set,
    breakdown,
    // `set` continua sendo a comparação inteira — é ela que a tela de
    // Alterações lê, e mexer nos agregados dela mudaria o que aquela tela
    // afirma. O escopo vem ao lado, recontado, e só quando foi pedido.
    ...(totais ? { escopo, totais } : {}),
    // So the screen can offer the other series instead of pretending this is
    // the whole fleet.
    series: series.map((s) => ({
      entityTypeSet: s.entityTypeSet,
      vigencias: s.count,
      latestLabel: s.latest.sourceLabel,
    })),
    selectedSeries: chosen.entityTypeSet,
    ...changes,
  });
});

/**
 * Consolidated: the fleet for one period, summing the series that delivered.
 *
 * A projection over the independent series — no snapshot is merged, nothing
 * waits for anything. When a series is missing the analysis still runs on what
 * arrived, and the response names what is absent so the caller can say so.
 */
router.get("/changes/consolidated", async (req, res): Promise<void> => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const context = parseContext(req.query as Record<string, unknown>);
  const view = await getConsolidated(db, period, context);
  if (!view) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }

  const escopo = parseEscopo(req.query as Record<string, unknown>);
  const filters = comEscopo(
    parseFilters(req.query as Record<string, unknown>),
    escopo,
  );
  const [changes, breakdown, totais] = await Promise.all([
    listChanges(db, view.changeSetIds, filters),
    getChangeSetBreakdown(db, view.changeSetIds, escopo, filters),
    // Idem `/latest`: os totais são da mesma população que a lista, sempre.
    totaisDoEscopo(db, view.changeSetIds, escopo, filters),
  ]);
  res.json({
    view,
    breakdown,
    // A `view` continua descrevendo o período inteiro — quais séries chegaram,
    // qual faltou, o total da frota. O escopo não a reescreve: ele vem ao
    // lado, recontado sobre as linhas, e a tela 360° lê daqui.
    ...(totais ? { escopo, totais } : {}),
    // Os períodos são os do mesmo contexto da view — listar os de outra
    // unidade num seletor que muda esta tela seria oferecer uma escolha que
    // troca de assunto sem avisar.
    periods: await listPeriods(db, view.context),
    ...changes,
  });
});

/**
 * Início — a vigência escolhida, agrupada por atributo e equipamento.
 *
 * A rota que a tela principal lê. Devolve tudo o que os Níveis 1 e 2 precisam
 * numa resposta só: os grupos, o impacto **desta** vigência, o acumulado
 * histórico num campo separado (nunca somados nem confundidos), as séries
 * presentes e as ausentes, e as vigências disponíveis para o seletor.
 *
 * Não calcula comparação nenhuma: lê as que a importação já produziu. Abrir uma
 * tela não pode disparar trabalho pesado nem fazer o número depender de quem
 * abriu primeiro.
 */
router.get("/changes/grouped", async (req, res): Promise<void> => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const context = parseContext(req.query as Record<string, unknown>);
  const view = await getGroupedView(db, period, context);
  if (!view) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(view);
});

/**
 * A vigência arrumada por família e parâmetro — a leitura familiar ao Freightech.
 *
 * Devolve tudo o que `/changes/grouped` devolve, mais o resumo executivo e a
 * árvore de famílias. É uma projeção sobre os mesmos grupos: nada é
 * reclassificado, nada é recalculado, e a soma das famílias fecha com o total
 * da vigência dentro de cada periodicidade.
 */
router.get("/changes/families", async (req, res): Promise<void> => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const context = parseContext(req.query as Record<string, unknown>);
  const view = await getFamiliesView(db, period, context);
  if (!view) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json({ ...view, freightechSemDado: FREIGHTECH_SEM_DADO });
});

/**
 * O intervalo — o que o cliente mexeu entre duas vigências escolhidas.
 *
 * As duas pontas entram na leitura. `from` e `to` fora do histórico caem no
 * padrão (a vigência mais recente e a anterior) em vez de virar erro: a aba de
 * análise abre antes de a pessoa escolher qualquer coisa.
 */
router.get("/changes/range", async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const bruto = typeof req.query.parameters === "string" ? req.query.parameters : "";
  const parameters = bruto.split(",").map((p) => p.trim()).filter(Boolean);
  const context = parseContext(req.query as Record<string, unknown>);
  const analysis = await getRangeAnalysis(db, from, to, context, parameters);
  if (!analysis) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(analysis);
});

/**
 * Ponta a ponta — o estado de uma vigência contra o de outra.
 *
 * Não é a soma dos movimentos e não pode ser derivada dela: um valor que subiu
 * e voltou some aqui e continua contado lá. A comparação é ativo a ativo, sobre
 * quem está nas duas pontas, e entrada e saída de frota vêm num eixo próprio.
 *
 * `parameters` recorta a leitura ao universo de um cartão. Sem ele, o intervalo
 * inteiro — e aí a resposta pode ser grande, porque os ativos de cada grupo vêm
 * junto (não existe `change_set` gravado para consultar depois).
 */
router.get("/changes/end-to-end", async (req, res): Promise<void> => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const bruto = typeof req.query.parameters === "string" ? req.query.parameters : "";
  const parameters = bruto.split(",").map((p) => p.trim()).filter(Boolean);
  const context = parseContext(req.query as Record<string, unknown>);
  const analysis = await getEndToEndAnalysis(db, from, to, context, parameters);
  if (!analysis) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(analysis);
});

/** Nível 2 — os veículos por trás de um cartão, um por linha. */
router.get("/changes/grouped/vehicles", async (req, res): Promise<void> => {
  const { period, attributeCode, entityType, changeType, comparability, impactConfidence } =
    req.query as Record<string, string | undefined>;
  if (!period || !attributeCode || !entityType) {
    res.status(400).json({ error: "Informe period, attributeCode e entityType." });
    return;
  }
  const context = parseContext(req.query as Record<string, unknown>);
  res.json(
    await getGroupVehicles(db, {
      period,
      attributeCode,
      entityType,
      changeType,
      comparability,
      impactConfidence,
      scopeHash: context?.scopeHash,
      ...(context && "channel" in context ? { channel: context.channel } : {}),
    }),
  );
});

/** Nível 2 — a série do atributo nas vigências, com numerador e denominador. */
router.get("/attributes/:code/series", async (req, res): Promise<void> => {
  const context = parseContext(req.query as Record<string, unknown>);
  const series = await getAttributeSeries(db, req.params.code, context);
  if (!series) {
    res.status(404).json({ error: "Atributo não encontrado." });
    return;
  }
  res.json(series);
});

/**
 * Os valores distintos de um atributo numa vigência — o cadastro do Freightech,
 * reconstruído do export de equipamento.
 *
 * Boa parte das telas de cartão de lá é uma lista de valores registrados
 * (PADRÃO: 6X4, 6X2, 4X2…), e não uma lista de mudanças. Este endpoint é o que
 * permite mostrar aquela tela com dado nosso — mais quantos ativos usam cada
 * valor, que é o que separa uma opção viva de uma que sobrou no cadastro.
 */
router.get("/attributes/:code/domain", async (req, res): Promise<void> => {
  const context = parseContext(req.query as Record<string, unknown>);
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const domain = await getAttributeDomain(db, req.params.code, context, period);
  if (!domain) {
    res.status(404).json({ error: "Atributo não encontrado nesta vigência." });
    return;
  }
  res.json(domain);
});

/**
 * A tabela de ativos de um cartão — uma linha por veículo, uma coluna por
 * atributo pedido.
 *
 * É a terceira forma de tela do Freightech, e a que CARRETA e CAVALO usam: o
 * inventário, com a placa à esquerda e as dezenas de colunas ao lado. As
 * colunas vêm na requisição porque a lista é do cartão, não do modelo — e as
 * que o dicionário não conhecer voltam em `missingColumns` em vez de sumirem.
 */
router.get("/entities/table", async (req, res): Promise<void> => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : "";
  const bruto = typeof req.query.attributes === "string" ? req.query.attributes : "";
  const attributes = bruto.split(",").map((c) => c.trim()).filter(Boolean);
  if (!entityType || attributes.length === 0) {
    res.status(400).json({ error: "Informe entityType e attributes." });
    return;
  }
  const context = parseContext(req.query as Record<string, unknown>);
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  const table = await getEntityTable(db, entityType, attributes, context, period);
  if (!table) {
    res.status(404).json({ error: "Nenhuma vigência para este contexto." });
    return;
  }
  res.json(table);
});

/** Comparar: any two snapshots the user picks. */
router.post("/change-sets", async (req, res, next): Promise<void> => {
  try {
    const { snapshotAId, snapshotBId, force } = req.body ?? {};
    if (!snapshotAId || !snapshotBId) {
      res.status(400).json({ error: "Informe snapshotAId e snapshotBId." });
      return;
    }
    const set = await computeChangeSet(db, snapshotAId, snapshotBId, {
      computedBy: "api:compare",
      force: Boolean(force),
    });
    res.json(set);
  } catch (err) {
    /*
      Refusals here are meaningful — mismatched scope, same snapshot twice —
      and the message is written for the person reading it. Mas só as recusas:
      uma falha de banco chegava aqui como 422 com a consulta do drizzle no
      corpo, dizendo a quem chamou que o defeito era do pedido dele.
    */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparison refused");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

router.get("/change-sets/:id/changes", async (req, res): Promise<void> => {
  const filters = parseFilters(req.query as Record<string, unknown>);
  const [changes, breakdown] = await Promise.all([
    listChanges(db, req.params.id, filters),
    getChangeSetBreakdown(db, req.params.id),
  ]);
  res.json({ breakdown, ...changes });
});

router.get("/change-sets/pair/:aId/:bId", async (req, res): Promise<void> => {
  const set = await getChangeSetForPair(db, req.params.aId, req.params.bId);
  if (!set) {
    res.status(404).json({ error: "Comparação ainda não calculada." });
    return;
  }
  res.json(set);
});

/** Both sides of one change, down to the originating cell. */
router.get("/changes/:id/provenance", async (req, res): Promise<void> => {
  const provenance = await getChangeProvenance(db, Number(req.params.id));
  if (!provenance) {
    res.status(404).json({ error: "Alteração não encontrada." });
    return;
  }
  res.json(provenance);
});

export default router;
