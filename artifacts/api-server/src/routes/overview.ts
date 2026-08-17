import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ContextNotFoundError,
  getOverview,
  type SeriesContext,
} from "@workspace/comparison";

/**
 * A Visão geral — o que o sistema já sabe, num número por pergunta.
 *
 * Nada aqui prevê nem anualiza. A página existe para que os itens do menu
 * pudessem ser abertos com honestidade, em vez de meramente destravados.
 *
 * ---------------------------------------------------------------------------
 * O que saiu daqui, e por quê
 * ---------------------------------------------------------------------------
 *
 * Este arquivo continha uma **segunda implementação inteira do pipeline de
 * importação**: `POST /imports` recebia o arquivo em base64 e o encaminhava
 * para `receiveFile`/`captureRaw`/`stage`/`preview`, e
 * `POST /imports/:id/promote` promovia o run — escrevendo na camada canônica.
 * Ao lado delas, três leituras (`GET /imports`, `GET /imports/:id`,
 * `GET /imports/:id/status`) devolviam os mesmos recursos de `imports.ts` com
 * formato diferente.
 *
 * Nada disso jamais respondeu a um pedido. `routes/index.ts` monta
 * `importsRouter` **antes** de `overviewRouter`, e o Express entrega ao
 * primeiro que casa — de modo que as cinco rotas eram alcançáveis apenas por
 * uma reordenação daquele arquivo. Era essa a única coisa que as separava de
 * uma segunda porta de entrada em produção, e ela era mais fraca do que a
 * porta de verdade em cinco pontos:
 *
 *   - não conferia se `contentBase64` era base64 (o `Buffer.from` descarta em
 *     silêncio o que não reconhece e entrega um zip truncado);
 *   - não conferia a assinatura `PK` do `.xlsx`;
 *   - gravava o arquivo em `tmpdir()`, que não sobrevive ao próximo deploy, em
 *     vez de `ensureImportStorageDir()` com o nome sendo o próprio sha256;
 *   - registrava `"upload"` como quem enviou, e não a sessão;
 *   - devolvia `err.message` cru para a tela, em vez de classificar a falha
 *     entre schema atrasado (503), recusa de regra (422) e defeito (500);
 *   - e pedia `onExistingSnapshot: "REJECT"`, que **não é um valor que o
 *     pipeline conheça** — os dois aceitos são `"FAIL"` e `"NEW_REVISION"`.
 *
 * A regra que este arquivo passa a respeitar está escrita em
 * `docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte A: **dado operacional que
 * alimenta o canônico entra por duas portas, Importações e Chamados.** Não
 * existe terceira, nem adormecida.
 *
 * A regra não depende mais de ninguém se lembrar dela:
 * `fronteira-de-ingestao.test.ts` falha se um segundo lugar registrar
 * `POST /imports` ou `POST /imports/:id/promote`, se qualquer par (método,
 * caminho) for registrado duas vezes, ou se um arquivo fora do caminho
 * autorizado passar a escrever nas tabelas do núcleo canônico.
 *
 * Nenhuma funcionalidade de leitura se perdeu na remoção: as três rotas de
 * leitura que saíram são as mesmas que `imports.ts` serve — e serve melhor,
 * com validação de identificador e com 503 em vez de 500 quando o banco está
 * atrás do repositório.
 */
const router: IRouter = Router();

/**
 * O contexto pedido na query, quando pedido.
 *
 * Nada pedido é o **censo** — todas as unidades, todos os canais —, e não "a
 * unidade mais recente". As duas coisas são respostas legítimas a perguntas
 * diferentes, e o Painel faz a primeira.
 */
function parseContext(query: Record<string, unknown>): Partial<SeriesContext> | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== ""
      ? query.scopeHash
      : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    // `?canal=` vazio quer dizer "as vigências sem canal legível", que é uma
    // partição real e não a ausência de filtro.
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

router.get("/overview", async (req, res): Promise<void> => {
  try {
    const contexto = parseContext(req.query as Record<string, unknown>);
    res.json(await getOverview(db, contexto));
  } catch (err) {
    // Contexto pedido que não existe é 404 com a frase, e não 500: o pedido
    // está errado, o servidor não.
    if (err instanceof ContextNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Error building overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
