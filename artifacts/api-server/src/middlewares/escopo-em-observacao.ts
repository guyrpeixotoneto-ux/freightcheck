import type { RequestHandler, Request } from "express";
import {
  escopoEfetivo,
  vereditoDoHash,
  type EscopoEfetivo,
  type Veredito,
} from "../lib/escopo-efetivo";

/**
 * O escopo por unidade, **medindo antes de cortar**.
 *
 * ---------------------------------------------------------------------------
 * Por que observação, e não bloqueio
 * ---------------------------------------------------------------------------
 *
 * Duas razões, e as duas são medidas.
 *
 * A primeira é a que `lib/permissoes.ts` já documenta: as telas compartilham
 * endpoints de leitura, e um bloqueio por cima de endpoint compartilhado
 * derruba tela permitida sem proteger a proibida. São ~40 rotas.
 *
 * A segunda é própria deste eixo, e é maior. Em `acesso_a_unidade`, **ausência
 * de linha é ausência de acesso** — de propósito, para a tabela ser uma
 * fronteira e não um enfeite. A consequência aritmética é que, num banco onde
 * ninguém ainda concedeu nada, ligar o corte deixa **todo mundo sem nada**. Não
 * há fallback que conserte isso sem desfazer a fronteira; o que conserta é a
 * ordem: criar a estrutura, medir, cadastrar as concessões, e só então ligar.
 *
 * Este middleware é o "medir". Ele calcula o escopo de toda leitura
 * autenticada, decide o que **faria**, registra, e deixa passar. O que sai dele
 * é a evidência que falta para a decisão de corte: quais rotas seriam afetadas,
 * quais contas, quantas requisições, e quanto disso é acesso indevido de
 * verdade contra curadoria pendente.
 *
 * ---------------------------------------------------------------------------
 * As quatro categorias, e por que não são duas
 * ---------------------------------------------------------------------------
 *
 * · `NADA` — o `scopeHash` pedido está dentro do que a conta alcança.
 * · `RECUSARIA` — está fora. É o número que diz se existe acesso indevido hoje.
 * · `INDECIDIVEL` — o hash não tem vínculo com unidade canônica nenhuma. **Não
 *   é acesso indevido: é curadoria pendente.** Somá-lo a `RECUSARIA` produziria
 *   um número alarmante que mandaria cortar o que não devia, e foi para separar
 *   os dois que a classificação existe. Ele também **não** é liberado por
 *   conveniência: antes do corte, cada um precisa de vínculo ou de exceção
 *   escrita.
 * · `REDUZIRIA` — a requisição não declarou `scopeHash`, e a conta não alcança
 *   tudo o que existe. O corte não recusaria; entregaria menos. Reduzir é a
 *   mudança mais difícil de ver depois de ligada, porque não produz erro na
 *   tela — só um número menor. Por isso ela é contada em separado desde agora.
 *
 * ---------------------------------------------------------------------------
 * Em memória, por processo
 * ---------------------------------------------------------------------------
 *
 * Mesma decisão do teto do Assistente e do contador de senha errada, pela mesma
 * razão: o produto roda um processo, e uma escrita por leitura para observar
 * leitura é custo que não se paga. A medição é da janela desde a última
 * partida, e o relatório diz isso em `desde` em vez de deixar quem lê supor que
 * é histórico.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo deliberadamente não faz
 * ---------------------------------------------------------------------------
 *
 * Não recusa, não altera resposta, não toca no que a rota devolve. Se ele
 * mudasse uma vírgula do corpo, a medição estaria medindo o produto já cortado
 * — e a pergunta que ela existe para responder é o que aconteceria *se*.
 *
 * O escopo calculado fica em `req.escopo` para as rotas usarem desde já. O
 * Assistente é a primeira, e usar o mesmo objeto é o que garante que não há
 * caminho paralelo.
 */

