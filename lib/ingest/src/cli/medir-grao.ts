/**
 * Que coluna identifica uma linha desta planilha — medido, não escolhido.
 *
 * ---------------------------------------------------------------------------
 * Por que esta ferramenta existe
 * ---------------------------------------------------------------------------
 * O leitor tem um grão fixo — `vigência` + `placa` — e ele foi escrito para os
 * dois equipamentos que a Ambev entregava. Trecho não tem placa: a perna da
 * rota é identificada por outra coisa, e *qual* outra coisa é uma pergunta
 * sobre o arquivo do cliente, não sobre o nosso código.
 *
 * A tentação é responder por leitura: o dicionário do Freightec traz uma coluna
 * chamada `chaveTrecho`, descrita como "Chave do trecho - campo chave", e
 * parece resolvido. Não é. "Campo chave" é o que o cadastro chama de chave; o
 * que a importação precisa saber é se ela **de fato** identifica uma linha
 * dentro de uma vigência, sem repetir e sem faltar. As duas coisas divergem com
 * frequência — uma chave de cadastro costuma repetir quando a mesma rota é
 * operada por dois transportadores, ou com duas capacidades de carga.
 *
 * Escolher a chave errada não dá erro: dá **dado silenciosamente errado**. Uma
 * chave que repete faz duas rotas virarem a mesma entidade, e a segunda linha
 * ou é recusada como duplicata conflitante ou sobrescreve a primeira. Uma chave
 * instável entre vigências faz a mesma rota virar uma entidade nova a cada
 * quinzena, e a comparação passa a dizer que a frota inteira foi criada e
 * apagada. Foi essa classe de erro que produziu MODELOCARRETA.
 *
 * Então: mede-se. Este CLI não decide nada e não escreve nada — nem no banco,
 * nem no arquivo. Ele lê a planilha e imprime, para cada coluna candidata,
 * quanto ela preenche, quanto ela repete dentro da vigência e quanto ela se
 * mantém entre vigências. A decisão é de quem lê a tabela.
 *
 * ---------------------------------------------------------------------------
 * Uso
 * ---------------------------------------------------------------------------
 *   tsx src/cli/medir-grao.ts <arquivo.xlsx> [--aba Nome] [--composta a,b,c]
 *
 * `--composta` pode repetir: cada ocorrência é uma chave composta a medir, com
 * os nomes das colunas como aparecem no cabeçalho (ou o slug delas).
 *
 * Não precisa de banco.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { foldText, slugifyColumn } from "../workbook";
import { normalizeIdentifier } from "../canonical-identity";
import { parseVigenciaLabel } from "../vigencia";

interface Coluna {
  indice: number;
  header: string;
  slug: string;
}

/** Uma coluna e a posição dela dentro da linha lida (colunas vazias saem). */
interface ColunaPosicionada extends Coluna {
  posicaoNaLinha: number;
}

interface Medida {
  nome: string;
  colunas: string[];
  /** Linhas com todos os componentes preenchidos, sobre o total. */
  preenchimento: number;
  /** Chaves distintas por vigência, somadas. */
  distintas: number;
  /** Linhas que repetem uma chave já vista na mesma vigência. */
  repetidas: number;
  /** Maior número de linhas com a mesma chave numa vigência. */
  maiorRepeticao: number;
  /** Exemplo de chave repetida, para quem for conferir no Excel. */
  exemploRepetido: string | null;
  /**
   * Presença entre vigências: fração das chaves da vigência mais cheia que
   * reaparecem em todas as outras. 1 quer dizer população estável.
   */
  estabilidade: number | null;
  /** Estabilidade semântica — calculada só para quem passa no teste de chave. */
  semantica: EstabilidadeSemantica | null;
}

