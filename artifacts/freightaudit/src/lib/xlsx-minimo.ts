/**
 * UM ESCRITOR DE .XLSX MÍNIMO — planilha de verdade, sem biblioteca nova.
 *
 * A exportação do fluxograma (`lib/fluxos-exportar.ts`) já tinha escolhido o
 * seu caminho: o arquivo é montado do dado, no navegador de quem pediu, sem
 * rota, sem fila e **sem dependência nova**. O modelo em Excel entra pela mesma
 * porta, e a razão é a mesma: um `.xlsx` é um ZIP com meia dúzia de XMLs
 * dentro, e trazer uma biblioteca inteira para o pacote da interface só para
 * escrever texto em células seria mais código de terceiro do que o que está
 * escrito aqui.
 *
 * (O servidor tem `exceljs`, e ele continua sendo a ferramenta certa **lá**,
 * onde o Node lê e escreve as planilhas de importação. Aqui não há Node, não há
 * arquivo em disco e não há nada a ler: só bytes a escrever e um download.)
 *
 * ---------------------------------------------------------------------------
 * O que este módulo escreve, e o que ele deliberadamente não escreve
 * ---------------------------------------------------------------------------
 *
 * Escreve: várias abas, texto em célula, largura de coluna, cinco estilos
 * (título, seção, rótulo, cabeçalho de tabela, ajuda) e o painel de cima
 * congelado. É o suficiente para um formulário legível.
 *
 * Não escreve: fórmula, número, data, mesclagem, validação de lista, imagem.
 * Nada disso é preciso para um modelo de preenchimento, e cada um seria uma
 * parte nova do OOXML para manter. Todo valor sai como texto em linha
 * (`inlineStr`) — sem tabela de textos compartilhados, que é a otimização de
 * quem escreve dez mil linhas, e não dez.
 *
 * O ZIP é **armazenado**, sem compressão. Comprimir exigiria `deflate`, que no
 * navegador só existe de forma assíncrona (`CompressionStream`) e nem em todo
 * lugar; um modelo de fluxo tem dezenas de KB de XML, e o custo de não
 * comprimir é um arquivo alguns KB maior — invisível ao lado de uma dependência
 * nova ou de tornar assíncrona uma função que não precisa ser.
 *
 * Tudo aqui é função pura sobre bytes, e por isso é testado sem navegador: a
 * estrutura do ZIP, o nome saneado da aba e o XML de cada parte são afirmados
 * em teste. O único ponto impuro é `pastaComoBlob`, que embrulha os bytes.
 */

// ---------------------------------------------------------------------------
// O modelo de uma pasta de trabalho
// ---------------------------------------------------------------------------

/** Os papéis de texto que o modelo usa — nomeados, não numerados. */
export type Estilo = "texto" | "titulo" | "secao" | "rotulo" | "cabecalho" | "ajuda";

export interface Celula {
  valor: string;
  estilo?: Estilo;
}

/**
 * Uma linha da planilha. `null` é célula vazia — e é o que preserva a coluna:
 * `[null, "Sim"]` escreve em B, não em A.
 */
export type Linha = (Celula | string | null)[];

export interface Planilha {
  /** O nome cru; o saneamento e a unicidade acontecem em `nomeDePlanilha`. */
  nome: string;
  /** Largura das colunas, em caracteres. Faltando, a coluna fica no padrão. */
  larguras?: number[];
  /** Quantas linhas do topo ficam congeladas ao rolar. Zero, nenhuma. */
  congelarLinhas?: number;
  linhas: Linha[];
}

export interface Pasta {
  planilhas: Planilha[];
}

const ESTILOS: Record<Estilo, number> = {
  texto: 0,
  titulo: 1,
  secao: 2,
  rotulo: 3,
  cabecalho: 4,
  ajuda: 5,
};

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/*
  Os caracteres de controle que o XML 1.0 não representa. Um deles vindo de um
  cadastro sujo não estraga uma célula: estraga o arquivo inteiro, que o Excel
  recusa com uma frase que não ajuda ninguém. Tabulação, quebra de linha e
  retorno ficam de fora da faixa — são conteúdo legítimo de uma célula de texto.
*/
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** O escape do XML — o mesmo problema, e a mesma resposta, da exportação em SVG. */
export function escaparXml(texto: string): string {
  return texto
    .replace(CONTROLES, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `0 → A`, `25 → Z`, `26 → AA`. A numeração de coluna do Excel é base-26 bijetiva. */
export function letraDaColuna(indice: number): string {
  let n = indice + 1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - resto) / 26);
  }
  return letra;
}

/**
 * O nome de uma aba, saneado e único.
 *
 * O Excel recusa a pasta inteira — não a aba — quando um nome passa de 31
 * caracteres, contém `[ ] : * ? / \`, começa ou termina com apóstrofo, ou se
 * repete. Como o nome da aba aqui vem do nome de uma etapa, que é texto livre
 * digitado por gente, sanear é obrigatório e não defensivo.
 *
 * `usados` são os nomes já emitidos, e a comparação é sem caixa porque a do
 * Excel também é: "Emissão" e "EMISSÃO" colidem. O desempate vira sufixo
 * ` (2)`, sempre dentro dos 31 caracteres.
 */
