import { describe, expect, it } from "vitest";
import { motivoDoVazio, quinzenaExiste, temColunaDaPlanilha } from "../resumo";

/**
 * O Resumo geral sem números — e as duas razões que ele confundia numa só.
 *
 * `lerResumoDoMes` devolve **sempre** as duas quinzenas do mês, "existam elas
 * ou não": a que ninguém abriu vem com `competenciaId` nulo. A tela procurava a
 * quinzena com um `find`, achava esse esqueleto, e o lia como uma competência
 * de verdade — o ramo "competência não aberta" era código morto, e um mês em
 * que nada tinha sido aberto se anunciava como "importada, ainda não apurada".
 *
 * A frase errada não é um detalhe de redação: ela manda procurar uma apuração
 * que não tem onde acontecer, e esconde a causa real — que, desde a `0046`, é
 * quase sempre o Tipo. Todo fechamento aberto antes daquela migration carrega
 * `NAO_INFORMADO`, e quem escolhe Empurrada ou Rota não alcança nenhum deles.
 */

const ABERTA = { quinzena: 1 as const, competenciaId: "c1" };
const NAO_ABERTA = { quinzena: 2 as const, competenciaId: null };

describe("quinzenaExiste", () => {
  it("é a competência no banco, e não a linha que a resposta sempre traz", () => {
    expect(quinzenaExiste(ABERTA)).toBe(true);
    expect(quinzenaExiste(NAO_ABERTA)).toBe(false);
  });

  it("trata a quinzena ausente da lista como inexistente, e não estoura", () => {
    expect(quinzenaExiste(undefined)).toBe(false);
  });
});

describe("motivoDoVazio", () => {
  it("sem nenhuma competência, o que falta é abrir — ou trocar o Tipo", () => {
    expect(motivoDoVazio([NAO_ABERTA, { quinzena: 1, competenciaId: null }])).toBe(
      "SEM_COMPETENCIA",
    );
  });

  it("com uma competência aberta, o que falta é apurar", () => {
    expect(motivoDoVazio([ABERTA, NAO_ABERTA])).toBe("SEM_APURACAO");
  });

  it("uma quinzena basta: meio mês aberto já é um mês que existe", () => {
    expect(motivoDoVazio([NAO_ABERTA, { quinzena: 1, competenciaId: "c2" }])).toBe(
      "SEM_APURACAO",
    );
  });
});

/**
 * A coluna da planilha — e as três ausências que ela precisa distinguir.
 *
 * O caso do meio é o que motivou extrair a regra: durante um deploy, um servidor
 * antigo devolve o painel sem o campo. `!== null` daria `true` ali e a tela
 * abriria duas colunas de traços, dizendo que a planilha não publica nada.
 */
describe("temColunaDaPlanilha", () => {
  it("com referência anexada, a coluna aparece", () => {
    expect(temColunaDaPlanilha({ referencia: { id: "r1", versao: 1 } })).toBe(true);
  });

  it("sem referência, a coluna não aparece — e esse é o estado normal", () => {
    expect(temColunaDaPlanilha({ referencia: null })).toBe(false);
  });

  it("campo ausente é tratado como sem referência, e não como presente", () => {
    expect(temColunaDaPlanilha({})).toBe(false);
    expect(temColunaDaPlanilha({ referencia: undefined })).toBe(false);
  });
});
