import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb } from "@workspace/db";
import { disponivel as iaDisponivel, MODELO } from "../llm";
import { resumoDaIa, eventosRecentes } from "../observabilidade";
import { EIXOS, placarDe, rodarAvaliacao, type Medida, type Placar } from "../avaliacao/harness";

/**
 * O comando que mede os dois cérebros e escreve o comparativo.
 *
 *     ASSISTANT_EVAL_DATABASE_URL=… pnpm --filter @workspace/assistant avaliacao
 *
 * Opções: `--eixos=ranking,placa` para um recorte, `--saida=caminho.md`.
 *
 * **Ele diz alto quando não pôde medir.** Sem `ANTHROPIC_API_KEY` o produto cai
 * na redação determinística e o agente não chega a existir — o relatório
 * carimba isso no topo e marca as métricas dependentes de modelo como não
 * medidas, em vez de publicá-las como zero. Um zero que na verdade é ausência de
 * medição é a forma mais cara de um relatório mentir.
 */

const argumentos = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k!, v.join("=")] as const;
  }),
);

const URL_DO_BANCO = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
if (!URL_DO_BANCO) {
  console.error(
    "Defina ASSISTANT_EVAL_DATABASE_URL. Este harness mede contra o banco real: " +
      "medir contra mock diria se o código roda, e não se o produto responde.",
  );
  process.exit(1);
}

function pct(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(0)}%`;
}

function num(x: number | null, casas = 1): string {
  return x === null ? "—" : x.toFixed(casas);
}

function tabelaPorEixo(a: Placar, b: Placar): string {
  const linhas = EIXOS.filter((e) => a.porEixo[e] || b.porEixo[e]).map((e) => {
    const pa = a.porEixo[e];
    const pb = b.porEixo[e];
    const fmt = (p?: { total: number; passou: number }) =>
      p ? `${p.passou}/${p.total}` : "—";
    return `| ${e} | ${fmt(pa)} | ${fmt(pb)} |`;
  });
  return ["| eixo | planejador | agente |", "| --- | ---: | ---: |", ...linhas].join("\n");
}

function falhas(medidas: Medida[], quantas = 12): string {
  const ruins = medidas.filter((m) => !m.passou).slice(0, quantas);
  if (ruins.length === 0) return "_Nenhuma._";
  return ruins
    .map((m) => `- **${m.id}** (${m.eixo}) — "${m.pergunta}"\n  - ${m.porque.join("\n  - ")}`)
    .join("\n");
}

async function main(): Promise<void> {
  const { db } = createDb(URL_DO_BANCO!);
  const eixos = argumentos.get("eixos")?.split(",").filter(Boolean) as
    | (typeof EIXOS)[number][]
    | undefined;

  /*
    A placa vem do banco, e não da linha de comando. Uma placa escrita à mão
    mede o ambiente de quem escreveu o caso: passa no banco de quem a tem e
    falha, sem defeito nenhum, no de quem não tem.
  */
  const placa = await db
    .execute<{ placa: string }>(
      sql`SELECT identifier_value AS placa FROM entity_identifier WHERE is_current LIMIT 1`,
    )
    .then((r) => r.rows[0]?.placa)
    .catch(() => undefined);

  const comChave = iaDisponivel();
  console.error(
    comChave
      ? `Medindo com modelo: ${MODELO}.`
      : "SEM ANTHROPIC_API_KEY — o agente não existe nesta execução e o relatório vai dizer isso.",
  );

  const { planejador, agente, casos } = await rodarAvaliacao(db, {
    ...(placa ? { placa } : {}),
    ...(eixos?.length ? { eixos } : {}),
  });

  const pa = placarDe(planejador);
  const pb = placarDe(agente);
  const uso = resumoDaIa();

  const aviso = comChave
    ? ""
    : [
        "> **MEDIÇÃO PARCIAL — sem `ANTHROPIC_API_KEY`.**",
        ">",
        "> O produto caiu na redação determinística e o laço do agente não chegou a",
        "> rodar (`investigar` devolve `SEM_CHAVE` na primeira rodada). O que está",
        "> medido aqui é o **pipeline**: intenção, lastro, ferramenta, lacuna,",
        "> latência de orquestração. O que **não** está medido, e não deve ser lido",
        "> como zero: precisão factual do texto, seleção de ferramenta pelo modelo,",
        "> argumentos que ele mandaria, encadeamento real, tokens, custo, e",
        "> resistência a injeção — todas dependem do modelo no caminho.",
        "",
      ].join("\n");

  const relatorio = `# Avaliação — planejador × agente

