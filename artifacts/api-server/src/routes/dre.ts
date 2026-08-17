import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { ContextNotFoundError, type SeriesContext } from "@workspace/comparison";
import {
  AVISO_DE_CIRCULARIDADE,
  CRITERIOS,
  ESCOPOS_APURAVEIS,
  explicarResultado,
  getDREDaFrota,
  getDREDoVeiculo,
  getHistoricoDaDRE,
  getPonteDaDRE,
  PLANO_DA_DRE,
  type CriterioDeOrdenacao,
  type EscopoApuravel,
  type FiltrosDaFrota,
} from "@workspace/dre";
import { equipamentosElegiveis } from "@workspace/availability";

/**
 * DRE — o resultado por unidade econômica.
 *
 * Seis rotas, uma por pergunta:
 *
 * - `/dre/plano` — o que a demonstração afirma, e o que ela admite não ter.
 * - `/dre/fleet` — quanto a frota deixa, quem deixa mais e quem precisa de atenção.
 * - `/dre/unit/:id` — a DRE de um veículo ou conjunto, com a origem de cada número.
 * - `/dre/unit/:id/bridge` — quais alterações mexeram no resultado, e quanto.
 * - `/dre/unit/:id/history` — a evolução por vigência.
 * - `/dre/history` — a mesma evolução, da frota inteira.
 *
 * **Nenhuma delas calcula nada.** Todas chamam `@workspace/dre`, que chama
 * `comporDeFatos` — o mesmo motor da Composição, sob o mesmo portão de
 * semântica. É a exigência de autoridade única, e ela morre no dia em que
 * alguém somar um campo aqui dentro.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mesma convenção das demais rotas — ver `routes/changes.ts`. */
function parseContext(query: Record<string, unknown>): Partial<SeriesContext> | undefined {
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

function parsePeriod(query: Record<string, unknown>): string | undefined {
  return typeof query.period === "string" && query.period !== "" ? query.period : undefined;
}

/**
 * O escopo pedido, ou 400 com a lista dos que existem.
 *
 * Devolver a DRE de conjunto para um escopo desconhecido seria pior do que o
 * erro: a tela mostraria números do par acreditando estar vendo o cavalo.
 */
function parseEscopo(query: Record<string, unknown>, res: Response): EscopoApuravel | null {
  const bruto = typeof query.escopo === "string" ? query.escopo.toUpperCase() : "CONJUNTO";
  if (!(ESCOPOS_APURAVEIS as readonly string[]).includes(bruto)) {
    res.status(400).json({
      error:
        `A DRE não sabe apurar o escopo "${bruto}". ` +
        `Escopos disponíveis: ${ESCOPOS_APURAVEIS.join(", ")}.`,
    });
    return null;
  }
  return bruto as EscopoApuravel;
}

function parseFiltros(query: Record<string, unknown>): FiltrosDaFrota {
  const flag = (key: string) => query[key] === "1" || query[key] === "true";
  const ordem = typeof query.ordenarPor === "string" ? query.ordenarPor : "";
  return {
    ...(typeof query.busca === "string" && query.busca !== "" ? { busca: query.busca } : {}),
    ...(flag("soNegativos") ? { soNegativos: true } : {}),
    ...(flag("soIncompletos") ? { soIncompletos: true } : {}),
    ...(CRITERIOS.some((c) => c.id === ordem)
      ? { ordenarPor: ordem as CriterioDeOrdenacao }
      : {}),
  };
}

function sendContextError(res: Response, err: unknown): boolean {
  if (err instanceof ContextNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * O plano da DRE — servido para que a tela não precise repetir a estrutura.
 *
 * Uma cópia do plano no frontend divergiria no primeiro componente novo, e as
 * duas versões seriam usadas para dizer o que a demonstração contém.
 */
router.get("/dre/plano", async (req, res): Promise<void> => {
  try {
    /*
      `equipamentos` é novo, e é o cruzamento que faltava.

      `escopos` continua sendo a lista **declarada** — e deve continuar: o que a
      DRE sabe apurar é conhecimento de negócio, não algo que se descubra numa
      consulta. O que não existia era alguém cruzá-la com o canônico: um
      terceiro equipamento importado ficava invisível na tela, sem aba e sem
      aviso, porque as abas eram os escopos declarados e ninguém perguntava o
      que o banco tinha.

      `CONJUNTO` fica de fora do cruzamento de propósito: ele não é um
      equipamento, é o par cavalo+carreta apurado junto. Procurá-lo em
      `snapshot_entity_type` não acharia nada, e a linha diria "não se aplica"
      sobre o escopo que a DRE mais usa.
    */
    const equipamentos = await equipamentosElegiveis(db, {
      apuraveis: ESCOPOS_APURAVEIS.filter((e) => e !== "CONJUNTO"),
      comoOModuloChama: (tipo) =>
        `Este equipamento está importado e a DRE não tem plano de apuração para ` +
        `"${tipo}". Apurar sem plano somaria componentes que ninguém declarou — a ` +
        `saída é declarar o plano em lib/dre/src/plano.ts, não importar de novo.`,
    });

    res.json({
      componentes: PLANO_DA_DRE,
      escopos: ESCOPOS_APURAVEIS,
      equipamentos,
      criterios: CRITERIOS,
      aviso: AVISO_DE_CIRCULARIDADE,
    });
  } catch (err) {
    req.log.error({ err }, "Error building DRE plan");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dre/fleet", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  try {
    const view = await getDREDaFrota(db, escopo, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
      filtros: parseFiltros(query),
    });
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json({ ...view, aviso: AVISO_DE_CIRCULARIDADE });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building DRE fleet view");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dre/unit/:entityId", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  try {
    const dre = await getDREDoVeiculo(db, entityId, escopo, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!dre) {
      res.status(404).json({
        error:
          `Este equipamento não forma uma unidade econômica de escopo ${escopo} ` +
          `nesta vigência.`,
      });
      return;
    }
    res.json({ ...dre, aviso: AVISO_DE_CIRCULARIDADE });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building DRE unit view");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * A ponte: alteração → impacto → linha da DRE → resultado.
 *
 * Pode calcular a comparação quando ela ainda não existe — é a mesma decisão de
 * `/composition/equipment/:id/changes`, e pelo mesmo motivo: devolver "nenhuma
 * alteração" porque ninguém rodou o diff seria indistinguível de "nada mudou".
 */
router.get("/dre/unit/:entityId/bridge", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  try {
    const ponte = await getPonteDaDRE(db, entityId, escopo, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!ponte) {
      res.status(404).json({ error: "Equipamento ou vigência não encontrados." });
      return;
    }
    res.json({ ...ponte, explicacao: explicarResultado(ponte) });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building DRE bridge");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dre/unit/:entityId/history", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  try {
    const historico = await getHistoricoDaDRE(db, escopo, {
      entityId,
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!historico) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(historico);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building DRE history");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dre/history", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  try {
    const historico = await getHistoricoDaDRE(db, escopo, {
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!historico) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(historico);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building DRE fleet history");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
