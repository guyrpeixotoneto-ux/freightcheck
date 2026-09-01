import { ArrowDownRight, ArrowUpRight, FileText, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { comSinal, type SituacaoDaApuracao } from "@/lib/impacto-apurado";
import type { LadosDoImpacto } from "@/lib/visao-geral";

/**
 * A manchete financeira — o único número grande da tela.
 *
 * O termo é **apurado**, e ele não é enfeite: enquanto houver alteração sem
 * preço, este valor é o impacto *já identificado*, e não o impacto da vigência.
 * A faixa logo abaixo (`FaixaDeCobertura`) diz quanto falta; o cartão diz o que
 * tem.
 *
 * Os quatro indicadores da direita são **contexto**, não manchete: ficam num
 * cartão só, com corpo menor e sem cor de destaque, porque a pergunta que a
 * tela responde primeiro é uma só. Cinco cartões do mesmo tamanho seriam cinco
 * perguntas com a mesma importância — que é exatamente o que o Impacto Líquido
 * já faz, e o que este módulo existe para não repetir.
 */

const CARTAO = "bg-card border rounded-xl shadow-sm";

export interface ContextoDaManchete {
  alteracoes: number;
  /** Tipos de alteração — `null` quando a leitura não sabe contá-los sem somar unidades. */
  tiposDeAlteracao: number | null;
  veiculos: number;
  /** A frota que a vigência entregou — `null` quando não há denominador confiável. */
  frota: number | null;
  /** Se `veiculos` é contagem de ativos distintos ou soma de unidades. */
  veiculosDeduplicados: boolean;
}

export function Manchete({
  situacao,
  outras,
  contexto,
}: {
  /**
   * Em que pé está a apuração — quatro desfechos, e nenhum deles é o outro.
   *
   * A tela escrevia `null` para três coisas diferentes: vigência sem alteração,
   * vigência sem preço e vigência apurada em R$ 0,00. As três viravam "nenhum
   * valor apurado", e a terceira é uma apuração que aconteceu.
   */
  situacao: SituacaoDaApuracao;
  /**
   * As outras periodicidades da vigência — em linha própria, e nunca somadas.
   *
   * R$/mês e R$/ano não somam, aqui nem em lugar nenhum do produto. Sem esta
   * linha, uma vigência com valor anual publicaria só o mensal e o anual
   * sumiria da tela sem que nada dissesse que ele existe.
   */
  outras: LadosDoImpacto[];
  contexto: ContextoDaManchete;
}) {
  const lados = situacao.estado === "com_movimento" ? situacao.lados : null;
  const sufixo = lados
    ? periodicitySuffix(lados.periodicity)
    : situacao.estado === "apurado_em_zero"
      ? periodicitySuffix(situacao.periodicity)
      : "";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.75fr)]">
      <section
        className="rounded-xl bg-brand text-brand-foreground px-6 py-5 shadow-sm relative overflow-hidden"
        aria-label="Impacto líquido apurado"
      >
        <p className="text-[11px] font-bold tracking-[0.14em] uppercase opacity-80">
          Impacto líquido apurado
        </p>
        {lados || situacao.estado === "apurado_em_zero" ? (
          <>
            <p className="mt-3 flex items-baseline gap-2 flex-wrap">
              {/*
                O corpo cede antes da frase: um valor de sete dígitos a
                `text-5xl` estoura o cartão numa tela de 13 polegadas, e o que
                não pode acontecer é o número quebrar no meio.
              */}
              <span className="text-3xl sm:text-4xl xl:text-5xl font-extrabold tabular-nums leading-none whitespace-nowrap">
                {comSinal(lados ? lados.liquido : 0)}
              </span>
              {sufixo && <span className="text-base font-semibold opacity-80">{sufixo}</span>}
            </p>
            <p className="text-xs opacity-80 mt-3 leading-snug">{DESCRICAO[situacao.estado]}</p>
            {/*
              Líquido zero tem duas causas, e elas pedem conversas diferentes:
              ganho e perda que se anularam, ou linhas apuradas em R$ 0,00. A
              primeira é dita aqui porque o número sozinho não a mostra.
            */}
            {lados && lados.liquido === 0 && lados.ganhos > 0 && (
              <p className="text-xs opacity-80 mt-1 leading-snug">
                Ganhos e perdas se compensaram: {formatBrlShort(lados.ganhos)} de um lado e{" "}
                {formatBrlShort(lados.perdas)} do outro.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-3 text-2xl font-extrabold leading-tight">
              {situacao.estado === "sem_alteracao" ? "Nada mudou" : "Nenhum valor apurado"}
            </p>
            <p className="text-xs opacity-80 mt-3 leading-snug">{DESCRICAO[situacao.estado]}</p>
          </>
        )}

        {outras.length > 0 && (
          <p className="text-xs opacity-80 mt-3 leading-snug border-t border-white/20 pt-2">
            Esta vigência também tem{" "}
            {outras
              .map((l) => `${formatBrlShort(l.liquido)}${periodicitySuffix(l.periodicity)}`)
              .join(" e ")}{" "}
            — grandezas que não somam com a de cima.
          </p>
        )}
      </section>

      <section className={cn(CARTAO, "px-6 py-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4")}>
        <Indicador
          icone={ArrowUpRight}
          tomDoIcone="text-emerald-700 bg-emerald-50"
          titulo={`Ganhos${adjetivo(lados?.periodicity ?? null)}`}
        >
          {lados ? (
            <Valor className="text-emerald-700">{comSinal(lados.ganhos)}</Valor>
          ) : (
            <SemValor situacao={situacao} />
          )}
        </Indicador>

        <Indicador
          icone={ArrowDownRight}
          tomDoIcone="text-red-700 bg-red-50"
          titulo={`Perdas${adjetivo(lados?.periodicity ?? null)}`}
        >
          {lados ? (
            <Valor className="text-red-700">{formatBrlShort(lados.perdas)}</Valor>
          ) : (
            <SemValor situacao={situacao} />
          )}
        </Indicador>

        <Indicador icone={Truck} tomDoIcone="text-brand bg-accent" titulo="Veículos afetados">
          <Valor>{contexto.veiculos.toLocaleString("pt-BR")}</Valor>
          <p className="text-xs text-muted-foreground mt-1">
            {contexto.frota && contexto.frota > 0
              ? `de ${contexto.frota.toLocaleString("pt-BR")} (${Math.round(
                  (contexto.veiculos / contexto.frota) * 100,
                )}%)`
              : contexto.veiculosDeduplicados
                ? "ativos distintos"
                : "soma das unidades"}
          </p>
        </Indicador>

        <Indicador icone={FileText} tomDoIcone="text-brand bg-accent" titulo="Alterações detectadas">
          <Valor>{contexto.alteracoes.toLocaleString("pt-BR")}</Valor>
          <p className="text-xs text-muted-foreground mt-1">
            {contexto.tiposDeAlteracao === null
              ? "desde a vigência anterior"
              : `${contexto.tiposDeAlteracao.toLocaleString("pt-BR")} ${
                  contexto.tiposDeAlteracao === 1 ? "tipo de alteração" : "tipos de alteração"
                }`}
          </p>
        </Indicador>
      </section>
    </div>
  );
}

