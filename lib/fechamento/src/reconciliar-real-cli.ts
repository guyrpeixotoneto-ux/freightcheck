/**
 * O GATE PONTA A PONTA — os relatórios de verdade contra o `RESUMO GERAL`.
 *
 * `reconciliar-planilha-cli.ts` responde *dadas as entradas da própria `.xlsb`,
 * o motor chega ao mesmo resultado?* — equivalência de fórmula. Este responde a
 * outra pergunta, que é a que decide a substituição da planilha:
 *
 *   **importando os relatórios e digitando o cadastro, o sistema chega sozinho
 *   ao `RESUMO GERAL`?**
 *
 * A `.xlsb` entra por uma porta só: a coluna de **referência**. Nenhum número
 * dela alimenta cálculo — os parâmetros vêm do cadastro, as viagens do 2Art, as
 * bases do 03.08.20, do 03.08.18 e do 03.08.12.09. O que a amostra fornece é o
 * gabarito contra o qual medir, e é por isso que a matriz sai com a coluna
 * `referência XLSB` ao lado da `sistema`, e não no lugar dela.
 *
 * Uso:
 *
 * ```
 * pnpm --filter @workspace/fechamento exec tsx ./src/reconciliar-real-cli.ts \
 *   --ano 2026 --mes 7 --canal ROTA \
 *   --gabarito ./src/__tests__/amostras/julho-2026.json \
 *   --q1 2art=caminho/2art-1q.xlsx,pagamento=caminho/03.08.20-1q.txt,... \
 *   --q2 2art=caminho/2art-2q.xlsx,...
 * ```
 *
 * Cada `--qN` recebe pares `fonte=caminho` separados por vírgula. As fontes:
 * `2art`, `pagamento` (03.08.20), `disponibilidade` (03.08.18), `requisicoes`
 * (03.08.12.09), `ctes` (03.08.15) e `conciliacao` (03.02.59.02).
 */
import { readFileSync } from "node:fs";

import type { Canal } from "./dominio";
import { montarMatriz, type LinhaDaMatriz, type MatrizDaReconciliacao } from "./matriz";
import { montarProvaPontaAPonta, type RelatoriosDaQuinzena } from "./prova-ponta-a-ponta";
import { interpretarAmostra } from "./reconciliacao";

/* ---------------------------------------------------------------------------
   O vocabulário de status do gate
   ------------------------------------------------------------------------ */

/**
 * O veredito de uma linha, no vocabulário de quem decide.
 *
 * É uma tradução de `StatusDaLinha`, e não um segundo julgamento: a matriz já
 * classifica, e reclassificar aqui abriria espaço para os dois discordarem.
 * O que esta camada acrescenta é a distinção que o gate precisa fazer na saída
 * — **de quem é a divergência** —, que é a pergunta que decide se alguém mexe
 * no código ou abre a planilha.
 */
export type StatusDoGate =
  /** O sistema chega ao número da planilha nas três colunas. */
  | "OK"
  /** Os números diferem, e a causa é um defeito da `.xlsb` já rastreado. */
  | "DIVERGENCIA DA PLANILHA COMPROVADA"
  /** Falta um relatório ou o cadastro — a linha não tem como existir ainda. */
  | "DADO AUSENTE"
  /** A planilha não escreve número aqui, ou a regra ainda não foi decidida. */
  | "REGRA A DEFINIR"
  /** Diferem e a causa não é da planilha. É defeito nosso, e trava o gate. */
  | "ERRO DO SISTEMA";

const TRADUCAO: Record<string, StatusDoGate> = {
  REPRODUZIDA: "OK",
  DIVERGENCIA_JUSTIFICADA_PLANILHA: "DIVERGENCIA DA PLANILHA COMPROVADA",
  DIVERGENCIA_DO_MOTOR: "ERRO DO SISTEMA",
  FONTE_NAO_DISPONIVEL: "DADO AUSENTE",
  NAO_SE_APLICA: "REGRA A DEFINIR",
};

export function statusDoGate(l: LinhaDaMatriz): StatusDoGate {
  return TRADUCAO[l.status] ?? "ERRO DO SISTEMA";
}

/* ---------------------------------------------------------------------------
   A matriz em texto
   ------------------------------------------------------------------------ */

const brl = (n: number | null) =>
  n === null
    ? "—"
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A coluna de uma linha, na quinzena pedida ou no total do mês. */
type Coluna = "primeira" | "segunda" | "total";

/**
 * A matriz como a mesa a lê: uma linha por linha do resumo, com o veredito.
 *
 * Sai em texto e não em tabela de terminal porque o destino dela é um documento
 * ou um comentário — e uma tabela que só existe no terminal não sobrevive à
 * conversa em que ela seria usada.
 */
export function matrizEmTexto(m: MatrizDaReconciliacao, coluna: Coluna = "total"): string {
  const linhas: string[] = [];
  const cab = ["Linha", "Origem", "Sistema", "Referência XLSB", "Diferença", "Status"];
  const larg = [42, 7, 16, 16, 14, 36];
  const risca = (v: string, i: number, dir = false) =>
    dir ? v.padStart(larg[i]!) : v.padEnd(larg[i]!);

  linhas.push(cab.map((c, i) => risca(c, i, i >= 2 && i <= 4)).join(" | "));
  linhas.push(larg.map((n) => "-".repeat(n)).join("-+-"));

  for (const l of m.linhas) {
    const s = statusDoGate(l);
    linhas.push(
      [
        risca(`${l.linhaNaPlanilha} ${l.rotulo}`.slice(0, larg[0]), 0),
        risca(l.origem, 1),
        risca(brl(l.sistema[coluna]), 2, true),
        risca(brl(l.planilha[coluna]), 3, true),
        risca(brl(l.diferenca[coluna]), 4, true),
        risca(s, 5),
      ].join(" | "),
    );
  }
  return linhas.join("\n");
}

