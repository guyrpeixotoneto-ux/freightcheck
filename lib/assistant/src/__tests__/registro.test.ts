/**
 * O contrato das ferramentas, e as garantias que ele promete.
 *
 * Cada bloco aqui prende uma das cinco promessas do PR 1. Elas não são
 * verificáveis pela leitura do código do agente — quando o laço existir, ele
 * vai depender delas e não vai reprová-las se falharem em silêncio. É aqui que
 * elas falham alto.
 */

import { describe, expect, it } from "vitest";
import {
  NOMES_RESERVADOS,
  Registro,
  evidenciasDe,
  executar,
  paraJsonSchema,
  registroPadrao,
  validar,
  type Argumentos,
  type ContextoDaFerramenta,
  type Ferramenta,
} from "../ferramentas/registro";

const ctxFalso = { db: {} as never, recorte: {} } satisfies ContextoDaFerramenta;

const argumentos: Argumentos = {
  nivel: { tipo: "texto", descricao: "…", opcoes: ["total", "grupos"] as const, obrigatorio: true },
  limite: { tipo: "inteiro", descricao: "…", minimo: 1, maximo: 100 },
  detalhado: { tipo: "booleano", descricao: "…" },
  placas: { tipo: "lista", descricao: "…" },
};

describe("isolamento — o recorte não é argumento", () => {
  it.each([...NOMES_RESERVADOS])("recusa registrar uma ferramenta com o campo %s", (reservado) => {
    const invasiva: Ferramenta = {
      nome: "invasiva",
      descricao: "…",
      argumentos: { [reservado]: { tipo: "texto", descricao: "…" } },
      executar: async () => ({ conteudo: null, evidencias: [] }),
    };

    expect(() => new Registro().registrar(invasiva)).toThrow(/recorte não pode ser argumento/);
  });

  it("nenhuma ferramenta do registro padrão declara recorte", () => {
    for (const f of registroPadrao().lista()) {
      for (const campo of Object.keys(f.argumentos)) {
        expect(NOMES_RESERVADOS.has(campo.toLowerCase())).toBe(false);
      }
    }
  });

  it("o esquema publicado ao modelo não tem como carregar recorte", () => {
    for (const f of registroPadrao().paraAnthropic()) {
      const esquema = f.input_schema as { properties: Record<string, unknown> };
      for (const campo of Object.keys(esquema.properties)) {
        expect(NOMES_RESERVADOS.has(campo.toLowerCase())).toBe(false);
      }
    }
  });
});

