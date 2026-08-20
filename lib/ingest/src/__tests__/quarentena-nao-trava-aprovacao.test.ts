import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { getImportRunIssues, getImportRunStatus } from "../history";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * O que a tela precisa saber para não discordar do pipeline sobre aprovar.
 *
 * ---------------------------------------------------------------------------
 * O caso
 * ---------------------------------------------------------------------------
 * Um QLP de Camaçari com 11.760 fatos bons e 8 chaves que aparecem duas vezes
 * na mesma vigência com valores que discordam. A quarentena por chave resolveu
 * o lado do pipeline: as 8 saem, as outras entram, e o run termina em PREVIEWED
 * — conferido, nada impede aprovar. A tela continuou lendo o total de
 * apontamentos ERRO (`errors`, que é 8) como se fosse a resposta a "isto impede
 * aprovar?", desabilitou o botão e mandou corrigir a origem. O servidor teria
 * aceitado aquele clique; ele nunca chegou a acontecer.
 *
 * A causa não foi a tela ter errado a conta: foi ela ter feito uma conta. O
 * pipeline sabia a resposta e não a mandava — `/imports/:id/status` só levava o
 * total bruto. Este arquivo prende o contrato que fecha isso: `blockingErrors`
 * e `chavesEmQuarentena` saem do mesmo predicado que a pré-visualização usa
 * para escolher entre PREVIEWED e VALIDATION_ERROR, e chegam prontos.
 *
 * ---------------------------------------------------------------------------
 * Por que a planilha é sintética, e o que dela é o caso real
 * ---------------------------------------------------------------------------
 * O arquivo do cliente não está no repositório. O que se reproduz aqui é a
 * proporção que produziu o defeito, e ela é exata: **11.760 fatos** em 336
 * chaves boas, **8 chaves em conflito**, **35 colunas** passando a ser
 * acompanhadas — os três números que o cartão mostrava quando o botão apareceu
 * desabilitado. As células (12.765 no original) não batem, e não podiam bater:
 * a planilha sintética preenche toda célula, e a do cliente tem vazias.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("quarentena_aprovacao");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/**
 * As colunas de fato além das duas que toda planilha sintética traz.
 *
 * São 28 aqui, 2 padrão e 5 que vêm do escopo (unidade, regional, operador) —
 * 35 atributos, que é o número de colunas novas que o QLP de Camaçari
 * apresentou. Cada linha preenche todas, de modo que uma chave valha 35 fatos.
 */
const COLUNAS = Array.from(
  { length: 28 },
  (_, i) => `Custo Extra ${String(i + 1).padStart(2, "0")}`,
);

const valores = (base: number) =>
  Object.fromEntries(COLUNAS.map((coluna, i) => [coluna, base + i]));

/** 336 chaves boas × 35 atributos = 11.760 fatos. */
const CHAVES_BOAS = 336;
const FATOS_POR_CHAVE = 35;
const CHAVES_EM_CONFLITO = 8;

/**
 * O QLP de Camaçari, na forma que importa: muitos fatos bons, oito conflitos.
 *
 * Os conflitos ficam no fim de propósito — é onde eles estavam no arquivo real,
 * e é a ordem que prova que o pipeline classifica antes de empurrar: um
 * conflito descoberto na 35ª coluna não pode deixar as 34 primeiras já dentro
 * da staging.
 */
function planilhaDeCamacari(): string {
  const linhas = Array.from({ length: CHAVES_BOAS }, (_, i) => ({
    placa: `CARGO${String(i + 1).padStart(4, "0")}`,
    valores: valores(i),
  }));

  for (let i = 1; i <= CHAVES_EM_CONFLITO; i++) {
    const cargo = `CONFLITO${String(i).padStart(2, "0")}`;
    // Duas linhas, a mesma chave, um número diferente: sem resposta certa.
    linhas.push({ placa: cargo, valores: { ...valores(i), "Custo Fixo": 100 } });
    linhas.push({ placa: cargo, valores: { ...valores(i), "Custo Fixo": 999 } });
  }

  return escreverPlanilha({
    vigencia: "EMPURRADA_1_5_2026",
    abas: [
      { nome: "Planilha1", identificador: "Cargo", colunas: COLUNAS, linhas },
    ],
  });
}

async function importar(arquivo: string, declaredType: string) {
  const { importRunId } = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType,
  });
  await captureRaw(ctx.db, importRunId);
  await stage(ctx.db, importRunId);
  const relatorio = await preview(ctx.db, importRunId);
  return { importRunId, relatorio };
}