/**
 * A chave continua nomeando **a mesma coisa** ao longo do arquivo?
 *
 * Unicidade e permanência são perguntas sobre a chave. Esta é sobre o que ela
 * carrega: uma chave que identifica a linha e permanece entre quinzenas ainda
 * pode estar sendo **reaproveitada** — o cadastro aposenta a rota Camaçari→
 * Salvador e reusa `CAM-SSA-01` para Camaçari→Feira no mês seguinte. Nas duas
 * medidas anteriores isso passa limpo: não repete, e reaparece em todas as
 * vigências. E é a pior falha das três, porque a comparação entre vigências
 * atribuiria a variação de preço de uma rota à outra.
 *
 * A medida: para cada valor da chave, quantas colunas do arquivo mantêm **um
 * único valor** ao longo de todas as vigências.
 *
 * - `ancoras` são as colunas constantes por chave. São elas que provam que a
 *   chave nomeia uma coisa, e não uma linha: se nenhuma coluna acompanha a
 *   chave, ela não descreve nada estável.
 * - `quaseAncoras` são as que ficam constantes em 90% ou mais das chaves — e
 *   não em todas. É a lista mais informativa das duas: uma coluna cadastral
 *   quase constante é exatamente o rastro de uma chave reaproveitada, e ela
 *   nomeia a linha do Excel onde ir conferir.
 *
 * Colunas de dinheiro e direcionadores **devem** variar entre vigências (é a
 * razão de a tabela ser versionada), então elas não aparecem como âncoras e
 * isso não é defeito. O que se lê aqui é a lista de âncoras: origem, destino,
 * capacidade, operador.
 */
interface EstabilidadeSemantica {
  /** Colunas constantes por chave, em todas as vigências. */
  ancoras: string[];
  /** Colunas constantes em 90%+ das chaves, mas não em todas. */
  quaseAncoras: { coluna: string; fracao: number; exemplo: string | null }[];
  /** Chaves cujo conjunto de âncoras candidatas discordou. */
  chavesComDivergencia: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * A partir de quanta constância uma coluna vira "quase âncora".
 *
 * 0,9 não é sagrado: é a faixa em que "a coluna descreve a chave" e "esta chave
 * foi reaproveitada" ficam distinguíveis. Abaixo disso a coluna simplesmente
 * varia — é dado de vigência, não descrição de identidade.
 */
const LIMIAR_DE_ANCORA = 0.9;

function lerAba(sheet: XLSX.WorkSheet): { colunas: Coluna[]; linhas: string[][] } {
  const ref = sheet["!ref"];
  if (!ref) return { colunas: [], linhas: [] };
  const range = XLSX.utils.decode_range(ref);

  const colunas: Coluna[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })] as
      | XLSX.CellObject
      | undefined;
    const header = cell?.v === undefined ? "" : String(cell.v).trim();
    if (header === "") continue;
    colunas.push({ indice: c, header, slug: slugifyColumn(header) });
  }

  const linhas: string[][] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const linha: string[] = [];
    let vazia = true;
    for (const coluna of colunas) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: coluna.indice })] as
        | XLSX.CellObject
        | undefined;
      const texto =
        cell?.v === undefined || cell.v === null ? "" : String(cell.v).trim();
      if (texto !== "") vazia = false;
      linha.push(texto);
    }
    if (!vazia) linhas.push(linha);
  }

  return { colunas, linhas };
}

/**
 * A vigência de cada linha, pelo mesmo leitor que o pipeline usa.
 *
 * Rótulo ilegível não vira "sem vigência": vira o texto cru, que continua
 * separando as linhas em grupos. Medir unicidade é uma pergunta sobre
 * agrupamento, e ela não precisa da data resolvida.
 */
function vigenciaDaLinha(linha: string[], indiceDaVigencia: number): string {
  const cru = linha[indiceDaVigencia] ?? "";
  return parseVigenciaLabel(cru).label || cru || "(sem vigência)";
}

