/**
 * O que a tela decide mostrar, nos dois eixos e no encontro deles.
 *
 * A classificação do banco é do servidor e é testada lá; a do transporte é
 * daqui e tem arquivo próprio. O que se fixa **neste** é a arbitragem: qual
 * orientação vence, e a invariante que impede a tela de mostrar duas.
 *
 * Foi assim que um ambiente ficou travado — o parágrafo de cima mandava adotar,
 * o de baixo mandava reiniciar, e quem lia seguia o de baixo. Os corpos abaixo
 * são cópias do que `responderSchemaAusente` e o `/api/healthz` respondem, para
 * que o teste falhe se a forma mudar de um lado só.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { apresentar } from "@/lib/apresentar-erro";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";

const REGISTRO_PERDIDO: Diagnostico = {
  estado: "REGISTRO_PERDIDO",
  resumo:
    "Este banco tem o schema e não tem o registro dele. (…) Rodar as " +
    "migrations de novo falha igual.",
  risco: {
    emRisco: false,
    texto: "Nada se perdeu, e o que está gravado está íntegro.",
  },
  acao: {
    codigo: "ADOTAR_MIGRATIONS",
    texto: "Declarar o que o banco já tem. Reiniciar o servidor não resolve.",
    comando: "pnpm --filter @workspace/db run migrate:adotar",
    quem: "operador",
  },
  evidencia:
    "A tentativa parou em 0000_freightcheck_foundation (SQLSTATE 42710).",
};

const PENDENTES: Diagnostico = {
  estado: "MIGRATIONS_PENDENTES",
  resumo: "Conectado, mas 2 migrations deste build não estão aplicadas.",
  risco: { emRisco: false, texto: "Nada se perdeu." },
  acao: {
    codigo: "APLICAR_MIGRATIONS",
    texto: "Aplicar as migrations que faltam.",
    comando: "pnpm --filter @workspace/db run migrate",
    quem: "operador",
  },
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
    "Chamados Camaçari.xlsx: este banco ainda não tem onde guardar chamados " +
      "(…) nada se perdeu. Este banco tem o schema e não tem o registro dele.",
    503,
    "SCHEMA_AUSENTE",
    {
      contexto:
        "Chamados Camaçari.xlsx: este banco ainda não tem onde guardar " +
        "chamados: falta pelo menos uma das migrations que criam esse " +
        "schema. Não é o seu arquivo — nada chegou a ser gravado.",
      diagnostico,
    },
  );

/** Tudo o que a tela vai escrever, junto — para conferir o conjunto. */
const naTela = (vista: ReturnType<typeof apresentar>): string =>
  [
    vista.contexto,
    vista.orientacao?.resumo,
    vista.orientacao?.risco.texto,
    vista.orientacao?.acao?.texto,
    vista.orientacao?.acao?.comando,
    vista.orientacao?.evidencia,
    vista.mensagemCrua,
  ]
    .filter(Boolean)
    .join(" ");

