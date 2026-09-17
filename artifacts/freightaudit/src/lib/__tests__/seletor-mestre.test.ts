import { describe, expect, it } from "vitest";

import { PARES_VAZIOS, type ParesDoCatalogo } from "../alteracoes-por-modulo";
import {
  aplicarMestre,
  coberturasQueSeguem,
  datasDoAcervo,
  inverterMestre,
  mestreDePartida,
  mestreDosPares,
  parNaCobertura,
  reancorarMestre,
  situacaoDasCoberturas,
  type ListasDoCatalogo,
} from "../seletor-mestre";

/**
 * O CONTRATO DO PAR MESTRE — um gesto, quatro coberturas, nenhum par recusado.
 *
 * O acervo deste arquivo é o que produziu o defeito relatado em tela: quatro
 * seletores abertos em quatro pares diferentes, sem nada dizendo por quê. A
 * frota entrega equipamento e trecho em vigências separadas e em quinzenas
 * diferentes; o quadro de pessoal vem de outra consulta, com **outros ids** nas
 * mesmas datas; e o administrativo foi importado uma vez só.
 *
 * O que roda aqui é a promessa da tela, e nada de pixel:
 *
 * 1. o mestre casa por data, e por isso alcança o QLP, que tem outros ids;
 * 2. o que ele aplica passou por `formamParDeVigencias` — nenhum par que o
 *    motor recusaria chega à tela por um gesto no mestre;
 * 3. a cobertura que não tem o par do mestre **fica como estava**, e é nomeada;
 * 4. a escolha que invalida a outra ponta arrasta-a para a mais próxima que
 *    serve, e não deixa em tela um mestre que não aplica nada.
 */

const UNIDADE = "hash-pe";

const vigencia = (
  id: string,
  effectiveDate: string,
  entityTypeSet: string,
  scopeHash = UNIDADE,
) => ({ id, effectiveDate, entityTypeSet, scopeHash });

/* A frota: equipamento em julho, agosto/2ª e setembro/1ª; trecho em julho e
   setembro/2ª — as duas séries do mesmo `/snapshots`, e é por elas divergirem
   que a tela abria em dois pares. */
const f1 = vigencia("f1", "2026-07-01", "CARRETA+CAVALO");
const f2 = vigencia("f2", "2026-08-16", "CARRETA+CAVALO");
const f3 = vigencia("f3", "2026-09-01", "CARRETA+CAVALO");
const t1 = vigencia("t1", "2026-07-01", "TRECHO");
const t2 = vigencia("t2", "2026-09-16", "TRECHO");

/* O quadro: outra consulta, outros ids — `o1` é a MESMA quinzena de `f2`. */
const o1 = vigencia("o1", "2026-08-16", "QLP_OPERACIONAL");
const o2 = vigencia("o2", "2026-09-01", "QLP_OPERACIONAL");
const a1 = vigencia("a1", "2026-09-01", "QLP_ADMINISTRATIVO");

const LISTAS: ListasDoCatalogo = {
  EQUIPAMENTO: [f1, f2, f3],
  TRECHO: [t1, t2],
  QLP_OPERACIONAL: [o1, o2],
  QLP_ADMINISTRATIVO: [a1],
};

const AGOSTO_SETEMBRO = { de: "2026-08-16", para: "2026-09-01" };

const pares = (parcial: Partial<ParesDoCatalogo>): ParesDoCatalogo => ({
  ...PARES_VAZIOS,
  ...parcial,
});

describe("o mestre casa por data, porque os ids não atravessam as consultas", () => {
  /* O requisito 1 — e a razão de o mestre não ser um par de ids. */
  it("alcança o QLP, que tem outro id na mesma quinzena", () => {
    expect(parNaCobertura(LISTAS.EQUIPAMENTO, AGOSTO_SETEMBRO)).toEqual({
      base: "f2",
      comparada: "f3",
    });
    expect(parNaCobertura(LISTAS.QLP_OPERACIONAL, AGOSTO_SETEMBRO)).toEqual({
      base: "o1",
      comparada: "o2",
    });
  });

  it("não forma par onde a data não existe", () => {
    /* Trecho não tem agosto/2ª: nenhuma tradução possível, e nenhum palpite. */
    expect(parNaCobertura(LISTAS.TRECHO, AGOSTO_SETEMBRO)).toBeNull();
    /* O administrativo tem setembro/1ª, mas não a outra ponta. */
    expect(parNaCobertura(LISTAS.QLP_ADMINISTRATIVO, AGOSTO_SETEMBRO)).toBeNull();
  });

  /* O requisito 2 — a régua é a do motor, e não "achei as duas datas". */
  it("recusa duas vigências de unidades diferentes na mesma data", () => {
    const deOutraUnidade = vigencia("x1", "2026-09-01", "CARRETA+CAVALO", "hash-cam");
    expect(parNaCobertura([f2, deOutraUnidade], AGOSTO_SETEMBRO)).toBeNull();
    /* Com a da unidade certa na lista, o par sai — e é o dela. */
    expect(parNaCobertura([f2, deOutraUnidade, f3], AGOSTO_SETEMBRO)).toEqual({
      base: "f2",
      comparada: "f3",
    });
  });

  it("oferece a união das datas das quatro listas, da mais nova para a mais velha", () => {
    expect(datasDoAcervo(LISTAS)).toEqual([
      "2026-09-16",
      "2026-09-01",
      "2026-08-16",
      "2026-07-01",
    ]);
  });
});

