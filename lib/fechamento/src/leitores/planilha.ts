import * as XLSX from "xlsx";

/**
 * A leitura crua de uma planilha, comum aos quatro leitores de `.xlsx`.
 *
 * Quatro decisões moram aqui, e todas existem para que os leitores acima não
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
 * Lê uma aba, localizando o cabeçalho pelas colunas que a fonte precisa ter.
 *
 * `aba` é o nome esperado; quando ele não existe, a primeira aba é usada — as
 * exportações do Promax nomeiam a aba com o número da rotina (`03.08.15`), mas
 * quem salva de dentro da pasta de fechamento renomeia com frequência, e o
 * layout é que identifica a fonte, não o nome da aba.
 */
export function lerAba(
  arquivo: Buffer | ArrayBuffer,
  opcoes: { aba?: string; exigidas: string[] },
): PlanilhaLida {
  const wb = XLSX.read(arquivo, { type: "buffer", cellDates: false, raw: true });
  const nomeDaAba =
    opcoes.aba && wb.SheetNames.includes(opcoes.aba) ? opcoes.aba : wb.SheetNames[0];
  const sheet = wb.Sheets[nomeDaAba];
  if (!sheet) throw new CabecalhoNaoEncontrado(nomeDaAba ?? "(vazia)", opcoes.exigidas);

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const cabecalho = acharCabecalho(matriz, opcoes.exigidas);
  if (!cabecalho) throw new CabecalhoNaoEncontrado(nomeDaAba, opcoes.exigidas);

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
    linhas.push({ numero: i + 1, celulas });
  }

  return { aba: nomeDaAba, cabecalho: cabecalho.nomes, linhas };
}

/** Todas as abas de uma planilha, pelo nome. */
export function nomesDasAbas(arquivo: Buffer | ArrayBuffer): string[] {
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
