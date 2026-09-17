import { Router, type IRouter } from "express";
import { escopoEfetivo } from "../lib/escopo-efetivo";
import { observacoes, relatorioDeEscopo } from "../middlewares/escopo-em-observacao";
import { somenteAdmin } from "./users";

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
 *
 * ---------------------------------------------------------------------------
 * As duas têm plateias diferentes, e isso decide quem entra
 * ---------------------------------------------------------------------------
 *
 * `/escopo/meu` responde **sobre quem pergunta**: que unidades esta sessão
 * alcança. Não há o que restringir — a conta perguntando por si mesma é o caso
 * de uso, e esconder isso dela só produziria "não estou vendo tal unidade" sem
 * resposta.
 *
 * `/escopo/observacao` é outra coisa: ela devolve o mapa de autorização da
 * casa — que contas existem, quantas unidades cada uma alcança, quem está sem
 * concessão nenhuma e por quais rotas isso aparece. É material de
 * administração, e entregá-lo a qualquer sessão seria dar a quem quer
 * atravessar a fronteira exatamente o mapa dela: quem tem pouco acesso, quais
 * rotas ainda não recusam, e onde a curadoria está frouxa.
 *
 * **O portão não cobre isto, e é por isso que a restrição está escrita aqui.**
 * `middlewares/portao-de-permissao.ts` recusa `POST`, `PUT`, `PATCH` e
 * `DELETE`; leitura ele deixa passar de propósito, porque as telas compartilham
 * endpoints. Uma rota `GET` que precisa de administrador precisa dizê-lo no
 * próprio handler — é o mesmo `somenteAdmin` que `routes/users.ts` usa, pela
 * mesma razão e com a mesma frase.
 */
const router: IRouter = Router();

/*
  Sem `try`/`catch`: o 5xx é do contrato, e não desta rota.

  `middlewares/contrato-json.ts` é a autoridade única que classifica banco fora,
  defeito nosso e coluna que falta — cada um com o seu diagnóstico. Um `catch`
  aqui devolveria a mesma frase para os três, que é exatamente a forma que
  `__tests__/o-contrato-cobre-todas-as-rotas.test.ts` existe para não deixar
  voltar. Foi ele que pegou este arquivo na primeira escrita.
*/
router.get("/escopo/meu", async (req, res): Promise<void> => {
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
});

router.get("/escopo/observacao", (req, res) => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }

  const pedido = Number(req.query.limite);
  const limite = Number.isFinite(pedido) ? Math.min(Math.max(pedido, 1), 1000) : 200;
  res.json({ ...relatorioDeEscopo(), amostra: observacoes(limite) });
});

export default router;
