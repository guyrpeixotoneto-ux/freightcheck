import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  acharCotacao,
  arquivarCotacao,
  analisarItem,
  carteira,
  criarCotacao,
  ehSituacao,
  guardarPremissa,
  iaDisponivel,
  listarCotacoes,
  moverCotacao,
  modeloConfigurado,
  panoramaDeCompras,
  politicaDe,
  porFornecedor,
  premissasConfiguradas,
  produtoDe,
  responderCompras,
  sugestoes,
  type EscopoDaConsulta,
  type PoliticaDeCompra,
  type PremissasDaCompra,
} from "@workspace/compras";

import { parseContext as parseContextoDaConsulta } from "../lib/contexto";
import { operacaoDaConsulta } from "../lib/operacao";

/**
 * Agente de Compras — a superfície HTTP do copiloto de aquisição.
 *
 * Fica ao lado de `routes/compras.ts` e responde outra pergunta. Aquele balcão
 * entrega o **remunerado** e se recusa, por desenho, a comparar com o preço do
 * pedido: o pedido não estava no banco. Estas rotas são o que mudou — a cotação
 * passou a poder ser registrada (migration `0101`), e com ela a pergunta "quanto
 * eu deveria pagar por isso?" ganhou os dois lados da conta.
 *
 * **O que nenhuma rota daqui faz: inventar preço.** Preço-alvo e teto saem do
 * motor econômico (`@workspace/compras/motor`), que é uma função pura sobre a
 * remuneração que o acervo devolveu. O modelo de linguagem entra depois, para
 * redigir, e o texto dele é descartado inteiro se citar um real que o dossiê
 * não sustente. `/perguntar` devolve, junto do texto, a análise que o produziu —
 * é o que permite conferir um contra o outro.
 *
 * **Cotação é privada de quem a registrou**, como a conversa do Assistente:
 * toda leitura passa por `req.user!.id`, e o armazém (`lib/compras/cotacoes.ts`)
 * não tem função que dispense o dono. **Premissa é da casa**: vida útil de pneu
 * não pertence a ninguém, e duas pessoas configurando vidas diferentes
 * produziriam dois preços-alvo para a mesma compra.
 */
const router: IRouter = Router();

const LIMITE_DA_PERGUNTA = 1000;

/*
  **Nenhuma rota daqui escreve 5xx.** Falha de banco, de rede ou defeito nosso
  sobem, e quem as classifica é o contrato de erro montado por último em
  `app.ts` — com `requestId`, diagnóstico e o stack ficando só no log. É a regra
  que `o-contrato-cobre-todas-as-rotas.test.ts` guarda sobre o texto-fonte, e a
  única exceção do produto é o Assistente, porque metade das respostas dele é
  `text/event-stream` e ali o cabeçalho já foi enviado quando a falha acontece.
  Esta superfície responde JSON e nada mais, então não precisa da exceção.

  O que continua sendo decisão desta rota são os 4xx: o que é pergunta vazia, o
  que é item fora do catálogo, o que é preço ausente. Esses dizem o que fazer, e
  por isso são escritos aqui.
*/

/** O contexto pedido — o mesmo parser das onze outras rotas, sem a janela. */
function parseContext(
  query: Record<string, unknown>,
): EscopoDaConsulta | undefined {
  const pedido = parseContextoDaConsulta(query);
  if (pedido === undefined) return undefined;
  const { janela: _janela, ...semJanela } = pedido;
  return semJanela;
}

function parsePeriod(query: Record<string, unknown>): string | undefined {
  return typeof query.period === "string" && query.period !== ""
    ? query.period
    : undefined;
}

function recorteDa(req: Request) {
  const query = req.query as Record<string, unknown>;
  return {
    ...(parsePeriod(query) !== undefined
      ? { period: parsePeriod(query)! }
      : {}),
    ...(parseContext(query) !== undefined
      ? { context: parseContext(query)! }
      : {}),
    operacao: operacaoDaConsulta(query),
  };
}