Banco: \`${URL_DO_BANCO!.replace(/:[^:@]*@/, ":***@")}\`
Modelo configurado: \`${MODELO}\` · IA disponível: **${comChave ? "sim" : "não"}**
Casos: ${casos.length} · Placa resolvida: \`${placa ?? "(nenhuma no banco)"}\`

${aviso}
## Placar

| | planejador | agente |
| --- | ---: | ---: |
| casos que passaram | **${pa.passou}/${pa.total}** | **${pb.passou}/${pb.total}** |
| determinísticos | ${pa.porNatureza.DETERMINISTICO.passou}/${pa.porNatureza.DETERMINISTICO.total} | ${pb.porNatureza.DETERMINISTICO.passou}/${pb.porNatureza.DETERMINISTICO.total} |
| exigem raciocínio | ${pa.porNatureza.RACIOCINIO.passou}/${pa.porNatureza.RACIOCINIO.total} | ${pb.porNatureza.RACIOCINIO.passou}/${pb.porNatureza.RACIOCINIO.total} |

**A leitura que importa** é a separação acima: num caso de raciocínio o
planejador não pode acertar por construção — ele fecha a trajetória antes de ver
qualquer resultado. Se o agente não vencer ali, ele não tem por que existir; se
ele perder nos determinísticos, ele custa mais do que entrega.

## Taxas

| | planejador | agente |
| --- | ---: | ---: |
| intenção resolvida | ${pct(pa.taxas.intencaoResolvida)} | ${pct(pb.taxas.intencaoResolvida)} |
| resposta com lastro | ${pct(pa.taxas.comLastro)} | ${pct(pb.taxas.comLastro)} |
| sem número podado pela trava | ${pct(pa.taxas.semNumeroPodado)} | ${pct(pb.taxas.semNumeroPodado)} |
| ferramenta esperada rodou | ${pct(pa.taxas.ferramentaCerta)} | ${pct(pb.taxas.ferramentaCerta)} |
| respostas escritas pelo modelo | ${pa.redigidasPorIa}/${pa.total} | ${pb.redigidasPorIa}/${pb.total} |

## Por eixo

${tabelaPorEixo(pa, pb)}

## Laço do agente

| | |
| --- | ---: |
| rodadas por pergunta (média) | ${num(pb.agente.rodadasMedia)} |
| consultas por pergunta (média) | ${num(pb.agente.consultasMedia)} |
| encadeamentos reais (média) | ${num(pb.agente.encadeamentoMedio)} |
| consultas repetidas (sinal de laço) | ${pb.agente.consultasRepetidas} |
| pararam por teto | ${pb.agente.pararamPorTeto} |
| erros de execução | ${pb.agente.erros} |

## Latência de orquestração

| | planejador | agente |
| --- | ---: | ---: |
| p50 | ${pa.latencia.p50} ms | ${pb.latencia.p50} ms |
| p95 | ${pa.latencia.p95} ms | ${pb.latencia.p95} ms |
| máx | ${pa.latencia.max} ms | ${pb.latencia.max} ms |

## Custo, no anel de observabilidade

${
  uso.total === 0
    ? "_Nenhuma chamada ao modelo nesta execução._"
    : `${uso.total} chamada(s) · ${uso.tokens} tokens · US$ ${uso.custoUsd.toFixed(4)} · latência média ${uso.latenciaMediaMs} ms · descartadas ${uso.descartadas} · podadas ${uso.podadas} · erros ${uso.erros}`
}

## Falhas — planejador

${falhas(planejador)}

## Falhas — agente

${falhas(agente)}
`;

  const saida = argumentos.get("saida") ?? "avaliacao.md";
  writeFileSync(saida, relatorio);
  writeFileSync(
    saida.replace(/\.md$/, ".json"),
    JSON.stringify({ modelo: MODELO, comChave, planejador, agente, placares: { pa, pb }, uso, eventos: eventosRecentes(200) }, null, 2),
  );
  console.error(`Escrito: ${saida} e ${saida.replace(/\.md$/, ".json")}`);
  console.log(relatorio);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
