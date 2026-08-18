import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight, CircleSlash, Coins, Layers, TriangleAlert } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { GroupCard } from "@/components/inicio/group-card";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { ligarParametros } from "@/lib/freightech-catalogo";
import { escreverImpacto, type DetalheDeImpacto } from "@/lib/visao-geral";
import {
  linkDeAlteracoes,
  paramsDoRecorte,
  RECORTE_VAZIO,
  type Recorte,
} from "@/lib/recorte";

/**
 * De onde vem o número — o painel que o pódio abre.
 *
 * Os Maiores impactos afirmam "Financiamento: R$ 26.856/mês" e param aí. Um
 * número grande sem caminho de volta até as linhas que o produziram é um número
 * que se leva para a reunião sem poder defender; quem precisava defendê-lo
 * tinha de sair da Visão geral, reencontrar o parâmetro numa grade de sessenta
 * cartões e torcer para chegar lá no mesmo recorte. Este painel é esse caminho,
 * e ele abre **sobre** a tela justamente para não perder o pódio de vista: o
 * número continua atrás, e o painel é a conta dele.
 *
 * A ordem das seções é a ordem em que a desconfiança chega:
 *
 * 1. **O número**, escrito de novo e com a periodicidade colada, para que não
 *    haja dúvida de qual dos números da tela este painel explica.
 * 2. **De onde ele vem** — os grupos de alteração que somam nele, cada um com
 *    o seu valor e os seus veículos, e cada um abrindo na lista de placas.
 * 3. **O que não está nele** — o sem preço, o excluído por dupla contagem e as
 *    outras periodicidades. Esta seção é a razão de o painel existir: os três
 *    são a diferença entre o número da tela e qualquer soma que alguém faça por
 *    fora, e um detalhe que os calasse produziria a discussão que ele veio
 *    evitar.
 * 4. **As portas**, para as duas telas que continuam a pergunta com o mesmo
 *    recorte no bolso.
 *
 * Nada aqui pede dado novo ao servidor: tudo sai da mesma resposta que desenhou
 * o pódio. Dois pedidos seriam duas vigências possíveis, e duas vigências é
 * exatamente como o número do detalhe deixaria de bater com o número de cima.
 */
