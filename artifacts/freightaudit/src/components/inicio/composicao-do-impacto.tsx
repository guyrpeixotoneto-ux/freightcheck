import { Link } from "wouter";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleSlash,
  Layers,
  Scale,
  TriangleAlert,
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
  type ComposicaoDoImpacto as Composicao,
  type Lado,
  type LadoDetalhado,
} from "@/lib/visao-geral";
import {
  linkDeAlteracoes,
  paramsDoRecorte,
  RECORTE_VAZIO,
  type Recorte,
} from "@/lib/recorte";

/**
 * A balança da vigência — o painel que o cartão de Impacto líquido abre.
 *
 * O cartão publicava uma subtração e parava aí. Medido em CAMAÇARI · EMPURRADA,
 * agosto/2026: o cartão dizia "R$ 11.917/mês, favorável", e o que aconteceu foi
 * **R$ 21.764 entrando enquanto R$ 9.847 saíam**. As duas frases descrevem a
 * mesma vigência, e só a segunda explica por que houve reunião. Quem precisava
 * dela tinha de sair da tela, abrir Parâmetros e reconstruir os dois lados
 * somando cartão por cartão, na mão, com o risco de chegar noutro recorte.
 *
 * Este painel é essa leitura, e ele abre **sobre** a tela pela mesma razão que
 * os outros dois desta pasta: o número continua atrás, e o painel é a conta
 * dele.
 *
 * A ordem das seções é a ordem em que a pergunta chega:
 *
 * 1. **A balança** — o líquido, os dois lados que o formam e a barra que mostra
 *    a proporção entre eles.
 * 2. **O lado que foi clicado**, parâmetro a parâmetro, o maior primeiro. Cada
 *    linha abre a própria conta em `DetalheDoImpacto`.
 * 3. **O outro lado**, do mesmo jeito. Os dois aparecem sempre, mesmo quando um
 *    está vazio: "nenhuma perda apurada" é uma afirmação sobre a vigência, e
 *    esconder a seção faria o painel parecer a lista de um lado só.
 * 4. **O que não está nesta balança** — o sem preço, o excluído por dupla
 *    contagem e as outras periodicidades. É a seção que impede a soma dos dois
 *    lados de ser lida como a vigência inteira.
 *
 * Duas recusas que valem aqui como valem no resto do produto:
 *
 * - **Periodicidade nunca soma.** A balança é de uma periodicidade só, escrita
 *   no topo. As outras aparecem como troca de assunto, cada uma abrindo a sua.
 * - **Lista vazia não vira zero.** Um lado sem parâmetro nenhum diz isso com
 *   palavras, e não com um "R$ 0" que se confundiria com um total apurado.
 */
