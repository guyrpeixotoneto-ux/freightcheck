/**
 * A ferramenta `alteracoes` contra o banco de verdade.
 *
 * **O que estes casos existem para provar.** Hoje "o que mudou?", "liste as
 * alterações" e "o que mudou nos cavalos?" produzem respostas byte a byte
 * idênticas, porque as três recebem o mesmo `resumoDaVigencia` — três agregados,
 * sem lista e sem filtro. A tese do PR 1 é que a capacidade sempre existiu e
 * faltava um eixo para pedi-la. Ou os três níveis devolvem materiais
 * diferentes, ou a tese é falsa.
 *
 * A suíte se pula quando não há banco, como as outras que falam com o Postgres.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { alteracoes } from "../ferramentas/alteracoes";
import { executar, registroPadrao } from "../ferramentas/registro";
import type { ContextoDaFerramenta } from "../ferramentas/registro";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("alteracoes — a capacidade em três resoluções", () => {
  let ctx: ContextoDaFerramenta;
  let db: Database;

  beforeAll(() => {
    db = createDb(url!).db;
    ctx = { db, recorte: {} };
  });

  it("o nível `total` devolve os números da vigência", async () => {
    const r = await alteracoes.executar(ctx, { nivel: "total" });
    const c = r.conteudo as { totais: { changes: number; groups: number }; recorte: unknown };

    expect(c.totais.changes).toBeGreaterThan(0);
    expect(c.recorte).toMatchObject({ unidade: expect.any(String) });
    expect(r.evidencias).toHaveLength(1);
    expect(r.evidencias[0]!.numeros).toContain(c.totais.changes);
  });

  it("o nível `grupos` devolve a lista que hoje não existe, com antes→depois", async () => {
    const r = await alteracoes.executar(ctx, { nivel: "grupos", limite: 5 });
    const c = r.conteudo as {
      gruposNoTotal: number;
      mostrando: number;
      grupos: { atributo: string | null; comoMudou: string | null; veiculos: number }[];
    };

    expect(c.grupos.length).toBeGreaterThan(0);
    expect(c.grupos.length).toBeLessThanOrEqual(5);
    // O corte é declarado — uma lista truncada em silêncio lê-se como completa.
    expect(c.gruposNoTotal).toBeGreaterThanOrEqual(c.mostrando);
    // O par antes→depois é o que "liste as alterações" pede e o agregado nunca deu.
    expect(c.grupos.some((g) => g.comoMudou !== null)).toBe(true);
  });

  it("o filtro de equipamento filtra de verdade — é o defeito que motivou o PR", async () => {
    const todos = await alteracoes.executar(ctx, { nivel: "grupos", limite: 100 });
    const cavalos = await alteracoes.executar(ctx, {
      nivel: "grupos",
      equipamento: "CAVALO",
      limite: 100,
    });

    const t = todos.conteudo as { grupos: { equipamento: string }[] };
    const c = cavalos.conteudo as { grupos: { equipamento: string }[] };

    expect(c.grupos.every((g) => g.equipamento === "CAVALO")).toBe(true);
    /*
      E o resultado tem de ser **diferente** do não filtrado. Um filtro que
      passa por todos os itens e não remove nenhum passaria no `every` acima
      sem filtrar nada — que é literalmente o comportamento de hoje.
    */
    expect(c.grupos.length).toBeLessThan(t.grupos.length);
  });

  it("`ordenarPor` muda a ordem, e as ordens não são a mesma", async () => {
    const porImpacto = await alteracoes.executar(ctx, {
      nivel: "grupos", ordenarPor: "impacto", limite: 10,
    });
    const porVeiculos = await alteracoes.executar(ctx, {
      nivel: "grupos", ordenarPor: "veiculos", limite: 10,
    });

    const nomes = (r: { conteudo: unknown }) =>
      (r.conteudo as { grupos: { atributo: string | null }[] }).grupos.map((g) => g.atributo);

    expect(nomes(porImpacto)).not.toEqual(nomes(porVeiculos));
  });

  it("o nível `linhas` desce até a placa, com os dois valores", async () => {
    const grupos = await alteracoes.executar(ctx, {
      nivel: "grupos", ordenarPor: "veiculos", limite: 1,
    });
    const atributo = (grupos.conteudo as { grupos: { atributo: string }[] }).grupos[0]!.atributo;

    const r = await alteracoes.executar(ctx, { nivel: "linhas", atributo, limite: 5 });
    const c = r.conteudo as {
      linhasNoTotal: number;
      linhas: { placa: string | null; antes: string | null; depois: string | null }[];
    };

    expect(c.linhas.length).toBeGreaterThan(0);
    expect(c.linhasNoTotal).toBeGreaterThanOrEqual(c.linhas.length);
    expect(c.linhas[0]).toHaveProperty("antes");
    expect(c.linhas[0]).toHaveProperty("depois");
  });

  it("`linhas` sem atributo devolve instrução, e não um erro genérico", async () => {
    const r = await alteracoes.executar(ctx, { nivel: "linhas" });
    expect(JSON.stringify(r.conteudo)).toContain("nivel='grupos'");
    expect(r.evidencias).toEqual([]);
  });

  it("os três níveis entregam materiais diferentes — a tese do PR", async () => {
    const total = await alteracoes.executar(ctx, { nivel: "total" });
    const grupos = await alteracoes.executar(ctx, { nivel: "grupos", limite: 10 });
    const atributo = (grupos.conteudo as { grupos: { atributo: string }[] }).grupos[0]!.atributo;
    const linhas = await alteracoes.executar(ctx, { nivel: "linhas", atributo, limite: 10 });

    const serializados = [total, grupos, linhas].map((r) => JSON.stringify(r.conteudo));
    expect(new Set(serializados).size).toBe(3);

    // E cada nível autoriza números próprios: é isso que a trava vai conferir.
    const numeros = [total, grupos, linhas].map((r) =>
      r.evidencias.flatMap((e) => e.numeros).length,
    );
    expect(numeros.every((n) => n > 0)).toBe(true);
  });

  it("todo número citável saiu de uma consulta — nada é derivado na ferramenta", async () => {
    const r = await alteracoes.executar(ctx, { nivel: "total" });
    const c = r.conteudo as { totais: Record<string, number> };
    const autorizados = new Set(r.evidencias.flatMap((e) => e.numeros));

    for (const [chave, valor] of Object.entries(c.totais)) {
      if (typeof valor === "number") {
        expect(autorizados.has(valor), `${chave} = ${valor} sem lastro`).toBe(true);
      }
    }
  });

  it("pelo executor, o rastro sai completo", async () => {
    const chamada = await executar(registroPadrao(), "alteracoes", { nivel: "total" }, ctx);

    expect(chamada.ok).toBe(true);
    expect(chamada.nome).toBe("alteracoes");
    expect(chamada.erro).toBeNull();
    expect(chamada.evidencias.length).toBeGreaterThan(0);
  });

  it("um recorte que não existe falha declarado, e não vira o recorte padrão", async () => {
    /*
      A pergunta que o isolamento tem de responder: pedir um recorte inexistente
      devolve **nada**. `resolveContext` lança `ContextNotFoundError` em vez de
      cair no contexto padrão — e é o executor que transforma isso numa falha
      declarada, com a instrução de não concluir. O caminho inteiro é testado
      aqui porque é a composição dos dois que dá a garantia: a exceção sozinha
      derrubaria a pergunta, e o catch sozinho poderia esconder um fallback.
    */
    const chamada = await executar(
      registroPadrao(),
      "alteracoes",
      { nivel: "total" },
      { db, recorte: { scopeHash: "nao-existe-este-hash" } },
    );

    expect(chamada.ok).toBe(false);
    expect(chamada.evidencias).toEqual([]);
    expect(JSON.stringify(chamada.conteudo)).toContain("Não conclua nada");
    // E o dado do recorte que existe não aparece em lugar nenhum da saída.
    expect(JSON.stringify(chamada.conteudo)).not.toMatch(/totais|changes/);
  });
});
