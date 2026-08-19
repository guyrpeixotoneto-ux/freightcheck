import { logger } from "./logger";

/**
 * O alerta operacional mínimo — a linha que liga para alguém.
 *
 * A auditoria mediu o custo da ausência: sem métrica e sem alerta, incidente é
 * descoberto quando o cliente liga. Este módulo é deliberadamente pequeno: um
 * webhook configurável (`ALERTA_WEBHOOK_URL`) que recebe os eventos que
 * exigiriam ação de gente — migration falhando na partida, backup falhando,
 * reconvergência incompleta, leituras órfãs encerradas, e a taxa de 500.
 *
 * **Sem webhook configurado, o alerta é o log em nível error** — que já é mais
 * do que existia, porque estes eventos ganham um código estável (`tipo`) que
 * dá para filtrar. Com webhook, o corpo é JSON simples com um campo `text`
 * (o formato que Slack/Teams/genérico aceitam sem adaptador).
 *
 * **Um alerta por tipo a cada 10 minutos.** Uma tempestade de 500 idênticos
 * não pode virar uma tempestade de webhooks: o primeiro avisa, os seguintes
 * contam, e o contador sai no próximo alerta daquele tipo.
 */

const JANELA_MS = 10 * 60_000;

interface EstadoDoTipo {
  ultimoEnvio: number;
  suprimidos: number;
}

const porTipo = new Map<string, EstadoDoTipo>();

/** Só para os testes: zera a janela de supressão. */
export function zerarJanelaDeAlertas(): void {
  porTipo.clear();
}

export interface Alerta {
  /** Código estável do evento: MIGRATION_FALHOU, BACKUP_FALHOU, HTTP_500… */
  tipo: string;
  resumo: string;
  detalhe?: Record<string, unknown>;
}

/**
 * Envia (ou suprime) um alerta. Nunca lança: um alerta que derruba o fluxo
 * que o emitiu transformaria o aviso em segundo incidente.
 */
export async function alertar(
  alerta: Alerta,
  enviar: (url: string, corpo: unknown) => Promise<void> = enviarWebhook,
): Promise<void> {
  const agora = Date.now();
  const estado = porTipo.get(alerta.tipo);

  if (estado && agora - estado.ultimoEnvio < JANELA_MS) {
    estado.suprimidos++;
    return;
  }

  const suprimidos = estado?.suprimidos ?? 0;
  porTipo.set(alerta.tipo, { ultimoEnvio: agora, suprimidos: 0 });

  logger.error(
    { alerta: alerta.tipo, detalhe: alerta.detalhe, suprimidosNaJanela: suprimidos },
    `ALERTA ${alerta.tipo}: ${alerta.resumo}`,
  );

  const url = process.env["ALERTA_WEBHOOK_URL"];
  if (!url) return;

  const texto =
    `[FreightCheck] ${alerta.tipo}: ${alerta.resumo}` +
    (suprimidos > 0 ? ` (${suprimidos} ocorrência(s) suprimida(s) nos últimos 10 min)` : "");

  try {
    await enviar(url, {
      text: texto,
      tipo: alerta.tipo,
      resumo: alerta.resumo,
      detalhe: alerta.detalhe ?? null,
      quando: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ err, alerta: alerta.tipo }, "O webhook de alerta falhou — o log acima é o registro.");
  }
}

async function enviarWebhook(url: string, corpo: unknown): Promise<void> {
  const controle = new AbortController();
  const teto = setTimeout(() => controle.abort(), 10_000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: controle.signal,
    });
  } finally {
    clearTimeout(teto);
  }
}
