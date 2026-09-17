// @vitest-environment jsdom
//
// O PAR NO ENDEREÇO — a persistência que as dezesseis telas de rubrica não
// tinham.
//
// O defeito, levantado na auditoria de 17/09/2026: sete telas liam
// `?base=&comparada=` na montagem e nunca mais escreviam; as outras nove não
// liam nem escreviam. O par vivia em `useState`, e por isso copiar o endereço
// depois de comparar junho com setembro mandava o outro para o par de partida
// da tela — o link de quem mandou funcionava, o link de quem trocou não.
//
// O que se prende aqui é o contrato do hook que substituiu os `useState`: o
// valor sai do endereço, o setter escreve nele, as outras chaves atravessam
// intocadas, e a escrita é `replace` — porque o mesmo setter serve o clique da
// pessoa e o efeito de reconciliação.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router, useSearch } from "wouter";

import { useParNaUrl } from "../par-de-vigencias";

/** Uma tela mínima com as duas pontas, como as auditorias as montam. */
function Tela() {
  const [base, setBase] = useParNaUrl("base");
  const [comparada, setComparada] = useParNaUrl("comparada");
  const busca = useSearch();
  return (
    <div>
      <span data-testid="base">{base}</span>
      <span data-testid="comparada">{comparada}</span>
      <span data-testid="busca">{busca}</span>
      <button onClick={() => setBase("jun")}>De junho</button>
      <button onClick={() => setBase("set")}>De setembro</button>
      <button onClick={() => setComparada("ago")}>Para agosto</button>
    </div>
  );
}

const abrirEm = (busca: string) =>
  window.history.pushState({}, "", busca ? `/custo-fixo-finame?${busca}` : "/custo-fixo-finame");

const montar = () => render(<Router><Tela /></Router>);

const naTela = (id: "base" | "comparada" | "busca") =>
  screen.getByTestId(id).textContent ?? "";

const clicar = (nome: string) => act(() => screen.getByText(nome).click());

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("o valor vem do endereço", () => {
  it("restaura as duas pontas de um link", () => {
    abrirEm("base=jun&comparada=set");
    montar();
    expect(naTela("base")).toBe("jun");
    expect(naTela("comparada")).toBe("set");
  });

  /* Sem os parâmetros as duas pontas nascem vazias — o estado inicial que estas
     telas sempre tiveram, e de onde o par de partida entra pelo efeito delas. */
  it("sem os parâmetros, nasce vazio", () => {
    abrirEm("");
    montar();
    expect(naTela("base")).toBe("");
    expect(naTela("comparada")).toBe("");
  });
});

describe("o setter escreve no endereço", () => {
  it("escolher no De escreve `?base=` — e o valor volta pelo endereço", () => {
    abrirEm("comparada=set");
    montar();
    clicar("De junho");

    expect(window.location.search).toContain("base=jun");
    expect(naTela("base")).toBe("jun");
    /* E a outra ponta não se mexeu: é o mesmo contrato do seletor. */
    expect(naTela("comparada")).toBe("set");
  });

  it("escolher no Para escreve `?comparada=`, e preserva o De", () => {
    abrirEm("base=jun");
    montar();
    clicar("Para agosto");

    expect(window.location.search).toContain("comparada=ago");
    expect(naTela("base")).toBe("jun");
  });

  /*
    As outras chaves atravessam intocadas — é a promessa de `trocarNoEndereco`,
    e aqui ela vale para o recorte de unidade, que é o que faria a tela responder
    por PERNAMBUCO debaixo da palavra CAMAÇARI.
  */
  it("não mexe nas outras chaves do endereço", () => {
    abrirEm("scopeHash=hash-ca&canal=EMPURRADA&modo=real&comparada=set");
    montar();
    clicar("De junho");

    const q = new URLSearchParams(window.location.search);
    expect(q.get("scopeHash")).toBe("hash-ca");
    expect(q.get("canal")).toBe("EMPURRADA");
    expect(q.get("modo")).toBe("real");
    expect(q.get("comparada")).toBe("set");
    expect(q.get("base")).toBe("jun");
  });

  /*
    Escrever o mesmo valor não navega.

    O efeito de reconciliação (`parReconciliado`) chama o setter a cada rodada em
    que a lista de vigências muda, e quase sempre com o valor que já está lá. Sem
    este atalho, cada rodada seria uma navegação — e com `replace`, um `replace`.
  */
  it("escrever o mesmo valor não navega", () => {
    abrirEm("base=jun");
    montar();
    const antes = window.history.length;
    clicar("De junho");
    expect(window.history.length).toBe(antes);
    expect(naTela("base")).toBe("jun");
  });

  /*
    `replace`, e não `push`: o mesmo setter serve o clique da pessoa e o efeito
    de reconciliação, e empilhando os dois o "voltar" precisaria de duas ou três
    batidas para desfazer uma escolha.
  */
  it("troca o endereço sem empilhar histórico", () => {
    abrirEm("");
    montar();
    const antes = window.history.length;
    clicar("De junho");
    clicar("De setembro");
    clicar("Para agosto");

    expect(window.history.length).toBe(antes);
    expect(naTela("base")).toBe("set");
    expect(naTela("comparada")).toBe("ago");
  });
});