/** Um número do corpo, ou `null`. String vazia e `NaN` contam como ausência. */
function numeroDoCorpo(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A política que a chamada pediu.
 *
 * Aceita percentual (12) e fração (0,12): o campo da tela pede percentual, e um
 * `12` chegando como `margemAlvo` seria lido como 1200% — o motor o descartaria
 * por estar fora de (0,1) e a pessoa veria o padrão da casa sem entender por
 * quê. Converter aqui é o que faz o campo funcionar como ele se apresenta.
 */
function politicaDoCorpo(
  corpo: Record<string, unknown>,
): Partial<PoliticaDeCompra> | undefined {
  const fracao = (bruto: unknown): number | undefined => {
    const n = Number(bruto);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n >= 1 ? n / 100 : n;
  };
  const margemAlvo = fracao(corpo.margemAlvo);
  const margemMinima = fracao(corpo.margemMinima);
  if (margemAlvo === undefined && margemMinima === undefined) return undefined;
  return {
    ...(margemAlvo !== undefined ? { margemAlvo } : {}),
    ...(margemMinima !== undefined ? { margemMinima } : {}),
  };
}

function premissasDoCorpo(corpo: Record<string, unknown>): PremissasDaCompra {
  return {
    precoUnitario: numeroDoCorpo(corpo.precoUnitario),
    quantidade: numeroDoCorpo(corpo.quantidade),
    precoHistorico: numeroDoCorpo(corpo.precoHistorico),
    vidaUtilMeses: numeroDoCorpo(corpo.vidaUtilMeses),
    unidadesPorAtivo: numeroDoCorpo(corpo.unidadesPorAtivo),
    fornecedor:
      typeof corpo.fornecedor === "string" ? corpo.fornecedor.trim() : null,
  };
}

// ── Capacidades e sugestões ─────────────────────────────────────────────────

/**
 * O que a tela precisa saber antes da primeira pergunta.
 *
 * `ia` e `modelo` são a mesma honestidade do Assistente: quem lê uma resposta
 * sobre preço merece saber se um modelo participou da redação. `politica` vem
 * junto porque a tela escreve "limite econômico **configurado**", e essa palavra
 * só é verdadeira se os números estiverem à vista.
 */
router.get("/agente-compras/capacidades", (_req, res): void => {
  res.json({
    ia: iaDisponivel(),
    modelo: modeloConfigurado(),
    politica: politicaDe(),
    sugestoes: sugestoes(),
  });
});

// ── Visão executiva ─────────────────────────────────────────────────────────

router.get("/agente-compras/panorama", async (req, res): Promise<void> => {
  res.json(
    await panoramaDeCompras(db, req.user!.id, { recorte: recorteDa(req) }),
  );
});

/** A carteira com os fornecedores ao lado — a leitura que a tela lista. */
router.get("/agente-compras/carteira", async (req, res): Promise<void> => {
  const linhas = await carteira(db, req.user!.id, { recorte: recorteDa(req) });
  res.json({ linhas, fornecedores: porFornecedor(linhas) });
});

// ── Análise de um item ──────────────────────────────────────────────────────

/**
 * A análise de um item, sem passar pelo chat.
 *
 * É a mesma conta que `/perguntar` faz — literalmente `analisarItem` —, e existe
 * para a tela poder recalcular ao mexer num campo sem gastar uma chamada ao
 * modelo por tecla digitada.
 */
router.post("/agente-compras/analisar", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const item = typeof corpo.item === "string" ? corpo.item.trim() : "";
  if (item === "" || !produtoDe(item)) {
    res.status(400).json({ error: "Informe um item do catálogo de compras." });
    return;
  }

  const analise = await analisarItem(db, {
    chave: item,
    ownerId: req.user!.id,
    placa:
      typeof corpo.placa === "string" && corpo.placa !== ""
        ? corpo.placa
        : null,
    premissas: premissasDoCorpo(corpo),
    ...(politicaDoCorpo(corpo) ? { politica: politicaDoCorpo(corpo)! } : {}),
    recorte: recorteDa(req),
  });
  if (!analise) {
    res
      .status(404)
      .json({ error: `"${item}" não está no catálogo de compras.` });
    return;
  }
  res.json(analise);
});

