import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { listarFrota } from "@workspace/comparison";
import { parseContext, sendContextError } from "../lib/contexto";

/**
 * Frota — quem existe, antes de perguntar o que mudou.
 *
 * É o que Cavalo 360° e Carreta 360° precisam para oferecer a escolha de uma
 * placa, e é a única leitura destas telas que não sai de nenhuma das quatro
 * abas de Alterações. A razão está em `lib/comparison/src/ativos.ts`, e é a
 * mesma que fez a aba Impacto existir: uma lista de alterações só conhece o
 * ativo que mudou, e um seletor montado a partir dela ofereceria uma frota
 * menor do que a real.
 *
 * Rota própria, e não um campo em `/impacto/quinzenas`: o seletor é do
 * cabeçalho da tela e vale para as quatro abas, inclusive as que nunca leem a
 * matriz. Pendurá-lo numa delas faria a escolha de placa depender de uma
 * consulta que a aba Chamados não tem motivo para fazer.
 */
const router: IRouter = Router();

/**
 * A frota de um equipamento no contexto pedido.
 *
 * `entityType` é obrigatório, ao contrário do resto desta família de rotas: as
 * telas 360° são de um equipamento por definição — o menu tem uma entrada para
 * cada —, e um padrão silencioso aqui abriria Carreta 360° com a frota de
 * cavalos. A resposta traz `entityTypes` junto para que a tela possa dizer que
 * o equipamento pedido não foi entregue neste contexto, em vez de mostrar uma
 * lista vazia.
 *
 * Vem inteira, sem paginar, como as outras leituras destas telas: uma frota
 * real deste export são 64 cavalos ou 80 carretas, e um seletor com "há mais"
 * no rodapé é um seletor em que a placa procurada pode não estar.
 */
router.get("/frota/ativos", async (req, res): Promise<void> => {
  try {
    const query = req.query as Record<string, unknown>;
    const entityType =
      typeof query.entityType === "string" && query.entityType.trim() !== ""
        ? query.entityType.trim()
        : null;

    if (entityType === null) {
      res.status(400).json({ error: "Informe o equipamento em entityType." });
      return;
    }

    const frota = await listarFrota(db, {
      entityType,
      context: parseContext(query),
    });

    if (!frota) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(frota);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error listing fleet assets");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
