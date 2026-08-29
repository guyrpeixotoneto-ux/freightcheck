import { describe, expect, it } from "vitest";
import {
  FAROIS,
  farolNoCatalogo,
  FRASE_DO_MOTIVO,
  idadeEmPalavras,
  ordenarPorGravidade,
  ROTULO_DO_MOTIVO,
  valorComUnidade,
  type EstadoDaEtapa,
  type Farol,
  type MotivoDaAusencia,
} from "../monitoramento-de-fluxo";

/**
 * O QUE A TELA DE MONITORAMENTO PODE E NÃO PODE DIZER.
 *
 * As regras de cor, validade e ausência são do motor, e têm bateria própria em
 * `lib/fluxos/src/__tests__/monitoramento.test.ts`, contra o contrato. O que se
 * prova aqui é a camada de apresentação, e a afirmação que ela não pode
 * quebrar: **ausência nunca se apresenta como normalidade.**
 *
 * Tudo abaixo é função pura sobre um `EstadoDaEtapa` montado à mão — nenhum
 * componente, nenhum DOM, nenhuma requisição. É o que permite provar a regra
 * sem montar tela.
 */

const MOTIVOS: MotivoDaAusencia[] = [
  "sem_chave",
  "sem_coletor",
  "coletor_falhou",
  "sem_resposta",
  "vencida",
];

function estado(parcial: Partial<EstadoDaEtapa> & { etapaId: string }): EstadoDaEtapa {
  return {
    etapaNome: "Etapa",
    chave: null,
    farol: "SEM_DADO",
    leitura: null,
    vencida: false,
    idadeEmSegundos: null,
    motivo: null,
    ...parcial,
  };
}

