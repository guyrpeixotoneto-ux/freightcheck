import * as XLSX from "xlsx";
import type {
  AbaDeImpacto,
  ExportacaoDeImpacto,
  QuinzenaCell,
} from "@workspace/comparison";

/**
 * A aba Impacto como arquivo do Excel: um índice e uma aba por parâmetro.
 *
 * O cliente já monta esta planilha à mão — `Soma de finameCavalo` dobrada pela
 * data de entrada, uma coluna por quinzena. A tela reproduz essa tabela com três
 * coisas que a dele não tem (a célula vazia que não é zero, o movimento apurado
 * pelo servidor e a variação decomposta em preço e frota), e este arquivo é a
 * mesma tabela levada de volta para onde ela nasceu — só que agora para **todos**
 * os parâmetros que mudaram, de uma vez, em vez de trinta e cinco cliques.
 *
 * Duas regras mandam no formato, e as duas vêm do fato de que uma planilha é
 * lida longe de quem a gerou:
 *
 * **Ausência nunca é zero, e no Excel isso é mais grave que na tela.** Lá uma
 * célula tem `title` para explicar; aqui não há para quem perguntar. Os três
 * estados de ausência saem como três marcas diferentes — e nenhuma delas é um
 * número, para que `SOMA()` sobre a coluna não as inclua por acidente.
 *
 * **Todo número da aba está na unidade declarada no cabeçalho dela.** Sem `R$`
 * repetido em novecentas células e sem conversão de periodicidade: um valor
 * mensal continua mensal, e a coluna "Total Geral" — que soma nove quinzenas —
 * carrega, escrito no topo, que ela não é o custo de nenhum mês.
 */

/** O que uma célula pode ser no arquivo. `null` sai como célula vazia. */
type CelulaDaPlanilha = string | number | null;

/**
 * O ativo não estava na frota nesta vigência.
 *
 * Um travessão, e não um zero nem um vazio: zero diria "passou a custar nada" e
 * vazio se confundiria com a vigência que não trouxe o equipamento. É a mesma
 * distinção que a tela faz com três aparências diferentes de célula.
 */
export const FORA_DA_FROTA = "—";

/** O ativo estava na vigência e a coluna veio vazia. */
export const SEM_VALOR = "·";

/**
 * A legenda das ausências, dita uma vez em cada aba.
 *
 * Ela é o que torna as marcas acima informação em vez de enigma. Fica no topo
 * da aba, e não num rodapé: quem abre a planilha lê de cima para baixo, e uma
 * legenda depois de 64 linhas chega tarde.
 */
export const LEGENDA_DAS_AUSENCIAS =
  `Ausências: "${FORA_DA_FROTA}" o ativo não estava na frota nesta vigência · ` +
  `"${SEM_VALOR}" estava na vigência e esta coluna veio vazia · ` +
  "célula vazia: a vigência não trouxe este equipamento. Nenhuma das três é zero.";

/** O aviso que a coluna "Total Geral" precisa carregar para não ser lida errado. */
export const AVISO_DO_TOTAL =
  '"Total Geral" soma as vigências, como a tabela dinâmica — serve para ordenar e ' +
  "conferir, e não é o custo de um período: somar nove quinzenas de um valor mensal " +
  "não produz o valor de nenhum mês. A variação ponta a ponta está na coluna Δ.";

/** Uma casa a mais que o centavo não existe no fato; duas bastam. */
const FORMATO_NUMERICO = "#,##0.00";

/**
 * Contagem e valor não se escrevem igual, e a diferença não é estética.
 *
 * "2.301 alterações" com duas casas seria "2.301,00 alterações", e um valor de
 * R$ 1.234,50 escrito como "1.234,5" parece truncado justamente onde o centavo
 * importa. São duas grandezas, e cada uma tem o seu formatador.
 */
const CONTAGEM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const VALOR = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const contagem = (n: number) => CONTAGEM.format(n);
const valorEscrito = (v: number) => VALOR.format(v);
const comSinal = (v: number) => `${v > 0 ? "+" : ""}${valorEscrito(v)}`;

