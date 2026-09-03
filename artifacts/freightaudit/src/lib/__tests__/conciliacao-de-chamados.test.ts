import { describe, expect, it } from "vitest";
import {
  avisoDaConciliacao,
  barrasDaSituacao,
  enderecoDasLinhas,
  pendencias,
  percentualConciliado,
  rotuloDaComparacao,
  rotuloDoEnvio,
  type ResumoDaConciliacao,
} from "@/lib/conciliacao-de-chamados";

/**
 * As contas da Conciliação de Chamados.
 *
 * A tela afirma quatro coisas na cara de quem opera — quanto está conciliado,
 * quanto não está, quantas alterações cada lado trouxe e se os dois lados
 * sequer falam da mesma unidade. O que este arquivo prende é que nenhuma delas
 * se deixa mentir pelos três estados em que uma leitura mal desenhada mentiria:
 * **sem resposta ainda**, **sem material de um dos lados** e **material dos
 * dois, mas de unidades diferentes**.
 */

function resumo(parcial: Partial<ResumoDaConciliacao> = {}): ResumoDaConciliacao {
  return {
    changeSetId: "cs",
    ticketImportId: "ti",
    planilha: { alteracoes: 10, pares: 10, placas: 4, foraDaConciliacao: 0 },
    chamados: { alteracoes: 8, pares: 8, placas: 3, foraDaConciliacao: 0 },
    pares: 12,
    conciliadas: 6,
    divergentes: 2,
    semChamado: 3,
    semAlteracao: 1,
    diferenca: 2,
    placasEmComum: 3,
    tipos: [{ entityType: "CAVALO", pares: 12 }],
    ...parcial,
  };
}

describe("a barra de conciliação", () => {
  it("mede sobre o par, e não sobre a alteração da planilha", () => {
    /*
      Seis conciliadas de doze pares é 50%. Medido sobre as dez alterações da
      planilha daria 60% — um número que sobe justamente quando a fila do outro
      lado cresce, que é o defeito que o denominador por par existe para evitar.
    */
    expect(percentualConciliado(resumo())).toBe(50);
  });

  it("devolve zero sem par nenhum, e não NaN", () => {
    expect(
      percentualConciliado(resumo({ pares: 0, conciliadas: 0 })),
    ).toBe(0);
  });

  it("não inventa número enquanto a resposta não chegou", () => {
    expect(percentualConciliado(null)).toBe(0);
    expect(pendencias(null)).toBeNull();
  });

  it("conta como pendência tudo o que não está conciliado", () => {
    /* Divergente, sem chamado e sem alteração: as três são trabalho. */
    expect(pendencias(resumo())).toBe(6);
  });
});