/**
 * "mensais", "anuais" — o adjetivo do rótulo, quando a periodicidade tem um.
 *
 * Sem adjetivo conhecido o rótulo fica "Ganhos" e a periodicidade viaja colada
 * ao número, onde ela nunca some. Escrever "Ganhos sem periodicidade" seria
 * publicar o código do banco num rótulo.
 */
function adjetivo(periodicity: string | null): string {
  if (periodicity === "MENSAL") return " mensais";
  if (periodicity === "ANUAL") return " anuais";
  return "";
}

function Indicador({
  icone: Icone,
  tomDoIcone,
  titulo,
  children,
}: {
  icone: typeof Truck;
  tomDoIcone: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full p-1.5 shrink-0", tomDoIcone)}>
          <Icone className="w-4 h-4" />
        </span>
        <p className="text-sm font-semibold text-muted-foreground truncate">{titulo}</p>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Valor({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-2xl font-extrabold tabular-nums leading-none", className)}>{children}</p>
  );
}

/**
 * Sem valor apurado não é R$ 0 — e a tela escreve qual dos casos é.
 *
 * "Apurado em R$ 0,00" tem número: é `R$ 0`, e escrevê-lo é a leitura honesta.
 * Os outros dois não têm, e um R$ 0 no lugar deles afirmaria que a mudança não
 * custou nada — quando o que se sabe é que ainda não se sabe.
 */
function SemValor({ situacao }: { situacao: SituacaoDaApuracao }) {
  if (situacao.estado === "apurado_em_zero") {
    return <p className="text-2xl font-extrabold tabular-nums leading-none">R$ 0</p>;
  }
  return (
    <p className="text-sm text-muted-foreground">
      {situacao.estado === "sem_alteracao" ? "sem alteração" : "sem valor apurado"}
    </p>
  );
}

/** A frase debaixo do número — uma por desfecho, e nenhuma serve para dois. */
const DESCRICAO: Record<SituacaoDaApuracao["estado"], string> = {
  com_movimento: "Impacto financeiro já identificado nesta vigência.",
  apurado_em_zero:
    "As alterações desta vigência foram apuradas e não mudaram a remuneração: o resultado é zero medido, e não ausência de apuração.",
  nada_apurado:
    "Há alterações nesta vigência, e nenhuma tem preço apurado. Sem preço não há resultado — e um R$ 0 aqui diria o contrário.",
  sem_alteracao:
    "O cliente não alterou nada nesta vigência que esta comparação alcance. Não há impacto a apurar.",
};
