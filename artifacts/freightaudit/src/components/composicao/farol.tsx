import { cn } from "@/lib/utils";
import { ROTULO_DO_FAROL, type Farol, type Variacao } from "./tipos";
import { formatBrl, formatPercent } from "@/lib/format";

/**
 * O farol, e a variação — os dois sinais que a listagem repete 62 vezes.
 *
 * São componentes minúsculos por um motivo de leitura: numa tabela densa, a
 * consistência entre linhas é o que permite ao olho varrer a coluna em vez de
 * ler célula por célula. Qualquer variação de forma entre uma linha e outra
 * custa uma parada.
 */

const CORES: Record<Farol, string> = {
  NORMAL: "bg-emerald-500",
  ATENCAO: "bg-amber-500",
  CRITICO: "bg-brand-red",
  INCOMPLETO: "bg-muted-foreground/40",
};

/** A bolinha sozinha, para a coluna estreita da tabela. */
export function Bolinha({ farol, titulo }: { farol: Farol; titulo?: string }) {
  return (
    <span
      className={cn("inline-block w-2.5 h-2.5 rounded-full shrink-0", CORES[farol])}
      title={titulo ?? ROTULO_DO_FAROL[farol]}
      aria-label={ROTULO_DO_FAROL[farol]}
    />
  );
}

/** A bolinha com o nome ao lado, para o cabeçalho da ficha. */
export function Farolete({ farol, className }: { farol: Farol; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", className)}>
      <Bolinha farol={farol} />
      {ROTULO_DO_FAROL[farol]}
    </span>
  );
}

/**
 * A variação, com sinal explícito e cor.
 *
 * Vermelho para alta e verde para baixa: esta é uma tela de **custo**, e um
 * aumento de remuneração é uma saída de caixa maior. Pintar de verde o que
 * encarece seria dizer o contrário do que a tela existe para dizer.
 */
export function VariacaoMensal({
  variacao,
  className,
  semSinalNulo,
}: {
  variacao: Variacao | null;
  className?: string;
  /** Mostra "—" em vez de "R$ 0,00" quando nada mudou. */
  semSinalNulo?: boolean;
}) {
  if (variacao === null) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  if (variacao.absoluta === 0 && semSinalNulo) {
    return <span className={cn("text-muted-foreground", className)}>sem mudança</span>;
  }

  const sobe = variacao.absoluta > 0;
  const parado = variacao.absoluta === 0;
  return (
    <span
      className={cn(
        "tabular-nums",
        parado ? "text-muted-foreground" : sobe ? "text-brand-red" : "text-emerald-600",
        className,
      )}
    >
      {!parado && (sobe ? "+" : "−")}
      {formatBrl(Math.abs(variacao.absoluta))}
      {variacao.percentual !== null && !parado && (
        <span className="ml-1.5 text-xs opacity-80">
          {formatPercent(variacao.percentual)}
        </span>
      )}
    </span>
  );
}
