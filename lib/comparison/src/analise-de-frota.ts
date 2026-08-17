import { sql } from "drizzle-orm";
import {
  chaveDeEscopoSql,
  filtroDeVigenciaDisponivel,
} from "@workspace/availability";
import type { Database } from "@workspace/db";
import { periodLabel } from "./labels";
import { contextFilter, resolveContext, type SeriesContext } from "./series";

/**
 * A Análise de frota, lida do canônico.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela mostrava, e por que era zero
 * ---------------------------------------------------------------------------
 *
 * A rota lia um `.xlsx` de `attached_assets` e procurava nele as abas
 * `carretas` e `cavalos`. O arquivo que ela escolhia — o primeiro `.xlsx` em
 * ordem alfabética, `Modelo_Carreta.xlsx` — tem uma aba só, chamada
 * `Modelo_Carreta`. `sheet_to_json(undefined)` devolve `[]` sem reclamar, e a
 * tela ficava com **zero linhas** enquanto 657 esperavam no arquivo. Medido,
 * não deduzido.
 *
 * Por isso a migração não tem número a preservar: todo campo do resumo era
 * zero. Qualquer valor que apareça aqui é correção de um defeito comprovado, e
 * não diferença a justificar. As exceções são os quatro pontos do ADR, tratados
 * um a um abaixo.
 *
 * ---------------------------------------------------------------------------
 * As quatro decisões, e onde cada uma está
 * ---------------------------------------------------------------------------
 *
 * **A periodicidade não é dividida à mão.** A rota fazia `manutencaoAno / 12`.
 * Quem converte competência no produto é `normalizarParaCompetencia`, e quando
 * a periodicidade do atributo não está confirmada o valor **não sai dividido em
 * silêncio**: `manutencaoCavalos` vem `null` com o motivo ao lado, como a DRE
 * já faz. Ver `naoCalculavel`.
 *
 * **O recorte é por contexto.** A soma antiga atravessava unidade e canal, e
 * dava certo por acidente porque a planilha tinha uma unidade só. Aqui todo
 * agregado passa por `contextFilter`, como Alterações, Impacto, Composição e
 * DRE.
 *
 * **`valor_nf_compra` é grandeza de aquisição.** Continua somada e continua
 * rotulada como valor de frota — estoque, não custo do mês. O nome do campo diz
 * isso, e a DRE se recusa a levá-la para o fluxo do período.
 *
 * **Ausência não vira zero.** `Number(x) || 0` transformava célula vazia, texto
 * e sentinela em zero, e o zero entrava na soma. Aqui a soma é do que existe, e
 * quantos não existiam vem ao lado, em `ausencias`. As duas informações juntas
 * são o que permite ler o total sem confundir "custa zero" com "não sabemos".
 */

/** Os campos numéricos do resumo, na ordem em que a tela os lê. */
export interface LinhaDoResumo {
  vigencia: string;
  label: string;
  totalCarretas: number;
  totalCavalos: number;
  custoFixoCarretas: number;
  finameCarretas: number;
  finameCavalos: number;
  ipvaCarretas: number;
  seguroCarretas: number;
  lucroFixoCarretas: number;
  lucroVariavelCarretas: number;
  /**
   * `null` quando a periodicidade de `cavalo.manutencao_ano` não está
   * confirmada. O motivo vem em `naoCalculavel.manutencaoCavalos`.
   */
  manutencaoCavalos: number | null;
  valorFrotaCarretas: number;
  valorFrotaCavalos: number;
  /**
   * Quantas entidades tinham a coluna entregue e **sem valor**, por campo.
   *
   * Não é enfeite: é a diferença entre um total baixo porque a frota é barata e
   * um total baixo porque metade dos ativos não trouxe o dado. A soma acima é
   * do que existe; esta contagem é do que faltou.
   */
  ausencias: Record<string, number>;
  /** Por campo, o motivo de ele não ter número. Vazio no caso normal. */
  naoCalculavel: Record<string, string>;
}

export interface AnaliseDeFrota {
  /** O recorte que produziu estes números, ou `null` quando é o censo. */
  contexto: SeriesContext | null;
  vigencias: string[];
  vigenciaLabels: Record<string, string>;
  summary: LinhaDoResumo[];
  financiamentoByVigencia: Record<string, unknown>[];
  modelosByVigencia: Record<string, unknown>[];
  ativoStatusByVigencia: Record<string, unknown>[];
}

