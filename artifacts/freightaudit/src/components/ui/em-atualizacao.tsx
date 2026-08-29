import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "O que você está vendo ainda é o recorte anterior."
 *
 * Este componente é a metade honesta de `keepPreviousData`
 * (`lib/frescor-das-leituras.ts`). A outra metade — manter o conteúdo em tela
 * durante a troca de unidade ou de competência — resolve o piscar; sozinha,
 * ela cria um problema pior do que o que resolve.
 *
 * O problema é este, e ele é concreto: a caixa "Unidade atual" da lateral lê o
 * endereço, então ela nomeia a unidade nova **no instante do clique**. O corpo
 * da tela lê a resposta, então ele mostra os números da unidade anterior por
 * mais 150–200 ms. Durante essa janela a tela inteira afirma uma coisa que não
 * é verdade, e ninguém tem como saber disso olhando.
 *
 * Uma tela em branco pelo menos não mente. Trocar a tela em branco por uma
 * afirmação falsa seria piorar, e é exatamente o que o pedido desta rodada
 * proíbe: *"não quero simplesmente esconder loaders"*.
 *
 * Então a regra é: **quem usa `keepPreviousData` mostra isto enquanto
 * `isPlaceholderData` for verdadeiro.** Não enquanto `isFetching` — um refetch
 * de fundo sobre a *mesma* chave não muda o assunto da tela e não precisa
 * anunciar nada. `isPlaceholderData` é o único sinal que quer dizer "a chave
 * mudou e a resposta dela ainda não chegou", que é a única situação em que há
 * algo a declarar.
 *
 * O cabeçalho das telas continua nomeando o recorte **da resposta que está em
 * tela**, e não o da URL — `Cabecalho` lê `view.context` e `view.period`, não
 * `params.get("scopeHash")`. Com isto ao lado, as duas coisas ficam ditas:
 * o título diz de quem são os números, e o indicador diz que outro está
 * chegando. Quando chega, título e números viram juntos, num quadro só.
 */
export function EmAtualizacao({
  ativo,
  className,
  rotulo = "atualizando",
}: {
  /** `isPlaceholderData` da consulta. Sem ele, o componente não aparece. */
  ativo: boolean;
  className?: string;
  /** O que está sendo trocado, quando a tela sabe dizer. */
  rotulo?: string;
}) {
  if (!ativo) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="em-atualizacao"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/70",
        "bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      {rotulo}
    </span>
  );
}

/**
 * A classe do conteúdo que ainda é o anterior.
 *
 * Um segundo sinal, não um enfeite: o indicador acima é pequeno e fica no
 * cabeçalho, e quem está olhando um número no meio da tela não passa por ele.
 * A opacidade alcança o campo de visão inteiro sem apagar nada — e é o mesmo
 * recurso que `components/changes/impacto-quinzenas.tsx` já usa, pela mesma
 * razão, desde antes desta rodada.
 *
 * 60% e não 30%: o conteúdo precisa continuar legível. Quem trocou de
 * competência para conferir um número da anterior ainda consegue lê-lo.
 */
export function classeDeAtualizacao(ativo: boolean): string {
  return ativo ? "opacity-60 transition-opacity" : "transition-opacity";
}
