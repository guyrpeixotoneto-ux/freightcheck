import type {
  ErrorRequestHandler,
  Request,
  RequestHandler,
  Response,
} from "express";
import { erroDoPostgres } from "@workspace/db";
import {
  faltaSchema,
  regraDeMigrationPendente,
  responderSchemaAusente,
} from "../lib/schema-ausente";
import {
  bancoIndisponivel,
  responderBancoIndisponivel,
} from "../lib/banco-indisponivel";
import { statusDaRecusa } from "../lib/recusa-de-dominio";
import { ehFraseParaQuemOpera } from "../lib/classificar-falha";
import { alertar } from "../lib/alerta";

/**
 * O contrato desta API, sustentado pelo servidor — e não por cada rota.
 *
 * A interface toda foi escrita sobre uma promessa: **toda resposta daqui é
 * JSON, mesmo quando é erro.** Está dito por extenso em
 * `lib/transporte.ts`, do lado do navegador, e é dela que sai a
 * classificação do que deu errado: corpo que não é JSON significa "não foi a
 * nossa API que respondeu — foi um proxy, um roteador, uma página de erro do
 * ambiente", e manda quem investiga para a plataforma.
 *
 * O servidor não cumpria essa promessa. Ela era cumprida rota a rota, dentro
 * de um `try/catch` por handler, e **nada** cobria o que passa por fora deles:
 *
 *   - caminho que não casa com rota nenhuma → `text/html` com 404;
 *   - corpo JSON malformado, recusado pelo `express.json()` antes de qualquer
 *     rota → `text/html` com 400;
 *   - exceção lançada fora de um `try` (ou dentro do próprio `catch`) →
 *     `text/html` com 500, cujo `<pre>` diz `Internal Server Error`.
 *
 * Os três vêm do `finalhandler`, que o Express monta quando ninguém mais
 * respondeu. Ele é a resposta certa para um servidor genérico e a errada para
 * este: o corpo em HTML faz a tela concluir que a requisição nem chegou à API,
 * e manda procurar um processo derrubado que está de pé o tempo todo. Um erro
 * interno passa a se parecer com uma falha de infraestrutura — que é a
 * confusão mais cara que este repositório já pagou.
 *
 * Os dois handlers abaixo fecham a promessa no único lugar onde ela pode ser
 * fechada por inteiro: depois de todas as rotas, para tudo o que sobrou.
 */

/** O `code` que a interface lê quando não há rota para o caminho pedido. */
export const CODIGO_ROTA_DESCONHECIDA = "ROTA_DESCONHECIDA";

/** O `code` de qualquer falha não prevista — a que antes virava HTML. */
export const CODIGO_ERRO_INTERNO = "ERRO_INTERNO";

/**
 * O `code` do pedido que não pôde ser aceito como veio.
 *
 * Separado de `ERRO_INTERNO` porque as duas mandam fazer coisas opostas: uma é
 * "corrija o que você enviou", a outra é "não há o que você possa fazer daqui".
 * Responder as duas com o mesmo código faria a tela dar o mesmo conselho para
 * um JSON truncado e para um banco fora do ar.
 */
export const CODIGO_PEDIDO_INVALIDO = "PEDIDO_INVALIDO";

/**
 * O detalhe da exceção sai na resposta?
 *
 * Fora de produção, sim: quem está desenvolvendo tem o processo à mão e o
 * detalhe economiza uma ida ao log. Em produção é uma decisão explícita —
 * `API_ERRO_DETALHADO=1` —, porque mensagem de exceção carrega nome de tabela,
 * trecho de SQL e, às vezes, valor que veio do banco.
 *
 * **O que não depende da chave:** o `requestId`. Ele sai sempre, nas duas
 * pontas — na resposta e na linha de log —, e é o que permite a quem está na
 * tela dizer *qual* chamada falhou para quem consegue ler o log. Sem ele, "deu
 * 500" e "o log tem 400 linhas" são dois fatos que não se encontram.
 */
