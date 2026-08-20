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

/**
 * Onde cada fonte grava os fatos dela.
 *
 * **O 03.08.20 grava em duas tabelas, e contar só uma mente.** As verbas vão
 * para `fechamento_pagamento_item` e os descontos para
 * `fechamento_pagamento_desconto`; `linhas_lidas` soma as duas. Um relatório em
 * que só os descontos foram reconhecidos aparecia aqui como "0 fatos" com
 * `linhas_lidas` cheio — o que parece arquivo perdido e é, na verdade, item não
 * reconhecido. São diagnósticos diferentes e levam a ações diferentes.
 */
const FATOS: { tipo: string; tabelas: string[] }[] = [
  { tipo: "OPERACAO", tabelas: ["fechamento_viagem"] },
  { tipo: "CTE", tabelas: ["fechamento_cte"] },
  {
    tipo: "PAGAMENTO",
    tabelas: ["fechamento_pagamento_item", "fechamento_pagamento_desconto"],
  },
  { tipo: "DISPONIBILIDADE", tabelas: ["fechamento_disponibilidade"] },
  { tipo: "REQUISICOES", tabelas: ["fechamento_requisicao"] },
  { tipo: "CONCILIACAO", tabelas: ["fechamento_conciliacao_item"] },
];

interface LinhaDoDiagnostico extends Record<string, unknown> {
  chave: string;
  unidade: string;
  transportadora: string;
  /** `EMPURRADA`, `ROTA`, `NAO_INFORMADO` — o quarto eixo da chave, desde a `0046`. */
  tipo_de_operacao: string;
  tipo: string;
  nome: string;
  vigente: boolean;
  linhas_lidas: number;
  recusas: number;
  recusas_texto: { linha: number; motivo: string; original: string }[];
  enviado_em: string;
  documento_id: string;
}

/**
 * A competência a que a linha pertence, escrita por inteiro.
 *
 * **O tipo de operação entra no rótulo porque a `0046` o pôs na chave.** Desde
 * ela, o mesmo CDD com a mesma transportadora tem duas competências na mesma
 * quinzena — EMPURRADA e ROTA, cada uma com a sua planilha e a sua conta. Sem
 * esta parte do rótulo os dois blocos sairiam sob o mesmo cabeçalho, e este
 * comando responderia "importei e não aparece" com os documentos da outra
 * operação. `NAO_INFORMADO` é o carimbo do backfill, e dizê-lo é dizer a
 * verdade: ninguém declarou o tipo daquela competência.
 */
