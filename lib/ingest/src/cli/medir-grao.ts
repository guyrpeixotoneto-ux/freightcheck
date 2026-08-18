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
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

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
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const arquivo = args.find((a) => !a.startsWith("--"));
  if (!arquivo) {
    console.error(
      "Uso: tsx src/cli/medir-grao.ts <arquivo.xlsx> [--aba Nome] [--composta col1,col2]",
    );
    process.exit(1);
  }

  const abaPedida = valorDe(args, "--aba");
  const compostas = todosOsValores(args, "--composta");

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
