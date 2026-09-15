/**
 * Parar uma importação — antes de ela entrar.
 *
 * ---------------------------------------------------------------------------
 * O que faltava
 * ---------------------------------------------------------------------------
 * O pipeline sempre soube recusar (o dado não fecha), sempre soube falhar (o
 * arquivo não abre) e sempre soube esperar (nada entra sem aprovação). O que
 * ele não sabia era **desistir**. Quem mandava o arquivo errado, ou o arquivo
 * certo grande demais, tinha dois gestos: esperar o fim e excluir depois — que
 * é deixar entrar para então tirar —, ou fechar a aba, que não para nada,
 * porque quem trabalha é o servidor e não a aba.
 *
 * Aqui mora o terceiro gesto. Ele vale nos três momentos em que ainda dá:
 *
 *  - **lendo** (PENDING/READING/STAGED) — há um leitor rodando, e ele para no
 *    próximo ponto de checagem;
 *  - **conferida** (PREVIEWED) — não há ninguém trabalhando, então o pedido é
 *    cumprido na hora, pela própria rota;
 *  - **aprovando** (PROMOTING) — há uma transação aberta, e parar é o
 *    `ROLLBACK` que o banco já sabia fazer.
 *
 * Em todos, a promessa é a mesma e é o que faz o gesto ser seguro: **nada
 * entrou**. Cancelar nunca desfaz dado promovido — para isso existe excluir,
 * com a conta do que sai e o motivo obrigatório.
 *
 * ---------------------------------------------------------------------------
 * Cooperativo, e por quê
 * ---------------------------------------------------------------------------
 * Não existe "matar a thread": o trabalho é uma sequência de idas ao banco
 * dentro de um processo que serve outras requisições. Então o pedido é um
 * registro, e quem trabalha o lê nos pontos em que já ia ao banco de qualquer
 * jeito — as publicações de progresso. É por isso que a granularidade de parar
 * é a mesma da barra: alguns por cento de trabalho, nunca o arquivo inteiro.
 *
 * E é por isso que `atendido_em` existe. Entre o clique e a leitura do pedido o
 * trabalho pode ter acabado; nesse caso o run termina como terminaria e o
 * pedido fica registrado sem ter sido atendido — o que a tela diz como "não deu
 * tempo", em vez de mostrar um cancelamento que não cancelou nada.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { importCancelamentoTable, importRunTable } from "@workspace/db";
import { progressoLimpo } from "./progresso";

// `progresso.ts` não importa este módulo de volta — ele recebe o que fazer ao
// detectar o pedido (`aoCancelar`) em vez de conhecer o erro que se lança. É o
// que mantém a medição do progresso sem opinião sobre cancelamento, e este
// arquivo como o único lugar onde "parar" está escrito.

/**
 * Os estados em que ainda há o que parar.
 *
 * É a mesma lista de `import_run_leitura_aberta_uq` — os estados em que o run
 * ainda ocupa o arquivo —, e não por coincidência: parar devolve o arquivo,
 * então o que se pode parar é exatamente o que ainda o segura.
 */
export const CANCELAVEIS = [
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
] as const;

/**
 * Os estados em que ninguém está trabalhando — o pedido se cumpre sozinho.
 *
 * PREVIEWED é a importação parada esperando decisão: não há leitor nem
 * transação aberta, e esperar um ponto de checagem que nunca vem deixaria o
 * cartão dizendo "parando…" para sempre.
 */
const SEM_TRABALHO_EM_CURSO = new Set(["PREVIEWED"]);

/**
 * O que a interrupção larga pelo caminho — e é um erro de propósito.
 *
 * Quem trabalha não confere um sinalizador a cada linha: ele é interrompido de
 * onde estiver, e o `throw` é o que desmonta a pilha inteira, inclusive a
 * transação da promoção. Quem a catalisa em desfecho é `readInBackground` e a
 * promoção em segundo plano, que a reconhecem por instância e escrevem
 * CANCELLED em vez de FAILED.
 */
export class ImportacaoCancelada extends Error {
  constructor(readonly importRunId: string) {
    super(`A importação ${importRunId} foi cancelada por quem a enviou.`);
    this.name = "ImportacaoCancelada";
  }
}

export interface PedidoDeCancelamento {
  /** O estado em que o run estava quando o pedido foi aceito. */
  status: string;
  /** Verdadeiro quando a própria rota já encerrou o run (nada rodava). */
  encerradoAgora: boolean;
}

/**
 * Por que este run não pode ser cancelado agora.
 *
 * Em português e pelo desfecho, como `whyCannotPromote`: quem lê é quem opera,
 * e a pergunta dessa pessoa não é "qual estado do enum" — é "ainda dá?".
 */
