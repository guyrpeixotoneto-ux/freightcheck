/**
 * Um documento como estrutura, e não como um bolo de palavras.
 *
 * **O que esta camada corrige.** A extração anterior tirava o texto do XML
 * varrendo `<w:t>` e jogando fora todo o resto. Para um contrato em prosa isso
 * bastava; para o Book do Operador, não — as regras de lá moram em tabelas, em
 * listas numeradas e sob títulos que dizem de que seção aquela regra é. Sem a
 * estrutura, "Bimestral" e "Auditoria QLP ADM" chegavam ao modelo como duas
 * palavras adjacentes num parágrafo corrido, e a única saída honesta era a
 * ressalva que a tela mostrava: *a diagramação não sobreviveu*. Ela era
 * verdadeira, e era um defeito nosso apresentado ao usuário como limitação do
 * mundo.
 *
 * **O que sai daqui.** Uma lista ordenada de blocos — título, parágrafo, item
 * de lista, tabela — que sabe o que cada pedaço é. Sobre ela se constrói o
 * resto: `renderizarBlocos` produz o markdown que o modelo lê (uma tabela
 * continua uma tabela, com cabeçalho e linhas), e o índice do Book quebra o
 * documento em trechos sem partir uma tabela ao meio nem separar uma regra do
 * título que a nomeia.
 *
 * **Por que um leitor próprio de OOXML, e não uma dependência.** A mesma razão
 * do leitor de zip ao lado: o que este produto precisa é abrir arquivos bem
 * formados que o próprio Office escreveu, e o custo de uma biblioteca completa
 * de conversão é uma superfície que ninguém aqui vai auditar. O escopo é
 * declarado e pequeno — parágrafo, estilo de título, lista, tabela — e o que
 * não for reconhecido vira parágrafo, que é a degradação certa: perde-se a
 * forma, nunca o conteúdo.
 *
 * **A planilha não passa por aqui como texto.** Ela é lida pelo mesmo `xlsx`
 * que o pipeline de importação usa, e vira tabela — uma por folha. Um `.xlsx`
 * de verdade traz data serializada e valor em cache de fórmula, e uma leitura
 * artesanal do XML acerta o arquivo de teste e erra o do cliente.
 */

import * as XLSX from "xlsx";

// ── O que um documento é, depois de lido ────────────────────────────────────

export type BlocoDeDocumento =
  | { tipo: "TITULO"; nivel: number; texto: string }
  | { tipo: "PARAGRAFO"; texto: string }
  | { tipo: "ITEM"; texto: string }
  | { tipo: "TABELA"; cabecalho: string[]; linhas: string[][] };

export interface DocumentoEstruturado {
  blocos: BlocoDeDocumento[];
  /**
   * O que ficou de fora, e por quê — para o log e para o painel técnico.
   *
   * Nunca para a resposta. Uma planilha de doze mil linhas entra cortada, e
   * quem opera precisa saber disso; quem perguntou "qual é a regra?" não tem
   * nada a fazer com essa informação, e recebê-la foi o que fez a resposta
   * parecer um relatório de importação.
   */
  cortes: string[];
}

// ── Varredura de XML ────────────────────────────────────────────────────────

/**
 * Os elementos de primeiro nível com estes nomes, na ordem do documento.
 *
 * Um `<w:p>` dentro de um `<w:tc>` dentro de um `<w:tbl>` **não** é um
 * parágrafo do corpo: ele é conteúdo de célula, e emiti-lo junto faria a mesma
 * frase aparecer duas vezes — uma solta e outra dentro da tabela. Por isso a
 * varredura conta profundidade da tag que abriu o elemento corrente e ignora
 * qualquer outra até ele fechar.
 */
