import { centavos, lerNumero, type Canal } from "../dominio";
import { diaDeTextoBR, type Dia } from "../periodo";

/**
 * O 03.02.59.02 — a conciliação CT-e × SRTrans, do Promax.
 *
 * É o fecho da quinzena: o relatório que põe lado a lado o que foi **emitido**
 * em CT-e e o que o SRTrans **calculou** que era devido, e cujo saldo atravessa
 * para a quinzena seguinte. É o documento que a transportadora recebe dizendo
 * quanto vai receber — e o que este produto existe para conferir.
 *
 * **É um relatório de largura fixa, e a coluna é o dado.** Muitas linhas trazem
 * um número só, e qual das duas colunas ele ocupa muda completamente o sentido:
 * `Desconto Frete Minimo ... 17.398,54` está na coluna do calculado (só reduz o
 * que o SRTrans apurou), enquanto `CT-es Recebidos ... 417.970,31` está na do
 * emitido. Contar números na linha, que é o reflexo instintivo, misturaria os
 * dois. Por isso o leitor decide pela **posição final** do número: a coluna do
 * emitido termina na 75, a do calculado na 88.
 *
 * **O arquivo não tem acento.** O Promax exporta em ASCII — `Saldo Proxima
 * Quinzena`, `Desconto Frete Minimo` —, e os rótulos aqui são comparados sem
 * acento justamente para que a versão do dia em que ele passar a ter acento
 * continue lendo.
 */

/** Onde o número estava: qual das duas colunas do relatório. */
export type ColunaDaConciliacao = "EMITIDO" | "CALCULADO";

/**
 * A fronteira entre as duas colunas, em caracteres.
 *
 * Números são alinhados à direita: os do emitido terminam na coluna 75 e os do
 * calculado na 88. A fronteira em 76 dá folga para uma variação de uma casa
 * sem confundir as colunas, que estão a treze caracteres uma da outra.
 */
const FIM_DA_COLUNA_EMITIDO = 76;

/** Uma linha de valor do relatório, com a coluna em que cada número estava. */
export interface ItemDaConciliacao {
  /** A linha física do arquivo. */
  linha: number;
  /** `ROTA`, `AS` ou `GERAL` — de que resumo esta linha faz parte. */
  secao: Canal | "GERAL";
  /** O bloco dentro da seção, como o relatório o intitula. */
  bloco: string;
  /** O rótulo da linha, sem acento, como veio. */
  rubrica: string;
  /** A marca da coluna "Conciliado": `S`, `N`, ou `null` quando a linha não a tem. */
  conciliado: "S" | "N" | null;
  emitido: number | null;
  calculado: number | null;
}

export interface Conciliacao {
  transportadora: { codigo: string; nome: string } | null;
  unidade: string | null;
  periodo: { inicio: Dia | null; fim: Dia | null };
  /** `Sintetico` ou `Analitico` — a opção com que o relatório foi tirado. */
  opcao: string | null;
  itens: ItemDaConciliacao[];
  /**
   * As frases soltas do rodapé — `Encontrado Notas Fiscais sem Vinculo com CT-e.`
   *
   * São avisos do Promax sem valor associado, e sumiam na planilha. Aqui viram
   * pendência com texto, porque nota fiscal sem CT-e é exatamente o valor que
   * atravessa quinzenas até alguém reclamar.
   */
  avisos: string[];
}

const RE_VALOR = /-?[\d.]{1,15},\d{2}/g;

