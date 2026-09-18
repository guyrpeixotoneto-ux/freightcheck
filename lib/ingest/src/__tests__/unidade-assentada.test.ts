import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  importRunTable,
  scopeTable,
  unidadeTable,
  validationIssueTable,
} from "@workspace/db";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * A IMPORTAÇÃO GRAVA DE QUEM É O ARQUIVO — e o caso que este arquivo guarda é
 * exatamente o que estava quebrado.
 *
 * O acervo de CAMAÇARI foi importado, com CAMAÇARI aberta na lateral, e o
 * escopo `07526557001505_CERV` entrou com os catorze dígitos do documento
 * dentro. A tela de Ativos e Parados, que atravessa do `scope_hash` da lateral
 * para `unidade.id`, respondia `SEM_CADASTRO` e mandava associar à mão em
 * Remuneração — um vínculo que a própria importação tinha em mãos e não
 * gravava. A primeira asserção daqui é essa travessia.
 *
 * O resto do arquivo é o que **não** pode acontecer junto: o arquivo de outra
 * unidade entrando sob o nome da aberta, o consolidado afirmando que as cinco
 * são uma, e — a que mais importa — o nome voltando a decidir identidade.
 */

let ctx: TestDb;

/** O CNPJ do caso real, com o sufixo colado que o export escreve. */
const CAMACARI_CNPJ = "07526557001505";
const CAMACARI_CODE = "07526557001505_CERV";
const RECIFE_CNPJ = "03134910000236";

async function importar(db: Database, caminho: string) {
  const recebido = await receiveFile(db, { filePath: caminho });
  return recebido.importRunId;
}

