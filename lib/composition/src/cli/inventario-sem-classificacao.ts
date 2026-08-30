/**
 * O inventário dos números que ninguém classificou — e as contas que decidem
 * o que fazer com eles.
 *
 *   DATABASE_URL=… pnpm --filter @workspace/composition exec tsx \
 *     src/cli/inventario-sem-classificacao.ts [vigência] [placa]
 *
 * A ficha já provou que nada do arquivo se perde
 * (`docs/AUDITORIA-VALORES-DA-PLACA.md`). Sobrou a pergunta seguinte, que é de
 * significado e não de completude: **destes números, quais são dinheiro que a
 * remuneração deveria somar?**
 *
 * Este arquivo não responde. Ele **mede** — e a diferença é o ponto:
 *
 * 1. o inventário de cada coluna numérica sem semântica confirmada, com massa,
 *    dispersão e comportamento na série;
 * 2. as identidades aritméticas entre colunas, que é o que separa uma parcela
 *    de um subtotal e impede a dupla contagem;
 * 3. a reconciliação — o que a Composição soma hoje, e o que somaria se cada
 *    grupo de proposta fosse confirmado.
 *
 * Nenhuma linha daqui escreve no banco. A classificação proposta a partir
 * destas medições está em `docs/CLASSIFICACAO-DOS-NAO-APURADOS.md`, e só entra
 * em vigor por `CONFIRMED_SEMANTICS`, com nome de quem decidiu — que é o
 * contrato que `lib/db/src/semantica-confirmada.ts` guarda.
 */
import { sql } from "drizzle-orm";
import { createDb } from "@workspace/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

const VIGENCIA = process.argv[2] ?? "2026-08-01";
const PLACA = process.argv[3] ?? null;

const { db, pool } = createDb(url);

const titulo = (texto: string) => {
  console.log(`\n${"═".repeat(96)}\n${texto}\n${"═".repeat(96)}`);
};
const brl = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// 1. Inventário
// ---------------------------------------------------------------------------

interface LinhaDoInventario extends Record<string, unknown> {
  code: string;
  source_name: string;
  entity_type: string;
  column_header: string | null;
  sheet_name: string | null;
  unit: string | null;
  periodicity: string | null;
  is_monetary: boolean | null;
  status: string;
  taxonomia: string | null;
  equipamentos: number;
  zerados: number;
  distintos: number;
  soma: string | null;
  minimo: string | null;
  maximo: string | null;
  amostra: string | null;
  entidades_que_variam: number;
}

/**
 * Tudo o que é número e não tem semântica confirmada, com o que decide.
 *
 * As duas colunas que mais informam não são a soma: são `distintos` — uma
 * coluna com um valor só para a frota inteira é parâmetro, não medida do ativo
 * — e `entidades_que_variam`, que separa o que muda ao longo da série do que é
 * cadastro. Um número que nunca varia em nove vigências não é fluxo mensal.
 */
