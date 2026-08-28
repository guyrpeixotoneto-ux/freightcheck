/**
 * LER UM .XLSX — a volta do modelo, sem biblioteca nova.
 *
 * `lib/xlsx-minimo.ts` escreve; este arquivo lê. A simetria não é enfeite: o
 * modelo exportado só vira levantamento de verdade se a planilha preenchida
 * puder voltar, e um caminho de ida sem volta é o que faz a pessoa transcrever
 * quinze abas à mão — exatamente o trabalho que o modelo existia para poupar.
 *
 * ---------------------------------------------------------------------------
 * Ler é mais difícil que escrever, e por dois motivos
 * ---------------------------------------------------------------------------
 *
 * Escrever é escolher um subconjunto do formato; ler é aceitar o que o Excel
 * (ou o LibreOffice, ou o Sheets) resolveu emitir. As duas diferenças que
 * importam:
 *
 * - **O ZIP vem comprimido.** O nosso sai armazenado, o deles sai em `deflate`.
 *   Aqui o `deflate` não é escrito à mão: o navegador tem
 *   `DecompressionStream("deflate-raw")`, e é ele que descomprime. É a razão de
 *   a leitura ser assíncrona e a escrita não.
 * - **O texto vem da tabela compartilhada.** O Excel guarda cada string uma vez
 *   em `sharedStrings.xml` e escreve o índice na célula (`t="s"`). Quem ignora
 *   isso lê uma planilha inteira de números.
 *
 * O XML é lido por expressão regular, e não por `DOMParser`. É deliberado: o
 * XML aqui é gerado por máquina e regular, e a expressão regular mantém a
 * leitura como **função pura** — testável neste pacote, que não monta DOM (ver
 * `vitest.config.ts`). O único ponto assíncrono é a descompressão.
 *
 * O que este leitor entrega é uma matriz de texto por aba, e nada além: fórmula
 * vira o valor que o Excel calculou por último, número vira o texto que estava
 * na célula, data vira o serial que o Excel guarda. Como o modelo só tem texto,
 * isso basta — e o que fazer com as linhas é problema de
 * `lib/fluxos-modelo-leitura.ts`, não deste arquivo.
 */

export interface PlanilhaLida {
  nome: string;
  /** As linhas, densas: uma linha em branco no meio da aba vira `[]`. */
  linhas: string[][];
}

export interface PastaLida {
  planilhas: PlanilhaLida[];
}

/** A recusa nomeada da leitura — a frase que a tela mostra sem traduzir. */
export class ArquivoIlegivel extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ArquivoIlegivel";
  }
}

// ---------------------------------------------------------------------------
// O ZIP, do fim para o começo
// ---------------------------------------------------------------------------

export interface EntradaDoZip {
  nome: string;
  /** 0 = armazenado, 8 = deflate. Qualquer outro este leitor recusa. */
  metodo: number;
  /** Os bytes como estão no arquivo — ainda comprimidos quando o método é 8. */
  dados: Uint8Array;
}

/**
 * As entradas de um ZIP, lidas pelo diretório central.
 *
 * Pelo diretório, e não varrendo cabeçalhos locais do começo: o cabeçalho local
 * pode declarar tamanho zero quando o escritor usou descritor de dados (o Excel
 * usa, ao salvar em fluxo), e quem confia nele lê arquivo vazio. O diretório
 * central é a autoridade do formato, e é o que toda ferramenta lê.
 */