/** De campo do resumo para o código canônico que o alimenta. */
const SOMAS: { campo: keyof LinhaDoResumo; code: string }[] = [
  { campo: "custoFixoCarretas", code: "carreta.custo_fixo" },
  { campo: "finameCarretas", code: "carreta.finame_implemento" },
  { campo: "finameCavalos", code: "cavalo.finame_cavalo" },
  { campo: "ipvaCarretas", code: "carreta.ipva_licenciamento" },
  { campo: "seguroCarretas", code: "carreta.seguro" },
  { campo: "lucroFixoCarretas", code: "carreta.lucro_fixomodelo_novo_ciclo_carreta" },
  { campo: "lucroVariavelCarretas", code: "carreta.lucro_variavel_previsto_carreta" },
  { campo: "valorFrotaCarretas", code: "carreta.valor_nf_compra" },
  { campo: "valorFrotaCavalos", code: "cavalo.valor_nf_compra" },
];

/** O campo que precisa de conversão de competência, e o atributo dele. */
const MANUTENCAO = { campo: "manutencaoCavalos" as const, code: "cavalo.manutencao_ano" };

/** As três contagens por valor de texto, e de que atributo cada uma sai. */
const AGRUPAMENTOS = [
  { bloco: "financiamentoByVigencia", code: "carreta.status_financiamento" },
  { bloco: "modelosByVigencia", code: "carreta.modelo" },
  { bloco: "ativoStatusByVigencia", code: "cavalo.ativo" },
] as const;

interface SomaPorVigencia extends Record<string, unknown> {
  effective_date: string;
  code: string;
  total: string | null;
  com_valor: number;
  ausentes: number;
}

