import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "../testing";
import {
  canonicalScopeOf,
  canonicalSnapshotKey,
  datasetFamilyFor,
  normalizeChannel,
  normalizeDocumento,
  normalizeIdentifier,
  normalizeScopeCode,
  serializeCanonicalScope,
  type ScopeEntry,
} from "../canonical-identity";

/**
 * O espelho: o que o TypeScript calcula e o que o Postgres calcula têm de ser o
 * mesmo valor, byte a byte.
 *
 * A garantia do produto — no máximo uma vigência ativa por identidade — é um
 * índice único sobre `canonical_snapshot_key`, uma coluna **gerada pelo banco**.
 * O TypeScript calcula a mesma chave para decidir antes de gravar: se é revisão
 * ou vigência nova, se o arquivo repetido traz dado novo. Se os dois lados
 * discordarem, o pipeline decide por uma identidade e o banco tranca outra — e
 * a promoção falha no índice, longe da causa.
 *
 * Este arquivo é o que os comentários de `canonical-identity.ts` e de
 * `0015_canonical_identity.sql` sempre prometeram. Ele roda contra PostgreSQL
 * de verdade, com as funções que a migration cria: `translate`, `COLLATE "C"`,
 * `sha256` e `convert_to` não têm simulacro que prove alguma coisa.
 */
let banco: TestDb;

beforeAll(async () => {
  banco = await createTestDatabase("identidade_sql");
}, 300_000);

afterAll(async () => {
  await banco?.drop();
}, 300_000);

async function sql1<T>(texto: string, valores: unknown[] = []): Promise<T> {
  const { rows } = await banco.pool.query(texto, valores);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
}

describe("documento: CNPJ e CPF", () => {
  const casos = [
    ["12.345.678/0001-99", "CNPJ mascarado"],
    ["12345678000199", "CNPJ numérico"],
    ["1234567000199", "CNPJ que perdeu o zero à esquerda no Excel"],
    ["123456780001", "12 dígitos"],
    ["  12.345.678/0001-99  ", "com espaço em volta"],
    ["123.456.789-01", "CPF mascarado"],
    ["12345678901", "CPF numérico"],
    ["1234567890", "CPF sem o zero da frente"],
    ["123456789", "9 dígitos"],
    ["", "vazio"],
    ["abc", "sem dígito nenhum"],
    ["12345678", "curto demais para ser documento"],
    ["123456789012345", "longo demais"],
  ] as const;

  for (const [entrada, o_que] of casos) {
    it(`${o_que}: ${JSON.stringify(entrada)}`, async () => {
      const noSql = await sql1<string>(
        "SELECT freightcheck_norm_documento($1)",
        [entrada],
      );
      expect(noSql).toBe(normalizeDocumento(entrada));
    });
  }

  it("o CNPJ mascarado e o numérico dão o mesmo documento nos dois lados", async () => {
    const mascarado = await sql1<string>(
      "SELECT freightcheck_norm_documento($1)",
      ["12.345.678/0001-99"],
    );
    const numerico = await sql1<string>(
      "SELECT freightcheck_norm_documento($1)",
      ["12345678000199"],
    );
    expect(mascarado).toBe(numerico);
    expect(normalizeDocumento("12.345.678/0001-99")).toBe(mascarado);
  });
});

describe("identificador: placa e chassi", () => {
  const casos = [
    "ABC-1D23",
    "abc1d23",
    "  ABC 1D23  ",
    "ABC1D23",
    "9BW ZZZ377VT004251",
    "",
    "ÁBC-1D23",
  ];

  for (const entrada of casos) {
    it(JSON.stringify(entrada), async () => {
      const noSql = await sql1<string>(
        "SELECT freightcheck_norm_identificador($1)",
        [entrada],
      );
      expect(noSql).toBe(normalizeIdentifier(entrada));
    });
  }
});

