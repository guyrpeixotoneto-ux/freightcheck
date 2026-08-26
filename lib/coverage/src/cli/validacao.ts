/**
 * A validação sobre o dado real, escrita como quem lê a tela.
 *
 * Importa os dois arquivos do export, promove, semeia o contrato e imprime as
 * cinco respostas que o módulo existe para dar — o que temos, o que falta, por
 * que falta, qual o impacto e de onde veio — com os números que o banco produz,
 * e não com exemplos.
 *
 *   pnpm --filter @workspace/coverage exec tsx src/cli/validacao.ts
 *
 * Exige `TEST_ADMIN_DATABASE_URL`. Cria um banco descartável e o derruba no
 * fim: não toca em banco de trabalho.
 */
import { sql } from "drizzle-orm";
import { createTestDatabase, importFixture, modelExportPaths } from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { semearContrato } from "../contrato";
import { detalheDaCelula, historicoDoAtributo } from "../detalhe";
import { visaoDaCobertura } from "../matriz";
import { entidadesDoAtributo } from "../observado";
import { provenienciaDoFato } from "../proveniencia";

const titulo = (texto: string) => {
  console.log(`\n${"═".repeat(78)}\n${texto}\n${"═".repeat(78)}`);
};

const ctx = await createTestDatabase(`validacao_${Date.now().toString(36)}`);
try {
  const { carreta, cavalo } = modelExportPaths();
  for (const f of [carreta, cavalo]) await importFixture(ctx.db, f);
  await seedTaxonomy(ctx.db, "validacao");
  await runProposalPass(ctx.db, "validacao");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  const semeado = await semearContrato(ctx.db);

  const t0 = Date.now();
  const visao = await visaoDaCobertura(ctx.db, { vigencias: 9 });
  const custo = Date.now() - t0;

  titulo("O QUE TEMOS");
  console.log(`Cobertura geral      ${visao.resumo.geral.percentual.toFixed(1)}%`);
  console.log(`Cobertura crítica    ${visao.resumo.critica.percentual.toFixed(1)}%`);
  console.log(`Lacunas              ${visao.resumo.lacunas.total} (${visao.resumo.lacunas.critico} críticas)`);
  console.log(`Conjuntos parciais   ${visao.resumo.conjuntosParciais}`);
  console.log(`Dados novos          ${visao.resumo.novos}`);
  console.log(`\n${visao.resumo.veredito.frase}`);
  console.log(
    `\nCombinações esperadas ${visao.resumo.geral.combinacoesEsperadas.toLocaleString("pt-BR")} · ` +
      `encontradas ${visao.resumo.geral.combinacoesEncontradas.toLocaleString("pt-BR")}`,
  );
  console.log(`Contrato semeado: ${semeado.inseridos} expectativas declaradas.`);
  console.log(`A visão inteira levou ${custo} ms.`);

  titulo("A MATRIZ");
  const cabecalho = ["Conjunto".padEnd(28), ...visao.colunas.map((c) => c.periodo.padStart(9))];
  console.log(cabecalho.join(""));
  for (const linha of visao.linhas) {
    const celulas = visao.colunas.map((coluna) => {
      const c = linha.celulas[coluna.chave];
      if (!c) return "—".padStart(9);
      const texto =
        c.estado === "AUSENTE"
          ? "AUSENTE"
          : c.estado === "NAO_APLICAVEL"
            ? "n/a"
            : `${c.conta.percentual.toFixed(1)}%`;
      return texto.padStart(9);
    });
    console.log([linha.rotulo.padEnd(28), ...celulas].join(""));
  }

  titulo("O QUE FALTA, E POR QUE FALTA");
  if (visao.lacunas.length === 0) {
    console.log(
      "Nenhuma lacuna. Todo atributo declarado por contrato e todo atributo que o\n" +
        "histórico sustenta chegaram para todas as entidades das nove vigências.",
    );
  }
  for (const lacuna of visao.lacunas.slice(0, 8)) {
    console.log(`\n• ${lacuna.attributeLabel} (${lacuna.attributeCode})`);
    console.log(`  ${lacuna.periodo} · ${lacuna.entityType.toLowerCase()} · ${lacuna.criticidade}`);
    console.log(
      `  ${lacuna.entidadesFaltando} de ${lacuna.entidadesEsperadas} equipamentos sem o dado`,
    );
    console.log(`  Por quê: ${lacuna.justificativa.motivo}`);
    console.log(
      `  Origem da expectativa: ${lacuna.justificativa.origem}` +
        ` (${lacuna.justificativa.declarado ? "declarada" : "inferida"})`,
    );
  }

  titulo("QUAL O IMPACTO");
  const critica = visao.resumo.critica;
  console.log(
    `Cobertura crítica ${critica.percentual.toFixed(1)}% — ` +
      `${critica.atributosEncontrados} de ${critica.atributosEsperados} atributos que sustentam análise.`,
  );
  console.log(
    critica.percentual >= 100
      ? "Análises financeiras disponíveis: todo dado crítico está presente."
      : "Análise comprometida: há dado crítico faltando.",
  );

  titulo("DE ONDE VEIO");
  const ultimaColuna = visao.colunas[visao.colunas.length - 1]!;
  const linhaCavalo = visao.linhas.find((l) => l.entityType === "CAVALO")!;
  const celula = linhaCavalo.celulas[ultimaColuna.chave]!;

  const detalhe = await detalheDaCelula(ctx.db, celula.vigencia.snapshotId, "CAVALO");
  console.log(
    `${detalhe.familiaLabel} de ${detalhe.equipamentoLabel}s · ${detalhe.vigencia.periodo}\n` +
      `Cobertura ${detalhe.conta.percentual.toFixed(1)}% · ` +
      `${detalhe.conta.entidadesEncontradas} entidades · ` +
      `${detalhe.conta.atributosEncontrados} de ${detalhe.conta.atributosEsperados} atributos\n` +
      `Combinações esperadas ${detalhe.conta.combinacoesEsperadas.toLocaleString("pt-BR")} · ` +
      `encontradas ${detalhe.conta.combinacoesEncontradas.toLocaleString("pt-BR")}\n` +
      `Revisão ${detalhe.vigencia.revision} (${detalhe.vigencia.sourceLabel})`,
  );
  console.log("\nArquivos que formaram esta vigência:");
  for (const c of detalhe.contribuintes) {
    console.log(
      `  • ${c.arquivo} — ${c.fatos.toLocaleString("pt-BR")} fatos` +
        (c.herdados > 0 ? `, ${c.herdados.toLocaleString("pt-BR")} herdados` : "") +
        ` · ${c.equipamentos.join("+")} · sha256 ${c.contentSha256.slice(0, 12)}…`,
    );
  }

  const entidades = await entidadesDoAtributo(
    ctx.db,
    celula.vigencia.snapshotId,
    "cavalo.ipva_licenciamento",
    { limite: 3 },
  );
  const comValor = entidades.find((e) => e.estado === "PRESENTE");
  if (comValor?.factId) {
    const p = await provenienciaDoFato(ctx.db, comValor.factId);
    if (p) {
      console.log(
        `\nDe qual arquivo veio o ipvaLicenciamento da placa ${p.entidade.identificador}` +
          ` em ${p.vigencia.effectiveDate}?`,
      );
      console.log(`  valor        ${p.valor}`);
      console.log(`  atributo     ${p.atributo.label} (${p.atributo.code})`);
      console.log(`  vigência     ${p.vigencia.sourceLabel}, revisão ${p.vigencia.revision}`);
      console.log(`  escopo       ${p.vigencia.scopeLabel} · ${p.vigencia.canal}`);
      console.log(
        `  célula       aba "${p.celula.aba}", linha ${p.celula.linha}, coluna ${p.celula.coluna}` +
          ` (cabeçalho "${p.celula.cabecalho}")`,
      );
      console.log(`  importação   ${p.importacao.importRunId} (${p.importacao.status})`);
      console.log(`  arquivo      ${p.importacao.arquivo}`);
      console.log(`  sha256       ${p.importacao.contentSha256}`);
    }
  }

  /* Um fato herdado: a prova de que a consolidação não quebrou a cadeia. */
  const { rows: herdado } = await ctx.db.execute<{ id: string }>(sql`
    SELECT f.id::text AS id FROM fato_visivel f
     WHERE f.snapshot_id = ${celula.vigencia.snapshotId}::uuid
       AND f.inherited_from_snapshot_id IS NOT NULL
     LIMIT 1
  `);
  if (herdado[0]) {
    const p = await provenienciaDoFato(ctx.db, Number(herdado[0].id));
    if (p) {
      console.log(
        `\nE um fato herdado (a carreta que o arquivo de cavalos não tocou)?\n` +
          `  ${p.atributo.code} da placa ${p.entidade.identificador}\n` +
          `  veio de   ${p.importacao.arquivo}\n` +
          `  herdado de ${p.herdadoDe?.sourceLabel} — a revisão anterior desta vigência\n` +
          `  A proveniência aponta o arquivo que trouxe o número, e não o que o carregou adiante.`,
      );
    }
  }

  titulo("HISTÓRICO DE UM ATRIBUTO");
  const serie = await historicoDoAtributo(ctx.db, "cavalo.ipva_licenciamento");
  for (const ponto of serie) {
    const barra = "█".repeat(Math.round(ponto.percentual / 5));
    console.log(
      `  ${ponto.periodo.padEnd(8)} ${String(ponto.percentual).padStart(5)}%  ${barra}` +
        `  (${ponto.comValor}/${ponto.entidadesNaVigencia})`,
    );
  }

  titulo("DESCOBERTAS");
  console.log(
    visao.descobertas.length === 0
      ? "Nenhuma. O export entrega as mesmas 138 colunas nas nove vigências, e o\n" +
          "módulo não anuncia novidade onde não houve — ruído aqui treina o usuário a\n" +
          "ignorar a seção justamente quando ela importar."
      : visao.descobertas
          .map((d) => `  + ${d.attributeCode} (${d.primeiroRotulo}, ${d.arquivo})`)
          .join("\n"),
  );
} finally {
  await ctx.drop();
}
process.exit(0);
