import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import {
  createTestDatabase,
  realExportPath,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { vigenciasDisponiveis } from "@workspace/availability";
import { listContexts } from "@workspace/comparison";
import { sql } from "drizzle-orm";

/**
 * Análise de frota — o contrato de hoje, registrado antes de trocar a fonte.
 *
 * Esta suíte não corrige nada. Ela é a rede de segurança do PR-15, que vai
 * trocar o `.xlsx` do disco pelo canônico: sem um registro do que a rota
 * entrega **hoje**, a migração seria feita no escuro e a única forma de
 * descobrir que ela mudou a tela seria a tela mudar.
 *
 * São três coisas registradas, e elas têm destinos diferentes:
 *
 * 1. **A forma da resposta** — tem de sobreviver à migração intacta. A tela é
 *    tipada contra ela e não muda uma linha.
 * 2. **O de-para** — de cada campo para a sua fonte canônica. Mora aqui, e não
 *    no ADR, para que ele não envelheça em silêncio: acrescentar um campo ao
 *    resumo sem mapeá-lo quebra esta suíte.
 * 3. **O defeito atual** — a rota devolve vazio, e a causa é conhecida. É o
 *    critério de aceitação do PR-15 invertido: o dia em que este bloco falhar é
 *    o dia em que a tela voltou a ter dado.
 *
 * **Os códigos do de-para foram conferidos contra o dicionário de verdade**, e
 * não deduzidos da regra de slug: os vinte saíram de uma importação do export
 * real, e os vinte existem em `attribute.code`. O que esta suíte ainda não faz
 * é prender essa conferência — ela não abre banco, de propósito, porque o
 * PR-15 é quem passa a ter um. Até lá, o risco é o de o dicionário mudar sem
 * que o mapa acompanhe, e ele é pequeno: renomear um código é operação
 * registrada (`entity_type_correction`).
 *
 * Ver `docs/ADR-FLEET-ANALYSIS-CANONICO.md`.
 */

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

let servidor: Server;
let base: string;
let ctx: TestDb;

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  /*
    A rota passou a ler o canônico, então o servidor de teste passou a precisar
    de banco. Antes ela lia um arquivo do disco e um `express()` pelado bastava
    — o que é, em si, a descrição do defeito que o PR-15 corrigiu.
  */
  ctx = await createTestDatabase("api_fleet_analysis");
  process.env.DATABASE_URL = ctx.url;

  const recebido = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  await seedTaxonomy(ctx.db, "teste:frota");
  await runProposalPass(ctx.db, "teste:frota");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: router } = await import("../fleet-analysis");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(router);
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 900_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
}, 60_000);

// ---------------------------------------------------------------------------
// 1. A forma, que a migração tem de preservar
// ---------------------------------------------------------------------------

/** Os campos de `SummaryRow`, na ordem em que a tela os declara. */
const CAMPOS_DO_RESUMO = [
  "vigencia",
  "label",
  "totalCarretas",
  "totalCavalos",
  "custoFixoCarretas",
  "finameCarretas",
  "finameCavalos",
  "ipvaCarretas",
  "seguroCarretas",
  "lucroFixoCarretas",
  "lucroVariavelCarretas",
  "manutencaoCavalos",
  "valorFrotaCarretas",
  "valorFrotaCavalos",
] as const;

