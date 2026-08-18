import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import type { RequestedContext } from "@workspace/comparison";
import {
  getDetalheDoCargo,
  getEvolucaoDoQuadro,
  getQuadroAdministrativo,
  type FiltrosDoQuadro,
} from "@workspace/qlp";

/**
 * QLP Administrativo — o quadro de pessoal da estrutura administrativa.
 *
 * Três rotas, uma por pergunta:
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

/** Mesma convenção das demais rotas — ver `routes/composition.ts`. */
function parseContext(query: Record<string, unknown>): RequestedContext | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== "" ? query.scopeHash : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
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

export default router;
