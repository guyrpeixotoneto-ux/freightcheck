// @vitest-environment jsdom
/**
 * O diálogo de justificar — o que ele cobra antes de deixar salvar, e como
 * percorre a fila quando se abriu mais de uma alteração.
 *
 * O caso que estes testes prendem é o de sempre com formulário condicional: o
 * botão que se acende com o formulário incompleto, ou a exceção que grava sem
 * responsável. Quem justifica escreve dois parágrafos antes de clicar; um 400
 * depois disso é o texto perdido.
 *
 * Os da fila prendem o que a caixa passou a prometer ao virar assistente: cada
 * "Salvar e próxima" grava **uma** variável (e não a mesma frase nas quatro),
 * uma gravação recusada não empurra ninguém para a etapa seguinte, e o que foi
 * digitado numa etapa continua lá quando se volta a ela.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JustificarDialog } from "../justificar-dialog";
import type { Justificativa } from "@/lib/justificativas";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ALVO = [
  {
    id: 2,
    entityLabel: "QYW6D15",
    attributeCode: "amortizacao",
    attributeName: "Amortização",
    valueBefore: "R$ 12.000,00",
    valueAfter: "R$ 15.000,00",
    deltaAbsolute: 3000,
    deltaPercent: 25,
  },
];

/** As quatro do contrato, com os códigos de verdade — é por eles que o total se reconhece. */
const CONTRATO = [
  {
    id: 21,
    entityLabel: "QYX1E98",
    attributeCode: "cavalo.finame_cavalo",
    attributeName: "Parcela FINAME",
  },
  {
    id: 22,
    entityLabel: "QYX1E98",
    attributeCode: "cavalo.juros_finame_cavalo",
    attributeName: "Juros FINAME",
  },
  {
    id: 23,
    entityLabel: "QYX1E98",
    attributeCode: "cavalo.amortizacao_cavalo",
    attributeName: "Amortização",
  },
  {
    id: 24,
    entityLabel: "QYX1E98",
    attributeCode: "cavalo.periodo_finame",
    attributeName: "Prazo",
  },
];

const QUATRO = [
  { id: 11, entityLabel: "QYX1E98", attributeCode: "parcela", attributeName: "Parcela FINAME" },
  { id: 12, entityLabel: "QYX1E98", attributeCode: "juros", attributeName: "Juros FINAME" },
  { id: 13, entityLabel: "QYX1E98", attributeCode: "amortizacao", attributeName: "Amortização" },
  { id: 14, entityLabel: "QYX1E98", attributeCode: "fim", attributeName: "Fim do contrato" },
];

const justificativaGravada = (extra: Partial<Justificativa> = {}): Justificativa => ({
  id: "j1",
  changeSetId: "cs1",
  changeId: 2,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  texto: "Exceção à regra: contrato renegociado — aprovada por Ana Souza.",
  formula: "Valor amortizável ÷ prazo",
  regra: "Só muda com novo prazo.",
  conforme: false,
  motivoExcecao: "Contrato renegociado.",
  responsavelAprovacao: "Ana Souza",
  criadoPor: "gestor@ambev.com.br",
  criadoEm: "2026-09-01T12:00:00.000Z",
  ...extra,
});

const renderizar = (extra: Partial<Parameters<typeof JustificarDialog>[0]> = {}) => {
  const onConfirmar = vi.fn();
  const onClose = vi.fn();
  render(
    <JustificarDialog
      alvo={ALVO}
      contexto="EMPURRADA_2_7_2026 → EMPURRADA_2_8_2026"
      pendente={false}
      erro={null}
      onClose={onClose}
      onConfirmar={onConfirmar}
      {...extra}
    />,
  );
  return { onConfirmar, onClose };
};

const escrever = (rotulo: RegExp, texto: string) =>
  fireEvent.change(screen.getByPlaceholderText(rotulo), { target: { value: texto } });

const FORMULA = /Descreva como o valor deve ser calculado/;
const REGRA = /Explique quando esta variável pode ser alterada/;

const salvar = (nome: RegExp = /^Salvar justificativa$/) =>
  screen.getByRole("button", { name: nome });

