// @vitest-environment jsdom
/**
 * O diálogo de justificar — o que ele cobra antes de deixar salvar.
 *
 * O caso que estes testes prendem é o de sempre com formulário condicional: o
 * botão que se acende com o formulário incompleto, ou a exceção que grava sem
 * responsável. Quem justifica escreve dois parágrafos antes de clicar; um 400
 * depois disso é o texto perdido.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JustificarDialog } from "../justificar-dialog";
import type { Justificativa } from "@/lib/justificativas";

afterEach(cleanup);

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

const renderizar = (extra: Partial<Parameters<typeof JustificarDialog>[0]> = {}) => {
  const onConfirmar = vi.fn();
  render(
    <JustificarDialog
      alvo={ALVO}
      contexto="EMPURRADA_2_7_2026 → EMPURRADA_2_8_2026"
      pendente={false}
      erro={null}
      onClose={vi.fn()}
      onConfirmar={onConfirmar}
      {...extra}
    />,
  );
  return { onConfirmar };
};

const escrever = (rotulo: RegExp, texto: string) =>
  fireEvent.change(screen.getByPlaceholderText(rotulo), { target: { value: texto } });

const salvar = () => screen.getByRole("button", { name: /Salvar/ });

describe("o diálogo de justificar", () => {
  it("diz o que se está justificando: a placa, a comparação e os dois valores", () => {
    renderizar();
    expect(screen.getByText("Justificar alteração — Amortização")).toBeTruthy();
    expect(
      screen.getByText("QYW6D15 • EMPURRADA_2_7_2026 → EMPURRADA_2_8_2026"),
    ).toBeTruthy();
    expect(screen.getByText("R$ 12.000,00")).toBeTruthy();
    expect(screen.getByText("R$ 15.000,00")).toBeTruthy();
  });

  it("não deixa salvar sem fórmula, regra e a resposta sobre a conformidade", () => {
    renderizar();
    expect(salvar().hasAttribute("disabled")).toBe(true);

    escrever(/Amortização mensal =/, "Valor amortizável ÷ prazo");
    expect(salvar().hasAttribute("disabled")).toBe(true);

    escrever(/O valor somente pode ser alterado/, "Só muda com novo prazo.");
    expect(salvar().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /Sim, está conforme a regra/ }));
    expect(salvar().hasAttribute("disabled")).toBe(false);
  });

  it("a exceção pede motivo e responsável, e só então salva", () => {
    const { onConfirmar } = renderizar();
    escrever(/Amortização mensal =/, "Valor amortizável ÷ prazo");
    escrever(/O valor somente pode ser alterado/, "Só muda com novo prazo.");
    fireEvent.click(screen.getByRole("radio", { name: /Não, foi realizada como exceção/ }));

    expect(screen.getByRole("button", { name: "Salvar exceção" }).hasAttribute("disabled")).toBe(
      true,
    );

    escrever(/Explique por que o valor foi alterado/, "Contrato renegociado.");
    expect(screen.getByRole("button", { name: "Salvar exceção" }).hasAttribute("disabled")).toBe(
      true,
    );

    fireEvent.change(screen.getByPlaceholderText(/Nome de quem autorizou/), {
      target: { value: "Ana Souza" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar exceção" }));

    expect(onConfirmar).toHaveBeenCalledWith({
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
    escrever(/Amortização mensal =/, "f");
    escrever(/O valor somente pode ser alterado/, "r");
    fireEvent.click(screen.getByRole("radio", { name: /exceção/ }));
    escrever(/Explique por que o valor foi alterado/, "Contrato renegociado.");
    fireEvent.click(screen.getByRole("radio", { name: /Sim, está conforme/ }));

    expect(screen.queryByPlaceholderText(/Explique por que o valor foi alterado/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar justificativa" }));
    expect(onConfirmar).toHaveBeenCalledWith(
      expect.objectContaining({ conforme: true, motivoExcecao: null, responsavelAprovacao: null }),
    );
  });

  it("reabrir uma alteração já justificada traz de volta o que foi gravado", () => {
    const atual: Justificativa = {
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
    };
    renderizar({ justificativaAtual: atual });

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
      justificativaAtual: {
        id: "j0",
        changeSetId: "cs1",
        changeId: 2,
        entityLabel: "QYW6D15",
        entityType: "CAVALO",
        texto: "Troca de eixo aprovada pela manutenção em 12/08.",
        formula: null,
        regra: null,
        conforme: null,
        motivoExcecao: null,
        responsavelAprovacao: null,
        criadoPor: "gestor@ambev.com.br",
        criadoEm: "2026-09-01T12:00:00.000Z",
      },
    });
    expect(salvar().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByDisplayValue(/Troca de eixo/)).toBeNull();
  });
});
