import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort } from "@/lib/format";
import type { HistoricoDaDRE, PonteDaDRE } from "./tipos";

/**
 * Os dois gráficos do módulo, e nenhum a mais (§25).
 *
 * A evolução responde *para onde isto está indo* e a ponte responde *o que
 * empurrou daqui para ali* — as duas perguntas que uma tabela responde pior que
 * uma forma. "Distribuição da frota" e "receita × custo × resultado" ficaram de
 * fora: com a seção de custo variável inteiramente vazia, os dois teriam uma
 * barra e uma legenda explicando a ausência das outras.
 *
 * SVG à mão, sem biblioteca de gráfico. São duas formas simples, e uma
 * dependência nova custaria mais em bytes e em superfície do que o desenho.
 * Vigência ausente **não vira zero**: a linha se interrompe, que é o que a
 * ausência parece.
 */

const LARGURA = 720;
const ALTURA = 200;
const MARGEM = { topo: 16, direita: 12, baixo: 28, esquerda: 64 };

export function EvolucaoDoResultado({
  historico,
  className,
}: {
  historico: HistoricoDaDRE;
  className?: string;
}) {
  const gradId = useId();
  const pontos = historico.pontos;
  const valores = pontos
    .flatMap((p) => [p.receita, p.resultado])
    .filter((v): v is number => v !== null);

  if (valores.length === 0) {
    return (
      <div className={cn("border rounded-lg bg-card px-6 py-10 text-center", className)}>
        <p className="text-sm text-muted-foreground">
          Nenhuma vigência desta série tem valor apurado.
        </p>
      </div>
    );
  }

  const max = Math.max(...valores, 0);
  const min = Math.min(...valores, 0);
  const faixa = max - min || 1;

  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.baixo;

  const x = (i: number) =>
    MARGEM.esquerda + (pontos.length === 1 ? larguraUtil / 2 : (i / (pontos.length - 1)) * larguraUtil);
  const y = (v: number) => MARGEM.topo + alturaUtil - ((v - min) / faixa) * alturaUtil;

  /** Segmentos contínuos: uma vigência sem valor quebra a linha em vez de zerá-la. */
  const segmentos = (chave: "receita" | "resultado"): string[] => {
    const partes: string[] = [];
    let atual: string[] = [];
    pontos.forEach((p, i) => {
      const v = p[chave];
      if (v === null) {
        if (atual.length > 1) partes.push(atual.join(" "));
        atual = [];
        return;
      }
      atual.push(`${atual.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (atual.length > 1) partes.push(atual.join(" "));
    return partes;
  };

  const zero = y(0);

  return (
    <div className={cn("border rounded-lg bg-card p-4", className)}>
      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Evolução da receita e do resultado de ${historico.rotulo} em ${pontos.length} vigências`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* A linha do zero, quando ela cai dentro do gráfico: é o que separa
            resultado positivo de negativo, e sem ela o olho não sabe onde está. */}
        {min < 0 && max > 0 && (
          <line
            x1={MARGEM.esquerda}
            x2={LARGURA - MARGEM.direita}
            y1={zero}
            y2={zero}
            className="stroke-border"
            strokeDasharray="3 3"
          />
        )}

        <text
          x={MARGEM.esquerda - 8}
          y={MARGEM.topo + 4}
          textAnchor="end"
          className="fill-muted-foreground text-3xs"
        >
          {formatBrlShort(max)}
        </text>
        <text
          x={MARGEM.esquerda - 8}
          y={MARGEM.topo + alturaUtil}
          textAnchor="end"
          className="fill-muted-foreground text-3xs"
        >
          {formatBrlShort(min)}
        </text>

        {segmentos("receita").map((d, i) => (
          <path
            key={`receita-${i}`}
            d={d}
            fill="none"
            className="stroke-muted-foreground/50"
            strokeWidth={1.5}
          />
        ))}
        {segmentos("resultado").map((d, i) => (
          <path
            key={`resultado-${i}`}
            d={d}
            fill="none"
            className="stroke-brand-red"
            strokeWidth={2}
          />
        ))}

        {pontos.map((p, i) =>
          p.resultado === null ? null : (
            <circle
              key={p.effectiveDate}
              cx={x(i)}
              cy={y(p.resultado)}
              r={3}
              className="fill-brand-red"
            >
              <title>
                {p.periodLabel}: resultado {formatBrl(p.resultado)}
                {p.receita !== null && `, receita ${formatBrl(p.receita)}`}
              </title>
            </circle>
          ),
        )}

        {pontos.map((p, i) => (
          <text
            key={`rot-${p.effectiveDate}`}
            x={x(i)}
            y={ALTURA - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-3xs"
          >
            {p.periodLabel.slice(0, 3)}
          </text>
        ))}
      </svg>

      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-px bg-muted-foreground/50" /> Receita
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 bg-brand-red" /> Resultado apurado
        </span>
        {pontos.some((p) => !p.presente) && (
          <span>· vigência sem a unidade interrompe a linha, e não a zera</span>
        )}
      </div>
    </div>
  );
}

/**
 * A ponte do resultado (§25, §12) — waterfall do que empurrou de um período ao outro.
 *
 * Barras horizontais, e não o waterfall vertical clássico: os rótulos são nomes
 * de linha da DRE, e na horizontal eles cabem sem girar o texto. O que a forma
 * tem de mostrar é a ordem de grandeza relativa e o sinal, e ela mostra.
 */
export function PonteDoResultado({
  ponte,
  className,
}: {
  ponte: PonteDaDRE;
  className?: string;
}) {
  if (ponte.porLinha.length === 0) return null;

  const maior = Math.max(...ponte.porLinha.map((l) => Math.abs(l.efeito)), 1);

  return (
    <div className={cn("border rounded-lg bg-card divide-y", className)}>
      {ponte.porLinha.map((l) => {
        const largura = (Math.abs(l.efeito) / maior) * 100;
        const positivo = l.efeito > 0;
        return (
          <div key={l.code} className="px-5 py-2.5 flex items-center gap-4">
            <span className="text-sm w-52 shrink-0 truncate" title={l.titulo}>
              {l.titulo}
            </span>
            <div className="flex-1 min-w-0 h-2 relative">
              <div
                className={cn(
                  "absolute h-full rounded-sm",
                  positivo ? "bg-emerald-500/70" : "bg-brand-red/70",
                )}
                style={{ width: `${largura}%` }}
              />
            </div>
            <span
              className={cn(
                "text-sm tabular-nums w-32 text-right shrink-0",
                positivo ? "text-emerald-600 dark:text-emerald-500" : "text-brand-red",
              )}
            >
              {positivo ? "+" : "−"}
              {formatBrl(Math.abs(l.efeito))}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground w-20 text-right shrink-0">
              {l.alteracoes} {l.alteracoes === 1 ? "alteração" : "alterações"}
            </span>
          </div>
        );
      })}

      <div className="px-5 py-3 flex items-center gap-4 bg-muted/30">
        <span className="text-sm font-semibold w-52 shrink-0">Saldo das alterações</span>
        <div className="flex-1" />
        <span
          className={cn(
            "text-base font-semibold tabular-nums w-32 text-right shrink-0",
            (ponte.saldo ?? 0) < 0 ? "text-brand-red" : "text-emerald-600 dark:text-emerald-500",
          )}
        >
          {ponte.saldo === null
            ? "—"
            : `${ponte.saldo > 0 ? "+" : "−"}${formatBrl(Math.abs(ponte.saldo))}`}
        </span>
        <span className="w-20 shrink-0" />
      </div>
    </div>
  );
}
