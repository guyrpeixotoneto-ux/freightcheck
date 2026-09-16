import type { MotivoSemPar } from "@workspace/comparison/recorte-de-rubrica";

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
