import { Link } from "wouter";
import { ArrowRight, Coins, TrendingDown, TrendingUp } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  escreverImpacto,
  type DetalheDaFamilia,
  type LinhaDaFamilia,
} from "@/lib/visao-geral";
import { paramsDoRecorte, RECORTE_VAZIO, type Recorte } from "@/lib/recorte";

/**
 * O que a família ganhou e o que ela perdeu — o painel que o pódio abre.
 *
 * Os Maiores impactos do Dashboard afirmavam "Aquisição e financiamento:
 * R$ 21.905/mês" e paravam aí, num verde inteiro. O cartão de Perdas mensais,
 * dois palmos acima na mesma tela, dizia "−R$ 4.652" — e não havia caminho
 * nenhum entre as duas frases: a perda estava *dentro* daquela família, escondida
 * pela subtração que produziu o líquido.
 *
 * Este painel é esse caminho, e ele abre **sobre** a tela para não perder o pódio
 * de vista: a linha continua atrás, e o painel é a conta dela. A ordem das seções
 * é a ordem em que a desconfiança chega:
 *
 * 1. **O líquido**, escrito de novo com a periodicidade colada, e os dois lados
 *    que o formam logo abaixo — para que "R$ 21.905" e "−R$ 4.652" apareçam na
 *    mesma frase em vez de em duas telas.
 * 2. **O que somou** e **o que tirou**, parâmetro a parâmetro, cada lista
 *    fechando exatamente com o total do seu lado.
 * 3. **As outras periodicidades** da mesma família, em linha própria — R$/mês e
 *    R$/ano não somam, aqui nem em lugar nenhum do produto.
 *
 * Nada aqui pede dado novo ao servidor: tudo sai da mesma resposta que desenhou
 * o pódio (`ExecutiveSummary.sides`). Dois pedidos seriam duas vigências
 * possíveis, e duas vigências é exatamente como o número do painel deixaria de
 * bater com o número de cima.
 */
