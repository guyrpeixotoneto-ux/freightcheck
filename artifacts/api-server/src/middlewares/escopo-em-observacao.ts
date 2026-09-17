import type { RequestHandler, Request } from "express";
import {
  escopoEfetivo,
  vereditoDoHash,
  type EscopoEfetivo,
  type Veredito,
} from "../lib/escopo-efetivo";

/**
 * O escopo por empresa e unidade, **medindo antes de cortar**.
 *
 * ---------------------------------------------------------------------------
 * Por que observação, e não bloqueio
 * ---------------------------------------------------------------------------
 *
 * Ligar o corte em ~40 rotas de leitura de uma vez é a forma conhecida de este
 * produto quebrar: `lib/permissoes.ts` documenta, com a razão escrita, por que
 * leitura nunca foi filtrada por módulo — as telas compartilham endpoints, e um
 * bloqueio por cima de endpoint compartilhado derruba tela permitida sem
 * proteger a proibida. A mesma armadilha vale aqui, com uma diferença: desta
 * vez dá para **medir** antes.
 *
 * Este middleware calcula o escopo efetivo de toda leitura autenticada, decide
 * o que **faria**, registra, e deixa passar. O que sai dele é a evidência que
 * falta para a decisão de corte: quais rotas seriam afetadas, quantas
 * requisições seriam reduzidas ou recusadas, e em que proporção isso é acesso
 * indevido de verdade contra curadoria pendente.
 *
 * ---------------------------------------------------------------------------
 * O que ele mede, e por que são três categorias e não duas
 * ---------------------------------------------------------------------------
 *
 * · `DENTRO` — o `scopeHash` pedido pertence a uma unidade que a conta alcança.
 *   Nada aconteceria.
 * · `FORA` — pertence a uma unidade que a conta **não** alcança. Seria recusa,
 *   e é o número que decide se existe acesso indevido hoje.
 * · `SEM_VINCULO` — pertence a acervo que nenhuma unidade canônica reivindica.
 *   **Não é acesso indevido**: é curadoria pendente. Contá-lo junto com `FORA`
 *   produziria um número alarmante que mandaria cortar o que não devia, e foi
 *   para separar os dois que a classificação existe.
 *
 * E um quarto caso, que é sobre a requisição e não sobre o hash: `SEM_PEDIDO`,
 * quando o cliente não declarou `scopeHash`. Aí o corte não recusaria — ele
 * **reduziria**, entregando as unidades permitidas em vez do universo. Reduzir
 * é uma mudança de resposta sem erro nenhum na tela, e é a mais difícil de ver
 * depois de ligada; por isso ela é contada em separado desde agora.
 *
 * ---------------------------------------------------------------------------
 * Em memória, por processo — e o que isso significa
 * ---------------------------------------------------------------------------
 *
 * Mesma decisão do teto do Assistente e do contador de senha errada, pela mesma
 * razão: o produto roda um processo, e uma escrita por leitura para observar
 * leitura é um custo que não se paga. A consequência é que a medição é da
 * janela desde a última partida, e o relatório precisa dizer isso — o que ele
 * diz, em `desde`.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo deliberadamente não faz
 * ---------------------------------------------------------------------------
 *
 * Não recusa, não altera resposta, não toca no que a rota devolve. Se ele
 * mudasse uma vírgula do corpo, a medição estaria medindo o produto já cortado
 * — e a pergunta que ela existe para responder é o que aconteceria *se*.
 *
 * O escopo calculado fica em `req.escopo` para as rotas que quiserem usá-lo
 * desde já — o Assistente é a primeira, e usar o mesmo objeto é o que garante
 * que não há caminho paralelo.
 */

/** Uma requisição observada. */
export interface ObservacaoDeEscopo {
  rota: string;
  metodo: string;
  userId: string;
  empresaId: string;
  /** O que o corte faria com esta requisição. */
  efeito: "NADA" | "RECUSARIA" | "REDUZIRIA" | "INDECIDIVEL";
  veredito: Veredito | "SEM_PEDIDO";
  /** O `scopeHash` pedido, quando houve. */
  pedido: string | null;
  /** Quantas unidades a conta alcança. */
  unidades: number;
  /** O conjunto veio do fallback (ninguém configurou) ou de concessão? */
  porFallback: boolean;
  em: string;
}

const LIMITE = 5000;
const anel: ObservacaoDeEscopo[] = [];
let desde = new Date().toISOString();

/** Só para os testes: zera a janela de medição. */
export function esquecerObservacoes(): void {
  anel.length = 0;
  desde = new Date().toISOString();
}