// ── Perguntar ───────────────────────────────────────────────────────────────

router.post("/agente-compras/perguntar", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const pergunta = typeof corpo.pergunta === "string" ? corpo.pergunta : "";

  if (pergunta.trim() === "") {
    res.status(400).json({ error: "Escreva a pergunta." });
    return;
  }
  if (pergunta.length > LIMITE_DA_PERGUNTA) {
    res.status(413).json({
      error: `A pergunta passou de ${LIMITE_DA_PERGUNTA} caracteres. Divida em duas.`,
    });
    return;
  }

  /*
    O histórico vem do cliente e não do banco: esta tela não guarda conversa.
    É a diferença deliberada para o Assistente — ali a conversa é o produto,
    com título, arquivamento e voto; aqui a unidade de trabalho é a **decisão
    de compra**, e ela é gravada onde importa, que é a cotação. Guardar um
    segundo histórico de conversa ao lado daquele criaria duas memórias sobre
    a mesma negociação.
  */
  const historico = Array.isArray(corpo.historico)
    ? corpo.historico
        .filter(
          (t): t is { papel: "PERGUNTA" | "RESPOSTA"; texto: string } =>
            typeof t === "object" &&
            t !== null &&
            typeof (t as { texto?: unknown }).texto === "string" &&
            ((t as { papel?: unknown }).papel === "PERGUNTA" ||
              (t as { papel?: unknown }).papel === "RESPOSTA"),
        )
        .slice(-8)
    : [];

  const resposta = await responderCompras(db, {
    pergunta,
    ownerId: req.user!.id,
    item:
      typeof corpo.item === "string" && corpo.item !== "" ? corpo.item : null,
    premissas: premissasDoCorpo(corpo),
    ...(politicaDoCorpo(corpo) ? { politica: politicaDoCorpo(corpo)! } : {}),
    recorte: recorteDa(req),
    ...(historico.length > 0 ? { historico } : {}),
    semIa: corpo.semIa === true,
  });

  res.json(resposta);
});

// ── Cotações ────────────────────────────────────────────────────────────────

router.get("/agente-compras/cotacoes", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  res.json({
    cotacoes: await listarCotacoes(db, req.user!.id, {
      ...(typeof query.item === "string" && query.item !== ""
        ? { item: query.item }
        : {}),
      ...(ehSituacao(query.situacao) ? { situacao: query.situacao } : {}),
      ...(operacaoDaConsulta(query) !== null
        ? { operacao: operacaoDaConsulta(query) }
        : {}),
    }),
  });
});

router.post("/agente-compras/cotacoes", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const item = typeof corpo.item === "string" ? corpo.item.trim() : "";
  const fornecedor =
    typeof corpo.fornecedor === "string" ? corpo.fornecedor.trim() : "";
  const preco = numeroDoCorpo(corpo.precoUnitario);

  /*
    Três recusas, e cada uma diz o que fazer. Um 400 genérico aqui obrigaria
    quem digitou a adivinhar qual dos três campos faltou — e este formulário é
    preenchido com um fornecedor no telefone.
  */
  if (item === "" || !produtoDe(item)) {
    res.status(400).json({ error: "Escolha o item do catálogo de compras." });
    return;
  }
  if (fornecedor === "") {
    res.status(400).json({ error: "Informe o fornecedor da proposta." });
    return;
  }
  if (preco === null) {
    res
      .status(400)
      .json({ error: "Informe o preço por unidade, maior que zero." });
    return;
  }

  const situacao = ehSituacao(corpo.situacao) ? corpo.situacao : "AGUARDANDO";
  const cotacao = await criarCotacao(db, req.user!.id, {
    item,
    fornecedor,
    precoUnitario: preco,
    descricao:
      typeof corpo.descricao === "string"
        ? corpo.descricao.trim() || null
        : null,
    quantidade: numeroDoCorpo(corpo.quantidade),
    operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
    unidade:
      typeof corpo.unidade === "string" ? corpo.unidade.trim() || null : null,
    situacao,
    evidencia:
      typeof corpo.evidencia === "string"
        ? corpo.evidencia.trim() || null
        : null,
    validaAte:
      typeof corpo.validaAte === "string" && corpo.validaAte !== ""
        ? corpo.validaAte
        : null,
  });
  res.status(201).json(cotacao);
});

