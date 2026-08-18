import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { esperadoDaVigencia, type PresencaNaVigencia } from "./esperado";
import { candidatoPara, janelaDosAtributos } from "./descoberta";
import {
  atributosObservados,
  entidadesDoAtributo,
  vigenciasObservadas,
} from "./observado";
import { contribuintesDaVigencia } from "./proveniencia";
import { atributoDeclarado } from "@workspace/curation/catalogo-declarado";
import { rosterDaVigencia, type EntidadeAusente } from "./frota";
import { medirCelula, periodoDe, rotuloDaFamilia, rotuloDoEquipamento } from "./matriz";
import type { Contagem, EstadoDeCobertura, Lacuna } from "./modelo";

/**
 * O drill-down: da célula da matriz até a placa, e da placa até o arquivo.
 *
 * A hierarquia é resumo → matriz → exceções → detalhe, e este arquivo cobre os
 * dois últimos degraus. A regra que ele respeita em todos: **mostrar exceção,
 * não despejar registro.** A célula devolve as lacunas ordenadas por quantas
 * entidades cada uma atinge; a lacuna devolve as entidades afetadas com limite;
 * a entidade devolve um fato, e o fato devolve a cadeia inteira.
 *
 * Nenhuma consulta daqui recalcula cobertura por conta própria: a célula chama
 * `medirCelula`, a mesma função da matriz. Se ela devolvesse um número
 * diferente do da matriz, a tela estaria mentindo em um dos dois lugares.
 */

export interface DetalheDaCelula {
  vigencia: {
    snapshotId: string;
    sourceLabel: string;
    effectiveDate: string;
    periodo: string;
    revision: number;
  };
  datasetFamily: string;
  familiaLabel: string;
  entityType: string;
  equipamentoLabel: string;
  scopeLabel: string;
  canal: string;
  estado: EstadoDeCobertura;
  conta: Contagem;
  contaCritica: Contagem;
  /** As lacunas desta célula, piores primeiro. */
  lacunas: Lacuna[];
  /**
   * Os equipamentos que eram esperados aqui e não vieram.
   *
   * A lacuna de atributo responde "o que falta"; esta responde "de quem". As
   * duas juntas são o que separa "o arquivo veio com menos colunas" de "o
   * arquivo veio com menos caminhões" — dois problemas com donos diferentes,
   * que a cobertura antiga somava num percentual só quando somava.
   */
  entidadesAusentes: EntidadeAusente[];
  /** Quais arquivos formaram esta vigência, e com quantos fatos cada um. */
  contribuintes: Awaited<ReturnType<typeof contribuintesDaVigencia>>;
  /** Atributos que chegaram e ninguém esperava. */
  inesperados: { attributeCode: string; attributeLabel: string; entidades: number }[];
}

/** Erro de recusa: a célula pedida não existe. A rota traduz em 404. */
export class CelulaNaoEncontrada extends Error {
  constructor(snapshotId: string, entityType: string) {
    super(`Nenhuma vigência ativa ${snapshotId} com equipamento ${entityType}.`);
    this.name = "CelulaNaoEncontrada";
  }
}

/**
 * Uma célula da matriz, aberta.
 *
 * O candidato a renomeação é preenchido aqui e não em `medirCelula`: ele custa
 * uma varredura de janelas de atributo, que a matriz inteira não deve pagar por
 * célula. Quem abre uma lacuna quer saber se o campo mudou de nome; quem olha a
 * matriz quer saber onde olhar.
 */
