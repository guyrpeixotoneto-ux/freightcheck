import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  listImportRuns,
  preview,
  promote,
  receiveFile,
  stage,
} from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { listComparableSnapshots } from "@workspace/comparison";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * As duas tabelas que o pipeline escrevia e ninguém lia.
 *
 * `import_decision` e `snapshot_merge` existem para responder duas perguntas
 * que a tela não sabia responder:
 *
 * - **"por que esse arquivo não entrou?"** — a recusa por duplicata é
 *   silenciosa por natureza: nada muda no canônico, nenhum erro aparece, e o
 *   operador só vê que o número dele não apareceu. O cartão dizia "dados já
 *   registrados" e parava aí, sem dizer contra qual vigência o conteúdo bateu
 *   nem que revisão já estava lá.
 * - **"onde foram parar os dados da vigência X?"** — uma fusão tira uma
 *   vigência ativa de cena. Quem a procurava em Vigências não a encontrava e
 *   concluía que a importação dela falhara, quando o dado está dentro da que
 *   ficou, com a revisão renumerada.
 *
 * As duas respostas estavam **gravadas e inalcançáveis**. É a mesma família dos
 * PRs 18 e 19: não é número errado, é informação que existe e não chega.
 */

const COLUNAS_FIXAS = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
  "Placa",
  "chassi",
];

const colunasDe = (prefixo: string) =>
  Array.from({ length: 20 }, (_, i) => `${prefixo} ${i}`);

function planilha(spec: {
  vigencia: string;
  abas: { nome: string; prefixo: string; placa: string }[];
  base?: number;
}): string {
  const wb = XLSX.utils.book_new();
  for (const aba of spec.abas) {
    const colunas = colunasDe(aba.prefixo);
    const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...colunas]];
    linhas.push([
      spec.vigencia,
      "07.526.557/0015-05",
      "CAMACARI",
      "GEO NE",
      "20.618.821/0007-99",
      "OPERADOR TESTE",
      aba.placa,
      `CHASSI${aba.placa}`,
      ...colunas.map((_, i) => (spec.base ?? 1000) + i),
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "decisao-fusao-"));
  const arquivo = path.join(dir, `${spec.vigencia}-${spec.base ?? 1000}.xlsx`);
  XLSX.writeFile(wb, arquivo);
  return arquivo;
}

/**
 * Importa, e **devolve o que aconteceu** em vez de engolir.
 *
 * A primeira versão desta ajuda tinha `.catch(() => {})` — a recusa é parte do
 * cenário, então engolir parecia razoável. Não é: com o erro engolido, um
 * cenário que não montou fica indistinguível de um que montou, e o teste falha
 * três asserções adiante dizendo "esperava mais que zero". Um fixture que
 * esconde falha é o mesmo vício que esta auditoria persegue nas telas.
 */
async function importar(
  db: Database,
  filePath: string,
  opcoes: { revisao?: boolean } = {},
): Promise<{ importRunId: string; duplicata: boolean; recusa: string | null }> {
  const recebido = await receiveFile(db, { filePath });
  if (recebido.isDuplicate) {
    return { importRunId: recebido.importRunId, duplicata: true, recusa: null };
  }
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  try {
    await promote(db, recebido.importRunId, {
      onExistingSnapshot: opcoes.revisao ? "NEW_REVISION" : "FAIL",
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
    return { importRunId: recebido.importRunId, duplicata: false, recusa: null };
  } catch (err) {
    // A recusa é resultado, e fica registrada em `import_decision`.
    return {
      importRunId: recebido.importRunId,
      duplicata: false,
      recusa: (err as Error).message,
    };
  }
}

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("decisao_e_fusao");
}, 900_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);

