import { createDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * O que uma competência tem de verdade — documento por documento, fato por fato.
 *
 * ```
 * pnpm --filter @workspace/fechamento exec tsx ./src/diagnostico-cli.ts 2026 7
 * pnpm --filter @workspace/fechamento exec tsx ./src/diagnostico-cli.ts 2026 7 443 36
 * PRODUCTION_DATABASE_URL='postgres://…' … ./src/diagnostico-cli.ts --producao 2026 7
 * ```
 *
 * **Ele diz em que banco entrou, sempre, antes de qualquer número.** O
 * Development do Replit e o banco que a tela serve são dois, e a pergunta
 * "importei e não aparece" já custou uma investigação inteira por causa disso:
 * a consulta rodou no banco vazio e a resposta pareceu um defeito do produto.
 * Ver as travas de `prova-producao.sh`, escritas depois do mesmo susto.
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

/**
 * Qual banco, e como saber que é ele.
 *
 * Sem `--producao`, é o `DATABASE_URL` do ambiente. Com ele, exige
 * `PRODUCTION_DATABASE_URL` e recusa quando ela está vazia ou é idêntica à de
 * Development — as mesmas duas travas de `prova-producao.sh`, pelo mesmo
 * motivo: com a variável vazia o libpq cai nos defaults e conecta em outro
 * banco **em silêncio**, que é o modo de falhar que não parece falha.
 */
function bancoEscolhido(producao: boolean): { url: string; rotulo: string } {
  if (!producao) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não está definida.");
    return { url, rotulo: "Development (DATABASE_URL)" };
  }

  const url = process.env.PRODUCTION_DATABASE_URL;
  if (url === undefined) throw new Error("PRODUCTION_DATABASE_URL não está definida.");
  if (url.trim() === "") {
    throw new Error(
      "PRODUCTION_DATABASE_URL está definida mas VAZIA — é exatamente o caso que faz o " +
        "psql conectar em outro banco sem avisar. Nada foi consultado.",
    );
  }
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL) {
    throw new Error(
      "PRODUCTION_DATABASE_URL é idêntica a DATABASE_URL. Uma das duas está errada.",
    );
  }
  return { url, rotulo: "PRODUCTION (PRODUCTION_DATABASE_URL)" };
}

/** Host e base, sem a senha — o suficiente para reconhecer o banco. */
function ondeEstou(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(url não interpretável)";
  }
}

async function principal(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const producao = argumentos.includes("--producao");
  let escolhido;
  try {
    escolhido = bancoEscolhido(producao);
  } catch (erro) {
    console.error(String(erro instanceof Error ? erro.message : erro));
    process.exitCode = 1;
    return;
  }
  const url = escolhido.url;
  console.log(`banco: ${escolhido.rotulo} → ${ondeEstou(url)}\n`);

  const [anoTexto, mesTexto, unidade, transportadora] = argumentos.filter(
    (a) => !a.startsWith("--"),
  );
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
      /* Zero competências e zero documentos são diagnósticos diferentes, e o
         primeiro quase sempre quer dizer "banco errado" e não "nada importado". */
      const { rows: quantas } = await db.execute<{ total: string }>(
        sql`select count(*)::text as total from fechamento_competencia`,
      );
      const competencias = Number(quantas[0]?.total ?? 0);
      console.log(`Nenhum documento em ${String(mes).padStart(2, "0")}/${ano}.`);
      if (competencias === 0) {
        console.log(
          `\nEste banco não tem competência nenhuma — nem deste mês, nem de outro.\n` +
            `Se a tela mostra dados, ela está lendo outro banco. Rode de novo com\n` +
            `--producao e PRODUCTION_DATABASE_URL definida.`,
        );
      } else {
        console.log(`\nO banco tem ${competencias} competência(s), nenhuma em ${String(mes).padStart(2, "0")}/${ano}.`);
      }
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
