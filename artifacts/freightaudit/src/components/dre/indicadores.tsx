import { useState } from "react";
import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort } from "@/lib/format";
import type {
  ApuracaoDaDRE,
  ConsolidadoDaDRE,
  CoberturaDaDRE,
  EstadoDaDRE,
  SubtotalDaDRE,
} from "./tipos";
import { ROTULO_DO_ESTADO } from "./tipos";

/**
 * Os quatro indicadores do topo (§6) — e o que fazer com os que não existem.
 *
 * O pedido lista Receita líquida, EBITDA, Resultado econômico e Resultado por
 * km. Dois deles não são apuráveis com este export: o EBITDA porque faltam
 * diesel, pneus e motorista; o resultado por km porque **não existe km** — o
 * export traz o hodômetro de entrada, que é um estoque, e taxas em R$/km, que
 * são razões sem denominador.
 *
 * Os dois ficam no lugar deles, apagados e com o motivo. Removê-los faria a tela
 * parecer completa; exibi-los com um número faria a tela mentir. A terceira
 * saída — a que este componente toma — é dizer que falta, e o que falta.
 */

export function Indicadores({
  dre,
  anterior,
  className,
}: {
  dre: ApuracaoDaDRE | ConsolidadoDaDRE;
  anterior?: ApuracaoDaDRE | ConsolidadoDaDRE | null;
  className?: string;
}) {
  const por = (id: string) => dre.subtotais.find((s) => s.id === id)!;
  const antes = (id: string) => anterior?.subtotais.find((s) => s.id === id) ?? null;

  return (
    <div className={cn("grid gap-px bg-border rounded-lg overflow-hidden md:grid-cols-4", className)}>
      <Indicador
        rotulo="Receita líquida"
        subtotal={por("RECEITA_LIQUIDA")}
        anterior={antes("RECEITA_LIQUIDA")}
      />
      <Indicador rotulo="EBITDA" subtotal={por("EBITDA")} anterior={antes("EBITDA")} />
      <Indicador
        rotulo="Resultado apurado"
        subtotal={por("RESULTADO_ECONOMICO")}
        anterior={antes("RESULTADO_ECONOMICO")}
        usarParcial
      />
      <Indisponivel
        rotulo="Resultado por km"
        motivo="Sem km rodado"
        detalhe={
          "O export não traz quilometragem do período. O hodômetro de entrada é um " +
          "estoque, e as colunas em R$/km são razões sem denominador — nenhuma das " +
          "duas produz km rodado. Multiplicar por uma quilometragem estimada seria " +
          "inventar o número."
        }
      />
    </div>
  );
}

function Indicador({
  rotulo,
  subtotal,
  anterior,
  usarParcial,
}: {
  rotulo: string;
  subtotal: SubtotalDaDRE;
  anterior: SubtotalDaDRE | null;
  /**
   * Mostra `valorParcial` quando o subtotal não fecha.
   *
   * Ligado só no Resultado apurado, e o nome do indicador muda junto: ele diz
   * "apurado", e não "econômico", porque é a conta com o que existe. É a única
   * concessão do módulo a exibir um número incompleto, e ela vem com o rótulo
   * dizendo isso e a cobertura ao lado.
   */
  usarParcial?: boolean;
}) {
  const valor = subtotal.conclusivo ? subtotal.valor : usarParcial ? subtotal.valorParcial : null;

  if (valor === null) {
    return (
      <Indisponivel
        rotulo={rotulo}
        motivo={`${subtotal.bloqueadoPor.length} componentes ausentes`}
        detalhe={subtotal.bloqueadoPor.map((b) => b.titulo).join(", ")}
      />
    );
  }

  const valorAnterior = anterior?.conclusivo
    ? anterior.valor
    : usarParcial
      ? (anterior?.valorParcial ?? null)
      : null;
  const variacao = valorAnterior === null ? null : valor - valorAnterior;

  return (
    <div className="bg-card px-5 py-4">
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1.5",
          valor < 0 && "text-brand-red",
        )}
      >
        {formatBrlShort(valor)}
      </div>
      <div className="text-xs text-muted-foreground mt-1 flex items-baseline gap-2 flex-wrap">
        {subtotal.percentualDaReceita !== null && (
          <span>{subtotal.percentualDaReceita.toFixed(1)}% da receita</span>
        )}
        {!subtotal.conclusivo && usarParcial && <span>com o que existe hoje</span>}
        {variacao !== null && variacao !== 0 && (
          <span className={cn("tabular-nums", variacao < 0 ? "text-brand-red" : "text-emerald-600")}>
            {variacao > 0 ? "+" : "−"}
            {formatBrl(Math.abs(variacao))}
          </span>
        )}
      </div>
    </div>
  );
}

