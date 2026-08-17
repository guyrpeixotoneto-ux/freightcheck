import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, modelExportPaths, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, runProposalPass, seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getFamiliesView } from "../families-view";
import { resolveContext } from "../series";
import { aguardandoPreco, reprecificar } from "../reprecificacao";

/**
 * Reprecificar isoladamente chega ao mesmo lugar que refazer tudo.
 *
 * ---------------------------------------------------------------------------
 * A prova que este arquivo existe para dar
 * ---------------------------------------------------------------------------
 *
 * O defeito foi medido contra o export real, variando **só** o instante em que
 * a comparação rodou em relação à curadoria:
 *
 * | estado                                   | precificadas | movimento        |
 * |------------------------------------------|--------------|------------------|
 * | como a produção ficava                   | 0 de 3.224   | —                |
 * | comparações refeitas depois da curadoria | 345 de 3.224 | R$ 1.530.515,54  |
 *
 * Refazer as comparações não era resposta: comparação e preço são derivados
 * diferentes — um responde *o que mudou*, o outro *quanto aquilo vale* — e
 * amarrar o segundo ao primeiro torna o preço refém de uma operação cara.
 *
 * Então a exigência é de equivalência, e é ela que este arquivo prova: **a
 * reprecificação isolada tem de produzir o mesmo conjunto e os mesmos valores
 * que a recomparação inteira produziria**, alteração por alteração, sem que
 * nenhuma linha de `change` seja recriada.
 *
 * A prova é feita em dois bancos irmãos, montados do mesmo arquivo e com a
 * mesma curadoria, divergindo só no caminho: um reprecifica, o outro recompara.
 * Comparar contra um número escrito à mão aqui provaria bem menos — o 345
 * seria uma constante que alguém atualizaria quando o teste caísse.
 */

let repreco: TestDb;
let refeito: TestDb;

async function montar(nome: string): Promise<TestDb> {
  const ctx = await createTestDatabase(nome);
  const { carreta, cavalo } = modelExportPaths();
  for (const arquivo of [carreta, cavalo]) {
    const r = await receiveFile(ctx.db, { filePath: arquivo });
    await captureRaw(ctx.db, r.importRunId);
    await stage(ctx.db, r.importRunId);
    const rel = await preview(ctx.db, r.importRunId);
    await promote(ctx.db, r.importRunId, {
      onExistingSnapshot: "NEW_REVISION",
      confirmNewEntityTypes: rel.pendingIdentities,
    });
  }
  await seedTaxonomy(ctx.db, "teste:reprecificacao");
  await runProposalPass(ctx.db, "teste:reprecificacao");
  // As comparações nascem **antes** da curadoria — que é a ordem real: o
  // arquivo chega, o produto compara, e só então alguém confirma o que as
  // colunas significam.
  await computeMissingChangeSets(ctx.db, "teste:reprecificacao");
  return ctx;
}

/**
 * Cada alteração com preço, na forma em que dá para comparar dois bancos.
 *
 * A chave é `código do atributo | rótulo da entidade | data da vigência`, e o
 * rótulo é deliberado: `entity_id` é UUID gerado por banco, de modo que
 * comparar por ele acusaria divergência em 345 linhas idênticas. A chave tem de
 * ser a identidade **de negócio** da linha, que é a que sobrevive a dois bancos
 * montados do mesmo arquivo.
 */
async function precificadas(ctx: TestDb) {
  const { rows } = await ctx.db.execute<{
    chave: string;
    valor: string;
    periodicidade: string | null;
  }>(sql`
    SELECT a.code || '|' || ch.entity_label || '|' || sb.effective_date::text AS chave,
           ch.impact_amount::text                                            AS valor,
           ch.impact_periodicity                                             AS periodicidade
      FROM "change" ch
      JOIN attribute a   ON a.id = ch.attribute_id
      JOIN change_set cs ON cs.id = ch.change_set_id
      JOIN snapshot sb   ON sb.id = cs.snapshot_b_id
     WHERE ch.impact_confidence = 'CALCULATED'
     ORDER BY 1
  `);
  return rows;
}

const soma = (linhas: { valor: string }[]) =>
  linhas.reduce((t, l) => t + Math.abs(Number(l.valor)), 0);

beforeAll(async () => {
  repreco = await montar("repreco_reprecificado");
  refeito = await montar("repreco_refeito");

  /*
    O mesmo ato de curadoria nos dois bancos.

    `applyConfirmations` chama `confirmAttribute`, que agora reprecifica na
    mesma operação — de modo que o banco da esquerda já sai daqui com os preços
    atualizados, sem que nada tenha recomparado.
  */
  await applyConfirmations(repreco.db);
  await applyConfirmations(refeito.db);

  // E o da direita refaz as comparações do zero, que é o contrafactual.
  await refeito.db.execute(sql`DELETE FROM "change"`);
  await refeito.db.execute(sql`DELETE FROM change_set`);
  await computeMissingChangeSets(refeito.db, "teste:refeito");
}, 3_600_000);

