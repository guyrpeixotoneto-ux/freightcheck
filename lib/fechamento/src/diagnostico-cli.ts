import { createDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * O que uma competência tem de verdade — documento por documento, fato por fato.
 *
 * ```
 * pnpm --filter @workspace/fechamento exec tsx ./src/diagnostico-cli.ts 2026 7
 * pnpm --filter @workspace/fechamento exec tsx ./src/diagnostico-cli.ts 2026 7 443 36
 * ```
 *
 * **Por que isto existe.** A pergunta "eu importei o arquivo, por que a tela diz
 * que não?" é respondida por um número só — quantos fatos aquele documento
 * produziu —, e esse número estava a um `psql` de distância de quem precisa
 * dele. Um comando que responde em uma linha é a diferença entre diagnosticar em
 * dez segundos e desconfiar do produto por uma tarde.
 *
 * **O que ele procura.** Um documento **vigente com zero linhas** é o defeito
 * que `recusarDocumentoSemFatos` passou a impedir: o arquivo foi aceito, a
 * lista o conta como recebido, e nenhuma conta o enxerga. Os enviados antes da
 * guarda continuam no banco, e é aqui que eles aparecem.
 *
 * Não escreve nada: é leitura pura, segura de rodar em produção.
 */

const FATOS: { tipo: string; tabela: string }[] = [
  { tipo: "OPERACAO", tabela: "fechamento_viagem" },
  { tipo: "CTE", tabela: "fechamento_cte" },
  { tipo: "PAGAMENTO", tabela: "fechamento_pagamento_item" },
  { tipo: "DISPONIBILIDADE", tabela: "fechamento_disponibilidade" },
  { tipo: "REQUISICOES", tabela: "fechamento_requisicao" },
  { tipo: "CONCILIACAO", tabela: "fechamento_conciliacao_item" },
];

interface LinhaDoDiagnostico extends Record<string, unknown> {
  chave: string;
  unidade: string;
  transportadora: string;
  tipo: string;
  nome: string;
  vigente: boolean;
  linhas_lidas: number;
  recusas: number;
  enviado_em: string;
  documento_id: string;
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não está definida.");
    process.exitCode = 1;
    return;
  }

  const [anoTexto, mesTexto, unidade, transportadora] = process.argv.slice(2);
  const ano = Number(anoTexto);
  const mes = Number(mesTexto);
  if (!Number.isInteger(ano) || !Number.isInteger(mes)) {
    console.error("uso: tsx ./src/diagnostico-cli.ts <ano> <mes> [unidade] [transportadora]");
    process.exitCode = 1;
    return;
  }

  const { db, pool } = createDb(url);
  try {
    const { rows } = await db.execute<LinhaDoDiagnostico>(sql`
      select c.chave,
             c.unidade_codigo as unidade,
             c.transportadora_codigo as transportadora,
             d.tipo,
             d.nome_do_arquivo as nome,
             d.vigente,
             d.linhas_lidas,
             jsonb_array_length(d.recusas) as recusas,
             to_char(d.enviado_em, 'DD/MM HH24:MI') as enviado_em,
             d.id::text as documento_id
        from fechamento_documento d
        join fechamento_competencia c on c.id = d.competencia_id
       where c.ano = ${ano}
         and c.mes = ${mes}
         and (${unidade ?? null}::text is null or c.unidade_codigo = ${unidade ?? null})
         and (${transportadora ?? null}::text is null or c.transportadora_codigo = ${transportadora ?? null})
       order by c.quinzena, d.tipo, d.enviado_em
    `);

    if (rows.length === 0) {
      console.log(`Nenhum documento em ${String(mes).padStart(2, "0")}/${ano}.`);
      return;
    }

    /* A contagem real dos fatos, por documento — é ela que desmente o `linhas_lidas`. */
    const contados = new Map<string, number>();
    for (const { tipo, tabela } of FATOS) {
      const ids = rows.filter((r) => r.tipo === tipo).map((r) => r.documento_id);
      if (ids.length === 0) continue;
      const { rows: contagem } = await db.execute<{ documento_id: string; total: string }>(sql`
        select documento_id::text as documento_id, count(*)::text as total
          from ${sql.raw(tabela)}
         where documento_id = any(${ids}::uuid[])
         group by documento_id
      `);
      for (const c of contagem) contados.set(c.documento_id, Number(c.total));
    }

    let chaveAtual = "";
    const suspeitos: LinhaDoDiagnostico[] = [];
    for (const r of rows) {
      const chave = `${r.chave}  ${r.unidade} · ${r.transportadora}`;
      if (chave !== chaveAtual) {
        console.log(`\n=== ${chave} ===`);
        console.log("  vig  tipo             linhas  fatos  recusas  enviado       arquivo");
        chaveAtual = chave;
      }
      const fatos = contados.get(r.documento_id) ?? 0;
      /* Vigente sem fato é o defeito; não-vigente sem fato é só histórico. */
      const alerta = r.vigente && fatos === 0;
      if (alerta) suspeitos.push(r);
      console.log(
        `  ${r.vigente ? " * " : "   "}  ${r.tipo.padEnd(16)}` +
          `${String(r.linhas_lidas).padStart(6)}${String(fatos).padStart(7)}` +
          `${String(r.recusas).padStart(9)}  ${r.enviado_em}  ${r.nome}` +
          `${alerta ? "   <<< VIGENTE E SEM FATOS" : ""}`,
      );
    }

    console.log("");
    if (suspeitos.length === 0) {
      console.log("Nenhum documento vigente sem fatos. Todo arquivo aceito produziu registro.");
      return;
    }
    console.log(`${suspeitos.length} documento(s) vigente(s) sem nenhum fato:`);
    for (const s of suspeitos) {
      console.log(`  ${s.chave} · ${s.tipo} · "${s.nome}"`);
    }
    console.log(
      "\nEstes foram aceitos antes da guarda `recusarDocumentoSemFatos`. Reenvie o arquivo\n" +
        "correto: o envio que não produzir registro passa a ser recusado em vez de apagar\n" +
        "o que já está aqui.",
    );
  } finally {
    await pool.end();
  }
}

await principal();
