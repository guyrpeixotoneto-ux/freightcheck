import { describe, expect, it } from "vitest";
import {
  anosDasVigencias,
  ehModoDeFiname,
  ehRecorteDeTipo,
  enderecoComTroca,
  pontasDoAno,
} from "../finame";
import { consultaDaEvolucao } from "../evolucao-por-placa";

/**
 * A EVOLUÇÃO ANUAL DO FINAME, do lado da tela.
 *
 * O que estes casos prendem não é formatação: é a promessa de que a aba
 * Evolução, posta ao lado de Carreta, não come nada do que estava aberto — e a
 * de que o ano é um atalho para as pontas do intervalo, e não um eixo novo que
 * recorta colunas.
 */

describe("o modo, lido do endereço", () => {
  it("aceita os dois modos e recusa o resto", () => {
    expect(ehModoDeFiname("comparacao")).toBe(true);
    expect(ehModoDeFiname("evolucao")).toBe(true);
    /* Endereço adulterado cai na comparação — a tela que sempre existiu —, e
       nunca numa tela em branco que se pareceria com "não há nada aqui". */
    expect(ehModoDeFiname("evolução")).toBe(false);
    expect(ehModoDeFiname("EVOLUCAO")).toBe(false);
    expect(ehModoDeFiname(null)).toBe(false);
    expect(ehModoDeFiname(undefined)).toBe(false);
  });

  it("aceita os três recortes da evolução e recusa o resto", () => {
    for (const r of ["TODOS", "CAVALO", "CARRETA"]) expect(ehRecorteDeTipo(r)).toBe(true);
    expect(ehRecorteDeTipo("CONJUNTO")).toBe(false);
    expect(ehRecorteDeTipo("TRECHO")).toBe(false);
    expect(ehRecorteDeTipo(null)).toBe(false);
  });
});

describe("os anos do seletor", () => {
  it("saem das vigências que existem, do mais recente ao mais antigo", () => {
    expect(
      anosDasVigencias(["2026-08-01", "2025-12-16", "2026-01-16", "2025-01-16"]),
    ).toEqual(["2026", "2025"]);
  });

  it("ignora o que não é data, em vez de inventar um ano", () => {
    expect(anosDasVigencias(["", "sem data", "2026-03-16"])).toEqual(["2026"]);
    expect(anosDasVigencias([])).toEqual([]);
  });
});

describe("o ano vira as pontas do intervalo", () => {
  const DATAS = [
    "2025-11-16",
    "2025-12-16",
    "2026-01-16",
    "2026-02-16",
    "2026-08-01",
    "2026-08-16",
  ];

  it("parte da última vigência ANTERIOR ao ano, que não entra na soma", () => {
    /* É a decisão central deste atalho. A ponta inicial é referência, não
       período somado (`pontasDoIntervalo`): começar em janeiro jogaria fora a
       transição dezembro→janeiro, que é uma alteração DE 2026. */
    expect(pontasDoAno("2026", DATAS)).toEqual({
      de: "2025-12-16",
      ate: "2026-08-16",
    });
  });

  it("no primeiro ano do acervo, parte da própria primeira vigência", () => {
    /* Não há vigência anterior, e não há comparação antes da primeira: a tela
       perde só a coluna que comparação nenhuma explicaria. */
    expect(pontasDoAno("2025", DATAS)).toEqual({
      de: "2025-11-16",
      ate: "2025-12-16",
    });
  });

  it("não devolve intervalo para um ano sem vigência", () => {
    expect(pontasDoAno("2024", DATAS)).toBeNull();
  });

  it("não recorta colunas: as duas entregas de agosto continuam no intervalo", () => {
    /* O ano escolhe as pontas; quem decide as colunas é `listPeriods`. As duas
       vigências de agosto caem dentro de `de` → `ate` e viram duas colunas. */
    const pontas = pontasDoAno("2026", DATAS)!;
    const dentro = DATAS.filter((d) => d > pontas.de && d <= pontas.ate);
    expect(dentro).toEqual(["2026-01-16", "2026-02-16", "2026-08-01", "2026-08-16"]);
  });
});

