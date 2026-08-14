/**
 * Roda a bateria de aceitação contra o FreightCheck real e escreve o relatório.
 *
 *     pnpm --filter @workspace/assistant run aceitacao
 *     pnpm --filter @workspace/assistant run aceitacao -- --sem-ia
 *     pnpm --filter @workspace/assistant run aceitacao -- --so=MULTIFONTE,BOOK_PURO
 *
 * **Ele recusa rodar sem o ambiente real, e diz o que falta.** Uma bateria de
 * aceitação que roda com banco vazio e sem modelo produz um relatório completo,
 * bonito e sem valor nenhum — todas as respostas saem do caminho determinístico
 * sobre um dossiê vazio, e o número de aprovações mede a ausência de dados. A
 * primeira coisa que este programa faz é conferir o ambiente e parar.
 *
 * **Os marcadores da bateria são resolvidos contra o banco.** `{BLOCO_DOC}` vira
 * o nome de um bloco que realmente tem documento anexado; `{PARAM_MUDOU}`, uma
 * gaveta que realmente mudou. É o que faz a mesma bateria valer em ambientes
 * diferentes sem virar um teste sobre o ambiente de quem a escreveu — e o
 * relatório registra o que cada marcador virou, para a rodada seguinte ser
 * comparável com esta.
 */

import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, type Database } from "@workspace/db";
import { getFamiliesView, listContexts, listPeriods, resolveContext } from "@workspace/comparison";
import { responder, type Resposta } from "../resposta";
import { disponivel, modeloConfigurado } from "../llm";
import { rotuloDoPeriodo } from "../formato";
import { CASOS, SEQUENCIAS, type Categoria } from "../aceitacao/bateria";
import { mantemAssunto, verificar, type Falha } from "../aceitacao/verificacoes";
import type { EstadoDaConversa } from "../conversa";
import type { TurnoAnterior } from "../llm";

// ── Ambiente ────────────────────────────────────────────────────────────────

interface Ambiente {
  urlDoBanco: string;
  ia: boolean;
  modelo: string | null;
  contexto: string | null;
  vigencias: number;
  blocosComRegra: number;
  blocosComDocumento: number;
}

async function conferirAmbiente(db: Database, urlDoBanco: string): Promise<Ambiente> {
  const contextos = await listContexts(db);
  const contexto = await resolveContext(db);
  const periodos = contexto ? await listPeriods(db, contexto) : [];

  const { rows } = await db.execute<{ registrados: number; documentos: number }>(sql`
    WITH vigente AS (
      SELECT DISTINCT ON (block_key) block_key, kind::text AS kind
        FROM book_entry ORDER BY block_key, revision DESC
    )
    SELECT count(*)::int AS registrados,
           count(*) FILTER (WHERE kind = 'DOCUMENTO')::int AS documentos
      FROM vigente
  `);

  return {
    urlDoBanco,
    ia: disponivel(),
    modelo: modeloConfigurado(),
    contexto: contextos.find((c) => c.scopeHash === contexto?.scopeHash)?.label ?? null,
    vigencias: periodos.length,
    blocosComRegra: Number(rows[0]?.registrados ?? 0),
    blocosComDocumento: Number(rows[0]?.documentos ?? 0),
  };
}

// ── Marcadores ──────────────────────────────────────────────────────────────

type Marcadores = Record<string, string>;

/**
 * O que cada marcador vale **neste** banco.
 *
 * Um marcador sem valor não é preenchido com um palpite: os casos que dependem
 * dele são pulados e aparecem como pulados no relatório. Substituir
 * `{BLOCO_DOC}` por "QLP ADM" num banco que não tem QLP ADM produziria uma
 * reprovação que não é do assistente.
 */
