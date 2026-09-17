/**
 * O ADAPTADOR — a porta do realizado, com o acervo do outro lado.
 *
 * ---------------------------------------------------------------------------
 * O arquivo que `realizado-de-finame.ts` disse que faltava
 * ---------------------------------------------------------------------------
 * Aquele módulo declarou o contrato `FonteDoRealizado` e escreveu, com todas as
 * letras, o que faltava: *"o que falta é **um** arquivo: um adaptador que
 * implemente `FonteDoRealizado`. Tudo o mais — consolidação mensal, confronto,
 * cartões, tabela, gráficos, rotas, permissões — já está escrito, testado, e não
 * sabe de onde o número vem."*
 *
 * Este é o arquivo. O que ele lê é o acervo `FINANCIAMENTO_REAL` que a
 * importação do extrato do ERP passou a produzir — vigências mensais, um fato
 * por (competência, placa), com os lançamentos contábeis por trás de cada um.
 *
 * ---------------------------------------------------------------------------
 * Por que ele lê o **fato**, e só o fato
 * ---------------------------------------------------------------------------
 * Porque o fato é a autoridade do produto sobre o que é verdade numa vigência:
 * ele passa por `fato_visivel`, que esconde o que uma importação ocultada
 * trouxe, e é dele que todas as outras telas falam. Uma segunda régua — somar os
 * lançamentos de novo aqui — devolveria outro número: o consolidado é arredondado
 * ao centavo por grupo, e a soma crua dos lançamentos difere dele por frações.
 * Foi o que o teste pegou: R$ 21.803,015 contra os R$ 21.803,02 que a vigência
 * guarda, e um centavo de discordância entre duas telas sobre o mesmo mês é
 * exatamente o defeito que este produto não admite.
 *
 * O **bruto** sai do mesmo fato, com o sinal do razão de volta. O contrato pede
 * o número "como a origem o entregou", e o que a origem entregou é débito —
 * negativo. Ele vale ao centavo, que é a precisão do consolidado; quem precisa
 * dos três e quatro decimais do razão, ou do documento que compõe cada valor,
 * abre o rastreio (`GET /financiamento-real/lancamentos`), onde cada lançamento
 * está com o `valor_original` intacto.
 *
 * ---------------------------------------------------------------------------
 * A convenção de sinal é declarada, e é `CUSTO_NEGATIVO`
 * ---------------------------------------------------------------------------
 * O razão do ERP lança o financiamento a crédito e entrega `VLRREA` negativo —
 * 903 linhas de 903 no extrato de 2026. Declarar em vez de inferir é o que o
 * contrato exige, e a razão está escrita lá: inferir pela maioria funcionaria
 * até o mês em que a operação tivesse um estorno, e aí o dinheiro que voltou
 * entraria como custo.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type { Competencia } from "./competencia-de-finame";
import {
  normalizarSinal,
  type EscopoDoRealizado,
  type FonteDoRealizado,
  type IndisponibilidadeDoRealizado,
  type ValorRealizado,
} from "./realizado-de-finame";

/** A família do acervo que este adaptador lê. Uma só, e nomeada. */
const FAMILIA_DO_REAL = "FINANCIAMENTO_REAL";

/**
 * Quando o acervo existe mas ainda não tem aquela competência.
 *
 * Diferente de `SEM_FONTE`: aqui há fonte, ela respondeu, e o mês não está lá.
 * A tela escreve coisas diferentes para os dois, e é por isso que o contrato
 * separa os motivos.
 */
function semCompetencia(competencia: Competencia): IndisponibilidadeDoRealizado {
  return {
    motivo: "SEM_COMPETENCIA",
    frase: `O extrato do financiamento ainda não foi importado para ${competencia}.`,
    oQueFalta:
      "O razão contábil daquele mês, enviado pela aba Real da tela de Importações — " +
      "ver docs/IMPORTACAO-FINAME-REAL.md.",
  };
}

