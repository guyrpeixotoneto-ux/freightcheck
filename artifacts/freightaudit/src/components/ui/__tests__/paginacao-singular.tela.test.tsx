// @vitest-environment jsdom
//
// O rodapé quando o total é um.
//
// "Mostrando 1 - 1 de 1 pares" foi o que a Conciliação escreveu enquanto o
// rodapé só conhecia o plural. O parâmetro que conserta isso é opcional de
// propósito — todas as telas anteriores a ele continuam como estavam —, e é
// justamente por ser opcional que ele precisa de prova dos dois lados: que
// informar muda, e que não informar não muda.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Paginacao } from "../paginacao";

afterEach(cleanup);

const NADA = () => {};

describe("o total de um", () => {
  it("usa o singular quando a tela o informa", () => {
    render(
      <Paginacao
        pagina={1}
        porPagina={50}
        total={1}
        onPagina={NADA}
        unidade="pares"
        unidadeSingular="par"
      />,
    );
    expect(screen.getByText("Mostrando 1 - 1 de 1 par")).toBeTruthy();
  });

  /*
    Sem o parâmetro, o plural em todos os casos — que é o comportamento que
    dezenas de telas já mostram. Um default esperto aqui ("corta o s") teria
    escrito "1 parâmetro" certo e "1 mê" errado.
  */
  it("mantém o plural para quem não o informa", () => {
    render(
      <Paginacao
        pagina={1}
        porPagina={50}
        total={1}
        onPagina={NADA}
        unidade="resultados"
      />,
    );
    expect(screen.getByText("Mostrando 1 - 1 de 1 resultados")).toBeTruthy();
  });

  it("volta ao plural assim que há mais de um", () => {
    render(
      <Paginacao
        pagina={1}
        porPagina={50}
        total={17}
        onPagina={NADA}
        unidade="parâmetros"
        unidadeSingular="parâmetro"
      />,
    );
    expect(screen.getByText("Mostrando 1 - 17 de 17 parâmetros")).toBeTruthy();
  });

  /* Zero não chega a ter unidade: o rodapé já dizia "Nenhum resultado". */
  it("não fala de unidade nenhuma quando não há resultado", () => {
    render(
      <Paginacao
        pagina={1}
        porPagina={50}
        total={0}
        onPagina={NADA}
        unidade="pares"
        unidadeSingular="par"
      />,
    );
    expect(screen.getByText("Nenhum resultado")).toBeTruthy();
  });
});
