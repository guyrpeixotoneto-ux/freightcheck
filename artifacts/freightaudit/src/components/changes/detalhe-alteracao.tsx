import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent, formatValue } from "@/lib/format";
import type { AttributeSeries, ChangeGroup, GroupVehicle } from "@/components/inicio/types";

/**
 * As peças do segundo nível — a profundidade técnica de uma alteração.
 *
 * Saíram de `inicio/group-card.tsx` sem alteração de comportamento para que o
 * cockpit do Acompanhamento e o cartão dos Parâmetros mostrem **a mesma
 * tabela**, com a mesma rastreabilidade até a célula. Duas cópias divergiriam,
 * e a que divergisse primeiro seria a que alguém usa para decidir.
 */

/**
 * Quantos veículos aparecem antes de pedir para ver o resto.
 *
 * O IPVA de julho tem 62 linhas, e despejá-las todas empurra o resto da tela
 * para longe. O corte é só de renderização: a contagem total fica escrita, o
 * botão abre a lista inteira, e nada é filtrado nem descartado.
 */
const VEHICLE_PREVIEW = 12;

/**
 * A vigência de um lado da tabela, quando ela é uma só.
 *
 * As linhas de um grupo vêm todas da mesma comparação, então o normal é haver
 * um único rótulo — e ele vira o subtítulo da coluna. Duas seriam um grupo que
 * juntou séries com anteriores diferentes: aí a coluna volta a ser só "Antes",
 * porque escrever um dos dois meses no cabeçalho de todas as linhas seria
 * afirmar do lado errado. É a mesma disciplina do resto da tela — sem valor
 * apurado se diz, não se estima.
 */
function vigenciaUnica(rotulos: (string | undefined)[]): string | null {
  const distintos = [...new Set(rotulos.filter((r): r is string => !!r))];
  return distintos.length === 1 ? distintos[0] : null;
}

export function TabelaVeiculos({
  rows,
  group,
}: {
  rows: GroupVehicle[];
  group: ChangeGroup;
}) {
  const [origin, setOrigin] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busca, setBusca] = useState("");

  if (rows.length === 0) {
    return <p className="text-muted-foreground">Nenhum veículo retornado.</p>;
  }

  // Sobre `rows`, e não sobre as linhas visíveis: o cabeçalho descreve a
  // tabela inteira, e não pode mudar de mês quando alguém busca uma placa.
  const vigenciaAntes = vigenciaUnica(rows.map((r) => r.periodBeforeLabel));
  const vigenciaAgora = vigenciaUnica(rows.map((r) => r.periodAfterLabel));

  const termo = busca.trim().toLowerCase();
  const filtradas = termo
    ? rows.filter((r) => (r.plate ?? "").toLowerCase().includes(termo))
    : rows;
  const visible = showAll ? filtradas : filtradas.slice(0, VEHICLE_PREVIEW);

  return (
    <div className="rounded-md border overflow-hidden">
      {/*
        Uma frase para a tabela inteira, e não só a nota por linha: quem chega
        aqui vê primeiro as colunas "Antes / Agora / Variação", que são a
        gramática de uma mudança. Sem esta linha, a leitura de mudança se forma
        antes de a explicação embaixo de cada placa ser lida.
      */}
      {group.formatOnly && (
        <p className="border-b bg-slate-50 px-3 py-2 text-[0.6875rem] text-slate-700 leading-snug">
          Nenhuma linha desta tabela é mudança de valor: em cada uma, o número da
          coluna <span className="font-medium">Agora</span> é o mesmo instante da data
          da coluna <span className="font-medium">Antes</span>, escrito no formato serial
          do Excel. Os dois lados continuam como vieram da planilha — abra{" "}
          <span className="font-medium">célula</span> em qualquer linha para conferir.
        </p>
      )}
      {rows.length > VEHICLE_PREVIEW && (
        <div className="border-b bg-muted/40 px-3 py-2">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar placa…"
            className="w-full max-w-xs bg-card border rounded px-2 py-1 text-xs"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Placa</th>
              {/*
                O mês fica no cabeçalho, e não só no topo da página.
                "Antes/Agora" sozinhos obrigam quem está a dez linhas de
                rolagem daqui a lembrar contra o que esta vigência foi
                comparada — e a lembrança mais fácil, "o mês anterior", é a
                que o motor não promete: cada série compara contra a última
                entrega dela. Uma linha `0 → 2,19` não se lê sem saber qual
                lado é qual mês.
              */}
              <th className="text-right px-3 py-1.5 font-medium">
                <Vigencia titulo="Antes" periodo={vigenciaAntes} />
              </th>
              <th className="text-right px-3 py-1.5 font-medium">
                <Vigencia titulo="Agora" periodo={vigenciaAgora} />
              </th>
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
                      <span
                        className={row.deltaPercent < 0 ? "text-red-700" : "text-emerald-700"}
                      >
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
                  <tr className={row.anomaly.formatOnly ? "bg-slate-50" : "bg-amber-50/60"}>
                    <td />
                    <td
                      colSpan={5}
                      className={cn(
                        "px-3 pb-1.5 text-[0.6875rem]",
                        row.anomaly.formatOnly ? "text-slate-700" : "text-amber-900",
                      )}
                    >
                      {row.anomaly.interpretation}
                      {/* A qualificação é a do servidor — `formatOnly` chega
                          pronto em cada linha. Antes ela era refeita aqui com um
                          `differenceMs < 1000` escrito à mão, e um limiar
                          duplicado é um limiar que um dia diverge: bastava mudar
                          o de `anomalies.ts` para esta linha passar a
                          contradizer o cartão logo acima dela. */}
                      {row.anomaly.sameInstant
                        ? " — mesmo instante do outro lado; troca de formato."
                        : row.anomaly.formatOnly
                          ? ` — diferença de ${row.anomaly.differenceMs} ms; precisão perdida no formato.`
                          : " — instante diferente do outro lado; há mudança de data junto."}
                    </td>
                  </tr>
                )}
                {origin === row.changeId && (
                  <tr className="bg-muted/40">
                    <td />
                    <td colSpan={5} className="px-3 py-2">
                      <Proveniencia changeId={row.changeId} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > visible.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-2 text-xs text-primary hover:bg-muted/60 border-t text-left"
        >
          ver os {filtradas.length - visible.length} veículos restantes (nenhum foi descartado)
        </button>
      )}
      {termo && filtradas.length === 0 && (
        <p className="px-3 py-2 text-xs text-muted-foreground border-t">
          Nenhuma placa contém “{busca}”. As {rows.length} linhas continuam aqui — limpe a
          busca para vê-las.
        </p>
      )}
    </div>
  );
}

