import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { and, eq, sql } from "drizzle-orm";
import {
  entityIdentifierTable,
  entityTable,
  factTable,
  importDecisionTable,
  importRunTable,
  snapshotTable,
  validationIssueTable,
} from "@workspace/db";
import type { Database } from "@workspace/db";
import {
  PromocaoRecusada,
  captureRaw,
  preview,
  promote,
  receiveFile,
  stage,
} from "../pipeline";
import { deleteImportRun } from "../deletion";
import { getImportRun } from "../history";
import { createTestDatabase, type TestDb } from "../testing";
import {
  escreverPlanilha,
  planilhaPadrao,
  type PlanilhaSpec,
} from "./planilha-sintetica";

/**
 * A prova de que não existe dado canônico duplicado.
 *
 * O produto tem duas camadas de defesa e elas respondem a perguntas diferentes:
 *
 *   1. **O arquivo já entrou?** SHA-256 do conteúdo, com índice único. Barra o
 *      reenvio idêntico antes de ler qualquer coisa.
 *   2. **O negócio já existe?** A identidade canônica — sistema, família, canal,
 *      data e escopo, todos normalizados —, com índice único parcial sobre uma
 *      coluna **gerada pelo banco**. Barra o mesmo negócio chegando com outro
 *      nome, outra máscara de CNPJ, outra ordem de linhas ou uma aba a menos.
 *
 * Os testes de concorrência abrem transações de verdade contra o Postgres, em
 * conexões distintas do pool. Um mock provaria que o TypeScript é coerente
 * consigo mesmo, que é justamente o que não está em questão.
 */

let ctx: TestDb;

/** Uma vigência por teste, para que dois testes não disputem a mesma identidade. */
let diaSequencial = 0;
function vigenciaUnica(canal = "EMPURRADA"): string {
  diaSequencial++;
  const mes = 1 + Math.floor((diaSequencial - 1) / 28);
  const dia = 1 + ((diaSequencial - 1) % 28);
  return `${canal}_${dia}_${mes}_2030`;
}

interface ResultadoImportacao {
  importRunId: string;
  isDuplicate: boolean;
  status: string;
  erro?: unknown;
}

