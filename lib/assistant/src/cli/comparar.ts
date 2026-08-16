/**
 * O portão da virada de chave — o critério, aplicado por máquina.
 *
 *     pnpm --filter @workspace/assistant run desfecho -- --saida=antes
 *     ASSISTENTE_AGENTE=1 pnpm --filter @workspace/assistant run desfecho -- --saida=depois
 *     pnpm --filter @workspace/assistant run comparar -- antes.json depois.json
 *
 * **Por que isto não é um diff.** Dois JSON lado a lado mostram tudo o que
 * mudou, e quase nada do que mudou importa: o texto muda em toda rodada de um
 * modelo, a latência muda, a ordem das consultas muda. O que decide são três
 * transições, e só elas:
 *
 *   PASSOU → REPROVOU          regressão. Bloqueia, sozinha.
 *   DEFEITO_CONHECIDO → PASSOU correção. É o que justifica a virada.
 *   REPROVOU → PASSOU          correção de algo que nem estava catalogado.
 *
 * **A assimetria é deliberada.** Uma regressão bloqueia por si; nenhuma
 * quantidade de correção a compensa. É a mesma regra que o resto deste produto
 * aplica a número sem lastro: o custo de exibir uma resposta pior do que a de
 * ontem não se paga com duas respostas melhores em outras perguntas, porque
 * quem faz a pergunta que regrediu não vê as outras duas.
 *
 * **Sai com código 1 quando reprova**, para poder ser o último passo de um
 * script de promoção sem que ninguém precise ler a saída.
 */

import { readFileSync, writeFileSync } from "node:fs";

interface Linha {
  id: string;
  pergunta: string;
  estado: "PASSOU" | "CORRIGIDO" | "DEFEITO_CONHECIDO" | "REPROVOU";
  capacidades: string[];
  consultas: string[];
  falhas: string[];
  redigiu: string;
  causa: string;
  texto: string;
}

interface Rodada {
  resumo: {
    caminho: string;
    modelo: string | null;
    ia: boolean;
    respostasDistintas: number;
    trajetoriasDistintas: number;
    casos: number;
  };
  linhas: Linha[];
}

function ler(caminho: string): Rodada {
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as Rodada;
  } catch (erro) {
    console.error(`Não consegui ler ${caminho}: ${erro instanceof Error ? erro.message : erro}`);
    process.exit(2);
  }
}

const [arqAntes, arqDepois, ...resto] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const saida = process.argv.slice(2).find((a) => a.startsWith("--saida="))?.slice(8) ?? "comparacao.md";

if (!arqAntes || !arqDepois || resto.length > 0) {
  console.error("uso: comparar <antes.json> <depois.json> [--saida=comparacao.md]");
  process.exit(2);
}

const antes = ler(arqAntes);
const depois = ler(arqDepois);

const porId = new Map(antes.linhas.map((l) => [l.id, l]));
const regressoes: { linha: Linha; de: string }[] = [];
const correcoes: { linha: Linha; de: string }[] = [];
const iguais: Linha[] = [];
const novos: Linha[] = [];

for (const d of depois.linhas) {
  const a = porId.get(d.id);
  if (!a) {
    novos.push(d);
    continue;
  }
  const passouAntes = a.estado === "PASSOU" || a.estado === "CORRIGIDO";
  const passouDepois = d.estado === "PASSOU" || d.estado === "CORRIGIDO";

  if (passouAntes && !passouDepois) regressoes.push({ linha: d, de: a.estado });
  else if (!passouAntes && passouDepois) correcoes.push({ linha: d, de: a.estado });
  else iguais.push(d);
}

const sumidos = antes.linhas.filter((a) => !depois.linhas.some((d) => d.id === a.id));

/*
  Um caso que sumiu conta como regressão.

  Não é preciosismo: a forma mais fácil de uma migração parecer boa é o caso
  difícil deixar de ser executado — por erro que derrubou a rodada, por marcador
  que não resolveu, por alguém tê-lo apagado. Um conjunto que encolheu não é
  comparável com o anterior, e tratá-lo como "sem regressão" seria deixar o
  portão passar exatamente o que ele existe para pegar.
*/
const aprovado = regressoes.length === 0 && sumidos.length === 0 && correcoes.length > 0;

const l: string[] = [];
const p = (s = "") => l.push(s);

