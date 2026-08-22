import { describe, expect, it } from "vitest";

import {
  DESCRICAO_DA_FONTE,
  LADOS_DA_CONFERENCIA,
  TIPOS_DE_FONTE,
  type LadoDaConferencia,
} from "../dominio";

/**
 * DE QUE LADO DA CONFERÊNCIA CADA FONTE ESTÁ.
 *
 * **O que este arquivo defende.** A força da conferência do fechamento vem de
 * os dois lados saírem de arquivos diferentes: o devido é derivado do contrato
 * e da operação, o demonstrado é lido do 03.08.20. Se uma fonte migrar de lado
 * sem que ninguém perceba, a tela passa a prometer uma independência que não
 * existe — e é exatamente o defeito de que este módulo saiu, quando o devido
 * era uma releitura do próprio demonstrativo.
 *
 * As asserções abaixo são sobre a **conta**, não sobre o layout: o agrupamento
 * da tela é consequência.
 */
describe("cada fonte tem um lado, e o lado diz o que ela alimenta", () => {
  it("as seis fontes estão classificadas", () => {
    for (const tipo of TIPOS_DE_FONTE) {
      expect(DESCRICAO_DA_FONTE[tipo].lado, `${tipo} sem lado`).toBeTruthy();
    }
  });

  it("o devido sai do contrato mais a operação — três fontes", () => {
    /*
      2Art dá as viagens, 03.08.18 dá os dias, 03.08.12.09 dá as despesas
      aprovadas. Nenhuma delas produz número sozinha: o contrato diz quanto vale
      cada coisa, e é por isso que o grupo pede o cadastro junto.
    */
    expect(doLado("DEVIDO")).toEqual(["DISPONIBILIDADE", "OPERACAO", "REQUISICOES"]);
  });

  it("o demonstrado é um arquivo só, e é o 03.08.20", () => {
    /*
      A asserção que protege a inversão do motor. Se um dia uma segunda fonte
      aparecer deste lado, ou o 03.08.20 aparecer do lado do devido, a
      conferência deixa de ser entre documentos independentes — e passa a
      concordar consigo mesma por construção.
    */
    expect(doLado("DEMONSTRADO")).toEqual(["PAGAMENTO"]);
    expect(DESCRICAO_DA_FONTE.PAGAMENTO.lado).toBe("DEMONSTRADO");
  });

  it("o faturamento e o fecho não entram na comparação", () => {
    /*
      O 03.08.15 é o que foi emitido em CT-e — um terceiro eixo, com linha
      própria no fecho — e o 03.02.59.02 traz os ajustes que atravessam a
      quinzena. Empurrá-los para um dos lados diria que eles alimentam uma
      comparação que eles não alimentam.
    */
    expect(doLado("FATURAMENTO")).toEqual(["CONCILIACAO", "CTE"]);
  });

  it("só o grupo do devido pede contrato", () => {
    /*
      É a razão de `precisaDeContrato` existir. O contrato não é arquivo — é
      digitado em Remuneração — e sem ele os três relatórios do devido não
      produzem número nenhum. Marcar outro grupo faria a tela pedir cadastro
      para um lado que não depende dele.
    */
    const pedem = LADOS_DA_CONFERENCIA.filter((l) => l.precisaDeContrato).map((l) => l.lado);
    expect(pedem).toEqual(["DEVIDO"]);
  });

  it("todo lado declarado tem fonte, e toda fonte tem lado declarado", () => {
    /*
      As duas pontas do mesmo contrato. Um lado sem fonte viraria um título
      seguido de nada na tela; uma fonte com lado que a lista não declara
      sumiria da tela sem ninguém notar — que é pior, porque é um relatório que
      deixa de ser pedido.
    */
    const declarados = LADOS_DA_CONFERENCIA.map((l) => l.lado);
    expect(new Set(declarados).size, "lado repetido na lista").toBe(declarados.length);
    for (const lado of declarados) {
      expect(doLado(lado).length, `${lado} sem fonte nenhuma`).toBeGreaterThan(0);
    }
    for (const tipo of TIPOS_DE_FONTE) {
      expect(declarados, `${tipo} aponta para um lado não declarado`).toContain(
        DESCRICAO_DA_FONTE[tipo].lado,
      );
    }
  });

  it("cada lado tem título e explicação escritos", () => {
    /* O texto é do domínio: a tela o mostra, e não o inventa. */
    for (const l of LADOS_DA_CONFERENCIA) {
      expect(l.titulo.length, `${l.lado} sem título`).toBeGreaterThan(0);
      expect(l.explica.length, `${l.lado} sem explicação`).toBeGreaterThan(20);
    }
  });
});

/** As fontes de um lado, ordenadas — para a asserção não depender da ordem do catálogo. */
function doLado(lado: LadoDaConferencia): string[] {
  return TIPOS_DE_FONTE.filter((t) => DESCRICAO_DA_FONTE[t].lado === lado).sort();
}