async function resolverMarcadores(db: Database): Promise<Marcadores> {
  const marcadores: Marcadores = {};

  const contexto = await resolveContext(db);
  const contextos = await listContexts(db);
  const info = contextos.find((c) => c.scopeHash === contexto?.scopeHash);

  if (info) {
    const unidade =
      info.scopes.find((s) => s.scopeType === "UNIT" || s.scopeType === "UNIDADE")?.name ??
      info.scopes[0]?.name;
    if (unidade) marcadores["{UNIDADE}"] = unidade;
    if (info.channel) marcadores["{CANAL}"] = info.channel;
  }

  if (contexto) {
    const periodos = await listPeriods(db, contexto);
    if (periodos[0]) marcadores["{MES}"] = rotuloDoPeriodo(periodos[0].effective_date);
    if (periodos[1]) marcadores["{MES_ANTERIOR}"] = rotuloDoPeriodo(periodos[1].effective_date);

    const visao = await getFamiliesView(db, undefined, contexto);
    const gavetas = visao?.families.flatMap((f) => f.parameters) ?? [];
    const queMudou = gavetas.find((p) => p.changes > 0);
    if (queMudou) marcadores["{PARAM_MUDOU}"] = queMudou.name;
    if (gavetas[0]) marcadores["{PARAM}"] = (queMudou ?? gavetas[0]).name;

    const placa = visao?.summary.topVehicles.find((v) => v.plate)?.plate;
    if (placa) marcadores["{PLACA}"] = placa;
  }

  const { rows } = await db.execute<{ bloco: string; kind: string }>(sql`
    SELECT DISTINCT ON (block_key) block_title AS bloco, kind::text AS kind
      FROM book_entry ORDER BY block_key, revision DESC
  `);
  const comDocumento = rows.find((r) => r.kind === "DOCUMENTO");
  if (comDocumento) marcadores["{BLOCO_DOC}"] = comDocumento.bloco;
  if (rows[0]) marcadores["{BLOCO}"] = (rows.find((r) => r !== comDocumento) ?? rows[0]).bloco;

  return marcadores;
}

const MARCADOR = /\{[A-Z_]+\}/g;

function aplicar(texto: string, marcadores: Marcadores): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const resolvido = texto.replace(MARCADOR, (m) => {
    const valor = marcadores[m];
    if (!valor) faltando.push(m);
    return valor ?? m;
  });
  return { texto: resolvido, faltando: [...new Set(faltando)] };
}

// ── Execução ────────────────────────────────────────────────────────────────

interface Resultado {
  id: string;
  categoria: Categoria | "CONVERSA";
  pergunta: string;
  esperado: string;
  /** `null` quando o caso foi pulado por falta de marcador. */
  resposta: Resposta | null;
  pulado?: string;
  falhas: Falha[];
  msDecorridos: number;
}

function resumoDaResposta(r: Resposta) {
  return {
    intencao: r.intencao,
    redacao: r.redacao,
    desfecho: r.tecnico.ia?.desfecho ?? "SEM_CHAMADA",
    latenciaDoModelo: r.tecnico.ia?.latenciaMs ?? null,
    ferramentas: r.tecnico.ferramentas,
    fontes: r.fontes.map((f) => `[${f.id}] ${f.tipo} · ${f.titulo}${f.detalhe ? ` · ${f.detalhe}` : ""}`),
    lacunas: r.lacunas.map((l) => l.tipo),
    recorte: r.recorte,
    numerosRecusados: r.tecnico.numerosRecusados,
  };
}

async function rodar(db: Database, marcadores: Marcadores, so: Set<string> | null) {
  const resultados: Resultado[] = [];

  for (const caso of CASOS) {
    if (so && !so.has(caso.categoria)) continue;

    const { texto: pergunta, faltando } = aplicar(caso.pergunta, marcadores);
    if (faltando.length > 0) {
      resultados.push({
        id: caso.id,
        categoria: caso.categoria,
        pergunta: caso.pergunta,
        esperado: caso.esperado,
        resposta: null,
        pulado: `este banco não tem ${faltando.join(", ")}`,
        falhas: [],
        msDecorridos: 0,
      });
      continue;
    }

    const inicio = Date.now();
    const resposta = await responder(db, pergunta);
    const msDecorridos = Date.now() - inicio;

    resultados.push({
      id: caso.id,
      categoria: caso.categoria,
      pergunta,
      esperado: caso.esperado,
      resposta,
      falhas: verificar(resposta, caso.espera ?? {}),
      msDecorridos,
    });
    process.stdout.write(`  ${caso.id} · ${msDecorridos} ms\n`);
  }

  return resultados;
}

