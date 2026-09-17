import {
  CircleDollarSign,
  ClipboardList,
  Percent,
  PiggyBank,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { CartaoDeIndicador } from "@/components/ui/cartao-de-indicador";
import { formatBrl, formatPercent } from "@/lib/format";
import type { Indicador } from "./tipos";

/**
 * A visão executiva do Agente de Compras — seis cartões, e nenhum inventado.
 *
 * Os números vêm prontos da rota (`/agente-compras/panorama`): a tela escolhe o
 * ícone e escreve o valor, e não faz conta nenhuma. É a regra que separa este
 * painel do defeito clássico da categoria — um KPI somado no navegador que não
 * bate com a resposta que o chat dá logo abaixo, sobre o mesmo dado.
 *
 * **Nulo não é zero, e o cartão mostra a diferença.** "R$ 0,00" diz que não há
 * economia a capturar; o travessão diz que não deu para calcular. As duas
 * frases pedem ações opostas — uma é boa notícia, a outra é dado faltando —, e
 * a nota embaixo do número explica qual das duas é.
 */

const ICONE: Record<string, LucideIcon> = {
  "economia-potencial": PiggyBank,
  "acima-do-teto": TriangleAlert,
  "itens-analisados": ClipboardList,
  "margem-media": Percent,
  "maior-oportunidade": Target,
  aguardando: CircleDollarSign,
};

/**
 * A cor do número, quando a medida tem régua.
 *
 * Só duas têm: compras acima do teto, que é vermelha quando há alguma, e a
 * margem média, que é vermelha quando é negativa — comprar acima do que a
 * remuneração cobre. As outras quatro são leitura, não veredito, e pintá-las
 * transformaria "seis itens analisados" num alarme.
 */
function corDoValor(indicador: Indicador): string | undefined {
  if (indicador.valor === null) return "text-muted-foreground";
  if (indicador.chave === "acima-do-teto" && indicador.valor > 0) return "text-rose-600";
  if (indicador.chave === "margem-media" && indicador.valor < 0) return "text-rose-600";
  if (indicador.chave === "maior-oportunidade" && indicador.valor > 0) return "text-emerald-600";
  return undefined;
}

function escrever(indicador: Indicador): string {
  if (indicador.valor === null) return "—";
  if (indicador.formato === "BRL") return formatBrl(indicador.valor);
  if (indicador.formato === "PERCENTUAL") return formatPercent(indicador.valor * 100);
  return new Intl.NumberFormat("pt-BR").format(indicador.valor);
}

export function Indicadores({ indicadores }: { indicadores: Indicador[] }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {indicadores.map((indicador) => (
        <CartaoDeIndicador
          key={indicador.chave}
          rotulo={indicador.rotulo}
          valor={escrever(indicador)}
          nota={indicador.porque}
          {...(ICONE[indicador.chave] ? { icone: ICONE[indicador.chave]! } : {})}
          {...(corDoValor(indicador) ? { corDoValor: corDoValor(indicador)! } : {})}
          href={indicador.atalho?.href ?? null}
        />
      ))}
    </div>
  );
}
