import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os pedaços de tela que as quatro leituras compartilham.
 *
 * Saíram de `pages/alteracoes.tsx` no dia em que Cavalo 360° e Carreta 360°
 * passaram a fazer as mesmas perguntas sobre uma frota recortada: um cartão
 * escrito duas vezes é um cartão que amanhã diz duas coisas, e a régua do
 * impacto — uma linha por periodicidade, nunca uma soma — é justamente a que
 * não pode divergir entre telas.
 *
 * Aqui só mora forma. Nenhum destes componentes busca nada nem decide o que é
 * verdade; quem sabe disso são as abas, e é lá que continuam as decisões.
 */

export function AbaBotao({
  active,
  onClick,
  icon,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-input",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "text-xs tabular-nums rounded-full px-1.5 py-0.5",
            active ? "bg-primary/10 text-primary" : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Reais sem centavos — a régua dos cartões, onde o centavo não decide nada. */
export const brl0 = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const LADRILHO: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-violet-50 text-violet-600",
};

/**
 * Um número do topo: o ícone que o identifica, o nome, o valor, e a ressalva.
 *
 * A ressalva é a linha pequena, e ela não é enfeite: um total de impacto sem
 * "quantas alterações ficaram de fora desta soma" é um número que parece cobrir
 * o arquivo inteiro quando cobre uma parte dele. Toda soma desta tela carrega o
 * seu complemento junto.
 */
export function MetricCard({
  icon,
  tone,
  label,
  value,
  hint,
  valueTone = "muted",
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  /**
   * Um número, ou o que não cabe em um. O impacto da planilha é uma linha por
   * periodicidade, e um cartão que só aceitasse texto obrigaria a escolher uma
   * delas para caber — que é a decisão que este produto não deixa ninguém tomar
   * por descuido.
   */
  value: React.ReactNode;
  hint?: string;
  valueTone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-14 w-14 rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-3xl font-bold tracking-tight tabular-nums mt-1 min-w-0",
            valueTone === "good" && "text-emerald-700",
            valueTone === "bad" && "text-red-600",
            valueTone === "warn" && "text-amber-600",
          )}
        >
          {/* Texto continua cortando com reticências; o que vem montado cuida
              da própria altura. */}
          {typeof value === "string" ? (
            <span className="block truncate">{value}</span>
          ) : (
            value
          )}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Impacto apurado, uma linha por periodicidade.
 *
 * Nunca um número só: R$/mês e R$/ano são grandezas diferentes, e somá-las
 * seria exatamente o erro que este produto existe para pegar. Anualizar as duas
 * numa figura comparável é trabalho de F4, com regras próprias.
 */
export function ImpactoPorPeriodicidade({
  buckets,
}: {
  buckets: Record<string, number>;
}) {
  const entries = Object.entries(buckets);
  if (entries.length === 0) {
    /*
      Em `text-2xl` a frase não cabe no cartão e sai cortada — "não c…", que se
      lê como defeito. Deixá-la no tamanho do texto comum é o que a mantém
      legível, e é a leitura certa: aqui não há número, e um espaço em branco do
      tamanho de um número prometeria que um dia haverá.

      O caso ficou comum com as telas 360°: um ativo sozinho costuma não ter
      alteração com preço apurado, e antes disso a soma vazia era rara o
      bastante para ninguém ter visto o corte.
    */
    return <span className="block text-base text-muted-foreground">não calculável</span>;
  }
  return (
    /*
      `whitespace-nowrap` não é estética. Um sinal de menos que cai sozinho na
      linha de cima transforma "-R$ 594" em algo que se lê como número positivo,
      e este é o cartão em que essa leitura custa dinheiro. É a mesma razão pela
      qual `ImpactCell` o carrega na tabela.

      O tamanho cede antes da quebra: com duas periodicidades cabem duas linhas
      no lugar de uma, e o texto encolhe para que nenhuma delas quebre no meio.
    */
    <div
      className={cn(
        "leading-tight",
        entries.length > 1 ? "text-lg space-y-0.5" : "text-2xl",
      )}
    >
      {entries.map(([periodicity, amount]) => (
        <div key={periodicity} className="flex items-baseline gap-1 whitespace-nowrap">
          <span className={amount < 0 ? "text-red-600" : "text-emerald-700"}>
            {brl0(amount)}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            /{periodicity.toLowerCase()}
          </span>
        </div>
      ))}
    </div>
  );
}

const AVISO: Record<string, { caixa: string; bolha: string; titulo: string }> = {
  red: {
    caixa: "border-red-100 bg-red-50",
    bolha: "bg-red-600 text-white",
    titulo: "text-red-600",
  },
  amber: {
    caixa: "border-amber-100 bg-amber-50",
    bolha: "bg-amber-500 text-white",
    titulo: "text-amber-700",
  },
  sky: {
    caixa: "border-sky-100 bg-sky-50",
    bolha: "bg-sky-500 text-white",
    titulo: "text-sky-700",
  },
};

/** Um problema do arquivo em uma linha: o quê, o quanto, e por onde ver. */
export function Aviso({
  tone,
  icone,
  titulo,
  detalhe,
  acao,
  aberto,
  onClick,
}: {
  tone: keyof typeof AVISO;
  icone?: React.ReactNode;
  titulo: string;
  detalhe: string;
  acao?: string;
  aberto?: boolean;
  onClick?: () => void;
}) {
  const estilo = AVISO[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-5 py-4",
        estilo.caixa,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0",
          estilo.bolha,
        )}
      >
        {icone ?? <AlertTriangle className="w-6 h-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("font-bold", estilo.titulo)}>{titulo}</div>
        <div className="text-sm text-muted-foreground line-clamp-1" title={detalhe}>
          {detalhe}
        </div>
      </div>
      {acao && onClick && (
        <button
          onClick={onClick}
          aria-expanded={aberto}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium shrink-0 hover:underline",
            estilo.titulo,
          )}
        >
          {acao}
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", aberto && "rotate-90")}
          />
        </button>
      )}
    </div>
  );
}

export function TituloDePainel({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
        {icone}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{children}</h3>
    </div>
  );
}
