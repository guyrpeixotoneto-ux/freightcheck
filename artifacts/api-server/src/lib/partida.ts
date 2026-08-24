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
 * tenta. Os três são *terminados*, e nos três a promoção deve seguir:
 *
 *   - convergiu → promover é o certo, e é o caso normal;
 *   - falhou → o deployment tem de subir mesmo assim, para ser diagnosticável
 *     de fora. A alternativa já foi medida aqui e é pior: publicação que não
 *     sobe, versão anterior servindo, e nada dizendo por quê;
 *   - não tenta (Preview, `DB_MIGRATE_ON_BOOT=0`) → esperar seria esperar para
 *     sempre por algo que ninguém vai fazer.
 *
 * Reter a promoção só faz sentido enquanto a fila **está andando**. É por isso
 * que "terminada" é o predicado, e não "pronta".
 *
 * ---------------------------------------------------------------------------
 * O teto, e por que ele não é um detalhe
 * ---------------------------------------------------------------------------
 * Um probe que espera sem limite troca um modo de falha por outro: a fila
 * travada — um `pg_advisory_lock` de outra instância que não solta, um banco
 * que não responde — viraria uma publicação que nunca sobe. O teto devolve o
 * comportamento de hoje quando ele é atingido: promove, e o portão assume a
 * partir dali, exatamente como antes deste módulo existir.
 *
 * **O valor do teto é uma medida, não uma opinião**, e por isso ele é lido do
 * ambiente. O orçamento real do startup probe do Autoscale não está declarado
 * no `artifact.toml` nem no `.replit`, e a documentação da plataforma não é
 * alcançável do ambiente onde este código foi escrito. O padrão abaixo é
 * conservador contra a única evidência que este repositório tem por escrito —
 * um bind de até 60 s era mais lento que o probe (`index.ts`) — e o
 * `[services.production.health.startup]` **continua apontando para `/healthz`**:
 * enquanto ele não for repontado, nada disto altera uma publicação. Repontar é
 * decisão de quem tiver medido o orçamento; ver `docs/MIGRATIONS.md`.
 */

/** A chave que fixa o teto, em milissegundos. `0` desliga a espera. */
const CHAVE_TETO = "STARTUP_PROBE_MAX_WAIT_MS";

/**
 * O teto padrão: 15 s.
 *
 * Escolhido **abaixo** do único limite que este repositório conhece por
 * escrito (um bind de 60 s já era tarde demais para o probe), com folga de 4×,
 * e acima do que uma fila normal custa — as duas migrations de 24/08/2026
 * entraram em menos de um segundo. Não é uma medição do orçamento da
 * plataforma, e não se apresenta como uma: é o que se pode afirmar sem ela.
 */
const TETO_PADRAO_MS = 15_000;

/** Quando este processo começou a contar — o mesmo instante para todos. */
let inicio = Date.now();

let comecou = false;
let terminada = false;
let motivoDoFim: string | undefined;

/**
 * O teto configurado neste ambiente.
 *
 * Valor não reconhecido cai no padrão em vez de virar zero — a mesma regra de
 * `deveMigrarNaPartida`, e pela mesma razão: um erro de digitação numa variável
 * de deploy não pode ser o que muda o comportamento em silêncio.
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
 * O `motivo` é para leitura humana no corpo do `/startupz` e no log. Ele não
 * classifica nada: quem classifica o banco é `diagnosticar`.
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
}

/**
 * A resposta do probe, sem tocar em banco nenhum.
 *
 * `NAO_INICIADA` retém, e isso é deliberado: entre o `listen` e a primeira
 * linha de `applyMigrationsInBackground` existe um intervalo real, e liberar
 * nele seria reabrir a janela por alguns milissegundos. O teto cobre o caso
 * patológico em que a tentativa nunca começa.
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

  if (terminada) {
    return {
      liberar: true,
      fase,
      motivo: motivoDoFim ?? "A tentativa de partida terminou.",
      esperandoHaMs,
    };
  }

  if (tetoMs === 0) {
    return {
      liberar: true,
      fase,
      motivo:
        `${CHAVE_TETO}=0: este ambiente não retém a promoção. O portão de ` +
        "prontidão continua recusando tráfego de produto até o banco convergir.",
      esperandoHaMs,
    };
  }

  if (esperandoHaMs >= tetoMs) {
    return {
      liberar: true,
      fase,
      motivo:
        `O teto de ${tetoMs} ms foi atingido com a partida ainda em ${fase === "EM_VOO" ? "voo" : "espera"}. ` +
        "A promoção segue para não travar a publicação, e o portão de prontidão " +
        "assume: o tráfego de produto continua recusado até o banco convergir.",
      esperandoHaMs,
    };
  }

  return {
    liberar: false,
    fase,
    motivo:
      fase === "EM_VOO"
        ? "A fila deste build está sendo aplicada neste banco agora."
        : "A partida ainda não começou a aplicar a fila deste build.",
    esperandoHaMs,
  };
}

/**
 * Volta ao começo — só os testes chamam.
 *
 * A suíte exercita "em voo → terminada" e "teto atingido" no mesmo processo, e
 * sem isto o primeiro arquivo fixaria o estado para todos os seguintes.
 */
export function esquecerPartida(agora: number = Date.now()): void {
  comecou = false;
  terminada = false;
  motivoDoFim = undefined;
  inicio = agora;
}
