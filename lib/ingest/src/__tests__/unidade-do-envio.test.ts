import { describe, expect, it } from "vitest";
import {
  cnpjDoEscopo,
  conferirUnidadeDoEnvio,
  identidadeDoEscopo,
  type EscopoDoArquivo,
  type UnidadeCadastrada,
} from "../unidade-do-envio";

/**
 * As regras que decidem de qual unidade é um arquivo — e as que **não** decidem.
 *
 * O caso que este arquivo guarda é o que motivou tudo: o acervo de CAMAÇARI
 * importado de dentro de CAMAÇARI, e a tela de Ativos e Parados mandando
 * associar à mão o vínculo que a importação tinha em mãos. A metade positiva
 * disso é a das primeiras asserções; a metade que importa mais é a última
 * seção, onde o nome continua não decidindo nada.
 */

const CAMACARI: UnidadeCadastrada = {
  id: "11111111-1111-1111-1111-111111111111",
  nome: "CAMAÇARI",
  cnpj: "07526557001505",
};
const RECIFE: UnidadeCadastrada = {
  id: "22222222-2222-2222-2222-222222222222",
  nome: "CDD RECIFE",
  cnpj: "03134910000236",
};

const escopo = (partes: Partial<EscopoDoArquivo>): EscopoDoArquivo => ({
  code: "07526557001505_CERV",
  nome: "CAMAÇARI",
  unidadePorCnpj: null,
  ...partes,
});

describe("o CNPJ dentro do código do escopo", () => {
  /*
    O código que o export traz não é um CNPJ limpo: ele vem com o sufixo da
    unidade de negócio colado — `07526557001505_CERV` é o que está gravado em
    `scope.code` no acervo de verdade. Ler o documento de dentro dele é a faixa
    que resolve o caso real, e é por isso que ela abre o arquivo.
  */
  it("lê o documento mesmo com o sufixo colado", () => {
    expect(cnpjDoEscopo("07526557001505_CERV")).toBe("07526557001505");
  });

  it("lê o documento mascarado, que é como a planilha às vezes o escreve", () => {
    expect(cnpjDoEscopo("07.526.557/0015-05")).toBe("07526557001505");
  });

  it("recusa o que não identifica ninguém", () => {
    expect(cnpjDoEscopo("CDD Belém")).toBeNull();
    expect(cnpjDoEscopo("443")).toBeNull();
    expect(cnpjDoEscopo("")).toBeNull();
    /* Onze dígitos é CPF, e catorze repetidos não são o CNPJ de ninguém. */
    expect(cnpjDoEscopo("12345678901")).toBeNull();
    expect(cnpjDoEscopo("00000000000000")).toBeNull();
    /* Um dígito trocado: o verificador não fecha, e a recusa é o certo. */
    expect(cnpjDoEscopo("07526557001506")).toBeNull();
  });
});

describe("de qual unidade cadastrada é este escopo", () => {
  it("é a do CNPJ, quando o código carrega um", () => {
    expect(
      identidadeDoEscopo(escopo({ unidadePorCnpj: CAMACARI }), null),
    ).toEqual({ unidade: CAMACARI, como: "CNPJ_DO_ESCOPO" });
  });

  it("é a do envio, quando o código não carrega documento nenhum", () => {
    expect(
      identidadeDoEscopo(escopo({ code: "443", nome: "CAMAÇARI" }), CAMACARI),
    ).toEqual({ unidade: CAMACARI, como: "UNIDADE_DO_ENVIO" });
  });

  /*
    A ordem entre as duas faixas, exercitada onde ela aparece: o documento vence
    a declaração. Não é preferência — é que a declaração discordando do
    documento não é empate, é conflito, e quem o pega é `conferirUnidadeDoEnvio`
    antes de qualquer coisa ser gravada. Se esta asserção inverter um dia, o
    arquivo de Recife entra gravado como CAMAÇARI.
  */
  it("prefere o documento à declaração", () => {
    expect(identidadeDoEscopo(escopo({ unidadePorCnpj: RECIFE }), CAMACARI))
      .toEqual({ unidade: RECIFE, como: "CNPJ_DO_ESCOPO" });
  });

  it("não responde quando nem o documento nem a declaração dizem — e é o certo", () => {
    expect(identidadeDoEscopo(escopo({ code: "443", nome: "CAMAÇARI" }), null))
      .toBeNull();
  });

  /*
    ---------------------------------------------------------------------------
    A parte que mais importa: o nome continua não decidindo nada
    ---------------------------------------------------------------------------

    O escopo se chama CAMAÇARI, a unidade cadastrada se chama CAMAÇARI, e a
    resposta é `null`. Dois CDDs podem chamar-se igual, e a frota de um
    desenhada sob o nome do outro é o estrago que este produto inteiro se
    organiza para não cometer. Esta asserção é a que impede alguém de "melhorar"
    a função acrescentando uma comparação de nome no dia em que uma unidade sem
    CNPJ der trabalho.
  */
  it("não associa por nome igual, nem quando os dois nomes são a mesma palavra", () => {
    const semDocumento = escopo({ code: "CAMAÇARI", nome: "CAMAÇARI" });
    expect(identidadeDoEscopo(semDocumento, null)).toBeNull();
  });
});

