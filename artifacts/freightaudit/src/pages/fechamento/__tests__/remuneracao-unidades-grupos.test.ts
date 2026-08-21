import { describe, expect, it } from "vitest";
import {
  agruparPorUnidade,
  chaveDaLinha,
  resumoDoGrupo,
} from "../remuneracao-unidades";
import type { EstadoDoCadastro, SituacaoDaUnidade } from "@/lib/remuneracao";

/**
 * Como a lista de Remuneração reúne os cadastros — e por que a ordem é dela.
 *
 * **O grupo é a unidade, e a linha é a vigência.** Uma linha por (unidade,
 * quinzena), como antes — o que mudou foi quem as reúne. Enquanto o grupo era o
 * mês da vigência, um acervo de poucas unidades e muitas vigências desenhava um
 * grupo por linha: o cabeçalho do mês repetia o que a única linha dele dizia, e
 * o nome da unidade descia a página uma vez por vigência sem distinguir nada.
 *
 * **O que a troca não pode perder** é o que a forma por vigência tinha
 * consertado: todas as vigências continuam em tela, cada uma na linha dela, de
 * modo que a planilha preenchida em julho não some quando agosto nasce vazio.
 * Só uma linha por unidade, mostrando a mais recente, é a forma que esta tela
 * já teve e não volta a ter.
 *
 * **A lista não chega ordenada.** O servidor manda as unidades do acervo por
 * vigência decrescente e acrescenta ao fim as que existem só por planilha ou
 * por cadastro à mão (ver `contextosEProcedencia`). Herdar essa ordem jogaria a
 * unidade cadastrada à mão para o rodapé ainda que a vigência dela fosse a mais
 * recente de todas — exatamente a unidade que a tela existe para não deixar
 * escondida.
 *
 * **A frase do grupo conta vigências, e nunca as trinta linhas de dentro
 * delas.** É o mesmo cuidado de `situacao.ts`: somá-las daria "89 de 900", que
 * é o percentual que o módulo recusa, disfarçado de total.
 */

/** O espaço inquebrável que `contar` e a frase do grupo põem depois do número. */
const NBSP = " ";

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
    planilhaOrfa: false,
    ...extras,
  };
}

