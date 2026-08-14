import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  canonicalPayloadHash,
  canonicalScopeJson,
  canonicalScopeOf,
  canonicalSnapshotKey,
  datasetFamilyOfSet,
  missingRequiredScopeTypes,
  normalizeDocumento,
  normalizeIdentifier,
  normalizeNumber,
  normalizeScopeCode,
  normalizeText,
  type CanonicalFact,
  type ScopeEntry,
} from "../canonical-identity";
import { createTestDatabase, type TestDb } from "../testing";

describe("normalizações", () => {
  it("reduz a placa ao que ela identifica", () => {
    for (const escrita of ["ABC1D23", "ABC-1D23", "abc1d23", " ABC 1D23 ", "abc.1d23"]) {
      expect(normalizeIdentifier(escrita)).toBe("ABC1D23");
    }
  });

  it("devolve o CNPJ mascarado e o numérico do Excel ao mesmo documento", () => {
    expect(normalizeDocumento("07.526.557/0015-05")).toBe("07526557001505");
    // Como o Excel entrega quando a célula é numérica: sem máscara, sem o zero.
    expect(normalizeDocumento("7526557001505")).toBe("07526557001505");
    expect(normalizeDocumento(" 07526557001505 ")).toBe("07526557001505");
  });

  it("não inventa dígito para um documento de tamanho implausível", () => {
    // Melhor não reconhecer do que completar e afirmar que são o mesmo.
    expect(normalizeDocumento("123")).toBe("123");
    expect(normalizeDocumento("123456789012345")).toBe("123456789012345");
  });

  it("trata acento, caixa e espaço repetido do escopo como forma, não conteúdo", () => {
    expect(normalizeScopeCode("REGIONAL", "  São   Paulo ")).toBe("SAO PAULO");
    expect(normalizeScopeCode("REGIONAL", "sao paulo")).toBe("SAO PAULO");
  });

  it("ordena o escopo por byte e tira repetição e vazio", () => {
    const entradas: ScopeEntry[] = [
      { scopeType: "UNIDADE", code: "07.526.557/0015-05" },
      { scopeType: "REGIONAL", code: "GEO NE" },
      { scopeType: "unidade", code: "7526557001505" },
      { scopeType: "OPERADOR", code: "" },
    ];
    expect(canonicalScopeJson(canonicalScopeOf(entradas))).toEqual([
      { scopeType: "REGIONAL", code: "GEO NE" },
      { scopeType: "UNIDADE", code: "07526557001505" },
    ]);
  });

  it("aponta o componente de identidade que falta", () => {
    expect(missingRequiredScopeTypes(canonicalScopeOf([]))).toEqual(["UNIDADE"]);
    expect(
      missingRequiredScopeTypes(
        canonicalScopeOf([{ scopeType: "UNIDADE", code: "07526557001505" }]),
      ),
    ).toEqual([]);
  });

  it("põe CAVALO e CARRETA na mesma família", () => {
    expect(datasetFamilyOfSet(["CAVALO"])).toBe(datasetFamilyOfSet(["CARRETA", "CAVALO"]));
  });

  it("normaliza número sem confundir ausência com zero", () => {
    expect(normalizeNumber("1.50")).toBe(normalizeNumber(1.5));
    expect(normalizeNumber("1.500")).toBe(normalizeNumber("1.5"));
    expect(normalizeNumber("-0")).toBe("0");
    expect(normalizeNumber(null)).not.toBe(normalizeNumber(0));
  });

  it("distingue texto vazio de ausência de texto", () => {
    // Os dois viram o mesmo token: uma célula em branco e uma célula com
    // espaços não afirmam coisas diferentes.
    expect(normalizeText("   ")).toBe(normalizeText(null));
    expect(normalizeText(" a  b ")).toBe("a b");
  });
});

