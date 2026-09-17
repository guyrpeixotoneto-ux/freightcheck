import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/**
 * A linha de lista do Panorama — **uma forma, e as três listas da tela**.
 *
 * O Panorama tem três rankings: o do dinheiro (dobra 2, por família ou por
 * parâmetro), o dos tipos de ativo e o das unidades (dobra 3). Os três dizem a
 * mesma coisa na mesma gramática — *isto é o que mais pesa, isto é o contexto
 * dele, isto é o quanto, e clique para ver por dentro* — e cada um estava
 * desenhado à mão, com três larguras de coluna, dois tamanhos de barra e duas
 * regras diferentes sobre onde o clique pega.
 *
 * Aqui a forma é uma:
 *
 * ```
 * 1  Cavalo                      ████████████░░░░   244
 *    15 parâmetros · frota de 62                     alterações
 * ```
 *
 * O que cada lista decide é **o que entra em cada lugar** — e o valor já chega
 * escrito, porque escrever número é da camada de leitura (`lib/panorama.ts`) e
 * não desta.
 *
 * **A linha inteira é o alvo do clique**, e não uma seta na borda direita: o
 * que se quer clicar aqui é o número, e um alvo de 16 pixels na beirada
 * obrigaria a mirar para fazer a pergunta mais óbvia da tela. Sem destino ela
 * deixa de ser `<button>` de propósito — um botão desabilitado ainda para o
 * foco de quem navega por teclado em algo que nunca vai responder.
 */
export function LinhaDeLista({
  className,
  posicao,
  nome,
  contexto,
  selo,
  proporcao,
  corDaBarra,
  valor,
  corDoValor,
  subvalor,
  aberta = false,
  titulo,
  onAbrir,
  href,
}: {
  posicao: number;
  nome: string;
  /** A linha de baixo: de onde vem, quantos, de que tamanho. */
  contexto: ReactNode;
  /** A pastilha ao lado do nome — `null` quando a lista não classifica. */
  selo?: { rotulo: string; classe: string } | null;
  /** Do maior valor da lista: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
  corDaBarra: string;
  /** O número, já escrito pela camada de leitura. */
  valor: ReactNode;
  corDoValor?: string;
  /** A linha embaixo do número — a unidade dele, ou o líquido da parcela. */
  subvalor?: ReactNode;
  /** A gaveta desta linha está aberta — a linha fica marcada atrás dela. */
  aberta?: boolean;
  titulo?: string;
  /** Abre a gaveta. Exclusivo com `href`. */
  onAbrir?: (() => void) | null;
  /** Leva a outra tela. Exclusivo com `onAbrir`. */
  href?: string | null;
  /**
   * O `<li>`, para a lista que **preenche** a altura do cartão.
   *
   * Os cartões de lista dividem a faixa com um gráfico de 300px e acompanham a
   * altura dele; com três linhas, a lista terminava no meio do cartão e o resto
   * ficava em branco. Quem sabe quanta folga há a repartir é a lista, não a
   * linha — daí a classe vir de fora.
   */
  className?: string;
}) {
  const conteudo = (
    <>
      <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{posicao}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold truncate" title={nome}>
            {nome}
          </span>
          {selo && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0",
                selo.classe,
              )}
            >
              {selo.rotulo}
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground truncate mt-0.5">{contexto}</span>
        <span className="mt-1.5 block h-1.5 rounded-full bg-muted overflow-hidden">
          {/*
            A barra de 2% não é a barra de zero: a linha que está na lista
            participou de algo, e um traço invisível a faria parecer ausente. O
            mínimo existe para isso, e não para inventar comprimento.
          */}
          <span
            className={cn("block h-full rounded-full", corDaBarra)}
            style={{ width: `${Math.max(2, proporcao * 100)}%` }}
          />
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block text-sm font-extrabold tabular-nums", corDoValor)}>{valor}</span>
        {subvalor && (
          <span className="block text-[0.6875rem] tabular-nums leading-tight text-muted-foreground">
            {subvalor}
          </span>
        )}
      </span>
      {(onAbrir || href) && (
        <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
      )}
    </>
  );

  const forma = "flex w-full items-center gap-3 py-2.5 text-left";
  const interativa =
    "group rounded-lg px-2 -mx-2 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors";

  if (onAbrir) {
    return (
      <li className={className}>
        <button
          type="button"
          onClick={onAbrir}
          title={titulo}
          aria-expanded={aberta}
          className={cn(forma, interativa, aberta && "bg-accent/60")}
        >
          {conteudo}
        </button>
      </li>
    );
  }

  if (href) {
    return (
      <li className={className}>
        <Link href={href} title={titulo} className={cn(forma, interativa)}>
          {conteudo}
        </Link>
      </li>
    );
  }

  return (
    <li className={className}>
      <div className={cn(forma, "px-2 -mx-2")}>{conteudo}</div>
    </li>
  );
}
