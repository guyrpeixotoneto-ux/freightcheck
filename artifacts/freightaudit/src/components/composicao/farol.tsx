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
 * A cor de um delta de remuneração — a regra, escrita uma vez só.
 *
 * **Verde para alta e vermelho para baixa, porque a remuneração apurada é
 * receita nossa e não custo nosso.** A autoridade é o plano da DRE: as fontes
 * `receita.remuneracao_fixa`, `receita.remuneracao_variavel` e
 * `receita.adicionais` fecham a seção `RECEITA_BRUTA`, cuja nota é "o que a
 * Ambev paga por este equipamento nesta vigência" (`lib/dre/src/plano.ts`). O
 * vocabulário de `@workspace/knowledge` diz o mesmo em palavras — cada
 * alteração "aumenta a nossa remuneração" ou "reduz a nossa remuneração" — e é
 * dele que a aba Cliente tira o que propor ao cliente. Pintar de vermelho a
 * vigência que nos paga mais ensinaria a temer a boa notícia.
 *
 * Esta era a única leitura invertida do produto: a matriz de quinzenas, a
 * composição do impacto, os grupos da vigência e a planilha exportada já
 * pintavam de verde o que subiu e de vermelho o que caiu — a mesma regra que o
 * `replit.md` registra para o export.
 *
 * **E ela é função porque vivia em dois lugares.** Eram duas redações do mesmo
 * `? :`, uma aqui e outra no card da frota, e foi por isso que a inversão
 * sobreviveu: consertar uma deixaria a outra dizendo o contrário na tela ao
 * lado. Agora os dois leitores importam a mesma decisão, e ela tem teste.
 */
export function tomDaVariacao(delta: number): string {
  if (delta === 0) return "text-muted-foreground";
  return delta > 0 ? "text-emerald-600" : "text-brand-red";
}

/** A variação, com sinal explícito e a cor de {@link tomDaVariacao}. */
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
    <span className={cn("tabular-nums", tomDaVariacao(variacao.absoluta), className)}>
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
