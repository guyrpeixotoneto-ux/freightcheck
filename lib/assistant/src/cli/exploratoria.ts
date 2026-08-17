/**
 * A bateria exploratória — uma conversa de verdade, medida turno a turno.
 *
 *     ASSISTENTE_AGENTE=1 pnpm --filter @workspace/assistant run exploratoria
 *
 * **O que ela mede que a bateria por desfecho não mede.** Aquela roda nove
 * perguntas isoladas e pergunta "o desfecho melhorou?". Esta roda **uma
 * conversa**, com o estado e o histórico passando de turno a turno, e pergunta
 * uma coisa diferente: o agente se comporta como um analista? Um follow-up
 * como "por quê?" não tem assunto próprio, e o que ele significa depende
 * inteiramente do turno anterior — é o caso que nenhuma pergunta isolada
 * alcança.
 *
 * **Os nove sinais são medidos, não julgados.** Nenhum deles é nota de prosa.
 * Cada um é uma propriedade conferível da resposta ou do rastro: quantas
 * consultas houve, se a segunda dependeu da primeira, se algum número foi
 * recusado pela trava, se há citação válida, se o follow-up continuou no mesmo
 * assunto. Onde a medição é fraca — distinguir fato de inferência se detecta
 * por marcador linguístico, e marcador não é garantia — o relatório diz que é
 * indício, e não veredito.
 *
 * **Ela não decide a virada de chave.** Quem decide é `comparar`, sobre a
 * bateria por desfecho. Esta responde a pergunta seguinte, que só faz sentido
 * depois: virou, e agora, ele é bom de conversar?
 */

import { writeFileSync } from "node:fs";
import { createDb } from "@workspace/db";
import { agenteLigado } from "../agente";
import { disponivel, modeloConfigurado, type TurnoAnterior } from "../llm";
import { responder, type Resposta } from "../resposta";
import type { EstadoDaConversa } from "../conversa";
import { capacidadesDe } from "../aceitacao/desfecho";

interface Passo {
  pergunta: string;
  /** O que este turno exige, e que o anterior não exigia. */
  exige: {
    /** Precisa de mais de uma consulta — não se responde com um agregado. */
    encadeia?: true;
    /** É follow-up: não nomeia assunto, e tem de continuar o do turno anterior. */
    continua?: true;
    /** Tem de reconhecer que falta dado, em vez de preencher. */
    reconheceFalta?: true;
    /** Tem de exercer uma capacidade que o turno anterior não exerceu. */
    capacidadeNova?: true;
  };
  porque: string;
}

/**
 * A conversa. A ordem importa: cada passo depende do anterior.
 *
 * Ela é uma conversa real de auditoria, e não um catálogo — abre no panorama,
 * pergunta a causa, quantifica, troca a vigência, compara, desce ao ativo e
 * termina perguntando o que ficou em aberto. É a sequência que um analista faz,
 * e é por isso que os follow-ups sem assunto próprio ("por quê?", "e julho?")
 * estão no meio dela e não no fim.
 */
const CONVERSA: Passo[] = [
  {
    pergunta: "o que mudou?",
    exige: {},
    porque: "abre a conversa; estabelece vigência e recorte para tudo o que vem depois",
  },
  {
    pergunta: "por quê?",
    exige: { continua: true, encadeia: true },
    porque:
      "não nomeia nada. Só significa alguma coisa sobre o turno anterior, e responder " +
      "exige descer abaixo do agregado que acabou de ser dito",
  },
  {
    pergunta: "qual foi o impacto?",
    exige: { continua: true },
    porque: "continua no mesmo recorte; o número tem de vir de consulta, não de memória",
  },
  {
    pergunta: "e julho?",
    exige: { continua: true },
    porque:
      "troca a vigência e mantém o assunto — o caso que a herança em código resolvia " +
      "sem modelo, e que agora depende de o modelo entender o referente",
  },
  {
    pergunta: "compare com a vigência anterior",
    exige: { capacidadeNova: true },
    porque: "pede confronto entre pontas, que é outra capacidade",
  },
  {
    pergunta: "quais veículos foram mais afetados?",
    exige: { capacidadeNova: true },
    porque: "desce ao ativo; a resposta tem de trazer placa, não agregado",
  },
  {
    pergunta: "o que você ainda não consegue concluir?",
    exige: { reconheceFalta: true },
    porque:
      "o teste mais duro: exige saber o que **não** foi consultado. Só é respondível " +
      "por quem escolheu as consultas",
  },
];

