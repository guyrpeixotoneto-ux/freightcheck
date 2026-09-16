import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { periodLabel, type RequestedContext } from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest";
import { filtroDosEscopos, resolverContextoDoQuadro } from "./contexto";

/**
 * A LEITURA QUE A AUDITORIA DO QUADRO FAZ — pela família do quadro de pessoal.
 *
 * ---------------------------------------------------------------------------
 * Por que ela não é `getEntityTable`
 * ---------------------------------------------------------------------------
 * Era. E a tela de Auditoria vinha vazia com o arquivo importado, nos dois
 * quadros, porque `getEntityTable` resolve o contexto pelo padrão do produto —
 * e o padrão é `REMUNERACAO_EQUIPAMENTO` (`datasetFamilyFilter`, em
 * `lib/comparison/src/series.ts`). O QLP forma vigências **próprias**, na mesma
 * unidade e no mesmo canal, numa família própria: com o filtro de equipamento,
 * a data mais recente do contexto era a do cavalo, e nenhuma linha de cargo
 * caía nela. Pedindo uma quinzena de QLP por `?period=`, a consulta não achava
 * snapshot nenhum e a rota respondia 404 — "nenhuma vigência importada" para um
 * acervo com seis delas.
 *
 * As outras três leituras deste pacote nunca tiveram esse defeito porque todas
 * passam por {@link resolverContextoDoQuadro}, que lista contextos da família
 * do quadro. Esta leitura passa a fazer o mesmo, e é só isso que ela muda: as
 * contas continuam inteiras em `@workspace/comparison/qlp`, e a rota continua
 * sem fazer conta nenhuma.
 *
 * ---------------------------------------------------------------------------
 * Consolidada, como o resto do quadro
 * ---------------------------------------------------------------------------
 * Uma planilha de QLP traz várias unidades, e o snapshot é particionado por
 * `scope_hash`. Prender a consulta ao escopo do contexto de referência faria a
 * Auditoria conferir os cargos de uma unidade enquanto a aba do Quadro, ao
 * lado, conta os de todas — dois números para a mesma vigência, na mesma tela.
 * Por isso o filtro é `filtroDosEscopos`, o mesmo de `getQuadroAdministrativo`.
 */

/** Uma linha do quadro, como a auditoria a lê: a chave, o nome e os valores. */
export interface LinhaLidaDoQuadro {
  /** A chave normalizada da entidade — `07526557001505CARGOGERENTE…`. */
  chave: string;
  /** A chave como o arquivo a escreveu, quando difere da normalizada. */
  nome: string | null;
  /** `attribute.code` → valor declarado, como texto. Ausente = célula vazia. */
  valores: Record<string, string | null>;
}

export interface QuadroParaAuditoria {
  effectiveDate: string;
  periodLabel: string;
  /**
   * Se a vigência aberta entregou o arquivo **deste** quadro.
   *
   * Falso é um estado legítimo e diferente de vazio: o administrativo chegou e
   * o operacional não, na mesma quinzena. A tela distingue os dois.
   */
  serieEntregue: boolean;
  /** Códigos pedidos que o dicionário não conhece — contas sem base. */
  colunasDesconhecidas: string[];
  linhas: LinhaLidaDoQuadro[];
}

type FatoLido = {
  entity_id: string;
  identifier_value: string;
  identifier_value_raw: string | null;
  code: string;
  valor: string | null;
  is_null: boolean;
};

/**
 * O quadro de uma vigência, nas colunas pedidas.
 *
 * `null` quando o acervo não tem vigência nenhuma deste quadro — a rota traduz
 * em 404, e a tela mostra o estado que diz isso por extenso. Note que o `null`
 * é sobre **o quadro**, e não sobre a quinzena aberta: importado o
 * administrativo e não o operacional, a tela do operacional continua dizendo
 * que o arquivo dele não chegou, que é a verdade.
 */
export async function lerQuadroParaAuditoria(
  db: Database,
  entityType: string,
  codigos: string[],
  options: { period?: string; context?: RequestedContext } = {},
): Promise<QuadroParaAuditoria | null> {
  if (codigos.length === 0) return null;

  const resolvido = await resolverContextoDoQuadro(db, {
    ...options.context,
    ...(options.period !== undefined ? { period: options.period } : {}),
  });
  if (!resolvido) return null;
  const { escopos, effectiveDate } = resolvido;

  /*
    O quadro existe no acervo? — e não "nesta quinzena".

    São perguntas diferentes e a segunda já tem resposta própria
    (`serieEntregue`). Devolver `null` porque a quinzena aberta não traz este
    quadro faria a tela dizer "nenhuma vigência importada" a quem acabou de
    importar seis, só porque parou numa data em que o outro quadro entregou
    sozinho.
  */
  const { rows: vigenciasDoTipo } = await db.execute<{
    effective_date: string;
  }>(sql`
    SELECT s.effective_date::text AS effective_date
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${entityType} = ANY (string_to_array(s.entity_type_set, '+'))
       AND ${filtroDosEscopos("s", escopos)}
  `);
  if (vigenciasDoTipo.length === 0) return null;

  const lista = sql.join(
    codigos.map((code) => sql`${code}`),
    sql`, `,
  );

  const { rows: conhecidas } = await db.execute<{ code: string }>(sql`
    SELECT code FROM attribute WHERE code IN (${lista})
  `);
  const existe = new Set(conhecidas.map((c) => c.code));

  const { rows } = await db.execute<FatoLido>(sql`
    SELECT f.entity_id::text AS entity_id,
           ei.identifier_value,
           ei.identifier_value_raw,
           a.code,
           CASE WHEN f.is_null THEN NULL
                ELSE coalesce(
                  f.value_text,
                  f.value_numeric::text,
                  f.value_boolean::text,
                  f.value_date::text
                )
           END AS valor,
           f.is_null
      FROM fato_visivel f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
      JOIN entity_identifier ei
        ON ei.entity_id = e.id
       AND ei.identifier_type = 'PLACA'
       AND ei.is_current
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.code IN (${lista})
       AND e.entity_type = ${entityType}
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND s.effective_date = ${effectiveDate}::date
       AND ${filtroDosEscopos("s", escopos)}
     ORDER BY ei.identifier_value_raw, a.code
  `);

  const porEntidade = new Map<string, LinhaLidaDoQuadro>();
  for (const fato of rows) {
    let linha = porEntidade.get(fato.entity_id);
    if (!linha) {
      /*
        A forma legível só entra quando é **diferente** da normalizada, como em
        `getEntityTable`: repetir a chave num campo que a tela chama de nome
        faria o cargo aparecer como `07526557001505CARGOGERENTE…`.
      */
      linha = {
        chave: fato.identifier_value,
        nome:
          fato.identifier_value_raw !== null &&
          fato.identifier_value_raw !== fato.identifier_value
            ? fato.identifier_value_raw
            : null,
        valores: {},
      };
      porEntidade.set(fato.entity_id, linha);
    }
    linha.valores[fato.code] = fato.is_null ? null : fato.valor;
  }

  return {
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    serieEntregue: vigenciasDoTipo.some((v) => v.effective_date === effectiveDate),
    colunasDesconhecidas: codigos.filter((code) => !existe.has(code)),
    linhas: [...porEntidade.values()].sort((a, b) =>
      (a.nome ?? a.chave).localeCompare(b.nome ?? b.chave, "pt-BR", { numeric: true }),
    ),
  };
}