router.get("/agente-compras/cotacoes/:id", async (req, res): Promise<void> => {
  const cotacao = await acharCotacao(db, req.user!.id, req.params.id);
  if (!cotacao) {
    res.status(404).json({ error: "Cotação não encontrada." });
    return;
  }
  res.json(cotacao);
});

/** Move a cotação no fluxo de quem compra. O veredito econômico não se grava. */
router.patch(
  "/agente-compras/cotacoes/:id",
  async (req, res): Promise<void> => {
    const { situacao } = (req.body ?? {}) as Record<string, unknown>;
    if (!ehSituacao(situacao)) {
      res.status(400).json({ error: "Situação inválida." });
      return;
    }
    const cotacao = await moverCotacao(
      db,
      req.user!.id,
      req.params.id,
      situacao,
    );
    if (!cotacao) {
      res.status(404).json({ error: "Cotação não encontrada." });
      return;
    }
    res.json(cotacao);
  },
);

/** Excluir é arquivar. Nenhuma linha é apagada. */
router.post(
  "/agente-compras/cotacoes/:id/arquivar",
  async (req, res): Promise<void> => {
    const cotacao = await arquivarCotacao(db, req.user!.id, req.params.id);
    if (!cotacao) {
      res.status(404).json({ error: "Cotação não encontrada." });
      return;
    }
    res.json({ archived: true, id: cotacao.id });
  },
);

// ── Premissas ───────────────────────────────────────────────────────────────

router.get("/agente-compras/premissas", async (req, res): Promise<void> => {
  const mapa = await premissasConfiguradas(
    db,
    operacaoDaConsulta(req.query as Record<string, unknown>),
  );
  res.json({ premissas: [...mapa.values()] });
});

/**
 * Configura a premissa de um item — o que faz a confiabilidade subir.
 *
 * Sem linha aqui o motor usa a estimativa do catálogo e marca a resposta como
 * de confiabilidade baixa; com linha, o mesmo número passa a ser confirmado.
 * É o caminho pelo qual o preço-alvo deixa de depender de chute sem ninguém
 * tocar em código.
 */
router.put(
  "/agente-compras/premissas/:item",
  async (req, res): Promise<void> => {
    const item = req.params.item;
    if (!produtoDe(item)) {
      res
        .status(400)
        .json({ error: `"${item}" não está no catálogo de compras.` });
      return;
    }

    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const politica = politicaDoCorpo(corpo) ?? {};
    const premissa = await guardarPremissa(db, req.user!.id, {
      item,
      operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
      vidaUtilMeses: numeroDoCorpo(corpo.vidaUtilMeses),
      unidadesPorAtivo: numeroDoCorpo(corpo.unidadesPorAtivo),
      margemAlvo: politica.margemAlvo ?? null,
      margemMinima: politica.margemMinima ?? null,
      justificativa:
        typeof corpo.justificativa === "string"
          ? corpo.justificativa.trim() || null
          : null,
    });
    res.json(premissa);
  },
);

export default router;
