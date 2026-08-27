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

import { parseContext as parseContextoDaConsulta } from "../lib/contexto";
import { exigirAtivoNaOperacao } from "../lib/operacao";
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
function parseContext(query: Record<string, unknown>): Partial<SeriesContext> | undefined {
  const pedido = parseContextoDaConsulta(query);
  if (pedido === undefined) return undefined;
  const { janela: _janela, ...semJanela } = pedido;
  return semJanela;
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

/**
 * O plano da DRE — servido para que a tela não precise repetir a estrutura.
 *
 * Uma cópia do plano no frontend divergiria no primeiro componente novo, e as
 * duas versões seriam usadas para dizer o que a demonstração contém.
 */
router.get("/dre/plano", (_req, res): void => {
  res.json({
    componentes: PLANO_DA_DRE,
    escopos: ESCOPOS_APURAVEIS,
    criterios: CRITERIOS,
    aviso: AVISO_DE_CIRCULARIDADE,
  });
});

router.get("/dre/fleet", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

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
});

router.get("/dre/unit/:entityId", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  /*
    O ativo é pedido por id, e o ativo é a única coisa deste modelo que
    atravessa operações: a mesma placa pode ser remunerada na empurrada e na
    rota. Por isso a pergunta não é "de qual operação ele é", e sim "ele aparece
    na que está perguntando" — ver `operacoesDaEntidade`.
  */
  await exigirAtivoNaOperacao(req, entityId);
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

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
  /*
    O ativo é pedido por id, e o ativo é a única coisa deste modelo que
    atravessa operações: a mesma placa pode ser remunerada na empurrada e na
    rota. Por isso a pergunta não é "de qual operação ele é", e sim "ele aparece
    na que está perguntando" — ver `operacoesDaEntidade`.
  */
  await exigirAtivoNaOperacao(req, entityId);
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  const ponte = await getPonteDaDRE(db, entityId, escopo, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!ponte) {
    res.status(404).json({ error: "Equipamento ou vigência não encontrados." });
    return;
  }
  res.json({ ...ponte, explicacao: explicarResultado(ponte) });
});

router.get("/dre/unit/:entityId/history", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de equipamento inválido." });
    return;
  }
  /*
    O ativo é pedido por id, e o ativo é a única coisa deste modelo que
    atravessa operações: a mesma placa pode ser remunerada na empurrada e na
    rota. Por isso a pergunta não é "de qual operação ele é", e sim "ele aparece
    na que está perguntando" — ver `operacoesDaEntidade`.
  */
  await exigirAtivoNaOperacao(req, entityId);
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  const historico = await getHistoricoDaDRE(db, escopo, {
    entityId,
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!historico) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(historico);
});

router.get("/dre/history", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const escopo = parseEscopo(query, res);
  if (!escopo) return;

  const historico = await getHistoricoDaDRE(db, escopo, {
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!historico) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(historico);
});

export default router;
