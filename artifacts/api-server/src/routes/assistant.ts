import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  iaDisponivel,
  indiceDeConhecimento,
  modeloConfigurado,
  responder,
  sugestoes,
} from "@workspace/assistant";

/**
 * Assistente de IA — a superfície HTTP.
 *
 * Três rotas, e a divisão entre elas é intencional. `/ask` é a única que custa
 * alguma coisa: ela consulta o banco e, quando há modelo configurado, chama a
 * API de linguagem. `/capabilities` e `/suggestions` respondem de código puro,
 * para que a tela consiga se montar por inteiro — inclusive dizendo em que modo
 * está — antes de alguém digitar a primeira pergunta.
 *
 * **Nada aqui guarda conversa.** Cada pergunta é respondida do zero, a partir do
 * conhecimento registrado e do banco no instante da chamada. Não há histórico,
 * não há memória entre perguntas e não há sessão de chat. É uma limitação
 * assumida: memória entre turnos faria uma resposta depender de outra que já
 * saiu da tela, e a promessa deste assistente é que toda resposta se sustenta
 * sozinha, com as fontes ao lado.
 */
const router: IRouter = Router();

/** O limite existe porque um corpo enorme aqui não é pergunta — é outra coisa. */
const LIMITE_DA_PERGUNTA = 1000;

router.get("/assistant/capabilities", (_req, res) => {
  res.json({
    /*
      A tela diz em que modo está, e este é o campo que ela lê.

      Sem chave configurada o assistente continua respondendo: o material é o
      mesmo, e só a redação muda. Esconder essa diferença seria deixar a pessoa
      atribuir a um modelo um texto que saiu de um `join` de strings — ou o
      contrário, desconfiar de um texto que veio do conhecimento aprovado.
    */
    ia: iaDisponivel(),
    modelo: modeloConfigurado(),
    artigos: indiceDeConhecimento().length,
    areas: ["PARAMETROS", "BOOK", "CONCEITO", "LEITURA", "NAVEGACAO", "RECUSA"],
  });
});

router.get("/assistant/suggestions", (_req, res) => {
  res.json({ sugestoes: sugestoes(), indice: indiceDeConhecimento() });
});

router.post("/assistant/ask", async (req, res): Promise<void> => {
  try {
    const { pergunta, scopeHash, canal, period, semIa } = (req.body ?? {}) as {
      pergunta?: unknown;
      scopeHash?: unknown;
      canal?: unknown;
      period?: unknown;
      semIa?: unknown;
    };

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

    /*
      O recorte vem da tela, não de um palpite do servidor.

      Quem pergunta "quanto mudou" enquanto olha CAMAÇARI · EMPURRADA está
      perguntando sobre aquele recorte. Sem estes campos a resposta cairia no
      contexto mais recente do banco — que pode ser outro — e o número sairia
      certo para uma operação que não é a de quem perguntou.
    */
    const resposta = await responder(db, pergunta, {
      recorte: {
        scopeHash: typeof scopeHash === "string" ? scopeHash : undefined,
        channel: typeof canal === "string" ? canal : undefined,
        period: typeof period === "string" ? period : undefined,
      },
      semIa: semIa === true,
    });

    res.json(resposta);
  } catch (err) {
    req.log.error({ err }, "Error answering assistant question");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