describe("as quatro barras", () => {
  it("aparecem sempre as quatro, mesmo zeradas", () => {
    const barras = barrasDaSituacao(resumo({ divergentes: 0 }));
    expect(barras.map((b) => b.situacao)).toEqual([
      "CONCILIADA",
      "DIVERGENTE",
      "SEM_CHAMADO",
      "SEM_ALTERACAO",
    ]);
    expect(barras.find((b) => b.situacao === "DIVERGENTE")!.pares).toBe(0);
  });

  it("soma cem por cento entre elas", () => {
    const barras = barrasDaSituacao(resumo());
    const total = barras.reduce((soma, b) => soma + b.proporcao, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("abre zerada, e não quebrada, antes da resposta", () => {
    const barras = barrasDaSituacao(null);
    expect(barras).toHaveLength(4);
    expect(barras.every((b) => b.pares === 0 && b.proporcao === 0)).toBe(true);
  });
});

describe("o aviso", () => {
  it("cala quando os dois lados têm material e se encontram", () => {
    expect(avisoDaConciliacao(resumo())).toBeNull();
  });

  /*
    O caso que motivou o aviso: os dois lados cheios e nenhuma placa em comum. É
    o retrato de conciliar o envio de uma unidade contra a vigência de outra, e
    sem ele a tela publicaria dezenas de pendências que não são pendências.
  */
  it("denuncia unidades diferentes por placas em comum, e não por palpite", () => {
    expect(avisoDaConciliacao(resumo({ placasEmComum: 0 }))).toBe(
      "UNIDADES_DIFERENTES",
    );
  });

  it("distingue lado vazio de unidade errada", () => {
    expect(
      avisoDaConciliacao(
        resumo({
          chamados: { alteracoes: 0, pares: 0, placas: 0, foraDaConciliacao: 4 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("SEM_CHAMADOS");

    expect(
      avisoDaConciliacao(
        resumo({
          planilha: { alteracoes: 0, pares: 0, placas: 0, foraDaConciliacao: 0 },
          placasEmComum: 0,
        }),
      ),
    ).toBe("SEM_ALTERACOES");
  });

  it("não avisa nada enquanto a resposta não chegou", () => {
    expect(avisoDaConciliacao(null)).toBeNull();
  });
});

describe("o endereço da lista", () => {
  const base = {
    escopo: "hash-da-unidade",
    serie: undefined as string | null | undefined,
    changeSetId: "cs-1",
    ticketImportId: "ti-1",
    somenteVigenciaComparada: false,
    situacao: null,
    tipo: null,
    busca: "",
    pagina: 1,
    porPagina: 50,
  };

  it("leva o recorte inteiro, e a unidade aberta junto", () => {
    const q = new URLSearchParams(enderecoDasLinhas(base).split("?")[1]);
    expect(q.get("scopeHash")).toBe("hash-da-unidade");
    expect(q.get("changeSetId")).toBe("cs-1");
    expect(q.get("ticketImportId")).toBe("ti-1");
    expect(q.get("limit")).toBe("50");
    expect(q.get("offset")).toBe("0");
    /* O que não foi escolhido não vira parâmetro: um filtro vazio no endereço é
       um filtro que o servidor teria de aprender a ignorar. */
    expect(q.has("situacao")).toBe(false);
    expect(q.has("search")).toBe(false);
    expect(q.has("somenteVigenciaComparada")).toBe(false);
    /* Série `undefined` é "todas": ela não vira parâmetro. */
    expect(q.has("serie")).toBe(false);
  });

  /*
    A unidade dos chamados viaja como série, e a série **indeterminada** viaja
    como rótulo — nunca como parâmetro vazio. Um `?serie=` em branco não
    distingue "sem recorte" de "os envios que não disseram de onde vieram", e as
    duas coisas dão telas diferentes.
  */
  it("distingue a série indeterminada de não ter recorte de série", () => {
    const comUnidade = new URLSearchParams(
      enderecoDasLinhas({ ...base, serie: "CAMAÇARI" }).split("?")[1],
    );
    expect(comUnidade.get("serie")).toBe("CAMAÇARI");

    const indeterminada = new URLSearchParams(
      enderecoDasLinhas({ ...base, serie: null }).split("?")[1],
    );
    expect(indeterminada.get("serie")).toBe("@sem-serie");
  });

  it("traduz a página em offset", () => {
    const q = new URLSearchParams(
      enderecoDasLinhas({ ...base, pagina: 3 }).split("?")[1],
    );
    expect(q.get("offset")).toBe("100");
  });

  it("manda a busca sem os espaços das pontas, e só quando há busca", () => {
    const comEspaco = new URLSearchParams(
      enderecoDasLinhas({ ...base, busca: "  AAA1A11 " }).split("?")[1],
    );
    expect(comEspaco.get("search")).toBe("AAA1A11");

    const soEspaco = new URLSearchParams(
      enderecoDasLinhas({ ...base, busca: "   " }).split("?")[1],
    );
    expect(soEspaco.has("search")).toBe(false);
  });
});

describe("os rótulos do seletor", () => {
  /*
    A unidade abre o rótulo do envio porque é o que decide se ele serve: dois
    envios do mesmo dia costumam ser unidades diferentes, e um seletor sem ela
    ofereceria duas linhas indistinguíveis para a única escolha que importa.
  */
  it("nomeia a unidade do envio antes do arquivo", () => {
    expect(
      rotuloDoEnvio({
        id: "ti",
        filename: "Chamados_CAMACARI.xlsx",
        receivedAt: "2026-09-03T00:00:00.000Z",
        ticketCount: 4,
        serie: "CAMAÇARI",
      }),
    ).toMatch(/^CAMAÇARI · Chamados_CAMACARI\.xlsx — /);
  });

  it("diz que o arquivo não nomeou unidade, em vez de deixar em branco", () => {
    expect(
      rotuloDoEnvio({
        id: "ti",
        filename: "Chamados.xlsx",
        receivedAt: "2026-09-03T00:00:00.000Z",
        ticketCount: 4,
        serie: null,
      }),
    ).toMatch(/^sem unidade no arquivo · /);
  });

  it("lê a comparação como uma seta, da vigência anterior para a nova", () => {
    expect(
      rotuloDaComparacao({
        id: "cs",
        rotuloA: "2026-07",
        rotuloB: "2026-08",
        dataB: "2026-08-01",
        scopeHash: null,
      }),
    ).toBe("2026-07 → 2026-08");
  });

  it("não deixa buraco quando um dos lados não tem rótulo", () => {
    expect(
      rotuloDaComparacao({
        id: "cs",
        rotuloA: null,
        rotuloB: "2026-08",
        dataB: null,
        scopeHash: null,
      }),
    ).toBe("? → 2026-08");
  });
});