/** Levar um arquivo do recebimento até a promoção, como a API faz. */
async function importar(
  db: Database,
  caminho: string,
  opcoes: { modo?: "FAIL" | "NEW_REVISION"; ateOPreview?: boolean } = {},
): Promise<ResultadoImportacao> {
  const recebido = await receiveFile(db, { filePath: caminho });
  if (recebido.isDuplicate) {
    return {
      importRunId: recebido.importRunId,
      isDuplicate: true,
      status: await statusDoRun(db, recebido.importRunId),
    };
  }
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  if (opcoes.ateOPreview) {
    return {
      importRunId: recebido.importRunId,
      isDuplicate: false,
      status: await statusDoRun(db, recebido.importRunId),
    };
  }
  let erro: unknown;
  try {
    await promote(db, recebido.importRunId, {
      onExistingSnapshot: opcoes.modo,
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
  } catch (e) {
    erro = e;
  }
  return {
    importRunId: recebido.importRunId,
    isDuplicate: false,
    status: await statusDoRun(db, recebido.importRunId),
    erro,
  };
}

async function statusDoRun(db: Database, importRunId: string): Promise<string> {
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  return run.status;
}

/** As vigências ativas de uma identidade, que é o número que importa. */
async function ativos(db: Database, effectiveDate: string) {
  return db
    .select()
    .from(snapshotTable)
    .where(
      and(
        eq(snapshotTable.effectiveDate, effectiveDate),
        sql`${snapshotTable.status} <> 'SUPERSEDED'`,
      ),
    );
}

async function importarSpec(
  spec: PlanilhaSpec,
  opcoes: Parameters<typeof importar>[2] = {},
  nomeArquivo?: string,
): Promise<ResultadoImportacao> {
  return importar(ctx.db, escreverPlanilha(spec, nomeArquivo), opcoes);
}

beforeAll(async () => {
  ctx = await createTestDatabase("dedup");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

// ---------------------------------------------------------------------------
// Camada 1 — o arquivo
// ---------------------------------------------------------------------------

describe("o mesmo arquivo", () => {
  it("é recusado na segunda vez, sem ler nada", async () => {
    const spec = planilhaPadrao({ vigencia: vigenciaUnica() });
    const caminho = escreverPlanilha(spec);

    const primeira = await importar(ctx.db, caminho);
    expect(primeira.status).toBe("PROMOTED");

    const segunda = await importar(ctx.db, caminho);
    expect(segunda.isDuplicate).toBe(true);
    expect(segunda.status).toBe("SKIPPED_DUPLICATE");

    const [decisao] = await ctx.db
      .select()
      .from(importDecisionTable)
      .where(
        and(
          eq(importDecisionTable.importRunId, segunda.importRunId),
          eq(importDecisionTable.decisao, "DUPLICATA_DE_ARQUIVO"),
        ),
      );
    expect(decisao).toBeTruthy();
  });

  it("continua sendo o mesmo arquivo depois de renomeado", async () => {
    // O nome não faz parte da identidade de nada. O SHA-256 é do conteúdo.
    const spec = planilhaPadrao({ vigencia: vigenciaUnica() });
    const original = escreverPlanilha(spec, "original.xlsx");
    const renomeado = escreverPlanilha(spec, "renomeado-pelo-operador.xlsx");

    expect(await importar(ctx.db, original)).toMatchObject({ status: "PROMOTED" });
    const segunda = await importar(ctx.db, renomeado);
    expect(segunda.isDuplicate).toBe(true);
    expect(segunda.status).toBe("SKIPPED_DUPLICATE");
  });
});

// ---------------------------------------------------------------------------
// Camada 2 — a identidade canônica
// ---------------------------------------------------------------------------

describe("o mesmo negócio, chegando de outro jeito", () => {
  it("XLSX regenerado com bytes diferentes e dados iguais não abre revisão", async () => {
    const vigencia = vigenciaUnica();
    const spec = planilhaPadrao({ vigencia });
    await importarSpec(spec);

    // Mesmo conteúdo lógico, arquivo gerado de novo: outro sha, mesma vigência.
    const regerado = await importarSpec({ ...spec, unidadeNome: "CAMACARI " });
    expect(regerado.isDuplicate).toBe(false);
    expect(regerado.status).toBe("SKIPPED_DUPLICATE_DATA");
    expect(await ativos(ctx.db, "2030-" + vigenciaParaMesDia(vigencia))).toHaveLength(1);
  });

  it("linhas em ordem diferente são o mesmo dado", async () => {
    const vigencia = vigenciaUnica();
    const base = planilhaPadrao({ vigencia });
    await importarSpec(base);

    const invertido: PlanilhaSpec = {
      ...base,
      abas: base.abas.map((a) => ({ ...a, linhas: [...a.linhas].reverse() })),
    };
    const segunda = await importarSpec(invertido);
    expect(segunda.status).toBe("SKIPPED_DUPLICATE_DATA");
  });

  it("abas em ordem diferente são o mesmo dado", async () => {
    const vigencia = vigenciaUnica();
    const base = planilhaPadrao({ vigencia });
    await importarSpec(base);

    const segunda = await importarSpec({ ...base, abas: [...base.abas].reverse() });
    expect(segunda.status).toBe("SKIPPED_DUPLICATE_DATA");
  });

  it("EMPURRADA_1_8_2030 e EMPURRADA_01_8_2030 são a mesma vigência", async () => {
    // O zero à esquerda era a brecha mais simples de todas: dois rótulos que a
    // mesma regra lê como o mesmo dia, e que a identidade antiga — feita do
    // rótulo literal — tratava como duas vigências ativas.
    const a = planilhaPadrao({ vigencia: "EMPURRADA_9_9_2030" });
    const b = planilhaPadrao({ vigencia: "EMPURRADA_09_9_2030" });

    expect(await importarSpec(a)).toMatchObject({ status: "PROMOTED" });
    const segunda = await importarSpec(b);
    expect(segunda.status).toBe("SKIPPED_DUPLICATE_DATA");
    expect(await ativos(ctx.db, "2030-09-09")).toHaveLength(1);
  });

  it("espaços e caixa no escopo não criam uma segunda vigência", async () => {
    const a = planilhaPadrao({ vigencia: "EMPURRADA_10_9_2030", regional: "GEO NE" });
    const b = planilhaPadrao({ vigencia: "EMPURRADA_10_9_2030", regional: "  geo   ne " });

    expect(await importarSpec(a)).toMatchObject({ status: "PROMOTED" });
    expect(await importarSpec(b)).toMatchObject({ status: "SKIPPED_DUPLICATE_DATA" });
    expect(await ativos(ctx.db, "2030-09-10")).toHaveLength(1);
  });

  it("CNPJ com e sem máscara é a mesma unidade", async () => {
    const a = planilhaPadrao({
      vigencia: "EMPURRADA_11_9_2030",
      unidadeCnpj: "07.526.557/0015-05",
    });
    const b = planilhaPadrao({
      vigencia: "EMPURRADA_11_9_2030",
      // Como o Excel devolve quando a célula é numérica: sem máscara e sem o
      // zero da frente.
      unidadeCnpj: "7526557001505",
    });

    expect(await importarSpec(a)).toMatchObject({ status: "PROMOTED" });
    expect(await importarSpec(b)).toMatchObject({ status: "SKIPPED_DUPLICATE_DATA" });
    expect(await ativos(ctx.db, "2030-09-11")).toHaveLength(1);
  });

  it("placa com e sem hífen é o mesmo veículo", async () => {
    const vigencia = "EMPURRADA_12_9_2030";
    await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "QRS1T45" }] }],
      }),
    );
    const antes = await ctx.db.select().from(entityTable);

    const segunda = await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "qrs-1t45" }] }],
      }),
    );
    expect(segunda.status).toBe("SKIPPED_DUPLICATE_DATA");

    // E não nasceu um segundo veículo com a mesma placa escrita de outro jeito.
    const depois = await ctx.db.select().from(entityTable);
    expect(depois).toHaveLength(antes.length);

    const [identificador] = await ctx.db
      .select()
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.identifierValue, "QRS1T45"),
        ),
      );
    expect(identificador).toBeTruthy();
    // O valor original continua guardado ao lado do normalizado.
    expect(identificador.identifierValueRaw).toBe("QRS1T45");
  });

  it("a mesma remuneração em meses diferentes é permitida", async () => {
    // Payload idêntico, vigências diferentes: são dois fatos de negócio, e o
    // hash de conteúdo não pode fundi-los. É por isso que ele nunca é único
    // globalmente — só dentro de uma identidade.
    const linhas = [{ placa: "MES1A11", valores: { "Custo Fixo": 500 } }];
    const jan = planilhaPadrao({
      vigencia: "EMPURRADA_1_1_2031",
      abas: [{ nome: "cavalos", linhas }],
    });
    const fev = planilhaPadrao({
      vigencia: "EMPURRADA_1_2_2031",
      abas: [{ nome: "cavalos", linhas }],
    });

    expect(await importarSpec(jan)).toMatchObject({ status: "PROMOTED" });
    expect(await importarSpec(fev)).toMatchObject({ status: "PROMOTED" });
    expect(await ativos(ctx.db, "2031-01-01")).toHaveLength(1);
    expect(await ativos(ctx.db, "2031-02-01")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Componentes parciais
// ---------------------------------------------------------------------------

describe("CAVALO+CARRETA seguido de só CAVALO", () => {
  it("vira revisão da mesma vigência, preservando as carretas", async () => {
    // Esta era a brecha mais cara: o conjunto de tipos entrava na identidade, de
    // modo que uma correção só de cavalos abria uma **segunda** vigência ativa,
    // e os cavalos passavam a contar em dobro.
    const vigencia = "EMPURRADA_13_9_2030";
    const ambos = await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [
          { nome: "cavalos", linhas: [{ placa: "CAV1A11", valores: { "Custo Fixo": 100 } }] },
          { nome: "carretas", linhas: [{ placa: "CAR1A11", valores: { "Custo Fixo": 200 } }] },
        ],
      }),
    );
    // O arquivo que trouxe os dois tipos diz os dois nos dois campos: nada é
    // herança na primeira revisão.
    const resumoDeAmbos = await getImportRun(ctx.db, ambos.importRunId);
    expect(resumoDeAmbos?.entityTypes).toEqual(["CARRETA", "CAVALO"]);
    expect(resumoDeAmbos?.tiposDoArquivo).toEqual(["CARRETA", "CAVALO"]);

    const soCavalo = await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [
          { nome: "cavalos", linhas: [{ placa: "CAV1A11", valores: { "Custo Fixo": 150 } }] },
        ],
      }),
      { modo: "NEW_REVISION" },
    );
    expect(soCavalo.status).toBe("PROMOTED");

    const vivas = await ativos(ctx.db, "2030-09-13");
    expect(vivas).toHaveLength(1);
    expect(vivas[0].revision).toBe(2);
    // A carreta não desapareceu: veio herdada da revisão anterior.
    expect(vivas[0].entityCount).toBe(2);

    const carreta = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .innerJoin(entityTable, eq(entityTable.id, factTable.entityId))
      .where(
        and(
          eq(factTable.snapshotId, vivas[0].id),
          eq(entityTable.entityType, "CARRETA"),
        ),
      );
    expect(carreta[0].n).toBeGreaterThan(0);

    // O histórico separa as duas afirmações: a vigência resultante cobre os
    // dois tipos, mas o segundo arquivo só trouxe cavalos — a carreta é
    // herança, e escrevê-la como conteúdo do arquivo foi o que fez a tela de
    // Importações etiquetar um arquivo de um tipo com os dois.
    const resumo = await getImportRun(ctx.db, soCavalo.importRunId);
    expect(resumo?.entityTypes).toEqual(["CARRETA", "CAVALO"]);
    expect(resumo?.tiposDoArquivo).toEqual(["CAVALO"]);
  });

  it("sem declarar correção, é recusado e o run continua aprovável", async () => {
    const vigencia = "EMPURRADA_14_9_2030";
    await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "CAV2A22", valores: { "Custo Fixo": 100 } }] }],
      }),
    );

    const correcao = await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "CAV2A22", valores: { "Custo Fixo": 999 } }] }],
      }),
    );
    expect(correcao.erro).toBeInstanceOf(PromocaoRecusada);
    expect((correcao.erro as PromocaoRecusada).decisao).toBe("VIGENCIA_ATIVA_EXISTENTE");
    // Recusa que é pergunta, não fim de linha: o operador ainda pode aprovar
    // como correção.
    expect(correcao.status).toBe("PREVIEWED");
    expect(await ativos(ctx.db, "2030-09-14")).toHaveLength(1);
  });

  it("uma correção de verdade abre revisão e a anterior fica SUPERSEDED", async () => {
    const vigencia = "EMPURRADA_15_9_2030";
    await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "COR1A11", valores: { "Custo Fixo": 100 } }] }],
      }),
    );

    const correcao = await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "COR1A11", valores: { "Custo Fixo": 777 } }] }],
      }),
      { modo: "NEW_REVISION" },
    );
    expect(correcao.status).toBe("PROMOTED");

    const vivas = await ativos(ctx.db, "2030-09-15");
    expect(vivas).toHaveLength(1);
    expect(vivas[0].revision).toBe(2);

    const todas = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.effectiveDate, "2030-09-15"));
    expect(todas).toHaveLength(2);
    expect(todas.filter((s) => s.status === "SUPERSEDED")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

describe("o que não pode ser promovido", () => {
  it("recusa a vigência sem o escopo obrigatório em vez de promovê-la", async () => {
    const resultado = await importarSpec(
      planilhaPadrao({ vigencia: "EMPURRADA_16_9_2030", unidadeCnpj: null }),
    );
    expect(resultado.erro).toBeInstanceOf(PromocaoRecusada);
    expect((resultado.erro as PromocaoRecusada).decisao).toBe("ESCOPO_OBRIGATORIO_AUSENTE");
    expect(resultado.status).toBe("VALIDATION_ERROR");
    expect(await ativos(ctx.db, "2030-09-16")).toHaveLength(0);
  });

  it("recusa a mesma entidade duas vezes com valores conflitantes", async () => {
    const resultado = await importarSpec(
      planilhaPadrao({
        vigencia: "EMPURRADA_17_9_2030",
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
      { ateOPreview: true },
    );
    expect(resultado.status).toBe("VALIDATION_ERROR");

    const [problema] = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          eq(validationIssueTable.importRunId, resultado.importRunId),
          eq(validationIssueTable.code, "ENTIDADE_DUPLICADA_CONFLITANTE"),
        ),
      );
    expect(problema.message).toMatch(/aparece mais de uma vez/i);
  });

  it("consolida a mesma entidade repetida quando as duas linhas concordam", async () => {
    const resultado = await importarSpec(
      planilhaPadrao({
        vigencia: "EMPURRADA_18_9_2030",
        abas: [
          {
            nome: "cavalos",
            linhas: [
              { placa: "IGU1A11", valores: { "Custo Fixo": 100 } },
              { placa: "IGU-1A11", valores: { "Custo Fixo": 100 } },
            ],
          },
        ],
      }),
    );
    expect(resultado.status).toBe("PROMOTED");

    const [consolidacao] = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          eq(validationIssueTable.importRunId, resultado.importRunId),
          eq(validationIssueTable.code, "ENTIDADE_DUPLICADA_CONSOLIDADA"),
        ),
      );
    expect(consolidacao).toBeTruthy();

    const vivas = await ativos(ctx.db, "2030-09-18");
    expect(vivas[0].entityCount).toBe(1);
  });

  it("desfaz tudo quando uma vigência do meio do arquivo é recusada", async () => {
    // Duas vigências no mesmo arquivo, a segunda sem unidade. A promoção é uma
    // transação só: ou entram as duas, ou não entra nenhuma.
    const caminho = escreverPlanilha({
      vigencia: "EMPURRADA_19_9_2030",
      abas: [{ nome: "cavalos", linhas: [{ placa: "ROL1A11" }] }],
    });
    // A segunda vigência é acrescentada com escopo vazio, num arquivo só.
    const comDuas = escreverPlanilhaDuasVigencias();
    void caminho;

    const resultado = await importar(ctx.db, comDuas);
    expect(resultado.erro).toBeInstanceOf(PromocaoRecusada);
    expect(resultado.status).toBe("VALIDATION_ERROR");

    // Nem a vigência boa entrou.
    expect(await ativos(ctx.db, "2030-09-20")).toHaveLength(0);
    expect(await ativos(ctx.db, "2030-09-21")).toHaveLength(0);
  });
});

