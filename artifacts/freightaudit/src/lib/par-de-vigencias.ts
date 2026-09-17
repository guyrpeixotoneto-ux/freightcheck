import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { trocarNoEndereco } from "@/lib/modo-da-auditoria";

/**
 * O PAR NO ENDEREÇO — uma ponta por gesto, e o link que descreve o que se vê.
 *
 * ---------------------------------------------------------------------------
 * O que este hook resolve
 * ---------------------------------------------------------------------------
 * As dezesseis telas de rubrica guardavam o par em `useState`. Sete delas liam
 * `?base=&comparada=` **na montagem** e nunca mais escreviam; as outras nove não
 * liam nem escreviam. O efeito prático, medido na auditoria de 17/09/2026:
 *
 * - o link que alguém manda abre no par de quem mandou, mas o link de quem
 *   trocou o par não carrega a troca — copiar o endereço depois de comparar
 *   junho com setembro manda o outro para o par de partida;
 * - o botão "voltar" do navegador não desfaz uma troca de par;
 * - recarregar a página perde a comparação.
 *
 * Nada disso é sutil para quem opera, e nenhuma das telas decidiu ser assim:
 * cada uma nasceu com o `useState` da anterior.
 *
 * ---------------------------------------------------------------------------
 * Por que ele substitui `useState` sem mudar a forma
 * ---------------------------------------------------------------------------
 * Ele devolve exatamente `[valor, setValor]`, e por isso entra no lugar do
 * `useState` de cada tela sem tocar em mais nada — as páginas continuam
 * passando `onBase={setBase}` ao seletor. O que muda é onde o valor mora.
 *
 * ---------------------------------------------------------------------------
 * `replace`, e não `push`
 * ---------------------------------------------------------------------------
 * Porque o mesmo setter serve dois chamadores: o clique da pessoa e o efeito de
 * reconciliação que ajusta o par quando a lista de vigências chega ou a unidade
 * troca (`parReconciliado`). Empilhando os dois, o "voltar" precisaria de duas
 * ou três batidas para desfazer uma escolha — e a tela, ao voltar, cairia num
 * par que o efeito reescreveria na frente de quem olha. Com `replace`, o
 * endereço descreve sempre o que está em tela, que é a promessa que ele existe
 * para cumprir.
 *
 * As outras chaves do endereço atravessam intocadas: quem escreve é
 * `trocarNoEndereco`, a mesma função que a troca de unidade e a de modo já
 * usam, e é ela que garante que entrar na Evolução e voltar devolva a
 * comparação como estava.
 *
 * ---------------------------------------------------------------------------
 * A rota sai do próprio endereço
 * ---------------------------------------------------------------------------
 * Ele não recebe a rota por parâmetro, e a razão é a tela de comparação do QLP:
 * ela é montada de três lugares — `/qlp-operacional`, `/qlp-administrativo` e
 * `/qlp/:modulo`, que é dinâmica —, e uma constante passada de fora estaria
 * errada em dois deles no dia em que alguém esquecesse de atualizá-la. Lida do
 * `useLocation`, ela é sempre a rota em que a pessoa está.
 */
export function useParNaUrl(
  chave: "base" | "comparada",
): [string, (valor: string) => void] {
  const busca = useSearch();
  const [rota, navegar] = useLocation();
  const valor = new URLSearchParams(busca).get(chave) ?? "";

  const definir = useCallback(
    (proximo: string) => {
      /* Escrever o mesmo valor empilharia uma navegação sem troca — e o efeito
         de reconciliação chama o setter a cada rodada em que a lista muda. */
      if (proximo === valor) return;
      navegar(trocarNoEndereco(rota, busca, { [chave]: proximo }), { replace: true });
    },
    [busca, chave, navegar, rota, valor],
  );

  return [valor, definir];
}

import type { MotivoSemPar } from "@workspace/comparison/recorte-de-rubrica";

/**
 * O par que o endereço já traz — `?base=<id>&comparada=<id>`.
 *
 * Existe para que o **Abrir auditoria** do Monitor Custo Fixo abra a tela do
 * módulo no mesmo par que o Monitor estava mostrando. Sem isto, o botão levava
 * à auditoria certa no par errado: a tela caía no par de partida dela, e quem
 * clicou numa alteração de julho chegava em setembro sem uma palavra dizendo
 * que o assunto tinha mudado — o mesmo defeito que `lib/recorte.ts` descreve
 * sobre o `/alteracoes` pelado.
 *
 * **É só um valor inicial, e isso é o desenho.** As duas pontas continuam
 * passando por `parReconciliado`, que mantém o que está na lista da unidade
 * aberta e descarta o que não está. Um par de outra unidade no endereço não
 * sequestra a tela: ele é descartado como qualquer outro par que não pertence
 * à lista, e a tela abre no par de partida dela.
 *
 * Quem chega sem os parâmetros — pelo menu, por um link antigo, por um favorito
 * — recebe `""` nas duas pontas, que é exatamente o estado inicial que as
 * quatro telas sempre tiveram. A retrocompatibilidade não é um caso especial
 * tratado aqui: é a ausência de um.
 */
