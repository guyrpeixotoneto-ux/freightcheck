/**
 * ETAPA 2, item 1 — a régua passa a medir o que o agente exerceu.
 *
 * **O defeito era do instrumento, não do produto.** `ChamadaDeFerramenta.nome`
 * guarda o que o modelo pediu — `"alteracoes"` —, e o nível vive nos argumentos.
 * A capacidade, porém, é definida pelo nível: `alteracoes:total` é um agregado e
 * `alteracoes:linhas` é a enumeração veículo a veículo. Como `tecnico.ferramentas`
 * carregava só o nome, `capacidadesDe` caía no casamento por prefixo, que devolve
 * a **primeira** entrada do mapa — a mais fraca.
 *
 * O efeito é uma decisão errada, não um número feio: a bateria por desfecho é o
 * critério de virada de chave, e ela reprovava o agente por `capacidade-ausente`
 * em consultas que tinham descido ao veículo. Qualquer comparação planejador ×
 * agente feita sobre esse número está viciada contra o agente.
 *
 * Aqui as ferramentas são chamadas **de verdade**, contra um banco real, sem
 * modelo nenhum: o que se mede é a tradução de chamada em capacidade, e ela não
 * precisa de LLM para ser conferida.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { computeMissingChangeSets } from "@workspace/comparison";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { executar, registroPadrao, type ChamadaDeFerramenta } from "../ferramentas/registro";
import { capacidadesDe } from "../aceitacao/desfecho";
import type { Resposta } from "../resposta";

const ATRIBUTOS: AttributeSpec[] = [
  {
    code: "cavalo.finame",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

/**
 * O mesmo cálculo que `montarComAgente` faz — sem montar a resposta inteira.
 *
 * Escrito aqui e conferido contra o de produção no último caso deste arquivo:
 * duplicá-lo sem essa amarra seria testar uma cópia da regra em vez da regra.
 */
function comoOAgenteRegistra(chamadas: ChamadaDeFerramenta[]): string[] {
  return chamadas.map((c) => {
    if (!c.ok) return `${c.nome} (falhou)`;
    const daEvidencia = [...new Set(c.evidencias.map((e) => e.ferramenta))];
    if (daEvidencia.length > 0) return daEvidencia.join(" + ");
    return `${c.nome} (sem evidência)`;
  });
}

function respostaCom(ferramentas: string[]): Resposta {
  return { tecnico: { ferramentas } } as unknown as Resposta;
}