function podeDetalhar(): boolean {
  if (process.env["API_ERRO_DETALHADO"] === "1") return true;
  return process.env["NODE_ENV"] !== "production";
}

/**
 * O detalhe passa pela mesma peneira de toda mensagem que vira resposta.
 *
 * A chave decide **se** há detalhe; ela nunca decidiu **o quê**, e essa era a
 * brecha. `err.message` de um `DrizzleQueryError` é a consulta com os
 * parâmetros — `Failed query: INSERT INTO "snapshot_entity_type" … params: …` —
 * e ela saía inteira em qualquer ambiente que não fosse produção, além de sair
 * em produção para quem ligasse `API_ERRO_DETALHADO=1`.
 *
 * Enquanto cada rota respondia o seu próprio 500 com frase fixa, o detalhe não
 * alcançava as rotas que mexem em banco. Alcança agora que todas passam por
 * aqui — e a resposta certa não é desligar o detalhe, que é o que economiza uma
 * ida ao log num defeito nosso: é dizer o que dá para dizer sem carregar SQL.
 *
 * O que sobra quando o texto não passa é o que nunca foi sensível e é o que se
 * quer saber primeiro: **a classe do erro e o SQLSTATE**. A mensagem inteira
 * continua no log deste `requestId`, que é onde ela sempre esteve.
 */
function detalheDe(err: unknown): string | undefined {
  if (!podeDetalhar()) return undefined;
  const texto =
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (ehFraseParaQuemOpera(texto)) return texto;
  const nome = err instanceof Error ? err.name : "erro";
  const codigo = erroDoPostgres(err)?.code;
  return (
    `${nome}${codigo ? ` (SQLSTATE ${codigo})` : ""} — a mensagem carrega a ` +
    `consulta e ficou no log desta requisição.`
  );
}

/**
 * O status que o erro já trazia, quando ele é uma recusa e não uma falha.
 *
 * O `express.json()` rejeita corpo malformado (400), corpo grande demais (413)
 * e codificação que não sabe ler (415) lançando um erro com `status`. São
 * respostas a um pedido inválido, não defeitos do servidor: preservá-las é o
 * que faz a tela dizer "o que você mandou não serve" em vez de "o servidor
 * quebrou". Qualquer `status` de 5xx é ignorado — se foi falha nossa, o número
 * é 500 e a explicação está no log, não no erro que subiu.
 */
function statusDoParser(err: unknown): number | null {
  const candidato = (err as { status?: unknown; statusCode?: unknown } | null)
    ?.status;
  const alternativo = (err as { statusCode?: unknown } | null)?.statusCode;
  for (const valor of [candidato, alternativo]) {
    if (typeof valor === "number" && valor >= 400 && valor < 500) return valor;
  }
  return null;
}

/** A frase de cada recusa que o parser de corpo produz. */
function frasePara(status: number, err: unknown): string {
  const tipo = (err as { type?: unknown } | null)?.type;
  if (tipo === "entity.parse.failed") {
    return "O corpo do pedido não é JSON válido.";
  }
  if (tipo === "entity.too.large" || status === 413) {
    return "O corpo do pedido passou do tamanho aceito.";
  }
  if (tipo === "encoding.unsupported" || status === 415) {
    return "A codificação do corpo do pedido não é suportada.";
  }
  return "O pedido não pôde ser aceito como veio.";
}

/**
 * Nenhuma rota casou com este caminho.
 *
 * Montado depois de todas elas e **fora** do `/api`, porque este processo só
 * serve API: qualquer caminho que chegue aqui e não tenha rota é um engano de
 * quem chamou ou de quem encaminhou, e nos dois casos a resposta precisa ser
 * legível pela mesma função que lê todas as outras.
 */