/** "1 ativo", "3 ativos" — o singular existe e o arquivo é lido por gente. */
const ativos = (n: number) => `${contagem(n)} ativo${n === 1 ? "" : "s"}`;

/** "MENSAL" → "por mês", como as telas escrevem. */
const POR_PERIODO: Record<string, string> = {
  MENSAL: "por mês",
  ANUAL: "por ano",
  PONTUAL: "em valor único",
};

const CLASSE_EM_PALAVRAS: Record<string, string> = {
  FIXO: "custo fixo",
  VARIAVEL: "custo variável",
  SEM_CLASSE: "sem classe de custo",
};

/** A unidade como se lê no cabeçalho da aba. */
function unidadeEscrita(unit: string | null): string {
  if (unit === "BRL") return "R$";
  if (unit === "PERCENT") return "%";
  return unit ?? "sem unidade declarada";
}

/**
 * O que o Excel recusa num nome de aba.
 *
 * Trinta e um caracteres, e sem `: \ / ? * [ ]`. Um nome inválido não é um
 * detalhe estético: o arquivo inteiro deixa de abrir, e o defeito aparece no
 * computador de quem baixou, longe de qualquer log.
 */
const PROIBIDOS_NO_NOME = /[\\/?*[\]:]/g;
const LIMITE_DO_NOME = 31;

/**
 * O nome de uma aba: o equipamento em três letras, e o parâmetro.
 *
 * O prefixo existe porque cavalo e carreta têm parâmetros de mesmo nome —
 * "Consumo de Combustível" é os dois —, e duas abas chamadas igual obrigariam o
 * Excel a numerar uma delas, produzindo um "(2)" que não diz de qual
 * equipamento é. Com o prefixo, a diferença fica escrita.
 *
 * `usados` é o que garante unicidade quando o corte de 31 caracteres faz dois
 * nomes longos coincidirem. O sufixo entra **antes** do corte, para não
 * ultrapassar o limite — e o índice do arquivo carrega o nome inteiro do
 * parâmetro de qualquer forma.
 */
export function nomeDeAba(
  entityType: string,
  title: string,
  usados: Set<string>,
): string {
  const sigla = entityType.slice(0, 3).toUpperCase();
  const limpo = `${sigla} ${title}`
    .replace(PROIBIDOS_NO_NOME, "-")
    .replace(/\s+/g, " ")
    .trim();
  const base = limpo === "" ? sigla : limpo;

  for (let tentativa = 1; ; tentativa++) {
    const sufixo = tentativa === 1 ? "" : ` (${tentativa})`;
    const nome = `${base.slice(0, LIMITE_DO_NOME - sufixo.length)}${sufixo}`;
    if (!usados.has(nome)) {
      usados.add(nome);
      return nome;
    }
  }
}

/**
 * O valor de uma célula da matriz, ou a marca da ausência dela.
 *
 * Os quatro estados de `impacto.ts`, traduzidos para as três marcas que o Excel
 * distingue. `NAO_ENTREGUE` é a única que vira célula de verdade vazia: ela não
 * é uma afirmação sobre o ativo, é a falta de um arquivo.
 */
export function celulaDaMatriz(celula: QuinzenaCell): CelulaDaPlanilha {
  if (celula.state === "VALOR") return celula.value;
  if (celula.state === "SEM_VALOR") return SEM_VALOR;
  if (celula.state === "FORA_DA_FROTA") return FORA_DA_FROTA;
  return null;
}

/**
 * As linhas de uma aba: o cabeçalho escrito, a tabela e o rodapé.
 *
 * A tabela sai com **duas** colunas de identificação em vez de uma. A tela
 * mostra o grupo como uma linha que se abre e fecha, e no Excel isso não
 * existe: repetir a data de entrada em cada linha do ativo é o que permite
 * ordenar, filtrar e montar uma tabela dinâmica em cima — que é a razão de
 * alguém querer o arquivo em vez do print da tela. As linhas de subtotal
 * continuam ali, como no exemplo que o cliente já usa, e dizem na coluna da
 * placa que são subtotal, para ninguém somá-las com os ativos.
 */