describe("o vocabulário vem do motor, e não daqui", () => {
  it("as quatro cores do contrato canônico têm entrada no catálogo", () => {
    const valores = FAROIS.map((f) => f.valor);
    expect(valores).toEqual(["VERDE", "AMARELO", "VERMELHO", "SEM_DADO"]);
  });

  it("cada cor traz rótulo, descrição e a classe do tema — nada é escrito na tela", () => {
    for (const farol of ["VERDE", "AMARELO", "VERMELHO", "SEM_DADO"] as Farol[]) {
      const entrada = farolNoCatalogo(farol);
      expect(entrada.valor).toBe(farol);
      expect(entrada.rotulo).not.toBe("");
      expect(entrada.descricao).not.toBe("");
      expect(entrada.classe).not.toBe("");
      /* Nunca cor literal: o catálogo fala em classes do tema. */
      expect(entrada.classe).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it("`SEM_DADO` diz por extenso que não é o mesmo que estar bem", () => {
    expect(farolNoCatalogo("SEM_DADO").descricao).toContain("Não é o mesmo que estar bem");
  });
});

describe("ausência nunca vira normalidade", () => {
  it("as cinco causas do motor têm frase e rótulo — nenhuma cai num cinza mudo", () => {
    for (const motivo of MOTIVOS) {
      expect(FRASE_DO_MOTIVO[motivo]).toBeTruthy();
      expect(ROTULO_DO_MOTIVO[motivo]).toBeTruthy();
    }
    expect(Object.keys(FRASE_DO_MOTIVO).sort()).toEqual([...MOTIVOS].sort());
    expect(Object.keys(ROTULO_DO_MOTIVO).sort()).toEqual([...MOTIVOS].sort());
  });

  it("nenhuma frase de ausência afirma que está tudo bem", () => {
    for (const motivo of MOTIVOS) {
      const frase = FRASE_DO_MOTIVO[motivo].toLowerCase();
      expect(frase).not.toMatch(/\bnormal\b|\bok\b|tudo bem|em dia|saud/);
    }
  });

  it("etapa sem leitura não tem número para mostrar", () => {
    expect(valorComUnidade(estado({ etapaId: "e1", motivo: "sem_coletor" }))).toBeNull();
  });

  it("etapa sem leitura não tem idade — nunca 'agora'", () => {
    expect(idadeEmPalavras(estado({ etapaId: "e1" }).idadeEmSegundos)).toBeNull();
  });
});

describe("idadeEmPalavras", () => {
  it("traduz segundos na frase que faz alguém conferir o coletor", () => {
    expect(idadeEmPalavras(0)).toBe("agora");
    expect(idadeEmPalavras(59)).toBe("agora");
    expect(idadeEmPalavras(600)).toBe("há 10 min");
    expect(idadeEmPalavras(7_200)).toBe("há 2h");
    expect(idadeEmPalavras(86_400)).toBe("há 1 dia");
    expect(idadeEmPalavras(259_200)).toBe("há 3 dias");
  });

  it("`null` entra e `null` sai — não se inventa medição que não houve", () => {
    expect(idadeEmPalavras(null)).toBeNull();
    expect(idadeEmPalavras(Number.NaN)).toBeNull();
  });

  it("idade negativa (relógio adiantado) não vira frase estranha", () => {
    expect(idadeEmPalavras(-30)).toBe("agora");
  });
});

describe("valorComUnidade", () => {
  it("junta o número medido com a unidade que o coletor declarou", () => {
    const medida = estado({
      etapaId: "e1",
      farol: "VERDE",
      chave: "cte.emissao",
      leitura: {
        chave: "cte.emissao",
        farol: "VERDE",
        medidoEm: "2026-08-27T13:55:13.415Z",
        valor: 412,
        unidade: "CT-e",
      },
    });
    expect(valorComUnidade(medida)).toBe("412 CT-e");
  });

  it("coletor que só sabe dizer a cor é um coletor legítimo, e não mostra número", () => {
    const soCor = estado({
      etapaId: "e2",
      farol: "AMARELO",
      leitura: {
        chave: "x.y",
        farol: "AMARELO",
        medidoEm: "2026-08-27T13:55:13.415Z",
        valor: null,
      },
    });
    expect(valorComUnidade(soCor)).toBeNull();
  });
});

describe("a leitura vencida se preserva", () => {
  it("a etapa apaga, e a medição anterior continua disponível para a tela", () => {
    const vencida = estado({
      etapaId: "e3",
      chave: "cte.emissao",
      farol: "SEM_DADO",
      vencida: true,
      motivo: "vencida",
      idadeEmSegundos: 1_728_005,
      leitura: {
        chave: "cte.emissao",
        farol: "VERDE",
        medidoEm: "2026-08-09T13:55:13.502Z",
        valor: 88,
        unidade: "CT-e",
      },
    });

    /* O farol da etapa é a ausência… */
    expect(vencida.farol).toBe("SEM_DADO");
    expect(farolNoCatalogo(vencida.farol).rotulo).toBe("Sem dado");
    /* …e a última medição continua legível, com a idade em palavras. */
    expect(vencida.leitura?.farol).toBe("VERDE");
    expect(valorComUnidade(vencida)).toBe("88 CT-e");
    expect(idadeEmPalavras(vencida.idadeEmSegundos)).toBe("há 20 dias");
    expect(FRASE_DO_MOTIVO[vencida.motivo!]).toContain("validade");
  });
});

describe("ordenarPorGravidade", () => {
  const fluxo: EstadoDaEtapa[] = [
    estado({ etapaId: "e1", farol: "VERDE" }),
    estado({ etapaId: "e2", motivo: "sem_coletor" }),
    estado({ etapaId: "e3", farol: "VERMELHO" }),
    estado({ etapaId: "e4", farol: "AMARELO" }),
    estado({ etapaId: "e5", farol: "VERDE" }),
    estado({ etapaId: "e6", motivo: "vencida", vencida: true }),
  ];

  it("põe o pior na frente e a ausência no fim — ela não é uma nota boa", () => {
    expect(ordenarPorGravidade(fluxo).map((e) => e.etapaId)).toEqual([
      "e3",
      "e4",
      "e1",
      "e5",
      "e2",
      "e6",
    ]);
  });

  it("não perde nem inventa etapa: todas continuam na lista", () => {
    const ordenado = ordenarPorGravidade(fluxo);
    expect(ordenado).toHaveLength(fluxo.length);
    expect(new Set(ordenado.map((e) => e.etapaId))).toEqual(
      new Set(fluxo.map((e) => e.etapaId)),
    );
  });

  it("não muda a lista original — a ordem do processo continua de pé", () => {
    const antes = fluxo.map((e) => e.etapaId);
    ordenarPorGravidade(fluxo);
    expect(fluxo.map((e) => e.etapaId)).toEqual(antes);
  });

  it("dentro de uma mesma cor, a ordem do processo é o desempate", () => {
    const verdes = ordenarPorGravidade(fluxo).filter((e) => e.farol === "VERDE");
    expect(verdes.map((e) => e.etapaId)).toEqual(["e1", "e5"]);
  });
});
