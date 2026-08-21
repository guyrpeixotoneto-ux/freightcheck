import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

import { lerCadastro } from "./leitores/cadastro";
import {
  compararModos,
  reconciliar,
  type DiaDaPlanilha,
  type FechamentoDaPlanilha,
  type ComparacaoDeModos,
  type ModoDaProva,
  type QuinzenaDaPlanilha,
  type Reconciliacao,
  type ViagemAgrupada,
} from "./reconciliacao";

/**
 * A prova, rodada contra a `.xlsb` de verdade.
 *
 * ```
 * pnpm --filter @workspace/fechamento exec tsx ./src/reconciliar-planilha-cli.ts <planilha.xlsb> [--amostra destino.json]
 * ```
 *
 * Faz duas coisas, e as duas importam. Imprime a reconciliação linha a linha
 * nos dois modos — a regra proposta e a reprodução da planilha — e, com
 * `--amostra`, extrai o fechamento inteiro para um JSON que o teste de
 * regressão consome. A amostra é fiel por construção: sai deste mesmo leitor, e
 * quem quiser refazê-la roda o comando de novo.
 *
 * **Por que a extração mora aqui.** O `.xlsb` tem 3 MB e 44 abas, e versioná-lo
 * poria um binário no repositório para o teste ler dois por cento dele. A
 * amostra guarda o que a conta usa — parâmetros, viagens agrupadas, bases e os
 * números que o resumo imprime — e nada mais.
 */

const ABA_RESUMO = "Resumo Geral";
const ABA_MAPA = "Mapa Rota";
const ABA_OUTROS = "Outros Custos";

/** A última coluna de dia de cada quinzena — onde as bases acumulam. */
const ULTIMO_DIA = { 1: "R", 2: "AH" } as const;
/** As colunas em que o `RESUMO GERAL` empilha as quinzenas. */
const COLUNA_DA_QUINZENA = { 1: "AI", 2: "AJ" } as const;
const DIAS_DA_QUINZENA = { 1: [1, 15], 2: [16, 31] } as const;

/**
 * As linhas do `RESUMO GERAL`, por chave do motor.
 *
 * Exportada para que `referencia.test.ts` prenda a concordância com o mapa de
 * `referencia.ts`: os dois módulos leem a mesma planilha para perguntas
 * diferentes, e a mesma célula não pode ter dois endereços no repositório.
 * Não são fundidos porque as perguntas divergem — este mapa é o das linhas de
 * quadro, e o de lá inclui os totais que a tela mostra.
 */
export const LINHA_NO_RESUMO: Record<string, number> = {
  rota_dvs: 7,
  custo_fixo_padronizado: 8,
  custo_fixo_inativos: 9,
  custo_vans_inativas: 10,
  indisponibilidade_fixo: 11,
  custo_fixo_especiais: 12,
  custo_fixo_vans: 13,
  desconto_devolucao_percentual: 14,
  desconto_disponibilidade: 15,
  desconto_complementar_negativo: 16,
  custo_variavel_frota_fixa: 21,
  custo_variavel_agregado: 22,
  indisponibilidade_variavel: 24,
  outros_custos: 29,
};

function numero(aba: XLSX.WorkSheet | undefined, celula: string): number {
  const c = aba?.[celula];
  return c ? Number(c.v) || 0 : 0;
}

function texto(aba: XLSX.WorkSheet | undefined, celula: string): string {
  const c = aba?.[celula];
  return c ? String(c.v).trim() : "";
}

/**
 * As viagens de um dia, agrupadas pela tupla que a conta enxerga.
 *
 * Ver {@link DiaDaPlanilha}: agrupar é exato, porque o motor só conta e soma.
 */