describe("o arquivo com chaves em quarentena continua aprovável", () => {
  let importRunId: string;

  beforeAll(async () => {
    ({ importRunId } = await importar(planilhaDeCamacari(), "QLP_ADMINISTRATIVO"));
  }, 600_000);

  it("o pipeline o classifica como conferido, e não como recusado", async () => {
    const { rows } = await ctx.db.execute<{ status: string; failure_reason: string }>(
      sql`SELECT status, failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    // PREVIEWED é a forma como o pipeline já disse "nada impede aprovar" — a
    // tela não precisa recalcular isso, e foi recalculando que ela discordou.
    expect(rows[0].status).toBe("PREVIEWED");
    expect(rows[0].failure_reason).toBeNull();
  });

  it("os três números do cartão são os do caso real", async () => {
    const status = (await getImportRunStatus(ctx.db, importRunId))!;
    expect(status.facts).toBe(CHAVES_BOAS * FATOS_POR_CHAVE); // 11.760
    expect(status.chavesEmQuarentena).toBe(CHAVES_EM_CONFLITO); // 8
    // O total bruto continua sendo o total bruto: 8 apontamentos ERRO, que é o
    // número que a tela mostrava como "8 erros — corrija a origem".
    expect(status.errors).toBe(CHAVES_EM_CONFLITO);

    /*
      E as 35 colunas novas do cartão, que são informação e nunca foram erro.

      O número é o mesmo de `FATOS_POR_CHAVE`, e não por coincidência: toda
      linha preenche toda coluna, então uma chave vale um fato por coluna
      acompanhada. As duas leituras do mesmo 35 estão aqui juntas de propósito.
    */
    const grupos = await getImportRunIssues(ctx.db, importRunId);
    const novas = grupos.find((g) => g.code === "NEW_ATTRIBUTE")!;
    expect(novas.severity).toBe("INFO");
    expect(novas.ocorrencias.length).toBe(FATOS_POR_CHAVE); // 35
  });

  it("nenhum dos 8 impede aprovar, e o status diz isso à tela", async () => {
    const status = (await getImportRunStatus(ctx.db, importRunId))!;
    expect(status.blockingErrors).toBe(0);
    // A mesma conta que a pré-visualização faz — uma pergunta, uma resposta.
    // Duas leituras do mesmo run não podem discordar, e é aqui que isso se
    // prova: o que a tela recebe e o que o pipeline decidiu são o mesmo número.
    const relatorio = await preview(ctx.db, importRunId);
    expect(relatorio.blockingErrors).toBe(status.blockingErrors);
    expect(relatorio.chavesEmQuarentena).toBe(status.chavesEmQuarentena);
  });

  it("aprovar de fato funciona: os 11.760 entram e os 8 ficam de fora", async () => {
    const status = (await getImportRunStatus(ctx.db, importRunId))!;
    // Equipamento novo é a única decisão que esta tela exige, e ela continua
    // exigida: a declaração vem de quem aprova, como o cartão a coleta.
    await promote(ctx.db, importRunId, {
      confirmNewEntityTypes: status.pendingIdentities,
    });

    const { rows } = await ctx.db.execute<{ status: string }>(
      sql`SELECT status FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    expect(rows[0].status).toBe("PROMOTED");

    const { rows: fatos } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
       WHERE s.import_run_id = ${importRunId}::uuid
    `);
    expect(fatos[0].n).toBe(CHAVES_BOAS * FATOS_POR_CHAVE);

    // E o que ficou de fora ficou de fora inteiro: nenhuma coluna das chaves em
    // conflito entrou pela metade.
    const { rows: conflitantes } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
        JOIN entity_identifier ei ON ei.entity_id = f.entity_id
       WHERE s.import_run_id = ${importRunId}::uuid
         AND ei.identifier_value LIKE '%CONFLITO%'
    `);
    expect(conflitantes[0].n).toBe(0);

    // A contraprova de que a consulta acima procura onde tem: as chaves boas
    // estão lá, pelo mesmo caminho. Sem isto, um `LIKE` que não casa com nada
    // passaria como "nenhum conflito entrou".
    const { rows: boas } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN snapshot s ON s.id = f.snapshot_id
        JOIN entity_identifier ei ON ei.entity_id = f.entity_id
       WHERE s.import_run_id = ${importRunId}::uuid
         AND ei.identifier_value LIKE '%CARGO%'
    `);
    expect(boas[0].n).toBe(CHAVES_BOAS * FATOS_POR_CHAVE);
  });
});

describe("o arquivo que realmente impede continua impedido", () => {
  it("recusa, conta o impedimento e não deixa promover", async () => {
    /*
      O mesmo quadro de pessoal enviado pela aba do Trecho: a planilha não traz
      `chaveTrecho`, então ela não é o que a declaração disse que era. Não há
      chave a isolar — é o arquivo inteiro que está sob a etiqueta errada —, e é
      isso que `blockingErrors` conta.
    */
    const { importRunId, relatorio } = await importar(
      escreverPlanilha({
        vigencia: "EMPURRADA_2_5_2026",
        abas: [
          {
            nome: "Planilha1",
            identificador: "Cargo",
            linhas: [{ placa: "ANALISTA" }, { placa: "COORDENADOR" }],
          },
        ],
      }),
      "TRECHO",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const status = (await getImportRunStatus(ctx.db, importRunId))!;
    expect(status.status).toBe("VALIDATION_ERROR");
    expect(status.blockingErrors).toBe(relatorio.blockingErrors);
    // Nada em quarentena: o impedimento não é uma chave, é o arquivo.
    expect(status.chavesEmQuarentena).toBe(0);
    expect(status.failureReason).toBeTruthy();

    await expect(promote(ctx.db, importRunId)).rejects.toThrow();
  });
});
