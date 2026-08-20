import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import type { RequestedContext } from "@workspace/comparison";
import {
  copiarPlanilhaDaUnidade,
  gravarPlanilhaDaUnidade,
  lerCadastroDaUnidade,
  lerComparacaoDeCadastros,
  lerPlanilhaDaUnidade,
  lerSituacaoDasUnidades,
  listarUnidades,
  LinhaDaPlanilhaInvalida,
  PlanilhaVazia,
} from "@workspace/remuneracao";

/**
 * Remuneração — o cadastro da planilha, por unidade.
 *
 * Cinco endereços, e cada um é uma pergunta inteira:
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
 * - `/remuneracao/planilha` — a metade que **não** sai do acervo: o que alguém
 *   digitou da aba de Excel. `GET` lê, `PUT` grava a vigência inteira, e
 *   `/copia` repete numa vigência o que já foi digitado noutra. O que entra por
 *   aqui volta no cadastro marcado como `INFORMADO`, com autor e data — nunca
 *   como apurado, e nunca por cima de um número que o acervo sustente.
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
 * O mesmo contexto, lido de um **corpo JSON** em vez da query.
 *
 * A diferença é uma só e ela decide em qual série a escrita cai: JSON sabe
 * dizer `null`, e uma query não. Na query, a série sem canal se pede com
 * `canal=` — a string vazia —, porque omitir o parâmetro significa "qualquer
 * canal" e o servidor escolhe o primeiro. No corpo, `"canal": null` é a mesma
 * coisa dita direto, e é o que a tela manda: ela carrega o canal do contexto
 * que leu, que é `null` nas séries sem canal.
 *
 * Reaproveitar `parseContext` aqui trataria esse `null` como "não disse", e uma
 * unidade que tenha uma série com canal e outra sem no mesmo `scopeHash`
 * receberia a planilha na série errada — sem erro nenhum, e sem nada na tela
 * que dissesse onde ela foi parar.
 */
function parseContextoDoCorpo(corpo: Record<string, unknown>): RequestedContext | undefined {
  const scopeHash =
    typeof corpo.scopeHash === "string" && corpo.scopeHash !== "" ? corpo.scopeHash : undefined;
  const temCanal =
    "canal" in corpo && (typeof corpo.canal === "string" || corpo.canal === null);
  if (scopeHash === undefined && !temCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(temCanal ? { channel: corpo.canal === "" ? null : (corpo.canal as string | null) } : {}),
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

/**
 * O que alguém digitou da aba de Excel, para uma unidade numa vigência.
 *
 * A tela de cadastro monta o formulário a partir de `/remuneracao/cadastro`,
 * que já devolve o declarado dentro de cada linha — este `GET` existe para
 * quem precisa só da planilha: a conferência de quem preencheu o quê, e o
 * "copiar da anterior", que pergunta o que a outra vigência tem antes de
 * oferecer o botão.
 *
 * Planilha nunca preenchida devolve `linhas: []`, e não 404. Quem cadastra pela
 * primeira vez está exatamente nesse estado, e um 404 ali diria que a unidade
 * não existe.
 */
router.get("/remuneracao/planilha", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const period = typeof query.period === "string" && query.period !== "" ? query.period : undefined;

  const planilha = await lerPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

/**
 * Grava a planilha informada de uma vigência — o "Salvar" da tela de cadastro.
 *
 * **`PUT` e não `POST`** porque o alvo é um recurso nomeado pelo pedido — a
 * planilha daquela unidade naquela vigência —, e mandar o mesmo corpo duas
 * vezes deixa o mesmo estado. `POST` prometeria criar uma segunda planilha da
 * mesma quinzena, que é justamente o que o índice único impede.
 *
 * **O corpo é um `merge`, e não a planilha inteira.** As chaves ausentes ficam
 * como estavam; `valor: null` apaga a linha. É o que permite salvar o bloco que
 * se está editando sem apagar os outros oito — ver `gravarPlanilha`.
 *
 * O autor sai da sessão, e nunca do corpo: um campo "informado por" que a tela
 * preenchesse sustentaria apenas "alguém digitou esse nome". É a mesma razão
 * pela qual `app_user` existe (ver `schema/auth.ts`).
 */
router.put("/remuneracao/planilha", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const contexto = parseContextoDoCorpo(corpo);
  const period = typeof corpo?.period === "string" && corpo.period !== "" ? corpo.period : undefined;

  if (!Array.isArray(corpo?.celulas)) {
    res.status(400).json({
      error:
        "celulas é obrigatório e precisa ser uma lista — cada item com a chave da linha e o " +
        "valor. Para apagar uma linha, mande-a com valor nulo.",
    });
    return;
  }

  const planilha = await gravarPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
    celulas: corpo.celulas as { chave: unknown; valor: unknown; observacao?: unknown }[],
    autor: { id: req.user?.id ?? null, nome: req.user?.name ?? null },
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

/**
 * Copia a planilha de uma vigência para outra, na mesma unidade.
 *
 * Existe porque a alternativa é redigitar trinta linhas por quinzena, e a maior
 * parte delas não muda — na própria aba de Excel os dois blocos repetem as
 * alíquotas e a frota. O que ela **não** é: herança automática. É um ato, com
 * autor e data de quem o pediu, e não sobrescreve o que a vigência de destino
 * já tem — ver `copiarPlanilha`.
 *
 * `POST` e não `PUT`: o mesmo pedido repetido não deixa o mesmo estado. A
 * segunda cópia não faz nada, porque a primeira já preencheu — e é o
 * comportamento certo, mas não é idempotência de recurso.
 */
router.post("/remuneracao/planilha/copia", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const contexto = parseContextoDoCorpo(corpo);
  const de = typeof corpo?.de === "string" ? corpo.de : "";
  const para = typeof corpo?.para === "string" ? corpo.para : "";

  if (de === "" || para === "") {
    res.status(400).json({
      error:
        "de e para são obrigatórios — copiar é dizer de qual vigência para qual, e as duas " +
        "precisam ser vigências desta unidade.",
    });
    return;
  }
  if (de === para) {
    res.status(400).json({
      error: "de e para são a mesma vigência. Copiar uma planilha para ela mesma não faz nada.",
    });
    return;
  }

  const planilha = await copiarPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    de,
    para,
    autor: { id: req.user?.id ?? null, nome: req.user?.name ?? null },
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

export default router;
