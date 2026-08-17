import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  preview,
  promote,
  readTicketImport,
  receiveFile,
  receiveTicketFile,
  stage,
} from "@workspace/ingest";
import {
  createTestDatabase,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import {
  computeChangeSet,
  computeMissingChangeSets,
  contextFilter,
  findPreviousSnapshot,
  getFamiliesView,
  getGroupedView,
  getOverview,
  getPanoramaDeAlteracoes,
  getQuinzenaMatrix,
  getTicketTotals,
  listComparableSnapshots,
  listContexts,
  listTicketChanges,
  resolveContext,
  type SeriesContext,
} from "@workspace/comparison";
import { vigenciasObservadas, visaoDaCobertura } from "@workspace/coverage";
import { montarComposicao } from "@workspace/composition";
import { getDREDaFrota } from "@workspace/dre";
import {
  equipamentosDisponiveis,
  filtroDeVigenciaDisponivel,
  vigenciasDisponiveis,
} from "@workspace/availability";
import { encerrarPoolDoProcesso, type Database } from "@workspace/db";

/**
 * A matriz de propagação — o segundo grande objetivo desta auditoria.
 *
 * O primeiro foi tirar de circulação as definições concorrentes de série, de
 * escopo e de disponibilidade. Este é o que prova que elas sumiram: para cada
 * porta de entrada, o caminho inteiro, elo a elo —
 *
 *     entrada → ingestão → snapshot/fato canônico → resolução de contexto
 *             → módulo consumidor
 *
 * **Por que uma matriz e não uma lista de testes.** Um teste por módulo prova
 * que aquele módulo funciona; nenhum deles prova que o conjunto é completo. A
 * matriz é uma tabela declarada: cada consumidor do produto tem uma linha, e a
 * linha tem de dar um veredito. Um módulo novo que não entre aqui é um módulo
 * cuja propagação ninguém conferiu — e a lista fica visível no arquivo, em vez
 * de ficar implícita em quantos `it()` alguém lembrou de escrever.
 *
 * **Os três vereditos, e a ausência do quarto.** O tipo `Veredito` não tem
 * variante para "sem dados". É o ponto do exercício: um módulo pode não
 * mostrar nada, e quando não mostra ele tem de dizer **por quê** — a causa vem
 * do próprio resultado do módulo, não do conhecimento do teste. Um vazio sem
 * causa não é um estado legítimo; é o defeito que esta auditoria persegue.
 *
 * | Veredito | Quando |
 * |---|---|
 * | `RECEBEU` | o módulo enxerga o dado que entrou por aquela porta |
 * | `AUSENTE_COM_CAUSA` | não enxerga, e a causa está nomeada no resultado dele |
 * | `NAO_APLICAVEL` | a pergunta não se aplica àquele módulo para aquele dado |
 *
 * O `describe` final é o cenário que originou tudo: o dado importou
 * corretamente e a DRE Cavalo aparece vazia. Ele quebra cada elo da corrente,
 * um de cada vez, e exige que o diagnóstico aponte **qual** elo parou.
 */

// ---------------------------------------------------------------------------
// O vocabulário
// ---------------------------------------------------------------------------

type Veredito =
  | { estado: "RECEBEU"; detalhe: string }
  | { estado: "AUSENTE_COM_CAUSA"; causa: string }
  | { estado: "NAO_APLICAVEL"; porque: string };

const recebeu = (detalhe: string): Veredito => ({ estado: "RECEBEU", detalhe });
const naoAplicavel = (porque: string): Veredito => ({ estado: "NAO_APLICAVEL", porque });

interface Consumidor {
  /** Como a tela se chama para quem opera. */
  modulo: string;
  /** A função de leitura que o módulo usa — o elo final da corrente. */
  elo: string;
  perguntar: (ctx: Contexto) => Promise<Veredito>;
}

interface Contexto {
  db: Database;
  contexto: SeriesContext;
  /** O censo: as vigências vivas, que é a régua de todo módulo. */
  censo: string[];
  ticketImportId: string;
}

/** Uma linha da matriz, pronta para virar tabela na saída do teste. */
interface Linha {
  modulo: string;
  elo: string;
  veredito: Veredito;
}

async function medir(consumidores: Consumidor[], ctx: Contexto): Promise<Linha[]> {
  const linhas: Linha[] = [];
  for (const c of consumidores) {
    linhas.push({ modulo: c.modulo, elo: c.elo, veredito: await c.perguntar(ctx) });
  }
  return linhas;
}

/** A matriz impressa, para que a evidência seja legível e não só verde. */
function imprimir(titulo: string, linhas: Linha[]): void {
  const largura = Math.max(...linhas.map((l) => l.modulo.length));
  const corpo = linhas
    .map((l) => {
      const detalhe =
        l.veredito.estado === "RECEBEU"
          ? l.veredito.detalhe
          : l.veredito.estado === "AUSENTE_COM_CAUSA"
            ? l.veredito.causa
            : l.veredito.porque;
      return `  ${l.modulo.padEnd(largura)}  ${l.veredito.estado.padEnd(18)}  ${detalhe}`;
    })
    .join("\n");
  console.log(`\n${titulo}\n${corpo}\n`);
}

// ---------------------------------------------------------------------------
// A montagem
// ---------------------------------------------------------------------------

let ctx: TestDb;
let contexto: SeriesContext;
let censo: string[];
let ticketImportId: string;
let parametroDoChamado: string;
let valorDoChamado: number;

beforeAll(async () => {
  ctx = await createTestDatabase("matriz_propagacao");

  // Porta 1: as duas entregas do export real. A segunda entra como revisão da
  // vigência que a primeira abriu — é essa fusão que faz o censo ser um só.
  const { carreta, cavalo } = modelExportPaths();
  for (const arquivo of [carreta, cavalo]) {
    const recebido = await receiveFile(ctx.db, { filePath: arquivo });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      onExistingSnapshot: "NEW_REVISION",
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
  }

  await seedTaxonomy(ctx.db, "teste:matriz");
  await runProposalPass(ctx.db, "teste:matriz");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  /*
    O que a promoção passou a fazer, feito aqui pelo mesmo motivo.

    O fixture chama `promote` diretamente, sem passar pela rota — então ele
    tem de reproduzir o que a rota faz depois dela. Antes deste PR não havia
    o que reproduzir, e foi essa lacuna que a matriz denunciou.
  */
  await computeMissingChangeSets(ctx.db, "teste:matriz");

  const resolvido = await resolveContext(ctx.db, undefined);
  contexto = resolvido!;
  censo = (await vigenciasDisponiveis(ctx.db)).map((v) => v.effectiveDate);

  /*
    Porta 2: um chamado sobre uma placa e um parâmetro que **existem** no
    canônico.

    O alvo é escolhido pelo banco, e não inventado aqui. Foi a própria matriz
    que cobrou isto: com um rótulo de parâmetro que não resolve no dicionário,
    o leitor de chamados não tem em que se apoiar para buscar o *antes*, e a
    linha "Chamados · o antes" acusou ausência — corretamente. Um fixture que
    não exercita o elo faz a matriz medir o fixture em vez do produto.

    O parâmetro não pode ter vírgula no nome: o arquivo de chamados é CSV, e a
    vírgula partiria a linha em duas. Não é rigor do produto, é o formato do
    fixture.
  */
  const { rows } = await ctx.db.execute<{
    placa: string;
    parametro: string;
    label: string;
    valor: string;
  }>(sql`
    SELECT ei.identifier_value   AS placa,
           a.source_name         AS parametro,
           s.source_label        AS label,
           f.value_numeric::text AS valor
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id AND s.status = 'CLOSED'
      JOIN attribute a ON a.id = f.attribute_id
      JOIN entity_identifier ei ON ei.entity_id = f.entity_id
                              AND ei.is_current AND ei.identifier_type = 'PLACA'
     WHERE a.data_type = 'NUMERIC'
       AND NOT f.is_null
       AND a.source_name NOT LIKE '%,%'
       AND s.effective_date = (
         SELECT max(effective_date) FROM snapshot WHERE status = 'CLOSED')
     ORDER BY a.code, ei.identifier_value
     LIMIT 1
  `);
  parametroDoChamado = rows[0].parametro;
  // Distante do atual de propósito: o leitor recusa apurar impacto quando os
  // dois lados são os mesmos algarismos com o decimal deslocado, e um valor
  // próximo faria o teste medir aquela heurística em vez da propagação.
  valorDoChamado = Math.round((Number(rows[0].valor) + 1234.57) * 100) / 100;

  const dir = mkdtempSync(path.join(tmpdir(), "matriz-chamados-"));
  const arquivo = path.join(dir, "chamados.csv");
  writeFileSync(
    arquivo,
    [
      `Chamado,Status,Item,Vig. Abertura,Operação,"${parametroDoChamado}"`,
      `CH-MATRIZ,Concluído,Placa: ${rows[0].placa},${rows[0].label},SET,${valorDoChamado}`,
    ].join("\n"),
    "utf8",
  );
  const recebidoChamado = await receiveTicketFile(ctx.db, {
    filePath: arquivo,
    filename: "chamados.csv",
  });
  ticketImportId = recebidoChamado.ticketImportId;
  await readTicketImport(ctx.db, ticketImportId);
}, 1_800_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

// ---------------------------------------------------------------------------
// Porta 1 — Importações
// ---------------------------------------------------------------------------

const CONSUMIDORES_DA_VIGENCIA: Consumidor[] = [
  {
    modulo: "Vigências",
    elo: "listComparableSnapshots",
    async perguntar({ db, censo }) {
      const vistas = await listComparableSnapshots(db);
      const datas = [...new Set(vistas.map((v) => v.effectiveDate))].sort();
      if (datas.join() !== censo.join()) {
        return { estado: "AUSENTE_COM_CAUSA", causa: `viu ${datas.length} de ${censo.length}` };
      }
      return recebeu(`${datas.length} vigências, o censo inteiro`);
    },
  },
  {
    modulo: "Seletor de contexto",
    elo: "listContexts",
    async perguntar({ db, contexto }) {
      const contextos = await listContexts(db);
      const achou = contextos.some((c) => c.scopeHash === contexto.scopeHash);
      return achou
        ? recebeu(`${contextos.length} contexto(s), incluindo o da entrega`)
        : { estado: "AUSENTE_COM_CAUSA", causa: "o contexto da entrega não está no seletor" };
    },
  },
  {
    modulo: "Cobertura",
    elo: "vigenciasObservadas",
    async perguntar({ db, censo }) {
      const observadas = await vigenciasObservadas(db);
      const datas = [...new Set(observadas.map((v) => v.effectiveDate))].sort();
      if (datas.join() !== censo.join()) {
        return { estado: "AUSENTE_COM_CAUSA", causa: `viu ${datas.length} de ${censo.length}` };
      }
      return recebeu(`${datas.length} vigências, com agregado por equipamento`);
    },
  },
  {
    modulo: "Cobertura · matriz",
    elo: "visaoDaCobertura",
    async perguntar({ db, censo }) {
      const visao = await visaoDaCobertura(db, { vigencias: 24 });
      if (visao.colunas.length !== censo.length) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `${visao.colunas.length} colunas para ${censo.length} vigências`,
        };
      }
      return recebeu(`${visao.linhas.length} linha(s) × ${visao.colunas.length} vigências`);
    },
  },
  {
    modulo: "Painel",
    elo: "getOverview",
    async perguntar({ db, censo }) {
      const painel = await getOverview(db);
      const vistas = Number(painel.totals.vigencias);
      if (vistas !== censo.length) {
        return { estado: "AUSENTE_COM_CAUSA", causa: `contou ${vistas} de ${censo.length}` };
      }
      return recebeu(`${vistas} vigências e ${painel.totals.fatos} fatos, das vivas`);
    },
  },
  {
    modulo: "Alterações · anterior",
    elo: "findPreviousSnapshot",
    async perguntar({ db }) {
      const vigencias = await vigenciasDisponiveis(db);
      const semAnterior: string[] = [];
      for (const v of vigencias) {
        const anterior = await findPreviousSnapshot(db, v.snapshotId);
        if (!anterior.encontrada) semAnterior.push(`${v.sourceLabel} (${anterior.motivo})`);
      }
      // Exatamente uma: a primeira da série. Mais que isso é série partida.
      if (semAnterior.length !== 1) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `${semAnterior.length} vigências sem anterior: ${semAnterior.join(", ")}`,
        };
      }
      return recebeu(`${vigencias.length - 1} com anterior; só a primeira sem`);
    },
  },
  {
    modulo: "Alterações · planilha",
    elo: "getGroupedView",
    async perguntar({ db, contexto }) {
      const view = await getGroupedView(db, undefined, contexto);
      if (!view) return { estado: "AUSENTE_COM_CAUSA", causa: "getGroupedView devolveu null" };
      const comparadas = view.series.filter((s) => s.changeSetId !== null);
      const semComparacao = view.series.filter((s) => s.changeSetId === null);

      /*
        Aqui a matriz pegou uma quebra de verdade, e a primeira versão deste
        veredito a deixou passar: bastava haver motivo escrito. Havia — "a
        comparação ainda não foi calculada" —, e isso não é propagação
        funcionando, é o passo pós-importação que ninguém executava. Um motivo
        que explica a própria ausência do cálculo não pode contar como recebido.
      */
      const naoCalculada = semComparacao.filter((s) =>
        /ainda não calculada/i.test(s.reason ?? ""),
      );
      if (naoCalculada.length > 0) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa:
            `${naoCalculada.length} série(s) sem comparação calculada — ` +
            `a promoção não disparou o backfill`,
        };
      }
      if (comparadas.length === 0) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: "nenhuma série comparada na vigência mais recente",
        };
      }
      const mudas = semComparacao.filter((s) => !s.reason);
      if (mudas.length > 0) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `${mudas.length} série(s) sem comparação e sem motivo escrito`,
        };
      }
      return recebeu(
        `${comparadas.length} série(s) comparada(s)` +
          (semComparacao.length > 0 ? `, ${semComparacao.length} com motivo escrito` : ""),
      );
    },
  },
  {
    modulo: "Alterações · comparação",
    elo: "computeChangeSet",
    async perguntar({ db }) {
      const vigencias = await vigenciasDisponiveis(db);
      const ultima = vigencias[vigencias.length - 1];
      const anterior = await findPreviousSnapshot(db, ultima.snapshotId);
      if (!anterior.encontrada) {
        return { estado: "AUSENTE_COM_CAUSA", causa: anterior.frase };
      }
      const set = await computeChangeSet(db, anterior.vigencia.snapshotId, ultima.snapshotId);
      return recebeu(`${set.valueChanges} alterações no par mais recente`);
    },
  },
  {
    modulo: "Alterações · panorama",
    elo: "getPanoramaDeAlteracoes",
    async perguntar({ db, contexto }) {
      const panorama = await getPanoramaDeAlteracoes(db, { context: contexto });
      if (!panorama) {
        return { estado: "AUSENTE_COM_CAUSA", causa: "getPanoramaDeAlteracoes devolveu null" };
      }
      return recebeu(`${panorama.periods.length} período(s) no eixo do tempo`);
    },
  },
  {
    modulo: "Parâmetros",
    elo: "getFamiliesView",
    async perguntar({ db, contexto }) {
      const view = await getFamiliesView(db, undefined, contexto);
      if (!view) return { estado: "AUSENTE_COM_CAUSA", causa: "getFamiliesView devolveu null" };
      return recebeu(`${view.families.length} família(s) de parâmetro`);
    },
  },
  {
    modulo: "Impacto",
    elo: "getQuinzenaMatrix",
    async perguntar({ db, contexto, censo }) {
      const matriz = await getQuinzenaMatrix(db, { context: contexto });
      if (!matriz.ok) {
        /*
          Desde o PR-18, o vazio do Impacto chega nomeado. `NAO_SE_APLICA` é um
          veredito legítimo desta matriz — quer dizer que o dado está lá e o
          módulo não fala dele —, e os outros três são ausência com causa. Antes
          os quatro chegavam como `null`, e esta linha só sabia dizer
          "devolveu null", que é a mesma frase única que o PR-18 desfez.
        */
        if (matriz.vazio.estado === "NAO_SE_APLICA") {
          return naoAplicavel(matriz.vazio.frase);
        }
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `${matriz.vazio.estado}: ${matriz.vazio.frase}`,
        };
      }
      if (matriz.valor.periods.length !== censo.length) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `${matriz.valor.periods.length} colunas para ${censo.length} vigências`,
        };
      }
      return recebeu(`${matriz.valor.periods.length} colunas, uma por vigência`);
    },
  },
  {
    modulo: "Composição",
    elo: "montarComposicao",
    async perguntar({ db, contexto }) {
      const { rows } = await db.execute<{ id: string }>(sql`
        SELECT DISTINCT f.entity_id::text AS id
          FROM fact f JOIN snapshot s ON s.id = f.snapshot_id AND s.status = 'CLOSED'
         LIMIT 1
      `);
      const composicao = await montarComposicao(db, rows[0].id, { context: contexto });
      if (!composicao) {
        return { estado: "AUSENTE_COM_CAUSA", causa: "montarComposicao devolveu null" };
      }
      return recebeu(`composição montada para 1 equipamento`);
    },
  },
  {
    modulo: "DRE · Cavalo",
    elo: "getDREDaFrota(CAVALO)",
    async perguntar({ db, contexto }) {
      return vereditoDaDRE(db, "CAVALO", contexto);
    },
  },
  {
    modulo: "DRE · Carreta",
    elo: "getDREDaFrota(CARRETA)",
    async perguntar({ db, contexto }) {
      return vereditoDaDRE(db, "CARRETA", contexto);
    },
  },
  {
    modulo: "Chamados",
    elo: "listTicketChanges",
    async perguntar() {
      return naoAplicavel(
        "chamado é dado da porta 2; uma vigência importada não abre chamado",
      );
    },
  },
  {
    modulo: "Book do operador",
    elo: "book_entry",
    async perguntar() {
      return naoAplicavel(
        "domínio documental separado, que não lê nem escreve o canônico operacional",
      );
    },
  },
];

