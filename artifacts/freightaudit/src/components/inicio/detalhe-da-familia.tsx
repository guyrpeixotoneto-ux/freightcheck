import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Coins,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
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
  type Lado,
  type LinhaDaFamilia,
} from "@/lib/visao-geral";
import { paramsDoRecorte, RECORTE_VAZIO, type Recorte } from "@/lib/recorte";
import { DrillDoParametro } from "@/components/inicio/drill-do-parametro";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";

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
 * Cada parâmetro das duas listas abre por dentro, em mais dois degraus: **por
 * unidade** e, dentro de uma unidade, **placa a placa, antes e depois** (ver
 * `DrillDoParametro`). Era onde a leitura terminava antes: a soma dizia
 * "Financiamento tirou R$ 76.318" e quem lia tinha de sair da tela para
 * descobrir de qual unidade e de qual caminhão aquilo veio — e chegar lá noutro
 * recorte, com outro número.
 *
 * Nada do painel em si pede dado novo ao servidor: os dois lados, o líquido e
 * as outras periodicidades saem todos da mesma resposta que desenhou o pódio
 * (`ExecutiveSummary.sides`) — e o degrau por unidade também, porque cada
 * unidade da Visão Geral já viaja com o seu resumo dentro dela. Dois pedidos
 * seriam duas vigências possíveis, e duas vigências é exatamente como o número
 * do painel deixaria de bater com o número de cima.
 *
 * O único que pede é o degrau mais fundo, o das placas: a árvore de parâmetros
 * e a tabela de veículos só existem **dentro de um contexto**, e ele pergunta
 * unidade por unidade, com o `scopeHash` de cada uma — nunca sobre a soma. Por
 * isso ele fecha a sua conta com o número da unidade que o abriu, e diz a
 * diferença quando não fecha.
 */
export function DetalheDaFamilia({
  detalhe,
  period,
  periodLabel,
  recorte = RECORTE_VAZIO,
  unidades = [],
  vigencia = null,
  onFechar,
}: {
  detalhe: DetalheDaFamilia | null;
  /** A vigência aberta — `null` na Visão Geral, que não tem uma unidade a quem perguntar. */
  period: string | null;
  periodLabel: string | null;
  recorte?: Recorte;
  /**
   * As unidades por trás destes números — uma só dentro de uma unidade, todas
   * as consolidadas na Visão Geral.
   *
   * É o que faz o parâmetro abrir por dentro. Vazia, as listas continuam
   * exatamente como eram: linhas de leitura, sem clique nenhum — nunca um
   * clique que abre um painel vazio.
   */
  unidades?: UnidadeDoDrill[];
  /**
   * A competência aberta — a mesma nas duas leituras.
   *
   * Vem separada de `period` de propósito: `period` é a vigência de **uma
   * unidade**, e é `null` na Visão Geral justamente para a porta de Parâmetros
   * não prometer "esta família" e entregar a de `contexts[0]`. O degrau por
   * placa não tem esse problema — ele pergunta unidade por unidade, com o
   * `scopeHash` de cada uma —, e o que ele precisa é da competência.
   */
  vigencia?: string | null;
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
            lado="ganhos"
            total={familia.ganhos}
            linhas={familia.parametros.ganhos}
            periodicity={periodicity}
            unidades={unidades}
            vigencia={vigencia}
            vazio="Nenhum parâmetro desta família somou nesta periodicidade."
          />
          <LadoDaFamilia
            titulo="O que tirou"
            icone={TrendingDown}
            lado="perdas"
            total={familia.perdas}
            linhas={familia.parametros.perdas}
            periodicity={periodicity}
            unidades={unidades}
            vigencia={vigencia}
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
 *
 * Cada linha é a porta do degrau seguinte: clicar abre o parâmetro por unidade
 * e, dentro de cada unidade, placa a placa com o antes e o depois. A linha só
 * vira botão quando há unidade a abrir — uma linha que parece clicável e não
 * abre nada é pior do que uma que não parece.
 */
function LadoDaFamilia({
  titulo,
  icone: Icone,
  lado,
  total,
  linhas,
  periodicity,
  unidades,
  vigencia,
  vazio,
}: {
  titulo: string;
  icone: typeof TrendingUp;
  lado: Lado;
  total: number;
  linhas: LinhaDaFamilia[];
  periodicity: string;
  unidades: UnidadeDoDrill[];
  vigencia: string | null;
  vazio: string;
}) {
  /*
    Um parâmetro aberto por vez, e por lado.

    Dois abertos ao mesmo tempo empilhariam duas tabelas de placas dentro de uma
    gaveta que já tem o líquido, os dois lados e as outras periodicidades — e a
    conta de cima, que é o que dá sentido a tudo aqui, sairia da tela. Estado
    local e não na URL: a família aberta é endereço (`?familia=`), o degrau
    dentro dela é leitura.
  */
  const [abertoKey, setAbertoKey] = useState<string | null>(null);
  const negativo = total < 0;
  // Sem unidade nenhuma não há degrau a abrir, e uma linha que parece clicável
  // e não abre nada é pior do que uma linha que não parece.
  const podeAbrir = unidades.length > 0;

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
          {linhas.map((linha) => {
            const aberto = abertoKey === linha.key;
            const corpo = (
              <>
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
              </>
            );

            return (
              <li key={linha.key}>
                {podeAbrir ? (
                  <button
                    type="button"
                    onClick={() => setAbertoKey((atual) => (atual === linha.key ? null : linha.key))}
                    aria-expanded={aberto}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-md text-left transition-colors -mx-2 px-2 py-1",
                      aberto ? "bg-muted/50" : "hover:bg-muted/40",
                    )}
                    title="Abrir por unidade e, dentro dela, placa a placa"
                  >
                    {aberto ? (
                      <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    {corpo}
                  </button>
                ) : (
                  <span className="flex items-center gap-3">{corpo}</span>
                )}

                {aberto && (
                  <DrillDoParametro
                    parametro={{ key: linha.key, name: linha.name, amount: linha.amount }}
                    lado={lado}
                    periodicity={periodicity}
                    unidades={unidades}
                    period={vigencia}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