function Indisponivel({
  rotulo,
  motivo,
  detalhe,
}: {
  rotulo: string;
  motivo: string;
  detalhe: string;
}) {
  return (
    <div className="bg-card px-5 py-4" title={detalhe}>
      <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1.5 text-muted-foreground/40">—</div>
      <div className="text-xs text-amber-600 dark:text-amber-500 mt-1 inline-flex items-center gap-1.5">
        <CircleAlert className="w-3.5 h-3.5 shrink-0" />
        {motivo}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const CORES_DO_ESTADO: Record<EstadoDaDRE, string> = {
  COMPLETA: "text-emerald-600 dark:text-emerald-500",
  PARCIALMENTE_APURADA: "text-amber-600 dark:text-amber-500",
  INCONCLUSIVA: "text-brand-red",
};

/**
 * A cobertura (§23), com a lista que a sustenta.
 *
 * O número não é uma nota: é a razão entre componentes apurados e componentes
 * que o plano exige neste escopo, e a lista abaixo é a conta inteira, item a
 * item. `metodo` explica por que a cobertura não é ponderada por valor — a
 * pergunta que todo mundo faz e que é irrespondível por construção.
 */
export function Cobertura({
  cobertura,
  estado,
  className,
}: {
  cobertura: CoberturaDaDRE;
  estado: EstadoDaDRE;
  className?: string;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <div className={cn("border rounded-lg bg-card", className)}>
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <span className={cn("text-sm font-medium", CORES_DO_ESTADO[estado])}>
          {ROTULO_DO_ESTADO[estado]}
        </span>
        <span className="text-sm text-muted-foreground">
          Cobertura {cobertura.percentual.toFixed(0)}% ·{" "}
          <span className="tabular-nums">
            {cobertura.apurados}/{cobertura.aplicaveis}
          </span>{" "}
          componentes
        </span>
        <div className="flex-1 min-w-0 h-1.5 rounded-full bg-muted overflow-hidden max-w-xs">
          <div
            className="h-full bg-foreground/60"
            style={{ width: `${cobertura.percentual}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0 ml-auto">
          {aberta ? "ocultar" : "ver componentes"}
        </span>
      </button>

      {aberta && (
        <div className="border-t px-5 py-4 space-y-3">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {cobertura.itens.map((item) => (
              <li key={item.code} className="flex items-baseline gap-2 text-sm">
                {item.apurado ? (
                  <CircleCheck className="w-3.5 h-3.5 shrink-0 self-center text-emerald-600 dark:text-emerald-500" />
                ) : item.essencial ? (
                  <CircleAlert className="w-3.5 h-3.5 shrink-0 self-center text-amber-600 dark:text-amber-500" />
                ) : (
                  <CircleMinus className="w-3.5 h-3.5 shrink-0 self-center text-muted-foreground/50" />
                )}
                <span className={cn("min-w-0 truncate", !item.apurado && "text-muted-foreground")}>
                  {item.titulo}
                </span>
                {!item.apurado && item.rotulo && (
                  <span className="text-[0.6875rem] text-muted-foreground ml-auto shrink-0">
                    {item.rotulo}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground border-t pt-3 max-w-4xl leading-relaxed">
            <span className="font-medium text-foreground">Como a cobertura é medida. </span>
            {cobertura.metodo}
          </p>
        </div>
      )}
    </div>
  );
}