/**
 * O veredito de um escopo da DRE — a linha que importa mais neste arquivo.
 *
 * A DRE tem quatro naturezas de valor e nenhuma delas é zero (`plano.ts`, §4).
 * Um escopo sem número não é um vazio: ou não há veículo daquele equipamento no
 * recorte, ou há e a semântica ainda não foi confirmada. As duas coisas têm
 * frase própria, e é isso que este veredito extrai.
 */
async function vereditoDaDRE(
  db: Database,
  escopo: "CAVALO" | "CARRETA",
  contexto: SeriesContext,
): Promise<Veredito> {
  const dre = await getDREDaFrota(db, escopo, { context: contexto });
  if (!dre) {
    return { estado: "AUSENTE_COM_CAUSA", causa: "getDREDaFrota devolveu null" };
  }
  if (dre.ranking.length === 0) {
    const equipamentos = await equipamentosDisponiveis(db);
    const temEquipamento = equipamentos.some((e) => e.entityType === escopo);
    return {
      estado: "AUSENTE_COM_CAUSA",
      causa: temEquipamento
        ? `há ${escopo} no canônico e o ranking veio vazio — a propagação parou depois do fato`
        : `nenhuma vigência entregou ${escopo}`,
    };
  }
  return recebeu(`${dre.ranking.length} veículo(s) no ranking`);
}

