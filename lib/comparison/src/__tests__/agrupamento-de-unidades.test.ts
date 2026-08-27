import { describe, expect, it } from "vitest";
import {
  agruparPorCanal,
  agruparPorUnidade,
  canalAmbiguo,
  chaveDaUnidade,
  conjuntoDeEntradas,
  type ContextoAgrupavel,
} from "../agrupamento-de-unidades";

/**
 * A régua que decide quais unidades entram num consolidado — agora usada nos
 * dois lados.
 *
 * Estas funções eram privadas de `families-view-overview.ts` e só tinham
 * cobertura indireta, pelas suítes que exercitam a Visão Geral contra um banco.
 * Saíram para um módulo próprio porque o Radar de Alterações passou a aplicar a
 * mesma régua no navegador (ver `pages/gestao-a-vista.tsx`), e uma régua com
 * dois chamadores precisa de teste direto: é ela que decide o que **não** entra
 * num número financeiro.
 */
function ctx(
  scopeHash: string,
  channel: string | null,
  escopos: Record<string, string>,
  label = scopeHash,
): ContextoAgrupavel {
  return {
    scopeHash,
    channel,
    label,
    scopes: Object.entries(escopos).map(([scopeType, code]) => ({ scopeType, code })),
  };
}

describe("chaveDaUnidade", () => {
  it("é o código do escopo UNIDADE, e não o scopeHash", () => {
    // O scopeHash já mistura REGIONAL/OPERADOR/canal: dois contextos da mesma
    // unidade têm hashes diferentes e precisam cair na mesma linha.
    expect(chaveDaUnidade(ctx("hash-1", "EMPURRADA", { UNIDADE: "U1", OPERADOR: "OP" }))).toBe("U1");
    expect(chaveDaUnidade(ctx("hash-2", "PUXADA", { UNIDADE: "U1" }))).toBe("U1");
  });

  it("sem escopo UNIDADE, cai no scopeHash em vez de ficar sem chave", () => {
    expect(chaveDaUnidade(ctx("hash-3", null, { REGIONAL: "NE" }))).toBe("hash-3");
  });
});

describe("agruparPorUnidade", () => {
  it("junta os contextos da mesma unidade, mesmo em canais diferentes", () => {
    const grupos = agruparPorUnidade([
      ctx("a", "EMPURRADA", { UNIDADE: "U1" }),
      ctx("b", "PUXADA", { UNIDADE: "U1" }),
      ctx("c", "EMPURRADA", { UNIDADE: "U2" }),
    ]);
    expect([...grupos.keys()].sort()).toEqual(["U1", "U2"]);
    expect(grupos.get("U1")).toHaveLength(2);
  });

  it("devolve o mesmo tipo que recebeu, com os campos de quem chamou", () => {
    // A genérica existe para servidor e tela não precisarem de cast: cada um
    // recupera o seu próprio tipo de contexto do outro lado do agrupamento.
    const comExtra = [{ ...ctx("a", null, { UNIDADE: "U1" }), periodosDisponiveis: ["2026-01"] }];
    const grupo = agruparPorUnidade(comExtra).get("U1");
    expect(grupo?.[0].periodosDisponiveis).toEqual(["2026-01"]);
  });
});

describe("canalAmbiguo", () => {
  it("dois contextos elegíveis no mesmo canal tornam a unidade ambígua", () => {
    const ambiguo = canalAmbiguo([
      ctx("a", "EMPURRADA", { UNIDADE: "U1" }),
      ctx("b", "EMPURRADA", { UNIDADE: "U1", OPERADOR: "OP" }),
    ]);
    expect(ambiguo).toHaveLength(2);
  });

  it("canais diferentes continuam somáveis — não é ambiguidade", () => {
    expect(
      canalAmbiguo([
        ctx("a", "EMPURRADA", { UNIDADE: "U1" }),
        ctx("b", "PUXADA", { UNIDADE: "U1" }),
      ]),
    ).toBeUndefined();
  });

  it("canal nulo é um canal — dois nulos colidem entre si", () => {
    expect(
      canalAmbiguo([ctx("a", null, { UNIDADE: "U1" }), ctx("b", null, { UNIDADE: "U1" })]),
    ).toHaveLength(2);
  });

  it("um contexto por canal nunca é ambíguo", () => {
    expect(canalAmbiguo([ctx("a", "EMPURRADA", { UNIDADE: "U1" })])).toBeUndefined();
  });
});

describe("agruparPorCanal e conjuntoDeEntradas", () => {
  it("agrupa pelo canal, com o nulo numa chave própria", () => {
    const porCanal = agruparPorCanal([
      ctx("a", "EMPURRADA", { UNIDADE: "U1" }),
      ctx("b", null, { UNIDADE: "U1" }),
    ]);
    expect(porCanal.get("EMPURRADA")).toHaveLength(1);
    expect(porCanal.get("")).toHaveLength(1);
  });

  it("as entradas do escopo distinguem código, e não só tipo", () => {
    // Dois contextos com os mesmos *tipos* de escopo e operadores diferentes
    // são irmãos, não um fatia do outro.
    expect([...conjuntoDeEntradas(ctx("a", null, { UNIDADE: "U1", OPERADOR: "OP1" }))].sort()).toEqual([
      "OPERADOR:OP1",
      "UNIDADE:U1",
    ]);
    expect(conjuntoDeEntradas(ctx("a", null, { UNIDADE: "U1", OPERADOR: "OP1" }))).not.toEqual(
      conjuntoDeEntradas(ctx("b", null, { UNIDADE: "U1", OPERADOR: "OP2" })),
    );
  });
});