function medir(
  nome: string,
  componentes: ColunaPosicionada[],
  linhas: string[][],
  indiceDaVigencia: number,
): Medida {
  const porVigencia = new Map<string, Map<string, number>>();
  let preenchidas = 0;
  let repetidas = 0;
  let maiorRepeticao = 0;
  let exemploRepetido: string | null = null;

  for (const linha of linhas) {
    const valores = componentes.map((c) => linha[c.posicaoNaLinha] ?? "");
    if (valores.some((v) => v === "")) continue;
    preenchidas++;

    const vigencia = vigenciaDaLinha(linha, indiceDaVigencia);
    const chave = valores.map((v) => normalizeIdentifier(v)).join("");
    let bucket = porVigencia.get(vigencia);
    if (!bucket) {
      bucket = new Map();
      porVigencia.set(vigencia, bucket);
    }
    const vistas = (bucket.get(chave) ?? 0) + 1;
    bucket.set(chave, vistas);
    if (vistas > 1) {
      repetidas++;
      if (vistas > maiorRepeticao) {
        maiorRepeticao = vistas;
        exemploRepetido = valores.join(" · ");
      }
    }
  }

  let distintas = 0;
  for (const bucket of porVigencia.values()) distintas += bucket.size;

  let estabilidade: number | null = null;
  if (porVigencia.size > 1) {
    const grupos = [...porVigencia.values()];
    const maior = grupos.reduce((a, b) => (b.size > a.size ? b : a));
    const outras = grupos.filter((g) => g !== maior);
    let presentes = 0;
    for (const chave of maior.keys()) {
      if (outras.every((g) => g.has(chave))) presentes++;
    }
    estabilidade = maior.size === 0 ? null : presentes / maior.size;
  }

  return {
    nome,
    colunas: componentes.map((c) => c.header),
    preenchimento: linhas.length === 0 ? 0 : preenchidas / linhas.length,
    distintas,
    repetidas,
    maiorRepeticao,
    exemploRepetido,
    estabilidade,
    semantica: null,
  };
}

/**
 * O que acompanha esta chave sem mudar — a estabilidade semântica.
 *
 * Roda **só** para as candidatas que já passaram no teste de chave, e não para
 * as 110 colunas: é uma varredura de (chaves × colunas), e fazê-la para toda
 * coluna candidata seria quadrática num arquivo grande sem informar nada — uma
 * coluna que repete dentro da vigência já está descartada antes daqui.
 */
function medirSemantica(
  componentes: ColunaPosicionada[],
  todas: ColunaPosicionada[],
  linhas: string[][],
): EstabilidadeSemantica {
  const daChave = new Set(componentes.map((c) => c.posicaoNaLinha));
  const outras = todas.filter((c) => !daChave.has(c.posicaoNaLinha));

  /** chave -> coluna -> valores vistos */
  const porChave = new Map<string, Map<number, Set<string>>>();
  for (const linha of linhas) {
    const valores = componentes.map((c) => linha[c.posicaoNaLinha] ?? "");
    if (valores.some((v) => v === "")) continue;
    const chave = valores.map((v) => normalizeIdentifier(v)).join("");
    let bucket = porChave.get(chave);
    if (!bucket) {
      bucket = new Map();
      porChave.set(chave, bucket);
    }
    for (const coluna of outras) {
      const valor = (linha[coluna.posicaoNaLinha] ?? "").trim();
      // Célula vazia não é discordância: é ausência, e tratá-la como um valor
      // faria toda coluna com buraco parecer instável.
      if (valor === "") continue;
      let vistos = bucket.get(coluna.posicaoNaLinha);
      if (!vistos) {
        vistos = new Set();
        bucket.set(coluna.posicaoNaLinha, vistos);
      }
      vistos.add(valor);
    }
  }

  const ancoras: string[] = [];
  const quaseAncoras: EstabilidadeSemantica["quaseAncoras"] = [];
  const divergiu = new Set<string>();

  for (const coluna of outras) {
    let constantes = 0;
    let observadas = 0;
    let exemplo: string | null = null;
    const discordantes: string[] = [];
    for (const [chave, bucket] of porChave) {
      const vistos = bucket.get(coluna.posicaoNaLinha);
      if (!vistos || vistos.size === 0) continue;
      observadas++;
      if (vistos.size === 1) constantes++;
      else {
        discordantes.push(chave);
        if (exemplo === null) exemplo = [...vistos].slice(0, 3).join(" / ");
      }
    }
    if (observadas === 0) continue;
    const fracao = constantes / observadas;
    if (fracao === 1) {
      ancoras.push(coluna.header);
      continue;
    }
    if (fracao < LIMIAR_DE_ANCORA) continue;
    quaseAncoras.push({ coluna: coluna.header, fracao, exemplo });
    /*
      A contagem de chaves suspeitas conta **só** as que discordam numa coluna
      quase-âncora.

      Contar qualquer divergência daria o arquivo inteiro: preço, pedágio e
      quilometragem mudam entre vigências porque a tabela é versionada, e é
      para isso que ela existe. O sinal é a chave que discorda numa coluna em
      que quase todas as outras concordam.
    */
    for (const chave of discordantes) divergiu.add(chave);
  }

  quaseAncoras.sort((a, b) => b.fracao - a.fracao);
  return { ancoras, quaseAncoras, chavesComDivergencia: divergiu.size };
}

