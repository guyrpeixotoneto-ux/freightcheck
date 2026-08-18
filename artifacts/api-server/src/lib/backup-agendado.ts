import { fazerBackup, ultimoBackup } from "@workspace/db/backup";
import { logger } from "./logger";

/**
 * O agendador de backups — a parte que não depende de ninguém lembrar.
 *
 * A regra é uma: **com `BACKUP_DIR` definido, existe um backup com menos de
 * `BACKUP_INTERVALO_HORAS` (24 por padrão) de idade.** A conferência roda na
 * partida e a cada hora, e só dispara o `pg_dump` quando o mais recente
 * envelheceu — subir três vezes no mesmo dia não produz três dumps.
 *
 * A partida entra na conta de propósito: num deployment autoscale um timer só
 * dispara enquanto a instância vive, e uma instância que morre à noite deixaria
 * a janela aberta. Como toda partida confere a idade, o primeiro boot do dia
 * fecha a janela — o agendador não confia no timer, o timer só encurta o
 * intervalo entre partidas.
 *
 * **Sem `BACKUP_DIR` em produção, o log grita na partida.** Fingir cópia é
 * pior que não ter: quem opera precisa saber que o produto está rodando com
 * uma única cópia do dado antes de o incidente perguntar por ela.
 */

const INTERVALO_DE_CONFERENCIA_MS = 60 * 60 * 1000;

function intervaloHoras(): number {
  const bruto = Number(process.env["BACKUP_INTERVALO_HORAS"]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : 24;
}

/** O que o healthz publica: existe cópia, e de quando ela é. Nunca o caminho. */
export function estadoDoBackup():
  | { configurado: false }
  | { configurado: true; ultimo: string | null; idadeHoras: number | null; atrasado: boolean } {
  const dir = process.env["BACKUP_DIR"];
  if (!dir) return { configurado: false };
  const ultimo = ultimoBackup(dir);
  if (!ultimo) return { configurado: true, ultimo: null, idadeHoras: null, atrasado: true };
  const idadeHoras = (Date.now() - ultimo.mtime.getTime()) / (60 * 60 * 1000);
  return {
    configurado: true,
    ultimo: ultimo.mtime.toISOString(),
    idadeHoras: Number(idadeHoras.toFixed(1)),
    atrasado: idadeHoras > intervaloHoras() * 1.5,
  };
}

let emAndamento = false;

async function conferirEFazer(motivo: string): Promise<void> {
  const dir = process.env["BACKUP_DIR"];
  const url = process.env["DATABASE_URL"];
  if (!dir || !url || emAndamento) return;

  const ultimo = ultimoBackup(dir);
  const idadeMs = ultimo ? Date.now() - ultimo.mtime.getTime() : Infinity;
  if (idadeMs < intervaloHoras() * 60 * 60 * 1000) return;

  emAndamento = true;
  try {
    const resultado = await fazerBackup({ databaseUrl: url, dir });
    logger.info(
      {
        bytes: resultado.bytes,
        duracaoMs: resultado.duracaoMs,
        podados: resultado.podados,
        motivo,
      },
      "Backup do banco concluído.",
    );
  } catch (err) {
    // Falha de backup é incidente, não rodapé: sem esta linha alta, a primeira
    // notícia de que as cópias pararam seria o dia em que uma fizesse falta.
    logger.error({ err, motivo }, "Backup do banco FALHOU — o dado está numa cópia só.");
  } finally {
    emAndamento = false;
  }
}

/** Liga o agendador: uma conferência agora, uma por hora dali em diante. */
export function agendarBackups(): void {
  const dir = process.env["BACKUP_DIR"];
  if (!dir) {
    if (process.env["NODE_ENV"] === "production") {
      logger.warn(
        "BACKUP_DIR não está definido: este ambiente roda com UMA cópia do dado. " +
          "Aponte BACKUP_DIR para armazenamento durável — ver docs/BACKUP.md.",
      );
    }
    return;
  }

  void conferirEFazer("partida");
  const timer = setInterval(() => void conferirEFazer("intervalo"), INTERVALO_DE_CONFERENCIA_MS);
  timer.unref();
}