export function entradasDoZip(bytes: Uint8Array): EntradaDoZip[] {
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /*
    O fim do diretório central fica nos últimos 22 bytes — a menos que o
    arquivo tenha comentário, e aí ele anda para trás. A varredura é de trás
    para a frente, e para no limite do que um comentário pode ter (64 KB).
  */
  const minimo = Math.max(0, bytes.length - 22 - 0xffff);
  let fim = -1;
  for (let i = bytes.length - 22; i >= minimo; i -= 1) {
    if (visao.getUint32(i, true) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ArquivoIlegivel("O arquivo não é uma planilha .xlsx.");

  const quantas = visao.getUint16(fim + 10, true);
  const inicio = visao.getUint32(fim + 16, true);
  if (quantas === 0xffff || inicio === 0xffffffff) {
    throw new ArquivoIlegivel("A planilha está em formato ZIP64, que este leitor não abre.");
  }

  const decodificador = new TextDecoder();
  const entradas: EntradaDoZip[] = [];
  let cursor = inicio;
  for (let i = 0; i < quantas; i += 1) {
    if (cursor + 46 > bytes.length || visao.getUint32(cursor, true) !== 0x02014b50) {
      throw new ArquivoIlegivel("A planilha está corrompida — o índice interno não confere.");
    }
    const metodo = visao.getUint16(cursor + 10, true);
    const comprimido = visao.getUint32(cursor + 20, true);
    const tamanhoDoNome = visao.getUint16(cursor + 28, true);
    const tamanhoDoExtra = visao.getUint16(cursor + 30, true);
    const tamanhoDoComentario = visao.getUint16(cursor + 32, true);
    const local = visao.getUint32(cursor + 42, true);
    const nome = decodificador.decode(bytes.subarray(cursor + 46, cursor + 46 + tamanhoDoNome));

    /*
      O cabeçalho local repete o nome e o extra — e o extra local costuma ter
      tamanho **diferente** do central. É por isso que o começo dos dados é
      calculado com os tamanhos de lá, e não com os que acabamos de ler.
    */
    const nomeLocal = visao.getUint16(local + 26, true);
    const extraLocal = visao.getUint16(local + 28, true);
    const comeco = local + 30 + nomeLocal + extraLocal;
    entradas.push({ nome, metodo, dados: bytes.subarray(comeco, comeco + comprimido) });

    cursor += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
  }
  return entradas;
}

/** Os bytes de uma entrada, descomprimidos quando é o caso. */
export async function conteudoDaEntrada(entrada: EntradaDoZip): Promise<Uint8Array> {
  if (entrada.metodo === 0) return entrada.dados;
  if (entrada.metodo !== 8) {
    throw new ArquivoIlegivel("A planilha usa uma compressão que este leitor não abre.");
  }
  if (typeof DecompressionStream === "undefined") {
    throw new ArquivoIlegivel(
      "Este navegador não sabe descompactar a planilha. Abra-a e salve de novo, ou use um navegador atual.",
    );
  }
  const fluxo = new Blob([entrada.dados as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

// ---------------------------------------------------------------------------
// O XML
// ---------------------------------------------------------------------------

/** `&amp;` e companhia de volta ao que eram, inclusive as formas numéricas. */
export function desescaparXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Todo `<t>` de um trecho, concatenado — é assim que texto rico vira string. */
function textoDe(trecho: string): string {
  const partes = trecho.match(/<t[^>]*>([\s\S]*?)<\/t>/g);
  if (!partes) return "";
  return partes
    .map((p) => desescaparXml(p.replace(/^<t[^>]*>/, "").replace(/<\/t>$/, "")))
    .join("");
}

/**
 * A tabela de textos compartilhados.
 *
 * Cada `<si>` é uma string, e uma `<si>` com formatação vem partida em vários
 * `<r>` — "Origem da **tarifa**" são dois pedaços. Juntá-los é o que faz uma
 * célula que alguém negritou no meio continuar sendo a mesma frase.
 */
export function textosCompartilhados(xml: string): string[] {
  const itens = xml.match(/<si>[\s\S]*?<\/si>|<si\/>/g);
  if (!itens) return [];
  return itens.map((si) => textoDe(si));
}

/** `B7` → coluna 1. O contrário de `letraDaColuna`. */
export function colunaDaReferencia(referencia: string): number {
  const letras = /^([A-Z]+)/.exec(referencia.toUpperCase())?.[1] ?? "";
  let indice = 0;
  for (const letra of letras) indice = indice * 26 + (letra.charCodeAt(0) - 64);
  return Math.max(0, indice - 1);
}

const ATRIBUTO = (atributos: string, nome: string): string | null =>
  new RegExp(`${nome}="([^"]*)"`).exec(atributos)?.[1] ?? null;

/**
 * Uma aba virando matriz de texto.
 *
 * A posição é lida dos atributos `r`, e não da ordem em que as marcas aparecem:
 * o Excel omite linha vazia e célula vazia, e quem empilha o que encontra
 * desloca a planilha inteira — o valor da linha 12 aparece na 9, e a importação
 * grava o campo errado sem errar nada visível.
 */
export function linhasDaPlanilha(xml: string, compartilhados: string[]): string[][] {
  const linhas: string[][] = [];
  const marcas = xml.match(/<row[^>]*\/>|<row[^>]*>[\s\S]*?<\/row>/g) ?? [];

  let seguinte = 0;
  for (const marca of marcas) {
    const atributos = /^<row([^>]*)/.exec(marca)?.[1] ?? "";
    const numero = Number(ATRIBUTO(atributos, "r") ?? seguinte + 1);
    const indice = Number.isFinite(numero) && numero > 0 ? numero - 1 : seguinte;
    seguinte = indice + 1;

    const celulas: string[] = [];
    const marcasDeCelula = marca.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) ?? [];
    let coluna = 0;
    for (const bruta of marcasDeCelula) {
      const attrs = /^<c([^>]*)/.exec(bruta)?.[1] ?? "";
      const referencia = ATRIBUTO(attrs, "r");
      const onde = referencia ? colunaDaReferencia(referencia) : coluna;
      coluna = onde + 1;

      const tipo = ATRIBUTO(attrs, "t");
      let valor = "";
      if (tipo === "inlineStr") {
        valor = textoDe(/<is>[\s\S]*?<\/is>/.exec(bruta)?.[0] ?? "");
      } else {
        const cru = /<v>([\s\S]*?)<\/v>/.exec(bruta)?.[1];
        if (cru !== undefined) {
          const texto = desescaparXml(cru);
          valor =
            tipo === "s"
              ? (compartilhados[Number(texto)] ?? "")
              : tipo === "b"
                ? texto === "1"
                  ? "sim"
                  : "não"
                : texto;
        }
      }
      while (celulas.length < onde) celulas.push("");
      celulas[onde] = valor;
    }

    while (linhas.length < indice) linhas.push([]);
    linhas[indice] = celulas;
  }
  return linhas;
}

/** As abas na ordem em que o Excel as mostra, com o arquivo de cada uma. */
export function abasDaPasta(pastaXml: string, relsXml: string): { nome: string; caminho: string }[] {
  const alvos = new Map<string, string>();
  for (const rel of relsXml.match(/<Relationship[^>]*\/>/g) ?? []) {
    const id = ATRIBUTO(rel, "Id");
    const alvo = ATRIBUTO(rel, "Target");
    if (id && alvo) alvos.set(id, alvo);
  }

  const abas: { nome: string; caminho: string }[] = [];
  for (const marca of pastaXml.match(/<sheet[^>]*\/>|<sheet[^>]*>/g) ?? []) {
    const nome = ATRIBUTO(marca, "name");
    /* O namespace do atributo varia entre escritores: `r:id` e `relationshipId`. */
    const id = ATRIBUTO(marca, "r:id") ?? ATRIBUTO(marca, "relationshipId");
    if (!nome || !id) continue;
    const alvo = alvos.get(id);
    if (!alvo) continue;
    abas.push({
      nome: desescaparXml(nome),
      caminho: alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo.replace(/^\.\//, "")}`,
    });
  }
  return abas;
}

/**
 * O arquivo inteiro, lido: as abas na ordem, com o texto de cada célula.
 *
 * O que este leitor recusa, recusa com frase: um `.xlsx` que não é `.xlsx`, um
 * ZIP64 e uma compressão desconhecida têm mensagens próprias, porque quem
 * escolheu o arquivo errado precisa saber **qual** é o problema — "não foi
 * possível ler" manda a pessoa tentar o mesmo arquivo de novo.
 */
export async function lerPasta(bytes: Uint8Array): Promise<PastaLida> {
  const entradas = new Map(entradasDoZip(bytes).map((e) => [e.nome, e]));
  const decodificador = new TextDecoder();

  const texto = async (caminho: string): Promise<string | null> => {
    const entrada = entradas.get(caminho);
    if (!entrada) return null;
    return decodificador.decode(await conteudoDaEntrada(entrada));
  };

  const pastaXml = await texto("xl/workbook.xml");
  const relsXml = await texto("xl/_rels/workbook.xml.rels");
  if (pastaXml === null || relsXml === null) {
    throw new ArquivoIlegivel("O arquivo não é uma planilha .xlsx.");
  }

  const compartilhadosXml = await texto("xl/sharedStrings.xml");
  const compartilhados = compartilhadosXml ? textosCompartilhados(compartilhadosXml) : [];

  const planilhas: PlanilhaLida[] = [];
  for (const aba of abasDaPasta(pastaXml, relsXml)) {
    const xml = await texto(aba.caminho);
    if (xml === null) continue;
    planilhas.push({ nome: aba.nome, linhas: linhasDaPlanilha(xml, compartilhados) });
  }
  return { planilhas };
}