async function inventario(): Promise<LinhaDoInventario[]> {
  const { rows } = await db.execute<LinhaDoInventario>(sql`
    WITH fatos AS (
      SELECT a.id, a.code, a.source_name, a.entity_type, a.unit, a.periodicity,
             a.is_monetary, a.semantics_status::text AS status,
             f.entity_id, f.value_numeric, f.raw_cell_id, s.effective_date
        FROM fato_visivel f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE s.status <> 'SUPERSEDED'
         AND a.data_type = 'NUMERIC'
         AND a.semantics_status <> 'CONFIRMED'
    ),
    variacao AS (
      SELECT id, count(*) FILTER (WHERE distintos > 1)::int AS entidades_que_variam
        FROM (
          SELECT id, entity_id, count(DISTINCT value_numeric)::int AS distintos
            FROM fatos GROUP BY 1, 2
        ) d
       GROUP BY 1
    ),
    origem AS (
      SELECT DISTINCT ON (f.id) f.id, c.column_header, sh.sheet_name, c.raw_value
        FROM fatos f
        JOIN raw_cell c ON c.id = f.raw_cell_id
        JOIN raw_row r  ON r.id = c.raw_row_id
        JOIN raw_sheet sh ON sh.id = r.raw_sheet_id
       WHERE f.effective_date = ${VIGENCIA}::date AND f.value_numeric IS NOT NULL
       ORDER BY f.id, f.value_numeric DESC
    )
    SELECT f.code, f.source_name, f.entity_type, f.unit, f.periodicity, f.is_monetary, f.status,
           o.column_header, o.sheet_name, o.raw_value AS amostra,
           n.name AS taxonomia,
           count(*) FILTER (WHERE f.effective_date = ${VIGENCIA}::date)::int AS equipamentos,
           count(*) FILTER (WHERE f.effective_date = ${VIGENCIA}::date AND f.value_numeric = 0)::int AS zerados,
           count(DISTINCT f.value_numeric) FILTER (WHERE f.effective_date = ${VIGENCIA}::date)::int AS distintos,
           round(sum(f.value_numeric) FILTER (WHERE f.effective_date = ${VIGENCIA}::date), 2)::text AS soma,
           round(min(f.value_numeric) FILTER (WHERE f.effective_date = ${VIGENCIA}::date), 4)::text AS minimo,
           round(max(f.value_numeric) FILTER (WHERE f.effective_date = ${VIGENCIA}::date), 4)::text AS maximo,
           coalesce(v.entidades_que_variam, 0) AS entidades_que_variam
      FROM fatos f
      LEFT JOIN variacao v ON v.id = f.id
      LEFT JOIN origem o   ON o.id = f.id
      LEFT JOIN attribute a ON a.id = f.id
      LEFT JOIN taxonomy_node n ON n.id = a.taxonomy_node_id
     GROUP BY f.code, f.source_name, f.entity_type, f.unit, f.periodicity, f.is_monetary,
              f.status, o.column_header, o.sheet_name, o.raw_value, n.name, v.entidades_que_variam
     ORDER BY f.entity_type,
              abs(coalesce(sum(f.value_numeric) FILTER (WHERE f.effective_date = ${VIGENCIA}::date), 0)) DESC
  `);
  return rows;
}

// ---------------------------------------------------------------------------
// 2. As identidades
// ---------------------------------------------------------------------------

/**
 * Uma hipótese aritmética, escrita para ser refutada.
 *
 * Cada uma nasceu de uma varredura de identidades sobre a matriz inteira
 * (todas as colunas numéricas × todas as linhas), e não de leitura de nome. O
 * que está aqui é o que sobreviveu — com a contagem de acertos junto, porque
 * "fecha em 529 de 558" e "fecha" são afirmações diferentes.
 */
interface Hipotese {
  entityType: "CAVALO" | "CARRETA";
  nome: string;
  colunas: string[];
  /** Recebe os valores das colunas na ordem declarada; devolve se a linha fecha. */
  vale: (v: number[]) => boolean;
  /** Linhas em que a hipótese nem se aplica (parcela ausente, ativo parado…). */
  aplica?: (v: number[]) => boolean;
  /** O que a resposta significa para a classificação. */
  porque: string;
}

const TOLERANCIA = 0.02;
const perto = (a: number, b: number) => Math.abs(a - b) < TOLERANCIA;

