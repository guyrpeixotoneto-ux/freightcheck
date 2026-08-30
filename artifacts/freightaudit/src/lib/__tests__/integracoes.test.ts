import { describe, expect, it } from "vitest";
import {
  EXPLICACAO_DA_BUSCA,
  EXPLICACAO_DO_ESTADO,
  chavesVivas,
  estadoDa,
  estadoDaBusca,
  intervaloEmPalavras,
  quando,
  type BuscaAtiva,
  type Integracao,
} from "@/lib/integracoes";

/**
 * O estado que a tela mostra é lido, e nunca chutado.
 *
 * O que este arquivo prende é a diferença entre as situações que se parecem na
 * lista e não se parecem na mesa de quem opera: uma integração sem chave, uma
 * com chave que ninguém usou e uma que está apanhando 403 há um dia pedem três
 * consertos diferentes, e uma tela que as pintasse igual mandaria procurar o
 * problema no lugar errado.
 */

const base: Integracao = {
  id: "i-1",
  nome: "Freightec",
  sistema: "Freightec",
  descricao: null,
  criadaEm: "2026-08-01T12:00:00.000Z",
  criadaPor: "alguem@empresa.com",
  desativadaEm: null,
  desativadaPor: null,
  chaves: [
    {
      id: "c-1",
      prefixo: "fck_a1b2c3d4e5f6",
      apelido: null,
      escopos: ["importacoes:enviar"],
      criadaEm: "2026-08-01T12:00:00.000Z",
      criadaPor: "alguem@empresa.com",
      ultimaChamadaEm: null,
      revogadaEm: null,
      revogadaPor: null,
    },
  ],
  ultimas24h: { ok: 0, recusadas: 0, falhas: 0 },
  ultimaChamadaEm: null,
};

describe("o estado de uma integração", () => {
  it("desativada responde antes de tudo — ela explica o resto", () => {
    const i: Integracao = {
      ...base,
      desativadaEm: "2026-08-20T10:00:00.000Z",
      chaves: [],
      ultimas24h: { ok: 0, recusadas: 9, falhas: 0 },
    };
    expect(estadoDa(i)).toBe("DESATIVADA");
  });

  it("chave revogada não conta como chave", () => {
    const i: Integracao = {
      ...base,
      chaves: [{ ...base.chaves[0], revogadaEm: "2026-08-20T10:00:00.000Z" }],
    };
    expect(chavesVivas(i)).toEqual([]);
    expect(estadoDa(i)).toBe("SEM_CHAVE");
  });

  it("com chave e sem chamada nenhuma, o estado diz isso e não 'com problema'", () => {
    expect(estadoDa(base)).toBe("NUNCA_CHAMOU");
  });

  /*
    A leitura conservadora: uma recusa no meio de chamadas atendidas é a
    duplicata do agendador que reenviou o mesmo arquivo, e não uma integração
    quebrada. Pintar isso de vermelho ensina a ignorar o vermelho.
  */
  it("recusa junto com sucesso continua sendo integração ativa", () => {
    const i: Integracao = {
      ...base,
      ultimaChamadaEm: "2026-08-30T09:00:00.000Z",
      ultimas24h: { ok: 3, recusadas: 1, falhas: 0 },
    };
    expect(estadoDa(i)).toBe("ATIVA");
  });

  it("só é RECUSANDO quando nenhuma chamada do dia foi atendida", () => {
    const i: Integracao = {
      ...base,
      ultimaChamadaEm: "2026-08-30T09:00:00.000Z",
      ultimas24h: { ok: 0, recusadas: 4, falhas: 1 },
    };
    expect(estadoDa(i)).toBe("RECUSANDO");
  });

  it("todo estado tem uma frase que diz o que fazer", () => {
    for (const estado of Object.keys(EXPLICACAO_DO_ESTADO)) {
      expect(EXPLICACAO_DO_ESTADO[estado as keyof typeof EXPLICACAO_DO_ESTADO]).not.toBe("");
    }
  });
});

describe("as datas", () => {
  it("ausência vira travessão, e não 'Invalid Date'", () => {
    expect(quando(null)).toBe("—");
  });

  it("uma data real vira dia e hora legíveis", () => {
    expect(quando("2026-08-30T12:34:00.000Z")).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

const buscaBase: BuscaAtiva = {
  id: "b-1",
  nome: "Export diário",
  url: "https://api.fornecedor.com/vigencia.xlsx",
  metodo: "GET",
  tipoDeclarado: "FRETE",
  intervaloMinutos: 60,
  temCredencial: true,
  forma: "BEARER",
  proximaEm: "2026-08-30T13:00:00.000Z",
  pausadaEm: null,
  pausadaPor: null,
  criadaEm: "2026-08-01T12:00:00.000Z",
  criadaPor: "alguem@empresa.com",
  ultima: null,
};

const execucao = (resultado: string): BuscaAtiva["ultima"] => ({
  id: "e-1",
  em: "2026-08-30T12:00:00.000Z",
  disparo: "AGENDA",
  resultado,
  statusHttp: 200,
  duracaoMs: 120,
  bytes: 4096,
  motivo: null,
  importRunId: null,
});

describe("o estado de uma busca ativa", () => {
  it("pausada responde antes de tudo", () => {
    expect(
      estadoDaBusca({
        ...buscaBase,
        pausadaEm: "2026-08-20T10:00:00.000Z",
        ultima: execucao("FALHA"),
      }),
    ).toBe("PAUSADA");
  });

  it("cadastrada e nunca executada diz isso, e não 'em dia'", () => {
    expect(estadoDaBusca(buscaBase)).toBe("NUNCA_EXECUTOU");
  });

  it("recusa e falha são a mesma leitura para quem opera: está falhando", () => {
    expect(estadoDaBusca({ ...buscaBase, ultima: execucao("RECUSADA") })).toBe("FALHANDO");
    expect(estadoDaBusca({ ...buscaBase, ultima: execucao("FALHA") })).toBe("FALHANDO");
  });

  /*
    O caso que não pode virar vermelho: uma agenda que busca de hora em hora
    contra um arquivo que muda uma vez por mês passa o mês inteiro assim, e isso
    é ela funcionando.
  */
  it("arquivo repetido é estado próprio, e não problema", () => {
    expect(estadoDaBusca({ ...buscaBase, ultima: execucao("SEM_NOVIDADE") })).toBe(
      "SEM_NOVIDADE",
    );
    expect(estadoDaBusca({ ...buscaBase, ultima: execucao("OK") })).toBe("EM_DIA");
  });

  it("todo estado tem uma frase que diz o que ele quer dizer", () => {
    for (const frase of Object.values(EXPLICACAO_DA_BUSCA)) expect(frase).not.toBe("");
  });
});

describe("o intervalo em palavras", () => {
  it.each([
    [15, "a cada 15 minutos"],
    [60, "a cada hora"],
    [360, "a cada 6 horas"],
    [1440, "uma vez por dia"],
    [2880, "a cada 2 dias"],
  ])("%i minutos vira %s", (minutos, esperado) => {
    expect(intervaloEmPalavras(minutos)).toBe(esperado);
  });
});
