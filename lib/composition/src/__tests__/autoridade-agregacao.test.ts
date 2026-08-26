import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import {
  applyConfirmations,
  AGREGACOES,
  runProposalPass,
  seedTaxonomy,
  viraDinheiro,
} from "@workspace/curation";
import {
  assessImpact,
  getAttributeSeries,
  getPanoramaDeAlteracoes,
  listImpactParameters,
  loadAttributeClassifications,
  type AttributeClassification,
} from "@workspace/comparison";

/**
 * Um só lugar responde "posso somar isto?".
 *
 * A auditoria de 16/08/2026 encontrou seis módulos e cinco respostas: o cockpit
 * somava com `aggregation === 'SUM'` e mais nada, o impacto exigia CONFIRMED +
 * monetário + SUM, o panorama repetia a regra com outra redação, a composição
 * acrescentava a base ausente, e a série do detalhe aceitava WEIGHTED_AVG
 * publicando média simples. Este arquivo é o que impede a sexta definição de
 * voltar a existir.
 *
 * A prova tem três partes, e nenhuma delas basta sozinha:
 *
 * 1. **Concordância pura** — as funções que aceitam uma classificação em memória
 *    devolvem exatamente o veredito da autoridade, shape a shape.
 * 2. **Concordância contra o banco** — o estado absurdo que a auditoria provou
 *    gravável (`KM_L + SUM + is_monetary`) é forçado numa vigência real, e as
 *    leituras que percorrem SQL recusam todas do mesmo jeito.
 * 3. **Guarda de código** — nenhum consumidor volta a escrever a regra à mão.
 */

let ctx: TestDb;

/** Não monetário, unidade de razão: o caso que abriu a auditoria. */
const RAZAO = "cavalo.combustivel_consumo_neg";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("autoridade_agregacao");
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

// ---------------------------------------------------------------------------
// 1. Concordância pura
// ---------------------------------------------------------------------------

const base: AttributeClassification = {
  attributeId: "id",
  attributeCode: "cavalo.x",
  attributeName: "x",
  attributeDisplayName: null,
  entityType: "CAVALO",
  dataType: "NUMERIC",
  unit: "BRL",
  periodicity: "MENSAL",
  aggregation: "SUM",
  isMonetary: true,
  semanticsStatus: "CONFIRMED",
  costClass: "FIXO",
  taxonomyPath: null,
  taxonomyName: null,
  economicDirection: null,
  economicEffect: null,
};

/** A matriz cobre um caso de cada decisão possível, e os três estados absurdos. */
const MATRIZ: { nome: string; c: AttributeClassification }[] = [
  { nome: "montante confirmado e somável", c: base },
  { nome: "montante ainda presumido", c: { ...base, semanticsStatus: "PRESUMED" } },
  { nome: "montante desconhecido", c: { ...base, semanticsStatus: "UNKNOWN" } },
  { nome: "confirmado mas não monetário", c: { ...base, isMonetary: false } },
  { nome: "confirmado, monetário, agregação NONE", c: { ...base, aggregation: "NONE" } },
  { nome: "confirmado com média simples", c: { ...base, aggregation: "AVG", unit: "MESES", isMonetary: false } },
  { nome: "razão km/l como manda a regra", c: { ...base, unit: "KM_L", aggregation: "NONE", isMonetary: false } },
  { nome: "razão km/l gravada como somável", c: { ...base, unit: "KM_L", aggregation: "SUM" } },
  { nome: "razão R$/km gravada como somável", c: { ...base, unit: "BRL_KM", aggregation: "SUM" } },
  { nome: "percentual gravado como somável", c: { ...base, unit: "PERCENT", aggregation: "SUM" } },
  { nome: "texto gravado como somável", c: { ...base, dataType: "TEXT", aggregation: "SUM" } },
  { nome: "tipo desconhecido com média", c: { ...base, dataType: "UNKNOWN", aggregation: "AVG" } },
  { nome: "média ponderada prometida", c: { ...base, unit: "KM", aggregation: "WEIGHTED_AVG", isMonetary: false } },
];

