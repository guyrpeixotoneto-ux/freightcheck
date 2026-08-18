import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { validationIssueTable } from "@workspace/db";
import { captureRaw, preview, receiveFile, stage } from "../pipeline";
import { apresentacaoDoDetalhe } from "../apontamentos";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

/**
 * Todo erro do pipeline atual chega à tela com apresentação completa.
 *
 * O contrato de `apontamentos.ts` tem um fallback — a frase no lugar das
 * seções — e ele existe para os apontamentos gravados **antes** do contrato,
 * que ninguém vai reescrever. O que ele não pode virar é escapatória: um erro
 * novo emitido sem apresentação cairia no fallback em silêncio, a tela
 * mostraria o código cru como título, e a regressão só seria notada por quem
 * abrisse a importação errada. Este arquivo prende a regra do lado de quem
 * emite: dispara cada recusa que uma planilha consegue provocar e varre tudo
 * o que os runs anotaram com severidade ERROR — qualquer um sem título,
 * resumo, correção e motivo falha aqui, com o código no nome do teste.
 *
 * Os avisos de célula entram na mesma varredura por uma razão de tela, não de
 * contrato: o título do grupo vem da apresentação, e um aviso sem ela estampa
 * `SUSPECTED_SENTINEL` — jargão — como cabeçalho da lista.
 *
 * O que uma planilha não provoca fica de fora e documentado:
 * `MISSING_RAW_CELL` é defeito do próprio leitor (o teste seria mockar o bug)
 * e `ENTITY_IDENTIFIER_CONFLICT` exige duas entidades promovidas disputando o
 * mesmo chassi — ambos têm apresentação escrita no mesmo padrão, conferida em
 * revisão; se um dia ganharem reprodução barata, entram aqui.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("apresentacao");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Lê o arquivo até a pré-visualização e devolve os apontamentos do run. */
async function importarEListar(arquivo: string) {
  const recebido = await receiveFile(ctx.db, { filePath: arquivo });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId).catch(() => {
    // A recusa da promoção é o comportamento esperado de metade dos casos
    // abaixo; o que este arquivo confere são os apontamentos, não o desfecho.
  });
  const issues = await ctx.db
    .select()
    .from(validationIssueTable)
    .where(eq(validationIssueTable.importRunId, recebido.importRunId));
  return { importRunId: recebido.importRunId, issues };
}

const importRunIds: string[] = [];

function apontamento(
  issues: (typeof validationIssueTable.$inferSelect)[],
  code: string,
) {
  const achado = issues.find((i) => i.code === code);
  expect(achado, `nenhum apontamento ${code} foi emitido`).toBeDefined();
  return achado!;
}