describe("porta 1 — Importações", () => {
  it("a matriz não tem nenhum vazio sem causa", async () => {
    const linhas = await medir(CONSUMIDORES_DA_VIGENCIA, {
      db: ctx.db,
      contexto,
      censo,
      ticketImportId,
    });
    imprimir("PORTA 1 · Importações → vigência canônica", linhas);

    // Nenhum módulo pode estar ausente: o export real entrega tudo o que estes
    // módulos consomem, então toda linha é RECEBEU ou NAO_APLICAVEL declarado.
    const ausentes = linhas.filter((l) => l.veredito.estado === "AUSENTE_COM_CAUSA");
    expect(
      ausentes.map((a) => `${a.modulo}: ${(a.veredito as { causa: string }).causa}`),
    ).toEqual([]);
  }, 1_800_000);

  it("todo módulo que consome vigência recebeu — e os que não consomem dizem por quê", async () => {
    const linhas = await medir(CONSUMIDORES_DA_VIGENCIA, {
      db: ctx.db,
      contexto,
      censo,
      ticketImportId,
    });

    const receberam = linhas.filter((l) => l.veredito.estado === "RECEBEU");
    const naoSeAplicam = linhas.filter((l) => l.veredito.estado === "NAO_APLICAVEL");

    // A contagem é fixa de propósito: um consumidor novo que entre na lista sem
    // ajustar este número obriga quem o adicionou a olhar o veredito dele.
    expect(receberam.length).toBe(14);
    expect(naoSeAplicam.length).toBe(2);
    expect(receberam.length + naoSeAplicam.length).toBe(linhas.length);

    // E nenhum NAO_APLICAVEL sem justificativa escrita.
    for (const l of naoSeAplicam) {
      expect((l.veredito as { porque: string }).porque.length).toBeGreaterThan(20);
    }
  }, 1_800_000);
});

