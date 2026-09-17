// @vitest-environment jsdom
//
// O PARA NÃO SAI DO LUGAR — o contrato do par do Panorama, no DOM de verdade.
//
// O relato, de 17/09/2026, sobre o Panorama de CAMAÇARI: *"seleciono pra Para
// ser setembro e DE ser agosto e automaticamente setembro vai pra agosto, não
// era assim o comportamento antes"*. Era: `aoEscolherDe` recalculava o `period`
// a partir da vigência escolhida no De, e o Para ia atrás — a referência que a
// pessoa tinha fixado saía debaixo dela, sem uma palavra na tela.
//
// A régua fica escrita aqui, e não só no módulo: os casos do módulo provam o
// endereço que cada gesto produz, e estes provam que **o gesto é esse mesmo** —
// que a caixa aberta é a que a pessoa clica e o valor que chega na página é o
// que estava escrito na linha. Um teste que só olhasse funções passaria verde
// sobre um seletor que trocasse os dois `onValueChange` de lugar.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SeletorDoParDoPanorama, type VigenciaDoPar } from "../seletor-do-par";
import {
  aoEscolherDe,
  aoEscolherPara,
  aoInverter,
  parEmTela,
} from "@/lib/par-do-panorama";

/* O Radix mede e ancora o menu com APIs que o jsdom não traz; nenhuma delas é o
   que estes casos provam. É o mesmo preâmbulo do seletor das auditorias. */
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

/* O histórico de CAMAÇARI, reduzido ao trecho do relato. */
const JUN = "2026-06-16";
const JUL = "2026-07-16";
const AGO1 = "2026-08-01";
const AGO2 = "2026-08-16";
const SET = "2026-09-01";
const DATAS = [SET, AGO2, AGO1, JUL, JUN];

const ROTULO: Record<string, string> = {
  [JUN]: "junho/2026 · 2ª quinzena",
  [JUL]: "julho/2026 · 2ª quinzena",
  [AGO1]: "agosto/2026 · 1ª quinzena",
  [AGO2]: "agosto/2026 · 2ª quinzena",
  [SET]: "setembro/2026 · 1ª quinzena",
};

const OPCOES: VigenciaDoPar[] = DATAS.map((data) => ({
  data,
  rotulo: ROTULO[data],
  alteracoes: 170,
  impacto: 1000,
}));

/**
 * A tela como o Panorama a monta — as duas pontas saem do endereço, e cada
 * gesto devolve o endereço seguinte.
 *
 * `endereco` é o que a página guardaria em `?period=`/`?base=`. Montar por ele,
 * e não por dois `useState` soltos, é o que faz estes casos provarem o caminho
 * inteiro: clique → função do módulo → endereço → par em tela.
 */
function montar(endereco: { period: string; base: string | null }) {
  const trocas: { period: string; base: string | null }[] = [];
  const par = parEmTela(DATAS, { para: endereco.period, de: endereco.base });
  const guardar = (destino: { period: string; base: string | null } | null) => {
    if (destino) trocas.push(destino);
  };
  render(
    <SeletorDoParDoPanorama
      opcoes={OPCOES}
      par={par}
      periodicidade="MENSAL"
      onEscolherDe={(data) => guardar(aoEscolherDe(DATAS, par, data))}
      onEscolherPara={(data) => guardar(aoEscolherPara(DATAS, par, data))}
      onInverter={() => guardar(aoInverter(DATAS, par))}
    />,
  );
  return {
    trocas,
    par,
    /** O par que a tela mostraria depois do gesto — o endereço lido de volta. */
    depois: () => {
      const ultimo = trocas.at(-1);
      return ultimo === undefined
        ? par
        : parEmTela(DATAS, { para: ultimo.period, de: ultimo.base });
    },
  };
}

const abrir = (campo: "De (vigência de origem)" | "Para (vigência de destino)") =>
  fireEvent.keyDown(screen.getByLabelText(campo), { key: "Enter" });

const escolher = (rotulo: string) =>
  fireEvent.click(screen.getByRole("option", { name: new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }));

const naCaixa = (campo: "De (vigência de origem)" | "Para (vigência de destino)") =>
  screen.getByLabelText(campo).textContent ?? "";

afterEach(cleanup);

describe("o gesto relatado", () => {
  /*
    O caso exato do relato, do clique ao que a tela passa a mostrar.
  */
  it("com setembro no Para, escolher agosto no De mantém setembro no Para", () => {
    const tela = montar({ period: SET, base: JUN });
    expect(naCaixa("Para (vigência de destino)")).toContain("setembro/2026");

    abrir("De (vigência de origem)");
    escolher("agosto/2026 · 2ª quinzena");

    expect(tela.trocas).toEqual([{ period: SET, base: null }]);
    expect(tela.depois()).toMatchObject({ de: AGO2, para: SET });
  });

  it("com setembro no Para, escolher junho no De mantém setembro no Para", () => {
    const tela = montar({ period: SET, base: null });

    abrir("De (vigência de origem)");
    escolher("junho/2026 · 2ª quinzena");

    expect(tela.trocas).toEqual([{ period: SET, base: JUN }]);
    expect(tela.depois()).toMatchObject({ de: JUN, para: SET, invertido: false });
  });

  /* A outra metade da mesma régua: mexer no Para não mexe no De. */
  it("trocar só o Para preserva o De escolhido", () => {
    const tela = montar({ period: SET, base: JUN });

    abrir("Para (vigência de destino)");
    escolher("agosto/2026 · 2ª quinzena");

    expect(tela.trocas).toEqual([{ period: AGO2, base: JUN }]);
    expect(tela.depois()).toMatchObject({ de: JUN, para: AGO2 });
  });
});