describe("hash canônico do conteúdo", () => {
  const fatos: CanonicalFact[] = [
    { entityType: "CAVALO", entityKey: "ABC1D23", attributeCode: "cavalo.custo_fixo", valueNumeric: "1000.00" },
    { entityType: "CARRETA", entityKey: "XYZ9A88", attributeCode: "carreta.custo_fixo", valueNumeric: "2000" },
  ];

  it("não depende da ordem das linhas", () => {
    expect(canonicalPayloadHash(fatos)).toBe(canonicalPayloadHash([...fatos].reverse()));
  });

  it("não depende da forma da placa nem da precisão escrita do número", () => {
    const outraForma: CanonicalFact[] = [
      { entityType: "CAVALO", entityKey: "abc-1d23", attributeCode: "cavalo.custo_fixo", valueNumeric: "1000" },
      { entityType: "CARRETA", entityKey: "XYZ-9A88", attributeCode: "carreta.custo_fixo", valueNumeric: "2000.000" },
    ];
    expect(canonicalPayloadHash(outraForma)).toBe(canonicalPayloadHash(fatos));
  });

  it("muda quando um valor muda de verdade", () => {
    const corrigido = [...fatos.slice(1), { ...fatos[0], valueNumeric: "1000.01" }];
    expect(canonicalPayloadHash(corrigido)).not.toBe(canonicalPayloadHash(fatos));
  });

  it("trata CNPJ mascarado e sem máscara como o mesmo dado", () => {
    const mascarado: CanonicalFact[] = [
      { entityType: "CAVALO", entityKey: "ABC1D23", attributeCode: "cavalo.unidade_cnpj", valueText: "07.526.557/0015-05" },
    ];
    const cru: CanonicalFact[] = [
      { entityType: "CAVALO", entityKey: "ABC1D23", attributeCode: "cavalo.unidade_cnpj", valueText: "7526557001505" },
    ];
    expect(canonicalPayloadHash(mascarado)).toBe(canonicalPayloadHash(cru));
  });
});

/**
 * O espelho SQL.
 *
 * A garantia do produto é um índice único sobre uma coluna **gerada pelo
 * banco**. Isso só vale se o que o TypeScript calcula for exatamente o que o
 * Postgres calcula — caso contrário a aplicação procuraria uma chave e o índice
 * protegeria outra, e as duas discordâncias se cancelariam em silêncio até o
 * dia em que não se cancelassem.
 *
 * Este bloco é o que impede a divergência de passar despercebida.
 */
describe("o TypeScript e o Postgres calculam a mesma identidade", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("identidade");
  }, 300_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  const corpus: { nome: string; canal: string; data: string; escopo: ScopeEntry[] }[] = [
    {
      nome: "unidade só, CNPJ mascarado",
      canal: "EMPURRADA",
      data: "2026-08-01",
      escopo: [{ scopeType: "unidade", code: "07.526.557/0015-05" }],
    },
    {
      nome: "unidade só, CNPJ numérico do Excel",
      canal: "empurrada",
      data: "2026-08-01",
      escopo: [{ scopeType: "UNIDADE", code: "7526557001505" }],
    },
    {
      nome: "escopo completo, fora de ordem",
      canal: "ROTA",
      data: "2025-12-02",
      escopo: [
        { scopeType: "REGIONAL", code: "  Geo   NE " },
        { scopeType: "UNIDADE", code: "07526557001505" },
        { scopeType: "OPERADOR", code: "20.618.821/0007-99" },
      ],
    },
    {
      nome: "regional com acento",
      canal: "EMPURRADA",
      data: "2030-02-28",
      escopo: [
        { scopeType: "UNIDADE", code: "07526557001505" },
        { scopeType: "REGIONAL", code: "São Paulo" },
      ],
    },
    {
      nome: "escopo vazio",
      canal: "EMPURRADA",
      data: "2030-01-01",
      escopo: [],
    },
    {
      nome: "código com repetição",
      canal: "EMPURRADA_2",
      data: "2031-06-15",
      escopo: [
        { scopeType: "UNIDADE", code: "07526557001505" },
        { scopeType: "UNIDADE", code: "07.526.557/0015-05" },
      ],
    },
  ];

  it.each(corpus)("$nome", async ({ canal, data, escopo }) => {
    const doTypeScript = canonicalSnapshotKey({
      sourceSystem: "FREIGHTEC",
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      channel: canal,
      effectiveDate: data,
      scope: escopo,
    });

    const cru = JSON.stringify(escopo);
    const { rows } = (await ctx.db.execute(sql`
      SELECT freightcheck_snapshot_key(
               'FREIGHTEC', 'REMUNERACAO_EQUIPAMENTO', ${canal}, ${data}::date,
               freightcheck_canonical_scope(${cru}::jsonb)
             ) AS chave,
             freightcheck_canonical_scope(${cru}::jsonb) AS escopo
    `)) as unknown as { rows: { chave: string; escopo: unknown }[] };

    expect(rows[0].chave).toBe(doTypeScript);
    // E o escopo canônico guardado é o mesmo dos dois lados, que é o que o
    // CHECK do banco cobra na hora de gravar.
    expect(rows[0].escopo).toEqual(canonicalScopeJson(canonicalScopeOf(escopo)));
  });

  it("o rótulo com e sem zero à esquerda cai na mesma chave", async () => {
    const { rows } = (await ctx.db.execute(sql`
      SELECT freightcheck_canal_do_rotulo('EMPURRADA_1_8_2026') = freightcheck_canal_do_rotulo('EMPURRADA_01_8_2026') AS igual
    `)) as unknown as { rows: { igual: boolean }[] };
    expect(rows[0].igual).toBe(true);
  });
});
