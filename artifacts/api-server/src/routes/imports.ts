import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Response } from "express";
import { codigoDoPostgres, db } from "@workspace/db";
import {
  ImportDeletionRefused,
  PromocaoRecusada,
  captureRaw,
  deleteImportRun,
  ensureImportStorageDir,
  getImportRun,
  getImportRunSheets,
  getImportRunSnapshots,
  getImportRunStatus,
  listImportDeletions,
  listImportRuns,
  markRunFailed,
  planImportDeletion,
  preview,
  promote,
  receiveFile,
  stage,
} from "@workspace/ingest";
import { semearContrato } from "@workspace/coverage";
import { computeMissingChangeSets } from "@workspace/comparison";
import { faltaSchema, responderSchemaAusente } from "../lib/schema-ausente";

/**
 * Importações (F1) — receber um arquivo, contar o que saiu dele, e só então
 * deixar alguém aprovar.
 *
 * A ordem importa: nada aqui escreve na camada canônica exceto
 * POST /imports/:id/promote, e ele exige um run já conferido (PREVIEWED). Ler
 * o arquivo e promovê-lo são dois pedidos separados porque entre eles existe
 * uma decisão humana — é essa separação que o pipeline chama de preview.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quem enviou é quem está logado — toda rota daqui exige sessão.
 *
 * O nome vinha do corpo do pedido, o que fazia o histórico registrar o que o
 * cliente dissesse. Este padrão sobrou para o caso de a sessão não estar lá, o
 * que hoje o middleware impede; um `upload` no histórico é sinal de que alguém
 * abriu uma exceção no portão.
 */
const DEFAULT_ACTOR = "upload";

export type DecodedUpload = { filename: string; bytes: Buffer };

export type DecodeResult =
  { ok: true; value: DecodedUpload } | { ok: false; error: string };

/**
 * O corpo do upload, conferido antes de virar arquivo em disco.
 *
 * Cada recusa aqui existe porque a alternativa é pior: sem o filtro de base64,
 * `Buffer.from` descarta em silêncio o que não reconhece e entrega um zip
 * truncado; sem a assinatura "PK", um .xlsx que na verdade é um CSV renomeado
 * só falharia lá dentro do leitor, com uma mensagem sobre estrutura de zip que
 * não ajuda ninguém a entender que mandou o arquivo errado.
 */
export function decodeUpload(body: unknown): DecodeResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Envie um JSON com filename e contentBase64." };
  }
  const { filename, contentBase64 } = body as Record<string, unknown>;

  if (typeof filename !== "string" || filename.trim() === "") {
    return { ok: false, error: "filename é obrigatório." };
  }
  // basename: o nome vem do cliente e é gravado como veio. Um "../" dentro
  // dele nunca chega a tocar em caminho nenhum aqui, mas também não precisa
  // existir no registro.
  const safeName = path.basename(filename.trim());
  if (!safeName.toLowerCase().endsWith(".xlsx")) {
    return {
      ok: false,
      error: `Só lemos .xlsx, e "${safeName}" não é um. Exporte a planilha do Freightec nesse formato.`,
    };
  }

  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
    return { ok: false, error: "contentBase64 é obrigatório." };
  }
  const encoded = contentBase64.trim();
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    return { ok: false, error: "contentBase64 não está em base64 válido." };
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    return { ok: false, error: "O arquivo chegou vazio." };
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      ok: false,
      error: `"${safeName}" não é uma planilha do Excel: o conteúdo não começa como um arquivo .xlsx. Confira se o que foi enviado é mesmo o export, e não um CSV renomeado.`,
    };
  }

  return { ok: true, value: { filename: safeName, bytes } };
}

/**
 * Por que este run não pode ser aprovado agora.
 *
 * O pipeline recusa com a frase dele — "run X is PROMOTED; this step requires
 * PREVIEWED" —, que é exata e serve para quem depura. Na tela quem lê é quem
 * opera, e a pergunta que essa pessoa tem é outra: já entrou? deu errado?
 * ainda está lendo? Cada estado responde a uma delas.
 */
