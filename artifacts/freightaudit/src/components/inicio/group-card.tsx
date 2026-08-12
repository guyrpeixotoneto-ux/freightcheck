import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info, Lock, TriangleAlert } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent, formatValue, periodicitySuffix } from "@/lib/format";
import type { ChangeGroup, GroupVehicle, AttributeSeries } from "./types";

/**
 * O cartão — a unidade de análise da tela.
 *
 * Um cartão responde, na ordem em que a pergunta é feita: **o que mudou**, *em
 * quantos veículos*, *de quanto para quanto*, *quanto isso custa* e *por que
 * não custa nada mensurável quando é o caso*. Abrir o cartão acrescenta o
 * histórico, os veículos e a célula de origem — sem sair da página.
 *
 * O que o cartão nunca faz: exibir um total que a semântica não autoriza,
 * esconder que há dispersão dentro do grupo, ou apresentar como variação de
 * preço uma soma que cresceu porque a frota cresceu.
 */

const BADGE_STYLE: Record<string, string> = {
  DINHEIRO: "bg-emerald-100 text-emerald-900 border-emerald-300",
  RUPTURA: "bg-amber-100 text-amber-900 border-amber-300",
  COBERTURA: "bg-sky-100 text-sky-900 border-sky-300",
  MOVIMENTO: "bg-violet-100 text-violet-900 border-violet-300",
  TRAVADO: "bg-zinc-100 text-zinc-700 border-zinc-300",
  SEM_SINAL: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

export function GroupCard({ group, period }: { group: ChangeGroup; period: string }) {
  const [open, setOpen] = useState(false);
  const money = group.impact.amount !== null && group.impact.amount !== 0;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors",
        open && "ring-1 ring-primary/30",
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-5 py-4 flex gap-4 items-start hover:bg-muted/40 rounded-lg"
      >
        <span className="mt-1 text-muted-foreground shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
                BADGE_STYLE[group.badge],
              )}
            >
              {group.badgeLabel}
            </span>
            <span className="font-semibold">{group.title}</span>
            <span className="text-muted-foreground">— {group.equipment}</span>
          </div>

          <div className="text-sm text-muted-foreground">{group.coverageLabel}</div>

          <div className="text-sm">
            <BeforeAfter group={group} />
          </div>

          {group.patterns > 1 && (
            <div className="text-xs text-muted-foreground">
              {group.patterns} padrões “antes → depois” distintos dentro deste grupo
              {group.dominantPattern && (
                <>
                  {" "}· o mais comum é{" "}
                  <span className="font-mono">
                    {group.dominantPattern.before ?? "—"} → {group.dominantPattern.after ?? "—"}
                  </span>{" "}
                  em {group.dominantPattern.vehicles}
                </>
              )}
            </div>
          )}
        </div>

        <div className="text-right shrink-0 w-52">
          {money ? (
            <div
              className={cn(
                "text-lg font-bold tabular-nums whitespace-nowrap",
                group.impact.amount! < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {formatBrl(group.impact.amount!)}
              <span className="text-xs font-normal text-muted-foreground">
                {periodicitySuffix(group.impact.periodicity)}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">impacto não calculável</div>
          )}
          {group.impact.excludedVehicles > 0 && (
            <div className="text-xs text-amber-800 mt-1">
              {group.impact.excludedVehicles} de {group.vehicles} fora do total
            </div>
          )}
          {group.anomalies.length > 0 && (
            <div className="text-xs text-amber-800 mt-1 inline-flex items-center gap-1">
              <TriangleAlert className="w-3 h-3" />
              possível anomalia de formato
            </div>
          )}
        </div>
      </button>

      {open && <GroupDetail group={group} period={period} />}
    </div>
  );
}

/**
 * O "antes → depois" do grupo.
 *
 * Só existe total quando `aggregation = SUM`. Para tudo o mais aparece a faixa
 * de variação e a média, ditas como tais — porque somar km/l de 62 cavalos
 * produz um número que não significa coisa nenhuma.
 */
