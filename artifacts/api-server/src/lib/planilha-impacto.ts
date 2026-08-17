import ExcelJS from "exceljs";
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
 * Três regras mandam no formato, e as três vêm do fato de que uma planilha é
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
 *
 * **A cor é a mesma da tela, e ela não é decoração.** Verde e vermelho dizem em
 * que vigência o valor de cada ativo se moveu — na tela isso é o que faz a
 * alteração aparecer sem que ninguém compare duas colunas na cabeça, e no arquivo
 * é a única pista que sobrevive à ausência dos `title`. Quem pinta é o servidor,
 * a partir do `movimento` que ele mesmo apurou: nenhuma célula é colorida por
 * comparação feita aqui.
 *
 * O escritor é o `exceljs`, e não o `xlsx` que o resto do repositório usa para
 * **ler** planilha. O motivo é só um: a edição community do SheetJS lê estilo e
 * não grava — pintar por lá exigiria a versão paga. O `xlsx` continua onde
 * sempre esteve, na importação.
 */

/**
 * O tom de uma célula — o que ela é, e não que cor ela tem.
 *
 * A cor mora num lugar só ({@link PALETA}), e o resto do arquivo fala em tom.
 * É a mesma razão pela qual a tela usa tokens em vez de hexadecimal: quando o
 * verde do produto mudar, ele muda numa linha.
 */
export type Tom =
  /** Subiu em relação à vigência anterior. */
  | "SUBIU"
  /** Caiu em relação à vigência anterior. */
  | "CAIU"
  /** Entrou na frota nesta vigência — frota maior não é preço maior. */
  | "ENTROU"
  /** Saiu da frota nesta vigência. */
  | "SAIU"
  /** A vigência não trouxe este equipamento. Hachurado, como na tela. */
  | "NAO_ENTREGUE"
  /** O ativo estava na vigência e a coluna veio vazia. */
  | "SEM_VALOR"
  /** Cabeçalho da tabela e linha de Total Geral. */
  | "CABECALHO"
  /** Linha de subtotal de um grupo. */
  | "GRUPO"
  /** O título da aba. */
  | "TITULO";

/**
 * Uma célula do arquivo: o valor, e o tom quando ele diz alguma coisa.
 *
 * O tom viaja **junto** com o valor, e não numa segunda matriz paralela: duas
 * estruturas alinhadas por índice divergem na primeira linha que alguém
 * acrescentar, e o defeito apareceria como uma cor na célula errada — que é
 * pior do que cor nenhuma, porque parece informação.
 */
export interface CelulaDaPlanilha {
  valor: string | number | null;
  tom?: Tom;
}

/** Valor sem tom — a maioria das células. */
const cel = (valor: string | number | null): CelulaDaPlanilha => ({ valor });

/**
 * As cores, uma vez, em hexadecimal — as mesmas classes que a tela usa.
 *
 * `fundo` e `texto` saem do Tailwind que `impacto-quinzenas.tsx` aplica:
 * `bg-emerald-50`/`text-emerald-800` no que subiu, `bg-red-50`/`text-red-700` no
 * que caiu, `bg-emerald-50/60` no ativo que entrou, `bg-red-50/60` no que saiu, e
 * o fundo `muted` do cabeçalho e dos subtotais. A transparência das duas com
 * `/60` foi resolvida contra branco, porque no Excel não há alfa: é a mesma
 * decisão que a tela toma com `color-mix` nas células presas.
 */
const PALETA: Record<Tom, { fundo?: string; texto?: string; negrito?: boolean }> = {
  SUBIU: { fundo: "FFECFDF5", texto: "FF065F46" },
  CAIU: { fundo: "FFFEF2F2", texto: "FFB91C1C" },
  ENTROU: { fundo: "FFF4FDF8", texto: "FF065F46" },
  SAIU: { fundo: "FFFEF7F7", texto: "FF94A3B8" },
  NAO_ENTREGUE: {},
  SEM_VALOR: { texto: "FF94A3B8" },
  CABECALHO: { fundo: "FFF1F5F9", negrito: true },
  GRUPO: { fundo: "FFF8FAFC", negrito: true },
  TITULO: { negrito: true },
};

/**
 * O tom da célula de valor, a partir do movimento que o servidor apurou.
 *
 * `IGUAL` não tem cor, e isso é deliberado: a tela também não pinta o que não se
 * moveu. Pintar "igual" de cinza faria a ausência de movimento parecer um
 * terceiro estado, quando ela é o fundo contra o qual os outros dois se leem.
 */
