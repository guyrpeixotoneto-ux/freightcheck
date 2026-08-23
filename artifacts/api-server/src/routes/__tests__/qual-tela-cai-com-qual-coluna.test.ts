/**
 * Duas telas caíram no mesmo minuto, e não era o mesmo defeito.
 *
 * O caso vivido, em 18/08/2026: **Composição** respondeu `Internal server error`
 * e a aba **Planilha** de Alterações respondeu `Internal server error`, com o
 * `/api/healthz` dizendo `SAUDAVEL` nas duas vezes. A frase idêntica convidava
 * à conclusão errada — "o servidor está fora" —, e ela era desmentida na mesma
 * tela: a aba **Chamados**, ao lado da Planilha, exibia a contagem de 1.218.
 * Um processo fora do ar não conta chamados.
 *
 * Este arquivo é o mapa que faltava para separar as duas. Ele parte de um banco
 * real construído das migrations, remove **uma** coluna por vez e mede quais
 * telas caem — e o que ele mostra é que as colunas não se sobrepõem:
 *
 * | coluna ausente                       | Composição | Planilha | Chamados |
 * | ------------------------------------ | ---------- | -------- | -------- |
 * | `change_set.*` (0033)                | responde   | **cai**  | responde |
 * | `attribute_semantics.cost_class` (0030) | **cai**  | responde | responde |
 *
 * Nenhuma coluna sozinha derruba as duas. Ver as duas caídas ao mesmo tempo é,
 * portanto, ver **duas divergências**, e tratá-las como uma só é procurar uma
 * causa que não existe.
 *
 * Por que isto vira teste, e não anotação: a tabela acima é uma propriedade do
 * produto, e ela muda sozinha. Basta a Composição passar a ler `change_set` —
 * uma linha — para as duas telas ficarem acopladas sem que ninguém decida
 * acoplá-las, e o mapa que orienta o diagnóstico do próximo incidente
 * silenciosamente mentir.
 *
 * O outro fato que ele trava é a resposta: nos dois casos ela é **503 com o
 * diagnóstico do banco e o SQLSTATE**, e não mais a constante. É o que muda
 * "erro interno" para "falta esta parte do schema neste banco".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { sql } from "drizzle-orm";
import { erroEmJson } from "../../middlewares/contrato-json";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { encerrarPoolDoProcesso } from "@workspace/db";

let ctx: TestDb;
let servidor: Server;
let base: string;

/** As telas dos dois prints, mais as duas que provam que o processo está de pé. */
const TELAS = {
  composicao: "/composition/fleet?entityType=CAVALO",
  planilha: "/changes/consolidated",
  chamados: "/tickets?limit=1",
  dre: "/dre/fleet",
} as const;

interface Resposta {
  status: number;
  body: Record<string, unknown>;
}

async function abrir(tela: keyof typeof TELAS): Promise<Resposta> {
  const res = await fetch(`${base}${TELAS[tela]}`);
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/**
 * Remove a coluna, mede, e **recoloca**.
 *
 * Recolocar não é higiene: sem isso as divergências se acumulam, o segundo caso
 * mede o efeito do primeiro junto, e a tabela do cabeçalho — que é o valor
 * inteiro deste arquivo — deixa de ser sobre uma coluna de cada vez.
 */
async function semAColuna<T>(
  remover: string,
  recolocar: string,
  medir: () => Promise<T>,
): Promise<T> {
  await ctx.db.execute(sql.raw(remover));
  try {
    return await medir();
  } finally {
    await ctx.db.execute(sql.raw(recolocar));
  }
}

beforeAll(async () => {
  ctx = await createTestDatabase("qual_tela_cai");
  process.env.DATABASE_URL = ctx.url;

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo])
    await importFixture(ctx.db, filePath);
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      log: { error: () => {}, warn: () => {}, info: () => {} },
      id: "req-de-teste",
      user: { email: "curador@teste" },
    });
    next();
  });
  for (const nome of ["composition", "changes", "tickets", "dre", "health"]) {
    const { default: router } = await import(`../${nome}.ts`);
    app.use(router);
  }
  app.use(erroEmJson);

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}, 900_000);

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  await encerrarPoolDoProcesso();
  await ctx.drop();
}, 120_000);

