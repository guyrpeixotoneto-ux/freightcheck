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
import { perguntaTecnica } from "../interpretacao";
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

/**
 * A linha da tabela de medição — o que se compara entre duas rodadas.
 *
 * Ela é o baseline da migração ao agente: rodada com a flag desligada, é o
 * "antes"; rodada com ela ligada, é o "depois". Por isso sai também em JSON, e
 * por isso nenhum campo aqui é derivado de julgamento — todos vêm da resposta.
 */
interface LinhaDeMedicao {
  id: string;
  categoria: string;
  pergunta: string;
  redigiu: "IA" | "DETERMINISTICA" | "PULADO";
  houveChamada: boolean;
  codigo: string;
  causa: string;
  /** As consultas que a orquestração decidiu fazer. */
  ferramentas: string[];
  /** O material que o modelo recebeu (ou teria recebido). */
  itens: number;
  fatos: number;
  secoes: string[];
  dossieChars: number;
  historicoChars: number;
  turnos: number;
  lacunas: string[];
  latenciaModeloMs: number | null;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
  frasesPodadas: number;
  frasesTotais: number;
  numerosRecusados: string[];
  msTotal: number;
}

function medir(r: Resultado): LinhaDeMedicao {
  const base = {
    id: r.id,
    categoria: String(r.categoria),
    pergunta: r.pergunta,
    msTotal: r.msDecorridos,
  };

  if (!r.resposta) {
    return {
      ...base,
      redigiu: "PULADO",
      houveChamada: false,
      codigo: "PULADO",
      causa: r.pulado ?? "pulado",
      ferramentas: [], itens: 0, fatos: 0, secoes: [], dossieChars: 0,
      historicoChars: 0, turnos: 0, lacunas: [],
      latenciaModeloMs: null, tokensEntrada: null, tokensSaida: null, custoUsd: null,
      frasesPodadas: 0, frasesTotais: 0, numerosRecusados: [],
    };
  }

  const t = r.resposta.tecnico;
  return {
    ...base,
    redigiu: t.motor.redigiu,
    houveChamada: t.motor.houveChamada,
    codigo: t.motor.codigo,
    causa: t.motor.causa,
    ferramentas: t.ferramentas,
    itens: t.contexto.itens.total,
    fatos: t.contexto.fatos,
    secoes: t.contexto.secoes,
    dossieChars: t.contexto.caracteres.dossie,
    historicoChars: t.contexto.caracteres.historico,
    turnos: t.contexto.turnos,
    lacunas: t.contexto.lacunas,
    latenciaModeloMs: t.ia?.latenciaMs ?? null,
    tokensEntrada: t.ia?.tokensEntrada ?? null,
    tokensSaida: t.ia?.tokensSaida ?? null,
    custoUsd: t.ia?.custoUsd ?? null,
    frasesPodadas: t.rastro.frasesPodadas,
    frasesTotais: t.rastro.frasesTotais,
    numerosRecusados: t.numerosRecusados,
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
    const resposta = await responder(db, pergunta, { diagnostico: true });
    const msDecorridos = Date.now() - inicio;

    resultados.push({
      id: caso.id,
      categoria: caso.categoria,
      pergunta,
      esperado: caso.esperado,
      resposta,
      falhas: verificar(resposta, caso.espera ?? {}, perguntaTecnica(pergunta)),
      msDecorridos,
    });
    process.stdout.write(`  ${caso.id} · ${msDecorridos} ms\n`);
  }

  return resultados;
}

