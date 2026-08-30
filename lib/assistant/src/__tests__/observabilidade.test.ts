import { describe, expect, it } from "vitest";
import {
  estimarCustoUsd,
  eventosRecentes,
  registrar,
  resumoDaIa,
  type EventoDeIa,
} from "../observabilidade";

/**
 * O que estes testes protegem: a resposta a "por que não foi a IA?".
 *
 * O anel media isto desde sempre dentro do processo, e nada o expunha — então a
 * tela dizia `redação: DETERMINISTICA` para três situações opostas: não há
 * chave, o modelo escreveu e a trava descartou, a chamada falhou. A primeira se
 * resolve na configuração, a segunda no dossiê, a terceira esperando a API
 * voltar. Agora `/assistant/usage` devolve este resumo, e ele precisa contar
 * cada desfecho pelo que ele é.
 */

function evento(
  desfecho: EventoDeIa["desfecho"],
  extra: Partial<EventoDeIa> = {},
) {
  return registrar({
    modelo: "claude-opus-5",
    modeloProvider: null,
    esforco: "medium",
    fluxo: true,
    latenciaMs: 1000,
    tokensEntrada: 1000,
    tokensSaida: 500,
    origemDosTokens: "usage",
    turnosNoHistorico: 0,
    intencao: "BOOK",
    desfecho,
    erro: null,
    ...extra,
  });
}

describe("o anel de chamadas ao modelo", () => {
  it("separa o texto aceito do texto descartado, e os dois do erro", () => {
    evento("IA");
    evento("DESCARTADA");
    evento("DESCARTADA");
    evento("ERRO", { erro: "429 rate limit", tokensSaida: 0 });

    const resumo = resumoDaIa();
    expect(resumo.total).toBe(4);
    /*
      É o número que mais importa: descarte não é o modelo piorando, é o dossiê
      chegando pobre a ele — e ele subindo pede uma ação diferente de erro
      subindo.
    */
    expect(resumo.descartadas).toBe(2);
    expect(resumo.erros).toBe(1);
    expect(resumo.latenciaMediaMs).toBe(1000);
  });

  it("cada evento guarda o desfecho e o erro que o explicam", () => {
    const ultimo = eventosRecentes(1)[0];
    expect(ultimo?.desfecho).toBe("ERRO");
    expect(ultimo?.erro).toBe("429 rate limit");
    expect(ultimo?.em, "o instante da chamada").toBeTruthy();
  });

  it("o limite corta a lista pelos mais recentes", () => {
    expect(eventosRecentes(2)).toHaveLength(2);
    expect(eventosRecentes(2).at(-1)?.desfecho).toBe("ERRO");
  });

  /*
    Um custo estimado apresentado como medido é o mesmo defeito que este produto
    existe para não cometer com número de frete: `origemDosTokens` diz qual dos
    dois está sendo lido, e o preço sai da tabela do modelo que respondeu.
  */
  it("cobra pelo preço do modelo, e um modelo desconhecido erra para cima", () => {
    expect(estimarCustoUsd("claude-opus-5", 1_000_000, 1_000_000)).toBe(30);
    expect(estimarCustoUsd("claude-haiku-4-5", 1_000_000, 1_000_000)).toBe(6);
    expect(estimarCustoUsd("modelo-que-nao-existe", 1_000_000, 1_000_000)).toBe(
      30,
    );
  });
});