function tomDoMovimento(celula: QuinzenaCell): Tom | undefined {
  if (celula.state === "NAO_ENTREGUE") return "NAO_ENTREGUE";
  if (celula.state === "SEM_VALOR") return "SEM_VALOR";
  if (celula.state === "FORA_DA_FROTA") {
    return celula.movimento === "SAIU" ? "SAIU" : undefined;
  }
  if (celula.movimento === "SUBIU") return "SUBIU";
  if (celula.movimento === "CAIU") return "CAIU";
  if (celula.movimento === "ENTROU") return "ENTROU";
  return undefined;
}

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
  const tom = tomDoMovimento(celula);
  const comTom = (valor: string | number | null): CelulaDaPlanilha =>
    tom === undefined ? { valor } : { valor, tom };

  if (celula.state === "VALOR") return comTom(celula.value);
  if (celula.state === "SEM_VALOR") return comTom(SEM_VALOR);
  if (celula.state === "FORA_DA_FROTA") return comTom(FORA_DA_FROTA);
  return comTom(null);
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

  linhas.push([{ valor: p.title, tom: "TITULO" }]);
  linhas.push([
    cel([
      p.equipment.toLowerCase(),
      CLASSE_EM_PALAVRAS[p.classeDeCusto] ?? p.classeDeCusto,
      p.grupoDeCusto ?? "sem grupo na taxonomia",
      `${contagem(p.changes)} alterações de valor em ${contagem(p.entities)} de ${contagem(p.entitiesNaSerie)} ativos`,
    ].join(" · ")),
  ]);
  linhas.push([
    cel([
      `valores em ${unidadeEscrita(p.unit)}`,
      ...(p.periodicity
        ? [POR_PERIODO[p.periodicity] ?? `por ${p.periodicity.toLowerCase()}`]
        : []),
      `${ativos(aba.ativos)} em ${contagem(aba.periods.length)} vigências`,
      ...(aba.groupedBy ? [`agrupados por ${aba.groupedBy.title.toLowerCase()}`] : []),
    ].join(" · ")),
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
      cel(`Impacto apurável entre ${ponta.fromLabel} e ${ponta.toLabel}: ` +
        `${comSinal(p.variacao.total)} no total, dos quais ${comSinal(p.variacao.preco)} ` +
        `de preço (${p.variacao.comparados} ativos nas duas pontas) e ` +
        `${comSinal(p.variacao.frota)} de frota ` +
        `(${p.variacao.entraram.entities} entraram, ${p.variacao.sairam.entities} saíram — não é preço).`),
    ]);
  } else {
    linhas.push([
      cel(`Sem leitura financeira apurada. ${p.impactoMotivo} ` +
        "Os valores abaixo são os do arquivo, e as somas são aritmética sobre eles."),
    ]);
  }

  /*
    A aba que a tela deixa fora dos rankings diz por quê — e o arquivo é onde
    esse aviso mais importa: duas abas somadas por quem não sabe que uma contém a
    outra é a dupla contagem que este produto existe para evitar.
  */
  if (!aba.linhaEconomica) {
    linhas.push([
      cel(p.papel === "CONJUNTO"
        ? "Esta coluna já contém o outro equipamento dentro dela" +
          (p.contem ? ` (${p.contem})` : "") +
          " — somá-la às abas daquele equipamento contaria o mesmo valor duas vezes."
        : `Este parâmetro é parcela de ${p.dentroDe ?? "um total"}, que também mudou — ` +
          "a alteração já está contada na aba daquele total."),
    ]);
  }

  linhas.push([cel(LEGENDA_DAS_AUSENCIAS)]);
  linhas.push([cel(AVISO_DO_TOTAL)]);
  linhas.push([]);

  /*
    O cabeçalho e as linhas de total recebem o mesmo fundo `muted` da tela, e as
    de subtotal o fundo mais claro do grupo. Não é enfeite: numa tabela de nove
    colunas de vigência é o que separa, de relance, o ativo do total que o
    contém — na tela isso é `bg-muted/40` contra `bg-muted/20`.
  */
  const estrutural = (valores: (string | number | null)[], tom: Tom) =>
    valores.map((valor) => ({ valor, tom }));

  linhas.push(
    estrutural(
      [
        aba.groupedBy ? aba.groupedBy.title : "grupo",
        "placa",
        ...aba.periods.map((v) => v.sourceLabel),
        "Total Geral",
        "Δ",
      ],
      "CABECALHO",
    ),
  );

  for (const grupo of aba.groups) {
    linhas.push(
      estrutural(
        [
          grupo.label,
          `subtotal · ${ativos(grupo.rows.length)}`,
          ...grupo.totals,
          grupo.total,
          null,
        ],
        "GRUPO",
      ),
    );
    for (const linha of grupo.rows) {
      linhas.push([
        cel(grupo.label),
        cel(linha.plate ?? "sem placa"),
        ...linha.cells.map(celulaDaMatriz),
        cel(linha.total),
        // O Δ da linha ganha a cor do sinal, como na tela: vermelho quando o
        // ativo ficou mais barato ponta a ponta, verde quando ficou mais caro.
        {
          valor: linha.delta,
          ...(linha.delta !== null && linha.delta !== 0
            ? { tom: linha.delta > 0 ? ("SUBIU" as const) : ("CAIU" as const) }
            : {}),
        },
      ]);
    }
  }

  linhas.push(
    estrutural(
      ["Total Geral", ativos(aba.ativos), ...aba.totals, aba.grandTotal, null],
      "CABECALHO",
    ),
  );

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
    [{ valor: "Impacto — tudo que mudou", tom: "TITULO" }],
    [
      cel(
        [
          exportacao.context.label,
          exportacao.corteNome ?? "Tudo (fixo, variável e sem classe)",
        ].join(" · "),
      ),
    ],
    [
      cel(
        primeira && ultima
          ? `Entre ${primeira.sourceLabel} e ${ultima.sourceLabel} — ${exportacao.periodos.length} vigências.`
          : "Sem vigências no recorte.",
      ),
    ],
    [
      cel(
        `${contagem(t.linhasEconomicas)} linhas econômicas · ` +
          `${contagem(t.alteracoes)} alterações de valor em até ${ativos(t.ativosAfetados)} · ` +
          `${contagem(t.comImpacto)} com impacto apurável · ` +
          `${contagem(t.semImpacto)} sem leitura financeira`,
      ),
    ],
    [cel(`Gerado em ${geradoEm}.`)],
    [
      cel(
        "Uma aba por parâmetro que mudou. Em cada uma: uma linha por ativo, uma coluna por vigência. " +
          "As abas marcadas fora das linhas econômicas não somam com as outras — a coluna Papel diz por quê. " +
          "As cores das abas são as mesmas da tela: verde subiu, vermelho caiu.",
      ),
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
    ].map((valor) => ({ valor, tom: "CABECALHO" as const })),
  ];

  for (const aba of exportacao.abas) {
    const p = aba.parametro;
    linhas.push(
      [
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
      ].map(cel),
    );
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

/** A largura das colunas do índice, na ordem em que `linhasDoIndice` as escreve. */
const LARGURAS_DO_INDICE = [32, 34, 12, 18, 24, 30, 10, 14, 12, 16, 14, 60];

/**
 * A largura de cada coluna, para o arquivo abrir legível.
 *
 * Sem isto, `EMPURRADA_2_12_2025` sai como `####` na largura padrão do Excel, e
 * a primeira coisa que quem abre o arquivo faz é arrastar nove colunas.
 */
function largurasDaAba(aba: AbaDeImpacto): number[] {
  return [
    18,
    16,
    ...aba.periods.map((v) => Math.max(12, v.sourceLabel.length + 2)),
    14,
    12,
  ];
}

/**
 * A seta dentro da célula, sem tirar dela a condição de número.
 *
 * A tela põe ↗ e ↘ nas células que se moveram, e a cor sozinha não basta: quem
 * não distingue verde de vermelho perderia a informação inteira, e uma planilha
 * impressa em preto e branco também. Escrever a seta no **formato** do número —
 * `"↗ "#,##0.00` — mantém a célula numérica: `SOMA()` continua somando, o Excel
 * continua ordenando, e a seta aparece do lado do valor como na tela.
 */
const FORMATO_POR_TOM: Partial<Record<Tom, string>> = {
  SUBIU: `"↗ "${FORMATO_NUMERICO}`,
  CAIU: `"↘ "${FORMATO_NUMERICO}`,
};

/**
 * Escreve uma célula: valor, formato e a cor do tom dela.
 *
 * O `NAO_ENTREGUE` é o único caso sem valor **e** com pintura: um hachurado
 * claro, que é o que a tela desenha com listras diagonais. Sem ele a vigência
 * que não trouxe o equipamento ficaria idêntica a uma célula vazia qualquer, e
 * essa é justamente a distinção que a leitura inteira existe para preservar.
 */
function escreverCelula(
  destino: ExcelJS.Cell,
  celula: CelulaDaPlanilha,
  numerica: boolean,
): void {
  const tom = celula.tom;
  const estilo = tom ? PALETA[tom] : undefined;

  if (celula.valor !== null) destino.value = celula.valor;

  if (typeof celula.valor === "number") {
    destino.numFmt = (tom && FORMATO_POR_TOM[tom]) ?? FORMATO_NUMERICO;
  }
  if (numerica) destino.alignment = { horizontal: "right" };

  if (tom === "NAO_ENTREGUE") {
    destino.fill = {
      type: "pattern",
      pattern: "lightUp",
      fgColor: { argb: "FFCBD5E1" },
      bgColor: { argb: "FFFFFFFF" },
    };
    return;
  }

  if (estilo?.fundo) {
    destino.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: estilo.fundo },
    };
  }
  if (estilo?.texto || estilo?.negrito) {
    destino.font = {
      ...(estilo.texto ? { color: { argb: estilo.texto } } : {}),
      ...(estilo.negrito ? { bold: true } : {}),
    };
  }
}

