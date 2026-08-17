/**
 * O relatório das duas invariantes, conferido sem subir banco.
 *
 * A consulta é testada contra o export real em
 * `lib/curation/src/__tests__/integridade-semantica.test.ts`, que é onde existe
 * dado de verdade para violar. O que se prova aqui é o texto — e ele é metade
 * do valor do comando: quem lê às duas da manhã precisa saber **qual** atributo,
 * **qual** campo e **quais** os dois valores, ou volta ao banco para descobrir.
 *
 * A frase que promete não consertar também é conteúdo, e está travada abaixo:
 * o dia em que alguém acrescentar uma bandeira de conserto, este teste falha e
 * a conversa acontece antes do commit, e não depois de um `UPDATE` calado.
 */
import { describe, expect, it } from "vitest";
import {
  CAMPOS_PROJETADOS,
  integridadeEmDia,
  relatarIntegridadeSemantica,
  type IntegridadeSemantica,
} from "../integridade-semantica";

const emDia: IntegridadeSemantica = {
  semSemanticaAplicavel: [],
  divergencias: [],
  atributos: 138,
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

describe("o relatório", () => {
  it("diz que está em dia com o denominador à vista", () => {
    expect(integridadeEmDia(emDia)).toBe(true);
    const [linha] = relatarIntegridadeSemantica(emDia);
    expect(linha).toContain("138 atributos");
    expect(linha).toMatch(/em dia/i);
  });

  it("nomeia o atributo, o motivo e as datas de quem não tem versão aplicável", () => {
    const texto = relatarIntegridadeSemantica({
      ...emDia,
      semSemanticaAplicavel: [
        {
          code: "cavalo.combustivel_vida_cavalo",
          motivo: "SEM_VERSAO",
          detalhe: "não tem nenhuma linha em attribute_semantics",
        },
        {
          code: "carreta.ipva",
          motivo: "NAO_COBRE_A_SERIE",
          detalhe:
            "a versão mais antiga começa em 2026-07-01, depois da vigência mais " +
            "antiga (2025-12-02) — a série antes dessa data fica sem semântica",
        },
      ],
    }).join("\n");

    expect(texto).toContain("cavalo.combustivel_vida_cavalo");
    expect(texto).toContain("[SEM_VERSAO]");
    expect(texto).toContain("carreta.ipva");
    expect(texto).toContain("2026-07-01");
    expect(texto).toContain("2025-12-02");
    // Quantos, e de quantos: "2" sozinho não diz se o banco está quase são.
    expect(texto).toContain("2 de 138");
    // E de onde vem a versão que falta, para a conversa não virar adivinhação.
    expect(texto).toContain("0025_semantica_inicial");
  });

  it("mostra os dois valores de cada campo divergente", () => {
    const texto = relatarIntegridadeSemantica({
      ...emDia,
      divergencias: [
        {
          code: "carreta.custo_fixo",
          campo: "periodicity",
          naProjecao: "MENSAL",
          naVersao: "ANUAL",
        },
        {
          code: "carreta.custo_fixo",
          campo: "aggregation",
          naProjecao: "SUM",
          naVersao: null,
        },
      ],
    }).join("\n");

    // Um campo por linha: "custo_fixo diverge" não é acionável.
    expect(texto).toContain('carreta.custo_fixo.periodicity: projeção="MENSAL" versão="ANUAL"');
    // Vazio dito como vazio, e não como a palavra "null".
    expect(texto).toContain("versão=(vazio)");
    // 2 campos, 1 atributo — a contagem não confunde os dois.
    expect(texto).toContain("2 em 1 atributo(s)");
    // Por que isso importa, em uma frase: as telas leem uma, o dinheiro é
    // somado pela outra.
    expect(texto).toMatch(/telas leem a projeção e a comparação soma pela versão/);
  });

  it("promete não consertar, e diz o que fazer no lugar", () => {
    const texto = relatarIntegridadeSemantica({
      ...emDia,
      divergencias: [
        { code: "x.y", campo: "unit", naProjecao: "BRL", naVersao: null },
      ],
    }).join("\n");

    expect(texto).toContain("Nada foi corrigido");
    expect(texto).toContain("não há bandeira que corrija");
    // A saída existe e é nomeada: correção com justificativa e registro.
    expect(texto).toContain("correctSemantics");
  });

  it("cala sobre o que não aconteceu", () => {
    const so = relatarIntegridadeSemantica({
      ...emDia,
      divergencias: [
        { code: "x.y", campo: "unit", naProjecao: "BRL", naVersao: null },
      ],
    }).join("\n");
    expect(so).not.toContain("sem versão de semântica aplicável");
    expect(integridadeEmDia(emDia)).toBe(true);
  });
});
