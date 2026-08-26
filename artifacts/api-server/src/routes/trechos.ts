import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  getRadarDeTrechos,
  resolverComparacaoDeTrecho,
  type Veredito,
} from "@workspace/comparison";
import { parseContext } from "../lib/contexto";

/**
 * Radar de Trechos — uma linha por trecho, não por atributo.
 *
 * Rota própria, e não um filtro dentro de `/changes/*`: os motores
 * compartilhados de lá (`gerencial.ts`, `grouped.ts`, `families-view.ts`)
 * **excluem** `entity_type = 'TRECHO'` desde o commit #345, que corrigiu um
 * vazamento — dado de trecho contaminando telas de equipamento. Reabrir esse
 * filtro para servir o Radar reintroduziria o mesmo vazamento nas outras
 * telas. O padrão correto é o de `/frota/ativos`: leitura própria, escopada
 * a `entityType = 'TRECHO'` desde a query.
 */
const router: IRouter = Router();

const VEREDITOS_VALIDOS: Veredito[] = ["PIOROU", "MELHOROU", "IGUAL", "MISTO", "INCONCLUSIVO"];

function parseStatus(query: Record<string, unknown>): Veredito[] | undefined {
  const raw = query.status;
  if (raw === undefined) return undefined;
  const lista = Array.isArray(raw) ? raw : [raw];
  const status = lista
    .filter((v): v is string => typeof v === "string" && v !== "")
    .flatMap((v) => v.split(","))
    .filter((v): v is Veredito => (VEREDITOS_VALIDOS as string[]).includes(v));
  return status.length > 0 ? status : undefined;
}

/**
 * O Radar — cards, fila de atenção e o resumo por trecho, tudo numa
 * resposta só.
 *
 * `getRadarDeTrechos` já devolve `contagens` calculadas sobre o recorte de
 * busca **antes** do filtro de status — uma leitura só, os cinco cards e a
 * lista da tabela saem consistentes entre si sem uma segunda varredura.
 */
router.get("/trechos/radar", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;

  const resultado = await resolverComparacaoDeTrecho(db, parseContext(query));
  if (resultado.erro === "SEM_CONTEXTO") {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  if (resultado.erro === "SEM_TRECHO") {
    res.status(404).json({
      error: "Este contexto não tem nenhuma vigência de trecho importada.",
    });
    return;
  }
  if (resultado.erro === "PRIMEIRA_VIGENCIA") {
    res.status(409).json({
      error: `"${resultado.sourceLabel}" é a primeira vigência de trecho deste contexto; não há anterior com que comparar.`,
      context: resultado.context,
      effectiveDate: resultado.effectiveDate,
      sourceLabel: resultado.sourceLabel,
    });
    return;
  }

  const status = parseStatus(query);
  const busca =
    typeof query.busca === "string" && query.busca !== "" ? query.busca : undefined;
  const limit = Number(query.limit);
  const offset = Number(query.offset);

  const radar = await getRadarDeTrechos(db, resultado.changeSetId, {
    status,
    busca,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
  });

  res.json({
    context: resultado.context,
    effectiveDate: resultado.effectiveDate,
    sourceLabel: resultado.sourceLabel,
    previousLabel: resultado.previousLabel,
    changeSetId: resultado.changeSetId,
    total: radar.total,
    contagens: radar.contagens,
    trechos: radar.trechos,
  });
});

export default router;
