/**
 * A tabela de confronto da Fase 7 — gerada, nunca escrita à mão.
 *
 * Roda cada pergunta da bateria contra o banco real e imprime o que aconteceu:
 * qual fonte foi recuperada, qual ferramenta rodou, e o começo da resposta que
 * saiu. Uma tabela digitada à mão descreveria o que o autor lembrava do
 * assistente; esta descreve o assistente.
 *
 *   DATABASE_URL=... pnpm exec tsx src/__tests__/tabela.mts > ../../docs/EVALS.md
 */

import { createDb } from "@workspace/db";
import { orquestrar } from "../orquestrador.js";
import { responder } from "../resposta.js";
import { CASOS, CONVERSAS } from "./bateria.js";

const { db } = createDb(process.env.DATABASE_URL!);

function celula(texto: string, limite = 150): string {
  const limpo = texto.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

console.log("| # | Pergunta | Fonte recuperada | Query/ferramenta | Resposta esperada | Resposta IA | Correto? |");
console.log("| - | -------- | ---------------- | ---------------- | ----------------- | ----------- | -------- |");

let n = 0;
let certos = 0;

for (const caso of CASOS) {
  n += 1;
  const dossie = await orquestrar(db, caso.pergunta);
  const resposta = await responder(db, caso.pergunta, { semIa: true });

  const fontes =
    [
      ...dossie.trechos.map((t) => `${t.trecho.corpus}: ${t.trecho.titulo}`),
      ...dossie.evidencias.map((e) => `DADO: ${e.titulo}`),
    ]
      .slice(0, 3)
      .join("; ") || "—";

  const ferramentas = dossie.evidencias.map((e) => e.ferramenta).join(", ") || "—";

  const ok =
    dossie.plano.intencao === caso.intencao &&
    (!caso.ferramentas ||
      caso.ferramentas.some((f) => dossie.evidencias.some((e) => e.ferramenta === f))) &&
    (!caso.lacuna || dossie.lacunas.some((l) => l.tipo === caso.lacuna)) &&
    (!caso.semLacuna || dossie.lacunas.length === 0) &&
    (!caso.desambigua || Boolean(dossie.desambiguacao)) &&
    (!caso.semRecorte || dossie.evidencias.every((e) => !e.recorte?.vigencia));
  if (ok) certos += 1;

  console.log(
    `| ${n} | ${celula(caso.pergunta, 60)} | ${celula(fontes, 110)} | ${celula(ferramentas, 90)} | ` +
      `${celula(caso.esperado, 120)} | ${celula(resposta.texto, 170)} | ${ok ? "✅" : "❌"} |`,
  );
}

for (const conversa of CONVERSAS) {
  let estado = undefined as never;
  for (const passo of conversa.passos) {
    n += 1;
    const resposta: Awaited<ReturnType<typeof responder>> = await responder(db, passo.pergunta, {
      semIa: true,
      ...(estado ? { estado } : {}),
    });
    estado = resposta.estado as never;

    const ok =
      resposta.intencao === passo.intencao &&
      (!passo.herda || resposta.tecnico.herdado.length > 0) &&
      (!passo.recorte || passo.recorte.test(resposta.recorte ?? ""));
    if (ok) certos += 1;

    console.log(
      `| ${n} | ${celula(`↳ ${passo.pergunta}`, 60)} | ${celula(resposta.fontes.map((f) => `${f.tipo}: ${f.titulo}`).join("; "), 110) || "—"} | ` +
        `${celula(resposta.tecnico.ferramentas.join(", "), 90) || "—"} | ${celula(passo.esperado, 120)} | ` +
        `${celula(resposta.texto, 170)} | ${ok ? "✅" : "❌"} |`,
    );
  }
}

console.log(`\n**${certos}/${n} corretas.**`);
process.exit(0);
