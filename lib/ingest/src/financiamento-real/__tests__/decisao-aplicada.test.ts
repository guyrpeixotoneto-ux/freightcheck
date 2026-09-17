import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureRaw, preview, promote, receiveFile, stage } from "../../pipeline";
import { createTestDatabase, type TestDb } from "../../testing";
import { DATASET_FAMILY_FINANCIAMENTO_REAL } from "../../tipos";
import { estagiarExtratoReal, vincularLancamentosAosFatos } from "../estagio";
import { aplicarDecisaoDoReal, AplicacaoRecusada } from "../aplicacao";

/**
 * CLASSIFICAR E APLICAR — a prova de que o número muda no clique.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo prende
 * ---------------------------------------------------------------------------
 * Antes, classificar uma placa gravava uma linha e não mudava nada: o valor só
 * entrava no confronto quando alguém reimportasse aquele mês à mão. A pendência
 * continuava na fila, a soma continuava igual, e não havia como distinguir "a
 * decisão não pegou" de "a decisão ainda não foi aplicada".
 *
 * Os testes abaixo medem as duas coisas que isso tem de virar, sobre o extrato
 * de verdade e pelo pipeline de verdade — sem arquivo novo e sem reimportação
 * manual:
 *
 *  1. **a pendência some e o dinheiro entra.** O mesmo valor que estava fora do
 *     confronto passa a compor o realizado da competência, na tabela e no
 *     total, e a fila da tela deixa de mostrar a placa;
 *  2. **clicar duas vezes não cobra duas vezes.** A segunda aplicação relê o
 *     mesmo RAW, produz o mesmo conteúdo e não abre revisão nenhuma: nenhum
 *     fato duplicado, nenhum centavo a mais.
 *
 * O extrato é o arquivo real de 2026 (903 linhas, 104 placas, 9 competências),
 * e o remunerado entra antes dele porque é de lá que sai o cadastro que resolve
 * o tipo de 55 das placas — as outras 49 são a fila de classificação, que é o
 * objeto deste teste. Nenhuma placa é inventada dos dois lados.
 */

/*
  A falha da promoção, injetada — porque o que este arquivo precisa medir é o
  **desfecho** de uma promoção que não vinga, e não uma maneira específica de
  ela não vingar.

  Torcer um dado do arquivo para provocar a recusa mediria a torção: no dia em
  que a conferência mudasse de lugar, o teste passaria a exercitar outro caminho
  sem que ninguém percebesse. O contrato aqui é "promoção lançou" — e é ele que
  o `promote` abaixo cumpre, com o resto do pipeline intacto.
*/
const falha = vi.hoisted(() => ({ naPromocao: false }));
vi.mock("../../pipeline", async (original) => {
  const real = await original<typeof import("../../pipeline")>();
  return {
    ...real,
    promote: async (...args: Parameters<typeof real.promote>) => {
      if (falha.naPromocao) throw new Error("A promoção caiu no meio, de propósito.");
      return real.promote(...args);
    },
  };
});

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ACERVO = path.resolve(AQUI, "../../../../../attached_assets");
const EXTRATO = path.join(ACERVO, "Finames_Real_2026.xlsx");
const REMUNERADO = path.join(ACERVO, "Modelo_Cavalo.xlsx");

const UNIDADE_CNPJ = "07526557001505";
const UNIDADE_NOME = "CAMAÇARI";

let ctx: TestDb;
let importRunId: string;

/** O realizado que o confronto lê: fato visível, vigência ativa, por competência. */
async function realizadoDaCompetencia(competencia: string): Promise<number> {
  const { rows } = await ctx.db.execute<{ total: string | null }>(sql`
    SELECT sum(f.value_numeric)::text AS total
      FROM fato_visivel f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
     WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
       AND s.status <> 'SUPERSEDED'
       AND s.effective_date = ${competencia}::date
       AND NOT f.is_null
  `);
  return Number(rows[0]?.total ?? 0);
}

/** O fato de uma placa numa competência — nulo quando ela não é contada. */
async function realizadoDaPlaca(
  placa: string,
  competencia: string,
): Promise<number | null> {
  const { rows } = await ctx.db.execute<{ valor: string }>(sql`
    SELECT f.value_numeric::text AS valor
      FROM fato_visivel f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id AND a.code LIKE '%.finame_real'
      JOIN entity_identifier ident
        ON ident.entity_id = f.entity_id
       AND ident.identifier_type = 'PLACA'
       AND ident.is_current
     WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
       AND s.status <> 'SUPERSEDED'
       AND s.effective_date = ${competencia}::date
       AND ident.identifier_value = ${placa}
  `);
  return rows[0] ? Number(rows[0].valor) : null;
}