/**
 * Quantas colunas identificam a linha antes de começarem as vigências.
 *
 * Grupo e placa. São elas que ficam presas na rolagem horizontal, pela mesma
 * razão que a tela prende a coluna da placa: em nove colunas de vigência, quem
 * rola até agosto precisa continuar sabendo de qual ativo é a linha.
 */
const COLUNAS_DE_IDENTIFICACAO = 2;

/**
 * Em que linha está o cabeçalho da tabela — a última que fica presa no topo.
 *
 * Achado pelo **tom**, e não pela contagem das linhas do bloco de texto acima
 * dele: aquele bloco tem uma linha a mais nas abas que não são linha econômica,
 * e um número fixo aqui congelaria o lugar errado justamente nelas. `CABECALHO`
 * também marca o rodapé de Total Geral, e por isso vale a **primeira**
 * ocorrência.
 */
export function linhaDoCabecalho(linhas: CelulaDaPlanilha[][]): number {
  return linhas.findIndex((l) => l[0]?.tom === "CABECALHO") + 1;
}

/**
 * O arquivo inteiro, pronto para descer pelo `res.send`.
 *
 * A ordem das abas é a da leitura, que é a da tela: dinheiro apurado primeiro,
 * pelo módulo da variação de preço, e depois o que mudou muito e ainda não
 * sabemos ler. A primeira aba de uma planilha é lida como a resposta, e por isso
 * ela não pode ser a primeira em ordem alfabética.
 *
 * Assíncrona porque o `exceljs` serializa o zip em stream. É a única diferença
 * de assinatura que a troca de escritor trouxe.
 */
