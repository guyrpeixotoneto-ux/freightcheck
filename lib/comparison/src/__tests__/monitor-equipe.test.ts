import { describe, expect, it } from "vitest";
import {
  MODULO_DO_CARGO,
  ROTA_DO_QUADRO,
  SITUACOES_DA_EQUIPE,
  consolidarEquipe,
  normalizarLinhasDeEquipe,
  quadroDoMonitor,
  resumirModulosDeEquipe,
  rotaDoModuloDeEquipe,
  situacaoDaLinhaDeEquipe,
  type ParDoMonitorDeEquipe,
} from "../monitor-equipe";
import {
  SEM_IMPACTO_FINANCEIRO,
  linhasDeQlpComparado,
  modulosDoQlp,
  movimentoDoEfetivo,
  type AlteracaoDoMotor,
} from "../qlp-comparacao";

/**
 * O que estes testes prendem.
 *
 * O Monitor Equipe não calcula nada: ele compõe o que a comparação por cargo
 * publicou. Um teste que verificasse os números dele contra si mesmo provaria
 * só que ele é consistente com a própria aritmética — então o que se prende
 * aqui é a **reconciliação** com a origem, e as recusas que a seção Equipe
 * carrega desde a aba do Quadro:
 *
 * 1. **nenhum número financeiro nasce aqui**, e a frase do travamento é a mesma
 *    de `qlp-comparacao.ts`, não uma segunda redação dela;
 * 2. o movimento do efetivo é `movimentoDoEfetivo`, campo a campo — e sai dos
 *    **totais das duas pontas**, nunca da lista de alterações;
 * 3. as quatro situações **particionam** a lista, sem resto e sem sobreposição;
 * 4. entrada e saída de cargo não viram rubrica, e o endereço delas é o do
 *    quadro;
 * 5. um cargo tocado em dois módulos conta **uma vez** no consolidado.
 *
 * Sem banco, como os recortes que ele compõe: alterações do motor construídas à
 * mão.
 */

const ADM = (slug: string) => `qlp_administrativo.${slug}`;
const CARGO = "07526557001505CARGOANALISTA";
const OUTRO = "07526557001505CARGOGERENTE";

const PAR: ParDoMonitorDeEquipe = {
  quadro: "ADMINISTRATIVO",
  baseId: "a1",
  comparadaId: "b2",
  baseRotulo: "QLP_ADM_1_08_2026",
  comparadaRotulo: "QLP_ADM_2_08_2026",
  baseData: "2026-08-01",
  comparadaData: "2026-08-16",
};

const alteracao = (over: Partial<AlteracaoDoMotor> = {}): AlteracaoDoMotor => ({
  id: 1,
  changeType: "VALUE_CHANGED",
  attributeCode: ADM("despesa_ordenados"),
  entityLabel: CARGO,
  entityType: "QLP_ADMINISTRATIVO",
  valueBefore: "4600",
  valueAfter: "5200",
  deltaAbsolute: 600,
  deltaPercent: 13.04,
  comparability: "COMPARABLE",
  ...over,
});

const normalizar = (alteracoes: AlteracaoDoMotor[], par = PAR) =>
  normalizarLinhasDeEquipe(
    linhasDeQlpComparado(alteracoes, par.quadro),
    par,
    "cs-1",
  );

describe("a situação de uma linha", () => {
  it("chama de efetivo a coluna de quantidade — a única grandeza que o QLP soma", () => {
    const [linha] = normalizar([
      alteracao({ id: 7, attributeCode: ADM("quantidade_ordenados"), valueBefore: "4", valueAfter: "5" }),
    ]);
    expect(linha!.situacao.tipo).toBe("EFETIVO");
    expect(linha!.modulo).toBe("salario");
  });

  it("chama de sem valoração a coluna de dinheiro, e o motivo é a frase do travamento", () => {
    const [linha] = normalizar([alteracao()]);
    expect(linha!.situacao.tipo).toBe("SEM_VALORACAO");
    expect(linha!.situacao.motivo).toBe(SEM_IMPACTO_FINANCEIRO);
  });

  it("nunca escreve zero no lugar da ausência de valor", () => {
    const [linha] = normalizar([alteracao()]);
    /* Não existe campo de impacto em lugar nenhum da linha — nem zerado. */
    expect(linha).not.toHaveProperty("impacto");
  });

  it("põe benchmark fora da soma, ainda que ele seja quantidade", () => {
    const { situacao } = situacaoDaLinhaDeEquipe({
      medida: "QUANTIDADE",
      papel: "BENCHMARK",
      foraDaSoma: null,
      motivo: null,
    });
    expect(situacao).toBe("FORA_DA_SOMA");
  });

  it("põe o vale-transporte do administrativo fora da soma, com o aviso do catálogo", () => {
    const [linha] = normalizar([
      alteracao({ id: 9, attributeCode: ADM("vale_transporte") }),
    ]);
    expect(linha!.situacao.tipo).toBe("FORA_DA_SOMA");
    expect(linha!.situacao.motivo).toMatch(/despesa de benefício/);
    /* Fora da soma não é fora da tela: a linha continua contada e endereçada. */
    expect(linha!.modulo).toBe("transporte");
    expect(linha!.origem.rota).toBe("/qlp/transporte");
  });

  it("as quatro situações particionam a lista, sem resto", () => {
    const linhas = normalizar([
      alteracao({ id: 1 }),
      alteracao({ id: 2, attributeCode: ADM("quantidade_ordenados") }),
      alteracao({ id: 3, attributeCode: ADM("qlp_benchmark_salario") }),
      alteracao({ id: 4, attributeCode: ADM("vale_transporte") }),
      alteracao({ id: 5, changeType: "ENTITY_ADDED", attributeCode: null, entityLabel: OUTRO }),
    ]);
    const resumo = consolidarEquipe(resumirModulosDeEquipe(linhas, []), []);
    const soma = SITUACOES_DA_EQUIPE.reduce((t, s) => t + resumo.porSituacao[s], 0);
    expect(soma).toBe(resumo.alteracoes);
    expect(resumo.alteracoes).toBe(linhas.length);
  });
});

