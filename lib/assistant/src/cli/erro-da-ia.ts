/**
 * A mensagem que a API devolveu, nos dois caminhos — sem servidor e sem sessão.
 *
 *     pnpm --filter @workspace/assistant run erro-da-ia
 *
 * Existe porque `causa: "ERRO"` diz que algo quebrou e não diz o quê, e
 * descobrir o quê custou uma troca de mensagens inteira com o relatório na mão.
 * Ele roda os dois caminhos na mesma chamada de propósito: a pergunta que
 * decide não é "o agente falhou?", é "só o agente falhou?".
 */
import { createDb } from "@workspace/db";
import { responder } from "../resposta";

async function principal() {
  const url = process.env.DATABASE_URL ?? process.env.ASSISTANT_EVAL_DATABASE_URL;
  if (!url) {
    console.error("Falta DATABASE_URL.");
    process.exit(1);
  }

  const { db } = createDb(url);
  for (const agente of [false, true]) {
    const r = await responder(db, "o que mudou?", { diagnostico: true, agente });
    console.log(`\n=== ${agente ? "AGENTE" : "PLANEJADOR"} ===`);
    console.log("causa   :", r.tecnico.motor.codigo);
    console.log("modelo  :", r.tecnico.ia?.modelo ?? "—");
    console.log("consultas:", r.tecnico.ferramentas.join(", ") || "nenhuma");
    console.log("erro    :", r.tecnico.ia?.erro ?? "(nenhum)");
  }
  process.exit(0);
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
