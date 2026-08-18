import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { getRecomendacoesAoCliente } from "@workspace/advisory";
import { parseContext } from "../lib/contexto";

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
 * O que recomendamos discutir com o cliente.
 *
 * O contexto — unidade, canal e o recorte `de`/`ate` — é lido pelo mesmo
 * `parseContext` que a rota de Impacto usa, e resolvido pela mesma autoridade.
 * É o que garante que trocar de aba não troque o período debaixo dos números.
 *
 * `entityType` chega da tela e é conferido lá dentro contra o que o contexto
 * entregou — um equipamento que nunca veio cai na leitura da frota inteira em
 * vez de virar erro. A resposta **diz** o que escolheu (`entityType`,
 * `entityTypes`) para que o padrão nunca seja uma escolha silenciosa.
 *
 * `placa` chega das telas 360° e obedece à mesma regra, com um alcance menor de
 * propósito: ela decide **quais parâmetros entram na lista** — os que se moveram
 * naquele ativo —, e não recalcula nada. O alcance e o impacto de cada item
 * continuam sendo os da frota, porque é a abrangência que sustenta o pedido ao
 * cliente. A resposta devolve `placa` resolvida, ou `null` quando o recorte não
 * a tem.
 *
 * Vem inteira, sem paginar, pela mesma razão das outras duas leituras desta
 * tela: são algumas dezenas de linhas, e um "há mais" no rodapé transformaria
 * "isto é o que temos a discutir" numa afirmação falsa.
 */
router.get("/cliente/recomendacoes", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const texto = (valor: unknown): string | undefined =>
    typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined;

  const recomendacoes = await getRecomendacoesAoCliente(db, {
    entityType: texto(query.entityType),
    placa: texto(query.placa),
    context: parseContext(query),
  });

  if (!recomendacoes) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(recomendacoes);
});

export default router;
