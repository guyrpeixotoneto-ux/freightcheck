/**
 * As ferramentas sobre o dado — não sobre o que o modelo de remuneração diz.
 *
 * `ferramentas.ts` responde perguntas sobre a remuneração: quanto mudou, o que
 * custou, o que o Book registra. Este módulo responde a outra família, que a
 * auditoria fazia e o assistente não alcançava: **de onde este número veio,
 * quando entrou, o que ficou de fora e o que ainda não foi confirmado.**
 *
 * A separação não é arrumação de arquivo. As duas famílias leem camadas
 * diferentes — uma lê o modelo canônico (`fact`, `change`, `snapshot`), a outra
 * lê a procedência e o estado do pipeline (`import_run`, `raw_cell`,
 * `attribute.semantics_status`) — e misturá-las num arquivo só faria a próxima
 * ferramenta ser escrita na camada errada por proximidade.
 *
 * **Nada aqui inventa cálculo.** Toda função abaixo chama o mesmo serviço que a
 * tela correspondente chama — Curadoria, Importações, Rastreio de Dados — e
 * embrulha o resultado em `Evidencia`. É o que garante que o assistente e a
 * tela nunca discordem: quando discordarem, é bug de um serviço só, não de dois
 * caminhos que calculam a mesma coisa de jeitos diferentes.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { getCurationSummary, getSemanticsHistory } from "@workspace/curation";
import { listImportRuns } from "@workspace/ingest";
import { listarBalancos, porQueNaoPromoveu } from "@workspace/balance";
import type { Evidencia, Fato } from "./ferramentas";
import { INTEIRO } from "./formato";

/** Data curta, para caber num fato sem virar parágrafo. */
function dia(valor: unknown): string {
  if (!valor) return "—";
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? String(valor) : d.toISOString().slice(0, 10);
}

// ── Curadoria ───────────────────────────────────────────────────────────────

/**
 * Quanto do export já tem semântica confirmada — e quanto ainda não tem.
 *
 * É a contraparte de "não dá para precificar". Aquela lacuna diz que **um**
 * impacto não é apurável; esta ferramenta diz **quanto** do modelo está nessa
 * situação, que é a pergunta que se faz antes de decidir se vale confiar num
 * total. Sem ela, o assistente sabia declarar a exceção e não sabia dimensioná-la.
 */
export async function estadoDaCuradoria(db: Database): Promise<Evidencia> {
  const { byStatus, unclassified } = await getCurationSummary(db);

  const total = byStatus.reduce((soma, l) => soma + l.count, 0);
  const porStatus = new Map(
    byStatus.map((l) => [
      String(l.status ?? "UNKNOWN"),
      { count: l.count, monetary: l.monetary },
    ]),
  );

  const confirmados = porStatus.get("CONFIRMED")?.count ?? 0;
  const pendentes = total - confirmados;

  const fatos: Fato[] = [
    {
      rotulo: "Atributos com semântica confirmada",
      valor: `${INTEIRO.format(confirmados)} de ${INTEIRO.format(total)}`,
      detalhe:
        total > 0
          ? `${INTEIRO.format(Math.round((confirmados / total) * 100))}% do modelo`
          : undefined,
    },
  ];

  for (const [status, n] of porStatus) {
    if (status === "CONFIRMED") continue;
    fatos.push({
      rotulo: `Em ${status.toLowerCase()}`,
      valor: INTEIRO.format(n.count),
      detalhe:
        n.monetary > 0 ? `${INTEIRO.format(n.monetary)} monetário(s)` : undefined,
    });
  }

  if (unclassified > 0) {
    fatos.push({
      rotulo: "Sem classificação na taxonomia",
      valor: INTEIRO.format(unclassified),
    });
  }

  return {
    ferramenta: "estadoDaCuradoria",
    titulo: "Estado da curadoria",
    fatos,
    numeros: [total, confirmados, pendentes, unclassified, ...byStatus.map((l) => l.count)],
    origem: "attribute.semantics_status · o mesmo resumo da tela de Curadoria",
    tela: { label: "Curadoria", href: "/curadoria" },
    destaque: "Atributos com semântica confirmada",
    nota:
      pendentes > 0
        ? "Atributo sem semântica confirmada não entra em soma de impacto — é isto que produz as ressalvas de 'não apurável'."
        : undefined,
  };
}