export const rotaDesconhecida: RequestHandler = (req, res) => {
  res.status(404).json({
    error: `Não existe ${req.method} ${req.path} nesta API.`,
    code: CODIGO_ROTA_DESCONHECIDA,
    requestId: req.id,
  });
};

/** O `code` de uma recusa nomeada pelo domínio — ver `lib/recusa-de-dominio.ts`. */
export const CODIGO_RECUSA = "RECUSA";

/**
 * O contexto de um schema ausente que este handler — e só ele — sabe escrever.
 *
 * Uma rota que declarasse o seu próprio texto voltaria a precisar de um
 * `catch`, e é o `catch` que este arquivo existe para eliminar. O que sobra é o
 * que dá para dizer sem estar dentro da rota, e é honesto: **qual** pedido
 * parou e **com que SQLSTATE** o banco o recusou.
 *
 * Recomendação nenhuma sai daqui. O que houve com o banco, se há risco e o que
 * resolve vêm de `diagnosticar`, a mesma autoridade que responde ao `/healthz`
 * — ver `lib/schema-ausente.ts`. O SQLSTATE atravessa (é um código, não revela
 * nada) e a mensagem do driver não: ela carrega host, usuário e o trecho que
 * falhou, e vai só para o log deste `requestId`.
 */
function contextoDeSchemaAusente(req: Request, err: unknown): string {
  const codigo = erroDoPostgres(err)?.code;
  const doRouter = req.contextoDeSchema;
  const sqlstate = codigo ? ` O banco recusou com SQLSTATE ${codigo}.` : "";
  if (doRouter) return `${doRouter}${sqlstate}`;
  return (
    `${req.method} ${req.path} parou porque este banco não tem parte do ` +
    `schema que esta rota lê.${sqlstate}`
  );
}

/**
 * O contexto da regra fechada que este banco aplica e é de antes deste build.
 *
 * A frase de `contextoDeSchemaAusente` não serve aqui, e a diferença não é de
 * estilo: ela diz que falta *parte do schema que esta rota lê*, e quem lesse
 * isso sobre uma coluna que existe iria procurar tabela ausente. O que falta é
 * a **versão** da regra — a lista fechada da coluna admite hoje menos valores
 * do que este build escreve —, e é isso que precisa estar dito para que
 * ninguém procure defeito no arquivo que acabou de subir.
 *
 * A constraint é nomeada porque é o endereço exato do que está velho, e porque
 * é schema, não dado: nenhum valor do pedido atravessa. Recomendação nenhuma
 * sai daqui — o que resolve vem de `diagnosticar`, como em todo este arquivo.
 *
 * A frase diz o que se sabe, e para: que a regra é de antes, e que a chamada
 * não gravou. Absolver o arquivo por escrito seria ir além da evidência — a
 * fila reescrever aquela regra não prova que o valor passaria na versão nova —,
 * e é a razão da recusa, e não um veredito, que tira quem opera do arquivo.
 */