describe("canal", () => {
  const casos = [
    "EMPURRADA",
    "empurrada",
    "  Empurrada  ",
    "EMPURRADA ESPECIAL",
    "empurrada-especial",
    "EMPURRADA__ESPECIAL",
    "ROTA",
    "Rota Ecológica",
    "SÃO PAULO",
    "",
    "_",
    "___",
  ];

  for (const entrada of casos) {
    it(JSON.stringify(entrada), async () => {
      const noSql = await sql1<string>("SELECT freightcheck_norm_canal($1)", [
        entrada,
      ]);
      expect(noSql).toBe(normalizeChannel(entrada));
    });
  }

  it("o canal sai do rótulo pela mesma gramática dos dois lados", async () => {
    const rotulos = [
      "EMPURRADA_1_8_2026",
      "EMPURRADA_01_08_2026",
      "ROTA_15_12_2025",
      "empurrada_especial_1_8_2026",
      "SEM_PADRAO",
      "  EMPURRADA_1_8_2026  ",
    ];
    for (const rotulo of rotulos) {
      const noSql = await sql1<string>(
        "SELECT freightcheck_canal_do_rotulo($1)",
        [rotulo],
      );
      // O espelho em TypeScript do `canal_do_rotulo`: o prefixo quando o rótulo
      // casa com o padrão, o rótulo inteiro quando não casa. É o que
      // `pipeline.ts` faz com `vigencia.channel ?? label`.
      const prefixo = rotulo
        .trim()
        .match(/^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$/);
      expect(noSql).toBe(normalizeChannel(prefixo ? prefixo[1]! : rotulo.trim()));
    }
  });
});

describe("código de escopo por tipo", () => {
  const casos: [string, string][] = [
    ["UNIDADE", "12.345.678/0001-99"],
    ["unidade", "12345678000199"],
    ["OPERADOR", "123.456.789-01"],
    ["REGIONAL", "Nordeste"],
    ["REGIONAL", "  NORDESTE  "],
    ["REGIONAL", "São Paulo - Interior"],
    ["REGIONAL", "SAO   PAULO"],
    ["REGIONAL", "Camaçari"],
    ["REGIONAL", ""],
  ];

  for (const [tipo, codigo] of casos) {
    it(`${tipo} / ${JSON.stringify(codigo)}`, async () => {
      const noSql = await sql1<string>(
        "SELECT freightcheck_norm_scope_code($1, $2)",
        [tipo, codigo],
      );
      expect(noSql).toBe(normalizeScopeCode(tipo, codigo));
    });
  }
});

describe("escopo canônico", () => {
  const escopos: [string, ScopeEntry[]][] = [
    ["uma unidade", [{ scopeType: "UNIDADE", code: "12.345.678/0001-99" }]],
    [
      "ordem invertida",
      [
        { scopeType: "REGIONAL", code: "Nordeste" },
        { scopeType: "UNIDADE", code: "12345678000199" },
      ],
    ],
    [
      "a mesma, na outra ordem",
      [
        { scopeType: "UNIDADE", code: "12345678000199" },
        { scopeType: "REGIONAL", code: "Nordeste" },
      ],
    ],
    [
      "com repetição escrita de dois jeitos",
      [
        { scopeType: "UNIDADE", code: "12.345.678/0001-99" },
        { scopeType: "UNIDADE", code: "12345678000199" },
        { scopeType: "unidade", code: "12345678000199" },
      ],
    ],
    [
      "com entrada vazia no meio",
      [
        { scopeType: "UNIDADE", code: "12345678000199" },
        { scopeType: "REGIONAL", code: "   " },
        { scopeType: "", code: "X" },
      ],
    ],
    [
      "duas unidades, ordem de byte contra ordem linguística",
      [
        { scopeType: "REGIONAL", code: "CAMAÇARI" },
        { scopeType: "REGIONAL", code: "CAMACARI" },
        { scopeType: "REGIONAL", code: "CAMPINAS" },
      ],
    ],
    ["vazio", []],
  ];

  for (const [o_que, entrada] of escopos) {
    it(`${o_que}: mesma forma canônica dos dois lados`, async () => {
      const noSql = await sql1<{ scopeType: string; code: string }[]>(
        "SELECT freightcheck_canonical_scope($1::jsonb)",
        [JSON.stringify(entrada)],
      );
      expect(noSql).toEqual(canonicalScopeOf(entrada));
    });

    it(`${o_que}: mesma serialização dos dois lados`, async () => {
      const canonico = canonicalScopeOf(entrada);
      const noSql = await sql1<string>(
        "SELECT freightcheck_serialize_scope(freightcheck_canonical_scope($1::jsonb))",
        [JSON.stringify(entrada)],
      );
      expect(noSql).toBe(serializeCanonicalScope(canonico));
    });
  }

  it("a ordem do escopo não muda a serialização", async () => {
    const a = [
      { scopeType: "UNIDADE", code: "12345678000199" },
      { scopeType: "REGIONAL", code: "NORDESTE" },
    ];
    const b = [...a].reverse();
    const sa = await sql1<string>(
      "SELECT freightcheck_serialize_scope(freightcheck_canonical_scope($1::jsonb))",
      [JSON.stringify(a)],
    );
    const sb = await sql1<string>(
      "SELECT freightcheck_serialize_scope(freightcheck_canonical_scope($1::jsonb))",
      [JSON.stringify(b)],
    );
    expect(sa).toBe(sb);
    expect(serializeCanonicalScope(canonicalScopeOf(a))).toBe(sa);
  });
});

