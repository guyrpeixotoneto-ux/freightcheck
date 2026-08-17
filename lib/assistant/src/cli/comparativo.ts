/**
 * Agente × planejador, pergunta a pergunta, sobre o mesmo banco.
 *
 *     ANTHROPIC_API_KEY=… DATABASE_URL=… \
 *       pnpm --filter @workspace/assistant run comparativo -- --saida=comparativo
 *
 * **Por que este arquivo existe, tendo `comparar` já existido.** `comparar` lê
 * dois JSON produzidos por duas rodadas separadas e responde uma pergunta de
 * portão: *houve regressão?* É a pergunta certa para decidir se se pode virar a
 * chave, e é insuficiente para decidir se **vale** virar. Ela conta transições
 * de estado; não mostra as duas respostas lado a lado, não separa rodada de
 * consulta, não diz quanto custou, e não permite a ninguém discordar do
 * veredito lendo o material.
 *
 * Aqui os dois caminhos rodam **no mesmo processo, sobre o mesmo banco, na
 * mesma ordem**, alternando por `PerguntaOptions.agente` em vez de variável de
 * ambiente. Isso elimina a classe de erro que a rodada anterior quase produziu:
 * duas execuções em momentos diferentes, comparadas como se fossem simultâneas.
 *
 * **O que ele não faz, e é deliberado.** Ele não decide qual resposta é melhor
 * em correção e utilidade. Isso exige ler as duas, e um número inventado para
 * essa dimensão seria pior do que a sua ausência — seria a aparência de
 * objetividade sobre um julgamento que ninguém fez. O relatório calcula o que é
 * objetivo (lastro, limites, encadeamento, custo, desfecho), põe as duas
 * respostas inteiras lado a lado, e para aí.
 *
 * **Nada aqui muda o agente.** Sem prompt, sem catálogo, sem teto, sem trava:
 * este arquivo só chama `responder` duas vezes e lê o que voltou.
 */

import { writeFileSync } from "node:fs";
import { createDb } from "@workspace/db";
import { disponivel, modeloConfigurado } from "../llm";
import { responder, type Resposta } from "../resposta";
import { CASOS_DE_DESFECHO, conferirDesfecho } from "../aceitacao/desfecho";
import { trajetoriasDistintas } from "../medicao";

// ── O que se mede de cada lado ──────────────────────────────────────────────

interface Lado {
  caminho: "PLANEJADOR" | "AGENTE";
  texto: string;
  redacao: string;
  /** Por que este texto saiu de quem saiu — IA_OK, IA_PODADA, DESCARTADA… */
  causa: string;
  /** As ferramentas na ordem em que foram chamadas. */
  ferramentas: string[];
  /**
   * Rodadas e consultas, **separadas**.
   *
   * Uma rodada é um turno do modelo e pode pedir várias ferramentas de uma vez.
   * Somá-las apagaria a diferença entre investigar fundo e varrer largo — e
   * apagá-la foi como uma métrica desta migração descreveu uma rodada ao
   * contrário.
   */
  rodadas: number | null;
  consultas: number;
  /** Quantas consultas usaram como argumento algo que outra consulta devolveu. */
  encadeadas: number;
  parou: string | null;
  evidencias: { titulo: string; origem: string }[];
  /** Afirmações numéricas do texto final e quantas a trava recusou. */
  numeros: { citados: number; recusados: string[] };
  frases: { podadas: number; total: number };
  /** Declarou o que faltava, em vez de responder sobre o vazio. */
  lacunas: string[];
  custo: { ms: number; entrada: number; saida: number; usd: number } | null;
  /** As regras da bateria que este lado violou — vazio é bom. */
  falhas: string[];
}

/** Todo token numérico de um texto — a mesma extração que a trava faz. */
function numerosDoTexto(texto: string): string[] {
  return texto.match(/\d[\d.,]*/g)?.filter((t) => t.length > 1) ?? [];
}