/**
 * O que já se decidiu sobre a semântica de um atributo, e quando.
 *
 * Responde "por que este parâmetro está sem preço?" com a história em vez de
 * com o estado: quem confirmou o quê, em que dia, e o que mudou desde então.
 */
export async function historicoDaSemantica(
  db: Database,
  codigo: string,
): Promise<Evidencia | null> {
  const versoes = await getSemanticsHistory(db, codigo);
  if (!versoes || versoes.length === 0) return null;

  const fatos: Fato[] = versoes.slice(0, 6).map((v) => {
    const registro = v as unknown as Record<string, unknown>;
    return {
      rotulo: dia(registro.confirmedAt ?? registro.createdAt ?? registro.validFrom),
      valor: String(registro.status ?? registro.semanticsStatus ?? "—"),
      detalhe: [registro.periodicity, registro.unit, registro.confirmedBy]
        .filter(Boolean)
        .map(String)
        .join(" · ") || undefined,
    };
  });

  return {
    ferramenta: "historicoDaSemantica",
    titulo: `Semântica de ${codigo}`,
    fatos,
    numeros: [versoes.length],
    origem: `attribute_semantics · histórico de "${codigo}"`,
    tela: { label: "Curadoria", href: "/curadoria" },
  };
}

// ── Importações ─────────────────────────────────────────────────────────────

/**
 * O que entrou, quando, e o que cada importação produziu.
 *
 * A pergunta "esses números são de quando?" é de auditoria pura, e até aqui o
 * assistente só sabia responder pela data da vigência — que é a data que o
 * Freightech declara, não a data em que o arquivo foi lido. As duas divergem, e
 * quem audita precisa das duas.
 */
