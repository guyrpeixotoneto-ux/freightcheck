import { Link } from "wouter";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  CircleSlash,
  Info,
  ListFilter,
  ListOrdered,
  Scale,
  ShieldQuestion,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { GroupCard } from "@/components/inicio/group-card";
import type { Recorte } from "@/lib/recorte";
import { cn } from "@/lib/utils";
import type { Severity } from "@/components/inicio/types";
import type { DetalheDeAlteracao, TipoDeLinha } from "@/lib/visao-geral";

/**
 * O ícone e a cor de cada natureza de linha.
 *
 * Moram aqui, e não na Visão geral, porque a lista e a gaveta precisam do mesmo
 * par: quem clica numa bolinha âmbar de interrogação tem de reencontrá-la no
 * topo do painel que abriu, ou o painel se lê como outra coisa. Duas tabelas
 * iguais em dois arquivos divergiriam, e a que divergisse seria a da gaveta —
 * que é a que ninguém compara lado a lado.
 */
export const ICONE_DA_LINHA: Record<TipoDeLinha, LucideIcon> = {
  queda: ArrowDownRight,
  alta: ArrowUpRight,
  "sem-preco": CircleHelp,
  neutro: Info,
};

export const COR_DA_LINHA: Record<TipoDeLinha, string> = {
  queda: "text-red-700 bg-red-50",
  alta: "text-emerald-700 bg-emerald-50",
  "sem-preco": "text-warning bg-warning/10",
  neutro: "text-muted-foreground bg-muted",
};

/**
 * Por que esta alteração está em destaque — a gaveta que a lista abre.
 *
 * As Alterações em destaque anunciavam quatro fatos por nome e mandavam cada um
 * para fora da tela: o clique trocava a Visão geral pela Planilha filtrada, e
 * quem só queria saber *por que aquilo estava em destaque* pagava uma navegação
 * inteira e voltava sem a resposta — a Planilha lista linhas, não explica
 * posições. É o mesmo beco que os Maiores impactos tinham antes de ganharem a
 * sua gaveta, e a solução aqui é a mesma, de propósito: **o painel abre sobre a
 * tela**, o item continua atrás, e o que ele mostra é a conta do item.
 *
 * A ordem das seções é a ordem em que a pergunta chega:
 *
 * 1. **Por que está aqui em cima** — a criticidade, o diagnóstico e a soma que
 *    produziu a posição, parcela por parcela. Um ranking cujo critério não pode
 *    ser lido é indistinguível de um palpite.
 * 2. **O que mudou** — o mesmo cartão que o Acompanhamento e os Parâmetros
 *    usam, já aberto: os dois lados como vieram da planilha, os padrões, a
 *    série do atributo e a lista de veículos com a célula de origem. Reaproveitá-lo
 *    não é economia de código, é a garantia de que o grupo lido aqui e o grupo
 *    lido lá dizem a mesma coisa.
 * 3. **O que este item não fecha** — o preço que falta e as outras alterações
 *    da mesma coluna que ficaram fora desta linha.
 * 4. **As portas**, para as telas que continuam a pergunta com o recorte no
 *    bolso.
 *
 * Nada aqui pede dado novo à vigência: `detalhe` sai da mesma resposta que
 * desenhou a lista. O cartão aberto pede os veículos, que é o único dado que a
 * lista de fato não tinha.
 */
