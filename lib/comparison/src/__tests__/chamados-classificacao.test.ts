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

describe("classificarAlteracoes", () => {
  it("separa o que mexe no fixo do que mexe no variável", () => {
    const view = classificarAlteracoes([
      linha("seguro", "ajuste de formula", 71),
      linha("freteReaisViagemPedagio", "Ajuste complemento PM", 1041),
    ]);

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
    ]);

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
    ]);

    expect(classe(view, "FIXO").parameters[0].tambemEm).toEqual(["VARIAVEL"]);
    expect(classe(view, "VARIAVEL").parameters[0].tambemEm).toEqual(["FIXO"]);
  });

  it("manda o desconhecido para a caixa visível, com o nome inteiro", () => {
    // A lista de não classificados é a fila de trabalho da tabela de
    // classificação. Um parâmetro que caísse em qualquer outra caixa nunca
    // seria classificado, porque ninguém saberia que ele está lá.
    const view = classificarAlteracoes([
      linha("parametroNovoDoFreightech", "Cadastrar", 5),
    ]);

    const naoClassificado = classe(view, "NAO_CLASSIFICADO");
    expect(view.unclassified).toBe(5);
    expect(naoClassificado.parameters.map((p) => p.parameterLabel)).toEqual([
      "parametroNovoDoFreightech",
    ]);
  });

  it("mantém a classe vazia na lista", () => {
    // "Nenhum chamado mexeu no diesel neste mês" é resposta. Uma caixa que
    // some quando dá zero deixa quem lê sem saber se a pergunta foi feita.
    const view = classificarAlteracoes([linha("seguro", "ajuste de formula", 3)]);

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
    ]);

    const parametro = classe(view, "FIXO").parameters[0];
    expect(parametro.changes).toBe(21);
    expect(parametro.subjects.map((s) => s.changes)).toEqual([10, 6, 5]);
    // O chamado sem assunto é uma folha de verdade, e não uma linha descartada.
    expect(parametro.subjects.map((s) => s.subject)).toContain(null);
  });

  it("soma impacto só do que foi apurado, e não inventa zero", () => {
    /*
      Zero é a afirmação de que mexeram e nada mudou. Quando a verdade é "nada
      foi apurado", a soma precisa chegar na tela como ausência — é ela que faz
      a tela escrever "sem impacto apurado" em vez de "R$ 0".
    */
    const view = classificarAlteracoes([
      linha("kmIda", "AJuste KM e excluir duplicadas", 5, {
        calculated: 2,
        impactSum: -297,
      }),
      linha("kmVolta", "AJuste KM e excluir duplicadas", 5),
    ]);

    const variavel = classe(view, "VARIAVEL");
    expect(variavel.impactSum).toBe(-297);
    expect(variavel.calculated).toBe(2);

    const semApuracao = variavel.parameters.find((p) => p.parameterLabel === "kmVolta");
    expect(semApuracao?.impactSum).toBeNull();
  });

  it("não perde alteração nenhuma: o total é a soma das linhas de origem", () => {
    const linhas = [
      linha("seguro", "ajuste de formula", 71),
      linha("freteReaisViagemPedagio", "Ajuste complemento PM", 1041),
      linha("cavaloEmpurrada", "transferencia de placas", 2),
      linha("parametroDesconhecido", null, 4),
    ];

    const view = classificarAlteracoes(linhas);
    expect(view.changes).toBe(linhas.reduce((t, l) => t + l.changes, 0));
  });

  it("devolve o envio vazio sem estourar", () => {
    const view = classificarAlteracoes([]);
    expect(view.changes).toBe(0);
    expect(view.overlap).toBe(0);
    expect(view.unclassified).toBe(0);
    expect(view.classes).toHaveLength(4);
  });
});
