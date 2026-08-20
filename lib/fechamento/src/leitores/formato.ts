/**
 * De que forma o arquivo chegou — e nunca pela extensão do nome dele.
 *
 * As seis fontes do fechamento não têm um formato só. O mesmo 03.08.15 sai do
 * Promax em `.xlsx` quando alguém o exporta pela tela e em `.csv` quando o
 * exporta pela fila de relatórios; o 03.02.59.02 sai em `.txt` de largura fixa
 * e em `.csv` delimitado; e um `.txt` renomeado para `.csv` (ou o contrário)
 * chega todo dia na mão de quem opera. A extensão é o que alguém digitou; os
 * bytes são o que o arquivo é.
 *
 * Por isso a decisão mora aqui, uma vez, a partir do conteúdo:
 *
 * - **Planilha** se os bytes começarem com a assinatura de um ZIP (que é o que
 *   um `.xlsx` é) ou de um documento composto OLE2 (que é o que um `.xls` é).
 * - **Texto**, em qualquer outro caso — e aí a pergunta seguinte é se esse
 *   texto é delimitado ou de largura fixa, que `separadorDe` responde.
 *
 * A regra do módulo continua sendo a de `dominio.ts`: **nada é inferido**.
 * Quando o texto não deixa claro que é delimitado, ele não vira delimitado por
 * decisão nossa — `separadorDe` devolve `null` e quem chama lê largura fixa,
 * que é o que o arquivo aparenta ser.
 */

/** Os bytes, seja qual for o invólucro em que eles chegaram. */
export function bytesDe(arquivo: Buffer | ArrayBuffer | Uint8Array): Uint8Array {
  if (arquivo instanceof Uint8Array) return arquivo;
  return new Uint8Array(arquivo);
}

function comecaCom(bytes: Uint8Array, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((byte, i) => bytes[i] === byte);
}

/** `PK` — todo `.xlsx` (e todo `.xlsm`, `.ods`) é um ZIP. */
const ZIP = [0x50, 0x4b];
/** O cabeçalho do documento composto OLE2 — o `.xls` do Excel 97-2003. */
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * O arquivo é uma planilha binária?
 *
 * Só isso — e não "qual planilha": distinguir `.xlsx` de `.xls` é trabalho do
 * SheetJS, que já o faz sozinho a partir dos mesmos bytes. O que este módulo
 * precisa decidir é apenas se há uma planilha para abrir ou um texto para ler.
 */
export function ehPlanilha(arquivo: Buffer | ArrayBuffer | Uint8Array): boolean {
  const bytes = bytesDe(arquivo);
  return comecaCom(bytes, ZIP) || comecaCom(bytes, OLE2);
}

/**
 * As marcas de codificação que o próprio arquivo carrega.
 *
 * Uma BOM não é palpite: é o arquivo declarando em que codificação foi
 * escrito. É por isso que ela pode ser lida sem violar a regra de não
 * adivinhar — e é por isso que, na ausência dela, a codificação continua sendo
 * a declarada pela origem (latin-1, o que o SRTrans e o Promax exportam) em
 * vez de uma tentativa de UTF-8 com queda para latin-1, que produziria
 * palavras diferentes para os mesmos bytes conforme o acaso.
 *
 * A BOM aparece porque o caminho do arquivo passou a incluir o Excel: quem
 * abre o `.csv` do SRTrans e o salva como "CSV UTF-8" devolve um arquivo com
 * `EF BB BF` na frente, e lê-lo como latin-1 transformaria `Requisição` em
 * `RequisiÃ§Ã£o` — o mesmo estrago que a origem latin-1 lida como UTF-8 faria
 * ao contrário.
 */
const BOMS: { bytes: number[]; codificacao: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], codificacao: "utf-8" },
  { bytes: [0xff, 0xfe], codificacao: "utf-16le" },
  { bytes: [0xfe, 0xff], codificacao: "utf-16be" },
];

/**
 * O texto do arquivo: latin-1, salvo quando o arquivo declara outra coisa.
 *
 * Os leitores de texto do fechamento chamavam `new TextDecoder("latin1")` cada
 * um por si, o que estava certo enquanto a única origem era o Promax. Com o
 * Excel no caminho, a declaração do arquivo passou a existir em alguns casos,
 * e a decisão precisa ser a mesma nos seis leitores — daí ela vir para cá.
 */
export function decodificarTexto(arquivo: Buffer | ArrayBuffer | Uint8Array | string): string {
  if (typeof arquivo === "string") return arquivo;
  const bytes = bytesDe(arquivo);
  for (const bom of BOMS) {
    if (comecaCom(bytes, bom.bytes)) {
      return new TextDecoder(bom.codificacao).decode(bytes.subarray(bom.bytes.length));
    }
  }
  return new TextDecoder("latin1").decode(bytes);
}

