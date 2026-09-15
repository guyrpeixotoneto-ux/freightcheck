// @vitest-environment jsdom
//
// O SELETOR NUNCA OFERECE UM PAR QUE O MOTOR VAI RECUSAR.
//
// O relato, de 15/09/2026, com o acervo de PERNAMBUCO logo depois de uma
// importação de carreta: *"algo aconteceu que agora não consigo mais comparar
// como antes e ainda não tem mais as alterações e impacto positivo/negativo do
// filtro"*. As duas metades da frase são o mesmo defeito. A importação deixou
// parte das vigências cobrindo `CARRETA+CAVALO` e parte só `CAVALO`; o motor
// não compara coberturas diferentes (`engine.ts`), a rota de candidatas nem as
// considera (`candidatas-do-par.ts`) — e o seletor continuava oferecendo as
// duas séries na mesma lista, as incompatíveis sem número nenhum ao lado.
//
// Estes casos abrem os menus de verdade e leem o que está escrito neles.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeletorDoPar, type VigenciaEscolhivel } from "../seletor-do-par";

/* O Radix mede e ancora o menu com APIs que o jsdom não traz; nenhuma delas é o
   que estes casos provam. */
globalThis.DOMRect ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  top = 0;
  left = 0;
  right = 0;
  bottom = 0;
  toJSON() {
    return this;
  }
} as unknown as typeof DOMRect;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const PERNAMBUCO = "scope-pe";
const CAMACARI = "scope-ca";

const v = (
  id: string,
  effectiveDate: string,
  entityTypeSet: string,
  scopeHash = PERNAMBUCO,
): VigenciaEscolhivel => ({
  id,
  sourceLabel: id.toUpperCase(),
  effectiveDate,
  entityTypeSet,
  scopeHash,
});

/* O acervo do relato, reduzido ao que importa: duas séries de cobertura
   diferente na mesma unidade, mais uma vigência de outra unidade. */
const ACERVO: VigenciaEscolhivel[] = [
  v("jun-ambos", "2026-06-01", "CARRETA+CAVALO"),
  v("jul-ambos", "2026-07-16", "CARRETA+CAVALO"),
  v("ago1-ambos", "2026-08-01", "CARRETA+CAVALO"),
  v("ago2-cavalo", "2026-08-16", "CAVALO"),
  v("set-cavalo", "2026-09-01", "CAVALO"),
  v("ca-jul-ambos", "2026-07-16", "CARRETA+CAVALO", CAMACARI),
];

const ROTULOS = new Map(
  ACERVO.map((x) => [
    x.id,
    { "jun-ambos": "junho/2026", "jul-ambos": "julho/2026", "ago1-ambos": "agosto/2026 · 1ª quinzena", "ago2-cavalo": "agosto/2026 · 2ª quinzena", "set-cavalo": "setembro/2026", "ca-jul-ambos": "julho/2026 · CAMAÇARI" }[x.id]!,
  ]),
);

/**
 * A tela como as quatro auditorias a montam — `vigencias` é a lista da unidade,
 * e as duas pontas são estado da página.
 */
function montar(
  base: string,
  comparada: string,
  vigencias: VigenciaEscolhivel[] = ACERVO,
  foco: string | null = null,
) {
  const onBase = vi.fn();
  const onComparada = vi.fn();
  render(
    <SeletorDoPar
      vigencias={vigencias}
      rotulos={ROTULOS}
      base={base}
      comparada={comparada}
      onBase={onBase}
      onComparada={onComparada}
      onInverter={() => {}}
      foco={foco}
      idPrefixo="finame"
    />,
  );
  return { onBase, onComparada };
}

const abrir = (campo: "De (vigência de origem)" | "Para (vigência de destino)") =>
  fireEvent.keyDown(screen.getByLabelText(campo), { key: "Enter" });

/** O que o menu aberto oferece para clicar, em texto. */
const opcoes = () =>
  screen.getAllByRole("option").map((o) => o.textContent?.trim() ?? "");

afterEach(cleanup);

describe("o campo Para, com um De escolhido", () => {
  /* O critério de aceite, dito como teste. */
  it("não oferece agosto só com cavalo quando o De cobre cavalo + carreta", () => {
    montar("jul-ambos", "ago1-ambos");
    abrir("Para (vigência de destino)");

    const oferecidas = opcoes();
    expect(oferecidas.some((t) => t.includes("agosto/2026 · 2ª quinzena"))).toBe(false);
    expect(oferecidas.some((t) => t.includes("setembro/2026"))).toBe(false);
  });

  it("oferece as compatíveis, e continua oferecendo todas elas", () => {
    montar("jul-ambos", "ago1-ambos");
    abrir("Para (vigência de destino)");

    expect(opcoes()).toEqual(["junho/2026", "agosto/2026 · 1ª quinzena"]);
  });

  /* A recusa por escopo, que o motor trata igual à de cobertura. */
  it("não oferece a vigência de outra unidade, mesma cobertura e mesma data", () => {
    montar("jul-ambos", "ago1-ambos");
    abrir("Para (vigência de destino)");

    expect(opcoes().some((t) => t.includes("CAMAÇARI"))).toBe(false);
  });
});

