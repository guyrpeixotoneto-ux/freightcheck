import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { resolveContext } from "@workspace/comparison";
import { interpretar } from "../interpretacao";
import { planejar } from "../plano";
import { orquestrar } from "../orquestrador";
import { buscarTrechos } from "../corpus";
import { normalizar } from "../normalizar";
import { semearBookDeTeste } from "./fixtures/book";

/**
 * A Fase 6 — as sete razões pelas quais oito perguntas ainda falhavam.
 *
 * A bateria parou em 95/103 depois da Fase 5, e as oito restantes não eram
 * oito defeitos: eram sete, e nenhum deles é "esta frase precisa de um padrão".
 * Cada `describe` abaixo é uma razão, com os casos que ela explica.
 *
 * O que estes testes protegem, além dos casos: que a correção seja da razão.
 * Um vocabulário que conhece "valor" e não conhece "preço" erra em toda
 * pergunta de preço, não só na que a bateria escreveu — e é isso que as
 * variações ao lado de cada caso medem.
 */

const plano = (pergunta: string) =>
  planejar({
    pergunta,
    leitura: interpretar(pergunta),
    assunto: null,
    temConversa: false,
    herdada: null,
    temRegraDoBook: false,
  });

/* ---- R1 ------------------------------------------------------------------ */

describe("R1 — o valor tem mais de um nome", () => {
  /*
    "Qual o preço do combustível em reais?" não casava detector nenhum e caía
    no BOOK por evidência. O detector de VALOR conhecia `valor`, `quanto custa`
    e `quanto está` — e não conhecia a palavra com que se pergunta preço.
  */
  it("preço, custo e tarifa perguntam a mesma coisa que valor", () => {
    for (const pergunta of [
      "Qual o preço do combustível em reais?",
      "Qual o valor do IPVA?",
      "Qual o custo do pneu hoje?",
      "Qual a tarifa de pedágio?",
      "Qual o preço praticado no diesel?",
    ]) {
      expect(plano(pergunta).necessidades, pergunta).toContain("VALOR");
    }
  });

  /* E continua sem roubar a pergunta de quem pede a regra ou o conceito. */
  it("mas não rouba a pergunta de definição nem a de regra", () => {
    expect(plano("O que é preço de combustível?").principal).toBe("CONCEITUAL");
    expect(plano("O que o Book diz sobre preço de combustível?").principal).toBe("BOOK");
  });
});

/* ---- R2 ------------------------------------------------------------------ */

describe("R2 — mudança também se afirma, e também se nega", () => {
  /*
    O detector de MOVIMENTO só conhecia a forma interrogativa: `o que mudou`,
    `teve alteração`, `mudou alguma coisa`. A oração declarativa — "o IPVA
    mudou" — passava batida, e uma pergunta composta perdia a metade que
    trazia o dado.
  */
  it("a oração declarativa é movimento", () => {
    for (const pergunta of [
      "O IPVA mudou e isso está previsto no Book?",
      "O pneu subiu esse mês?",
      "A manutenção caiu em agosto?",
      "O combustível variou desde julho?",
    ]) {
      expect(plano(pergunta).necessidades, pergunta).toContain("MOVIMENTO");
    }
  });

  /*
    E a pergunta pela igualdade é a mesma pergunta pela negativa. Quem escreve
    "tá tudo igual?" quer exatamente o que quem escreve "o que mudou?" quer, e
    recebia DESCONHECIDA — nenhuma consulta, resposta sobre o vazio.
  */
  it("a forma de igualdade é a mesma pergunta", () => {
    for (const pergunta of [
      "tá tudo igual esse mês?",
      "Está tudo igual em agosto?",
      "Ficou tudo na mesma?",
      "Teve algo sem alteração?",
      "continua igual?",
    ]) {
      expect(plano(pergunta).necessidades, pergunta).toContain("MOVIMENTO");
    }
  });
});

/* ---- R3 ------------------------------------------------------------------ */