/**
 * O rótulo de uma das duas colunas de valor.
 *
 * `Antes · julho/2026`. O mês vem em peso normal para a coluna continuar
 * escaneável de cima a baixo — o cabeçalho ganha a data sem virar a coisa mais
 * pesada da tabela. Sem vigência única, sobra o rótulo de sempre.
 */
function Vigencia({ titulo, periodo }: { titulo: string; periodo: string | null }) {
  if (!periodo) return <>{titulo}</>;
  return (
    <>
      {titulo}{" "}
      <span className="font-normal text-muted-foreground">· {periodo}</span>
    </>
  );
}

/**
 * A célula da planilha, dos dois lados.
 *
 * Reaproveita `/changes/:id/provenance`. Rastreabilidade não muda de lugar
 * quando a leitura muda.
 */
export function Proveniencia({ changeId }: { changeId: number }) {
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
    /**
     * A vigência daquele lado, ao lado da entrega.
     *
     * O `source_label` sozinho identifica o arquivo e não diz de quando ele é
     * — e é justamente "de quando" que se vem conferir aqui, depois de ler
     * "Antes" numa tabela. Os dois ficam: a data no título, onde o olho cai, e
     * o rótulo da entrega logo abaixo, que é o que se cita ao pedir a planilha
     * de volta para o cliente.
     */
    period: unknown,
    delivery: unknown,
    sheet: unknown,
    row: unknown,
    column: unknown,
    header: unknown,
    raw: unknown,
    type: unknown,
  ) => (
    <div className="rounded border bg-card px-3 py-2 font-mono text-[0.6875rem]">
      <div className="font-sans uppercase tracking-wide text-muted-foreground mb-1">
        {String(title)}
        {typeof period === "string" && period !== "" && <> · {period}</>}
      </div>
      <div className="text-muted-foreground">entrega: {String(delivery)}</div>
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
        "Antes",
        data.period_before_label,
        data.snapshot_before,
        data.sheet_before,
        data.row_before,
        data.column_before,
        data.header_before,
        data.raw_before,
        data.type_before,
      )}
      {side(
        "Agora",
        data.period_after_label,
        data.snapshot_after,
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

/**
 * A série do atributo nas vigências.
 *
 * O único gráfico da leitura, e existe por uma decisão que não tem substituto
 * textual: distinguir "caiu uma vez" de "vem caindo há meses". A tabela ao lado
 * dele mostra numerador, denominador e média — porque a soma da frota sobe
 * quando entram veículos, e sem a divisão isso se lê como aumento de preço.
 */
export function HistoricoAtributo({
  series,
  semTitulo,
}: {
  series: AttributeSeries;
  /** Quando quem chama já escreveu o título da seção — ver o cockpit. */
  semTitulo?: boolean;
}) {
  const values = series.points.map((p) => (series.summable ? p.total : p.average));
  const known = values.filter((v): v is number => v !== null);
  const max = known.length ? Math.max(...known) : 0;
  const min = known.length ? Math.min(...known) : 0;
  const span = max - min || 1;

  return (
    <div>
      {!semTitulo && (
        <div className="font-medium mb-1">Como esta linha se comportou nas vigências</div>
      )}
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
          A média é a soma dividida pelo número de veículos com valor numérico na vigência — os
          dois números estão na tabela. Uma soma maior com mais veículos não é preço maior.
        </p>
      )}
    </div>
  );
}
