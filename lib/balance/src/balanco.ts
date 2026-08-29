import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { classificacao, semJit } from "./classificacao";
import {
  destino as descreverDestino,
  ORDEM_DESTINOS,
  type Destino,
  type DestinoCode,
  type DestinoNatureza,
} from "./destinos";

/**
 * Rastreio de Dados — a conta de conservação da importação (o balanço de
 * massa).
 *
 * O produto inteiro se apoia numa promessa: nenhum número aparece sem que se
 * consiga segui-lo até a célula da planilha de origem. Este módulo faz a
 * pergunta inversa, que ninguém estava fazendo: **toda célula da planilha de
 * origem chegou a algum lugar?**
 *
 * São perguntas diferentes e as duas precisam de resposta. A primeira protege
 * contra número inventado; a segunda, contra dado que sumiu — e dado que some
 * não deixa rastro nenhum na tela, porque o que falta não aparece. Uma coluna
 * que a Freightec renomeou e o leitor deixou de reconhecer não produz erro:
 * produz um total menor, com todas as parcelas exibidas conferindo entre si.
 *
 * A conta tem três etapas, e cada uma fecha (ou não fecha) por conta própria:
 *
 * 1. **Arquivo → STAGING**, célula a célula. Toda célula capturada em RAW tem
 *    de sair por um dos destinos declarados em `destinos.ts`. O que sobra é
 *    resíduo, e resíduo diferente de zero é defeito.
 * 2. **STAGING → CANÔNICO**, fato a fato, por vigência. O que foi preparado
 *    tem de estar promovido — ou a importação tem de dizer por que não está.
 * 3. **CANÔNICO → o que pode virar dinheiro**, pelo portão da semântica. Fato
 *    promovido cuja semântica não foi confirmada existe, é conferível, e ainda
 *    assim não pode entrar numa soma. Essa massa não sumiu: ela está parada, e
 *    a tela diz quanto.
 *
 * **Nada aqui recalcula o pipeline.** A classificação é feita sobre o que ficou
 * gravado — abas, linhas, células, mapeamentos de coluna, recusas e fatos —, e
 * não sobre uma segunda implementação das regras de leitura. Uma cópia da
 * lógica de `stage()` que confirmasse a si mesma seria pior que balanço nenhum:
 * concordaria com o pipeline inclusive quando os dois estivessem errados.
 */

export interface DestinoContagem {
  code: DestinoCode;
  natureza: DestinoNatureza;
  nome: string;
  explicacao: string;
  celulas: number;
}

export interface BalancoResumo {
  importRunId: string;
  filename: string;
  contentSha256: string;
  status: string;
  recebidoEm: Date;
  /** Células que estão em RAW agora — a massa que entrou, contada hoje. */
  entrada: number;
  /**
   * Células que o pipeline registrou ter capturado, no momento em que capturou.
   *
   * Confrontar os dois números é o primeiro teste do balanço, e ele não é
   * retórico: RAW é imutável por trigger, então uma diferença aqui só pode vir
   * de uma exclusão de importação que não levou tudo o que devia — que é
   * exatamente o tipo de defeito que nenhuma outra tela mostraria.
   */
  entradaRegistrada: number;
  capturaConfere: boolean;
  destinos: DestinoContagem[];
  porNatureza: Record<DestinoNatureza, number>;
  /** Células sem destino declarado. Zero é a única resposta aceitável. */
  residuo: number;
  fecha: boolean;
}

export interface AbaBalanco {
  sheetName: string;
  role: string;
  roleReason: string;
  celulas: number;
  virouFato: number;
  perda: number;
  residuo: number;
}

export interface AmostraCelula {
  code: DestinoCode;
  sheetName: string;
  rowIndex: number;
  columnLetter: string;
  columnHeader: string | null;
  rawValue: string | null;
}

export interface VigenciaBalanco {
  label: string;
  effectiveDate: string | null;
  snapshotId: string | null;
  revision: number | null;
  status: string | null;
  /** Fatos preparados no STAGING para este rótulo. */
  preparados: number;
  /** O que a vigência registrou ao fechar. */
  declarados: number | null;
  /** O que existe em `fact` agora. */
  promovidos: number;
  /** Destes, quantos apontam para uma célula deste mesmo arquivo. */
  comLastroNoArquivo: number;
  fecha: boolean;
}