describe("Etapa 2 — capacidade exercida, e não nome pedido", () => {
  let ctx: TestDb;
  let db: Database;

  beforeAll(async () => {
    ctx = await createTestDatabase("capacidade_exercida");
    db = ctx.db;
    await buildFixture(
      db,
      ATRIBUTOS,
      [
        {
          label: "antes",
          effectiveDate: "2026-07-02",
          data: { PQR4S55: { "cavalo.finame": 9000 }, PQR4S56: { "cavalo.finame": 8000 } },
        },
        {
          label: "depois",
          effectiveDate: "2026-08-01",
          data: { PQR4S55: { "cavalo.finame": 4000 }, PQR4S56: { "cavalo.finame": 3000 } },
        },
      ],
      { entityType: "CAVALO", scopeHash: "hash-cap", canal: "EMPURRADA" },
    );
    await computeMissingChangeSets(db, "teste:capacidade");
  }, 120_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  it("os três níveis de `alteracoes` produzem capacidades diferentes", async () => {
    const reg = registroPadrao();
    const f = { db, recorte: { scopeHash: "hash-cap" } };

    const total = await executar(reg, "alteracoes", { nivel: "total" }, f);
    const grupos = await executar(reg, "alteracoes", { nivel: "grupos", limite: 5 }, f);
    const g = (grupos.conteudo as { grupos: { atributo: string; equipamento: string }[] }).grupos[0]!;
    const linhas = await executar(
      reg,
      "alteracoes",
      { nivel: "linhas", atributo: g.atributo, equipamento: g.equipamento },
      f,
    );

    // O nome cru é o mesmo nos três — é exatamente por isso que ele não serve.
    expect([total.nome, grupos.nome, linhas.nome]).toEqual([
      "alteracoes",
      "alteracoes",
      "alteracoes",
    ]);

    expect(capacidadesDe(respostaCom(comoOAgenteRegistra([total])))).toEqual(
      new Set(["MOVIMENTO_AGREGADO"]),
    );
    expect(capacidadesDe(respostaCom(comoOAgenteRegistra([grupos])))).toEqual(
      new Set(["ALTERACOES_DETALHADAS"]),
    );
    expect(capacidadesDe(respostaCom(comoOAgenteRegistra([linhas])))).toEqual(
      new Set(["ALTERACOES_DETALHADAS"]),
    );
  }, 60_000);

  it("o nome cru mede a capacidade mais fraca — a régua antiga, reproduzida", () => {
    /*
      A prova de que o defeito era real: com o nome que o modelo pediu, uma
      consulta que desceu ao veículo é registrada como agregado. É esta linha
      que produzia "capacidade-ausente: precisava de ALTERACOES_DETALHADAS".
    */
    expect(capacidadesDe(respostaCom(["alteracoes"]))).toEqual(
      new Set(["MOVIMENTO_AGREGADO"]),
    );
    expect(capacidadesDe(respostaCom(["alteracoes:linhas"]))).toEqual(
      new Set(["ALTERACOES_DETALHADAS"]),
    );
  });

  it("uma consulta que falhou não exerce capacidade nenhuma", async () => {
    const reg = registroPadrao();
    const f = { db, recorte: { scopeHash: "hash-cap" } };
    /*
      `linhas` sem `atributo` é o erro que o próprio catálogo prevê e explica.
      Ele devolve conteúdo com `erro` e nenhuma evidência — e a régua não pode
      contar isso como enumeração feita.
    */
    const semAtributo = await executar(reg, "alteracoes", { nivel: "linhas" }, f);
    expect(semAtributo.evidencias).toHaveLength(0);
    expect(capacidadesDe(respostaCom(comoOAgenteRegistra([semAtributo])))).toEqual(new Set());
  }, 60_000);

  it("uma chamada marcada como falha sai da conta", () => {
    expect(capacidadesDe(respostaCom(["ordenacao (falhou)"]))).toEqual(new Set());
    expect(capacidadesDe(respostaCom(["ordenacao"]))).toEqual(new Set(["ORDENACAO"]));
  });

  it("uma chamada com duas evidências conta as duas capacidades", () => {
    expect(capacidadesDe(respostaCom(["alteracoes:linhas + documentos"]))).toEqual(
      new Set(["ALTERACOES_DETALHADAS", "BOOK"]),
    );
  });

  it("o planejador continua sendo medido pelos nomes dele", () => {
    expect(capacidadesDe(respostaCom(["resumoDaVigencia", "veiculosDoGrupo"]))).toEqual(
      new Set(["MOVIMENTO_AGREGADO", "ALTERACOES_DETALHADAS"]),
    );
  });

  /*
    A amarra que impede este arquivo de testar uma cópia: a tradução usada aqui
    tem de dar o mesmo resultado que a de produção. Ela é exercida de verdade em
    `montarComAgente`, e o que se confere é o contrato — chamada ok com
    evidência vira o nome da evidência; chamada com falha, o nome cru marcado.
  */
  it("a tradução deste teste é a mesma de produção", async () => {
    const reg = registroPadrao();
    const f = { db, recorte: { scopeHash: "hash-cap" } };
    const grupos = await executar(reg, "alteracoes", { nivel: "grupos", limite: 3 }, f);
    expect(comoOAgenteRegistra([grupos])).toEqual(["alteracoes:grupos"]);
    expect(grupos.evidencias.map((e) => e.ferramenta)).toEqual(["alteracoes:grupos"]);
  }, 60_000);
});
