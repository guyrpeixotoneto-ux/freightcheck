import { describe, expect, it } from "vitest";

import {
  DESCRICAO_DA_FONTE,
  FONTES_DE_CONFERENCIA_OPERACIONAL,
  FONTES_DE_FATURAMENTO,
  FONTES_QUE_FORMAM_O_DEVIDO,
  FONTE_QUE_DEMONSTRA_O_PAGAMENTO,
  LADOS_DA_CONFERENCIA,
  ladoDaFonte,
  TIPOS_DE_FONTE,
  type LadoDaConferencia,
  type TipoDeFonte,
} from "../dominio";
import { FONTES_OPERACIONAIS_DO_CATALOGO, FONTE_DO_DEMONSTRATIVO } from "../matriz";

/**
 * O QUE FORMA O DEVIDO, O QUE DEMONSTRA O PAGAMENTO, E O QUE É SÓ FATURAMENTO.
 *
 * **Por que este arquivo existe, e por que ele confronta o motor.** A
 * classificação nasceu como rótulo de tela: um campo `lado` escrito à mão ao
 * lado de cada fonte, que nenhuma linha de cálculo consultava. Um rótulo assim
 * pode divergir do que o motor faz sem nada acusar — e um agrupamento que
 * promete "estes formam o devido" enquanto o motor usa outros é pior que
 * nenhum agrupamento, porque é uma afirmação falsa com cara de estrutura.
 *
 * As asserções abaixo confrontam a classificação com **a declaração do próprio
 * motor**: `matriz.ts` nomeia, linha a linha do `RESUMO GERAL`, de que fonte
 * operacional aquele devido sai. Uma fonte que mude de papel sem mudar de lista
 * derruba este arquivo.
 *
 * **A força da conferência é o que está sendo protegido.** O devido é formado
 * pelo cadastro e pelos relatórios da operação; o demonstrado é lido do
 * 03.08.20. Os dois virem de documentos que ninguém escreveu olhando o outro é
 * o que faz baterem significar alguma coisa — e é o estado de que este módulo
 * saiu, quando o painel era uma releitura do próprio demonstrativo.
 */

/** As fontes de um lado, ordenadas — a asserção não depende da ordem do catálogo. */
const doLado = (lado: LadoDaConferencia): TipoDeFonte[] =>
  TIPOS_DE_FONTE.filter((t) => ladoDaFonte(t) === lado).sort();

/** A rotina como quem opera a chama — `2Art`, `03.08.20`. */
const rotina = (t: TipoDeFonte) => DESCRICAO_DA_FONTE[t].rotina;

describe("a classificação das fontes é declarada, e não deduzida", () => {
  it("as quatro listas cobrem as nove fontes, sem sobra e sem repetição", () => {
    /*
      Quatro listas e não três desde que a frota Promax entrou: ela não é
      dinheiro (não forma devido, não demonstra pagamento) e não é faturamento
      — é conferência operacional, o quarto grupo. Ver
      `FONTES_DE_CONFERENCIA_OPERACIONAL` e `frota-promax-contaminacao.test.ts`.
    */
    const classificadas = [
      ...FONTES_QUE_FORMAM_O_DEVIDO,
      FONTE_QUE_DEMONSTRA_O_PAGAMENTO,
      ...FONTES_DE_FATURAMENTO,
      ...FONTES_DE_CONFERENCIA_OPERACIONAL,
    ];
    expect(new Set(classificadas).size, "fonte em duas listas").toBe(classificadas.length);
    expect([...classificadas].sort()).toEqual([...TIPOS_DE_FONTE].sort());
  });

  it("o lado é derivado das listas — não há um segundo lugar que o declare", () => {
    /*
      A garantia estrutural: `ladoDaFonte` é a única resposta, e ela lê as
      quatro listas. Enquanto `lado` era campo em `DESCRICAO_DA_FONTE`, havia
      duas declarações e nada impedia que discordassem.
    */
    for (const t of FONTES_QUE_FORMAM_O_DEVIDO) expect(ladoDaFonte(t)).toBe("DEVIDO");
    expect(ladoDaFonte(FONTE_QUE_DEMONSTRA_O_PAGAMENTO)).toBe("DEMONSTRADO");
    for (const t of FONTES_DE_FATURAMENTO) expect(ladoDaFonte(t)).toBe("FATURAMENTO");
    for (const t of FONTES_DE_CONFERENCIA_OPERACIONAL) {
      expect(ladoDaFonte(t)).toBe("CONFERENCIA_OPERACIONAL");
    }
    expect(DESCRICAO_DA_FONTE.OPERACAO).not.toHaveProperty("lado");
  });

  it("o devido é formado por quatro relatórios — e nenhum deles é o contrato", () => {
    /* Quatro e não três desde que o 03.08.18 virou dois: a FF e as vans chegam
       em arquivos separados e cada uma responde pelo desconto da frota dela. */
    expect(doLado("DEVIDO")).toEqual([
      "DISPONIBILIDADE_FF",
      "DISPONIBILIDADE_VAN",
      "OPERACAO",
      "REQUISICOES",
    ]);
    /* O cadastro não é fonte importável: entra pelo grupo, não pela lista. */
    expect(LADOS_DA_CONFERENCIA.find((l) => l.lado === "DEVIDO")?.precisaDeContrato).toBe(true);
  });

  it("o demonstrado é um arquivo só, e é o mesmo que a matriz nomeia", () => {
    /*
      A asserção que protege a inversão do motor. Se um segundo documento
      entrasse deste lado, ou se este saísse, a conferência deixaria de ser
      entre fontes independentes.
    */
    expect(doLado("DEMONSTRADO")).toEqual(["PAGAMENTO"]);
    expect(rotina(FONTE_QUE_DEMONSTRA_O_PAGAMENTO)).toBe(FONTE_DO_DEMONSTRATIVO);
  });

  it("faturamento e fechamento são os dois que sobram", () => {
    expect(doLado("FATURAMENTO")).toEqual(["CONCILIACAO", "CTE"]);
  });
});