/**
 * O recorte que toda pergunta carrega, em SQL.
 *
 * O escopo vem por requisição e nunca fica guardado na fonte: a mesma instância
 * responde a duas pessoas com acesso a unidades diferentes, e uma fonte que
 * lembrasse do escopo da última pergunta é a forma exata do vazamento entre
 * unidades. É o contrato dizendo isso, e este `WHERE` é o cumprimento dele.
 */
function recorte(escopo: EscopoDoRealizado) {
  const tipos = escopo.entityTypes.filter((t) => t.trim() !== "");
  return sql`
    s.dataset_family = ${FAMILIA_DO_REAL}
    AND s.granularidade = 'MENSAL'
    AND s.status <> 'SUPERSEDED'
    ${escopo.scopeHash ? sql`AND s.scope_hash = ${escopo.scopeHash}` : sql``}
    ${escopo.canal ? sql`AND s.canal = ${escopo.canal}` : sql``}
    ${
      tipos.length > 0
        ? sql`AND e.entity_type IN (${sql.join(
            tipos.map((t) => sql`${t}`),
            sql`, `,
          )})`
        : sql``
    }
  `;
}

/**
 * A fonte do realizado lida do acervo deste FreightCheck.
 *
 * Recebe o `db` em vez de importá-lo: `@workspace/comparison` é lido pelo
 * servidor e pelo navegador, e um `import { db }` aqui arrastaria o `pg` para
 * dentro do bundle da tela. É a mesma razão pela qual as demais consultas desta
 * biblioteca recebem a conexão por parâmetro.
 */
export function fonteRealDoAcervo(db: Pick<Database, "execute">): FonteDoRealizado {
  return {
    nome: "acervo-financiamento-real",
    convencaoDeSinal: "CUSTO_NEGATIVO",

    async competenciasDisponiveis(escopo) {
      const { rows } = await db.execute<{ competencia: string }>(sql`
        SELECT DISTINCT to_char(s.effective_date, 'YYYY-MM') AS competencia
          FROM snapshot s
          JOIN fato_visivel f ON f.snapshot_id = s.id
          JOIN entity e ON e.id = f.entity_id
          JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
         WHERE ${recorte(escopo)}
         ORDER BY 1
      `);
      return { competencias: rows.map((r) => r.competencia) };
    },

    async valoresDaCompetencia(escopo, competencia) {
      const { rows } = await db.execute<{
        placa: string;
        entity_type: string;
        valor: string | null;
      }>(sql`
        SELECT ident.identifier_value AS placa,
               e.entity_type,
               f.value_numeric::text AS valor
          FROM snapshot s
          JOIN fato_visivel f ON f.snapshot_id = s.id
          JOIN entity e ON e.id = f.entity_id
          JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
          JOIN entity_identifier ident
            ON ident.entity_id = f.entity_id
           AND ident.identifier_type = 'PLACA'
           AND ident.is_current
         WHERE ${recorte(escopo)}
           AND to_char(s.effective_date, 'YYYY-MM') = ${competencia}
           AND NOT f.is_null
      `);

      /*
        Zero linha aqui é "este mês não está no acervo", e não "este mês custou
        nada". A diferença importa: lista vazia a tela desenharia como um mês sem
        movimento, e é exatamente o que o contrato manda não fazer.
      */
      if (rows.length === 0) return { indisponivel: semCompetencia(competencia) };

      const valores: ValorRealizado[] = rows.map((r) => {
        /*
          O bruto é o consolidado com o sinal do razão de volta.

          Não é uma reconstrução: o consolidado **é** a soma dos lançamentos com
          o sinal invertido (ver `apurar`, em `@workspace/ingest`), de modo que
          desfazer a inversão devolve o que o razão escreveu, ao centavo. E
          `valor` sai daqui por `normalizarSinal`, e não da consulta, para que a
          relação entre os dois campos continue sendo a que o contrato declara —
          não duas leituras que por acaso coincidem.
        */
        const bruto = r.valor === null ? null : -Number(r.valor);
        return {
          competencia,
          entityLabel: r.placa,
          entityType: r.entity_type,
          valor: normalizarSinal(bruto, "CUSTO_NEGATIVO"),
          bruto,
        };
      });

      return { valores };
    },
  };
}