async function rodarConversas(db: Database, marcadores: Marcadores) {
  const resultados: Resultado[] = [];

  for (const sequencia of SEQUENCIAS) {
    /*
      Ou a conversa inteira, ou nenhum turno dela.

      Pular só o passo cujo marcador não resolveu deixaria "Qual a frequência?"
      rodar sem a pergunta que estabeleceu o assunto — e o que se mediria ali
      não é a continuidade, é uma pergunta órfã. Reprovar por isso seria culpar
      o assistente pela lacuna do banco.
    */
    const semMarcador = [
      ...new Set(sequencia.passos.flatMap((p) => aplicar(p.pergunta, marcadores).faltando)),
    ];
    if (semMarcador.length > 0) {
      resultados.push({
        id: sequencia.id,
        categoria: "CONVERSA",
        pergunta: `(conversa: ${sequencia.descricao})`,
        esperado: sequencia.passos.map((p) => p.esperado).join(" → "),
        resposta: null,
        pulado: `este banco não tem ${semMarcador.join(", ")} — a conversa inteira foi pulada`,
        falhas: [],
        msDecorridos: 0,
      });
      continue;
    }

    let estado: EstadoDaConversa | null = null;
    const historico: TurnoAnterior[] = [];
    process.stdout.write(`  ${sequencia.id}\n`);

    for (const [i, passo] of sequencia.passos.entries()) {
      const { texto: pergunta } = aplicar(passo.pergunta, marcadores);
      const id = `${sequencia.id}#${i + 1}`;

      const inicio = Date.now();
      const resposta = await responder(db, pergunta, {
        estado,
        historico: [...historico],
        diagnostico: true,
      });
      const msDecorridos = Date.now() - inicio;

      const falhas = verificar(resposta, passo.espera ?? {}, perguntaTecnica(pergunta));

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
  if (ambiente.blocosComRegra === 0) {
    p();
    p(
      "> **Cobertura parcial.** Este banco não tem nenhuma regra registrada no Book. As " +
        "categorias de Book, documento e multi-fonte foram puladas e **este relatório não é " +
        "baseline delas** — o que ele mede é a metade de dado do assistente.",
    );
  }
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

  /*
    ---- B2. quem escreveu, e por quê ----------------------------------------

    Esta é a tabela que faltava, e a falta era cara: `redacao: DETERMINISTICA`
    aparecia sozinha, e ela cobre cinco situações que pedem ações opostas. Aqui
    cada linha diz se houve chamada, o que a impediu quando não houve, e — para
    o caso em que houve e o texto foi descartado — quantas frases caíram e por
    causa de que número.

    As três colunas de contexto (itens, fatos, dossiê) respondem a outra
    pergunta, e é a que decide se vale mexer no prompt: **o modelo tinha com que
    responder?** Uma linha com 1 item e 3 fatos não melhora com instrução
    nenhuma.
  */
  const medicoes = resultados.map(medir);
  const executadas = medicoes.filter((m) => m.redigiu !== "PULADO");
  const porCodigo = new Map<string, number>();
  for (const m of executadas) porCodigo.set(m.codigo, (porCodigo.get(m.codigo) ?? 0) + 1);

  p("## B2. Quem escreveu cada resposta — e por quê");
  p();
  p(`- respostas executadas: **${executadas.length}**`);
  p(`- escritas pelo modelo: **${executadas.filter((m) => m.redigiu === "IA").length}**`);
  p(`- escritas em código: **${executadas.filter((m) => m.redigiu === "DETERMINISTICA").length}**`);
  p(`- houve chamada real à Anthropic em: **${executadas.filter((m) => m.houveChamada).length}**`);
  p();
  p("Por causa:");
  p();
  for (const [codigo, n] of [...porCodigo].sort((a, b) => b[1] - a[1])) {
    p(`- \`${codigo}\` — ${n} caso(s)`);
  }
  p();

  const somaTokens = executadas.reduce(
    (acc, m) => ({
      entrada: acc.entrada + (m.tokensEntrada ?? 0),
      saida: acc.saida + (m.tokensSaida ?? 0),
      custo: acc.custo + (m.custoUsd ?? 0),
    }),
    { entrada: 0, saida: 0, custo: 0 },
  );
  const comChamada = executadas.filter((m) => m.houveChamada);
  if (comChamada.length > 0) {
    const latencias = comChamada.map((m) => m.latenciaModeloMs ?? 0).sort((a, b) => a - b);
    p(
      `Custo do modelo nesta rodada: **${somaTokens.entrada.toLocaleString("pt-BR")}** tokens de ` +
        `entrada, **${somaTokens.saida.toLocaleString("pt-BR")}** de saída, ` +
        `**US$ ${somaTokens.custo.toFixed(4)}**. Latência mediana: ` +
        `**${latencias[Math.floor(latencias.length / 2)]} ms**.`,
    );
  } else {
    p(
      "> **Nenhuma chamada ao modelo nesta rodada.** As colunas de token, custo e latência " +
        "estão vazias por isso, e não por falta de instrumentação. O que esta rodada mede é " +
        "o caminho determinístico e — na coluna `itens`/`fatos`/`dossiê` — exatamente o " +
        "material que o modelo teria recebido em cada pergunta.",
    );
  }
  p();
  p("| # | redigiu | chamada | causa | ferramentas | itens | fatos | dossiê | podadas | tok. ent | tok. saí | modelo ms |");
  p("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const m of medicoes) {
    const num = (v: number | null) => (v === null ? "—" : String(v));
    p(
      `| ${m.id} | ${m.redigiu} | ${m.houveChamada ? "sim" : "não"} | \`${m.codigo}\` | ` +
        `${m.ferramentas.length > 0 ? m.ferramentas.join(", ") : "—"} | ` +
        `${m.itens} | ${m.fatos} | ${m.dossieChars} | ` +
        `${m.frasesTotais > 0 ? `${m.frasesPodadas}/${m.frasesTotais}` : "—"} | ` +
        `${num(m.tokensEntrada)} | ${num(m.tokensSaida)} | ${num(m.latenciaModeloMs)} |`,
    );
  }
  p();
  p(
    "_`itens` = fontes citáveis entregues ao modelo · `fatos` = linhas de resultado visíveis " +
      "nas evidências · `dossiê` = caracteres do material desta pergunta · `podadas` = frases " +
      "removidas pela trava de lastro, sobre o total._",
  );
  p();

  /*
    Os dossiês magros, em primeiro plano.

    Uma linha com um item e poucos fatos é uma pergunta que o produto recebeu e
    não foi buscar material para responder. Nenhum modelo conserta isso, e é o
    achado que decide a arquitetura — por isso ele sai destacado, e não
    escondido no meio de sessenta linhas de tabela.
  */
  const magras = executadas
    .filter((m) => m.fatos <= 3 && m.itens <= 2)
    .sort((a, b) => a.fatos - b.fatos);
  if (magras.length > 0) {
    p("### Perguntas cujo dossiê chegou magro ao modelo");
    p();
    p(
      `**${magras.length} de ${executadas.length}** perguntas foram para a redação com no ` +
        "máximo 2 fontes e 3 fatos. Nestas, a qualidade da resposta é um teto imposto pelo " +
        "material, não pelo redator.",
    );
    p();
    p("| # | pergunta | itens | fatos | ferramentas |");
    p("| --- | --- | ---: | ---: | --- |");
    for (const m of magras) {
      p(
        `| ${m.id} | ${m.pergunta.replace(/\|/g, "\\|").slice(0, 70)} | ${m.itens} | ` +
          `${m.fatos} | ${m.ferramentas.join(", ") || "—"} |`,
      );
    }
    p();
  }

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

    /*
      O material exato, e não um resumo dele.

      Esta é a pergunta que nenhuma investigação de resposta ruim conseguia
      responder sem instrumentar o código à mão: **com o que o modelo tinha
      para trabalhar?** Sem ela, "a resposta ficou pobre" é indistinguível de
      "o dossiê chegou pobre", e as duas hipóteses custam a mesma investigação.
    */
    const ctx = r.resposta.tecnico.contexto;
    p(
      `**Quem redigiu.** \`${r.resposta.tecnico.motor.redigiu}\` — ` +
        `${r.resposta.tecnico.motor.causa}`,
    );
    p();
    p(
      `**Contexto entregue ao modelo.** ${ctx.itens.total} fonte(s) ` +
        `(conceito ${ctx.itens.conceito} · Book ${ctx.itens.book} · dado ${ctx.itens.dado} · ` +
        `arquivo ${ctx.itens.arquivo}) · ${ctx.fatos} fato(s) visível(is) · ` +
        `${ctx.caracteres.dossie} caracteres de dossiê · ${ctx.turnos} turno(s) de histórico ` +
        `(${ctx.caracteres.historico} caracteres) · instrução do sistema ` +
        `${ctx.caracteres.instrucao} caracteres` +
        (ctx.secoes.length > 0 ? ` · seções: ${ctx.secoes.join(", ")}` : " · **dossiê vazio**"),
    );
    p();
    if (ctx.dossie) {
      p("<details><summary>O dossiê inteiro, como o modelo o recebe</summary>");
      p();
      p("```markdown");
      p(ctx.dossie);
      p("```");
      p();
      p("</details>");
      p();
    }
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
  /*
    Faltar chave deixou de ser motivo para não medir — passou a ser o que se mede.

    A recusa fazia sentido quando o relatório só sabia dizer "redação
    determinística": um relatório inteiro assim media a ausência da chave e
    parecia medir o assistente. Com a seção B2, uma rodada sem chave responde
    duas perguntas reais e as responde bem — qual é o texto que o produto
    entrega hoje sem modelo, e **com que material** cada pergunta teria chegado
    ao modelo. As duas valem como baseline; o que não vale é confundi-las com
    uma medição do modelo, e disso o relatório avisa em letra grande.
  */
  const semChaveNoProcesso = !disponivel() && !semIa;

  if (semChaveNoProcesso) {
    console.warn(
      "\n⚠  Não há ANTHROPIC_API_KEY neste processo.\n" +
        "   A bateria roda assim mesmo e mede o caminho determinístico — mas as colunas\n" +
        "   de token, custo e latência ficam vazias, e nenhuma linha desta rodada diz\n" +
        "   nada sobre a qualidade do modelo. Para medir a metade do modelo, rode no\n" +
        "   ambiente onde a chave existe.\n",
    );
  }

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
  /*
    Book vazio não é motivo para não medir nada — é motivo para dizer o que não
    foi medido.

    A versão anterior parava aqui, e a parada custava caro: um banco com
    vigências promovidas e chave configurada consegue medir dois terços da
    bateria (parâmetros, operação, comparação, impacto, executivas, anomalias,
    ambiguidade, ausência de resposta e indução de número) contra dado real e
    com o modelo real. O que não dá para medir sem documento anexado são as
    categorias de Book e as multi-fonte — e essas se pulam sozinhas, porque os
    marcadores `{BLOCO_DOC}` e `{BLOCO}` não resolvem. Cada uma aparece como
    **pulada** no relatório, com o motivo; nenhuma vira aprovação silenciosa.
  */
  if (ambiente.blocosComRegra === 0) {
    console.warn(
      "\n⚠  O Book não tem nenhuma regra registrada neste banco.\n" +
        "   As categorias de Book, documento e multi-fonte vão aparecer como PULADAS —\n" +
        "   este relatório não serve como baseline delas. Se o Book do app que você usa\n" +
        "   tem documentos, provavelmente é outro banco: confira a DATABASE_URL.\n",
    );
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

  const todos = [...doCatalogo, ...dasConversas];
  const texto = relatorio(ambiente, marcadores, todos);
  writeFileSync(saida, texto, "utf8");

  /*
    O mesmo resultado em JSON, ao lado do markdown.

    O markdown é para ler; este é para **comparar**. Quando o agente entrar
    atrás da flag, a pergunta que decide se ele pode virar padrão é "que
    perguntas mudaram de desfecho, e para melhor ou pior?" — e essa pergunta se
    responde com um diff entre dois destes arquivos, não relendo sessenta
    respostas à mão.
  */
  const json = saida.replace(/\.md$/, "") + ".json";
  writeFileSync(
    json,
    JSON.stringify(
      {
        em: new Date().toISOString(),
        agente: process.env.ASSISTENTE_AGENTE === "1",
        ambiente: { ...ambiente, urlDoBanco: ambiente.urlDoBanco.replace(/:[^:@/]+@/, ":***@") },
        marcadores,
        medicoes: todos.map(medir),
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\nRelatório escrito em ${saida}`);
  console.log(`Medição comparável em ${json}`);
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