export function linhasDaAba(aba: AbaDeImpacto): CelulaDaPlanilha[][] {
  const p = aba.parametro;
  const linhas: CelulaDaPlanilha[][] = [];

  linhas.push([p.title]);
  linhas.push([
    [
      p.equipment.toLowerCase(),
      CLASSE_EM_PALAVRAS[p.classeDeCusto] ?? p.classeDeCusto,
      p.grupoDeCusto ?? "sem grupo na taxonomia",
      `${contagem(p.changes)} alterações de valor em ${contagem(p.entities)} de ${contagem(p.entitiesNaSerie)} ativos`,
    ].join(" · "),
  ]);
  linhas.push([
    [
      `valores em ${unidadeEscrita(p.unit)}`,
      ...(p.periodicity
        ? [POR_PERIODO[p.periodicity] ?? `por ${p.periodicity.toLowerCase()}`]
        : []),
      `${ativos(aba.ativos)} em ${contagem(aba.periods.length)} vigências`,
      ...(aba.groupedBy ? [`agrupados por ${aba.groupedBy.title.toLowerCase()}`] : []),
    ].join(" · "),
  ]);

  /*
    A régua vem antes da tabela, e não como nota de pé.

    Um parâmetro sem semântica confirmada tem números no arquivo — são os do
    export — e somá-los produz um resultado aritmeticamente correto que não é
    impacto financeiro apurado. Na tela isso é uma faixa amarela impossível de
    não ver; aqui é esta linha, no topo, antes de qualquer número.
  */
  const ponta = aba.pontaAPonta;
  if (p.impactoCalculavel && p.variacao && ponta) {
    linhas.push([
      `Impacto apurável entre ${ponta.fromLabel} e ${ponta.toLabel}: ` +
        `${comSinal(p.variacao.total)} no total, dos quais ${comSinal(p.variacao.preco)} ` +
        `de preço (${p.variacao.comparados} ativos nas duas pontas) e ` +
        `${comSinal(p.variacao.frota)} de frota ` +
        `(${p.variacao.entraram.entities} entraram, ${p.variacao.sairam.entities} saíram — não é preço).`,
    ]);
  } else {
    linhas.push([
      `Sem leitura financeira apurada. ${p.impactoMotivo} ` +
        "Os valores abaixo são os do arquivo, e as somas são aritmética sobre eles.",
    ]);
  }

  /*
    A aba que a tela deixa fora dos rankings diz por quê — e o arquivo é onde
    esse aviso mais importa: duas abas somadas por quem não sabe que uma contém a
    outra é a dupla contagem que este produto existe para evitar.
  */
  if (!aba.linhaEconomica) {
    linhas.push([
      p.papel === "CONJUNTO"
        ? "Esta coluna já contém o outro equipamento dentro dela" +
          (p.contem ? ` (${p.contem})` : "") +
          " — somá-la às abas daquele equipamento contaria o mesmo valor duas vezes."
        : `Este parâmetro é parcela de ${p.dentroDe ?? "um total"}, que também mudou — ` +
          "a alteração já está contada na aba daquele total.",
    ]);
  }

  linhas.push([LEGENDA_DAS_AUSENCIAS]);
  linhas.push([AVISO_DO_TOTAL]);
  linhas.push([]);

  linhas.push([
    aba.groupedBy ? aba.groupedBy.title : "grupo",
    "placa",
    ...aba.periods.map((v) => v.sourceLabel),
    "Total Geral",
    "Δ",
  ]);

  for (const grupo of aba.groups) {
    linhas.push([
      grupo.label,
      `subtotal · ${ativos(grupo.rows.length)}`,
      ...grupo.totals,
      grupo.total,
      null,
    ]);
    for (const linha of grupo.rows) {
      linhas.push([
        grupo.label,
        linha.plate ?? "sem placa",
        ...linha.cells.map(celulaDaMatriz),
        linha.total,
        linha.delta,
      ]);
    }
  }

  linhas.push([
    "Total Geral",
    ativos(aba.ativos),
    ...aba.totals,
    aba.grandTotal,
    null,
  ]);

  return linhas;
}