export function porQueNaoCancelar(status: string): string | null {
  if ((CANCELAVEIS as readonly string[]).includes(status)) return null;
  switch (status) {
    case "PROMOTED":
      return (
        "Esta importação já entrou: os dados dela estão no sistema. Cancelar não " +
        "desfaz o que foi aprovado — para tirar do acervo, use Excluir, que mostra " +
        "a conta do que sai."
      );
    case "CANCELLED":
      return "Esta importação já foi cancelada.";
    case "FAILED":
    case "ABORTED":
    case "VALIDATION_ERROR":
    case "SKIPPED_DUPLICATE":
    case "SKIPPED_DUPLICATE_DATA":
      return "Esta importação já terminou, então não há trabalho para parar.";
    default:
      return `Esta importação está em ${status.toLowerCase()} e não há o que parar.`;
  }
}

/**
 * Registrar o pedido — e cumpri-lo na hora quando não há ninguém trabalhando.
 *
 * A escrita do pedido vem **antes** de qualquer toque em `import_run`, e a
 * ordem é a correção: numa promoção em curso a linha do run está travada, e
 * inverter deixaria o pedido preso atrás do trabalho que ele interrompe.
 */
export async function pedirCancelamento(
  db: Database,
  importRunId: string,
  quem: { por?: string | null; motivo?: string | null } = {},
): Promise<PedidoDeCancelamento | null> {
  const [run] = await db
    .select({ status: importRunTable.status })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  if (!run) return null;
  if (porQueNaoCancelar(run.status)) {
    return { status: run.status, encerradoAgora: false };
  }

  await db
    .insert(importCancelamentoTable)
    .values({
      importRunId,
      pedidoPor: quem.por ?? null,
      motivo: quem.motivo ?? null,
    })
    // Dois cliques, duas abas: o primeiro pedido é o que fica. Repetir não é
    // erro — é a mesma vontade dita de novo.
    .onConflictDoNothing();

  if (SEM_TRABALHO_EM_CURSO.has(run.status)) {
    const encerrado = await encerrarComoCancelada(db, importRunId);
    return { status: run.status, encerradoAgora: encerrado };
  }

  return { status: run.status, encerradoAgora: false };
}

/**
 * Já pediram para parar?
 *
 * Uma consulta a uma tabela de uma linha por run, pela chave primária. É barata
 * de propósito: quem a chama está no meio do caminho quente, e o custo dela é o
 * preço de poder parar.
 */
export async function cancelamentoPedido(
  db: Database,
  importRunId: string,
): Promise<boolean> {
  const [pedido] = await db
    .select({ importRunId: importCancelamentoTable.importRunId })
    .from(importCancelamentoTable)
    .where(eq(importCancelamentoTable.importRunId, importRunId));
  return pedido !== undefined;
}

/**
 * O ponto de checagem: se pediram para parar, para aqui.
 *
 * Fica entre as etapas do pipeline — nos lugares em que largar o trabalho não
 * deixa nada pela metade que alguém possa ler como pronto.
 */
export async function conferirCancelamento(
  db: Database,
  importRunId: string,
): Promise<void> {
  if (await cancelamentoPedido(db, importRunId)) {
    throw new ImportacaoCancelada(importRunId);
  }
}

/**
 * O desfecho: o run vira CANCELLED e o pedido vira atendido.
 *
 * Só escreve sobre um run que ainda estava cancelável — o `inArray` no `WHERE`
 * é o que impede uma corrida de reescrever um PROMOTED que acabou de comitar.
 * Devolve se de fato encerrou, que é a diferença entre "parei" e "não deu
 * tempo".
 */
export async function encerrarComoCancelada(
  db: Database,
  importRunId: string,
  /*
    A frase vai direto para o cartão, então diz as duas coisas que quem parou
    precisa saber: que nada entrou, e o que fazer para tentar de novo. O
    reenvio puro e simples seria recusado pelo SHA-256 — o arquivo continua
    registrado como recebido —, e é excluir que o devolve. É a mesma saída que
    a varredura de leituras órfãs já indica para um run abortado.
  */
  motivo = "Cancelada por quem enviou o arquivo. Nada deste arquivo entrou no sistema. " +
    "Para enviá-lo de novo, exclua esta importação primeiro — é o que libera o arquivo.",
): Promise<boolean> {
  const encerrados = await db
    .update(importRunTable)
    .set({
      status: "CANCELLED",
      failureReason: motivo,
      finishedAt: new Date(),
      promocaoEm: null,
      // O progresso descrevia um trabalho que não continua: mantê-lo deixaria
      // uma barra em 38% ao lado de "cancelada".
      ...progressoLimpo(),
    })
    .where(
      sql`${importRunTable.id} = ${importRunId} AND ${inArray(
        importRunTable.status,
        [...CANCELAVEIS],
      )}`,
    )
    .returning({ id: importRunTable.id });

  if (encerrados.length === 0) return false;

  await db
    .update(importCancelamentoTable)
    .set({ atendidoEm: new Date() })
    .where(eq(importCancelamentoTable.importRunId, importRunId));
  return true;
}
