import { eq, sql } from "drizzle-orm";
import { fechamentoViagemTable, type Database } from "@workspace/db";
import type { Coletor, Leitura, PedidoDeColeta } from "@workspace/fluxos/monitoramento";
import {
  documentoDaQuinzena,
  farolDaPresenca,
  VALIDADE_DA_QUINZENA_EM_SEGUNDOS,
} from "./fonte-da-quinzena";

/**
 * `operacao.transporte` — a etapa "Transporte / acompanhamento", medida pelo
 * diário operacional que já se importa.
 *
 * ===========================================================================
 * 1. A fonte, e o eixo que ela de fato responde
 * ===========================================================================
 *
 * A etapa "Transporte / acompanhamento" tem por objetivo *"acompanhar a viagem
 * até a entrega e tratar o que sair do previsto"*, e o gargalo que a operação
 * levantou nela é explícito: *"Ocorrência sem registro — a informação existe no
 * WhatsApp e não no sistema"* (`exemplos/cte-ate-recebimento.ts`).
 *
 * **Esse gargalo é o eixo que este coletor mede: está registrado?** A fonte é
 * `fechamento_viagem`, o 2Art — o diário operacional, uma linha por viagem, com
 * dia, canal, frota, placa, entregas e caixas. Uma quinzena com viagens lançadas
 * é uma quinzena em que a operação chegou ao sistema; uma sem é a que o gargalo
 * descreve.
 *
 * ===========================================================================
 * 2. A régua, por extenso
 * ===========================================================================
 *
 *  VERDE     O documento OPERACAO vigente da competência mais recente da empresa
 *            traz pelo menos uma viagem, e o leitor não recusou nenhuma linha.
 *            Afirma: a operação da quinzena está registrada, e o registro está
 *            completo.
 *
 *  AMARELO   O mesmo, e o leitor recusou linhas do arquivo. Afirma: há operação
 *            registrada e há linha do diário fora da conta.
 *
 *  SEM_DADO  Sem competência, sem 2Art vigente, diário sem uma linha, ou o
 *            último diário mais velho que a validade. Decisão do motor; o
 *            coletor cala.
 *
 *  VERMELHO  **Não existe.** Uma quinzena sem viagem lançada pode ser uma
 *            quinzena sem operação — e não há neste acervo nada que diga quantas
 *            viagens *deveriam* ter existido. Sem denominador não há afirmação
 *            negativa possível, e inventar uma faria a etapa acusar a operação
 *            de um problema do fechamento.
 *
 * ===========================================================================
 * 3. O que este farol NÃO diz — e é muito
 * ===========================================================================
 *
 * A etapa declara o indicador *"% de entregas no prazo"*, e **este coletor não o
 * mede**. O 2Art traz hora de saída, hora de entrada e tempo previsto, mas as
 * durações chegam como texto e na mesma coluna convivem `9:14` e `0:37:00`
 * (ver `fechamento_viagem`, no schema): interpretá-las seria decidir, sem fonte,
 * qual das duas grafias o Promax quis dizer — e um percentual de pontualidade
 * construído sobre esse palpite é pior do que nenhum, porque tem cara de
 * medição.
 *
 * Verde aqui significa **"a operação da quinzena está lançada no diário"**, e
 * nada além. Não diz que as entregas foram no prazo, não vê avaria, não vê
 * sinistro e não sabe se houve ocorrência não registrada — que é, aliás, o único
 * caso que este farol por construção jamais pode acusar. A frase que vai para a
 * tela diz isso com todas as letras.
 */

/** A chave da etapa "Transporte / acompanhamento". */
export const CHAVE_DO_TRANSPORTE = "operacao.transporte";

export function coletorDeTransporte(db: Database): Coletor {
  return {
    nome: "diario-operacional-2art",
    prefixos: [CHAVE_DO_TRANSPORTE],
    async ler(pedido: PedidoDeColeta): Promise<readonly Leitura[]> {
      if (!pedido.chaves.includes(CHAVE_DO_TRANSPORTE)) return [];

      const documento = await documentoDaQuinzena(db, pedido.empresaId, "OPERACAO");
      if (!documento) return [];

      const [contagem] = await db
        .select({
          viagens: sql<number>`count(*)::int`,
          entregas: sql<number>`coalesce(sum(${fechamentoViagemTable.entregas}), 0)::int`,
          dias: sql<number>`count(distinct ${fechamentoViagemTable.dia})::int`,
        })
        .from(fechamentoViagemTable)
        .where(eq(fechamentoViagemTable.documentoId, documento.documentoId));

      const viagens = contagem?.viagens ?? 0;
      /* Diário vigente e vazio: ausência do fato, não fato ruim. */
      if (viagens === 0) return [];

      return [
        {
          chave: CHAVE_DO_TRANSPORTE,
          farol: farolDaPresenca(documento.recusas),
          medidoEm: documento.enviadoEm.toISOString(),
          validadeEmSegundos: VALIDADE_DA_QUINZENA_EM_SEGUNDOS,
          valor: viagens,
          unidade: "viagens",
          texto: frase(
            documento.competencia,
            viagens,
            contagem?.entregas ?? 0,
            contagem?.dias ?? 0,
            documento.recusas,
          ),
        },
      ];
    },
  };
}

/** A frase da etapa: o que foi medido, e o que este farol não alcança. */
function frase(
  competencia: string,
  viagens: number,
  entregas: number,
  dias: number,
  recusas: number,
): string {
  const base =
    `${viagens.toLocaleString("pt-BR")} viagens em ${dias} dia(s) no 2Art de ` +
    `${competencia}, com ${entregas.toLocaleString("pt-BR")} entregas`;
  const ressalva =
    recusas === 0
      ? "sem linha recusada na leitura"
      : `${recusas} linha(s) do diário recusada(s) na leitura — há operação fora desta conta`;
  return `${base}; ${ressalva}. Mede operação registrada, não pontualidade nem ocorrência.`;
}