describe("o diálogo de justificar", () => {
  it("diz o que se está justificando: a placa, a comparação e os dois valores", () => {
    renderizar();
    expect(screen.getByText("Justificar alteração — Amortização")).toBeTruthy();
    expect(screen.getByText("EMPURRADA_2_7_2026 → EMPURRADA_2_8_2026")).toBeTruthy();
    expect(screen.getByText("QYW6D15")).toBeTruthy();
    expect(screen.getByText("R$ 12.000,00")).toBeTruthy();
    expect(screen.getByText("R$ 15.000,00")).toBeTruthy();
  });

  it("não deixa salvar sem fórmula, regra e a resposta sobre a conformidade", () => {
    renderizar();
    expect(salvar().hasAttribute("disabled")).toBe(true);

    escrever(FORMULA, "Valor amortizável ÷ prazo");
    expect(salvar().hasAttribute("disabled")).toBe(true);

    escrever(REGRA, "Só muda com novo prazo.");
    expect(salvar().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Sim, está conforme/ }));
    expect(salvar().hasAttribute("disabled")).toBe(false);
  });

  it("a exceção pede motivo e responsável, e só então salva", () => {
    const { onConfirmar } = renderizar();
    escrever(FORMULA, "Valor amortizável ÷ prazo");
    escrever(REGRA, "Só muda com novo prazo.");
    fireEvent.click(screen.getByRole("radio", { name: /Não, foi uma exceção/ }));

    expect(salvar(/^Salvar exceção$/).hasAttribute("disabled")).toBe(true);

    escrever(/Explique por que o valor foi alterado/, "Contrato renegociado.");
    expect(salvar(/^Salvar exceção$/).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/Nome de quem autorizou/), {
      target: { value: "Ana Souza" },
    });
    fireEvent.click(salvar(/^Salvar exceção$/));

    expect(onConfirmar).toHaveBeenCalledWith(ALVO[0], {
      formula: "Valor amortizável ÷ prazo",
      regra: "Só muda com novo prazo.",
      conforme: false,
      motivoExcecao: "Contrato renegociado.",
      responsavelAprovacao: "Ana Souza",
    });
  });

  /*
    Quem escreveu o motivo e depois marcou "conforme" mudou de decisão. Gravar
    o texto abandonado junto deixaria no banco uma linha que se contradiz.
  */
  it("voltar para conforme descarta o motivo e o responsável", () => {
    const { onConfirmar } = renderizar();
    escrever(FORMULA, "f");
    escrever(REGRA, "r");
    fireEvent.click(screen.getByRole("radio", { name: /exceção/ }));
    escrever(/Explique por que o valor foi alterado/, "Contrato renegociado.");
    fireEvent.click(screen.getByRole("radio", { name: /Sim, está conforme/ }));

    expect(screen.queryByPlaceholderText(/Explique por que o valor foi alterado/)).toBeNull();
    fireEvent.click(salvar());
    expect(onConfirmar).toHaveBeenCalledWith(
      ALVO[0],
      expect.objectContaining({ conforme: true, motivoExcecao: null, responsavelAprovacao: null }),
    );
  });

  it("reabrir uma alteração já justificada traz de volta o que foi gravado", () => {
    renderizar({ justificativas: new Map([[2, justificativaGravada()]]) });

    expect(screen.getByDisplayValue("Valor amortizável ÷ prazo")).toBeTruthy();
    expect(screen.getByDisplayValue("Só muda com novo prazo.")).toBeTruthy();
    expect(screen.getByDisplayValue("Ana Souza")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /exceção/ }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  /*
    Justificativa anterior à `0098` tem a frase e não tem os campos: ela abre
    em branco de propósito — copiar a frase para o campo "Regra" afirmaria que
    alguém a escreveu como regra.
  */
  it("justificativa antiga, sem campos, abre em branco e não salva sozinha", () => {
    renderizar({
      justificativas: new Map([
        [
          2,
          justificativaGravada({
            id: "j0",
            texto: "Troca de eixo aprovada pela manutenção em 12/08.",
            formula: null,
            regra: null,
            conforme: null,
            motivoExcecao: null,
            responsavelAprovacao: null,
          }),
        ],
      ]),
    });
    expect(salvar().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByDisplayValue(/Troca de eixo/)).toBeNull();
  });
});

const preencher = (formula: string) => {
  escrever(FORMULA, formula);
  escrever(REGRA, "Só muda com novo prazo.");
  fireEvent.click(screen.getByRole("radio", { name: /Sim, está conforme/ }));
};

