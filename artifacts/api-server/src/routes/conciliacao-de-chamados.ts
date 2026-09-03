import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  SITUACOES_DA_CONCILIACAO,
  latestTicketImport,
  linhasDaConciliacao,
  listChangeSets,
  listTicketImports,
  operacaoDoChangeSet,
  resumoDaConciliacao,
  tiposDaConciliacao,
  type SituacaoDaConciliacao,
} from "@workspace/comparison";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";

/**
 * CONCILIAÇÃO DE CHAMADOS — a superfície da terceira leitura.
 *
 * `changes.ts` responde o que a planilha mudou; `tickets.ts` responde o que a
 * fila pediu. Nenhuma das duas responde se as duas contam a mesma história, e é
 * essa a pergunta daqui — a mesma que o módulo tem no nome: **para cada
 * alteração da planilha importada, existe o chamado que a pediu?**
 *
 * A rota não calcula nada: o cruzamento inteiro mora em
 * `@workspace/comparison/conciliacao-de-chamados`, testado sem HTTP. Aqui só se
 * traduzem parâmetros, se recusa o que não é da operação de quem pergunta, e se
 * escolhem os dois lados quando quem pergunta não escolheu.
 *
 * **Os dois ids são o recorte, e os dois são obrigatórios** — uma comparação e
 * um envio. O motivo está escrito no módulo: `ticket` é append-only e cada
 * envio reinsere a fila inteira, então "todos os envios" multiplicaria a fila
 * pelo número de importações. Quando não vêm na consulta, o padrão é a
 * comparação mais recente da operação e o envio mais recente lido — e a
 * resposta **diz quais escolheu**, para a tela poder mostrar sobre o que está
 * falando em vez de deixar quem lê supor.
 *
 * O recorte por operação é o das demais leituras: um `changeSetId` de outra
 * auditoria é 403, pela mesma regra por id de `justificativas.ts`. O lado dos
 * chamados não tem operação — o export do Freightech não a nomeia —, e por isso
 * ele é escolhido por envio e nunca herdado.
 */
const router: IRouter = Router();

const BASE = "/conciliacao-de-chamados";

/**
 * O que este router — e mais ninguém — sabe dizer quando falta schema.
 *
 * A conciliação lê as duas famílias ao mesmo tempo, e num banco atrasado a que
 * falta costuma ser a de chamados: a de comparação é do começo do produto. A
 * frase nomeia as duas, porque adivinhar qual falta produziria uma instrução
 * errada com a mesma confiança da certa.
 */