export function DetalheDaFamilia({
  detalhe,
  period,
  periodLabel,
  recorte = RECORTE_VAZIO,
  onFechar,
}: {
  detalhe: DetalheDaFamilia | null;
  /** A vigência aberta — `null` na Visão Geral, que não tem uma unidade a quem perguntar. */
  period: string | null;
  periodLabel: string | null;
  recorte?: Recorte;
  onFechar: () => void;
}) {
  if (!detalhe) return null;

  const { familia, periodicity } = detalhe;
  const negativo = familia.liquido < 0;

  /*
    A porta para Parâmetros só existe quando a tela sabe de que unidade está
    falando.

    Parâmetros recorta por unidade, e um endereço sem `scopeHash` cai em
    `contexts[0]`: o botão prometeria "os parâmetros desta família" e entregaria
    os de uma unidade só, debaixo de um painel que somou todas. É a mesma recusa
    do rodapé dos Maiores impactos na Visão geral.
  */
  const consultaDeParametros =
    recorte.scopeHash === null || period === null
      ? null
      : paramsDoRecorte({ ...recorte, period });

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {periodLabel ?? "Esta vigência"} · em R${periodicitySuffix(periodicity)}
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
            {familia.name}
          </SheetTitle>

          <p
            className={cn(
              "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
              negativo ? "text-red-700" : "text-emerald-700",
            )}
          >
            {formatBrlShort(familia.liquido)}
            <span className="text-base font-semibold text-muted-foreground">
              {periodicitySuffix(periodicity)}
            </span>
            <span className="ml-2 text-sm font-bold uppercase tracking-wide">
              {negativo ? "desfavorável" : "favorável"}
            </span>
          </p>

          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            O líquido é a diferença entre os dois lados, e não um dos dois: nesta família,{" "}
            <strong className="text-emerald-700">
              {escreverImpacto({ periodicity, amount: familia.ganhos })}
            </strong>{" "}
            somaram e{" "}
            <strong className="text-red-700">
              {escreverImpacto({ periodicity, amount: familia.perdas })}
            </strong>{" "}
            saíram, em {contar(familia.alteracoes, "alteração com preço", "alterações com preço")}.
          </SheetDescription>

          <Balanca familia={familia} />
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          <LadoDaFamilia
            titulo="O que somou"
            icone={TrendingUp}
            total={familia.ganhos}
            linhas={familia.parametros.ganhos}
            periodicity={periodicity}
            vazio="Nenhum parâmetro desta família somou nesta periodicidade."
          />
          <LadoDaFamilia
            titulo="O que tirou"
            icone={TrendingDown}
            total={familia.perdas}
            linhas={familia.parametros.perdas}
            periodicity={periodicity}
            vazio="Nenhum parâmetro desta família tirou nesta periodicidade."
          />

          {detalhe.outras.length > 0 && (
            <section className="border-t pt-6">
              <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
                <Coins className="w-4 h-4 text-muted-foreground" />
                Esta família também mexeu em
              </h3>
              <ul className="mt-3 space-y-2">
                {detalhe.outras.map((outra) => (
                  <li
                    key={outra.periodicity}
                    className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm"
                  >
                    <span className="font-semibold">R${periodicitySuffix(outra.periodicity)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <strong className="text-emerald-700">
                        {escreverImpacto({
                          periodicity: outra.periodicity,
                          amount: outra.ganhos,
                        })}
                      </strong>{" "}
                      e{" "}
                      <strong className="text-red-700">
                        {escreverImpacto({
                          periodicity: outra.periodicity,
                          amount: outra.perdas,
                        })}
                      </strong>{" "}
                      ={" "}
                      <strong className={outra.liquido < 0 ? "text-red-700" : "text-emerald-700"}>
                        {escreverImpacto({
                          periodicity: outra.periodicity,
                          amount: outra.liquido,
                        })}
                      </strong>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs text-muted-foreground">
                Em linha própria porque não se somam com o número de cima — a conversão entre
                periodicidades este produto se recusa a fazer no escuro.
              </p>
            </section>
          )}

          {consultaDeParametros && (
            <section className="flex flex-wrap gap-3 border-t pt-6">
              <Link
                href={`/parametros?${consultaDeParametros}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
              >
                Abrir em Parâmetros
                <ArrowRight className="w-4 h-4" />
              </Link>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A barra que parte o movimento da família em dois.
 *
 * Mede **movimento**, e não saldo: a fatia verde é `ganhos ÷ (ganhos + |perdas|)`,
 * a mesma conta do cartão de Impacto líquido. Uma barra do saldo diria que a
 * família com R$ 40 mil para cima e R$ 39 mil para baixo é quase toda verde,
 * quando o que aconteceu ali foram dois movimentos grandes em direções opostas.
 */
function Balanca({ familia }: { familia: DetalheDaFamilia["familia"] }) {
  if (familia.fatiaDeGanho === null) return null;
  return (
    <div className="mt-4">
      <span className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted" aria-hidden="true">
        <span
          className="block h-full bg-emerald-600"
          style={{ width: `${familia.fatiaDeGanho * 100}%` }}
        />
        <span
          className="block h-full bg-red-600"
          style={{ width: `${(1 - familia.fatiaDeGanho) * 100}%` }}
        />
      </span>
      <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
        Do que se mexeu nesta família, {Math.round(familia.fatiaDeGanho * 100)}% foi para cima.
      </p>
    </div>
  );
}

/**
 * Um dos dois lados, parâmetro a parâmetro.
 *
 * As barras das duas listas estão na mesma escala — a da própria família —,
 * porque dentro de uma periodicidade a comparação entre um ganho e uma perda é
 * legítima. Uma escala por lado faria a maior perda e o maior ganho terminarem
 * no mesmo lugar, afirmando com a figura que os dois pesam igual.
 *
 * Lista vazia diz isso com palavras, e não com um "R$ 0" que se confundiria com
 * um total apurado.
 */
function LadoDaFamilia({
  titulo,
  icone: Icone,
  total,
  linhas,
  periodicity,
  vazio,
}: {
  titulo: string;
  icone: typeof TrendingUp;
  total: number;
  linhas: LinhaDaFamilia[];
  periodicity: string;
  vazio: string;
}) {
  const negativo = total < 0;
  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          <Icone className={cn("w-4 h-4", negativo ? "text-red-600" : "text-emerald-600")} />
          {titulo}
        </h3>
        <span
          className={cn(
            "text-base font-extrabold tabular-nums",
            negativo ? "text-red-700" : "text-emerald-700",
          )}
        >
          {escreverImpacto({ periodicity, amount: total })}
        </span>
      </div>

      {linhas.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground border rounded-lg px-5 py-4">{vazio}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {linhas.map((linha) => (
            <li key={linha.key} className="flex items-center gap-3">
              <span className="w-44 shrink-0 min-w-0">
                <span className="block text-sm font-semibold truncate" title={linha.name}>
                  {linha.name}
                </span>
                <span className="block text-[0.6875rem] text-muted-foreground">
                  {contar(linha.changes, "alteração", "alterações")} ·{" "}
                  {contar(linha.vehicles, "veículo", "veículos")}
                </span>
              </span>
              <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8 rounded-sm">
                <span
                  className={cn("block h-full", negativo ? "bg-red-600" : "bg-emerald-600")}
                  style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
                />
              </span>
              <span
                className={cn(
                  "text-sm font-bold tabular-nums shrink-0 text-right w-28",
                  negativo ? "text-red-700" : "text-emerald-700",
                )}
              >
                {escreverImpacto({ periodicity, amount: linha.amount })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
