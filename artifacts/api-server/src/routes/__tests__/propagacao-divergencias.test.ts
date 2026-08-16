import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  channelOf,
  normalizeChannel,
  preview,
  promote,
  receiveFile,
  stage,
} from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  findPreviousSnapshot,
  getQuinzenaMatrix,
  listComparableSnapshots,
  listContexts,
} from "@workspace/comparison";
import { vigenciasObservadas } from "@workspace/coverage";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * As divergências provadas — onde o dado existe e um módulo não o enxerga.
 *
 * O export real não exercita nenhuma delas, e não é sorte: ele é uma unidade,
 * um canal, e nove entregas completas escritas sempre do mesmo jeito. É o
 * caminho mais estreito possível pelo produto, e é o único que os testes
 * percorriam. Cada cenário abaixo mexe em **uma** variável desse caminho — a
 * entrega deixa de ser completa, o CNPJ chega mascarado, o rótulo chega em
 * outra caixa — e mostra o módulo que perde o dado por causa disso.
 *
 * **A convenção deste arquivo.** Cada divergência tem dois testes:
 *
 * - um `it` normal, verde, que prova que **o dado existe** e que os módulos que
 *   o enxergam continuam enxergando. É a metade que impede a leitura preguiçosa
 *   de "então o arquivo não entrou";
 * - um `it.fails`, que afirma **o comportamento correto** e está marcado como
 *   ainda não verdadeiro. Ele passa enquanto o defeito existir e vira vermelho
 *   no dia em que a correção entrar — que é quando alguém tem de vir aqui e
 *   apagar o `.fails`.
 *
 * `it.fails` e não `it.skip` porque um teste pulado não avisa nada: ele
 * permaneceria pulado depois da correção, e a divergência voltaria a ficar sem
 * dono. Ver `docs/AUDITORIA-INGESTAO-PROPAGACAO.md`, Parte 3.
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

/**
 * Vinte colunas por equipamento, e não duas.
 *
 * A identidade de uma aba é decidida pela sobreposição das colunas dela com o
 * dicionário (`classifyEntityType`), e as seis colunas de escopo são comuns a
 * todo equipamento. Com poucas colunas de fato, essas seis dominam a nota e uma
 * aba de cavalos passa por carreta — o que apagaria o cenário antes de ele
 * começar. Vinte colunas próprias põem a nota onde o export real a põe.
 */
const CARRETA = Array.from({ length: 20 }, (_, i) => `Custo Carreta ${i}`);
const CAVALO = Array.from({ length: 20 }, (_, i) => `Custo Cavalo ${i}`);

interface AbaSpec {
  nome: string;
  placas: string[];
  colunas: string[];
}