export interface SemanticaContagem {
  status: string;
  fatos: number;
  ausencias: number;
}

export interface BalancoImportacao extends BalancoResumo {
  etapa1: {
    porAba: AbaBalanco[];
    /** Endereço de algumas das células perdidas. Sem endereço não há conserto. */
    amostras: AmostraCelula[];
  };
  etapa2: {
    preparados: number;
    /** Células distintas que originaram fato. Igual a `preparados`, ou há defeito. */
    celulasDeOrigem: number;
    promovidos: number;
    naoPromovidos: number;
    porQueNaoPromoveu: string | null;
    vigencias: VigenciaBalanco[];
    fecha: boolean;
  };
  etapa3: {
    fatos: number;
    /** Fatos cuja semântica está confirmada — os únicos que podem ser somados. */
    podeSomar: number;
    /** Existe, é conferível, e não entra em conta nenhuma até alguém confirmar. */
    semPreco: number;
    /** Fatos que registram ausência (a célula estava vazia, ou era sentinela). */
    ausencias: number;
    porSemantica: SemanticaContagem[];
  };
}

/** Códigos de recusa de linha que `stage()` grava. Espelho, não reimplementação. */
type LinhaDestino = {
  run_id: string;
  destino: string;
  celulas: number;
}

/**
 * Um destino que a consulta devolveu e a lista não declara.
 *
 * Não é possível hoje — o `CASE` só emite os códigos de `destinos.ts` —, e
 * mesmo assim a checagem existe: no dia em que alguém acrescentar um ramo ao
 * `CASE` sem acrescentar o destino, a tela pararia de somar aquele ramo e
 * exibiria um total menor **sem nenhum sinal**. Falhar aqui é o oposto disso.
 */
function contarDestinos(linhas: LinhaDestino[]): Map<string, Map<DestinoCode, number>> {
  const porRun = new Map<string, Map<DestinoCode, number>>();
  for (const linha of linhas) {
    const code = descreverDestino(linha.destino as DestinoCode).code;
    const bucket = porRun.get(linha.run_id) ?? new Map<DestinoCode, number>();
    bucket.set(code, (bucket.get(code) ?? 0) + linha.celulas);
    porRun.set(linha.run_id, bucket);
  }
  return porRun;
}

function montarDestinos(contagem: Map<DestinoCode, number>): {
  destinos: DestinoContagem[];
  porNatureza: Record<DestinoNatureza, number>;
  residuo: number;
} {
  const porNatureza: Record<DestinoNatureza, number> = {
    FATO: 0,
    OUTRO_PAPEL: 0,
    DESCARTE: 0,
    PERDA: 0,
    RESIDUO: 0,
  };

  const destinos = ORDEM_DESTINOS.map((code): DestinoContagem => {
    const d: Destino = descreverDestino(code);
    const celulas = contagem.get(code) ?? 0;
    porNatureza[d.natureza] += celulas;
    return {
      code,
      natureza: d.natureza,
      nome: d.nome,
      explicacao: d.explicacao,
      celulas,
    };
  });

  return { destinos, porNatureza, residuo: porNatureza.RESIDUO };
}

type LinhaRun = {
  import_run_id: string;
  status: string;
  filename: string;
  content_sha256: string;
  received_at: Date;
  raw_cell_count: number;
  /** Nulo = nunca recenseado. Ver o caminho de exceção em `listarBalancos`. */
  censo_calculado_em: Date | null;
}