describe("as decisões em memória são a decisão da autoridade", () => {
  it.each(MATRIZ)("assessImpact concorda com viraDinheiro — $nome", ({ c }) => {
    const veredito = assessImpact({
      classification: c,
      numericBefore: 10,
      numericAfter: 12,
      comparable: true,
    });
    const autoridade = viraDinheiro(c);

    expect(veredito.confidence === "CALCULATED").toBe(autoridade.ok);
    // O motivo não é reescrito no caminho: a frase que a tela mostra é a da
    // autoridade, e não uma tradução que pode divergir dela.
    if (!autoridade.ok) expect(veredito.reason).toBe(autoridade.motivo);
  });

  it("nenhuma razão sobrevive a assessImpact, nem gravada como SUM", () => {
    for (const unit of ["KM_L", "BRL_KM", "PERCENT"]) {
      const veredito = assessImpact({
        classification: { ...base, unit, aggregation: "SUM" },
        numericBefore: 1.5,
        numericAfter: 1.7,
        comparable: true,
      });
      expect(veredito.confidence).toBe("NOT_CALCULABLE");
      expect(veredito.amount).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Concordância contra o banco
// ---------------------------------------------------------------------------

describe("as leituras que passam por SQL obedecem à mesma decisão", () => {
  beforeAll(async () => {
    /*
      O estado que a auditoria provou gravável, forçado direto no banco: km/l
      confirmado como montante mensal somável.

      A trava da 0023 recusa exatamente isto, e por isso ela é suspensa aqui e
      reposta logo abaixo. O teste não perde o sentido com a constraint no ar —
      ganha: as duas guardas são independentes de propósito, e o que se mede
      neste bloco é que **a de código sozinha basta**. Se um dia a constraint
      for afrouxada, adiada num ambiente, ou o estado chegar por um caminho que
      não passa por ela, as telas continuam recusando o número absurdo.
    */
    await ctx.db.execute(
      sql`ALTER TABLE attribute DROP CONSTRAINT attribute_semantica_coerente`,
    );
    await ctx.db.execute(sql`
      UPDATE attribute
         SET unit='KM_L', aggregation='SUM', is_monetary=true, periodicity='MENSAL',
             semantics_status='CONFIRMED', confirmed_by='teste@autoridade', confirmed_at=now()
       WHERE code=${RAZAO}
    `);
    // Reposta imediatamente, com NOT VALID: a linha absurda já está gravada e é
    // o objeto do teste, mas nenhuma escrita seguinte volta a produzir outra.
    await ctx.db.execute(sql`
      ALTER TABLE attribute ADD CONSTRAINT attribute_semantica_coerente CHECK (
        ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
        AND NOT ("data_type" IN ('TEXT', 'BOOLEAN', 'DATE', 'MIXED', 'UNKNOWN')
                 AND "aggregation" IS NOT NULL AND "aggregation" <> 'NONE')
        AND NOT (("unit" = 'KM_L' OR "unit" = 'PERCENT' OR "unit" LIKE 'BRL\\_%')
                 AND "aggregation" = 'SUM')
        AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
      ) NOT VALID
    `);
  });

  it("o banco de fato aceitou o estado absurdo — a prova não é encenada", async () => {
    const { rows } = await ctx.db.execute<{ unit: string; aggregation: string }>(sql`
      SELECT unit, aggregation FROM attribute WHERE code=${RAZAO}
    `);
    expect(rows[0]).toMatchObject({ unit: "KM_L", aggregation: "SUM" });
  });

  it("a série do cockpit recusa somar e recusa tirar média", async () => {
    const serie = await getAttributeSeries(ctx.db, RAZAO);
    expect(serie).not.toBeNull();
    expect(serie!.summable).toBe(false);
    expect(serie!.averageable).toBe(false);
    // Sem total e sem média em nenhum ponto: a recusa vale para a série inteira.
    for (const ponto of serie!.points) {
      expect(ponto.total).toBeNull();
      expect(ponto.average).toBeNull();
    }
  });

  it("a lista de parâmetros do impacto não o marca como somável", async () => {
    const parametros = await listImpactParameters(ctx.db, "CAVALO");
    const alvo = parametros.find((p) => p.code === RAZAO)!;
    expect(alvo).toBeDefined();
    expect(alvo.somavel).toBe(false);
  });

  it("o panorama o deixa fora da régua, com o motivo da autoridade", async () => {
    const panorama = await getPanoramaDeAlteracoes(ctx.db);
    const alvo = panorama?.parametros.find((p) => p.code === RAZAO);
    if (alvo) {
      expect(alvo.impactoCalculavel).toBe(false);
      expect(alvo.impactoMotivo).toBe(
        viraDinheiro({
          unit: "KM_L",
          aggregation: "SUM",
          isMonetary: true,
          semanticsStatus: "CONFIRMED",
        }).motivo,
      );
    }
  });

  it("todo atributo do export recebe de cada módulo a mesma resposta", async () => {
    // A varredura completa: 138 atributos, e para cada um a decisão da
    // autoridade tem de bater com a que o impacto calcula.
    const classificacoes = await loadAttributeClassifications(ctx.db);
    expect(classificacoes.size).toBeGreaterThan(100);

    for (const c of classificacoes.values()) {
      const autoridade = viraDinheiro(c);
      const impacto = assessImpact({
        classification: c,
        numericBefore: 1,
        numericAfter: 2,
        comparable: true,
      });
      expect(
        impacto.confidence === "CALCULATED",
        `${c.attributeCode} divergiu: autoridade=${autoridade.ok} impacto=${impacto.confidence}`,
      ).toBe(autoridade.ok);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Guarda de código
// ---------------------------------------------------------------------------

describe("nenhum consumidor reescreve a regra", () => {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

  /** Os arquivos que tinham, cada um, a sua própria definição. */
  const CONSUMIDORES = [
    "lib/comparison/src/impact.ts",
    "lib/comparison/src/impacto.ts",
    "lib/comparison/src/panorama.ts",
    "lib/comparison/src/grouped.ts",
    "lib/composition/src/motor.ts",
    // A tela reescrevia a régua em prosa própria — a sexta definição, e a única
    // fora do alcance de um import. Agora ela recebe o motivo pronto no payload.
    "artifacts/freightaudit/src/components/changes/impacto-quinzenas.tsx",
  ];

  it.each(CONSUMIDORES)("%s não compara aggregation com SUM à mão", (arquivo) => {
    const fonte = readFileSync(path.join(raiz, arquivo), "utf8");
    // Comentários explicam a regra e podem citar o literal; código, não.
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(semComentarios).not.toMatch(/aggregation\s*[!=]==\s*["']SUM["']/);
    expect(semComentarios).not.toMatch(/aggregation\s*[!=]==\s*["']WEIGHTED_AVG["']/);
  });

  it.each(CONSUMIDORES.filter((a) => a.startsWith("lib/")))(
    "%s consulta a autoridade",
    (arquivo) => {
      const fonte = readFileSync(path.join(raiz, arquivo), "utf8");
      expect(fonte).toMatch(/from "@workspace\/curation"/);
    },
  );

  it("a tela que ainda oferece agregação oferece exatamente as que o banco aceita", () => {
    /*
      A lista da tela e a da autoridade são a mesma lista, e a constraint da
      0023 é a terceira cópia — só que inescapável. Oferecer no formulário um
      valor que o banco recusa transforma uma regra em erro 422 na cara do
      curador, que foi o que aconteceria se WEIGHTED_AVG tivesse ficado.

      Sobrou uma tela: `versoes.tsx`, que corrige uma versão passada ou registra
      que a fonte mudou a regra. Ali o campo técnico é o objeto do ato, e não um
      detalhe que alguém tenha de derivar de cabeça.
    */
    const fonte = readFileSync(
      path.join(raiz, "artifacts/freightaudit/src/pages/versoes.tsx"),
      "utf8",
    );
    const inicio = fonte.indexOf("const AGGREGATIONS");
    const bloco = fonte.slice(inicio, fonte.indexOf("];", inicio));
    const oferecidas = [...bloco.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(oferecidas.sort()).toEqual([...AGREGACOES].sort());
  });

  /**
   * A tela de confirmação não oferece agregação nenhuma — e isso é a regra, não
   * uma omissão.
   *
   * A agregação passou a ser **consequência** do significado econômico: quem diz
   * "R$ por litro" já disse que aquilo não soma entre veículos, e quem diz
   * "R$ por mês" já disse que soma. Reabrir o campo no formulário devolveria à
   * pessoa a chance de contradizer o que ela acabou de afirmar — que é a porta
   * por onde `KM_L + SUM + is_monetary` entrou da primeira vez.
   *
   * A guarda é por ausência do vocabulário técnico na tela: nem lista de
   * agregações, nem lista de periodicidades, nem lista de unidades. O que ela
   * manda ao servidor é `meaningCode`, e a derivação é do servidor.
   */
  it("a tela de confirmação não oferece agregação, unidade nem periodicidade", () => {
    const fonte = readFileSync(
      path.join(raiz, "artifacts/freightaudit/src/pages/curadoria.tsx"),
      "utf8",
    );
    const semComentarios = fonte
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(semComentarios).not.toMatch(/const AGGREGATIONS/);
    expect(semComentarios).not.toMatch(/const UNITS/);
    expect(semComentarios).not.toMatch(/const PERIODICITIES/);
    for (const literal of ["SUM", "AVG", "NONE", "BRL_KM", "KM_L"]) {
      expect(
        semComentarios,
        `a tela de confirmação voltou a citar "${literal}" — a derivação é do servidor`,
      ).not.toMatch(new RegExp(`["']${literal}["']`));
    }
    // E o que ela manda é o significado.
    expect(semComentarios).toMatch(/meaningCode/);
  });

  it("a tela do impacto não reescreve a régua: recebe o motivo pronto", () => {
    const fonte = readFileSync(
      path.join(raiz, "artifacts/freightaudit/src/components/changes/impacto-quinzenas.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/semanticsStatus\s*!==\s*["']CONFIRMED["']/);
    expect(fonte).toMatch(/data\.attribute\.motivo/);
  });
});