function planilha(spec: {
  vigencia: string;
  cnpj?: string;
  abas: AbaSpec[];
}): string {
  const wb = XLSX.utils.book_new();
  for (const aba of spec.abas) {
    const linhas: (string | number)[][] = [[...COLUNAS_FIXAS, ...aba.colunas]];
    for (const placa of aba.placas) {
      linhas.push([
        spec.vigencia,
        spec.cnpj ?? "07.526.557/0015-05",
        "CAMACARI",
        "GEO NE",
        "20.618.821/0007-99",
        "OPERADOR TESTE",
        placa,
        `CHASSI${placa}`,
        ...aba.colunas.map((_, i) => 1000 + i),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "divergencia-"));
  const arquivo = path.join(dir, `${spec.vigencia}.xlsx`);
  XLSX.writeFile(wb, arquivo);
  return arquivo;
}

async function importar(db: Database, filePath: string): Promise<void> {
  const recebido = await receiveFile(db, { filePath });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    onExistingSnapshot: "NEW_REVISION",
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
}

interface Vigencia {
  id: string;
  effectiveDate: string;
  sourceLabel: string;
  canal: string;
  entityTypeSet: string;
  scopeHash: string;
  canonicalScope: string;
}

async function vivas(db: Database): Promise<Vigencia[]> {
  const { rows } = await db.execute<{
    id: string;
    d: string;
    label: string;
    canal: string;
    ets: string;
    sh: string;
    cs: string;
  }>(sql`
    SELECT id::text, effective_date::text AS d, source_label AS label, canal,
           entity_type_set AS ets, scope_hash AS sh, canonical_scope::text AS cs
      FROM snapshot
     WHERE status <> 'SUPERSEDED'
     ORDER BY effective_date
  `);
  return rows.map((r) => ({
    id: r.id,
    effectiveDate: r.d,
    sourceLabel: r.label,
    canal: r.canal,
    entityTypeSet: r.ets,
    scopeHash: r.sh,
    canonicalScope: r.cs,
  }));
}

// ---------------------------------------------------------------------------

describe("divergência 1 — a entrega parcial parte a série de Alterações", () => {
  /*
    Janeiro veio só com carretas; fevereiro veio com carretas e cavalos.

    É a sequência que a Ambev produz sempre que passa a entregar um equipamento
    novo a partir de certa data, e ela muda `entity_type_set` de "CARRETA" para
    "CARRETA+CAVALO". O modelo canônico chama esse campo de **descritivo**
    (ver `lib/db/src/schema/canonical.ts`); `findPreviousSnapshot` o usa como
    **identidade da série**. As duas leituras não podem estar certas ao mesmo
    tempo.
  */
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("divergencia_entrega_parcial");
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_1_2026",
        abas: [{ nome: "carretas", placas: ["AAA1A11", "AAA2A22"], colunas: CARRETA }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "EMPURRADA_1_2_2026",
        abas: [
          { nome: "carretas", placas: ["AAA1A11", "AAA2A22"], colunas: CARRETA },
          { nome: "cavalos", placas: ["BBB1B11"], colunas: CAVALO },
        ],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("o dado está lá: duas vigências da mesma unidade e do mesmo canal, e os outros módulos as veem", async () => {
    const vigencias = await vivas(ctx.db);
    expect(vigencias.map((v) => v.effectiveDate)).toEqual(["2026-01-01", "2026-02-01"]);
    // Mesma unidade, mesmo canal — nada aqui separa as duas como negócio.
    expect(new Set(vigencias.map((v) => v.scopeHash)).size).toBe(1);
    expect(new Set(vigencias.map((v) => v.canal)).size).toBe(1);
    // O que mudou foi só a cobertura de equipamento da segunda entrega.
    expect(vigencias.map((v) => v.entityTypeSet)).toEqual(["CARRETA", "CARRETA+CAVALO"]);

    expect((await listComparableSnapshots(ctx.db)).length).toBe(2);
    expect((await vigenciasObservadas(ctx.db)).length).toBe(2);
    expect((await getQuinzenaMatrix(ctx.db, {}))!.periods.length).toBe(2);
  }, 300_000);

  it.fails(
    "Alterações deveria achar a vigência anterior de fevereiro — hoje devolve “não há anterior”",
    async () => {
      const vigencias = await vivas(ctx.db);
      const fevereiro = vigencias.find((v) => v.effectiveDate === "2026-02-01")!;
      const anterior = await findPreviousSnapshot(ctx.db, fevereiro.id);
      // Correção esperada: a série é (escopo canônico, canal), e a cobertura de
      // equipamento é um atributo da entrega — não um componente da identidade.
      expect(anterior).not.toBeNull();
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------

describe("divergência 2 — o CNPJ mascarado parte o contexto em dois", () => {
  /*
    A mesma unidade, com o CNPJ escrito das duas formas que o Excel produz.

    `canonical_scope` normaliza o documento e enxerga uma unidade só — é o que
    a identidade canônica promete. `scope_hash` é o hash dos códigos **como
    vieram**, e o próprio schema diz que ele deixou de identificar. Só que é por
    ele que `series.ts` reparte o mundo em contextos, e é o contexto que
    Alterações, Impacto, Composição e DRE usam para escolher o que mostrar.
  */
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("divergencia_escopo");
    await importar(
      ctx.db,
      planilha({
        vigencia: "ROTA_1_3_2026",
        cnpj: "07.526.557/0015-05",
        abas: [{ nome: "carretas", placas: ["CCC1C11", "CCC2C22"], colunas: CARRETA }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "ROTA_1_4_2026",
        cnpj: "07526557001505",
        abas: [{ nome: "carretas", placas: ["CCC1C11", "CCC2C22"], colunas: CARRETA }],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("o dado está lá: mesmo escopo canônico, mesmo canal, e Cobertura vê as duas", async () => {
    const vigencias = await vivas(ctx.db);
    expect(vigencias.map((v) => v.effectiveDate)).toEqual(["2026-03-01", "2026-04-01"]);
    // A identidade canônica reconhece uma unidade só — é o que ela existe para fazer.
    expect(new Set(vigencias.map((v) => v.canonicalScope)).size).toBe(1);
    // E o hash antigo, que não identifica mais nada, mesmo assim difere.
    expect(new Set(vigencias.map((v) => v.scopeHash)).size).toBe(2);

    expect((await listComparableSnapshots(ctx.db)).length).toBe(2);
    expect((await vigenciasObservadas(ctx.db)).length).toBe(2);
  }, 300_000);

  it.fails(
    "o seletor de contexto deveria mostrar uma unidade — hoje mostra duas com o mesmo nome",
    async () => {
      const contextos = await listContexts(ctx.db);
      // Correção esperada: o contexto se chaveia pelo escopo canônico (ou pela
      // chave canônica sem a data), nunca pelo `scope_hash`.
      expect(contextos.length).toBe(1);
    },
    300_000,
  );

  it.fails(
    "Impacto deveria abrir com as duas vigências da unidade — hoje mostra uma coluna só",
    async () => {
      const matriz = await getQuinzenaMatrix(ctx.db, {});
      expect(matriz!.periods.map((p) => p.effectiveDate)).toEqual([
        "2026-03-01",
        "2026-04-01",
      ]);
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------

describe("divergência 3 — a caixa do rótulo parte o canal em dois", () => {
  /*
    `TRANSFERENCIA_1_5_2026` e `Transferencia_1_6_2026`.

    São dois jeitos de escrever o mesmo canal, e o produto os trata de dois
    jeitos ao mesmo tempo: `snapshot.canal` guarda o canal **normalizado**, que
    a importação calcula; `series.ts` re-deriva o canal do rótulo por regex, sem
    normalizar, e o comentário dele ainda diz que "o canal não é coluna" — o que
    deixou de ser verdade quando a coluna entrou. Cobertura lê a coluna;
    Alterações e Impacto leem o regex. Os dois não podem discordar sobre o mesmo
    campo.
  */
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDatabase("divergencia_canal");
    await importar(
      ctx.db,
      planilha({
        vigencia: "TRANSFERENCIA_1_5_2026",
        abas: [{ nome: "carretas", placas: ["DDD1D11"], colunas: CARRETA }],
      }),
    );
    await importar(
      ctx.db,
      planilha({
        vigencia: "Transferencia_1_6_2026",
        abas: [{ nome: "carretas", placas: ["DDD1D11"], colunas: CARRETA }],
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await ctx?.drop().catch(() => {});
  }, 60_000);

  it("o dado está lá: um canal só no canônico, e Cobertura enxerga um canal só", async () => {
    const vigencias = await vivas(ctx.db);
    expect(vigencias.map((v) => v.effectiveDate)).toEqual(["2026-05-01", "2026-06-01"]);
    expect(vigencias.map((v) => v.canal)).toEqual(["TRANSFERENCIA", "TRANSFERENCIA"]);
    expect(new Set(vigencias.map((v) => v.scopeHash)).size).toBe(1);

    const observadas = await vigenciasObservadas(ctx.db);
    expect(new Set(observadas.map((v) => v.canal)).size).toBe(1);
    expect(observadas.length).toBe(2);
  }, 300_000);

  it.fails(
    "o canal derivado do rótulo deveria ser o canal gravado — hoje difere na caixa",
    async () => {
      const vigencias = await vivas(ctx.db);
      for (const v of vigencias) {
        // Correção esperada: quem quiser o canal lê `snapshot.canal`. Enquanto
        // houver uma segunda derivação, ela tem de dar o mesmo resultado.
        expect(channelOf(v.sourceLabel)).toBe(v.canal);
        // A normalização já concorda — o que falta é aplicá-la dos dois lados.
        expect(normalizeChannel(channelOf(v.sourceLabel))).toBe(v.canal);
      }
    },
    300_000,
  );

  it.fails(
    "o seletor de contexto deveria mostrar um canal — hoje mostra dois",
    async () => {
      const contextos = await listContexts(ctx.db);
      expect(contextos.length).toBe(1);
    },
    300_000,
  );

  it.fails(
    "Impacto deveria abrir com as duas vigências do canal — hoje mostra uma coluna só",
    async () => {
      const matriz = await getQuinzenaMatrix(ctx.db, {});
      expect(matriz!.periods.map((p) => p.effectiveDate)).toEqual([
        "2026-05-01",
        "2026-06-01",
      ]);
    },
    300_000,
  );
});

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);