export async function detalheDaCelula(
  db: Database,
  snapshotId: string,
  entityType: string,
): Promise<DetalheDaCelula> {
  const [vigencia] = await vigenciasObservadas(db).then((todas) =>
    todas.filter((v) => v.snapshotId === snapshotId),
  );
  if (!vigencia) throw new CelulaNaoEncontrada(snapshotId, entityType);

  /*
    O equipamento pode não estar na vigência **e** a célula existir mesmo assim.

    É o caso do conjunto declarado que nunca chegou: a matriz desenha a linha
    porque o catálogo a declara, e a tela convida a clicar nela — "clique numa
    célula para ver o que falta". Enquanto a ausência do agregado era motivo de
    404, o convite levava a um erro exatamente na célula que mais tinha o que
    explicar. A decisão de existir ou não fica para depois de resolver o
    esperado, logo abaixo: sem equipamento **e** sem expectativa não há célula;
    sem equipamento e com expectativa há, com zero entidades.
  */
  const equipamento = vigencia.equipamentos.find((e) => e.entityType === entityType);

  const observados = (await atributosObservados(db, [snapshotId])).filter(
    (o) => o.entityType === entityType,
  );
  const entidadesPorTipo = new Map(
    vigencia.equipamentos.map((e) => [e.entityType, e.entidades] as const),
  );
  const presenca: PresencaNaVigencia[] = observados.map((o) => ({
    attributeCode: o.attributeCode,
    entityType: o.entityType,
    entidadesComAtributo: o.comValor + o.vazias,
  }));

  /*
    O mesmo roster da matriz, pela mesma razão que a matriz o usa — e por mais
    uma: o drill-down promete abrir "com a mesma conta que a matriz mostrou".
    Duas leituras da mesma célula que resolvessem o denominador de formas
    diferentes dariam dois percentuais para a mesma pergunta, que é o defeito
    que `modelo.ts` chama pelo nome.
  */
  const roster = await rosterDaVigencia(db, vigencia, entidadesPorTipo);

  const { esperados, dispensados } = await esperadoDaVigencia(
    db,
    vigencia,
    presenca,
    roster.esperadasPorTipo,
  );

  const esperadosDoTipo = esperados.filter((e) => e.entityType === entityType);
  if (!equipamento && esperadosDoTipo.length === 0) {
    throw new CelulaNaoEncontrada(snapshotId, entityType);
  }

  const medida = medirCelula({
    esperados: esperadosDoTipo,
    observados,
    dispensados,
    entidadesNaVigencia: equipamento?.entidades ?? 0,
    entidadesEsperadas: roster.esperadasPorTipo.get(entityType),
    ausentes: roster.ausentes.filter((a) => a.entityType === entityType),
  });

  /* Só agora, e só para as lacunas ausentes, o candidato a renomeação. */
  const ausentes = medida.lacunas.filter((l) => l.estado === "AUSENTE");
  if (ausentes.length > 0) {
    const janelas = await janelaDosAtributos(db, {
      datasetFamily: vigencia.datasetFamily,
    });
    const novosDaVigencia = janelas.filter(
      (j) => j.primeiraVigencia === vigencia.effectiveDate,
    );
    for (const lacuna of ausentes) {
      const antiga = janelas.find((j) => j.attributeCode === lacuna.attributeCode);
      if (!antiga) continue;
      /*
        A pergunta é invertida em relação a `descobertas`: lá procura-se o
        antecessor de um campo novo; aqui, o sucessor de um campo que sumiu. O
        mesmo cálculo serve para as duas — basta trocar quem é o novo.
      */
      for (const novo of novosDaVigencia) {
        const candidato = candidatoPara(novo, [antiga]);
        if (candidato && candidato.attributeCode === lacuna.attributeCode) {
          lacuna.possivelSucessor = {
            attributeCode: novo.attributeCode,
            confianca: candidato.confianca,
          };
          lacuna.estado = "ALTERADO";
          lacuna.justificativa = {
            ...lacuna.justificativa,
            motivo:
              `${lacuna.justificativa.motivo} Existia até ${antiga.ultimaVigencia} e deixou de aparecer ` +
              `exatamente quando surgiu ${novo.attributeCode} — ${candidato.motivos.join("; ")}. ` +
              `Confiança ${Math.round(candidato.confianca * 100)}%. É um candidato, não uma conclusão: ` +
              `nada foi remapeado, e a decisão é da Curadoria.`,
            medicao: {
              ...lacuna.justificativa.medicao,
              candidato: novo.attributeCode,
              confianca: candidato.confianca,
            },
          };
          break;
        }
      }
    }
  }

  const esperadosPorCodigo = new Set(esperados.map((e) => e.attributeCode));

  return {
    vigencia: {
      snapshotId: vigencia.snapshotId,
      sourceLabel: vigencia.sourceLabel,
      effectiveDate: vigencia.effectiveDate,
      periodo: periodoDe(vigencia.effectiveDate),
      revision: vigencia.revision,
    },
    datasetFamily: vigencia.datasetFamily,
    familiaLabel: rotuloDaFamilia(vigencia.datasetFamily),
    entityType,
    equipamentoLabel: rotuloDoEquipamento(entityType),
    scopeLabel: vigencia.scopeLabel,
    canal: vigencia.canal,
    estado: medida.estado,
    conta: medida.conta,
    contaCritica: medida.contaCritica,
    lacunas: medida.lacunas.sort(
      (a, b) =>
        b.entidadesFaltando - a.entidadesFaltando ||
        a.attributeCode.localeCompare(b.attributeCode),
    ),
    entidadesAusentes: medida.entidadesAusentes,
    contribuintes: await contribuintesDaVigencia(db, snapshotId),
    inesperados: observados
      .filter((o) => !esperadosPorCodigo.has(o.attributeCode))
      .map((o) => ({
        attributeCode: o.attributeCode,
        attributeLabel: o.attributeLabel,
        entidades: o.comValor + o.vazias,
      }))
      .sort((a, b) => b.entidades - a.entidades),
  };
}

