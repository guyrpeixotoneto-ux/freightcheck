import { describe, expect, it } from "vitest";
import { lerPagamento } from "../leitores/pagamento";

/**
 * O desconto que o 03.08.20 traz e o leitor não conhece.
 *
 * **O que este teste protege.** Até aqui, uma linha com valor dentro de um
 * bloco de desconto cujo rótulo não batesse com nenhum dos conhecidos era
 * descartada em silêncio: os três blocos (`DESCONTO DEVOLUCAO`,
 * `DESCONTO DISPONIBILIDADE`, `DESCONTO FRETE MINIMO`) tinham, cada um, um
 * caminho que caía num `continue` sem registrar nada.
 *
 * O efeito prático é o pior tipo de erro que este módulo pode ter: se a Ambev
 * criar um desconto novo — ou renomear um existente —, o dinheiro dele
 * simplesmente não existe para o fechamento. O total do relatório deixa de
 * fechar com a soma das verbas, e não há onde olhar para descobrir por quê,
 * porque o arquivo original não é guardado e a linha não virou nem recusa.
 *
 * A escolha aqui é a mesma que o leitor já fazia para as linhas com cara de
 * verba: **o que tem valor e não foi entendido vira pergunta, não ausência.**
 * Nenhuma dessas recusas interrompe a leitura — o resto do arquivo entra
 * normalmente.
 */

const REGUA = "-".repeat(120);

/** Um 03.08.20 mínimo, com um bloco de desconto e as linhas que se quiser nele. */
function pagamentoCom(bloco: string, linhas: string[]): Buffer {
  return Buffer.from(
    [
      "Periodo: 16/07/2026 a 31/07/2026",
      "Transportadora: 36 - TRANSPORTES FICTICIA",
      "Unidade: 443 - CDD BELEM",
      "",
      "ROTA",
      "",
      bloco,
      REGUA,
      ...linhas,
      "",
    ].join("\r\n"),
    "latin1",
  );
}

describe("um desconto que o leitor não conhece", () => {
  it("no bloco de disponibilidade, vira recusa em vez de sumir", () => {
    const { descontos, recusas } = lerPagamento(
      pagamentoCom("DESCONTO DISPONIBILIDADE", [
        "Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)            100,00",
        "Desconto FF - Combustivel (uma rubrica que a Ambev criou depois)                                  250,00",
      ]),
    );

    /* O conhecido entra normalmente — a recusa do vizinho não contamina. */
    expect(descontos).toHaveLength(1);
    expect(descontos[0]?.tipo).toBe("DISPONIBILIDADE_CUSTO_FIXO");

    expect(recusas).toHaveLength(1);
    expect(recusas[0]?.motivo).toContain("DESCONTO DISPONIBILIDADE");
    /* A evidência precisa sobreviver: o arquivo original não é guardado. */
    expect(recusas[0]?.original).toContain("Combustivel");
  });

  it("no bloco de devolução, vira recusa", () => {
    const { recusas } = lerPagamento(
      pagamentoCom("DESCONTO DEVOLUCAO", [
        "Valor S/Imposto (Todas VBZ's)                                                                  2.400,00",
        "% Dev. Resp. Transportadora                                                                        1,50 %",
        "Desconto Devolucao                                                                                36,00",
        "Multa Contratual Aplicada (rubrica que nao existia)                                               99,00",
      ]),
    );

    expect(recusas).toHaveLength(1);
    expect(recusas[0]?.motivo).toContain("DESCONTO DEVOLUCAO");
    expect(recusas[0]?.original).toContain("Multa");
  });

  /*
    O reconhecimento é por **prefixo**, e isso tem uma consequência que vale
    fixar: um rótulo novo que comece com o nome de um desconto conhecido é
    absorvido como aquele desconto, em vez de recusado. `Desconto Devolucao
    Extraordinaria` entra como devolução comum.

    Não é o ideal — o nome específico se perde na classificação —, mas é o
    comportamento seguro dos dois possíveis: o valor **entra na conta** e o
    rótulo inteiro fica guardado em `rotulo`, então o dinheiro nunca some.
    Recusar seria pior: tiraria da conta um desconto que quase certamente é da
    família certa. Este caso está aqui para que a escolha seja deliberada, e
    para que mudá-la exija mudar um teste que a explica.
  */
  it("rótulo que estende um desconto conhecido entra nele, e não vira recusa", () => {
    const { descontos, recusas } = lerPagamento(
      pagamentoCom("DESCONTO DEVOLUCAO", [
        "Desconto Devolucao Extraordinaria (variante do mesmo desconto)                                    99,00",
      ]),
    );

    expect(recusas).toHaveLength(0);
    expect(descontos).toHaveLength(1);
    expect(descontos[0]?.tipo).toBe("DEVOLUCAO");
    /* O nome específico não se perde: fica inteiro no rótulo. */
    expect(descontos[0]?.rotulo).toContain("Extraordinaria");
  });

  it("no bloco de frete mínimo, vira recusa", () => {
    const { recusas } = lerPagamento(
      pagamentoCom("DESCONTO FRETE MINIMO", [
        "Desconto Frete minimo (das VBZs de custo Fixo coluna ICMS)                                         50,00",
        "Desconto Frete maximo (rubrica que nao existia)                                                    70,00",
      ]),
    );

    expect(recusas).toHaveLength(1);
    expect(recusas[0]?.motivo).toContain("DESCONTO FRETE MINIMO");
    expect(recusas[0]?.original).toContain("maximo");
  });

  /*
    O contrapeso do teste acima: recusar demais é tão ruim quanto recusar de
    menos. Uma linha sem valor dentro de um bloco de desconto não é um desconto
    perdido — é texto do relatório —, e continuar caladamente é o certo ali.
  */
  it("linha sem valor nenhum não vira recusa — não há dinheiro se perdendo", () => {
    const { descontos, recusas } = lerPagamento(
      pagamentoCom("DESCONTO DISPONIBILIDADE", [
        "Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)            100,00",
        "     Observacao qualquer sem numero algum nesta linha",
      ]),
    );

    expect(descontos).toHaveLength(1);
    expect(recusas).toHaveLength(0);
  });
});
