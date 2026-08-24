import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";

/**
 * Planilhas sintéticas, para variar **uma** coisa de cada vez.
 *
 * Os fixtures reais provam que o pipeline lê o arquivo do cliente. O que eles
 * não conseguem provar é o que acontece quando o mesmo negócio chega escrito de
 * outro jeito: `EMPURRADA_1_8_2026` contra `EMPURRADA_01_8_2026`, CNPJ com e
 * sem máscara, placa com e sem hífen, linhas em outra ordem, abas em outra
 * ordem. Para isso é preciso poder gerar o arquivo, e é só isso que este módulo
 * faz — nada aqui conhece a identidade canônica.
 */

export interface LinhaSpec {
  /**
   * A chave da linha: placa, chave do trecho ou cargo, conforme a aba — ver
   * {@link AbaSpec.identificador}.
   */
  placa: string;
  /** O turno, só nas abas de QLP Operacional, onde ele completa a chave. */
  turno?: string;
  /**
   * A unidade desta linha, quando ela não é a do arquivo.
   *
   * Existe para escrever o único caso que a chave do QLP precisa sustentar:
   * duas unidades com o mesmo cargo, na mesma vigência, no mesmo arquivo.
   */
  unidadeCnpj?: string;
  /**
   * O nome da unidade desta linha, quando ela não é a do arquivo.
   *
   * Anda junto com {@link unidadeCnpj} e existe pela mesma razão: um export
   * consolidado traz cinco unidades na mesma aba, e cada linha diz a sua nas
   * duas colunas. Sem isto, as cinco entravam com o nome do arquivo — escopos
   * distintos, todos escritos "CAMACARI" — e um teste sobre unidades teria de
   * distinguir pelo hash o que quem opera distingue pelo nome.
   */
  unidadeNome?: string;
  chassi?: string;
  /** código do atributo (sem o prefixo do equipamento) -> valor */
  valores?: Record<string, number | string>;
}

export interface AbaSpec {
  /** `cavalos` e `carretas` são os nomes que o classificador reconhece. */
  nome: string;
  /**
   * Como as linhas desta aba se identificam. `Placa` por padrão.
   *
   * Nem todo tipo tem placa: o trecho é uma perna de rota, identificada por
   * `chaveTrecho`, e o quadro de pessoal é um cargo dentro de uma unidade — e
   * no operacional dentro de um turno. Poder escrever as quatro formas é o que
   * permite provar que o leitor aceita as quatro; antes, toda planilha
   * sintética tinha placa, e uma aba sem placa nunca era exercitada.
   */
  identificador?: "Placa" | "chaveTrecho" | "Cargo" | "cargoEquipeEmpurrada";
  /**
   * Colunas de fato além de {@link ATRIBUTOS_PADRAO}, nesta aba.
   *
   * Existe para o que só se pode escrever variando uma coluna que as duas
   * padrão não têm — `Placa Carreta`, que é o vínculo cavalo–carreta. O valor
   * de cada linha sai de `LinhaSpec.valores`; linha que não declara o seu sai
   * vazia, e vazio é ausência, não zero.
   */
  colunas?: string[];
  linhas: LinhaSpec[];
}

export interface PlanilhaSpec {
  vigencia: string;
  unidadeCnpj?: string | null;
  unidadeNome?: string;
  regional?: string;
  operadorCnpj?: string | null;
  operadorNome?: string;
  abas: AbaSpec[];
}

/** O que toda aba carrega antes da identidade: vigência e escopo. */
const COLUNAS_DE_ESCOPO = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
] as const;

/** As colunas de identidade de uma aba, que dependem de como ela se identifica. */
function colunasDeIdentidade(aba: AbaSpec): string[] {
  switch (aba.identificador) {
    case "chaveTrecho":
      return ["chaveTrecho"];
    case "Cargo":
      return ["Cargo"];
    case "cargoEquipeEmpurrada":
      return ["cargoEquipeEmpurrada", "turnoEmpurrada"];
    default:
      return ["Placa", "chassi"];
  }
}