export function whyCannotPromote(status: string): string | null {
  switch (status) {
    case "PREVIEWED":
      return null;
    case "PENDING":
    case "READING":
    case "STAGED":
      return "O arquivo ainda está sendo lido. Espere o resumo aparecer antes de aprovar.";
    case "PROMOTING":
      return "Esta importação já está sendo aprovada neste momento.";
    case "PROMOTED":
      return "Esta importação já foi aprovada; os dados dela já estão no sistema.";
    case "FAILED":
      return "Esta importação falhou ao ser lida, então não há o que aprovar. Corrija a origem e envie o arquivo de novo.";
    case "SKIPPED_DUPLICATE":
      return "Este arquivo já foi recebido anteriormente. Nenhum dado foi importado novamente.";
    case "SKIPPED_DUPLICATE_DATA":
      return "O arquivo é diferente, mas os dados normalizados desta vigência são iguais aos já registrados. Nenhum dado foi duplicado.";
    case "VALIDATION_ERROR":
      return "Esta importação não pode ser aprovada: o dado não fecha. Veja o motivo na importação, corrija a origem e envie o arquivo de novo.";
    case "ABORTED":
      return "Esta importação foi abortada. Envie o arquivo de novo para recomeçar.";
    default:
      return `Esta importação está em ${status.toLowerCase()} e só pode ser aprovada depois de conferida.`;
  }
}

// ---------------------------------------------------------------------------
// A falha, classificada uma vez só
// ---------------------------------------------------------------------------
//
// O defeito que este bloco elimina foi visto na tela: aprovar uma planilha
// devolveu, em vermelho, `Failed query: INSERT INTO "snapshot_entity_type" …
// params: 1f10e1af-…`. Duas coisas se somaram para produzir isso.
//
// A primeira é que o drizzle não deixa o erro do `pg` subir cru: ele o embrulha
// num `DrizzleQueryError` cuja `message` é a consulta inteira com os
// parâmetros, e põe o erro de verdade — o que tem o SQLSTATE — em `cause`. A
// segunda é que a rota respondia `err.message` direto, e a tela imprime o que a
// API mandar.
//
// O resultado não era só feio. Era 422, que nesta rota significa "o dado não
// fecha: corrija a origem e reenvie" — e o que faltava era uma migration. A
// planilha estava perfeita, e a resposta mandava mexer nela.
//
// Aqui a classificação acontece **uma vez**, por SQLSTATE e nunca por texto, e
// tem três desfechos e só três. `faltaSchema` continua sendo a autoridade sobre
// o que é schema atrasado: este arquivo pergunta, não decide.

/** A frase de um desfecho que não se sabe explicar a quem opera. */
const FALHA_INESPERADA =
  "Não foi possível concluir a importação. Tente novamente ou verifique o " +
  "diagnóstico do sistema em /api/healthz.";

/**
 * O contexto que esta rota — e só ela — sabe sobre um schema ausente.
 *
 * Recomendação nenhuma sai daqui: o que resolve vem de `diagnosticar`, que é a
 * mesma autoridade que responde ao `/healthz`. Ver `lib/schema-ausente.ts`.
 */
const CONTEXTO_DE_SCHEMA =
  "Este banco não tem parte do schema que a importação grava: falta pelo menos " +
  "uma migration. Não é a sua planilha — a transação voltou atrás inteira, " +
  "nada foi importado e nada se perdeu.";

/**
 * O motivo gravado num run que falhou, quando a causa foi schema atrasado.
 *
 * Diferente de `CONTEXTO_DE_SCHEMA` num ponto: este texto vai para
 * `import_run.failure_reason` e é lido no card da importação meses depois,
 * **sem** o diagnóstico ao lado. Por isso ele aponta para onde o estado do
 * banco pode ser visto, em vez de deixar quem lê sem saída.
 */
const MOTIVO_DE_SCHEMA =
  "Este banco não tem parte do schema que a importação grava: falta pelo menos " +
  "uma migration. Não é o seu arquivo — nada foi gravado. O estado do banco " +
  "está em /api/healthz.";

/**
 * As marcas do que nunca é frase para quem opera.
 *
 * Esta lista **não classifica nada** — quem classifica é o SQLSTATE, logo
 * abaixo. Ela é a peneira final, no ponto em que um texto viraria resposta: uma
 * rede contra o dia em que uma mensagem de banco chegar por um caminho que
 * ninguém previu, embrulhada de um jeito sem `code`. Uma rede depois da
 * classificação é barata; uma heurística de texto *no lugar* dela seria frágil,
 * e é por isso que ela não está no lugar dela.
 */