describe("entrada e saída de cargo", () => {
  it("não vira rubrica, e o endereço dela é o do quadro", () => {
    const [linha] = normalizar([
      alteracao({ changeType: "ENTITY_REMOVED", attributeCode: null, valueAfter: null }),
    ]);
    expect(linha!.modulo).toBe(MODULO_DO_CARGO);
    expect(linha!.origem.rota).toBe(ROTA_DO_QUADRO.ADMINISTRATIVO);
    expect(rotaDoModuloDeEquipe(MODULO_DO_CARGO, "OPERACIONAL")).toBe("/qlp-operacional");
  });

  it("é o que mais pesa na fila — tanto quanto o efetivo que mudou", () => {
    const [saiu] = normalizar([
      alteracao({ changeType: "ENTITY_REMOVED", attributeCode: null, valueAfter: null }),
    ]);
    const [efetivo] = normalizar([
      alteracao({ id: 2, attributeCode: ADM("quantidade_ordenados"), deltaPercent: 0 }),
    ]);
    expect(saiu!.prioridade.score).toBe(35);
    expect(efetivo!.prioridade.score).toBe(35);
  });

  it("o módulo do cargo vai para o fim da lista de módulos — ele é eixo, não assunto", () => {
    const linhas = normalizar([
      alteracao({ changeType: "ENTITY_ADDED", attributeCode: null, entityLabel: OUTRO }),
      alteracao({ id: 2 }),
    ]);
    const modulos = resumirModulosDeEquipe(linhas, ["salario"]).map((m) => m.modulo);
    expect(modulos).toEqual(["salario", MODULO_DO_CARGO]);
  });
});

describe("o consolidado", () => {
  it("conta o mesmo cargo uma vez, ainda que ele apareça em dois módulos", () => {
    const linhas = normalizar([
      alteracao({ id: 1, attributeCode: ADM("despesa_ordenados") }),
      alteracao({ id: 2, attributeCode: ADM("despesa_encargos") }),
    ]);
    const resumo = consolidarEquipe(resumirModulosDeEquipe(linhas, []), []);
    expect(resumo.alteracoes).toBe(2);
    expect(resumo.cargosAfetados).toBe(1);
  });

  it("carrega a frase do travamento, e ela é a da comparação por cargo", () => {
    const resumo = consolidarEquipe([], []);
    expect(resumo.semImpactoFinanceiro).toBe(SEM_IMPACTO_FINANCEIRO);
  });

  it("não publica número financeiro nenhum", () => {
    const resumo = consolidarEquipe(resumirModulosDeEquipe(normalizar([alteracao()]), []), []);
    const texto = JSON.stringify(resumo);
    expect(texto).not.toMatch(/"impacto"/);
    expect(texto).not.toMatch(/"porPeriodicidade"/);
  });
});

describe("o quadro dentro do Monitor", () => {
  const totais = { base: 41, comparada: 39 };

  it("reconcilia o movimento do efetivo com a função da comparação por cargo", () => {
    const alteracoes = [
      alteracao({ id: 1, attributeCode: ADM("quantidade_ordenados"), valueBefore: "4", valueAfter: "5" }),
      alteracao({
        id: 2,
        attributeCode: ADM("quantidade_ordenados"),
        entityLabel: OUTRO,
        valueBefore: "9",
        valueAfter: "6",
      }),
    ];
    const daOrigem = linhasDeQlpComparado(alteracoes, "ADMINISTRATIVO");
    const noMonitor = quadroDoMonitor(
      "ADMINISTRATIVO",
      PAR,
      normalizarLinhasDeEquipe(daOrigem, PAR, "cs-1"),
      totais,
      null,
    );
    expect(noMonitor.efetivo).toEqual(
      movimentoDoEfetivo(daOrigem, "ADMINISTRATIVO", totais),
    );
    /* A diferença é a das duas pontas inteiras, e não a da lista de alterações. */
    expect(noMonitor.efetivo!.diferenca).toBe(-2);
    expect(noMonitor.efetivo!.cargosQueSubiram).toBe(1);
    expect(noMonitor.efetivo!.cargosQueDesceram).toBe(1);
  });

  it("um quadro sem par entra na resposta com o motivo, e não some", () => {
    const vazio = quadroDoMonitor(
      "OPERACIONAL",
      null,
      [],
      null,
      "Só uma vigência do QLP Operacional foi importada.",
    );
    expect(vazio.par).toBeNull();
    expect(vazio.efetivo).toBeNull();
    expect(vazio.ausente).toMatch(/Só uma vigência/);
    expect(vazio.rota).toBe("/qlp-operacional");
  });
});

describe("os módulos", () => {
  it("todos os módulos do catálogo têm endereço, e é o da tela por assunto", () => {
    for (const modulo of modulosDoQlp()) {
      expect(rotaDoModuloDeEquipe(modulo.chave, modulo.quadros[0]!)).toBe(
        `/qlp/${modulo.chave}`,
      );
    }
  });
});
