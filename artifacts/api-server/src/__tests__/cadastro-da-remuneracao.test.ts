import { describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * A porta do cadastro, do lado da borda — com o banco fingido.
 *
 * O que se prova aqui não é aritmética: é **qual aba responde por qual
 * quinzena**, que é a regra que o usuário pediu e a única coisa que este
 * arquivo decide. A conta está provada duas vezes noutro lugar — a tradução em
 * `@workspace/remuneracao` (`contrato.test.ts`) e o motor em
 * `@workspace/fechamento` (`mapa-rota.test.ts`, contra a `.xlsb` real).
 *
 * O banco é fingido de propósito. Um Postgres aqui provaria que o `SELECT`
 * compila, e não provaria nenhuma das cinco decisões abaixo; e o teste que
 * precisa de banco é o que ninguém roda na máquina antes de mandar o commit.
 */

/** Uma aba completa de julho/2026, como a tela a guarda (percentual em pontos). */
const ABA = new Map<string, number>([
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  ["rota_percentual_iss", 3.16],
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  ["inativo_remuneracao_fixa", 1650.97],
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
  ["marketing_sem_impostos", 0],
]);

/** O texto de uma consulta do drizzle, para o banco fingido saber quem chamou. */
function textoDa(query: unknown): string {
  const partes: string[] = [];
  const visitar = (no: unknown) => {
    if (no == null) return;
    if (typeof no === "string") return void partes.push(no);
    if (Array.isArray(no)) return void no.forEach(visitar);
    if (typeof no === "object" && "value" in (no as Record<string, unknown>)) {
      visitar((no as { value: unknown }).value);
    }
  };
  visitar((query as { queryChunks?: unknown }).queryChunks);
  return partes.join(" ");
}

/**
 * Um banco com uma unidade registrada e as abas de `porVigencia`.
 *
 * `unidade: null` é a unidade que ninguém registrou — o estado de toda unidade
 * antes de alguém abrir a tela de cadastro.
 */
function bancoCom(opcoes: {
  unidade?: { scopeHash: string; canal: string } | null;
  porVigencia: Record<string, ReadonlyMap<string, number>>;
}): Database {
  const unidade = opcoes.unidade === undefined ? { scopeHash: "sh1", canal: "" } : opcoes.unidade;

  return {
    async execute(query: unknown) {
      const texto = textoDa(query);

      if (texto.includes("remuneracao_unidade")) {
        return { rows: unidade ? [{ scope_hash: unidade.scopeHash, canal: unidade.canal }] : [] };
      }
      if (texto.includes("DISTINCT")) {
        return { rows: Object.keys(opcoes.porVigencia).sort().map((d) => ({ effective_date: d })) };
      }
      /* O que sobra é a leitura da aba, em `lerPlanilhasEmLote`. */
      const rows = Object.entries(opcoes.porVigencia).flatMap(([data, valores]) =>
        [...valores].map(([chave, valor]) => ({
          scope_hash: unidade?.scopeHash ?? "sh1",
          canal: unidade?.canal ?? "",
          effective_date: data,
          chave,
          valor: String(valor),
          observacao: null,
          autor_nome: null,
          atualizada_em: new Date("2026-07-20T12:00:00Z"),
        })),
      );
      return { rows };
    },
  } as unknown as Database;
}

const PRIMEIRA = { canal: "ROTA" as const, inicio: "2026-07-01", fim: "2026-07-15" };
const SEGUNDA = { canal: "ROTA" as const, inicio: "2026-07-16", fim: "2026-07-31" };
const UNIDADE = { unidadeCodigo: "0443", transportadoraCodigo: "36" };

const porta = (db: Database) => cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });

describe("cadastroDaRemuneracao", () => {
  it("uma aba na 1ª quinzena responde também pela 2ª, e diz de onde veio", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });

    const primeira = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });
    const segunda = await porta(db).resolver({ ...UNIDADE, ...SEGUNDA });

    expect(primeira?.vigenteDe).toBe("2026-07-01");
    expect(segunda?.vigenteDe).toBe("2026-07-01");
    /* Mesma aba, mesma identidade — é por ela que a tela diz que é uma só. */
    expect(segunda?.cadastroId).toBe(primeira?.cadastroId);
    expect(segunda?.parametros.frotaFixaAtiva).toBe(56);
  });

  it("e o contrário também: uma aba na 2ª responde pela 1ª", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-16": ABA } });

    expect((await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA }))?.vigenteDe).toBe("2026-07-16");
    expect((await porta(db).resolver({ ...UNIDADE, ...SEGUNDA }))?.vigenteDe).toBe("2026-07-16");
  });

  it("duas abas cadastradas: cada quinzena usa a sua", async () => {
    const segundaAba = new Map(ABA).set("frota_fixa_ativos", 60);
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA, "2026-07-16": segundaAba } });

    const primeira = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });
    const segunda = await porta(db).resolver({ ...UNIDADE, ...SEGUNDA });

    expect(primeira?.vigenteDe).toBe("2026-07-01");
    expect(primeira?.parametros.frotaFixaAtiva).toBe(56);
    expect(segunda?.vigenteDe).toBe("2026-07-16");
    expect(segunda?.parametros.frotaFixaAtiva).toBe(60);
    expect(segunda?.cadastroId).not.toBe(primeira?.cadastroId);
  });

  it("a herança não atravessa o mês: junho não responde por julho", async () => {
    const db = bancoCom({ porVigencia: { "2026-06-01": ABA, "2026-06-16": ABA } });
    expect(await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA })).toBeNull();
  });

  it("converte o percentual de pontos para fração — 17,84 % vira 0,1784", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    const r = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(r?.parametros.aliquotas.icms).toBeCloseTo(0.1784, 10);
    expect(r?.parametros.parcelaDentroDoMunicipio).toBeCloseTo(0.0316, 10);
    expect(r?.custoVariavelPrevistoPor25Viagens).toBe(5176.53);
  });

  it("aba incompleta não vira contrato — o devido fica vazio, não errado", async () => {
    const faltando = new Map(ABA);
    faltando.delete("van_custo_fixo");
    const db = bancoCom({ porVigencia: { "2026-07-01": faltando } });

    expect(await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA })).toBeNull();
  });

  it("unidade sem cadastro registrado responde null, não o contrato de outra", async () => {
    const db = bancoCom({ unidade: null, porVigencia: { "2026-07-01": ABA } });
    expect(await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA })).toBeNull();
  });

  it("o AS não é respondido com os parâmetros da Rota", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    expect(await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA, canal: "AS" })).toBeNull();
  });
});