async function rodarConversas(db: Database, marcadores: Marcadores) {
  const resultados: Resultado[] = [];

  for (const sequencia of SEQUENCIAS) {
    let estado: EstadoDaConversa | null = null;
    const historico: TurnoAnterior[] = [];
    process.stdout.write(`  ${sequencia.id}\n`);

    for (const [i, passo] of sequencia.passos.entries()) {
      const { texto: pergunta, faltando } = aplicar(passo.pergunta, marcadores);
      const id = `${sequencia.id}#${i + 1}`;

      if (faltando.length > 0) {
        resultados.push({
          id,
          categoria: "CONVERSA",
          pergunta: passo.pergunta,
          esperado: passo.esperado,
          resposta: null,
          pulado: `este banco não tem ${faltando.join(", ")}`,
          falhas: [],
          msDecorridos: 0,
        });
        continue;
      }

      const inicio = Date.now();
      const resposta = await responder(db, pergunta, { estado, historico: [...historico] });
      const msDecorridos = Date.now() - inicio;

      const falhas = verificar(resposta, passo.espera ?? {});

      /*
        A continuidade é conferida contra o valor do marcador, não contra o
        nome do marcador: o passo diz "mantém BLOCO_DOC" e o que se procura na
        resposta é o nome que aquele marcador tomou neste banco.
      */
      if (passo.mantemAssunto) {
        const assunto = marcadores[`{${passo.mantemAssunto}}`];
        if (assunto && !mantemAssunto(resposta, assunto)) {
          falhas.push({
            regra: "mantem-assunto",
            detalhe: `perdeu o fio: a resposta não fala mais de "${assunto}"`,
          });
        }
      }

      resultados.push({
        id,
        categoria: "CONVERSA",
        pergunta,
        esperado: passo.esperado,
        resposta,
        falhas,
        msDecorridos,
      });

      estado = resposta.estado;
      historico.push({ papel: "PERGUNTA", texto: pergunta });
      historico.push({ papel: "RESPOSTA", texto: resposta.texto });
    }
  }

  return resultados;
}

// ── Relatório ───────────────────────────────────────────────────────────────

function relatorio(ambiente: Ambiente, marcadores: Marcadores, resultados: Resultado[]): string {
  const rodados = resultados.filter((r) => r.resposta);
  const comFalha = rodados.filter((r) => r.falhas.length > 0);
  const porIa = rodados.filter((r) => r.resposta!.redacao === "IA");

  const linhas: string[] = [];
  const p = (s = "") => linhas.push(s);

  p("# Bateria de aceitação — Assistente FreightCheck");
  p();
  p("## A. Estado do ambiente");
  p();
  p(`- banco: \`${ambiente.urlDoBanco.replace(/:[^:@/]+@/, ":***@")}\``);
  p(`- contexto padrão: ${ambiente.contexto ?? "—"} · ${ambiente.vigencias} vigência(s)`);
  p(`- Book: ${ambiente.blocosComRegra} bloco(s) com regra, ${ambiente.blocosComDocumento} com documento`);
  p(`- IA: ${ambiente.ia ? `ligada · ${ambiente.modelo}` : "**desligada** — sem chave"}`);
  p(`- respostas escritas pelo modelo: ${porIa.length} de ${rodados.length}`);
  p();
  p("### Marcadores resolvidos neste banco");
  p();
  for (const [marcador, valor] of Object.entries(marcadores)) p(`- \`${marcador}\` → ${valor}`);
  p();

  p("## B. Resultado");
  p();
  p(`- casos executados: **${rodados.length}** (de ${resultados.length}; ${resultados.length - rodados.length} pulados por falta de dado)`);
  p(`- sem falha automática: **${rodados.length - comFalha.length}**`);
  p(`- com falha automática: **${comFalha.length}**`);
  p();
  p("| # | categoria | pergunta | intenção | redação | fontes | ms | falhas |");
  p("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of resultados) {
    if (!r.resposta) {
      p(`| ${r.id} | ${r.categoria} | ${r.pergunta} | — | pulado | — | — | ${r.pulado} |`);
      continue;
    }
    const s = resumoDaResposta(r.resposta);
    p(
      `| ${r.id} | ${r.categoria} | ${r.pergunta.replace(/\|/g, "\\|")} | ${s.intencao} | ` +
        `${s.redacao}${s.desfecho !== "IA" && s.desfecho !== "SEM_CHAMADA" ? ` (${s.desfecho})` : ""} | ` +
        `${r.resposta.fontes.length} | ${r.msDecorridos} | ` +
        `${r.falhas.map((f) => f.regra).join(", ") || "—"} |`,
    );
  }
  p();

  p("## C. Falhas por regra");
  p();
  const porRegra = new Map<string, Resultado[]>();
  for (const r of comFalha) {
    for (const f of r.falhas) porRegra.set(f.regra, [...(porRegra.get(f.regra) ?? []), r]);
  }
  if (porRegra.size === 0) p("Nenhuma falha automática.");
  for (const [regra, casos] of [...porRegra].sort((a, b) => b[1].length - a[1].length)) {
    p(`- **${regra}** — ${casos.length} caso(s): ${casos.map((c) => c.id).join(", ")}`);
  }
  p();

  p("## D. Respostas, uma a uma");
  p();
  for (const r of resultados) {
    p(`### ${r.id} · ${r.categoria}`);
    p();
    p(`**Pergunta.** ${r.pergunta}`);
    p();
    p(`**Esperado.** ${r.esperado}`);
    p();
    if (!r.resposta) {
      p(`_Pulado: ${r.pulado}._`);
      p();
      continue;
    }
    const s = resumoDaResposta(r.resposta);
    p(
      `**Execução.** intenção \`${s.intencao}\` · redação \`${s.redacao}\` · desfecho ` +
        `\`${s.desfecho}\` · ${r.msDecorridos} ms` +
        (s.latenciaDoModelo ? ` (modelo: ${s.latenciaDoModelo} ms)` : ""),
    );
    p();
    if (s.ferramentas.length > 0) p(`**Consultas.** ${s.ferramentas.join(", ")}`);
    if (s.fontes.length > 0) {
      p("**Fontes.**");
      for (const f of s.fontes) p(`- ${f}`);
    }
    if (s.lacunas.length > 0) p(`**Lacunas.** ${s.lacunas.join(", ")}`);
    if (s.numerosRecusados.length > 0) p(`**Recusado pela trava.** ${s.numerosRecusados.join(", ")}`);
    p();
    p("**Resposta.**");
    p();
    p("> " + r.resposta.texto.split("\n").join("\n> "));
    p();
    if (r.falhas.length > 0) {
      p("**Falhas automáticas.**");
      for (const f of r.falhas) p(`- \`${f.regra}\` — ${f.detalhe}`);
      p();
    }
  }

  p("## E. O que este relatório não mede");
  p();
  p(
    "Correção factual, clareza, qualidade executiva e capacidade analítica são julgamento, " +
      "e não estão nas colunas acima. As verificações automáticas cobrem o que é fato sobre o " +
      "texto: mecânica exposta, citação inválida, número sem lastro, fonte exigida ausente, " +
      "lacuna não declarada e perda do fio da conversa. As notas de 0 a 5 nas dimensões de " +
      "julgamento saem da leitura das respostas transcritas na seção D.",
  );

  return linhas.join("\n");
}