const MARCAS_QUE_NAO_SAO_FRASE = [
  /failed query:/i, // o carimbo do drizzle
  /\bparams:/i, // os parâmetros que ele imprime junto
  /\binsert\s+into\b/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+"?[\w.]+"?\s+set\b/i,
  /\bselect\b[\s\S]*\bfrom\b/i,
  /\n\s+at\s+\S/, // um stack trace que virou mensagem
];

/** Este texto pode ser mostrado a quem opera? */
export function ehFraseParaQuemOpera(texto: string): boolean {
  return !MARCAS_QUE_NAO_SAO_FRASE.some((marca) => marca.test(texto));
}

/**
 * Os erros que o runtime levanta sozinho.
 *
 * Um `TypeError` não é recusa: é defeito nosso, e a frase dele fala de
 * `undefined` e de nome de variável. Separá-los **pela classe** é o que permite
 * manter inteira a frase das recusas que o pipeline escreve em português com
 * `new Error(...)` — a de equipamento novo, por exemplo — sem deixar passar a
 * de um bug. Fosse por texto, seria adivinhação.
 */
function ehDefeitoDoRuntime(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError ||
    err instanceof URIError ||
    err instanceof EvalError
  );
}

/**
 * O que fazer com um erro que subiu do pipeline. Três desfechos, e só três.
 *
 * - `SCHEMA`    — o banco está atrás do repositório. 503, com o diagnóstico.
 * - `REGRA`     — recusa escrita para quem opera. 422, com a frase inteira.
 * - `INESPERADO`— defeito nosso ou falha de banco. 500, com frase genérica.
 *
 * A ordem das perguntas é o desenho: o SQLSTATE decide primeiro, e ele é
 * procurado **dentro** do que o drizzle embrulhou (`codigoDoPostgres` percorre
 * a cadeia de `cause`). Só o que não veio do driver pode ser recusa de regra —
 * e é por isso que nenhuma consulta chega à tela.
 */
export type DesfechoDaFalha =
  | { tipo: "SCHEMA" }
  | { tipo: "REGRA"; mensagem: string }
  | { tipo: "INESPERADO" };

export function classificarFalhaDeImportacao(err: unknown): DesfechoDaFalha {
  if (faltaSchema(err)) return { tipo: "SCHEMA" };
  // Qualquer outro SQLSTATE é o banco falando, e o banco não fala com quem
  // opera. 23505, 23503, 40001 — todos viram frase genérica e log completo.
  if (codigoDoPostgres(err) !== undefined) return { tipo: "INESPERADO" };
  if (ehDefeitoDoRuntime(err)) return { tipo: "INESPERADO" };
  if (
    err instanceof Error &&
    err.message.trim() !== "" &&
    ehFraseParaQuemOpera(err.message)
  ) {
    return { tipo: "REGRA", mensagem: err.message };
  }
  return { tipo: "INESPERADO" };
}

/**
 * O motivo que fica gravado no run — e que a tela repete como está.
 *
 * `import_run.failure_reason` é campo de leitura humana: aparece no card da
 * importação, na lista e no histórico. O `err.message` de uma falha de banco
 * não serve ali, e ali é pior do que numa resposta HTTP: a resposta passa, o
 * campo fica.
 */
export function motivoGravavel(err: unknown): string {
  const desfecho = classificarFalhaDeImportacao(err);
  if (desfecho.tipo === "REGRA") return desfecho.mensagem;
  if (desfecho.tipo === "SCHEMA") return MOTIVO_DE_SCHEMA;
  return FALHA_INESPERADA;
}

/** O `req.log` reduzido ao que este arquivo usa. */
type Log = {
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
};

/**
 * O detalhe inteiro, onde ele pode estar: o log do servidor.
 *
 * Erro, `cause`, SQLSTATE e o que se estava fazendo. Nada disso atravessa para
 * o browser — e é justamente por o log guardar tudo que a resposta pode não
 * guardar nada.
 */
function registrarFalha(
  log: Log,
  err: unknown,
  operacao: string,
  importRunId?: string,
): void {
  log.error(
    {
      err,
      cause: (err as { cause?: unknown } | null)?.cause,
      pgCode: codigoDoPostgres(err),
      operacao,
      ...(importRunId ? { importRunId } : {}),
    },
    `Falha em ${operacao}`,
  );
}

