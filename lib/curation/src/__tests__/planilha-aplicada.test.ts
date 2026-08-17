import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  taxonomyNodeTable,
} from "@workspace/db";
import { criarBancoComExportRealPromovido, type TestDb } from "@workspace/ingest/testing";
import { listarCategorias } from "../catalogo";
import { runProposalPass } from "../engine";
import {
  aplicarPreenchimento,
  conferirPreenchimento,
  montarLinhas,
  type AtributoDoModelo,
} from "../planilha-de-atributos";
import { seedTaxonomy } from "../taxonomy";
import { getCurationQueue } from "../engine";

/**
 * A planilha aplicada contra a base real.
 *
 * A prova que este arquivo existe para dar é uma só e é negativa: **nada do que
 * a planilha grava confirma atributo nenhum.** Nome, descrição e categoria
 * entram; `semantics_status`, `confirmed_by` e
 * `confirmed_at` ficam exatamente onde estavam. No dia em que um caminho daqui
 * mexer nesses três campos, uma planilha preenchida por e-mail passa a destravar
 * soma financeira sem justificativa assinada — e é este arquivo que falha.
 */

let ctx: TestDb;
/** Presumido e sem nada escrito: o estado em que a fila realmente está. */
const CODE = "cavalo.valor_pneu";
/** O mesmo atributo, como a planilha o nomeia: aba + coluna de origem. */
const ABA = "Cavalo";
const ATRIBUTO = "valorPneu";

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("planilha-aplicada");
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

async function atributo(code: string) {
  const [row] = await ctx.db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  return row;
}

async function versaoEmVigor(attributeId: string) {
  const [row] = await ctx.db
    .select()
    .from(attributeSemanticsTable)
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, attributeId),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );
  return row;
}

async function daBase(): Promise<AtributoDoModelo[]> {
  const fila = await getCurationQueue(ctx.db, { includeConfirmed: true });
  return fila.map((item) => ({
    code: item.code,
    sourceName: item.sourceName,
    entityType: item.entityType,
    semanticsStatus: item.semanticsStatus,
    displayName: item.displayName,
    definition: item.definition,
    taxonomyCode: item.taxonomyCode,
  }));
}

/** O mesmo recorte que a rota entrega ao modelo — nem um campo a mais. */
async function catalogos() {
  const categorias = await listarCategorias(ctx.db);
  return {
    categorias: categorias.map((c) => ({
      code: c.code,
      caminho: c.caminho,
      sintetico: c.sintetico,
      analitico: c.analitico,
    })),
  };
}

describe("a planilha de atributos descreve, e só", () => {
  it("grava nome, descrição e categoria sem tocar no status", async () => {
    const base = await daBase();
    const lista = await catalogos();
    const antes = await atributo(CODE);
    expect(antes.semanticsStatus).not.toBe("CONFIRMED");

    const conferencia = conferirPreenchimento(
      [
        {
          aba: ABA,
          linha: 2,
          atributo: ATRIBUTO,
          displayName: "Valor do pneu",
          definition: "Preço unitário do pneu considerado em contrato.",
          categoria: lista.categorias[0].caminho,
        },
      ],
      base,
      lista,
    );
    expect(conferencia.resumo.mudam).toBe(1);

    const resultado = await aplicarPreenchimento(ctx.db, {
      linhas: conferencia.linhas,
      actor: "planilha@teste",
    });
    expect(resultado.gravadas).toBe(1);

    const depois = await atributo(CODE);
    expect(depois.displayName).toBe("Valor do pneu");
    expect(depois.definition).toBe("Preço unitário do pneu considerado em contrato.");

    // O que esta planilha não pode ter movido, e é o motivo do arquivo.
    expect(depois.semanticsStatus).toBe(antes.semanticsStatus);
    expect(depois.confirmedBy).toBe(antes.confirmedBy);
    expect(depois.confirmedAt).toEqual(antes.confirmedAt);
  });

  it("escreve a categoria como proposta, na versão em vigor", async () => {
    const depois = await atributo(CODE);
    const lista = await catalogos();

    const [no] = await ctx.db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, lista.categorias[0].code));

    expect(depois.taxonomyNodeId).toBe(no.id);

    // Espelhado na versão em vigor: sem isto, a próxima projeção devolveria o
    // categoria antiga e a planilha pareceria não ter sido aplicada.
    const versao = await versaoEmVigor(depois.id);
    expect(versao.taxonomyNodeId).toBe(no.id);
    // E a versão também não foi confirmada por este caminho.
    expect(versao.confirmedBy).toBeNull();
  });

  it("registra no histórico quem trouxe a planilha para dentro", async () => {
    const alvo = await atributo(CODE);
    const eventos = await ctx.db
      .select()
      .from(curationEventTable)
      .where(eq(curationEventTable.targetId, alvo.id));

    const daPlanilha = eventos.filter((e) => e.actor === "planilha@teste");
    expect(daPlanilha.length).toBeGreaterThanOrEqual(3);
    expect(daPlanilha.map((e) => e.field)).toEqual(
      expect.arrayContaining(["display_name", "definition", "taxonomy_node_id"]),
    );
    // Nenhum deles é confirmação: o campo que confirma não aparece.
    expect(daPlanilha.map((e) => e.field)).not.toContain("semantics_status");
  });

  it("não grava nada quando a planilha volta igual ao que já está lá", async () => {
    const base = await daBase();
    const lista = await catalogos();
    const linhas = montarLinhas(
      base.filter((a) => a.code === CODE),
      lista,
    );

    const conferencia = conferirPreenchimento(
      linhas.map((l) => ({ aba: ABA, linha: 2, ...l })),
      base,
      lista,
    );
    expect(conferencia.resumo).toMatchObject({ mudam: 0, campos: 0, iguais: 1 });


    const resultado = await aplicarPreenchimento(ctx.db, {
      linhas: conferencia.linhas,
      actor: "planilha@teste",
    });
    expect(resultado).toMatchObject({ gravadas: 0, campos: 0 });
  });

  it("não cria atributo para uma coluna que a base não tem", async () => {
    const base = await daBase();
    const lista = await catalogos();
    const conferencia = conferirPreenchimento(
      [
        {
          aba: "Trecho",
          linha: 2,
          atributo: "pedagio",
          definition: "Pedágio do trecho.",
        },
      ],
      base,
      lista,
    );

    await aplicarPreenchimento(ctx.db, {
      linhas: conferencia.linhas,
      actor: "planilha@teste",
    });

    const [criado] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "trecho.pedagio"));
    expect(criado).toBeUndefined();
  });

  it("exige responsável — o arquivo passou por gente sem login", async () => {
    await expect(
      aplicarPreenchimento(ctx.db, { linhas: [], actor: "  " }),
    ).rejects.toThrow(/responsável/i);
  });
});
