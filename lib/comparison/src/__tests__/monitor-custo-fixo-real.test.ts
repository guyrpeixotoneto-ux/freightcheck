import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { computeChangeSet } from "../engine";
import { listChanges, listComparableSnapshots } from "../query";
import { CODIGOS_DO_DETALHE, impactoPorPeriodicidade, linhasDeFiname } from "../finame";
import {
  CODIGOS_DO_DETALHE_DE_ALUGUEL,
  impactoDeAluguel,
  linhasDeAluguel,
} from "../aluguel";
import { CODIGOS_DO_DETALHE_DE_IPVA, impactoDeIpva, linhasDeIpva } from "../ipva";
import {
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  impactoDeImpostos,
  linhasDeImpostos,
} from "../impostos";
import {
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  impactoDeLucroFixo,
  linhasDeLucroFixo,
} from "../lucro-fixo";
import {
  MODULOS_DO_MONITOR,
  SITUACOES_DO_IMPACTO,
  consolidar,
  impactoDoModulo,
  normalizarLinhas,
  resumirModulo,
  type LinhaDeRubrica,
  type ModuloDoMonitor,
  type ParDoMonitor,
} from "../monitor-custo-fixo";
import type { ChangeRow } from "../query";

/**
 * A RECONCILIAÇÃO, contra o export real da Freightec.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo prova, e o que o teste sem banco não provava
 * ---------------------------------------------------------------------------
 * `monitor-custo-fixo.test.ts` roda sobre alterações construídas à mão: ele
 * prende a regra. Este roda sobre os dois arquivos de `attached_assets`, com o
 * motor de verdade comparando vigências de verdade — e prende a **promessa**:
 * para o mesmo par, o que o Monitor publica de cada módulo é, campo a campo, o
 * que a auditoria daquele módulo publica.
 *
 * A diferença importa porque a auditoria original não é uma função: é um
 * caminho — change set, `listChanges` com o recorte do módulo, `linhasDeX`,
 * `impactoDeX`. O Monitor percorre o mesmo caminho com **uma** leitura em vez
 * de quatro, e é aí que um recorte errado passaria despercebido: uma coluna a
 * mais na união dos catálogos e o total de um módulo mudaria sem que nenhum
 * teste de unidade percebesse.
 *
 * Por isso a auditoria é reproduzida aqui **como a rota dela faz**, com o
 * `attributeCodes` dela, e não com a união. As duas respostas são comparadas.
 */

let ctx: TestDb;

/** Os pares de vigência do acervo, na ordem em que o motor os compara. */
let pares: { base: string; comparada: string; rotulo: string }[] = [];

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("monitor_custo_fixo_real");

  const vigencias = await listComparableSnapshots(ctx.db);
  /*
    Os pares são consecutivos **dentro da mesma cobertura**: o acervo traz
    cavalo e carreta como séries separadas, e o motor recusa comparar uma com a
    outra. É a mesma regra que `parDePartida` aplica na tela.
  */
  const porCobertura = new Map<string, typeof vigencias>();
  for (const v of vigencias) {
    porCobertura.set(v.entityTypeSet, [...(porCobertura.get(v.entityTypeSet) ?? []), v]);
  }
  for (const [cobertura, lista] of porCobertura) {
    for (let i = 1; i < lista.length; i++) {
      pares.push({
        base: lista[i - 1]!.id,
        comparada: lista[i]!.id,
        rotulo: `${cobertura} ${lista[i - 1]!.effectiveDate} → ${lista[i]!.effectiveDate}`,
      });
    }
  }
  /* Um acervo sem par nenhum faria todos os testes passarem por vacuidade. */
  expect(pares.length).toBeGreaterThan(0);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** O recorte de cada módulo — o mesmo que a rota dele pede ao motor. */
const CODIGOS: Record<ModuloDoMonitor, readonly string[]> = {
  FINAME: CODIGOS_DO_DETALHE,
  ALUGUEL: CODIGOS_DO_DETALHE_DE_ALUGUEL,
  IPVA: CODIGOS_DO_DETALHE_DE_IPVA,
  IMPOSTOS: CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  LUCRO_FIXO: CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
};

const LINHAS: Record<ModuloDoMonitor, (rows: ChangeRow[]) => LinhaDeRubrica[]> = {
  FINAME: (rows) => linhasDeFiname(rows),
  ALUGUEL: (rows) => linhasDeAluguel(rows),
  IPVA: (rows) => linhasDeIpva(rows),
  IMPOSTOS: (rows) => linhasDeImpostos(rows),
  LUCRO_FIXO: (rows) => linhasDeLucroFixo(rows),
};