/**
 * A falha de uma rota que escreve: 503 para schema, 422 para recusa, 500 para o
 * resto.
 */
async function responderFalhaDeEscrita(
  res: Response,
  log: Log,
  err: unknown,
  operacao: string,
  importRunId?: string,
): Promise<void> {
  registrarFalha(log, err, operacao, importRunId);
  const desfecho = classificarFalhaDeImportacao(err);
  if (desfecho.tipo === "SCHEMA") {
    await responderSchemaAusente(res, CONTEXTO_DE_SCHEMA);
    return;
  }
  if (desfecho.tipo === "REGRA") {
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }
  res.status(500).json({ error: FALHA_INESPERADA });
}

/**
 * A falha de uma rota que só lê.
 *
 * Sem o desfecho de 422: uma listagem não tem recusa de regra, então um `Error`
 * qualquer aqui é defeito, e defeito é 500. Schema atrasado continua sendo 503
 * — é o caso em que a tela de Importações abre vazia num banco desatualizado, e
 * a diferença entre "não há importações" e "este banco não sabe respondê-las".
 */
async function responderFalhaDeLeitura(
  res: Response,
  log: Log,
  err: unknown,
  operacao: string,
): Promise<void> {
  registrarFalha(log, err, operacao);
  if (faltaSchema(err)) {
    await responderSchemaAusente(res, CONTEXTO_DE_SCHEMA);
    return;
  }
  res.status(500).json({ error: FALHA_INESPERADA });
}

/**
 * Ler o arquivo até o preview, fora do ciclo da requisição.
 *
 * São dezenas de milhares de células: manter a conexão aberta até o fim daria
 * timeout no proxy antes de dar resposta. O cliente recebe o id na hora e
 * pergunta o estado por /status — e qualquer falha vira FAILED com motivo, em
 * vez de um run parado para sempre em READING.
 */
async function readInBackground(importRunId: string, log: Log): Promise<void> {
  try {
    await captureRaw(db, importRunId);
    await stage(db, importRunId);
    await preview(db, importRunId);
  } catch (err) {
    // O motivo é gravado, e gravado é para sempre: passa pela mesma
    // classificação da resposta, senão a consulta que o drizzle carimba na
    // frente do erro ficaria no card da importação até alguém excluí-la.
    const message = motivoGravavel(err);
    registrarFalha(log, err, "leitura do arquivo", importRunId);
    try {
      await markRunFailed(db, importRunId, message);
    } catch (markErr) {
      // Se nem isso foi possível, o banco é que está fora. O run fica no
      // estado em que parou; o log é o único lugar onde isso ainda pode ser
      // visto.
      log.error({ err: markErr, importRunId }, "Could not mark run as failed");
    }
  }
}

router.get("/imports", async (req, res): Promise<void> => {
  try {
    res.json(await listImportRuns(db));
  } catch (err) {
    await responderFalhaDeLeitura(res, req.log, err, "listagem de importações");
  }
});

router.post("/imports", async (req, res): Promise<void> => {
  const decoded = decodeUpload(req.body);
  if (!decoded.ok) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  try {
    const { filename, bytes } = decoded.value;
    // O nome em disco é o próprio sha256: dois envios do mesmo conteúdo
    // apontam para o mesmo arquivo, e nomes vindos do cliente nunca viram
    // caminho.
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const filePath = path.join(
      ensureImportStorageDir(),
      `${contentSha256}.xlsx`,
    );
    writeFileSync(filePath, bytes);

    const received = await receiveFile(db, {
      filePath,
      filename,
      receivedBy: req.user?.email ?? DEFAULT_ACTOR,
    });

    if (received.isDuplicate) {
      // A tentativa fica registrada como SKIPPED_DUPLICATE — recusar não é
      // esquecer. O motivo já foi escrito pelo pipeline, para quem opera.
      const run = await getImportRunStatus(db, received.importRunId);
      const padrao = `Este arquivo já havia sido recebido (sha256 ${contentSha256.slice(0, 16)}…).`;
      // O motivo vem do banco, e bancos guardam o que já foi gravado: runs
      // anteriores a esta correção podem ter uma consulta inteira no campo.
      const motivo =
        run?.failureReason && ehFraseParaQuemOpera(run.failureReason)
          ? run.failureReason
          : padrao;
      res.status(409).json({
        error: motivo,
        importRunId: received.importRunId,
      });
      return;
    }

    res.status(202).json({
      importRunId: received.importRunId,
      contentSha256: received.contentSha256,
      status: "PENDING",
    });

    void readInBackground(received.importRunId, req.log);
  } catch (err) {
    await responderFalhaDeEscrita(res, req.log, err, "recebimento do arquivo");
  }
});

