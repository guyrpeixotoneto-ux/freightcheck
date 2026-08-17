import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  getExportacaoDeImpacto,
  getPanoramaDeAlteracoes,
  getQuinzenaMatrix,
  type CorteDaExportacao,
} from "@workspace/comparison";
import { parseContext, sendContextError } from "../lib/contexto";
import {
  agoraEmBrasilia,
  montarPlanilhaDeImpacto,
  nomeDoArquivo,
} from "../lib/planilha-impacto";
import { contentDisposition } from "./book";

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
      // A placa das telas 360°. Conferida lá dentro contra a frota do
      // equipamento, e ecoada em `plate` na resposta — uma placa que este
      // contexto não tem cai na frota inteira em vez de virar erro, e a tela
      // precisa saber que foi isso que aconteceu.
      plate: str("placa"),
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

/**
 * O corte de classe pedido, conferido contra os três que existem.
 *
 * Um valor desconhecido cai em "tudo" em vez de virar erro: a mesma recusa a
 * transformar escolha inválida em 400 que `entityType` e `placa` já praticam na
 * matriz — e aqui o custo de errar seria pior, porque o arquivo já baixou.
 */
export function parseCorte(valor: unknown): CorteDaExportacao {
  if (valor === "FIXO" || valor === "VARIAVEL" || valor === "SEM_CLASSE") return valor;
  return "TUDO";
}

/**
 * A aba inteira em Excel: um índice e uma aba por parâmetro que mudou.
 *
 * É a mesma leitura das duas rotas acima, montada de uma vez: o panorama decide
 * quais parâmetros entram — com o recorte De/Até e o corte de classe da tela —, e
 * cada um vira a matriz por placa e vigência que o segundo nível mostra. Existe
 * porque a alternativa, para quem confere o mês fora do produto, é abrir trinta e
 * cinco parâmetros um a um e copiar cada tabela à mão.
 *
 * **A única rota desta API que não responde JSON no caminho de sucesso.** O
 * contrato de `middlewares/contrato-json.ts` continua valendo para tudo o que dá
 * errado — 400, 404 e 500 saem como JSON, e é assim que a tela consegue mostrar
 * o motivo em vez de baixar um arquivo com uma mensagem de erro dentro.
 */
router.get("/impacto/exportacao.xlsx", async (req, res): Promise<void> => {
  try {
    const query = req.query as Record<string, unknown>;
    const exportacao = await getExportacaoDeImpacto(db, {
      classe: parseCorte(query.classe),
      context: parseContext(query),
    });

    if (!exportacao) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    /*
      Nada mudou no recorte é uma resposta, e ela não pode virar um arquivo com
      um índice vazio: quem baixasse teria de conferir aba por aba para descobrir
      que não havia nenhuma. A tela já sabe dizer isso em uma linha.
    */
    if (exportacao.abas.length === 0) {
      res.status(404).json({
        error:
          "Nenhum parâmetro mudou de valor neste recorte — não há aba para exportar.",
      });
      return;
    }

    const bytes = montarPlanilhaDeImpacto(exportacao, agoraEmBrasilia(new Date()));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", contentDisposition(nomeDoArquivo(exportacao)));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building impact workbook");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
