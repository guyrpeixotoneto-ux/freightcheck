import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { equipmentLabel } from "./labels";
import {
  contextFilter,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
} from "./series";

/**
 * A frota de um equipamento — quem existe, antes de perguntar o que mudou.
 *
 * É a leitura que as telas Cavalo 360° e Carreta 360° precisam para oferecer a
 * escolha de uma placa, e ela não sai de nenhuma das quatro leituras de
 * Alterações. A razão é a mesma que fez a aba Impacto existir: uma lista de
 * alterações só conhece o ativo que mudou, e um seletor montado a partir dela
 * ofereceria uma frota menor do que a real — quem procurasse a placa do cavalo
 * parado no pátio concluiria que ele não está na base.
 *
 * Então a fonte é a presença: um ativo está na frota da vigência em que ele tem
 * **qualquer** fato, e não na vigência em que algum parâmetro escolhido tem
 * valor. É a mesma régra de `impacto.ts`, e pela mesma razão — uma coluna que
 * sumiu do layout não tira ativo da frota.
 *
 * A placa vem do identificador corrente. Um ativo sem placa aparece mesmo
 * assim, com `plate: null`: ele existe, é remunerado, e some-lo do seletor
 * faria a soma da tela não fechar com a da frota inteira.
 */

export interface AtivoDaFrota {
  entityId: string;
  /** A placa corrente. Null quando o ativo não tem identificador de placa. */
  plate: string | null;
  chassi: string | null;
  /** Em quantas vigências do contexto o ativo aparece. */
  periods: number;
  /** A primeira e a última vigência em que apareceu, pelo rótulo do arquivo. */
  firstLabel: string;
  lastLabel: string;
  /**
   * Está na vigência mais recente que entregou este equipamento?
   *
   * É o que separa "saiu da frota" de "está lá e não mudou" no seletor. Sem
   * isso, um ativo devolvido em março continuaria oferecido como se fosse
   * escolha corrente, e quem o escolhesse veria uma tela vazia sem uma palavra
   * dizendo por quê.
   */
  current: boolean;
}

export interface FrotaDoEquipamento {
  context: ContextInfo;
  entityType: string;
  equipment: string;
  /** Os equipamentos que este contexto entregou — para a tela recusar o resto. */
  entityTypes: string[];
  /** A vigência mais recente que entregou este equipamento, quando houve uma. */
  latestLabel: string | null;
  ativos: AtivoDaFrota[];
}

export interface OpcoesDaFrota {
  entityType: string;
  context?: RequestedContext;
}

/**
 * A frota de um equipamento no contexto pedido.
 *
 * Devolve `null` quando o contexto não tem vigência nenhuma — a rota traduz em
 * 404, como as outras leituras desta tela, e o convite a importar aparece no
 * lugar de um seletor vazio.
 */
export async function listarFrota(
  db: Database,
  options: OpcoesDaFrota,
): Promise<FrotaDoEquipamento | null> {
  const context = await resolveContext(db, options.context);
  if (!context) return null;

  const { rows: tipos } = await db.execute<{ t: string }>(sql`
    SELECT DISTINCT t
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     ORDER BY 1
  `);
  const entityTypes = tipos.map((t) => t.t);
  const entityType = options.entityType;

  const { rows: ultima } = await db.execute<{ source_label: string }>(sql`
    SELECT string_agg(DISTINCT s.source_label, ' · ') AS source_label
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND ${entityType} = ANY (string_to_array(s.entity_type_set, '+'))
       AND ${contextFilter("s", context)}
     GROUP BY s.effective_date
     ORDER BY s.effective_date DESC
     LIMIT 1
  `);
  const latestLabel = ultima[0]?.source_label ?? null;

  /*
    Uma varredura só, e a presença medida por `fact`.

    O `DISTINCT` sobre (ativo, vigência) é o que impede a contagem de virar
    número de fatos: um cavalo com quarenta colunas preenchidas aparece uma vez
    na vigência, não quarenta. `min`/`max` pela data e não pelo rótulo — o
    rótulo do arquivo não ordena cronologicamente ("EMPURRADA_1_8" vem antes de
    "EMPURRADA_2_7" no alfabeto).
  */
  const { rows } = await db.execute<{
    entity_id: string;
    plate: string | null;
    chassi: string | null;
    periods: number;
    first_label: string;
    last_label: string;
    last_date: string;
  }>(sql`
    WITH presenca AS (
      SELECT DISTINCT f.entity_id, s.effective_date, s.source_label
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
        JOIN entity e   ON e.id = f.entity_id
       WHERE e.entity_type = ${entityType}
         AND s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
    )
    SELECT p.entity_id::text AS entity_id,
           max(i.identifier_value) FILTER (WHERE i.identifier_type = 'PLACA')  AS plate,
           max(i.identifier_value) FILTER (WHERE i.identifier_type = 'CHASSI') AS chassi,
           count(DISTINCT p.effective_date)::int AS periods,
           (array_agg(p.source_label ORDER BY p.effective_date ASC))[1]  AS first_label,
           (array_agg(p.source_label ORDER BY p.effective_date DESC))[1] AS last_label,
           max(p.effective_date)::text AS last_date
      FROM presenca p
      LEFT JOIN entity_identifier i
        ON i.entity_id = p.entity_id AND i.is_current
     GROUP BY p.entity_id
  `);

  const ultimaData = rows.reduce<string | null>(
    (maior, r) => (maior === null || r.last_date > maior ? r.last_date : maior),
    null,
  );

  const ativos: AtivoDaFrota[] = rows
    .map((r) => ({
      entityId: r.entity_id,
      plate: r.plate,
      chassi: r.chassi,
      periods: r.periods,
      firstLabel: r.first_label,
      lastLabel: r.last_label,
      current: r.last_date === ultimaData,
    }))
    /*
      Ordem de placa, numérica-aware: `QYW2D78` e `QYW10D78` lado a lado no
      seletor precisam sair em ordem humana. Quem não tem placa vai para o fim —
      é a caixa do que não dá para nomear, e ela não pode abrir a lista.
    */
    .sort((a, b) => {
      if ((a.plate === null) !== (b.plate === null)) return a.plate === null ? 1 : -1;
      return (a.plate ?? "").localeCompare(b.plate ?? "", "pt-BR", { numeric: true });
    });

  return {
    context,
    entityType,
    equipment: equipmentLabel(entityType),
    entityTypes,
    latestLabel,
    ativos,
  };
}