router.get("/imports/:id/status", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const status = await getImportRunStatus(db, req.params.id);
    if (!status) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    res.json(status);
  } catch (err) {
    await responderFalhaDeLeitura(res, req.log, err, "estado da importação");
  }
});

router.get("/imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const run = await getImportRun(db, req.params.id);
    if (!run) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    const [sheets, snapshots] = await Promise.all([
      getImportRunSheets(db, req.params.id),
      getImportRunSnapshots(db, req.params.id),
    ]);
    res.json({ run, sheets, snapshots });
  } catch (err) {
    await responderFalhaDeLeitura(res, req.log, err, "detalhe da importação");
  }
});

router.post("/imports/:id/promote", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    // O estado é conferido antes para que a recusa mais comum — aprovar duas
    // vezes, com dois cliques ou duas abas — volte em português e como 409,
    // e não como a frase interna do pipeline dentro de um 422.
    const current = await getImportRunStatus(db, req.params.id);
    if (!current) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    const refusal = whyCannotPromote(current.status);
    if (refusal) {
      res.status(409).json({ error: refusal });
      return;
    }

    // Equipamento novo é declaração de quem promove, nunca efeito colateral de
    // um nome de aba: a lista chega do corpo do pedido, o pipeline recusa o
    // que não estiver nela, e o que sobra é a frase que a tela mostra.
    const confirmNewEntityTypes = Array.isArray(req.body?.confirmNewEntityTypes)
      ? (req.body.confirmNewEntityTypes as unknown[])
          .filter((t): t is string => typeof t === "string" && t.trim() !== "")
          .map((t) => t.trim().toUpperCase())
      : undefined;

    const result = await promote(db, req.params.id, {
      // Reimportar a mesma vigência é uma correção, e correção se declara:
      // o padrão recusa, e só quem pede NEW_REVISION escreve a revisão N+1.
      onExistingSnapshot:
        req.body?.onExistingSnapshot === "NEW_REVISION"
          ? "NEW_REVISION"
          : "FAIL",
      promotedBy: req.user?.email ?? DEFAULT_ACTOR,
      confirmNewEntityTypes,
    });

    /*
      O contrato de cobertura acompanha o dicionário.

      Uma promoção pode criar atributos que o dicionário não tinha, e o contrato
      declara expectativas por código de atributo. Semear aqui é idempotente
      (`ON CONFLICT DO NOTHING`) e nunca sobrescreve decisão de curadoria; sem
      isto, uma coluna nova ficaria fora da cobertura crítica até alguém chamar
      a rota de semeadura à mão.

      Fora do `try` da promoção não dá — ela já respondeu. Dentro dele, uma
      falha aqui não pode derrubar uma promoção que deu certo: o dado está
      gravado, e a expectativa é derivada e refazível.
    */
    try {
      await semearContrato(db);
    } catch (err) {
      req.log.warn(
        { err },
        "Contrato de cobertura não semeado após a promoção",
      );
    }

    /*
      Comparar é ato de importação — e não era ato de ninguém.

      `computeMissingChangeSets` existe desde sempre, a documentação dele diz
      que roda "após toda promoção" e o `computedBy` padrão dele é
      `api:after-import`. Nenhum lugar do produto o chamava. O efeito foi
      encontrado pela matriz de propagação: `getGroupedView` — a aba Planilha
      de Alterações — apenas **lê** os `change_set` que existem, e depois de
      uma importação não existia nenhum. A tela abria com "comparação ainda
      não calculada" em todas as séries, que é o dado tendo entrado e o módulo
      aparecendo vazio.

      Consolidado e `/changes/latest` calculavam sob demanda e mascaravam isso:
      quem abrisse aquelas telas primeiro fazia a Planilha funcionar. A
      propagação não pode depender da ordem em que alguém navega.

      Idempotente por construção — só calcula o par que falta —, e no mesmo
      `try` isolado do contrato, pelo mesmo motivo: a promoção já deu certo, e
      uma comparação que falha não pode desfazê-la. O que ela deixa é um
      `change_set` a menos, que a próxima leitura sob demanda refaz.
    */
    try {
      await computeMissingChangeSets(db);
    } catch (err) {
      req.log.warn(
        { err },
        "Comparações não calculadas após a promoção",
      );
    }

    res.json(result);
  } catch (err) {
    // Uma recusa **nomeada** é a única coisa que sai daqui com a frase inteira.
    // Ela é escrita pelo pipeline para quem opera, e o código HTTP separa as
    // duas que a tela trata diferente: 409 é "já existe uma versão ativa" — um
    // conflito que o operador resolve decidindo registrar uma correção, com o
    // run ainda aprovável. 422 é "o dado não fecha", e aí não há botão que
    // resolva: o caminho é corrigir a origem e reenviar. A transação já desfez
    // o que tinha começado.
    if (err instanceof PromocaoRecusada) {
      req.log.warn(
        { err, importRunId: req.params.id, decisao: err.decisao },
        "Promotion refused",
      );
      res.status(err.decisao === "VIGENCIA_ATIVA_EXISTENTE" ? 409 : 422).json({
        error: ehFraseParaQuemOpera(err.message)
          ? err.message
          : FALHA_INESPERADA,
        decisao: err.decisao,
        detalhe: err.detalhe,
      });
      return;
    }

    // Todo o resto passa pela classificação: schema atrasado vira 503 com o
    // diagnóstico do banco, e não um 422 que manda mexer numa planilha que está
    // certa. Era daqui que saía a consulta crua para a tela.
    await responderFalhaDeEscrita(
      res,
      req.log,
      err,
      "aprovação da importação",
      req.params.id,
    );
  }
});

