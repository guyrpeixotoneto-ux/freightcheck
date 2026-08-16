import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import express from "express";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const { default: router } = await import("../fleet-analysis");
  const app = express();
  app.use(express.json());
  app.use(router);
  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 120_000);

afterAll(async () => {
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
  it("`/summary` devolve os seis blocos que a tela consome", async () => {
    const res = await get("/fleet-analysis/summary");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "ativoStatusByVigencia",
      "financiamentoByVigencia",
      "modelosByVigencia",
      "summary",
      "vigenciaLabels",
      "vigencias",
    ]);
    expect(Array.isArray(res.body.vigencias)).toBe(true);
    expect(Array.isArray(res.body.summary)).toBe(true);
    expect(typeof res.body.vigenciaLabels).toBe("object");
  });

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

  it("e por isso ela devolve vazio — enquanto o canônico tem nove vigências", async () => {
    /*
      ESTE BLOCO É PARA SER INVERTIDO NO PR-15.

      Ele não afirma que devolver vazio está certo: afirma que é o que acontece
      hoje, para que a migração tenha um antes contra o que se medir. Quando a
      rota passar a ler o canônico, este teste falha — e é aí que ele vira a
      prova positiva de que a tela voltou a ter dado.
    */
    const res = await get("/fleet-analysis/summary");
    expect(res.body.vigencias).toEqual([]);
    expect(res.body.summary).toEqual([]);
    expect((await get("/fleet-analysis/carretas")).body).toEqual([]);
    expect((await get("/fleet-analysis/cavalos")).body).toEqual([]);
  });

  it("a rota não escreve nada — é fonte paralela de leitura, não porta de entrada", async () => {
    // A distinção da Parte A da auditoria, em forma de prova: nenhum dos três
    // endpoints é POST, e o arquivo não importa `@workspace/db`.
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(
      path.join(RAIZ, "artifacts/api-server/src/routes/fleet-analysis.ts"),
      "utf8",
    );
    expect(fonte).not.toMatch(/router\.(post|put|patch|delete)\(/);
    expect(fonte).not.toMatch(/@workspace\/db/);
  });
});