/** Um arquivo com duas vigências, a segunda sem o escopo obrigatório. */
function escreverPlanilhaDuasVigencias(): string {
  const spec = planilhaPadrao({
    vigencia: "EMPURRADA_20_9_2030",
    abas: [{ nome: "cavalos", linhas: [{ placa: "ROL1A11" }] }],
  });
  const caminho = escreverPlanilha(spec);
  // Reescrever à mão para conseguir duas vigências com escopos diferentes na
  // mesma aba — o gerador padrão aplica um escopo só por arquivo.
  return reescreverComSegundaVigencia(caminho);
}

function reescreverComSegundaVigencia(caminho: string): string {
  const wb = XLSX.readFile(caminho);
  const aba = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1 });
  const cabecalho = linhas[0] as string[];
  const modelo = linhas[1] as unknown[];
  const segunda = [...modelo];
  segunda[cabecalho.indexOf("Vigencia")] = "EMPURRADA_21_9_2030";
  segunda[cabecalho.indexOf("Unidade - CNPJ")] = "";
  segunda[cabecalho.indexOf("Placa")] = "ROL2A22";
  const novo = XLSX.utils.aoa_to_sheet([...linhas, segunda] as never);
  wb.Sheets[wb.SheetNames[0]] = novo;
  const destino = caminho.replace(/\.xlsx$/, "-duas.xlsx");
  XLSX.writeFile(wb, destino);
  return destino;
}