// ── Entrada ─────────────────────────────────────────────────────────────────

async function principal() {
  const args = process.argv.slice(2);
  const semIa = args.includes("--sem-ia");
  const so = args.find((a) => a.startsWith("--so="))?.slice(5);
  const saida =
    args.find((a) => a.startsWith("--saida="))?.slice(8) ??
    `aceitacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;

  const urlDoBanco = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL ?? null;

  /*
    O programa recusa rodar sem ambiente real — e diz exatamente o que falta.

    Sem isto, ele produziria um relatório completo sobre um banco vazio: todas
    as perguntas respondidas pelo caminho determinístico, nenhuma fonte, e uma
    contagem de aprovações que mede a ausência de dados.
  */
  const faltando: string[] = [];
  if (!urlDoBanco) faltando.push("DATABASE_URL (ou ASSISTANT_EVAL_DATABASE_URL) apontando para o banco com os dados importados");
  if (!disponivel() && !semIa) faltando.push("ANTHROPIC_API_KEY — sem ela só roda o caminho determinístico (use --sem-ia para medir só ele, de propósito)");

  if (faltando.length > 0) {
    console.error("A bateria de aceitação não roda neste ambiente. Falta:\n");
    for (const f of faltando) console.error(`  · ${f}`);
    console.error("\nNada foi executado e nenhum relatório foi escrito.");
    process.exit(1);
  }

  const { db } = createDb(urlDoBanco!);
  const ambiente = await conferirAmbiente(db, urlDoBanco!);

  if (ambiente.vigencias === 0) {
    console.error("O banco não tem vigência promovida — a bateria mediria o vazio. Nada executado.");
    process.exit(1);
  }
  if (ambiente.blocosComRegra === 0) {
    console.error(
      "O Book não tem nenhuma regra registrada: as categorias de Book e multi-fonte não têm o " +
        "que medir. Anexe os documentos pela tela do Book do Operador antes de rodar.",
    );
    process.exit(1);
  }

  console.log(`\nContexto: ${ambiente.contexto} · ${ambiente.vigencias} vigências`);
  console.log(`Book: ${ambiente.blocosComRegra} blocos com regra (${ambiente.blocosComDocumento} documentos)`);
  console.log(`IA: ${ambiente.ia ? ambiente.modelo : "desligada"}\n`);

  const marcadores = await resolverMarcadores(db);
  const filtro = so ? new Set(so.split(",").map((s) => s.trim().toUpperCase())) : null;

  console.log("Perguntas:");
  const doCatalogo = await rodar(db, marcadores, filtro);
  console.log("\nConversas:");
  const dasConversas = filtro ? [] : await rodarConversas(db, marcadores);

  const texto = relatorio(ambiente, marcadores, [...doCatalogo, ...dasConversas]);
  writeFileSync(saida, texto, "utf8");
  console.log(`\nRelatório escrito em ${saida}`);
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
