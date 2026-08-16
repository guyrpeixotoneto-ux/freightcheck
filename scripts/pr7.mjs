#!/usr/bin/env node
/**
 * A rodada do PR 7, inteira, num comando.
 *
 *     DATABASE_URL=… ANTHROPIC_API_KEY=… node scripts/pr7.mjs
 *
 * **Por que um script e não sete comandos.** A sequência tem uma ordem que
 * importa e um passo que só faz sentido se o anterior passou: medir o
 * planejador, medir o agente, comparar, e — só se o portão aprovar — rodar a
 * exploratória. Executada à mão, a parte fácil de errar é rodar o `depois` sem
 * `ASSISTENTE_AGENTE=1` e comparar o planejador com ele mesmo, que produz um
 * relatório verossímil e sem valor. Aqui a variável é posta por processo, e a
 * comparação recusa duas rodadas do mesmo caminho.
 *
 * **Ele não vira a chave.** O último passo escreve o veredito e para. Ligar
 * `ASSISTENTE_AGENTE=1` em produção continua sendo um ato humano, feito depois
 * de ler o relatório — e é o único ato desta migração que muda o que o usuário
 * vê.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const PASTA = process.env.PR7_SAIDA ?? "relatorios-pr7";
const filtro = ["--filter", "@workspace/assistant"];

function conferirAmbiente() {
  const faltando = [];
  if (!process.env.DATABASE_URL && !process.env.ASSISTANT_EVAL_DATABASE_URL) {
    faltando.push(
      "DATABASE_URL — o banco com as planilhas importadas (o mesmo que a aplicação usa)",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    faltando.push(
      "ANTHROPIC_API_KEY — sem ela o agente não roda, e a comparação mede o " +
        "planejador contra ele mesmo",
    );
  }
  if (faltando.length === 0) return;

  console.error("\nEsta rodada não pode acontecer neste ambiente. Falta:\n");
  for (const f of faltando) console.error(`  · ${f}`);
  console.error(
    "\nA rodada precisa acontecer onde a chave já existe — no Replit, ela está nos\n" +
      "Secrets e é injetada no processo do servidor. Pelo Shell de lá, as variáveis\n" +
      "já estão no ambiente e este script roda direto.\n",
  );
  process.exit(1);
}

function passo(titulo, script, args, env = {}) {
  console.log(`\n\x1b[1m▸ ${titulo}\x1b[0m`);
  try {
    execFileSync("pnpm", [...filtro, "run", script, "--", ...args], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (erro) {
    return erro.status ?? 1;
  }
}

conferirAmbiente();
if (!existsSync(PASTA)) mkdirSync(PASTA, { recursive: true });

/*
  As duas medições. A segunda com a variável ligada **só para este processo
  filho** — o que garante que a primeira mediu o planejador de verdade, e não um
  ambiente já contaminado por uma tentativa anterior.
*/
passo("1/4 · baseline do planejador", "desfecho", [`--saida=${PASTA}/antes`], {
  ASSISTENTE_AGENTE: "",
});
passo("2/4 · rodada do agente", "desfecho", [`--saida=${PASTA}/depois`], {
  ASSISTENTE_AGENTE: "1",
});
passo("3/4 · trajetória do agente", "trajetoria", [`--saida=${PASTA}/trajetoria.md`], {
  ASSISTENTE_AGENTE: "1",
});

const veredito = passo("4/4 · o portão", "comparar", [
  `${PASTA}/antes.json`,
  `${PASTA}/depois.json`,
  `--saida=${PASTA}/comparacao.md`,
]);

/*
  A exploratória só roda se o portão aprovar, e a ordem é a razão.

  Ela mede como o agente conversa, e essa pergunta só faz sentido depois de "ele
  pode substituir o outro?". Rodá-la sobre um agente que regrediu produziria sete
  turnos de leitura agradável sobre algo que não vai entrar — e é assim que uma
  decisão ruim ganha material de apoio.
*/
if (veredito === 0) {
  passo("extra · bateria exploratória (uma conversa)", "exploratoria", [
    `--saida=${PASTA}/exploratoria`,
  ], { ASSISTENTE_AGENTE: "1" });
}

console.log(`\n\x1b[1mRelatórios em ${PASTA}/\x1b[0m`);
console.log("  antes.md · depois.md · trajetoria.md · comparacao.md" + (veredito === 0 ? " · exploratoria.md" : ""));
console.log(
  veredito === 0
    ? "\n\x1b[32mO portão aprovou.\x1b[0m Leia comparacao.md e exploratoria.md antes de ligar\n" +
        "ASSISTENTE_AGENTE=1 em produção. A virada é uma variável; a volta também.\n"
    : "\n\x1b[31mO portão reprovou.\x1b[0m comparacao.md nomeia cada regressão com a pergunta,\n" +
        "as falhas e as consultas que o agente fez. Não vire a chave.\n",
);
process.exit(veredito);
