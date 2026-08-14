/**
 * O que dá para tirar de um arquivo sem traduzir o que ele mostra.
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
 * `<w:t>` no Word, `<a:t>` no PowerPoint — os dois guardam o texto visível em
 * elementos de nome curto, e é isso que se colhe. Quebra de parágrafo vira
 * quebra de linha para o texto não sair como um bloco só, que é o que faria uma
 * lista de cláusulas parecer um parágrafo corrido.
 */
export function textoDoXml(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<w:br\s*\/>/g, "\n")
    .replace(/<[wa]:t(?:\s[^>]*)?>([\s\S]*?)<\/[wa]:t>/g, (_, t: string) => t)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
 * O conteúdo de um arquivo que o modelo não abre sozinho.
 *
 * Devolve `null` quando não há caminho — formato legado, arquivo ilegível, ou
 * um documento do qual não se conseguiu tirar nem texto nem figura. `null` aqui
 * não é falha silenciosa: quem chama volta a dizer que não leu o documento, que
 * é a verdade.
 */
export function extrairAnexo(mimeType: string, buffer: Buffer): ConteudoExtraido | null {
  const texto = (t: string): ConteudoExtraido | null =>
    t.trim() ? { texto: t.trim(), imagens: [] } : null;

  // Texto puro não precisa de extração — é o próprio conteúdo.
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv") {
    return texto(buffer.toString("utf8"));
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
    const conteudo: ConteudoExtraido = {
      texto: corpo ? textoDoXml(corpo.toString("utf8")) : "",
      imagens: imagensDe(arquivos, "word/media/").slice(0, TETO_DE_IMAGENS),
    };
    return conteudo.texto || conteudo.imagens.length > 0 ? conteudo : null;
  }

  if (mimeType.includes("presentationml")) {
    /*
      Os slides saem numerados e em ordem.

      `slide10.xml` vem antes de `slide2.xml` em ordem alfabética, e uma
      apresentação fora de ordem descreve um raciocínio que ninguém apresentou.
      O número do slide entra no texto porque é assim que se cita um: "no slide
      4" só quer dizer algo se o slide 4 estiver marcado.
    */
    const slides = [...arquivos.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

    const partes = slides
      .map((nome, i) => {
        const t = textoDoXml(arquivos.get(nome)!.toString("utf8"));
        return t ? `[slide ${i + 1}]\n${t}` : "";
      })
      .filter(Boolean);

    const conteudo: ConteudoExtraido = {
      texto: partes.join("\n\n"),
      imagens: imagensDe(arquivos, "ppt/media/").slice(0, TETO_DE_IMAGENS),
    };
    return conteudo.texto || conteudo.imagens.length > 0 ? conteudo : null;
  }

  if (mimeType.includes("spreadsheetml")) {
    return texto(planilhaEmTexto(arquivos));
  }

  return null;
}

/**
 * A planilha como texto, célula a célula.
 *
 * Não usa biblioteca de planilha de propósito: o que se quer aqui não é o
 * modelo de dados de um `.xlsx` — fórmulas, formatos, referências — e sim o que
 * está escrito nas células, para o modelo poder citar. Ler `sharedStrings.xml`
 * mais os valores das folhas entrega isso com uma fração da superfície.
 *
 * O que fica de fora está declarado: fórmula não é avaliada, e o que sai é o
 * valor que o Excel gravou junto dela.
 */
function planilhaEmTexto(arquivos: Map<string, Buffer>): string {
  const compartilhadas: string[] = [];
  const bruto = arquivos.get("xl/sharedStrings.xml");
  if (bruto) {
    for (const m of bruto.toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      compartilhadas.push(textoDoXml(m[1].replace(/<t(?:\s[^>]*)?>/g, "<w:t>").replace(/<\/t>/g, "</w:t>")));
    }
  }

  const folhas = [...arquivos.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const linhas: string[] = [];
  for (const [i, folha] of folhas.entries()) {
    const xml = arquivos.get(folha)!.toString("utf8");
    const desta: string[] = [];
    for (const linha of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celulas: string[] = [];
      for (const c of linha[1].matchAll(/<c[^>]*?(?:\st="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
        const valor = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (!valor) continue;
        celulas.push(c[1] === "s" ? (compartilhadas[Number(valor)] ?? "") : valor);
      }
      if (celulas.length > 0) desta.push(celulas.join(" | "));
    }
    if (desta.length > 0) linhas.push(`[planilha ${i + 1}]\n${desta.join("\n")}`);
  }

  return linhas.join("\n\n");
}