describe("R3 — quem escreve com pressa continua sendo entendido", () => {
  /*
    `qnt` não é `quanto`, e por isso a pergunta perdia as duas coisas de uma
    vez: a intenção (EVOLUÇÃO virava o plano padrão) e o assunto (`qnt` sobrava
    no candidato e o reconhecimento falhava).

    A correção é de normalização, não de padrão: as abreviações são de palavras
    que já estão na classe fechada das palavras de pergunta.
  */
  it("a abreviação vira a palavra, antes de qualquer detector", () => {
    expect(normalizar("qnt mudou o pneu?")).toBe("quanto mudou o pneu?");
    expect(normalizar("tá tudo igual?")).toBe("esta tudo igual?");
    expect(normalizar("pq isso mudou?")).toBe("porque isso mudou?");
  });

  it("e a pergunta abreviada encontra a mesma necessidade que a escrita", () => {
    expect(plano("qnt mudou o pneu?").necessidades).toEqual(
      plano("quanto mudou o pneu?").necessidades,
    );
    expect(plano("qto custa o IPVA?").necessidades).toContain("VALOR");
  });

  /*
    E o assunto sobrevive: com `qnt` expandido, ele cai na classe fechada e sai
    do candidato, deixando `pneu` sozinho — que é o que a pergunta nomeia.
  */
  it("o assunto sobrevive à abreviação", () => {
    // `qnt` expandido cai na classe fechada e sai do candidato, como `mudou`.
    expect(interpretar("qnt mudou o pneu?").entidades.assuntoCandidato).toBe("pneu");
  });

  /* A expansão é de palavra inteira: ela não pode comer o meio de outra. */
  it("não toca em palavra que só contém a abreviação", () => {
    expect(normalizar("qual a tarifa?")).toBe("qual a tarifa?");
    expect(normalizar("o total da carreta")).toBe("o total da carreta");
  });
});

/* ---- R4 ------------------------------------------------------------------ */

describe("R4 — perguntar de que a remuneração é feita é perguntar a composição", () => {
  /*
    COMPOSIÇÃO conhecia `composicao`, `como se compõe` e `ficha do cavalo`. A
    forma mais comum de fazer a mesma pergunta — "quais parâmetros compõem" —
    não casava nada, e o plano padrão respondia com o movimento do recorte.
  */
  it("a forma em lista é composição", () => {
    for (const pergunta of [
      "Quais parâmetros impactam a remuneração do cavalo?",
      "Quais parâmetros compõem a remuneração?",
      "Que itens entram na remuneração da carreta?",
      "Quais componentes fazem parte da remuneração?",
    ]) {
      const p = plano(pergunta);
      expect([p.principal, ...p.necessidades], pergunta).toContain("COMPOSICAO");
    }
  });
});

/* ---- R5 ------------------------------------------------------------------ */

describe("R5 — a fonte nomeada nomeia a resposta", () => {
  /*
    "Existe alguma regra no Book relacionada a essa alteração?" detecta as duas
    necessidades, e as duas explicitamente: MOVIMENTO pela palavra `alteração`,
    BOOK pela palavra `Book`. A ORDEM fixa decidia por MOVIMENTO, e a resposta
    se chamava pelo que não tinha sido pedido.

    Quem escreve o nome da fonte está dizendo onde quer que se procure.
  */
  it("quem nomeia o Book recebe o Book", () => {
    for (const pergunta of [
      "Existe alguma regra no Book relacionada a essa alteração?",
      "O Book fala dessa alteração?",
      "Essa mudança está prevista no contrato?",
    ]) {
      expect(plano(pergunta).principal, pergunta).toBe("BOOK");
    }
  });

  /*
    E quem não nomeia continua recebendo o que pediu: a regra não pode passar
    a ganhar de tudo só por estar na lista.
  */
  it("e quem não nomeia continua com a necessidade da frase", () => {
    expect(plano("Quais foram as principais alterações de agosto?").principal).toBe("MOVIMENTO");
    expect(plano("O que mudou em agosto?").principal).toBe("MOVIMENTO");
    expect(plano("Compare julho com agosto.").principal).toBe("COMPARACAO");
  });
});

/* ---- R6 ------------------------------------------------------------------ */

describe("R6 — o que o produto não tem não ganha contexto de consolação", () => {
  /*
    "Me dá o CPF do motorista da placa ABC1D23" voltava com o cartão **Motor**
    do catálogo, a 0,800. O casamento inteiro estava em `motorista` começar com
    `motor`: a regra de variante aceitava qualquer prefixo, e um sufixo
    derivacional faz outra palavra.
  */
  it("motorista não é motor", () => {
    const titulos = buscarTrechos("Me dá o CPF do motorista da placa ABC1D23").map(
      (t) => t.trecho.titulo,
    );
    expect(titulos, `voltou: ${titulos.join(" | ")}`).not.toContain("Motor");
  });

  it("e a flexão continua casando", () => {
    // As variantes que a regra existe para aceitar: plural e gênero.
    expect(buscarTrechos("quais vigencias existem?").length).toBeGreaterThan(0);
    expect(buscarTrechos("o que é um parâmetro?").length).toBeGreaterThan(0);
  });

  it("uma pergunta fora do domínio não recebe conceito nenhum", () => {
    expect(buscarTrechos("Me dá o CPF do motorista da placa ABC1D23")).toEqual([]);
    expect(buscarTrechos("Qual o telefone do fornecedor?")).toEqual([]);
  });
});

