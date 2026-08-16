/**
 * As dez capacidades, exercitadas contra o banco.
 *
 * **O que se prova aqui.** Que cada ferramenta roda de verdade — não que o
 * modelo as escolhe bem, que é o relatório de trajetória. Um invólucro que
 * compila e quebra na primeira chamada é o defeito mais fácil de introduzir
 * neste PR, porque nada além de uma execução real o pega: os tipos casam, o
 * nome existe, e a consulta por baixo espera um argumento noutro formato.
 * Foi assim que `entityType` apareceu no PR 1.
 *
 * **E as invariantes do contrato, sobre o conjunto.** Nome único, descrição que
 * diz quando usar, nenhum campo de recorte, e — a que mais importa — nenhuma
 * ferramenta que devolva número sem o declarar como evidência.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { NOMES_RESERVADOS, executar, registroPadrao } from "../ferramentas/registro";
import type { ContextoDaFerramenta } from "../ferramentas/registro";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

const registro = registroPadrao();

describe("o registro como conjunto", () => {
  it("tem dez capacidades, cada uma com nome único", () => {
    const nomes = registro.lista().map((f) => f.nome);
    expect(nomes).toHaveLength(10);
    expect(new Set(nomes).size).toBe(10);
  });

  it("nenhuma declara recorte — a fronteira de isolamento vale para todas", () => {
    for (const f of registro.lista()) {
      for (const campo of Object.keys(f.argumentos)) {
        expect(NOMES_RESERVADOS.has(campo.toLowerCase()), `${f.nome}.${campo}`).toBe(false);
      }
    }
  });

  it("toda descrição diz quando usar, e não só o que é", () => {
    for (const f of registro.lista()) {
      // A descrição é o único texto pelo qual o modelo decide chamar. Uma linha
      // curta é uma ferramenta que ele vai ignorar ou usar no lugar errado.
      expect(f.descricao.length, f.nome).toBeGreaterThan(100);
      for (const [campo, decl] of Object.entries(f.argumentos)) {
        expect(decl.descricao.length, `${f.nome}.${campo}`).toBeGreaterThan(10);
      }
    }
  });

  it("o esquema publicado é JSON Schema válido para a API", () => {
    for (const f of registro.paraAnthropic()) {
      const e = f.input_schema as { type: string; properties: object; required: string[] };
      expect(e.type).toBe("object");
      expect(e.properties).toBeTypeOf("object");
      expect(Array.isArray(e.required)).toBe(true);
      expect(f.name).toMatch(/^[a-z_]+$/);
    }
  });
});

comBanco("cada capacidade roda contra o banco", () => {
  let ctx: ContextoDaFerramenta;

  beforeAll(() => {
    const db: Database = createDb(url!).db;
    ctx = { db, recorte: {} };
  });

  /*
    Os argumentos mínimos de cada ferramenta. Onde há obrigatório, ele é
    preenchido com um valor plausível; onde não há, a chamada vai vazia — que é
    como o modelo a fará na primeira vez.
  */
  const chamadas: [string, Record<string, unknown>][] = [
    ["alteracoes", { nivel: "total" }],
    ["recortes", {}],
    ["parametros", { busca: "ipva" }],
    ["comparar", {}],
    ["ordenacao", { por: "criticidade" }],
    ["ordenacao", { por: "dinheiro", sentido: "perda" }],
    ["veiculos", {}],
    ["resultado", {}],
    ["documentos", { busca: "combustível" }],
    ["estado_do_dado", { aspecto: "curadoria" }],
    ["estado_do_dado", { aspecto: "importacoes" }],
    ["estado_do_dado", { aspecto: "balanco" }],
    ["estado_do_dado", { aspecto: "panorama" }],
    ["estado_do_dado", { aspecto: "sem_preco" }],
  ];

  it.each(chamadas)("%s %j executa sem quebrar", async (nome, args) => {
    const c = await executar(registro, nome, args, ctx);

    expect(c.erro, `${nome} falhou: ${c.erro}`).toBeNull();
    expect(c.ok).toBe(true);
    expect(c.conteudo).toBeDefined();
  });

  it("`serie` roda com um código vindo de `parametros` — as duas compõem", async () => {
    /*
      Este caso existe porque é a composição que o agente vai fazer: descobrir o
      código e usá-lo. Testá-la com um código escrito à mão provaria que a
      ferramenta roda e esconderia que o campo que ela devolve não é o que a
      outra espera.
    */
    const dicionario = await executar(registro, "parametros", { busca: "ipva", limite: 1 }, ctx);
    const codigo = (dicionario.conteudo as { parametros: { codigo: string }[] }).parametros[0]!
      .codigo;

    const s = await executar(registro, "serie", { atributo: codigo }, ctx);

    expect(s.ok).toBe(true);
    expect(s.erro).toBeNull();
  });

  it("um argumento obrigatório ausente volta como recusa, não como exceção", async () => {
    const c = await executar(registro, "serie", {}, ctx);

    expect(c.ok).toBe(false);
    expect(JSON.stringify(c.conteudo)).toContain("chame de novo");
  });

  it("toda ferramenta que devolve número o declara como evidência", async () => {
    /*
      A regra que sustenta a trava: um número que apareça no conteúdo sem estar
      numa evidência é um número que o modelo pode citar e a trava não conhece.
      Aqui a checagem é a mais barata possível — se houve fato numérico, houve
      evidência —, e ela pega o esquecimento que é fácil cometer num invólucro.
    */
    for (const [nome, args] of chamadas) {
      const c = await executar(registro, nome, args, ctx);
      if (!c.ok) continue;

      const bruto = JSON.stringify(c.conteudo);
      const temNumeroDeGrandeza = /:\s*-?\d{2,}/.test(bruto);
      if (temNumeroDeGrandeza && c.evidencias.length === 0) {
        /*
          `parametros` e `recortes` são a exceção declarada: o que elas devolvem
          é catálogo — códigos, nomes, datas —, e não medida. Nada ali é
          quantidade que uma resposta possa somar.
        */
        expect(["parametros", "recortes", "documentos"], `${nome} devolveu número sem evidência`).toContain(
          nome,
        );
      }
    }
  });

  it("o recorte inexistente falha declarado em todas — não cai no padrão", async () => {
    const invasor: ContextoDaFerramenta = {
      db: ctx.db,
      recorte: { scopeHash: "nao-existe" },
    };

    for (const nome of ["alteracoes", "comparar", "ordenacao", "veiculos", "resultado"]) {
      const args = nome === "alteracoes" ? { nivel: "total" } : nome === "ordenacao" ? { por: "criticidade" } : {};
      const c = await executar(registro, nome, args, invasor);

      expect(c.ok, `${nome} respondeu para um recorte que não existe`).toBe(false);
      expect(c.evidencias).toEqual([]);
    }
  });
});
