/**
 * Três investigações difíceis, passo a passo, no nível operacional.
 *
 *     ASSISTANT_EVAL_DATABASE_URL=… pnpm --filter @workspace/assistant run tres
 *
 * **O que sai daqui.** Para cada pergunta: que consulta rodou, que resultado
 * relevante ela devolveu, **por que a próxima foi escolhida** — nomeando o valor
 * que não existia antes —, e a conclusão. Nada de raciocínio do modelo: cada
 * linha é o que aconteceu com os argumentos, lido do dossiê.
 */

import { createDb } from "@workspace/db";
import { orquestrar } from "../orquestrador";
import { avancarEstado, ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { explicarFoco } from "../foco";

const URL = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!URL) {
  console.error("defina ASSISTANT_EVAL_DATABASE_URL");
  process.exit(1);
}
const { db } = createDb(URL);

const CASOS: { titulo: string; turnos: string[] }[] = [
  {
    titulo: "Causa raiz de uma queda, do agregado à célula da planilha",
    turnos: ["Por que a remuneração caiu?"],
  },
  {
    titulo: "A investigação que continua — e não recomeça",
    turnos: ["O que mais impactou negativamente?", "O que mudou nesses veículos?", "De onde saiu esse valor?"],
  },
  {
    titulo: "A dúvida sobre a própria conclusão",
    turnos: ["Qual teve maior perda em agosto?", "Por quê?", "Tem certeza?"],
  },
];

for (const caso of CASOS) {
  console.log(`\n${"═".repeat(78)}\n${caso.titulo}\n${"═".repeat(78)}`);
  let estado: EstadoDaConversa = ESTADO_VAZIO;

  for (const pergunta of caso.turnos) {
    const d = await orquestrar(db, pergunta, { estado });
    estado = avancarEstado(estado, d);

    console.log(`\n▸ "${pergunta}"`);
    console.log(`  entendeu ......... ${d.plano.intencao} · plano [${d.plano.necessidades.join(", ")}]`);
    console.log(
      `  recorte .......... ${d.plano.contexto?.info.label ?? "(nenhum)"} · ${d.plano.periodo ?? "vigência corrente"} · origem ${d.plano.origemDoRecorte}`,
    );
    if (d.plano.herdado.length) console.log(`  herdou ........... ${d.plano.herdado.join(", ")}`);

    console.log(`  consultou:`);
    d.evidencias.forEach((e, i) => {
      const primeiro = e.fatos.find((f) => !f.interno);
      console.log(`    #${i + 1} ${e.ferramenta}`);
      if (primeiro) console.log(`        → ${primeiro.rotulo}: ${primeiro.valor}`);
    });

    if (d.encadeamentos.length > 0) {
      console.log(`  encadeou (${d.encadeamentos.filter((p) => p.derivaDe !== null).length} reação(ões)):`);
      d.encadeamentos.forEach((p, i) => {
        const de = p.derivaDe !== null ? ` ← passo ${p.derivaDe + 1}` : "";
        const valor = p.descoberto ? ` [${p.descoberto.campo}="${p.descoberto.valor}"]` : "";
        console.log(`    ${i + 1}. ${p.ferramenta}${de}${valor}`);
        console.log(`        porque: ${p.porque}`);
      });
    } else {
      console.log(`  encadeou ......... nada — esta pergunta se responde num nível só`);
    }

    console.log(`  foco ............. ${estado.foco ? explicarFoco(estado.foco) : "(nenhum)"}`);
    if (d.lacunas.length) {
      console.log(`  declarou falta ... ${d.lacunas.map((l) => l.tipo).join(", ")}`);
    }
  }
}
process.exit(0);
