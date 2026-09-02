import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ABAS,
  RevisaoRecusada,
  desfazerRevisao,
  detalheDaMovimentacao,
  diaDaOperacao,
  diaSeguinte,
  listarMovimentacoes,
  opcoesDeFiltro,
  registrarRevisao,
  reguaDeDias,
  resumoDoDia,
  revisarEmLote,
  seriesDisponiveis,
  type AbaDoMonitoramento,
} from "@workspace/comparison";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";

/**
 * MONITORAMENTO DE CHAMADOS — a superfície da tela.
 *
 * A aba Chamados (`tickets.ts`) responde "o que tem na fila hoje", lendo um
 * envio. Estas rotas respondem "o que mudou desde ontem", lendo a camada
 * derivada que o motor já calculou na importação. **Nenhuma delas compara nada
 * em tempo de requisição**: abrir a tela é três consultas sobre linhas prontas,
 * e é o que impede a página mais acessada do produto de ficar cara.
 *
 * ---------------------------------------------------------------------------
 * O escopo, e o que ele é neste produto
 * ---------------------------------------------------------------------------
 *
 * O FreightCheck não tem inquilinos — está escrito em
 * `lib/db/src/schema/significado.ts` e em `lib/empresa-da-requisicao.ts`, e não
 * há `empresa_id` em tabela nenhuma. Então o recorte que existe aqui é a
 * **série**: a unidade que o próprio arquivo de chamados nomeia.
 *
 * Três regras, e todas moram em `serieDaConsulta`:
 *
 * 1. **A série chega só pela query.** Nunca pelo corpo. As rotas de escrita
 *    abaixo recebem apenas o id da movimentação, e o dia e a série delas são
 *    lidos do banco — não há caminho por onde um corpo amplie escopo.
 * 2. **Ausente é "todas", e vazio não existe.** Uma instalação de uma unidade
 *    só nunca manda o parâmetro, e não paga por uma decisão que não tem.
 * 3. **Desconhecida devolve nada, nunca tudo.** O motor filtra por igualdade, e
 *    é a diferença entre um filtro que não achou e um filtro que sumiu.
 *
 * No dia em que houver vínculo entre conta e série, é `serieDaConsulta` que
 * muda — e nenhuma das consultas abaixo precisa ser reescrita. É o mesmo
 * desenho de `resolverEmpresa`, e pela mesma razão: escopo espalhado é o que
 * faz a próxima rota esquecer o `where`.
 */
const router: IRouter = Router();

const BASE = "/monitoramento-de-chamados";

/**
 * O que este router — e mais ninguém — sabe dizer quando falta schema.
 *
 * Mesma frase de sempre pelo mesmo 503 com diagnóstico, e pela mesma razão de
 * `tickets.ts`: sem a `0087` as tabelas do monitoramento não existem, e cada
 * consulta morreria com um `42P01` que parece defeito do pedido.
 */
