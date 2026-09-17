/**
 * O EXTRATO DO FINANCIAMENTO — ler o arquivo do ERP como ele é.
 *
 * ---------------------------------------------------------------------------
 * Por que existe um leitor próprio
 * ---------------------------------------------------------------------------
 * O leitor de modelo (`workbook.ts`) pede `vigencia` + um identificador de
 * linha, e trabalha no grão "uma linha por entidade por vigência". É o formato
 * do export de remuneração, que é um **cadastro**: cada linha descreve um
 * equipamento naquela quinzena.
 *
 * O extrato do financiamento não é um cadastro, é um **razão**. A linha é um
 * lançamento contábil — um documento, uma filial, uma conta, uma data de
 * escrituração —, e a mesma placa aparece quantas vezes o mês tiver lançamentos
 * dela. Não há coluna de vigência: há `MES` e `ANO`.
 *
 * Passar esse arquivo pelo leitor de modelo tem uma consequência medida, e é
 * pior do que uma recusa: sem a coluna `vigencia`, a aba é rebaixada a pivô,
 * nenhum fato é produzido, e a importação termina com zero erro e zero aviso —
 * aprovada e vazia. E se a coluna existisse, o grão ainda estaria errado: duas
 * linhas da mesma placa no mesmo mês viram chave repetida, e o pipeline recusa
 * o registro inteiro (`ENTIDADE_DUPLICADA_CONFLITANTE`) quando os valores
 * discordam — 73 chaves deste arquivo, R$ 506 mil — ou grava uma só quando eles
 * coincidem, perdendo a outra em silêncio.
 *
 * Daí este módulo: ele lê o razão como razão, e quem transforma lançamento em
 * valor consolidado é `agregacao.ts`, com a regra escrita e testada.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo não faz
 * ---------------------------------------------------------------------------
 * Não decide tipo de ativo, não soma, não inverte sinal e não fala com banco
 * nenhum. Ele converte células em campos tipados, **preservando o original ao
 * lado de cada conversão**, e diz o que não conseguiu ler. Tudo o que é
 * interpretação mora depois dele, para que os testes possam discordar de uma
 * coisa de cada vez.
 */

import {
  COLUNAS_DO_EXTRATO,
  reconhecerLayoutDoExtrato,
  type LayoutDoExtrato,
} from "../workbook";

/*
  As colunas obrigatórias e o reconhecimento do layout moram em `workbook.ts`,
  junto de quem decide o papel de uma aba, e são reexportados aqui para que quem
  lê o extrato continue pedindo ao módulo do extrato. Uma segunda lista das
  mesmas cinco colunas concordaria no dia em que fosse escrita e discordaria no
  dia em que o ERP acrescentasse uma — e discordar, aqui, é a aba entrar como
  fonte e o leitor não a reconhecer, ou o contrário.
*/
export { reconhecerLayoutDoExtrato, type LayoutDoExtrato };
export const COLUNAS_OBRIGATORIAS = COLUNAS_DO_EXTRATO;

/** Uma linha do arquivo, como o pipeline a entrega: célula a célula, por cabeçalho. */
export interface LinhaBrutaDoExtrato {
  /** A linha física na planilha, 1-based — como uma pessoa a conta. */
  rowIndex: number;
  /** Valor por cabeçalho, na forma de `foldText`. Texto sempre, tipagem aqui. */
  celulas: Record<string, string | null>;
}

/**
 * As colunas preservadas como evidência contábil, com o nome que elas têm no
 * ERP.
 *
 * Guardadas e não descartadas porque são o que transforma "R$ 10.817,54 em
 * março" em algo conferível contra o razão: a filial, a conta, o documento e a
 * data de escrituração são exatamente o que alguém precisa para achar o
 * lançamento do outro lado.
 */
export const COLUNAS_DE_EVIDENCIA = [
  "codfil",
  "serie",
  "tipdoc",
  "analit",
  "analitica",
  "sintet",
  "sintetica",
  "observacao",
  "datatu",
  "situac",
  "unidade",
  "codunn",
] as const;

