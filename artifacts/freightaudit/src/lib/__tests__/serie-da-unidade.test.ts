import { describe, expect, it } from "vitest";
import {
  normalizarUnidade,
  recorteDeChamados,
  serieDaUnidade,
} from "../serie-da-unidade";

/**
 * A unidade da lateral e a série do arquivo — a regressão que este arquivo guarda.
 *
 * O sintoma, nas palavras de quem o relatou: "eu mudo de PERNAMBUCO para
 * CAMAÇARI e muda o módulo, mas eu quero ver justamente os chamados que
 * importei de Camaçari". Duas metades: a troca expulsava da tela (isso é
 * `navegacao-do-escopo.test.ts`), e a tela não sabia recortar por unidade
 * nenhuma — isso é o que roda aqui.
 *
 * O que estes testes travam:
 *
 * 1. o nome casa apesar da grafia, porque os dois nomes vêm de sistemas
 *    diferentes preenchidos por gente diferente;
 * 2. o nome **não** casa por parentesco inventado — sem "contém", sem prefixo;
 * 3. a ordem das autoridades: a URL vence a lateral, a lateral vence a soma;
 * 4. unidade sem envio devolve um recorte que não acha nada, e **diz** que é
 *    isso — nunca o acervo inteiro embaixo do nome dela.
 */

const SERIES = [
  { serie: "Camaçari" },
  { serie: "PERNAMBUCO" },
  { serie: null },
];

describe("normalizarUnidade", () => {
  it("iguala grafias da mesma unidade", () => {
    expect(normalizarUnidade("Camaçari")).toBe(normalizarUnidade("CAMACARI "));
    expect(normalizarUnidade("cdd  cebrasa")).toBe(
      normalizarUnidade("CDD CEBRASA"),
    );
  });

  it("mantém unidades diferentes diferentes", () => {
    expect(normalizarUnidade("CDD CEBRASA")).not.toBe(
      normalizarUnidade("CEBRASA"),
    );
  });

  /* Nome vazio é ausência de nome, e ausência não casa com nada. */
  it("devolve null para o que não é nome", () => {
    expect(normalizarUnidade("   ")).toBeNull();
    expect(normalizarUnidade(null)).toBeNull();
  });
});

describe("serieDaUnidade", () => {
  /*
    O caso do relato. A série volta **como o arquivo a escreveu** — é sobre esse
    texto que a rota compara por igualdade, e devolver "CAMAÇARI" faria a
    consulta não achar nada justamente quando o casamento deu certo.
  */
  it("acha a série apesar da grafia, e devolve o texto do arquivo", () => {
    expect(serieDaUnidade("CAMAÇARI", SERIES)).toBe("Camaçari");
  });

  it("não inventa parentesco quando o nome não bate", () => {
    expect(serieDaUnidade("MANAUS", SERIES)).toBeNull();
    expect(serieDaUnidade("CEBRASA", [{ serie: "CDD CEBRASA" }])).toBeNull();
  });

  /*
    A série indeterminada é o envio que não disse de onde veio. Atribuí-la à
    unidade aberta seria afirmar uma origem que o dado não tem.
  */
  it("nunca casa a unidade com o envio sem unidade no arquivo", () => {
    expect(serieDaUnidade("CAMAÇARI", [{ serie: null }])).toBeNull();
  });
});

describe("recorteDeChamados", () => {
  const base = {
    serieNaUrl: null,
    visaoGeral: false,
    unidade: "CAMAÇARI",
    series: SERIES,
  };

  /* O requisito 3, a metade de baixo: sem nada escrito, vale a lateral. */
  it("recorta pela unidade que a lateral nomeia", () => {
    expect(recorteDeChamados(base)).toEqual({
      serie: "Camaçari",
      motivo: "UNIDADE",
      unidade: "CAMAÇARI",
      pronto: true,
    });
  });

  /* O requisito 3, a metade de cima: quem escreveu na URL escolheu. */
  it("deixa a série da URL vencer a lateral", () => {
    const recorte = recorteDeChamados({ ...base, serieNaUrl: "PERNAMBUCO" });

    expect(recorte.serie).toBe("PERNAMBUCO");
    expect(recorte.motivo).toBe("ESCOLHA");
    /* A unidade continua sendo dita — é o que permite a tela avisar a divergência. */
    expect(recorte.unidade).toBe("CAMAÇARI");
  });

  it("entende o rótulo do envio sem unidade no arquivo", () => {
    const recorte = recorteDeChamados({ ...base, serieNaUrl: "@sem-serie" });

    expect(recorte.serie).toBeNull();
    expect(recorte.motivo).toBe("ESCOLHA");
  });

  /* A soma é escolha, e `undefined` é como ela viaja para as consultas. */
  it("a Visão Geral é todas as séries", () => {
    const recorte = recorteDeChamados({ ...base, visaoGeral: true });

    expect(recorte.serie).toBeUndefined();
    expect(recorte.motivo).toBe("TODAS");
  });

  /*
    O requisito 4. O recorte sai com o nome da unidade **de propósito**: série
    desconhecida devolve nada, e é a rota que garante isso (ver
    `serieDaConsulta`). O que a tela não pode fazer é somar todas as unidades
    embaixo do nome de uma.
  */
  it("unidade sem envio não vira o acervo inteiro", () => {
    const recorte = recorteDeChamados({ ...base, unidade: "MANAUS" });

    expect(recorte.motivo).toBe("UNIDADE_SEM_ENVIO");
    expect(recorte.serie).toBe("MANAUS");
    expect(recorte.pronto).toBe(true);
  });

  /*
    Sem contexto nenhum não há unidade a honrar, e a soma é a resposta honesta —
    é o estado de quem ainda não importou vigência nenhuma.
  */
  it("sem unidade aberta, todas as séries", () => {
    const recorte = recorteDeChamados({ ...base, unidade: null });

    expect(recorte.serie).toBeUndefined();
    expect(recorte.motivo).toBe("TODAS");
  });

  /*
    A lista de séries ainda não chegou: não dá para saber se a unidade casa. O
    recorte sai `pronto: false` e as consultas ficam paradas — disparar agora
    seria disparar duas vezes, e a primeira pintaria "nenhuma movimentação"
    sobre um dia que tem.
  */
  it("espera a lista de séries antes de decidir", () => {
    const recorte = recorteDeChamados({ ...base, series: undefined });

    expect(recorte.pronto).toBe(false);
  });

  /* Mas só espera quando há o que decidir: a escolha explícita não espera. */
  it("não espera quando a URL já disse a série", () => {
    expect(
      recorteDeChamados({ ...base, series: undefined, serieNaUrl: "Camaçari" })
        .pronto,
    ).toBe(true);
    expect(
      recorteDeChamados({ ...base, series: undefined, visaoGeral: true }).pronto,
    ).toBe(true);
  });
});
