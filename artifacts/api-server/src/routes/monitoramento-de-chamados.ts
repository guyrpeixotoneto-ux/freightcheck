import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  diaDaOperacao,
  diaSeguinte,
  filaDoDia,
  reguaDeDias,
  resumoDoDia,
  seriesDisponiveis,
} from "@workspace/comparison";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";

/**
 * MONITORAMENTO DE CHAMADOS — a superfície da tela.
 *
 * A aba Chamados (`tickets.ts`) responde "o que tem na fila hoje", lendo um
 * envio. Estas rotas respondem pelo **dia**: que arquivo chegou, de que
 * tamanho, e o que ele trouxe. São quatro — as séries, a régua, o resumo e a
 * relação —, e **nenhuma compara nada em tempo de requisição**: o motor já
 * comparou na importação, e o que elas leem é linha pronta. É o que impede a
 * página mais acessada do produto de ficar cara.
 *
 * A tela já teve uma segunda leitura, a das **movimentações** — a fila de
 * trabalho revisável, com a lista paginada, o detalhe de uma movimentação e as
 * três escritas da revisão. O módulo escolheu o grão do arquivo e ela saiu da
 * tela; estas rotas saíram atrás. O motor continua produzindo movimentação em
 * toda importação, e `/dia/:data` continua contando quantas houve — o que
 * deixou de existir é a fila de trabalho sobre elas.
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

/**
 * Um parâmetro de texto da query.
 *
 * Vazio é **ausência**, nunca um filtro por string vazia: `?unidade=` sai de um
 * seletor que voltou para "todas", e lê-lo como predicado devolveria zero linha
 * para um recorte que ninguém pediu.
 */
function texto(query: Record<string, unknown>, chave: string): string | undefined {
  const v = query[chave];
  return typeof v === "string" && v !== "" ? v : undefined;
}

/** Um inteiro não negativo. Qualquer outra coisa é ausência, e não erro. */
function numero(query: Record<string, unknown>, chave: string): number | undefined {
  const v = texto(query, chave);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
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

/**
 * O resumo de um dia: cartões, detalhamento, pontos de atenção e avisos.
 *
 * Ele já vinha com as opções de filtro das movimentações — unidades, áreas,
 * responsáveis, tipos de alteração —, uma consulta a mais em toda abertura de
 * tela. Os seletores da tela agora recortam a relação, e as opções deles vêm
 * com ela, em `/dia/:data/chamados`. Uma consulta que ninguém lê é cara na
 * página mais acessada do produto.
 */
router.get(`${BASE}/dia/:data`, async (req, res): Promise<void> => {
  if (!DIA.test(req.params.data)) {
    res.status(400).json({ error: "Data inválida: use o formato AAAA-MM-DD." });
    return;
  }
  res.json(
    await resumoDoDia(db, {
      dia: req.params.data,
      serie: serieDaConsulta(req.query),
    }),
  );
});

/**
 * A relação de chamados que o arquivo do dia trouxe — a lista da tela.
 *
 * `/dia/:data` conta **o que mudou**; esta devolve **o que veio**. São grãos
 * diferentes e nunca somam: a relação é o arquivo inteiro, e as movimentações
 * são o subconjunto dele que se mexeu — cada linha daqui diz em qual dos dois
 * ela está (`movimentou`), que é o que torna a afirmação conferível a olho.
 *
 * Rota própria, e não um campo em `/dia/:data`: a relação é do tamanho do
 * arquivo, e o resumo é uma consulta pequena que a régua e os cartões pedem
 * primeiro. Quem pagina a lista não repagina o resumo.
 */
router.get(`${BASE}/dia/:data/chamados`, async (req, res): Promise<void> => {
  if (!DIA.test(req.params.data)) {
    res.status(400).json({ error: "Data inválida: use o formato AAAA-MM-DD." });
    return;
  }

  res.json(
    await filaDoDia(db, {
      dia: req.params.data,
      serie: serieDaConsulta(req.query),
      filtros: {
        unidade: texto(req.query, "unidade"),
        area: texto(req.query, "area"),
        responsavel: texto(req.query, "responsavel"),
        statusBucket: texto(req.query, "statusBucket"),
        busca: texto(req.query, "busca"),
        limit: numero(req.query, "limit"),
        offset: numero(req.query, "offset"),
      },
    }),
  );
});

export default router;