// ---------------------------------------------------------------------------
// Concorrência real
// ---------------------------------------------------------------------------

describe("concorrência", () => {
  it("dois uploads simultâneos do mesmo arquivo: um entra, o outro é duplicata", async () => {
    // Antes, os dois liam "não existe" e os dois inseriam; o perdedor recebia
    // 23505 e a API devolvia 500. Agora quem decide é o `ON CONFLICT`.
    const caminho = escreverPlanilha(planilhaPadrao({ vigencia: "EMPURRADA_22_9_2030" }));

    const [a, b] = await Promise.all([
      receiveFile(ctx.db, { filePath: caminho }),
      receiveFile(ctx.db, { filePath: caminho }),
    ]);

    const duplicatas = [a, b].filter((r) => r.isDuplicate);
    expect(duplicatas).toHaveLength(1);
    expect(a.sourceFileId).toBe(b.sourceFileId);
  });

  it("duas promoções simultâneas da mesma vigência: sobra uma ativa", async () => {
    const spec = planilhaPadrao({ vigencia: "EMPURRADA_23_9_2030" });
    const um = await prepararAtePreview(spec);
    const dois = await prepararAtePreview({ ...spec, unidadeNome: "OUTRO NOME" });

    const resultados = await Promise.allSettled([
      promote(ctx.db, um, { onExistingSnapshot: "NEW_REVISION" }),
      promote(ctx.db, dois, { onExistingSnapshot: "NEW_REVISION" }),
    ]);
    expect(resultados.some((r) => r.status === "fulfilled")).toBe(true);

    const vivas = await ativos(ctx.db, "2030-09-23");
    expect(vivas).toHaveLength(1);
  });

  it("dois NEW_REVISION simultâneos não produzem duas revisões equivalentes", async () => {
    const vigencia = "EMPURRADA_24_9_2030";
    await importarSpec(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "CNC1A11", valores: { "Custo Fixo": 1 } }] }],
      }),
    );

    const a = await prepararAtePreview(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "CNC1A11", valores: { "Custo Fixo": 2 } }] }],
      }),
    );
    const b = await prepararAtePreview(
      planilhaPadrao({
        vigencia,
        abas: [{ nome: "cavalos", linhas: [{ placa: "CNC1A11", valores: { "Custo Fixo": 3 } }] }],
      }),
    );

    await Promise.allSettled([
      promote(ctx.db, a, { onExistingSnapshot: "NEW_REVISION" }),
      promote(ctx.db, b, { onExistingSnapshot: "NEW_REVISION" }),
    ]);

    const vivas = await ativos(ctx.db, "2030-09-24");
    expect(vivas).toHaveLength(1);

    // E não há duas revisões com o mesmo número na mesma identidade.
    const todas = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.effectiveDate, "2030-09-24"));
    const numeros = todas.map((s) => s.revision);
    expect(new Set(numeros).size).toBe(numeros.length);
  });
});

