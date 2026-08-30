// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova aqui é o contexto: a decisão "este link
// ainda quer dizer o que promete?" atravessa a subárvore da aba de tipo, e é
// justamente por atravessar que ela não pode ser lida sem montar a árvore.
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LeituraPorTipo, useLinkDeAlteracoes } from "../tipo-da-linha-do-tempo";

/**
 * As três leituras que a aba "Cavalo, Carreta e Trecho" pode estar fazendo, e o
 * endereço que cada uma pode honestamente oferecer.
 *
 * O defeito que isto trava é o mesmo dos dois lados: um link que sai de uma
 * leitura recortada e chega a Alterações mostrando outra população. No cavalo e
 * na carreta ele mostraria a frota inteira; no trecho mostraria uma lista
 * vazia, que se lê como "nada mudou" e é falso — Alterações não lê trecho.
 */
function Endereco() {
  const link = useLinkDeAlteracoes();
  return (
    <span data-testid="endereco">
      {link === null
        ? "(sem endereço)"
        : link({ recorte: { period: "2026-08-02", scopeHash: "abc", canal: null } })}
    </span>
  );
}

const endereco = () => screen.getByTestId("endereco").textContent ?? "";

afterEach(cleanup);

describe("o endereço de Alterações que a leitura por tipo oferece", () => {
  it("na aba Geral, é o de sempre — sem recorte de equipamento", () => {
    render(
      <LeituraPorTipo tipo={null}>
        <Endereco />
      </LeituraPorTipo>,
    );
    expect(endereco()).toContain("/alteracoes?");
    expect(new URLSearchParams(endereco().split("?")[1]).get("entityType")).toBeNull();
  });

  it("no cavalo e na carreta, leva o equipamento junto", () => {
    render(
      <LeituraPorTipo tipo="CAVALO">
        <Endereco />
      </LeituraPorTipo>,
    );
    const params = new URLSearchParams(endereco().split("?")[1]);
    expect(params.get("entityType")).toBe("CAVALO");
    // A unidade e a vigência continuam no endereço: o tipo acrescenta, não
    // substitui o recorte que já viajava.
    expect(params.get("scopeHash")).toBe("abc");
    expect(params.get("period")).toBe("2026-08-02");
  });

  it("no trecho, não há endereço — Alterações não sabe mostrá-lo", () => {
    render(
      <LeituraPorTipo tipo="TRECHO">
        <Endereco />
      </LeituraPorTipo>,
    );
    expect(endereco()).toBe("(sem endereço)");
  });

  it("fora da aba de tipo, sem provedor nenhum, nada muda", () => {
    render(<Endereco />);
    expect(new URLSearchParams(endereco().split("?")[1]).get("entityType")).toBeNull();
  });
});