/* ---- R7, sem banco ------------------------------------------------------- */

const URL_DO_BANCO = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const rodar = URL_DO_BANCO ? describe : describe.skip;

rodar("R7 — o assunto também se reconhece pelo conteúdo, não só pelo título", () => {
  let db: Database;

  beforeAll(async () => {
    ({ db } = createDb(URL_DO_BANCO!));
    expect(await resolveContext(db), "esta suíte precisa de um banco promovido").toBeTruthy();
    await semearBookDeTeste(db);
  });

  /*
    O vocabulário do produto era só de **títulos**: títulos de bloco do Book,
    nomes de cartão do catálogo, rótulos de parâmetro. `recapagem` não é o
    título de nada — é uma palavra que só existe dentro do texto do bloco PNEU,
    escrita por quem redigiu a regra. Reconhecida como "conhecida sem dado",
    ela fechava o portão que existe para `pedágio`, e a pergunta terminava sem
    consultar a gaveta que a responde.

    A ponte não é uma tabela de sinônimos — ela seria infinita e estaria sempre
    atrasada em relação ao que a operação escreve. É o índice da Fase 3, que já
    sabe de que fala cada trecho, e que se atualiza sozinho quando um bloco novo
    é anexado.
  */
  it("uma palavra que só existe dentro do texto do Book chega à gaveta", async () => {
    for (const pergunta of ["Quanto mudou a recapagem?", "O que mudou no sucateamento?"]) {
      const dossie = await orquestrar(db, pergunta);
      expect(
        dossie.plano.alvo?.parametro,
        `${pergunta}: lacunas ${dossie.lacunas.map((l) => l.tipo).join(",")}`,
      ).toBe("Pneu");
      expect(dossie.plano.comoReconheceu, pergunta).toBe("CONTEUDO_DO_BOOK");
      expect(dossie.evidencias.length, pergunta).toBeGreaterThan(0);
    }
  });

  /*
    E as duas guardas continuam de pé, cada uma pelo seu motivo.

    `preventiva` acha MANUTENÇÃO com folga e nenhuma coluna se chama assim de
    forma inequívoca; `pedágio` acha BOOK VALE PEDÁGIO e este export não traz
    pedágio nenhum. Nos dois casos nada é adotado — a segunda guarda (o título
    do bloco tem de resolver para uma gaveta) é o que impede o conteúdo do Book
    de inventar uma resposta.
  */
  it("e o que o Book descreve sem o produto medir continua sendo lacuna", async () => {
    const dossie = await orquestrar(db, "Quanto mudou o pedágio?");
    expect(dossie.lacunas.length, "a ausência tem de ser declarada").toBeGreaterThan(0);
    expect(
      dossie.evidencias.some((e) => e.ferramenta === "resumoDaVigencia"),
      "o agregado do recorte não pode ser apresentado como resposta sobre pedágio",
    ).toBe(false);
  });

  /*
    `diesel` é o caso que mostra onde a ponte **não** deve chegar, e por isso
    ficou aqui.

    A bateria pedia que ela virasse combustível — "sinônimo de domínio", dizia a
    nota. Mas o catálogo do Freightech publica um campo `Diesel destino` que
    **este export não traz**, e as colunas de combustível que ele traz medem
    consumo e capacidade, não o preço do diesel. Responder "o diesel mudou X"
    com elas seria o número certo sobre o assunto errado — exatamente o que o
    portão existe para impedir. A resposta correta é a regra do Book mais a
    declaração de que a coluna não veio.
  */
  it("e diesel recebe a regra e a lacuna, não o número de outra coluna", async () => {
    const dossie = await orquestrar(db, "O que mudou no diesel?");
    expect(dossie.documentos.length, "a regra do Book responde o que dá").toBeGreaterThan(0);
    expect(dossie.lacunas.map((l) => l.tipo)).toContain("CONCEITO_SEM_DADO");
    expect(dossie.evidencias.some((e) => e.ferramenta === "resumoDaVigencia")).toBe(false);
  });
});