export interface LinhaDoExtrato {
  rowIndex: number;
  /** `YYYY-MM-01` — a competência, derivada de `MES` e `ANO`. */
  competencia: string;
  mes: number;
  ano: number;
  /** Maiúscula, sem hífen nem espaço: a forma que casa com o acervo. */
  placa: string;
  /** Como o arquivo a escreveu. Nunca normalizada. */
  placaRaw: string;
  numdoc: string;
  /** A despesa em positivo — o módulo de `VLRREA`. */
  valorAbsoluto: number;
  /** `VLRREA` como veio, com o sinal do razão. */
  valorOriginal: number;
  codfil: string | null;
  serie: string | null;
  tipdoc: string | null;
  contaAnaliticaCodigo: string | null;
  contaAnalitica: string | null;
  contaSinteticaCodigo: string | null;
  contaSintetica: string | null;
  /** `OBSERVACAO` — o código interno do veículo no ERP. */
  codvei: string | null;
  datatu: string | null;
  situac: string | null;
  unidadeRaw: string | null;
  codunn: string | null;
  /**
   * A impressão digital da linha: todas as células, em ordem de cabeçalho.
   *
   * É o que distingue duplicata provável de lançamento distinto — duas linhas
   * iguais em **tudo**, inclusive na data de escrituração, contra duas que
   * diferem em alguma coisa. Ver `agregacao.ts`.
   */
  impressaoDigital: string;
}

export interface LinhaRecusada {
  rowIndex: number;
  codigo:
    | "COMPETENCIA_ILEGIVEL"
    | "PLACA_AUSENTE"
    | "VALOR_ILEGIVEL"
    | "DOCUMENTO_AUSENTE";
  /** O que a linha trazia, para que a recusa seja conferível sem abrir o arquivo. */
  evidencia: string;
  mensagem: string;
}

export interface LeituraDoExtrato {
  linhas: LinhaDoExtrato[];
  recusadas: LinhaRecusada[];
}

/**
 * A placa na forma que casa com o acervo.
 *
 * O extrato escreve `QYZ-3E44`; o export de remuneração escreve `QYZ3E44`. São
 * a mesma placa, e precisam ser a mesma **entidade** — `entity_identifier` é
 * único por (tipo, valor), de modo que a diferença de um hífen faria o real de
 * um caminhão viver numa entidade e o remunerado dele em outra, sem cruzamento
 * possível. Que é a única coisa que esta auditoria existe para fazer.
 */