describe("o arquivo é da unidade que quem enviou tinha aberta?", () => {
  it("se cala quando ninguém declarou unidade — o envio da Visão Geral", () => {
    expect(
      conferirUnidadeDoEnvio({
        declarada: null,
        escopos: [escopo({ unidadePorCnpj: RECIFE })],
      }),
    ).toBeNull();
  });

  it("aceita o arquivo da própria unidade", () => {
    expect(
      conferirUnidadeDoEnvio({
        declarada: CAMACARI,
        escopos: [escopo({ unidadePorCnpj: CAMACARI })],
      }),
    ).toBeNull();
  });

  it("aceita o código sem documento — é o caso em que a declaração responde", () => {
    expect(
      conferirUnidadeDoEnvio({
        declarada: CAMACARI,
        escopos: [escopo({ code: "443", nome: "CAMAÇARI" })],
      }),
    ).toBeNull();
  });

  it("recusa o arquivo de outra unidade, e diz de quem ele é", () => {
    const recusa = conferirUnidadeDoEnvio({
      declarada: CAMACARI,
      escopos: [escopo({ code: RECIFE.cnpj!, nome: "CDD RECIFE", unidadePorCnpj: RECIFE })],
    });
    expect(recusa?.motivo).toBe("CONFLITO");
    expect(recusa?.resumo).toContain("CAMAÇARI");
    expect(recusa?.resumo).toContain("CDD RECIFE");
    /* A saída é a casa certa, e ela está na frase — não num apontamento adiante. */
    expect(recusa?.comoCorrigir).toContain("CDD RECIFE");
  });

  /*
    O consolidado de várias unidades continua sendo um arquivo legítimo — é o
    export normal da Ambev. O que ele não pode é entrar **por dentro de uma**,
    porque dali ele afirmaria que as cinco são aquela. A saída oferecida é a
    Visão Geral, e ela precisa estar escrita: sem isso, quem enviou fica com uma
    recusa e nenhum caminho.
  */
  it("recusa o consolidado mandado de dentro de uma unidade, e oferece a Visão Geral", () => {
    const recusa = conferirUnidadeDoEnvio({
      declarada: CAMACARI,
      escopos: [
        escopo({ unidadePorCnpj: CAMACARI }),
        escopo({ code: RECIFE.cnpj!, nome: "CDD RECIFE", unidadePorCnpj: RECIFE }),
      ],
    });
    expect(recusa?.motivo).toBe("MULTIPLA");
    expect(recusa?.encontradas).toEqual(["CAMAÇARI", "CDD RECIFE"]);
    expect(recusa?.comoCorrigir).toContain("Visão Geral");
  });

  it("se cala quando o arquivo não traz escopo de unidade nenhum", () => {
    /*
      É o acervo Real: o extrato do ERP não traz CNPJ, e quem o supre é
      `declared_unidade`. Não há o que conferir, e inventar uma divergência aqui
      recusaria todo envio daquele acervo.
    */
    expect(conferirUnidadeDoEnvio({ declarada: CAMACARI, escopos: [] })).toBeNull();
  });
});