export function elementosDeTopo(
  xml: string,
  tags: string[],
): { tag: string; xml: string }[] {
  const nomes = tags.map((t) => t.replace(":", "\\:")).join("|");
  const re = new RegExp(`<(${nomes})(\\s[^>]*?)?(/)?>|</(${nomes})>`, "g");

  const saida: { tag: string; xml: string }[] = [];
  let corrente: string | null = null;
  let profundidade = 0;
  let inicio = 0;

  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const abre = m[1];
    const autofechada = Boolean(m[3]);
    const fecha = m[4];

    if (abre && !autofechada) {
      if (corrente === null) {
        corrente = abre;
        profundidade = 1;
        inicio = m.index;
      } else if (abre === corrente) {
        profundidade++;
      }
      continue;
    }

    if (fecha && corrente !== null && fecha === corrente) {
      profundidade--;
      if (profundidade === 0) {
        saida.push({ tag: corrente, xml: xml.slice(inicio, m.index + m[0].length) });
        corrente = null;
      }
    }
  }

  return saida;
}

/** O texto de um trecho de XML do Office, sem as tags e com as entidades de volta. */
export function textoDoXml(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<w:br\s*\/>|<a:br\s*\/>/g, "\n")
    .replace(/<w:tab\s*\/>/g, " ")
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

/** O texto de uma célula: os parágrafos dela numa linha só, que é como ela é lida. */
function textoDaCelula(xml: string): string {
  return textoDoXml(xml).replace(/\s*\n\s*/g, " ").trim();
}

// ── Word ────────────────────────────────────────────────────────────────────

/**
 * O nível de título deste parágrafo — `0` quando ele não é um título.
 *
 * Word marca título de três formas, e as três aparecem em documentos reais
 * escritos por gente diferente: o estilo nomeado (`Heading2`, e `Ttulo2` na
 * instalação em português), o nível de estrutura de tópicos (`outlineLvl`), e
 * — em documento que ninguém estilizou — uma linha curta, inteira em negrito e
 * sem ponto final. As duas primeiras são declaração; a terceira é heurística, e
 * ela existe porque documento de operação quase nunca usa estilo.
 */
function nivelDoTitulo(xml: string, texto: string): number {
  const estilo = /<w:pStyle\s[^>]*w:val="([^"]+)"/.exec(xml)?.[1] ?? "";
  const nomeado = /^(?:heading|t.?tulo)\s*(\d)/i.exec(estilo.replace(/\s+/g, ""));
  if (nomeado) return Math.min(Number(nomeado[1]), 4);

  const contorno = /<w:outlineLvl\s[^>]*w:val="(\d)"/.exec(xml)?.[1];
  if (contorno !== undefined) return Math.min(Number(contorno) + 1, 4);

  const negritoInteiro =
    /<w:b\s*\/>|<w:b\s[^>]*w:val="(?:1|true|on)"/.test(xml) &&
    !/<w:b\s[^>]*w:val="(?:0|false|off)"/.test(xml);
  if (negritoInteiro && texto.length > 0 && texto.length <= 80 && !/[.;:]$/.test(texto)) {
    return 2;
  }

  return 0;
}

/** Uma tabela do Word, com a primeira linha promovida a cabeçalho. */
function tabelaDoWord(xml: string): BlocoDeDocumento | null {
  const linhas = elementosDeTopo(xml, ["w:tr"]).map((tr) =>
    elementosDeTopo(tr.xml, ["w:tc"]).map((tc) => textoDaCelula(tc.xml)),
  );
  return montarTabela(linhas);
}

/**
 * Linhas cruas viram tabela — ou nada, quando não há tabela ali.
 *
 * A primeira linha vira cabeçalho porque é o que ela é em toda tabela de regra
 * que este produto encontrou; quando ela vem vazia, o cabeçalho é sintético e a
 * tabela continua legível. Uma "tabela" de uma coluna só é devolvida como
 * tabela mesmo assim: no Word ela costuma ser uma lista de exceções, e virar
 * parágrafo faria as exceções se fundirem numa frase só.
 */
function montarTabela(linhas: string[][]): BlocoDeDocumento | null {
  const uteis = linhas.filter((l) => l.some((c) => c.trim().length > 0));
  if (uteis.length === 0) return null;

  const colunas = Math.max(...uteis.map((l) => l.length));
  const completar = (l: string[]) =>
    Array.from({ length: colunas }, (_, i) => (l[i] ?? "").trim());

  const [primeira, ...resto] = uteis;
  const cabecalhoUtil = primeira.some((c) => c.trim().length > 0);

  return {
    tipo: "TABELA",
    cabecalho: cabecalhoUtil
      ? completar(primeira)
      : Array.from({ length: colunas }, (_, i) => `Coluna ${i + 1}`),
    linhas: (cabecalhoUtil ? resto : uteis).map(completar),
  };
}