router.use(
  BASE,
  contextoDeSchema(
    "Este banco ainda não tem onde guardar o monitoramento de chamados: falta " +
      "a migration 0087_monitoramento_de_chamados. Não é o seu pedido — nada " +
      "chegou a ser lido, e nada se perdeu.",
  ),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O rótulo com que a série indeterminada viaja na URL.
 *
 * `?serie=` vazio seria ambíguo — não dá para distinguir "sem recorte" de "o
 * recorte dos envios sem unidade" —, e um envio sem unidade é uma série de
 * verdade, com movimentações próprias. O `@` marca que é um nome nosso e não
 * uma unidade que a Ambev escreveu, pela mesma convenção das chaves de módulo.
 */
const SEM_SERIE = "@sem-serie";

/** O recorte de série — a autoridade única deste arquivo. Ver o cabeçalho. */
function serieDaConsulta(
  query: Record<string, unknown>,
): string | null | undefined {
  const bruta = query["serie"];
  if (typeof bruta !== "string" || bruta === "") return undefined;
  return bruta === SEM_SERIE ? null : bruta;
}

/** Quantos dias a régua mostra quando ninguém pede outra coisa. */
const DIAS_DA_REGUA = 9;

/** As séries que existem — o seletor da tela, e nada além. */
router.get(`${BASE}/series`, async (_req, res): Promise<void> => {
  res.json({ series: await seriesDisponiveis(db), semSerie: SEM_SERIE });
});

/**
 * A régua: um dia por posição, com o estado de cada um.
 *
 * A janela padrão termina **hoje** e olha para trás: quem abre a tela quer o
 * que ainda não olhou, e dias futuros nunca têm importação. Uma janela centrada
 * em hoje gastaria quase metade das posições com cinza garantido.
 */
router.get(`${BASE}/dias`, async (req, res): Promise<void> => {
  const hoje = diaDaOperacao(new Date());
  const ate = typeof req.query.ate === "string" && DIA.test(req.query.ate)
    ? req.query.ate
    : hoje;
  const de = typeof req.query.de === "string" && DIA.test(req.query.de)
    ? req.query.de
    : diaSeguinte(ate, -(DIAS_DA_REGUA - 1));

  if (de > ate) {
    res.status(400).json({ error: "A data inicial da régua é posterior à final." });
    return;
  }

  res.json({
    hoje,
    de,
    ate,
    dias: await reguaDeDias(db, { de, ate, serie: serieDaConsulta(req.query) }),
  });
});

/** O resumo de um dia: cartões, detalhamento, pontos de atenção e avisos. */
router.get(`${BASE}/dia/:data`, async (req, res): Promise<void> => {
  if (!DIA.test(req.params.data)) {
    res.status(400).json({ error: "Data inválida: use o formato AAAA-MM-DD." });
    return;
  }
  const serie = serieDaConsulta(req.query);
  const [resumo, filtros] = await Promise.all([
    resumoDoDia(db, { dia: req.params.data, serie }),
    opcoesDeFiltro(db, { dia: req.params.data, serie }),
  ]);
  res.json({ ...resumo, filtros });
});

/**
 * A lista paginada — a fila de trabalho do dia.
 *
 * A aba chega por nome e é conferida contra a lista fechada `ABAS`: texto de
 * fora nunca vira predicado. É a mesma disciplina de `ORDENACOES` em
 * `tickets.ts`, e pela mesma razão — o que não está na lista não é um recorte,
 * é uma tentativa.
 */
router.get(`${BASE}/dia/:data/movimentacoes`, async (req, res): Promise<void> => {
  if (!DIA.test(req.params.data)) {
    res.status(400).json({ error: "Data inválida: use o formato AAAA-MM-DD." });
    return;
  }

  const texto = (chave: string): string | undefined => {
    const v = req.query[chave];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const numero = (chave: string): number | undefined => {
    const v = texto(chave);
    if (v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
  };

  const pedida = texto("aba");
  const aba = (ABAS as readonly string[]).includes(pedida ?? "")
    ? (pedida as AbaDoMonitoramento)
    : "TODOS";

  const resultado = await listarMovimentacoes(db, {
    dia: req.params.data,
    serie: serieDaConsulta(req.query),
    filtros: {
      aba,
      unidade: texto("unidade"),
      area: texto("area"),
      responsavel: texto("responsavel"),
      statusBucket: texto("statusBucket"),
      tipoDeAlteracao: texto("tipoDeAlteracao"),
      busca: texto("busca"),
      limit: numero("limit"),
      offset: numero("offset"),
    },
  });

  res.json({ aba, ...resultado });
});

/**
 * Uma movimentação inteira: o encadeamento do dia e os parâmetros do chamado.
 *
 * Rota própria, e não mais um campo na lista: o encadeamento é grande e quase
 * ninguém o abre. Mandá-lo junto faria toda abertura de tela pagar por ele — a
 * mesma escolha que `/tickets/:id` faz do outro lado.
 */
router.get(`${BASE}/movimentacoes/:id`, async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de movimentação inválido." });
    return;
  }
  const detalhe = await detalheDaMovimentacao(db, req.params.id);
  if (!detalhe) {
    res.status(404).json({ error: "Movimentação não encontrada." });
    return;
  }
  res.json(detalhe);
});

/**
 * Marcar como revisada.
 *
 * O autor é **a sessão**, nunca um campo do corpo: uma revisão que dissesse
 * quem revisou por conta do cliente não sustenta a frase "foi fulano quem
 * revisou". A escrita durante um "visualizar como" já é recusada antes de
 * chegar aqui (`middlewares/visualizacao-como.ts`), o que mantém o autor sendo
 * sempre quem digitou a senha.
 *
 * `revisao` no corpo é a versão que a **tela mostrou**. Quando ela não é mais a
 * atual — um envio novo reescreveu a movimentação entre o carregamento e o
 * clique —, a resposta é 409 com a frase inteira, e não uma revisão gravada em
 * cima de algo que ninguém viu.
 */
router.post(`${BASE}/movimentacoes/:id/revisao`, async (req, res, next): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de movimentação inválido." });
    return;
  }
  const bruta = (req.body as Record<string, unknown> | undefined)?.revisao;
  const revisaoEsperada =
    typeof bruta === "number" && Number.isInteger(bruta) ? bruta : undefined;

  try {
    res.json(
      await registrarRevisao(db, {
        movementId: req.params.id,
        revisaoEsperada,
        revisor: {
          userId: req.user?.id ?? null,
          email: req.user?.email ?? "sistema",
        },
      }),
    );
  } catch (err) {
    if (err instanceof RevisaoRecusada) {
      res.status(err.codigo === "NAO_ENCONTRADA" ? 404 : 409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** Desfazer — some com a revisão da versão atual, e só dela. */
router.delete(`${BASE}/movimentacoes/:id/revisao`, async (req, res, next): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de movimentação inválido." });
    return;
  }
  try {
    res.json(await desfazerRevisao(db, req.params.id));
  } catch (err) {
    if (err instanceof RevisaoRecusada) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** Quantas movimentações um lote pode carregar. É o teto de uma página. */
const TETO_DO_LOTE = 100;

/**
 * O "Continuar revisão" — um lote de movimentações que a tela acabou de mostrar.
 *
 * A resposta separa `revisadas` de `recusadas`: as que mudaram desde que a
 * lista carregou não entram em silêncio, e a tela diz quantas ficaram para um
 * segundo olhar. Revisá-las junto seria carimbar o que ninguém viu — o mesmo
 * motivo do 409 da rota acima, aplicado a um lote.
 */
router.post(`${BASE}/revisoes`, async (req, res): Promise<void> => {
  const corpo = req.body as Record<string, unknown> | undefined;
  const ids = Array.isArray(corpo?.ids) ? corpo.ids : null;

  if (ids === null || ids.length === 0) {
    res.status(400).json({ error: "Envie `ids` com ao menos uma movimentação." });
    return;
  }
  if (ids.length > TETO_DO_LOTE) {
    res.status(400).json({
      error: `Um lote revisa no máximo ${TETO_DO_LOTE} movimentações por vez.`,
    });
    return;
  }
  if (!ids.every((id): id is string => typeof id === "string" && UUID.test(id))) {
    res.status(400).json({ error: "Há identificador de movimentação inválido no lote." });
    return;
  }

  res.json(
    await revisarEmLote(db, {
      ids,
      revisor: {
        userId: req.user?.id ?? null,
        email: req.user?.email ?? "sistema",
      },
    }),
  );
});

export default router;
