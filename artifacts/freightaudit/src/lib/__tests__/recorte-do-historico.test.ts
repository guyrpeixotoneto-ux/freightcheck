import { describe, expect, it } from "vitest";
import {
  enderecoDoHistorico,
  lerRecorteDoHistorico,
} from "@/lib/recorte-do-historico";
import { consultaDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { enderecoDoCartao } from "@/lib/alteracoes-por-modulo";

/**
 * OS DEEP LINKS DOS CARTÕES — e a única coisa que importa provar neles.
 *
 * Um link de filtro quebra em silêncio: acrescenta-se parâmetro ao endereço, a
 * outra tela não o lê, e ela abre inteira sem erro nenhum. Então o caso central
 * daqui é o **ciclo fechado** — o que `enderecoDoHistorico` escreve,
 * `lerRecorteDoHistorico` lê, e `consultaDoIntervalo` manda ao servidor com o
 * nome que `/changes/range` de fato espera.
 */

const contexto = { scopeHash: "hash-da-unidade", canal: null };

const cartao = {
  rotulo: "FINAME",
  parametrosDoHistorico: ["CUSTO_FIXO|FINAME", "CUSTO_FIXO|Amortização"],
  tipoDoHistorico: null,
  par: { baseData: "2026-07-16", comparadaData: "2026-08-01" },
};

describe("Ver histórico — o que o endereço carrega", () => {
  it("leva unidade, intervalo e o recorte do módulo", () => {
    const q = new URLSearchParams(enderecoDoHistorico(cartao, contexto).split("?")[1]);

    expect(q.get("scopeHash")).toBe("hash-da-unidade");
    /*
      Só a ponta final. Mandar as duas abriria um intervalo de uma comparação
      só — os gráficos de série vazios e o impacto repetindo o número do cartão
      de origem. Um histórico de um passo não é histórico.
    */
    expect(q.get("period")).toBe("2026-08-01");
    expect(q.has("de")).toBe(false);
    expect(q.get("parametros")).toBe("CUSTO_FIXO|FINAME,CUSTO_FIXO|Amortização");
    expect(q.get("recorte")).toBe("FINAME");
  });

  it("a cobertura de trecho leva o tipo — sem ele a leitura o excluiria", () => {
    const endereco = enderecoDoHistorico(
      { ...cartao, rotulo: "Consumo", tipoDoHistorico: "TRECHO" },
      contexto,
    );
    expect(new URLSearchParams(endereco.split("?")[1]).get("tipo")).toBe("TRECHO");
  });

  it("sem recorte a oferecer, o link não promete filtro nenhum", () => {
    /*
      A recusa que importa: acrescentar `parametros=` vazio faria a outra tela
      mostrar o selo de recorte sobre uma leitura inteira.
    */
    const endereco = enderecoDoHistorico(
      { ...cartao, parametrosDoHistorico: [] },
      contexto,
    );
    const q = new URLSearchParams(endereco.split("?")[1]);
    expect(q.has("parametros")).toBe(false);
    expect(q.has("recorte")).toBe(false);
  });

  it("um cartão sem par não inventa ponta nenhuma", () => {
    const q = new URLSearchParams(
      enderecoDoHistorico({ ...cartao, par: null }, contexto).split("?")[1],
    );
    expect(q.has("de")).toBe(false);
    expect(q.has("period")).toBe(false);
  });
});

describe("o ciclo fechado — escrever, ler, e perguntar ao servidor", () => {
  /**
   * O caso que prende o item 9: o filtro **chega** a `/changes/range`, com o
   * nome que aquela rota lê (`parameters`), e não com o nosso (`parametros`).
   */
  it("o que o cartão escreveu vira o recorte que o servidor recebe", () => {
    const endereco = enderecoDoHistorico(cartao, contexto);
    const recorte = lerRecorteDoHistorico(endereco.split("?")[1]);

    /* O botão não nomeia a ponta inicial — o destino abre o histórico inteiro
       até a vigência do cartão. Mas um link que a nomeie continua sendo lido,
       e é o caso logo abaixo. */
    expect(recorte.de).toBeNull();
    expect(recorte.parametros).toEqual([
      "CUSTO_FIXO|FINAME",
      "CUSTO_FIXO|Amortização",
    ]);
    expect(recorte.rotulo).toBe("FINAME");

    const consulta = consultaDoIntervalo(
      new URLSearchParams({ scopeHash: "hash-da-unidade" }),
      "2026-07-16",
      "2026-08-01",
      null,
      recorte.parametros,
    );

    expect(consulta.get("from")).toBe("2026-07-16");
    expect(consulta.get("to")).toBe("2026-08-01");
    /* `parameters`, e não `parametros`: é o nome que `/changes/range` lê. */
    expect(consulta.get("parameters")).toBe("CUSTO_FIXO|FINAME,CUSTO_FIXO|Amortização");
  });

  it("uma ponta inicial nomeada no endereço continua sendo honrada", () => {
    /*
      A capacidade fica: quem monta um link com `de=` — um favorito, um link
      colado de outra conversa — recebe o intervalo que pediu.
    */
    const recorte = lerRecorteDoHistorico("de=2026-01-16&parametros=CUSTO_FIXO%7CFINAME");
    expect(recorte.de).toBe("2026-01-16");
  });

  it("o recorte entra na chave de cache — senão uma leitura mostraria a outra", () => {
    const base = new URLSearchParams({ scopeHash: "h" });
    const inteira = consultaDoIntervalo(base, "2026-07-16", "2026-08-01").toString();
    const recortada = consultaDoIntervalo(base, "2026-07-16", "2026-08-01", null, [
      "CUSTO_FIXO|FINAME",
    ]).toString();

    expect(inteira).not.toBe(recortada);
  });

  it("um recorte vazio não muda a pergunta de sempre", () => {
    const base = new URLSearchParams({ scopeHash: "h" });
    expect(consultaDoIntervalo(base, "a", "b", null, []).toString()).toBe(
      consultaDoIntervalo(base, "a", "b").toString(),
    );
  });

  it("um endereço adulterado cai na leitura inteira, e não numa vazia", () => {
    /*
      A mesma doutrina de `ehTipoDaLinhaDoTempo`: uma data inválida no endereço
      não quebra a tela e — o que importa mais — não a abre vazia, que se
      pareceria com "não houve alteração nenhuma".
    */
    const recorte = lerRecorteDoHistorico("de=ontem&parametros=&recorte=");
    expect(recorte.de).toBeNull();
    expect(recorte.parametros).toEqual([]);
    expect(recorte.rotulo).toBeNull();
  });
});

describe("Ver alterações — a auditoria com o par do cartão", () => {
  it("leva o par do cartão, e não o par de partida da auditoria", () => {
    const endereco = enderecoDoCartao(
      {
        rota: "/custo-fixo-finame",
        par: { baseId: "id-de-julho", comparadaId: "id-de-agosto" },
      },
      contexto,
    );
    const q = new URLSearchParams(endereco.split("?")[1]);
    expect(q.get("base")).toBe("id-de-julho");
    expect(q.get("comparada")).toBe("id-de-agosto");
    expect(q.get("scopeHash")).toBe("hash-da-unidade");
  });

  /**
   * A rota de um assunto do QLP já tem consulta — `?quadro=OPERACIONAL`, que é o
   * que distingue os dois quadros. O par tem de **entrar** nela, e não abrir uma
   * segunda: um endereço com dois `?` abria a auditoria no par de partida dela,
   * com o número da tela diferente do número do cartão e nada dizendo por quê.
   */
  it("um assunto do quadro abre com o par dele, e a consulta da rota sobrevive", () => {
    const doAssunto = enderecoDoCartao(
      {
        rota: "/qlp-modulo/salario?quadro=OPERACIONAL",
        par: { baseId: "junho", comparadaId: "julho" },
      },
      contexto,
    );
    const q = new URLSearchParams(doAssunto.split("?")[1]);
    expect(q.get("comparada")).toBe("julho");
    expect(q.get("base")).toBe("junho");
    expect(q.get("quadro")).toBe("OPERACIONAL");
    expect(doAssunto.split("?")).toHaveLength(2);
  });

  it("sem par, o endereço é a auditoria pura — e não um par inventado", () => {
    const endereco = enderecoDoCartao({ rota: "/custo-fixo-ipva", par: null }, {
      scopeHash: null,
      canal: null,
    });
    expect(endereco).toBe("/custo-fixo-ipva");
  });
});