/** O corpo de um `.docx`, na ordem em que ele foi escrito. */
export function blocosDoWord(documentXml: string): BlocoDeDocumento[] {
  const blocos: BlocoDeDocumento[] = [];

  for (const el of elementosDeTopo(documentXml, ["w:p", "w:tbl"])) {
    if (el.tag === "w:tbl") {
      const tabela = tabelaDoWord(el.xml);
      if (tabela) blocos.push(tabela);
      continue;
    }

    const texto = textoDoXml(el.xml).replace(/\s*\n\s*/g, " ").trim();
    if (!texto) continue;

    const nivel = nivelDoTitulo(el.xml, texto);
    if (nivel > 0) {
      blocos.push({ tipo: "TITULO", nivel, texto });
    } else if (/<w:numPr>/.test(el.xml)) {
      blocos.push({ tipo: "ITEM", texto });
    } else {
      blocos.push({ tipo: "PARAGRAFO", texto });
    }
  }

  return blocos;
}

// ── PowerPoint ──────────────────────────────────────────────────────────────

/** Um slide: o número como título, e o que houver dentro dele. */
export function blocosDoSlide(slideXml: string, numero: number): BlocoDeDocumento[] {
  const blocos: BlocoDeDocumento[] = [{ tipo: "TITULO", nivel: 2, texto: `Slide ${numero}` }];

  for (const tabela of elementosDeTopo(slideXml, ["a:tbl"])) {
    const linhas = elementosDeTopo(tabela.xml, ["a:tr"]).map((tr) =>
      elementosDeTopo(tr.xml, ["a:tc"]).map((tc) => textoDaCelula(tc.xml)),
    );
    const montada = montarTabela(linhas);
    if (montada) blocos.push(montada);
  }

  /*
    O texto do slide sai **sem** o que já foi lido como tabela.

    Sem esta subtração, cada célula apareceria duas vezes — uma na tabela e
    outra no parágrafo corrido —, e um modelo lendo duas cópias da mesma linha
    tem todo motivo para achar que são dois casos diferentes.
  */
  const semTabelas = slideXml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, " ");
  for (const linha of textoDoXml(semTabelas).split("\n")) {
    const texto = linha.trim();
    if (texto) blocos.push({ tipo: "PARAGRAFO", texto });
  }

  return blocos.length > 1 ? blocos : [];
}

// ── Planilha ────────────────────────────────────────────────────────────────

/** Quantas linhas de uma folha entram. Além disto, o corte é declarado. */
const TETO_DE_LINHAS = 300;

/**
 * Cada folha vira uma tabela, com o nome dela como título.
 *
 * `cellDates` e `cellText` fazem sair o que o Excel **mostra**, não o número
 * cru por trás: uma data tem de chegar como data, senão o modelo lê 45231 e
 * cita um número que ninguém reconhece na tela. Fórmula não é avaliada aqui —
 * o que sai é o valor que o Excel gravou junto dela.
 */
export function blocosDaPlanilha(buffer: Buffer): {
  blocos: BlocoDeDocumento[];
  cortes: string[];
} {
  let livro: XLSX.WorkBook;
  try {
    livro = XLSX.read(buffer, { type: "buffer", cellDates: true, cellText: true });
  } catch {
    return { blocos: [], cortes: ["a planilha não pôde ser aberta"] };
  }

  const blocos: BlocoDeDocumento[] = [];
  const cortes: string[] = [];

  for (const nome of livro.SheetNames) {
    const folha = livro.Sheets[nome];
    if (!folha) continue;

    const linhas = XLSX.utils
      .sheet_to_json<unknown[]>(folha, { header: 1, blankrows: false, raw: false, defval: "" })
      .map((linha) => (Array.isArray(linha) ? linha.map((c) => String(c ?? "")) : []));

    if (linhas.length === 0) continue;

    if (linhas.length > TETO_DE_LINHAS) {
      cortes.push(
        `folha "${nome}": ${linhas.length} linhas, ${TETO_DE_LINHAS} lidas`,
      );
    }

    const tabela = montarTabela(linhas.slice(0, TETO_DE_LINHAS));
    if (!tabela) continue;

    blocos.push({ tipo: "TITULO", nivel: 2, texto: nome });
    blocos.push(tabela);
  }

  return { blocos, cortes };
}