export function parDaUrl(search: string): { base: string; comparada: string } {
  const q = new URLSearchParams(search);
  return { base: q.get("base") ?? "", comparada: q.get("comparada") ?? "" };
}

/**
 * A frase da tela vazia quando a lista **tem** vigências e mesmo assim não sai
 * par.
 *
 * As sete telas de rubrica escreviam uma frase só para todo caso sem par —
 * *"Esta unidade não tem duas vigências para comparar"* — e ela é falsa
 * justamente no caso mais difícil de entender: o seletor com duas linhas
 * dentro, as duas clicáveis, e a tela dizendo que não há duas. Foi o que se
 * viu na Auditoria de Km Rodado em 15/09/2026, com `agosto/2026` e
 * `setembro/2026` na lista.
 *
 * Contar quantas há é uma coisa; poder emparelhá-las é outra. O motor recusa
 * dois pares por construção (`engine.ts`) — escopos diferentes e coberturas
 * diferentes —, e é sobre esses dois que esta frase fala. Os outros dois
 * motivos (`LISTA_VAZIA`, `UMA_SO`) continuam com a frase de cada tela, que
 * sabe dizer qual arquivo falta importar; para eles isto devolve `null`.
 *
 * O seletor não é desligado junto. A lista é verdadeira, escolher é legítimo, e
 * quem escolher as duas pontas recebe do servidor a recusa com o nome dos dois
 * arquivos — que é mais do que esta frase sabe dizer.
 */
export function avisoDoParImpossivel(
  motivo: MotivoSemPar,
): { titulo: string; descricao: string } | null {
  if (motivo.motivo === "UNIDADES_DIFERENTES") {
    return {
      titulo: "As vigências desta lista são de unidades diferentes",
      descricao:
        "Sem unidade escolhida na lateral, a lista traz o acervo inteiro — e o motor não compara vigências de unidades distintas, porque nela todo ativo de uma apareceria como novo na outra. Escolha uma unidade na lateral.",
    };
  }
  if (motivo.motivo === "COBERTURAS_DIFERENTES") {
    return {
      titulo: "As vigências desta unidade não formam par",
      descricao: `A lista tem mais de uma vigência, mas elas chegaram cobrindo conjuntos diferentes de entidade (${motivo.coberturas.join(
        " e ",
      )}), e o motor só compara vigências de mesma cobertura. Escolher as duas pontas acima continua possível — a recusa virá nomeando os dois arquivos. Para comparar de verdade, falta importar a vigência seguinte com a mesma cobertura.`,
    };
  }
  return null;
}

/**
 * O mesmo assunto em uma linha — a cobertura que não tem par, dita ao lado das
 * que têm.
 *
 * {@link avisoDoParImpossivel} escreve o parágrafo da tela vazia, onde há
 * espaço para dizer o que importar e por que o motor recusa. Aqui é outro
 * lugar: a lista de coberturas do catálogo, onde as irmãs cabem numa linha cada
 * e esta precisa caber também — senão a cobertura sem par vira o item mais alto
 * da lista, que é o oposto da importância dela.
 *
 * Os quatro motivos continuam distintos, e é por isso que esta função existe em
 * vez de um "sem par" fixo: `LISTA_VAZIA` pede uma importação, `UMA_SO` pede a
 * **seguinte**, e as outras duas são recusas do motor sobre vigências que estão
 * ali, visíveis. Dizer o mesmo para os quatro mandaria três dos quatro
 * procurarem a coisa errada.
 */
export function fraseSemPar(motivo: MotivoSemPar): string {
  switch (motivo.motivo) {
    case "LISTA_VAZIA":
      return "nenhuma vigência importada";
    case "UMA_SO":
      return "uma vigência só — falta a seguinte";
    case "UNIDADES_DIFERENTES":
      return "vigências de unidades diferentes — escolha uma na lateral";
    case "COBERTURAS_DIFERENTES":
      return `coberturas diferentes (${motivo.coberturas.join(" e ")}) — o motor não as compara`;
  }
}
