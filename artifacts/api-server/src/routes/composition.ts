import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { ContextNotFoundError, type SeriesContext } from "@workspace/comparison";
import {
  getAlteracoesDoEquipamento,
  getHistorico,
  getVinculoDoCavalo,
  getVisaoDeFrota,
  montarComposicao,
  TIPOS_COM_REGRA,
  type FiltrosDeFrota,
} from "@workspace/composition";
import { equipamentosElegiveis } from "@workspace/availability";

/**
 * Composição — a memória de cálculo da remuneração, por equipamento.
 *
 * Quatro rotas, uma por pergunta:
 *
 * - `/composition/fleet` — quanto cada equipamento recebe nesta vigência.
 * - `/composition/equipment/:id` — de onde vem cada valor deste equipamento,
 *   e quais componentes ficaram de fora, com o motivo. É a mesma resposta que
 *   alimenta a aba Composição e a aba Parâmetros: são duas leituras do mesmo
 *   conjunto de fatos, e servi-las de endpoints diferentes deixaria as duas
 *   telas capazes de discordar.
 * - `/composition/equipment/:id/history` — a evolução nas vigências.
 * - `/composition/equipment/:id/changes` — o que mudou contra a anterior.
 *
 * O tipo de equipamento é validado contra o registro de regras: pedir a frota
 * de um tipo sobre o qual o produto não declarou nada devolve 400 com a lista
 * dos que existem, em vez de uma tabela vazia que se parece com "não há nada".
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

function parseFiltros(query: Record<string, unknown>): FiltrosDeFrota {
  const flag = (key: string) => query[key] === "1" || query[key] === "true";
  const status = typeof query.status === "string" ? query.status : undefined;
  return {
    ...(typeof query.busca === "string" && query.busca !== "" ? { busca: query.busca } : {}),
    ...(status === "NORMAL" ||
    status === "ATENCAO" ||
    status === "CRITICO" ||
    status === "INCOMPLETO"
      ? { status }
      : {}),
    ...(flag("comAlteracao") ? { comAlteracao: true } : {}),
    ...(flag("comAlerta") ? { comAlerta: true } : {}),
    ...(flag("comNaoCalculavel") ? { comNaoCalculavel: true } : {}),
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
 * Os equipamentos que o **canônico tem**, com o veredito da Composição sobre
 * cada um.
 *
 * Isto devolvia `TIPOS_COM_REGRA` — a lista declarada, sem olhar o banco — e
 * não era chamado por tela nenhuma: `composicao.tsx` tinha as duas abas
 * escritas à mão. Um terceiro equipamento importado ficava invisível: sem aba,
 * sem aviso, sem erro. Não havia tela vazia para alguém estranhar; havia uma
 * ausência que ninguém tinha como notar.
 *
 * Agora a resposta é o cruzamento: um item por equipamento **que existe**, com
 * `apuravel` e, quando não, o vazio nomeado. A tela monta as abas a partir
 * daqui, e mostra o que não sabe compor em vez de omiti-lo.
 */
router.get("/composition/equipment-types", async (req, res): Promise<void> => {
  try {
    res.json(
      await equipamentosElegiveis(db, {
        apuraveis: TIPOS_COM_REGRA,
        comoOModuloChama: (tipo) =>
          `Este equipamento está importado e a Composição não tem regra de ` +
          `remuneração declarada para "${tipo}". Compor sem regra somaria colunas ` +
          `que ninguém disse que se somam — a saída é declarar a regra, não ` +
          `importar de novo.`,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "Error listing composition equipment types");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/composition/fleet", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const entityType = typeof query.entityType === "string" ? query.entityType : "CAVALO";

  if (!TIPOS_COM_REGRA.includes(entityType)) {
    res.status(400).json({
      error:
        `O módulo de Composição não tem regra de remuneração declarada para "${entityType}". ` +
        `Tipos disponíveis: ${TIPOS_COM_REGRA.join(", ")}.`,
    });
    return;
  }

  try {
    const view = await getVisaoDeFrota(db, entityType, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
      filtros: parseFiltros(query),
    });
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(view);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building composition fleet view");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/composition/equipment/:entityId", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  try {
    const composicao = await montarComposicao(db, entityId, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!composicao) {
      res.status(404).json({ error: "Equipamento ou vigência não encontrados." });
      return;
    }
    /*
      O vínculo com a carreta só é resolvido para o cavalo, e só quando a fonte
      o declara. Vai junto da composição porque é um atalho de navegação, não um
      número — nada dele entra em total nenhum (ver `ficha.ts`).
    */
    const vinculo =
      composicao.entityType === "CAVALO"
        ? await getVinculoDoCavalo(db, entityId, {
            period: composicao.effectiveDate,
            ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
          })
        : null;

    res.json({ ...composicao, vinculo });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building equipment composition");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/composition/equipment/:entityId/history", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  try {
    const historico = await getHistorico(
      db,
      entityId,
      parseContext(req.query as Record<string, unknown>),
    );
    if (!historico) {
      res.status(404).json({ error: "Equipamento não encontrado." });
      return;
    }
    res.json(historico);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building equipment history");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * As alterações deste equipamento entre a vigência escolhida e a anterior.
 *
 * Pode calcular a comparação quando ela ainda não existe — é a mesma decisão de
 * `/changes/latest`, e pelo mesmo motivo: devolver "sem alterações" porque
 * ninguém rodou o diff seria indistinguível de "nada mudou".
 */
router.get("/composition/equipment/:entityId/changes", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  try {
    const alteracoes = await getAlteracoesDoEquipamento(db, entityId, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    });
    if (!alteracoes) {
      res.status(404).json({ error: "Equipamento ou vigência não encontrados." });
      return;
    }
    res.json(alteracoes);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building equipment changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