describe("a forma da resposta — o que a migração não pode mexer", () => {
  it("`/summary` devolve os blocos que a tela consome, e um a mais declarado", async () => {
    const res = await get("/fleet-analysis/summary");
    expect(res.status).toBe(200);
    /*
      Seis blocos eram o contrato antigo; são sete.

      `contexto` entrou no PR-15 pelo mesmo motivo que entrou no Painel no
      PR-13: um número sem o recorte à vista é um número que a tela pode
      legendar errado, e foi assim que o Painel passou a discordar da Cobertura
      sem que ninguém visse a discordância. Ele é `null` quando a resposta é o
      censo.

      A mudança é **aditiva e declarada**. A tela lê os seis por nome e não se
      importa com o sétimo; esta asserção é de igualdade exata de propósito,
      para que um oitavo campo não entre sem alguém escrever por quê.
    */
    expect(Object.keys(res.body).sort()).toEqual([
      "ativoStatusByVigencia",
      "contexto",
      "financiamentoByVigencia",
      "modelosByVigencia",
      "summary",
      "vigenciaLabels",
      "vigencias",
    ]);
    expect(Array.isArray(res.body.vigencias)).toBe(true);
    expect(Array.isArray(res.body.summary)).toBe(true);
    expect(typeof res.body.vigenciaLabels).toBe("object");
  }, 300_000);

  it("`/carretas` e `/cavalos` devolvem lista, com e sem vigência pedida", async () => {
    for (const caminho of ["/fleet-analysis/carretas", "/fleet-analysis/cavalos"]) {
      expect(Array.isArray((await get(caminho)).body), caminho).toBe(true);
      expect(
        Array.isArray((await get(`${caminho}?vigencia=EMPURRADA_1_8_2026`)).body),
        caminho,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. O de-para, que o PR-15 vai executar
// ---------------------------------------------------------------------------

/**
 * De onde cada campo do resumo passa a vir.
 *
 * `SOMA` é a soma de um atributo canônico sobre os ativos da vigência;
 * `CONTAGEM` sai de `snapshot_entity_type` sem tocar `fact`; `DERIVADO` é
 * calculado a partir da própria vigência.
 */
const DE_PARA_DO_RESUMO: Record<
  (typeof CAMPOS_DO_RESUMO)[number],
  { origem: "SOMA" | "CONTAGEM" | "DERIVADO"; fonte: string; nota?: string }
> = {
  vigencia: { origem: "DERIVADO", fonte: "snapshot.source_label" },
  label: {
    origem: "DERIVADO",
    fonte: "periodoDe(snapshot.effective_date)",
    nota: "some o regex com EMPURRADA_ fixo no código",
  },
  totalCarretas: { origem: "CONTAGEM", fonte: "snapshot_entity_type[CARRETA].entity_count" },
  totalCavalos: { origem: "CONTAGEM", fonte: "snapshot_entity_type[CAVALO].entity_count" },
  custoFixoCarretas: { origem: "SOMA", fonte: "carreta.custo_fixo" },
  finameCarretas: { origem: "SOMA", fonte: "carreta.finame_implemento" },
  finameCavalos: { origem: "SOMA", fonte: "cavalo.finame_cavalo" },
  ipvaCarretas: {
    origem: "SOMA",
    fonte: "carreta.ipva_licenciamento",
    nota: "há homônimo em CAVALO; o tipo de equipamento é o que separa",
  },
  seguroCarretas: { origem: "SOMA", fonte: "carreta.seguro" },
  lucroFixoCarretas: { origem: "SOMA", fonte: "carreta.lucro_fixomodelo_novo_ciclo_carreta" },
  lucroVariavelCarretas: { origem: "SOMA", fonte: "carreta.lucro_variavel_previsto_carreta" },
  manutencaoCavalos: {
    origem: "SOMA",
    fonte: "cavalo.manutencao_ano",
    nota: "a rota divide por 12 à mão; a migração usa normalizarParaCompetencia",
  },
  valorFrotaCarretas: {
    origem: "SOMA",
    fonte: "carreta.valor_nf_compra",
    nota: "grandeza de aquisição — estoque, não fluxo do período",
  },
  valorFrotaCavalos: {
    origem: "SOMA",
    fonte: "cavalo.valor_nf_compra",
    nota: "idem",
  },
};

/** As colunas das duas tabelas, e o que **não** é fato. */
const DE_PARA_DAS_TABELAS: Record<string, Record<string, string>> = {
  carretas: {
    Placa: "IDENTIFICADOR: entity_identifier (PLACA)",
    "Operador - Nome": "ESCOPO: scope (OPERADOR)",
    implemento: "carreta.implemento",
    modelo: "carreta.modelo",
    ano: "carreta.ano",
    custoFixo: "carreta.custo_fixo",
    finameImplemento: "carreta.finame_implemento",
    seguro: "carreta.seguro",
    ipvaLicenciamento: "carreta.ipva_licenciamento",
    valorNfCompra: "carreta.valor_nf_compra",
    statusFinanciamento: "carreta.status_financiamento",
  },
  cavalos: {
    Placa: "IDENTIFICADOR: entity_identifier (PLACA)",
    "Placa Carreta": "cavalo.placa_carreta",
    "Operador - Nome": "ESCOPO: scope (OPERADOR)",
    montadora: "cavalo.montadora",
    anoBid: "cavalo.ano_bid",
    ativo: "cavalo.ativo",
    faixaKm: "cavalo.faixa_km",
    finameCavalo: "cavalo.finame_cavalo",
    manutencaoAno: "cavalo.manutencao_ano",
    reaiskm: "cavalo.reaiskm",
    valorNfCompra: "cavalo.valor_nf_compra",
  },
};

describe("o de-para para o canônico está completo", () => {
  it("todo campo do resumo tem fonte declarada", () => {
    // Acrescentar um campo ao resumo sem dizer de onde ele passa a vir é como
    // o mapa envelheceria em silêncio — e um mapa desatualizado é pior que
    // nenhum, porque parece confiável.
    expect(Object.keys(DE_PARA_DO_RESUMO).sort()).toEqual([...CAMPOS_DO_RESUMO].sort());
    for (const [campo, destino] of Object.entries(DE_PARA_DO_RESUMO)) {
      expect(destino.fonte, campo).toMatch(/\S/);
    }
  });

  it("duas colunas das tabelas não são fato, e o mapa diz isso", () => {
    // É a descoberta que mais muda a implementação: uma migração que
    // procurasse `Placa` em `fact` não a acharia e concluiria que o dado
    // sumiu. Placa é identidade; operador é escopo da vigência, não do ativo.
    expect(DE_PARA_DAS_TABELAS.carretas["Placa"]).toContain("IDENTIFICADOR");
    expect(DE_PARA_DAS_TABELAS.cavalos["Placa"]).toContain("IDENTIFICADOR");
    expect(DE_PARA_DAS_TABELAS.carretas["Operador - Nome"]).toContain("ESCOPO");
    expect(DE_PARA_DAS_TABELAS.cavalos["Operador - Nome"]).toContain("ESCOPO");
  });

  it("os códigos mapeados têm o prefixo do equipamento a que pertencem", () => {
    // `ipvaLicenciamento` existe nos dois equipamentos com o mesmo nome de
    // origem. Só o prefixo os separa, e trocá-lo somaria carreta em cavalo.
    // Só o que é código de atributo: `CONTAGEM` vem de `snapshot_entity_type`,
    // `DERIVADO` da própria vigência, e identidade e escopo não moram em
    // `fact` — nenhum dos três tem prefixo de equipamento, e cobrá-lo deles
    // seria a prova medindo a si mesma.
    const naoEhAtributo = (fonte: string) =>
      fonte.startsWith("snapshot") || fonte.includes(":") || fonte.includes("(");

    const codigos = [
      ...Object.values(DE_PARA_DO_RESUMO)
        .filter((d) => d.origem === "SOMA")
        .map((d) => d.fonte),
      ...Object.values(DE_PARA_DAS_TABELAS).flatMap((t) => Object.values(t)),
    ].filter((fonte) => !naoEhAtributo(fonte));

    expect(codigos.length).toBeGreaterThan(15);
    for (const codigo of codigos) {
      expect(codigo, codigo).toMatch(/^(carreta|cavalo)\.[a-z0-9_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. O defeito de hoje — o critério de aceitação do PR-15, invertido
// ---------------------------------------------------------------------------

describe("o estado atual: a rota lê o disco, e o disco não tem mais as abas", () => {
  it("o arquivo que a rota escolhe não tem as abas que ela procura", () => {
    // A rota pega o primeiro `.xlsx` da ordem de `readdir` e procura abas com
    // os nomes literais `carretas` e `cavalos`. Elas existiam no export
    // combinado; a entrega por equipamento não as tem.
    const assets = path.join(RAIZ, "attached_assets");
    const escolhido = readdirSync(assets).find((f) => f.endsWith(".xlsx"));
    expect(escolhido).toBeDefined();

    const wb = XLSX.readFile(path.join(assets, escolhido!));
    expect(wb.SheetNames).not.toContain("carretas");
    expect(wb.SheetNames).not.toContain("cavalos");
  });

  it("e a tela voltou a ter dado — o canônico responde onde o disco calava", async () => {
    /*
      A inversão. Este bloco dizia `expect(res.body.vigencias).toEqual([])`, e
      não afirmava que o vazio estivesse certo: registrava o que acontecia, para
      que a migração tivesse um antes contra o que medir. O antes era zero em
      todo campo, com 657 linhas paradas no arquivo.

      O corpo do teste mudou porque a afirmação mudou de sinal — é a diferença
      entre este protocolo e o do `it.fails`, onde o corpo já afirmava o certo e
      só a marca saía.
    */
    const res = await get("/fleet-analysis/summary");
    expect(res.status).toBe(200);
    expect(res.body.vigencias.length).toBeGreaterThan(1);
    expect(res.body.summary.length).toBe(res.body.vigencias.length);
    expect((await get("/fleet-analysis/carretas")).body.length).toBeGreaterThan(0);
    expect((await get("/fleet-analysis/cavalos")).body.length).toBeGreaterThan(0);
  }, 300_000);

  it("nenhum número vem de disco: o mesmo censo que Vigências e Cobertura veem", async () => {
    /*
      O critério 1 e o 3 do ADR, numa asserção só. Se a rota lesse o arquivo,
      esta lista seria a do arquivo — e o arquivo tem as vigências que alguém
      deixou no repositório, não as que a Ambev entregou.
    */
    const res = await get("/fleet-analysis/summary");
    const doCanonico = (await vigenciasDisponiveis(ctx.db)).map((v) => v.sourceLabel);
    expect([...res.body.vigencias].sort()).toEqual([...new Set(doCanonico)].sort());
  }, 300_000);

  it("a rota não escreve, e não lê disco — as duas metades da regra", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(
      path.join(RAIZ, "artifacts/api-server/src/routes/fleet-analysis.ts"),
      "utf8",
    );
    // Continua sendo leitura: nenhum verbo de escrita.
    expect(fonte).not.toMatch(/router\.(post|put|patch|delete)\(/);
    /*
      E deixou de ser leitura **paralela**. A asserção antiga era
      `not.toMatch(/@workspace\/db/)` — ela provava que a rota não tocava o
      banco, que era exatamente o problema: o número não vinha do canônico. Ela
      inverte junto. O que fica proibido agora é o disco.
    */
    expect(fonte).toMatch(/@workspace\/comparison/);
    expect(fonte).not.toMatch(/readFile|readdirSync|attached_assets\"/);
    expect(fonte).not.toMatch(/from "xlsx"/);
  });
});

// ---------------------------------------------------------------------------
// 4. Os quatro pontos onde a migração podia errar — um teste por ponto
// ---------------------------------------------------------------------------

/*
  Estes quatro não quebram nenhum teste de forma se estiverem errados: a
  resposta continua com os campos certos, e o número é que fica torto. São
  exatamente as decisões que o ADR mandou não tomar em silêncio, e cada uma tem
  aqui a asserção que a torna visível.
*/

describe("os quatro pontos do ADR, um a um", () => {
  it("4.1 · a periodicidade não é dividida à mão — e quando não dá, o campo diz", async () => {
    const { summary } = (await get("/fleet-analysis/summary")).body;

    /*
      A rota fazia `sum(manutencaoAno) / 12` sem perguntar de que periodicidade
      o número era. Agora ou há periodicidade confirmada e o valor sai
      convertido, ou o campo vem `null` **com o motivo escrito**. O que não pode
      existir é o terceiro caso: um número dividido por doze sem base.
    */
    for (const linha of summary) {
      const temNumero = typeof linha.manutencaoCavalos === "number";
      const temMotivo = typeof linha.naoCalculavel?.manutencaoCavalos === "string";
      expect(
        temNumero !== temMotivo,
        `${linha.vigencia}: manutencaoCavalos precisa de número **ou** de motivo, nunca dos dois nem de nenhum`,
      ).toBe(true);
      if (temMotivo) {
        expect(linha.naoCalculavel.manutencaoCavalos.length).toBeGreaterThan(30);
      }
    }
  }, 300_000);

  it("4.1 · a conversão concorda com a autoridade da DRE", async () => {
    /*
      `analise-de-frota.ts` reproduz a metade de `normalizarParaCompetencia` que
      usa, porque importá-la faria `comparison` depender de `dre`, que depende
      de `comparison`. Reprodução sem prova é divergência esperando acontecer:
      aqui as duas são chamadas com os mesmos argumentos e têm de dar o mesmo.
    */
    const { normalizarParaCompetencia } = await import("@workspace/dre");
    const { rows } = await ctx.db.execute<{ periodicity: string | null }>(sql`
      SELECT periodicity FROM attribute WHERE code = 'cavalo.manutencao_ano'
    `);
    const periodicidade = rows[0]?.periodicity ?? null;

    const daAutoridade = normalizarParaCompetencia(1200, periodicidade, "MENSAL");
    const { summary } = (await get("/fleet-analysis/summary")).body;
    const daRota = summary.some((l: { manutencaoCavalos: number | null }) =>
      typeof l.manutencaoCavalos === "number",
    );

    // As duas ou aceitam, ou recusam. Divergir aqui é a rota ter inventado uma
    // regra de competência própria — que é o que ela fazia com o `/12`.
    expect(daRota).toBe(daAutoridade.ok);
  }, 300_000);

  it("4.2 · o recorte é por contexto, e as partes fecham com o todo", async () => {
    /*
      A soma antiga atravessava unidade e canal, e dava certo por acidente
      porque a planilha tinha uma unidade só. Com uma unidade, o censo e o
      recorte têm de dar o mesmo — e é o que se pode provar aqui. A prova de
      isolamento com duas unidades está em `painel.test.ts`, que monta o caso.
    */
    const contextos = await listContexts(ctx.db);
    expect(contextos.length).toBe(1);

    const censo = (await get("/fleet-analysis/summary")).body;
    const recortado = (await get(`/fleet-analysis/summary?scopeHash=${contextos[0].scopeHash}`))
      .body;

    expect(recortado.contexto).not.toBeNull();
    expect(censo.contexto).toBeNull();
    expect(recortado.summary.map((l: { custoFixoCarretas: number }) => l.custoFixoCarretas))
      .toEqual(censo.summary.map((l: { custoFixoCarretas: number }) => l.custoFixoCarretas));
  }, 300_000);

  it("4.2 · pedir um contexto que não existe é 404, e não o censo com outro nome", async () => {
    const res = await get("/fleet-analysis/summary?scopeHash=nao-existe");
    expect(res.status).toBe(404);
  }, 300_000);

  it("4.3 · o valor da frota é grandeza de aquisição, e continua separado do fluxo", async () => {
    /*
      `valor_nf_compra` é o preço da nota — estoque, não custo do mês. A DRE se
      recusa a levá-la para o fluxo do período, e aqui ela continua num campo
      próprio, com nome que diz o que é. A prova é de **separação**: ela não
      entra em nenhum dos campos de custo.
    */
    const { summary } = (await get("/fleet-analysis/summary")).body;
    const linha = summary[summary.length - 1];

    expect(linha.valorFrotaCarretas).toBeGreaterThan(0);
    // A ordem de grandeza denuncia a mistura: valor de nota é dezenas de vezes
    // o custo mensal, e somá-lo a um campo de custo seria visível aqui.
    expect(linha.valorFrotaCarretas).toBeGreaterThan(linha.custoFixoCarretas * 5);
    for (const campo of ["custoFixoCarretas", "finameCarretas", "seguroCarretas"]) {
      expect(linha[campo], campo).toBeLessThan(linha.valorFrotaCarretas);
    }
  }, 300_000);

  it("4.4 · ausência não vira zero — a soma é do que existe, e o que faltou vem dito", async () => {
    /*
      O ponto mais silencioso dos quatro. `Number(x) || 0` transformava célula
      vazia, texto e sentinela em zero, e o zero entrava na soma sem deixar
      rastro. Agora `sum` ignora nulo por definição e `ausencias` conta quantos
      foram ignorados.

      A asserção é dupla porque uma metade sozinha não prova nada: a soma tem de
      bater com o que o banco tem de **não nulo**, e a contagem de ausentes tem
      de bater com o que ele tem de nulo.
    */
    const { summary } = (await get("/fleet-analysis/summary")).body;
    const ultima = summary[summary.length - 1];

    const { rows } = await ctx.db.execute<{ soma: string | null; nulos: number }>(sql`
      SELECT sum(f.value_numeric)::text                 AS soma,
             count(*) FILTER (WHERE f.is_null)::int      AS nulos
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE a.code = 'carreta.custo_fixo'
         AND s.status = 'CLOSED'
         AND s.source_label = ${ultima.vigencia}
    `);

    expect(ultima.custoFixoCarretas).toBeCloseTo(Number(rows[0].soma ?? 0), 2);
    expect(ultima.ausencias?.custoFixoCarretas ?? 0).toBe(Number(rows[0].nulos));
  }, 300_000);

  it("4.4 · e o zero que existe continua sendo zero", async () => {
    /*
      A outra ponta da mesma regra, e a que uma correção apressada quebra: nem
      todo zero é ausência. Um custo que a origem informou como `0` é um valor,
      e tem de continuar entrando na soma e **fora** da contagem de ausentes.
    */
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE a.code = 'carreta.custo_fixo'
         AND s.status = 'CLOSED'
         AND NOT f.is_null
         AND f.value_numeric = 0
    `);
    // Se o export real tiver zeros informados, eles não podem estar contados
    // como ausência em vigência nenhuma.
    const { summary } = (await get("/fleet-analysis/summary")).body;
    const ausentesTotais = summary.reduce(
      (s: number, l: { ausencias?: Record<string, number> }) =>
        s + (l.ausencias?.custoFixoCarretas ?? 0),
      0,
    );
    const { rows: nulosTotais } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE a.code = 'carreta.custo_fixo' AND s.status = 'CLOSED' AND f.is_null
    `);
    expect(ausentesTotais).toBe(Number(nulosTotais[0].n));
    // E a contagem de zeros informados fica de fora, seja ela qual for.
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(0);
  }, 300_000);
});

describe("as duas colunas que não são fato", () => {
  it("Placa e Operador chegam à tabela, vindos de identidade e escopo", async () => {
    /*
      A descoberta que mais mudou a implementação: `Placa` está em
      `entity_identifier` e `Operador - Nome` em `scope`. Uma migração que as
      procurasse em `fact` não as acharia e concluiria que o dado sumiu — e a
      tabela apareceria sem as duas colunas que identificam a linha.
    */
    const carretas = (await get("/fleet-analysis/carretas")).body;
    expect(carretas.length).toBeGreaterThan(0);
    expect(carretas.every((l: { Placa: string | null }) => typeof l.Placa === "string")).toBe(
      true,
    );
    expect(
      carretas.some((l: Record<string, unknown>) => l["Operador - Nome"] !== null),
    ).toBe(true);
  }, 300_000);

  it("as colunas da tela chegam com o nome da tela, e número continua número", async () => {
    const [linha] = (await get("/fleet-analysis/carretas")).body;
    for (const coluna of ["implemento", "modelo", "custoFixo", "valorNfCompra"]) {
      expect(Object.keys(linha), coluna).toContain(coluna);
    }
    // Moeda ordenada como texto é um defeito que só aparece na tela; aqui ele
    // aparece no teste.
    expect(typeof linha.custoFixo === "number" || linha.custoFixo === null).toBe(true);
  }, 300_000);
});