export function DetalheDoImpacto({
  detalhe,
  period,
  periodLabel,
  recorte = RECORTE_VAZIO,
  onFechar,
}: {
  detalhe: DetalheDeImpacto | null;
  period: string;
  periodLabel: string | null;
  recorte?: Recorte;
  onFechar: () => void;
}) {
  /*
    O cartão do catálogo que corresponde a este parâmetro, quando existe.

    É o que faz "Abrir em Parâmetros" cair no cartão certo em vez de despejar na
    grade inteira e cobrar que se procure de novo o que já estava na mão. Quando
    o parâmetro não tem cartão — os que só o FreightCheck tem —, o link vai para
    a grade sem `?cartao=`, que é a verdade daquele caso.
  */
  const cartao = useMemo(() => {
    if (!detalhe) return null;
    const { porCartao } = ligarParametros([detalhe.name]);
    for (const [chave, nomes] of porCartao) {
      if (nomes.includes(detalhe.name)) return chave;
    }
    return null;
  }, [detalhe]);

  if (!detalhe) return null;

  const negativo = detalhe.amount < 0;
  const daVigencia: Recorte = { ...recorte, period };
  const consultaDeParametros = paramsDoRecorte(daVigencia);
  if (cartao) consultaDeParametros.set("cartao", cartao);

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl p-0 flex flex-col gap-0"
      >
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {detalhe.familyName}
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-1 pr-8">
            {detalhe.name}
          </SheetTitle>

          <p
            className={cn(
              "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
              negativo ? "text-red-700" : "text-emerald-700",
            )}
          >
            {formatBrlShort(detalhe.amount)}
            <span className="text-base font-semibold text-muted-foreground">
              {periodicitySuffix(detalhe.periodicity)}
            </span>
          </p>

          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            {negativo ? "Quanto este parâmetro tirou" : "Quanto este parâmetro somou"} da
            remuneração{periodLabel ? ` em ${periodLabel}` : " nesta vigência"} — a soma dos
            grupos abaixo, sem o que não tem preço e sem o que já está contado noutro lugar.
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          <Origem detalhe={detalhe} period={period} />
          <ForaDoNumero detalhe={detalhe} recorte={daVigencia} />

          <section className="flex flex-wrap gap-3 border-t pt-6">
            <Link
              href={linkDeAlteracoes({
                recorte: daVigencia,
                filtros: detalhe.attributeCode
                  ? { attributeCode: detalhe.attributeCode }
                  : {},
              })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
            >
              Ver as alterações, linha a linha
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href={`/parametros?${consultaDeParametros}`}
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
// De onde vem
// ---------------------------------------------------------------------------

/**
 * Os grupos que somam no número.
 *
 * O cartão de grupo é o mesmo que Parâmetros e Alterações usam, e abre na lista
 * de placas com o valor de cada uma — é ali que a cadeia termina, no dado que
 * veio da planilha. Reaproveitá-lo não é economia de código: é a garantia de
 * que o grupo lido aqui e o grupo lido lá dizem a mesma coisa.
 */
function Origem({ detalhe, period }: { detalhe: DetalheDeImpacto; period: string }) {
  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <Coins className="w-4 h-4 text-muted-foreground" />
        De onde vem
      </h3>
      <p className="text-sm text-muted-foreground mt-1.5">
        {contar(detalhe.changes, "alteração", "alterações")} deste parâmetro nesta vigência,
        em {contar(detalhe.vehicles, "veículo", "veículos")}. O número acima é a soma de{" "}
        <strong className="text-foreground">
          {contar(detalhe.grupos.length, "grupo", "grupos")}
        </strong>
        , com {contar(detalhe.veiculosContados, "veículo contado", "veículos contados")}.
      </p>

      {detalhe.grupos.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground border rounded-lg px-5 py-4">
          Nenhum grupo desta periodicidade sobrou para exibir — o valor existe no resumo da
          vigência, mas as alterações que o produziram não estão neste recorte.
        </p>
      ) : (
        <div className="mt-4 space-y-2.5">
          {detalhe.grupos.map((grupo) => (
            <GroupCard key={grupo.key} group={grupo} period={period} />
          ))}
        </div>
      )}

      {/*
        A diferença entre a soma dos grupos e o número publicado.

        Deve ser zero sempre — grupo é partição de linha. Fica escrita porque
        quem confere soma na mão, e descobrir uma diferença sozinho é descobrir
        que uma das duas telas mente sem saber qual.
      */}
      {Math.abs(detalhe.resto) >= 0.01 && (
        <p className="mt-3 flex gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-px" />
          <span>
            Os grupos acima somam{" "}
            <strong>
              {escreverImpacto({
                periodicity: detalhe.periodicity,
                amount: detalhe.amount - detalhe.resto,
              })}
            </strong>
            , e não o valor publicado. A diferença de{" "}
            <strong>
              {escreverImpacto({ periodicity: detalhe.periodicity, amount: detalhe.resto })}
            </strong>{" "}
            não é explicada por nenhum grupo desta vigência.
          </span>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O que não está no número
// ---------------------------------------------------------------------------

/**
 * As três coisas que o número não contém — e a razão de cada uma.
 *
 * A seção some inteira quando não há nenhuma delas, e isso é uma afirmação e
 * não um vazio: quer dizer que toda alteração do parâmetro tem preço, nenhuma
 * saiu por dupla contagem, e não há outra periodicidade escondida. Um "0" em
 * três linhas diria o mesmo gastando a tela e ensinando a não ler a seção.
 */
function ForaDoNumero({
  detalhe,
  recorte,
}: {
  detalhe: DetalheDeImpacto;
  recorte: Recorte;
}) {
  const excluido = detalhe.excluido.alteracoes > 0;
  if (detalhe.semPreco === 0 && !excluido && detalhe.outras.length === 0) return null;

  return (
    <section className="border-t pt-6">
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <CircleSlash className="w-4 h-4 text-muted-foreground" />
        O que não está neste número
      </h3>

      <ul className="mt-3.5 space-y-3.5">
        {detalhe.semPreco > 0 && (
          <li className="flex gap-3 text-sm">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
            <p>
              <strong>{contar(detalhe.semPreco, "alteração", "alterações")} sem preço.</strong>{" "}
              Mudaram, mas não há semântica confirmada que as transforme em dinheiro — e
              impacto que não foi apurado não vira zero na soma.{" "}
              <Link
                href={linkDeAlteracoes({
                  recorte,
                  filtros: {
                    impactConfidence: "NOT_CALCULABLE",
                    ...(detalhe.attributeCode
                      ? { attributeCode: detalhe.attributeCode }
                      : {}),
                  },
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
                {contar(detalhe.excluido.alteracoes, "alteração", "alterações")} fora, por já
                estarem contadas nas parcelas
              </strong>
              {detalhe.excluido.valor !== null && (
                <>
                  {" "}
                  (
                  {escreverImpacto({
                    periodicity: detalhe.periodicity,
                    amount: detalhe.excluido.valor,
                  })}
                  )
                </>
              )}
              . O total mudou porque as suas partes mudaram; somar os dois lados contaria o
              mesmo dinheiro duas vezes.
            </p>
          </li>
        )}

        {detalhe.outras.length > 0 && (
          <li className="flex gap-3 text-sm">
            <Coins className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <p>
              <strong>
                Este parâmetro também tem{" "}
                {detalhe.outras
                  .map((impacto) => escreverImpacto(impacto))
                  .join(" e ")}
              </strong>
              . Cada periodicidade é uma grandeza própria e sai em linha própria — R$/mês e
              R$/ano não somam, aqui nem em lugar nenhum do produto.
            </p>
          </li>
        )}
      </ul>
    </section>
  );
}

/** `3 grupos`, `1 grupo` — o número por extenso com a palavra que ele rege. */
function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade.toLocaleString("pt-BR")} ${quantidade === 1 ? singular : plural}`;
}