afterAll(async () => {
  await repreco?.drop().catch(() => {});
  await refeito?.drop().catch(() => {});
}, 120_000);

describe("convergência: reprecificar ≡ recomparar", () => {
  it("o cenário de fato precifica alguma coisa — o controle", async () => {
    /*
      Sem isto, um banco em que a curadoria não destravou nada faria as duas
      metades baterem em zero e o teste passaria provando nada.
    */
    const doRefeito = await precificadas(refeito);
    expect(doRefeito.length).toBeGreaterThan(100);
    expect(soma(doRefeito)).toBeGreaterThan(100_000);
    console.log(
      `\nCONTRAFACTUAL · ${doRefeito.length} alterações precificadas, ` +
        `R$ ${soma(doRefeito).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} de movimento\n`,
    );
  }, 600_000);

  it("as duas metades chegam ao mesmo conjunto e aos mesmos valores", async () => {
    const doRepreco = await precificadas(repreco);
    const doRefeito = await precificadas(refeito);

    expect(doRepreco.length, "conjuntos de tamanhos diferentes").toBe(doRefeito.length);
    expect(doRepreco.map((l) => l.chave)).toEqual(doRefeito.map((l) => l.chave));

    // Valor a valor, e não só a soma: dois erros que se cancelam dariam o mesmo
    // total e responderiam errado a "quanto vale esta linha".
    for (const [i, linha] of doRepreco.entries()) {
      expect(Number(linha.valor), `valor divergente em ${linha.chave}`).toBe(
        Number(doRefeito[i].valor),
      );
      expect(linha.periodicidade, `periodicidade divergente em ${linha.chave}`).toBe(
        doRefeito[i].periodicidade,
      );
    }

    expect(soma(doRepreco)).toBe(soma(doRefeito));
  }, 600_000);

  it("e o número que chega à decisão é o mesmo nos dois", async () => {
    const ler = async (ctx: TestDb) => {
      const contexto = (await resolveContext(ctx.db, undefined))!;
      const visao = await getFamiliesView(ctx.db, undefined, contexto);
      return {
        perdas: visao?.summary.lossesByPeriodicity,
        ganhos: visao?.summary.gainsByPeriodicity,
        naoCalculavel: visao?.summary.notCalculable,
      };
    };
    const a = await ler(repreco);
    const b = await ler(refeito);

    // O controle: a tela mostra dinheiro, e não dois vazios idênticos.
    expect(Object.keys(a.ganhos ?? {}).length + Object.keys(a.perdas ?? {}).length)
      .toBeGreaterThan(0);
    expect(a).toEqual(b);
  }, 600_000);
});

describe("reprecificar é idempotente", () => {
  it("a segunda passada não escreve nada e devolve o mesmo veredito", async () => {
    /*
      A idempotência não é conveniência: é o que permite chamar a
      reprecificação em toda confirmação sem medo, e é o que garante que dois
      curadores confirmando o mesmo atributo em sequência não produzam estados
      diferentes.
    */
    const alvo = "carreta.custo_fixo_carreta";
    const primeira = await reprecificar(repreco.db, alvo);
    const segunda = await reprecificar(repreco.db, alvo);

    expect(segunda.atualizadas, "a segunda passada escreveu no banco").toBe(0);
    expect(segunda.avaliadas).toBe(primeira.avaliadas);
    expect(segunda.passaramACalcular).toBe(0);
    expect(segunda.deixaramDeCalcular).toBe(0);
    expect(segunda.continuamSemPreco).toBe(primeira.continuamSemPreco);
    expect(segunda.motivos).toEqual(primeira.motivos);
  }, 600_000);

  it("o que ainda espera preço é contado, com o motivo", async () => {
    const pendente = await aguardandoPreco(repreco.db);
    expect(pendente.total).toBeGreaterThan(0);
    expect(pendente.porAtributo.length).toBeGreaterThan(0);

    // Nunca um número solto: cada pendência diz de qual atributo é e por quê.
    for (const linha of pendente.porAtributo) {
      expect(linha.attributeCode.length).toBeGreaterThan(0);
      expect(linha.motivo.length).toBeGreaterThan(10);
    }
    console.log(
      `\nAGUARDANDO PREÇO · ${pendente.total} alterações\n` +
        pendente.porAtributo
          .slice(0, 3)
          .map((l) => `  ${l.attributeCode} (${l.alteracoes}) — ${l.motivo.slice(0, 80)}`)
          .join("\n") +
        "\n",
    );
  }, 600_000);
});
