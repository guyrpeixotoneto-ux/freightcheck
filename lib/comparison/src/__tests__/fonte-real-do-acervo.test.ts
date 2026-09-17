import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  captureRaw,
  preview,
  promote,
  receiveFile,
  stage,
} from "@workspace/ingest";
import {
  estagiarExtratoReal,
  vincularLancamentosAosFatos,
  DATASET_FAMILY_FINANCIAMENTO_REAL,
} from "@workspace/ingest/financiamento-real";
import { fonteRealDoAcervo } from "../fonte-real-do-acervo";
import {
  fonteDoRealizadoEmUso,
  registrarFonteDoRealizado,
  SEM_FONTE_DO_REALIZADO,
} from "../realizado-de-finame";

/**
 * A porta do realizado, com o acervo do outro lado.
 *
 * `realizado-de-finame.ts` declarou o contrato e disse o que faltava: *um*
 * adaptador. Estes testes provam que o que falta deixou de faltar — e provam
 * sobre o acervo de verdade, importado pelo pipeline oficial a partir do extrato
 * do ERP, e não sobre uma fonte de mentira montada para o teste passar.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ACERVO = path.resolve(AQUI, "../../../../attached_assets");
const EXTRATO = path.join(ACERVO, "Finames_Real_2026.xlsx");
const REMUNERADO = path.join(ACERVO, "Modelo_Cavalo.xlsx");

const UNIDADE_CNPJ = "07526557001505";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("fonte_real_do_acervo");

  /* O remunerado primeiro — é dele que sai o cadastro que resolve o tipo de
     cada placa, e é a ordem em que as coisas acontecem na operação. */
  const remunerado = await receiveFile(ctx.db, {
    filePath: REMUNERADO,
    declaredType: "CAVALO",
  });
  await captureRaw(ctx.db, remunerado.importRunId);
  await stage(ctx.db, remunerado.importRunId);
  await preview(ctx.db, remunerado.importRunId);
  await promote(ctx.db, remunerado.importRunId);

  const real = await receiveFile(ctx.db, {
    filePath: EXTRATO,
    declaredType: "CAVALO",
    declaredFamily: DATASET_FAMILY_FINANCIAMENTO_REAL,
    declaredUnidade: UNIDADE_CNPJ,
    declaredGranularity: "MENSAL",
  });
  await captureRaw(ctx.db, real.importRunId);
  await estagiarExtratoReal(ctx.db, real.importRunId, { unidadeNome: "CAMAÇARI" });
  await preview(ctx.db, real.importRunId);
  await promote(ctx.db, real.importRunId);
  await vincularLancamentosAosFatos(ctx.db, real.importRunId);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const escopo = { scopeHash: null, canal: null, entityTypes: ["CAVALO", "CARRETA"] };