/**
 * O balanço de cada importação, numa passada só.
 *
 * A tentação era listar as importações com os contadores baratos que
 * `import_run` já guarda e só calcular o balanço ao abrir uma. Seria uma lista
 * que não responde a pergunta pela qual alguém entra nela — *alguma delas
 * perdeu massa?* —, e um "fecha" que ninguém calculou é a espécie de número que
 * este produto existe para não exibir. Então a lista calcula: é uma agregação
 * por importação sobre células já indexadas por aba, e ela responde no tempo em
 * que uma lista responde.
 *
 * **Importação oculta fica de fora, e isso não é uma escolha desta função.** O
 * contrato está escrito na coluna que a cria (`import_run.hidden_at`, em
 * `lib/db/src/schema/raw.ts`): um run oculto — e todos os fatos de todas as
 * vigências dele — "fica de fora de todo agregado (dashboard, comparativo,
 * **cobertura**, DRE...)". A cobertura auditada é calculada exatamente sobre
 * esta lista, e até aqui era o único agregado do produto que ignorava a
 * palavra "cobertura" escrita no próprio contrato: quem ocultava um arquivo o
 * via sumir do comparativo e continuar pesando no percentual de qualidade.
 *
 * Ocultar não é excluir, e nada aqui apaga: o run continua no banco, continua
 * listado na tela de Importações e volta à conta assim que `hidden_at` for
 * `NULL` de novo — que é a tela de onde se oculta e se reexibe, e por isso
 * ninguém fica sem caminho de volta ao tirá-lo daqui.
 */
export async function listarBalancos(db: Database): Promise<BalancoResumo[]> {
  const { rows: runs } = await db.execute<LinhaRun>(sql`
    SELECT
      ir.id                 AS import_run_id,
      ir.status::text       AS status,
      ir.raw_cell_count::int AS raw_cell_count,
      ir.censo_calculado_em,
      sf.filename,
      sf.content_sha256,
      sf.received_at
    FROM import_run ir
    JOIN source_file sf ON sf.id = ir.source_file_id
    WHERE ir.hidden_at IS NULL
    ORDER BY sf.received_at DESC, ir.started_at DESC
  `);

  if (runs.length === 0) return [];

  /*
    O censo já está gravado — a leitura não reclassifica nada.

    Até 29/08/2026 esta função rodava `classificacao()` **sem filtro**: a cada
    requisição, uma varredura completa de `raw_cell` (514.878 linhas) e de
    `staged_fact` (499.446), somando 1.022.946 linhas lidas do Postgres para
    devolver 2,5 KB — e crescendo com cada importação, para sempre. Custava
    2.267 ms quentes, e o Resumo executivo esperava por eles.

    Agora cada importação grava o próprio censo quando termina de preparar
    (`censo.ts`), e a leitura é um `SELECT` sobre as importações visíveis. O
    resultado é o mesmo porque a classificação de uma célula nunca dependeu de
    outra importação — a prova está no cabeçalho de `censo.ts` e no teste de
    decomposição.
  */
  const ids = runs.map((r) => r.import_run_id);
  const { rows: destinos } = await db.execute<LinhaDestino>(sql`
    SELECT import_run_id::text AS run_id, destino, celulas
    FROM import_run_censo
    WHERE import_run_id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
  `);

  const porRun = contarDestinos(destinos);

  /*
    O run que ainda não foi recenseado é calculado na hora — e só ele.

    Não deveria haver nenhum depois do backfill da `0080`, e mesmo assim o
    caminho existe: sem ele, um run gravado por um servidor antigo (ou um cujo
    `stage()` morreu entre a escrita do RAW e a do censo) **sumiria da lista**
    em vez de aparecer com os números que tem. Uma tela que existe para
    denunciar dado que sumiu não pode ser a primeira a sumir com um.

    `censo_calculado_em` é o que distingue "recenseado, e o resultado foi zero
    célula" de "nunca recenseado": as duas não deixam linha nenhuma na tabela,
    e só a marca as separa.
  */
  const pendentes = runs.filter((r) => r.censo_calculado_em === null);
  for (const run of pendentes) {
    const { rows } = await semJit<LinhaDestino>(
      db,
      sql`
      ${classificacao(run.import_run_id)}
      SELECT run_id, destino, count(*)::int AS celulas
      FROM classificada
      GROUP BY run_id, destino
    `,
    );
    for (const [id, contagem] of contarDestinos(rows)) porRun.set(id, contagem);
  }

  return runs.map((run) => resumoDe(run, porRun.get(run.import_run_id) ?? new Map()));
}