describe("o campo De, que é o que dá acesso à outra série", () => {
  /* Recortar os dois campos um pelo outro prenderia o par na cobertura em que
     abriu: não haveria clique que levasse à série só de cavalo. O campo
     ancorado oferece o acervo da unidade — e diz, em cada linha, o que ela é. */
  it("agrupa à parte as de outra composição, dizendo como o arquivo veio", () => {
    montar("jul-ambos", "ago1-ambos", ACERVO, "CAVALO");
    abrir("De (vigência de origem)");

    const outra = screen.getByRole("option", { name: /agosto\/2026 · 2ª quinzena/ });
    expect(within(outra).getByText("Somente cavalo")).toBeTruthy();
    expect(screen.getByText("Como o cavalo veio na vigência")).toBeTruthy();
  });

  /**
   * O defeito que trocou este rótulo: "Outra cobertura" dentro da aba Cavalo,
   * com as linhas dizendo "Cavalo". O nome descrevia a identidade do arquivo no
   * banco e contradizia a aba — as duas séries **têm** cavalo, e o que as separa
   * é o arquivo ter vindo só com ele ou com a carreta junto.
   */
  it("nunca escreve 'Outra cobertura'", () => {
    montar("jul-ambos", "ago1-ambos", ACERVO, "CAVALO");
    abrir("De (vigência de origem)");

    expect(screen.queryByText(/Outra cobertura/i)).toBeNull();
  });

  /* A mesma vigência, lida da pergunta que está sendo feita. */
  it("lê a composição pelo equipamento da aba aberta", () => {
    montar("jul-ambos", "ago1-ambos", ACERVO, "CARRETA");
    abrir("De (vigência de origem)");

    expect(screen.getByText("Como a carreta veio na vigência")).toBeTruthy();
  });

  /* O defeito relatado: linha muda ao lado de linhas que dizem "nenhuma
     alteração" é lida como "nada mudou aqui". Ela nunca terá número — o
     servidor não a considera candidata —, então ela diz o que é. */
  it("nunca deixa uma linha incomparável em branco", () => {
    montar("jul-ambos", "ago1-ambos", ACERVO, "CAVALO");
    abrir("De (vigência de origem)");

    for (const nome of [/agosto\/2026 · 2ª quinzena/, /setembro\/2026/]) {
      const linha = screen.getByRole("option", { name: nome });
      expect(within(linha).getByText("Somente cavalo")).toBeTruthy();
    }
  });

  it("arrasta o Para para a compatível mais próxima ao trocar de cobertura", () => {
    const { onBase, onComparada } = montar("jul-ambos", "ago1-ambos");
    abrir("De (vigência de origem)");
    fireEvent.click(screen.getByRole("option", { name: /setembro\/2026/ }));

    expect(onBase).toHaveBeenCalledWith("set-cavalo");
    /* A vizinha de setembro dentro de CAVALO é agosto · 2ª quinzena. */
    expect(onComparada).toHaveBeenCalledWith("ago2-cavalo");
  });

  /* Trocar dentro da mesma cobertura não mexe na outra ponta: o par já vale. */
  it("não mexe no Para quando a escolha continua compatível", () => {
    const { onComparada } = montar("jul-ambos", "ago1-ambos");
    abrir("De (vigência de origem)");
    fireEvent.click(screen.getByRole("option", { name: /junho\/2026/ }));

    expect(onComparada).not.toHaveBeenCalled();
  });
});

describe("quando não há vigência compatível nenhuma", () => {
  const SOZINHA = [
    v("jul-ambos", "2026-07-16", "CARRETA+CAVALO"),
    v("ago-cavalo", "2026-08-16", "CAVALO"),
    v("set-cavalo", "2026-09-01", "CAVALO"),
  ];

  it("explica a ausência e diz o que importar, em vez de deixar a caixa muda", () => {
    montar("jul-ambos", "", SOZINHA);

    expect(
      screen.getByText(
        "Não há outra vigência com cobertura de Cavalo + Carreta disponível para comparação. Importe os dados correspondentes na vigência desejada.",
      ),
    ).toBeTruthy();
  });

  it("esvazia a outra ponta em vez de deixar um par que o motor recusa", () => {
    const { onComparada } = montar("ago-cavalo", "set-cavalo", SOZINHA);
    abrir("De (vigência de origem)");
    fireEvent.click(screen.getByRole("option", { name: /julho\/2026/ }));

    expect(onComparada).toHaveBeenCalledWith("");
  });

  /* O contrário do caso acima: com par possível, nada de aviso na tela. */
  it("não avisa nada quando o par em tela é válido", () => {
    montar("jul-ambos", "ago1-ambos");

    expect(screen.queryByText(/Não há outra vigência com cobertura/)).toBeNull();
  });
});