describe("data efetiva", () => {
  for (const data of [
    "2026-08-01",
    "2026-12-31",
    "2026-01-05",
    "1999-09-09",
    "2000-02-29",
  ]) {
    it(data, async () => {
      const noSql = await sql1<string>("SELECT freightcheck_iso_date($1::date)", [
        data,
      ]);
      expect(noSql).toBe(data);
    });
  }
});

describe("família do dataset", () => {
  for (const tipo of ["CAVALO", "CARRETA", "cavalo", "DOLLY", ""]) {
    it(JSON.stringify(tipo), async () => {
      const noSql = await sql1<string>(
        "SELECT freightcheck_dataset_family($1)",
        [tipo],
      );
      expect(noSql).toBe(datasetFamilyFor(tipo));
    });
  }
});

describe("a chave canônica inteira", () => {
  const identidades = [
    {
      o_que: "vigência simples",
      sourceSystem: "FREIGHTEC",
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      channel: "EMPURRADA",
      effectiveDate: "2026-08-01",
      scope: [{ scopeType: "UNIDADE", code: "12345678000199" }],
    },
    {
      o_que: "a mesma, com o CNPJ mascarado e o canal em caixa baixa",
      sourceSystem: " freightec ",
      datasetFamily: " remuneracao_equipamento ",
      channel: "empurrada",
      effectiveDate: "2026-08-01",
      scope: [{ scopeType: "unidade", code: "12.345.678/0001-99" }],
    },
    {
      o_que: "escopo múltiplo fora de ordem",
      sourceSystem: "FREIGHTEC",
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      channel: "ROTA",
      effectiveDate: "2026-09-15",
      scope: [
        { scopeType: "REGIONAL", code: "São Paulo" },
        { scopeType: "UNIDADE", code: "1234567000199" },
        { scopeType: "REGIONAL", code: "SAO PAULO" },
      ],
    },
    {
      o_que: "canal com acento",
      sourceSystem: "FREIGHTEC",
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      channel: "ROTA ECOLÓGICA",
      effectiveDate: "2026-08-01",
      scope: [{ scopeType: "UNIDADE", code: "12345678000199" }],
    },
    {
      o_que: "sem escopo",
      sourceSystem: "FREIGHTEC",
      datasetFamily: "REMUNERACAO_EQUIPAMENTO",
      channel: "EMPURRADA",
      effectiveDate: "2026-08-01",
      scope: [],
    },
  ];

  for (const { o_que, ...identidade } of identidades) {
    it(o_que, async () => {
      const noSql = await sql1<string>(
        `SELECT freightcheck_snapshot_key($1, $2, $3, $4::date, freightcheck_canonical_scope($5::jsonb))`,
        [
          identidade.sourceSystem,
          identidade.datasetFamily,
          identidade.channel,
          identidade.effectiveDate,
          JSON.stringify(identidade.scope),
        ],
      );
      expect(noSql).toMatch(/^[0-9a-f]{64}$/);
      expect(noSql).toBe(canonicalSnapshotKey(identidade));
    });
  }

  it("as duas primeiras identidades são a mesma vigência, nos dois lados", async () => {
    const [a, b] = identidades;
    expect(canonicalSnapshotKey(a!)).toBe(canonicalSnapshotKey(b!));
    const chaves = await Promise.all(
      [a!, b!].map((i) =>
        sql1<string>(
          `SELECT freightcheck_snapshot_key($1, $2, $3, $4::date, freightcheck_canonical_scope($5::jsonb))`,
          [
            i.sourceSystem,
            i.datasetFamily,
            i.channel,
            i.effectiveDate,
            JSON.stringify(i.scope),
          ],
        ),
      ),
    );
    expect(chaves[0]).toBe(chaves[1]);
  });

  it("canais diferentes na mesma data continuam identidades diferentes", async () => {
    const base = identidades[0]!;
    const outra = { ...base, channel: "ROTA" };
    expect(canonicalSnapshotKey(base)).not.toBe(canonicalSnapshotKey(outra));
    const chave = await sql1<string>(
      `SELECT freightcheck_snapshot_key($1, $2, $3, $4::date, freightcheck_canonical_scope($5::jsonb))`,
      [
        outra.sourceSystem,
        outra.datasetFamily,
        outra.channel,
        outra.effectiveDate,
        JSON.stringify(outra.scope),
      ],
    );
    expect(chave).toBe(canonicalSnapshotKey(outra));
  });

  it("a chave que o banco grava sozinho é a que o TypeScript calcula", async () => {
    // A prova que interessa: não a função chamada à mão, e sim a coluna gerada
    // — que é quem alimenta o índice único.
    const { rows } = await banco.pool.query<{ chave: string }>(
      `WITH origem AS (
         INSERT INTO "source_file" ("filename", "content_sha256", "byte_size", "storage_path")
         VALUES ('parity.xlsx', md5(random()::text), 1, '/tmp/parity.xlsx') RETURNING "id"
       ), corrida AS (
         INSERT INTO "import_run" ("source_file_id", "status")
         SELECT "id", 'PROMOTED' FROM origem RETURNING "id", "source_file_id"
       )
       INSERT INTO "snapshot" (
         "source_file_id", "import_run_id", "source_system", "source_label",
         "effective_date", "entity_type_set",
         "dataset_family", "canal", "canonical_scope")
       SELECT c."source_file_id", c."id", 'FREIGHTEC', 'EMPURRADA_1_8_2026',
              '2026-08-01', 'CARRETA',
              'REMUNERACAO_EQUIPAMENTO', 'EMPURRADA',
              '[{"scopeType":"UNIDADE","code":"12345678000199"}]'::jsonb
         FROM corrida c
       RETURNING "canonical_snapshot_key" AS chave`,
    );
    expect(rows[0]!.chave).toBe(
      canonicalSnapshotKey({
        sourceSystem: "FREIGHTEC",
        datasetFamily: "REMUNERACAO_EQUIPAMENTO",
        channel: "EMPURRADA",
        effectiveDate: "2026-08-01",
        scope: [{ scopeType: "UNIDADE", code: "12345678000199" }],
      }),
    );
  });
});

