import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  JanelaInvalidaError,
  aplicarJanela,
  contextFilter,
  type ContextInfo,
} from "../series";

/**
 * O recorte De/Até — o que estes casos protegem.
 *
 * Não é o filtro em si: é a promessa de que ele **é do contexto**, e não de uma
 * tela. Quem lê Impacto e quem lê Cliente têm de estar olhando para o mesmo
 * período, e a única forma de garantir isso sem confiar em ninguém é o recorte
 * viajar dentro do contexto resolvido até `contextFilter`, que é o predicado
 * por onde toda consulta de leitura passa.
 *
 * O outro grupo de casos é sobre recusar: uma ponta que não existe, aparada em
 * silêncio, produziria o número certo sob o título errado — que é a categoria
 * de erro que este produto inteiro evita.
 */

const VIGENCIAS = [
  "2025-12-02",
  "2026-01-02",
  "2026-02-02",
  "2026-03-02",
  "2026-04-02",
];

const contexto = (): ContextInfo => ({
  scopeHash: "abc",
  channel: "EMPURRADA",
  label: "CAMAÇARI · EMPURRADA",
  scopes: [],
  latestPeriod: VIGENCIAS[VIGENCIAS.length - 1],
  periods: VIGENCIAS.length,
  periodosDisponiveis: [...VIGENCIAS],
  periodosNaJanela: VIGENCIAS.length,
  janela: null,
});

/** O SQL que o predicado gera, com os parâmetros ao lado. */
function comoSql(context: ContextInfo) {
  return new PgDialect().sqlToQuery(contextFilter("s", context));
}

describe("aplicarJanela", () => {
  it("sem pedido, é a série inteira", () => {
    const c = aplicarJanela(contexto(), null);
    expect(c.janela).toBeNull();
    expect(c.periodosNaJanela).toBe(5);
  });

  it("recorta e conta quantas vigências sobraram", () => {
    const c = aplicarJanela(contexto(), { de: "2026-01-02", ate: "2026-03-02" });
    expect(c.janela).toEqual({ de: "2026-01-02", ate: "2026-03-02" });
    expect(c.periodosNaJanela).toBe(3);
  });

  it("aceita meia janela e completa a outra ponta com o extremo da série", () => {
    // "De março para cá" é um pedido legítimo, e exigir as duas pontas
    // transformaria um filtro útil num formulário.
    const daqui = aplicarJanela(contexto(), { de: "2026-03-02" });
    expect(daqui.janela).toEqual({ de: "2026-03-02", ate: "2026-04-02" });
    expect(daqui.periodosNaJanela).toBe(2);

    const ate = aplicarJanela(contexto(), { ate: "2026-01-02" });
    expect(ate.janela).toEqual({ de: "2025-12-02", ate: "2026-01-02" });
  });

  it("não muda `periods`, que é o tamanho do histórico", () => {
    // Várias telas escrevem "N vigências no histórico". Se o número encolhesse
    // ao filtrar, a frase deixaria de ser verdadeira sem ninguém perceber.
    const c = aplicarJanela(contexto(), { de: "2026-04-02" });
    expect(c.periods).toBe(5);
    expect(c.periodosNaJanela).toBe(1);
  });

  it("recusa uma ponta que não é vigência deste contexto", () => {
    // Aparar para a mais próxima faria a tela responder sobre um período
    // diferente do pedido — o número certo sob o título errado.
    expect(() => aplicarJanela(contexto(), { de: "2026-01-15" })).toThrow(
      JanelaInvalidaError,
    );
    expect(() => aplicarJanela(contexto(), { ate: "2027-01-02" })).toThrow(
      JanelaInvalidaError,
    );
  });

  it("a recusa diz quais vigências existem", () => {
    try {
      aplicarJanela(contexto(), { de: "2026-01-15" });
      expect.unreachable("deveria ter recusado");
    } catch (err) {
      expect((err as Error).message).toContain("2026-01-02");
      expect((err as Error).message).toContain("não é uma vigência deste contexto");
    }
  });

  it("recusa o intervalo invertido", () => {
    expect(() =>
      aplicarJanela(contexto(), { de: "2026-03-02", ate: "2026-01-02" }),
    ).toThrow(/posterior ao fim/);
  });

  it("uma janela de uma vigência só é aceita, e contada como tal", () => {
    // Não é erro: é um recorte legítimo que simplesmente não tem par para
    // comparar, e quem decide o que dizer sobre isso é a tela.
    const c = aplicarJanela(contexto(), { de: "2026-02-02", ate: "2026-02-02" });
    expect(c.periodosNaJanela).toBe(1);
  });
});

describe("contextFilter", () => {
  it("sem janela, filtra unidade, canal e família — e mais nada", () => {
    const { sql, params } = comoSql(contexto());
    expect(sql).toContain("s.scope_hash");
    expect(sql).toContain("s.dataset_family");
    expect(sql).not.toContain("effective_date");
    expect(params).toEqual(["abc", "EMPURRADA", "REMUNERACAO_EQUIPAMENTO"]);
  });

  /*
    A família é a terceira parte do contexto, e o padrão dela é escolhido.

    Um contexto montado à mão — como o desta suíte, e como os de dezenas de
    consultas que só tinham unidade e canal a dizer — fala de equipamento. Foi o
    padrão contrário (nenhuma cláusula, portanto todas as famílias) que deixou a
    vigência do QLP entrar na régua e no seletor do equipamento e fez cavalo e
    carreta sumirem da tela. Ver `familia-de-dataset.test.ts`.
  */
  it("quem nomeia a família lê a dela, e não a de equipamento", () => {
    const { params } = comoSql({ ...contexto(), datasetFamily: "QUADRO_DE_PESSOAL" });
    expect(params).toEqual(["abc", "EMPURRADA", "QUADRO_DE_PESSOAL"]);
  });

  it("com janela, o recorte entra no mesmo predicado", () => {
    /*
      É a garantia central: toda consulta de leitura passa por `contextFilter`,
      então pendurar a janela aqui faz o panorama, a matriz por quinzena e as
      recomendações ao cliente respeitarem o mesmo recorte sem que nenhum deles
      precise saber que ele existe.
    */
    const { sql, params } = comoSql(
      aplicarJanela(contexto(), { de: "2026-01-02", ate: "2026-03-02" }),
    );
    expect(sql).toContain("s.effective_date >=");
    expect(sql).toContain("s.effective_date <=");
    expect(params).toEqual([
      "abc",
      "EMPURRADA",
      "REMUNERACAO_EQUIPAMENTO",
      "2026-01-02",
      "2026-03-02",
    ]);
  });

  it("as duas pontas são inclusivas", () => {
    // `>=` e `<=`, e não `>` e `<`: quem escolhe "até EMPURRADA_2_3_2026"
    // espera que março apareça na tela.
    const { sql } = comoSql(aplicarJanela(contexto(), { de: "2026-01-02" }));
    expect(sql).not.toMatch(/effective_date >[^=]/);
    expect(sql).not.toMatch(/effective_date <[^=]/);
  });
});
