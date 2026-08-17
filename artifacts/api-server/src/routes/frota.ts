import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  chamadosPorAtivo,
  getConsolidated,
  latestTicketImport,
  listarFrota,
  situacaoPorAtivo,
  type ChamadosDoAtivo,
  type SeriesContext,
  type SituacaoDoAtivo,
} from "@workspace/comparison";
import { getVisaoDeFrota, TIPOS_COM_REGRA } from "@workspace/composition";
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
 * Unidade e canal, sem o recorte de vigências.
 *
 * `parseContext` de `lib/contexto` lê os dois — ele serve as abas que leem
 * séries inteiras. O panorama lê **uma** vigência, e um `de`/`ate` herdado de
 * um link estreitaria a série por baixo de cards que falam de um mês só.
 */
function parseEscopoDoContexto(
  query: Record<string, unknown>,
): Partial<SeriesContext> | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== ""
      ? query.scopeHash
      : undefined;
  // `?canal=` vazio quer dizer "as vigências sem canal legível no rótulo", que
  // é uma partição real e não a ausência de filtro.
  const temCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !temCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(temCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

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

/**
 * O panorama da frota — um card por ativo, com a situação inteira dele.
 *
 * É a porta de Cavalo 360° e Carreta 360°: em vez de abrir na lista de
 * alterações de todos os cavalos, a tela abre na **frota**, e cada cavalo é um
 * card que responde três perguntas de uma vez — quanto ele custa, o que mudou
 * nele, e o que pedimos por chamado.
 *
 * **Esta rota não calcula nada, e a regra vale literalmente.** Cada número vem
 * da autoridade dele, nomeada aqui no lugar em que é chamada:
 *
 * - a remuneração mensal, a variação e o farol vêm de `@workspace/composition`
 *   — a mesma `getVisaoDeFrota` que a tela de Composição lê, e não uma soma
 *   nova. Dois lugares somando a remuneração de uma placa é o número que um dia
 *   diverge, e a Composição já escreve no próprio cabeçalho que a linha da
 *   lista e a ficha são o mesmo cálculo;
 * - a contagem de alterações e a maior delas vêm de `situacaoPorAtivo`, com a
 *   mesma régua de materialidade da lista para onde o card leva;
 * - a contagem de chamados vem de `chamadosPorAtivo`, do envio mais recente.
 *
 * O que a rota faz é **juntar por placa** — nada mais. No dia em que precisar
 * de uma conta própria, ela deixa de ser uma rota e vira uma biblioteca, como
 * `advisory` fez.
 *
 * **A placa é a chave da junção, e ela tem um buraco declarado:** um ativo sem
 * identificador corrente entra na lista com `plate: null` e sem contagens. Ele
 * aparece mesmo assim — some-lo faria o total dos cards não fechar com o da
 * frota, e a ausência de placa é exatamente o tipo de coisa que uma tela de
 * auditoria não pode esconder.
 *
 * As três leituras não se somam entre si, pela mesma razão que as abas de
 * Alterações não se somam: o que a planilha mexeu e o que o chamado pediu são
 * duas contas com réguas diferentes. O card as põe lado a lado, nunca juntas.
 */
router.get("/frota/panorama", async (req, res): Promise<void> => {
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
    if (!TIPOS_COM_REGRA.includes(entityType)) {
      res.status(400).json({
        error:
          `Não há regra de remuneração declarada para "${entityType}", então não ` +
          `há o que mostrar por ativo. Tipos disponíveis: ${TIPOS_COM_REGRA.join(", ")}.`,
      });
      return;
    }

    /*
      Unidade e canal, e **não** o De/Até.

      `parseContext` lê os dois recortes porque as abas de Impacto e Cliente
      leem séries; aqui a leitura é de uma vigência só — a que a Composição
      apurou —, e um `de`/`ate` chegando de um link antigo estreitaria a série
      debaixo de um card que fala de um mês. Os cards mostram o período no
      cabeçalho, e é esse período que `period` escolhe.
    */
    const contexto = parseEscopoDoContexto(query);
    const periodo =
      typeof query.period === "string" && query.period !== ""
        ? query.period
        : undefined;

    const visao = await getVisaoDeFrota(db, entityType, {
      ...(periodo !== undefined ? { period: periodo } : {}),
      ...(contexto !== undefined ? { context: contexto } : {}),
      filtros: {},
    });
    if (!visao) {
      res.status(404).json({ error: "Nenhuma vigência importada ainda." });
      return;
    }

    /*
      A comparação é a do período que a Composição está mostrando, e não a mais
      recente do banco: o card diz "R$ 3.324 em agosto" e "3 alterações", e as
      duas frases têm de ser do mesmo mês. Pedir a comparação por conta própria
      abriria a porta para um card que mistura dois períodos sem dizer.
    */
    const consolidado = await getConsolidated(db, visao.effectiveDate, contexto);
    const alteracoes = consolidado
      ? await situacaoPorAtivo(db, consolidado.changeSetIds, { entityType })
      : new Map<string, SituacaoDoAtivo>();

    /*
      Os chamados são do envio mais recente, e **não** têm recorte de período: o
      export da fila é uma população própria, sem vigência nem unidade — é a
      mesma recusa que `paramsDeAlteracoes` escreve para a aba Chamados. O card
      diz de que envio veio a contagem, para que ninguém a leia como "chamados
      de agosto".
    */
    const envio = await latestTicketImport(db).catch(() => null);
    const chamados = envio
      ? await chamadosPorAtivo(db, envio.id, { entityType }).catch(
          () => new Map<string, ChamadosDoAtivo>(),
        )
      : new Map<string, ChamadosDoAtivo>();

    const ativos = visao.linhas.map((linha) => {
      const placa = linha.placa;
      const mudou = placa === null ? undefined : alteracoes.get(placa);
      const pedidos = placa === null ? undefined : chamados.get(placa);
      return {
        ...linha,
        alteracoes: mudou?.alteracoes ?? 0,
        maiorAlteracao: mudou?.maior ?? null,
        chamados: pedidos?.chamados ?? 0,
        alteracoesDeChamado: pedidos?.alteracoes ?? 0,
      };
    });

    res.json({
      entityType,
      rotuloDoTipo: visao.rotuloDoTipo,
      context: visao.context,
      effectiveDate: visao.effectiveDate,
      periodLabel: visao.periodLabel,
      anterior: visao.anterior,
      vigencias: visao.vigencias,
      serieEntregue: visao.serieEntregue,
      resumo: visao.resumo,
      // De onde vem cada contagem, para o card poder dizê-lo em vez de deixar
      // quem lê supor que as três são do mesmo recorte. Elas não são.
      procedencia: {
        comparacao: consolidado
          ? { period: consolidado.period, completa: consolidado.complete }
          : null,
        envioDeChamados: envio
          ? { id: envio.id, filename: envio.filename, receivedAt: envio.receivedAt }
          : null,
      },
      ativos,
    });
  } catch (err) {
    if (sendContextError(res, err)) return;
    req.log.error({ err }, "Error building fleet panorama");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