const IMPACTO_NATIVO = {
  FINAME: (l: LinhaDeRubrica[]) => impactoPorPeriodicidade(l as never),
  ALUGUEL: (l: LinhaDeRubrica[]) => impactoDeAluguel(l as never),
  IPVA: (l: LinhaDeRubrica[]) => impactoDeIpva(l as never),
  IMPOSTOS: (l: LinhaDeRubrica[]) => impactoDeImpostos(l as never),
  LUCRO_FIXO: (l: LinhaDeRubrica[]) => impactoDeLucroFixo(l as never),
} satisfies Record<ModuloDoMonitor, (l: LinhaDeRubrica[]) => { porPeriodicidade: Record<string, number> }>;

/** A união dos cinco catálogos — a leitura única que a rota do Monitor faz. */
const UNIAO = [...new Set(Object.values(CODIGOS).flat())];

const PAR_FALSO = (base: string, comparada: string): ParDoMonitor => ({
  baseId: base,
  comparadaId: comparada,
  baseRotulo: null,
  comparadaRotulo: null,
  baseData: null,
  comparadaData: null,
});

/** A auditoria de um módulo, reproduzida como a rota dela a faz. */
async function auditoriaDe(modulo: ModuloDoMonitor, par: { base: string; comparada: string }) {
  const set = await computeChangeSet(ctx.db, par.base, par.comparada);
  const { rows } = await listChanges(ctx.db, set.id, {
    attributeCodes: [...CODIGOS[modulo]],
    limit: 5000,
  });
  const linhas = LINHAS[modulo](rows);
  return { linhas, impacto: IMPACTO_NATIVO[modulo](linhas) };
}

/** O Monitor, como a rota dele o faz: uma leitura, quatro traduções. */
async function monitorDe(par: { base: string; comparada: string }) {
  const set = await computeChangeSet(ctx.db, par.base, par.comparada);
  const { rows } = await listChanges(ctx.db, set.id, {
    attributeCodes: UNIAO,
    limit: 5000,
  });
  const p = PAR_FALSO(par.base, par.comparada);
  const resumos = MODULOS_DO_MONITOR.map((modulo) => {
    const daRubrica = LINHAS[modulo](rows);
    const normalizadas = normalizarLinhas(modulo, daRubrica, p, set.id);
    return resumirModulo(modulo, normalizadas, impactoDoModulo(modulo, daRubrica), p);
  });
  return { consolidado: consolidar(resumos), resumos };
}

describe("o acervo tem matéria — este arquivo não pode passar por vacuidade", () => {
  /*
    Um teste de reconciliação sobre zero linhas passa sempre, e não prova nada.
    Estes números são o retrato do que os dois arquivos de `attached_assets`
    produzem hoje, e são contrato: se algum deles mudar sem que alguém tenha
    mudado uma regra de propósito, a regra mudou sozinha.
  */
  it("os pares do acervo produzem alterações de custo fixo nos cinco módulos", async () => {
    const porModulo: Record<string, number> = {};
    let total = 0;
    for (const par of pares) {
      const { resumos } = await monitorDe(par);
      for (const r of resumos) {
        porModulo[r.modulo] = (porModulo[r.modulo] ?? 0) + r.alteracoes;
        total += r.alteracoes;
      }
    }
    /*
      Os 22 do Aluguel são **só entradas e saídas de ativo**: o acervo tem 11
      `ENTITY_ADDED` e 11 `ENTITY_REMOVED`, e toda rubrica os conta, porque uma
      placa que entra ou sai explica todas as outras linhas dela. Nenhum contrato
      de locação mudou de valor nas vigências deste acervo — as duas carretas
      alugadas declaram o mesmo aluguel nas 18 (`docs/ACHADO-ALUGUEL.md`).

      O número é contrato, como os outros quatro: no dia em que um aluguel se
      mover, ele deixa de ser 22 e alguém precisa ter mexido numa regra de
      propósito.
    */
    /*
      O FINAME foi de 219 para 229 linhas quando `lucro_fixo_do_cavalo` entrou
      no catálogo dele: são as 10 quitações do acervo
      (`docs/ACHADO-QUITACAO-DO-CAVALO.md`), que agora aparecem na auditoria do
      financiamento como a terceira parcela da parcela do cavalo. Elas entram
      como **conferência**, marcadas `foraDaSoma`: quem as soma continua sendo o
      Lucro Fixo, e é por isso que o portão da dupla contagem, abaixo, continua
      fechando com o mesmo dinheiro.
    */
    expect({ total, porModulo }).toEqual({
      total: 799,
      porModulo: { FINAME: 229, ALUGUEL: 22, IPVA: 437, LUCRO_FIXO: 89, IMPOSTOS: 22 },
    });
  }, 600_000);
});

