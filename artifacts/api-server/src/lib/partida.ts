/**
 * Um fato sobre **este processo**: a tentativa de partida já terminou?
 *
 * ---------------------------------------------------------------------------
 * A janela que este módulo existe para fechar
 * ---------------------------------------------------------------------------
 * `app.listen()` acontece antes da fila, e tem de acontecer — a conexão de
 * produção bloqueava o bind por até 60 s e o startup probe desistia. O que
 * ficou sem dono foi o intervalo: o probe aponta para `/healthz`, que é
 * liveness pura e responde 200 sem tocar no banco, então a plataforma promove o
 * release **enquanto a fila ainda roda**. Quem abre a tela nesse intervalo
 * recebe 503 do portão de prontidão — a tela de 24/08/2026, com a `0056` e a
 * `0057` nomeadas.
 *
 * O portão está certo e continua igual: ele impede dado errado. O que faltava
 * era impedir a **promoção**, e promoção é decisão da plataforma, tomada a
 * partir de um probe HTTP. Este módulo é o fato que esse probe precisa.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo **não** é
 * ---------------------------------------------------------------------------
 * **Não é uma segunda autoridade sobre a saúde do banco.** Ele não consulta o
 * banco, não importa `diagnosticar`, não sabe o que é uma migration pendente e
 * não tem como discordar de ninguém sobre isso: a autoridade continua sendo
 * `diagnosticar(observarBanco())`, medida a cada pergunta, em `prontidao.ts`.
 *
 * O que ele sabe é uma coisa só, e é sobre este processo: **a tentativa de
 * partida está em voo ou já terminou?** É deliberadamente indiferente ao
 * desfecho — convergiu, o banco recusou uma migration, ou este ambiente nem
 * tenta. Os três são *terminados*, e nos três a promoção pode seguir:
 *
 *   - convergiu → promover é o certo, e é o caso normal;
 *   - falhou → o deployment tem de subir mesmo assim, para ser diagnosticável
 *     de fora. Não é inseguro: o portão de prontidão (`prontidao.ts`) continua
 *     recusando toda rota de produto enquanto `MIGRATION_FALHOU` valer — a
 *     promoção do processo e a admissão de tráfego de produto são duas portas
 *     diferentes, e só a segunda lê o banco;
 *   - não tenta (Preview, `DB_MIGRATE_ON_BOOT=0`) → não há nada a esperar.
 *
 * ---------------------------------------------------------------------------
 * `liberar` é `fase === "TERMINADA"`, sem exceção — e é a revisão deste módulo
 * ---------------------------------------------------------------------------
 * Uma versão anterior deste arquivo liberava a promoção também quando um teto
 * de tempo expirava com a tentativa **ainda em voo** — o argumento era não
 * deixar uma fila travada (lock de outra instância que não solta, banco que
 * não responde) travar a publicação para sempre. Estava errado: fazer o probe
 * responder 200 por causa do relógio, sem saber se a fila terminou, é romper
 * exatamente a garantia que este módulo existe para dar — **admitir a
 * instância nova enquanto ainda não se sabe se ela fala a mesma versão de
 * contrato do banco**. Um teto que libera é indistinguível, do lado de fora,
 * de "convergiu": ele mente sobre o que este processo sabe.
 *
 * A revisão é: `liberar` é verdadeiro se e somente se `tentativaTerminou()` foi
 * chamada. Em voo ou não iniciada — teto estourado ou não — a resposta
 * continua sendo 503, sempre. **Fail-closed sem prazo de validade.**
 *
 * O que isso custa, dito sem retoque: uma fila genuinamente travada faz este
 * processo nunca ficar pronto para promoção, e a publicação correspondente
 * falha (ou nunca é promovida) enquanto isso durar. É o modo de falha seguro
 * — a versão anterior continua servindo, e nada de errado é admitido — contra
 * o modo de falha inseguro que a versão anterior deste módulo permitia.
 *
 * ---------------------------------------------------------------------------
 * O teto continua existindo — como termômetro, nunca como válvula
 * ---------------------------------------------------------------------------
 * `STARTUP_PROBE_MAX_WAIT_MS` não libera mais nada. O que ele faz é marcar
 * `alemDoTeto: true` no corpo da resposta quando a espera já passou dele —
 * puramente informativo, para quem lê o corpo ou os logs perceber que esta
 * partida está demorando de forma anômala, sem que essa percepção mude o
 * código HTTP. Continua lido do ambiente pela mesma razão de sempre: o
 * orçamento real do startup probe do Autoscale não está documentado por
 * escrito em nenhum lugar alcançável — nem o total, nem a contagem de
 * retries —, só o teto por chamada (~5 s, segundo a documentação da
 * plataforma). Ver `docs/MIGRATIONS.md` para o registro dessa lacuna.
 */

/** A chave que fixa o teto informativo, em milissegundos. */
const CHAVE_TETO = "STARTUP_PROBE_MAX_WAIT_MS";

