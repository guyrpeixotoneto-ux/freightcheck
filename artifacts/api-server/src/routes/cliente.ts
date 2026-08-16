import { Router, type IRouter, type Response } from "express";
import { db } from "@workspace/db";
import { ContextNotFoundError, type SeriesContext } from "@workspace/comparison";
import { getRecomendacoesAoCliente } from "@workspace/advisory";

/**
 * Cliente — a quarta aba de Alterações.
 *
 * As três anteriores respondem *o que mudou* por três caminhos. Esta responde a
 * pergunta seguinte, que é a única que vira reunião: **do que mudou, o que faz
 * sentido pedir ao cliente que ajuste no Freightec?**
 *
 * Rota própria, e não mais um endpoint em `impacto.ts`, pela mesma razão que
 * separa `tickets.ts`: a leitura é outra. Aqui não há tabela por vigência nem
 * ranking de alterações — há uma decisão, parâmetro a parâmetro, entre propor,
 * investigar, não propor e não conseguir calcular, com o motivo escrito em cada
 * caso.
 *
 * **Nada nesta rota calcula.** Ela chama `@workspace/advisory`, que compõe
 * `getPanoramaDeAlteracoes` com o comportamento econômico declarado em
 * `@workspace/knowledge`. É a mesma exigência de autoridade única que
 * `coverage.ts` e `dre.ts` já respeitam, e ela morre no dia em que alguém somar
 * um campo aqui dentro.
 */
const router: IRouter = Router();

/**
 * O contexto pedido na query, quando pedido.
 *
 * Cópia deliberada da leitura de `impacto.ts` e `changes.ts`: as quatro abas
 * têm de enxergar a mesma unidade e o mesmo canal quando a pessoa troca de
 * aba. `?canal=` vazio quer dizer "as vigências sem canal legível no rótulo",
 * que é uma partição real e não a ausência de filtro.
 */
function parseContext(
  query: Record<string, unknown>,
): Partial<SeriesContext> | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== ""
      ? query.scopeHash
      : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

/** Recusa escrita vira 404 com a frase; o resto continua sendo 500. */
function sendContextError(res: Response, err: unknown): boolean {
  if (err instanceof ContextNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

/**
 * O que recomendamos discutir com o cliente.
 *
 * `entityType` chega da tela e é conferido lá dentro contra o que o contexto
 * entregou — um equipamento que nunca veio cai na leitura da frota inteira em
 * vez de virar erro. A resposta **diz** o que escolheu (`entityType`,
 * `entityTypes`) para que o padrão nunca seja uma escolha silenciosa.
 *
 * Vem inteira, sem paginar, pela mesma razão das outras duas leituras desta
 * tela: são algumas dezenas de linhas, e um "há mais" no rodapé transformaria
 * "isto é o que temos a discutir" numa afirmação falsa.
 */
router.get("/cliente/recomendacoes", async (req, res): Promise<void> => {
  try {
    const query = req.query as Record<string, unknown>;
    const entityType =
      typeof query.entityType === "string" && query.entityType !== ""
        ? query.entityType
        : undefined;

    const recomendacoes = await getRecomendacoesAoCliente(db, {
      entityType,
      context: parseContext(query),
    });

    if (!recomendacoes) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }
    res.json(recomendacoes);
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building client recommendations");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