function viagensDoDia(pasta: XLSX.WorkBook, dia: number): ViagemAgrupada[] {
  const aba = pasta.Sheets[String(dia).padStart(2, "0")];
  if (!aba?.["!ref"]) return [];
  const area = XLSX.utils.decode_range(aba["!ref"]);
  const contagem = new Map<string, ViagemAgrupada>();
  for (let linha = 8; linha <= area.e.r + 1; linha += 1) {
    const frota = texto(aba, `E${linha}`);
    if (!frota) continue;
    const carga = texto(aba, `D${linha}`);
    const imposto = texto(aba, `AF${linha}`);
    const faturado = numero(aba, `AI${linha}`);
    const chave = [frota, carga, imposto, faturado].join(" | ");
    const achada = contagem.get(chave);
    if (achada) achada[4] += 1;
    else contagem.set(chave, [frota, carga, imposto, faturado, 1]);
  }
  return [...contagem.values()];
}

/** Extrai o fechamento inteiro da planilha, na forma que a prova consome. */
export function extrairFechamento(bytes: Buffer, arquivo: string): FechamentoDaPlanilha {
  const abasDeDia = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
  const pasta = XLSX.read(bytes, {
    type: "buffer",
    sheets: [ABA_RESUMO, ABA_MAPA, ABA_OUTROS, ...abasDeDia],
  });
  const resumo = pasta.Sheets[ABA_RESUMO];
  const mapa = pasta.Sheets[ABA_MAPA];
  const outros = pasta.Sheets[ABA_OUTROS];
  if (!resumo || !mapa) {
    throw new Error(`A planilha não tem as abas "${ABA_RESUMO}" e "${ABA_MAPA}".`);
  }

  const cadastro = lerCadastro(bytes);

  const quinzenas = ([1, 2] as const).map((q): QuinzenaDaPlanilha => {
    const doCadastro = cadastro.find((c) => c.quinzena === q);
    if (!doCadastro) throw new Error(`A aba Cadastro não trouxe a ${q}ª quinzena.`);

    const [inicio, fim] = DIAS_DA_QUINZENA[q];
    const dias: DiaDaPlanilha[] = [];
    for (let dia = inicio; dia <= fim; dia += 1) {
      dias.push({ dia, viagens: viagensDoDia(pasta, dia) });
    }

    const ultimo = ULTIMO_DIA[q];
    const coluna = COLUNA_DA_QUINZENA[q];
    const resumoGeral = Object.fromEntries(
      Object.entries(LINHA_NO_RESUMO).map(([chave, linha]) => [
        chave,
        numero(resumo, `${coluna}${linha}`),
      ]),
    );

    return {
      quinzena: q,
      parametros: doCadastro.parametros,
      custoVariavelPrevistoPor25Viagens: doCadastro.custoVariavelPrevistoPor25Viagens,
      dias,
      bases: {
        /* As bases acumulam na última coluna de dia da quinzena, sem imposto. */
        devolucao: numero(mapa, `${ultimo}138`),
        disponibilidade: numero(mapa, `${ultimo}139`),
        complementarNegativo: numero(mapa, `${ultimo}140`),
        outrosCustos: numero(outros, q === 1 ? "F4" : "G4"),
        indisponibilidade: numero(mapa, `${coluna}132`),
      },
      foraDoMunicipioNoDiario: numero(mapa, `${coluna}119`),
      resumoGeral,
      totais: {
        remuneracao: numero(resumo, `${coluna}17`),
        variavel: numero(resumo, `${coluna}25`),
        outrosCustos: numero(resumo, `${coluna}30`),
        geral: numero(resumo, `${coluna}36`),
      },
    };
  });

  return { competencia: "julho/2026 — CDD Belém · Horizonte", arquivo, quinzenas };
}