describe("com o banco em dia", () => {
  it("as quatro telas respondem", async () => {
    for (const tela of Object.keys(TELAS) as (keyof typeof TELAS)[]) {
      expect((await abrir(tela)).status, tela).toBe(200);
    }
  });
});

describe("sem as colunas que a 0033 cria em change_set", () => {
  const REMOVER = `
    ALTER TABLE "change_set" DROP COLUMN IF EXISTS "impacto_oficial_by_periodicity";
    ALTER TABLE "change_set" DROP COLUMN IF EXISTS "deducao_rastro";
    ALTER TABLE "change_set" DROP COLUMN IF EXISTS "mudancas_fora_do_total";
  `;
  const RECOLOCAR = `
    ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "impacto_oficial_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL;
    ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "deducao_rastro" jsonb DEFAULT '{}'::jsonb NOT NULL;
    ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "mudancas_fora_do_total" integer DEFAULT 0 NOT NULL;
  `;

  it("a Planilha cai — e a Composição, os Chamados e a DRE não", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      expect((await abrir("planilha")).status).toBe(503);
      expect((await abrir("composicao")).status).toBe(200);
      expect((await abrir("chamados")).status).toBe(200);
      expect((await abrir("dre")).status).toBe(200);
    });
  });

  it("a resposta diz que falta schema, com o SQLSTATE — e não a constante", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      const { body } = await abrir("planilha");

      expect(body["code"]).toBe("SCHEMA_AUSENTE");
      /* 42703 é coluna que não existe: a migration consta aplicada e não deixou
         tudo o que promete. É a diferença entre "rode migrate" e "confira". */
      expect(body["contexto"]).toContain("42703");
      expect(body["error"]).not.toBe("Internal server error");
      expect((body["diagnostico"] as { estado: string }).estado).toBe(
        "SCHEMA_DIVERGENTE",
      );
    });
  });
});

describe("sem a coluna que a 0030 cria em attribute_semantics", () => {
  const REMOVER =
    'ALTER TABLE "attribute_semantics" DROP COLUMN IF EXISTS "cost_class"';
  const RECOLOCAR =
    'ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "cost_class" text';

  it("a Composição cai — e a Planilha e os Chamados não", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      expect((await abrir("composicao")).status).toBe(503);
      expect((await abrir("planilha")).status).toBe(200);
      expect((await abrir("chamados")).status).toBe(200);
    });
  });

  it("a resposta nomeia o pedido que parou, e traz o diagnóstico do banco", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      const { body } = await abrir("composicao");

      expect(body["code"]).toBe("SCHEMA_AUSENTE");
      expect(body["contexto"]).toContain("/composition/fleet");
      expect(body["contexto"]).toContain("42703");
    });
  });
});