describe("apresentar", () => {
  /**
   * **A regressão do caso vivido.** Registro perdido, schema existente, `42710`
   * na `0000`. A tela mostra `migrate:adotar` e mais nada — em particular, não
   * a mensagem crua da rota, que era de onde saía o "suba o servidor de novo".
   */
  it("registro perdido: mostra adotar, e nenhuma segunda recomendação", () => {
    const vista = apresentar(erroDeChamados(REGISTRO_PERDIDO));

    expect(vista.orientacao?.estado).toBe("REGISTRO_PERDIDO");
    expect(vista.orientacao?.acao?.comando).toBe(
      "pnpm --filter @workspace/db run migrate:adotar",
    );
    expect(vista.mensagemCrua).toBeNull();
    expect(vista.mostrarLinkHealthz).toBe(false);

    // O nome do arquivo sobrevive: com vários enviados, "qual deles" é a
    // primeira pergunta de quem lê o aviso.
    expect(vista.contexto).toMatch(/Chamados Camaçari\.xlsx/);

    expect(naTela(vista)).toMatch(/migrate:adotar/);
    expect(naTela(vista)).not.toMatch(/run migrate`/);
    expect(naTela(vista)).not.toMatch(/suba o servidor/i);
  });

  /**
   * A invariante que torna o defeito irrepresentável, em todo caminho que esta
   * função tem: onde há orientação não há mensagem crua, e vice-versa.
   */
  it("orientação e mensagem crua nunca coexistem", () => {
    const casos: unknown[] = [
      erroDeChamados(REGISTRO_PERDIDO),
      new ApiError("Internal server error", 500),
      new ApiError("Arquivo sem coluna de chamado", 400),
      new ErroDeTransporte(
        diagnosticarTransporte({ status: 502, corpoVazio: true }),
      ),
      new Error("qualquer coisa"),
      new TypeError("Failed to fetch"),
      "um erro que nem é Error",
    ];

    for (const caso of casos) {
      const vista = apresentar(caso);
      expect(vista.orientacao !== null && vista.mensagemCrua !== null).toBe(
        false,
      );
    }
  });

  describe("o eixo do transporte vence o do banco", () => {
    /**
     * **O buraco que faltava fechar.** Um roteador sem ninguém atrás de `/api`
     * não se explica pelo estado do banco — e o `/healthz` pode estar em cache
     * de antes, respondendo sobre migrations. Apresentar `migrate` como
     * resposta a "a API não está no ar" é a mesma contradição de sempre, só que
     * entre camadas.
     */
    it("API ausente não é apresentada com recomendação de banco", () => {
      const vista = apresentar(
        new ErroDeTransporte(
          diagnosticarTransporte({ status: 502, corpoVazio: true }),
        ),
        { diagnostico: PENDENTES },
      );

      expect(vista.orientacao?.estado).toBe("API_AUSENTE");
      expect(vista.orientacao?.acao?.codigo).toBe("RESTABELECER_API");
      expect(naTela(vista)).not.toMatch(/migrate/);
    });

    it("requisição que não completou também ignora o healthz", () => {
      const vista = apresentar(new TypeError("Failed to fetch"), {
        diagnostico: REGISTRO_PERDIDO,
      });

      expect(vista.orientacao?.estado).toBe("SEM_RESPOSTA");
      expect(naTela(vista)).not.toMatch(/migrate:adotar/);
      expect(vista.mensagemCrua).toBeNull();
    });

    it("resposta que não é nossa não vira diagnóstico de banco", () => {
      const vista = apresentar(
        new ErroDeTransporte(
          diagnosticarTransporte({
            status: 200,
            corpoNaoJson: "<!doctype html><h1>504 Gateway Timeout</h1>",
          }),
        ),
        { diagnostico: REGISTRO_PERDIDO },
      );

      expect(vista.orientacao?.estado).toBe("RESPOSTA_ESTRANHA");
      expect(vista.orientacao?.evidencia).toMatch(/504 Gateway Timeout/);
      expect(naTela(vista)).not.toMatch(/migrate/);
    });
  });

  it("erro não tipado cai no fallback: mensagem crua e o link do healthz", () => {
    const vista = apresentar(new ApiError("Internal server error", 500));

    expect(vista.orientacao).toBeNull();
    expect(vista.mensagemCrua).toBe("Internal server error");
    expect(vista.mostrarLinkHealthz).toBe(true);
  });

  it("erro que nem é Error também é apresentável", () => {
    const vista = apresentar("caiu");

    expect(vista.mensagemCrua).toBe("caiu");
    expect(vista.orientacao).toBeNull();
  });

  it("sem diagnóstico no erro, o do /healthz vale", () => {
    const vista = apresentar(new ApiError("Internal server error", 500), {
      diagnostico: REGISTRO_PERDIDO,
    });

    expect(vista.orientacao?.estado).toBe("REGISTRO_PERDIDO");
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

    expect(vista.orientacao).toBeNull();
    expect(vista.mensagemCrua).toBe("Internal server error");
  });

  it("o diagnóstico do próprio erro tem prioridade sobre o do /healthz", () => {
    const vista = apresentar(erroDeChamados(REGISTRO_PERDIDO), {
      diagnostico: SAUDAVEL,
    });

    expect(vista.orientacao?.estado).toBe("REGISTRO_PERDIDO");
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
    expect(vista.orientacao).toBeNull();
    expect(vista.mensagemCrua).toBe("erro");
  });
});