/** Uma requisição observada. */
export interface ObservacaoDeEscopo {
  rota: string;
  metodo: string;
  userId: string;
  /** O que o corte faria com esta requisição. */
  efeito: "NADA" | "RECUSARIA" | "REDUZIRIA" | "INDECIDIVEL";
  veredito: Veredito | "SEM_PEDIDO";
  /** O `scopeHash` pedido, quando houve. Lista vira lista. */
  pedido: string | null;
  /** Quantas unidades a conta alcança. */
  unidades: number;
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
 * O relatório que a decisão de corte precisa — por rota e por conta.
 *
 * Agregado nos dois eixos porque são duas perguntas diferentes e as duas
 * precisam de resposta antes de ligar: **por rota** diz por onde começar o
 * corte; **por conta** diz quem precisa de concessão cadastrada antes, e é esse
 * o número que dimensiona o trabalho de provisionamento.
 */
export function relatorioDeEscopo() {
  const chave = (o: ObservacaoDeEscopo) => `${o.metodo} ${o.rota}`;

  const porRota = new Map<
    string,
    { rota: string; total: number; nada: number; recusaria: number; reduziria: number; indecidivel: number }
  >();
  const porConta = new Map<
    string,
    { userId: string; total: number; unidades: number; recusaria: number; reduziria: number; indecidivel: number }
  >();

  for (const o of anel) {
    const r = porRota.get(chave(o)) ?? {
      rota: chave(o), total: 0, nada: 0, recusaria: 0, reduziria: 0, indecidivel: 0,
    };
    r.total += 1;
    if (o.efeito === "NADA") r.nada += 1;
    if (o.efeito === "RECUSARIA") r.recusaria += 1;
    if (o.efeito === "REDUZIRIA") r.reduziria += 1;
    if (o.efeito === "INDECIDIVEL") r.indecidivel += 1;
    porRota.set(chave(o), r);

    const c = porConta.get(o.userId) ?? {
      userId: o.userId, total: 0, unidades: o.unidades, recusaria: 0, reduziria: 0, indecidivel: 0,
    };
    c.total += 1;
    c.unidades = o.unidades;
    if (o.efeito === "RECUSARIA") c.recusaria += 1;
    if (o.efeito === "REDUZIRIA") c.reduziria += 1;
    if (o.efeito === "INDECIDIVEL") c.indecidivel += 1;
    porConta.set(o.userId, c);
  }

  return {
    desde,
    total: anel.length,
    resumo: {
      nada: anel.filter((o) => o.efeito === "NADA").length,
      recusaria: anel.filter((o) => o.efeito === "RECUSARIA").length,
      reduziria: anel.filter((o) => o.efeito === "REDUZIRIA").length,
      indecidivel: anel.filter((o) => o.efeito === "INDECIDIVEL").length,
      /* Contas que ainda não têm concessão nenhuma — o trabalho de antes do corte. */
      contasSemConcessao: new Set(anel.filter((o) => o.unidades === 0).map((o) => o.userId)).size,
    },
    rotas: [...porRota.values()].sort((a, b) => b.recusaria - a.recusaria || b.total - a.total),
    contas: [...porConta.values()].sort((a, b) => b.recusaria - a.recusaria || b.total - a.total),
  };
}

/**
 * O `scopeHash` que a requisição declarou, onde quer que ele venha.
 *
 * Consulta e corpo, e a lista contando como lista: mandar `?scopeHash=a&
 * scopeHash=b` é a forma mais óbvia de tentar ampliar, e ela precisa chegar
 * inteira a quem intersecciona em vez de ser truncada aqui.
 */
function hashPedido(req: Request): string | string[] | null {
  const daConsulta = (req.query as Record<string, unknown>)["scopeHash"];
  if (typeof daConsulta === "string" && daConsulta) return daConsulta;
  if (Array.isArray(daConsulta)) return daConsulta.filter((x): x is string => typeof x === "string");
  const doCorpo = (req.body as Record<string, unknown> | undefined)?.["scopeHash"];
  if (typeof doCorpo === "string" && doCorpo) return doCorpo;
  if (Array.isArray(doCorpo)) return doCorpo.filter((x): x is string => typeof x === "string");
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
    const pedidos = pedido === null ? [] : Array.isArray(pedido) ? pedido : [pedido];

    /*
      Numa lista, o veredito é o **pior** dos pedidos: se qualquer item está
      fora, o corte recusaria a requisição. Tomar o melhor deles seria dizer que
      basta um hash legítimo na lista para os outros passarem — que é exatamente
      a ampliação que este eixo existe para impedir.
    */
    const vereditos = pedidos.map((h) => vereditoDoHash(escopo, h));
    const veredito: Veredito | "SEM_PEDIDO" =
      pedidos.length === 0
        ? "SEM_PEDIDO"
        : vereditos.includes("FORA")
          ? "FORA"
          : vereditos.includes("SEM_VINCULO")
            ? "SEM_VINCULO"
            : "DENTRO";

    const efeito: ObservacaoDeEscopo["efeito"] =
      veredito === "DENTRO"
        ? "NADA"
        : veredito === "FORA"
          ? "RECUSARIA"
          : veredito === "SEM_VINCULO"
            ? "INDECIDIVEL"
            : /*
                Sem pedido: o corte entregaria só o que a conta alcança. É
                "nada" apenas quando ela já alcança tudo o que tem vínculo e não
                há acervo pendente de curadoria; em qualquer outro caso ele
                entregaria menos, e é essa a mudança silenciosa que interessa
                contar.
              */
              escopo.hashesSemUnidade.length === 0 && escopo.unidadesPermitidas.length > 0
              ? "NADA"
              : "REDUZIRIA";

    anel.push({
      rota: req.path,
      metodo: req.method,
      userId: req.user.id,
      efeito,
      veredito,
      pedido: pedidos.length === 0 ? null : pedidos.join(","),
      unidades: escopo.unidadesPermitidas.length,
      em: new Date().toISOString(),
    });
    if (anel.length > LIMITE) anel.shift();
  } catch (err) {
    req.log?.warn?.({ err }, "escopo em observação não pôde ser calculado");
  }

  next();
};