/**
 * O teto padrão: 15 s.
 *
 * Não gira mais o interruptor de nada — ver o cabeçalho. É só o limiar a
 * partir do qual `alemDoTeto` vira `true` no corpo de `/startupz`, escolhido
 * acima do que uma fila normal custa (as migrations de 24/08/2026 entraram em
 * menos de um segundo) e abaixo do único número que este repositório tem por
 * escrito (um bind de até 60 s já era tarde para o probe).
 */
const TETO_PADRAO_MS = 15_000;

/** Quando este processo começou a contar — o mesmo instante para todos. */
let inicio = Date.now();

let comecou = false;
let terminada = false;
let motivoDoFim: string | undefined;

/**
 * O teto configurado neste ambiente — só para o campo informativo.
 *
 * Valor não reconhecido cai no padrão em vez de virar zero, pela mesma razão
 * de `deveMigrarNaPartida`: um erro de digitação numa variável de deploy não
 * pode mudar o comportamento observável em silêncio. Como o teto não libera
 * nada, "mudar o comportamento" aqui é só "mudar quando o rótulo aparece".
 */
export function tetoDaPromocao(
  env: Partial<Record<string, string | undefined>> = process.env,
): number {
  const bruto = env[CHAVE_TETO];
  if (bruto === undefined || bruto.trim() === "") return TETO_PADRAO_MS;
  const valor = Number(bruto.trim());
  if (!Number.isFinite(valor) || valor < 0) return TETO_PADRAO_MS;
  return valor;
}

/** A fila deste build começou a ser aplicada por este processo. */
export function tentativaComecou(agora: number = Date.now()): void {
  comecou = true;
  terminada = false;
  motivoDoFim = undefined;
  inicio = agora;
}

/**
 * A tentativa terminou — seja qual for o desfecho.
 *
 * É a **única** coisa que muda `liberar` para `true`. O `motivo` é para
 * leitura humana no corpo do `/startupz` e no log; ele não classifica nada —
 * quem classifica o banco é `diagnosticar`.
 */
export function tentativaTerminou(motivo: string): void {
  comecou = true;
  terminada = true;
  motivoDoFim = motivo;
}

/** Em que ponto a partida está, do ponto de vista de promover o release. */
export type FaseDaPartida = "NAO_INICIADA" | "EM_VOO" | "TERMINADA";

export interface EstadoDaPromocao {
  /** A plataforma pode promover este release e mandar tráfego? */
  liberar: boolean;
  fase: FaseDaPartida;
  /** Por que liberou (ou por que ainda não) — frase curta, para ler no corpo. */
  motivo: string;
  /** Há quanto tempo este processo está contando. */
  esperandoHaMs: number;
  /**
   * A espera já passou do teto configurado — sinal de anomalia, não de
   * liberação. Só é `true` fora de `TERMINADA`: uma vez terminada, a pergunta
   * "isto demorou muito?" deixou de importar para a promoção.
   */
  alemDoTeto: boolean;
}

/**
 * A resposta do probe — síncrona, sem I/O, sem `await`, sem tocar em banco.
 *
 * Lê só as variáveis locais deste módulo e o relógio recebido por parâmetro:
 * não há como esta função segurar a conexão HTTP esperando a fila terminar —
 * ela devolve o que sabe **agora**, e `routes/health.ts` escreve a resposta na
 * mesma tick. `NAO_INICIADA` retém pela mesma razão de sempre: entre o
 * `listen` e a primeira linha de `applyMigrationsInBackground` existe um
 * intervalo real, e liberar nele reabriria a janela por alguns milissegundos.
 */
export function estadoDaPromocao(
  agora: number = Date.now(),
  tetoMs: number = tetoDaPromocao(),
): EstadoDaPromocao {
  const esperandoHaMs = Math.max(0, agora - inicio);
  const fase: FaseDaPartida = terminada
    ? "TERMINADA"
    : comecou
      ? "EM_VOO"
      : "NAO_INICIADA";

  if (fase === "TERMINADA") {
    return {
      liberar: true,
      fase,
      motivo: motivoDoFim ?? "A tentativa de partida terminou.",
      esperandoHaMs,
      alemDoTeto: false,
    };
  }

  const alemDoTeto = esperandoHaMs >= tetoMs;

  return {
    liberar: false,
    fase,
    motivo: alemDoTeto
      ? `A tentativa está ${fase === "EM_VOO" ? "em voo" : "sem começar"} há ` +
        `${esperandoHaMs} ms, além do teto informativo de ${tetoMs} ms ` +
        `(${CHAVE_TETO}). Isto é anômalo. A promoção continua retida: ela só ` +
        "libera quando a tentativa terminar, nunca por tempo decorrido."
      : fase === "EM_VOO"
        ? "A fila deste build está sendo aplicada neste banco agora."
        : "A partida ainda não começou a aplicar a fila deste build.",
    esperandoHaMs,
    alemDoTeto,
  };
}

/**
 * Volta ao começo — só os testes chamam.
 *
 * A suíte exercita "em voo → terminada" e "além do teto, ainda retido" no
 * mesmo processo, e sem isto o primeiro arquivo fixaria o estado para todos os
 * seguintes.
 */
export function esquecerPartida(agora: number = Date.now()): void {
  comecou = false;
  terminada = false;
  motivoDoFim = undefined;
  inicio = agora;
}
