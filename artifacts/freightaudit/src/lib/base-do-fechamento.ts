import { useLocation } from "wouter";
import { baseDoFechamento, operacaoDoFechamento } from "@/lib/ambiente";

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

/**
 * A operação do fechamento aberto — o recorte de todas as leituras de lista.
 *
 * O par de {@link useBaseDoFechamento}: aquele diz para onde os links vão, este
 * diz de qual acervo a tela fala. Uma lista pedida sem ele traz o Fechamento
 * inteiro, e aí o Rota mostra as competências da Empurrada — a mesma linha em
 * dois lugares, que some dos dois quando alguém a exclui de um. Ver
 * `OPERACAO_DO_AMBIENTE`, em `lib/ambiente.ts`.
 */
export function useOperacaoDoFechamento(): string {
  const [location] = useLocation();
  return operacaoDoFechamento(location);
}
