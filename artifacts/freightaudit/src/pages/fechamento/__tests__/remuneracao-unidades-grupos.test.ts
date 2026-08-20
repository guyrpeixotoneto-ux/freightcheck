import { describe, expect, it } from "vitest";
import {
  agruparPorVigencia,
  chaveDaLinha,
  resumoDoGrupo,
} from "../remuneracao-unidades";
import type { EstadoDoCadastro, SituacaoDaUnidade } from "@/lib/remuneracao";

/**
 * Como a lista de Remuneração reúne os cadastros — e por que a ordem é dela.
 *
 * **A lista é por vigência**: uma linha por (unidade, quinzena), e não uma por
 * unidade. É o que faz a planilha preenchida em julho continuar em tela quando
 * agosto chega vazio — e é por isso que o grupo conta cadastros, e não
 * unidades, em tudo menos na procedência, que é fato da unidade.
 *
 * **A lista não chega ordenada.** O servidor manda as unidades do acervo por
 * vigência decrescente e acrescenta ao fim as que existem só por planilha ou
 * por cadastro à mão (ver `contextosEProcedencia`). Herdar essa ordem, como
 * Apurações faz com a dela, colocaria a unidade cadastrada à mão num grupo
 * sozinho no rodapé ainda que a vigência dela fosse a mais recente de todas —
 * exatamente a unidade que a tela existe para não deixar escondida.
 *
 * **A frase do grupo conta cadastros, e nunca as trinta linhas de dentro
 * deles.** É o mesmo cuidado de `situacao.ts`: somá-las daria "89 de 900", que
 * é o percentual que o módulo recusa, disfarçado de total.
 */

/** O espaço inquebrável que `contar` e a frase do grupo põem depois do número. */
const NBSP = "\u00A0";

const cadastro = (
  estado: EstadoDoCadastro,
  extras: Partial<SituacaoDaUnidade["cadastro"]> = {},
): SituacaoDaUnidade["cadastro"] => ({
  linhas: 30,
  comLastro: 11,
  semLastro: 19,
  frota: estado === "FROTA_E_ALIQUOTAS" || estado === "SO_FROTA",
  aliquotas: estado === "FROTA_E_ALIQUOTAS" || estado === "SO_ALIQUOTAS",
  estado,
  informadas: 0,
  conferidas: 0,
  divergentes: 0,
  ...extras,
});

function unidade(
  label: string,
  effectiveDate: string,
  estado: EstadoDoCadastro,
  extras: Partial<SituacaoDaUnidade> = {},
): SituacaoDaUnidade {
  return {
    scopeHash: label.toLowerCase(),
    channel: "EMPURRADA",
    label,
    unidade: label,
    scopes: [],
    effectiveDate,
    periodLabel: `${effectiveDate.slice(5, 7)}/${effectiveDate.slice(0, 4)}`,
    material: { cavalos: 0, trechos: 0, trechosEntregues: false, linhasInformadas: 0 },
    cadastro: cadastro(estado),
    registradaAMao: false,
    ...extras,
  };
}

