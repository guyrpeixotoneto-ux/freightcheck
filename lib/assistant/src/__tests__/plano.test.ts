import { describe, expect, it } from "vitest";
import { detectar, planejar, type Necessidade } from "../plano";
import { interpretar } from "../interpretacao";

/**
 * O plano de investigação, sem banco e sem rede.
 *
 * O que estes casos protegem é a propriedade que a Fase 2 introduziu: **uma
 * pergunta pode precisar de mais de uma coisa, e nenhuma necessidade exclui as
 * outras**. Um teste que só verificasse a necessidade principal continuaria
 * passando com o desenho antigo — era exatamente isso que a classificação por
 * intenção única fazia bem.
 */

function plano(
  pergunta: string,
  opcoes: {
    assunto?: string | null;
    temConversa?: boolean;
    herdada?: Necessidade | null;
    regraForte?: boolean;
  } = {},
) {
  return planejar({
    pergunta,
    leitura: interpretar(pergunta),
    assunto: opcoes.assunto ?? null,
    temConversa: opcoes.temConversa ?? false,
    herdada: opcoes.herdada ?? null,
    temRegraDoBook: opcoes.regraForte ?? false,
  });
}

describe("uma pergunta pode precisar de duas coisas", () => {
  it("dado e regra saem juntos quando a frase pede os dois", () => {
    const p = plano("Teve alteração na remuneração de pneu e existe alguma regra do Book relacionada?");
    expect(p.necessidades).toContain("MOVIMENTO");
    expect(p.necessidades).toContain("BOOK");
  });

  it("o movimento dá nome quando ele foi pedido, e o ranking vai junto", () => {
    const p = plano("Quais foram as principais alterações de agosto?");
    expect(p.principal).toBe("MOVIMENTO");
    expect(p.necessidades).toContain("RANKING_PERDA");
  });

  it("dois meses citados viram comparação sem o verbo comparar", () => {
    const p = plano("julho e agosto no pneu");
    expect(p.necessidades).toContain("COMPARACAO");
  });
});

describe("a família executiva", () => {
  const executivas = [
    "Me diga apenas o que merece minha atenção.",
    "Tem alguma coisa fora do padrão?",
    "O que eu deveria investigar primeiro?",
    "Resuma agosto para a diretoria.",
    "Vale a pena eu me preocupar com alguma coisa?",
  ];

  it.each(executivas)("%s pede o movimento e o que pesou", (pergunta) => {
    const p = plano(pergunta);
    expect(p.necessidades).toContain("MOVIMENTO");
    expect(p.necessidades).toContain("RANKING_PERDA");
  });

  it("nenhuma delas fica sem plano", () => {
    for (const pergunta of executivas) {
      expect(plano(pergunta).necessidades).not.toEqual(["DESCONHECIDA"]);
    }
  });
});

describe("o plano padrão só vale para pergunta deste produto", () => {
  it("uma pergunta ancorada por período investiga o recorte", () => {
    const p = plano("Resuma agosto");
    expect(p.ancorada).toBe(true);
    expect(p.necessidades).toContain("MOVIMENTO");
  });

  it("uma pergunta ancorada por assunto investiga o recorte", () => {
    const p = plano("e o pneu", { assunto: "pneu" });
    expect(p.ancorada).toBe(true);
    expect(p.necessidades).not.toEqual(["DESCONHECIDA"]);
  });

  /*
    A guarda que impede o constrangimento: responder com números verdadeiros a
    uma pergunta que não é deste produto.
  */
  it("uma pergunta de fora não ganha consulta nenhuma", () => {
    const p = plano("Qual a previsão do tempo em Salvador?");
    expect(p.ancorada).toBe(false);
    expect(p.necessidades).toEqual(["DESCONHECIDA"]);
  });
});

describe("o plano reage ao que foi recuperado", () => {
  it("uma regra forte define a pergunta que nenhum detector nomeou", () => {
    const p = plano("Posso somar parcelas mensais e por km?", { regraForte: true });
    expect(p.principal).toBe("BOOK");
    expect(p.bookPorEvidencia).toBe(true);
  });

  it("sem regra forte, a mesma pergunta não vira pergunta de Book", () => {
    const p = plano("Posso somar parcelas mensais e por km?", { regraForte: false });
    expect(p.necessidades).not.toContain("BOOK");
  });

  /*
    A regra recuperada é evidência mais fraca do que uma necessidade que a
    própria frase declarou — senão toda pergunta de número que por acaso casasse
    uma regra viraria uma pergunta de Book.
  */
  it("a regra não rouba o nome de quem pediu número", () => {
    const p = plano("Quanto mudou o pneu desde dezembro?", { regraForte: true });
    expect(p.principal).toBe("EVOLUCAO");
  });

  it("e não rouba o nome de quem pediu a origem", () => {
    const p = plano("Por quê?", { regraForte: true, temConversa: true, herdada: "MOVIMENTO" });
    expect(p.principal).toBe("PROCEDENCIA");
  });
});

describe("a conversa continua quando a frase não diz o que quer", () => {
  it("herda a necessidade do fio em vez de investigar do zero", () => {
    const p = plano("e a carreta?", { temConversa: true, herdada: "VALOR" });
    expect(p.necessidades).toContain("VALOR");
  });
});

describe("a ordem entre detectores não decide mais onde procurar", () => {
  it("todos os detectores que casam aparecem", () => {
    const achados = detectar("Qual a regra do bloco PNEU?");
    expect(achados).toContain("BOOK");
    expect(achados).toContain("CONCEITUAL");
  });

  it("a regra ganha o nome quando a pergunta pede a regra", () => {
    expect(plano("Qual a regra do bloco PNEU?").principal).toBe("BOOK");
  });

  it("o conceito ganha quando a pergunta é sobre uma tela com nome próprio", () => {
    expect(plano("para que serve a curadoria?").principal).toBe("CONCEITUAL");
  });

  it("a negação de preço é pendência, não disponibilidade", () => {
    expect(plano("Quais parâmetros não têm preço suficiente?").principal).toBe("SEM_PRECO");
  });
});

describe("saudação continua não planejando nada", () => {
  it("não investiga e não ancora", () => {
    const p = plano("bom dia");
    expect(p.necessidades).toEqual(["SAUDACAO"]);
    expect(p.ancorada).toBe(false);
  });
});