describe("agruparPorUnidade", () => {
  /*
    O caso que motivou a troca: uma unidade só, seis vigências. Por vigência
    isto eram seis grupos de uma linha, com o nome repetido seis vezes; por
    unidade é um grupo com seis linhas.
  */
  it("reúne as vigências da unidade num grupo só", () => {
    const grupos = agruparPorUnidade([
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
      unidade("CAMAÇARI", "2026-07-02", "SO_FROTA"),
      unidade("CAMAÇARI", "2026-06-02", "SO_FROTA"),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.chave).toBe("camaçari|EMPURRADA");
    expect(grupos[0]!.titulo).toBe("CAMAÇARI · EMPURRADA");
    expect(grupos[0]!.linhas).toHaveLength(3);
  });

  /*
    Duas séries do mesmo escopo são dois cadastros com duas frotas. Reuni-las
    num grupo só somaria coisas que ninguém soma — e é a mesma razão pela qual
    o canal entra na chave do servidor.
  */
  it("separa as duas operações do mesmo escopo em dois grupos", () => {
    const grupos = agruparPorUnidade([
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
      unidade("CAMAÇARI", "2026-08-01", "FROTA_E_ALIQUOTAS", { channel: "ROTA" }),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.titulo).sort()).toEqual([
      "CAMAÇARI · EMPURRADA",
      "CAMAÇARI · ROTA",
    ]);
  });

  /* Dentro do grupo, a primeira linha é onde a unidade está — e é por isso que
     a ordem é da vigência mais recente para a mais antiga. */
  it("põe a vigência mais recente da unidade em cima", () => {
    const [grupo] = agruparPorUnidade([
      unidade("CAMAÇARI", "2026-06-02", "SO_FROTA"),
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
      unidade("CAMAÇARI", "2026-07-02", "SO_FROTA"),
    ]);

    expect(grupo!.linhas.map((u) => u.effectiveDate)).toEqual([
      "2026-08-01",
      "2026-07-02",
      "2026-06-02",
    ]);
    expect(grupo!.maisRecente).toBe("2026-08-01");
  });

  /*
    A ordem dos grupos é o que substitui o "grupo mais recente em cima" da forma
    antiga, e responde à mesma pergunta: quem ficou para trás cai para o fim.
    BELÉM parou em junho e fica abaixo das duas que entregaram em agosto, ainda
    que o nome dela venha antes no alfabeto.
  */
  it("desce ao fim a unidade que parou de entregar", () => {
    const grupos = agruparPorUnidade([
      unidade("BELÉM", "2026-06-02", "SEM_LASTRO"),
      unidade("SIMÕES FILHO", "2026-08-01", "FROTA_E_ALIQUOTAS"),
      unidade("CAMAÇARI", "2026-08-01", "SO_FROTA"),
    ]);

    expect(grupos.map((g) => g.titulo)).toEqual([
      "CAMAÇARI · EMPURRADA",
      "SIMÕES FILHO · EMPURRADA",
      "BELÉM · EMPURRADA",
    ]);
  });

  /* No empate — todo mundo em dia — a ordem é o nome, que é a única que quer
     dizer alguma coisa para quem lê. A do banco é a do `scope_hash`. */
  it("ordena pelo nome as unidades que estão na mesma vigência", () => {
    const grupos = agruparPorUnidade([
      unidade("SIMÕES FILHO", "2026-08-01", "SO_FROTA"),
      unidade("BELÉM", "2026-08-01", "SEM_LASTRO"),
      unidade("CAMAÇARI", "2026-08-01", "FROTA_E_ALIQUOTAS"),
    ]);

    expect(grupos.map((g) => g.titulo)).toEqual([
      "BELÉM · EMPURRADA",
      "CAMAÇARI · EMPURRADA",
      "SIMÕES FILHO · EMPURRADA",
    ]);
  });

  /*
    A unidade cadastrada à mão chega no fim da lista do servidor e é a mais
    recente das três: a ordem é calculada aqui justamente para ela não herdar o
    rodapé.
  */
  it("não herda do servidor o rodapé da unidade cadastrada à mão", () => {
    const grupos = agruparPorUnidade([
      unidade("BELÉM", "2026-07-16", "SEM_LASTRO"),
      unidade("CAMAÇARI", "2026-06-01", "SO_FROTA"),
      unidade("SIMÕES FILHO", "2026-08-01", "FROTA_E_ALIQUOTAS", { registradaAMao: true }),
    ]);

    expect(grupos.map((g) => g.titulo)).toEqual([
      "SIMÕES FILHO · EMPURRADA",
      "BELÉM · EMPURRADA",
      "CAMAÇARI · EMPURRADA",
    ]);
  });

  it("conta cadastros por estado, e cada um entra num contador só", () => {
    const [grupo] = agruparPorUnidade([
      unidade("A", "2026-08-01", "FROTA_E_ALIQUOTAS"),
      unidade("A", "2026-07-01", "SO_FROTA"),
      unidade("A", "2026-06-01", "SO_ALIQUOTAS"),
      unidade("A", "2026-05-01", "SEM_LASTRO"),
      unidade("A", "2026-04-01", "SEM_LASTRO"),
    ]);

    expect(grupo!.frotaEAliquotas).toBe(1);
    expect(grupo!.soFrota).toBe(1);
    expect(grupo!.soAliquotas).toBe(1);
    expect(grupo!.semLastro).toBe(2);
    expect(
      grupo!.frotaEAliquotas + grupo!.soFrota + grupo!.soAliquotas + grupo!.semLastro,
    ).toBe(grupo!.linhas.length);
  });

  it("conta a planilha e a divergência por cadastro, e não por linha digitada", () => {
    const [grupo] = agruparPorUnidade([
      unidade("A", "2026-08-01", "SO_FROTA", {
        cadastro: cadastro("SO_FROTA", { informadas: 12, conferidas: 4, divergentes: 3 }),
      }),
      unidade("A", "2026-07-01", "SEM_LASTRO", {
        cadastro: cadastro("SEM_LASTRO", { informadas: 5 }),
      }),
      unidade("A", "2026-06-01", "SO_FROTA"),
    ]);

    expect(grupo!.comPlanilha).toBe(2);
    expect(grupo!.comDivergencia).toBe(1);
  });

  it("a lista vazia não inventa grupo nenhum", () => {
    expect(agruparPorUnidade([])).toEqual([]);
  });
});

describe("resumoDoGrupo", () => {
  it("conta vigências, e escreve só os estados que existem no grupo", () => {
    const [grupo] = agruparPorUnidade([
      unidade("A", "2026-08-01", "SO_FROTA"),
      unidade("A", "2026-07-01", "SEM_LASTRO"),
    ]);

    expect(resumoDoGrupo(grupo!)).toBe(
      `2${NBSP}vigências · 1${NBSP}só com a frota · 1${NBSP}sem lastro`,
    );
  });

  it("diz a planilha e a divergência quando elas existem", () => {
    const [grupo] = agruparPorUnidade([
      unidade("A", "2026-08-01", "SEM_LASTRO", {
        cadastro: cadastro("SEM_LASTRO", { informadas: 8, conferidas: 2, divergentes: 1 }),
      }),
    ]);

    expect(resumoDoGrupo(grupo!)).toBe(
      `1${NBSP}vigência · 1${NBSP}sem lastro · 1${NBSP}com planilha informada · ` +
        `1${NBSP}diverge do acervo`,
    );
  });

  /*
    A procedência saiu da frase e virou marca do cabeçalho — ver
    `MarcasDaUnidade`. No grupo por unidade ela deixou de ser uma contagem
    ("1 unidade cadastrada à mão", dito dentro do grupo daquela unidade) e
    voltou a ser o que sempre foi: um fato só, dito uma vez.
  */
  it("não conta procedência na frase: ela é fato da unidade, dito no cabeçalho", () => {
    const [grupo] = agruparPorUnidade([
      unidade("A", "2026-08-01", "SEM_LASTRO", { registradaAMao: true }),
      unidade("A", "2026-07-01", "SEM_LASTRO", { registradaAMao: true }),
    ]);

    expect(resumoDoGrupo(grupo!)).toBe(`2${NBSP}vigências · 2${NBSP}sem lastro`);
  });

  it("cala o que não tem: nem planilha, nem divergência", () => {
    const [grupo] = agruparPorUnidade([unidade("A", "2026-08-01", "FROTA_E_ALIQUOTAS")]);

    expect(resumoDoGrupo(grupo!)).toBe(`1${NBSP}vigência · 1${NBSP}com as duas metades`);
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