/**
 * Os separadores que um relatório destas origens pode usar.
 *
 * A ordem é a da confiança. `;`, tabulação e `|` **não ocorrem** nos layouts
 * de largura fixa do Promax: quando um deles aparece de forma regular, o
 * arquivo é delimitado e não há outra explicação. A vírgula é o caso perigoso,
 * porque ela é a casa decimal de todo valor em português (`1.000,00`) — e é
 * por isso que ela só é aceita sob a condição bem mais dura de `A_VIRGULA_E_DECIMAL`.
 */
const SEPARADORES = [";", "\t", "|", ","] as const;
export type Separador = (typeof SEPARADORES)[number];

/**
 * Uma vírgula entre um dígito e dois dígitos: a casa decimal do português.
 *
 * É o que separa `1.000,00` de `nome,sobrenome`, e é o motivo de a vírgula não
 * poder ser tratada como os outros três separadores. Um relatório de largura
 * fixa do Promax é feito de números em português: as vírgulas dele são todas
 * decimais, aparecem em quase toda linha e — se a linha tiver sempre dois
 * valores — aparecem com uma regularidade que passaria em qualquer teste de
 * consistência. Foi por isso que o teste de consistência não bastou.
 */
const A_VIRGULA_E_DECIMAL = /\d,\d{2}(?!\d)/;

/** Quantas vezes o caractere aparece fora de aspas — a única contagem que vale. */
function ocorrenciasForaDeAspas(linha: string, separador: string): number {
  let dentro = false;
  let total = 0;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') {
      /* `""` dentro de um campo entre aspas é uma aspa escapada, não o fim dele. */
      if (dentro && linha[i + 1] === '"') {
        i += 1;
        continue;
      }
      dentro = !dentro;
      continue;
    }
    if (!dentro && c === separador) total += 1;
  }
  return total;
}

/** O valor que mais se repete, e em quantas linhas. */
function moda(contagens: number[]): { valor: number; vezes: number } {
  const quantas = new Map<number, number>();
  for (const c of contagens) quantas.set(c, (quantas.get(c) ?? 0) + 1);
  let valor = 0;
  let vezes = 0;
  for (const [c, n] of quantas) {
    if (n > vezes || (n === vezes && c > valor)) {
      valor = c;
      vezes = n;
    }
  }
  return { valor, vezes };
}

/** O texto sem o que está entre aspas — onde um separador não separa nada. */
function foraDasAspas(texto: string): string {
  return texto.replace(/"(?:[^"]|"")*"/g, "");
}

/**
 * O separador do texto — ou `null` quando ele não é delimitado.
 *
 * O teste é de **regularidade**, e não de presença: um arquivo delimitado tem
 * o mesmo número de separadores em quase toda linha, porque toda linha tem as
 * mesmas colunas. Um `;` ou uma tabulação com essa regularidade num relatório
 * do Promax é a declaração de que o arquivo é delimitado — eles não existem no
 * layout de largura fixa, e duas linhas concordando já bastam.
 *
 * **A vírgula não entra por esse caminho, e a diferença é deliberada.** Ela só
 * é considerada quando o arquivo inteiro não tem uma única casa decimal em
 * português (ver `A_VIRGULA_E_DECIMAL`) — isto é, quando nenhuma vírgula do
 * arquivo pode ser outra coisa senão separador. Um `.txt` de largura fixa
 * confundido com CSV não daria erro: daria um relatório inteiro lido pelas
 * colunas erradas, que é o desfecho que este módulo existe para impedir.
 */
export function separadorDe(texto: string): Separador | null {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length === 0) return null;
  const virgulaEhDecimal = A_VIRGULA_E_DECIMAL.test(foraDasAspas(texto));

  for (const separador of SEPARADORES) {
    if (separador === "," && virgulaEhDecimal) continue;

    const contagens = linhas.map((l) => ocorrenciasForaDeAspas(l, separador));
    const comSeparador = contagens.filter((c) => c > 0);
    if (comSeparador.length === 0) continue;

    const { valor, vezes } = moda(comSeparador);
    if (valor === 0) continue;
    /* Duas linhas concordando bastam, desde que não sejam um acidente isolado
       no meio de um arquivo que não tem nada a ver com elas. */
    if (vezes >= 2 && vezes >= Math.ceil(linhas.length * 0.2)) return separador;
  }
  return null;
}

/**
 * O texto delimitado em matriz, e a linha física onde cada registro começou.
 *
 * O parser é o do RFC 4180, com o que os exportadores reais fazem: campo entre
 * aspas, aspa dobrada dentro dele, e quebra de linha dentro do campo. A linha
 * física é guardada porque toda recusa do fechamento aponta onde — e um campo
 * com quebra de linha faz o número do registro divergir do número da linha do
 * arquivo, que é o que quem abre o arquivo no editor vai procurar.
 */
