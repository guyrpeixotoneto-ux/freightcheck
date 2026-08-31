import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CHAVES_PROTEGIDAS,
  definirModulosUniversais,
  historicoDosModulosUniversais,
  listarModulosDesligados,
  problemaDaChave,
} from "../lib/modulos-universais";

/**
 * Módulos universais — o que a casa liga e desliga para todo mundo.
 *
 * As outras duas telas de acesso decidem sobre gente: Permissões, sobre uma
 * conta; Papéis, sobre um grupo. Esta decide sobre a **instalação** — que
 * partes do produto ela usa. Chave desligada aqui sai do menu de todo mundo, e
 * nenhum papel e nenhuma exceção a devolvem (`lib/permissoes.ts`, onde as
 * camadas são somadas).
 *
 * Ler é aberto a quem tem sessão, como a lista de contas e a de papéis e pela
 * mesma razão: saber que partes do produto esta casa usa não é privilégio — e é
 * a resposta para "por que esta tela sumiu?", que qualquer pessoa faz. Mexer é
 * de administrador.
 *
 * A única recusa que existe aqui é a porta trancada por dentro: `/configuracoes`
 * não se desliga, porque é dentro dele que esta tela mora.
 */
const router: IRouter = Router();

router.get("/modulos-universais", async (_req, res): Promise<void> => {
  res.json({
    desligadas: await listarModulosDesligados(db),
    protegidas: CHAVES_PROTEGIDAS,
    historico: await historicoDosModulosUniversais(db),
  });
});

router.put("/modulos-universais", async (req, res): Promise<void> => {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({
      error:
        "Somente administradores ligam e desligam módulos da instalação. Peça a um administrador.",
    });
    return;
  }

  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const bruto = corpo.chaves;
  if (bruto === null || typeof bruto !== "object" || Array.isArray(bruto)) {
    res.status(400).json({
      error: "Envie `chaves` como um objeto de chave do módulo para ligado/desligado.",
    });
    return;
  }

  const chaves: Record<string, boolean> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor !== "boolean") {
      res.status(400).json({
        error: `O estado de ${chave} precisa ser verdadeiro (ligado) ou falso (desligado).`,
      });
      return;
    }
    /*
      A recusa da chave protegida é 409, e não 400: o pedido está bem formado —
      o que ele quer é que não pode ser feito. É a mesma distinção que `/users`
      faz entre "corpo inválido" e "isto trancaria a porta por dentro".
    */
    const problema = problemaDaChave(chave, valor);
    if (problema) {
      res.status(valor === false ? 409 : 400).json({ error: problema });
      return;
    }
    chaves[chave] = valor;
  }

  const desligadas = await definirModulosUniversais(db, {
    chaves,
    motivo: typeof corpo.motivo === "string" ? corpo.motivo : null,
    por: req.user.email,
  });

  req.log.info(
    { chaves, by: req.user.email },
    "Módulos universais alterados",
  );

  res.json({
    desligadas,
    protegidas: CHAVES_PROTEGIDAS,
    historico: await historicoDosModulosUniversais(db),
  });
});

export default router;