export function nomeDePlanilha(bruto: string, usados: string[]): string {
  const limpo = bruto
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  const base = (limpo === "" ? "Aba" : limpo).slice(0, 31).trim();

  const tomados = new Set(usados.map((u) => u.toLowerCase()));
  if (!tomados.has(base.toLowerCase())) return base;

  for (let n = 2; n < 1000; n += 1) {
    const sufixo = ` (${n})`;
    const candidato = base.slice(0, 31 - sufixo.length).trim() + sufixo;
    if (!tomados.has(candidato.toLowerCase())) return candidato;
  }
  return base;
}

const CABECALHO_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Uma aba virando XML: colunas, painel congelado e as células que têm conteúdo. */
export function planilhaComoXml(planilha: Planilha): string {
  const cols =
    planilha.larguras && planilha.larguras.length > 0
      ? `<cols>${planilha.larguras
          .map(
            (largura, i) =>
              `<col min="${i + 1}" max="${i + 1}" width="${largura}" customWidth="1"/>`,
          )
          .join("")}</cols>`
      : "";

  const congelar =
    planilha.congelarLinhas && planilha.congelarLinhas > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${planilha.congelarLinhas}" topLeftCell="A${
          planilha.congelarLinhas + 1
        }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : "";

  const linhas = planilha.linhas
    .map((linha, iLinha) => {
      const celulas = linha
        .map((bruta, iColuna) => {
          if (bruta === null || bruta === undefined) return "";
          const celula: Celula = typeof bruta === "string" ? { valor: bruta } : bruta;
          const estilo = ESTILOS[celula.estilo ?? "texto"];
          const referencia = `${letraDaColuna(iColuna)}${iLinha + 1}`;
          /*
            A célula vazia com estilo ainda é escrita: é ela que estende a faixa
            cinza de um cabeçalho de tabela até a última coluna. A vazia sem
            estilo some — escrever `<c/>` para cada buraco de uma linha curta é
            peso sem efeito nenhum na tela.
          */
          if (celula.valor === "") {
            return estilo === 0 ? "" : `<c r="${referencia}" s="${estilo}"/>`;
          }
          return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(
            celula.valor,
          )}</t></is></c>`;
        })
        .join("");
      return celulas === "" ? "" : `<row r="${iLinha + 1}">${celulas}</row>`;
    })
    .join("");

  return `${CABECALHO_XML}<worksheet xmlns="${NS}" xmlns:r="${NS_R}">${congelar}${cols}<sheetData>${linhas}</sheetData></worksheet>`;
}

/**
 * A folha de estilos — os cinco papéis, escritos uma vez.
 *
 * O `wrapText` no estilo de texto é o que faz uma descrição de três linhas
 * aparecer inteira dentro da célula, em vez de sumir atrás da coluna vizinha. É
 * a diferença entre um modelo que se lê e um que exige clicar célula a célula.
 */
function estilosComoXml(): string {
  return (
    `${CABECALHO_XML}<styleSheet xmlns="${NS}">` +
    `<fonts count="5">` +
    `<font><sz val="11"/><color rgb="FF0F172A"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="12"/><color rgb="FF1E293B"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF334155"/><name val="Calibri"/></font>` +
    `<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="2">` +
    `<border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>` +
    `</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="6">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>` +
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

export interface ArquivoDaPasta {
  caminho: string;
  conteudo: Uint8Array;
}

const bytes = (texto: string): Uint8Array => new TextEncoder().encode(texto);

/**
 * As partes do `.xlsx`, montadas — a função que os testes leem.
 *
 * Separada de `pastaComoBlob` de propósito: o que decide o conteúdo do arquivo
 * é isto, e é afirmável sem `Blob` e sem navegador. O embrulho é uma linha.
 */
export function arquivosDaPasta(pasta: Pasta): ArquivoDaPasta[] {
  const nomes: string[] = [];
  for (const planilha of pasta.planilhas) nomes.push(nomeDePlanilha(planilha.nome, nomes));

  const abas = pasta.planilhas.map((planilha, i) => ({
    planilha,
    nome: nomes[i],
    /* `sheet1.xml` é 1-indexado no OOXML, e o `rId` acompanha. */
    arquivo: `sheet${i + 1}.xml`,
    id: `rId${i + 1}`,
  }));
  const idDosEstilos = `rId${abas.length + 1}`;

  const tipos =
    `${CABECALHO_XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    abas
      .map(
        (aba) =>
          `<Override PartName="/xl/worksheets/${aba.arquivo}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const raizRels =
    `${CABECALHO_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const pastaXml =
    `${CABECALHO_XML}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>` +
    abas
      .map((aba, i) => `<sheet name="${escaparXml(aba.nome)}" sheetId="${i + 1}" r:id="${aba.id}"/>`)
      .join("") +
    `</sheets></workbook>`;

  const pastaRels =
    `${CABECALHO_XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    abas
      .map(
        (aba) =>
          `<Relationship Id="${aba.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${aba.arquivo}"/>`,
      )
      .join("") +
    `<Relationship Id="${idDosEstilos}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  return [
    { caminho: "[Content_Types].xml", conteudo: bytes(tipos) },
    { caminho: "_rels/.rels", conteudo: bytes(raizRels) },
    { caminho: "xl/workbook.xml", conteudo: bytes(pastaXml) },
    { caminho: "xl/_rels/workbook.xml.rels", conteudo: bytes(pastaRels) },
    { caminho: "xl/styles.xml", conteudo: bytes(estilosComoXml()) },
    ...abas.map((aba) => ({
      caminho: `xl/worksheets/${aba.arquivo}`,
      conteudo: bytes(planilhaComoXml(aba.planilha)),
    })),
  ];
}

// ---------------------------------------------------------------------------
// O ZIP
// ---------------------------------------------------------------------------

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

/** CRC-32 (IEEE), que é o que o cabeçalho de cada entrada do ZIP carrega. */
export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i += 1) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Um ZIP sem compressão — cabeçalho local, dado cru, diretório central, fim.
 *
 * O formato é de 1989 e não mudou: é por isso que escrevê-lo à mão é razoável
 * onde escrever um `deflate` à mão não seria. A data é fixa (01/01/1980, o
 * menor carimbo que o formato representa) e não o relógio, pelo mesmo motivo
 * que a exportação recebe a data por parâmetro: dois modelos do mesmo fluxo
 * saem byte a byte iguais, e é isso que um teste consegue afirmar.
 */
export function zipArmazenado(arquivos: ArquivoDaPasta[]): Uint8Array {
  const entradas = arquivos.map((arquivo) => ({
    nome: bytes(arquivo.caminho),
    conteudo: arquivo.conteudo,
    crc: crc32(arquivo.conteudo),
  }));

  const tamanhoLocal = entradas.reduce(
    (soma, e) => soma + 30 + e.nome.length + e.conteudo.length,
    0,
  );
  const tamanhoCentral = entradas.reduce((soma, e) => soma + 46 + e.nome.length, 0);
  const saida = new Uint8Array(tamanhoLocal + tamanhoCentral + 22);
  const visao = new DataView(saida.buffer);

  let posicao = 0;
  const u16 = (valor: number) => {
    visao.setUint16(posicao, valor, true);
    posicao += 2;
  };
  const u32 = (valor: number) => {
    visao.setUint32(posicao, valor >>> 0, true);
    posicao += 4;
  };
  const crus = (dados: Uint8Array) => {
    saida.set(dados, posicao);
    posicao += dados.length;
  };

  const DATA = 0x0021; /* 01/01/1980 no formato MS-DOS. */
  const HORA = 0x0000;
  /* Bit 11: os nomes das partes estão em UTF-8. Aqui são ASCII, mas o dizemos. */
  const BANDEIRA = 0x0800;

  const deslocamentos: number[] = [];
  for (const entrada of entradas) {
    deslocamentos.push(posicao);
    u32(0x04034b50);
    u16(20);
    u16(BANDEIRA);
    u16(0); /* método 0 = armazenado */
    u16(HORA);
    u16(DATA);
    u32(entrada.crc);
    u32(entrada.conteudo.length);
    u32(entrada.conteudo.length);
    u16(entrada.nome.length);
    u16(0);
    crus(entrada.nome);
    crus(entrada.conteudo);
  }

  const inicioDoCentral = posicao;
  entradas.forEach((entrada, i) => {
    u32(0x02014b50);
    u16(20);
    u16(20);
    u16(BANDEIRA);
    u16(0);
    u16(HORA);
    u16(DATA);
    u32(entrada.crc);
    u32(entrada.conteudo.length);
    u32(entrada.conteudo.length);
    u16(entrada.nome.length);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(0);
    u32(deslocamentos[i]);
    crus(entrada.nome);
  });

  /*
    O tamanho do diretório é lido **antes** de escrever o fim: `posicao` anda a
    cada campo, e usá-la lá embaixo somaria os doze bytes já escritos do próprio
    registro de fim — um ZIP que abre em algumas ferramentas e não em outras.
  */
  const tamanhoDoCentral = posicao - inicioDoCentral;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entradas.length);
  u16(entradas.length);
  u32(tamanhoDoCentral);
  u32(inicioDoCentral);
  u16(0);

  return saida;
}

const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A pasta de trabalho virando arquivo — a única linha impura do módulo. */
export function pastaComoBlob(pasta: Pasta): Blob {
  const dados = zipArmazenado(arquivosDaPasta(pasta));
  return new Blob([dados as BlobPart], { type: TIPO_XLSX });
}
