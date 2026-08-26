import { describe, expect, it } from "vitest";
import {
  enderecoDaLista,
  rotuloDoTipo,
  tipoDaLeitura,
  tiposParaLerNoAmbiente,
  TIPO_NAO_INFORMADO,
  TIPOS_DE_OPERACAO,
  TIPOS_PARA_LER,
} from "../fechamento";

/**
 * Abrir e consultar pedem listas diferentes de Tipo — e a diferença é o defeito
 * que este arquivo prende.
 *
 * Quem **abre** não pode escolher `NAO_INFORMADO`: seria dizer "não sei" num
 * campo que a operação decidiu que é obrigatório, e o servidor o recusa na
 * porta (`normalizarTipoDeOperacao`, em `@workspace/fechamento`). Quem
 * **consulta** precisa alcançá-lo: todo fechamento aberto antes da `0046`
 * carrega esse carimbo, porque o backfill não adivinhou de qual operação cada
 * um era. Um seletor de leitura com a lista de abertura deixa o acervo inteiro
 * sem endereço — a unidade certa, a transportadora certa, o mês certo, e mesmo
 * assim nada na tela.
 */

describe("as duas listas de Tipo", () => {
  it("abrir oferece só os tipos que alguém pode declarar", () => {
    expect(TIPOS_DE_OPERACAO.map((t) => t.valor)).toEqual([
      "EMPURRADA",
      "ROTA",
      "AS",
      "APOIO",
    ]);
  });

  it("abrir nunca oferece o carimbo do backfill", () => {
    expect(TIPOS_DE_OPERACAO.some((t) => t.valor === TIPO_NAO_INFORMADO)).toBe(false);
  });

  it("consultar alcança tudo que o banco pode ter, o carimbo inclusive", () => {
    expect(TIPOS_PARA_LER.map((t) => t.valor)).toEqual([
      "EMPURRADA",
      "ROTA",
      "AS",
      "APOIO",
      TIPO_NAO_INFORMADO,
    ]);
  });

  it("ler é um superconjunto de abrir: nenhum tipo que se abre fica sem consulta", () => {
    for (const t of TIPOS_DE_OPERACAO) {
      expect(TIPOS_PARA_LER.some((l) => l.valor === t.valor)).toBe(true);
    }
  });
});

describe("rotuloDoTipo", () => {
  it("escreve o carimbo por extenso, e não como se fosse uma operação", () => {
    expect(rotuloDoTipo(TIPO_NAO_INFORMADO)).toBe("Não informado");
  });

  it("escreve os tipos reais como a tela os mostra", () => {
    expect(rotuloDoTipo("EMPURRADA")).toBe("Empurrada");
    expect(rotuloDoTipo("ROTA")).toBe("Rota");
    /*
      "AS" fica em caixa alta porque é sigla, e não palavra: escrito "As" ele
      vira o artigo, e o seletor passaria a oferecer um rótulo que ninguém
      reconhece.
    */
    expect(rotuloDoTipo("AS")).toBe("AS");
    expect(rotuloDoTipo("APOIO")).toBe("Apoio");
  });

  it("devolve o valor cru para um tipo que ainda não tem rótulo, sem inventar um", () => {
    expect(rotuloDoTipo("TRANSFERENCIA")).toBe("TRANSFERENCIA");
  });
});

/**
 * O terceiro recorte de Tipo: o que uma tela de **leitura** oferece dentro de um
 * ambiente.
 *
 * Rota, Empurrada, AS e Apoio são fechamentos distintos, e o seletor que
 * oferecia todos os tipos em qualquer um deles deixava a tela desmentir a porta
 * pela qual a pessoa entrou — o Fechamento Rota mostrando a conta da empurrada,
 * com "Fechamento Rota" escrito no topo.
 */
describe("os tipos de leitura dentro de um ambiente", () => {
  it("oferece a operação do ambiente e o carimbo do backfill — nada mais", () => {
    expect(tiposParaLerNoAmbiente("ROTA").map((t) => t.valor)).toEqual([
      "ROTA",
      TIPO_NAO_INFORMADO,
    ]);
    expect(tiposParaLerNoAmbiente("EMPURRADA").map((t) => t.valor)).toEqual([
      "EMPURRADA",
      TIPO_NAO_INFORMADO,
    ]);
    expect(tiposParaLerNoAmbiente("AS").map((t) => t.valor)).toEqual([
      "AS",
      TIPO_NAO_INFORMADO,
    ]);
    expect(tiposParaLerNoAmbiente("APOIO").map((t) => t.valor)).toEqual([
      "APOIO",
      TIPO_NAO_INFORMADO,
    ]);
  });

  it("nunca oferece a operação de outro fechamento", () => {
    for (const outro of ["EMPURRADA", "AS", "APOIO"]) {
      expect(tiposParaLerNoAmbiente("ROTA").some((t) => t.valor === outro)).toBe(false);
    }
  });
});

describe("tipoDaLeitura", () => {
  it("aceita o que o ambiente alcança", () => {
    expect(tipoDaLeitura("ROTA", "ROTA")).toBe("ROTA");
    expect(tipoDaLeitura(TIPO_NAO_INFORMADO, "ROTA")).toBe(TIPO_NAO_INFORMADO);
  });

  /*
    A regressão que este caso prende: um endereço colado do outro fechamento —
    ou guardado de antes de os dois existirem — traz o tipo do outro na
    consulta. Obedecê-lo faria a tela ler a conta da outra operação sem nada
    dizer que ela é de lá.
  */
  it("um endereço de outro fechamento não muda a operação desta tela", () => {
    expect(tipoDaLeitura("EMPURRADA", "ROTA")).toBe("ROTA");
    expect(tipoDaLeitura("ROTA", "EMPURRADA")).toBe("EMPURRADA");
    expect(tipoDaLeitura("ROTA", "AS")).toBe("AS");
    expect(tipoDaLeitura("EMPURRADA", "APOIO")).toBe("APOIO");
  });

  it("sem tipo na URL, vale a operação do ambiente", () => {
    expect(tipoDaLeitura("", "EMPURRADA")).toBe("EMPURRADA");
    expect(tipoDaLeitura(" rota ", "ROTA")).toBe("ROTA");
  });
});

describe("enderecoDaLista", () => {
  it("leva o recorte na consulta quando há um", () => {
    expect(enderecoDaLista("/fechamento/competencias", "ROTA")).toBe(
      "/fechamento/competencias?tipoDeOperacao=ROTA",
    );
  });

  it("sem recorte, é a rota nua — o contrato de quem lê o acervo inteiro", () => {
    expect(enderecoDaLista("/fechamento/apuracoes")).toBe("/fechamento/apuracoes");
    expect(enderecoDaLista("/fechamento/apuracoes", "")).toBe("/fechamento/apuracoes");
  });
});
