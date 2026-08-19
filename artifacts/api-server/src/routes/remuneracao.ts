import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import type { RequestedContext } from "@workspace/comparison";
import {
  lerCadastroDaUnidade,
  lerComparacaoDeCadastros,
  lerSituacaoDasUnidades,
  listarUnidades,
} from "@workspace/remuneracao";

/**
 * Remuneração — o cadastro da planilha, por unidade.
 *
 * Quatro rotas, e cada uma é uma pergunta inteira:
 *
 * - `/remuneracao/unidades` — quem tem cadastro a mostrar. É a mesma lista de
 *   `/contexts`, e existe separada porque o módulo pergunta pela **unidade**,
 *   não pelo contexto de comparação: quem abre a tela escolhe "CAMAÇARI ·
 *   EMPURRADA", e a palavra "contexto" é vocabulário do motor, não de quem
 *   opera.
 * - `/remuneracao/situacao` — as mesmas unidades, cada uma com **o que o
 *   cadastro dela alcança** na vigência mais recente. É a tela que vem antes do
 *   cadastro, e é rota separada de `/unidades` de propósito: aquela é o seletor
 *   e tem de ser barata, esta monta o cadastro de todas as unidades e custa o
 *   que custa. Juntá-las faria o seletor da tela de detalhe pagar a conta da
 *   lista toda vez que alguém troca de unidade.
 * - `/remuneracao/cadastro` — as trinta linhas da aba para uma unidade numa
 *   vigência, cada uma com o número e a procedência, ou com o motivo de não ter
 *   número.
 * - `/remuneracao/comparacao` — as mesmas trinta linhas em **duas quinzenas
 *   lado a lado**, que é a forma da planilha: a aba traz os dois blocos um ao
 *   lado do outro, e quem confere lê as duas colunas juntas.
 *
 * **Nada aqui calcula.** A aritmética inteira mora em `@workspace/remuneracao`,
 * testada sem banco e sem HTTP, como a do Fechamento. Este arquivo lê a query,
 * chama e devolve.
 *
 * **Por que a rota não vive sob `/fechamento`.** Porque o cadastro não é de uma
 * competência: ele é da unidade, numa vigência, e é lido pelo acervo da
 * Auditoria. A tela que o abre é do Fechamento — é lá que ele serve —, mas
 * pendurá-lo no prefixo do outro ambiente diria que ele nasce de uma quinzena
 * fechada, e ele nasce do que a Ambev contratou.
 */
const router: IRouter = Router();

const SEM_ACERVO =
  "Nenhuma unidade entregou vigência ainda — sem export importado, não há cadastro a montar.";

/** Mesma convenção das demais rotas — ver `routes/qlp.ts`. */
function parseContext(query: Record<string, unknown>): RequestedContext | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== "" ? query.scopeHash : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

/**
 * As unidades que têm cadastro.
 *
 * Devolve o contexto inteiro — `scopeHash`, canal, rótulo e vigências — porque
 * é com ele que a tela monta os dois seletores sem uma segunda ida ao servidor,
 * e porque as vigências oferecidas têm de ser exatamente as que aquela unidade
 * entregou. Um seletor com opções que a unidade não tem é um convite a um 404.
 */
router.get("/remuneracao/unidades", async (_req, res): Promise<void> => {
  const unidades = await listarUnidades(db);
  res.json(
    unidades.map((u) => ({
      scopeHash: u.scopeHash,
      canal: u.channel,
      label: u.label,
      scopes: u.scopes,
      vigenciaMaisRecente: u.latestPeriod,
      vigencias: u.periodosDisponiveis,
    })),
  );
});

/**
 * A situação do cadastro em cada unidade.
 *
 * A pergunta que vem antes de "qual é o cadastro desta unidade": **quais
 * unidades já têm cadastro de pé, e quais ainda não têm.** Devolve, por
 * unidade, a vigência mais recente, o que ela entregou e quantas das trinta
 * linhas têm lastro — mais o estado em uma palavra, que é o que a tela destaca.
 *
 * Sem parâmetros: a pergunta é sobre o conjunto, e recortá-lo por unidade seria
 * pedir a lista de uma unidade só. Acervo vazio devolve lista vazia com resumo
 * zerado, e não 404 — não há nada pedido que possa não existir, e a tela sabe
 * escrever "nenhuma unidade entregou vigência ainda" a partir do zero.
 */
router.get("/remuneracao/situacao", async (_req, res): Promise<void> => {
  res.json(await lerSituacaoDasUnidades(db));
});

/**
 * O cadastro de uma unidade numa vigência.
 *
 * Sem `scopeHash`, a unidade mais recente do acervo; sem `period`, a vigência
 * mais recente dela — e a resposta **diz qual escolheu**, para que escolher por
 * padrão nunca seja escolher em silêncio.
 *
 * As recusas nomeadas do domínio (`ContextNotFoundError`,
 * `VigenciaDoCadastroNaoEncontrada`) sobem sem `try/catch`: quem as traduz em
 * 404 é `lib/recusa-de-dominio.ts`, e capturá-las aqui só faria o que não fosse
 * recusa perder o `code` e o `requestId` no caminho.
 */
router.get("/remuneracao/cadastro", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const period = typeof query.period === "string" && query.period !== "" ? query.period : undefined;

  const cadastro = await lerCadastroDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
  });

  if (!cadastro) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(cadastro);
});

/**
 * Duas quinzenas da mesma unidade, lado a lado.
 *
 * Sem `de` e `ate`, as duas vigências mais recentes — o par que a planilha do
 * mês corrente mostra. As duas pontas saem ordenadas em ordem cronológica pelo
 * domínio, e não na ordem em que chegaram: ver `lerComparacaoDeCadastros`.
 *
 * `ComparacaoSemDuasVigencias` sobe daqui como recusa nomeada e vira 422 em
 * `lib/recusa-de-dominio.ts` — a unidade existe, o cadastro dela existe, o que
 * não existe é o par.
 */
router.get("/remuneracao/comparacao", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const de = typeof query.de === "string" && query.de !== "" ? query.de : undefined;
  const ate = typeof query.ate === "string" && query.ate !== "" ? query.ate : undefined;

  const comparacao = await lerComparacaoDeCadastros(db, {
    ...(contexto ?? {}),
    ...(de !== undefined ? { de } : {}),
    ...(ate !== undefined ? { ate } : {}),
  });

  if (!comparacao) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(comparacao);
});

export default router;