function resumoDe(run: LinhaRun, contagem: Map<DestinoCode, number>): BalancoResumo {
  const { destinos, porNatureza, residuo } = montarDestinos(contagem);
  const entrada = destinos.reduce((total, d) => total + d.celulas, 0);
  const capturaConfere = entrada === run.raw_cell_count;

  return {
    importRunId: run.import_run_id,
    filename: run.filename,
    contentSha256: run.content_sha256,
    status: run.status,
    recebidoEm: run.received_at,
    entrada,
    entradaRegistrada: run.raw_cell_count,
    capturaConfere,
    destinos,
    porNatureza,
    residuo,
    fecha: residuo === 0 && capturaConfere,
  };
}

/**
 * Por que a massa preparada não chegou ao canônico.
 *
 * Uma importação que não foi aprovada não perdeu nada — ela está esperando. A
 * diferença entre "esperando" e "perdida" é a única coisa que a etapa 2 precisa
 * dizer quando não fecha, e ela não sai de uma conta: sai do estado do run.
 */
export function porQueNaoPromoveu(status: string): string | null {
  switch (status) {
    case "PROMOTED":
      return null;
    case "PENDING":
    case "READING":
    case "STAGED":
      return "O arquivo ainda está sendo lido; nada foi promovido ainda.";
    case "PREVIEWED":
      return "A importação está conferida e aguardando aprovação. A massa preparada entra na camada canônica quando alguém aprovar.";
    case "PROMOTING":
      return "A aprovação está em curso neste momento.";
    case "FAILED":
      return "A leitura falhou, então nada foi promovido. O que está em STAGING é o que o leitor conseguiu preparar antes de parar.";
    case "ABORTED":
      return "A importação foi abortada; o que está em STAGING não será promovido.";
    case "SKIPPED_DUPLICATE":
      return "O arquivo foi recusado como duplicata — o conteúdo já havia entrado por outra importação.";
    default:
      return `A importação está em ${status.toLowerCase()} e ainda não promoveu o que preparou.`;
  }
}

type LinhaAba = {
  aba_id: string;
  sheet_name: string;
  sheet_index: number;
  role: string;
  role_reason: string;
  destino: string;
  celulas: number;
}

type LinhaAmostra = {
  destino: string;
  sheet_name: string;
  row_index: number;
  column_letter: string;
  column_header: string | null;
  raw_value: string | null;
}

type LinhaVigenciaStaging = {
  label: string;
  preparados: number;
}

type LinhaSnapshot = {
  id: string;
  source_label: string;
  effective_date: string;
  revision: number;
  status: string;
  fact_count: number;
  promovidos: number;
  /** Fatos que vieram da revisão anterior, e não deste arquivo. */
  herdados: number;
  com_lastro: number;
}

type LinhaSemantica = {
  status: string;
  fatos: number;
  ausencias: number;
}

/** Quantas células perdidas mostrar por destino. Endereço, não amostra estatística. */
const AMOSTRAS_POR_DESTINO = 8;

/**
 * O balanço de uma importação, com endereço.
 *
 * A lista responde *se* fecha; esta função responde *onde* não fecha. As duas
 * usam a mesma classificação — a tela não pode dizer 1.200 perdidas na lista e
 * 900 ao abrir.
 */