describe("o que a tela diz sobre o par", () => {
  /*
    O sentido, escrito. Ele deixou de ser dedutível no dia em que o par salteado
    passou a ser possível: com as duas caixas livres, "Para − De" é a única
    frase que diz de qual ponta para qual ponta o número da tela anda.
  */
  it("publica o sentido da leitura — Para − De", () => {
    montar({ period: SET, base: JUN });
    expect(
      screen.getByText(/setembro\/2026 · 1ª quinzena − junho\/2026 · 2ª quinzena/),
    ).toBeTruthy();
  });

  it("declara a volta quando a partida é posterior à chegada", () => {
    montar({ period: JUL, base: SET });
    expect(screen.getByText(/Esta é a/)).toBeTruthy();
    expect(screen.getByText("volta")).toBeTruthy();
  });

  /*
    A mesma vigência dos dois lados: as duas escolhas ficam onde foram postas, e
    a frase diz por que não dá. Trocar uma delas por uma vizinha seria repetir,
    num caso menor, o defeito que este arquivo fecha.
  */
  it("a mesma vigência nos dois campos fica em tela, com a recusa escrita", () => {
    montar({ period: SET, base: SET });

    expect(naCaixa("De (vigência de origem)")).toContain("setembro/2026");
    expect(naCaixa("Para (vigência de destino)")).toContain("setembro/2026");
    expect(screen.getByRole("status").textContent).toMatch(
      /não se compara consigo mesma/,
    );
    /* E o botão que não leva a lugar nenhum não aceita clique. */
    expect(
      screen.getByRole("button", { name: /Inverter/ }).hasAttribute("disabled"),
    ).toBe(true);
  });

  /*
    A vigência mais antiga tinha o **De vazio** e nenhuma explicação: era o que
    via quem clicasse na primeira barra do gráfico de ganhos e perdas.
  */
  it("na vigência mais antiga, o De vem preenchido com a posterior", () => {
    montar({ period: JUN, base: null });

    expect(naCaixa("De (vigência de origem)")).toContain("julho/2026");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uma ponta que não é desta unidade é nomeada, e as caixas continuam clicáveis", () => {
    montar({ period: SET, base: "2025-01-01" });

    expect(screen.getByRole("status").textContent).toMatch(/não está no histórico/);
    expect(
      screen.getByLabelText("De (vigência de origem)").hasAttribute("disabled"),
    ).toBe(false);
  });

  /* Uma vigência só no histórico não é falha: é o acervo dizendo o que falta. */
  it("com uma vigência só, diz o que importar em vez de oferecer escolha", () => {
    const par = parEmTela([SET], { para: SET, de: null });
    render(
      <SeletorDoParDoPanorama
        opcoes={[OPCOES[0]]}
        par={par}
        onEscolherDe={() => {}}
        onEscolherPara={() => {}}
        onInverter={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/uma vigência só no histórico/);
  });
});

describe("inverter", () => {
  it("troca as duas pontas, e nada mais", () => {
    const tela = montar({ period: SET, base: JUN });
    fireEvent.click(screen.getByRole("button", { name: /Inverter/ }));
    expect(tela.trocas).toEqual([{ period: JUN, base: SET }]);
    expect(tela.depois()).toMatchObject({ de: SET, para: JUN, invertido: true });
  });
});

/**
 * A varredura: nenhum clique em uma caixa mexe na outra.
 *
 * Abre o menu, clica em cada linha, e confere as duas pontas. É o que fecha a
 * porta para um arrasto novo entrar por uma borda que ninguém lembrou de
 * testar — foi exatamente assim que o anterior entrou.
 */
describe("nenhuma alteração silenciosa, linha a linha", () => {
  it("nenhuma escolha no De move o Para", () => {
    for (const escolhida of DATAS) {
      const tela = montar({ period: SET, base: AGO1 });
      abrir("De (vigência de origem)");
      escolher(ROTULO[escolhida]);
      expect(tela.depois().para).toBe(SET);
      expect(tela.depois().de).toBe(escolhida);
      cleanup();
    }
  });

  it("nenhuma escolha no Para move o De", () => {
    for (const escolhida of DATAS) {
      const tela = montar({ period: SET, base: AGO1 });
      abrir("Para (vigência de destino)");
      escolher(ROTULO[escolhida]);
      expect(tela.depois().de).toBe(AGO1);
      expect(tela.depois().para).toBe(escolhida);
      cleanup();
    }
  });
});
