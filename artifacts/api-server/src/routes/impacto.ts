import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { getPanoramaDeAlteracoes, getQuinzenaMatrix } from "@workspace/comparison";
import { parseContext, sendContextError } from "../lib/contexto";

/**
 * Impacto — a terceira aba de Alterações.
 *
 * As outras duas partem da alteração e chegam ao dinheiro: a Planilha compara
 * duas vigências, o Chamado compara o pedido com o que voltou. Esta parte do
 * dinheiro e deixa a alteração aparecer como a diferença entre duas colunas —
 * **quanto cada ativo custa em cada quinzena**, que é a pergunta de quem
 * confere o mês e a única que nenhuma lista de alterações responde: o ativo que
 * não mexeu não está em lista nenhuma, e sem ele o total da coluna não fecha.
 *
 * Rota própria, e não mais um endpoint em `changes.ts`, pela mesma razão que
 * separa `tickets.ts`: a leitura é outra. Aqui não há `change_set`, não há
 * comparação gravada e não há impacto apurado — há o fato de cada vigência,
 * lido como ele foi importado. Nada nesta rota soma nada com as outras duas.
 */
const router: IRouter = Router();

/**
 * A tabela do impacto: um parâmetro, todos os ativos, todas as vigências.
 *
 * `entityType` e `attributeCode` chegam da tela e são conferidos lá dentro
 * contra o que o banco tem — um equipamento que este contexto nunca entregou, ou
 * um parâmetro que não existe, cai no padrão em vez de virar erro. A aba abre
 * antes de alguém escolher qualquer coisa, e a resposta **diz** o que escolheu:
 * `entityType`, `attribute` e `entityTypes` voltam junto para que o padrão nunca
 * seja uma escolha silenciosa.
 *
 * A resposta carrega a tabela inteira, sem paginar. É deliberado: uma frota real
 * deste export são 64 cavalos ou 80 carretas em nove colunas, e o total da
 * coluna só fecha com o que a Ambev pagou se todas as linhas estiverem lá. Uma
 * página de cem linhas com um rodapé dizendo "há mais" transformaria o subtotal
 * numa afirmação falsa.
 */
router.get("/impacto/quinzenas", async (req, res): Promise<void> => {
  try {
    const query = req.query as Record<string, unknown>;
    const str = (key: string) =>
      typeof query[key] === "string" && query[key] !== ""
        ? (query[key] as string)
        : undefined;

    const matriz = await getQuinzenaMatrix(db, {
      entityType: str("entityType"),
      attributeCode: str("attributeCode"),
      groupBy: str("groupBy"),
      context: parseContext(query),
    });

    if (!matriz) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(matriz);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building impact matrix");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Panorama — o primeiro nível da aba: tudo que mudou, antes de escolher o quê.
 *
 * Não recebe `entityType` de propósito. A pergunta "o que mudou?" não é por
 * equipamento — e a árvore econômica atravessa os dois: `carreta.finame` contém
 * `cavalo.finame_cavalo`, e um panorama por equipamento mostraria os dois como
 * duas alterações independentes, que é a dupla contagem que a leitura existe
 * para evitar.
 *
 * A resposta vem inteira, como a da matriz e pela mesma razão: são algumas
 * dezenas de parâmetros, e um "há mais" no rodapé transformaria "tudo que
 * mudou" numa afirmação falsa.
 */
router.get("/impacto/panorama", async (req, res): Promise<void> => {
  try {
    const panorama = await getPanoramaDeAlteracoes(db, {
      context: parseContext(req.query as Record<string, unknown>),
    });

    if (!panorama) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(panorama);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building change panorama");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