export async function balancoDaImportacao(
  db: Database,
  importRunId: string,
): Promise<BalancoImportacao | null> {
  const { rows: runs } = await db.execute<LinhaRun>(sql`
    SELECT
      ir.id                  AS import_run_id,
      ir.status::text        AS status,
      ir.raw_cell_count::int AS raw_cell_count,
      ir.censo_calculado_em,
      sf.filename,
      sf.content_sha256,
      sf.received_at
    FROM import_run ir
    JOIN source_file sf ON sf.id = ir.source_file_id
    WHERE ir.id = ${importRunId}::uuid
  `);
  const run = runs[0];
  if (!run) return null;

  const [porAbaRows, amostraRows, stagingRows, snapshotRows, semanticaRows] =
    await Promise.all([
      semJit<LinhaAba>(
        db,
        sql`
        ${classificacao(importRunId)}
        SELECT
          a.id          AS aba_id,
          a.sheet_name,
          a.sheet_index,
          a.role::text  AS role,
          a.role_reason,
          c.destino,
          count(*)::int AS celulas
        FROM classificada c
        JOIN aba a ON a.id = c.aba_id
        GROUP BY a.id, a.sheet_name, a.sheet_index, a.role, a.role_reason, c.destino
        ORDER BY a.sheet_index
      `,
      ),
      semJit<LinhaAmostra>(
        db,
        sql`
        ${classificacao(importRunId)},
        perdida AS (
          SELECT
            c.id,
            c.destino,
            row_number() OVER (PARTITION BY c.destino ORDER BY c.id) AS posicao
          FROM classificada c
          WHERE c.destino IN (
            'LINHA_RECUSADA', 'COLUNA_SEM_CABECALHO', 'COLUNA_AMBIGUA',
            'ABA_SEM_GRAO', 'SEM_DESTINO'
          )
        )
        SELECT
          p.destino,
          s.sheet_name,
          r.row_index,
          rc.column_letter,
          rc.column_header,
          left(rc.raw_value, 80) AS raw_value
        FROM perdida p
        JOIN raw_cell rc  ON rc.id = p.id
        JOIN raw_row r    ON r.id = rc.raw_row_id
        JOIN raw_sheet s  ON s.id = r.raw_sheet_id
        WHERE p.posicao <= ${AMOSTRAS_POR_DESTINO}
        ORDER BY p.destino, r.row_index, rc.column_index
      `,
      ),
      db.execute<LinhaVigenciaStaging>(sql`
        SELECT snapshot_label AS label, count(*)::int AS preparados
        FROM staged_fact
        WHERE import_run_id = ${importRunId}::uuid
        GROUP BY snapshot_label
      `),
      db.execute<LinhaSnapshot>(sql`
        SELECT
          s.id,
          s.source_label,
          s.effective_date::text AS effective_date,
          s.revision,
          s.status::text AS status,
          s.fact_count,
          -- Os fatos herdados de uma revisão anterior ficam de fora das duas
          -- contagens. Eles são do snapshot, mas a célula que os originou está
          -- em outra importação — somá-los aqui faria esta importação parecer
          -- ter produzido massa que ela não produziu, e "uma célula, um fato"
          -- deixaria de fechar sem que nada estivesse errado.
          (
            SELECT count(*)::int FROM fact f
             WHERE f.snapshot_id = s.id
               AND f.inherited_from_snapshot_id IS NULL
          ) AS promovidos,
          (
            SELECT count(*)::int FROM fact f
             WHERE f.snapshot_id = s.id
               AND f.inherited_from_snapshot_id IS NOT NULL
          ) AS herdados,
          (
            SELECT count(*)::int
            FROM fact f
            JOIN raw_cell c  ON c.id = f.raw_cell_id
            JOIN raw_row r   ON r.id = c.raw_row_id
            JOIN raw_sheet a ON a.id = r.raw_sheet_id
            WHERE f.snapshot_id = s.id
              AND f.inherited_from_snapshot_id IS NULL
              AND a.import_run_id = ${importRunId}::uuid
          ) AS com_lastro
        FROM snapshot s
        WHERE s.import_run_id = ${importRunId}::uuid
        ORDER BY s.effective_date
      `),
      db.execute<LinhaSemantica>(sql`
        SELECT
          at.semantics_status::text                    AS status,
          count(*)::int                                AS fatos,
          (count(*) FILTER (WHERE f.is_null))::int     AS ausencias
        FROM fact f
        JOIN attribute at ON at.id = f.attribute_id
        WHERE f.inherited_from_snapshot_id IS NULL
          AND f.snapshot_id IN (
            SELECT id FROM snapshot WHERE import_run_id = ${importRunId}::uuid
          )
        GROUP BY at.semantics_status
      `),
    ]);

  const contagem = new Map<DestinoCode, number>();
  for (const linha of porAbaRows.rows) {
    const code = descreverDestino(linha.destino as DestinoCode).code;
    contagem.set(code, (contagem.get(code) ?? 0) + linha.celulas);
  }

  const resumo = resumoDe(run, contagem);

  // --- etapa 1: por aba ----------------------------------------------------
  const abas = new Map<string, AbaBalanco>();
  for (const linha of porAbaRows.rows) {
    const d = descreverDestino(linha.destino as DestinoCode);
    let aba = abas.get(linha.aba_id);
    if (!aba) {
      aba = {
        sheetName: linha.sheet_name,
        role: linha.role,
        roleReason: linha.role_reason,
        celulas: 0,
        virouFato: 0,
        perda: 0,
        residuo: 0,
      };
      abas.set(linha.aba_id, aba);
    }
    aba.celulas += linha.celulas;
    if (d.natureza === "FATO") aba.virouFato += linha.celulas;
    if (d.natureza === "PERDA") aba.perda += linha.celulas;
    if (d.natureza === "RESIDUO") aba.residuo += linha.celulas;
  }

  // --- etapa 2: staging → canônico -----------------------------------------
  const preparadosPorLabel = new Map(
    stagingRows.rows.map((r) => [r.label, r.preparados]),
  );
  const preparados = stagingRows.rows.reduce((total, r) => total + r.preparados, 0);

  const vigencias: VigenciaBalanco[] = snapshotRows.rows.map((s) => {
    const prep = preparadosPorLabel.get(s.source_label) ?? 0;
    preparadosPorLabel.delete(s.source_label);
    return {
      label: s.source_label,
      effectiveDate: s.effective_date,
      snapshotId: s.id,
      revision: s.revision,
      status: s.status,
      preparados: prep,
      // `fact_count` descreve o snapshot inteiro; aqui a conta é sobre o que
      // esta importação declarou ter produzido.
      declarados: s.fact_count - s.herdados,
      promovidos: s.promovidos,
      comLastroNoArquivo: s.com_lastro,
      fecha:
        prep === s.promovidos &&
        s.promovidos === s.fact_count - s.herdados &&
        s.com_lastro === s.promovidos,
    };
  });

  /*
    Rótulos que o STAGING preparou e que não viraram vigência nenhuma.

    Numa importação não aprovada são todos, e isso não é perda — é espera. Numa
    importação aprovada, um rótulo aqui é massa que ficou pelo caminho, e é
    justamente o que a etapa 2 existe para não deixar passar em silêncio.
  */
  for (const [label, prep] of preparadosPorLabel) {
    vigencias.push({
      label,
      effectiveDate: null,
      snapshotId: null,
      revision: null,
      status: null,
      preparados: prep,
      declarados: null,
      promovidos: 0,
      comLastroNoArquivo: 0,
      fecha: false,
    });
  }
  vigencias.sort((a, b) => a.label.localeCompare(b.label));

  const promovidos = snapshotRows.rows.reduce((total, s) => total + s.promovidos, 0);
  const celulasDeOrigem = contagem.get("FATO_PREPARADO") ?? 0;

  // --- etapa 3: o portão da semântica --------------------------------------
  const porSemantica: SemanticaContagem[] = semanticaRows.rows
    .map((r) => ({ status: r.status, fatos: r.fatos, ausencias: r.ausencias }))
    .sort((a, b) => b.fatos - a.fatos);
  const fatos = porSemantica.reduce((total, s) => total + s.fatos, 0);
  const podeSomar =
    porSemantica.find((s) => s.status === "CONFIRMED")?.fatos ?? 0;

  return {
    ...resumo,
    etapa1: {
      porAba: [...abas.values()],
      amostras: amostraRows.rows.map((a) => ({
        code: descreverDestino(a.destino as DestinoCode).code,
        sheetName: a.sheet_name,
        rowIndex: a.row_index,
        columnLetter: a.column_letter,
        columnHeader: a.column_header,
        rawValue: a.raw_value,
      })),
    },
    etapa2: {
      preparados,
      celulasDeOrigem,
      promovidos,
      naoPromovidos: preparados - promovidos,
      porQueNaoPromoveu: porQueNaoPromoveu(run.status),
      vigencias,
      fecha:
        preparados === celulasDeOrigem &&
        (run.status === "PROMOTED"
          ? vigencias.every((v) => v.fecha)
          : promovidos === 0),
    },
    etapa3: {
      fatos,
      podeSomar,
      semPreco: fatos - podeSomar,
      ausencias: porSemantica.reduce((total, s) => total + s.ausencias, 0),
      porSemantica,
    },
  };
}