export async function importacoesRecentes(db: Database): Promise<Evidencia> {
  const runs = await listImportRuns(db);
  const recentes = runs.slice(0, 8);

  const fatos: Fato[] = recentes.map((r) => {
    const registro = r as unknown as Record<string, unknown>;
    const status = String(registro.status ?? "—");
    return {
      rotulo: String(registro.filename ?? registro.id ?? "importação"),
      valor: status,
      detalhe: [
        dia(registro.startedAt),
        registro.rawCellCount ? `${INTEIRO.format(Number(registro.rawCellCount))} células` : null,
        registro.failureReason ? String(registro.failureReason) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });

  const promovidas = recentes.filter(
    (r) => String((r as unknown as Record<string, unknown>).status) === "PROMOTED",
  ).length;

  return {
    ferramenta: "importacoesRecentes",
    titulo: "Importações",
    fatos: fatos.length > 0 ? fatos : [{ rotulo: "Importações", valor: "nenhuma registrada" }],
    numeros: [
      runs.length,
      promovidas,
      ...recentes.map((r) => Number((r as unknown as Record<string, unknown>).rawCellCount ?? 0)),
    ],
    origem: "import_run · o mesmo histórico da tela de Importações",
    tela: { label: "Importações", href: "/importacoes" },
  };
}

// ── Rastreio de Dados ───────────────────────────────────────────────────────

/**
 * Quantas células entraram e quantas viraram fato — e o que se perdeu no meio.
 *
 * É a pergunta que o Rastreio de Dados existe para responder, e a que separa
 * "o dado não mudou" de "o dado não chegou". Quando uma importação não promove,
 * `porQueNaoPromoveu` traduz o status em uma frase — escrita lá, não aqui, para
 * a tela e o assistente dizerem a mesma coisa.
 */
export async function balancoDasImportacoes(db: Database): Promise<Evidencia> {
  const balancos = await listarBalancos(db);
  const recentes = balancos.slice(0, 6);

  const fatos: Fato[] = recentes.map((b) => {
    const registro = b as unknown as Record<string, unknown>;
    const status = String(registro.status ?? "—");
    const motivo = porQueNaoPromoveu(status);
    return {
      rotulo: String(registro.filename ?? registro.importRunId ?? "importação"),
      valor: registro.rawCellCount
        ? `${INTEIRO.format(Number(registro.rawCellCount))} células`
        : status,
      detalhe: motivo ?? status,
    };
  });

  return {
    ferramenta: "balancoDasImportacoes",
    titulo: "Rastreio de Dados",
    fatos: fatos.length > 0 ? fatos : [{ rotulo: "Rastreio", valor: "nenhuma importação registrada" }],
    numeros: recentes.map((b) =>
      Number((b as unknown as Record<string, unknown>).rawCellCount ?? 0),
    ),
    origem: "import_run + raw_cell · o mesmo cálculo da tela de Rastreio de Dados",
    tela: { label: "Rastreio de Dados", href: "/rastreio-de-dados" },
  };
}

// ── Busca nas células importadas ────────────────────────────────────────────

interface LinhaDaCelula {
  [coluna: string]: unknown;
  sheet_name: string | null;
  row_index: number | null;
  column_letter: string | null;
  column_header: string | null;
  raw_value: string | null;
  filename: string | null;
  total: string | number;
}

/**
 * Procurar um texto em qualquer célula de qualquer planilha importada.
 *
 * Até aqui `raw_cell` só era alcançável pela procedência de **uma** alteração:
 * dava para descer da alteração até a célula, e não para partir de um texto e
 * achar onde ele aparece. Perguntas legítimas de auditoria — "onde aparece esta
 * placa?", "que coluna tem este cabeçalho?" — não tinham caminho.
 *
 * **O limite é parte da resposta.** Uma importação tem centenas de milhares de
 * células, e devolver as mil primeiras não ajudaria ninguém a auditar nada. A
 * busca traz as 12 primeiras e diz **quantas existem no total** — o número
 * completo, não o da amostra —, porque "12 de 4.317" e "12 de 12" pedem
 * decisões opostas de quem lê, e omitir isso seria exibir um recorte com cara
 * de conjunto.
 */
export async function buscarNasCelulas(db: Database, termo: string): Promise<Evidencia | null> {
  const alvo = termo.trim();
  if (alvo.length < 3) return null;
  const padrao = `%${alvo}%`;

  const { rows } = await db.execute<LinhaDaCelula>(sql`
    WITH achadas AS (
      SELECT rc.raw_value, rc.column_letter, rc.column_header,
             rr.row_index, rs.sheet_name, sf.filename, ir.started_at
        FROM raw_cell rc
        JOIN raw_row rr   ON rr.id = rc.raw_row_id
        JOIN raw_sheet rs ON rs.id = rr.raw_sheet_id
        JOIN import_run ir ON ir.id = rs.import_run_id
        LEFT JOIN source_file sf ON sf.id = ir.source_file_id
       WHERE rc.raw_value ILIKE ${padrao}
    )
    SELECT *, (SELECT count(*) FROM achadas) AS total
      FROM achadas
     ORDER BY started_at DESC NULLS LAST, sheet_name, row_index
     LIMIT 12
  `);

  const total = Number(rows[0]?.total ?? 0);
  if (total === 0) return null;

  const fatos: Fato[] = rows.map((r) => ({
    rotulo: `${r.sheet_name ?? "planilha"} · linha ${r.row_index ?? "—"} · coluna ${r.column_letter ?? "—"}`,
    valor: (r.raw_value ?? "").slice(0, 120),
    detalhe: [r.column_header, r.filename].filter(Boolean).join(" · ") || undefined,
  }));

  return {
    ferramenta: "buscarNasCelulas",
    titulo: `"${alvo}" nas planilhas importadas`,
    fatos,
    numeros: [total, rows.length],
    origem: "raw_cell · busca textual sobre as células como foram lidas",
    tela: { label: "Importações", href: "/importacoes" },
    destaque: fatos[0]?.rotulo,
    nota:
      total > rows.length
        ? `São ${INTEIRO.format(total)} células com esse texto; acima estão as ${rows.length} mais recentes.`
        : undefined,
  };
}
