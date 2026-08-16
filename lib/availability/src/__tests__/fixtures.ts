import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import type { Database } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";

/**
 * Planilhas sintéticas, para variar **uma** coisa de cada vez.
 *
 * O export real é uma unidade, um canal e nove entregas completas — o caminho
 * mais estreito possível pelo produto. Série com buraco, contexto que aparece no
 * meio, equipamento que entra e sai: nada disso existe lá, e é tudo o que a
 * disponibilidade precisa saber responder.
 */

const COLUNAS_DE_GRAO = [
  "Vigencia",
  "Unidade - CNPJ",
  "Unidade - Nome",
  "Unidade - Regional",
  "Operador - CNPJ",
  "Operador - Nome",
  "Placa",
  "chassi",
];

/**
 * Vinte colunas próprias por equipamento, e não duas.
 *
 * A identidade de uma aba sai da sobreposição das colunas dela com o dicionário,
 * e as seis colunas de escopo são comuns a todo equipamento. Com poucas colunas
 * de fato elas dominam a nota e uma aba de cavalos passa por carreta — o que
 * apagaria o cenário antes de ele começar.
 */
export const COLUNAS_DE_CARRETA = Array.from(
  { length: 20 },
  (_, i) => `Custo Carreta ${i}`,
);
export const COLUNAS_DE_CAVALO = Array.from(
  { length: 20 },
  (_, i) => `Custo Cavalo ${i}`,
);

export interface AbaSintetica {
  nome: string;
  placas: string[];
  colunas: string[];
  /** Valor por coluna; `null` escreve célula vazia. Sem isto, `100 + i`. */
  valores?: (indice: number) => number | string | null;
}

export interface PlanilhaSintetica {
  vigencia: string;
  cnpj?: string;
  unidade?: string;
  abas: AbaSintetica[];
}

export function escreverPlanilha(spec: PlanilhaSintetica): string {
  const wb = XLSX.utils.book_new();
  for (const aba of spec.abas) {
    const linhas: (string | number | null)[][] = [[...COLUNAS_DE_GRAO, ...aba.colunas]];
    for (const placa of aba.placas) {
      linhas.push([
        spec.vigencia,
        spec.cnpj ?? "07.526.557/0015-05",
        spec.unidade ?? "CAMACARI",
        "GEO NE",
        "20.618.821/0007-99",
        "OPERADOR TESTE",
        placa,
        `CHASSI${placa}`,
        ...aba.colunas.map((_, i) => (aba.valores ? aba.valores(i) : 100 + i)),
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba.nome);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "disponibilidade-"));
  const arquivo = path.join(dir, `${spec.vigencia}-${Math.random().toString(36).slice(2)}.xlsx`);
  XLSX.writeFile(wb, arquivo);
  return arquivo;
}

/** Recebe, lê, confere e promove — o caminho inteiro da porta de Importações. */
export async function importarEPromover(
  db: Database,
  spec: PlanilhaSintetica,
): Promise<string> {
  const recebido = await receiveFile(db, { filePath: escreverPlanilha(spec) });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  const relatorio = await preview(db, recebido.importRunId);
  await promote(db, recebido.importRunId, {
    onExistingSnapshot: "NEW_REVISION",
    confirmNewEntityTypes: relatorio.pendingIdentities,
  });
  return recebido.importRunId;
}

/** Recebe e confere, **sem** promover. O estado que não é disponibilidade. */
export async function importarSemPromover(
  db: Database,
  spec: PlanilhaSintetica,
): Promise<string> {
  const recebido = await receiveFile(db, { filePath: escreverPlanilha(spec) });
  await captureRaw(db, recebido.importRunId);
  await stage(db, recebido.importRunId);
  await preview(db, recebido.importRunId);
  return recebido.importRunId;
}

/** Uma carreta simples, para quando o cenário é sobre a série e não sobre o dado. */
export function carretas(vigencia: string, placas: string[], cnpj?: string): PlanilhaSintetica {
  return {
    vigencia,
    ...(cnpj !== undefined ? { cnpj } : {}),
    abas: [{ nome: "carretas", placas, colunas: COLUNAS_DE_CARRETA }],
  };
}