function identificacao(r: LinhaDoDiagnostico): string {
  return `${r.chave}  ${r.unidade} · ${r.transportadora} · ${r.tipo_de_operacao}`;
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
             c.tipo_de_operacao,
             d.tipo,
             d.nome_do_arquivo as nome,
             d.vigente,
             d.linhas_lidas,
             jsonb_array_length(d.recusas) as recusas,
             d.recusas as recusas_texto,
             to_char(d.enviado_em, 'DD/MM HH24:MI') as enviado_em,
             d.id::text as documento_id
        from fechamento_documento d
        join fechamento_competencia c on c.id = d.competencia_id
       where c.ano = ${ano}
         and c.mes = ${mes}
         and (${unidade ?? null}::text is null or c.unidade_codigo = ${unidade ?? null})
         and (${transportadora ?? null}::text is null or c.transportadora_codigo = ${transportadora ?? null})
       order by c.unidade_codigo, c.transportadora_codigo, c.tipo_de_operacao,
                c.quinzena, d.tipo, d.enviado_em
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

    /*
      A contagem real dos fatos, por documento — é ela que desmente o
      `linhas_lidas` gravado, e é justamente quando os dois discordam que este
      comando serve.

      **A lista de ids vai como UM parâmetro, e não como vários.** No template
      do drizzle, `${ids}` com `ids` sendo um array vira `($1, $2, …)` — um
      *record*, que o Postgres recusa converter para `uuid[]` (`cannot cast type
      record to uuid[]`). `sql.param()` envolve o array inteiro num parâmetro
      só, e o driver o serializa como literal de array, que `::uuid[]` aceita.

      Interpolar os ids no texto da consulta resolveria e seria o começo de uma
      injeção; a versão parametrizada custa uma função e fecha a porta.
    */
    const contados = new Map<string, number>();
    /* Por tabela, para que a de descontos some à de itens em vez de sobrescrevê-la. */
    const porTabela = new Map<string, Map<string, number>>();
    for (const { tipo, tabelas } of FATOS) {
      const ids = rows.filter((r) => r.tipo === tipo).map((r) => r.documento_id);
      /* Lista vazia nem chega ao banco: `any('{}')` seria uma ida à toa. */
      if (ids.length === 0) continue;
      for (const tabela of tabelas) {
        const { rows: contagem } = await db.execute<{ documento_id: string; total: string }>(sql`
          select documento_id::text as documento_id, count(*)::text as total
            from ${sql.raw(tabela)}
           where documento_id = any(${sql.param(ids)}::uuid[])
           group by documento_id
        `);
        const daTabela = new Map<string, number>();
        for (const c of contagem) {
          daTabela.set(c.documento_id, Number(c.total));
          contados.set(c.documento_id, (contados.get(c.documento_id) ?? 0) + Number(c.total));
        }
        porTabela.set(tabela, daTabela);
      }
    }

    /* A abertura do 03.08.20, que é onde a diferença entre item e desconto mora. */
    const itens = porTabela.get("fechamento_pagamento_item");
    const descontosDe = porTabela.get("fechamento_pagamento_desconto");
    const abertura = (r: LinhaDoDiagnostico) =>
      r.tipo === "PAGAMENTO"
        ? `  (verbas ${itens?.get(r.documento_id) ?? 0} · descontos ${descontosDe?.get(r.documento_id) ?? 0})`
        : "";

    /* Ordenadas pela competência inteira acima, as linhas de uma competência
       ficam contíguas — é o que faz este cabeçalho trocar uma vez por
       competência, e não toda vez que a listagem alterna entre duas. */
    let competenciaAtual = "";
    const suspeitos: LinhaDoDiagnostico[] = [];
    for (const r of rows) {
      const competencia = identificacao(r);
      if (competencia !== competenciaAtual) {
        console.log(`\n=== ${competencia} ===`);
        console.log("  vig  tipo             linhas  fatos  recusas  enviado       arquivo");
        competenciaAtual = competencia;
      }
      const fatos = contados.get(r.documento_id) ?? 0;
      /* Vigente sem fato é o defeito; não-vigente sem fato é só histórico. */
      const alerta = r.vigente && fatos === 0;
      if (alerta) suspeitos.push(r);
      console.log(
        `  ${r.vigente ? " * " : "   "}  ${r.tipo.padEnd(16)}` +
          `${String(r.linhas_lidas).padStart(6)}${String(fatos).padStart(7)}` +
          `${String(r.recusas).padStart(9)}  ${r.enviado_em}  ${r.nome}` +
          `${alerta ? "   <<< VIGENTE E SEM FATOS" : ""}${abertura(r)}`,
      );
    }

    /*
      O 03.08.20 que trouxe desconto e nenhuma verba é um caso próprio: o arquivo
      foi lido, as seções foram reconhecidas, e só as linhas de verba não
      casaram com o layout esperado. Diagnóstico e conserto são outros.
    */
    const semVerba = rows.filter(
      (r) =>
        r.tipo === "PAGAMENTO" &&
        r.vigente &&
        (itens?.get(r.documento_id) ?? 0) === 0 &&
        (descontosDe?.get(r.documento_id) ?? 0) > 0,
    );
    if (semVerba.length > 0) {
      console.log("");
      console.log(`${semVerba.length} demonstrativo(s) com desconto e NENHUMA verba:`);
      for (const s of semVerba) console.log(`  ${identificacao(s)} · "${s.nome}"`);
      /*
        A recusa gravada no documento é a evidência que sobrevive ao envio: o
        fechamento não guarda o arquivo, e sem ela a única saída era pedir o
        TXT de volta. Os documentos enviados antes desta gravação existir têm
        `recusas` vazio, e para esses o arquivo continua sendo necessário.
      */
      for (const s of semVerba) {
        const motivos = s.recusas_texto ?? [];
        if (motivos.length === 0) {
          console.log(
            `\n  "${s.nome}" foi importado antes de o leitor registrar recusas —\n` +
              `  não há evidência gravada. Rode \`explicar-pagamento-cli.ts\` sobre o arquivo,\n` +
              `  ou reenvie-o: agora a recusa fica guardada.`,
          );
          continue;
        }
        console.log(`\n  "${s.nome}" — ${motivos.length} linha(s) de verba recusada(s):`);
        for (const m of motivos.slice(0, 3)) {
          console.log(`    linha ${m.linha}: ${m.motivo}`);
          console.log(`      ${JSON.stringify(m.original.slice(0, 120))}`);
        }
        if (motivos.length > 3) console.log(`    … e mais ${motivos.length - 3}.`);
      }
    }

    console.log("");
    if (suspeitos.length === 0) {
      console.log("Nenhum documento vigente sem fatos. Todo arquivo aceito produziu registro.");
      return;
    }
    console.log(`${suspeitos.length} documento(s) vigente(s) sem nenhum fato:`);
    for (const s of suspeitos) {
      console.log(`  ${identificacao(s)} · ${s.tipo} · "${s.nome}"`);
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
