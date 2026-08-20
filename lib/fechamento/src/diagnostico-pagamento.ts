import { lerTextoDeRelatorio } from "./leitores/formato";
import { lerPagamento } from "./leitores/pagamento";

/**
 * Por que este 03.08.20 não virou verba.
 *
 * **O caso que isto existe para resolver.** Um demonstrativo com `linhas_lidas`
 * cheio e zero verbas gravadas: o arquivo foi lido, o cabeçalho reconhecido, os
 * descontos entraram — e nenhuma linha de verba casou. A lista de relatórios
 * mostra "14 linhas" e o painel da planilha diz não ter de onde sair; as duas
 * coisas são verdade, e nenhuma das duas explica a outra. `explicarPainelAusente`
 * diz **que** não há verba; esta função diz **por quê**, apontando a linha.
 *
 * **É pura, e é a mesma resposta em todo lugar.** A análise nasceu num CLI
 * (`explicar-pagamento-cli.ts`), o que exigia terminal e `DATABASE_URL` para
 * responder a uma pergunta que quem opera faz olhando a tela. Ela mora aqui
 * agora, sobre bytes, e os dois — o CLI e a rota — chamam esta função: duas
 * cópias divergiriam no primeiro layout novo, e a do CLI é a que ninguém veria
 * envelhecer.
 *
 * **Lê o arquivo pelo mesmo caminho do leitor**, e não por `split("\n")` sobre
 * um `toString("utf8")`: o 03.08.20 chega em latin-1 e chega delimitado, e
 * examinar bytes por uma régua diferente da que o leitor usa devolveria o
 * diagnóstico de um arquivo que não é o que foi importado.
 */