const HIPOTESES: Hipotese[] = [
  {
    entityType: "CAVALO",
    nome: "lucroVariavelPrevistoCavalo = 0,65% × valorNfCompra",
    colunas: ["lucro_variavel_previsto_cavalo", "valor_nf_compra"],
    aplica: ([lucro]) => lucro > 0,
    vale: ([lucro, nf]) => Math.abs(lucro - 0.0065 * nf) < 0.01,
    porque:
      "Se fecha, a coluna é derivada de uma taxa fixa sobre o ativo — previsão, " +
      "não valor negociado linha a linha.",
  },
  {
    entityType: "CAVALO",
    nome: "finameCavalo contém lucroVariavelPrevistoCavalo?",
    colunas: [
      "finame_cavalo",
      "amortizacao_cavalo",
      "juros_finame_cavalo",
      "lucro_fixomodelo_novo_ciclo_cavalo",
      "lucro_variavel_previsto_cavalo",
    ],
    aplica: ([, , , , lucroVar]) => lucroVar > 0,
    vale: ([finame, amort, juros, lucroFixo, lucroVar]) =>
      perto(finame, amort + juros + lucroFixo + lucroVar),
    porque:
      "Se fechasse, somar o lucro variável ao total contaria o mesmo dinheiro duas vezes. " +
      "Falhar em todas as linhas é a prova de que ele está fora do total declarado.",
  },
  {
    entityType: "CAVALO",
    nome: "finameCavalo = amortização + juros + lucro fixo",
    colunas: [
      "finame_cavalo",
      "amortizacao_cavalo",
      "juros_finame_cavalo",
      "lucro_fixomodelo_novo_ciclo_cavalo",
    ],
    vale: ([finame, amort, juros, lucroFixo]) => perto(finame, amort + juros + lucroFixo),
    porque: "A árvore já declarada. Está aqui como controle: se ela quebrar, a medição está errada.",
  },
  {
    entityType: "CAVALO",
    nome: "taxaFiname = composição de TJLP, spread BNDES e spread banco",
    colunas: ["taxa_finame", "tjlp", "spread_bndes", "spread_banco"],
    vale: ([taxa, tjlp, bndes, banco]) =>
      Math.abs(taxa - ((1 + tjlp / 100) * (1 + bndes / 100) * (1 + banco / 100) - 1) * 100) < 0.02,
    porque: "Se fecha, taxaFiname é subtotal das outras três — nunca uma quarta grandeza.",
  },
  {
    entityType: "CAVALO",
    nome: "valorReajustado = reaiskm × (1 + percentualReajusteAplicado)",
    colunas: ["valor_reajustado", "reaiskm", "percentual_reajuste_aplicado"],
    aplica: ([, reaiskm]) => reaiskm > 0,
    vale: ([reajustado, reaiskm, pct]) => Math.abs(reajustado - reaiskm * (1 + pct / 100)) < 0.005,
    porque: "Se fecha, valorReajustado é derivado — e somá-lo com reaiskm contaria a mesma razão duas vezes.",
  },
  {
    entityType: "CAVALO",
    nome: "manutencaoContrato = valorReajustado (coluna duplicada)",
    colunas: ["manutencao_contrato", "valor_reajustado"],
    vale: ([a, b]) => a === b,
    porque: "Duas colunas com o mesmo conteúdo em todas as linhas são a mesma medida com dois nomes.",
  },
  {
    entityType: "CAVALO",
    nome: "freeMaintenance = manutencaoFreeMaintenance (coluna duplicada)",
    colunas: ["free_maintenance", "manutencao_free_maintenance"],
    vale: ([a, b]) => a === b,
    porque: "Idem.",
  },
  {
    entityType: "CAVALO",
    nome: "anoBid = manutencaoAno (coluna duplicada)",
    colunas: ["ano_bid", "manutencao_ano"],
    vale: ([a, b]) => a === b,
    porque: "Idem.",
  },
  {
    entityType: "CARRETA",
    nome: "lucroVariavelPrevistoCarreta = 0,65% × valorNfCompra",
    colunas: ["lucro_variavel_previsto_carreta", "valor_nf_compra"],
    aplica: ([lucro]) => lucro > 0,
    vale: ([lucro, nf]) => Math.abs(lucro - 0.0065 * nf) < 0.01,
    porque: "A mesma taxa do cavalo. Se fecha nos dois, a regra é do contrato, não do ativo.",
  },
  {
    entityType: "CARRETA",
    nome: "finameImplemento = custoAluguel + amortização + juros",
    colunas: [
      "finame_implemento",
      "custo_aluguel",
      "amortizacao_implemento",
      "juros_finame_implemento",
    ],
    vale: ([finame, aluguel, amort, juros]) => perto(finame, aluguel + amort + juros),
    porque: "Controle da árvore da carreta — e mostra que custoAluguel já está dentro de finameImplemento.",
  },
  {
    entityType: "CARRETA",
    nome: "ipvaLicenciamentoMensal = ipvaLicenciamento ÷ 12",
    colunas: ["ipva_licenciamento_mensal", "ipva_licenciamento"],
    vale: ([mensal, anual]) => Math.abs(mensal - anual / 12) < 0.01,
    porque:
      "Se falhasse na maioria, as duas colunas não medem a mesma grandeza — e o nome " +
      "'mensal' não autoriza dividir uma pela outra.",
  },
];