export function observacoes(limite = 200): ObservacaoDeEscopo[] {
  return anel.slice(-limite);
}

/**
 * O relatório que a decisão de corte precisa — por rota, e por efeito.
 *
 * Agregado por rota porque é rota a rota que o corte vai ser ligado: um total
 * global diria "3% seria recusado" sem dizer onde, e onde é a única coisa que
 * importa para saber por qual começar.
 */
export function relatorioDeEscopo() {
  const porRota = new Map<
    string,
    { rota: string; total: number; nada: number; recusaria: number; reduziria: number; indecidivel: number }
  >();

  for (const o of anel) {
    const chave = `${o.metodo} ${o.rota}`;
    const linha = porRota.get(chave) ?? {
      rota: chave,
      total: 0,
      nada: 0,
      recusaria: 0,
      reduziria: 0,
      indecidivel: 0,
    };
    linha.total += 1;
    if (o.efeito === "NADA") linha.nada += 1;
    if (o.efeito === "RECUSARIA") linha.recusaria += 1;
    if (o.efeito === "REDUZIRIA") linha.reduziria += 1;
    if (o.efeito === "INDECIDIVEL") linha.indecidivel += 1;
    porRota.set(chave, linha);
  }

  const total = anel.length;
  return {
    desde,
    total,
    /* O resumo responde "dá para ligar?"; as rotas respondem "por onde". */
    resumo: {
      nada: anel.filter((o) => o.efeito === "NADA").length,
      recusaria: anel.filter((o) => o.efeito === "RECUSARIA").length,
      reduziria: anel.filter((o) => o.efeito === "REDUZIRIA").length,
      indecidivel: anel.filter((o) => o.efeito === "INDECIDIVEL").length,
      contasNoFallback: new Set(anel.filter((o) => o.porFallback).map((o) => o.userId)).size,
    },
    rotas: [...porRota.values()].sort((a, b) => b.recusaria - a.recusaria || b.total - a.total),
  };
}

/** O `scopeHash` que a requisição declarou, onde quer que ele venha. */
function hashPedido(req: Request): string | null {
  const daConsulta = (req.query as Record<string, unknown>)["scopeHash"];
  if (typeof daConsulta === "string" && daConsulta) return daConsulta;
  const doCorpo = (req.body as Record<string, unknown> | undefined)?.["scopeHash"];
  if (typeof doCorpo === "string" && doCorpo) return doCorpo;
  return null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** O escopo desta sessão, quando calculado. Ver `lib/escopo-efetivo.ts`. */
      escopo?: EscopoEfetivo;
    }
  }
}

/**
 * Calcula, classifica, registra — e deixa passar.
 *
 * Nunca derruba a requisição: uma falha de cálculo aqui é uma medição perdida,
 * e perder medição não pode custar uma leitura ao produto. É a mesma postura do
 * portão de permissão diante de banco fora — o que não se sabe não vira recusa.
 */
export const escopoEmObservacao: RequestHandler = async (req, _res, next) => {
  if (!req.user) {
    next();
    return;
  }

  try {
    const escopo = await escopoEfetivo(req.user.id);
    req.escopo = escopo;

    const pedido = hashPedido(req);
    const veredito: Veredito | "SEM_PEDIDO" = pedido
      ? vereditoDoHash(escopo, pedido)
      : "SEM_PEDIDO";

    const efeito: ObservacaoDeEscopo["efeito"] =
      veredito === "DENTRO"
        ? "NADA"
        : veredito === "FORA"
          ? "RECUSARIA"
          : veredito === "SEM_VINCULO"
            ? "INDECIDIVEL"
            : /*
                Sem pedido: o corte entregaria só o que a conta alcança. Isso é
                "nada" quando ela alcança tudo o que existe, e "reduziria"
                quando não — e é essa distinção que diz se ligar o corte muda
                alguma tela.
              */
              escopo.hashesSemUnidade.length === 0 && escopo.porFallback
              ? "NADA"
              : "REDUZIRIA";

    anel.push({
      rota: req.path,
      metodo: req.method,
      userId: req.user.id,
      empresaId: escopo.empresaId,
      efeito,
      veredito,
      pedido,
      unidades: escopo.unidadesPermitidas.length,
      porFallback: escopo.porFallback,
      em: new Date().toISOString(),
    });
    if (anel.length > LIMITE) anel.shift();
  } catch (err) {
    req.log?.warn?.({ err }, "escopo em observação não pôde ser calculado");
  }

  next();
};
