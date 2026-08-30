import { db } from "@workspace/db";
import { contarBuscasAtivas, varrerBuscasDevidas } from "./busca-ativa";
import { cofreDisponivel } from "./cofre";
import { logger } from "./logger";

/**
 * O relógio da busca ativa — a parte que não depende de ninguém lembrar.
 *
 * Uma varredura por minuto, e é ela que pergunta ao banco "que busca venceu?".
 * O minuto é folgado de propósito: o piso de intervalo de uma busca é de quinze
 * minutos (`INTERVALO_MINIMO_MINUTOS`), então uma varredura por minuto já dá a
 * precisão máxima que a agenda pode usar, e custa uma consulta indexada que não
 * devolve nada quase sempre.
 *
 * **Quem garante que duas instâncias não buscam a mesma coisa é o banco**, e não
 * este timer: a varredura toma as linhas vencidas com `FOR UPDATE SKIP LOCKED`
 * e empurra o carimbo dentro da mesma transação (ver `varrerBuscasDevidas`).
 * É o que permite este agendador rodar em todas as instâncias do autoscale sem
 * eleição de líder e sem tabela de lock — e é o que faz a agenda sobreviver à
 * instância que morre no meio da madrugada, porque a próxima que subir encontra
 * a linha vencida esperando.
 *
 * **A partida entra na conta**, como no agendador de backups: um deploy no meio
 * da janela não perde a busca, porque a primeira varredura acontece assim que o
 * processo sobe.
 */

const INTERVALO_DA_VARREDURA_MS = 60 * 1000;

/** O `req.log` que a varredura não tem: ela roda fora de requisição nenhuma. */
const registro = {
  warn: (obj: unknown, msg: string) => logger.warn(obj as object, msg),
  error: (obj: unknown, msg: string) => logger.error(obj as object, msg),
};

let varrendo = false;

async function varrer(motivo: string): Promise<void> {
  /*
    Uma varredura por vez neste processo. A trava do banco já impede duas
    instâncias de pegarem a mesma linha; esta impede que **a mesma** instância
    empilhe rodadas quando uma busca demora mais que o intervalo do timer — o
    que aconteceria com um fornecedor lento e um minuto de relógio.
  */
  if (varrendo) return;
  varrendo = true;
  try {
    const quantas = await varrerBuscasDevidas(db, registro);
    if (quantas > 0) {
      logger.info({ quantas, motivo }, "Buscas ativas executadas.");
    }
  } catch (err) {
    logger.error({ err, motivo }, "A varredura de buscas ativas falhou.");
  } finally {
    varrendo = false;
  }
}

/** Liga o relógio: uma varredura agora, uma por minuto dali em diante. */
export function agendarBuscasAtivas(): void {
  if (!process.env["DATABASE_URL"]) return;

  /*
    O aviso da partida, e ele existe para um desfecho específico e silencioso:
    um ambiente com buscas cadastradas e **sem chave mestra** não consegue abrir
    a credencial de nenhuma delas, e todas falhariam a cada janela — de
    madrugada, num histórico que ninguém está olhando. Dito alto na partida, o
    conserto é uma variável de ambiente.
  */
  void contarBuscasAtivas(db)
    .then((quantas) => {
      if (quantas > 0 && !cofreDisponivel()) {
        logger.warn(
          { buscas: quantas },
          "Há buscas ativas cadastradas e INTEGRACOES_CHAVE_MESTRA não está " +
            "definida: as que usam credencial vão falhar a cada janela. Ver " +
            "docs/INTEGRACOES.md.",
        );
      }
    })
    .catch(() => {
      /* O banco ainda pode estar convergindo na partida; a varredura reclama
         sozinha se o problema for real e persistir. */
    });

  void varrer("partida");
  const timer = setInterval(() => void varrer("intervalo"), INTERVALO_DA_VARREDURA_MS);
  timer.unref();
}
