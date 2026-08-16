/**
 * A prova do PR 2: perguntas diferentes têm de buscar dados diferentes.
 *
 *     pnpm --filter @workspace/assistant run trajetoria
 *
 * **O que ela mede, e o que ela deliberadamente não mede.** Não é qualidade de
 * prosa, não é nota de resposta, não é se o texto ficou bom. É uma coisa só:
 * **a trajetória de consultas**. Que ferramentas foram chamadas, com que
 * argumentos, em que ordem, e que evidência voltou de cada uma. Se três
 * perguntas semanticamente distintas produzirem a mesma trajetória, o agente
 * não está investigando — está fazendo o que o planejador fazia, com mais
 * passos e mais custo.
 *
 * **As duas colunas.** Cada pergunta roda por dois caminhos: o **atual** (o
 * planejador determinístico, que roda sem chave nenhuma) e o **agente** (o laço
 * de tool use, que precisa de chave). A comparação é o produto deste relatório,
 * e a coluna do atual é a régua: hoje ela é a mesma para as três perguntas, e
 * isso é medido aqui, não afirmado.
 *
 * **Os três casos mínimos.** "O que mudou?" pede o panorama. "O que mudou nos
 * cavalos?" pede o mesmo panorama restrito a um tipo de ativo. "Liste as
 * alterações dos cavalos" pede a enumeração daquele recorte. As três diferem em
 * exatamente um eixo por vez — o filtro e o nível de detalhe —, que é o desenho
 * mais estreito capaz de mostrar se o agente distingue eixos ou só assunto.
 */

import { writeFileSync } from "node:fs";
import { createDb } from "@workspace/db";
import { investigar, agenteLigado } from "../agente";
import { registroPadrao, type ChamadaDeFerramenta } from "../ferramentas/registro";
import { disponivel, modeloConfigurado } from "../llm";
import { responder } from "../resposta";

const PERGUNTAS = [
  "o que mudou?",
  "o que mudou nos cavalos?",
  "liste as alterações dos cavalos",
];

interface Trajetoria {
  pergunta: string;
  /** O caminho atual: as consultas que o planejador decidiu fazer. */
  atual: { ferramentas: string[]; texto: string; fatos: number };
  /** O caminho do agente, quando houve chave para rodá-lo. */
  agente: {
    rodadas: number;
    parou: string;
    chamadas: ChamadaDeFerramenta[];
    texto: string | null;
    tokensEntrada: number;
    tokensSaida: number;
    latenciaMs: number;
    erro: string | null;
  } | null;
}

