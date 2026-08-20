import * as XLSX from "xlsx";
import {
  decodificarTexto,
  ehPlanilha,
  matrizDelimitada,
  separadorDe,
} from "./formato";

/**
 * A leitura crua de uma tabela, comum aos quatro leitores tabulares.
 *
 * **Tabela, e não planilha.** O mesmo relatório chega em `.xlsx` quando alguém
 * o exporta pela tela do Promax e em `.csv` quando o exporta pela fila de
 * relatórios — e chega em `.txt` quando o caminho passou por um sistema que
 * renomeia. As três formas trazem o mesmo cabeçalho e as mesmas colunas, e o
 * que muda é só como os bytes empacotam a grade. Por isso o formato é decidido
 * pelo conteúdo (ver `formato.ts`) e a grade é normalizada aqui: acima deste
 * arquivo, um leitor não sabe nem precisa saber em que formato a fonte chegou.
 *
 * Cinco decisões moram aqui, e todas existem para que os leitores acima não
 * precisem conhecer o SheetJS:
 *
 * 1. **A célula chega como veio.** `raw: true` desliga a formatação: uma data
 *    serial permanece `46219` e uma moeda permanece `74050.4`. Quem interpreta
 *    é o leitor da fonte, que sabe qual dos três formatos de data aquela
 *    coluna usa — deixar o SheetJS decidir seria adivinhação com cara de
 *    conversão.
 * 2. **O cabeçalho é procurado, não presumido.** A planilha do 03.08.15 tem
 *    três linhas de totais antes do cabeçalho quando exportada de dentro da
 *    pasta de fechamento, e nenhuma quando exportada direto do Promax. Achar a
 *    linha que contém as colunas esperadas cobre os dois casos sem
 *    configuração.
 * 3. **A linha física é preservada.** Toda linha lida carrega o número que o
 *    Excel mostra, porque uma recusa que não diz onde não serve para ninguém.
 * 4. **O nome da coluna vale sem os espaços.** `ValorFrete` e `VALOR FRETE`
 *    são a mesma coluna escrita por dois exportadores diferentes do mesmo
 *    relatório — ver `compactarColuna`.
 * 5. **O texto delimitado entra pela mesma porta.** Um `.csv` vira a mesma
 *    matriz que uma aba viraria, e daí em diante o caminho é um só. A única
 *    diferença que sobrevive é o tipo da célula: a planilha entrega número
 *    nativo e o texto entrega texto, e é `lerNumero` (em `dominio.ts`) que
 *    lê as duas formas — `1.000,00` e `1000` chegam ao mesmo lugar.
 */

export interface LinhaDePlanilha {
  /** A linha física, 1-based, como o Excel a numera. */
  numero: number;
  /** Coluna (pelo nome no cabeçalho) → valor cru. */
  celulas: Record<string, unknown>;
}

export interface PlanilhaLida {
  aba: string;
  cabecalho: string[];
  linhas: LinhaDePlanilha[];
}