/**
 * O confronto com o motor — o que tira a classificação do terreno visual.
 */
describe("a classificação bate com o que o motor declara consumir", () => {
  it("toda fonte do devido alimenta pelo menos uma linha do RESUMO GERAL", () => {
    /*
      `FONTES_OPERACIONAIS_DO_CATALOGO` é a lista das procedências que as linhas
      do resumo declaram. Uma fonte classificada como formadora do devido que
      não aparecesse ali estaria prometendo alimentar uma conta que não a usa.

      O casamento é por rotina porque é assim que o catálogo escreve a
      procedência — `2Art`, `03.08.18`, `03.08.12.09` —, e algumas entradas a
      qualificam ("03.08.18 (mês inteiro) — conferido contra 03.08.20").
    */
    for (const t of FONTES_QUE_FORMAM_O_DEVIDO) {
      const usada = FONTES_OPERACIONAIS_DO_CATALOGO.some((f) => f.includes(rotina(t)));
      expect(usada, `${rotina(t)} está no devido e não alimenta linha nenhuma`).toBe(true);
    }
  });

  it("a fonte do demonstrado também aparece — e é sabido por quê", () => {
    /*
      O 03.08.20 aparece como procedência de duas linhas: o desconto de
      devolução e o complementar negativo têm o devido lido dele. Não é defeito
      e não é acidente — é o que a aferição classifica como `MESMA_FONTE` e
      exclui do lastro justamente por isso. O teste registra o fato para que ele
      não seja lido como contradição da classificação.
    */
    const usada = FONTES_OPERACIONAIS_DO_CATALOGO.some((f) => f.includes(FONTE_DO_DEMONSTRATIVO));
    expect(usada).toBe(true);
  });

  it("nenhuma fonte de faturamento aparece como procedência de linha nenhuma", () => {
    /*
      **É esta a asserção que prova que o terceiro grupo não é sobra.** O
      03.08.15 e o 03.02.59.02 não formam devido e não demonstram pagamento: o
      motor não os nomeia em linha alguma do `RESUMO GERAL`. Se um dia
      passarem a alimentar uma linha, este teste cai — e a classificação terá
      de mudar junto, em vez de continuar dizendo que eles estão de fora.
    */
    for (const t of FONTES_DE_FATURAMENTO) {
      const usada = FONTES_OPERACIONAIS_DO_CATALOGO.some((f) => f.includes(rotina(t)));
      expect(usada, `${rotina(t)} é de faturamento e alimenta uma linha do resumo`).toBe(false);
    }
  });
});

describe("o texto dos grupos vem do domínio", () => {
  it("os quatro lados são declarados, na ordem, com título e explicação", () => {
    expect(LADOS_DA_CONFERENCIA.map((l) => l.lado)).toEqual([
      "DEVIDO",
      "DEMONSTRADO",
      "FATURAMENTO",
      "CONFERENCIA_OPERACIONAL",
    ]);
    for (const l of LADOS_DA_CONFERENCIA) {
      expect(l.titulo.length, `${l.lado} sem título`).toBeGreaterThan(0);
      expect(l.explica.length, `${l.lado} sem explicação`).toBeGreaterThan(20);
      expect(doLado(l.lado).length, `${l.lado} sem fonte nenhuma`).toBeGreaterThan(0);
    }
  });

  it("o título do devido não atribui ao contrato o que os quatro formam juntos", () => {
    /*
      A correção que motivou esta revisão. "O que o contrato manda pagar" era
      falso pela metade: o grupo tem o contrato **e** três relatórios, e é a
      soma deles que forma o devido — o cadastro traz regras, tarifas e
      parâmetros, e os relatórios trazem a operação.
    */
    const devido = LADOS_DA_CONFERENCIA.find((l) => l.lado === "DEVIDO")!;
    expect(devido.titulo).toBe("O que forma o valor devido");
    expect(devido.explica).toContain("nenhum produz número sozinho");
  });

  it("o devido e a conferência de frota dependem do contrato — os outros dois, não", () => {
    /*
      A frota Promax entra na lista de quem precisa do contrato: sem
      `frotaFixaAtiva`/`Inativa`/Vans do cadastro, a comparação não tem contra
      o que comparar (ver `frota-promax-comparacao.ts`). Isso não a torna
      financeira — ela continua fora de `DEVIDO`/`DEMONSTRADO` — só reconhece
      que a mesma porta do contrato alimenta os dois grupos.
    */
    const pedem = LADOS_DA_CONFERENCIA.filter((l) => l.precisaDeContrato).map((l) => l.lado);
    expect(pedem.sort()).toEqual(["CONFERENCIA_OPERACIONAL", "DEVIDO"].sort());
  });
});