export function normalizarPlaca(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** `MES` + `ANO` viram o primeiro dia do mês — a competência. */
export function competenciaDe(mes: number, ano: number): string | null {
  if (!Number.isInteger(mes) || !Number.isInteger(ano)) return null;
  if (mes < 1 || mes > 12) return null;
  if (ano < 1900 || ano > 2999) return null;
  return `${String(ano).padStart(4, "0")}-${String(mes).padStart(2, "0")}-01`;
}

/**
 * Um número do ERP, que chega ora como número, ora como texto.
 *
 * O mesmo export entrega `-5896.428` e `"0.00000000000"`, e escreve `"NULL"`
 * como palavra onde não há valor. Ponto é o separador decimal em todos eles —
 * não há vírgula neste arquivo, e supor uma inverteria milhar com decimal no
 * dia em que o ERP mudar de locale. Quando a suposição não se sustenta, a
 * resposta é `null` e a linha é recusada com o texto original na evidência.
 */
export function numeroDoErp(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const texto = raw.trim();
  if (texto === "" || texto.toUpperCase() === "NULL") return null;
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return null;
  const valor = Number(texto);
  return Number.isFinite(valor) ? valor : null;
}

function texto(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  if (limpo === "" || limpo.toUpperCase() === "NULL") return null;
  return limpo;
}

/**
 * Lê as linhas do extrato, recusando uma a uma o que não dá para ler.
 *
 * Recusa **a linha**, e nunca o arquivo: um lançamento sem placa não invalida
 * os outros 902, e derrubar a importação inteira por causa dele esconderia o
 * mês todo em nome de uma linha. O que a linha recusada não faz é sumir — ela
 * sai em `recusadas`, com o código e a evidência, e o relatório a conta.
 */
export function lerExtrato(linhas: readonly LinhaBrutaDoExtrato[]): LeituraDoExtrato {
  const lidas: LinhaDoExtrato[] = [];
  const recusadas: LinhaRecusada[] = [];

  for (const linha of linhas) {
    const c = linha.celulas;
    const mes = numeroDoErp(c["mes"]);
    const ano = numeroDoErp(c["ano"]);
    const competencia = mes !== null && ano !== null ? competenciaDe(mes, ano) : null;
    if (competencia === null) {
      recusadas.push({
        rowIndex: linha.rowIndex,
        codigo: "COMPETENCIA_ILEGIVEL",
        evidencia: `MES=${c["mes"] ?? "∅"} ANO=${c["ano"] ?? "∅"}`,
        mensagem:
          "A competência do lançamento não pôde ser lida de MES e ANO. Sem mês não " +
          "há em que vigência consolidar este valor, e escolher um seria inventá-lo.",
      });
      continue;
    }

    const placaRaw = texto(c["placa"]);
    const placa = normalizarPlaca(placaRaw);
    if (placa === "") {
      recusadas.push({
        rowIndex: linha.rowIndex,
        codigo: "PLACA_AUSENTE",
        evidencia: `Placa=${c["placa"] ?? "∅"}`,
        mensagem:
          "O lançamento não diz de que veículo é. Sem placa não há a que ativo " +
          "atribuir a despesa, e o realizado desta linha não tem como ser comparado.",
      });
      continue;
    }

    const valorOriginal = numeroDoErp(c["vlrrea"]);
    if (valorOriginal === null) {
      recusadas.push({
        rowIndex: linha.rowIndex,
        codigo: "VALOR_ILEGIVEL",
        evidencia: `VLRREA=${c["vlrrea"] ?? "∅"}`,
        mensagem:
          "O valor realizado não pôde ser lido como número. Ele fica de fora da " +
          "soma e a competência é marcada como incompleta — zero no lugar dele " +
          "diria que o banco não cobrou nada naquele mês.",
      });
      continue;
    }

    const numdoc = texto(c["numdoc"]);
    if (numdoc === null) {
      recusadas.push({
        rowIndex: linha.rowIndex,
        codigo: "DOCUMENTO_AUSENTE",
        evidencia: `NUMDOC=${c["numdoc"] ?? "∅"}`,
        mensagem:
          "O lançamento não traz documento. Sem ele não há como dizer se duas " +
          "linhas da mesma placa no mesmo mês são o mesmo pagamento ou dois.",
      });
      continue;
    }

    lidas.push({
      rowIndex: linha.rowIndex,
      competencia,
      mes: mes as number,
      ano: ano as number,
      placa,
      placaRaw: placaRaw as string,
      numdoc,
      valorAbsoluto: Math.abs(valorOriginal),
      valorOriginal,
      codfil: texto(c["codfil"]),
      serie: texto(c["serie"]),
      tipdoc: texto(c["tipdoc"]),
      contaAnaliticaCodigo: texto(c["analit"]),
      contaAnalitica: texto(c["analitica"]),
      contaSinteticaCodigo: texto(c["sintet"]),
      contaSintetica: texto(c["sintetica"]),
      codvei: texto(c["observacao"]),
      datatu: texto(c["datatu"]),
      situac: texto(c["situac"]),
      unidadeRaw: texto(c["unidade"]),
      codunn: texto(c["codunn"]),
      impressaoDigital: impressaoDigitalDe(c),
    });
  }

  return { linhas: lidas, recusadas };
}

/**
 * A impressão digital de uma linha: todas as suas células, em ordem estável.
 *
 * Calculada sobre o conteúdo inteiro, e não sobre as colunas que interessam, de
 * propósito: duas linhas que diferem só em `DATATU` **não** são duplicata, e
 * uma impressão digital que ignorasse a data as fundiria. Neste arquivo são 14
 * pares exatamente assim — mesma placa, mesmo mês, mesmo valor, documentos e
 * datas diferentes —, e eles são dois pagamentos, não um repetido.
 */
function impressaoDigitalDe(celulas: Record<string, string | null>): string {
  return Object.keys(celulas)
    .sort()
    .map((chave) => `${chave}=${celulas[chave] ?? "∅"}`)
    .join("\u0001");
}