async function prepararAtePreview(spec: PlanilhaSpec): Promise<string> {
  const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(spec) });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  return recebido.importRunId;
}

// ---------------------------------------------------------------------------
// A invariante, tentada por baixo
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

describe("excluir e reimportar", () => {
  it("libera o arquivo mesmo depois de uma tentativa recusada por duplicata", async () => {
    // A sequência que prendia o operador: enviar, reenviar por engano (409),
    // excluir o original. A recusa continuava apontando para o arquivo, o
    // arquivo continuava "já recebido", e reimportar era impossível sem
    // adivinhar que era preciso excluir também a recusa.
    const caminho = escreverPlanilha(
      planilhaPadrao({
        vigencia: "EMPURRADA_25_9_2030",
        abas: [{ nome: "cavalos", linhas: [{ placa: "CIC1A11" }] }],
      }),
    );

    const original = await importar(ctx.db, caminho);
    expect(original.status).toBe("PROMOTED");

    const reenvio = await importar(ctx.db, caminho);
    expect(reenvio.status).toBe("SKIPPED_DUPLICATE");

    await deleteImportRun(ctx.db, original.importRunId, {
      deletedBy: "operador@exemplo.com",
      reason: "arquivo errado",
    });

    // O mesmo conteúdo entra de novo, sem intervenção nenhuma.
    const reimportado = await importar(ctx.db, caminho);
    expect(reimportado.isDuplicate).toBe(false);
    expect(reimportado.status).toBe("PROMOTED");
    expect(await ativos(ctx.db, "2030-09-25")).toHaveLength(1);
  });
});