/**
 * A fila como a tela a lê — o mesmo recorte de `lerPendenciasDoReal`.
 *
 * Repetido aqui de propósito: o teste tem de provar que a **fila** esvazia, e
 * chamar a função de leitura de `@workspace/comparison` faria este pacote
 * depender dela só para conferir a si mesmo.
 */
async function placasNaFila(): Promise<string[]> {
  const { rows } = await ctx.db.execute<{ placa: string }>(sql`
    SELECT DISTINCT l.placa
      FROM finame_real_lancamento l
     WHERE l.status = 'PENDENTE_DE_CLASSIFICACAO'
       AND l.import_run_id IN (
             SELECT DISTINCT ON (r.source_file_id) r.id
               FROM import_run r
              WHERE r.source_file_id IN (
                      SELECT dono.source_file_id
                        FROM import_run dono
                        JOIN snapshot s ON s.import_run_id = dono.id
                       WHERE s.dataset_family = 'FINANCIAMENTO_REAL'
                         AND s.status <> 'SUPERSEDED'
                    )
                AND EXISTS (
                      SELECT 1 FROM finame_real_lancamento x WHERE x.import_run_id = r.id
                    )
              ORDER BY r.source_file_id, r.started_at DESC
           )
     ORDER BY 1
  `);
  return rows.map((r) => r.placa);
}