router.use(
  BASE,
  contextoDeSchema(
    "Este banco ainda não tem as duas metades da conciliação: falta o schema " +
      "de comparação (change/change_set) ou o de chamados (0012_chamados, " +
      "0013_chamados_por_parametro, 0014_chamados_formato_real). Não é o seu " +
      "pedido — nada chegou a ser lido, e nada se perdeu.",
  ),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cinquenta linhas por página, como a tabela abre; teto de duzentas. */
const POR_PAGINA_PADRAO = 50;
const POR_PAGINA_MAXIMO = 200;

function texto(query: Record<string, unknown>, chave: string): string | undefined {
  const v = query[chave];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function uuidDaConsulta(
  query: Record<string, unknown>,
  chave: string,
): string | undefined {
  const v = texto(query, chave);
  return v !== undefined && UUID.test(v) ? v : undefined;
}

function limiteDaConsulta(bruto: unknown): number {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return POR_PAGINA_PADRAO;
  return Math.min(Math.trunc(n), POR_PAGINA_MAXIMO);
}

function offsetDaConsulta(bruto: unknown): number {
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O que a tela conferiu de fato — os dois lados, resolvidos.
 *
 * Existe como função porque as três rotas de leitura precisam exatamente da
 * mesma resolução, e porque ela tem uma propriedade que não pode variar entre
 * elas: **o padrão é escolhido no servidor e devolvido na resposta.** Se cada
 * rota escolhesse o seu, o resumo e a lista da mesma tela poderiam falar de
 * comparações diferentes sem que nada avisasse.
 */
async function ladosDaConciliacao(
  req: Parameters<typeof exigirOperacaoDoRecurso>[0],
): Promise<
  | { ok: true; changeSetId: string; ticketImportId: string }
  | { ok: false; status: number; error: string }
> {
  const query = req.query as Record<string, unknown>;
  const operacao = operacaoDaConsulta(query);

  let changeSetId = uuidDaConsulta(query, "changeSetId");
  if (changeSetId) {
    await exigirOperacaoDoRecurso(req, "comparação", changeSetId, () =>
      operacaoDoChangeSet(db, changeSetId!),
    );
  } else {
    const comparacoes = await listChangeSets(db, { operacao });
    const escopo = texto(query, "scopeHash");
    const escolhida = comparacoes.find(
      (cs) => !escopo || String(cs.snapshot_b_scope_hash ?? "") === escopo,
    );
    if (!escolhida) {
      return {
        ok: false,
        status: 404,
        error:
          "Não há comparação de vigências para conciliar neste recorte. " +
          "Compare duas vigências em Comparar vigências e volte aqui.",
      };
    }
    changeSetId = String(escolhida.id);
  }

  let ticketImportId = uuidDaConsulta(query, "ticketImportId");
  if (!ticketImportId) {
    const envio = await latestTicketImport(db);
    if (!envio) {
      return {
        ok: false,
        status: 404,
        error:
          "Não há envio de chamados lido neste banco. Importe um arquivo de " +
          "chamados em Importações e volte aqui.",
      };
    }
    ticketImportId = envio.id;
  }

  return { ok: true, changeSetId, ticketImportId };
}

function recorteDaConsulta(
  query: Record<string, unknown>,
  lados: { changeSetId: string; ticketImportId: string },
) {
  return {
    ...lados,
    somenteVigenciaComparada: query["somenteVigenciaComparada"] === "1",
  };
}

/**
 * Os dois seletores da tela: as comparações da operação e os envios lidos.
 *
 * Uma resposta só, e não duas rotas, porque a tela precisa das duas listas para
 * abrir — e porque é aqui que a escolha padrão fica visível antes de qualquer
 * conta: quem abre vê imediatamente qual vigência e qual envio o servidor
 * escolheu, e troca se não for o que queria.
 *
 * Os envios que não chegaram a READ ficam de fora. Conciliar contra um envio
 * que falhou no meio produziria centenas de "sem chamado" que são falha de
 * leitura, e não ausência de chamado — a mesma distinção que o Monitoramento
 * faz ao marcar uma comparação como IGNORADO.
 */
router.get(`${BASE}/opcoes`, async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const operacao = operacaoDaConsulta(query);
  const escopo = texto(query, "scopeHash");

  const [comparacoes, envios] = await Promise.all([
    listChangeSets(db, { operacao }),
    listTicketImports(db),
  ]);

  res.json({
    comparacoes: comparacoes
      .filter((cs) => !escopo || String(cs.snapshot_b_scope_hash ?? "") === escopo)
      .map((cs) => ({
        id: String(cs.id),
        rotuloA: cs.snapshot_a_label ?? null,
        rotuloB: cs.snapshot_b_label ?? null,
        dataB: cs.snapshot_b_date ?? null,
        scopeHash: cs.snapshot_b_scope_hash ?? null,
      })),
    envios: envios
      .filter((e) => e.status === "READ")
      .map((e) => ({
        id: e.id,
        filename: e.filename,
        receivedAt: e.receivedAt,
        ticketCount: e.ticketCount,
      })),
  });
});

/** O resumo: os dois lados, o cruzamento e a diferença de contagem. */
router.get(`${BASE}/resumo`, async (req, res): Promise<void> => {
  const lados = await ladosDaConciliacao(req);
  if (!lados.ok) {
    res.status(lados.status).json({ error: lados.error });
    return;
  }

  const recorte = recorteDaConsulta(req.query as Record<string, unknown>, lados);
  const [resumo, tipos] = await Promise.all([
    resumoDaConciliacao(db, recorte),
    tiposDaConciliacao(db, recorte),
  ]);

  res.json({
    changeSetId: lados.changeSetId,
    ticketImportId: lados.ticketImportId,
    ...resumo,
    tipos,
  });
});

/**
 * A lista paginada — um par por linha.
 *
 * A situação chega por nome e é conferida contra a lista fechada
 * `SITUACOES_DA_CONCILIACAO`: texto de fora nunca vira predicado, pela mesma
 * disciplina de `ABAS` no Monitoramento.
 */
router.get(`${BASE}/linhas`, async (req, res): Promise<void> => {
  const lados = await ladosDaConciliacao(req);
  if (!lados.ok) {
    res.status(lados.status).json({ error: lados.error });
    return;
  }

  const query = req.query as Record<string, unknown>;
  const pedida = texto(query, "situacao");
  const situacao = (SITUACOES_DA_CONCILIACAO as readonly string[]).includes(
    pedida ?? "",
  )
    ? (pedida as SituacaoDaConciliacao)
    : undefined;

  const pagina = await linhasDaConciliacao(
    db,
    recorteDaConsulta(query, lados),
    {
      situacao,
      entityType: texto(query, "entityType"),
      search: texto(query, "search"),
    },
    {
      limit: limiteDaConsulta(query["limit"]),
      offset: offsetDaConsulta(query["offset"]),
    },
  );

  res.json({
    changeSetId: lados.changeSetId,
    ticketImportId: lados.ticketImportId,
    ...pagina,
  });
});

export default router;
