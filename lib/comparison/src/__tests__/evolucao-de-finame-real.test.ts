import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { placementOf } from "../families";
import { listContexts } from "../series";
import { listChanges, getChangeSetForPair, listComparableSnapshots } from "../query";
import { evolucaoPorPlaca } from "../evolucao-por-placa";
import {
  CODIGOS_DA_TABELA,
  CODIGOS_DO_DETALHE,
  codigosDoRecorte,
  impactoPorPeriodicidade,
  linhasDeFiname,
  variavelDoCodigo,
  VARIAVEIS_DE_FINAME,
} from "../finame";

/**
 * A EVOLUÇÃO DE FINAME CONTRA A BASE REAL — os contratos de reconciliação.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo é o portão, e não um teste a mais
 * ---------------------------------------------------------------------------
 * O FINAME é lido hoje por **duas** implementações da mesma regra de dupla
 * contagem, e elas nunca foram confrontadas:
 *
 * - `impactoPorPeriodicidade` (`finame.ts`), sobre `LinhaDeFiname` — a régua da
 *   Auditoria de FINAME, a tela de comparação entre duas vigências;
 * - `criarDeduplicador` (`deduplicacao.ts`), sobre `LinhaDeMudanca` — a régua do
 *   intervalo, que a Linha do Tempo e a Evolução por Placa usam.
 *
 * A Evolução anual do FINAME publica o número da segunda ao lado de uma tela que
 * publica o da primeira. Se as duas discordarem, o produto ganha a quinta
 * resposta para "qual foi o impacto?" — o defeito que `deduplicacao.ts`
 * documenta no próprio cabeçalho ter custado caro.
 *
 * O primeiro `it` mede isso par a par sobre a base real. Ele **passa** hoje, e
 * passa por um motivo que o segundo `it` guarda: o universo somado da tela é
 * `CODIGOS_DA_TABELA`, que não tem o total composto da carreta.
 *
 * ---------------------------------------------------------------------------
 * O que foi medido e fica registrado
 * ---------------------------------------------------------------------------
 * Com `carreta.finame` (o total composto) dentro do universo, as duas réguas
 * divergem em 2 dos 8 pares da base curada — a diferença é integralmente dele.
 * `impactoPorPeriodicidade` barra o total composto sempre (`linhaDaAlteracao`);
 * `deduplicacao.ts` só o exclui quando uma das duas regras dele alcança o caso,
 * e nenhuma alcança quando o implemento se move sozinho ou quando a composição
 * troca. Ver `docs/ACHADO-FINAME-TOTAL-COMPOSTO.md`.
 *
 * Este arquivo não conserta isso e não arredonda nada para escondê-lo: ele
 * amarra o que a tela nova de fato soma, e guarda a fronteira que a mantém
 * correta.
 */

let ctx: TestDb;
let datas: string[];

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("evolucao_de_finame_real");
  /* Da mais antiga para a mais recente — é assim que os pares são lidos. */
  datas = (await listPeriods(ctx.db)).map((p) => p.effective_date).reverse();
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const centavos = (v: number) => Number(v.toFixed(2));

/** O impacto mensal que a tela de comparação publica para um par. */
async function impactoDaTelaDeComparacao(
  base: string,
  comparada: string,
  codigos: readonly string[],
): Promise<number> {
  const { db } = ctx;
  const vigencias = await listComparableSnapshots(db);
  let total = 0;
  for (const a of vigencias.filter((v) => v.effectiveDate === base)) {
    /* O par é por série e por escopo: cavalo com cavalo, carreta com carreta —
       nunca um com o outro, que é a recusa do motor. */
    const b = vigencias.find(
      (v) =>
        v.effectiveDate === comparada &&
        v.entityTypeSet === a.entityTypeSet &&
        v.scopeHash === a.scopeHash,
    );
    if (!b) continue;
    const resumo = await getChangeSetForPair(db, a.id, b.id);
    if (!resumo) continue;
    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...codigos],
      limit: 5000,
    });
    total += impactoPorPeriodicidade(linhasDeFiname(rows)).porPeriodicidade.MENSAL ?? 0;
  }
  return centavos(total);
}

/** O impacto mensal que a evolução publica para o mesmo par, recortada. */
async function impactoDaEvolucao(
  base: string,
  comparada: string,
  codigos: readonly string[],
  tipo?: "CAVALO" | "CARRETA",
): Promise<number> {
  const { db } = ctx;
  const contextos = await listContexts(db);
  let total = 0;
  for (const c of contextos) {
    const evolucao = await evolucaoPorPlaca(db, {
      from: base,
      to: comparada,
      context: { scopeHash: c.scopeHash, channel: c.channel },
      parameters: codigos,
      periodicidade: "MENSAL",
      ...(tipo ? { tipo } : {}),
    });
    if (!evolucao) continue;
    /* A ponta pedida tem de ser a ponta aberta: `pontasDoIntervalo` cai num
       padrão quando a data não existe no contexto, e um intervalo trocado em
       silêncio faria este teste comparar outra coisa e passar. */
    expect(evolucao.from).toBe(base);
    expect(evolucao.to).toBe(comparada);
    total += evolucao.totais.liquido;
  }
  return centavos(total);
}