interface MatrizDaEntidade {
  linhas: Map<string, Map<string, number>>;
}

async function lerMatriz(entityType: string): Promise<MatrizDaEntidade> {
  const { rows } = await db.execute<{ chave: string; code: string; valor: string }>(sql`
    SELECT (f.entity_id::text || '|' || s.effective_date::text) AS chave,
           a.code, f.value_numeric::text AS valor
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND s.status <> 'SUPERSEDED'
       AND a.data_type = 'NUMERIC'
       AND f.value_numeric IS NOT NULL
  `);
  const linhas = new Map<string, Map<string, number>>();
  const prefixo = `${entityType.toLowerCase()}.`;
  for (const row of rows) {
    const linha = linhas.get(row.chave) ?? new Map<string, number>();
    linha.set(row.code.replace(prefixo, ""), Number(row.valor));
    linhas.set(row.chave, linha);
  }
  return { linhas };
}

function medir(hipotese: Hipotese, matriz: MatrizDaEntidade): string {
  let ok = 0;
  let falha = 0;
  let semDados = 0;
  for (const linha of matriz.linhas.values()) {
    const valores = hipotese.colunas.map((c) => linha.get(c));
    if (valores.some((v) => v === undefined)) {
      semDados += 1;
      continue;
    }
    const v = valores as number[];
    if (hipotese.aplica && !hipotese.aplica(v)) continue;
    if (hipotese.vale(v)) ok += 1;
    else falha += 1;
  }
  const total = ok + falha;
  const pct = total === 0 ? 0 : (100 * ok) / total;
  return `${ok}/${total} (${pct.toFixed(1)}%)${semDados > 0 ? ` · ${semDados} linhas sem a coluna` : ""}`;
}

// ---------------------------------------------------------------------------
// 3. A reconciliação
// ---------------------------------------------------------------------------

/** Um grupo da proposta, com o que ele somaria se fosse confirmado. */
const GRUPOS: { rotulo: string; codes: string[] }[] = [
  {
    rotulo: "Hoje no total mensal",
    codes: [
      "cavalo.finame_cavalo",
      "carreta.finame_implemento",
      "carreta.lucro_fixomodelo_novo_ciclo",
    ],
  },
  {
    rotulo: "Proposta A — lucro variável previsto (próprio de cada ativo)",
    codes: ["cavalo.lucro_variavel_previsto_cavalo", "carreta.lucro_variavel_previsto_carreta"],
  },
  {
    rotulo: "Proposta A — o mesmo dinheiro no escopo do conjunto (NÃO soma)",
    codes: ["carreta.lucro_variavel_previsto"],
  },
  {
    rotulo: "Proposta B — acessórios e seguro da carreta (periodicidade não provada)",
    codes: ["carreta.seguro", "carreta.revestimento", "carreta.tacografo", "carreta.faixa_reflexiva"],
  },
  {
    rotulo: "Proposta C — IPVA da carreta, duas colunas homônimas (decisão de negócio)",
    codes: ["carreta.ipva_licenciamento_mensal", "carreta.ipva_licenciamento"],
  },
  {
    rotulo: "Colunas zeradas na vigência inteira (não somam nada, hoje)",
    codes: [
      "cavalo.custo_aluguel",
      "cavalo.valor_icms",
      "cavalo.valor_pneu",
      "carreta.valor_icms",
      "carreta.valor_pneus",
      "carreta.rastreador",
    ],
  },
];