/**
 * O índice: o que o arquivo tem, e o que cada aba é.
 *
 * Existe por uma razão prática — o nome da aba caberia em 31 caracteres e o do
 * parâmetro não — e por uma de fundo: é aqui que fica escrito o que a tela diz
 * com ladrilhos e etiquetas. Sem ele, um arquivo de trinta e cinco abas não diz
 * quais delas somam entre si.
 */
export function linhasDoIndice(
  exportacao: ExportacaoDeImpacto,
  nomes: Map<string, string>,
  geradoEm: string,
): CelulaDaPlanilha[][] {
  const primeira = exportacao.periodos[0];
  const ultima = exportacao.periodos[exportacao.periodos.length - 1];
  const t = exportacao.totais;

  const linhas: CelulaDaPlanilha[][] = [
    ["Impacto — tudo que mudou"],
    [
      [
        exportacao.context.label,
        exportacao.corteNome ?? "Tudo (fixo, variável e sem classe)",
      ].join(" · "),
    ],
    [
      primeira && ultima
        ? `Entre ${primeira.sourceLabel} e ${ultima.sourceLabel} — ${exportacao.periodos.length} vigências.`
        : "Sem vigências no recorte.",
    ],
    [
      `${contagem(t.linhasEconomicas)} linhas econômicas · ` +
        `${contagem(t.alteracoes)} alterações de valor em até ${ativos(t.ativosAfetados)} · ` +
        `${contagem(t.comImpacto)} com impacto apurável · ` +
        `${contagem(t.semImpacto)} sem leitura financeira`,
    ],
    [`Gerado em ${geradoEm}.`],
    [
      "Uma aba por parâmetro que mudou. Em cada uma: uma linha por ativo, uma coluna por vigência. " +
        "As abas marcadas fora das linhas econômicas não somam com as outras — a coluna Papel diz por quê.",
    ],
    [],
    [
      "Aba",
      "Parâmetro",
      "Equipamento",
      "Classe",
      "Grupo na taxonomia",
      "Papel",
      "Unidade",
      "Periodicidade",
      "Alterações",
      "Ativos alterados",
      "Ativos na aba",
      "Impacto financeiro",
    ],
  ];

  for (const aba of exportacao.abas) {
    const p = aba.parametro;
    linhas.push([
      nomes.get(p.code) ?? "",
      p.title,
      p.equipment.toLowerCase(),
      CLASSE_EM_PALAVRAS[p.classeDeCusto] ?? p.classeDeCusto,
      p.grupoDeCusto ?? "sem grupo na taxonomia",
      papelEscrito(aba),
      unidadeEscrita(p.unit),
      p.periodicity
        ? (POR_PERIODO[p.periodicity] ?? p.periodicity.toLowerCase())
        : "—",
      p.changes,
      p.entities,
      aba.ativos,
      p.impactoCalculavel && p.variacao
        ? `preço ${comSinal(p.variacao.preco)} · frota ${comSinal(p.variacao.frota)}`
        : p.impactoMotivo,
    ]);
  }

  return linhas;
}

/** O papel do parâmetro na árvore econômica, na redação do panorama. */
function papelEscrito(aba: AbaDeImpacto): string {
  const p = aba.parametro;
  if (!aba.linhaEconomica) {
    return p.papel === "CONJUNTO"
      ? `já contém o outro equipamento${p.contem ? ` (${p.contem})` : ""}`
      : `parcela de ${p.dentroDe ?? "um total"} que também mudou`;
  }
  if (p.papel === "TOTAL") return `total de ${p.parcelas.length} parcelas`;
  return "linha econômica";
}