/**
 * Afirmar que **o banco** recusou, e por qual regra.
 *
 * O drizzle embrulha o erro do driver: a mensagem que chega é "Failed query:
 * …", e o nome da constraint fica na `cause`. Comparar só a mensagem de fora
 * faria o teste passar por qualquer erro de SQL — inclusive um erro de digitação
 * na própria query —, que é exatamente o contrário do que estes testes provam.
 * Aqui a cadeia inteira é percorrida, e a constraint é lida do campo em que o
 * Postgres a coloca.
 */
async function recusadoPeloBanco(
  executar: () => Promise<unknown>,
  padrao: RegExp,
): Promise<void> {
  let capturado: unknown;
  try {
    await executar();
  } catch (e) {
    capturado = e;
  }
  expect(capturado, "esperava que o banco recusasse, e ele aceitou").toBeDefined();

  const partes: string[] = [];
  let atual: unknown = capturado;
  while (atual && partes.length < 10) {
    const e = atual as { message?: string; constraint?: string; code?: string; cause?: unknown };
    partes.push(e.message ?? "", e.constraint ?? "", e.code ?? "");
    atual = e.cause;
  }
  expect(partes.join(" | ")).toMatch(padrao);
}

describe("a garantia é do banco, não do TypeScript", () => {
  it("recusa um segundo snapshot ativo com a mesma identidade canônica, por SQL direto", async () => {
    // Nenhuma linha de aplicação participa deste teste. É a prova de que a
    // invariante sobrevive a um bug futuro no pipeline.
    const [vivo] = await ctx.db
      .select()
      .from(snapshotTable)
      .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
      .limit(1);
    expect(vivo).toBeTruthy();

    await recusadoPeloBanco(
      () =>
        ctx.db.execute(sql`
        INSERT INTO snapshot (
          source_file_id, import_run_id, source_system, source_label, effective_date,
          scope_hash, entity_type_set, dataset_family, canal, canonical_scope, revision, status
        ) VALUES (
          ${vivo.sourceFileId}::uuid, ${vivo.importRunId}::uuid, ${vivo.sourceSystem},
          ${vivo.sourceLabel || "CLONE"}, ${vivo.effectiveDate}::date,
          ${vivo.scopeHash}, ${vivo.entityTypeSet}, ${vivo.datasetFamily}, ${vivo.canal},
          ${JSON.stringify(vivo.canonicalScope)}::jsonb, 9999, 'CLOSED'
        )
        `),
      /snapshot_canonical_live_uq|duplicate key/i,
    );
  });

  it("recusa duas revisões com o mesmo número na mesma identidade, por SQL direto", async () => {
    const [vivo] = await ctx.db
      .select()
      .from(snapshotTable)
      .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
      .limit(1);

    await recusadoPeloBanco(
      () =>
        ctx.db.execute(sql`
        INSERT INTO snapshot (
          source_file_id, import_run_id, source_system, source_label, effective_date,
          scope_hash, entity_type_set, dataset_family, canal, canonical_scope, revision, status
        ) VALUES (
          ${vivo.sourceFileId}::uuid, ${vivo.importRunId}::uuid, ${vivo.sourceSystem},
          ${vivo.sourceLabel || "CLONE"}, ${vivo.effectiveDate}::date,
          ${vivo.scopeHash}, ${vivo.entityTypeSet}, ${vivo.datasetFamily}, ${vivo.canal},
          ${JSON.stringify(vivo.canonicalScope)}::jsonb, ${vivo.revision}, 'SUPERSEDED'
        )
        `),
      /snapshot_canonical_revision_uq|duplicate key/i,
    );
  });

  it("recusa o mesmo fato duas vezes dentro de um snapshot, por SQL direto", async () => {
    const [fato] = await ctx.db.select().from(factTable).limit(1);
    await recusadoPeloBanco(
      () =>
        ctx.db.execute(sql`
        INSERT INTO fact (snapshot_id, entity_id, attribute_id, value_numeric, is_null)
        VALUES (${fato.snapshotId}::uuid, ${fato.entityId}::uuid, ${fato.attributeId}::uuid, 1, false)
        `),
      /fact_grain_uq|duplicate key|immutable/i,
    );
  });

  it("recusa um escopo canônico fora de forma", async () => {
    // O CHECK impede que um erro no TypeScript grave escopo desordenado ou com
    // CNPJ mascarado — que produziria outra chave para o mesmo negócio.
    const [vivo] = await ctx.db.select().from(snapshotTable).limit(1);
    await recusadoPeloBanco(
      () =>
        ctx.db.execute(sql`
        INSERT INTO snapshot (
          source_file_id, import_run_id, source_system, source_label, effective_date,
          scope_hash, entity_type_set, dataset_family, canal, canonical_scope, revision, status
        ) VALUES (
          ${vivo.sourceFileId}::uuid, ${vivo.importRunId}::uuid, 'FREIGHTEC',
          'FORA_DE_FORMA', '2099-01-01'::date, 'x', 'CAVALO', 'REMUNERACAO_EQUIPAMENTO', 'EMPURRADA',
          '[{"scopeType":"UNIDADE","code":"07.526.557/0015-05"}]'::jsonb, 1, 'CLOSED'
        )
        `),
      /snapshot_canonical_scope_ck|check constraint/i,
    );
  });

  it("as duas consultas de auditoria devolvem zero linhas", async () => {
    const dup = (await ctx.db.execute(
      sql`SELECT count(*)::int AS n FROM freightcheck_snapshot_ativo_duplicado`,
    )) as unknown as { rows: { n: number }[] };
    expect(dup.rows[0].n).toBe(0);

    const fatos = (await ctx.db.execute(
      sql`SELECT count(*)::int AS n FROM freightcheck_fato_duplicado`,
    )) as unknown as { rows: { n: number }[] };
    expect(fatos.rows[0].n).toBe(0);
  });
});

/** `EMPURRADA_D_M_AAAA` -> `MM-DD`, para montar a data que o teste procura. */
function vigenciaParaMesDia(label: string): string {
  const [, dia, mes] = /_(\d{1,2})_(\d{1,2})_(\d{4})$/.exec(label)!;
  return `${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}
