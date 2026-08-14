/**
 * O que cada chamada ao modelo custou — e o que ela fez.
 *
 * **Por que isto existe separado do log.** O log do servidor registra que a
 * rota respondeu; não registra que a resposta consumiu 14 mil tokens de
 * entrada, levou 9 segundos, e foi descartada pela trava de lastro. Essas três
 * coisas juntas são a única forma de saber se o assistente está caro, lento ou
 * errado — e as três só existem no instante da chamada, dentro de `llm.ts`.
 *
 * **Anel em memória, de propósito.** Um assistente que grava telemetria no
 * banco a cada pergunta paga uma escrita para observar uma leitura. O anel
 * guarda as últimas chamadas e some no restart, que é exatamente o que se quer
 * de um número operacional: ele responde "como está agora", não "como estava em
 * março". `registrar` é o ponto de extensão para o dia em que a resposta certa
 * for um destino durável.
 *
 * **Tokens reais quando o provedor os dá.** A API devolve `usage` com a
 * contagem verdadeira; a estimativa por caracteres é o fallback, e o campo
 * `origemDosTokens` diz qual dos dois está sendo lido. Um custo estimado
 * apresentado como medido é o mesmo defeito que este produto existe para não
 * cometer com número de frete.
 */

/** Preço de tabela, em dólares por milhão de tokens. */
const PRECOS: Record<string, { entrada: number; saida: number }> = {
  "claude-opus-5": { entrada: 5, saida: 25 },
  "claude-sonnet-5": { entrada: 3, saida: 15 },
  "claude-haiku-4-5": { entrada: 1, saida: 5 },
};

/** Um modelo fora da tabela é cobrado como Opus — erra para cima, não para baixo. */
const PRECO_PADRAO = { entrada: 5, saida: 25 };

export interface EventoDeIa {
  em: string;
  modelo: string;
  esforco: string;
  /** Streaming ou chamada única. */
  fluxo: boolean;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSaida: number;
  /** "usage" = número do provedor; "estimativa" = caracteres ÷ 4. */
  origemDosTokens: "usage" | "estimativa";
  custoUsd: number;
  /** Quantos turnos anteriores foram enviados junto. */
  turnosNoHistorico: number;
  /** A intenção que a orquestração resolveu, quando o chamador a informa. */
  intencao: string | null;
  /** O que aconteceu com o texto: aceito, descartado pela trava, ou falha. */
  desfecho: "IA" | "DESCARTADA" | "RECUSA" | "ERRO" | "SEM_CHAVE";
  erro: string | null;
}

const LIMITE = 500;
const anel: EventoDeIa[] = [];

export function estimarTokens(texto: string): number {
  return Math.ceil((texto || "").length / 4);
}

export function estimarCustoUsd(
  modelo: string,
  tokensEntrada: number,
  tokensSaida: number,
): number {
  const p = PRECOS[modelo] ?? PRECO_PADRAO;
  return Number(
    ((tokensEntrada / 1e6) * p.entrada + (tokensSaida / 1e6) * p.saida).toFixed(6),
  );
}

/** O ponto de extensão para um destino durável. Hoje: o anel. */
export function registrar(evento: Omit<EventoDeIa, "em" | "custoUsd">): EventoDeIa {
  const completo: EventoDeIa = {
    em: new Date().toISOString(),
    custoUsd: estimarCustoUsd(evento.modelo, evento.tokensEntrada, evento.tokensSaida),
    ...evento,
  };
  anel.push(completo);
  if (anel.length > LIMITE) anel.shift();
  return completo;
}

export function eventosRecentes(limite = 50): EventoDeIa[] {
  return anel.slice(-limite);
}

/**
 * O resumo que responde "como está agora".
 *
 * `descartadas` é o número que importa mais: são respostas em que o modelo
 * citou um número que nenhuma consulta devolveu, e que a trava de lastro
 * substituiu pela redação em código. Ele subindo significa que o dossiê está
 * chegando pobre ao modelo, não que o modelo piorou.
 */
export function resumoDaIa() {
  const total = anel.length;
  if (total === 0) {
    return { total: 0, tokens: 0, custoUsd: 0, latenciaMediaMs: 0, descartadas: 0, erros: 0 };
  }
  let tokens = 0;
  let custoUsd = 0;
  let latencia = 0;
  let descartadas = 0;
  let erros = 0;
  for (const e of anel) {
    tokens += e.tokensEntrada + e.tokensSaida;
    custoUsd += e.custoUsd;
    latencia += e.latenciaMs;
    if (e.desfecho === "DESCARTADA") descartadas++;
    if (e.desfecho === "ERRO") erros++;
  }
  return {
    total,
    tokens,
    custoUsd: Number(custoUsd.toFixed(4)),
    latenciaMediaMs: Math.round(latencia / total),
    descartadas,
    erros,
  };
}