/** O que o leitor exige de uma linha de verba — a mesma de `leitores/pagamento.ts`. */
const RE_ITEM =
  /^\s*(\d{1,3})\s*-\s*(.+?)\s{2,}(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s+(-?[\d.]+,\d{2})\s*$/;
/** Uma linha que **começa** como verba: `NN - Nome`. O resto é o que se investiga. */
const RE_PARECE_VERBA = /^\s*(\d{1,3})\s*-\s*(.{3,}?)\s{2,}(.+)$/;
const RE_VALOR = /-?[\d.]+,\d{2}/g;

/**
 * Onde a leitura parou.
 *
 * A ordem das causas é a da precisão: quanto mais cedo na lista, mais específico
 * é o que se pode dizer, e mais diferente é o que quem opera tem de fazer. A
 * última, `SEM_CORPO_DE_VERBA`, é a que sobra — e ela também é uma resposta: o
 * arquivo foi lido inteiro e não tem verba dentro.
 */
export type CausaDoPagamentoSemVerba =
  | "LEU_NORMALMENTE"
  | "NAO_E_O_03_08_20"
  | "SEM_CABECALHO_DE_SECAO"
  | "LINHA_DE_VERBA_RECUSADA"
  | "SEM_CORPO_DE_VERBA";

export interface LinhaSuspeita {
  /** A linha física, 1-based, como o editor a numera. */
  linha: number;
  motivo: string;
  original: string;
}

export interface DiagnosticoDoPagamento {
  causa: CausaDoPagamentoSemVerba;
  /** A frase que a tela mostra — uma só, e sempre a mesma para a mesma causa. */
  resumo: string;
  lido: { verbas: number; descontos: number; totais: number };
  cabecalho: {
    periodo: { inicio: string | null; fim: string | null };
    unidade: string | null;
    transportadora: string | null;
  };
  /** Os cabeçalhos de que a leitura de verba depende, e quantas linhas casam. */
  secoes: { canal: boolean; bloco: boolean; verbasBemFormatadas: number };
  /** As linhas que pareciam verba e não entraram, com o motivo de cada uma. */
  suspeitas: LinhaSuspeita[];
}

function motivoDaLinha(bruta: string): string | null {
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

/** Sem acento e em minúsculas — a mesma normalização do leitor. */
function chave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

export function diagnosticarPagamento(
  conteudo: Buffer | ArrayBuffer | Uint8Array | string,
): DiagnosticoDoPagamento {
  const lido = lerPagamento(conteudo as Buffer);
  const { linhas, linhaFisica } = lerTextoDeRelatorio(conteudo);

  const cabecalho = {
    periodo: lido.periodo,
    unidade: lido.unidade ? `${lido.unidade.codigo} — ${lido.unidade.nome}` : null,
    transportadora: lido.transportadora
      ? `${lido.transportadora.codigo} — ${lido.transportadora.nome}`
      : null,
  };
  const contagem = {
    verbas: lido.itens.length,
    descontos: lido.descontos.length,
    totais: lido.totais.length,
  };
  const secoes = {
    canal: linhas.some((l) => ["rota", "as"].includes(chave(l))),
    bloco: linhas.some((l) => ["frete", "outros custos"].includes(chave(l))),
    verbasBemFormatadas: linhas.filter((l) => RE_ITEM.test(l)).length,
  };
  const suspeitas: LinhaSuspeita[] = [];
  for (let i = 0; i < linhas.length; i += 1) {
    const bruta = linhas[i] ?? "";
    const motivo = motivoDaLinha(bruta);
    if (motivo) {
      suspeitas.push({ linha: linhaFisica[i] ?? i + 1, motivo, original: bruta.trim() });
    }
  }

  const base = { lido: contagem, cabecalho, secoes, suspeitas };

  if (contagem.verbas > 0) {
    return {
      ...base,
      causa: "LEU_NORMALMENTE",
      resumo:
        `As ${contagem.verbas} verba(s) deste arquivo foram reconhecidas — ele produz ` +
        `fatos normalmente.`,
    };
  }

  /*
    Sem nenhum dos três cabeçalhos, é quase certo que o arquivo não é um
    03.08.20 — os três saem do cabeçalho de toda página do relatório. Dizer
    "o layout mudou" aqui mandaria mexer no leitor por causa de um arquivo
    trocado, que é o erro mais caro deste diagnóstico.
  */
  if (!cabecalho.periodo.inicio && !cabecalho.unidade && !cabecalho.transportadora) {
    return {
      ...base,
      causa: "NAO_E_O_03_08_20",
      resumo:
        "Nenhum dos três cabeçalhos do 03.08.20 foi reconhecido — nem o período, nem a " +
        "unidade, nem a transportadora. Isto normalmente quer dizer que o arquivo enviado " +
        "não é o demonstrativo de pagamento, e não que o layout dele mudou.",
    };
  }

  /*
    As verbas estão no formato certo e mesmo assim não entraram: o leitor só as
    aceita **dentro** de uma seção `FRETE`/`OUTROS CUSTOS`, e a seção só existe
    depois de uma linha de canal. É o arquivo recortado, e quem conserta é quem
    exporta — não o leitor.
  */
  if (secoes.verbasBemFormatadas > 0) {
    const falta = !secoes.canal
      ? "a linha de canal (`ROTA` ou `AS`, sozinha na linha) não existe no arquivo, e sem ela nada é lido"
      : "a linha de bloco (`FRETE` ou `OUTROS CUSTOS`) não existe no arquivo, e sem ela as verbas são ignoradas";
    return {
      ...base,
      causa: "SEM_CABECALHO_DE_SECAO",
      resumo:
        `${secoes.verbasBemFormatadas} linha(s) de verba estão no formato certo e foram ` +
        `descartadas: ${falta}. O arquivo parece ter sido exportado sem os cabeçalhos de ` +
        `seção, ou recortado — reexporte o 03.08.20 inteiro.`,
    };
  }

  if (suspeitas.length > 0) {
    const primeira = suspeitas[0]!;
    return {
      ...base,
      causa: "LINHA_DE_VERBA_RECUSADA",
      resumo:
        `${suspeitas.length} linha(s) parecem verba e não foram aceitas. A primeira é a ` +
        `linha ${primeira.linha}, que ${primeira.motivo}. O leitor espera VBZ, "-", nome, ` +
        `dois ou mais espaços e seis valores (sem imposto, NF/ISS, CTRC/ICMS, faturado, ` +
        `VLC NF/ISS, VLC CTRC/ICMS).`,
    };
  }

  return {
    ...base,
    causa: "SEM_CORPO_DE_VERBA",
    resumo:
      'Nenhuma linha do arquivo sequer parece uma verba ("NN - Nome" seguido de valores). ' +
      "O arquivo foi lido — o cabeçalho e os descontos entraram —, mas não tem o corpo de " +
      "um 03.08.20: ele parece ter vindo só com os quadros de desconto.",
  };
}