/** Normaliza um nome de coluna para comparação: sem acento, sem caixa, sem espaço duplo. */
export function normalizarColuna(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * O mesmo nome, sem o que só separa palavras — espaço, ponto, hífen, `%`.
 *
 * Existe porque a mesma coluna chega escrita de dois jeitos conforme quem
 * exportou: o 2Art salvo do Promax escreve `CxCarreg` e `ValorFrete`, e o
 * mesmo relatório salvo de dentro da pasta de fechamento escreve `CX CARREG` e
 * `VALOR FRETE`. São o mesmo dado, e um leitor que só reconhece uma das grafias
 * recusa metade das exportações reais — inclusive no cabeçalho, onde a recusa
 * não é de uma coluna, é do arquivo inteiro.
 *
 * A forma compacta é **fallback**, nunca a primeira via: o nome exato manda, e
 * só quando ele não existe é que se procura por aqui. Assim duas colunas
 * distintas que colapsem na mesma forma continuam sendo lidas pelo nome que
 * cada uma tem.
 */
export function compactarColuna(nome: string): string {
  return normalizarColuna(nome).replace(/[^a-z0-9]/g, "");
}

/**
 * Encontra a linha de cabeçalho: a primeira que contém **todas** as colunas
 * exigidas.
 *
 * Exigir todas, e não alguma, é o que impede uma linha de título de ser
 * confundida com o cabeçalho quando ela por acaso repete uma das palavras.
 */
function acharCabecalho(
  matriz: unknown[][],
  exigidas: string[],
): { indice: number; nomes: string[] } | null {
  for (let i = 0; i < matriz.length && i < 50; i += 1) {
    const linha = matriz[i] ?? [];
    const nomes = linha.map((c) => (typeof c === "string" ? c : c == null ? "" : String(c)));
    const presentes = new Set([
      ...nomes.map(normalizarColuna),
      ...nomes.map(compactarColuna),
    ]);
    const tem = (nome: string) =>
      presentes.has(normalizarColuna(nome)) || presentes.has(compactarColuna(nome));
    if (exigidas.every(tem)) return { indice: i, nomes };
  }
  return null;
}

export class CabecalhoNaoEncontrado extends Error {
  constructor(
    readonly aba: string,
    readonly exigidas: string[],
  ) {
    super(
      `A aba "${aba}" não tem a linha de cabeçalho esperada. ` +
        `Faltou pelo menos uma destas colunas: ${exigidas.join(", ")}.`,
    );
    this.name = "CabecalhoNaoEncontrado";
  }
}

/**
 * O nome que uma tabela de texto recebe no lugar do nome da aba.
 *
 * Um `.csv` não tem abas — tem uma tabela só. Chamá-la de `"Sheet1"` seria
 * inventar um nome de planilha para um arquivo que não é uma; este nome diz o
 * que ela é, e aparece assim na recusa que cita a aba.
 */
export const TABELA_DE_TEXTO = "(tabela do arquivo de texto)";

/**
 * O arquivo é texto, mas não é uma tabela.
 *
 * Acontece quando alguém envia na aba de uma fonte tabular o `.txt` de largura
 * fixa de outra — o 03.08.20 na aba do 03.08.15, por exemplo. A recusa diz
 * isso em vez de falar de cabeçalho ausente, porque o problema não é a coluna
 * que faltou: é o arquivo que não tem colunas.
 */
export class TabelaNaoDelimitada extends Error {
  constructor(readonly linhas: number) {
    super(
      "O arquivo é texto, mas não está separado em colunas: nenhuma das linhas " +
        `se divide por ponto e vírgula, tabulação, barra vertical ou vírgula (${linhas} linha(s) lidas). ` +
        "Se ele for um relatório de largura fixa, ele pertence a outra fonte — confira a aba de envio.",
    );
    this.name = "TabelaNaoDelimitada";
  }
}

/** A grade do arquivo, seja ele planilha ou texto delimitado. */
interface Grade {
  nome: string;
  matriz: unknown[][];
  /** A linha física de cada linha da matriz, 1-based. */
  linhaFisica: number[];
}

/**
 * A tabela do arquivo, normalizada — a única função que conhece os formatos.
 *
 * `aba` só tem sentido numa planilha. Num texto delimitado ela é ignorada, e
 * não recusada: o arquivo tem uma tabela e é essa que se lê. Quem precisa das
 * duas abas do 03.08.18 confere `nomesDasAbas` antes e decide lá, com o
 * vocabulário da fonte, o que fazer com um arquivo que só traz uma.
 */
function grade(arquivo: Buffer | ArrayBuffer, aba: string | undefined): Grade {
  if (!ehPlanilha(arquivo)) {
    const texto = decodificarTexto(arquivo);
    const separador = separadorDe(texto);
    if (separador === null) {
      throw new TabelaNaoDelimitada(texto.split(/\r?\n/).length);
    }
    const { matriz, linhaFisica } = matrizDelimitada(texto, separador);
    return { nome: TABELA_DE_TEXTO, matriz, linhaFisica };
  }

  const wb = XLSX.read(arquivo, { type: "buffer", cellDates: false, raw: true });
  const nome = aba && wb.SheetNames.includes(aba) ? aba : wb.SheetNames[0];
  const sheet = nome ? wb.Sheets[nome] : undefined;
  if (!sheet) return { nome: nome ?? "(vazia)", matriz: [], linhaFisica: [] };

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  return { nome, matriz, linhaFisica: matriz.map((_, i) => i + 1) };
}

/**
 * Lê uma tabela, localizando o cabeçalho pelas colunas que a fonte precisa ter.
 *
 * `aba` é o nome esperado; quando ele não existe, a primeira aba é usada — as
 * exportações do Promax nomeiam a aba com o número da rotina (`03.08.15`), mas
 * quem salva de dentro da pasta de fechamento renomeia com frequência, e o
 * layout é que identifica a fonte, não o nome da aba. Num arquivo de texto não
 * há aba nenhuma, e o parâmetro não se aplica.
 */
export function lerAba(
  arquivo: Buffer | ArrayBuffer,
  opcoes: { aba?: string; exigidas: string[] },
): PlanilhaLida {
  const { nome: nomeDaTabela, matriz, linhaFisica } = grade(arquivo, opcoes.aba);
  if (matriz.length === 0) throw new CabecalhoNaoEncontrado(nomeDaTabela, opcoes.exigidas);

  const cabecalho = acharCabecalho(matriz, opcoes.exigidas);
  if (!cabecalho) throw new CabecalhoNaoEncontrado(nomeDaTabela, opcoes.exigidas);

  const linhas: LinhaDePlanilha[] = [];
  for (let i = cabecalho.indice + 1; i < matriz.length; i += 1) {
    const bruta = matriz[i] ?? [];
    if (bruta.every((c) => c == null || c === "")) continue;
    const celulas: Record<string, unknown> = {};
    cabecalho.nomes.forEach((nome, coluna) => {
      if (nome) celulas[normalizarColuna(nome)] = bruta[coluna] ?? null;
    });
    /* Os apelidos entram depois de todos os nomes exatos, e nunca por cima de
       um: uma coluna que já existe pelo nome dela não pode ser encoberta pela
       forma compacta de outra. */
    cabecalho.nomes.forEach((nome, coluna) => {
      if (!nome) return;
      const apelido = compactarColuna(nome);
      if (apelido && !(apelido in celulas)) celulas[apelido] = bruta[coluna] ?? null;
    });
    linhas.push({ numero: linhaFisica[i] ?? i + 1, celulas });
  }

  return { aba: nomeDaTabela, cabecalho: cabecalho.nomes, linhas };
}

/**
 * Todas as abas de uma planilha, pelo nome.
 *
 * Um arquivo de texto não tem abas, e a lista vem vazia — o que é a verdade
 * sobre ele, e não uma falha. Quem depende das abas para saber o que está
 * lendo (só o 03.08.18) trata a lista vazia com o vocabulário da própria
 * fonte.
 */
export function nomesDasAbas(arquivo: Buffer | ArrayBuffer): string[] {
  if (!ehPlanilha(arquivo)) return [];
  return XLSX.read(arquivo, { type: "buffer", bookSheets: true }).SheetNames;
}

/**
 * O valor de uma coluna, pelo nome normalizado — e, na falta dele, pela forma
 * compacta (ver `compactarColuna`).
 */
export function celula(linha: LinhaDePlanilha, coluna: string): unknown {
  const nome = normalizarColuna(coluna);
  if (nome in linha.celulas) return linha.celulas[nome] ?? null;
  return linha.celulas[compactarColuna(coluna)] ?? null;
}
