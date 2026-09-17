import { Router, type IRouter } from "express";
import { escopoEfetivo } from "../lib/escopo-efetivo";
import { observacoes, relatorioDeEscopo } from "../middlewares/escopo-em-observacao";

/**
 * A janela para o modo de observação da ACL por empresa e unidade.
 *
 * Duas leituras, e as duas existem para a mesma decisão: **dá para ligar o
 * corte, e por onde começar?**
 *
 * · `GET /escopo/meu` — o que esta sessão alcança, calculado agora. É a
 *   resposta a "por que não estou vendo tal unidade?" depois que o corte
 *   existir, e hoje é o jeito de conferir que o cálculo bate com o cadastro.
 * · `GET /escopo/observacao` — o relatório agregado por rota: quantas
 *   requisições seriam recusadas, reduzidas ou não classificáveis.
 *
 * **Sem escrita.** Conceder e revogar acesso a unidade é ato administrativo,
 * mora na tela de Permissões e passa pelo portão como qualquer outra escrita de
 * Configurações. Este arquivo só mostra.
 *
 * A medição é da janela desde a última partida do processo — o anel vive em
 * memória, pela mesma razão do resto da telemetria deste produto — e o campo
 * `desde` diz isso em vez de deixar quem lê supor que é histórico.
 */
const router: IRouter = Router();

router.get("/escopo/meu", async (req, res): Promise<void> => {
  try {
    const escopo = await escopoEfetivo(req.user!.id);
    res.json({
      empresaId: escopo.empresaId,
      unidades: escopo.unidadesPermitidas.length,
      /*
        Os ids das unidades saem; os `scope_hash`, só contados. O primeiro é o
        que a tela precisa para explicar o alcance; o segundo é chave de acervo,
        e publicar a lista inteira de hashes daria a quem lê exatamente o
        vocabulário para montar um pedido que o corte existe para recusar.
      */
      unidadesPermitidas: escopo.unidadesPermitidas,
      porFallback: escopo.porFallback,
      scopeHashesPermitidos: escopo.scopeHashesPermitidos.length,
      hashesSemUnidade: escopo.hashesSemUnidade.length,
    });
  } catch (err) {
    req.log.error({ err, requestId: req.id }, "Falha ao calcular o escopo efetivo");
    res.status(500).json({ error: "Não foi possível calcular o escopo desta sessão." });
  }
});

router.get("/escopo/observacao", (req, res) => {
  const pedido = Number(req.query.limite);
  const limite = Number.isFinite(pedido) ? Math.min(Math.max(pedido, 1), 1000) : 200;
  res.json({
    ...relatorioDeEscopo(),
    amostra: observacoes(limite),
  });
});

export default router;