export function DetalheDaAlteracao({
  detalhe,
  period,
  periodLabel,
  recorte,
  onFechar,
}: {
  detalhe: DetalheDeAlteracao | null;
  period: string;
  periodLabel: string | null;
  /** De quem é a alteração — unidade e canal, que o cartão precisa no nível 2. */
  recorte: Recorte;
  onFechar: () => void;
}) {
  if (!detalhe) return null;

  const { grupo } = detalhe;
  const negativo = (grupo.impact.amount ?? 0) < 0;
  const Icone = ICONE_DA_LINHA[detalhe.tipo];

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl p-0 flex flex-col gap-0"
      >
        <header className="px-7 pt-7 pb-5 border-b shrink-0">
          {/*
            O mesmo ícone da linha, no topo do painel que ela abriu.

            É a única confirmação de que a gaveta é da linha clicada e não da de
            baixo — a lista tem quatro títulos que começam com as mesmas três
            palavras, e um painel que abre sem sinal de origem obriga a fechar e
            conferir.
          */}
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                COR_DA_LINHA[detalhe.tipo],
              )}
            >
              <Icone className="w-3.5 h-3.5" />
            </span>
            Alteração em destaque
            {detalhe.prioridade && <> · nº {detalhe.prioridade.rank} da fila</>}
          </p>
          <SheetTitle className="text-2xl font-extrabold tracking-tight mt-2 pr-8">
            {detalhe.titulo}
          </SheetTitle>

          {/*
            O número quando há número; a recusa escrita quando não há.

            "Sem preço apurado" ocupa exatamente o lugar que o valor ocuparia,
            em cinza e do mesmo tamanho da frase, e não um "R$ 0,00" cinzento:
            impacto que não foi apurado não é impacto zero, e essa é a distinção
            que esta tela inteira existe para não perder.
          */}
          {detalhe.valor !== null ? (
            <p
              className={cn(
                "text-[2rem] font-extrabold tabular-nums leading-none mt-4",
                negativo ? "text-red-700" : "text-emerald-700",
              )}
            >
              {detalhe.valor}
            </p>
          ) : (
            <p className="text-lg font-bold text-muted-foreground mt-4">
              Sem preço apurado nesta vigência
            </p>
          )}

          <SheetDescription className="mt-2.5 max-w-xl leading-snug">
            {contar(grupo.changes, "alteração", "alterações")} nesta coluna
            {periodLabel ? ` em ${periodLabel}` : " nesta vigência"} · {grupo.coverageLabel}
            {detalhe.semPreco !== null && <> — {detalhe.semPreco}</>}
          </SheetDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-7 py-6 space-y-8">
          <PorQueEmDestaque detalhe={detalhe} />

          <section>
            <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
              <Scale className="w-4 h-4 text-muted-foreground" />
              O que mudou
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              Os dois lados como vieram da planilha, veículo a veículo — o mesmo cartão que o
              Acompanhamento e os Parâmetros abrem, com a célula de origem no fim da linha.
            </p>
            <div className="mt-4">
              <GroupCard
                group={grupo}
                period={period}
                recorte={recorte}
                inicialmenteAberto
              />
            </div>
          </section>

          <NaoFecha detalhe={detalhe} />

          <section className="flex flex-wrap gap-3 border-t pt-6">
            <Link
              href={detalhe.href}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand px-5 py-2.5 text-sm font-bold text-brand hover:bg-accent transition-colors"
            >
              Ver as alterações, linha a linha
              <ArrowRight className="w-4 h-4" />
            </Link>
            {/*
              O Acompanhamento leva a vigência, e não o item.

              A fila de investigação é a lista inteira ordenada por esta mesma
              conta; abrir nela é o passo seguinte natural de quem acabou de ler
              a posição de um item. O que não existe é um endereço para *este*
              item lá dentro — a investigação abre por clique, dentro da tabela —
              e inventá-lo prometeria uma tela que não abre no lugar prometido.
            */}
            <Link
              href={detalhe.hrefFila}
              className="inline-flex items-center gap-1.5 rounded-lg border px-5 py-2.5 text-sm font-bold hover:bg-accent transition-colors"
            >
              Abrir a fila no Acompanhamento
              <ArrowRight className="w-4 h-4" />
            </Link>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Por que está em destaque
// ---------------------------------------------------------------------------

const CORES_DA_SEVERIDADE: Record<Severity, { chip: string; barra: string }> = {
  CRITICO: { chip: "bg-red-50 text-red-800 border-red-300", barra: "bg-red-700" },
  ALTO: { chip: "bg-amber-50 text-amber-900 border-amber-300", barra: "bg-amber-500" },
  MEDIO: { chip: "bg-sky-50 text-sky-900 border-sky-300", barra: "bg-sky-600" },
  BAIXO: { chip: "bg-zinc-50 text-zinc-600 border-zinc-300", barra: "bg-zinc-300" },
};

const ROTULO_DA_SEVERIDADE: Record<Severity, string> = {
  CRITICO: "Crítico",
  ALTO: "Alto",
  MEDIO: "Médio",
  BAIXO: "Baixo",
};

/**
 * A conta que pôs este item na lista — escrita, e não resumida num adjetivo.
 *
 * A fila do cockpit é ordenada por uma soma de parcelas, e é a mesma soma que a
 * tabela do Acompanhamento mostra no fim da investigação. Ela aparece aqui pelo
 * mesmo motivo que aparece lá: quem lê "em destaque" tem direito de saber
 * contra o que os outros itens perderam a posição. Os cortes de criticidade vão
 * escritos junto, porque um limiar oculto transforma a nota num palpite.
 *
 * A seção some inteira quando o item não está na fila — o que não deveria
 * acontecer, já que a lista e a fila nascem da mesma resposta. Sumir é a única
 * saída honesta: uma criticidade inventada aqui contradiria a tela ao lado.
 */
