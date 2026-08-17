/**
 * O laudo e o relatório, conferidos sem subir banco.
 *
 * As consultas são testadas contra o export real em
 * `lib/curation/src/__tests__/integridade-semantica.test.ts`, que é onde existe
 * dado de verdade para violar. O que se prova aqui é o resto da autoridade: o
 * veredito de três estados, as duas funções que um portão vai usar, e o texto.
 *
 * O texto é metade do valor do comando — quem lê às duas da manhã precisa saber
 * **qual** atributo, **qual** campo e **quais** os dois valores, ou volta ao
 * banco para descobrir. E a frase que promete não consertar também é conteúdo:
 * o dia em que alguém acrescentar uma bandeira de conserto, este arquivo falha
 * e a conversa acontece antes do commit, não depois de um `UPDATE` calado.
 */
import { describe, expect, it } from "vitest";
import {
  CAMPOS_PROJETADOS,
  comprometidosEntre,
  estaComprometido,
  relatarIntegridadeSemantica,
  type AtributoComprometido,
  type LaudoDeIntegridade,
} from "../integridade-semantica";

const semVersao = (code: string, detalhe: string): AtributoComprometido => ({
  code,
  falhas: [
    { invariante: "SEMANTICA_APLICAVEL", motivo: "SEM_VERSAO", detalhe },
  ],
});

const divergente = (
  code: string,
  campo: string,
  naProjecao: string | null,
  naVersao: string | null,
): AtributoComprometido => ({
  code,
  falhas: [
    {
      invariante: "PROJECAO_CONCORDA",
      campo,
      naProjecao,
      naVersao,
      detalhe: `${campo}: a projeção diz ${naProjecao} e a versão em vigor diz ${naVersao}`,
    },
  ],
});

const emDia: LaudoDeIntegridade = {
  estado: "OK",
  atributos: 138,
  comprometidos: [],
  limitacao: null,
};

const degradado: LaudoDeIntegridade = {
  estado: "DEGRADED",
  atributos: 138,
  comprometidos: [divergente("carreta.custo_fixo", "periodicity", "MENSAL", "ANUAL")],
  limitacao:
    "1 de 138 atributos ficaram de fora por semântica inconsistente " +
    "(carreta.custo_fixo). O que está apurado aqui não os inclui.",
};

describe("os campos que são a mesma verdade", () => {
  it("são os que a projeção copia da versão, e só eles", () => {
    expect([...CAMPOS_PROJETADOS]).toEqual([
      "unit",
      "periodicity",
      "aggregation",
      "is_monetary",
      "taxonomy_node_id",
      "definition",
      "semantics_status",
      "semantics_rationale",
      "confirmed_by",
      "confirmed_at",
    ]);
  });

  it("não incluem o apelido nem a fórmula, que não são projetados", () => {
    // `display_name` não é versionado de propósito; `calculation_basis` só
    // existe na versão. Cobrá-los aqui inventaria divergência em todo banco.
    expect(CAMPOS_PROJETADOS).not.toContain("display_name");
    expect(CAMPOS_PROJETADOS).not.toContain("calculation_basis");
  });
});

describe("as perguntas que um portão faz sobre o laudo", () => {
  /*
    Elas moram aqui, e não em cada consumidor, porque são regra: um portão que
    escrevesse o seu próprio `some(...)` sobre `comprometidos` seria uma segunda
    definição de "atributo confiável", e duas definições divergem.
  */
  it("responde por um atributo", () => {
    expect(estaComprometido(degradado, "carreta.custo_fixo")).toBe(true);
    expect(estaComprometido(degradado, "carreta.ipva")).toBe(false);
    expect(estaComprometido(emDia, "carreta.custo_fixo")).toBe(false);
  });

  it("responde pelo recorte que uma apuração usa, e só por ele", () => {
    // Um banco DEGRADED por causa de colunas que esta apuração não olha não tem
    // por que barrá-la: o portão pergunta pelos códigos dela, não pelo banco.
    expect(comprometidosEntre(degradado, ["carreta.ipva", "cavalo.pneu"])).toEqual([]);
    expect(
      comprometidosEntre(degradado, ["carreta.custo_fixo", "carreta.ipva"]),
    ).toEqual(["carreta.custo_fixo"]);
  });
});

