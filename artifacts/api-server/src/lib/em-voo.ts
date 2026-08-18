import type { NextFunction, Request, Response } from "express";

import { logger } from "./logger";

/**
 * O que aconteceu com cada requisição, e quantas estavam acontecendo junto.
 *
 * Este arquivo é instrumento de diagnóstico, não de produto: ele não decide
 * nada e não muda resposta nenhuma. Existe porque uma falha real desta
 * plataforma não pôde ser explicada com o que o servidor registrava.
 *
 * ---------------------------------------------------------------------------
 * A falha que ele existe para fechar
 * ---------------------------------------------------------------------------
 * A tela de Curadoria mostrou `SEM_RESPOSTA` (ver `lib/transporte.ts` na
 * interface): o `fetch` rejeitou, nenhuma resposta HTTP chegou. Esse estado tem
 * duas causas possíveis e elas pedem consertos opostos —
 *
 *   1. o processo foi reiniciado com a requisição em voo (o supervisor de
 *      `scripts/dev.mjs` reconstrói e manda `SIGTERM` a cada mudança de
 *      arquivo), ou
 *   2. a requisição demorou mais do que alguma camada no caminho tolera, e a
 *      conexão foi cortada.
 *
 * — e o log não separava as duas. O `pino-http` registra a requisição **quando
 * ela termina**; nos dois casos ela não termina, então nos dois casos não havia
 * linha nenhuma. Ausência de log não distingue nada: ela é o mesmo silêncio.
 *
 * ---------------------------------------------------------------------------
 * O que muda aqui
 * ---------------------------------------------------------------------------
 * Três linhas, e cada uma responde uma pergunta que o silêncio não respondia:
 *
 * - **`requisicao iniciada`** prova que a requisição *chegou*. Sem ela, o
 *   defeito está antes do servidor — roteador, proxy, rede — e não dentro dele.
 * - **`requisicao concluida`** traz `duracaoMs`. É o que mede a hipótese do
 *   tempo, com número em vez de impressão.
 * - **`requisicao encerrada sem resposta`** é a que faltava. Sai quando o
 *   socket fecha antes de a resposta terminar (`res.writableFinished` falso), e
 *   é exatamente o outro lado do `SEM_RESPOSTA` da tela — o servidor dizendo
 *   "eu estava respondendo e a conexão morreu".
 *
 * `emVoo` é o quarto dado: quantas requisições o processo estava atendendo no
 * instante. Ele entra também na despedida do processo (`index.ts`), que é onde
 * diz quantas ficaram sem resposta num reinício.
 *
 * ---------------------------------------------------------------------------
 * Como as duas causas se separam — medido, não deduzido
 * ---------------------------------------------------------------------------
 * As duas foram reproduzidas contra este servidor, e produzem evidências que
 * **não se sobrepõem**. Vale a pena escrever qual é qual, porque a intuição
 * erra aqui:
 *
 * | Causa                         | O que aparece no log                     |
 * |-------------------------------|------------------------------------------|
 * | Reinício (`SIGTERM`)          | `sinal-de-encerramento` com `emVoo > 0` e |
 * |                               | a lista de rotas. **Nenhuma** linha por    |
 * |                               | requisição.                               |
 * | Corte com o processo vivo     | `requisicao encerrada sem resposta`, com  |
 * |                               | `duracaoMs`. **Nenhum** sinal.            |
 *
 * A ausência na primeira linha não é falha do instrumento, é a natureza do
 * caso: `SIGTERM` mata o processo antes de qualquer `res.on("close")` rodar.
 * Por isso a despedida em `index.ts` precisa carregar a lista de rotas em voo —
 * ela é o **único** registro de quem ficou sem resposta num reinício.
 */

/** Quantas requisições entraram e ainda não terminaram. */
let emVoo = 0;

/** Para quem precisa do número fora do ciclo de uma requisição — o `SIGTERM`. */
export function requisicoesEmVoo(): number {
  return emVoo;
}

/**
 * As rotas em voo agora, com há quanto tempo cada uma está.
 *
 * Um número sozinho ("3 em voo") não diz quem ficou sem resposta. A lista diz,
 * e é ela que aparece na despedida do processo.
 */
const iniciadas = new Map<string, { rota: string; inicio: number }>();

export function rotasEmVoo(): { rota: string; haMs: number }[] {
  const agora = performance.now();
  return [...iniciadas.values()].map((r) => ({
    rota: r.rota,
    haMs: Math.round(agora - r.inicio),
  }));
}

let sequencia = 0;

/**
 * O middleware. Registrado antes das rotas, conta tudo o que entra em `/api`.
 *
 * Não interfere: não escreve resposta, não trata erro, não decide nada. Só
 * observa e devolve o controle.
 */
export function contarEmVoo(req: Request, res: Response, next: NextFunction): void {
  const rota = req.url?.split("?")[0] ?? req.url ?? "?";
  const id = `${++sequencia}`;
  const inicio = performance.now();

  emVoo += 1;
  iniciadas.set(id, { rota, inicio });

  req.log?.info(
    { rota, metodo: req.method, emVoo, marca: id },
    "requisicao iniciada",
  );

  /*
    `close` e não `finish`: `finish` só dispara quando a resposta foi escrita
    inteira, e é justamente o caso que não interessa investigar. `close`
    dispara sempre — inclusive quando a conexão morreu no meio —, e
    `writableFinished` diz qual dos dois foi.
  */
  res.on("close", () => {
    emVoo -= 1;
    iniciadas.delete(id);
    const duracaoMs = Math.round(performance.now() - inicio);
    const dados = {
      rota,
      metodo: req.method,
      status: res.statusCode,
      duracaoMs,
      emVoo,
      marca: id,
    };

    if (res.writableFinished) {
      req.log?.info(dados, "requisicao concluida");
      return;
    }

    /*
      Aqui está o achado que o log não tinha. A resposta não terminou de sair:
      ou o processo está morrendo, ou quem estava do outro lado desistiu. A
      linha do `SIGTERM` decide qual — e ela existe por causa desta.
    */
    logger.warn(
      dados,
      "requisicao encerrada sem resposta — a conexao fechou antes de a resposta terminar",
    );
  });

  next();
}