describe("por que esse arquivo não entrou", () => {
  it("a decisão do pipeline chega à listagem de importações", async () => {
    /*
      O mesmo conteúdo, duas vezes. A segunda é recusada — e a recusa é o caso
      que mais precisa de registro, porque nada muda no banco.
    */
    const primeira = planilha({
      vigencia: "EMPURRADA_1_1_2026",
      abas: [{ nome: "carretas", prefixo: "Custo Carreta", placa: "AAA1A11" }],
    });
    await importar(ctx.db, primeira);
    // Um arquivo diferente com o mesmo conteúdo normalizado.
    const segunda = planilha({
      vigencia: "EMPURRADA_1_1_2026",
      abas: [{ nome: "carretas", prefixo: "Custo Carreta", placa: "AAA1A11" }],
      base: 1000,
    });
    await importar(ctx.db, segunda);

    // A montagem, medida: o pipeline registrou decisão para os dois runs.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM import_decision
    `);
    expect(Number(rows[0].n)).toBeGreaterThan(0);

    const runs = await listImportRuns(ctx.db);
    expect(runs.length).toBeGreaterThan(1);

    /*
      A asserção central: a decisão chega na listagem. Antes, `listImportRuns`
      devolvia o status do run e nada mais — a tela mostrava "dados já
      registrados" sem dizer contra o quê.
    */
    const comDecisao = runs.filter((r) => (r.decisoes ?? []).length > 0);
    expect(comDecisao.length).toBeGreaterThan(0);

    for (const r of comDecisao) {
      for (const d of r.decisoes) {
        expect(d.decisao.length).toBeGreaterThan(0);
        // A frase é escrita para quem opera, e não um código repetido.
        expect(d.motivo.length).toBeGreaterThan(20);
        expect(d.motivo).not.toBe(d.decisao);
      }
    }
  }, 900_000);

  it("a decisão diz contra qual vigência e qual revisão — o que faltava", async () => {
    /*
      Um código de decisão sozinho não resolve nada. "DUPLICATA_DE_DADOS" e
      "revisão 1 já estava ativa, em EMPURRADA_1_1_2026" mandam a mesma pessoa
      fazer coisas diferentes: a primeira faz reimportar, a segunda faz olhar a
      vigência que já está lá.
    */
    const runs = await listImportRuns(ctx.db);
    const decisoes = runs.flatMap((r) => r.decisoes ?? []);
    expect(decisoes.length).toBeGreaterThan(0);

    // Ao menos uma decisão nomeia a vigência de que fala.
    expect(decisoes.some((d) => d.sourceLabel !== null)).toBe(true);
    // E ao menos uma diz o número de revisão — encontrada ou criada.
    expect(
      decisoes.some((d) => d.revisionEncontrada !== null || d.revisionCriada !== null),
    ).toBe(true);
  }, 300_000);
});

describe("onde foram parar os dados da vigência que sumiu", () => {
  it("a fusão chega à listagem de vigências, com as revisões que entraram", async () => {
    /*
      A fusão acontece quando uma entrega parcial chega para uma vigência que
      já existe: o `promote` funde as duas ativas em uma e renumera. Quem
      procurar a que saiu de cena não a acha em Vigências — e o dado dela está
      dentro da que ficou.
    */
    const comCavalo = planilha({
      vigencia: "EMPURRADA_1_2_2026",
      abas: [
        { nome: "carretas", prefixo: "Custo Carreta", placa: "AAA2A22" },
        { nome: "cavalos", prefixo: "Custo Cavalo", placa: "BBB2B22" },
      ],
    });
    const daPrimeira = await importar(ctx.db, comCavalo);

    // Uma entrega parcial da mesma vigência, como revisão.
    const soCarreta = planilha({
      vigencia: "EMPURRADA_1_2_2026",
      abas: [{ nome: "carretas", prefixo: "Custo Carreta", placa: "AAA2A22" }],
      base: 5000,
    });
    const daSegunda = await importar(ctx.db, soCarreta, { revisao: true });
    expect(daSegunda.recusa, "a revisão parcial precisa promover").toBeNull();

    // O cenário montou? Se não montou, é isto que precisa aparecer, e não uma
    // asserção sobre fusão falhando três linhas adiante.
    expect(daPrimeira.recusa, "a primeira entrega precisa promover").toBeNull();

    const vigencias = await listComparableSnapshots(ctx.db);
    expect(vigencias.length).toBeGreaterThan(0);

    /*
      O campo existe em toda vigência, e é `null` na esmagadora maioria — que é
      o certo. O que este teste garante é que ele **chega**: antes,
      `snapshot_merge` era gravada e a listagem não a mencionava.
    */
    for (const v of vigencias) {
      expect(v, v.sourceLabel).toHaveProperty("fusao");
    }

    /*
      A fusão precisa ter acontecido — e a asserção é sobre o banco, não sobre
      o retorno da listagem. Um `if (houve fusão)` aqui deixaria o teste passar
      calado no dia em que o `promote` parasse de fundir: a listagem devolveria
      `fusao: null` em tudo, corretamente, sobre um cenário que não montou. É a
      diferença entre provar que a informação chega e provar que ela existe.
    */
    const { rows } = await ctx.db.execute<{ n: number; ids: string[] }>(sql`
      SELECT count(*)::int                                  AS n,
             coalesce(array_agg(DISTINCT snapshot_id::text), '{}') AS ids
        FROM snapshot_merge
    `);
    expect(Number(rows[0].n), "a revisão parcial precisa ter fundido").toBeGreaterThan(0);

    /*
      E agora o elo que faltava: a fusão gravada chega à listagem.

      Este era o defeito. A correlação da subconsulta era escrita como
      `${snapshotTable.id}`, que num select de uma tabela só o drizzle emite
      sem qualificar — e `snapshot_merge` tem a sua própria coluna `id`. O
      predicado virava `m.snapshot_id = m.id`, casava com nada, e o campo vinha
      `null` em toda vigência. Nenhum erro, nenhum aviso: a mesma ausência
      silenciosa de antes do PR, agora com um campo para exibi-la.
    */
    const fundidas = vigencias.filter((v) => v.fusao !== null);
    /*
      A conta é contra as vigências **vivas** que têm fusão gravada, e não
      contra o total de linhas de `snapshot_merge`: a listagem só mostra
      vigência disponível, e uma fusão pode descrever uma revisão que já saiu
      de cena. Comparar com o total faria o teste acusar um defeito que não
      existe no dia em que houver uma terceira revisão.
    */
    const vivasComFusao = vigencias.filter((v) => rows[0].ids.includes(v.id));
    expect(vivasComFusao.length, "o cenário precisa deixar a fundida viva").toBeGreaterThan(0);
    expect(
      fundidas.map((v) => v.id).sort(),
      "toda vigência viva com fusão gravada precisa trazê-la na listagem",
    ).toEqual(vivasComFusao.map((v) => v.id).sort());
    for (const v of fundidas) {
      expect(v.fusao!.motivo.length).toBeGreaterThan(10);
      expect(v.fusao!.revisoesOriginais.length).toBeGreaterThan(0);
    }
  }, 900_000);
});

describe("as duas tabelas deixaram de ser órfãs", () => {
  it("alguém lê `import_decision` e `snapshot_merge` fora dos testes", async () => {
    /*
      A varredura que impede a volta. As duas eram escritas pelo pipeline e
      lidas por ninguém — e uma tabela que só é escrita é uma resposta que
      ninguém vai ler. Esta prova é de **presença**, e não de ausência: o que
      se quer é que exista leitor no código de produção.
    */
    const { readFileSync } = await import("node:fs");
    const raiz = path.resolve(import.meta.dirname, "../../../../..");
    const ler = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");

    expect(ler("lib/ingest/src/history.ts")).toContain("import_decision");
    expect(ler("lib/comparison/src/query.ts")).toContain("snapshot_merge");

    // E as telas mostram o que a leitura trouxe.
    expect(ler("artifacts/freightaudit/src/pages/importacoes.tsx")).toContain(
      "DecisoesDoPipeline",
    );
    expect(ler("artifacts/freightaudit/src/pages/vigencias.tsx")).toContain("fusao");
  });
});
