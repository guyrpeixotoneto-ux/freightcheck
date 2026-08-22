/**
 * A medição do ciclo: o Assistente virou investigador, ou só ficou mais falante?
 *
 *     ASSISTANT_EVAL_DATABASE_URL=… pnpm --filter @workspace/assistant run investigacao
 *
 * **As duas baterias, e por que são duas.** As 78 perguntas do diagnóstico
 * medem **cobertura** — perguntas de todo tipo, e o que interessa ali é quantos
 * planos distintos elas produzem e qual é o maior aglomerado. As nove da bateria
 * funda medem **profundidade** — e ali o que interessa é encadeamento
 * verdadeiro, que é outra coisa e é medida por outra régua.
 *
 * **Encadeamento verdadeiro, e nunca "número de consultas".** Ver
 * `encadeamento.ts`: uma consulta só conta como encadeada quando um argumento
 * dela não existia antes de outra consulta voltar. Três consultas disparadas
 * juntas contam zero, por mais que somem três no total.
 *
 * **O que este relatório não faz.** Não roda o agente: sem `ANTHROPIC_API_KEY`
 * não há laço de tool use, e inventar a coluna dele seria exatamente a
 * maquiagem que este ciclo existe para não fazer. A coluna medida aqui é a do
 * planejador — que é o caminho em que **todo usuário está hoje**, com a flag
 * desligada.
 */

import { writeFileSync } from "node:fs";
import { createDb } from "@workspace/db";
import { orquestrar, type Dossie } from "../orquestrador";
import { avancarEstado, ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { assinaturaDeTrajetoria } from "../medicao";
import { CASOS_DO_DIAGNOSTICO, DIAGNOSTICO, INVESTIGACAO } from "../__tests__/perguntas-de-investigacao";

const URL = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!URL) {
  console.error("defina ASSISTANT_EVAL_DATABASE_URL (o banco com o export promovido)");
  process.exit(1);
}
const { db } = createDb(URL);

/** A trajetória de um dossiê: as capacidades exercidas, na ordem. */
const trajetoria = (d: Dossie) => d.evidencias.map((e) => e.ferramenta);
/** O plano: o conjunto de necessidades, como assinatura. */
const plano = (d: Dossie) => d.plano.necessidades.join("+");

interface LinhaDoDiagnostico {
  familia: string;
  pergunta: string;
  intencao: string;
  plano: string;
  trajetoria: string;
  consultas: number;
  encadeamentos: number;
  lacunas: string[];
}

const linhas: LinhaDoDiagnostico[] = [];
for (const [familia, perguntas] of Object.entries(DIAGNOSTICO)) {
  for (const pergunta of perguntas) {
    const d = await orquestrar(db, pergunta);
    linhas.push({
      familia,
      pergunta,
      intencao: d.plano.intencao,
      plano: plano(d),
      trajetoria: assinaturaDeTrajetoria(trajetoria(d)),
      consultas: d.evidencias.length,
      encadeamentos: d.encadeamentos.length,
      lacunas: d.lacunas.map((l) => l.tipo),
    });
  }
}

const planos = new Map<string, number>();
for (const l of linhas) planos.set(l.plano, (planos.get(l.plano) ?? 0) + 1);
const maiorCluster = [...planos.entries()].sort((a, b) => b[1] - a[1])[0]!;

/** A bateria funda, sequencial: cada pergunta continua a investigação anterior. */
interface LinhaDaInvestigacao {
  pergunta: string;
  minimo: number;
  encadeamentos: number;
  passos: string[];
  consultas: number;
  trajetoria: string;
  passou: boolean;
}

const fundas: LinhaDaInvestigacao[] = [];
let estado: EstadoDaConversa = ESTADO_VAZIO;
for (const caso of INVESTIGACAO) {
  const d = await orquestrar(db, caso.pergunta, { estado });
  estado = avancarEstado(estado, d);
  fundas.push({
    pergunta: caso.pergunta,
    minimo: caso.encadeamentosMinimos,
    encadeamentos: d.encadeamentos.length,
    passos: d.encadeamentos.map((p) => p.porque),
    consultas: d.evidencias.length,
    trajetoria: assinaturaDeTrajetoria(trajetoria(d)),
    passou: d.encadeamentos.length >= caso.encadeamentosMinimos,
  });
}

const relatorio = {
  em: new Date().toISOString(),
  diagnostico: {
    perguntas: linhas.length,
    planosDistintos: planos.size,
    maiorCluster: { plano: maiorCluster[0], perguntas: maiorCluster[1] },
    trajetoriasDistintas: new Set(linhas.map((l) => l.trajetoria)).size,
    consultasMedias: Number(
      (linhas.reduce((s, l) => s + l.consultas, 0) / linhas.length).toFixed(2),
    ),
    semConsulta: linhas.filter((l) => l.consultas === 0).length,
    comLacuna: linhas.filter((l) => l.lacunas.length > 0).length,
    linhas,
  },
  investigacao: {
    casos: fundas.length,
    comEncadeamentoSuficiente: fundas.filter((f) => f.passou).length,
    trajetoriasDistintas: new Set(fundas.map((f) => f.trajetoria)).size,
    encadeamentosMedios: Number(
      (fundas.reduce((s, f) => s + f.encadeamentos, 0) / fundas.length).toFixed(2),
    ),
    consultasMedias: Number(
      (fundas.reduce((s, f) => s + f.consultas, 0) / fundas.length).toFixed(2),
    ),
    linhas: fundas,
  },
};

const destino = process.argv[2] ?? "relatorio-investigacao.json";
writeFileSync(destino, JSON.stringify(relatorio, null, 1));

console.log(`\n── DIAGNÓSTICO (${linhas.length} perguntas) ─────────────────────────`);
console.log(`planos distintos ............ ${relatorio.diagnostico.planosDistintos}`);
console.log(
  `maior cluster ............... ${maiorCluster[1]} perguntas no plano "${maiorCluster[0]}"`,
);
console.log(`trajetórias distintas ....... ${relatorio.diagnostico.trajetoriasDistintas}`);
console.log(`consultas médias ............ ${relatorio.diagnostico.consultasMedias}`);
console.log(`sem consulta nenhuma ........ ${relatorio.diagnostico.semConsulta}`);

console.log(`\n── INVESTIGAÇÃO FUNDA (${fundas.length} casos) ────────────────────`);
console.log(
  `com encadeamento suficiente . ${relatorio.investigacao.comEncadeamentoSuficiente}/${fundas.length}`,
);
console.log(`trajetórias distintas ....... ${relatorio.investigacao.trajetoriasDistintas}`);
console.log(`encadeamentos médios ........ ${relatorio.investigacao.encadeamentosMedios}`);
for (const f of fundas) {
  console.log(
    `  ${f.passou ? "✓" : "✗"} ${f.encadeamentos}/${f.minimo} · ${f.pergunta}\n      ${f.trajetoria || "(nenhuma consulta)"}`,
  );
}
console.log(`\nrelatório: ${destino}`);
process.exit(0);