async function somaDe(codes: string[], placa: string | null): Promise<Map<string, number>> {
  const { rows } = await db.execute<{ code: string; soma: string }>(sql`
    SELECT a.code, coalesce(sum(f.value_numeric), 0)::text AS soma
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
      LEFT JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
                                    AND ei.identifier_type = 'PLACA'
     WHERE s.effective_date = ${VIGENCIA}::date
       AND s.status <> 'SUPERSEDED'
       AND a.code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})
       ${placa === null ? sql`` : sql`AND ei.identifier_value = ${placa}`}
     GROUP BY 1
  `);
  return new Map(rows.map((r) => [r.code, Number(r.soma)]));
}

// ---------------------------------------------------------------------------

titulo(`Inventário dos números sem semântica confirmada — vigência ${VIGENCIA}`);
const linhas = await inventario();
console.log(
  [
    "tipo".padEnd(8),
    "código".padEnd(44),
    "cabeçalho".padEnd(30),
    "soma na vigência".padStart(18),
    "eq".padStart(4),
    "zer".padStart(4),
    "dist".padStart(5),
    "varia".padStart(6),
    "unidade".padEnd(9),
    "monet".padEnd(6),
  ].join(" "),
);
for (const l of linhas) {
  console.log(
    [
      l.entity_type.padEnd(8),
      l.code.padEnd(44),
      (l.column_header ?? "—").slice(0, 30).padEnd(30),
      brl(l.soma === null ? null : Number(l.soma)).padStart(18),
      String(l.equipamentos).padStart(4),
      String(l.zerados).padStart(4),
      String(l.distintos).padStart(5),
      String(l.entidades_que_variam).padStart(6),
      (l.unit ?? "—").padEnd(9),
      String(l.is_monetary ?? "—").padEnd(6),
    ].join(" "),
  );
}
console.log(`\n${linhas.length} colunas numéricas sem semântica confirmada.`);

titulo("Identidades aritméticas — o que é parcela, o que é subtotal, o que é duplicata");
const matrizes = new Map<string, MatrizDaEntidade>([
  ["CAVALO", await lerMatriz("CAVALO")],
  ["CARRETA", await lerMatriz("CARRETA")],
]);
for (const hipotese of HIPOTESES) {
  console.log(`\n· ${hipotese.entityType} — ${hipotese.nome}`);
  console.log(`    fecha em ${medir(hipotese, matrizes.get(hipotese.entityType)!)}`);
  console.log(`    ${hipotese.porque}`);
}

titulo(`Reconciliação — ${PLACA ? `placa ${PLACA}` : "frota inteira"}, ${VIGENCIA}`);
let base = 0;
for (const grupo of GRUPOS) {
  const somas = await somaDe(grupo.codes, PLACA);
  const total = [...somas.values()].reduce((a, b) => a + b, 0);
  console.log(`\n${grupo.rotulo}`);
  for (const code of grupo.codes) {
    console.log(`    ${code.padEnd(46)} ${brl(somas.get(code) ?? 0).padStart(16)}`);
  }
  console.log(`    ${"—".repeat(46)} ${brl(total).padStart(16)}`);
  if (grupo.rotulo.startsWith("Hoje")) base = total;
}
console.log(
  "\nNada aqui foi escrito no banco. A proposta de classificação está em " +
    "docs/CLASSIFICACAO-DOS-NAO-APURADOS.md; o total mensal apurado hoje é " +
    `${brl(base)}.`,
);

await pool.end();