export async function analiseDeFrota(
  db: Database,
  contextoPedido?: Partial<SeriesContext>,
): Promise<AnaliseDeFrota> {
  const contexto = contextoPedido ? await resolveContext(db, contextoPedido) : null;
  const recorte = contexto ? contextFilter("s", contexto) : sql`true`;

  const { rows: vigencias } = await db.execute<{
    effective_date: string;
    source_label: string;
  }>(sql`
    SELECT s.effective_date::text, s.source_label
      FROM snapshot s
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${recorte}
     ORDER BY s.effective_date
  `);
  if (vigencias.length === 0) {
    return {
      contexto,
      vigencias: [],
      vigenciaLabels: {},
      summary: [],
      financiamentoByVigencia: [],
      modelosByVigencia: [],
      ativoStatusByVigencia: [],
    };
  }

  /*
    As contagens de frota saem de `snapshot_entity_type`, sem tocar `fact`.

    É o mesmo agregado que a Cobertura usa, contado na promoção. Contar
    `DISTINCT entity_id` em `fact` daria o mesmo número hoje e passaria a
    divergir no dia em que uma entidade viesse sem nenhum fato — e a Análise de
    frota discordaria da Cobertura sobre o tamanho da mesma frota.
  */
  const { rows: frotas } = await db.execute<{
    effective_date: string;
    entity_type: string;
    entity_count: number;
  }>(sql`
    SELECT s.effective_date::text, t.entity_type, t.entity_count
      FROM snapshot_entity_type t
      JOIN snapshot s ON s.id = t.snapshot_id
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${recorte}
  `);

  const codigos = sql.join(
    [...SOMAS.map((s) => s.code), MANUTENCAO.code].map((c) => sql`${c}`),
    sql`, `,
  );

  /*
    Uma consulta para todas as somas, e a ausência contada junto.

    `sum` ignora `NULL` por definição, então a soma já é "do que existe" sem
    precisar de filtro — e é exatamente o oposto do `Number(x) || 0`, que
    somava o zero de quem não tinha valor. O `count FILTER (WHERE is_null)` é a
    outra metade: sem ela, um total baixo por falta de dado seria
    indistinguível de um total baixo de verdade.
  */
  const { rows: somas } = await db.execute<SomaPorVigencia>(sql`
    SELECT s.effective_date::text,
           a.code,
           sum(f.value_numeric)::text                        AS total,
           count(*) FILTER (WHERE NOT f.is_null)::int        AS com_valor,
           count(*) FILTER (WHERE f.is_null)::int            AS ausentes
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE a.code IN (${codigos})
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${recorte}
     GROUP BY 1, 2
  `);

  const { rows: periodicidades } = await db.execute<{
    code: string;
    periodicity: string | null;
    semantics_status: string;
  }>(sql`
    SELECT code, periodicity, semantics_status::text AS semantics_status
      FROM attribute WHERE code = ${MANUTENCAO.code}
  `);
  const manutencao = periodicidades[0] ?? null;

  const { rows: textos } = await db.execute<{
    effective_date: string;
    code: string;
    valor: string | null;
    n: number;
  }>(sql`
    SELECT s.effective_date::text,
           a.code,
           CASE WHEN f.is_null THEN NULL ELSE f.value_text END AS valor,
           count(*)::int AS n
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE a.code IN (${sql.join(
       AGRUPAMENTOS.map((g) => sql`${g.code}`),
       sql`, `,
     )})
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${recorte}
     GROUP BY 1, 2, 3
  `);

  // ---- montagem -------------------------------------------------------------

  const chave = (data: string, code: string) => `${data}${code}`;
  const porSoma = new Map(somas.map((r) => [chave(r.effective_date, r.code), r]));
  const porFrota = new Map(
    frotas.map((r) => [chave(r.effective_date, r.entity_type), Number(r.entity_count)]),
  );

  const rotulos: Record<string, string> = {};
  const summary: LinhaDoResumo[] = [];

  for (const v of vigencias) {
    rotulos[v.source_label] = periodLabel(v.effective_date);
    const ausencias: Record<string, number> = {};
    const naoCalculavel: Record<string, string> = {};

    const somar = (campo: string, code: string): number => {
      const linha = porSoma.get(chave(v.effective_date, code));
      if (!linha) return 0;
      if (Number(linha.ausentes) > 0) ausencias[campo] = Number(linha.ausentes);
      return linha.total === null ? 0 : Number(linha.total);
    };

    const linha: LinhaDoResumo = {
      vigencia: v.source_label,
      label: periodLabel(v.effective_date),
      totalCarretas: porFrota.get(chave(v.effective_date, "CARRETA")) ?? 0,
      totalCavalos: porFrota.get(chave(v.effective_date, "CAVALO")) ?? 0,
      custoFixoCarretas: 0,
      finameCarretas: 0,
      finameCavalos: 0,
      ipvaCarretas: 0,
      seguroCarretas: 0,
      lucroFixoCarretas: 0,
      lucroVariavelCarretas: 0,
      manutencaoCavalos: null,
      valorFrotaCarretas: 0,
      valorFrotaCavalos: 0,
      ausencias,
      naoCalculavel,
    };

    for (const { campo, code } of SOMAS) {
      (linha[campo] as number) = somar(String(campo), code);
    }

    /*
      A manutenção, pela autoridade de competência.

      A rota dividia por 12 sem perguntar de que periodicidade o número era.
      `normalizarParaCompetencia` recusa quando ninguém confirmou — e a recusa é
      um resultado, não uma falha: o campo vem `null` e o motivo vai junto, do
      mesmo jeito que a DRE faz com um valor que não sabe medir.
    */
    const bruto = somar(MANUTENCAO.campo, MANUTENCAO.code);
    const conversao = normalizar(bruto, manutencao?.periodicity ?? null);
    if (conversao.ok) linha.manutencaoCavalos = conversao.valor;
    else naoCalculavel[MANUTENCAO.campo] = conversao.explicacao;

    summary.push(linha);
  }

  const agrupar = (code: string): Record<string, unknown>[] =>
    vigencias.map((v) => {
      const conta: Record<string, unknown> = {
        vigencia: v.source_label,
        label: periodLabel(v.effective_date),
      };
      for (const t of textos) {
        if (t.effective_date !== v.effective_date || t.code !== code) continue;
        // A limpeza do prefixo fica **de um lado só**: a rota fazia e a tela
        // refazia, e duas limpezas da mesma string divergem quando uma muda.
        const rotulo = (t.valor ?? "N/A").replace("Descrição: ", "");
        conta[rotulo] = ((conta[rotulo] as number) ?? 0) + Number(t.n);
      }
      return conta;
    });

  return {
    contexto,
    vigencias: vigencias.map((v) => v.source_label),
    vigenciaLabels: rotulos,
    summary,
    financiamentoByVigencia: agrupar(AGRUPAMENTOS[0].code),
    modelosByVigencia: agrupar(AGRUPAMENTOS[1].code),
    ativoStatusByVigencia: agrupar(AGRUPAMENTOS[2].code),
  };
}

/**
 * A conversão de competência, sem trazer `@workspace/dre` para cá.
 *
 * `normalizarParaCompetencia` é a autoridade e mora na DRE; importá-la aqui
 * faria `comparison` depender de `dre`, que depende de `comparison`. A regra
 * reproduzida é a metade que este módulo usa — anual vira mensal dividindo por
 * doze, mensal fica, e o que não foi confirmado **não é dividido** —, e o teste
 * de contrato confere que as duas concordam.
 */