/**
 * O que a exclusão tiraria, antes de tirar.
 *
 * A pergunta "tem certeza?" não é responsável por si só: quem está na tela não
 * tem como saber que aquele arquivo sustenta nove vigências e quarenta mil
 * fatos. Esta rota é o que transforma a confirmação numa decisão — e é a mesma
 * conta que a exclusão vai fazer, escrita uma vez só em `planImportDeletion`.
 */
router.get("/imports/:id/deletion", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const plan = await planImportDeletion(db, req.params.id);
    if (!plan) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }
    res.json(plan);
  } catch (err) {
    await responderFalhaDeLeitura(res, req.log, err, "plano de exclusão");
  }
});

/**
 * Excluir uma importação.
 *
 * Quem exclui é quem está logado, e o nome vai para `import_deletion` junto com
 * o que saiu — o registro sobrevive ao dado, que é a única forma de "isto foi
 * apagado" continuar sendo uma afirmação verificável depois.
 *
 * As recusas — um run ainda sendo lido, uma vigência corrigida por importação
 * posterior — voltam como 409 com a frase inteira. Não são erros do servidor:
 * são a ordem em que as coisas podem ser desfeitas.
 */
router.delete("/imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  try {
    const motivo =
      typeof req.body?.reason === "string" && req.body.reason.trim() !== ""
        ? req.body.reason.trim()
        : null;

    const result = await deleteImportRun(db, req.params.id, {
      deletedBy: req.user?.email ?? DEFAULT_ACTOR,
      reason: motivo,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof ImportDeletionRefused) {
      const notFound = err.message.includes("não encontrada");
      req.log.warn({ err, importRunId: req.params.id }, "Deletion refused");
      res.status(notFound ? 404 : 409).json({
        error: ehFraseParaQuemOpera(err.message)
          ? err.message
          : FALHA_INESPERADA,
      });
      return;
    }
    await responderFalhaDeEscrita(
      res,
      req.log,
      err,
      "exclusão da importação",
      req.params.id,
    );
  }
});

/** O histórico das exclusões — o que já não está mais aqui, e por ordem de quem. */
router.get("/import-deletions", async (req, res): Promise<void> => {
  try {
    res.json(await listImportDeletions(db));
  } catch (err) {
    await responderFalhaDeLeitura(res, req.log, err, "histórico de exclusões");
  }
});

export default router;