describe("a fila de variáveis", () => {
  const renderizarQuatro = (extra: Partial<Parameters<typeof JustificarDialog>[0]> = {}) =>
    renderizar({ alvo: QUATRO, contexto: "vigência 01/09/26", ...extra });

  it("abre na primeira variável, lista as quatro e conta o que falta", () => {
    renderizarQuatro();
    expect(screen.getByText("Justificar 4 alterações")).toBeTruthy();
    expect(screen.getByText("0 de 4 concluídas")).toBeTruthy();
    expect(screen.getByText("Variável 1 de 4")).toBeTruthy();
    for (const a of QUATRO) {
      expect(screen.getAllByText(a.attributeName).length).toBeGreaterThan(0);
    }
    /* A promessa que o formulário faz, e que a gravação tem de cumprir. */
    expect(
      screen.getAllByText("Esta resposta será associada somente à variável Parcela FINAME.")
        .length,
    ).toBe(3);
  });

  it("cada variável é gravada sozinha, com a fórmula que se escreveu nela", async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    renderizarQuatro({ onConfirmar });

    preencher("Parcela = juros + amortização");
    fireEvent.click(salvar(/^Salvar e próxima$/));

    await waitFor(() => expect(screen.getByText("Variável 2 de 4")).toBeTruthy());
    expect(onConfirmar).toHaveBeenCalledTimes(1);
    expect(onConfirmar.mock.calls[0][0]).toEqual(QUATRO[0]);
    expect(onConfirmar.mock.calls[0][1]).toEqual(
      expect.objectContaining({ formula: "Parcela = juros + amortização", conforme: true }),
    );

    /* A etapa seguinte começa vazia: a fórmula dos Juros não é a da Parcela. */
    expect((screen.getByPlaceholderText(FORMULA) as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("1 de 4 concluídas")).toBeTruthy();
  });

  it("uma gravação recusada não avança nem apaga o que foi escrito", async () => {
    const onConfirmar = vi.fn().mockRejectedValue(new Error("400"));
    renderizarQuatro({ onConfirmar });

    preencher("Parcela = juros + amortização");
    fireEvent.click(salvar(/^Salvar e próxima$/));

    await waitFor(() => expect(onConfirmar).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Variável 1 de 4")).toBeTruthy();
    expect((screen.getByPlaceholderText(FORMULA) as HTMLTextAreaElement).value).toBe(
      "Parcela = juros + amortização",
    );
  });

  it("a última concluída fecha a caixa", async () => {
    const onConfirmar = vi.fn().mockResolvedValue(undefined);
    const { onClose } = renderizarQuatro({
      alvo: [QUATRO[0]],
      justificativas: new Map(),
      onConfirmar,
    });

    preencher("Parcela = juros + amortização");
    fireEvent.click(salvar());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  /*
    A fila é de uma placa: a placa não muda entre as etapas, então ela é do
    cabeçalho — escrevê-la de novo em cada etapa é repetir quatro vezes o que
    não mudou.
  */
  it("a placa é dita uma vez, no cabeçalho", () => {
    renderizarQuatro();
    expect(screen.getAllByText("QYX1E98")).toHaveLength(1);
    expect(screen.queryByText(/Alteração em/)).toBeNull();
  });

  /* A seleção do Painel atravessa placas de propósito: ali o cabeçalho não pode
     afirmar uma, e cada etapa diz a sua. */
  it("com placas diferentes na lista, cada etapa diz a sua", () => {
    renderizarQuatro({
      alvo: [
        { ...QUATRO[0], entityLabel: "QYX1E98" },
        { ...QUATRO[1], entityLabel: "QYW6D15" },
      ],
    });
    expect(screen.getByText(/Alteração em/)).toBeTruthy();
  });

  /*
    Ir e voltar é o que separa uma fila de um formulário de quatro páginas sem
    volta: quem descobre na terceira variável que errou a primeira precisa
    poder consertar sem redigitar as outras.
  */
  it("navegar pela lateral não perde o que já foi digitado", () => {
    renderizarQuatro();
    escrever(FORMULA, "Parcela = juros + amortização");

    fireEvent.click(screen.getByRole("button", { name: /Juros FINAME/ }));
    expect(screen.getByText("Variável 2 de 4")).toBeTruthy();
    expect((screen.getByPlaceholderText(FORMULA) as HTMLTextAreaElement).value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /Parcela FINAME/ }));
    expect((screen.getByPlaceholderText(FORMULA) as HTMLTextAreaElement).value).toBe(
      "Parcela = juros + amortização",
    );
  });

  /*
    O rascunho é o papel em cima da mesa: fica no navegador, volta quando a
    caixa reabre e — o que importa para a auditoria — não vira justificativa
    nenhuma pelo caminho.
  */
  it("o rascunho volta ao reabrir, e não grava nada", () => {
    const { onConfirmar, onClose } = renderizarQuatro();
    escrever(FORMULA, "Parcela = juros + amortização");
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(onConfirmar).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    cleanup();
    renderizarQuatro();
    expect((screen.getByPlaceholderText(FORMULA) as HTMLTextAreaElement).value).toBe(
      "Parcela = juros + amortização",
    );
  });
});

/**
 * A Parcela FINAME é juros mais amortização. Perguntar a fórmula das três pede
 * a mesma coisa duas vezes — e deixa a resposta do total livre para contradizer
 * a das parcelas.
 */
describe("o total que é a conta das suas parcelas", () => {
  it("sai da fila quando as parcelas estão na mesma lista, e diz por quê", () => {
    renderizar({ alvo: CONTRATO });

    expect(screen.getByText("Justificar 3 alterações")).toBeTruthy();
    expect(screen.getByText("0 de 3 concluídas")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Parcela FINAME/ })).toBeNull();
    expect(screen.getByText("Parcela FINAME = Juros FINAME + Amortização")).toBeTruthy();
    expect(screen.getByText(/será registrado a partir das justificativas/)).toBeTruthy();
    /* A primeira etapa é a primeira parcela, e não o total. */
    expect(screen.getByRole("heading", { level: 3, name: "Juros FINAME" })).toBeTruthy();
  });

  it("aberto sozinho, continua sendo perguntado — não há de onde deduzir", () => {
    renderizar({ alvo: [CONTRATO[0]] });
    expect(screen.getByText("Justificar alteração — Parcela FINAME")).toBeTruthy();
    expect(screen.getByPlaceholderText(FORMULA)).toBeTruthy();
    expect(screen.queryByText(/será registrado a partir das justificativas/)).toBeNull();
  });
});
