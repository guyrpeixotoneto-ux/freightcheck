import { centavos, lerNumero, type Canal } from "../dominio";
import { diaDeTextoBR, type Dia } from "../periodo";
import { lerTextoDeRelatorio } from "./formato";

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
 *
 * **Quando ele chega delimitado, a régua deixa de existir — e o campo ocupa o
 * lugar dela.** É a única fonte em que o formato muda o que se pode afirmar:
 * nas outras cinco o separador é embalagem, e aqui a coluna *é* o sentido. Por
 * isso um `.csv` desta fonte não é lido pela posição do caractere, e sim pelo
 * índice do campo — e esse índice é descoberto no próprio arquivo, pelo
 * cabeçalho que ele traz (`(Emitido)` / `(Calculado)`) ou, na falta dele, pelas
 * duas únicas colunas em que valores aparecem. Quando nem uma coisa nem outra
 * resolve, o leitor **recusa o arquivo** em vez de escolher uma coluna: um
 * `Desconto Frete Minimo` lido na coluna errada não dá erro nenhum, dá um
 * fechamento plausível e errado, que é o desfecho mais caro que este módulo
 * pode produzir.
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
/** O mesmo valor, quando ele é o campo inteiro e não um trecho da linha. */
const RE_CAMPO_DE_VALOR = /^-?[\d.]{1,15},\d{2}$/;

/**
 * Onde as duas colunas de dinheiro estão, num arquivo delimitado.
 *
 * O equivalente exato de `FIM_DA_COLUNA_EMITIDO` para um arquivo sem régua: lá
 * a pergunta é "o número terminou antes da coluna 76?", aqui é "o número está
 * no campo do emitido ou no do calculado?".
 */
interface ReguaDeCampos {
  emitido: number;
  calculado: number;
}

/** O arquivo é delimitado, mas não diz qual coluna é qual. */
export class ColunasDaConciliacaoIndefinidas extends Error {
  constructor(readonly encontradas: number[]) {
    super(
      "O relatório de conciliação veio delimitado, e não dá para saber qual coluna é o emitido " +
        "(R$ CT-e) e qual é o calculado (R$ SRTrans): o arquivo não traz o cabeçalho que as nomeia " +
        `e ${encontradas.length === 1 ? "só uma coluna traz" : `${encontradas.length} colunas trazem`} valor. ` +
        "A mesma linha nas duas colunas quer dizer coisas opostas, então o leitor não escolhe por conta " +
        "própria — envie o .txt do Promax, que traz as duas colunas alinhadas.",
    );
    this.name = "ColunasDaConciliacaoIndefinidas";
  }
}

/** `(emitido)`, `r$ ct-e` e afins, sem acento e sem caixa. */
function marcaDeColuna(campo: string): ColunaDaConciliacao | null {
  const texto = chave(campo).replace(/[()]/g, "");
  if (texto === "emitido" || texto === "r$ ct-e") return "EMITIDO";
  if (texto === "calculado" || texto === "r$ srtrans") return "CALCULADO";
  return null;
}

/** Em que campos o arquivo põe valor — a evidência de onde estão as colunas. */
function camposComValor(matriz: string[][]): number[] {
  const indices = new Set<number>();
  for (const campos of matriz) {
    campos.forEach((campo, i) => {
      if (RE_CAMPO_DE_VALOR.test(campo.trim())) indices.add(i);
    });
  }
  return [...indices].sort((a, b) => a - b);
}

/** O cabeçalho que nomeia as duas colunas, quando o arquivo traz um. */
function reguaDoCabecalho(matriz: string[][]): ReguaDeCampos | null {
  for (const campos of matriz) {
    let emitido = -1;
    let calculado = -1;
    campos.forEach((campo, i) => {
      const marca = marcaDeColuna(campo);
      if (marca === "EMITIDO" && emitido < 0) emitido = i;
      if (marca === "CALCULADO" && calculado < 0) calculado = i;
    });
    if (emitido >= 0 && calculado >= 0) return { emitido, calculado };
  }
  return null;
}