function PorQueEmDestaque({ detalhe }: { detalhe: DetalheDeAlteracao }) {
  const item = detalhe.prioridade;
  if (item === null) return null;

  const cores = CORES_DA_SEVERIDADE[item.severity];

  return (
    <section>
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <ListOrdered className="w-4 h-4 text-muted-foreground" />
        Por que está em destaque
      </h3>

      <div className="flex items-center gap-2 mt-3">
        <span
          className={cn(
            "text-[0.625rem] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 border rounded-md",
            cores.chip,
          )}
        >
          {ROTULO_DA_SEVERIDADE[item.severity]}
        </span>
        <span className="text-xs text-muted-foreground">
          posição {item.rank} da fila de investigação desta vigência
        </span>
      </div>

      <p className="text-sm mt-2.5 leading-snug">{item.diagnosis}</p>

      {item.sharePercent !== null && (
        <div className="mt-3.5">
          <div className="h-1.5 bg-muted overflow-hidden rounded-full">
            <div
              className={cn("h-full", cores.barra)}
              style={{ width: `${Math.min(100, Math.max(2, item.sharePercent))}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {item.shareLabel} · {item.sharePercent.toLocaleString("pt-BR")}% da frota comparada
          </p>
        </div>
      )}

      {item.reasons.length > 0 && (
        <>
          <ul className="text-xs mt-4 space-y-0.5 border rounded-lg px-4 py-3">
            {item.reasons.map((razao) => (
              <li key={razao.label} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{razao.label}</span>
                <span className="tabular-nums font-medium shrink-0">+{razao.points}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t pt-1 mt-1 font-semibold">
              <span>Total · {ROTULO_DA_SEVERIDADE[item.severity].toLowerCase()}</span>
              <span className="tabular-nums">{item.score}</span>
            </li>
          </ul>
          <p className="text-[0.6875rem] text-muted-foreground mt-1.5 leading-snug">
            A fila é ordenada por esta soma, e nenhum critério é oculto: crítico a partir de
            70, alto a partir de 45, médio a partir de 25.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// O que este item não fecha
// ---------------------------------------------------------------------------

/**
 * As duas coisas que ficam abertas depois de ler o item.
 *
 * A seção some inteira quando não há nenhuma delas, e o silêncio é uma
 * afirmação: quer dizer que esta alteração tem preço apurado e que a coluna não
 * mudou em mais lugar nenhum desta vigência. Dois "nenhum" escritos diriam o
 * mesmo gastando a tela e ensinando a não ler a seção.
 */
function NaoFecha({ detalhe }: { detalhe: DetalheDeAlteracao }) {
  const faltaPreco = detalhe.valor === null;
  if (!faltaPreco && detalhe.mesmoAtributo === null) return null;

  return (
    <section className="border-t pt-6">
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <CircleSlash className="w-4 h-4 text-muted-foreground" />
        O que este item não fecha
      </h3>

      <ul className="mt-3.5 space-y-3.5">
        {faltaPreco && (
          <li className="flex gap-3 text-sm">
            <ShieldQuestion className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
            <p>
              <strong>Esta alteração não entra em soma nenhuma.</strong>{" "}
              {detalhe.semPreco ??
                "O motor não apurou valor para ela nesta vigência, e impacto não apurado não vira zero no total."}
              {detalhe.hrefCuradoria !== null && (
                <>
                  {" "}
                  <Link
                    href={detalhe.hrefCuradoria}
                    className="font-semibold text-brand hover:underline"
                  >
                    Confirmar o significado na Curadoria
                  </Link>{" "}
                  é o que destrava o preço.
                </>
              )}
            </p>
          </li>
        )}

        {detalhe.mesmoAtributo !== null && (
          <li className="flex gap-3 text-sm">
            <ListFilter className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <p>
              <strong>
                A mesma coluna mudou em mais{" "}
                {contar(detalhe.mesmoAtributo.grupos, "grupo", "grupos")}
              </strong>{" "}
              nesta vigência, somando{" "}
              {contar(detalhe.mesmoAtributo.veiculos, "veículo", "veículos")} fora desta
              linha — outro equipamento, outro tipo de mudança, ou outra confiança de
              impacto.{" "}
              <Link
                href={detalhe.mesmoAtributo.href}
                className="font-semibold text-brand hover:underline"
              >
                Ver a coluna inteira
              </Link>
              .
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