/**
 * O limite conhecido do espelho, prendido por teste para que ele seja uma
 * decisão e não uma surpresa.
 *
 * O TypeScript tira acento por `normalize("NFD")`, que cobre o Unicode inteiro.
 * O SQL tira por `translate`, com uma lista fixa que cobre Latin-1 e o
 * essencial de Latin Extended-A — a faixa de que nome de regional e de unidade
 * precisam. Fora dessa lista os dois divergem.
 *
 * Isso **não** é corrigível trocando a função: `freightcheck_sem_acento` está
 * dentro de `canonical_snapshot_key`, que é uma coluna gerada `STORED` e
 * sustenta um índice único. Reescrever a função mudaria a chave das linhas
 * futuras sem recalcular as gravadas, e o banco passaria a ter duas gerações de
 * identidade convivendo — exatamente o defeito que a `0015` fechou.
 *
 * O que acontece na prática se um caractere desses aparecer: o TypeScript
 * calcula uma chave, o banco calcula outra, e a promoção falha no índice único.
 * Falha alta e visível, não duplicata silenciosa.
 */
describe("o limite do espelho", () => {
  it("diverge fora da faixa que o translate cobre, e falha alto quando isso acontece", async () => {
    const foraDaFaixa = "Ř";
    const noSql = await sql1<string>(
      "SELECT freightcheck_norm_identificador($1)",
      [foraDaFaixa],
    );
    expect(noSql).toBe("");
    expect(normalizeIdentifier(foraDaFaixa)).toBe("R");
  });

  it("cobre a faixa que o domínio usa: todo o Latin-1 acentuado do português", async () => {
    const portugues = "áàâãäçéêëíïóôõöúüñÁÀÂÃÄÇÉÊËÍÏÓÔÕÖÚÜÑ";
    for (const letra of portugues) {
      const noSql = await sql1<string>(
        "SELECT freightcheck_norm_scope_code('REGIONAL', $1)",
        [letra],
      );
      expect(noSql, `divergiu em ${letra}`).toBe(
        normalizeScopeCode("REGIONAL", letra),
      );
    }
  });
});