export function ComposicaoDoImpacto({
  composicao,
  periodLabel,
  recorte = RECORTE_VAZIO,
  onAbrirParametro,
  onTrocarPeriodicidade,
  onFechar,
}: {
  composicao: Composicao | null;
  periodLabel: string | null;
  recorte?: Recorte;
  /** Abre a conta de um parâmetro. Ver `DetalheDoImpacto`. */
  onAbrirParametro: (key: string, periodicity: string) => void;
  /** Troca a balança de periodicidade — nunca soma duas. */
  onTrocarPeriodicidade: (periodicity: string) => void;
  onFechar: () => void;
}) {
  if (!composicao) return null;

  const negativo = composicao.liquido < 0;
  const primeiro =
    composicao.primeiro === "perdas" ? composicao.perdas : composicao.ganhos;
  const segundo =
    composicao.primeiro === "perdas" ? composicao.ganhos : composicao.perdas;

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col gap-0">
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {periodLabel ?? "Esta vigência"} · em R$
            {periodicitySuffix(composicao.periodicity)}
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
            O que somou e o que subtraiu
          </SheetTitle>

          <p
            className={cn(
              "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
              negativo ? "text-red-700" : "text-emerald-700",
            )}
          >
            {formatBrlShort(composicao.liquido)}
            <span className="text-base font-semibold text-muted-foreground">
              {periodicitySuffix(composicao.periodicity)}
            </span>
            <span className="ml-2 text-sm font-bold uppercase tracking-wide">
              {negativo ? "desfavorável" : "favorável"}
            </span>
          </p>

          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            O líquido é a diferença entre os dois lados abaixo, e não um dos dois: nesta
            periodicidade,{" "}
            <strong className="text-emerald-700">
              {escreverImpacto({
                periodicity: composicao.periodicity,
                amount: composicao.ganhos.total,
              })}
            </strong>{" "}
            somaram à remuneração e{" "}
            <strong className="text-red-700">
              {escreverImpacto({
                periodicity: composicao.periodicity,
                amount: composicao.perdas.total,
              })}
            </strong>{" "}
            saíram dela.
          </SheetDescription>

          <Balanca composicao={composicao} />
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          <ListaDoLado
            lado={primeiro}
            composicao={composicao}
            onAbrirParametro={onAbrirParametro}
          />
          <ListaDoLado
            lado={segundo}
            composicao={composicao}
            separada
            onAbrirParametro={onAbrirParametro}
          />

          <ForaDaBalanca
            composicao={composicao}
            recorte={recorte}
            onTrocarPeriodicidade={onTrocarPeriodicidade}
          />

          <section className="flex flex-wrap gap-3 border-t pt-6">
            <Link
              href={linkDeAlteracoes({
                recorte,
                filtros: { impactConfidence: "CALCULATED" },
              })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
            >
              Ver as alterações que somam nestes valores
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href={`/parametros?${paramsDoRecorte(recorte)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-5 py-2.5 text-sm font-bold hover:bg-accent transition-colors"
            >
              Abrir em Parâmetros
              <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// A balança
// ---------------------------------------------------------------------------

/**
 * A barra dos dois lados — verde à esquerda, vermelho à direita.
 *
 * Ela mede **movimento**, e não saldo: a fatia verde é `ganhos ÷ (ganhos +
 * |perdas|)`. É a única figura do painel, e o que ela responde é "quanto do
 * dinheiro que se mexeu foi para cima" — a pergunta que o líquido sozinho não
 * responde. Sem movimento nenhum a barra não é desenhada: meia barra cinza
 * seria a figura de um empate que não aconteceu.
 */
function Balanca({ composicao }: { composicao: Composicao }) {
  if (composicao.fatiaDeGanho === null) return null;
  const verde = Math.max(0, Math.min(1, composicao.fatiaDeGanho)) * 100;

  return (
    <div className="mt-5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-emerald-600" style={{ width: `${verde}%` }} />
        <div className="h-full bg-red-600" style={{ width: `${100 - verde}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs font-semibold">
        <span className="flex items-center gap-1.5 text-emerald-700">
          <ArrowUpRight className="w-3.5 h-3.5" />
          {contar(composicao.ganhos.alteracoes, "alteração somou", "alterações somaram")} em{" "}
          {contar(composicao.ganhos.veiculos, "ativo", "ativos")}
        </span>
        <span className="flex items-center gap-1.5 text-red-700">
          {contar(composicao.perdas.alteracoes, "alteração tirou", "alterações tiraram")} em{" "}
          {contar(composicao.perdas.veiculos, "ativo", "ativos")}
          <ArrowDownRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Um lado, parâmetro a parâmetro
// ---------------------------------------------------------------------------

const TITULO_DO_LADO: Record<Lado, string> = {
  ganhos: "O que somou",
  perdas: "O que subtraiu",
};

/**
 * A lista de um lado — um parâmetro por linha, o maior em módulo primeiro.
 *
 * A linha inteira é o botão, e não uma seta no fim dela: o que se quer clicar
 * aqui é o número, e um alvo de dezesseis pixels na borda obrigaria a mirar
 * para fazer a pergunta mais óbvia do painel.
 *
 * O `changes` de cada linha conta **as alterações daquele lado**, e não as do
 * parâmetro: um parâmetro que subiu em oito ativos e caiu em dois aparece nas
 * duas listas, com o número de cada uma. É por isso que a soma dos dois lados
 * pode passar do total de alterações com preço do parâmetro — cada linha está
 * contada uma vez só, no lado a que ela pertence.
 */
function ListaDoLado({
  lado,
  composicao,
  separada,
  onAbrirParametro,
}: {
  lado: LadoDetalhado;
  composicao: Composicao;
  separada?: boolean;
  onAbrirParametro: (key: string, periodicity: string) => void;
}) {
  const ganho = lado.lado === "ganhos";

  return (
    <section className={cn(separada && "border-t pt-6")}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
          {ganho ? (
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          ) : (
            <ArrowDownRight className="w-4 h-4 text-red-600" />
          )}
          {TITULO_DO_LADO[lado.lado]}
        </h3>
        <span
          className={cn(
            "text-lg font-extrabold tabular-nums",
            // Zero de um lado é medição, e não ausência de medição — o número
            // fica, em cinza, porque o que ele diz é "nada veio por aqui", e
            // não "não sabemos".
            lado.total === 0
              ? "text-muted-foreground"
              : ganho
                ? "text-emerald-700"
                : "text-red-700",
          )}
        >
          {escreverImpacto({ periodicity: composicao.periodicity, amount: lado.total })}
        </span>
      </div>

      {lado.linhas.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground border rounded-lg px-5 py-4">
          {ganho
            ? "Nenhum ganho apurado nesta periodicidade — nenhuma alteração com preço aumentou a remuneração."
            : "Nenhuma perda apurada nesta periodicidade — nenhuma alteração com preço reduziu a remuneração."}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mt-1.5">
            {contar(lado.linhas.length, "parâmetro", "parâmetros")}, com{" "}
            {contar(lado.alteracoes, "alteração", "alterações")} em{" "}
            {contar(lado.veiculos, "ativo", "ativos")}. O total acima é a soma destas
            linhas — a lista é o lado inteiro, e não um recorte dos maiores.
          </p>

          <ol className="mt-4 space-y-3">
            {lado.linhas.map((linha) => (
              <li key={linha.key}>
                <button
                  type="button"
                  onClick={() => onAbrirParametro(linha.key, composicao.periodicity)}
                  title={`De onde vem o impacto de ${linha.name}`}
                  className="w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors group"
                >
                  <span className="flex-1 min-w-0">
                    <span
                      className="block text-sm font-semibold truncate group-hover:underline"
                      title={linha.name}
                    >
                      {linha.name}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {linha.familyName} ·{" "}
                      {contar(linha.changes, "alteração", "alterações")} em{" "}
                      {contar(linha.vehicles, "ativo", "ativos")}
                    </span>
                    {/*
                      O mesmo parâmetro nos dois lados, dito na própria linha.

                      Sem isto, clicar em "+R$ 17.086 Financiamento" abriria um
                      painel escrito "R$ 14.939" e a diferença ficaria por conta
                      de quem lê. A linha diz as duas coisas antes do clique: o
                      que este lado tem, e qual é o saldo que o painel abre.
                    */}
                    {linha.noOutroLado !== null && (
                      <span className="block text-[0.6875rem] text-muted-foreground truncate">
                        também{" "}
                        <span className={ganho ? "text-red-700" : "text-emerald-700"}>
                          {ganho ? "tirou" : "somou"}{" "}
                          {formatBrlShort(Math.abs(linha.noOutroLado))}
                        </span>{" "}
                        · saldo{" "}
                        {escreverImpacto({
                          periodicity: composicao.periodicity,
                          amount: linha.liquido,
                        })}
                      </span>
                    )}
                  </span>
                  <span className="w-28 sm:w-40 shrink-0 h-2.5 bg-muted overflow-hidden rounded-full">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        ganho ? "bg-emerald-600" : "bg-red-600",
                      )}
                      style={{ width: `${Math.max(2, linha.proporcao * 100)}%` }}
                    />
                  </span>
                  {/*
                    `whitespace-nowrap` e largura folgada: "-R$ 598.630/ano" não
                    cabia em `w-28` e quebrava depois do sinal, deixando um "−"
                    sozinho numa linha e o valor na outra — que se lê como dois
                    números, e é o erro mais caro que uma formatação de dinheiro
                    pode cometer.
                  */}
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums shrink-0 text-right w-36 whitespace-nowrap",
                      ganho ? "text-emerald-700" : "text-red-700",
                    )}
                  >
                    {escreverImpacto({
                      periodicity: composicao.periodicity,
                      amount: linha.amount,
                    })}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O que não está na balança
// ---------------------------------------------------------------------------

/**
 * As três coisas que os dois lados não contêm — e a razão de cada uma.
 *
 * A seção some inteira quando não há nenhuma delas, e isso é uma afirmação e
 * não um vazio: quer dizer que toda alteração da vigência tem preço, nenhuma
 * saiu por dupla contagem, e não há outra periodicidade escondida. Um "0" em
 * três linhas diria o mesmo gastando a tela e ensinando a não ler a seção.
 */
function ForaDaBalanca({
  composicao,
  recorte,
  onTrocarPeriodicidade,
}: {
  composicao: Composicao;
  recorte: Recorte;
  onTrocarPeriodicidade: (periodicity: string) => void;
}) {
  const excluido = composicao.excluido.alteracoes > 0;
  if (composicao.semPreco === 0 && !excluido && composicao.outras.length === 0) return null;

  return (
    <section className="border-t pt-6">
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <CircleSlash className="w-4 h-4 text-muted-foreground" />
        O que não está nesta balança
      </h3>

      <ul className="mt-3.5 space-y-3.5">
        {composicao.semPreco > 0 && (
          <li className="flex gap-3 text-sm">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
            <p>
              <strong>
                {contar(composicao.semPreco, "alteração", "alterações")} sem preço.
              </strong>{" "}
              Mudaram, mas não há semântica confirmada que as transforme em dinheiro — elas
              não estão em lado nenhum, e impacto que não foi apurado não vira zero na soma.{" "}
              <Link
                href={linkDeAlteracoes({
                  recorte,
                  filtros: { impactConfidence: "NOT_CALCULABLE" },
                })}
                className="font-semibold text-brand hover:underline"
              >
                Ver quais
              </Link>
              .
            </p>
          </li>
        )}

        {excluido && (
          <li className="flex gap-3 text-sm">
            <Layers className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <p>
              <strong>
                {contar(composicao.excluido.alteracoes, "alteração", "alterações")} fora, por
                já estarem contadas nas parcelas
              </strong>
              {composicao.excluido.valor !== null && (
                <>
                  {" "}
                  (
                  {escreverImpacto({
                    periodicity: composicao.periodicity,
                    amount: composicao.excluido.valor,
                  })}
                  )
                </>
              )}
              . O total mudou porque as suas partes mudaram; somar os dois lados contaria o
              mesmo dinheiro duas vezes.
            </p>
          </li>
        )}

        {composicao.outras.length > 0 && (
          <li className="flex gap-3 text-sm">
            <Scale className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div>
              <p>
                <strong>
                  Esta vigência também tem impacto em{" "}
                  {composicao.outras.length === 1
                    ? "outra periodicidade"
                    : `outras ${composicao.outras.length} periodicidades`}
                  .
                </strong>{" "}
                Cada uma é uma grandeza própria e tem a sua própria balança — R$/mês e R$/ano
                não somam, aqui nem em lugar nenhum do produto.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {composicao.outras.map((outra) => (
                  <button
                    key={outra.periodicity}
                    type="button"
                    onClick={() => onTrocarPeriodicidade(outra.periodicity)}
                    className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold hover:bg-accent transition-colors"
                  >
                    <span className="tabular-nums">
                      {escreverImpacto({
                        periodicity: outra.periodicity,
                        amount: outra.liquido,
                      })}
                    </span>
                    <span className="text-emerald-700 tabular-nums">
                      +{formatBrlShort(outra.ganhos)}
                    </span>
                    <span className="text-red-700 tabular-nums">
                      {formatBrlShort(outra.perdas)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          </li>
        )}
      </ul>
    </section>
  );
}

/** `3 parâmetros`, `1 parâmetro` — o número por extenso com a palavra que ele rege. */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