// ---------------------------------------------------------------------------
// Porta 2 — Alterações · Chamados
// ---------------------------------------------------------------------------

const CONSUMIDORES_DO_CHAMADO: Consumidor[] = [
  {
    modulo: "Chamados · lista",
    elo: "listTicketChanges",
    async perguntar({ db, ticketImportId }) {
      const { total } = await listTicketChanges(db, ticketImportId, {});
      return total > 0
        ? recebeu(`${total} alteração(ões) de chamado`)
        : { estado: "AUSENTE_COM_CAUSA", causa: "o envio não produziu alteração nenhuma" };
    },
  },
  {
    modulo: "Chamados · totais",
    elo: "getTicketTotals",
    async perguntar({ db, ticketImportId }) {
      const totais = await getTicketTotals(db, ticketImportId);
      return totais
        ? recebeu(`totais apurados para o envio`)
        : { estado: "AUSENTE_COM_CAUSA", causa: "getTicketTotals devolveu vazio" };
    },
  },
  {
    modulo: "Chamados · o antes",
    elo: "valoresVigentes (via readTicketImport)",
    async perguntar({ db, ticketImportId }) {
      const { rows } = await db.execute<{ fonte: string; referencia: string | null }>(sql`
        SELECT tc.before_source::text AS fonte, tc.before_reference AS referencia
          FROM ticket_change tc
         WHERE tc.ticket_import_id = ${ticketImportId}::uuid
      `);
      const daVigencia = rows.filter((r) => r.fonte === "VIGENCIA");
      if (daVigencia.length === 0) {
        // Legítimo, e tem de vir nomeado: o chamado que traz o antes no próprio
        // arquivo não precisa do canônico.
        const doArquivo = rows.filter((r) => r.fonte === "ARQUIVO").length;
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `nenhum antes veio do canônico; ${doArquivo} veio do próprio arquivo`,
        };
      }
      return recebeu(
        `${daVigencia.length} antes vindo(s) da vigência (${daVigencia[0].referencia})`,
      );
    },
  },
  {
    modulo: "Cobertura",
    elo: "vigenciasObservadas",
    async perguntar() {
      return naoAplicavel(
        "chamado não é fato de vigência: ele não entra no denominador da cobertura",
      );
    },
  },
  {
    modulo: "Impacto",
    elo: "getQuinzenaMatrix",
    async perguntar() {
      return naoAplicavel(
        "a matriz de Impacto é por vigência; o chamado tem a própria aba, com o próprio total",
      );
    },
  },
  {
    modulo: "Alterações · comparação",
    elo: "change",
    async perguntar({ db, ticketImportId }) {
      // Não é só "não se aplica": é uma invariante a proteger. Se um chamado
      // virasse `change`, ele seria contado como alteração de vigência.
      const { rows } = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
          FROM "change" ch
         WHERE ch.entity_label IN (
                 SELECT t.entity_label FROM ticket_change t
                  WHERE t.ticket_import_id = ${ticketImportId}::uuid)
           AND ch.value_after = ${String(valorDoChamado)}
      `);
      if (Number(rows[0].n) > 0) {
        return {
          estado: "AUSENTE_COM_CAUSA",
          causa: `o chamado virou ${rows[0].n} linha(s) de change — é alteração de vigência inventada`,
        };
      }
      return naoAplicavel(
        "chamado não vira alteração de vigência, e a ausência dele em `change` é verificada",
      );
    },
  },
  {
    modulo: "DRE · Cavalo",
    elo: "getDREDaFrota(CAVALO)",
    async perguntar() {
      return naoAplicavel(
        "a DRE apura a vigência; o chamado é pedido de mudança, não remuneração vigente",
      );
    },
  },
];

describe("porta 2 — Alterações · Chamados", () => {
  it("a matriz não tem nenhum vazio sem causa", async () => {
    const linhas = await medir(CONSUMIDORES_DO_CHAMADO, {
      db: ctx.db,
      contexto,
      censo,
      ticketImportId,
    });
    imprimir("PORTA 2 · Chamados → alteração de chamado", linhas);

    const ausentes = linhas.filter((l) => l.veredito.estado === "AUSENTE_COM_CAUSA");
    expect(
      ausentes.map((a) => `${a.modulo}: ${(a.veredito as { causa: string }).causa}`),
    ).toEqual([]);
  }, 900_000);

  it("o chamado chega onde tem significado e para onde não tem", async () => {
    const linhas = await medir(CONSUMIDORES_DO_CHAMADO, {
      db: ctx.db,
      contexto,
      censo,
      ticketImportId,
    });
    expect(linhas.filter((l) => l.veredito.estado === "RECEBEU").length).toBe(3);
    expect(linhas.filter((l) => l.veredito.estado === "NAO_APLICAVEL").length).toBe(4);
  }, 900_000);
});

// ---------------------------------------------------------------------------
// O cenário que originou a auditoria
// ---------------------------------------------------------------------------

/**
 * Onde a propagação parou — a pergunta que ninguém conseguia responder.
 *
 * O relato que abriu esta auditoria foi "o dado importou e a DRE Cavalo está
 * vazia". Descobrir por quê levou horas de leitura de código, porque a tela
 * dizia a mesma coisa para cinco causas diferentes.
 *
 * Este diagnóstico percorre a corrente na ordem e para no primeiro elo que não
 * fecha, nomeando-o. Ele não substitui os módulos: cada elo pergunta ao dono
 * dele — ingestão, autoridade de disponibilidade, curadoria, DRE — e o valor
 * está em juntá-los numa resposta só.
 */
type Elo =
  | "ARQUIVO_RECEBIDO"
  | "PROMOVIDO"
  | "EQUIPAMENTO_NO_CANONICO"
  | "EQUIPAMENTO_NO_RECORTE"
  | "SEMANTICA_CONFIRMADA"
  | "APURADO";

interface Diagnostico {
  /** O primeiro elo que não fechou, ou `null` quando a corrente está inteira. */
  parouEm: Elo | null;
  frase: string;
  /** Cada elo, na ordem, com o que foi medido nele. */
  corrente: { elo: Elo; ok: boolean; medida: string }[];
}

async function ondeAPropagacaoParou(
  db: Database,
  escopo: "CAVALO" | "CARRETA",
  contextoPedido?: SeriesContext,
): Promise<Diagnostico> {
  const corrente: Diagnostico["corrente"] = [];
  const registrar = (elo: Elo, ok: boolean, medida: string) => {
    corrente.push({ elo, ok, medida });
    return ok;
  };
  const parar = (elo: Elo, frase: string): Diagnostico => ({ parouEm: elo, frase, corrente });

  // 1. Algum arquivo chegou?
  const { rows: arquivos } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM import_run WHERE status = 'PROMOTED'
  `);
  if (!registrar("ARQUIVO_RECEBIDO", Number(arquivos[0].n) > 0, `${arquivos[0].n} run(s) promovido(s)`)) {
    return parar("ARQUIVO_RECEBIDO", "Nenhum arquivo foi promovido. A propagação parou antes de começar.");
  }

  // 2. Existe vigência viva?
  const vigencias = await vigenciasDisponiveis(db);
  if (!registrar("PROMOVIDO", vigencias.length > 0, `${vigencias.length} vigência(s) disponível(is)`)) {
    return parar("PROMOVIDO", "Há arquivo promovido e nenhuma vigência disponível — a promoção não fechou snapshot.");
  }

  // 3. O equipamento existe no canônico?
  const equipamentos = await equipamentosDisponiveis(db);
  const doEscopo = equipamentos.find((e) => e.entityType === escopo);
  if (!registrar("EQUIPAMENTO_NO_CANONICO", Boolean(doEscopo), doEscopo ? `${doEscopo.vigencias} vigência(s) com ${escopo}` : `nenhuma vigência entregou ${escopo}`)) {
    return parar(
      "EQUIPAMENTO_NO_CANONICO",
      `Nenhuma vigência entregou ${escopo}. Falta importar o arquivo desse equipamento — não é defeito de leitura.`,
    );
  }

  /*
    4. E dentro do recorte, **na vigência que a DRE apura**?

    A primeira versão deste elo contava o equipamento em todas as vigências, e
    o número não batia com o do elo seguinte: 64 cavalos contra 62 no ranking.
    Não era defeito do produto — dois cavalos saíram da frota antes da última
    vigência —, era defeito do diagnóstico. Um elo que mede coisa diferente do
    elo seguinte não sabe dizer onde a corrente parou: ele inventa uma
    diferença e obriga quem lê a investigá-la.
  */
  const contexto = contextoPedido ?? (await resolveContext(db, undefined))!;
  const { rows: noRecorte } = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT f.entity_id)::int AS n
      FROM fact f
      JOIN entity e   ON e.id = f.entity_id AND e.entity_type = ${escopo}
      JOIN snapshot s ON s.id = f.snapshot_id
     WHERE ${filtroDeVigenciaDisponivel("s")}
       AND ${contextFilter("s", contexto)}
       AND s.effective_date = (
         SELECT max(s2.effective_date)
           FROM snapshot s2
          WHERE ${filtroDeVigenciaDisponivel("s2")}
            AND ${contextFilter("s2", contexto)})
  `);
  if (!registrar("EQUIPAMENTO_NO_RECORTE", Number(noRecorte[0].n) > 0, `${noRecorte[0].n} ${escopo}(s) na vigência apurada`)) {
    return parar(
      "EQUIPAMENTO_NO_RECORTE",
      `Existe ${escopo} no canônico, e nenhum no contexto pedido ` +
        `(escopo ${contexto.scopeHash.slice(0, 8)}, canal ${contexto.channel}). ` +
        `O dado está noutra unidade ou noutro canal.`,
    );
  }

  // 5. A semântica dos parâmetros daquele equipamento foi confirmada?
  const { rows: semantica } = await db.execute<{ confirmados: number; total: number }>(sql`
    SELECT count(*) FILTER (WHERE a.semantics_status = 'CONFIRMED')::int AS confirmados,
           count(*)::int                                                 AS total
      FROM attribute a
     WHERE a.entity_type = ${escopo}
       AND a.is_monetary IS TRUE
  `);
  if (
    !registrar(
      "SEMANTICA_CONFIRMADA",
      Number(semantica[0].confirmados) > 0,
      `${semantica[0].confirmados} de ${semantica[0].total} parâmetro(s) monetário(s) confirmado(s)`,
    )
  ) {
    return parar(
      "SEMANTICA_CONFIRMADA",
      `Há ${escopo} com fato e nenhum parâmetro monetário confirmado. A DRE se recusa a somar o que não sabe medir — é o comportamento certo, e a saída é a curadoria.`,
    );
  }

  // 6. A DRE apura?
  const dre = await getDREDaFrota(db, escopo, { context: contexto });
  const apurou = Boolean(dre && dre.ranking.length > 0);
  registrar("APURADO", apurou, apurou ? `${dre!.ranking.length} veículo(s) no ranking` : "ranking vazio");
  if (!apurou) {
    return parar(
      "APURADO",
      `Todos os elos anteriores fecham e a DRE ${escopo} não apurou. Isto é defeito do motor, e não falta de dado.`,
    );
  }

  return { parouEm: null, frase: `A corrente está inteira: a DRE ${escopo} apurou.`, corrente };
}

describe("o cenário que originou a auditoria: a DRE Cavalo vazia", () => {
  it("com a corrente inteira, o diagnóstico não aponta elo nenhum", async () => {
    const d = await ondeAPropagacaoParou(ctx.db, "CAVALO", contexto);
    console.log(
      `\nDIAGNÓSTICO · DRE Cavalo\n` +
        d.corrente.map((e) => `  ${e.ok ? "✓" : "✗"} ${e.elo.padEnd(26)} ${e.medida}`).join("\n") +
        `\n  → ${d.frase}\n`,
    );

    expect(d.parouEm).toBeNull();
    expect(d.corrente.every((e) => e.ok)).toBe(true);

    /*
      Os dois últimos elos têm de falar do mesmo conjunto.

      É a asserção que teria evitado o 64 contra 62: se o elo que conta o
      equipamento no recorte medir uma coisa e o que apura medir outra, o
      diagnóstico aponta um culpado inexistente. A igualdade aqui é o que
      torna a corrente uma corrente, e não seis medições soltas.
    */
    const noRecorte = Number(d.corrente[3].medida.split(" ")[0]);
    const apurados = Number(d.corrente[5].medida.split(" ")[0]);
    expect(apurados).toBe(noRecorte);
    // Os seis elos, na ordem. Um elo que suma daqui é um elo que ninguém confere.
    expect(d.corrente.map((e) => e.elo)).toEqual([
      "ARQUIVO_RECEBIDO",
      "PROMOVIDO",
      "EQUIPAMENTO_NO_CANONICO",
      "EQUIPAMENTO_NO_RECORTE",
      "SEMANTICA_CONFIRMADA",
      "APURADO",
    ]);
  }, 900_000);

  it("sem arquivo nenhum, o diagnóstico para no primeiro elo", async () => {
    const vazio = await createTestDatabase("matriz_elo_arquivo");
    try {
      const d = await ondeAPropagacaoParou(vazio.db, "CAVALO");
      expect(d.parouEm).toBe("ARQUIVO_RECEBIDO");
      expect(d.frase).toContain("antes de começar");
    } finally {
      await vazio.drop().catch(() => {});
    }
  }, 900_000);

  it("com carreta importada e cavalo não, o diagnóstico nomeia o equipamento que falta", async () => {
    /*
      O elo que o relato original teria acusado. Sem esta distinção, "a DRE
      Cavalo está vazia" e "ninguém importou o arquivo de cavalos" são a mesma
      tela — e a segunda não é defeito, é uma pendência de quem opera.
    */
    const soCarreta = await createTestDatabase("matriz_elo_equipamento");
    try {
      const { carreta } = modelExportPaths();
      const recebido = await receiveFile(soCarreta.db, { filePath: carreta });
      await captureRaw(soCarreta.db, recebido.importRunId);
      await stage(soCarreta.db, recebido.importRunId);
      const relatorio = await preview(soCarreta.db, recebido.importRunId);
      await promote(soCarreta.db, recebido.importRunId, {
        onExistingSnapshot: "NEW_REVISION",
        confirmNewEntityTypes: relatorio.pendingIdentities,
      });

      const d = await ondeAPropagacaoParou(soCarreta.db, "CAVALO");
      expect(d.parouEm).toBe("EQUIPAMENTO_NO_CANONICO");
      expect(d.frase).toContain("Falta importar o arquivo desse equipamento");
      // E a corrente mostra que os dois primeiros elos fecharam — a diferença
      // entre "não importou nada" e "importou o outro equipamento".
      expect(d.corrente.slice(0, 2).every((e) => e.ok)).toBe(true);
    } finally {
      await soCarreta.drop().catch(() => {});
    }
  }, 1_800_000);

  it("com cavalo importado e semântica não confirmada, o diagnóstico aponta a curadoria", async () => {
    /*
      O elo mais traiçoeiro: o dado está lá, inteiro, e a DRE se recusa a somar
      porque não sabe o que os números medem. É o comportamento **certo** — a
      alternativa seria somar o que não se entende —, e sem o diagnóstico ele é
      indistinguível de dado ausente.
    */
    const semCuradoria = await createTestDatabase("matriz_elo_semantica");
    try {
      const { carreta, cavalo } = modelExportPaths();
      for (const arquivo of [carreta, cavalo]) {
        const recebido = await receiveFile(semCuradoria.db, { filePath: arquivo });
        await captureRaw(semCuradoria.db, recebido.importRunId);
        await stage(semCuradoria.db, recebido.importRunId);
        const relatorio = await preview(semCuradoria.db, recebido.importRunId);
        await promote(semCuradoria.db, recebido.importRunId, {
          onExistingSnapshot: "NEW_REVISION",
          confirmNewEntityTypes: relatorio.pendingIdentities,
        });
      }
      // De propósito: nenhum `runProposalPass`, nenhum `applyConfirmations`.

      const d = await ondeAPropagacaoParou(semCuradoria.db, "CAVALO");
      expect(d.parouEm).toBe("SEMANTICA_CONFIRMADA");
      expect(d.frase).toContain("a saída é a curadoria");
      // Os quatro elos de dado fecharam: o dado chegou inteiro.
      expect(d.corrente.slice(0, 4).every((e) => e.ok)).toBe(true);
    } finally {
      await semCuradoria.drop().catch(() => {});
    }
  }, 1_800_000);
});

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
});