describe("agruparPorVigencia", () => {
  it("reúne pelo mês da vigência, e não pela data exata", () => {
    const grupos = agruparPorVigencia([
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
      unidade("BELÉM", "2026-08-16", "SEM_LASTRO"),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.chave).toBe("2026-08");
    expect(grupos[0]!.titulo).toBe("agosto de 2026");
    /* Os dias continuam ditos: o grupo é o mês, e as duas metades dele não são
       a mesma entrega. */
    expect(grupos[0]!.dias).toEqual(["01/08", "16/08"]);
  });

  it("põe o mês mais recente em cima, mesmo quando ele chega por último", () => {
    /* A unidade cadastrada à mão vem no fim da lista do servidor, e é a mais
       recente das três. */
    const grupos = agruparPorVigencia([
      unidade("BELÉM", "2026-07-16", "SEM_LASTRO"),
      unidade("CAMAÇARI", "2026-06-01", "SO_FROTA"),
      unidade("SIMÕES FILHO", "2026-08-01", "FROTA_E_ALIQUOTAS", { registradaAMao: true }),
    ]);

    expect(grupos.map((g) => g.chave)).toEqual(["2026-08", "2026-07", "2026-06"]);
  });

  it("ordena as unidades do grupo pelo nome, e não pelo escopo", () => {
    const grupos = agruparPorVigencia([
      unidade("SIMÕES FILHO", "2026-08-01", "SO_FROTA"),
      unidade("BELÉM", "2026-08-16", "SEM_LASTRO"),
      unidade("CAMAÇARI", "2026-08-01", "FROTA_E_ALIQUOTAS"),
    ]);

    expect(grupos[0]!.linhas.map((u) => u.label)).toEqual([
      "BELÉM",
      "CAMAÇARI",
      "SIMÕES FILHO",
    ]);
  });

  /*
    A unidade que entregou as duas quinzenas do mês tem duas linhas no mesmo
    grupo. Elas ficam juntas, porque a ordem é pelo nome, e em ordem de
    calendário entre si — que é como se lê "o que estava preenchido na 1ª" ao
    lado de "o que falta na 2ª".
  */
  it("põe as duas quinzenas da mesma unidade juntas, na ordem do calendário", () => {
    const [grupo] = agruparPorVigencia([
      unidade("CAMAÇARI", "2026-08-16", "SO_FROTA"),
      unidade("BELÉM", "2026-08-01", "SEM_LASTRO"),
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
    ]);

    expect(grupo!.linhas.map((u) => `${u.label} ${u.effectiveDate}`)).toEqual([
      "BELÉM 2026-08-01",
      "CAMAÇARI 2026-08-01",
      "CAMAÇARI 2026-08-16",
    ]);
  });

  it("conta cadastros por estado, e cada um entra num contador só", () => {
    const grupos = agruparPorVigencia([
      unidade("A", "2026-08-01", "FROTA_E_ALIQUOTAS"),
      unidade("B", "2026-08-01", "SO_FROTA"),
      unidade("C", "2026-08-01", "SO_ALIQUOTAS"),
      unidade("D", "2026-08-01", "SEM_LASTRO"),
      unidade("E", "2026-08-01", "SEM_LASTRO"),
    ]);

    const [grupo] = grupos;
    expect(grupo!.frotaEAliquotas).toBe(1);
    expect(grupo!.soFrota).toBe(1);
    expect(grupo!.soAliquotas).toBe(1);
    expect(grupo!.semLastro).toBe(2);
    expect(
      grupo!.frotaEAliquotas + grupo!.soFrota + grupo!.soAliquotas + grupo!.semLastro,
    ).toBe(grupo!.linhas.length);
  });

  it("conta a planilha e a divergência por cadastro, e não por linha digitada", () => {
    const grupos = agruparPorVigencia([
      unidade("A", "2026-08-01", "SO_FROTA", {
        cadastro: cadastro("SO_FROTA", { informadas: 12, conferidas: 4, divergentes: 3 }),
      }),
      unidade("B", "2026-08-01", "SEM_LASTRO", {
        cadastro: cadastro("SEM_LASTRO", { informadas: 5 }),
      }),
      unidade("C", "2026-08-01", "SO_FROTA"),
    ]);

    const [grupo] = grupos;
    expect(grupo!.comPlanilha).toBe(2);
    expect(grupo!.comDivergencia).toBe(1);
  });

  /*
    Ser cadastrada à mão é fato da unidade, e não da quinzena: as duas linhas
    abaixo são a mesma unidade nas duas quinzenas de agosto, e contá-las duas
    vezes diria que há duas unidades sem export onde há uma.
  */
  it("conta a unidade cadastrada à mão uma vez, mesmo com duas vigências no mês", () => {
    const [grupo] = agruparPorVigencia([
      unidade("BELÉM", "2026-08-01", "SEM_LASTRO", { registradaAMao: true }),
      unidade("BELÉM", "2026-08-16", "SEM_LASTRO", { registradaAMao: true }),
    ]);

    expect(grupo!.linhas).toHaveLength(2);
    expect(grupo!.unidadesRegistradas).toBe(1);
  });

  it("a lista vazia não inventa grupo nenhum", () => {
    expect(agruparPorVigencia([])).toEqual([]);
  });
});

describe("resumoDoGrupo", () => {
  it("escreve só os estados que existem no grupo", () => {
    const [grupo] = agruparPorVigencia([
      unidade("A", "2026-08-01", "SO_FROTA"),
      unidade("B", "2026-08-16", "SEM_LASTRO"),
    ]);

    expect(resumoDoGrupo(grupo!)).toBe(
      `2${NBSP}cadastros · 1${NBSP}só com a frota · 1${NBSP}sem lastro`,
    );
  });

  it("diz a planilha, a divergência e a procedência quando elas existem", () => {
    const [grupo] = agruparPorVigencia([
      unidade("A", "2026-08-01", "SEM_LASTRO", {
        registradaAMao: true,
        cadastro: cadastro("SEM_LASTRO", { informadas: 8, conferidas: 2, divergentes: 1 }),
      }),
    ]);

    expect(resumoDoGrupo(grupo!)).toBe(
      `1${NBSP}cadastro · 1${NBSP}sem lastro · 1${NBSP}com planilha informada · ` +
        `1${NBSP}diverge do acervo · 1${NBSP}unidade cadastrada à mão`,
    );
  });

  it("cala o que não tem: nem planilha, nem divergência, nem cadastro à mão", () => {
    const [grupo] = agruparPorVigencia([unidade("A", "2026-08-01", "FROTA_E_ALIQUOTAS")]);

    expect(resumoDoGrupo(grupo!)).toBe(`1${NBSP}cadastro · 1${NBSP}com as duas metades`);
  });
});

describe("chaveDaLinha", () => {
  /*
    Duas séries da mesma unidade — uma por canal — são duas linhas, e abrir uma
    não pode abrir a outra. A chave é a mesma que endereça o cadastro no
    servidor: escopo, canal e vigência.
  */
  it("separa as duas operações do mesmo escopo", () => {
    const empurrada = unidade("CAMAÇARI", "2026-08-01", "SO_FROTA");
    const rota = unidade("CAMAÇARI", "2026-08-01", "SO_FROTA", { channel: "ROTA" });
    expect(chaveDaLinha(empurrada)).not.toBe(chaveDaLinha(rota));
  });

  /* E as duas quinzenas da mesma série também: abrir julho abriria agosto
     junto se a vigência ficasse de fora da chave. */
  it("separa as duas vigências da mesma série", () => {
    const primeira = unidade("CAMAÇARI", "2026-08-01", "SO_FROTA");
    const segunda = unidade("CAMAÇARI", "2026-08-16", "SO_FROTA");
    expect(chaveDaLinha(primeira)).not.toBe(chaveDaLinha(segunda));
  });

  it("a série sem canal tem chave própria, e não a de um canal qualquer", () => {
    const semCanal = unidade("CAMAÇARI", "2026-08-01", "SO_FROTA", { channel: null });
    expect(chaveDaLinha(semCanal)).toBe("camaçari||2026-08-01");
  });
});