p("# Virada de chave — o critério aplicado");
p();
p(`- **antes**: ${antes.resumo.caminho} · ${antes.resumo.modelo ?? "sem modelo"} · ${antes.linhas.length} casos`);
p(`- **depois**: ${depois.resumo.caminho} · ${depois.resumo.modelo ?? "sem modelo"} · ${depois.linhas.length} casos`);
p();

if (antes.resumo.caminho === depois.resumo.caminho) {
  p(
    `> **Atenção: as duas rodadas são do mesmo caminho (${antes.resumo.caminho}).** ` +
      "Isto compara ruído, não arquitetura. Rode a segunda com `ASSISTENTE_AGENTE=1`.",
  );
  p();
}
if (!depois.resumo.ia) {
  p(
    "> **A rodada `depois` não teve modelo.** O agente escolhe ferramentas pelo modelo; " +
      "sem chave ele não roda, e o que está sendo comparado é o caminho determinístico " +
      "com ele mesmo. Esta comparação não decide nada.",
  );
  p();
}

p("## Veredito");
p();
p(aprovado ? "**PODE VIRAR.**" : "**NÃO PODE VIRAR.**");
p();
p(`- regressões: **${regressoes.length}** (qualquer uma bloqueia)`);
p(`- correções: **${correcoes.length}**`);
p(`- casos que sumiram: **${sumidos.length}** (contam como regressão)`);
p(`- sem mudança de estado: ${iguais.length}`);
p(
  `- respostas distintas: ${antes.resumo.respostasDistintas} → **${depois.resumo.respostasDistintas}** ` +
    `· trajetórias distintas: ${antes.resumo.trajetoriasDistintas} → **${depois.resumo.trajetoriasDistintas}**`,
);
p();

if (regressoes.length > 0) {
  p("## Regressões — o que bloqueia");
  p();
  for (const { linha, de } of regressoes) {
    p(`### ${linha.id} — era \`${de}\`, virou \`${linha.estado}\``);
    p();
    p(`_${linha.pergunta}_`);
    p();
    for (const f of linha.falhas) p(`- ${f}`);
    p();
    p(`Consultou: \`${linha.consultas.join(", ") || "nada"}\` · redigiu: ${linha.redigiu} (${linha.causa})`);
    p();
  }
}

if (correcoes.length > 0) {
  p("## Correções");
  p();
  p("| # | era | virou | pergunta | consultas agora |");
  p("| --- | --- | --- | --- | --- |");
  for (const { linha, de } of correcoes) {
    p(`| ${linha.id} | ${de} | ${linha.estado} | ${linha.pergunta} | \`${linha.consultas.join(", ")}\` |`);
  }
  p();
  const catalogados = correcoes.filter((c) => c.de === "DEFEITO_CONHECIDO");
  if (catalogados.length > 0) {
    p(
      `> **${catalogados.length} defeito(s) conhecido(s) foram corrigidos.** Apague a linha ` +
        "`defeitoConhecido` desses casos em `aceitacao/desfecho.ts` na mesma mudança que " +
        "virar a chave — senão a suíte passa a exigir que eles voltem a falhar.",
    );
    p();
  }
}

if (sumidos.length > 0) {
  p("## Casos que sumiram");
  p();
  for (const s of sumidos) p(`- \`${s.id}\` — ${s.pergunta}`);
  p();
}

if (aprovado) {
  p("---");
  p();
  p(
    "Nenhuma regressão e há correção: o agente pode virar padrão. A virada é uma " +
      "variável de ambiente, e a volta também — `ASSISTENTE_AGENTE` desligada devolve o " +
      "caminho anterior sem migração, sem perda de conversa e sem deploy.",
  );
} else if (correcoes.length === 0 && regressoes.length === 0) {
  p("---");
  p();
  p(
    "Sem regressão e sem correção: nada mudou de estado. Ou o agente não rodou, ou ele " +
      "está fazendo o mesmo que o planejador — e nesse caso não há razão para virar.",
  );
}

writeFileSync(saida, l.join("\n"), "utf8");
console.log(`\n${saida}`);
console.log(
  `  ${aprovado ? "PODE VIRAR" : "NÃO PODE VIRAR"} · ${regressoes.length} regressão(ões) · ` +
    `${correcoes.length} correção(ões) · ${sumidos.length} sumido(s)`,
);
process.exit(aprovado ? 0 : 1);