export async function montarPlanilhaDeImpacto(
  exportacao: ExportacaoDeImpacto,
  geradoEm: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FreightCheck";

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

  const preencher = (
    ws: ExcelJS.Worksheet,
    linhas: CelulaDaPlanilha[][],
    larguras: number[],
    primeiraColunaNumerica: number,
  ) => {
    ws.columns = larguras.map((width) => ({ width }));
    linhas.forEach((linha, i) => {
      const destino = ws.getRow(i + 1);
      linha.forEach((celula, j) => {
        escreverCelula(
          destino.getCell(j + 1),
          celula,
          j + 1 >= primeiraColunaNumerica,
        );
      });
    });
  };

  const indice = wb.addWorksheet("Índice");
  // As duas primeiras colunas do índice são nomes; da terceira em diante é
  // classificação, e as contagens ficam à direita como em qualquer planilha.
  preencher(
    indice,
    linhasDoIndice(exportacao, nomes, geradoEm),
    LARGURAS_DO_INDICE,
    LARGURAS_DO_INDICE.length + 1,
  );

  for (const aba of exportacao.abas) {
    const ws = wb.addWorksheet(nomes.get(aba.parametro.code));
    const linhas = linhasDaAba(aba);
    // Grupo e placa à esquerda; vigências, Total Geral e Δ à direita.
    preencher(ws, linhas, largurasDaAba(aba), 3);
    ws.views = [
      {
        state: "frozen",
        xSplit: COLUNAS_DE_IDENTIFICACAO,
        ySplit: linhaDoCabecalho(linhas),
      },
    ];
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
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
