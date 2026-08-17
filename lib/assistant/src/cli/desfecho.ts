/**
 * A bateria por desfecho, rodada de fora — o critério de virada de chave.
 *
 *     pnpm --filter @workspace/assistant run desfecho -- --saida=antes
 *     ASSISTENTE_AGENTE=1 pnpm --filter @workspace/assistant run desfecho -- --saida=depois
 *
 * **Duas rodadas, um diff.** O mesmo arquivo roda os dois caminhos porque as
 * asserções não sabem qual está rodando — elas falam de capacidade e de
 * propriedade do texto, nunca de nome de função. A decisão de virar a chave sai
 * da comparação entre os dois JSON, e não da leitura de nove respostas.
 *
 * **O que decide.** Três números, e nenhum deles é nota de qualidade: quantos
 * casos passaram, quantos defeitos conhecidos foram corrigidos, e quantas das
 * nove perguntas produziram respostas distintas. O agente pode virar padrão
 * quando não regride em nenhum caso que hoje passa **e** corrige defeitos
 * conhecidos. Regredir num que passa é bloqueio, por melhor que esteja o resto.
 */

import { writeFileSync } from "node:fs";
import { createDb } from "@workspace/db";
import { agenteLigado } from "../agente";
import { disponivel, modeloConfigurado } from "../llm";
import { responder, type Resposta } from "../resposta";
import { CASOS_DE_DESFECHO, capacidadesDe, conferirDesfecho } from "../aceitacao/desfecho";

async function principal() {
  const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
  const base = process.argv.slice(2).find((a) => a.startsWith("--saida="))?.slice(8) ?? "desfecho";

  if (!url) {
    console.error("Falta DATABASE_URL (ou ASSISTANT_EVAL_DATABASE_URL). Nada executado.");
    process.exit(1);
  }

  const { db } = createDb(url);
  const respostas = new Map<string, Resposta>();

  for (const caso of CASOS_DE_DESFECHO) {
    process.stdout.write(`  ${caso.id}\n`);
    respostas.set(caso.id, await responder(db, caso.pergunta, { diagnostico: true }));
  }

  const linhas = CASOS_DE_DESFECHO.map((caso) => {
    const r = respostas.get(caso.id)!;
    const falhas = conferirDesfecho(r, caso.espera, respostas);
    return {
      id: caso.id,
      pergunta: caso.pergunta,
      passou: falhas.length === 0,
      defeitoConhecido: caso.espera.defeitoConhecido ?? null,
      /*
        O desfecho em três estados, e não dois.

        `CORRIGIDO` é o que interessa numa migração: um caso que estava marcado
        como defeito conhecido e passou. Ele não é "verde" como os outros — é
        uma mudança de estado, e o arquivo de casos precisa ser atualizado.
      */
      estado: falhas.length === 0
        ? caso.espera.defeitoConhecido ? "CORRIGIDO" : "PASSOU"
        : caso.espera.defeitoConhecido ? "DEFEITO_CONHECIDO" : "REPROVOU",
      falhas: falhas.map((f) => `${f.regra}: ${f.detalhe}`),
      capacidades: [...capacidadesDe(r)].sort(),
      consultas: r.tecnico.ferramentas,
      redigiu: r.tecnico.motor.redigiu,
      causa: r.tecnico.motor.codigo,
      /*
        A mensagem, e não só o código.

        `causa: "ERRO"` em nove casos diz que algo quebrou e não diz o quê — e
        foi preciso um comando à mão, numa sessão à parte, para descobrir que
        era a API recusando toda chamada. O texto do erro custa uma linha aqui
        e economiza a investigação inteira.
      */
      erroDaIa: r.tecnico.ia?.erro ?? null,
      fatos: r.tecnico.contexto.fatos,
      itens: r.tecnico.contexto.itens.total,
      texto: r.texto,
    };
  });

  const distintas = new Set(linhas.map((l) => l.texto.trim())).size;
  const trajetorias = new Set(linhas.map((l) => l.consultas.slice().sort().join(","))).size;
  const resumo = {
    caminho: agenteLigado() ? "AGENTE" : "PLANEJADOR",
    modelo: modeloConfigurado(),
    ia: disponivel(),
    casos: linhas.length,
    passou: linhas.filter((l) => l.estado === "PASSOU").length,
    corrigido: linhas.filter((l) => l.estado === "CORRIGIDO").length,
    defeitoConhecido: linhas.filter((l) => l.estado === "DEFEITO_CONHECIDO").length,
    reprovou: linhas.filter((l) => l.estado === "REPROVOU").length,
    respostasDistintas: distintas,
    trajetoriasDistintas: trajetorias,
  };

  writeFileSync(`${base}.json`, JSON.stringify({ resumo, linhas }, null, 2), "utf8");

  const l: string[] = [];
  const p = (s = "") => l.push(s);
  p(`# Bateria por desfecho — caminho ${resumo.caminho}`);
  p();
  p(`- modelo: ${resumo.modelo ?? "**sem chave**"} · flag do agente: ${agenteLigado() ? "ligada" : "desligada"}`);
  p(
    `- **${resumo.passou} passou** · **${resumo.corrigido} corrigido** · ` +
      `${resumo.defeitoConhecido} defeito conhecido · **${resumo.reprovou} reprovou**`,
  );
  p(`- respostas distintas: **${distintas}/${linhas.length}** · trajetórias distintas: **${trajetorias}/${linhas.length}**`);
  p();
  p("| # | estado | capacidades | consultas | itens | fatos | falhas |");
  p("| --- | --- | --- | --- | ---: | ---: | --- |");
  for (const x of linhas) {
    p(
      `| ${x.id} | ${x.estado} | ${x.capacidades.join(", ") || "—"} | ` +
        `${x.consultas.join(", ") || "—"} | ${x.itens} | ${x.fatos} | ${x.falhas.join(" · ") || "—"} |`,
    );
  }
  p();
  if (resumo.corrigido > 0) {
    p(
      `> **${resumo.corrigido} defeito(s) conhecido(s) foram corrigidos nesta rodada.** ` +
        "Apague a linha `defeitoConhecido` desses casos em `aceitacao/desfecho.ts` — " +
        "senão a suíte continua exigindo que eles falhem.",
    );
    p();
  }
  if (resumo.reprovou > 0) {
    p(
      `> **${resumo.reprovou} caso(s) que deveriam passar reprovaram.** Isto é bloqueio de ` +
        "virada de chave: uma regressão num caso verde não se compensa com correção noutro.",
    );
    p();
  }
  writeFileSync(`${base}.md`, l.join("\n"), "utf8");

  console.log(`\n${base}.md · ${base}.json`);
  console.log(
    `  ${resumo.caminho}: ${resumo.passou} passou · ${resumo.corrigido} corrigido · ` +
      `${resumo.reprovou} reprovou · ${distintas}/${linhas.length} respostas distintas`,
  );
  process.exit(0);
}

principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
