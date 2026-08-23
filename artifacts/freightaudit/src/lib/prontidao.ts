import { getApiUrl } from "@/lib/api";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";
import {
  diagnosticarTransporte,
  type DiagnosticoDeTransporte,
} from "@/lib/transporte";

/**
 * A pergunta que a tela passa a fazer sozinha quando uma chamada falha.
 *
 * ---------------------------------------------------------------------------
 * O que isto substitui
 * ---------------------------------------------------------------------------
 * Uma frase: **"Se isto persistir, confira `/api/healthz`."** Ela estava na
 * tela de login, e havia um "Ver /api/healthz" na tela que não conseguia ser
 * desenhada. Era o produto entregando um endpoint técnico a quem só queria
 * entrar — e pedindo a essa pessoa que fizesse o diagnóstico no lugar dele.
 *
 * O diagnóstico sempre foi possível de fazer daqui: é uma chamada. O que
 * faltava era fazê-la. Esta função é a chamada.
 *
 * ---------------------------------------------------------------------------
 * Por que `/readyz`, e não `/healthz`
 * ---------------------------------------------------------------------------
 * Porque a pergunta é "este ambiente consegue servir?", e essa é a definição
 * de readiness. O `/healthz` responde outra coisa — o processo está de pé —, e
 * responde 200 até com o banco fora, de propósito: é para lá que o startup
 * probe aponta. Perguntar a ele sobre o banco era o que fazia "de pé" ser lido
 * como "pronto".
 *
 * ---------------------------------------------------------------------------
 * As três respostas possíveis, e nenhuma delas é uma exceção
 * ---------------------------------------------------------------------------
 * Esta função **não lança**. Ela é chamada justamente quando alguma coisa já
 * falhou, e um erro dentro do diagnóstico do erro não ajuda ninguém:
 *
 * - `pronto` — o ambiente está inteiro. A falha que trouxe alguém até aqui é
 *   daquela chamada, e não do ambiente: é o caso em que a tela mostra o
 *   `requestId` e nada mais, porque inventar explicação seria pior.
 * - `nao-pronto` — o ambiente respondeu dizendo o que lhe falta, com o
 *   diagnóstico da autoridade única. É a orientação que a tela apresenta.
 * - `inalcancavel` — nem a pergunta chegou. Aí o que se sabe é o eixo do
 *   transporte, e vem classificado por `diagnosticarTransporte` — a mesma
 *   função que classifica qualquer outra chamada que não completa.
 */
export type RespostaDaProntidao =
  | { estado: "pronto"; diagnostico: Diagnostico | null }
  | { estado: "nao-pronto"; diagnostico: Diagnostico | null }
  | { estado: "inalcancavel"; diagnostico: DiagnosticoDeTransporte };

/** A chave do cache — uma só, porque a pergunta é sobre o ambiente inteiro. */
export const PRONTIDAO_QUERY_KEY = ["prontidao"] as const;

/**
 * Pergunta ao `/readyz` e devolve o que ele disse.
 *
 * **O 503 não é erro aqui, é a resposta.** É o desfecho em que o corpo mais
 * importa — ele traz o diagnóstico —, e por isso esta função não usa
 * `fetchJson`: aquele caminho transforma status fora do 2xx em exceção, que é
 * o certo para uma chamada de produto e o oposto do que se quer de um
 * diagnóstico.
 */
export async function consultarProntidao(
  sinal?: AbortSignal,
): Promise<RespostaDaProntidao> {
  let resposta: Response;
  try {
    resposta = await fetch(getApiUrl("/readyz"), {
      ...(sinal ? { signal: sinal } : {}),
      /*
        Nunca do cache do navegador. A pergunta é sobre agora — e uma resposta
        de trinta segundos atrás, no meio de um deploy, é exatamente a
        informação que não serve.
      */
      cache: "no-store",
    });
  } catch (err) {
    const nome =
      typeof err === "object" && err !== null
        ? (err as { name?: unknown }).name
        : undefined;
    return {
      estado: "inalcancavel",
      diagnostico: diagnosticarTransporte(
        nome === "AbortError"
          ? { cancelada: true }
          : {
              naoCompletou: true,
              ...(err instanceof Error && err.message !== ""
                ? { motivo: err.message }
                : {}),
            },
      ),
    };
  }

  /*
    O corpo pode não ser nosso: um 502 do roteador com ninguém atrás do `/api`
    vem em HTML, e um `.json()` nele estoura com "Unexpected end of JSON
    input". Quem responde não é a nossa API, e é o eixo do transporte que
    descreve isso — não um "não está pronto" sobre um servidor que não chegou a
    ser consultado.
  */
  let corpo: Record<string, unknown> | null = null;
  let texto = "";
  try {
    texto = await resposta.text();
    corpo = texto.trim()
      ? (JSON.parse(texto) as Record<string, unknown>)
      : null;
  } catch {
    corpo = null;
  }

  if (corpo === null || typeof corpo["ready"] !== "boolean") {
    return {
      estado: "inalcancavel",
      diagnostico: diagnosticarTransporte({
        status: resposta.status,
        ...(texto.trim() ? { corpoNaoJson: texto } : { corpoVazio: true }),
      }),
    };
  }

  const diagnostico = ehDiagnostico(corpo["diagnostico"])
    ? corpo["diagnostico"]
    : null;

  return corpo["ready"] === true
    ? { estado: "pronto", diagnostico }
    : { estado: "nao-pronto", diagnostico };
}

/**
 * O diagnóstico que esta resposta oferece — ou nada, quando ela não oferece.
 *
 * Um ambiente **pronto** não explica falha nenhuma, e é por isso que ele
 * devolve `null` em vez do diagnóstico saudável que veio no corpo: imprimir
 * "está tudo certo" ao lado de um erro manda procurar no lugar errado. É a
 * mesma regra que `apresentar` já aplicava ao `/healthz`, agora escrita onde a
 * resposta nasce.
 */
export function orientacaoDaProntidao(
  resposta: RespostaDaProntidao | undefined,
): Diagnostico | DiagnosticoDeTransporte | null {
  if (!resposta) return null;
  if (resposta.estado === "inalcancavel") return resposta.diagnostico;
  if (resposta.estado === "pronto") return null;
  return resposta.diagnostico;
}
