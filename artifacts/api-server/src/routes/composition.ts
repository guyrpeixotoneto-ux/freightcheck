import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { ContextNotFoundError, type SeriesContext } from "@workspace/comparison";
import {
  getAlteracoesDoEquipamento,
  getHistorico,
  getVinculoDoCavalo,
  getVisaoDeConjuntos,
  getVisaoDeFrota,
  montarComposicao,
  TIPOS_COM_REGRA,
  type FiltrosDeConjuntos,
  type FiltrosDeFrota,
} from "@workspace/composition";

/**
 * Composição — a memória de cálculo da remuneração, por equipamento.
 *
 * Cinco rotas, uma por pergunta:
 *
 * - `/composition/fleet` — quanto cada equipamento recebe nesta vigência.
 * - `/composition/conjuntos` — o cavalo e a carreta lidos como uma unidade só,
 *   e a conferência entre o total que a fonte declara para o conjunto e a soma
 *   do que as duas fichas apuram. Não é `fleet` com outro `entityType`: conjunto
 *   não é tipo de equipamento, é o par — e a rota não aceita `entityType`
 *   justamente para que ninguém o trate como se fosse.
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

/** Os tipos que a tela pode abrir como aba. */
router.get("/composition/equipment-types", (_req, res): void => {
  res.json(TIPOS_COM_REGRA);
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

function parseFiltrosDeConjuntos(query: Record<string, unknown>): FiltrosDeConjuntos {
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
    ...(flag("comDivergencia") ? { comDivergencia: true } : {}),
    ...(flag("semPar") ? { semPar: true } : {}),
    ...(flag("comAlteracao") ? { comAlteracao: true } : {}),
  };
}

router.get("/composition/conjuntos", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  try {
    const view = await getVisaoDeConjuntos(db, {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
      filtros: parseFiltrosDeConjuntos(query),
    });
    if (!view) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    /*
      Uma placa apontada por mais de um cavalo contradiz o que as 9 vigências
      medidas mostram, e o efeito dela é contábil: a carreta seria contada duas
      vezes se o pareamento a atribuísse aos dois. A tela continua abrindo — ela
      diz, linha a linha, o que aconteceu —, mas o estado não passa em silêncio.
    */
    const disputadas = view.linhas.filter((l) => l.natureza === "PLACA_DISPUTADA");
    if (disputadas.length > 0) {
      req.log.error(
        {
          effectiveDate: view.effectiveDate,
          placas: [...new Set(disputadas.map((l) => l.placaApontada))],
        },
        "Placa de carreta apontada por mais de um cavalo na mesma vigência.",
      );
    }
    res.json(view);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building composition conjuntos view");
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

      A vigência e o contexto são os que a composição **já resolveu**, e não o
      que veio na query. Reenviar o pedido faria a leitura resolvê-lo uma
      segunda vez, e duas resoluções são duas chances de a ficha e o atalho
      dela falarem de vigências diferentes.
    */
    const vinculo =
      composicao.entityType === "CAVALO"
        ? await getVinculoDoCavalo(db, entityId, {
            effectiveDate: composicao.effectiveDate,
            context: { scopeHash: composicao.scopeHash, channel: composicao.channel },
          })
        : null;

    /*
      Duas carretas correntes com a mesma placa contradizem
      `entity_identifier_current_uq`. A ficha continua abrindo — o vínculo é um
      atalho, e derrubar a página inteira por causa dele seria trocar um defeito
      por outro maior —, mas o estado não passa em silêncio.
    */
    if (vinculo?.ambiguidade) {
      req.log.error(
        {
          entityId,
          placaCarreta: vinculo.placaCarreta,
          carretas: vinculo.ambiguidade.entityIds,
          effectiveDate: composicao.effectiveDate,
        },
        "Mais de uma carreta corrente com a mesma placa; o vínculo do cavalo ficou sem destino.",
      );
    }

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
