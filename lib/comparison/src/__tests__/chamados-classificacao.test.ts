/**
 * Dobrar as alterações de chamado nos valores que elas mexem.
 *
 * A consulta que alimenta esta função é um `group by` banal; o que pode estar
 * errado de um jeito que ninguém percebe é a dobra. Estes casos fixam as
 * propriedades que a tela promete: as contagens batem com o envio, a dupla
 * contagem é medida em vez de escondida, "não apurado" nunca vira zero, e uma
 * classe vazia continua existindo para poder dizer que está vazia.
 */
import { describe, expect, it } from "vitest";
import {
  classificarAlteracoes,
  type ReguaDoParametro,
  type TicketGroupedRow,
} from "../chamados";

const linha = (
  parameterLabel: string,
  subject: string | null,
  changes: number,
  extra: Partial<TicketGroupedRow> = {},
): TicketGroupedRow => ({
  parameterLabel,
  attributeCode: null,
  subject,
  changes,
  calculated: 0,
  impactSum: null,
  ...extra,
});

const classe = (view: ReturnType<typeof classificarAlteracoes>, codigo: string) =>
  view.classes.find((c) => c.classe === codigo)!;

/** Régua vazia: nenhum parâmetro passa — o padrão honesto destas dobras. */
const SEM_REGUA = new Map<string, ReguaDoParametro>();