describe("o relatório", () => {
  it("diz OK com o denominador à vista", () => {
    const [linha] = relatarIntegridadeSemantica(emDia);
    expect(linha).toContain("OK");
    expect(linha).toContain("138 atributos");
  });

  it("abre pelo veredito, com quantos de quantos", () => {
    const texto = relatarIntegridadeSemantica(degradado).join("\n");
    expect(texto).toContain("Integridade da semântica: DEGRADED");
    expect(texto).toContain("1 de 138 atributos não sustentam conclusão");
  });

  it("nomeia o atributo, o motivo e as datas de quem não tem versão aplicável", () => {
    const texto = relatarIntegridadeSemantica({
      ...emDia,
      estado: "DEGRADED",
      comprometidos: [
        semVersao(
          "cavalo.combustivel_vida_cavalo",
          "não tem nenhuma linha em attribute_semantics",
        ),
        {
          code: "carreta.ipva",
          falhas: [
            {
              invariante: "SEMANTICA_APLICAVEL",
              motivo: "NAO_COBRE_A_SERIE",
              detalhe:
                "a versão mais antiga começa em 2026-07-01, depois da vigência " +
                "mais antiga (2025-12-02) — a série antes dessa data fica sem semântica",
            },
          ],
        },
      ],
    }).join("\n");

    expect(texto).toContain("cavalo.combustivel_vida_cavalo");
    expect(texto).toContain("[SEM_VERSAO]");
    expect(texto).toContain("carreta.ipva");
    expect(texto).toContain("2026-07-01");
    expect(texto).toContain("2025-12-02");
    // De onde vem a versão que falta, para a conversa não virar adivinhação.
    expect(texto).toContain("0025_semantica_inicial");
  });

  it("mostra os dois valores de cada campo divergente", () => {
    const texto = relatarIntegridadeSemantica({
      ...emDia,
      estado: "DEGRADED",
      comprometidos: [
        {
          code: "carreta.custo_fixo",
          falhas: [
            ...divergente("carreta.custo_fixo", "periodicity", "MENSAL", "ANUAL")
              .falhas,
            ...divergente("carreta.custo_fixo", "aggregation", "SUM", null).falhas,
          ],
        },
      ],
    }).join("\n");

    // Um campo por linha: "custo_fixo diverge" não é acionável.
    expect(texto).toContain(
      'carreta.custo_fixo.periodicity: projeção="MENSAL" versão="ANUAL"',
    );
    // Vazio dito como vazio, e não como a palavra "null".
    expect(texto).toContain("versão=(vazio)");
    // 2 campos, 1 atributo — a contagem não confunde os dois.
    expect(texto).toContain("2 em 1 atributo(s)");
    expect(texto).toMatch(/telas leem a projeção e a comparação soma pela versão/);
  });

  it("fecha com a limitação que o consumidor teria de declarar", () => {
    const texto = relatarIntegridadeSemantica(degradado).join("\n");
    expect(texto).toContain("O que está apurado aqui não os inclui");
  });

  it("promete não consertar, e diz o que fazer no lugar", () => {
    const texto = relatarIntegridadeSemantica(degradado).join("\n");
    expect(texto).toContain("Nada foi corrigido");
    expect(texto).toContain("não há bandeira que corrija");
    // A saída existe e é nomeada: correção com justificativa e registro.
    expect(texto).toContain("correctSemantics");
  });

  it("cala sobre o que não aconteceu", () => {
    const texto = relatarIntegridadeSemantica(degradado).join("\n");
    expect(texto).not.toContain("Sem versão de semântica aplicável");
  });
});