/** Marcadores de leitura própria — indício de que fato e inferência não se confundem. */
const MARCA_INFERENCIA =
  /\b(sugere|parece|indica|provavelmente|hipótese|pode ser que|vale investigar|ao que tudo indica)\b/i;

/** Marcadores de ausência declarada. */
const MARCA_FALTA =
  /\b(não foi apurad|não consegui|não há como|falta|não est[áa] confirmad|não apur[áa]vel|em aberto|não consultei)\b/i;

interface Medida {
  turno: number;
  pergunta: string;
  porque: string;
  rodadas: number | null;
  consultas: string[];
  capacidades: string[];
  citacoes: number[];
  fontes: number;
  numerosRecusados: string[];
  recorte: string | null;
  redigiu: string;
  causa: string;
  tokens: number | null;
  ms: number;
  sinais: Record<string, boolean | null>;
  texto: string;
}

function citacoesDe(texto: string): number[] {
  return [...new Set((texto.match(/\[\d{1,2}\]/g) ?? []).map((c) => Number(c.slice(1, -1))))].sort(
    (a, b) => a - b,
  );
}

async function principal() {
  const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  const saida =
    process.argv.slice(2).find((a) => a.startsWith("--saida="))?.slice(8) ?? "exploratoria";

  if (!url) {
    console.error("Falta DATABASE_URL (ou ASSISTANT_EVAL_DATABASE_URL). Nada executado.");
    process.exit(1);
  }

  const { db } = createDb(url);
  let estado: EstadoDaConversa | null = null;
  const historico: TurnoAnterior[] = [];
  const medidas: Medida[] = [];

  for (const [i, passo] of CONVERSA.entries()) {
    process.stdout.write(`  ${i + 1}. ${passo.pergunta}\n`);
    const inicio = Date.now();
    const r: Resposta = await responder(db, passo.pergunta, {
      estado,
      historico: [...historico],
      diagnostico: true,
    });
    const ms = Date.now() - inicio;

    const anterior = medidas.at(-1);
    const capacidades = [...capacidadesDe(r)].sort();
    const citacoes = citacoesDe(r.texto);

    /*
      Cada sinal é `null` quando o passo não o exige — e não `false`. A
      diferença importa no relatório: "não exigido" e "exigido e falhou" são
      leituras opostas, e um zero no lugar de um traço faria a conversa parecer
      pior do que foi.
    */
    const sinais: Record<string, boolean | null> = {
      encadeia: passo.exige.encadeia ? r.tecnico.ferramentas.length > 1 : null,
      /*
        Continuar é três coisas ao mesmo tempo, e nenhuma delas sozinha basta:
        ficar no mesmo recorte (não trocou de vigência sem avisar), ter ido
        consultar alguma coisa (não respondeu de memória), e **não repetir** o
        turno anterior — um follow-up que devolve o texto de antes não
        continuou a conversa, encerrou-a.
      */
      continua: passo.exige.continua
        ? r.recorte === (anterior?.recorte ?? r.recorte) &&
          r.tecnico.ferramentas.length > 0 &&
          r.texto.trim() !== (anterior?.texto.trim() ?? "")
        : null,
      reconheceFalta: passo.exige.reconheceFalta
        ? MARCA_FALTA.test(r.texto) || r.lacunas.length > 0
        : null,
      capacidadeNova: passo.exige.capacidadeNova
        ? capacidades.some((c) => !(anterior?.capacidades ?? []).includes(c))
        : null,
      // Estes quatro valem em todo turno.
      naoInventou: r.tecnico.numerosRecusados.length === 0,
      citouEvidencia: citacoes.length > 0 && citacoes.every((n) => n >= 1 && n <= r.fontes.length),
      distingueInferencia: MARCA_INFERENCIA.test(r.texto),
      consultouAlgo: r.tecnico.ferramentas.length > 0,
    };

    medidas.push({
      turno: i + 1,
      pergunta: passo.pergunta,
      porque: passo.porque,
      rodadas: null,
      consultas: r.tecnico.ferramentas,
      capacidades,
      citacoes,
      fontes: r.fontes.length,
      numerosRecusados: r.tecnico.numerosRecusados,
      recorte: r.recorte,
      redigiu: r.tecnico.motor.redigiu,
      causa: r.tecnico.motor.codigo,
      tokens: r.tecnico.ia ? r.tecnico.ia.tokensEntrada + r.tecnico.ia.tokensSaida : null,
      ms,
      sinais,
      texto: r.texto,
    });

    estado = r.estado;
    historico.push({ papel: "PERGUNTA", texto: passo.pergunta });
    historico.push({ papel: "RESPOSTA", texto: r.texto });
  }

  // ---- relatório -----------------------------------------------------------
  const l: string[] = [];
  const p = (s = "") => l.push(s);
  const marca = (v: boolean | null) => (v === null ? "—" : v ? "sim" : "**não**");

  p(`# Bateria exploratória — caminho ${agenteLigado() ? "AGENTE" : "PLANEJADOR"}`);
  p();
  p(`- modelo: ${modeloConfigurado() ?? "**sem chave**"}`);
  p(`- turnos: ${medidas.length}, numa conversa só (estado e histórico atravessam)`);
  p();
  if (!disponivel()) {
    p(
      "> **Sem chave neste processo.** O que está medido abaixo é o caminho determinístico. " +
        "Os sinais de encadeamento, citação e inferência só significam alguma coisa com o " +
        "modelo real escolhendo as consultas.",
    );
    p();
  }

  p("## Os nove sinais, turno a turno");
  p();
  p("| # | pergunta | consultou | encadeou | continuou | cap. nova | reconheceu falta | não inventou | citou | inferência |");
  p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of medidas) {
    p(
      `| ${m.turno} | ${m.pergunta} | ${marca(m.sinais.consultouAlgo!)} | ${marca(m.sinais.encadeia!)} | ` +
        `${marca(m.sinais.continua!)} | ${marca(m.sinais.capacidadeNova!)} | ${marca(m.sinais.reconheceFalta!)} | ` +
        `${marca(m.sinais.naoInventou!)} | ${marca(m.sinais.citouEvidencia!)} | ${marca(m.sinais.distingueInferencia!)} |`,
    );
  }
  p();
  p(
    "_`—` = o turno não exige aquele sinal. `inferência` é **indício**: ela é detectada por " +
      "marcador linguístico, e marcador não prova que a distinção foi feita — serve para " +
      "achar o turno que merece leitura, não para dar nota._",
  );
  p();

  p("## Trajetória de cada turno");
  p();
  for (const m of medidas) {
    p(`### ${m.turno}. ${m.pergunta}`);
    p();
    p(`_Por que este turno existe:_ ${m.porque}`);
    p();
    p(
      `Consultou: \`${m.consultas.join(" → ") || "nada"}\` · capacidades: ` +
        `${m.capacidades.join(", ") || "—"} · fontes: ${m.fontes} · citou: ` +
        `${m.citacoes.length > 0 ? m.citacoes.map((c) => `[${c}]`).join("") : "nenhuma"} · ` +
        `redigiu: ${m.redigiu} (${m.causa}) · ${m.ms} ms` +
        (m.tokens ? ` · ${m.tokens.toLocaleString("pt-BR")} tokens` : ""),
    );
    p();
    if (m.numerosRecusados.length > 0) {
      p(`> **A trava recusou:** ${m.numerosRecusados.join(", ")}`);
      p();
    }
    p("> " + m.texto.split("\n").join("\n> "));
    p();
  }

  const falhos = medidas.filter((m) =>
    Object.values(m.sinais).some((v) => v === false),
  );
  p("## Onde olhar primeiro");
  p();
  if (falhos.length === 0) {
    p("Nenhum sinal exigido falhou.");
  } else {
    for (const m of falhos) {
      const quais = Object.entries(m.sinais)
        .filter(([, v]) => v === false)
        .map(([k]) => k);
      p(`- **turno ${m.turno}** (${m.pergunta}): ${quais.join(", ")}`);
    }
    p();
    p(
      "A correção de um sinal falho quase nunca é uma frase no prompt. `encadeou` que " +
        "falha costuma ser descrição de ferramenta que não diz quando descer ao detalhe; " +
        "`citou` que falha é numeração que não chegou clara ao modelo; `continuou` que " +
        "falha é histórico curto demais.",
    );
  }
  p();

  writeFileSync(`${saida}.md`, l.join("\n"), "utf8");
  writeFileSync(
    `${saida}.json`,
    JSON.stringify({ caminho: agenteLigado() ? "AGENTE" : "PLANEJADOR", medidas }, null, 2),
    "utf8",
  );

  console.log(`\n${saida}.md · ${saida}.json`);
  console.log(`  ${falhos.length} turno(s) com sinal exigido falhando, de ${medidas.length}`);
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
