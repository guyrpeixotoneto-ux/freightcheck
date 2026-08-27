import { describe, expect, it } from "vitest";
import { veiculosDistintos } from "../dashboard";
import type { ChangeGroup } from "@/components/inicio/types";

/**
 * "42 veículos impactados" ao lado de "91 veículos afetados".
 *
 * Os dois números estavam na mesma tela, com a mesma palavra, e mediam coisas
 * diferentes: 91 era `totals.vehiclesTouched`, ativos distintos contados numa
 * varredura só no servidor; 42 era a soma de `grupo.vehicles` das oito linhas
 * visíveis — o mesmo caminhão contado uma vez por atributo que mudou nele. Um
 * leitor que subtraísse concluiria "faltam 49 veículos", e não faltava nenhum.
 *
 * A união responde a pergunta que o rótulo faz. Este teste prende as três
 * propriedades que a soma não tinha: idempotência sobre repetição, limite
 * superior na frota, e recusa em responder quando falta a identidade.
 */

const grupo = (vehicles: number, entityIds: string[] | undefined): ChangeGroup =>
  ({ vehicles, entityIds }) as unknown as ChangeGroup;

describe("veiculosDistintos", () => {
  it("conta o mesmo veículo uma vez, mesmo em várias alterações", () => {
    const grupos = [
      grupo(3, ["v1", "v2", "v3"]),
      grupo(3, ["v2", "v3", "v4"]),
      grupo(2, ["v1", "v4"]),
    ];

    expect(grupos.reduce((s, g) => s + g.vehicles, 0)).toBe(8); // o que a tela publicava
    expect(veiculosDistintos(grupos)).toBe(4);
  });

  it("nunca passa a frota, por mais atributos que tenham mudado nela", () => {
    const frota = ["v1", "v2", "v3"];
    const grupos = Array.from({ length: 20 }, () => grupo(frota.length, [...frota]));

    expect(grupos.reduce((s, g) => s + g.vehicles, 0)).toBe(60);
    expect(veiculosDistintos(grupos)).toBe(3);
  });

  it("sem interseção, coincide com a soma — o único caso em que a soma acertava", () => {
    const grupos = [grupo(2, ["v1", "v2"]), grupo(2, ["v3", "v4"])];

    expect(veiculosDistintos(grupos)).toBe(4);
  });

  it("tabela vazia é zero veículos, não uma resposta ausente", () => {
    expect(veiculosDistintos([])).toBe(0);
  });

  it("recusa responder quando um grupo chega sem a identidade dos ativos", () => {
    /*
      Resposta de uma versão anterior da API, ainda em cache. Uma união parcial
      subestimaria em silêncio — e um número menor que o certo, com o rótulo
      "veículos distintos", é pior do que a tela dizer que não sabe.
    */
    expect(veiculosDistintos([grupo(3, ["v1", "v2", "v3"]), grupo(2, undefined)])).toBeNull();
    expect(veiculosDistintos([grupo(2, undefined)])).toBeNull();
  });

  it("é um subconjunto do total da vigência, nunca o contrário", () => {
    const daVigencia = new Set(["v1", "v2", "v3", "v4", "v5"]);
    const exibidos = [grupo(2, ["v1", "v2"]), grupo(2, ["v2", "v3"])];

    const distintos = veiculosDistintos(exibidos);
    expect(distintos).not.toBeNull();
    expect(distintos!).toBeLessThanOrEqual(daVigencia.size);
    expect(exibidos.every((g) => g.entityIds.every((id) => daVigencia.has(id)))).toBe(true);
  });
});
