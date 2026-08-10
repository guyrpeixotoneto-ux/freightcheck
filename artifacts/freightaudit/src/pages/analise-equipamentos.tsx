import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Truck,
  TruckIcon,
  TrendingDown,
  TrendingUp,
  Package,
  Search,
  DollarSign,
  Activity,
  Wrench,
} from "lucide-react";
import { getApiUrl } from "@/lib/api";

// ─── types ───────────────────────────────────────────────────────────────────

interface SummaryRow {
  vigencia: string;
  label: string;
  totalCarretas: number;
  totalCavalos: number;
  custoFixoCarretas: number;
  finameCarretas: number;
  finameCavalos: number;
  ipvaCarretas: number;
  seguroCarretas: number;
  lucroFixoCarretas: number;
  lucroVariavelCarretas: number;
  manutencaoCavalos: number;
  valorFrotaCarretas: number;
  valorFrotaCavalos: number;
}

interface SummaryData {
  vigencias: string[];
  vigenciaLabels: Record<string, string>;
  summary: SummaryRow[];
  financiamentoByVigencia: Record<string, unknown>[];
  modelosByVigencia: Record<string, unknown>[];
  ativoStatusByVigencia: Record<string, unknown>[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);

const pct = (curr: number, prev: number) => {
  if (!prev) return null;
  const p = ((curr - prev) / prev) * 100;
  return p;
};

const COLORS = [
  "#6366f1", "#22d3ee", "#f59e0b", "#10b981",
  "#ef4444", "#a78bfa", "#f97316", "#14b8a6",
];

const STATUS_COLORS: Record<string, string> = {
  FINAME: "#f59e0b",
  QUITADO: "#10b981",
  FINANCIADO: "#6366f1",
  "N/A": "#6b7280",
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  prev,
  icon: Icon,
  format = "currency",
}: {
  title: string;
  value: number;
  prev?: number;
  icon: React.ElementType;
  format?: "currency" | "count";
}) {
  const display = format === "currency" ? fmt(value) : String(value);
  const delta = prev != null ? pct(value, prev) : null;

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1 tabular-nums">{display}</p>
            {delta != null && (
              <div
                className={`flex items-center gap-1 mt-1 text-xs font-medium ${
                  delta >= 0 ? "text-emerald-500" : "text-red-400"
                }`}
              >
                {delta >= 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {Math.abs(delta).toFixed(1)}% vs vigência anterior
              </div>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Vehicle Table ────────────────────────────────────────────────────────────

function CarretasTable({
  vigencia,
}: {
  vigencia: string;
}) {
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ["fleet/carretas", vigencia],
    queryFn: () =>
      fetch(
        getApiUrl(`/fleet-analysis/carretas?vigencia=${encodeURIComponent(vigencia)}`)
      ).then((r) => r.json()),
    enabled: !!vigencia,
  });

  const filtered = search
    ? data.filter((r) =>
        Object.values(r)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : data;

  const cols = [
    { key: "Placa", label: "Placa", width: "w-24" },
    { key: "Operador - Nome", label: "Operador", width: "w-32" },
    { key: "implemento", label: "Fabricante", width: "w-28" },
    { key: "modelo", label: "Modelo", width: "w-24" },
    { key: "ano", label: "Ano", width: "w-16" },
    { key: "custoFixo", label: "Custo Fixo", width: "w-32", currency: true },
    { key: "finameImplemento", label: "FINAME/mês", width: "w-32", currency: true },
    { key: "seguro", label: "Seguro", width: "w-28", currency: true },
    { key: "ipvaLicenciamento", label: "IPVA+Lic.", width: "w-28", currency: true },
    { key: "valorNfCompra", label: "Valor NF", width: "w-32", currency: true },
    { key: "statusFinanciamento", label: "Financiamento", width: "w-32" },
  ];

  const statusBadge = (v: unknown) => {
    const s = String(v ?? "N/A").replace("Descrição: ", "");
    const color =
      STATUS_COLORS[s] ??
      (s === "QUITADO" ? "#10b981" : s === "FINAME" ? "#f59e0b" : "#6366f1");
    return (
      <span
        className="px-2 py-0.5 rounded text-xs font-semibold"
        style={{ background: color + "22", color }}
      >
        {s}
      </span>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar placa, operador, modelo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} carretas
        </span>
      </div>

      <div className="overflow-auto rounded-lg border text-sm">
        <table className="w-full min-w-max">
          <thead>
            <tr className="bg-muted/40 border-b">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 text-left text-xs font-semibold text-muted-foreground ${c.width}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum resultado
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.width}`}>
                      {c.key === "statusFinanciamento" ? (
                        statusBadge(row[c.key])
                      ) : c.currency ? (
                        <span className="tabular-nums font-mono text-xs">
                          {fmt(Number(row[c.key]) || 0)}
                        </span>
                      ) : (
                        <span className="text-xs">{String(row[c.key] ?? "—")}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CavalosTable({ vigencia }: { vigencia: string }) {
  const [search, setSearch] = useState("");
  const { data = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: ["fleet/cavalos", vigencia],
    queryFn: () =>
      fetch(
        getApiUrl(`/fleet-analysis/cavalos?vigencia=${encodeURIComponent(vigencia)}`)
      ).then((r) => r.json()),
    enabled: !!vigencia,
  });

  const filtered = search
    ? data.filter((r) =>
        Object.values(r)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      )
    : data;

  const cols = [
    { key: "Placa", label: "Placa Cavalo", width: "w-24" },
    { key: "Placa Carreta", label: "Placa Carreta", width: "w-28" },
    { key: "Operador - Nome", label: "Operador", width: "w-32" },
    { key: "montadora", label: "Montadora", width: "w-28" },
    { key: "anoBid", label: "Ano", width: "w-16" },
    { key: "ativo", label: "Status", width: "w-20" },
    { key: "faixaKm", label: "Faixa km", width: "w-28" },
    { key: "finameCavalo", label: "FINAME/mês", width: "w-32", currency: true },
    { key: "manutencaoAno", label: "Manut./ano", width: "w-32", currency: true },
    { key: "reaiskm", label: "R$/km", width: "w-24", mono: true },
    { key: "valorNfCompra", label: "Valor NF", width: "w-32", currency: true },
  ];

  const statusBadge = (v: unknown) => {
    const s = String(v ?? "");
    if (s === "ATIVO" || s === "true")
      return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-500">ATIVO</span>;
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-500/20 text-gray-400">PARADO</span>;
  };

  const montadoraLabel = (v: unknown) => {
    const s = String(v ?? "").replace("Descrição: ", "");
    return s;
  };

  const faixaLabel = (v: unknown) => {
    return String(v ?? "").replace("ATE_", "até ").replace("000", "k km");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar placa, operador, modelo…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-8 text-sm"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} cavalos mecânicos
        </span>
      </div>

      <div className="overflow-auto rounded-lg border text-sm">
        <table className="w-full min-w-max">
          <thead>
            <tr className="bg-muted/40 border-b">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 text-left text-xs font-semibold text-muted-foreground ${c.width}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum resultado
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0 hover:bg-muted/20 transition-colors"
                >
                  {cols.map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.width}`}>
                      {c.key === "ativo" ? (
                        statusBadge(row[c.key])
                      ) : c.key === "montadora" ? (
                        <span className="text-xs">{montadoraLabel(row[c.key])}</span>
                      ) : c.key === "faixaKm" ? (
                        <span className="text-xs">{faixaLabel(row[c.key])}</span>
                      ) : c.currency ? (
                        <span className="tabular-nums font-mono text-xs">
                          {fmt(Number(row[c.key]) || 0)}
                        </span>
                      ) : c.mono ? (
                        <span className="tabular-nums font-mono text-xs">
                          {(Number(row[c.key]) || 0).toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-xs">{String(row[c.key] ?? "—")}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AnaliseEquipamentos() {
  const { data, isLoading, error } = useQuery<SummaryData>({
    queryKey: ["fleet/summary"],
    queryFn: () => fetch(getApiUrl("/fleet-analysis/summary")).then((r) => r.json()),
  });

  const vigencias = data?.vigencias ?? [];
  const lastVig = vigencias[vigencias.length - 1] ?? "";
  const prevVig = vigencias[vigencias.length - 2] ?? "";

  const [selectedVig, setSelectedVig] = useState<string>("");
  const activeVig = selectedVig || lastVig;

  const lastSummary = data?.summary.find((s) => s.vigencia === lastVig);
  const prevSummary = data?.summary.find((s) => s.vigencia === prevVig);

  const totalCustoMensalLast =
    (lastSummary?.custoFixoCarretas ?? 0) + (lastSummary?.manutencaoCavalos ?? 0);
  const totalCustoMensalPrev =
    (prevSummary?.custoFixoCarretas ?? 0) + (prevSummary?.manutencaoCavalos ?? 0);

  const totalFrotaLast =
    (lastSummary?.valorFrotaCarretas ?? 0) + (lastSummary?.valorFrotaCavalos ?? 0);

  if (isLoading)
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Carregando dados da frota…
        </div>
      </Layout>
    );

  if (error)
    return (
      <Layout>
        <div className="flex items-center justify-center h-64 text-red-400">
          Erro ao carregar: {String(error)}
        </div>
      </Layout>
    );

  return (
    <Layout>
      <div className="p-6 space-y-6 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Truck className="w-6 h-6 text-primary" />
              Análise de Equipamentos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Evolução da remuneração da frota Freightec — {vigencias.length} vigências analisadas
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Vigência:</span>
            <Select value={activeVig} onValueChange={setSelectedVig}>
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue placeholder="Selecionar…" />
              </SelectTrigger>
              <SelectContent>
                {vigencias.map((v) => (
                  <SelectItem key={v} value={v}>
                    {data?.vigenciaLabels[v] ?? v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeVig === lastVig && (
              <Badge variant="default" className="text-xs">Mais recente</Badge>
            )}
          </div>
        </div>

        {/* KPIs */}
        {lastSummary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              title="Cavalos Mecânicos"
              value={lastSummary.totalCavalos}
              prev={prevSummary?.totalCavalos}
              icon={TruckIcon}
              format="count"
            />
            <KpiCard
              title="Carretas"
              value={lastSummary.totalCarretas}
              prev={prevSummary?.totalCarretas}
              icon={Package}
              format="count"
            />
            <KpiCard
              title="Custo Fixo Mensal (Carretas)"
              value={lastSummary.custoFixoCarretas}
              prev={prevSummary?.custoFixoCarretas}
              icon={DollarSign}
            />
            <KpiCard
              title="Valor Total da Frota (NF)"
              value={totalFrotaLast}
              icon={Activity}
            />
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="evolucao">Evolução por Vigência</TabsTrigger>
            <TabsTrigger value="carretas">Carretas</TabsTrigger>
            <TabsTrigger value="cavalos">Cavalos Mecânicos</TabsTrigger>
          </TabsList>

          {/* ── Visão Geral ─────────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Fleet size over time */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Tamanho da Frota por Vigência
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="totalCavalos"
                        name="Cavalos"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalCarretas"
                        name="Carretas"
                        stroke="#22d3ee"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Custo fixo carretas por vigência */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Custo Fixo Mensal — Carretas (R$)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="custoFixoCarretas" name="Custo Fixo" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Status financiamento última vigência */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Status de Financiamento — {data?.vigenciaLabels[lastVig]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-6">
                  {(() => {
                    const row = data?.financiamentoByVigencia.find(
                      (r) => r["vigencia"] === lastVig
                    );
                    if (!row) return null;
                    const slices = Object.entries(row)
                      .filter(([k]) => !["vigencia", "label"].includes(k))
                      .map(([name, value]) => ({ name, value: Number(value) }));
                    return (
                      <>
                        <ResponsiveContainer width={160} height={160}>
                          <PieChart>
                            <Pie
                              data={slices}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={70}
                              dataKey="value"
                            >
                              {slices.map((s, i) => (
                                <Cell
                                  key={s.name}
                                  fill={STATUS_COLORS[s.name] ?? COLORS[i % COLORS.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "#1e293b",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2">
                          {slices.map((s, i) => (
                            <div key={s.name} className="flex items-center gap-2 text-sm">
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{
                                  background:
                                    STATUS_COLORS[s.name] ?? COLORS[i % COLORS.length],
                                }}
                              />
                              <span className="text-muted-foreground">{s.name}</span>
                              <span className="font-semibold ml-auto">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>

              {/* Modelos de carretas */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Mix de Modelos — {data?.vigenciaLabels[lastVig]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-6">
                  {(() => {
                    const row = data?.modelosByVigencia.find(
                      (r) => r["vigencia"] === lastVig
                    );
                    if (!row) return null;
                    const slices = Object.entries(row)
                      .filter(([k]) => !["vigencia", "label"].includes(k))
                      .map(([name, value]) => ({ name, value: Number(value) }));
                    return (
                      <>
                        <ResponsiveContainer width={160} height={160}>
                          <PieChart>
                            <Pie
                              data={slices}
                              cx="50%"
                              cy="50%"
                              innerRadius={45}
                              outerRadius={70}
                              dataKey="value"
                            >
                              {slices.map((s, i) => (
                                <Cell key={s.name} fill={COLORS[i % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "#1e293b",
                                border: "1px solid #334155",
                                borderRadius: 8,
                                fontSize: 12,
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-2">
                          {slices.map((s, i) => (
                            <div key={s.name} className="flex items-center gap-2 text-sm">
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ background: COLORS[i % COLORS.length] }}
                              />
                              <span className="text-muted-foreground">{s.name}</span>
                              <span className="font-semibold ml-auto">{s.value}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Evolução por Vigência ─────────────────────────────────────── */}
          <TabsContent value="evolucao" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* FINAME carretas */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" />
                    FINAME Mensal — Carretas + Cavalos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="finameCarretas"
                        name="FINAME Carretas"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="finameCavalos"
                        name="FINAME Cavalos"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Manutenção + seguro + IPVA */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-primary" />
                    Encargos Mensais — Seguro · IPVA · Manutenção
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="seguroCarretas" name="Seguro" stackId="a" fill="#6366f1" />
                      <Bar dataKey="ipvaCarretas" name="IPVA+Lic." stackId="a" fill="#22d3ee" />
                      <Bar dataKey="manutencaoCavalos" name="Manutenção" stackId="a" fill="#10b981" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Lucro fixo vs variável */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Lucro Previsto — Fixo vs. Variável (Carretas)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="lucroFixoCarretas" name="Lucro Fixo" fill="#10b981" radius={[4,4,0,0]} />
                      <Bar dataKey="lucroVariavelCarretas" name="Lucro Variável" fill="#f59e0b" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Valor da frota */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">
                    Valor Patrimonial da Frota (NF)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={data?.summary}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}M`}
                      />
                      <Tooltip
                        formatter={(v: number) => fmt(v)}
                        contentStyle={{
                          background: "#1e293b",
                          border: "1px solid #334155",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="valorFrotaCavalos" name="Cavalos" stackId="a" fill="#6366f1" />
                      <Bar dataKey="valorFrotaCarretas" name="Carretas" stackId="a" fill="#22d3ee" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Carretas ─────────────────────────────────────────────────── */}
          <TabsContent value="carretas">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Carretas — {data?.vigenciaLabels[activeVig] ?? activeVig}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CarretasTable vigencia={activeVig} />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Cavalos ──────────────────────────────────────────────────── */}
          <TabsContent value="cavalos">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Cavalos Mecânicos — {data?.vigenciaLabels[activeVig] ?? activeVig}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CavalosTable vigencia={activeVig} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
