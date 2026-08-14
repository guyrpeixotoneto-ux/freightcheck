import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  acharConversa,
  arquivarConversa,
  criarConversa,
  gravarTurno,
  guardarEstado,
  listarConversas,
  mensagensDaConversa,
  renomearConversa,
  tituloDe,
} from "../lib/conversas";
import {
  desserializarEstado,
  iaDisponivel,
  modeloConfigurado,
  responder,
  serializarEstado,
  sugestoes,
  TRECHOS,
  type EstadoDaConversa,
} from "@workspace/assistant";

/**
 * Assistente — a superfície HTTP, e o portão do dono.
 *
 * As rotas não sabem consultar conversa: elas pedem a `lib/conversas`, que é
 * onde vive o filtro do dono e a regra de que excluir é arquivar. Aqui ficam só
 * as decisões de HTTP — o que é 400, o que é 404, o que volta no corpo.
 */
const router: IRouter = Router();

const LIMITE_DA_PERGUNTA = 1000;

// ── Capacidades e sugestões ─────────────────────────────────────────────────

router.get("/assistant/capabilities", (_req, res) => {
  res.json({
    ia: iaDisponivel(),
    modelo: modeloConfigurado(),
    trechos: TRECHOS.length,
    corpora: {
      catalogo: TRECHOS.filter((t) => t.corpus === "CATALOGO").length,
      book: TRECHOS.filter((t) => t.corpus === "BOOK_INDICE").length,
      artigos: TRECHOS.filter((t) => t.corpus === "ARTIGO").length,
    },
  });
});

router.get("/assistant/suggestions", (_req, res) => {
  res.json({ sugestoes: sugestoes() });
});

// ── Conversas ───────────────────────────────────────────────────────────────

router.get("/assistant/conversations", async (req, res): Promise<void> => {
  try {
    res.json(await listarConversas(db, req.user!.id));
  } catch (err) {
    req.log.error({ err }, "Error listing conversations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/assistant/conversations/:id", async (req, res): Promise<void> => {
  try {
    const conversa = await acharConversa(db, req.user!.id, req.params.id);
    if (!conversa) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }
    res.json({ conversa, mensagens: await mensagensDaConversa(db, conversa.id) });
  } catch (err) {
    req.log.error({ err }, "Error loading conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/assistant/conversations/:id", async (req, res): Promise<void> => {
  try {
    const titulo = (req.body?.title ?? "").toString().trim();
    if (!titulo) {
      res.status(400).json({ error: "Escreva o novo título." });
      return;
    }
    const atualizada = await renomearConversa(db, req.user!.id, req.params.id, titulo);
    if (!atualizada) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }
    res.json(atualizada);
  } catch (err) {
    req.log.error({ err }, "Error renaming conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** Excluir arquiva. Nenhuma linha é apagada. */
router.post("/assistant/conversations/:id/archive", async (req, res): Promise<void> => {
  try {
    const arquivada = await arquivarConversa(db, req.user!.id, req.params.id);
    if (!arquivada) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }
    res.json({ archived: true, id: arquivada.id });
  } catch (err) {
    req.log.error({ err }, "Error archiving conversation");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Perguntar ───────────────────────────────────────────────────────────────

router.post("/assistant/ask", async (req, res): Promise<void> => {
  try {
    const { pergunta, conversationId, scopeHash, canal, period, semIa } =
      (req.body ?? {}) as Record<string, unknown>;

    if (typeof pergunta !== "string" || pergunta.trim().length === 0) {
      res.status(400).json({ error: "Escreva a pergunta." });
      return;
    }
    if (pergunta.length > LIMITE_DA_PERGUNTA) {
      res.status(413).json({
        error: `A pergunta passou de ${LIMITE_DA_PERGUNTA} caracteres. Divida em duas.`,
      });
      return;
    }

    // ---- a conversa, e o estado que ela carrega ----------------------------
    let conversa = null;
    let estado: EstadoDaConversa | null = null;

    if (typeof conversationId === "string" && conversationId) {
      const achada = await acharConversa(db, req.user!.id, conversationId);
      if (!achada) {
        res.status(404).json({ error: "Conversa não encontrada." });
        return;
      }
      conversa = achada;
      estado = desserializarEstado(achada.state);
    }

    const resposta = await responder(db, pergunta, {
      recorte: {
        ...(typeof scopeHash === "string" ? { scopeHash } : {}),
        ...(typeof canal === "string" ? { channel: canal } : {}),
        ...(typeof period === "string" ? { period } : {}),
      },
      estado,
      semIa: semIa === true,
    });

    // ---- persistência ------------------------------------------------------
    const estadoNovo = serializarEstado(resposta.estado) as object;
    if (!conversa) {
      conversa = await criarConversa(db, req.user!.id, tituloDe(pergunta), estadoNovo);
    } else {
      await guardarEstado(db, conversa.id, estadoNovo);
    }

    await gravarTurno(db, conversa.id, pergunta, {
      texto: resposta.texto,
      redacao: resposta.redacao,
      evidencia: {
        fontes: resposta.fontes,
        lacunas: resposta.lacunas,
        recorte: resposta.recorte,
        intencao: resposta.intencao,
      },
    });

    res.json({ ...resposta, conversationId: conversa.id, conversationTitle: conversa.title });
  } catch (err) {
    req.log.error({ err }, "Error answering assistant question");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
