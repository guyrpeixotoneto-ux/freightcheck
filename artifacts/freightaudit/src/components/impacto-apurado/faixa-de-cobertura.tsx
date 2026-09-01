import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { frasesDaCobertura, type CoberturaApurada } from "@/lib/impacto-apurado";
import type { Tom } from "@/lib/visao-geral";

/**
 * A faixa de cobertura — a confiança no número, logo abaixo dele.
 *
 * No Impacto Líquido a cobertura é um anel discreto no quarto cartão. Aqui ela
 * é uma faixa da largura da tela, porque a pergunta que ela responde vem em
 * segundo lugar e não em quarto: *posso confiar nesse número, ou ainda tem
 * muita coisa sem preço?* Um resultado com 7% de cobertura e um com 99% são
 * duas conversas diferentes, e a diferença não pode depender de alguém reparar
 * num anel.
 *
 * **A severidade não é escolha desta tela.** A palavra e o tom vêm de
 * `qualidadeDaCobertura` (`lib/visao-geral.ts`), a régua que o produto já usa —
 * Excelente ≥ 99, Alta ≥ 95, Parcial ≥ 85, Baixa abaixo disso. Aqui só se
 * pinta o que ela decidiu.
 */

const TOM: Record<Tom, { caixa: string; icone: string; titulo: string }> = {
  grave: {
    caixa: "border-red-300 bg-red-50",
    icone: "text-red-700 bg-red-100",
    titulo: "text-red-900",
  },
  atencao: {
    caixa: "border-amber-300 bg-amber-50",
    icone: "text-amber-700 bg-amber-100",
    titulo: "text-amber-900",
  },
  ok: {
    caixa: "border-emerald-300 bg-emerald-50",
    icone: "text-emerald-700 bg-emerald-100",
    titulo: "text-emerald-900",
  },
};

export function FaixaDeCobertura({
  cobertura,
  /** O endereço das alterações sem preço — `null` quando nenhuma tela responde a esta população. */
  verDetalhes,
}: {
  cobertura: CoberturaApurada;
  verDetalhes: string | null;
}) {
  const tom = TOM[cobertura.qualidade.tom];
  const { titulo, detalhe } = frasesDaCobertura(cobertura);
  const Icone = cobertura.parcial ? TriangleAlert : CircleCheck;

  return (
    <section
      className={cn("rounded-xl border px-5 py-4 flex items-start gap-4 flex-wrap", tom.caixa)}
      aria-label="Cobertura financeira da vigência"
    >
      <span className={cn("rounded-full p-2 shrink-0", tom.icone)}>
        <Icone className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-bold leading-snug", tom.titulo)}>{titulo}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">{detalhe}</p>
      </div>
      {cobertura.parcial && verDetalhes && (
        <Link
          href={verDetalhes}
          className="flex items-center gap-1.5 rounded-lg border border-current bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-accent transition-colors shrink-0"
        >
          Ver detalhes
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </section>
  );
}

/**
 * A faixa de quem não tem cobertura a mostrar — e os **dois** motivos para
 * isso, que não são o mesmo motivo.
 *
 * `0 de 0` não é cobertura zero: é ausência de alteração, e um anel em 0% diria
 * que a apuração falhou. Mas "nada mudou" e "não há vigência anterior com que
 * comparar" também não são a mesma frase — a primeira é uma notícia sobre o
 * cliente, a segunda sobre o acervo —, e `cockpit.baseline.hasBaseline` é quem
 * as separa.
 */
export function FaixaSemAlteracao({ temAnterior }: { temAnterior: boolean }) {
  return (
    <section className="rounded-xl border px-5 py-4 bg-muted/40">
      <p className="text-sm font-bold">
        {temAnterior
          ? "Nenhuma alteração detectada nesta vigência."
          : "Esta vigência não tem anterior com que comparar."}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {temAnterior
          ? "Não há cobertura a medir — o cliente não mudou nada entre esta vigência e a anterior."
          : "Sem uma vigência anterior importada não há alteração a detectar, e por isso não há cobertura a medir. Não é o mesmo que “nada mudou”."}
      </p>
    </section>
  );
}