describe("aplicar o mestre", () => {
  /* O requisito 3 — o que não segue fica como estava, e não é arrastado. */
  it("escreve só nas coberturas que formam o par, e preserva as outras", () => {
    const atuais = pares({
      TRECHO: { base: "t1", comparada: "t2" },
      QLP_ADMINISTRATIVO: { base: "a1", comparada: "" },
    });
    expect(aplicarMestre(AGOSTO_SETEMBRO, LISTAS, atuais)).toEqual({
      EQUIPAMENTO: { base: "f2", comparada: "f3" },
      TRECHO: { base: "t1", comparada: "t2" },
      QLP_OPERACIONAL: { base: "o1", comparada: "o2" },
      QLP_ADMINISTRATIVO: { base: "a1", comparada: "" },
    });
  });

  it("inverter troca as pontas de quem segue, e só delas", () => {
    const atuais = aplicarMestre(AGOSTO_SETEMBRO, LISTAS, pares({
      TRECHO: { base: "t1", comparada: "t2" },
    }));
    const invertido = aplicarMestre(inverterMestre(AGOSTO_SETEMBRO), LISTAS, atuais);
    expect(invertido.EQUIPAMENTO).toEqual({ base: "f3", comparada: "f2" });
    expect(invertido.QLP_OPERACIONAL).toEqual({ base: "o2", comparada: "o1" });
    expect(invertido.TRECHO).toEqual({ base: "t1", comparada: "t2" });
  });

  it("nomeia quem segue", () => {
    expect(coberturasQueSeguem(AGOSTO_SETEMBRO, LISTAS)).toEqual([
      "EQUIPAMENTO",
      "QLP_OPERACIONAL",
    ]);
  });
});

describe("o mestre de abertura", () => {
  /* O defeito do print: quatro `parDePartida` independentes, quatro pares. */
  it("escolhe o par que serve a mais coberturas", () => {
    expect(mestreDePartida(LISTAS)).toEqual(AGOSTO_SETEMBRO);
  });

  it("é vazio quando nenhuma cobertura forma par", () => {
    expect(
      mestreDePartida({
        EQUIPAMENTO: [],
        TRECHO: [],
        QLP_OPERACIONAL: [],
        QLP_ADMINISTRATIVO: [a1],
      }),
    ).toEqual({ de: "", para: "" });
  });
});

describe("o mestre lido dos quatro pares", () => {
  it("é o par da maioria quando eles divergem", () => {
    const atuais = pares({
      EQUIPAMENTO: { base: "f2", comparada: "f3" },
      QLP_OPERACIONAL: { base: "o1", comparada: "o2" },
      TRECHO: { base: "t1", comparada: "t2" },
    });
    expect(mestreDosPares(atuais, LISTAS)).toEqual(AGOSTO_SETEMBRO);
  });

  it("é vazio quando não há par completo nenhum", () => {
    expect(mestreDosPares(PARES_VAZIOS, LISTAS)).toEqual({ de: "", para: "" });
  });
});

describe("a ponta que a escolha invalidou", () => {
  /* O requisito 4 — e o empate resolvido para trás, como no seletor de par. */
  it("arrasta a outra ponta para a mais próxima que serve a alguma cobertura", () => {
    /* Setembro/2ª só existe em Trecho, que não tem setembro/1ª: sem arrasto, o
       mestre ficaria em tela sem aplicar nada. */
    const escolhido = { de: "2026-09-16", para: "2026-09-01" };
    expect(coberturasQueSeguem(escolhido, LISTAS)).toEqual([]);
    expect(reancorarMestre(escolhido, LISTAS, "de")).toEqual({
      de: "2026-09-16",
      para: "2026-07-01",
    });
  });

  it("não mexe num mestre que já serve a alguém", () => {
    expect(reancorarMestre(AGOSTO_SETEMBRO, LISTAS, "de")).toEqual(AGOSTO_SETEMBRO);
  });

  it("deixa a outra ponta vazia quando nenhuma data forma par com a escolhida", () => {
    /* Dezembro só existe em OUTRA unidade: a data aparece na lista, e mesmo
       assim nenhuma vigência do acervo forma par com ela. */
    const deOutraUnidade = vigencia("z1", "2026-12-01", "QLP_ADMINISTRATIVO", "hash-cam");
    const listas: ListasDoCatalogo = { ...LISTAS, QLP_ADMINISTRATIVO: [a1, deOutraUnidade] };
    expect(
      reancorarMestre({ de: "2026-08-16", para: "2026-12-01" }, listas, "para"),
    ).toEqual({ de: "", para: "2026-12-01" });
  });
});

describe("em que pé cada cobertura está", () => {
  it("separa quem segue, quem tem par próprio e quem não tem par", () => {
    const atuais = aplicarMestre(AGOSTO_SETEMBRO, LISTAS, pares({
      TRECHO: { base: "t1", comparada: "t2" },
    }));
    expect(situacaoDasCoberturas(AGOSTO_SETEMBRO, atuais, LISTAS)).toEqual([
      {
        cobertura: "EQUIPAMENTO",
        estado: "SEGUE",
        par: { base: "f2", comparada: "f3" },
        motivo: null,
      },
      {
        cobertura: "TRECHO",
        estado: "PROPRIO",
        par: { base: "t1", comparada: "t2" },
        motivo: null,
      },
      {
        cobertura: "QLP_OPERACIONAL",
        estado: "SEGUE",
        par: { base: "o1", comparada: "o2" },
        motivo: null,
      },
      {
        cobertura: "QLP_ADMINISTRATIVO",
        estado: "SEM_PAR",
        par: { base: "", comparada: "" },
        motivo: { motivo: "UMA_SO" },
      },
    ]);
  });
});