function medir(
  caminho: Lado["caminho"],
  r: Resposta,
  falhas: string[],
): Lado {
  const a = r.tecnico.agente;
  return {
    caminho,
    texto: r.texto,
    redacao: r.redacao,
    causa: r.tecnico.motor.codigo,
    ferramentas: r.tecnico.ferramentas,
    rodadas: a?.rodadas ?? null,
    consultas: a?.consultas ?? r.tecnico.ferramentas.length,
    encadeadas: a?.chamadas.filter((c) => c.derivaDe !== null).length ?? 0,
    parou: a?.parou ?? null,
    evidencias: r.fontes.map((f) => ({ titulo: f.titulo, origem: f.origem })),
    numeros: {
      citados: numerosDoTexto(r.texto).length,
      recusados: r.tecnico.numerosRecusados,
    },
    frases: { podadas: r.tecnico.rastro.frasesPodadas, total: r.tecnico.rastro.frasesTotais },
    lacunas: r.lacunas.map((l) => l.tipo),
    custo: r.tecnico.ia
      ? {
          ms: r.tecnico.ia.latenciaMs,
          entrada: r.tecnico.ia.tokensEntrada,
          saida: r.tecnico.ia.tokensSaida,
          usd: r.tecnico.ia.custoUsd,
        }
      : null,
    falhas,
  };
}

// ── A comparação objetiva ───────────────────────────────────────────────────

type Dimensao = "grounding" | "limites" | "investigacao" | "eficiencia" | "desfecho";

/**
 * A ordem dos desfechos, do melhor para o pior.
 *
 * `IA_OK` é a resposta do modelo inteira; `IA_PODADA` perdeu frases;
 * `DESCARTADA` caiu para a redação em código; `ERRO` não respondeu. É ordinal e
 * não é nota: a distância entre os degraus não significa nada.
 */
const ORDEM_DE_DESFECHO = ["ERRO", "RECUSA", "DESCARTADA", "IA_PODADA", "IA_OK"];

function compararDimensao(d: Dimensao, p: Lado, a: Lado): { ganhador: string; porque: string } {
  if (d === "desfecho") {
    const ip = ORDEM_DE_DESFECHO.indexOf(p.causa);
    const ia = ORDEM_DE_DESFECHO.indexOf(a.causa);
    if (ip === ia) return { ganhador: "empate", porque: `ambos ${p.causa}` };
    return {
      ganhador: ia > ip ? "agente" : "planejador",
      porque: `${a.causa} vs ${p.causa}`,
    };
  }

  if (d === "grounding") {
    /*
      Menos número recusado é melhor, e a leitura precisa de cuidado: recusa
      pode significar "o modelo inventou" **ou** "a ferramenta mostrou sem
      autorizar". As duas aparecem aqui iguais, e a segunda é defeito de
      infraestrutura, não do agente — por isso os números recusados vão
      listados por extenso no relatório, e não só contados.
    */
    const rp = p.numeros.recusados.length;
    const ra = a.numeros.recusados.length;
    if (rp === ra) return { ganhador: "empate", porque: `${rp} número(s) recusado(s) dos dois lados` };
    return {
      ganhador: ra < rp ? "agente" : "planejador",
      porque: `${ra} recusado(s) no agente vs ${rp} no planejador`,
    };
  }

  if (d === "limites") {
    const lp = p.lacunas.length;
    const la = a.lacunas.length;
    if (lp === la) return { ganhador: "empate", porque: `${lp} lacuna(s) declarada(s) dos dois lados` };
    return {
      ganhador: la > lp ? "agente" : "planejador",
      porque: `${la} lacuna(s) declarada(s) vs ${lp}`,
    };
  }

  if (d === "investigacao") {
    /*
      **Consultas não decidem sozinhas.** Dez buscas independentes são largura,
      não profundidade; o que prova investigação é uma consulta cujo argumento
      saiu do resultado de outra. Por isso o critério é encadeamento primeiro, e
      só depois quantidade — e um empate em encadeamento com mais consultas do
      lado do agente é declarado "mais consultas, sem encadeamento", que é
      exatamente a leitura que não se deve premiar.
    */
    if (a.encadeadas !== p.encadeadas) {
      return {
        ganhador: a.encadeadas > p.encadeadas ? "agente" : "planejador",
        porque: `${a.encadeadas} consulta(s) encadeada(s) vs ${p.encadeadas}`,
      };
    }
    if (a.consultas === p.consultas) return { ganhador: "empate", porque: "mesma largura, mesmo encadeamento" };
    return {
      ganhador: "indeciso",
      porque:
        `${a.consultas} consultas vs ${p.consultas}, sem diferença de encadeamento — ` +
        "mais consultas não é investigar melhor",
    };
  }

  // eficiência
  const cp = p.custo?.usd ?? 0;
  const ca = a.custo?.usd ?? 0;
  const mp = p.custo?.ms ?? 0;
  const ma = a.custo?.ms ?? 0;
  if (cp === 0 && ca === 0) return { ganhador: "empate", porque: "sem custo medido" };
  return {
    ganhador: ca <= cp ? "agente" : "planejador",
    porque: `US$ ${ca.toFixed(4)} / ${ma}ms vs US$ ${cp.toFixed(4)} / ${mp}ms`,
  };
}