describe("cada recusa que uma planilha provoca", () => {
  it("linha sem identificador nomeia a coluna vazia e o lugar", async () => {
    const { importRunId, issues } = await importarEListar(
      escreverPlanilha({
        vigencia: "EMPURRADA_1_9_2026",
        abas: [{ nome: "cavalos", linhas: [{ placa: "" }, { placa: "OK1A234" }] }],
      }),
    );
    importRunIds.push(importRunId);

    const recusa = apontamento(issues, "ROW_MISSING_GRAIN_KEY");
    const apresentacao = apresentacaoDoDetalhe(recusa.detail)!;
    expect(apresentacao.onde).toEqual([{ aba: "cavalos", linhas: [2] }]);
    expect(apresentacao.comoCorrigir).toContain("Placa");
  });

  it("vigência ilegível mostra o texto que veio e um exemplo do formato", async () => {
    const { importRunId, issues } = await importarEListar(
      escreverPlanilha({
        vigencia: "EMPURRADA_45_13_2026",
        abas: [{ nome: "cavalos", linhas: [{ placa: "VIG1A11" }] }],
      }),
    );
    importRunIds.push(importRunId);

    const recusa = apontamento(issues, "UNPARSEABLE_VIGENCIA_LABEL");
    const apresentacao = apresentacaoDoDetalhe(recusa.detail)!;
    expect(apresentacao.registro).toContainEqual({
      campo: "Vigencia",
      valor: "EMPURRADA_45_13_2026",
    });
    expect(apresentacao.comoCorrigir).toContain("EMPURRADA_1_8_2026");
  });

  it("colunas que se confundem nomeiam as duas e qual foi recusada", async () => {
    const { importRunId, issues } = await importarEListar(
      escreverPlanilha({
        vigencia: "EMPURRADA_2_9_2026",
        abas: [
          {
            nome: "cavalos",
            // `custoFixo` normaliza para o mesmo nome de "Custo Fixo".
            colunas: ["custoFixo"],
            linhas: [{ placa: "AMB1A11", valores: { custoFixo: 1 } }],
          },
        ],
      }),
    );
    importRunIds.push(importRunId);

    const recusa = apontamento(issues, "AMBIGUOUS_COLUMN_SLUG");
    const apresentacao = apresentacaoDoDetalhe(recusa.detail)!;
    expect(apresentacao.resumo).toContain('"Custo Fixo"');
    expect(apresentacao.resumo).toContain('"custoFixo"');
    expect(apresentacao.onde).toEqual([{ aba: "cavalos", coluna: "custoFixo" }]);
  });

  it("duplicidade conflitante responde as seis perguntas", async () => {
    const { importRunId, issues } = await importarEListar(
      escreverPlanilha({
        vigencia: "EMPURRADA_3_9_2026",
        abas: [
          {
            nome: "cavalos",
            linhas: [
              { placa: "DUP1A11", valores: { "Custo Fixo": 100 } },
              { placa: "dup-1a11", valores: { "Custo Fixo": 200 } },
            ],
          },
        ],
      }),
    );
    importRunIds.push(importRunId);

    const recusa = apontamento(issues, "ENTIDADE_DUPLICADA_CONFLITANTE");
    const apresentacao = apresentacaoDoDetalhe(recusa.detail)!;
    // Onde, registro humano, diferenças com o nome real da coluna e o valor
    // de cada linha — nenhuma das seções pode faltar num conflito.
    expect(apresentacao.onde).toEqual([{ aba: "cavalos", linhas: [2, 3] }]);
    expect(apresentacao.registro).toContainEqual({ campo: "Placa", valor: "DUP1A11" });
    const custoFixo = apresentacao.diferencas!.find((d) => d.campo === "Custo Fixo");
    expect(custoFixo?.versoes).toEqual([
      { aba: "cavalos", linha: 2, valor: "100" },
      { aba: "cavalos", linha: 3, valor: "200" },
    ]);
  });
});

describe("a varredura", () => {
  it("todo ERRO emitido nestes runs tem apresentação completa", async () => {
    const erros = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          inArray(validationIssueTable.importRunId, importRunIds),
          eq(validationIssueTable.severity, "ERROR"),
        ),
      );
    expect(erros.length).toBeGreaterThan(0);

    for (const erro of erros) {
      const apresentacao = apresentacaoDoDetalhe(erro.detail);
      expect(apresentacao, `${erro.code} caiu no fallback`).not.toBeNull();
      // As quatro seções que nenhum erro pode dispensar. `onde`, `registro` e
      // `diferencas` variam por natureza do problema; estas quatro, não.
      expect(apresentacao!.titulo, `${erro.code} sem título`).toBeTruthy();
      expect(apresentacao!.resumo, `${erro.code} sem resumo`).toBeTruthy();
      expect(apresentacao!.comoCorrigir, `${erro.code} sem correção`).toBeTruthy();
      expect(apresentacao!.porQueImporta, `${erro.code} sem motivo`).toBeTruthy();
      // E nenhuma frase da leitura principal carrega código de atributo — o
      // ponto que fez esta arquitetura existir.
      const frases = [
        apresentacao!.titulo,
        apresentacao!.resumo,
        apresentacao!.comoCorrigir ?? "",
      ].join(" ");
      expect(frases, `${erro.code} expõe código de atributo`).not.toMatch(
        /\b\w+\.\w+_\w+\b|qlp_|cavalo\.|carreta\./,
      );
    }
  });

  it("todo aviso e informação destes runs também tem título para o grupo", async () => {
    const restantes = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(inArray(validationIssueTable.importRunId, importRunIds));

    for (const apontado of restantes) {
      const apresentacao = apresentacaoDoDetalhe(apontado.detail);
      expect(apresentacao, `${apontado.code} caiu no fallback`).not.toBeNull();
      expect(apresentacao!.titulo, `${apontado.code} sem título`).toBeTruthy();
      expect(apresentacao!.resumo, `${apontado.code} sem resumo`).toBeTruthy();
    }
  });
});
