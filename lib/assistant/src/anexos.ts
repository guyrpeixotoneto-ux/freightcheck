/**
 * O que dá para tirar de um arquivo sem traduzir o que ele mostra.
 *
 * **A estrutura é lida em `documento.ts`; aqui fica o acesso ao arquivo.** Este
 * módulo abre o zip, escolhe a parte certa de cada formato e devolve o que o
 * resto do assistente consome — o documento em blocos, o markdown dele e as
 * figuras. A separação existe porque as duas coisas quebram por motivos
 * diferentes: um zip mal lido é deslocamento de bytes, uma tabela perdida é
 * interpretação de OOXML, e juntá-las num arquivo só fez a segunda ser
 * negligenciada por anos — era o `<w:tbl>` inteiro caindo no mesmo
 * `replace(/<[^>]+>/g, "")` que tirava as tags de formatação.
 *
 * O modelo lê PDF e imagem nativamente, e é assim que esses dois chegam a ele —
 * sem intermediário. Word, Excel e PowerPoint ele não abre, e aí a escolha é
 * entre não ler nada e ler o que o próprio arquivo declara. Este módulo faz a
 * segunda, e a distinção com OCR é a razão de ela ser aceitável:
 *
 * - **As imagens saem intactas.** Um `.docx` é um zip, e as figuras dele vivem
 *   em `word/media/` como PNG e JPEG originais. Elas vão ao modelo byte a byte,
 *   exatamente como iriam se tivessem sido enviadas soltas. Não há conversão,
 *   não há perda, não há nada a errar.
 * - **O texto sai do XML, não de pixels.** `word/document.xml` guarda o texto
 *   como texto. Lê-lo é ler o formato de origem; um OCR seria adivinhar de uma
 *   imagem o que já está escrito ali. As duas coisas se parecem no resultado e
 *   não se parecem em nada no risco.
 *
 * **O que se perde, e a resposta precisa saber.** A diagramação. Uma cláusula
 * cujo sentido depende de estar numa tabela, de uma numeração ou de uma coluna
 * chega mais pobre do que chegaria num PDF. Por isso `extrairAnexo` marca a
 * forma como o conteúdo veio, e a instrução do modelo trata "texto extraído"
 * diferente de "arquivo lido".
 *
 * **O ZIP é lido aqui, sem dependência.** Um leitor de zip completo faria muito
 * mais do que este produto precisa; o que ele precisa é abrir um arquivo bem
 * formado que o próprio Office escreveu. São duas dezenas de linhas sobre o
 * diretório central, e `node:zlib` faz o resto.
 */

import { inflateRawSync } from "node:zlib";
import {
  blocosDaPlanilha,
  blocosDoSlide,
  blocosDoTexto,
  blocosDoWord,
  renderizarBlocos,
  textoDoXml as textoDeXmlDoOffice,
  type BlocoDeDocumento,
  type DocumentoEstruturado,
} from "./documento";

// ── ZIP ─────────────────────────────────────────────────────────────────────

/** Assinatura do fim do diretório central: "PK\5\6". */
const FIM_DO_DIRETORIO = 0x06054b50;
/** Assinatura de uma entrada do diretório central: "PK\1\2". */
const ENTRADA_DO_DIRETORIO = 0x02014b50;

/**
 * Os arquivos de dentro do zip, por caminho.
 *
 * Lê pelo diretório central — que é onde o formato diz a verdade — e não
 * varrendo assinaturas locais, que aparecem também dentro de dados comprimidos
 * e produziriam entradas fantasma.
 *
 * Só os dois métodos que o Office usa: 0 (sem compressão) e 8 (deflate). Uma
 * entrada com outro método é pulada em silêncio, e não quebra o arquivo todo —
 * um documento com um objeto exótico continua entregando o texto e as figuras.
 */
export function lerZip(buffer: Buffer): Map<string, Buffer> {
  const arquivos = new Map<string, Buffer>();

  // O fim do diretório central tem tamanho variável (o comentário do zip vai
  // no fim), então se procura a assinatura de trás para frente.
  let fim = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 22 - 65536; i--) {
    if (buffer.readUInt32LE(i) === FIM_DO_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return arquivos;

  const quantas = buffer.readUInt16LE(fim + 10);
  let p = buffer.readUInt32LE(fim + 16);

  for (let i = 0; i < quantas && p + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(p) !== ENTRADA_DO_DIRETORIO) break;

    const metodo = buffer.readUInt16LE(p + 10);
    const tamanhoComprimido = buffer.readUInt32LE(p + 20);
    const tamanhoDoNome = buffer.readUInt16LE(p + 28);
    const tamanhoExtra = buffer.readUInt16LE(p + 30);
    const tamanhoComentario = buffer.readUInt16LE(p + 32);
    const inicioLocal = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString("utf8", p + 46, p + 46 + tamanhoDoNome);

    p += 46 + tamanhoDoNome + tamanhoExtra + tamanhoComentario;

    // O cabeçalho local repete nome e extra com tamanhos próprios; os dados
    // começam depois deles, e não depois dos tamanhos do diretório central.
    if (inicioLocal + 30 > buffer.length) continue;
    const nomeLocal = buffer.readUInt16LE(inicioLocal + 26);
    const extraLocal = buffer.readUInt16LE(inicioLocal + 28);
    const inicioDados = inicioLocal + 30 + nomeLocal + extraLocal;
    const dados = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido);

    try {
      if (metodo === 0) arquivos.set(nome, Buffer.from(dados));
      else if (metodo === 8) arquivos.set(nome, inflateRawSync(dados));
    } catch {
      // Entrada corrompida não invalida o arquivo inteiro.
    }
  }

  return arquivos;
}