function BeforeAfter({ group }: { group: ChangeGroup }) {
  const a = group.aggregate;

  if (a.summable && a.totalBefore !== null && a.totalAfter !== null) {
    return (
      <span className="tabular-nums">
        <span className="font-mono">{formatValue(a.totalBefore, group.unit)}</span>
        {" → "}
        <span className="font-mono font-medium">{formatValue(a.totalAfter, group.unit)}</span>
        {a.deltaPercent !== null && (
          <span
            className={cn(
              "ml-2 font-medium",
              a.deltaPercent < 0 ? "text-red-700" : "text-emerald-700",
            )}
          >
            {formatPercent(a.deltaPercent)}
          </span>
        )}
      </span>
    );
  }

  if (a.minPercent !== null && a.maxPercent !== null) {
    return (
      <span className="text-muted-foreground">
        variação de {formatPercent(a.minPercent)} a {formatPercent(a.maxPercent)} por veículo ·{" "}
        <span className="italic">não somável ({a.aggregation ?? "agregação não definida"})</span>
      </span>
    );
  }

  if (group.dominantPattern) {
    return (
      <span className="font-mono text-muted-foreground">
        {group.dominantPattern.before ?? "—"} → {group.dominantPattern.after ?? "—"}
      </span>
    );
  }
  return <span className="text-muted-foreground italic">sem variação numérica a exibir</span>;
}

// ---------------------------------------------------------------------------
// Nível 2
// ---------------------------------------------------------------------------