/**
 * A natureza de cada coluna — e por que ela é lida, e não decidida aqui.
 *
 * A pergunta "esta coluna é identidade, descrição, operação ou remuneração?"
 * tem duas metades, e só uma delas se mede.
 *
 * **A metade que se mede** é a identidade: unicidade, permanência e âncora são
 * contagens sobre o arquivo, e é o que o resto deste CLI faz.
 *
 * **A metade que não se mede** é a diferença entre um direcionador operacional
 * e uma rubrica de remuneração. `kmIda` e `freteReaisViagemPedagio` são os dois
 * números por linha; qual deles vira dinheiro na DRE é uma afirmação de
 * negócio, e este arquivo não tem como derivá-la de estatística nenhuma.
 *
 * O que ele **não** vai fazer é chutar por nome de coluna — é a regra deste
 * repositório desde `identity.ts`, e aqui o chute seria pior: classificar
 * `pedagioReaisKM` como remuneratória porque tem "pedagio" no nome erraria toda
 * vez que a operação nomeasse uma coluna de outro jeito.
 *
 * Então ele **lê a resposta de quem já a deu**. As planilhas de
 * `docs/planilha-atributos-*-dre.xlsx` são o dicionário do próprio Freightec,
 * com "Categoria DRE - Sintético" e "Categoria DRE - Analítico" preenchidos por
 * coluna. `Não entra na DRE + Cadastral` é descrição; `Não entra na DRE +
 * Direcionador operacional` é operação; qualquer categoria de DRE de verdade —
 * receita, dedução, custo variável, margem — é remuneração.
 *
 * Sem `--dicionario`, a classificação simplesmente não sai, e o relatório diz
 * isso. Uma coluna classificada por palpite seria pior do que uma coluna sem
 * classificação nenhuma.
 */
type Natureza =
  | "COMPETENCIA"
  | "IDENTIDADE"
  | "DESCRITIVO"
  | "OPERACIONAL"
  | "REMUNERATORIO"
  | "?";

interface EntradaDoDicionario {
  sintetico: string;
  analitico: string;
}

function lerDicionario(caminho: string): Map<string, EntradaDoDicionario> {
  const wb = XLSX.read(readFileSync(caminho), { type: "buffer" });
  const mapa = new Map<string, EntradaDoDicionario>();
  for (const nomeDaAba of wb.SheetNames) {
    const { colunas, linhas } = lerAba(wb.Sheets[nomeDaAba]!);
    const indice = (rotulo: string) =>
      colunas.findIndex((c) => foldText(c.header) === foldText(rotulo));
    const iAtributo = indice("Atributo");
    const iSintetico = indice("Categoria DRE - Sintético");
    const iAnalitico = indice("Categoria DRE - Análitico");
    if (iAtributo < 0 || iSintetico < 0) continue;
    for (const linha of linhas) {
      const atributo = (linha[iAtributo] ?? "").trim();
      if (atributo === "") continue;
      mapa.set(slugifyColumn(atributo), {
        sintetico: (linha[iSintetico] ?? "").trim(),
        analitico: (iAnalitico >= 0 ? (linha[iAnalitico] ?? "") : "").trim(),
      });
    }
  }
  return mapa;
}

const FORA_DA_DRE = "nao entra na dre";

function naturezaDe(
  coluna: ColunaPosicionada,
  dicionario: Map<string, EntradaDoDicionario> | null,
  identidades: Set<string>,
): Natureza {
  // A vigência não é uma coluna a classificar: é o eixo contra o qual todas as
  // outras são classificadas. Listá-la como "cadastral" — que é o que o
  // dicionário diz dela — misturaria o eixo com o que ele mede.
  if (foldText(coluna.header) === "vigencia") return "COMPETENCIA";
  if (identidades.has(coluna.header)) return "IDENTIDADE";
  if (!dicionario) return "?";
  const entrada = dicionario.get(coluna.slug);
  if (!entrada) return "?";
  if (foldText(entrada.sintetico) !== FORA_DA_DRE) return "REMUNERATORIO";
  return foldText(entrada.analitico).includes("direcionador")
    ? "OPERACIONAL"
    : "DESCRITIVO";
}