const DIMENSOES: Dimensao[] = ["desfecho", "grounding", "limites", "investigacao", "eficiencia"];

async function principal() {
  const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  const base = process.argv.slice(2).find((x) => x.startsWith("--saida="))?.slice(8) ?? "comparativo";

  if (!url) {
    console.error("Falta DATABASE_URL (ou ASSISTANT_EVAL_DATABASE_URL). Nada executado.");
    process.exit(1);
  }

  /*
    Sem chave, os dois lados viram o mesmo caminho determinístico e a comparação
    não compara nada. Recusar aqui é o mesmo princípio do portão: "não medi" e
    "medi e empatou" pedem ações opostas.
  */
  if (!disponivel()) {
    console.error(
      "\nSem ANTHROPIC_API_KEY não há agente: os dois lados cairiam na redação em código\n" +
        "e o relatório mostraria um empate que não significa nada. Nenhum veredito emitido.\n",
    );
    process.exit(1);
  }

  const { db } = createDb(url);
  const linhas: { id: string; pergunta: string; planejador: Lado; agente: Lado }[] = [];

  for (const caso of CASOS_DE_DESFECHO) {
    process.stdout.write(`  ${caso.id}\n`);

    /*
      A ordem é sempre planejador → agente, e os dois no mesmo processo. Rodar
      em processos separados foi o que permitiu, na rodada anterior, comparar o
      planejador com ele mesmo sem que nada acusasse.
    */
    const p = await responder(db, caso.pergunta, { diagnostico: true, agente: false });
    const a = await responder(db, caso.pergunta, { diagnostico: true, agente: true });

    const mapaP = new Map([[caso.id, p]]);
    const mapaA = new Map([[caso.id, a]]);

    linhas.push({
      id: caso.id,
      pergunta: caso.pergunta,
      planejador: medir(
        "PLANEJADOR",
        p,
        conferirDesfecho(p, caso.espera, mapaP).map((f) => `${f.regra}: ${f.detalhe}`),
      ),
      agente: medir(
        "AGENTE",
        a,
        conferirDesfecho(a, caso.espera, mapaA).map((f) => `${f.regra}: ${f.detalhe}`),
      ),
    });
  }

  // ---- o relatório ---------------------------------------------------------

  const l: string[] = [];
  const pr = (s = "") => l.push(s);

  const placar = { agente: 0, planejador: 0, empate: 0, indeciso: 0 };
  for (const caso of linhas) {
    for (const d of DIMENSOES) {
      const v = compararDimensao(d, caso.planejador, caso.agente);
      placar[v.ganhador as keyof typeof placar] += 1;
    }
  }

  pr("# Agente × planejador — pergunta a pergunta");
  pr();
  pr(`- modelo: **${modeloConfigurado() ?? "sem chave"}**`);
  pr(`- ${linhas.length} perguntas, os dois caminhos no mesmo processo e sobre o mesmo banco`);
  pr(
    `- trajetórias distintas: planejador **${trajetoriasDistintas(linhas.map((x) => x.planejador.ferramentas))}** · ` +
      `agente **${trajetoriasDistintas(linhas.map((x) => x.agente.ferramentas))}** (de ${linhas.length})`,
  );
  pr();
  pr("## O que este relatório decide, e o que ele não decide");
  pr();
  pr(
    "Decide o que é objetivo: desfecho, lastro, reconhecimento de limites, encadeamento " +
      "da investigação e custo. **Não** decide correção e utilidade — isso exige ler as duas " +
      "respostas, e um número inventado para essa dimensão seria a aparência de objetividade " +
      "sobre um julgamento que ninguém fez. As respostas inteiras estão abaixo, lado a lado.",
  );
  pr();
  pr(
    "E **mais consultas não conta como investigar melhor**: a dimensão de investigação " +
      "compara encadeamento primeiro — consultas cujo argumento saiu do resultado de outra — " +
      "e declara `indeciso` quando o agente só fez mais chamadas sem encadear.",
  );
  pr();
  pr("## Placar por dimensão");
  pr();
  pr(`| agente | planejador | empate | indeciso |`);
  pr(`| ---: | ---: | ---: | ---: |`);
  pr(`| **${placar.agente}** | **${placar.planejador}** | ${placar.empate} | ${placar.indeciso} |`);
  pr();
  pr(`_De ${linhas.length} perguntas × ${DIMENSOES.length} dimensões = ${linhas.length * DIMENSOES.length} comparações._`);
  pr();

  const custoTotal = (lado: "planejador" | "agente") =>
    linhas.reduce((s, x) => s + (x[lado].custo?.usd ?? 0), 0);
  pr(
    `Custo da bateria: planejador US$ ${custoTotal("planejador").toFixed(4)} · ` +
      `agente US$ ${custoTotal("agente").toFixed(4)}.`,
  );
  pr();

  for (const caso of linhas) {
    pr("---");
    pr();
    pr(`## ${caso.id}`);
    pr();
    pr(`> ${caso.pergunta}`);
    pr();

    pr("| | planejador | agente |");
    pr("| --- | --- | --- |");
    pr(`| desfecho | ${caso.planejador.causa} | ${caso.agente.causa} |`);
    pr(
      `| **rodadas** | — | ${caso.agente.rodadas ?? "—"}${caso.agente.parou ? ` (parou: ${caso.agente.parou})` : ""} |`,
    );
    pr(`| **tool calls** | ${caso.planejador.consultas} | ${caso.agente.consultas} |`);
    pr(`| encadeadas | ${caso.planejador.encadeadas} | ${caso.agente.encadeadas} |`);
    pr(`| evidências | ${caso.planejador.evidencias.length} | ${caso.agente.evidencias.length} |`);
    pr(
      `| números no texto | ${caso.planejador.numeros.citados} | ${caso.agente.numeros.citados} |`,
    );
    pr(
      `| números recusados | ${caso.planejador.numeros.recusados.join(", ") || "—"} | ${caso.agente.numeros.recusados.join(", ") || "—"} |`,
    );
    pr(
      `| frases podadas | ${caso.planejador.frases.podadas}/${caso.planejador.frases.total} | ${caso.agente.frases.podadas}/${caso.agente.frases.total} |`,
    );
    pr(`| lacunas declaradas | ${caso.planejador.lacunas.join(", ") || "—"} | ${caso.agente.lacunas.join(", ") || "—"} |`);
    pr(
      `| tempo · tokens · custo | ${caso.planejador.custo ? `${caso.planejador.custo.ms}ms · ${caso.planejador.custo.entrada}+${caso.planejador.custo.saida} · US$ ${caso.planejador.custo.usd.toFixed(4)}` : "—"} | ` +
        `${caso.agente.custo ? `${caso.agente.custo.ms}ms · ${caso.agente.custo.entrada}+${caso.agente.custo.saida} · US$ ${caso.agente.custo.usd.toFixed(4)}` : "—"} |`,
    );
    pr(`| falhas da bateria | ${caso.planejador.falhas.join(" · ") || "—"} | ${caso.agente.falhas.join(" · ") || "—"} |`);
    pr();

    pr("**Ferramentas, na ordem**");
    pr();
    pr(`- planejador: \`${caso.planejador.ferramentas.join(" → ") || "nada"}\``);
    pr(`- agente: \`${caso.agente.ferramentas.join(" → ") || "nada"}\``);
    pr();

    pr("**Veredito por dimensão**");
    pr();
    pr("| dimensão | ganhador | por quê |");
    pr("| --- | --- | --- |");
    for (const d of DIMENSOES) {
      const v = compararDimensao(d, caso.planejador, caso.agente);
      pr(`| ${d} | ${v.ganhador} | ${v.porque} |`);
    }
    pr("| correção e utilidade | **exige leitura humana** | as duas respostas estão abaixo |");
    pr();

    pr("<details><summary><b>Resposta do planejador</b></summary>");
    pr();
    pr(caso.planejador.texto || "_(vazia)_");
    pr();
    pr("</details>");
    pr();
    pr("<details><summary><b>Resposta do agente</b></summary>");
    pr();
    pr(caso.agente.texto || "_(vazia)_");
    pr();
    pr("</details>");
    pr();
  }

  writeFileSync(`${base}.md`, l.join("\n"), "utf8");
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ modelo: modeloConfigurado(), placar, linhas }, null, 2),
    "utf8",
  );

  console.log(`\n${base}.md · ${base}.json`);
  console.log(
    `  agente ${placar.agente} · planejador ${placar.planejador} · ` +
      `empate ${placar.empate} · indeciso ${placar.indeciso}`,
  );
  console.log("\n  Correção e utilidade não estão no placar. Leia as respostas.\n");
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
