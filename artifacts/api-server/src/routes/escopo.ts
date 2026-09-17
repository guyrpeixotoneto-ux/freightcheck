import { Router, type IRouter } from "express";
import { escopoEfetivo } from "../lib/escopo-efetivo";
import { observacoes, relatorioDeEscopo } from "../middlewares/escopo-em-observacao";

/**
 * A janela para o modo de observação da ACL por unidade.
 *
 * Duas leituras, para a mesma decisão: **dá para ligar o corte, e o que falta
 * antes?**
 *
 * · `GET /escopo/meu` — que unidades esta sessão alcança, calculado agora. É a
 *   resposta a "por que não estou vendo tal unidade?" depois que o corte
 *   existir, e hoje é o jeito de conferir que o cálculo bate com o cadastro.
 * · `GET /escopo/observacao` — o relatório por rota e por conta: quantas
 *   requisições seriam recusadas, reduzidas ou não classificáveis, e quantas
 *   contas ainda não têm concessão nenhuma.
 *
 * **Sem escrita.** Conceder e revogar acesso é ato administrativo, mora na tela
 * de Permissões e passa pelo portão como qualquer escrita de Configurações.
 * Este arquivo só mostra.
 */
const router: IRouter = Router();

router.get("/escopo/meu", async (req, res): Promise<void> => {
  try {
    const escopo = await escopoEfetivo(req.user!.id);
    res.json({
      unidades: escopo.unidadesPermitidas.length,
      unidadesPermitidas: escopo.unidadesPermitidas,
      /*
        Os ids das unidades saem; os `scope_hash`, só contados. O primeiro é o
        que a tela precisa para explicar o alcance; o segundo é chave de acervo,
        e publicar a lista inteira daria a quem lê exatamente o vocabulário para
        montar o pedido que o corte existe para recusar.
      */
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
  res.json({ ...relatorioDeEscopo(), amostra: observacoes(limite) });
});

export default router;
