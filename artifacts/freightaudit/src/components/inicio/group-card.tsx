import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info, Lock, TriangleAlert } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent, formatValue, periodicitySuffix } from "@/lib/format";
import {
  HistoricoAtributo,
  TabelaVeiculos,
} from "@/components/changes/detalhe-alteracao";
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
  // Azul de nota, não âmbar de alerta: o que este selo diz é que **não** houve
  // mudança contratual. Vesti-lo de aviso repõe pela cor o susto que a
  // classificação acabou de tirar.
  FORMATO: "bg-slate-100 text-slate-700 border-slate-300",
  SEM_SINAL: "bg-zinc-50 text-zinc-500 border-zinc-200",
};

export function GroupCard({
  group,
  period,
  inicialmenteAberto = false,
}: {
  group: ChangeGroup;
  period: string;
  /**
   * Se o cartão já nasce aberto.
   *
   * Falso em toda lista — numa pilha de cartões, abrir todos é não ordenar
   * nenhum. Verdadeiro onde o cartão **é** o assunto da tela: na gaveta que uma
   * alteração em destaque abre, exigir mais um clique para ver os veículos
   * seria esconder atrás de um chevron exatamente o que o clique anterior pediu.
   */
  inicialmenteAberto?: boolean;
}) {
  const [open, setOpen] = useState(inicialmenteAberto);
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
                "text-[0.6875rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border",
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
            <div
              className={cn(
                "text-xs mt-1 inline-flex items-center gap-1",
                group.formatOnly ? "text-slate-600" : "text-amber-800",
              )}
            >
              {group.formatOnly ? (
                <Info className="w-3 h-3" />
              ) : (
                <TriangleAlert className="w-3 h-3" />
              )}
              {group.formatOnly
                ? "troca de formato, sem mudança de valor"
                : "possível anomalia de formato"}
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
          className={cn(
            "rounded-md border-l-4 px-4 py-3",
            anomaly.formatOnly
              ? "border-slate-400 bg-slate-50 text-slate-800"
              : "border-amber-500 bg-amber-50 text-amber-900",
          )}
        >
          <div className="font-semibold text-xs uppercase tracking-wide mb-1 flex items-center gap-1.5">
            {anomaly.formatOnly ? (
              <Info className="w-3.5 h-3.5" />
            ) : (
              <TriangleAlert className="w-3.5 h-3.5" />
            )}
            {anomaly.formatOnly ? "Troca de formato" : "Possível anomalia de formato"} ·{" "}
            {anomaly.vehicles} {anomaly.vehicles === 1 ? "veículo" : "veículos"}
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
        <HistoricoAtributo series={series.data} />
      )}

      <div>
        <div className="font-medium mb-2">
          Veículos afetados{" "}
          <span className="text-muted-foreground font-normal">
            ({group.vehicles} de {group.fleet})
          </span>
        </div>
        {vehicles.isLoading && <p className="text-muted-foreground">Carregando…</p>}
        {vehicles.data && <TabelaVeiculos rows={vehicles.data} group={group} />}
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