// ── Texto escrito à mão ─────────────────────────────────────────────────────

/**
 * Texto puro vira blocos pelo que ele já marca.
 *
 * Vale para a entrada TEXTO do Book — a regra que alguém escreveu direto no
 * sistema — e para `.txt`/`.md` anexados. Quem escreve regra em caixa de texto
 * usa markdown quase sempre, e reconhecer `#` e `-` custa cinco linhas; o que
 * não for reconhecido continua parágrafo.
 */
export function blocosDoTexto(texto: string): BlocoDeDocumento[] {
  const blocos: BlocoDeDocumento[] = [];

  for (const bruto of texto.split(/\n/)) {
    const linha = bruto.trim();
    if (!linha) continue;

    const titulo = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (titulo) {
      blocos.push({ tipo: "TITULO", nivel: titulo[1].length, texto: titulo[2].trim() });
      continue;
    }

    const item = /^([-*•]|\d+[.)])\s+(.*)$/.exec(linha);
    if (item) {
      blocos.push({ tipo: "ITEM", texto: item[2].trim() });
      continue;
    }

    blocos.push({ tipo: "PARAGRAFO", texto: linha });
  }

  return blocos;
}

// ── Markdown ────────────────────────────────────────────────────────────────

/** `|` numa célula partiria a tabela em markdown, e a célula é conteúdo. */
function celulaSegura(texto: string): string {
  return texto.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/**
 * Os blocos em markdown — a forma em que o modelo os lê e a tela os mostra.
 *
 * Tabela vira tabela de verdade, com cabeçalho e separador. É o ponto inteiro
 * desta camada: um critério que só significa alguma coisa por estar na coluna
 * "Frequência" chega ao modelo dentro da coluna "Frequência".
 */
export function renderizarBlocos(blocos: BlocoDeDocumento[]): string {
  const partes: string[] = [];

  for (const bloco of blocos) {
    switch (bloco.tipo) {
      case "TITULO":
        partes.push(`${"#".repeat(Math.min(bloco.nivel + 1, 6))} ${bloco.texto}`);
        break;
      case "ITEM":
        partes.push(`- ${bloco.texto}`);
        break;
      case "PARAGRAFO":
        partes.push(bloco.texto);
        break;
      case "TABELA": {
        const cabecalho = bloco.cabecalho.map(celulaSegura);
        const linhas = [
          `| ${cabecalho.join(" | ")} |`,
          `| ${cabecalho.map(() => "---").join(" | ")} |`,
          ...bloco.linhas.map((l) => `| ${l.map(celulaSegura).join(" | ")} |`),
        ];
        partes.push(linhas.join("\n"));
        break;
      }
    }
  }

  /*
    Item de lista consecutivo fica colado; o resto respira.

    Uma lista com linha em branco entre os itens vira, em markdown, uma lista
    "solta" que os renderizadores desenham com parágrafos dentro de cada item —
    o que faz três critérios curtos ocuparem meia tela.
  */
  let texto = "";
  blocos.forEach((bloco, i) => {
    const anterior = blocos[i - 1];
    const colados = bloco.tipo === "ITEM" && anterior?.tipo === "ITEM";
    texto += (i === 0 ? "" : colados ? "\n" : "\n\n") + partes[i];
  });

  return texto.trim();
}

/** Só o texto que vale para busca — sem a pontuação de markdown. */
export function textoDosBlocos(blocos: BlocoDeDocumento[]): string {
  return blocos
    .map((b) =>
      b.tipo === "TABELA"
        ? [b.cabecalho.join(" "), ...b.linhas.map((l) => l.join(" "))].join("\n")
        : b.texto,
    )
    .join("\n");
}
