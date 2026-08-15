/**
 * O transporte inteiro: o corpo que a rota responde, o `ApiError` que ele vira,
 * e o que a tela decide mostrar.
 *
 * Os cinco estados são decididos no servidor e testados lá, na função pura. O
 * que se fixa aqui é a outra metade do defeito: **a tela não pode apresentar
 * duas recomendações para o mesmo erro.** Foi assim que um ambiente ficou
 * travado — o parágrafo de cima mandava adotar, o de baixo mandava reiniciar, e
 * quem lia seguia o de baixo.
 *
 * Os corpos abaixo são cópias literais do que `responderSchemaAusente` e o
 * `/api/healthz` respondem, para que o teste falhe se a forma mudar de um lado
 * só.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { apresentar } from "@/lib/apresentar-erro";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";

const REGISTRO_PERDIDO: Diagnostico = {
  estado: "REGISTRO_PERDIDO",
  resumo:
    "Este banco tem o schema e não tem o registro dele. (…) Rodar as " +
    "migrations de novo falha igual.",
  risco: { emRisco: false, texto: "Nada se perdeu, e o que está gravado está íntegro." },
  acao: {
    codigo: "ADOTAR_MIGRATIONS",
    texto: "Declarar o que o banco já tem. Reiniciar o servidor não resolve.",
    comando: "pnpm --filter @workspace/db run migrate:adotar",
    quem: "operador",
  },
  evidencia: "A tentativa parou em 0000_freightcheck_foundation (SQLSTATE 42710).",
};

const SAUDAVEL: Diagnostico = {
  estado: "SAUDAVEL",
  resumo: "Conectado, com todas as migrations deste build aplicadas.",
  risco: { emRisco: false, texto: "Nada a conferir." },
  acao: null,
};

/** O 503 de Chamados como ele chega: contexto da rota + diagnóstico do banco. */
const erroDeChamados = (diagnostico: Diagnostico) =>
  new ApiError(
    "Este banco ainda não tem onde guardar chamados: (…) nada se perdeu. " +
      "Este banco tem o schema e não tem o registro dele. (…)",
    503,
    "SCHEMA_AUSENTE",
    {
      contexto:
        "Este banco ainda não tem onde guardar chamados: falta pelo menos " +
        "uma das migrations que criam esse schema. Não é o seu arquivo — " +
        "nada chegou a ser gravado, e nada se perdeu.",
      diagnostico,
    },
  );