describe("o esquema que o modelo lê", () => {
  it("traduz cada tipo e marca só o obrigatório", () => {
    const e = paraJsonSchema(argumentos);

    expect(e.type).toBe("object");
    expect(e.additionalProperties).toBe(false);
    expect(e.required).toEqual(["nivel"]);
    expect(e.properties.nivel).toMatchObject({ type: "string", enum: ["total", "grupos"] });
    expect(e.properties.limite).toMatchObject({ type: "integer", minimum: 1, maximum: 100 });
    expect(e.properties.detalhado).toMatchObject({ type: "boolean" });
    expect(e.properties.placas).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("toda ferramenta e todo campo têm descrição — é por ela que o modelo escolhe", () => {
    for (const f of registroPadrao().lista()) {
      expect(f.descricao.length).toBeGreaterThan(40);
      for (const [nome, campo] of Object.entries(f.argumentos)) {
        expect(campo.descricao, `${f.nome}.${nome}`).toBeTruthy();
      }
    }
  });
});

describe("validação — o que o modelo manda é conferido", () => {
  it("aceita o que está na declaração", () => {
    const r = validar(argumentos, { nivel: "total", limite: 5 });
    expect(r).toEqual({ ok: true, valor: { nivel: "total", limite: 5 } });
  });

  it("recusa enum fora da lista, campo desconhecido e obrigatório ausente", () => {
    const fora = validar(argumentos, { nivel: "linhas" });
    expect(fora.ok).toBe(false);

    const desconhecido = validar(argumentos, { nivel: "total", scopeHash: "abc" });
    expect(desconhecido.ok).toBe(false);
    if (!desconhecido.ok) expect(desconhecido.recusas[0]!.campo).toBe("scopeHash");

    const semObrigatorio = validar(argumentos, { limite: 5 });
    expect(semObrigatorio.ok).toBe(false);
  });

  it("recusa o inteiro fora da faixa em vez de o cortar em silêncio", () => {
    const r = validar(argumentos, { nivel: "total", limite: 5000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recusas[0]!.motivo).toContain("máximo");
  });
});

describe("execução — nunca lança, e sempre deixa rastro", () => {
  const quebrada: Ferramenta = {
    nome: "quebrada",
    descricao: "uma ferramenta que falha, para provar o que acontece quando uma falha",
    argumentos: {},
    executar: async () => {
      throw new Error("o banco não respondeu");
    },
  };

  const boa: Ferramenta = {
    nome: "boa",
    descricao: "uma ferramenta que responde, para provar o caminho feliz do executor",
    argumentos: {},
    executar: async () => ({
      conteudo: { alteracoes: 267 },
      evidencias: [
        {
          ferramenta: "boa",
          titulo: "t",
          fatos: [{ rotulo: "Alterações", valor: "267" }],
          numeros: [267],
          origem: "teste",
        },
      ],
    }),
  };

  const registro = new Registro().registrar(quebrada).registrar(boa);

  it("uma consulta que falha vira fato declarado, não exceção", async () => {
    const c = await executar(registro, "quebrada", {}, ctxFalso);

    expect(c.ok).toBe(false);
    expect(c.erro).toContain("o banco não respondeu");
    // O modelo precisa receber a falha como conteúdo, com a instrução de não
    // concluir a partir dela — senão ele conclui.
    expect(JSON.stringify(c.conteudo)).toContain("Não conclua nada");
    expect(c.evidencias).toEqual([]);
  });

  it("uma ferramenta que não existe é dita, com a lista das que existem", async () => {
    const c = await executar(registro, "inventada", {}, ctxFalso);

    expect(c.ok).toBe(false);
    expect(JSON.stringify(c.conteudo)).toContain("boa");
  });

  it("argumentos inválidos voltam ao modelo para ele corrigir", async () => {
    const comArgs = new Registro().registrar({ ...boa, argumentos });
    const c = await executar(comArgs, "boa", { nivel: "inexistente" }, ctxFalso);

    expect(c.ok).toBe(false);
    expect(JSON.stringify(c.conteudo)).toContain("chame de novo");
  });

  it("o rastro carrega nome, argumentos crus e duração", async () => {
    const c = await executar(registro, "boa", { qualquer: 1 }, ctxFalso);

    expect(c.nome).toBe("boa");
    // Os argumentos ficam **como o modelo os mandou**, mesmo os recusados: é o
    // que permite investigar por que ele chamou errado.
    expect(c.argumentos).toEqual({ qualquer: 1 });
    expect(c.ms).toBeGreaterThanOrEqual(0);
  });
});

describe("rastreabilidade — só o que uma chamada devolveu pode ser citado", () => {
  it("as evidências de uma chamada que falhou não entram no lastro", async () => {
    const registro = new Registro()
      .registrar({
        nome: "falha",
        descricao: "falha sempre, e por isso não pode autorizar número nenhum",
        argumentos: {},
        executar: async () => {
          throw new Error("fora do ar");
        },
      })
      .registrar({
        nome: "ok",
        descricao: "responde, e por isso autoriza os números que devolveu",
        argumentos: {},
        executar: async () => ({
          conteudo: {},
          evidencias: [
            { ferramenta: "ok", titulo: "t", fatos: [], numeros: [42], origem: "teste" },
          ],
        }),
      });

    const chamadas = [
      await executar(registro, "falha", {}, ctxFalso),
      await executar(registro, "ok", {}, ctxFalso),
    ];

    const evidencias = evidenciasDe(chamadas);
    expect(evidencias).toHaveLength(1);
    expect(evidencias.flatMap((e) => e.numeros)).toEqual([42]);
  });
});

describe("a flag do agente", () => {
  /*
    Este bloco substitui o do PR 1, que exigia que **nenhum** arquivo importasse
    o registro. O PR 2 ligou a importação de propósito, e a garantia mudou de
    forma: não é mais "o registro não é referenciado", é "com a flag desligada,
    o registro não é usado". A segunda é a que interessa a partir daqui, e é a
    que continua valendo depois de a flag existir.
  */
  it("está desligada por padrão — nenhum ambiente entra no agente sem pedir", async () => {
    const { agenteLigado } = await import("../agente");
    const antes = process.env.ASSISTENTE_AGENTE;
    delete process.env.ASSISTENTE_AGENTE;

    expect(agenteLigado()).toBe(false);

    for (const valor of ["0", "", "true", "sim", "on"]) {
      process.env.ASSISTENTE_AGENTE = valor;
      // Só o literal "1" liga. Um `true` numa variável de ambiente é o jeito
      // mais fácil de o agente entrar em produção sem ninguém ter decidido.
      expect(agenteLigado(), `ASSISTENTE_AGENTE=${valor}`).toBe(false);
    }

    process.env.ASSISTENTE_AGENTE = "1";
    expect(agenteLigado()).toBe(true);

    if (antes === undefined) delete process.env.ASSISTENTE_AGENTE;
    else process.env.ASSISTENTE_AGENTE = antes;
  });
});