const EXPLICACAO_DA_NATUREZA: Record<Natureza, string> = {
  COMPETENCIA: "o eixo do versionamento — não é coluna a classificar",
  IDENTIDADE: "identifica a linha e permanece — candidata a chave",
  DESCRITIVO: "cadastro: descreve, e pode mudar sem que a coisa mude",
  OPERACIONAL: "direcionador da operação — muda por vigência, de propósito",
  REMUNERATORIO: "entra na DRE: é dinheiro, e é o que a comparação audita",
  "?": "sem classificação — a coluna não está no dicionário informado",
};

/**
 * Todos os casos em que uma chave mudou de descrição, um por linha.
 *
 * A contagem agregada responde "há reaproveitamento?"; esta lista responde
 * "onde", que é o que permite abrir o Excel e conferir. Sai ordenada por chave
 * e por vigência, com o valor de antes e o de depois lado a lado.
 */
function listarDivergencias(
  componentes: ColunaPosicionada[],
  observadas: ColunaPosicionada[],
  linhas: string[][],
  indiceDaVigencia: number,
): {
  chave: string;
  coluna: string;
  de: { vigencia: string; valor: string };
  para: { vigencia: string; valor: string };
}[] {
  /** chave -> coluna -> vigência -> valor */
  const porChave = new Map<string, Map<number, Map<string, string>>>();
  for (const linha of linhas) {
    const valores = componentes.map((c) => linha[c.posicaoNaLinha] ?? "");
    if (valores.some((v) => v === "")) continue;
    const chave = valores.join(" · ");
    const vigencia = vigenciaDaLinha(linha, indiceDaVigencia);
    let porColuna = porChave.get(chave);
    if (!porColuna) {
      porColuna = new Map();
      porChave.set(chave, porColuna);
    }
    for (const coluna of observadas) {
      const valor = (linha[coluna.posicaoNaLinha] ?? "").trim();
      if (valor === "") continue;
      let porVigencia = porColuna.get(coluna.posicaoNaLinha);
      if (!porVigencia) {
        porVigencia = new Map();
        porColuna.set(coluna.posicaoNaLinha, porVigencia);
      }
      porVigencia.set(vigencia, valor);
    }
  }

  const casos: ReturnType<typeof listarDivergencias> = [];
  for (const [chave, porColuna] of porChave) {
    for (const [posicao, porVigencia] of porColuna) {
      const coluna = observadas.find((c) => c.posicaoNaLinha === posicao)!;
      const ordenadas = [...porVigencia.entries()].sort((a, b) =>
        (parseVigenciaLabel(a[0]).effectiveDate ?? a[0]).localeCompare(
          parseVigenciaLabel(b[0]).effectiveDate ?? b[0],
        ),
      );
      for (let i = 1; i < ordenadas.length; i++) {
        const [vigAnterior, valorAnterior] = ordenadas[i - 1]!;
        const [vigAtual, valorAtual] = ordenadas[i]!;
        // Só a **transição**: uma chave que muda uma vez em nove vigências
        // produz uma linha, e não oito.
        if (normalizeIdentifier(valorAnterior) === normalizeIdentifier(valorAtual)) continue;
        casos.push({
          chave,
          coluna: coluna.header,
          de: { vigencia: vigAnterior, valor: valorAnterior },
          para: { vigencia: vigAtual, valor: valorAtual },
        });
      }
    }
  }
  return casos.sort(
    (a, b) => a.chave.localeCompare(b.chave) || a.coluna.localeCompare(b.coluna),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith("--"));
  if (!arquivo) {
    console.error(
      [
        "Uso: tsx src/cli/medir-grao.ts <arquivo.xlsx> [opções]",
        "",
        "  --aba <nome>                 mede só esta aba",
        '  --composta "a,b"             mede a chave composta a+b (pode repetir)',
        '  --casos "chave:col1,col2"    lista caso a caso onde a chave mudou de descrição',
        "  --dicionario <arquivo.xlsx>  classifica as colunas pelo dicionário de atributos",
      ].join("\n"),
    );
    process.exit(1);
  }

  const abaPedida = valorDe(args, "--aba");
  const compostas = todosOsValores(args, "--composta");
  const caminhoDoDicionario = valorDe(args, "--dicionario");
  const dicionario = caminhoDoDicionario ? lerDicionario(caminhoDoDicionario) : null;
  /** `--casos "chaveTrecho:Origem,Destino"` — a lista completa, caso a caso. */
  const casosPedidos = todosOsValores(args, "--casos");

  const wb = XLSX.read(readFileSync(arquivo), { type: "buffer", cellDates: true });
  const nomes = abaPedida ? [abaPedida] : wb.SheetNames;

  console.log(`\nMEDIÇÃO DE GRÃO — ${path.basename(arquivo)}`);

  for (const nome of nomes) {
    const sheet = wb.Sheets[nome];
    if (!sheet) {
      console.error(`\nAba "${nome}" não existe neste arquivo.`);
      continue;
    }
    const { colunas, linhas } = lerAba(sheet);
    const posicionadas: ColunaPosicionada[] = colunas.map((c, i) => ({
      ...c,
      posicaoNaLinha: i,
    }));

    console.log(`\n── aba "${nome}" — ${linhas.length} linhas, ${colunas.length} colunas`);
    if (linhas.length === 0) continue;

    const daVigencia = posicionadas.find((c) => foldText(c.header) === "vigencia");
    if (!daVigencia) {
      console.log(
        "   Sem coluna Vigencia: a medição roda como se tudo fosse uma vigência só.",
      );
    }
    const indiceDaVigencia = daVigencia?.posicaoNaLinha ?? -1;
    const vigencias = new Set(
      linhas.map((l) => vigenciaDaLinha(l, indiceDaVigencia)),
    );
    console.log(`   Vigências no arquivo: ${[...vigencias].sort().join(", ")}`);

    const medidas: Medida[] = [];
    for (const coluna of posicionadas) {
      if (coluna.posicaoNaLinha === indiceDaVigencia) continue;
      medidas.push(medir(coluna.header, [coluna], linhas, indiceDaVigencia));
    }
    for (const composta of compostas) {
      const pedidas = composta.split(",").map((s) => s.trim());
      const componentes = pedidas.map((pedida) => {
        const achada = posicionadas.find(
          (c) => foldText(c.header) === foldText(pedida) || c.slug === slugifyColumn(pedida),
        );
        if (!achada) throw new Error(`Coluna "${pedida}" não existe na aba "${nome}".`);
        return achada;
      });
      medidas.push(
        medir(pedidas.join(" + "), componentes, linhas, indiceDaVigencia),
      );
    }

    /*
      A ordem é a da utilidade para a decisão: primeiro o que não repete dentro
      da vigência, depois o que preenche mais, depois o que se mantém entre
      vigências. Uma coluna que repete não é chave, por mais bonito que seja o
      nome dela.
    */
    const candidatas = medidas
      .filter((m) => m.preenchimento > 0)
      .sort(
        (a, b) =>
          a.repetidas - b.repetidas ||
          b.preenchimento - a.preenchimento ||
          (b.estabilidade ?? 0) - (a.estabilidade ?? 0),
      );

    console.log(
      `\n   ${"CANDIDATA".padEnd(38)} ${"PREENCH".padStart(8)} ${"DISTINTAS".padStart(10)} ${"REPETE".padStart(7)} ${"MAIOR".padStart(6)} ${"ESTÁVEL".padStart(8)}`,
    );
    for (const m of candidatas) {
      console.log(
        `   ${m.nome.slice(0, 38).padEnd(38)} ${pct(m.preenchimento).padStart(8)} ` +
          `${String(m.distintas).padStart(10)} ${String(m.repetidas).padStart(7)} ` +
          `${String(m.maiorRepeticao).padStart(6)} ` +
          `${(m.estabilidade === null ? "—" : pct(m.estabilidade)).padStart(8)}`,
      );
    }

    const chaves = candidatas.filter(
      (m) => m.repetidas === 0 && m.preenchimento === 1,
    );

    /*
      A terceira pergunta, só para quem passou nas duas primeiras.

      Identificar a linha e permanecer entre vigências ainda deixa passar a
      chave reaproveitada — a que nomeia uma rota nesta quinzena e outra na
      seguinte. Ver `EstabilidadeSemantica`.
    */
    const comSemantica = chaves.slice(0, 8);
    for (const medida of comSemantica) {
      const componentes = medida.colunas.map(
        (header) => posicionadas.find((c) => c.header === header)!,
      );
      medida.semantica = medirSemantica(componentes, posicionadas, linhas);
    }

    if (comSemantica.length > 0) {
      console.log(`\n   ESTABILIDADE SEMÂNTICA — o que acompanha a chave sem mudar`);
      for (const m of comSemantica) {
        const sem = m.semantica!;
        const amostra = sem.ancoras.slice(0, 6).join(", ");
        console.log(
          `   ${m.nome.slice(0, 38).padEnd(38)} ${String(sem.ancoras.length).padStart(3)} âncoras` +
            (amostra ? `: ${amostra}${sem.ancoras.length > 6 ? "…" : ""}` : ""),
        );
        if (sem.ancoras.length === 0) {
          console.log(
            `      nenhuma coluna acompanha esta chave sem mudar — ela nomeia a ` +
              `linha, não uma coisa.`,
          );
        }
        for (const quase of sem.quaseAncoras.slice(0, 4)) {
          console.log(
            `      ${quase.coluna} é constante em ${pct(quase.fracao)} das chaves e ` +
              `discorda no resto${quase.exemplo ? ` (ex.: ${quase.exemplo})` : ""}`,
          );
        }
        if (sem.chavesComDivergencia > 0) {
          console.log(
            `      ${sem.chavesComDivergencia} chaves mudam de descrição ao longo do ` +
              `arquivo — candidatas a reaproveitamento.`,
          );
        }
      }
    }

    /*
      Item 4: a lista completa, caso a caso.

      O agregado responde "há reaproveitamento?"; esta lista responde "onde", e
      é ela que se leva para o Excel. Pedida explicitamente porque num arquivo
      grande ela pode ter centenas de linhas — imprimi-la sempre afogaria a
      medição, e escondê-la tornaria a contagem uma afirmação sem prova.
    */
    for (const pedido of casosPedidos) {
      const [nomeDaChave, listaDeColunas] = pedido.split(":");
      const componentes = (nomeDaChave ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const achada = posicionadas.find(
            (c) => foldText(c.header) === foldText(n) || c.slug === slugifyColumn(n),
          );
          if (!achada) throw new Error(`Coluna "${n}" não existe na aba "${nome}".`);
          return achada;
        });
      if (componentes.length === 0) continue;

      const observadas = (listaDeColunas ?? "")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
        .map((n) => {
          const achada = posicionadas.find(
            (c) => foldText(c.header) === foldText(n) || c.slug === slugifyColumn(n),
          );
          if (!achada) throw new Error(`Coluna "${n}" não existe na aba "${nome}".`);
          return achada;
        });
      const alvo = observadas.length > 0 ? observadas : posicionadas;

      const casos = listarDivergencias(componentes, alvo, linhas, indiceDaVigencia);
      const rotuloDaChave = componentes.map((c) => c.header).join(" + ");
      console.log(
        `\n   CASOS — ${rotuloDaChave} mudando de ${alvo.map((c) => c.header).join("/")}`,
      );
      if (casos.length === 0) {
        console.log(
          `   Nenhum. Em todas as vigências, cada ${rotuloDaChave} manteve ` +
            `${alvo.length === 1 ? "o mesmo valor" : "os mesmos valores"}.`,
        );
      } else {
        console.log(
          `   ${casos.length} ${casos.length === 1 ? "caso" : "casos"}. Cada linha é uma transição entre duas vigências consecutivas.`,
        );
        console.log(
          `   ${"CHAVE".padEnd(28)} ${"COLUNA".padEnd(16)} ${"DE (vigência)".padEnd(34)} ${"→ PARA (vigência)"}`,
        );
        for (const caso of casos) {
          console.log(
            `   ${caso.chave.slice(0, 28).padEnd(28)} ${caso.coluna.slice(0, 16).padEnd(16)} ` +
              `${`${caso.de.valor} (${caso.de.vigencia})`.slice(0, 34).padEnd(34)} ` +
              `${`${caso.para.valor} (${caso.para.vigencia})`.slice(0, 34)}`,
          );
        }
      }
    }

    /*
      Item 6: a natureza de cada coluna.

      Sai só com `--dicionario`, e a ausência é dita. Ver `naturezaDe`: a
      diferença entre direcionador operacional e rubrica de remuneração é
      afirmação de negócio, e o dicionário do Freightec já a traz respondida
      coluna a coluna. Adivinhá-la por nome seria o erro que este repositório
      não comete desde `identity.ts`.
    */
    /*
      IDENTIDADE aqui é mais estreita do que "passou no teste de chave".

      `Placa Carreta` e `odometroEntrada` identificam a linha e **não**
      permanecem — pô-las nesta caixa faria a tabela de naturezas contradizer o
      aviso impresso logo abaixo dela. Quem identifica mas não permanece cai na
      classificação do dicionário, que é onde ela pertence.
    */
    const identidades = new Set(
      chaves
        .filter(
          (c) =>
            c.colunas.length === 1 &&
            (c.estabilidade === null || c.estabilidade >= LIMIAR_DE_ANCORA),
        )
        .flatMap((c) => c.colunas),
    );
    console.log(`\n   NATUREZA DAS COLUNAS`);
    if (!dicionario) {
      console.log(
        "   Não classificada: passe --dicionario docs/planilha-atributos-<tipo>-dre.xlsx.\n" +
          "   Classificar por nome de coluna daria uma tabela bonita e errada.",
      );
    } else {
      const porNatureza = new Map<Natureza, string[]>();
      for (const coluna of posicionadas) {
        const natureza = naturezaDe(coluna, dicionario, identidades);
        const bucket = porNatureza.get(natureza) ?? [];
        bucket.push(coluna.header);
        porNatureza.set(natureza, bucket);
      }
      const ordem: Natureza[] = [
        "COMPETENCIA",
        "IDENTIDADE",
        "DESCRITIVO",
        "OPERACIONAL",
        "REMUNERATORIO",
        "?",
      ];
      for (const natureza of ordem) {
        const colunasDaNatureza = porNatureza.get(natureza);
        if (!colunasDaNatureza || colunasDaNatureza.length === 0) continue;
        console.log(
          `   ${natureza.padEnd(14)} ${String(colunasDaNatureza.length).padStart(3)} — ${EXPLICACAO_DA_NATUREZA[natureza]}`,
        );
        console.log(`      ${colunasDaNatureza.slice(0, 12).join(", ")}${colunasDaNatureza.length > 12 ? ", …" : ""}`);
      }
    }

    console.log("");
    if (chaves.length === 0) {
      console.log(
        "   Nenhuma candidata identifica a linha sozinha: toda coluna repete ou falta.\n" +
          "   O grão desta aba é composto — meça combinações com --composta.",
      );
    } else {
      console.log(
        `   Identificam a linha dentro da vigência, sem repetir e sem faltar: ` +
          `${chaves.map((c) => c.nome).join(", ")}.`,
      );
      const instaveis = chaves.filter(
        (c) => c.estabilidade !== null && c.estabilidade < 0.9,
      );
      for (const c of instaveis) {
        console.log(
          `   Atenção: "${c.nome}" identifica, mas só ${pct(c.estabilidade!)} das chaves ` +
            `reaparecem em todas as vigências — como identidade, ela faria a população ` +
            `nascer e morrer entre quinzenas.`,
        );
      }
    }

    for (const m of candidatas.filter((c) => c.exemploRepetido !== null).slice(0, 3)) {
      console.log(
        `   "${m.nome}" repete até ${m.maiorRepeticao}× — exemplo: ${m.exemploRepetido}`,
      );
    }
  }

  console.log("");
}

function valorDe(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function todosOsValores(args: string[], flag: string): string[] {
  const saida: string[] = [];
  args.forEach((a, i) => {
    if (a === flag && args[i + 1]) saida.push(args[i + 1]);
  });
  return saida;
}

main();