/** O que o sistema de arquivos de quem baixa não aceita num nome. */
const PROIBIDOS_NO_ARQUIVO = /[\\/:*?"<>|]/g;

/**
 * O nome do arquivo: o que ele contém, e de que recorte.
 *
 * Contexto e pontas no nome porque estes arquivos se acumulam na pasta de
 * downloads de quem confere o mês — "impacto.xlsx" ao lado de "impacto (3).xlsx"
 * não diz qual é de qual quinzena.
 */
export function nomeDoArquivo(exportacao: ExportacaoDeImpacto): string {
  const primeira = exportacao.periodos[0]?.sourceLabel;
  const ultima = exportacao.periodos[exportacao.periodos.length - 1]?.sourceLabel;
  const pedacos = [
    "Impacto",
    exportacao.context.label,
    ...(exportacao.corteNome ? [exportacao.corteNome] : []),
    ...(primeira && ultima
      ? [primeira === ultima ? primeira : `${primeira} a ${ultima}`]
      : []),
  ];
  return `${pedacos.join(" - ").replace(PROIBIDOS_NO_ARQUIVO, "-")}.xlsx`;
}

/**
 * A largura de cada coluna, para o arquivo abrir legível.
 *
 * Sem isto, `EMPURRADA_2_12_2025` sai como `####` na largura padrão do Excel, e
 * a primeira coisa que quem abre o arquivo faz é arrastar nove colunas.
 */
function colunasDaAba(aba: AbaDeImpacto): XLSX.ColInfo[] {
  return [
    { wch: 18 },
    { wch: 16 },
    ...aba.periods.map((v) => ({ wch: Math.max(12, v.sourceLabel.length + 2) })),
    { wch: 14 },
    { wch: 12 },
  ];
}

/**
 * O formato numérico em toda célula que é número.
 *
 * Aplicado depois de montar a aba, e a toda ela: cada número deste arquivo está
 * na unidade declarada no cabeçalho, então não há duas famílias de formato a
 * distinguir. As marcas de ausência são texto e passam por aqui intocadas — que
 * é exatamente por que elas são texto.
 */
function formatarNumeros(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const celula = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (celula?.t === "n") celula.z = FORMATO_NUMERICO;
    }
  }
}

/**
 * O arquivo inteiro, pronto para descer pelo `res.send`.
 *
 * A ordem das abas é a da leitura, que é a da tela: dinheiro apurado primeiro,
 * pelo módulo da variação de preço, e depois o que mudou muito e ainda não
 * sabemos ler. A primeira aba de uma planilha é lida como a resposta, e por isso
 * ela não pode ser a primeira em ordem alfabética.
 */
export function montarPlanilhaDeImpacto(
  exportacao: ExportacaoDeImpacto,
  geradoEm: string,
): Buffer {
  const wb = XLSX.utils.book_new();

  /*
    Os nomes saem antes do índice porque o índice os cita: ele é a única página
    que liga "CAV Consumo de Combustível" ao nome inteiro do parâmetro.
  */
  const usados = new Set<string>();
  const nomes = new Map<string, string>();
  for (const aba of exportacao.abas) {
    nomes.set(
      aba.parametro.code,
      nomeDeAba(aba.parametro.entityType, aba.parametro.title, usados),
    );
  }

  const indice = XLSX.utils.aoa_to_sheet(linhasDoIndice(exportacao, nomes, geradoEm));
  indice["!cols"] = [
    { wch: 32 },
    { wch: 34 },
    { wch: 12 },
    { wch: 18 },
    { wch: 24 },
    { wch: 30 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 60 },
  ];
  XLSX.utils.book_append_sheet(wb, indice, "Índice");

  for (const aba of exportacao.abas) {
    const ws = XLSX.utils.aoa_to_sheet(linhasDaAba(aba));
    ws["!cols"] = colunasDaAba(aba);
    formatarNumeros(ws);
    XLSX.utils.book_append_sheet(wb, ws, nomes.get(aba.parametro.code));
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Quando o arquivo foi gerado, no fuso de quem o lê.
 *
 * O horário de Brasília, e não UTC: quem confere o mês está no Brasil, e um
 * "gerado em 17/08/2026 17:32" que na verdade é 14:32 faria duas exportações do
 * mesmo dia parecerem fora de ordem.
 */
export function agoraEmBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(agora);
}