function contextoDeRegraAntiga(req: Request, err: unknown): string {
  const constraint = erroDoPostgres(err)?.constraint;
  return (
    `${req.method} ${req.path} parou numa regra que este banco aplica na ` +
    `versão anterior à deste build${constraint ? ` (\`${constraint}\`)` : ""}: ` +
    `a fila tem uma migration que a reescreve, e ela ainda não rodou aqui. ` +
    `Nada foi gravado por esta chamada, e nada se perdeu.`
  );
}

/**
 * O contexto de uma chamada que não chegou ao banco.
 *
 * Diz o que se sabe e para: **qual** pedido parou e que ele não gravou nada.
 * Recomendação nenhuma sai daqui — o que houve com o ambiente e o que resolve
 * vêm de `diagnosticar`, como em todo este arquivo. A frase existe porque sem
 * ela o diagnóstico chegaria à tela sem dizer sobre qual chamada ele fala, e
 * "o banco não respondeu" sozinho não responde à pergunta que quem acabou de
 * clicar faz primeiro: *o que eu tentei fazer aconteceu?*
 */
function contextoDeBancoIndisponivel(req: Request): string {
  return (
    `${req.method} ${req.path} não foi executado: a consulta não chegou ao ` +
    `banco deste ambiente. Nada foi gravado por esta chamada.`
  );
}

/**
 * O 500 de sempre — a última saída, quando nada acima classificou o erro.
 *
 * Está numa função porque é chamado de dois lugares: do fluxo normal e do
 * `catch` que protege a classificação. Um handler de erro que **lança** deixa o
 * Express cair no `finalhandler`, que responde `text/html` — exatamente o que
 * este arquivo inteiro existe para impedir.
 */
function responderFalhaInterna(
  req: Request,
  res: Response,
  err: unknown,
): void {
  res.status(500).json({
    error:
      "O servidor falhou ao processar este pedido. Nada foi gravado por esta " +
      "chamada.",
    code: CODIGO_ERRO_INTERNO,
    requestId: req.id,
    ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
  });
  // O 500 genérico é o evento que ninguém deveria descobrir pelo cliente:
  // um por janela vira alerta, os demais viram contagem — ver lib/alerta.
  void alertar({
    tipo: "HTTP_500",
    resumo: `500 em ${req.method} ${req.path}`,
    detalhe: { requestId: req.id, path: req.path },
  });
}

/**
 * A última linha: o que sobrou de erro vira JSON, sempre.
 *
 * Seis desfechos, **nesta ordem** — e a ordem é o desenho, não arrumação:
 *
 * 1. **Cabeçalho já enviado.** Não há status para trocar. Se a resposta em
 *    curso é um stream de eventos — o `/assistant/ask` com `text/event-stream`
 *    —, o erro sai como o último evento, que é onde a tela já sabe procurá-lo.
 *    Qualquer outro caso só pode ser encerrado.
 * 2. **Recusa do parser de corpo.** O status dele é preservado (400, 413, 415)
 *    e a frase diz o que estava errado no pedido.
 * 3. **Recusa nomeada pelo domínio.** 404, 400, 409 ou 422 conforme a classe,
 *    com a frase que o domínio escreveu. Vem antes do schema porque uma recusa
 *    é uma resposta, e não uma falha: perguntar pelo banco primeiro faria uma
 *    vigência inexistente parecer um banco quebrado.
 * 4. **Falta schema.** 503 com o diagnóstico de `diagnosticar` — a mesma
 *    autoridade que responde ao `/healthz`. É o caso que o `/healthz` sozinho
 *    não enxerga: pela contagem de migrations está tudo em dia e, ainda assim,
 *    um objeto que elas criam não está lá.
 * 5. **O banco não respondeu.** 503 com o diagnóstico da conexão que falhou —
 *    ver `lib/banco-indisponivel.ts`. Vem depois do schema porque é a menos
 *    específica das falhas de ambiente, e antes do 500 porque um banco fora do
 *    ar não é defeito deste servidor.
 * 6. **Falha nossa.** 500, com `code` e `requestId`, e o erro inteiro — com
 *    stack — na linha de log deste `requestId`.
 *
 * Os desfechos 3 e 4 eram, até aqui, trabalho de cada rota: trinta e nove
 * `try/catch` traduziam a recusa e quatro arquivos perguntavam por schema. Quem
 * não fizesse as duas coisas — e a maioria não fazia — respondia
 * `{"error": "Internal server error"}`, a constante que esta API não emite mais
 * em lugar nenhum. Aqui as perguntas são feitas uma vez, para todas as rotas, e
 * **nenhuma rota pode deixar de fazê-las esquecendo de escrever um `catch`.**
 *
 * O `async` e o `catch` de dentro andam juntos: o desfecho 4 abre conexão para
 * observar o banco, e um handler de erro cuja promessa rejeita deixa o Express
 * responder HTML. Se a classificação falhar, o pedido cai no 500 — que é a
 * resposta certa para "nem o diagnóstico foi possível".
 */
export const erroEmJson: ErrorRequestHandler = (err, req, res, _next) => {
  void (async () => {
    if (res.headersSent) {
      req.log?.error(
        { err },
        "Erro não tratado — respondido pelo contrato JSON",
      );
      const tipo = String(res.getHeader("content-type") ?? "");
      if (tipo.includes("text/event-stream")) {
        res.write(
          `event: erro\ndata: ${JSON.stringify({
            error: "A resposta foi interrompida por uma falha do servidor.",
            code: CODIGO_ERRO_INTERNO,
            requestId: req.id,
            ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
          })}\n\n`,
        );
      }
      res.end();
      return;
    }

    const doParser = statusDoParser(err);
    if (doParser !== null) {
      req.log?.warn({ err }, "Pedido recusado pelo parser de corpo");
      res.status(doParser).json({
        error: frasePara(doParser, err),
        code: CODIGO_PEDIDO_INVALIDO,
        requestId: req.id,
        ...(detalheDe(err) ? { detalhe: detalheDe(err) } : {}),
      });
      return;
    }

    try {
      /*
        Uma recusa nomeada não é defeito: sai como `warn`, e sem `detalhe` — a
        frase dela **é** o detalhe, escrita pelo domínio para quem lê.
      */
      const daRecusa = statusDaRecusa(err);
      if (daRecusa !== null) {
        req.log?.warn({ err }, "Recusa nomeada pelo domínio");
        res.status(daRecusa).json({
          error: err instanceof Error ? err.message : "Pedido recusado.",
          code: CODIGO_RECUSA,
          requestId: req.id,
        });
        return;
      }

      if (faltaSchema(err)) {
        req.log?.error({ err }, "Schema ausente — respondido com diagnóstico");
        await responderSchemaAusente(res, contextoDeSchemaAusente(req, err));
        return;
      }

      /*
        A mesma falta, na forma que o schema tem quando o objeto **está** lá e
        é de antes: a regra fechada que uma migration pendente reescreve. Vem
        depois de `faltaSchema` porque é a mais cara das duas — só ela pergunta
        ao banco — e porque um erro que já se classificou por SQLSTATE não
        precisa de evidência nenhuma além dele.
      */
      const observado = await regraDeMigrationPendente(err);
      if (observado) {
        req.log?.error(
          { err },
          "Regra de migration pendente — respondido com diagnóstico",
        );
        await responderSchemaAusente(
          res,
          contextoDeRegraAntiga(req, err),
          observado,
        );
        return;
      }
      /*
        A terceira falha de ambiente, e a mais banal: a consulta não chegou ao
        banco. Vem depois das duas de schema porque elas são mais específicas —
        um `42P01` é uma consulta que **chegou** e encontrou o banco sem a
        tabela —, e vem antes do 500 porque um banco fora do ar não é defeito
        deste servidor, e responder que ele é manda procurar no lugar errado.

        Era o buraco por onde a tela de login saía dizendo "Não foi possível
        concluir o login" com o banco desligado — a mesma frase que ela usaria
        para uma senha errada.
      */
      if (bancoIndisponivel(err)) {
        req.log?.error(
          { err },
          "Banco indisponível — respondido com diagnóstico",
        );
        responderBancoIndisponivel(
          res,
          contextoDeBancoIndisponivel(req),
          err,
          req.id,
        );
        return;
      }
    } catch (falhaDaClassificacao) {
      req.log?.error(
        { err, falhaDaClassificacao },
        "Erro não tratado — a classificação também falhou",
      );
      if (!res.headersSent) responderFalhaInterna(req, res, err);
      return;
    }

    req.log?.error({ err }, "Erro não tratado — respondido pelo contrato JSON");
    responderFalhaInterna(req, res, err);
  })();
};
