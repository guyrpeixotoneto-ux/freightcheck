import { readFileSync } from "node:fs";

import { lerPagamento } from "./leitores/pagamento";

/**
 * Por que este 03.08.20 não virou verba — linha a linha, sem banco.
 *
 * ```
 * pnpm --filter @workspace/fechamento exec tsx ./src/explicar-pagamento-cli.ts 03.08.20.txt
 * ```
 *
 * **O caso que ele existe para resolver.** Um demonstrativo com `linhas_lidas`
 * cheio e zero verbas gravadas: o arquivo foi lido, as seções foram
 * reconhecidas, os descontos entraram — e nenhuma linha de verba casou. O
 * diagnóstico do banco mostra o sintoma; este mostra a causa, apontando a linha
 * e dizendo qual condição ela não cumpriu.
 *
 * Lê o arquivo do disco e não toca em banco nenhum.
 */

/** O que o leitor exige de uma linha de verba, e a ordem em que exige. */
const RE_ITEM =
  /^\s*(\d{1,3})\s*-\s*(.+?)\s{2,}(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*$/;
/** Uma linha que **começa** como verba: `NN - Nome`. O resto é o que se investiga. */
const RE_PARECE_VERBA = /^\s*(\d{1,3})\s*-\s*(.{3,}?)\s{2,}(.+)$/;
const RE_VALOR = /-?[\d.]+,\d{2}/g;

function diagnosticarLinha(bruta: string): string | null {
  if (RE_ITEM.test(bruta)) return null;
  const parece = RE_PARECE_VERBA.exec(bruta);
  if (!parece) return null;

  const cauda = parece[3] ?? "";
  const valores = cauda.match(RE_VALOR) ?? [];
  if (valores.length !== 6) {
    return `tem ${valores.length} coluna(s) de valor, e o leitor exige exatamente 6`;
  }
  /* Seis valores e ainda assim não casou: sobra algo entre eles ou no fim. */
  return "tem 6 valores, mas há texto entre eles ou no fim da linha que o leitor não espera";
}

function principal(): void {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error("uso: tsx ./src/explicar-pagamento-cli.ts <arquivo do 03.08.20>");
    process.exitCode = 1;
    return;
  }

  const conteudo = readFileSync(caminho);
  const lido = lerPagamento(conteudo);

  console.log(`arquivo: ${caminho}  (${conteudo.length} bytes)\n`);
  console.log(`  período declarado : ${lido.periodo.inicio ?? "—"} a ${lido.periodo.fim ?? "—"}`);
  console.log(`  unidade           : ${lido.unidade ? `${lido.unidade.codigo} — ${lido.unidade.nome}` : "— (não reconhecida)"}`);
  console.log(`  transportadora    : ${lido.transportadora ? `${lido.transportadora.codigo} — ${lido.transportadora.nome}` : "— (não reconhecida)"}`);
  console.log(`  verbas lidas      : ${lido.itens.length}`);
  console.log(`  descontos lidos   : ${lido.descontos.length}`);
  console.log(`  totais lidos      : ${lido.totais.length}${lido.totais.length > 0 ? ` (${lido.totais.map((t) => `${t.canal} ${t.total.toFixed(2)}`).join(", ")})` : ""}`);
  console.log(`  linhas_lidas      : ${lido.itens.length + lido.descontos.length}  <- é este o número que o banco grava`);

  /*
    Sem período nem unidade, é quase certo que o arquivo não é um 03.08.20 — as
    duas saem do cabeçalho de toda página do relatório.
  */
  const semCabecalho = !lido.periodo.inicio && !lido.unidade && !lido.transportadora;
  if (semCabecalho) {
    console.log(
      `\n  Nenhum dos três cabeçalhos foi reconhecido. Isto normalmente quer dizer que o\n` +
        `  arquivo não é o 03.08.20, e não que o layout dele mudou.`,
    );
  }

  const texto = conteudo.toString("utf8");
  const linhas = texto.split(/\r?\n/);

  /*
    Uma quarta causa, e a mais traiçoeira: a linha de verba está perfeita e
    mesmo assim é descartada, porque o leitor só a aceita **dentro** de uma
    seção `FRETE` ou `OUTROS CUSTOS`, e essas seções só existem depois de uma
    linha de canal (`ROTA` ou `AS`). Sem os cabeçalhos, nenhuma verba entra por
    mais bem formatada que esteja.
  */
  const chaveDaLinha = (l: string) =>
    l
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  const temCanal = linhas.some((l) => ["rota", "as"].includes(chaveDaLinha(l)));
  const temBloco = linhas.some((l) => ["frete", "outros custos"].includes(chaveDaLinha(l)));
  const bemFormatadas = linhas.filter((l) => RE_ITEM.test(l)).length;

  if (lido.itens.length === 0 && bemFormatadas > 0) {
    console.log(`\n=== ${bemFormatadas} linha(s) de verba estão no formato certo e foram descartadas ===`);
    console.log(
      `\n  O leitor só aceita verba dentro de uma seção, e a seção só existe depois de\n` +
        `  uma linha de canal. Neste arquivo:\n` +
        `    linha de canal (` + "`ROTA`" + ` ou ` + "`AS`" + ` sozinha na linha) : ${temCanal ? "encontrada" : "AUSENTE"}\n` +
        `    linha de bloco (` + "`FRETE`" + ` ou ` + "`OUTROS CUSTOS`" + `)      : ${temBloco ? "encontrada" : "AUSENTE"}`,
    );
    console.log(
      `\n  ${!temCanal ? "Sem a linha de canal, nada é lido." : "Sem a linha de bloco, as verbas são ignoradas."}\n` +
        `  O arquivo provavelmente foi exportado sem os cabeçalhos de seção, ou recortado.`,
    );
    return;
  }
  const suspeitas: { numero: number; bruta: string; motivo: string }[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const motivo = diagnosticarLinha(linhas[i] ?? "");
    if (motivo) suspeitas.push({ numero: i + 1, bruta: linhas[i] ?? "", motivo });
  }

  if (lido.itens.length === 0 && suspeitas.length > 0) {
    console.log(`\n=== ${suspeitas.length} linha(s) parecem verba e não foram aceitas ===`);
    for (const s of suspeitas.slice(0, 10)) {
      console.log(`\n  linha ${s.numero}: ${s.motivo}`);
      console.log(`    ${JSON.stringify(s.bruta.slice(0, 160))}`);
    }
    if (suspeitas.length > 10) console.log(`\n  … e mais ${suspeitas.length - 10}.`);
    console.log(
      `\n  O leitor espera: VBZ, ` + "`-`" + `, nome, dois ou mais espaços, e SEIS valores\n` +
        `  (sem imposto, NF/ISS, CTRC/ICMS, faturado, VLC NF/ISS, VLC CTRC/ICMS).`,
    );
    return;
  }

  if (lido.itens.length === 0) {
    console.log(
      `\n  Nenhuma linha do arquivo sequer **parece** uma verba (` + "`NN - Nome  valores`" + `).\n` +
        `  O arquivo foi lido, mas não tem o corpo de um 03.08.20.`,
    );
    return;
  }

  console.log(`\n  As ${lido.itens.length} verbas foram reconhecidas. Este arquivo produz fatos normalmente.`);
  const porCanal = new Map<string, number>();
  for (const i of lido.itens) porCanal.set(i.canal, (porCanal.get(i.canal) ?? 0) + 1);
  for (const [canal, quantas] of porCanal) console.log(`    ${canal}: ${quantas} verba(s)`);
}

principal();