beforeAll(async () => {
  ctx = await createTestDatabase("decisao_do_real_aplicada");

  const remunerado = await receiveFile(ctx.db, {
    filePath: REMUNERADO,
    declaredType: "CAVALO",
  });
  await captureRaw(ctx.db, remunerado.importRunId);
  await stage(ctx.db, remunerado.importRunId);
  await preview(ctx.db, remunerado.importRunId);
  await promote(ctx.db, remunerado.importRunId);

  const extrato = await receiveFile(ctx.db, {
    filePath: EXTRATO,
    declaredType: "CAVALO",
    declaredFamily: DATASET_FAMILY_FINANCIAMENTO_REAL,
    declaredUnidade: UNIDADE_CNPJ,
    declaredGranularity: "MENSAL",
  });
  importRunId = extrato.importRunId;
  await captureRaw(ctx.db, importRunId);
  await estagiarExtratoReal(ctx.db, importRunId, { unidadeNome: UNIDADE_NOME });
  await preview(ctx.db, importRunId);
  await promote(ctx.db, importRunId);
  await vincularLancamentosAosFatos(ctx.db, importRunId);
}, 900_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("classificar e aplicar", () => {
  /** A placa da fila que este teste decide, medida — nunca escolhida a dedo. */
  let placa: string;
  let competencias: string[];
  let valorPendente: number;
  let lancamentosPendentes: number;
  /** O realizado de cada competência alcançada, antes de aplicar. */
  const antes = new Map<string, number>();

  beforeAll(async () => {
    const { rows } = await ctx.db.execute<{
      placa: string;
      competencias: string[];
      lancamentos: string;
      valor: string;
    }>(sql`
      SELECT placa,
             array_agg(DISTINCT competencia::text ORDER BY competencia::text) AS competencias,
             count(*)::text AS lancamentos,
             sum(valor_absoluto)::text AS valor
        FROM finame_real_lancamento
       WHERE status = 'PENDENTE_DE_CLASSIFICACAO'
         AND import_run_id = ${importRunId}::uuid
       GROUP BY placa
       ORDER BY sum(valor_absoluto) DESC
       LIMIT 1
    `);
    placa = rows[0].placa;
    competencias = rows[0].competencias;
    lancamentosPendentes = Number(rows[0].lancamentos);
    valorPendente = Number(Number(rows[0].valor).toFixed(2));
    for (const c of competencias) antes.set(c, await realizadoDaCompetencia(c));
  }, 600_000);

  it("a placa está na fila e fora do confronto — o estado que a tela mostra", async () => {
    expect(await placasNaFila()).toContain(placa);
    expect(valorPendente).toBeGreaterThan(0);
    for (const competencia of competencias) {
      expect(await realizadoDaPlaca(placa, competencia)).toBeNull();
    }
  });

  it("aplicar move o valor para o realizado, sem arquivo novo", async () => {
    const resultado = await aplicarDecisaoDoReal(ctx.db, {
      tipo: "CLASSIFICAR_ATIVO",
      chave: placa,
      valor: "CAVALO",
      motivo: "Conferido no cadastro da transportadora: é cavalo mecânico.",
      decididoPor: "auditor@freightcheck.dev",
    });

    expect(resultado.aplicada).toBe(true);
    expect(resultado.lancamentosAfetados).toBe(lancamentosPendentes);
    expect(resultado.competencias).toEqual(competencias);
    expect(resultado.valor).toBeCloseTo(valorPendente, 2);
    /* Uma revisão por competência alcançada, e nenhuma além delas. */
    expect(resultado.revisoes).toHaveLength(competencias.length);
    expect(resultado.revisoes.every((r) => r.revisao === 2)).toBe(true);
    expect(resultado.efeito).toContain("Aplicada");

    /* 1. A pendência sumiu da fila. */
    expect(await placasNaFila()).not.toContain(placa);

    /* 2. O valor passou a compor o Real, placa a placa. */
    for (const competencia of competencias) {
      expect(await realizadoDaPlaca(placa, competencia)).not.toBeNull();
    }

    /* 3. E o total da competência subiu exatamente o que estava retido. */
    let subiu = 0;
    for (const competencia of competencias) {
      subiu += (await realizadoDaCompetencia(competencia)) - antes.get(competencia)!;
    }
    expect(subiu).toBeCloseTo(valorPendente, 2);
  }, 600_000);

  it("o lançamento aponta para o fato que passou a compor", async () => {
    const { rows } = await ctx.db.execute<{
      status: string;
      entity_type: string;
      fact_id: string | null;
      snapshot_id: string | null;
    }>(sql`
      SELECT l.status, l.entity_type, l.fact_id::text, l.snapshot_id::text
        FROM finame_real_lancamento l
        JOIN import_run ir ON ir.id = l.import_run_id
       WHERE l.placa = ${placa}
       ORDER BY ir.started_at DESC, l.competencia
       LIMIT ${lancamentosPendentes}
    `);
    expect(rows).toHaveLength(lancamentosPendentes);
    expect(rows.every((r) => r.status === "ACEITO")).toBe(true);
    expect(rows.every((r) => r.entity_type === "CAVALO")).toBe(true);
    /* O rastreio fecha: cada lançamento sabe que fato compõe, e em que vigência. */
    expect(rows.every((r) => r.fact_id !== null && r.snapshot_id !== null)).toBe(true);
  });

  it("a revisão anterior continua no histórico, e só as competências alcançadas mudaram", async () => {
    const { rows } = await ctx.db.execute<{
      effective_date: string;
      revision: number;
      status: string;
    }>(sql`
      SELECT effective_date::text, revision, status
        FROM snapshot
       WHERE dataset_family = 'FINANCIAMENTO_REAL'
       ORDER BY effective_date, revision
    `);

    for (const competencia of competencias) {
      const daCompetencia = rows.filter((r) => r.effective_date === competencia);
      /* A que estava ativa não foi editada: foi posta de lado, e continua legível. */
      expect(daCompetencia.find((r) => r.revision === 1)?.status).toBe("SUPERSEDED");
      expect(daCompetencia.find((r) => r.revision === 2)?.status).toBe("CLOSED");
    }

    /* Nenhuma vigência fora do alcance da decisão ganhou revisão. */
    const intocadas = rows.filter((r) => !competencias.includes(r.effective_date));
    expect(intocadas.every((r) => r.revision === 1 && r.status === "CLOSED")).toBe(true);
  });

  it("a decisão fica auditável: usuário, data, competências e lançamentos", async () => {
    const { rows } = await ctx.db.execute<{
      tipo: string;
      chave: string;
      valor: string | null;
      motivo: string;
      decidido_por: string;
      competencias: string[];
      lancamentos_afetados: number;
      aplicada_por: string | null;
      aplicada_em: string | null;
      aplicacao_run_id: string | null;
    }>(sql`
      SELECT tipo, chave, valor, motivo, decidido_por, competencias,
             lancamentos_afetados, aplicada_por, aplicada_em::text, aplicacao_run_id::text
        FROM financiamento_real_decisao
       WHERE chave = ${placa}
       ORDER BY decidido_em
    `);

    expect(rows).toHaveLength(1);
    const decisao = rows[0];
    expect(decisao.tipo).toBe("CLASSIFICAR_ATIVO");
    expect(decisao.valor).toBe("CAVALO");
    expect(decisao.decidido_por).toBe("auditor@freightcheck.dev");
    expect(decisao.motivo).toContain("cavalo mecânico");
    expect(decisao.competencias).toEqual(competencias);
    expect(decisao.lancamentos_afetados).toBe(lancamentosPendentes);
    /* Decidir e aplicar são dois atos, e o histórico sabe que os dois houve. */
    expect(decisao.aplicada_em).not.toBeNull();
    expect(decisao.aplicada_por).toBe("auditor@freightcheck.dev");
    expect(decisao.aplicacao_run_id).not.toBeNull();
  });

  it("clicar de novo não cobra duas vezes", async () => {
    const totaisAntes = new Map<string, number>();
    for (const competencia of competencias) {
      totaisAntes.set(competencia, await realizadoDaCompetencia(competencia));
    }
    const { rows: fatosAntes } = await ctx.db.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM fato_visivel`,
    );

    const repetida = await aplicarDecisaoDoReal(ctx.db, {
      tipo: "CLASSIFICAR_ATIVO",
      chave: placa,
      valor: "CAVALO",
      motivo: "Clicou de novo — a mesma classificação, de novo.",
      decididoPor: "auditor@freightcheck.dev",
    });

    /*
      Não há mais lançamento pendente com este endereço: a segunda aplicação não
      relê nada, e a resposta diz isso em vez de mentir um desfecho.
    */
    expect(repetida.aplicada).toBe(false);
    expect(repetida.lancamentosAfetados).toBe(0);
    expect(repetida.revisoes).toHaveLength(0);

    for (const competencia of competencias) {
      expect(await realizadoDaCompetencia(competencia)).toBeCloseTo(
        totaisAntes.get(competencia)!,
        2,
      );
    }
    const { rows: fatosDepois } = await ctx.db.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM fato_visivel`,
    );
    expect(fatosDepois[0].total).toBe(fatosAntes[0].total);

    /* A segunda decisão continua registrada: alguém decidiu, e isso é história. */
    const { rows } = await ctx.db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total FROM financiamento_real_decisao WHERE chave = ${placa}
    `);
    expect(rows[0].total).toBe("2");
  }, 600_000);
});

describe("o que a aplicação recusa", () => {
  it("decisão sem motivo não é auditável, e não passa", async () => {
    await expect(
      aplicarDecisaoDoReal(ctx.db, {
        tipo: "CLASSIFICAR_ATIVO",
        chave: "XXX0000",
        valor: "CAVALO",
        motivo: "   ",
        decididoPor: "auditor@freightcheck.dev",
      }),
    ).rejects.toThrow(AplicacaoRecusada);
  });

  it("classificar sem dizer o tipo não passa", async () => {
    await expect(
      aplicarDecisaoDoReal(ctx.db, {
        tipo: "CLASSIFICAR_ATIVO",
        chave: "XXX0000",
        motivo: "Sem dizer de que tipo é.",
        decididoPor: "auditor@freightcheck.dev",
      }),
    ).rejects.toThrow(/de que tipo/);
  });

  /*
    A aplicação que não vinga não pode limpar a fila.

    É o pior desfecho possível, porque é o invisível: a leitura nova é a mais
    recente do arquivo, e é dela que a fila da tela lê. Se os lançamentos dela
    ficassem gravados depois de a promoção falhar, a pendência sumiria da tela
    sobre um fato que não mudou — decidido nas linhas, não decidido no dinheiro.

    O empurrão aqui é a promoção derrubada de propósito, no ponto exato em que
    a leitura nova já gravou os lançamentos dela e a vigência ainda não entrou —
    a janela em que o estrago é possível. O que se mede é o estrago que a
    recusa **não** deixou.
  */
  it("uma aplicação que falha não deixa a fila mentindo", async () => {
    const filaAntes = await placasNaFila();
    const placa = filaAntes[0];
    const { rows: fatosAntes } = await ctx.db.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM fato_visivel`,
    );

    falha.naPromocao = true;
    try {
      await expect(
        aplicarDecisaoDoReal(ctx.db, {
          tipo: "CLASSIFICAR_ATIVO",
          chave: placa,
          valor: "CAVALO",
          motivo: "Conferido no cadastro: é cavalo mecânico.",
          decididoPor: "auditor@freightcheck.dev",
        }),
      ).rejects.toThrow(/de propósito/);
    } finally {
      falha.naPromocao = false;
    }

    /* A placa continua na fila, porque de fato continua pendente. */
    expect(await placasNaFila()).toContain(placa);
    /* E nada entrou no acervo. */
    const { rows: fatosDepois } = await ctx.db.execute<{ total: string }>(
      sql`SELECT count(*)::text AS total FROM fato_visivel`,
    );
    expect(fatosDepois[0].total).toBe(fatosAntes[0].total);

    /* A leitura que não vingou não ficou aberta trancando a próxima. */
    const { rows: abertas } = await ctx.db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total FROM import_run
       WHERE status IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING')
    `);
    expect(abertas[0].total).toBe("0");

    /* A decisão fica registrada, com a falha ao lado e sem data de aplicação. */
    const { rows: decisoes } = await ctx.db.execute<{
      aplicada_em: string | null;
      aplicacao_resultado: { aplicada: boolean; erro?: string } | null;
    }>(sql`
      SELECT aplicada_em::text, aplicacao_resultado
        FROM financiamento_real_decisao
       WHERE chave = ${placa}
       ORDER BY decidido_em DESC
       LIMIT 1
    `);
    expect(decisoes[0].aplicada_em).toBeNull();
    expect(decisoes[0].aplicacao_resultado?.aplicada).toBe(false);
    expect(decisoes[0].aplicacao_resultado?.erro).toContain("de propósito");

    /* E aplicar de novo, sem a falha, funciona: o caminho não ficou sujo. */
    const segunda = await aplicarDecisaoDoReal(ctx.db, {
      tipo: "CLASSIFICAR_ATIVO",
      chave: placa,
      valor: "CAVALO",
      motivo: "Conferido no cadastro: é cavalo mecânico.",
      decididoPor: "auditor@freightcheck.dev",
    });
    expect(segunda.aplicada).toBe(true);
    expect(await placasNaFila()).not.toContain(placa);
  }, 600_000);

  it("um tipo que o acervo Real não conhece não vira frota nova", async () => {
    await expect(
      aplicarDecisaoDoReal(ctx.db, {
        tipo: "CLASSIFICAR_ATIVO",
        chave: "XXX0000",
        valor: "BITREM",
        motivo: "Um tipo que o seletor da tela não oferece.",
        decididoPor: "auditor@freightcheck.dev",
      }),
    ).rejects.toThrow(/não é um tipo de ativo do acervo Real/);
  });

  it("uma leitura aberta do mesmo arquivo barra a aplicação, com a frase", async () => {
    /*
      Uma placa que está na fila **de verdade** — a da leitura ativa, e não a de
      uma leitura que outra aplicação já substituiu. Pendência de run superado
      não está na fila de ninguém, e decidir sobre ela não teria o que aplicar.
    */
    const placa = (await placasNaFila())[0];
    expect(placa).toBeDefined();

    /*
      Uma leitura por decidir, como a tela de Importações a deixa: o índice
      `import_run_leitura_aberta_uq` admite uma por arquivo, e a aplicação
      precisaria abrir a segunda.
    */
    const { rows } = await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO import_run (source_file_id, status, triggered_by)
      SELECT DISTINCT ir.source_file_id, 'PREVIEWED'::import_run_status, 'outra pessoa'
        FROM import_run ir
        JOIN finame_real_lancamento l ON l.import_run_id = ir.id
       WHERE l.placa = ${placa}
       LIMIT 1
      RETURNING id
    `);

    try {
      await expect(
        aplicarDecisaoDoReal(ctx.db, {
          tipo: "CLASSIFICAR_ATIVO",
          chave: placa,
          valor: "CAVALO",
          motivo: "Conferido no cadastro: é cavalo mecânico.",
          decididoPor: "auditor@freightcheck.dev",
        }),
      ).rejects.toThrow(/leitura deste extrato esperando decisão/);
    } finally {
      await ctx.db.execute(
        sql`UPDATE import_run SET status = 'CANCELLED'::import_run_status WHERE id = ${rows[0].id}::uuid`,
      );
    }

    /* Mesmo recusada, a decisão de quem olhou ficou registrada. */
    const { rows: decisoes } = await ctx.db.execute<{ aplicada_em: string | null }>(sql`
      SELECT aplicada_em::text FROM financiamento_real_decisao WHERE chave = ${placa}
    `);
    expect(decisoes).toHaveLength(1);
    expect(decisoes[0].aplicada_em).toBeNull();
  }, 600_000);
});
