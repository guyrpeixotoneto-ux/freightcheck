import { Router } from "express";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const router = Router();

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function findExcelFile(): string | null {
  // Search up from __dirname for an attached_assets directory
  const candidates = [
    path.resolve(process.cwd(), "../../attached_assets"),
    path.resolve(process.cwd(), "../attached_assets"),
    path.resolve(process.cwd(), "attached_assets"),
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const xlsx = files.find((f) => f.endsWith(".xlsx"));
    if (xlsx) return path.join(dir, xlsx);
  }
  return null;
}

/** Parse "EMPURRADA_D_M_YYYY" → Date */
function parseVigencia(v: string): Date {
  const m = v.match(/EMPURRADA_(\d+)_(\d+)_(\d+)/);
  if (!m) return new Date(0);
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

/** "EMPURRADA_2_12_2025" → "Dez/2025" */
const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function vigenciaLabel(v: string): string {
  const m = v.match(/EMPURRADA_(\d+)_(\d+)_(\d+)/);
  if (!m) return v;
  return `${MONTHS[+m[2] - 1]}/${m[3]}`;
}

type Row = Record<string, unknown>;

function sumField(arr: Row[], field: string): number {
  return arr.reduce((s, r) => s + (Number(r[field]) || 0), 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// Cache
// ──────────────────────────────────────────────────────────────────────────────

interface FleetData {
  vigencias: string[];
  summary: Record<string, unknown>[];
  financiamentoByVigencia: Record<string, unknown>[];
  modelosByVigencia: Record<string, unknown>[];
  ativoStatusByVigencia: Record<string, unknown>[];
  carretas: Row[];
  cavalos: Row[];
}

let _cache: FleetData | null = null;

function getFleetData(): FleetData {
  if (_cache) return _cache;

  const filePath = findExcelFile();
  if (!filePath) throw new Error("Arquivo de frota (.xlsx) não encontrado em attached_assets");

  const wb = XLSX.readFile(filePath);

  const carretasRaw = XLSX.utils.sheet_to_json<Row>(wb.Sheets["carretas"], { defval: null });
  const cavalosRaw  = XLSX.utils.sheet_to_json<Row>(wb.Sheets["cavalos"],  { defval: null });

  // Unique vigências, chronologically sorted
  const vigenciasSet = new Set<string>([
    ...carretasRaw.map((r) => String(r["Vigencia"] ?? "")),
    ...cavalosRaw.map((r) => String(r["Vigencia"] ?? "")),
  ]);
  const vigencias = [...vigenciasSet]
    .filter(Boolean)
    .sort((a, b) => parseVigencia(a).getTime() - parseVigencia(b).getTime());

  // Per-vigência summary
  const summary = vigencias.map((v) => {
    const cr = carretasRaw.filter((r) => r["Vigencia"] === v);
    const cv = cavalosRaw.filter((r) => r["Vigencia"] === v);
    return {
      vigencia: v,
      label: vigenciaLabel(v),
      totalCarretas: cr.length,
      totalCavalos: cv.length,
      custoFixoCarretas: sumField(cr, "custoFixo"),
      finameCarretas: sumField(cr, "finameImplemento"),
      finameCavalos: sumField(cv, "finameCavalo"),
      ipvaCarretas: sumField(cr, "ipvaLicenciamento"),
      seguroCarretas: sumField(cr, "seguro"),
      lucroFixoCarretas: sumField(cr, "lucroFixomodeloNovoCicloCarreta"),
      lucroVariavelCarretas: sumField(cr, "lucroVariavelPrevistoCarreta"),
      manutencaoCavalos: sumField(cv, "manutencaoAno") / 12,
      valorFrotaCarretas: sumField(cr, "valorNfCompra"),
      valorFrotaCavalos: sumField(cv, "valorNfCompra"),
    };
  });

  // Financing status breakdown per vigência (carretas)
  const financiamentoByVigencia = vigencias.map((v) => {
    const cr = carretasRaw.filter((r) => r["Vigencia"] === v);
    const counts: Record<string, number | string> = { vigencia: v, label: vigenciaLabel(v) };
    cr.forEach((r) => {
      const s = (r["statusFinanciamento"] ?? "N/A") as string;
      const clean = s.replace("Descrição: ", "");
      counts[clean] = ((counts[clean] as number) || 0) + 1;
    });
    return counts;
  });

  // Modelo breakdown per vigência (carretas)
  const modelosByVigencia = vigencias.map((v) => {
    const cr = carretasRaw.filter((r) => r["Vigencia"] === v);
    const counts: Record<string, number | string> = { vigencia: v, label: vigenciaLabel(v) };
    cr.forEach((r) => {
      const m = (r["modelo"] ?? "N/A") as string;
      counts[m] = ((counts[m] as number) || 0) + 1;
    });
    return counts;
  });

  // Ativo status breakdown per vigência (cavalos)
  const ativoStatusByVigencia = vigencias.map((v) => {
    const cv = cavalosRaw.filter((r) => r["Vigencia"] === v);
    const counts: Record<string, number | string> = { vigencia: v, label: vigenciaLabel(v) };
    cv.forEach((r) => {
      const s = (r["ativo"] ?? "N/A") as string;
      counts[String(s)] = ((counts[String(s)] as number) || 0) + 1;
    });
    return counts;
  });

  _cache = {
    vigencias,
    summary,
    financiamentoByVigencia,
    modelosByVigencia,
    ativoStatusByVigencia,
    carretas: carretasRaw,
    cavalos: cavalosRaw,
  };

  return _cache;
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

router.get("/fleet-analysis/summary", (_req, res) => {
  const data = getFleetData();
  res.json({
    vigencias: data.vigencias,
    vigenciaLabels: data.vigencias.reduce<Record<string, string>>((m, v) => {
      m[v] = vigenciaLabel(v);
      return m;
    }, {}),
    summary: data.summary,
    financiamentoByVigencia: data.financiamentoByVigencia,
    modelosByVigencia: data.modelosByVigencia,
    ativoStatusByVigencia: data.ativoStatusByVigencia,
  });
});

router.get("/fleet-analysis/carretas", (req, res) => {
  const { vigencia } = req.query as Record<string, string>;
  const data = getFleetData();
  const rows = vigencia
    ? data.carretas.filter((r) => r["Vigencia"] === vigencia)
    : data.carretas;
  res.json(rows);
});

router.get("/fleet-analysis/cavalos", (req, res) => {
  const { vigencia } = req.query as Record<string, string>;
  const data = getFleetData();
  const rows = vigencia
    ? data.cavalos.filter((r) => r["Vigencia"] === vigencia)
    : data.cavalos;
  res.json(rows);
});

export default router;
