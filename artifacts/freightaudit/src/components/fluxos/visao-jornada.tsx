import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Flag,
  FileText,
  Hourglass,
  Server,
  Shuffle,
  Target,
  Timer,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { cartaoDaJornada, linhasDaLista, resumoDaLente } from "@/lib/fluxos-analise";
import { LENTES_DA_JORNADA, type LenteDaJornada } from "@/lib/fluxos-visoes";
import type { PropsDaVisao } from "@/components/fluxos/visao";

/**
 * VISUALIZAÇÃO 3 — A JORNADA: o processo como linha do tempo, por uma lente.
 *
 * É a visão de reunião. O fluxograma é o instrumento de quem levanta o
 * processo; a jornada é o que se mostra para a diretoria: a sequência, na ordem
 * em que acontece, um cartão por macroetapa.
 *
 * O que mudou é **o que cabe no cartão**. Antes a jornada mostrava sempre as
 * mesmas três linhas (quem, onde, prazo) e escondia o resto de propósito, para
 * não virar ilegível. O tipo de jornada mantém a promessa e resolve a perda:
 * continua sendo uma leitura de cada vez — três linhas, nunca tudo junto —, mas
 * quem lê escolhe *qual*. A jornada da documentação, a das falhas, a dos
 * gargalos e a das informações são o mesmo caminho, com o cartão respondendo
 * outra pergunta.
 *
 * A troca de lente não mexe em nada além disso: mesma sequência, mesma
 * numeração, mesmo clique abrindo o mesmo painel com tudo. `cartaoDaJornada` é
 * função pura sobre a linha que a Lista já monta — não há dado por lente.
 *
 * O vazio continua sendo dito com todas as letras ("sem prazo definido", "sem
 * falhas registradas"), nunca preenchido com estimativa. E o cartão em que a
 * lente não achou nada aparece esmaecido: numa jornada de documentação, a
 * mancha de cartões apagados é o mapa do que ainda não foi levantado.
 *
 * No celular a jornada continua sendo a visualização que funciona sem
 * adaptação — cartões empilhados, um por linha, com o mesmo conteúdo.
 */

/**
 * Os ícones que as lentes usam.
 *
 * O catálogo (`fluxos-visoes.ts`, `fluxos-analise.ts`) guarda o **nome** do
 * ícone, e não o componente, para continuar sendo dado puro e testável sem
 * React. A tradução para componente é aqui, num mapa fechado: importar o pacote
 * inteiro do `lucide-react` por nome levaria o bundle junto.
 */
const ICONES: Record<string, LucideIcon> = {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Flag,
  FileText,
  Hourglass,
  Server,
  Shuffle,
  Target,
  Timer,
  Undo2,
  Users,
};

export function VisaoJornada({
  completo,
  catalogo,
  etapaSelecionada,
  onSelecionarEtapa,
  lente,
}: PropsDaVisao & { lente: LenteDaJornada }) {
  const linhas = useMemo(() => linhasDaLista(completo), [completo]);
  const resumo = useMemo(() => resumoDaLente(linhas, lente), [linhas, lente]);
  const entrada = LENTES_DA_JORNADA.find((l) => l.valor === lente) ?? LENTES_DA_JORNADA[0];

  return (
    <div className="h-full overflow-auto bg-muted/20 px-4 py-6 sm:px-8">
      {/*
        A linha do cabeçalho responde a pergunta da lente antes de qualquer
        cartão ser lido: em quantas etapas isto está cadastrado. Num fluxo
        recém-levantado é a informação mais útil da tela.
      */}
      <p className="mx-auto mb-4 max-w-6xl text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{entrada.rotulo}</span>
        {" · "}
        {entrada.descricao}
        {" · "}
        {resumo.etapas === 0
          ? `nada cadastrado nas ${resumo.total} etapas`
          : `em ${resumo.etapas} de ${resumo.total} etapas`}
      </p>

      <ol className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-stretch">
        {linhas.map((linha, indice) => {
          const tipo = catalogo?.tiposDeEtapa.find((t) => t.valor === linha.etapa.tipo);
          const aberta = etapaSelecionada === linha.etapa.id;
          const cartao = cartaoDaJornada(linha, lente);
          return (
            /*
              Cartão e seta são **um** item de fluxo, e não dois: soltos, a
              quebra de linha jogaria a seta do último cartão da linha para o
              começo da linha seguinte, e a jornada passaria a começar com uma
              seta apontando para lugar nenhum.
            */
            <li key={linha.etapa.id} className="flex items-stretch gap-3">
              <button
                type="button"
                onClick={() => onSelecionarEtapa(aberta ? null : linha.etapa.id)}
                aria-pressed={aberta}
                className={cn(
                  "w-full rounded-lg border bg-card px-4 py-3 text-left shadow-sm transition-shadow hover:shadow-md lg:w-[236px]",
                  /*
                    O cartão sem nada nesta lente esmaece, mas continua clicável
                    e continua na sequência: esconder etapa quebraria a jornada,
                    que é justamente o que esta visualização é.
                  */
                  cartao.achados === 0 && "opacity-60",
                  aberta && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
                data-testid={`jornada-${linha.etapa.nome}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {String(linha.numero).padStart(2, "0")}
                  </span>
                  <Badge variant="secondary" className="font-normal">
                    {tipo?.rotulo ?? linha.etapa.tipo}
                  </Badge>
                  {linha.etapa.status === "ATENCAO" && (
                    <Badge variant="destructive" className="font-normal">
                      Atenção
                    </Badge>
                  )}
                </div>

                <p className="mt-2 text-sm font-medium leading-snug text-foreground">
                  {linha.etapa.nome}
                </p>

                <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {cartao.campos.map((campo) => {
                    const Icone = ICONES[campo.icone] ?? Activity;
                    return (
                      <div key={campo.chave} className="flex items-start gap-1.5">
                        <Icone className="mt-0.5 h-3 w-3 shrink-0" />
                        <dt className="sr-only">{campo.rotulo}</dt>
                        <dd className="min-w-0 flex-1">
                          {campo.valores.length === 0 ? (
                            <span className="text-muted-foreground/60">{campo.vazio}</span>
                          ) : (
                            /*
                              Duas linhas no máximo por campo: o objetivo de uma
                              etapa pode ter um parágrafo, e a jornada existe
                              para ser lida de relance. O texto inteiro está a um
                              clique, no painel de detalhe.
                            */
                            <span className="line-clamp-2 break-words">
                              {campo.valores.join(" · ")}
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </button>

              {/*
                A seta entre cartões é decoração e não conteúdo: some do leitor
                de tela e vira uma quebra vertical no celular, onde a jornada é
                uma pilha e não uma linha.
              */}
              {indice < linhas.length - 1 && (
                <span
                  aria-hidden
                  className="flex shrink-0 items-center justify-center text-muted-foreground/50"
                >
                  <ChevronRight className="h-4 w-4 rotate-90 lg:rotate-0" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