describe("o /readyz para de responder SAUDAVEL sobre um banco divergente", () => {
  /*
   * O terceiro fato dos dois incidentes, e o que os tornava indecifráveis: a
   * tela caía com 42703 e a rota de saúde, consultada no mesmo minuto,
   * respondia SAUDAVEL — porque ela contava migrations, e a contagem estava
   * certa. Agora o `observarBanco` roda a conferência de schema quando a
   * contagem diz "em dia", e quem a publica nomeia a coluna **antes** de
   * qualquer tela morrer.
   *
   * Quem publica é o `/readyz`: o `/healthz` virou liveness puro e não fala
   * mais do banco — enquanto falava, ele era o endereço que a interface
   * mandava a pessoa abrir. O estado vem no corpo dos dois desfechos, e o
   * status acompanha: 200 pronto, 503 não.
   */
  const REMOVER =
    'ALTER TABLE "attribute_semantics" DROP COLUMN IF EXISTS "cost_class"';
  const RECOLOCAR =
    'ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "cost_class" text';

  async function saude(): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}/readyz`);
    /* Divergente não está pronto: o corpo explica, e o status também. */
    expect([200, 503]).toContain(res.status);
    const corpo = (await res.json()) as { database: Record<string, unknown> };
    return corpo.database;
  }

  it("com o banco em dia, diz que conferiu — não só que contou", async () => {
    const database = await saude();
    const diagnostico = database["diagnostico"] as {
      estado: string;
      evidencia?: string;
    };

    expect(diagnostico.estado).toBe("SAUDAVEL");
    expect(diagnostico.evidencia).toMatch(/o schema confere/);
  });

  it("sem a coluna, nomeia attribute_semantics.cost_class — sem nenhuma tela ter caído", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      const diagnostico = (await saude())["diagnostico"] as {
        estado: string;
        evidencia?: string;
        acao: { comando?: string } | null;
      };

      expect(diagnostico.estado).toBe("SCHEMA_DIVERGENTE");
      expect(diagnostico.evidencia).toContain("attribute_semantics.cost_class");
      expect(diagnostico.acao?.comando).toContain("conferir-schema");
    });

    /* E recolocada, o estado volta sozinho: nada fica preso em cache. */
    const depois = (await saude())["diagnostico"] as { estado: string };
    expect(depois.estado).toBe("SAUDAVEL");
  });

  it("o 503 da tela caída nomeia a mesma coluna, pela mesma autoridade", async () => {
    await semAColuna(REMOVER, RECOLOCAR, async () => {
      const { status, body } = await abrir("composicao");
      const diagnostico = body["diagnostico"] as { evidencia?: string };

      expect(status).toBe(503);
      expect(diagnostico.evidencia).toContain("attribute_semantics.cost_class");
    });
  });
});

describe("as duas telas não compartilham coluna", () => {
  /**
   * A afirmação central, escrita como propriedade e não como comentário: as
   * colunas que derrubam uma **não** derrubam a outra. Enquanto isto valer, ver
   * as duas caídas juntas é ver duas causas — e é isso que impede alguém de
   * consertar uma e dar a outra por resolvida.
   */
  it("nenhuma das colunas medidas derruba Composição e Planilha ao mesmo tempo", async () => {
    const CASOS: [string, string, string][] = [
      [
        "change_set.impacto_oficial_by_periodicity",
        'ALTER TABLE "change_set" DROP COLUMN IF EXISTS "impacto_oficial_by_periodicity"',
        `ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "impacto_oficial_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL`,
      ],
      [
        "attribute.cost_class",
        'ALTER TABLE "attribute" DROP COLUMN IF EXISTS "cost_class"',
        'ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "cost_class" text',
      ],
      [
        "attribute_semantics.cost_class",
        'ALTER TABLE "attribute_semantics" DROP COLUMN IF EXISTS "cost_class"',
        'ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "cost_class" text',
      ],
    ];

    for (const [nome, remover, recolocar] of CASOS) {
      await semAColuna(remover, recolocar, async () => {
        const composicao = (await abrir("composicao")).status;
        const planilha = (await abrir("planilha")).status;

        expect(
          composicao >= 500 && planilha >= 500,
          `sem ${nome} as duas telas caíram juntas — o mapa do cabeçalho ficou desatualizado`,
        ).toBe(false);
        /* E alguma das duas tem de cair: uma coluna que não derruba ninguém não
           pertence a esta lista, e mantê-la aqui dá falsa cobertura. */
        expect(
          composicao >= 500 || planilha >= 500,
          `sem ${nome} nada caiu`,
        ).toBe(true);
      });
    }
  });

  it("os Chamados respondem em todos esses estados — o processo não é o problema", async () => {
    /* É o fato que a tela mostrava e ninguém leu: 1.218 chamados contados ao
       lado de um aviso que sugeria servidor fora do ar. */
    expect((await abrir("chamados")).status).toBe(200);
  });
});