export function matrizDelimitada(
  texto: string,
  separador: string,
): { matriz: string[][]; linhaFisica: number[] } {
  /*
    O caminho rápido, para o arquivo sem uma única aspa — que é o que o Promax
    e o SRTrans exportam. Sem aspas não há campo com separador dentro nem campo
    com quebra de linha, então cortar por linha e por separador dá exatamente o
    mesmo resultado que o autômato abaixo, sem percorrer caractere a caractere:
    o 03.08.15 de uma quinzena real tem 23 mil linhas.
  */
  if (!texto.includes('"')) {
    const linhas = texto.split(/\r?\n/);
    return {
      matriz: linhas.map((l) => l.replace(/\r$/, "").split(separador)),
      linhaFisica: linhas.map((_, i) => i + 1),
    };
  }

  const matriz: string[][] = [];
  const linhaFisica: number[] = [];

  let campos: string[] = [];
  let campo = "";
  let dentroDeAspas = false;
  /** A linha física que está sendo consumida agora. */
  let linhaAtual = 1;
  /** A linha física em que o registro em construção começou. */
  let inicioDoRegistro = 1;

  const fecharRegistro = () => {
    campos.push(campo);
    campo = "";
    matriz.push(campos);
    linhaFisica.push(inicioDoRegistro);
    campos = [];
  };

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];

    if (dentroDeAspas) {
      if (c === '"') {
        /* `""` é uma aspa escapada; uma aspa sozinha fecha o campo. */
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
          continue;
        }
        dentroDeAspas = false;
        continue;
      }
      if (c === "\n") linhaAtual += 1;
      campo += c;
      continue;
    }

    if (c === '"' && campo === "") {
      dentroDeAspas = true;
      continue;
    }
    if (c === separador) {
      campos.push(campo);
      campo = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      fecharRegistro();
      linhaAtual += 1;
      inicioDoRegistro = linhaAtual;
      continue;
    }
    campo += c;
  }

  /* A última linha sem quebra no fim ainda é um registro. */
  if (campo !== "" || campos.length > 0) fecharRegistro();

  return { matriz, linhaFisica };
}

/**
 * Um relatório de texto, lido de um jeito que serve aos dois formatos em que
 * ele chega.
 *
 * O 03.08.20 e o 03.02.59.02 nasceram de largura fixa: o Promax alinha as
 * colunas com espaço, e no segundo deles **a posição do número é o dado** — o
 * mesmo `17.398,54` significa uma coisa terminando na coluna 75 e outra
 * terminando na 88. Quando o mesmo relatório sai delimitado, essa régua deixa
 * de existir e quem passa a dizer a coluna é o campo.
 *
 * Por isso a leitura devolve as duas visões da mesma linha:
 *
 * - `linhas` — o texto da linha, que é onde os leitores procuram cabeçalho,
 *   seção, bloco e aviso. No arquivo delimitado ela é remontada juntando os
 *   campos preenchidos com dois espaços, que é o vão que o relatório de
 *   largura fixa usa entre uma coluna e outra: as expressões que já liam
 *   `Transportadora  36  NOME` continuam lendo, sem uma segunda gramática.
 * - `campos` — os campos crus, **só** quando o arquivo é delimitado. É deles
 *   que sai o valor, porque o índice do campo é o que substitui a posição do
 *   caractere. Num arquivo de largura fixa vem `null`, e o leitor usa a régua.
 *
 * Juntar os campos preenchidos e descartar os vazios é seguro para a primeira
 * visão e não para a segunda — e é exatamente por isso que as duas existem
 * separadas. `Desconto Frete Minimo;;;325,00` remontado vira
 * `Desconto Frete Minimo  325,00`, onde não há mais como saber que o valor
 * estava na segunda coluna de dinheiro; nos campos, há.
 */
export interface TextoDeRelatorio {
  linhas: string[];
  campos: string[][] | null;
  /** A linha física de cada entrada de `linhas`, 1-based. */
  linhaFisica: number[];
  separador: Separador | null;
}

export function lerTextoDeRelatorio(
  arquivo: Buffer | ArrayBuffer | Uint8Array | string,
): TextoDeRelatorio {
  const texto = decodificarTexto(arquivo);
  const separador = separadorDe(texto);
  if (separador === null) {
    const linhas = texto.split(/\r?\n/);
    return { linhas, campos: null, linhaFisica: linhas.map((_, i) => i + 1), separador: null };
  }
  const { matriz, linhaFisica } = matrizDelimitada(texto, separador);
  return {
    linhas: matriz.map((campos) => campos.map((c) => c.trim()).filter((c) => c !== "").join("  ")),
    campos: matriz,
    linhaFisica,
    separador,
  };
}