describe("classificarAlteracoes", () => {
  it("separa o que mexe no fixo do que mexe no variável", () => {
    const view = classificarAlteracoes([
      linha("seguro", "ajuste de formula", 71),
      linha("freteReaisViagemPedagio", "Ajuste complemento PM", 1041),
    ], SEM_REGUA);

    expect(classe(view, "FIXO").changes).toBe(71);
    expect(classe(view, "VARIAVEL").changes).toBe(1041);
    expect(view.changes).toBe(1112);
  });

  it("conta nas duas classes o parâmetro que mexe nos dois valores, e mede o excesso", () => {
    /*
      O caso do export real que motivou a tela: `cavaloEmpurrada` aparece nas
      duas tabelas da planilha do time com a mesma contagem. As classes somam
      1.220 e o envio tem 1.218 — a diferença é exatamente esta, e a tela a
      escreve em vez de deixar quem lê descobri-la subtraindo de cabeça.
    */
    const view = classificarAlteracoes([
      linha("seguro", "ajuste de formula", 71),
      linha("kmIda", "AJuste KM e excluir duplicadas", 5),
      linha("cavaloEmpurrada", "transferencia de placas", 2),
    ], SEM_REGUA);

    expect(view.changes).toBe(78);
    expect(view.overlap).toBe(2);
    expect(classe(view, "FIXO").changes).toBe(73);
    expect(classe(view, "VARIAVEL").changes).toBe(7);

    const soma = view.classes.reduce((total, c) => total + c.changes, 0);
    expect(soma).toBe(view.changes + view.overlap);
  });

  it("aponta, no parâmetro repetido, em que outra classe ele também entra", () => {
    const view = classificarAlteracoes([
      linha("cavaloEmpurrada", "transferencia de placas", 2),
    ], SEM_REGUA);

    expect(classe(view, "FIXO").parameters[0].tambemEm).toEqual(["VARIAVEL"]);
    expect(classe(view, "VARIAVEL").parameters[0].tambemEm).toEqual(["FIXO"]);
  });

  it("manda o desconhecido para a caixa visível, com o nome inteiro", () => {
    // A lista de não classificados é a fila de trabalho da tabela de
    // classificação. Um parâmetro que caísse em qualquer outra caixa nunca
    // seria classificado, porque ninguém saberia que ele está lá.
    const view = classificarAlteracoes([
      linha("parametroNovoDoFreightech", "Cadastrar", 5),
    ], SEM_REGUA);

    const naoClassificado = classe(view, "NAO_CLASSIFICADO");
    expect(view.unclassified).toBe(5);
    expect(naoClassificado.parameters.map((p) => p.parameterLabel)).toEqual([
      "parametroNovoDoFreightech",
    ]);
  });

  it("mantém a classe vazia na lista", () => {
    // "Nenhum chamado mexeu no diesel neste mês" é resposta. Uma caixa que
    // some quando dá zero deixa quem lê sem saber se a pergunta foi feita.
    const view = classificarAlteracoes([linha("seguro", "ajuste de formula", 3)], SEM_REGUA);

    expect(view.classes.map((c) => c.classe)).toEqual([
      "FIXO",
      "VARIAVEL",
      "VARIAVEL_DIESEL",
      "NAO_CLASSIFICADO",
    ]);
    expect(classe(view, "VARIAVEL_DIESEL").changes).toBe(0);
    expect(classe(view, "VARIAVEL_DIESEL").parameters).toEqual([]);
  });

  it("junta os assuntos sob o parâmetro, do maior para o menor", () => {
    const view = classificarAlteracoes([
      linha("finameCavalo", "ajuste de formula finame", 10),
      linha("finameCavalo", "AJUSTE FINAME CONFORME REGRA", 5),
      linha("finameCavalo", null, 6),
    ], SEM_REGUA);

    const parametro = classe(view, "FIXO").parameters[0];
    expect(parametro.changes).toBe(21);
    expect(parametro.subjects.map((s) => s.changes)).toEqual([10, 6, 5]);
    // O chamado sem assunto é uma folha de verdade, e não uma linha descartada.
    expect(parametro.subjects.map((s) => s.subject)).toContain(null);
  });

  it("a soma da classe passa pela régua: só o confirmado e monetário vira balde", () => {
    /*
      A soma da classe atravessa parâmetros — mensal com anual, monetário com o
      que nem dinheiro é. Por isso ela só existe na régua (`viraDinheiro`), por
      periodicidade; o que não passa é CONTADO em `foraDaRegua`, nunca somado
      nem escondido.
    */
    const regua = new Map<string, ReguaDoParametro>([
      ["cavalo.km_ida", { somavel: true, motivo: null, periodicidade: "MENSAL" }],
    ]);
    const view = classificarAlteracoes(
      [
        linha("kmIda", "AJuste KM e excluir duplicadas", 5, {
          attributeCode: "cavalo.km_ida",
          calculated: 2,
          impactSum: -297,
        }),
        // Apurado no arquivo, mas sem régua: variação existe, dinheiro não é.
        linha("kmVolta", "AJuste KM e excluir duplicadas", 5, {
          calculated: 1,
          impactSum: 40,
        }),
      ],
      regua,
    );

    const variavel = classe(view, "VARIAVEL");
    expect(variavel.impacto.porPeriodicidade).toEqual({ MENSAL: -297 });
    expect(variavel.impacto.alteracoesSomadas).toBe(2);
    expect(variavel.impacto.foraDaRegua).toBe(1);
    expect(variavel.calculated).toBe(3);

    // O escalar por parâmetro continua existindo (uma unidade só), com a
    // régua ao lado dizendo se ele é dinheiro.
    const semRegua = variavel.parameters.find((p) => p.parameterLabel === "kmVolta");
    expect(semRegua?.impactSum).toBe(40);
    expect(semRegua?.regua).toBeNull();
  });

  it("periodicidades diferentes nunca se somam num escalar de classe", () => {
    const regua = new Map<string, ReguaDoParametro>([
      ["cavalo.seguro", { somavel: true, motivo: null, periodicidade: "MENSAL" }],
      ["cavalo.ipva", { somavel: true, motivo: null, periodicidade: "ANUAL" }],
    ]);
    const view = classificarAlteracoes(
      [
        linha("seguro", "ajuste", 2, {
          attributeCode: "cavalo.seguro",
          calculated: 2,
          impactSum: 100,
        }),
        linha("ipvaLicenciamento", "ajuste", 1, {
          attributeCode: "cavalo.ipva",
          calculated: 1,
          impactSum: 1200,
        }),
      ],
      regua,
    );

    const fixo = classe(view, "FIXO");
    expect(fixo.impacto.porPeriodicidade).toEqual({ MENSAL: 100, ANUAL: 1200 });
  });

  it("não perde alteração nenhuma: o total é a soma das linhas de origem", () => {
    const linhas = [
      linha("seguro", "ajuste de formula", 71),
      linha("freteReaisViagemPedagio", "Ajuste complemento PM", 1041),
      linha("cavaloEmpurrada", "transferencia de placas", 2),
      linha("parametroDesconhecido", null, 4),
    ];

    const view = classificarAlteracoes(linhas, SEM_REGUA);
    expect(view.changes).toBe(linhas.reduce((t, l) => t + l.changes, 0));
  });

  it("devolve o envio vazio sem estourar", () => {
    const view = classificarAlteracoes([], SEM_REGUA);
    expect(view.changes).toBe(0);
    expect(view.overlap).toBe(0);
    expect(view.unclassified).toBe(0);
    expect(view.classes).toHaveLength(4);
  });
});