// ── Texto de XML do Office ──────────────────────────────────────────────────

/**
 * O texto de um XML do Office, na ordem em que ele aparece.
 *
 * Continua exportado daqui porque é assim que ele é conhecido — a
 * implementação mora em `documento.ts`, ao lado de quem a usa para ler célula
 * de tabela e parágrafo de slide.
 */
export const textoDoXml = textoDeXmlDoOffice;

// ── Extração ────────────────────────────────────────────────────────────────

export interface ImagemExtraida {
  mimeType: "image/png" | "image/jpeg";
  dados: string;
}

export interface ConteudoExtraido {
  texto: string;
  imagens: ImagemExtraida[];
}

/** Só o que o modelo lê como imagem — o resto de `media/` é ignorado. */
function imagensDe(arquivos: Map<string, Buffer>, pasta: string): ImagemExtraida[] {
  const imagens: ImagemExtraida[] = [];
  for (const [nome, bytes] of arquivos) {
    if (!nome.startsWith(pasta)) continue;
    const ext = nome.toLowerCase().split(".").pop() ?? "";
    const mimeType =
      ext === "png" ? ("image/png" as const)
      : ext === "jpg" || ext === "jpeg" ? ("image/jpeg" as const)
      : null;
    if (!mimeType) continue;
    imagens.push({ mimeType, dados: bytes.toString("base64") });
  }
  return imagens;
}

/** Quantas imagens de um mesmo arquivo acompanham a pergunta. */
const TETO_DE_IMAGENS = 6;

/**
 * O documento estruturado de um arquivo que o modelo não abre sozinho.
 *
 * Devolve `null` quando não há caminho — formato legado, arquivo ilegível, ou
 * um documento do qual não se conseguiu tirar nem texto nem figura. `null` aqui
 * não é falha silenciosa: quem chama volta a dizer que não leu o documento, que
 * é a verdade.
 */
export function extrairDocumento(
  mimeType: string,
  buffer: Buffer,
): (DocumentoEstruturado & { imagens: ImagemExtraida[] }) | null {
  const pronto = (
    blocos: BlocoDeDocumento[],
    imagens: ImagemExtraida[] = [],
    cortes: string[] = [],
  ) => (blocos.length > 0 || imagens.length > 0 ? { blocos, imagens, cortes } : null);

  // Texto puro não precisa de extração — é o próprio conteúdo.
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return pronto(blocosDoTexto(buffer.toString("utf8")));
  }

  /*
    CSV é tabela, e chegava como prosa.

    Ele caía no caminho do texto puro, onde cada linha virava um parágrafo: o
    cabeçalho perdia a relação com as linhas e "Placa,IPVA" passava a ser uma
    frase. O mesmo leitor da planilha o abre, e o resultado é a tabela que o
    arquivo sempre foi. O título da folha não entra — num CSV ele é inventado
    pelo leitor ("Sheet1") e não diz nada a ninguém.
  */
  if (mimeType === "text/csv") {
    const { blocos, cortes } = blocosDaPlanilha(buffer);
    return pronto(
      blocos.filter((b) => b.tipo === "TABELA"),
      [],
      cortes,
    );
  }

  /*
    Planilha vem antes do zip, porque nem toda planilha é zip.

    `.xlsx` é OOXML (zip); `.xls` é BIFF dentro de OLE2, um formato binário sem
    nada em comum com o outro. O mesmo leitor abre os dois — é o que o pipeline
    de importação já usa para ler estes arquivos —, e roteá-los juntos aqui
    evita a única alternativa: um parser meu para o moderno e uma dependência
    para o antigo, duas leituras da mesma família discordando em silêncio.
  */
  if (mimeType.includes("spreadsheetml") || mimeType === "application/vnd.ms-excel") {
    const { blocos, cortes } = blocosDaPlanilha(buffer);
    return pronto(blocos, [], cortes);
  }

  let arquivos: Map<string, Buffer>;
  try {
    arquivos = lerZip(buffer);
  } catch {
    return null;
  }
  if (arquivos.size === 0) return null;

  if (mimeType.includes("wordprocessingml")) {
    const corpo = arquivos.get("word/document.xml");
    return pronto(
      corpo ? blocosDoWord(corpo.toString("utf8")) : [],
      imagensDe(arquivos, "word/media/").slice(0, TETO_DE_IMAGENS),
    );
  }

  if (mimeType.includes("presentationml")) {
    /*
      Os slides saem numerados e em ordem.

      `slide10.xml` vem antes de `slide2.xml` em ordem alfabética, e uma
      apresentação fora de ordem descreve um raciocínio que ninguém apresentou.
      O número do slide entra como título porque é assim que se cita um: "no
      slide 4" só quer dizer algo se o slide 4 estiver marcado.
    */
    const slides = [...arquivos.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

    return pronto(
      slides.flatMap((nome, i) => blocosDoSlide(arquivos.get(nome)!.toString("utf8"), i + 1)),
      imagensDe(arquivos, "ppt/media/").slice(0, TETO_DE_IMAGENS),
    );
  }

  return null;
}

/**
 * O mesmo conteúdo, já em markdown — a forma em que ele viaja.
 *
 * Continua existindo com este nome porque é o contrato de quem manda um anexo
 * ao modelo. O que mudou é o texto que sai: antes era o resultado de arrancar
 * as tags de um XML, agora é a renderização dos blocos, com as tabelas
 * inteiras.
 */
export function extrairAnexo(mimeType: string, buffer: Buffer): ConteudoExtraido | null {
  const documento = extrairDocumento(mimeType, buffer);
  if (!documento) return null;
  const texto = renderizarBlocos(documento.blocos);
  return texto || documento.imagens.length > 0
    ? { texto, imagens: documento.imagens }
    : null;
}