describe("as duas réguas de impacto do FINAME", () => {
  it("respondem o mesmo para cada par de vigências, no universo que a tela soma", async () => {
    expect(datas.length).toBeGreaterThan(1);

    const divergencias: string[] = [];
    for (let i = 0; i < datas.length - 1; i++) {
      const base = datas[i];
      const comparada = datas[i + 1];
      const daComparacao = await impactoDaTelaDeComparacao(base, comparada, CODIGOS_DA_TABELA);
      const daEvolucao = await impactoDaEvolucao(base, comparada, CODIGOS_DA_TABELA);
      if (daComparacao !== daEvolucao) {
        divergencias.push(
          `${base} → ${comparada}: comparação=${daComparacao} evolução=${daEvolucao} ` +
            `diferença=${centavos(daEvolucao - daComparacao)}`,
        );
      }
    }

    expect(
      divergencias,
      divergencias.length === 0
        ? ""
        : `As duas réguas divergem — ver docs/ACHADO-FINAME-TOTAL-COMPOSTO.md:\n  ${divergencias.join("\n  ")}\n`,
    ).toEqual([]);
  }, 900_000);

  it("mantém o total composto fora de qualquer universo somado", () => {
    /* A fronteira que faz o teste acima passar. Acrescentar `finame_total` a
       `VARIAVEIS_DE_FINAME` — ou tirar o `totalComposto` dele — reabre a
       divergência medida, e reabre aqui, antes de reabrir numa tela. */
    const compostos = [...CODIGOS_DA_TABELA].filter(
      (codigo) => variavelDoCodigo(codigo)?.totalComposto === true,
    );
    expect(compostos).toEqual([]);
    expect(VARIAVEIS_DE_FINAME.some((v) => v.totalComposto)).toBe(false);
    /* E o detalhe continua tendo o total composto — ele é mostrado, nunca somado. */
    expect(
      [...CODIGOS_DO_DETALHE].some(
        (codigo) => variavelDoCodigo(codigo)?.totalComposto === true,
      ),
    ).toBe(true);
  });
});

describe("o recorte de FINAME dentro da evolução", () => {
  it("é um subconjunto do intervalo inteiro, e só tem rubrica de FINAME", async () => {
    const { db } = ctx;
    const contexto = (await listContexts(db))[0];
    const pedido = {
      from: datas[0],
      to: datas[datas.length - 1],
      context: { scopeHash: contexto.scopeHash, channel: contexto.channel },
      periodicidade: "MENSAL",
    };

    const inteiro = await evolucaoPorPlaca(db, pedido);
    const recortado = await evolucaoPorPlaca(db, {
      ...pedido,
      parameters: CODIGOS_DA_TABELA,
    });
    expect(inteiro).not.toBeNull();
    expect(recortado).not.toBeNull();

    /* Nenhuma rubrica de fora do catálogo sobrevive ao recorte.

       A comparação é por `parameterKey` (`FAMÍLIA|parâmetro`, de `placementOf`)
       e não pelo código de atributo: dois códigos — o do cavalo e o da carreta —
       caem no mesmo parâmetro, que é justamente o agrupamento que a matriz
       mostra. */
    const doCatalogo = new Set(
      [...CODIGOS_DA_TABELA].map((codigo) => placementOf(codigo).parameterKey),
    );
    for (const r of recortado!.rubricas) {
      expect(doCatalogo.has(r.parameterKey), r.parameterKey).toBe(true);
    }

    /* E o recorte nunca inventa: menos alterações, menos ativos, nunca mais. */
    expect(recortado!.totais.alteracoes).toBeLessThanOrEqual(inteiro!.totais.alteracoes);
    expect(recortado!.totais.ativos).toBeLessThanOrEqual(inteiro!.totais.ativos);
    expect(recortado!.colunas.length).toBe(inteiro!.colunas.length);
  }, 900_000);

  it("Cavalo e Carreta somam Cavalo + Carreta, em cada par", async () => {
    for (let i = 0; i < datas.length - 1; i++) {
      const base = datas[i];
      const comparada = datas[i + 1];
      const juntos = await impactoDaEvolucao(base, comparada, CODIGOS_DA_TABELA);
      const cavalo = await impactoDaEvolucao(base, comparada, CODIGOS_DA_TABELA, "CAVALO");
      const carreta = await impactoDaEvolucao(base, comparada, CODIGOS_DA_TABELA, "CARRETA");
      expect(centavos(cavalo + carreta), `${base} → ${comparada}`).toBe(juntos);
    }
  }, 900_000);

  it("recortar por equipamento pelos códigos é o mesmo que recortar pelo tipo", async () => {
    /* É disto que a leitura ponta a ponta depende: ela não aceita `tipo`, só
       uma lista de atributos. Se as duas formas discordassem, a variação ponta
       a ponta da aba Cavalo responderia por outro recorte que não o dela. */
    for (const equipamento of ["CAVALO", "CARRETA"] as const) {
      for (let i = 0; i < datas.length - 1; i++) {
        const base = datas[i];
        const comparada = datas[i + 1];
        const porTipo = await impactoDaEvolucao(
          base,
          comparada,
          CODIGOS_DA_TABELA,
          equipamento,
        );
        const porCodigo = await impactoDaEvolucao(
          base,
          comparada,
          codigosDoRecorte(equipamento),
        );
        expect(porCodigo, `${equipamento} ${base} → ${comparada}`).toBe(porTipo);
      }
    }
  }, 900_000);
});