function GroupDetail({ group, period }: { group: ChangeGroup; period: string }) {
  const vehicles = useQuery({
    queryKey: ["group-vehicles", period, group.key],
    queryFn: async () => {
      const params = new URLSearchParams({
        period,
        attributeCode: group.attributeCode ?? "",
        entityType: group.entityType ?? "",
        changeType: group.changeType,
        comparability: group.comparability,
        impactConfidence: group.impact.confidence,
      });
      const response = await fetch(getApiUrl(`/changes/grouped/vehicles?${params}`));
      if (!response.ok) return [];
      return (await response.json()) as GroupVehicle[];
    },
  });

  const series = useQuery({
    queryKey: ["attribute-series", group.attributeCode],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/attributes/${encodeURIComponent(group.attributeCode ?? "")}/series`),
      );
      if (!response.ok) return null;
      return (await response.json()) as AttributeSeries;
    },
    enabled: group.attributeCode !== null,
  });

  return (
    <div className="border-t px-5 py-4 space-y-5 text-sm">
      {group.anomalies.map((anomaly) => (
        <div
          key={`${anomaly.kind}-${anomaly.sameInstant}`}
          className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900"
        >
          <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <TriangleAlert className="w-3.5 h-3.5" />
            Possível anomalia de formato · {anomaly.vehicles}{" "}
            {anomaly.vehicles === 1 ? "veículo" : "veículos"}
          </div>
          <p>{anomaly.explanation}</p>
          <p className="mt-1 text-xs">
            Nada foi convertido nem corrigido. O valor original de cada lado continua
            guardado como veio da planilha — abra um veículo abaixo para conferir a célula.
          </p>
        </div>
      ))}

      {group.impact.excludedReason && (
        <div className="rounded-md border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sky-900">
          <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Fora do total desta vigência
          </div>
          <p>{group.impact.excludedReason}</p>
          {group.composition && (
            <p className="mt-1.5 text-xs">
              <span className="font-medium">Composição declarada:</span>{" "}
              <span className="font-mono">{group.composition.total}</span> ={" "}
              <span className="font-mono">{group.composition.parts.join(" + ")}</span>.{" "}
              {group.composition.evidence}
            </p>
          )}
          {group.impact.excludedAmount !== null && (
            <p className="mt-1.5 text-xs tabular-nums">
              Valor deixado de fora: {formatBrl(group.impact.excludedAmount)}
              {periodicitySuffix(group.impact.periodicity)}
              {group.impact.countedVehicles > 0 && (
                <> · {group.impact.countedVehicles} veículo(s) deste grupo continuam no total.</>
              )}
            </p>
          )}
        </div>
      )}

      {group.inconclusiveReason && (
        <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900">
          <div className="font-semibold text-xs uppercase tracking-wide mb-1">
            Comparação inconclusiva
          </div>
          <p>{group.inconclusiveReason}</p>
        </div>
      )}

      {group.impact.amount === null && group.impact.reason && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Lock className="w-3.5 h-3.5" />
            Por que não há valor apurado
          </span>
          <p className="mt-1">{group.impact.reason}</p>
        </div>
      )}

      {series.data && series.data.points.length > 0 && (
        <AttributeHistory series={series.data} />
      )}

      <div>
        <div className="font-medium mb-2">
          Veículos afetados{" "}
          <span className="text-muted-foreground font-normal">
            ({group.vehicles} de {group.fleet})
          </span>
        </div>
        {vehicles.isLoading && <p className="text-muted-foreground">Carregando…</p>}
        {vehicles.data && <VehicleTable rows={vehicles.data} group={group} />}
      </div>

      <div className="text-xs text-muted-foreground border-t pt-3">
        <span className="font-medium text-foreground">Classificação:</span>{" "}
        {group.costClass === "FIXO"
          ? "custo fixo"
          : group.costClass === "VARIAVEL"
            ? "custo variável"
            : "sem classificação"}
        {group.taxonomyName && <> · {group.taxonomyName}</>} · {group.semanticsLabel}
        {group.attributeCode && (
          <> · coluna de origem: <span className="font-mono">{group.attributeCode}</span></>
        )}
      </div>
    </div>
  );
}

/**
 * A série do atributo nas vigências.
 *
 * O único gráfico da tela, e existe por uma decisão que não tem substituto
 * textual: distinguir "caiu uma vez" de "vem caindo há meses". A tabela ao lado
 * dele mostra numerador, denominador e média — porque a soma da frota sobe
 * quando entram veículos, e sem a divisão isso se lê como aumento de preço.
 */
function AttributeHistory({ series }: { series: AttributeSeries }) {
  const values = series.points.map((p) =>
    series.summable ? p.total : p.average,
  );
  const known = values.filter((v): v is number => v !== null);
  const max = known.length ? Math.max(...known) : 0;
  const min = known.length ? Math.min(...known) : 0;
  const span = max - min || 1;

  return (
    <div>
      <div className="font-medium mb-1">Como esta linha se comportou nas vigências</div>
      <p className="text-xs text-muted-foreground mb-3">{series.note}</p>

      {known.length > 0 && (
        <div className="flex items-end gap-1 h-20 mb-2">
          {series.points.map((point, index) => {
            const value = values[index];
            const height = value === null ? 0 : ((value - min) / span) * 100;
            return (
              <div key={point.effectiveDate} className="flex-1 flex flex-col justify-end h-full">
                <div
                  className="bg-primary/70 rounded-t"
                  style={{ height: `${Math.max(height, 3)}%` }}
                  title={`${point.periodLabel}: ${formatValue(value, series.unit)}`}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b">
              <th className="text-left py-1 font-medium">Vigência</th>
              <th className="text-right py-1 font-medium">Veículos com valor</th>
              {series.averageable && (
                <th className="text-right py-1 font-medium">Com valor numérico</th>
              )}
              {series.summable && <th className="text-right py-1 font-medium">Soma da frota</th>}
              {series.averageable && (
                <th className="text-right py-1 font-medium">Média por veículo</th>
              )}
              <th className="text-right py-1 font-medium">Faixa</th>
            </tr>
          </thead>
          <tbody>
            {series.points.map((point) => (
              <tr key={point.effectiveDate} className="border-b last:border-0">
                <td className="py-1">{point.periodLabel}</td>
                <td className="py-1 text-right tabular-nums">{point.vehicles}</td>
                {series.averageable && (
                  <td className="py-1 text-right tabular-nums">{point.numericVehicles}</td>
                )}
                {series.summable && (
                  <td className="py-1 text-right tabular-nums font-mono">
                    {formatValue(point.total, series.unit)}
                  </td>
                )}
                {series.averageable && (
                  <td className="py-1 text-right tabular-nums font-mono">
                    {point.total !== null && point.numericVehicles > 0 ? (
                      <span
                        title={`${formatValue(point.total, series.unit)} ÷ ${point.numericVehicles} veículos`}
                      >
                        {formatValue(point.average, series.unit)}
                      </span>
                    ) : (
                      formatValue(point.average, series.unit)
                    )}
                  </td>
                )}
                <td className="py-1 text-right tabular-nums font-mono text-muted-foreground">
                  {formatValue(point.min, series.unit)} – {formatValue(point.max, series.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {series.averageable && (
        <p className="text-xs text-muted-foreground mt-1.5">
          A média é a soma dividida pelo número de veículos com valor numérico na
          vigência — os dois números estão na tabela. Uma soma maior com mais veículos
          não é preço maior.
        </p>
      )}
    </div>
  );
}

/**
 * Quantos veículos aparecem antes de pedir para ver o resto.
 *
 * O IPVA de julho tem 62 linhas, e despejá-las todas empurra os outros
 * cartões para fora da tela — o oposto do que esta leitura veio resolver. O
 * corte é só de renderização: a contagem total fica escrita, o botão abre a
 * lista inteira, e nada é filtrado nem descartado.
 */
const VEHICLE_PREVIEW = 12;

function VehicleTable({ rows, group }: { rows: GroupVehicle[]; group: ChangeGroup }) {
  const [origin, setOrigin] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (rows.length === 0) {
    return <p className="text-muted-foreground">Nenhum veículo retornado.</p>;
  }

  const visible = showAll ? rows : rows.slice(0, VEHICLE_PREVIEW);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">Placa</th>
            <th className="text-right px-3 py-1.5 font-medium">Antes</th>
            <th className="text-right px-3 py-1.5 font-medium">Agora</th>
            <th className="text-right px-3 py-1.5 font-medium">Variação</th>
            <th className="text-right px-3 py-1.5 font-medium">Impacto</th>
            <th className="text-right px-3 py-1.5 font-medium">Origem</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <Fragment key={row.changeId}>
              <tr className="border-t">
                <td className="px-3 py-1.5 font-mono">{row.plate ?? "—"}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {row.numericBefore !== null
                    ? formatValue(row.numericBefore, group.unit)
                    : (row.valueBefore ?? "—")}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {row.numericAfter !== null
                    ? formatValue(row.numericAfter, group.unit)
                    : (row.valueAfter ?? "—")}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {row.deltaPercent === null ? (
                    <span className="text-amber-800">—</span>
                  ) : (
                    <span className={row.deltaPercent < 0 ? "text-red-700" : "text-emerald-700"}>
                      {formatPercent(row.deltaPercent)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums font-mono">
                  {row.impactAmount === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        row.excludedFromTotal && "line-through opacity-60",
                        row.impactAmount < 0 ? "text-red-700" : "text-emerald-700",
                      )}
                      title={
                        row.excludedFromTotal
                          ? "Fora do total: a variação já está contada nas parcelas deste ativo."
                          : undefined
                      }
                    >
                      {formatBrl(row.impactAmount)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    className="text-primary hover:underline"
                    onClick={() => setOrigin(origin === row.changeId ? null : row.changeId)}
                  >
                    célula
                  </button>
                </td>
              </tr>
              {row.anomaly && (
                <tr className="bg-amber-50/60">
                  <td />
                  <td colSpan={5} className="px-3 pb-1.5 text-[11px] text-amber-900">
                    {row.anomaly.interpretation}
                    {/* A qualificação vem do mesmo critério do cartão: uma
                        diferença abaixo de um segundo é a precisão que o serial
                        do Excel não carrega, não uma data nova. Duplicar a frase
                        aqui com outro critério faria a linha contradizer o
                        aviso logo acima dela. */}
                    {row.anomaly.sameInstant
                      ? " — mesmo instante do outro lado; troca de formato."
                      : row.anomaly.differenceMs < 1000
                        ? ` — diferença de ${row.anomaly.differenceMs} ms; precisão perdida no formato.`
                        : " — instante diferente do outro lado; há mudança de data junto."}
                  </td>
                </tr>
              )}
              {origin === row.changeId && (
                <tr className="bg-muted/40">
                  <td />
                  <td colSpan={5} className="px-3 py-2">
                    <Provenance changeId={row.changeId} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {rows.length > visible.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-2 text-xs text-primary hover:bg-muted/60 border-t text-left"
        >
          ver os {rows.length - visible.length} veículos restantes (nenhum foi descartado)
        </button>
      )}
    </div>
  );
}

/**
 * A célula da planilha, dos dois lados.
 *
 * Reaproveita `/changes/:id/provenance`, que já existia e já era a melhor parte
 * da tela anterior. Rastreabilidade não muda de lugar quando a leitura muda.
 */
function Provenance({ changeId }: { changeId: number }) {
  const { data } = useQuery({
    queryKey: ["provenance", changeId],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/changes/${changeId}/provenance`));
      if (!response.ok) return null;
      return (await response.json()) as Record<string, string | number | null>;
    },
  });

  if (!data) return <span className="text-muted-foreground">Carregando origem…</span>;

  const side = (
    title: unknown,
    sheet: unknown,
    row: unknown,
    column: unknown,
    header: unknown,
    raw: unknown,
    type: unknown,
  ) => (
    <div className="rounded border bg-card px-3 py-2 font-mono text-[11px]">
      <div className="font-sans uppercase tracking-wide text-muted-foreground mb-1">
        {String(title)}
      </div>
      {sheet ? (
        <>
          <div>
            aba <strong>{String(sheet)}</strong> · linha <strong>{String(row)}</strong> · coluna{" "}
            <strong>{String(column)}</strong>
          </div>
          <div className="text-muted-foreground">cabeçalho: {String(header)}</div>
          <div className="text-muted-foreground">
            valor original: {String(raw)} ({String(type)})
          </div>
        </>
      ) : (
        <div className="text-muted-foreground font-sans italic">
          Sem célula de origem deste lado.
        </div>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {side(
        `Antes — ${data.snapshot_before}`,
        data.sheet_before,
        data.row_before,
        data.column_before,
        data.header_before,
        data.raw_before,
        data.type_before,
      )}
      {side(
        `Agora — ${data.snapshot_after}`,
        data.sheet_after,
        data.row_after,
        data.column_after,
        data.header_after,
        data.raw_after,
        data.type_after,
      )}
    </div>
  );
}
