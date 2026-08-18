import { describe, expect, it } from "vitest";
import { resumir } from "../resumo";
import type {
  ApuracaoDaDRE,
  CoberturaDaDRE,
  LinhaDaDRE,
  SecaoDaDRE,
  SecaoId,
  SubtotalDaDRE,
} from "../tipos";

/**
 * O resumo tem uma obrigação só, e é aritmética: os três números que ele mostra
 * têm de ser os mesmos três da linha do ranking de onde a pessoa clicou.
 *
 * O ranking os tira dos subtotais (`lib/dre/src/frota.ts`): receita é o parcial
 * de RECEITA_BRUTA, resultado é o parcial de RESULTADO_ECONOMICO, e custo é a
 * diferença. O resumo os tira das linhas. Os testes abaixo montam a apuração com
 * as duas coisas dentro e conferem que os dois caminhos chegam ao mesmo lugar —
 * é a única forma de a tela não passar a ter duas versões do mesmo número.
 */

function linha(
  code: string,
  secao: SecaoId,
  valor: number | null,
  essencial = false,
): LinhaDaDRE {
  const sinal = secao === "RECEITA_BRUTA" ? 1 : -1;
  return {
    code,
    titulo: code,
    secao,
    sinal,
    escopo: "CONJUNTO",
    valor,
    natureza: valor === null ? "NAO_DISPONIVEL" : "OBSERVADO",
    contribuicao: valor === null ? null : Number((valor * sinal).toFixed(2)),
    percentualDaReceita: null,
    origens: [],
    ausencia:
      valor === null
        ? { motivo: "COLUNA_SEM_DADO", rotulo: "sem dado", oQueFalta: "a coluna veio vazia" }
        : null,
    essencial,
    evidencia: "",
  };
}

const TITULO_DA_SECAO: Record<SecaoId, string> = {
  RECEITA_BRUTA: "Receita bruta",
  DEDUCOES: "(−) Deduções",
  CUSTO_VARIAVEL: "(−) Custos variáveis",
  CUSTO_FIXO: "(−) Custos fixos do veículo",
  DEPRECIACAO_FINANCEIRO: "(−) Depreciação e financeiro",
};

/** Só o que `resumir` lê: seções com linhas, e a cobertura para contar o que falta. */
function apuracao(linhas: LinhaDaDRE[]): ApuracaoDaDRE {
  const ids = Object.keys(TITULO_DA_SECAO) as SecaoId[];
  const secoes: SecaoDaDRE[] = ids.map((id) => ({
    id,
    titulo: TITULO_DA_SECAO[id],
    nota: "",
    linhas: linhas.filter((l) => l.secao === id),
    total: null,
    fecha: "RESULTADO_ECONOMICO",
  }));

  const cobertura: CoberturaDaDRE = {
    aplicaveis: linhas.length,
    apurados: linhas.filter((l) => l.valor !== null).length,
    percentual: 0,
    essenciaisAplicaveis: 0,
    essenciaisApurados: 0,
    percentualEssencial: 0,
    itens: linhas.map((l) => ({
      code: l.code,
      titulo: l.titulo,
      secao: l.secao,
      essencial: l.essencial,
      apurado: l.valor !== null,
      motivo: l.ausencia?.motivo ?? null,
      rotulo: l.ausencia?.rotulo ?? null,
    })),
    metodo: "",
  };

  return {
    escopo: "CONJUNTO",
    competencia: "2025-07",
    effectiveDate: "2025-07-01",
    periodLabel: "julho/2025",
    identidade: [],
    secoes,
    subtotais: [] as SubtotalDaDRE[],
    cobertura,
    estado: "PARCIALMENTE_APURADA",
    aguardandoCuradoria: [],
  };
}

describe("resumir", () => {
  const LINHAS = [
    linha("RECEITA_FIXA", "RECEITA_BRUTA", 18_000),
    linha("RECEITA_VARIAVEL", "RECEITA_BRUTA", 1_213.13),
    linha("ICMS", "DEDUCOES", 2_305.58),
    linha("MANUTENCAO", "CUSTO_VARIAVEL", 6_400),
    linha("SEGURO", "CUSTO_FIXO", 4_229.34),
    linha("DEPRECIACAO", "DEPRECIACAO_FINANCEIRO", 7_000),
    linha("DIESEL", "CUSTO_VARIAVEL", null, true),
  ];

  it("soma a receita pelas linhas da receita bruta", () => {
    expect(resumir(apuracao(LINHAS)).receita).toBe(19_213.13);
  });

  it("soma o custo por tudo o que não é receita, com o sinal desfeito", () => {
    expect(resumir(apuracao(LINHAS)).custo).toBe(19_934.92);
  });

  it("fecha a conta: resultado é receita menos custo", () => {
    const r = resumir(apuracao(LINHAS));
    expect(r.resultado).toBe(-721.79);
    expect(Number((r.receita - r.custo).toFixed(2))).toBe(r.resultado);
  });

  it("chega ao mesmo resultado que a soma assinada de todas as linhas", () => {
    /*
      O caminho do motor (`somarSecoes` sobre RESULTADO_ECONOMICO) é somar as
      contribuições de todas as seções. Se este teste cair, o resumo passou a
      contar alguma linha duas vezes, ou a perder uma.
    */
    const assinada = LINHAS.reduce((s, l) => s + (l.contribuicao ?? 0), 0);
    expect(resumir(apuracao(LINHAS)).resultado).toBe(Number(assinada.toFixed(2)));
  });

  it("calcula a margem sobre a receita bruta", () => {
    expect(resumir(apuracao(LINHAS)).margem).toBeCloseTo(-3.757, 3);
  });

  it("ordena os componentes do maior para o menor", () => {
    expect(resumir(apuracao(LINHAS)).itensDoCusto.map((i) => i.code)).toEqual([
      "DEPRECIACAO",
      "MANUTENCAO",
      "SEGURO",
      "ICMS",
    ]);
  });

  it("dá a fatia de cada componente dentro do seu grupo", () => {
    const r = resumir(apuracao(LINHAS));
    expect(r.itensDaReceita[0]!.fatia).toBeCloseTo(93.686, 3);
    expect(r.itensDoCusto[0]!.fatia).toBeCloseTo(35.11, 2);
  });

  it("conta as linhas sem dado separando receita de custo", () => {
    const r = resumir(apuracao(LINHAS));
    expect(r.custoSemDado).toBe(1);
    expect(r.receitaSemDado).toBe(0);
  });

  it("não divide por zero quando não há receita", () => {
    const r = resumir(apuracao([linha("MANUTENCAO", "CUSTO_VARIAVEL", 500)]));
    expect(r.receita).toBe(0);
    expect(r.margem).toBeNull();
    expect(r.itensDoCusto[0]!.fatia).toBeCloseTo(100, 5);
    expect(r.resultado).toBe(-500);
  });

  it("devolve listas vazias quando nenhuma linha tem valor", () => {
    const r = resumir(apuracao([linha("DIESEL", "CUSTO_VARIAVEL", null, true)]));
    expect(r.itensDaReceita).toEqual([]);
    expect(r.itensDoCusto).toEqual([]);
    expect(r.resultado).toBe(0);
  });
});