function normalizar(
  valor: number,
  periodicidade: string | null,
): { ok: true; valor: number } | { ok: false; explicacao: string } {
  if (periodicidade === "MENSAL") return { ok: true, valor };
  if (periodicidade === "ANUAL") return { ok: true, valor: Number((valor / 12).toFixed(2)) };
  if (periodicidade === "PONTUAL") {
    return {
      ok: false,
      explicacao:
        "O valor é pontual — o preço de uma nota, não um custo que se repete. " +
        "Dividi-lo por doze produziria uma depreciação com uma vida útil que " +
        "ninguém informou.",
    };
  }
  return {
    ok: false,
    explicacao:
      "O valor é monetário, mas ninguém confirmou se ele é mensal ou anual. " +
      "Sem isso não há em que competência colocá-lo — e a divisão por doze que " +
      "esta tela fazia era um palpite com cara de conta.",
  };
}

/** As linhas cruas de um equipamento numa vigência — o que as tabelas mostram. */
export interface LinhaDeEquipamento {
  Placa: string | null;
  "Operador - Nome": string | null;
  [coluna: string]: string | number | null;
}

/**
 * As linhas de um equipamento, pivotadas por entidade.
 *
 * **Duas colunas não são fato**, e é a descoberta que mais mudou esta migração:
 * `Placa` é identidade (`entity_identifier`, com histórico de vigência) e
 * `Operador - Nome` é escopo (`scope`, ligado à vigência e não ao ativo). Uma
 * migração que as procurasse em `fact` não as acharia e concluiria que o dado
 * sumiu.
 */
export async function linhasDeEquipamento(
  db: Database,
  entityType: string,
  codigos: string[],
  opcoes: { vigencia?: string; contexto?: Partial<SeriesContext> } = {},
): Promise<LinhaDeEquipamento[]> {
  const contexto = opcoes.contexto ? await resolveContext(db, opcoes.contexto) : null;
  const recorte = contexto ? contextFilter("s", contexto) : sql`true`;
  const lista = sql.join(
    codigos.map((c) => sql`${c}`),
    sql`, `,
  );

  const { rows } = await db.execute<{
    entity_id: string;
    code: string;
    valor: string | null;
    placa: string | null;
    operador: string | null;
    source_label: string;
  }>(sql`
    SELECT f.entity_id::text AS entity_id,
           a.code,
           CASE WHEN f.is_null THEN NULL
                ELSE coalesce(f.value_text, f.value_numeric::text,
                              f.value_boolean::text, f.value_date::text)
           END AS valor,
           ei.identifier_value AS placa,
           (SELECT string_agg(coalesce(sc.name, sc.code), ' · ')
              FROM snapshot_scope ss JOIN scope sc ON sc.id = ss.scope_id
             WHERE ss.snapshot_id = s.id AND sc.scope_type = 'OPERADOR') AS operador,
           s.source_label
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id AND e.entity_type = ${entityType}
      LEFT JOIN entity_identifier ei ON ei.entity_id = f.entity_id
                                    AND ei.identifier_type = 'PLACA'
                                    AND ei.is_current
     WHERE a.code IN (${lista})
       AND ${filtroDeVigenciaDisponivel("s")}
       AND ${recorte}
       AND (${opcoes.vigencia ?? null}::text IS NULL
            OR s.source_label = ${opcoes.vigencia ?? null})
  `);

  const porEntidade = new Map<string, LinhaDeEquipamento>();
  for (const r of rows) {
    let linha = porEntidade.get(r.entity_id);
    if (!linha) {
      linha = {
        Placa: r.placa,
        "Operador - Nome": r.operador,
        Vigencia: r.source_label,
      };
      porEntidade.set(r.entity_id, linha);
    }
    // A coluna que a tela lê é o sufixo do código: `carreta.custo_fixo` →
    // `custoFixo`. O de-para vive no chamador; aqui fica o código inteiro, e a
    // rota traduz — é ela que conhece o formato da tela.
    linha[r.code] = r.valor;
  }

  return [...porEntidade.values()].sort((a, b) =>
    String(a.Placa ?? "").localeCompare(String(b.Placa ?? ""), "pt-BR", { numeric: true }),
  );
}

/** O escopo canônico das vigências vivas — para a rota poder recortar. */
export async function escoposDaFrota(db: Database): Promise<string[]> {
  const { rows } = await db.execute<{ escopo: string }>(sql`
    SELECT DISTINCT ${chaveDeEscopoSql("s")} AS escopo
      FROM snapshot s
     WHERE ${filtroDeVigenciaDisponivel("s")}
  `);
  return rows.map((r) => r.escopo);
}