const brl = (n: number | null) =>
  n === null
    ? "—"
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A tabela, em Markdown, para colar num relatório sem reformatar. */
export function tabelaEmMarkdown(r: Reconciliacao): string {
  const saida: string[] = [];
  saida.push(`### ${r.competencia} — modo \`${r.modo}\``);
  saida.push("");
  saida.push(
    "| Quadro | Linha | Planilha 1ª | Motor 1ª | Dif 1ª | Planilha 2ª | Motor 2ª | Dif 2ª | Planilha total | Motor total | Dif total |",
  );
  saida.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const l of [...r.linhas, ...r.totais]) {
    saida.push(
      `| ${l.quadro} | ${l.rotulo} | ${brl(l.planilha.primeira)} | ${brl(l.motor.primeira)} | ${brl(l.diferenca.primeira)} ` +
        `| ${brl(l.planilha.segunda)} | ${brl(l.motor.segunda)} | ${brl(l.diferenca.segunda)} ` +
        `| ${brl(l.planilha.total)} | ${brl(l.motor.total)} | ${brl(l.diferenca.total)} |`,
    );
  }
  saida.push("");
  saida.push(
    `Células que fecham em R$ 0,00: **${r.placar.iguais}** · que não fecham: **${r.placar.diferentes}**`,
  );
  const comMotivo = r.linhas.filter((l) => l.divergencia);
  if (comMotivo.length > 0) {
    saida.push("");
    saida.push("#### As diferenças, e de onde cada uma vem");
    saida.push("");
    for (const l of comMotivo) saida.push(`- **${l.rotulo}** — ${l.divergencia}`);
  }
  return saida.join("\n");
}

/** Legado × Canônica, com o efeito de adotar a regra oficial. */
export function comparacaoEmMarkdown(c: ComparacaoDeModos): string {
  const saida: string[] = [];
  saida.push(`### ${c.competencia} — Legado × Regra Canônica`);
  saida.push("");
  saida.push("| Linha | Legado 1ª | Canônica 1ª | Efeito 1ª | Legado 2ª | Canônica 2ª | Efeito 2ª | Efeito no total |");
  saida.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const l of [...c.linhas, ...c.totais]) {
    if (
      [l.efeito.primeira, l.efeito.segunda, l.efeito.total].every(
        (n) => n === null || Math.abs(n) < 0.005,
      )
    ) {
      continue;
    }
    saida.push(
      `| ${l.rotulo} | ${brl(l.legado.primeira)} | ${brl(l.canonica.primeira)} | ${brl(l.efeito.primeira)} ` +
        `| ${brl(l.legado.segunda)} | ${brl(l.canonica.segunda)} | ${brl(l.efeito.segunda)} | ${brl(l.efeito.total)} |`,
    );
  }
  saida.push("");
  saida.push(
    c.afetadas.length === 0
      ? "A regra canônica não muda nenhuma linha neste fechamento."
      : `Linhas que a regra canônica muda: **${c.afetadas.join(", ")}**. ` +
        `Efeito no TOTAL GERAL UNIDADE do mês: **${brl(c.efeitoNoTotalGeral)}**.`,
  );
  saida.push("");
  saida.push(
    "As linhas omitidas acima são as que as duas regras calculam igual — a troca de " +
      "autoridade só toca o custo fixo padronizado da 2ª quinzena.",
  );
  return saida.join("\n");
}

function principal(): void {
  const argumentos = process.argv.slice(2);
  const caminho = argumentos.find((a) => !a.startsWith("--"));
  if (!caminho) {
    console.error("uso: tsx ./src/reconciliar-planilha-cli.ts <planilha.xlsb> [--amostra destino.json]");
    process.exitCode = 1;
    return;
  }

  const bytes = readFileSync(caminho);
  const fechamento = extrairFechamento(bytes, caminho.split("/").pop() ?? caminho);

  const posicao = argumentos.indexOf("--amostra");
  const destino = posicao >= 0 ? argumentos[posicao + 1] : undefined;
  if (destino && !destino.startsWith("--")) {
    writeFileSync(destino, `${JSON.stringify(fechamento, null, 2)}\n`, "utf8");
    console.log(`amostra escrita em ${destino}`);
    console.log("");
  }

  for (const modo of ["PLANILHA_LEGADA", "REGRA_CANONICA"] as ModoDaProva[]) {
    console.log(tabelaEmMarkdown(reconciliar(fechamento, modo)));
    console.log("");
  }
  console.log(comparacaoEmMarkdown(compararModos(fechamento)));
}

/* Só roda como programa; importado, é só o extrator e o formatador. */
if (process.argv[1]?.endsWith("reconciliar-planilha-cli.ts")) principal();