describe("apresentar", () => {
  /**
   * **A regressão do caso vivido.**
   *
   * Registro de migrations perdido, schema existente, `42710` na `0000`. A tela
   * tem de mostrar `migrate:adotar` e mais nada — em particular, não pode
   * mostrar a mensagem crua da rota ao lado, que era de onde saía o "suba o
   * servidor de novo ou rode `migrate`".
   */
  it("registro perdido: mostra adotar, e nenhuma segunda recomendação", () => {
    const vista = apresentar(erroDeChamados(REGISTRO_PERDIDO));

    expect(vista.diagnostico?.estado).toBe("REGISTRO_PERDIDO");
    expect(vista.diagnostico?.acao?.comando).toBe(
      "pnpm --filter @workspace/db run migrate:adotar",
    );

    // A mensagem crua some quando há diagnóstico — é a metade do defeito que
    // vivia no componente.
    expect(vista.mensagemCrua).toBeNull();
    expect(vista.mostrarLinkHealthz).toBe(false);

    // E nada do que a tela vai escrever oferece o caminho que não funciona.
    const naTela = [
      vista.contexto,
      vista.diagnostico?.resumo,
      vista.diagnostico?.risco.texto,
      vista.diagnostico?.acao?.texto,
      vista.diagnostico?.acao?.comando,
      vista.diagnostico?.evidencia,
      vista.mensagemCrua,
      vista.falhaDeRede,
    ]
      .filter(Boolean)
      .join(" ");

    expect(naTela).toMatch(/migrate:adotar/);
    expect(naTela).not.toMatch(/run migrate`/);
    expect(naTela).not.toMatch(/suba o servidor/i);
  });

  /**
   * A invariante que torna o defeito irrepresentável, conferida em todo caminho
   * que esta função tem: onde há diagnóstico não há mensagem crua, e vice-versa.
   */
  it("diagnóstico e mensagem crua nunca coexistem", () => {
    const casos: unknown[] = [
      erroDeChamados(REGISTRO_PERDIDO),
      new ApiError("Internal server error", 500),
      new ApiError("Arquivo sem coluna de chamado", 400),
      new Error("qualquer coisa"),
      new TypeError("Failed to fetch"),
      "um erro que nem é Error",
    ];

    for (const caso of casos) {
      const vista = apresentar(caso);
      expect(
        vista.diagnostico !== null && vista.mensagemCrua !== null,
      ).toBe(false);
    }
  });

  it("erro não tipado cai no fallback: mensagem crua e o link do healthz", () => {
    const vista = apresentar(new ApiError("Internal server error", 500));

    expect(vista.diagnostico).toBeNull();
    expect(vista.mensagemCrua).toBe("Internal server error");
    expect(vista.mostrarLinkHealthz).toBe(true);
  });

  it("erro que nem é Error também é apresentável", () => {
    const vista = apresentar("caiu");

    expect(vista.mensagemCrua).toBe("caiu");
    expect(vista.diagnostico).toBeNull();
  });

  it("falha de rede não inventa diagnóstico — não houve resposta", () => {
    const vista = apresentar(new TypeError("Failed to fetch"));

    expect(vista.falhaDeRede).toMatch(/não completou/);
    expect(vista.diagnostico).toBeNull();
    expect(vista.mensagemCrua).toBeNull();
  });

  it("sem diagnóstico no erro, o do /healthz vale", () => {
    const vista = apresentar(new ApiError("Internal server error", 500), {
      diagnostico: REGISTRO_PERDIDO,
    });

    expect(vista.diagnostico?.estado).toBe("REGISTRO_PERDIDO");
    expect(vista.mensagemCrua).toBeNull();
  });

  /**
   * "Está tudo certo" ao lado de uma falha manda procurar no lugar errado: se o
   * banco está são, a causa do erro é outra, e a mensagem crua é o que se tem.
   */
  it("banco saudável não é explicação para um erro — a mensagem crua volta", () => {
    const vista = apresentar(new ApiError("Internal server error", 500), {
      diagnostico: SAUDAVEL,
    });

    expect(vista.diagnostico).toBeNull();
    expect(vista.mensagemCrua).toBe("Internal server error");
  });

  it("o diagnóstico do próprio erro tem prioridade sobre o do /healthz", () => {
    // O `/healthz` é uma segunda pergunta, feita depois; o do erro descreve o
    // banco no instante em que a chamada falhou.
    const vista = apresentar(erroDeChamados(REGISTRO_PERDIDO), {
      diagnostico: SAUDAVEL,
    });

    expect(vista.diagnostico?.estado).toBe("REGISTRO_PERDIDO");
  });

  /**
   * Um bundle antigo ainda no ar é situação real neste projeto. A tela precisa
   * cair no caminho antigo em vez de quebrar lendo `.resumo` de `undefined`.
   */
  it("corpo sem diagnóstico, ou com diagnóstico malformado, não quebra a tela", () => {
    expect(ehDiagnostico(undefined)).toBe(false);
    expect(ehDiagnostico({ estado: "INVENTADO" })).toBe(false);
    expect(ehDiagnostico({ estado: "SAUDAVEL" })).toBe(false);
    expect(ehDiagnostico(SAUDAVEL)).toBe(true);

    const vista = apresentar(
      new ApiError("erro", 503, "SCHEMA_AUSENTE", {
        diagnostico: { estado: "INVENTADO" } as unknown as Diagnostico,
      }),
    );
    expect(vista.diagnostico).toBeNull();
    expect(vista.mensagemCrua).toBe("erro");
  });
});