describe("cada módulo fecha com a auditoria dele, par a par", () => {
  it("o impacto por periodicidade é idêntico, em todos os pares do acervo", async () => {
    const divergencias: string[] = [];

    for (const par of pares) {
      const { resumos } = await monitorDe(par);
      for (const modulo of MODULOS_DO_MONITOR) {
        const auditoria = await auditoriaDe(modulo, par);
        const noMonitor = resumos.find((r) => r.modulo === modulo)!;
        /*
          Igualdade de objeto, e não de um balde escolhido: um balde a mais, a
          menos, ou arredondado de outro jeito reprova — que é exatamente o que
          uma divergência financeira seria.
        */
        if (
          JSON.stringify(noMonitor.porPeriodicidade) !==
          JSON.stringify(auditoria.impacto.porPeriodicidade)
        ) {
          divergencias.push(
            `${modulo} em ${par.rotulo}: monitor ${JSON.stringify(
              noMonitor.porPeriodicidade,
            )} vs auditoria ${JSON.stringify(auditoria.impacto.porPeriodicidade)}`,
          );
        }
      }
    }

    expect(divergencias).toEqual([]);
  }, 600_000);

  it("a contagem de linhas de cada módulo é a mesma dos dois caminhos", async () => {
    const divergencias: string[] = [];
    for (const par of pares) {
      const { resumos } = await monitorDe(par);
      for (const modulo of MODULOS_DO_MONITOR) {
        const auditoria = await auditoriaDe(modulo, par);
        const noMonitor = resumos.find((r) => r.modulo === modulo)!;
        if (noMonitor.alteracoes !== auditoria.linhas.length) {
          divergencias.push(
            `${modulo} em ${par.rotulo}: ${noMonitor.alteracoes} vs ${auditoria.linhas.length}`,
          );
        }
      }
    }
    expect(divergencias).toEqual([]);
  }, 600_000);
});

describe("as invariantes, sobre dado real", () => {
  it("a identidade dos baldes fecha em todos os pares", async () => {
    for (const par of pares) {
      const { consolidado } = await monitorDe(par);
      const soma = SITUACOES_DO_IMPACTO.reduce(
        (t, s) => t + consolidado.porSituacao[s],
        0,
      );
      expect(soma, `baldes em ${par.rotulo}`).toBe(consolidado.alteracoes);
    }
  }, 600_000);

  it("ganho e perda abrem o líquido sem inventar dinheiro", async () => {
    for (const par of pares) {
      const { consolidado } = await monitorDe(par);
      for (const balde of consolidado.baldes) {
        expect(
          balde.ganho + balde.perda,
          `${par.rotulo} ${balde.periodicidade}`,
        ).toBeCloseTo(balde.liquido, 2);
      }
    }
  }, 600_000);

  it("nenhuma alteração sem valor carrega número, em nenhum par", async () => {
    for (const par of pares) {
      const set = await computeChangeSet(ctx.db, par.base, par.comparada);
      const { rows } = await listChanges(ctx.db, set.id, {
        attributeCodes: UNIAO,
        limit: 5000,
      });
      const p = PAR_FALSO(par.base, par.comparada);
      for (const modulo of MODULOS_DO_MONITOR) {
        for (const l of normalizarLinhas(modulo, LINHAS[modulo](rows), p, set.id)) {
          if (l.impacto.situacao === "VALORADO") continue;
          expect(l.impacto.valor, `${modulo} ${l.id}`).toBeNull();
        }
      }
    }
  }, 600_000);

  it("a mesma entidade não é contada duas vezes entre módulos", async () => {
    for (const par of pares) {
      const { consolidado } = await monitorDe(par);
      const somaIngenua = consolidado.porModulo.reduce(
        (t, m) => t + m.entidades.length,
        0,
      );
      expect(consolidado.entidadesAfetadas).toBeLessThanOrEqual(somaIngenua);
    }
  }, 600_000);
});

describe("o portão da dupla contagem, sobre dado real", () => {
  it("nenhum valor entra no total de dois módulos ao mesmo tempo", async () => {
    /*
      A prova comportamental, e não a de catálogo: para cada alteração real do
      acervo, quantos módulos a põem no total deles? A resposta tem de ser 0 ou
      1, nunca 2. Antes da correção de `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`
      este teste reprovaria em todo par com alteração de PIS/COFINS.
    */
    const disputadas: string[] = [];

    for (const par of pares) {
      const set = await computeChangeSet(ctx.db, par.base, par.comparada);
      const { rows } = await listChanges(ctx.db, set.id, {
        attributeCodes: UNIAO,
        limit: 5000,
      });
      const p = PAR_FALSO(par.base, par.comparada);

      const donosPorAlteracao = new Map<number, ModuloDoMonitor[]>();
      for (const modulo of MODULOS_DO_MONITOR) {
        for (const l of normalizarLinhas(modulo, LINHAS[modulo](rows), p, set.id)) {
          if (l.impacto.situacao !== "VALORADO" || l.changeId === null) continue;
          donosPorAlteracao.set(l.changeId, [
            ...(donosPorAlteracao.get(l.changeId) ?? []),
            modulo,
          ]);
        }
      }

      for (const [changeId, donos] of donosPorAlteracao) {
        if (donos.length > 1) {
          disputadas.push(`change #${changeId} em ${par.rotulo}: ${donos.join(" e ")}`);
        }
      }
    }

    expect(disputadas).toEqual([]);
  }, 600_000);
});
