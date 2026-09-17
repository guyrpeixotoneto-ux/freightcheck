import {
  FileText,
  Gauge,
  PieChart,
  ShieldCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { Ajuda } from "@/components/ui/cartao-de-indicador";
import { cn } from "@/lib/utils";
import type { MedidaDoPlacar } from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

/**
 * O placar da vigência — *"e os outros números?"* —, agora **dentro** do cartão
 * do veredito, e em régua e não em fileira de cartões.
 *
 * Eram cinco cartões de KPI, do tamanho dos cartões de KPI do resto do produto,
 * numa faixa própria embaixo da manchete. Três coisas estavam erradas nisso:
 *
 * 1. **O primeiro deles era o número da manchete.** "Impacto líquido", com os
 *    mesmos ganhos e perdas embaixo, reimpresso a 200 pixels de onde a tela o
 *    tinha acabado de anunciar em corpo 48. A medida não saiu da leitura — ela
 *    é a manchete, e {@link MedidaDoPlacar} continua publicando-a para quem
 *    precise dela solta; quem não a desenha aqui é esta régua.
 * 2. **Dois outros repetiam a faixa de cobertura** que vinha logo abaixo:
 *    "Sem impacto calculável · 5.433" e "Cobertura da apuração · 15% · 947 de
 *    6.380" são exatamente os números da frase da faixa.
 * 3. **Cinco cartões custam ~180px de altura** para publicar quatro números de
 *    contexto — e contexto que compete em peso visual com a resposta deixa de
 *    ser contexto.
 *
 * A régua diz os mesmos números na mesma ordem, com o mesmo ⓘ de definição e o
 * mesmo tom de severidade, em uma linha. O que ela tira é a moldura: sem
 * medalhão, sem borda por medida e sem corpo de número grande — porque a
 * hierarquia desta dobra é *um* número grande, e ele está à esquerda.
 */
export function Placar({
  medidas,
  className,
}: {
  medidas: MedidaDoPlacar[];
  className?: string;
}) {
  /*
    Medida sem dado não aparece, e a régua fecha — nada aqui mostra "0" para
    preencher lugar. É a mesma recusa que o Resumo executivo já declarava.

    E o líquido não aparece **nunca**: ele é a manchete ao lado, e `destaque` é
    exatamente a marca de quem é. Filtrar pela marca, e não pela chave, é o que
    mantém a regra verdadeira se um dia a manchete for outra medida.
  */
  const visiveis = medidas.filter((m) => m.valor !== null && !m.destaque);
  if (visiveis.length === 0) return null;

  return (
    <div
      className={cn("flex flex-wrap items-start gap-x-8 gap-y-4", className)}
      aria-label="O placar da vigência"
      role="group"
    >
      {visiveis.map((medida) => (
        <Medida key={medida.chave} medida={medida} />
      ))}
    </div>
  );
}

function Medida({ medida }: { medida: MedidaDoPlacar }) {
  const Icone = ICONE_DA_MEDIDA[medida.chave];
  const corpo = (
    <>
      <p className="flex items-center gap-1.5 text-3xs uppercase tracking-[0.1em] font-bold text-muted-foreground">
        {Icone && <Icone className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{medida.rotulo}</span>
        {medida.ajuda && <Ajuda texto={medida.ajuda} />}
      </p>
      <p
        className={cn(
          "text-xl font-extrabold tabular-nums leading-none mt-1.5 tracking-[-0.01em]",
          medida.tom ? COR_DO_TOM[medida.tom] : "text-foreground",
        )}
      >
        {medida.valor}
      </p>
      {medida.nota && (
        <p className="text-[0.6875rem] text-muted-foreground mt-1 leading-snug">{medida.nota}</p>
      )}
    </>
  );

  /* Com destino, a medida inteira é o alvo — a mesma régua do cartão de KPI. */
  if (!medida.href) return <div className="min-w-0 max-w-[15rem]">{corpo}</div>;
  return (
    <Link
      href={medida.href}
      className="min-w-0 max-w-[15rem] rounded-lg -mx-2 px-2 py-1 -my-1 hover:bg-accent/60 transition-colors"
    >
      {corpo}
    </Link>
  );
}

/**
 * O ícone de cada medida — **desenho, e não dado**, e por isso ele mora aqui e
 * não em `lib/panorama.ts`.
 *
 * A camada de leitura publica as medidas com chave estável; o que cada uma
 * *parece* é decisão desta tela. Pôr o ícone lá dentro faria a aritmética da
 * vigência carregar um `LucideIcon` para ser testada.
 *
 * Chave sem ícone cai em `undefined`, e a medida simplesmente não desenha o
 * glifo — uma medida nova aparece sem enfeite em vez de aparecer com o enfeite
 * errado.
 */
const ICONE_DA_MEDIDA: Record<string, LucideIcon | undefined> = {
  liquido: Gauge,
  alteracoes: FileText,
  veiculos: Truck,
  "sem-preco": PieChart,
  cobertura: ShieldCheck,
};

/*
  A mesma paleta de tom que `OndeAgirAgora` usa, e pelo mesmo motivo: os dois
  publicam severidade lida da mesma régua (`qualidadeDaCobertura`, `Tom`), e
  duas escalas de cor para a mesma severidade fariam os dois discordarem sobre a
  gravidade do mesmo fato.
*/
const COR_DO_TOM: Record<Tom, string> = {
  grave: "text-red-700",
  atencao: "text-amber-700",
  ok: "text-emerald-700",
};
