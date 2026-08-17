import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  acharConversa,
  arquivarConversa,
  CONVERSA_SEM_ASSUNTO,
  criarConversa,
  gravarTurno,
  guardarEstado,
  listarConversas,
  mensagensDaConversa,
  registrarFeedback,
  renomearConversa,
  tituloDe,
} from "../lib/conversas";
import {
  agenteParaUsuario,
  desserializarEstado,
  eventosRecentes,
  iaDisponivel,
  modeloConfigurado,
  responder,
  resumoDaIa,
  serializarEstado,
  sugestoes,
  TRECHOS,
  type EstadoDaConversa,
  type TurnoAnterior,
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

/**
 * A falha que se pode rastrear até a linha que a causou.
 *
 * `{ "error": "Internal server error" }` era uma constante: a mesma frase para
 * o banco fora, para uma coluna que falta e para um defeito de código. Quem
 * está na tela lê a frase, quem opera lê o log, e não havia nada ligando as
 * duas leituras — com várias pessoas usando o produto, "deu erro às 14h" não
 * seleciona uma linha entre as centenas daquele minuto.
 *
 * `requestId` é o que liga. É o mesmo `req.id` que o `pino-http` carimba em
 * toda linha desta requisição, e sai também no corpo do erro; o stack completo
 * fica só no log, que é onde ele não vira superfície de ataque. O `code` existe
 * para a interface poder distinguir esta falha das recusas que ela já trata.
 */
const CODIGO_FALHA = "ASSISTENTE_FALHOU";

function falhou(
  req: Request,
  res: Response,
  err: unknown,
  contexto: string,
): void {
  req.log.error({ err, requestId: req.id }, contexto);
  res.status(500).json({
    error: "O Assistente falhou ao responder. Nada foi gravado por esta chamada.",
    code: CODIGO_FALHA,
    requestId: req.id,
  });
}

// ── Capacidades e sugestões ─────────────────────────────────────────────────

router.get("/assistant/capabilities", (req, res) => {
  res.json({
    ia: iaDisponivel(),
    modelo: modeloConfigurado(),
    /*
      Qual cérebro responde **a quem está perguntando**.

      Sem isto, quem testa não tem como saber se está avaliando o agente ou o
      planejador: as duas respostas chegam pela mesma rota, com a mesma cara, e
      a diferença mora numa variável de ambiente do servidor. Uma avaliação de
      experiência feita sobre o caminho errado é pior do que nenhuma — ela
      produz opinião confiante sobre a coisa que não estava em teste.
    */
    cerebro: agenteParaUsuario(req.user?.id) ? "AGENTE" : "PLANEJADOR",
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

/**
 * O que as últimas chamadas ao modelo custaram — e o que aconteceu com elas.
 *
 * `capabilities` responde se há chave; esta rota responde o que aconteceu
 * **depois** dela. A diferença é a pergunta que ficou sem resposta por um dia:
 * uma tela em `redação: DETERMINISTICA` com `ia: true` pode ser resposta
 * descartada pela trava de lastro, recusa do classificador ou erro de chamada,
 * e as três exigem ações opostas. O anel já media as três dentro do processo, e
 * nada as expunha.
 *
 * `limite` corta a lista de eventos; o resumo é sempre sobre o anel inteiro.
 * O anel vive em memória e some no restart, o que é o comportamento desejado:
 * ele responde "como está agora", não "como estava em março".
 */
router.get("/assistant/usage", (req, res) => {
  const pedido = Number(req.query.limite);
  const limite = Number.isFinite(pedido) ? Math.min(Math.max(pedido, 1), 200) : 50;
  res.json({
    ia: iaDisponivel(),
    modelo: modeloConfigurado(),
    resumo: resumoDaIa(),
    eventos: eventosRecentes(limite),
  });
});

// ── Conversas ───────────────────────────────────────────────────────────────

router.get("/assistant/conversations", async (req, res): Promise<void> => {
  try {
    res.json(await listarConversas(db, req.user!.id));
  } catch (err) {
    falhou(req, res, err, "Falha ao listar as conversas do Assistente");
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
    falhou(req, res, err, "Falha ao carregar uma conversa do Assistente");
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
    falhou(req, res, err, "Falha ao renomear uma conversa do Assistente");
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
    falhou(req, res, err, "Falha ao arquivar uma conversa do Assistente");
  }
});

/**
 * O voto de quem leu.
 *
 * `feedback: null` desfaz — um clique errado se corrige clicando de novo, e não
 * há por que exigir uma rota diferente para isso.
 */
router.post(
  "/assistant/conversations/:id/messages/:messageId/feedback",
  async (req, res): Promise<void> => {
    try {
      const { feedback, nota } = (req.body ?? {}) as Record<string, unknown>;
      if (feedback !== null && feedback !== "UTIL" && feedback !== "NAO_UTIL") {
        res.status(400).json({ error: "Voto inválido." });
        return;
      }

      const linha = await registrarFeedback(
        db,
        req.user!.id,
        req.params.id,
        req.params.messageId,
        feedback,
        typeof nota === "string" ? nota.slice(0, 1000) : null,
      );
      if (!linha) {
        res.status(404).json({ error: "Mensagem não encontrada." });
        return;
      }
      res.json(linha);
    } catch (err) {
      falhou(req, res, err, "Falha ao registrar o voto numa resposta do Assistente");
    }
  },
);

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

    // ---- a conversa, o estado e os turnos que ela carrega -------------------
    let conversa = null;
    let estado: EstadoDaConversa | null = null;
    let historico: TurnoAnterior[] = [];

    if (typeof conversationId === "string" && conversationId) {
      const achada = await acharConversa(db, req.user!.id, conversationId);
      if (!achada) {
        res.status(404).json({ error: "Conversa não encontrada." });
        return;
      }
      conversa = achada;
      estado = desserializarEstado(achada.state);
      /*
        Os turnos anteriores vão ao modelo junto com a pergunta.

        O estado (`state`) diz sobre o que se falava — parâmetro, período,
        recorte — e é o que faz "e julho?" funcionar sem modelo nenhum. O que
        ele não carrega é o que foi *dito*, e sem isso "explica melhor" chegava
        ao modelo como uma primeira pergunta sobre nada. O banco já guarda os
        turnos para a tela reabrir a conversa; aqui eles passam a servir também
        de contexto. Quantos entram é decisão da camada de linguagem, que é
        quem paga por eles.
      */
      historico = (await mensagensDaConversa(db, achada.id)).map((m) => ({
        papel: m.role === "PERGUNTA" ? ("PERGUNTA" as const) : ("RESPOSTA" as const),
        texto: m.content,
      }));
    }

    /*
      Quando a tela pede eventos, as etapas saem no instante em que acontecem.

      A alternativa era o que a tela fazia antes: animar uma lista fixa por
      tempo enquanto a requisição corria. Ela anunciava "calculando impacto" em
      pergunta conceitual que nunca calcula impacto — progresso inventado, numa
      aplicação cuja regra é não exibir o que não se pode sustentar. Aqui cada
      linha que aparece é uma etapa que a orquestração executou de fato.

      O texto sai pelo mesmo canal, em `texto`, à medida que é escrito — e só
      depois de a trava de lastro conferir a frase. Por isso a tela pode
      renderizar o que chega sem ressalva: o que passou por aqui já é
      conferível. O evento `resposta` continua carregando o texto que vale, e é
      ele que a tela adota no fim — se a conferência final descartar a redação
      do modelo, o que a pessoa leu é substituído pela redação em código, que
      responde a mesma pergunta com o mesmo material.

      O corpo final é o mesmo JSON da resposta comum, no último evento: quem
      não pede `text/event-stream` continua recebendo um POST e um objeto.
    */
    const emEventos = req.get("accept")?.includes("text/event-stream") ?? false;
    if (emEventos) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        // Sem isto um proxy que faça buffer entrega tudo junto no fim, e o
        // streaming vira um POST lento com passos que ninguém viu.
        "x-accel-buffering": "no",
      });
    }
    const emitir = (evento: string, dados: unknown) => {
      if (!emEventos) return;
      res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    };

    const resposta = await responder(db, pergunta, {
      /*
        A flag por usuário, e não só a global.

        Avaliar a experiência exige usar o produto; usar o produto com a flag
        global desligada é usar o assistente antigo. `agenteParaUsuario` deixa
        ligar para quem está testando sem trocar o que todo mundo vê — e o
        rollback é tirar o id da lista, valendo no pedido seguinte.
      */
      agente: agenteParaUsuario(req.user?.id),
      recorte: {
        ...(typeof scopeHash === "string" ? { scopeHash } : {}),
        ...(typeof canal === "string" ? { channel: canal } : {}),
        ...(typeof period === "string" ? { period } : {}),
      },
      estado,
      semIa: semIa === true,
      ...(historico.length > 0 ? { historico } : {}),
      ...(emEventos
        ? {
            aoAvancar: (etapa) => emitir("etapa", etapa),
            aoTexto: (pedaco) => emitir("texto", { pedaco }),
          }
        : {}),
    });

    // ---- persistência ------------------------------------------------------
    const estadoNovo = serializarEstado(resposta.estado) as object;

    /*
      O título é o assunto, e ele pode chegar depois.

      Quem abre a tela costuma cumprimentar antes de perguntar, e o título
      nascia dessa primeira linha: a barra lateral acumulava conversas chamadas
      "ola". Agora a conversa nasce sem nome quando não há assunto, e a primeira
      pergunta de verdade a batiza — com o bloco do Book ou a gaveta de que ela
      falou, que é como quem procura depois vai lembrar dela.
    */
    const titulo = tituloDe(pergunta, {
      bloco: resposta.estado.blocoDoBook,
      parametro: resposta.estado.parametro,
    });

    if (!conversa) {
      conversa = await criarConversa(
        db,
        req.user!.id,
        titulo ?? CONVERSA_SEM_ASSUNTO,
        estadoNovo,
      );
    } else {
      await guardarEstado(db, conversa.id, estadoNovo);
      if (titulo && conversa.title === CONVERSA_SEM_ASSUNTO) {
        const renomeada = await renomearConversa(db, req.user!.id, conversa.id, titulo);
        if (renomeada) conversa = renomeada;
      }
    }

    const gravado = await gravarTurno(db, conversa.id, pergunta, {
      texto: resposta.texto,
      redacao: resposta.redacao,
      evidencia: {
        fontes: resposta.fontes,
        lacunas: resposta.lacunas,
        recorte: resposta.recorte,
        intencao: resposta.intencao,
      },
    });

    const corpo = {
      ...resposta,
      conversationId: conversa.id,
      conversationTitle: conversa.title,
      messageId: gravado.respostaId,
    };

    if (emEventos) {
      emitir("resposta", corpo);
      res.end();
      return;
    }
    res.json(corpo);
  } catch (err) {
    /*
      Num stream o cabeçalho já foi enviado e não há status para trocar: o erro
      vira o último evento, e a tela o mostra como mostraria qualquer falha.

      **É por isso que um 500 nesta rota diz onde o defeito não está.** Quando a
      tela pede `text/event-stream`, o `200` sai antes de a orquestração
      começar: daí em diante nenhuma falha desta rota pode virar 500 — ela vira
      este evento. Um `500` observado no navegador para esta chamada é,
      portanto, prova de que a requisição não chegou até aqui, ou de que o
      processo não sobreviveu para respondê-la.
    */
    if (res.headersSent) {
      req.log.error({ err, requestId: req.id }, "Falha no meio do stream do Assistente");
      res.write(
        `event: erro\ndata: ${JSON.stringify({
          error: "O Assistente falhou ao responder.",
          code: CODIGO_FALHA,
          requestId: req.id,
        })}\n\n`,
      );
      res.end();
      return;
    }
    falhou(req, res, err, "Falha ao responder uma pergunta ao Assistente");
  }
});

export default router;
