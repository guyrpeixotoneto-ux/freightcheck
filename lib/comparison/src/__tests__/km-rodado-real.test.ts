import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { tabelaDeFreteTrechoPath } from "@workspace/ingest/testing";
import {
  avaliarTrecho,
  chaveDeIdentidade,
  conferirProjecaoMensal,
  montarPanorama,
  type TrechoKm,
} from "../km-rodado";

/**
 * O Km Rodado sobre a tabela de frete real — `EMPURRADA_1_9_2026`.
 *
 * Os números abaixo **não foram calculados por este código**. Saíram de uma
 * varredura independente do mesmo arquivo, e são o contrato desta leitura: se
 * ela parar de reproduzi-los, ela mudou de ideia sobre o que está medindo.
 *
 * O arquivo traz junto a auditoria que o transportador faz à mão — a aba
 * `KM RODADO`, comparando o km de um percurso entre 28 e 30 pallets. Ela é o
 * segundo contrato, e o mais importante: o módulo tem de achar o que ela acha,
 * e tem de deixar de errar o que ela erra. Os dois defeitos dela estão medidos
 * no último bloco.
 */

const CAMINHO = tabelaDeFreteTrechoPath();

interface LinhaCrua {
  [coluna: string]: unknown;
}

function lerAba(nome: string, opcoes: XLSX.Sheet2JSONOpts = {}): LinhaCrua[] {
  const wb = XLSX.readFile(CAMINHO, { cellDates: false });
  const aba = wb.Sheets[nome];
  if (aba === undefined) throw new Error(`Aba "${nome}" não existe em ${CAMINHO}`);
  return XLSX.utils.sheet_to_json<LinhaCrua>(aba, { defval: null, ...opcoes });
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * A tradução do export para o grão do módulo.
 *
 * É deliberadamente burra: nenhuma regra mora aqui, só o de-para de coluna para
 * campo. Toda decisão — o que entra, o que sai, o que é a identidade — está em
 * `km-rodado.ts`, que é o que este teste existe para exercitar.
 */
function comoTrecho(l: LinhaCrua, i: number): TrechoKm {
  return {
    entityId: `linha-${i}`,
    chaveTrecho: texto(l["chaveTrecho"]),
    unidadeCnpj: texto(l["Unidade - CNPJ"]),
    origemSap: texto(l["origem SAP"]),
    destinoSap: texto(l["destino SAP"]),
    unidade: texto(l["Unidade - Nome"]),
    operador: texto(l["Operador - Nome"]),
    regional: texto(l["Unidade - Regional"]),
    origem: texto(l["Origem"]),
    destino: texto(l["Destino"]),
    capacidade: texto(l["Capacidade"]),
    kmIda: numero(l["kmIda"]),
    kmVolta: numero(l["kmVolta"]),
    kmRodado: numero(l["kmRodado"]),
    kmRodadoMesPorEquipe: numero(l["kmRodadoMesPorEquipe"]),
    previsaoViagens: numero(l["previsaoViagens"]),
    diasMes: numero(l["diasMes"]),
  };
}

const trechos: TrechoKm[] = lerAba("Trecho").map(comoTrecho);
const panorama = montarPanorama(trechos);

describe("o export real, como ele é", () => {
  it("traz 2.497 trechos de uma vigência só", () => {
    expect(trechos).toHaveLength(2497);
    expect(panorama.resumo.trechosNoExport).toBe(2497);
  });

  it("fecha o ciclo em todas as linhas: kmRodado = kmIda + kmVolta", () => {
    expect(panorama.resumo.excluidos.CICLO_NAO_FECHA).toBe(0);
    expect(panorama.resumo.excluidos.SEM_KM).toBe(0);
    expect(panorama.resumo.excluidos.KM_NAO_POSITIVO).toBe(0);
    expect(panorama.resumo.excluidos.SEM_IDENTIDADE).toBe(0);
  });

  it("soma 3.564.546,40 km de ciclo contratado", () => {
    expect(panorama.resumo.kmTotal).toBeCloseTo(3_564_546.4, 1);
    expect(panorama.resumo.trechos).toBe(2492);
    expect(panorama.resumo.cobertura).toBeCloseTo(2492 / 2497, 6);
  });
});

describe("a identidade, e os 65 km que ela salva", () => {
  /*
    O achado que motivou o módulo. Sob `chaveTrecho` sozinha — a identidade
    declarada hoje em `lib/ingest/src/tipos.ts` — 171 linhas colapsam, e nem
    todas são inofensivas: em 65 grupos as linhas colapsadas têm km diferente
    entre si, e uma apaga a outra.
  */
  it("chaveTrecho sozinha colapsa 171 das 2.497 linhas", () => {
    const porChave = new Set(trechos.map((t) => t.chaveTrecho));
    expect(porChave.size).toBe(2326);
    expect(2497 - porChave.size).toBe(171);
  });

  it("e em 65 desses grupos o km colapsado é diferente — isso é perda, não repetição", () => {
    const porChave = new Map<string, Set<number>>();
    for (const t of trechos) {
      if (t.chaveTrecho === null || t.kmRodado === null) continue;
      const kms = porChave.get(t.chaveTrecho) ?? new Set<number>();
      kms.add(Number(t.kmRodado.toFixed(6)));
      porChave.set(t.chaveTrecho, kms);
    }
    const comKmDiferente = [...porChave.values()].filter((k) => k.size > 1).length;
    expect(comKmDiferente).toBe(65);
  });

  /*
    A identidade deste módulo usa só colunas do export oficial — a planilha de
    trabalho tem uma coluna `Trecho` que resolveria sozinha, e ela não chega na
    importação de verdade.
  */
  it("chave + CNPJ da unidade + os dois SAP identificam, sem nenhum conflito de km", () => {
    const porIdentidade = new Set(trechos.map(chaveDeIdentidade));
    expect(porIdentidade.size).toBe(2492);
    expect(panorama.resumo.colapsadas).toBe(5);
    expect(panorama.conflitos).toHaveLength(0);
  });
});

describe("o comportamento do km", () => {
  it("separa ida de volta: 991 dos 2.492 ciclos não voltam pelo mesmo caminho", () => {
    expect(panorama.assimetria.simetricos).toBe(1501);
    expect(panorama.assimetria.assimetricos).toBe(991);
    expect(panorama.assimetria.indeterminados).toBe(0);
  });

  it("abre por unidade, e as seis somam o total", () => {
    expect(panorama.porUnidade.map((u) => u.chave)).toEqual(
      expect.arrayContaining(["CAMAÇARI", "CDD CEBRASA", "PERNAMBUCO", "EQUATORIAL", "MANAUS", "CDR Belém"]),
    );
    const soma = panorama.porUnidade.reduce((s, u) => s + u.kmTotal, 0);
    expect(soma).toBeCloseTo(panorama.resumo.kmTotal ?? 0, 1);
  });

  it("abre por operador — Horizonte e Operalog, e nada mais", () => {
    expect(panorama.porOperador.map((o) => o.chave).sort()).toEqual(["HORIZONTE", "OPERALOG"]);
  });

  it("a projeção mensal fecha dentro da faixa que o arredondamento admite", () => {
    let confere = 0;
    let acusa = 0;
    for (const t of trechos) {
      const r = conferirProjecaoMensal(t);
      if (r === null) continue;
      if (r.confere) confere++;
      else acusa++;
    }
    /*
      A comparação contra o ponto acusaria 61 linhas. Contra a faixa, nenhuma —
      que é a resposta certa: o que difere é a casa decimal que o export cortou,
      não a fórmula.
    */
    expect(acusa).toBe(0);
    expect(confere).toBe(2497);
  });
});

describe("a divergência de km entre capacidades", () => {
  it("acha 307 percursos em que a distância muda com a capacidade", () => {
    expect(panorama.divergencias).toHaveLength(307);
  });

  it("põe a maior amplitude no topo da fila", () => {
    const pior = panorama.divergencias[0];
    expect(pior?.percurso).toBe("CERVEJARIA CAMAÇARI_CERVEJARIA MANAUS");
    expect(pior?.amplitude).toBeCloseTo(2491.94, 2);
  });

  it("nenhuma divergência é ruído de arredondamento", () => {
    for (const d of panorama.divergencias) expect(d.amplitude).toBeGreaterThan(0.01);
  });
});

describe("a planilha que o transportador mantém à mão", () => {
  /*
    A aba `KM RODADO` é a auditoria manual: uma linha por trecho, km em 28
    contra km em 30, e um veredito. Ela acerta a pergunta e erra a conta, e os
    dois blocos abaixo medem exatamente o quê.
  */
  const auditoria = lerAba("KM RODADO", { range: 1 });

  it("classifica pela comparação direta entre as duas capacidades", () => {
    const contagem = { "30 MAIOR": 0, Corrigir: 0, OK: 0 } as Record<string, number>;
    for (const l of auditoria) {
      const v = texto(l["Correção FT"]);
      if (v !== null) contagem[v] = (contagem[v] ?? 0) + 1;
    }
    expect(contagem).toEqual({ "30 MAIOR": 552, Corrigir: 453, OK: 103 });
  });

  it("e a regra dela é exatamente essa — 1.108 de 1.108", () => {
    let bate = 0;
    for (const l of auditoria) {
      const km28 = numero(l["Pallets: 28"]);
      const km30 = numero(l["Pallets: 30"]);
      const v = texto(l["Correção FT"]);
      if (km28 === null || km30 === null || v === null) continue;
      const esperado = km30 > km28 ? "30 MAIOR" : km30 < km28 ? "Corrigir" : "OK";
      if (esperado === v) bate++;
    }
    expect(bate).toBe(1108);
  });

  /*
    O defeito que o módulo elimina de graça: a chave do join (`Trecho`, o código
    TMS) não é única, e a mesma linha de trecho entra até quatro vezes. Qualquer
    soma feita sobre esta aba está inflada ~2,6x.
  */
  it("conta o mesmo trecho mais de uma vez — 1.108 linhas para 420 trechos", () => {
    expect(auditoria).toHaveLength(1108);
    const distintos = new Set(auditoria.map((l) => texto(l["ID FT"])).filter((x) => x !== null));
    expect(distintos.size).toBe(420);
  });
});
