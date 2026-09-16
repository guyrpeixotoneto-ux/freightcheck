import { describe, expect, it } from "vitest";
import { formamParDeVigencias } from "../recorte-de-rubrica";

/**
 * A CASCA DE TRECHO NÃO PODE SER A ANTERIOR DE UMA VIGÊNCIA DE EQUIPAMENTO.
 *
 * O acervo entrega o arquivo de trecho como vigência **separada**, com
 * `entity_type_set = 'TRECHO'` — é a "casca" que `listContexts`, a Visão
 * Gerencial e o Radar já tratam à parte. Ela convive, na mesma unidade e no
 * mesmo canal, com as vigências de equipamento.
 *
 * Enquanto a régua de par era igualdade de cobertura, as duas séries não se
 * viam: trecho com trecho, equipamento com equipamento. Ao trocar a igualdade
 * por "algum tipo em comum" (16/09/2026), abriu-se um caminho que não existia:
 * uma vigência `CARRETA+CAVALO+TRECHO` tem trecho em comum com a casca, então a
 * casca passaria a ser candidata a anterior dela — e, sendo mais recente que a
 * vigência de equipamento de verdade, **ganharia**.
 *
 * O resultado seria uma comparação de equipamento cuja interseção é só trecho:
 * zero alterações de cavalo num mês em que houve. É o defeito que a correção
 * veio consertar, com o sinal trocado.
 *
 * A régua certa tem dois degraus: as coberturas têm de se cruzar **e** têm de
 * ser do mesmo grão. Quem cobre equipamento só se compara com quem cobre
 * equipamento.
 */
const PERNAMBUCO = "scope-pe";

const v = (id: string, effectiveDate: string, entityTypeSet: string) => ({
  id,
  effectiveDate,
  entityTypeSet,
  scopeHash: PERNAMBUCO,
});

describe("o grão do par", () => {
  const equipamentoJulho = v("jul-eq", "2026-07-16", "CARRETA+CAVALO");
  const cascaDeTrecho = v("ago-trecho", "2026-08-01", "TRECHO");
  const equipamentoAgosto = v("ago-eq", "2026-08-16", "CARRETA+CAVALO+TRECHO");

  it("não forma par entre equipamento e a casca de trecho", () => {
    expect(formamParDeVigencias(cascaDeTrecho, equipamentoAgosto)).toBe(false);
    expect(formamParDeVigencias(cascaDeTrecho, equipamentoJulho)).toBe(false);
  });

  it("continua formando par entre as duas de equipamento", () => {
    expect(formamParDeVigencias(equipamentoJulho, equipamentoAgosto)).toBe(true);
  });

  it("duas cascas de trecho continuam se comparando entre si", () => {
    const outraCasca = v("set-trecho", "2026-09-01", "TRECHO");
    expect(formamParDeVigencias(cascaDeTrecho, outraCasca)).toBe(true);
  });
});