/**
 * Descobre a régua do arquivo delimitado.
 *
 * Duas vias, nesta ordem, e nenhuma terceira:
 *
 * 1. **O cabeçalho, quando ele existe.** `(Emitido)` e `(Calculado)` (ou
 *    `R$ CT-e` e `R$ SRTrans`) são o próprio arquivo dizendo onde estão as
 *    colunas, e é isso que se lê — **desde que os valores estejam mesmo lá**.
 *    Essa conferência não é zelo excessivo: um cabeçalho que aponta para
 *    colunas vazias faria toda linha ser lida sem valor nenhum, e um relatório
 *    inteiro em branco é a falha mais silenciosa que este leitor poderia ter.
 * 2. **As colunas que têm dinheiro, quando são exatamente duas.** Aí a da
 *    esquerda é o emitido e a da direita o calculado, que é a mesma ordem da
 *    régua de largura fixa. Não é palpite: é a única leitura compatível com o
 *    layout do relatório.
 *
 * Uma só coluna, ou três, e o leitor recusa — ver a classe acima.
 */
function reguaDeCampos(matriz: string[][]): ReguaDeCampos {
  const comValor = camposComValor(matriz);
  const doCabecalho = reguaDoCabecalho(matriz);
  if (
    doCabecalho &&
    (comValor.includes(doCabecalho.emitido) || comValor.includes(doCabecalho.calculado))
  ) {
    return doCabecalho;
  }
  if (comValor.length !== 2) throw new ColunasDaConciliacaoIndefinidas(comValor);
  return { emitido: comValor[0], calculado: comValor[1] };
}

/** O que uma linha de valor declara, seja qual for o formato em que ela veio. */
interface ValoresDaLinha {
  rubrica: string;
  conciliado: "S" | "N" | null;
  emitido: number | null;
  calculado: number | null;
}

/** A linha de largura fixa: a coluna em que o número termina é quem decide. */
function valoresPelaPosicao(bruta: string): ValoresDaLinha | null {
  RE_VALOR.lastIndex = 0;
  const achados = [...bruta.matchAll(RE_VALOR)];
  if (achados.length === 0) return null;

  let emitido: number | null = null;
  let calculado: number | null = null;
  for (const achado of achados) {
    const fim = (achado.index ?? 0) + achado[0].length;
    const valor = lerNumero(achado[0]);
    if (valor == null) continue;
    if (fim <= FIM_DA_COLUNA_EMITIDO) emitido = centavos(valor);
    else calculado = centavos(valor);
  }

  const marca = /\s([SN])\s+[\d.]+,\d{2}/.exec(bruta);
  return {
    rubrica: bruta.slice(0, achados[0].index ?? 0).trim().replace(/\s+[SN]$/, "").trim(),
    conciliado: marca ? (marca[1] as "S" | "N") : null,
    emitido,
    calculado,
  };
}

/** A linha delimitada: o índice do campo é quem decide. */
function valoresPelosCampos(campos: string[], regua: ReguaDeCampos): ValoresDaLinha | null {
  const valorEm = (i: number): number | null => {
    const bruto = (campos[i] ?? "").trim();
    if (!RE_CAMPO_DE_VALOR.test(bruto)) return null;
    const valor = lerNumero(bruto);
    return valor == null ? null : centavos(valor);
  };
  const emitido = valorEm(regua.emitido);
  const calculado = valorEm(regua.calculado);
  if (emitido === null && calculado === null) return null;

  const antes = campos
    .slice(0, Math.min(regua.emitido, regua.calculado))
    .map((c) => c.trim())
    .filter((c) => c !== "");
  const ultimo = antes[antes.length - 1];
  const conciliado = ultimo === "S" || ultimo === "N" ? (antes.pop() as "S" | "N") : null;

  return { rubrica: antes.join(" ").trim(), conciliado, emitido, calculado };
}

/** Lê o 03.02.59.02. */
export function lerConciliacao(arquivo: Buffer | ArrayBuffer | string): Conciliacao {
  const { linhas, campos, linhaFisica } = lerTextoDeRelatorio(arquivo);
  /* A régua do arquivo delimitado é descoberta uma vez, antes da primeira
     linha de valor: ela é do documento, não da linha. */
  const regua = campos ? reguaDeCampos(campos) : null;

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
    const linha = linhaFisica[i] ?? i + 1;
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
    const valores =
      regua && campos ? valoresPelosCampos(campos[i] ?? [], regua) : valoresPelaPosicao(bruta);
    if (!valores) {
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

    itens.push({ linha, secao, bloco, ...valores });
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