/** A trajetória como assinatura comparável: nome(args) → nome(args). */
function assinatura(chamadas: ChamadaDeFerramenta[]): string {
  return chamadas
    .map((c) => {
      const args = Object.entries((c.argumentos ?? {}) as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .sort()
        .join(", ");
      return `${c.nome}(${args})`;
    })
    .join(" → ");
}

async function principal() {
  const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  const saida =
    process.argv.slice(2).find((a) => a.startsWith("--saida="))?.slice(8) ?? "trajetoria.md";

  if (!url) {
    console.error("Falta DATABASE_URL (ou ASSISTANT_EVAL_DATABASE_URL). Nada executado.");
    process.exit(1);
  }

  const { db } = createDb(url);
  const registro = registroPadrao();
  const trajetorias: Trajetoria[] = [];

  for (const pergunta of PERGUNTAS) {
    process.stdout.write(`  ${pergunta}\n`);

    /*
      O caminho atual roda com `semIa`, e é de propósito.

      O que interessa dele é a **trajetória de consultas**, que é decidida pelo
      planejador antes de qualquer chamada ao modelo. Rodá-lo com modelo
      mudaria o texto e não mudaria uma vírgula das ferramentas — e custaria
      uma chamada por pergunta para medir o que já está decidido.
    */
    const atual = await responder(db, pergunta, { semIa: true, diagnostico: true });

    const agente = disponivel()
      ? await (async () => {
          const inv = await investigar({
            pergunta,
            registro,
            ferramentas: { db, recorte: {} },
          });
          return {
            rodadas: inv.rodadas,
            parou: inv.parou,
            chamadas: inv.chamadas,
            texto: inv.texto,
            tokensEntrada: inv.medicao.tokensEntrada,
            tokensSaida: inv.medicao.tokensSaida,
            latenciaMs: inv.medicao.latenciaMs,
            erro: inv.medicao.erro,
          };
        })()
      : null;

    trajetorias.push({
      pergunta,
      atual: {
        ferramentas: atual.tecnico.ferramentas,
        texto: atual.texto,
        fatos: atual.tecnico.contexto.fatos,
      },
      agente,
    });
  }

  // ---- relatório -----------------------------------------------------------
  const l: string[] = [];
  const p = (s = "") => l.push(s);

  p("# Trajetória de ferramentas — PR 2");
  p();
  p(`- modelo: ${modeloConfigurado() ?? "**sem chave neste processo**"}`);
  p(`- flag \`ASSISTENTE_AGENTE\`: ${agenteLigado() ? "ligada" : "desligada"}`);
  p(`- ferramentas registradas: ${registro.lista().map((f) => f.nome).join(", ")}`);
  p();
  p(
    "Este relatório mede **o que foi consultado**, não a qualidade do texto. A pergunta " +
      "que ele responde é uma só: perguntas semanticamente diferentes produzem trajetórias " +
      "diferentes?",
  );
  p();

  // ---- A. o caminho atual, que roda sem chave ------------------------------
  p("## A. Caminho atual — o planejador determinístico");
  p();
  p("| pergunta | consultas | fatos entregues |");
  p("| --- | --- | ---: |");
  for (const t of trajetorias) {
    p(`| ${t.pergunta} | \`${t.atual.ferramentas.join(", ") || "—"}\` | ${t.atual.fatos} |`);
  }
  p();

  const assinaturasAtuais = new Set(trajetorias.map((t) => t.atual.ferramentas.join(",")));
  const textosAtuais = new Set(trajetorias.map((t) => t.atual.texto));
  p(
    `Trajetórias distintas: **${assinaturasAtuais.size} de ${trajetorias.length}**. ` +
      `Textos distintos: **${textosAtuais.size} de ${trajetorias.length}**.`,
  );
  p();
  if (assinaturasAtuais.size === 1) {
    p(
      "> As três perguntas produzem a **mesma** trajetória. Nenhum modelo distingue três " +
        "perguntas que recebem o mesmo material — é o limite que o PR 2 existe para tirar.",
    );
    p();
  }

  // ---- B. o agente ---------------------------------------------------------
  p("## B. Caminho do agente — o laço de tool use");
  p();

  if (!disponivel()) {
    p(
      "> **Não rodado: não há `ANTHROPIC_API_KEY` neste processo.** Esta metade exige uma " +
        "chamada real ao modelo — é o modelo que escolhe as ferramentas, e não há como " +
        "simular essa escolha sem falsificar a prova. Rode este mesmo comando no ambiente " +
        "onde a chave existe e a seção se preenche.",
    );
    p();
  } else {
    for (const t of trajetorias) {
      const a = t.agente!;
      p(`### ${t.pergunta}`);
      p();
      p(
        `${a.rodadas} rodada(s) · parou por \`${a.parou}\` · ` +
          `${a.tokensEntrada.toLocaleString("pt-BR")} tokens de entrada · ` +
          `${a.tokensSaida.toLocaleString("pt-BR")} de saída · ${a.latenciaMs} ms` +
          (a.erro ? ` · erro: ${a.erro}` : ""),
      );
      p();
      p(`**Trajetória.** \`${assinatura(a.chamadas) || "(nenhuma consulta)"}\``);
      p();
      p("| # | ferramenta | argumentos | ok | ms | evidência que voltou | números |");
      p("| --- | --- | --- | --- | ---: | --- | ---: |");
      a.chamadas.forEach((c, i) => {
        const titulos = c.evidencias.map((e) => e.titulo).join("; ") || "—";
        const numeros = c.evidencias.reduce((n, e) => n + e.numeros.length, 0);
        p(
          `| ${i + 1} | \`${c.nome}\` | \`${JSON.stringify(c.argumentos)}\` | ` +
            `${c.ok ? "sim" : `**não** — ${c.erro}`} | ${c.ms} | ${titulos} | ${numeros} |`,
        );
      });
      p();
      if (a.texto) {
        p("<details><summary>O texto que saiu (não avaliado aqui)</summary>");
        p();
        p("> " + a.texto.split("\n").join("\n> "));
        p();
        p("</details>");
        p();
      }
    }

    // ---- C. o veredito -----------------------------------------------------
    const assinaturas = trajetorias.map((t) => assinatura(t.agente!.chamadas));
    const distintas = new Set(assinaturas);

    p("## C. Veredito");
    p();
    p("| pergunta | trajetória |");
    p("| --- | --- |");
    trajetorias.forEach((t, i) => p(`| ${t.pergunta} | \`${assinaturas[i]}\` |`));
    p();
    p(
      `Trajetórias distintas: **${distintas.size} de ${trajetorias.length}** ` +
        `(o caminho atual produz ${assinaturasAtuais.size}).`,
    );
    p();
    if (distintas.size === trajetorias.length) {
      p(
        "> **Passou.** Cada pergunta buscou o seu próprio dado. Isto não diz que as respostas " +
          "estão boas — diz que elas deixaram de ser a mesma resposta.",
      );
    } else {
      p(
        "> **Não passou.** Duas ou mais perguntas produziram a mesma trajetória. Antes de " +
          "mexer no prompt, olhe a coluna de argumentos: o padrão mais comum é o modelo " +
          "chamar o nível certo e esquecer o filtro, e isso se corrige na descrição do " +
          "campo, não na instrução do sistema.",
      );
    }
    p();
  }

  p("## O que este relatório não mede");
  p();
  p(
    "Qualidade de prosa, correção factual e utilidade da resposta. A coluna de texto está " +
      "aqui para leitura, não para nota — a régua de qualidade é a bateria de aceitação, " +
      "que roda em separado.",
  );

  writeFileSync(saida, l.join("\n"), "utf8");
  console.log(`\nRelatório escrito em ${saida}`);
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