describe("a consulta que a evolução manda ao servidor", () => {
  const CONTEXTO = new URLSearchParams({ scopeHash: "ae92", canal: "EMPURRADA" });

  it("leva o universo de atributos, e preserva o contexto", () => {
    const q = consultaDaEvolucao(CONTEXTO, "2025-12-16", "2026-08-16", null, null, null, {
      parameters: ["cavalo.finame_cavalo", "carreta.finame_implemento"],
    });
    expect(q.get("scopeHash")).toBe("ae92");
    expect(q.get("canal")).toBe("EMPURRADA");
    expect(q.get("from")).toBe("2025-12-16");
    expect(q.get("to")).toBe("2026-08-16");
    expect(q.get("parameters")).toBe("cavalo.finame_cavalo,carreta.finame_implemento");
  });

  it("sem universo, não manda a chave — que é o intervalo inteiro", () => {
    expect(consultaDaEvolucao(CONTEXTO, null, null).has("parameters")).toBe(false);
    expect(
      consultaDaEvolucao(CONTEXTO, null, null, null, null, null, { parameters: [] }).has(
        "parameters",
      ),
    ).toBe(false);
  });

  it("o recorte de equipamento vira `tipo`, e Cavalo + Carreta não vira nada", () => {
    expect(
      consultaDaEvolucao(CONTEXTO, null, null, "CAVALO", null, null, {
        parameters: ["cavalo.finame_cavalo"],
      }).get("tipo"),
    ).toBe("CAVALO");
    /* `TODOS` é ausência de recorte, e não um valor: mandá-lo como `tipo` faria
       o servidor procurar um `entity_type` chamado TODOS e devolver nada. */
    expect(consultaDaEvolucao(CONTEXTO, null, null, null).has("tipo")).toBe(false);
  });
});

describe("entrar na Evolução e voltar não custa nada", () => {
  /* O endereço de quem estava auditando Carreta, em Camaçari, no par de
     julho→agosto, com uma variável filtrada e uma busca escrita. */
  const ABERTO =
    "scopeHash=ae92&canal=EMPURRADA&base=jul&comparada=ago&variavel=parcela&busca=QYQ";

  it("entrar na Evolução preserva tudo que estava aberto", () => {
    const destino = enderecoComTroca(ABERTO, { modo: "evolucao" });
    const q = new URLSearchParams(destino.split("?")[1]);

    expect(destino.startsWith("/custo-fixo-finame?")).toBe(true);
    expect(q.get("modo")).toBe("evolucao");
    for (const [chave, valor] of new URLSearchParams(ABERTO)) {
      expect(q.get(chave), chave).toBe(valor);
    }
  });

  it("e voltar devolve exatamente o endereço de origem", () => {
    /* A ida e a volta, encadeadas — que é o gesto real de quem espia a evolução
       e retoma a comparação. Nenhuma chave a mais, nenhuma a menos. */
    const ida = enderecoComTroca(ABERTO, { modo: "evolucao" });
    const dentro = enderecoComTroca(ida.split("?")[1], {
      recorteEvolucao: "CAVALO",
      ano: "2026",
    });
    const volta = enderecoComTroca(dentro.split("?")[1], { modo: null });
    const q = new URLSearchParams(volta.split("?")[1]);

    expect(q.has("modo")).toBe(false);
    for (const [chave, valor] of new URLSearchParams(ABERTO)) {
      expect(q.get(chave), chave).toBe(valor);
    }
    /* O que foi escolhido dentro da Evolução fica guardado para a próxima
       visita — ele não suja a comparação, e não se perde. */
    expect(q.get("recorteEvolucao")).toBe("CAVALO");
    expect(q.get("ano")).toBe("2026");
  });

  it("o recorte da evolução é chave própria: não toca no da comparação", () => {
    const q = new URLSearchParams(
      enderecoComTroca("tipo=CARRETA&modo=evolucao", { recorteEvolucao: "CAVALO" }).split(
        "?",
      )[1],
    );
    expect(q.get("tipo")).toBe("CARRETA");
    expect(q.get("recorteEvolucao")).toBe("CAVALO");
  });

  it("apaga a chave em vez de escrever vazio", () => {
    expect(enderecoComTroca("modo=evolucao", { modo: null })).toBe("/custo-fixo-finame");
    expect(enderecoComTroca("modo=evolucao", { modo: "" })).toBe("/custo-fixo-finame");
  });
});