/** Lê o 03.02.59.02. */
export function lerConciliacao(arquivo: Buffer | ArrayBuffer | string): Conciliacao {
  const texto =
    typeof arquivo === "string"
      ? arquivo
      : new TextDecoder("latin1").decode(
          arquivo instanceof Buffer ? arquivo : new Uint8Array(arquivo),
        );
  const linhas = texto.split(/\r?\n/);

  let transportadora: Conciliacao["transportadora"] = null;
  let unidade: string | null = null;
  let opcao: string | null = null;
  const periodo: Conciliacao["periodo"] = { inicio: null, fim: null };
  const itens: ItemDaConciliacao[] = [];
  const avisos: string[] = [];

  let secao: Canal | "GERAL" = "GERAL";
  let bloco = "";

  for (let i = 0; i < linhas.length; i += 1) {
    const bruta = linhas[i] ?? "";
    const linha = i + 1;
    const enxuta = bruta.trim();
    if (enxuta === "") continue;

    /* --- o cabeçalho, que se repete a cada página -------------------------- */
    const cabecalho = /^Transportadora:\s*(\d+)\s*-\s*(.+)$/.exec(enxuta);
    if (cabecalho) {
      transportadora = { codigo: cabecalho[1], nome: cabecalho[2].trim() };
      continue;
    }
    const selecao = /^Selecao\s*-\s*Data:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/.exec(enxuta);
    if (selecao) {
      periodo.inicio = diaDeTextoBR(selecao[1]);
      periodo.fim = diaDeTextoBR(selecao[2]);
      continue;
    }
    const opcaoLida = /^Opcao:\s*(.+)$/.exec(enxuta);
    if (opcaoLida) {
      opcao = opcaoLida[1].trim();
      continue;
    }
    if (/^CRBS\b/.test(enxuta) && !unidade) {
      unidade = enxuta.split(/\s{2,}/)[0]?.trim() ?? null;
      continue;
    }
    if (/^(PW\d|Versao:|Selecao)/.test(enxuta)) continue;
    if (/^-{5,}$/.test(enxuta)) continue;
    if (/^Conciliado\b|^\(Emitido\)/.test(enxuta)) continue;

    /* --- as seções e os blocos -------------------------------------------- */
    const resumo = /^RESUMO CT-e\s+(ROTA|AS)\b/.exec(enxuta);
    if (resumo) {
      secao = resumo[1] === "ROTA" ? "ROTA" : "AS";
      bloco = "";
      continue;
    }
    if (/^TOTAL GERAL/.test(enxuta)) {
      secao = "GERAL";
      bloco = "TOTAL GERAL";
      continue;
    }
    if (/^RESUMO /.test(enxuta) || /^\(Quinzena (Atual|Anterior)\)$/.test(enxuta)) {
      bloco = enxuta;
      continue;
    }

    /* --- as linhas de valor ------------------------------------------------ */
    RE_VALOR.lastIndex = 0;
    const achados = [...bruta.matchAll(RE_VALOR)];
    if (achados.length === 0) {
      /*
        Linha sem número. Duas coisas chegam aqui: um subtítulo sem valor
        (`Recebido Quinzenas Anteriores`), que é contexto, e um aviso do
        rodapé, que é pendência. O ponto final é o que os separa — o Promax
        escreve aviso como frase.
      */
      if (/\.$/.test(enxuta)) avisos.push(enxuta);
      else bloco = bloco === "" ? enxuta : bloco;
      continue;
    }

    let emitido: number | null = null;
    let calculado: number | null = null;
    for (const achado of achados) {
      const fim = (achado.index ?? 0) + achado[0].length;
      const valor = lerNumero(achado[0]);
      if (valor == null) continue;
      if (fim <= FIM_DA_COLUNA_EMITIDO) emitido = centavos(valor);
      else calculado = centavos(valor);
    }

    const rubrica = bruta.slice(0, achados[0].index ?? 0).trim().replace(/\s+[SN]$/, "").trim();
    const marca = /\s([SN])\s+[\d.]+,\d{2}/.exec(bruta);

    itens.push({
      linha,
      secao,
      bloco,
      rubrica,
      conciliado: marca ? (marca[1] as "S" | "N") : null,
      emitido,
      calculado,
    });
  }

  return { transportadora, unidade, periodo, opcao, itens, avisos };
}

/** Normaliza um rótulo para comparação: sem acento, sem caixa, sem espaço duplo. */
function chave(rubrica: string): string {
  return rubrica
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * O valor de uma rubrica, em uma seção e coluna.
 *
 * Devolve `null` — e não `0` — quando a rubrica não existe naquela seção. A
 * diferença importa: "o relatório não trouxe esta linha" e "esta linha veio
 * zerada" levam a conversas diferentes com a Ambev.
 */
export function valorDe(
  conciliacao: Conciliacao,
  filtro: { secao: Canal | "GERAL"; rubrica: string; bloco?: string; coluna: ColunaDaConciliacao },
): number | null {
  const alvo = chave(filtro.rubrica);
  const bloco = filtro.bloco ? chave(filtro.bloco) : null;
  for (const item of conciliacao.itens) {
    if (item.secao !== filtro.secao) continue;
    if (chave(item.rubrica) !== alvo) continue;
    if (bloco && chave(item.bloco) !== bloco) continue;
    return filtro.coluna === "EMITIDO" ? item.emitido : item.calculado;
  }
  return null;
}