/** Recebe, lê e aprova — o caminho inteiro, como a tela o percorre. */
async function importarEPromover(
  db: Database,
  caminho: string,
  opcoes: { unidadeId?: string | null } = {},
) {
  const importRunId = await receiveFile(db, {
    filePath: caminho,
    unidadeId: opcoes.unidadeId ?? null,
  }).then((r) => r.importRunId);
  await captureRaw(db, importRunId);
  await stage(db, importRunId);
  const relatorio = await preview(db, importRunId);
  const promovido = await promote(db, importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  return { importRunId, relatorio, promovido };
}

/** Recebe e lê, sem aprovar — para exercitar a recusa da pré-visualização. */
async function importarAtePreview(
  db: Database,
  caminho: string,
  unidadeId: string | null,
) {
  const importRunId = await receiveFile(db, { filePath: caminho, unidadeId }).then(
    (r) => r.importRunId,
  );
  await captureRaw(db, importRunId);
  await stage(db, importRunId);
  const relatorio = await preview(db, importRunId);
  return { importRunId, relatorio };
}

async function cadastrar(
  db: Database,
  unidade: { nome: string; cnpj: string | null; codigoGerencial?: string | null },
) {
  const [criada] = await db
    .insert(unidadeTable)
    .values({
      nome: unidade.nome,
      cnpj: unidade.cnpj,
      codigoGerencial: unidade.codigoGerencial ?? null,
    })
    .returning();
  return criada!;
}

async function unidadeDoScope(db: Database, code: string) {
  const [linha] = await db
    .select({ unidadeId: scopeTable.unidadeId })
    .from(scopeTable)
    .where(and(eq(scopeTable.scopeType, "UNIDADE"), eq(scopeTable.code, code)));
  return linha?.unidadeId ?? null;
}

async function apontamentosDeUnidade(db: Database, importRunId: string) {
  return db
    .select()
    .from(validationIssueTable)
    .where(
      and(
        eq(validationIssueTable.importRunId, importRunId),
        eq(validationIssueTable.code, "UNIDADE_DIVERGE_DA_DECLARACAO"),
      ),
    );
}

const planilhaDe = (vigencia: string, linhas: { placa: string; unidadeCnpj?: string; unidadeNome?: string }[]) =>
  escreverPlanilha({
    vigencia,
    unidadeNome: "CAMACARI",
    abas: [{ nome: "cavalos", linhas }],
  } satisfies PlanilhaSpec);

beforeAll(async () => {
  ctx = await createTestDatabase("unidade_assentada");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o CNPJ que o arquivo traz", () => {
  it("liga o escopo à unidade cadastrada, sem ninguém associar nada", async () => {
    const camacari = await cadastrar(ctx.db, {
      nome: "CAMAÇARI",
      cnpj: CAMACARI_CNPJ,
    });

    const { promovido } = await importarEPromover(
      ctx.db,
      planilhaDe("EMPURRADA_1_1_2041", [
        { placa: "CAM1A11", unidadeCnpj: CAMACARI_CODE },
      ]),
    );

    expect(await unidadeDoScope(ctx.db, CAMACARI_CODE)).toBe(camacari.id);
    /*
      E a promoção devolve o par, que é o que a rota de aprovação usa para
      conciliar as competências do Fechamento — a outra metade do conserto.
    */
    expect(promovido.unidadesAssentadas).toEqual([
      { unidadeId: camacari.id, nome: "CAMAÇARI", code: CAMACARI_CODE },
    ]);
  });

  /*
    A segunda importação da mesma unidade não tem trabalho a fazer, e precisa
    continuar devolvendo o par: a conciliação das competências roda a cada
    aprovação, e uma quinzena nova aberta no meio do caminho depende dela.
  */
  it("continua respondendo pela unidade na importação seguinte", async () => {
    const { promovido } = await importarEPromover(
      ctx.db,
      planilhaDe("EMPURRADA_2_1_2041", [
        { placa: "CAM2A22", unidadeCnpj: CAMACARI_CODE },
      ]),
    );
    expect(promovido.unidadesAssentadas.map((u) => u.code)).toEqual([
      CAMACARI_CODE,
    ]);
  });
});

describe("a unidade aberta na lateral", () => {
  it("dá identidade ao escopo cujo código não carrega documento nenhum", async () => {
    const belem = await cadastrar(ctx.db, {
      nome: "CDD BELÉM",
      cnpj: null,
      codigoGerencial: "081-0443",
    });

    await importarEPromover(
      ctx.db,
      planilhaDe("EMPURRADA_1_2_2041", [
        { placa: "BEL1A11", unidadeCnpj: "443", unidadeNome: "CDD BELEM" },
      ]),
      { unidadeId: belem.id },
    );

    expect(await unidadeDoScope(ctx.db, "443")).toBe(belem.id);
  });

  /*
    A conferência, e ela é a razão de a declaração poder existir sem virar uma
    segunda verdade: o arquivo de Recife mandado de dentro de CAMAÇARI não entra
    — nem como CAMAÇARI, nem como Recife.
  */
  it("recusa o arquivo cujo CNPJ é de outra unidade", async () => {
    const [camacari] = await ctx.db
      .select()
      .from(unidadeTable)
      .where(eq(unidadeTable.cnpj, CAMACARI_CNPJ));
    await cadastrar(ctx.db, { nome: "CDD RECIFE", cnpj: RECIFE_CNPJ });

    const { importRunId, relatorio } = await importarAtePreview(
      ctx.db,
      planilhaDe("EMPURRADA_1_3_2041", [
        { placa: "REC1A11", unidadeCnpj: RECIFE_CNPJ, unidadeNome: "CDD RECIFE" },
      ]),
      camacari!.id,
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);
    const apontamentos = await apontamentosDeUnidade(ctx.db, importRunId);
    expect(apontamentos).toHaveLength(1);
    expect(apontamentos[0]!.message).toContain("CDD RECIFE");
    /* E nada foi gravado: o escopo de Recife não existe, ou existe sem unidade. */
    expect(await unidadeDoScope(ctx.db, RECIFE_CNPJ)).toBeNull();
  });

  it("recusa o consolidado mandado de dentro de uma unidade", async () => {
    const [camacari] = await ctx.db
      .select()
      .from(unidadeTable)
      .where(eq(unidadeTable.cnpj, CAMACARI_CNPJ));

    const { importRunId, relatorio } = await importarAtePreview(
      ctx.db,
      planilhaDe("EMPURRADA_2_3_2041", [
        { placa: "CAM3A33", unidadeCnpj: CAMACARI_CODE },
        { placa: "REC2A22", unidadeCnpj: RECIFE_CNPJ, unidadeNome: "CDD RECIFE" },
      ]),
      camacari!.id,
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);
    const [apontamento] = await apontamentosDeUnidade(ctx.db, importRunId);
    expect(apontamento?.message).toContain("Visão Geral");
  });

  it("guarda na execução a unidade que o envio declarou", async () => {
    const [camacari] = await ctx.db
      .select()
      .from(unidadeTable)
      .where(eq(unidadeTable.cnpj, CAMACARI_CNPJ));

    const importRunId = await importar(
      ctx.db,
      planilhaDe("EMPURRADA_2_4_2041", [{ placa: "CAM4A44", unidadeCnpj: CAMACARI_CODE }]),
    );
    const [run] = await ctx.db
      .select({ unidadeId: importRunTable.unidadeId })
      .from(importRunTable)
      .where(eq(importRunTable.id, importRunId));
    expect(run?.unidadeId).toBeNull();

    const outro = await receiveFile(ctx.db, {
      filePath: planilhaDe("EMPURRADA_1_5_2041", [
        { placa: "CAM5A55", unidadeCnpj: CAMACARI_CODE },
      ]),
      unidadeId: camacari!.id,
    });
    const [comUnidade] = await ctx.db
      .select({ unidadeId: importRunTable.unidadeId })
      .from(importRunTable)
      .where(eq(importRunTable.id, outro.importRunId));
    expect(comUnidade?.unidadeId).toBe(camacari!.id);
  });
});

describe("o que a importação continua não fazendo", () => {
  /*
    ---------------------------------------------------------------------------
    O nome não associa nada — nem quando é a mesma palavra
    ---------------------------------------------------------------------------

    Esta é a asserção que protege o desenho inteiro. `MANAUS` está cadastrada,
    o arquivo traz um escopo cujo nome é `MANAUS`, e o código dele não é
    documento nenhum — e a unidade do escopo continua nula, com a associação
    manual de pé. Dois CDDs podem chamar-se igual, e o dia em que esta asserção
    passar a esperar o contrário é o dia em que a frota de um aparece sob o nome
    do outro.
  */
  it("não liga escopo a unidade pelo nome, nem com o nome idêntico", async () => {
    await cadastrar(ctx.db, {
      nome: "MANAUS",
      cnpj: null,
      codigoGerencial: "MAO-1",
    });

    await importarEPromover(
      ctx.db,
      planilhaDe("EMPURRADA_1_6_2041", [
        { placa: "MAO1A11", unidadeCnpj: "999", unidadeNome: "MANAUS" },
      ]),
    );

    expect(await unidadeDoScope(ctx.db, "999")).toBeNull();
  });

  /*
    E o inverso da primeira asserção do arquivo: sem cadastro nenhum com aquele
    CNPJ, o escopo fica nulo. A importação liga ao que existe; ela não inventa a
    unidade canônica, que é cadastro — ato de gente —, e derivá-la de um arquivo
    é o desenho que este produto desfez de propósito.
  */
  it("não inventa a unidade cadastrada quando ninguém a cadastrou", async () => {
    const SEM_CADASTRO = "05570714000159";
    await importarEPromover(
      ctx.db,
      planilhaDe("EMPURRADA_2_6_2041", [
        { placa: "NOV1A11", unidadeCnpj: SEM_CADASTRO, unidadeNome: "CDD NOVA" },
      ]),
    );

    expect(await unidadeDoScope(ctx.db, SEM_CADASTRO)).toBeNull();
    const [nenhuma] = await ctx.db
      .select()
      .from(unidadeTable)
      .where(eq(unidadeTable.cnpj, SEM_CADASTRO));
    expect(nenhuma).toBeUndefined();
  });
});
