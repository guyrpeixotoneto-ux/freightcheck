import { useLocation } from "wouter";
import { baseDoFechamento } from "@/lib/ambiente";

/**
 * A base de endereço do fechamento aberto — o atalho que as telas usam.
 *
 * `lib/ambiente.ts` é função pura sobre a localização, de propósito; este
 * arquivo é o mesmo cálculo com o `useLocation` já embutido, para que uma tela
 * que só quer montar um link não precise declarar a localização que não vai
 * usar para mais nada.
 *
 * **Toda navegação de dentro do fechamento passa por aqui.** Um `href` escrito
 * como `/fechamento/competencias` funciona no Rota e leva quem está na
 * Empurrada para o ambiente errado, sem erro na tela — a pior forma de essa
 * regressão aparecer. Escrito como `` `${base}/competencias` ``, ele é sempre o
 * endereço do ambiente em que a pessoa está.
 */
export function useBaseDoFechamento(): string {
  const [location] = useLocation();
  return baseDoFechamento(location);
}
