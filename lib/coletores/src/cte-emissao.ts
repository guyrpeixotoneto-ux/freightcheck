import { eq, sql } from "drizzle-orm";
import { fechamentoCteTable, type Database } from "@workspace/db";
import type { Coletor, Leitura, PedidoDeColeta } from "@workspace/fluxos/monitoramento";
import {
  documentoDaQuinzena,
  farolDaPresenca,
  VALIDADE_DA_QUINZENA_EM_SEGUNDOS,
} from "./fonte-da-quinzena";

/**
 * `cte.emissao` — a etapa "Emissão do CTe", medida pelo extrato que já se importa.
 *
 * ===========================================================================
 * 1. A fonte, e por que ela responde por esta etapa
 * ===========================================================================
 *
 * A etapa "Emissão do CTe" tem por objetivo *"gerar o documento fiscal da
 * prestação a partir do que foi contratado e coletado"*, e o indicador que ela
 * mesma declara é *"CTes emitidos no dia"* (`exemplos/cte-ate-recebimento.ts`).
 *
 * A fonte disso neste banco é **uma só**: `fechamento_cte`, o relatório 03.08.15
 * do Promax — literalmente "os CT-es emitidos, verba a verba", importado por
 * quinzena. Não há segunda tabela de CT-e no schema, e este coletor não cria
 * nenhuma: ele conta a que existe.
 *
 * O casamento entre a etapa e a fonte é direto, e é o mais direto dos cinco que
 * a Prioridade 1 propunha: a etapa pergunta se houve emissão, e o arquivo é a
 * lista do que foi emitido.
 *
 * ===========================================================================
 * 2. A régua, por extenso
 * ===========================================================================
 *
 *  VERDE     O extrato CTE vigente da competência mais recente da empresa traz
 *            pelo menos um CT-e, e o leitor não recusou nenhuma linha dele.
 *            Afirma: houve emissão na quinzena, e o registro dela está completo.
 *
 *  AMARELO   O mesmo extrato traz CT-es **e** o leitor recusou linhas.
 *            Afirma: houve emissão, e há linha do arquivo fora da conta — pode
 *            haver CT-e emitido que este acervo não contabilizou. Não é um
 *            percentual escolhido: o limiar é "existe recusa", porque uma linha
 *            recusada ou está lá ou não está.
 *
 *  SEM_DADO  Tudo o mais, e é o **motor** que decide, não este arquivo: a
 *            empresa não tem competência, o extrato não chegou, o extrato chegou
 *            vazio, ou o último extrato é mais velho que a validade. O coletor
 *            simplesmente não devolve leitura.
 *
 *  VERMELHO  **Não existe**, e a ausência é decisão. Ver `farolDaPresenca` em
 *            `fonte-da-quinzena.ts`: um extrato sem CT-e é a ausência do fato, e
 *            não um fato ruim — a quinzena em que ninguém importou nada é um
 *            problema do fechamento, não da emissão, e acusar a emissão por ele
 *            seria apontar o dedo para o lado errado da casa.
 *
 * ===========================================================================
 * 3. O que este farol NÃO diz
 * ===========================================================================
 *
 * Ele não mede tempo de emissão, não vê CT-e cancelado, não sabe se o tomador
 * está certo e não conhece o que *deveria* ter sido emitido — não há no acervo
 * o denominador de prestações encerradas contra o qual comparar. Verde aqui
 * significa "a quinzena teve emissão registrada e íntegra", e a frase que vai
 * para a tela (`texto`) diz isso com essas palavras, para que ninguém leia
 * "faturamento em dia" onde está escrito "houve emissão".
 */

/** A chave da etapa "Emissão do CTe" — a única que este coletor reivindica. */
export const CHAVE_DA_EMISSAO = "cte.emissao";

export function coletorDeEmissaoDeCte(db: Database): Coletor {
  return {
    nome: "emissao-no-extrato-03.08.15",
    prefixos: [CHAVE_DA_EMISSAO],
    async ler(pedido: PedidoDeColeta): Promise<readonly Leitura[]> {
      if (!pedido.chaves.includes(CHAVE_DA_EMISSAO)) return [];

      const documento = await documentoDaQuinzena(db, pedido.empresaId, "CTE");
      if (!documento) return [];

      const [contagem] = await db
        .select({
          ctes: sql<number>`count(*)::int`,
          valor: sql<number>`coalesce(sum(${fechamentoCteTable.valorCte}), 0)::float8`,
        })
        .from(fechamentoCteTable)
        .where(eq(fechamentoCteTable.documentoId, documento.documentoId));

      const ctes = contagem?.ctes ?? 0;
      /* Extrato vigente e sem uma linha: ausência do fato, e não fato ruim. */
      if (ctes === 0) return [];

      return [
        {
          chave: CHAVE_DA_EMISSAO,
          farol: farolDaPresenca(documento.recusas),
          medidoEm: documento.enviadoEm.toISOString(),
          validadeEmSegundos: VALIDADE_DA_QUINZENA_EM_SEGUNDOS,
          valor: ctes,
          unidade: "CT-e",
          texto: frase(documento.competencia, ctes, contagem?.valor ?? 0, documento.recusas),
        },
      ];
    },
  };
}

/** A frase da etapa: o que foi medido, e o que não foi. */
function frase(
  competencia: string,
  ctes: number,
  valor: number,
  recusas: number,
): string {
  const dinheiro = valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
  const base =
    `${ctes.toLocaleString("pt-BR")} CT-es no extrato 03.08.15 de ${competencia}, ` +
    `somando ${dinheiro}`;
  const ressalva =
    recusas === 0
      ? "sem linha recusada na leitura"
      : `${recusas} linha(s) do arquivo recusada(s) na leitura — pode haver CT-e fora desta conta`;
  return `${base}; ${ressalva}. Mede emissão registrada, não prazo nem cancelamento.`;
}