export interface DetalheDaLacuna {
  attributeCode: string;
  attributeLabel: string;
  entityType: string;
  vigencia: { snapshotId: string; sourceLabel: string; effectiveDate: string; periodo: string };
  /** As entidades que não têm o dado, com o motivo de cada uma. */
  entidades: Awaited<ReturnType<typeof entidadesDoAtributo>>;
  /** Quantas ficaram de fora do recorte devolvido. Nunca truncamento silencioso. */
  naoListadas: number;
}

/**
 * As entidades afetadas por uma lacuna.
 *
 * Limitada, e a resposta **diz** que limitou. Uma lista truncada em silêncio é
 * pior do que uma lista curta: quem lê conclui que são essas e só essas.
 */
export async function detalheDaLacuna(
  db: Database,
  snapshotId: string,
  attributeCode: string,
  limite = 200,
): Promise<DetalheDaLacuna | null> {
  /*
    `LEFT JOIN`, e não o produto cartesiano de antes.

    A consulta exigia linha em `attribute` para devolver qualquer coisa, e
    `attribute` só ganha linha na importação, de célula com valor. O resultado
    era que a lacuna mais grave que existe — o atributo declarado que **nunca**
    chegou — era a única que não abria: a matriz a listava, a tela convidava a
    clicar, e o clique dava 404. O rótulo, nesse caso, vem do catálogo, que é
    quem sabe que `trecho.pedagio_cheio` se chama "Pedágio cheio".
  */
  const { rows } = await db.execute<{
    source_label: string;
    effective_date: string;
    code: string | null;
    label: string | null;
    entity_type: string | null;
  }>(sql`
    SELECT s.source_label, s.effective_date::text, a.code,
           coalesce(a.display_name, a.source_name) AS label, a.entity_type
      FROM snapshot s
      LEFT JOIN attribute a ON a.code = ${attributeCode}
     WHERE s.id = ${snapshotId}::uuid
  `);
  const cabecalho = rows[0];
  if (!cabecalho) return null;

  const declarado = atributoDeclarado(attributeCode);
  /* Nem importado nem declarado: o código não é de nada, e 404 é a resposta. */
  if (!cabecalho.code && !declarado) return null;

  const attributeLabel =
    cabecalho.label ?? declarado?.nomeGerencial ?? declarado?.sourceName ?? attributeCode;
  const entityType = cabecalho.entity_type ?? declarado?.entityType ?? "";

  const faltando = await entidadesDoAtributo(db, snapshotId, attributeCode, {
    apenasFaltando: true,
    limite: limite + 1,
  });

  return {
    attributeCode,
    attributeLabel,
    entityType,
    vigencia: {
      snapshotId,
      sourceLabel: cabecalho.source_label,
      effectiveDate: cabecalho.effective_date,
      periodo: periodoDe(cabecalho.effective_date),
    },
    entidades: faltando.slice(0, limite),
    naoListadas: Math.max(0, faltando.length - limite),
  };
}

