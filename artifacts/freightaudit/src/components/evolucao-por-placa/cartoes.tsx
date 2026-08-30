import {
  AlertTriangle,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  vocabularioDoGrao,
  type EvolucaoPorPlaca,
  type InsightDaEvolucao,
} from "@/lib/evolucao-por-placa";

/**
 * A faixa executiva e o bloco de atenção — os dois blocos do topo.
 *
 * Os cinco cartões respondem "quanto disto é meu problema" em cinco números que
 * **fecham entre si**: `analisadas = comPerda + comGanho + sem saldo apurado`, e
 * `líquido = ganho + perda`. Nenhum deles é somado aqui; todos chegam prontos do
 * servidor, que é onde a autoridade financeira mora.
 *
 * O bloco de atenção transforma esses números em prioridades. Cada frase é
 * derivada dos dados (ver `insightsDaEvolucao`, no domínio) e **clicável**: o
 * clique recorta a matriz para exatamente as placas que a frase conta — o
 * número e a lista são o mesmo conjunto, e não duas contas que precisam
 * concordar.
 */

export function CartoesDaEvolucao({ evolucao }: { evolucao: EvolucaoPorPlaca }) {
  const { totais } = evolucao;
  const sufixo = periodicitySuffix(evolucao.periodicidade);
  const vocabulario = vocabularioDoGrao(evolucao.grao);
  const daFrota =
    totais.frota > 0 ? Math.round((totais.ativos / totais.frota) * 100) : null;
  const Titulo = (texto: string) =>
    `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Cartao
        icon={Truck}
        tom="neutro"
        titulo={`${Titulo(vocabulario.plural)} analisad${evolucao.grao === "CONJUNTO" ? "os" : "as"}`}
        valor={totais.ativos.toLocaleString("pt-BR")}
        nota={
          daFrota === null
            ? `${totais.alteracoes.toLocaleString("pt-BR")} alterações`
            : `${daFrota}% ${vocabulario.universo}`
        }
        dica={`${totais.ativos} ${vocabulario.plural} tiveram ao menos uma alteração entre ${evolucao.fromLabel} e ${evolucao.toLabel}. O período tem ${totais.frota} ${vocabulario.plural} no total — a diferença são os que não mudaram, e não os que sumiram.`}
      />
      <Cartao
        icon={TrendingDown}
        tom="perda"
        titulo={`${Titulo(vocabulario.plural)} com perda`}
        valor={totais.comPerda.toLocaleString("pt-BR")}
        nota={`${formatBrlShort(totais.perda)}${sufixo}`}
        dica={`${Titulo(vocabulario.plural)} cujo impacto acumulado no período é negativo. O valor ao lado é a soma de tudo que reduziu a remuneração — nunca compensado com o que somou.`}
      />
      <Cartao
        icon={TrendingUp}
        tom="ganho"
        titulo={`${Titulo(vocabulario.plural)} com ganho`}
        valor={totais.comGanho.toLocaleString("pt-BR")}
        nota={`+${formatBrlShort(totais.ganho)}${sufixo}`}
        dica={`${Titulo(vocabulario.plural)} cujo impacto acumulado no período é positivo, e a soma de tudo que somou.`}
      />
      <Cartao
        icon={AlertTriangle}
        tom="pendencia"
        titulo="Sem valoração"
        valor={totais.comPendencia.toLocaleString("pt-BR")}
        nota={`${totais.alteracoesSemValoracao.toLocaleString("pt-BR")} ${
          totais.alteracoesSemValoracao === 1 ? "alteração" : "alterações"
        }`}
        dica={`${Titulo(vocabulario.plural)} com ao menos uma alteração cujo impacto financeiro ainda não pôde ser apurado. Elas não valem R$ 0 — valem um número que ainda não sabemos, e por isso ficam fora das somas acima.`}
      />
      <Cartao
        icon={Sparkles}
        tom={totais.liquido < 0 ? "perda" : "ganho"}
        titulo="Impacto líquido atual"
        valor={`${totais.liquido > 0 ? "+" : ""}${formatBrlShort(totais.liquido)}`}
        nota={`por ${evolucao.periodicidade.toLowerCase() === "mensal" ? "mês" : evolucao.periodicidade.toLowerCase()}`}
        destaque
        dica={`Ganhos e perdas do período somados, na mesma apuração que a Linha do Tempo publica para ${evolucao.fromLabel} → ${evolucao.toLabel}. R$/mês e R$/ano nunca são somados entre si: esta faixa fala de uma grandeza de cada vez.`}
      />
    </div>
  );
}

const TOM_DO_CARTAO = {
  neutro: "bg-primary/10 text-primary",
  perda: "bg-red-50 text-red-600",
  ganho: "bg-emerald-50 text-emerald-600",
  pendencia: "bg-amber-50 text-amber-600",
} as const;

function Cartao({
  icon: Icon,
  tom,
  titulo,
  valor,
  nota,
  dica,
  destaque,
}: {
  icon: LucideIcon;
  tom: keyof typeof TOM_DO_CARTAO;
  titulo: string;
  valor: string;
  nota: string;
  dica: string;
  destaque?: boolean;
}) {
  return (
    <div
      title={dica}
      className={cn(
        "bg-card border rounded-xl shadow-sm px-4 py-3",
        destaque && "border-primary/40 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("rounded-lg p-1.5 shrink-0", TOM_DO_CARTAO[tom])}>
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground leading-tight">
          {titulo}
        </span>
      </div>
      <p
        className={cn(
          "mt-1.5 text-2xl font-bold tabular-nums leading-none",
          tom === "perda" && "text-red-700",
          tom === "ganho" && "text-emerald-700",
          tom === "pendencia" && "text-amber-700",
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-muted-foreground tabular-nums">{nota}</p>
    </div>
  );
}

const TOM_DO_INSIGHT = {
  PERDA: {
    caixa: "border-red-200 bg-red-50/70 hover:bg-red-50",
    icone: "bg-red-100 text-red-600",
  },
  PENDENCIA: {
    caixa: "border-amber-200 bg-amber-50/70 hover:bg-amber-50",
    icone: "bg-amber-100 text-amber-600",
  },
  NEUTRO: {
    caixa: "border-indigo-200 bg-indigo-50/70 hover:bg-indigo-50",
    icone: "bg-indigo-100 text-indigo-600",
  },
} as const;

const ICONE_DO_INSIGHT: Record<InsightDaEvolucao["chave"], string> = {
  PIORA_CONSECUTIVA: "↘",
  CONCENTRACAO_DA_PERDA: "◑",
  SEM_VALORACAO: "⚠",
  RUBRICA_REPETIDA: "⟳",
};

export function AtencaoDaEvolucao({
  insights,
  ativo,
  grao,
  onEscolher,
}: {
  insights: InsightDaEvolucao[];
  /** A chave do insight recortando a matriz agora, quando há um. */
  ativo: InsightDaEvolucao["chave"] | null;
  grao: EvolucaoPorPlaca["grao"];
  onEscolher: (insight: InsightDaEvolucao | null) => void;
}) {
  if (insights.length === 0) return null;

  return (
    <section className="bg-card border rounded-xl shadow-sm p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="text-base font-bold leading-tight">O que merece sua atenção</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          Clique num item para ver só {vocabularioDoGrao(grao).plural === "conjuntos" ? "esses conjuntos" : "essas placas"} na matriz.
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {insights.map((insight) => {
          const selecionado = ativo === insight.chave;
          return (
            <button
              key={insight.chave}
              onClick={() => onEscolher(selecionado ? null : insight)}
              aria-pressed={selecionado}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                TOM_DO_INSIGHT[insight.tom].caixa,
                selecionado && "ring-2 ring-primary/40",
              )}
            >
              <span
                className={cn(
                  "rounded-full w-7 h-7 shrink-0 grid place-items-center text-sm",
                  TOM_DO_INSIGHT[insight.tom].icone,
                )}
                aria-hidden
              >
                {ICONE_DO_INSIGHT[insight.chave]}
              </span>
              <span className="text-sm leading-snug">{insight.texto}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
