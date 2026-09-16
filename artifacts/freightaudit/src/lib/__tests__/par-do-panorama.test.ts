// As regras do par, fora do DOM.
//
// Elas decidem **o que vai para o endereço** a cada clique, e é aí que mora a
// única coisa difícil deste controle: as duas caixas oferecem o histórico
// inteiro, e mesmo assim nenhum clique pode montar um par que o servidor
// recuse. O que se prende aqui é isso — e que a vigência mais antiga, que não
// tem anterior, continua alcançável pela volta.
import { describe, expect, it } from "vitest";

import {
  anteriorDe,
  aoEscolherDe,
  aoEscolherPara,
  aoInverter,
  consultaDoPar,
  baseNoEndereco,
  parEmTela,
  posteriorA,
} from "../par-do-panorama";

const DATAS = ["2026-07-01", "2026-08-01", "2026-09-01"];

describe("as vizinhas de uma vigência", () => {
  it("são a anterior e a posterior da lista, e nada além das bordas", () => {
    expect(anteriorDe(DATAS, "2026-08-01")).toBe("2026-07-01");
    expect(posteriorA(DATAS, "2026-08-01")).toBe("2026-09-01");
    expect(anteriorDe(DATAS, "2026-07-01")).toBeNull();
    expect(posteriorA(DATAS, "2026-09-01")).toBeNull();
  });
});

describe("o par em tela", () => {
  it("sem `?de=`, é o natural: cada vigência contra a anterior dela", () => {
    expect(parEmTela(DATAS, { para: "2026-08-01", de: null })).toEqual({
      de: "2026-07-01",
      para: "2026-08-01",
      invertido: false,
    });
  });

  it("com um `?de=` posterior, é a volta — e ela se declara", () => {
    expect(parEmTela(DATAS, { para: "2026-07-01", de: "2026-08-01" })).toEqual({
      de: "2026-08-01",
      para: "2026-07-01",
      invertido: true,
    });
  });

  /*
    Um par salteado no endereço cai no natural em vez de virar pergunta ao
    servidor: a tela já sabe que o Panorama lê um passo de cada vez, e pedir uma
    recusa que ela mesma escreveria seria uma viagem para nada.
  */
  it("um `?de=` que não é vizinho é descartado", () => {
    expect(parEmTela(DATAS, { para: "2026-09-01", de: "2026-07-01" })).toEqual({
      de: "2026-08-01",
      para: "2026-09-01",
      invertido: false,
    });
  });

  it("com uma vigência só, não há par — e as duas pontas ficam vazias", () => {
    expect(parEmTela(["2026-08-01"], { para: "2026-08-01", de: null })).toEqual({
      de: null,
      para: "2026-08-01",
      invertido: false,
    });
  });
});

describe("escolher numa das caixas", () => {
  it("arrasta a outra ponta para a vizinha seguinte — a leitura de sempre", () => {
    expect(aoEscolherDe(DATAS, "2026-07-01")).toEqual({
      period: "2026-08-01",
      de: "2026-07-01",
    });
    expect(aoEscolherPara(DATAS, "2026-09-01")).toEqual({
      period: "2026-09-01",
      de: "2026-08-01",
    });
  });

  /*
    Nas bordas só existe uma vizinha, e é ela que a outra ponta assume — mesmo
    quando isso significa a volta. É o que mantém a vigência mais antiga
    legível: ela não tem anterior, e sem esta regra escolhê-la no "Para" não
    produziria par nenhum.
  */
  it("na borda do histórico, a única vizinha possível — ainda que invertida", () => {
    expect(aoEscolherDe(DATAS, "2026-09-01")).toEqual({
      period: "2026-08-01",
      de: "2026-09-01",
    });
    expect(aoEscolherPara(DATAS, "2026-07-01")).toEqual({
      period: "2026-07-01",
      de: "2026-08-01",
    });
  });

  it("com uma vigência só, escolher não leva a lugar nenhum", () => {
    expect(aoEscolherDe(["2026-08-01"], "2026-08-01")).toBeNull();
    expect(aoEscolherPara(["2026-08-01"], "2026-08-01")).toBeNull();
  });
});

describe("inverter", () => {
  it("troca as duas pontas de lado, e nada mais", () => {
    expect(
      aoInverter({ de: "2026-07-01", para: "2026-08-01", invertido: false }),
    ).toEqual({ period: "2026-07-01", de: "2026-08-01" });
  });

  it("sem par montado, não faz nada", () => {
    expect(aoInverter({ de: null, para: "2026-08-01", invertido: false })).toBeNull();
  });
});

describe("o que vai para o endereço", () => {
  /*
    O par natural não escreve `?base=`: escrevê-lo faria a tela trocar de consulta
    — e de chave de cache — sem trocar de resposta.
  */
  it("o natural não escreve `?base=`; a volta escreve", () => {
    expect(baseNoEndereco(DATAS, { para: "2026-08-01", de: "2026-07-01" })).toBeNull();
    expect(baseNoEndereco(DATAS, { para: "2026-07-01", de: "2026-08-01" })).toBe("2026-08-01");
  });

  it("a consulta do par leva o recorte da unidade, e não a vigência aberta", () => {
    const recorte = new URLSearchParams({
      period: "2026-08-01",
      scopeHash: "hash-pe",
      canal: "EMPURRADA",
    });
    const consulta = consultaDoPar(recorte, { de: "2026-08-01", para: "2026-07-01" });
    expect(consulta.get("scopeHash")).toBe("hash-pe");
    expect(consulta.get("canal")).toBe("EMPURRADA");
    expect(consulta.get("base")).toBe("2026-08-01");
    expect(consulta.get("comparada")).toBe("2026-07-01");
    /* E nunca `de`/`para`: `?de=` é o recorte de janela do contexto do outro
       lado, e mandá-lo aqui recortaria a unidade em vez de nomear a ponta. */
    expect(consulta.get("de")).toBeNull();
    /* `period` não viaja: quem nomeia a chegada aqui é `para`, e mandar os dois
       deixaria o servidor com duas fontes para a mesma ponta. */
    expect(consulta.get("period")).toBeNull();
  });
});