export interface PontoDoHistorico {
  effectiveDate: string;
  periodo: string;
  sourceLabel: string;
  snapshotId: string;
  entidadesNaVigencia: number;
  comValor: number;
  vazias: number;
  naoAplicaveis: number;
  noLayout: boolean;
  /** `comValor / entidadesNaVigencia`, em pontos percentuais. */
  percentual: number;
}

/**
 * A série de um atributo ao longo das vigências.
 *
 * É o que evidencia a quebra de padrão — sete vigências a 100% e a oitava a
 * 51% — e é lida só de `snapshot_attribute` e `snapshot_entity_type`, sem tocar
 * em `fact`. Uma vigência em que a coluna nem veio no layout aparece com
 * `noLayout: false` e 0%: sumir da série faria a linha do gráfico pular o
 * buraco, que é a informação toda.
 */
export async function historicoDoAtributo(
  db: Database,
  attributeCode: string,
  filtro: { scopeHash?: string; canal?: string | null; limite?: number } = {},
): Promise<PontoDoHistorico[]> {
  const { rows } = await db.execute<{
    snapshot_id: string;
    effective_date: string;
    source_label: string;
    entidades: number;
    value_count: number | null;
    null_count: number | null;
    nao_aplicaveis: number;
    no_layout: boolean;
  }>(sql`
    WITH alvo AS (SELECT id, entity_type FROM attribute WHERE code = ${attributeCode})
    SELECT s.id::text                                        AS snapshot_id,
           s.effective_date::text,
           s.source_label,
           coalesce(agg.entity_count, 0)::int                AS entidades,
           sa.value_count,
           sa.null_count,
           coalesce((
             SELECT count(*) FROM fact f
              WHERE f.snapshot_id = s.id
                AND f.attribute_id = (SELECT id FROM alvo)
                AND f.null_reason = 'NOT_APPLICABLE'
           ), 0)::int                                        AS nao_aplicaveis,
           coalesce(sa.present_in_layout, false)             AS no_layout
      FROM snapshot s
      LEFT JOIN snapshot_entity_type agg
        ON agg.snapshot_id = s.id AND agg.entity_type = (SELECT entity_type FROM alvo)
      LEFT JOIN snapshot_attribute sa
        ON sa.snapshot_id = s.id AND sa.attribute_id = (SELECT id FROM alvo)
     WHERE s.status <> 'SUPERSEDED'
       AND (${filtro.scopeHash ?? null}::text IS NULL OR s.scope_hash = ${filtro.scopeHash ?? null})
       AND (${filtro.canal === undefined ? null : filtro.canal}::text IS NULL
            OR s.canal = ${filtro.canal === undefined ? null : filtro.canal})
       AND agg.entity_type IS NOT NULL
     ORDER BY s.effective_date
  `);

  const pontos = rows.map((r) => {
    const entidades = Number(r.entidades);
    const comValor = Number(r.value_count ?? 0);
    return {
      snapshotId: r.snapshot_id,
      effectiveDate: r.effective_date,
      periodo: periodoDe(r.effective_date),
      sourceLabel: r.source_label,
      entidadesNaVigencia: entidades,
      comValor,
      vazias: Number(r.null_count ?? 0),
      naoAplicaveis: Number(r.nao_aplicaveis),
      noLayout: Boolean(r.no_layout),
      percentual: entidades === 0 ? 0 : Number(((comValor / entidades) * 100).toFixed(1)),
    };
  });

  const limite = filtro.limite ?? 24;
  return pontos.slice(-limite);
}