/** Os valores de identidade de uma linha, na ordem das colunas acima. */
function valoresDeIdentidade(aba: AbaSpec, linha: LinhaSpec): string[] {
  switch (aba.identificador) {
    case "chaveTrecho":
    case "Cargo":
      return [linha.placa];
    case "cargoEquipeEmpurrada":
      return [linha.placa, linha.turno ?? "1"];
    default:
      return [
        linha.placa,
        linha.chassi ?? `CHASSI${linha.placa.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
      ];
  }
}

/** As colunas de fato que as planilhas sintéticas carregam por padrão. */
export const ATRIBUTOS_PADRAO = ["Custo Fixo", "Custo Variavel"] as const;

let sequencia = 0;

/**
 * Escrever a planilha e devolver o caminho.
 *
 * Cada chamada escreve num diretório novo, de modo que duas planilhas de mesmo
 * nome e conteúdo diferente não se sobreponham — e de modo que duas planilhas
 * de conteúdo **igual** possam ter o mesmo nome, que é o que o teste de arquivo
 * renomeado precisa.
 */
export function escreverPlanilha(spec: PlanilhaSpec, nomeArquivo?: string): string {
  const wb = XLSX.utils.book_new();

  for (const aba of spec.abas) {
    const atributos = [...ATRIBUTOS_PADRAO, ...(aba.colunas ?? [])];
    const identidade = colunasDeIdentidade(aba);
    const cabecalho = [...COLUNAS_DE_ESCOPO, ...identidade, ...atributos];
    const linhas: (string | number | null)[][] = [cabecalho as unknown as string[]];

    for (const linha of aba.linhas) {
      linhas.push([
        spec.vigencia,
        linha.unidadeCnpj ??
          (spec.unidadeCnpj === null ? "" : (spec.unidadeCnpj ?? "07.526.557/0015-05")),
        linha.unidadeNome ?? spec.unidadeNome ?? "CAMACARI",
        spec.regional ?? "GEO NE",
        spec.operadorCnpj === null ? "" : (spec.operadorCnpj ?? "20.618.821/0007-99"),
        spec.operadorNome ?? "OPERADOR TESTE",
        ...valoresDeIdentidade(aba, linha),
        ...atributos.map(
          (a) =>
            linha.valores?.[a] ??
            ((ATRIBUTOS_PADRAO as readonly string[]).includes(a) ? 1000 : ""),
        ),
      ]);
    }

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }

  const dir = mkdtempSync(path.join(tmpdir(), "fc-sint-"));
  const destino = path.join(dir, nomeArquivo ?? `sintetica-${++sequencia}.xlsx`);
  writeFileSync(destino, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return destino;
}

/**
 * A planilha de referência: uma vigência, uma unidade, cavalos e carretas.
 *
 * `sobrepor` altera só o que o teste quer variar, para que a diferença entre
 * dois arquivos de um mesmo teste seja legível numa linha.
 */
export function planilhaPadrao(sobrepor: Partial<PlanilhaSpec> = {}): PlanilhaSpec {
  return {
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      { nome: "cavalos", linhas: [{ placa: "ABC1D23" }, { placa: "ABC4D56" }] },
      { nome: "carretas", linhas: [{ placa: "XYZ9A88" }] },
    ],
    ...sobrepor,
  };
}

/**
 * Uma cópia de uma planilha real com todo número de fato somado de 1.
 *
 * As colunas de grão (vigência, placa) e as de escopo ficam intactas — mexer
 * nelas mudaria a identidade, e o que se quer aqui é a mesma vigência com
 * valores diferentes. O resultado é uma correção legítima de todas as nove.
 */
export function corrigirValoresNumericos(origem: string): string {

  const PRESERVAR = new Set([
    "vigencia",
    "placa",
    "chavetrecho",
    "cargo",
    "cargoequipeempurrada",
    "turnoempurrada",
    "placa carreta",
    "chassi",
    "unidade - cnpj",
    "unidade - nome",
    "unidade - regional",
    "operador - cnpj",
    "operador - nome",
  ]);

  const wb = XLSX.readFile(origem, { cellStyles: true });
  for (const nome of wb.SheetNames) {
    const aba = wb.Sheets[nome];
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: true });
    if (linhas.length < 2) continue;
    const cabecalho = (linhas[0] as unknown[]).map((c) => String(c ?? "").trim().toLowerCase());
    // Só as abas de origem têm coluna de vigência; as dinâmicas ficam como estão.
    if (!cabecalho.includes("vigencia")) continue;

    const corrigidas = linhas.map((linha, i) => {
      if (i === 0) return linha;
      return (linha as unknown[]).map((celula, coluna) =>
        typeof celula === "number" && !PRESERVAR.has(cabecalho[coluna] ?? "")
          ? celula + 1
          : celula,
      );
    });
    wb.Sheets[nome] = XLSX.utils.aoa_to_sheet(corrigidas as never);
  }

  const destino = path.join(mkdtempSync(path.join(tmpdir(), "fc-corr-")), "corrigido.xlsx");
  XLSX.writeFile(wb, destino);
  return destino;
}
