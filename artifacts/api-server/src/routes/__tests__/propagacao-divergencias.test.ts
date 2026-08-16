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
  componentesDaComparacao,
  computeChangeSet,
  findPreviousSnapshot,
  getGroupedView,
  getQuinzenaMatrix,
  listComparableSnapshots,
  listContexts,
  resolveContext,
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
 *
 * **Estado.** As três divergências deste arquivo foram corrigidas: o canal
 * (PR-6), o escopo (PR-7) e `entity_type_set` (PR-9). Os três `it.fails`
 * viraram provas normais, com o corpo intacto, que é a regra do protocolo.
 * Não resta nenhum marcado aqui.
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

describe("divergência 1 — a entrega parcial partia a série de Alterações", () => {
  /*
    Janeiro veio só com carretas; fevereiro veio com carretas e cavalos.

    É a sequência que a Ambev produz sempre que passa a entregar um equipamento
    novo a partir de certa data, e ela muda `entity_type_set` de "CARRETA" para
    "CARRETA+CAVALO". O modelo canônico chama esse campo de **descritivo**
    (ver `lib/db/src/schema/canonical.ts`); `findPreviousSnapshot` o usava como
    **identidade da série**. As duas leituras não podiam estar certas ao mesmo
    tempo, e a que ficou é a do modelo: a série é (escopo canônico, canal), e a
    cobertura de equipamento recorta a comparação em vez de parti-la.
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

  it("Alterações acha a vigência anterior de fevereiro", async () => {
    /*
      Era o último `it.fails` da auditoria, e o protocolo é este: quando a
      correção chega, a marca sai e o corpo do teste fica intacto.

      Ele nasceu afirmando o que o produto **não** fazia — fevereiro devolvia
      "não há anterior" para uma vigência que tem anterior no banco, porque
      `entity_type_set` era usado como identidade da série. Passou pelo PR-8 na
      forma intermediária ("existe anterior, e a cobertura é que difere": recusa
      que ao menos não mentia), e agora não há recusa: a série é (escopo
      canônico, canal), e a cobertura de equipamento é atributo da entrega.
    */
    const vigencias = await vivas(ctx.db);
    const fevereiro = vigencias.find((v) => v.effectiveDate === "2026-02-01")!;
    const anterior = await findPreviousSnapshot(ctx.db, fevereiro.id);

    expect(anterior.encontrada).toBe(true);
    if (!anterior.encontrada) return;
    expect(anterior.vigencia.sourceLabel).toBe("EMPURRADA_1_1_2026");
    expect(anterior.vigencia.effectiveDate).toBe("2026-01-01");
  }, 300_000);

  it("os cavalos de fevereiro não são reportados como frota que entrou", async () => {
    /*
      A outra metade do PR-9, e a razão de as duas andarem juntas.

      Remover a guarda sem recortar a comparação faria a primeira vigência com
      cavalos reportar cada cavalo como ativo que entrou na frota — a leitura
      que `impacto.ts` descreve como errada: eles não entraram na frota,
      entraram no arquivo. A comparação é por componente: só CARRETA está nas
      duas pontas, e é só sobre CARRETA que os eixos falam.
    */
    const vigencias = await vivas(ctx.db);
    const janeiro = vigencias.find((v) => v.effectiveDate === "2026-01-01")!;
    const fevereiro = vigencias.find((v) => v.effectiveDate === "2026-02-01")!;

    const componentes = await componentesDaComparacao(ctx.db, janeiro.id, fevereiro.id);
    expect(componentes.comuns).toEqual(["CARRETA"]);
    expect(componentes.soEmB).toEqual(["CAVALO"]);

    const set = await computeChangeSet(ctx.db, janeiro.id, fevereiro.id, {
      computedBy: "teste:propagacao",
    });
    // As duas carretas continuam nas duas pontas, e o cavalo não vira notícia.
    expect(set.entitiesAdded).toBe(0);
    expect(set.entitiesRemoved).toBe(0);
  }, 300_000);

  it("a tela não confunde “não mudou” com “não foi comparado”", async () => {
    /*
      O zero do cavalo precisa ter nome. A linha dele existe — a frota é dele e
      está contada —, mas ela não aponta para o conjunto de alterações, e traz a
      frase que diz por quê. Sem isso, o recorte por componente seria uma
      omissão silenciosa: exatamente o defeito que esta auditoria persegue.
    */
    const view = (await getGroupedView(ctx.db, "2026-02-01"))!;
    const carreta = view.series.find((s) => s.entityTypeSet === "CARRETA")!;
    const cavalo = view.series.find((s) => s.entityTypeSet === "CAVALO")!;

    expect(carreta.changeSetId).not.toBeNull();
    expect(carreta.reason).toBeNull();
    expect(carreta.previousLabel).toBe("EMPURRADA_1_1_2026");

    expect(cavalo.changeSetId).toBeNull();
    expect(cavalo.fleet).toBe(1);
    expect(cavalo.reason).toContain("EMPURRADA_1_1_2026");
    expect(cavalo.reason).toContain("não há com o que comparar");
  }, 300_000);
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

  /*
    Corrigido no PR-7. Os dois `it.fails` viraram provas normais, com o corpo
    intacto: o contexto passou a ser chaveado pelo escopo **canônico**, que é o
    que a identidade da vigência já usava, e não pelo `scope_hash` — hash dos
    códigos como vieram, que o próprio schema tinha aposentado.
  */
  it("o seletor de contexto mostra uma unidade, e não duas com o mesmo nome", async () => {
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBe(1);
  }, 300_000);

  it("Impacto abre com as duas vigências da unidade", async () => {
    const matriz = await getQuinzenaMatrix(ctx.db, {});
    expect(matriz!.periods.map((p) => p.effectiveDate)).toEqual([
      "2026-03-01",
      "2026-04-01",
    ]);
  }, 300_000);

  it("o link antigo continua funcionando: os dois `scope_hash` levam ao mesmo contexto", async () => {
    /*
      A metade da correção que não aparece na tela.

      Antes do PR-7 existiam dois contextos, e quem tivesse guardado um link ou
      um favorito carrega o `scope_hash` cru de um deles. Recusá-lo agora
      transformaria a correção em página quebrada — e os dois têm de levar ao
      **mesmo** contexto, que é o que o link antigo não conseguia mostrar
      inteiro.
    */
    const vigencias = await vivas(ctx.db);
    const hashesCrus = [...new Set(vigencias.map((v) => v.scopeHash))];
    expect(hashesCrus).toHaveLength(2);

    const [contexto] = await listContexts(ctx.db);
    for (const legado of hashesCrus) {
      const resolvido = await resolveContext(ctx.db, { scopeHash: legado });
      expect(resolvido?.scopeHash, `o hash antigo ${legado.slice(0, 8)} não resolveu`).toBe(
        contexto.scopeHash,
      );
    }
    expect([...contexto.scopeHashesLegados].sort()).toEqual([...hashesCrus].sort());
  }, 300_000);

  it("Cobertura também vê uma unidade só — e o recorte dela é o mesmo", async () => {
    /*
      A metade que ficou de fora do PR-7 e é o PR-10.

      Cobertura recortava por `scope_hash` cru enquanto Alterações e Impacto já
      recortavam pelo escopo canônico. Nos bancos com o CNPJ escrito de uma
      forma só — todos os que existem hoje — os dois davam o mesmo recorte, e
      neste, que é o caso misto, davam dois. Era dívida com prazo, e o prazo é
      este PR.
    */
    const observadas = await vigenciasObservadas(ctx.db);
    expect(observadas).toHaveLength(2);

    // Uma chave de escopo e uma série, do lado da Cobertura...
    const [escopo, ...outros] = [...new Set(observadas.map((v) => v.scopeHash))];
    expect(outros).toHaveLength(0);
    expect(new Set(observadas.map((v) => v.serie)).size).toBe(1);

    // ...e é **a mesma** que Alterações usa. Dois módulos, um recorte.
    const [contexto] = await listContexts(ctx.db);
    expect(escopo).toBe(contexto.scopeHash);

    // Recortar por ela devolve as duas vigências, e não uma.
    const recortadas = await vigenciasObservadas(ctx.db, { scopeHash: escopo });
    expect(recortadas.map((v) => v.effectiveDate)).toEqual(["2026-03-01", "2026-04-01"]);
  }, 300_000);
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

  /*
    Corrigido no PR-6. Os dois `it.fails` desta divergência viraram provas
    normais, e o corpo deles não mudou: a afirmação sempre foi a certa, e o que
    faltava era o produto cumpri-la.

    O terceiro foi **aposentado**, e a aposentadoria é a correção. Ele exigia
    que as duas derivações do canal concordassem, e a premissa dele era o
    defeito: duas autoridades sobre o mesmo campo. `channelOf` continua
    existindo e continua certo onde ele pertence — a importação, onde o canal
    nasce. O que deixou de existir é uma segunda *leitura*, e é isso que a prova
    no lugar dele afirma.
  */
  it("a leitura do canal não passa mais pelo rótulo", async () => {
    const vigencias = await vivas(ctx.db);
    const derivados = vigencias.map((v) => channelOf(v.sourceLabel));
    const gravados = vigencias.map((v) => v.canal);

    // Os dois rótulos deste cenário derivam canais diferentes...
    expect(new Set(derivados).size).toBe(2);
    // ...e a coluna guarda um só, porque a importação normaliza ao gravar.
    expect(new Set(gravados).size).toBe(1);
    expect(gravados[0]).toBe(normalizeChannel(derivados[0]));
  }, 300_000);

  it("o seletor de contexto mostra um canal, e não dois", async () => {
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBe(1);
  }, 300_000);

  it("Impacto abre com as duas vigências do canal", async () => {
    const matriz = await getQuinzenaMatrix(ctx.db, {});
    expect(matriz!.periods.map((p) => p.effectiveDate)).toEqual([
      "2026-05-01",
      "2026-06-01",
    ]);
  }, 300_000);
});

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
}, 60_000);