describe("o adaptador do acervo importado", () => {
  it("lista as competências que o extrato trouxe, no formato da auditoria", async () => {
    const fonte = fonteRealDoAcervo(ctx.db);
    const resposta = await fonte.competenciasDisponiveis(escopo);

    expect("competencias" in resposta).toBe(true);
    if (!("competencias" in resposta)) return;
    /* `YYYY-MM`, como `Competencia` manda — e não a data da vigência. */
    expect(resposta.competencias).toContain("2026-05");
    expect(resposta.competencias[0]).toMatch(/^\d{4}-\d{2}$/);
    expect(resposta.competencias).toEqual([...resposta.competencias].sort());
  });

  it("entrega o custo por placa, com o bruto do razão ao lado", async () => {
    const fonte = fonteRealDoAcervo(ctx.db);
    const resposta = await fonte.valoresDaCompetencia(escopo, "2026-05");

    expect("valores" in resposta).toBe(true);
    if (!("valores" in resposta)) return;
    expect(resposta.valores.length).toBeGreaterThan(50);

    const linha = resposta.valores.find((v) => v.entityLabel === "RPH9E62");
    expect(linha).toBeDefined();
    /*
      A placa RPH9E62 tem dois lançamentos em maio sob o mesmo documento —
      principal R$ 16.352,26 e juros R$ 5.450,76 —, e o consolidado é a soma.
    */
    expect(linha!.valor).toBeCloseTo(21803.02, 2);
    /*
      E o bruto é o que o razão escreveu: negativo, porque o financiamento é
      lançado a crédito. É por ele que alguém confere contra o extrato.
    */
    expect(linha!.bruto).toBeCloseTo(-21803.02, 2);
    expect(linha!.entityType).toBe("CAVALO");
  });

  it("a convenção de sinal é declarada, e é a do razão contábil", () => {
    /*
      Declarada, nunca inferida — e a razão está no contrato: inferir pela
      maioria funcionaria até o mês em que a operação tivesse um estorno, e aí o
      dinheiro que voltou entraria como custo.
    */
    expect(fonteRealDoAcervo(ctx.db).convencaoDeSinal).toBe("CUSTO_NEGATIVO");
  });

  it("um mês que o extrato não trouxe é indisponibilidade, e não lista vazia", async () => {
    /*
      Lista vazia a tela desenharia como um mês sem movimento. A diferença é o
      que este contrato existe para preservar.
    */
    const resposta = await fonteRealDoAcervo(ctx.db).valoresDaCompetencia(
      escopo,
      "2025-01",
    );
    expect("indisponivel" in resposta).toBe(true);
    if (!("indisponivel" in resposta)) return;
    expect(resposta.indisponivel.motivo).toBe("SEM_COMPETENCIA");
    expect(resposta.indisponivel.frase).toContain("2025-01");
  });

  it("o recorte de unidade viaja em cada pergunta, e vazio não devolve tudo", async () => {
    /*
      A autorização é por requisição: a mesma instância responde a duas pessoas
      com acesso a unidades diferentes. Um escopo que não é o da vigência não
      pode devolver o custo dela.
    */
    const resposta = await fonteRealDoAcervo(ctx.db).valoresDaCompetencia(
      { ...escopo, scopeHash: "hash-de-outra-unidade" },
      "2026-05",
    );
    expect("indisponivel" in resposta).toBe(true);
  });

  it("recorta por tipo de ativo — carreta não traz o cavalo junto", async () => {
    const resposta = await fonteRealDoAcervo(ctx.db).valoresDaCompetencia(
      { ...escopo, entityTypes: ["CARRETA"] },
      "2026-05",
    );
    /* Este acervo só tem cavalo classificado, então a carreta não tem o que
       mostrar — e isso é indisponibilidade da competência para aquele recorte. */
    if ("valores" in resposta) {
      expect(resposta.valores.every((v) => v.entityType === "CARRETA")).toBe(true);
    } else {
      expect(resposta.indisponivel.motivo).toBe("SEM_COMPETENCIA");
    }
  });

  it("o total do adaptador bate com o fato gravado na vigência", async () => {
    /*
      A conferência que impede o adaptador de virar uma segunda régua: o que ele
      entrega é o que está em `fato_visivel`, e não uma releitura dos
      lançamentos com outra conta.
    */
    const { rows } = await ctx.db.execute<{ total: string }>(sql`
      SELECT sum(f.value_numeric)::text AS total
        FROM fato_visivel f
        JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.effective_date = '2026-05-01' AND s.status <> 'SUPERSEDED'
    `);

    const resposta = await fonteRealDoAcervo(ctx.db).valoresDaCompetencia(
      escopo,
      "2026-05",
    );
    if (!("valores" in resposta)) throw new Error("esperava valores");
    const somaDoAdaptador = resposta.valores.reduce((s, v) => s + (v.valor ?? 0), 0);
    expect(somaDoAdaptador).toBeCloseTo(Number(rows[0].total), 2);
  });
});

describe("a fonte em uso", () => {
  it("sem ninguém registrar, continua dizendo a verdade sobre não existir", () => {
    /*
      É o estado do navegador e o de um teste de unidade: `@workspace/comparison`
      não conhece banco, e quem registra é o servidor na partida.
    */
    expect(fonteDoRealizadoEmUso()).toBe(SEM_FONTE_DO_REALIZADO);
  });

  it("registrada, é ela que a auditoria passa a consultar", async () => {
    registrarFonteDoRealizado(fonteRealDoAcervo(ctx.db));
    try {
      const fonte = fonteDoRealizadoEmUso();
      expect(fonte.nome).toBe("acervo-financiamento-real");

      const resposta = await fonte.competenciasDisponiveis(escopo);
      expect("competencias" in resposta).toBe(true);
    } finally {
      /* O registro é global ao processo: devolvê-lo evita que este teste
         decida o resultado dos outros arquivos da suíte. */
      registrarFonteDoRealizado(SEM_FONTE_DO_REALIZADO);
    }
  });
});