/** O placar do gate, no vocabulário dele. */
export function placarDoGate(m: MatrizDaReconciliacao): Record<StatusDoGate, number> {
  const placar: Record<StatusDoGate, number> = {
    OK: 0,
    "DIVERGENCIA DA PLANILHA COMPROVADA": 0,
    "DADO AUSENTE": 0,
    "REGRA A DEFINIR": 0,
    "ERRO DO SISTEMA": 0,
  };
  for (const l of m.linhas) placar[statusDoGate(l)] += 1;
  return placar;
}

/* ---------------------------------------------------------------------------
   A montagem a partir dos arquivos
   ------------------------------------------------------------------------ */

const FONTES = {
  "2art": "operacao",
  pagamento: "pagamento",
  disponibilidade: "disponibilidade",
  requisicoes: "requisicoes",
  ctes: "ctes",
  conciliacao: "conciliacao",
} as const;

/** `2art=caminho,pagamento=caminho` → os bytes de cada fonte. */
export function relatoriosDeArgumento(
  quinzena: 1 | 2,
  spec: string | undefined,
): RelatoriosDaQuinzena {
  const out: RelatoriosDaQuinzena = { quinzena };
  if (!spec) return out;
  for (const par of spec.split(",")) {
    const [nome, ...resto] = par.split("=");
    const caminho = resto.join("=").trim();
    const chave = FONTES[(nome ?? "").trim() as keyof typeof FONTES];
    if (!chave) {
      throw new Error(
        `Fonte desconhecida "${nome}". As que existem: ${Object.keys(FONTES).join(", ")}.`,
      );
    }
    if (!caminho) throw new Error(`A fonte "${nome}" veio sem caminho.`);
    (out as unknown as Record<string, unknown>)[chave] = readFileSync(caminho);
  }
  return out;
}

/**
 * Roda o gate: relatórios + cadastro contra o gabarito.
 *
 * O cadastro sai do próprio gabarito **de propósito e provisoriamente**: é a
 * mesma aba `Cadastro` que a unidade digitaria, e enquanto o módulo de cadastro
 * não expõe uma leitura por competência é a única forma de rodar isto sem
 * banco. `procedencia.parametros` continua dizendo `CADASTRO_DO_SISTEMA`, e a
 * matriz continua reportando o que ainda vem do gabarito — não há como esta
 * escolha se disfarçar de prova ponta a ponta completa.
 */
export function rodarGate(entrada: {
  ano: number;
  mes: number;
  canal: Canal;
  caminhoDoGabarito: string;
  relatorios: RelatoriosDaQuinzena[];
}): MatrizDaReconciliacao {
  const gabarito = interpretarAmostra(
    JSON.parse(readFileSync(entrada.caminhoDoGabarito, "utf8")),
  );
  const quinzenas = montarProvaPontaAPonta({
    ano: entrada.ano,
    mes: entrada.mes,
    canal: entrada.canal,
    cadastro: gabarito.quinzenas.map((q) => ({
      quinzena: q.quinzena,
      parametros: q.parametros,
      custoVariavelPrevistoPor25Viagens: q.custoVariavelPrevistoPor25Viagens,
    })),
    relatorios: entrada.relatorios,
    gabarito: gabarito.quinzenas,
  });
  return montarMatriz({ ...gabarito, quinzenas }, "REGRA_CANONICA");
}

/* ---------------------------------------------------------------------------
   A linha de comando
   ------------------------------------------------------------------------ */

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function principal(): void {
  const gabaritoPath = argumento("gabarito");
  if (!gabaritoPath) {
    console.error("Uso: --gabarito <amostra.json> [--ano N --mes N --canal ROTA] --q1 ... --q2 ...");
    process.exitCode = 2;
    return;
  }

  const matriz = rodarGate({
    ano: Number(argumento("ano") ?? 2026),
    mes: Number(argumento("mes") ?? 7),
    canal: (argumento("canal") ?? "ROTA") as Canal,
    caminhoDoGabarito: gabaritoPath,
    relatorios: [
      relatoriosDeArgumento(1, argumento("q1")),
      relatoriosDeArgumento(2, argumento("q2")),
    ],
  });

  const coluna = (argumento("coluna") ?? "total") as Coluna;
  console.log(`\n${matriz.competencia} — coluna: ${coluna}\n`);
  console.log(matrizEmTexto(matriz, coluna));

  const placar = placarDoGate(matriz);
  console.log("\nPlacar:");
  for (const [k, v] of Object.entries(placar)) console.log(`  ${String(v).padStart(3)}  ${k}`);

  if (!matriz.insumos.pontaAPonta) {
    console.log("\nInsumos que ainda saem do gabarito:");
    for (const q of matriz.insumos.doGabarito) {
      console.log(`  ${q.quinzena}ª quinzena: ${q.itens.join("; ")}`);
    }
  }

  /*
    Só `ERRO DO SISTEMA` derruba o gate. Divergência comprovada da planilha é
    achado, dado ausente é trabalho de quem importa, e regra a definir é decisão
    de domínio — nenhum dos três é defeito de código, e tratar os quatro como o
    mesmo vermelho faria o gate parar de significar alguma coisa.
  */
  if (placar["ERRO DO SISTEMA"] > 0) {
    console.error(`\n${placar["ERRO DO SISTEMA"]} linha(s) com ERRO DO SISTEMA.`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("reconciliar-real-cli.ts")) principal();
