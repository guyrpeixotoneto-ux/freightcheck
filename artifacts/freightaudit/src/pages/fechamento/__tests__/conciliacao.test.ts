import { describe, expect, it } from "vitest";
import { referenciaDoMes, temColunaDaPlanilha } from "../conciliacao";
import type { CanalDoResumo, ProcedenciaDaReferencia } from "@/lib/fechamento";

/**
 * A CONCILIAÇÃO SEM PLANILHA — o estado normal desta tela, e o que ela afirma nele.
 *
 * As duas regras testadas aqui decidem a mesma coisa por caminhos diferentes:
 * *já existe régua contra a qual medir?* Errar para o lado do "sim" abre colunas
 * de traços que dizem que a planilha não publica nada; errar para o lado do
 * "não" esconde a conferência que alguém acabou de anexar.
 */

const REFERENCIA: ProcedenciaDaReferencia = {
  id: "r1",
  versao: 1,
  nomeDoArquivo: "Fechamento_Remuneracao.xlsb",
  sha256: "3e479c584f32aaaabbbbccccddddeeeeffff0000111122223333444455556666",
  anexadaPor: null,
  anexadaEm: "2026-08-21T13:40:23.000Z",
};

/** Um canal com painel comparado, e só o que estas duas regras leem dele. */
function canal(
  nome: string,
  comparado: { referencia: ProcedenciaDaReferencia | null } | null,
): CanalDoResumo {
  return { canal: nome, comparado } as unknown as CanalDoResumo;
}

/**
 * O caso do meio é o que motivou extrair a regra: durante um deploy, um servidor
 * antigo devolve o painel **sem** o campo. `!== null` daria `true` ali e a tela
 * abriria colunas de traços, dizendo que a planilha não publica nada.
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

/**
 * É **um** anexo por mês, e não um por canal — e é isso que a função afirma.
 *
 * O mês tem dois canais e os dois são conferidos contra o mesmo arquivo: quem
 * anexa declara o fechamento, não o canal. Procurar "a referência do canal"
 * sugeriria que pode haver duas, e a tela teria de escolher uma em silêncio.
 */
describe("referenciaDoMes", () => {
  it("acha a régua no canal que tem painel comparado", () => {
    expect(referenciaDoMes([canal("ROTA", { referencia: REFERENCIA })])).toEqual(REFERENCIA);
  });

  it("atravessa o canal sem comparado até o que tem a régua", () => {
    const canais = [canal("AS", null), canal("ROTA", { referencia: REFERENCIA })];
    expect(referenciaDoMes(canais)).toEqual(REFERENCIA);
  });

  it("sem nenhum arquivo anexado devolve null, e não um objeto vazio", () => {
    expect(referenciaDoMes([canal("ROTA", { referencia: null })])).toBeNull();
  });

  it("mês sem canal nenhum não tem régua — e não estoura", () => {
    expect(referenciaDoMes([])).toBeNull();
  });
});
