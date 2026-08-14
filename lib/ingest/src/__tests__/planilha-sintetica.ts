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
  placa: string;
  chassi?: string;
  /** código do atributo (sem o prefixo do equipamento) -> valor */
  valores?: Record<string, number | string>;
}

export interface AbaSpec {
  /** `cavalos` e `carretas` são os nomes que o classificador reconhece. */
  nome: string;
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

const COLUNAS_FIXAS = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
  "Placa",
  "chassi",
] as const;

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
    const cabecalho = [...COLUNAS_FIXAS, ...ATRIBUTOS_PADRAO];
    const linhas: (string | number | null)[][] = [cabecalho as unknown as string[]];

    for (const linha of aba.linhas) {
      linhas.push([
        spec.vigencia,
        spec.unidadeCnpj === null ? "" : (spec.unidadeCnpj ?? "07.526.557/0015-05"),
        spec.unidadeNome ?? "CAMACARI",
        spec.regional ?? "GEO NE",
        spec.operadorCnpj === null ? "" : (spec.operadorCnpj ?? "20.618.821/0007-99"),
        spec.operadorNome ?? "OPERADOR TESTE",
        linha.placa,
        linha.chassi ?? `CHASSI${linha.placa.toUpperCase().replace(/[^A-Z0-9]/g, "")}`,
        ...ATRIBUTOS_PADRAO.map((a) => linha.valores?.[a] ?? 1000),
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
