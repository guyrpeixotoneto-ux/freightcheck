import type { ComponentType, ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { Medalhao } from "@/components/ui/superficie";
import { cn } from "@/lib/utils";

/**
 * O cartão de indicador — o KPI do produto, num componente só.
 *
 * Ele existia em quatro lugares com quatro desenhos: o placar do Panorama, os
 * cartões do Impacto Líquido, os do Resumo executivo e os da Gestão à Vista.
 * Os quatro dizem a mesma coisa — um rótulo, um número grande, uma linha de
 * contexto — e os quatro chegaram a corpos diferentes (`text-2xl`, `text-3xl`,
 * `text-[1.75rem]`) e a respiros diferentes. Numa tela executiva isso se lê
 * como importância: o número maior parece o mais grave, e ele só é o mais novo.
 *
 * A ordem de leitura dentro do cartão é fixa, e é ela que o componente
 * protege: **rótulo, número, nota**. O medalhão fica à esquerda do rótulo,
 * onde ele funciona como marcador de assunto para uma varredura horizontal de
 * cinco cartões — que é como uma fileira de KPI é lida de verdade.
 *
 * O cartão inteiro é o alvo do clique quando há destino (`envolver`), e o ⓘ
 * sobrevive por cima dele com uma camada própria: sem isso, tocar na definição
 * do número navegaria em vez de explicá-la.
 */
export function CartaoDeIndicador({
  rotulo,
  valor,
  nota,
  ajuda,
  icone,
  corDoIcone = "bg-brand/10 text-brand",
  corDoValor,
  destaque = false,
  href,
  className,
}: {
  rotulo: ReactNode;
  /** O número, já escrito pela camada de leitura. */
  valor: ReactNode;
  nota?: ReactNode;
  /** A definição da medida, no ⓘ. */
  ajuda?: string;
  icone?: ComponentType<{ className?: string }>;
  /** As duas classes do medalhão — fundo esmaecido e cor do glifo. */
  corDoIcone?: string;
  /** A cor do número, quando a medida tem régua de severidade. */
  corDoValor?: string;
  /** O cartão do número principal da tela. Um por fileira. */
  destaque?: boolean;
  /** A tela que responde a esta medida. Com destino, o cartão inteiro é o alvo. */
  href?: string | null;
  className?: string;
}) {
  const classes = cn(
    "superficie px-5 py-4 flex flex-col relative",
    destaque && "border-brand/30 ring-1 ring-brand/10",
    href && "superficie-interativa",
    className,
  );

  const corpo = (
    <>
      <div className="flex items-start gap-3">
        {icone && <Medalhao icone={icone} tamanho="md" className={corDoIcone} />}
        <h3 className="text-[0.8125rem] font-bold min-w-0 flex-1 leading-tight pt-0.5">
          {rotulo}
        </h3>
        {ajuda && <Ajuda texto={ajuda} />}
      </div>

      <p
        className={cn(
          "text-2xl font-extrabold tabular-nums leading-none mt-3.5 tracking-[-0.01em]",
          corDoValor ?? "text-foreground",
        )}
      >
        {valor}
      </p>

      {nota && <p className="text-xs text-muted-foreground mt-2 leading-snug">{nota}</p>}
    </>
  );

  if (!href) return <section className={classes}>{corpo}</section>;
  return (
    <Link href={href} className={classes}>
      {corpo}
    </Link>
  );
}

function Ajuda({ texto }: { texto: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={texto}
          className="relative z-10 shrink-0 text-muted-foreground/60 hover:text-brand transition-colors"
        >
          <Info className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-snug">{texto}</TooltipContent>
    </Tooltip>
  );
}
