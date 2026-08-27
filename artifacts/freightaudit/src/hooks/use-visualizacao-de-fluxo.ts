import { useCallback, useState } from "react";
import {
  gravarPreferencia,
  lerPreferencia,
  type AgrupamentoDeRaia,
  type Orientacao,
  type PreferenciaDeVisualizacao,
  type Visualizacao,
} from "@/lib/fluxos-visoes";

/**
 * A visualização escolhida — e por que ela é estado de tela, e não de rota.
 *
 * Trocar de visualização não é navegar: o objeto aberto continua sendo o mesmo
 * fluxo, com os mesmos dados carregados, a mesma etapa selecionada e as mesmas
 * alterações pendentes. Pôr isso na URL faria a troca remontar a árvore e
 * perder a seleção — e, pior, sugeriria que cada visualização é um lugar
 * diferente do produto, que é exatamente a impressão que o módulo não pode dar.
 *
 * A escolha sobrevive à sessão em `localStorage` (ver `lib/fluxos-visoes.ts`):
 * quem trabalha o dia inteiro nas Raias abre nas Raias amanhã. O estado inicial
 * é lido uma vez, na montagem, e não a cada renderização.
 */
export function useVisualizacaoDeFluxo() {
  const [preferencia, setPreferencia] = useState<PreferenciaDeVisualizacao>(() => lerPreferencia());

  const atualizar = useCallback((parcial: Partial<PreferenciaDeVisualizacao>) => {
    setPreferencia((atual) => {
      const nova = { ...atual, ...parcial };
      gravarPreferencia(nova);
      return nova;
    });
  }, []);

  /**
   * A visualização que a **tela** propõe — e por que ela não é gravada.
   *
   * Um fluxo recém-criado não tem o que desenhar: abrir no fluxograma vazio é
   * mostrar um quadro em branco a quem acabou de dizer que quer cadastrar um
   * processo. A Lista é onde as etapas nascem com nome, área, responsável e
   * prazo, então é ela que abre.
   *
   * A sugestão **não** vai para o `localStorage`: quem trabalha o dia inteiro
   * nas Raias não pode perder essa preferência porque passou por um fluxo
   * vazio. Ela vale para a tela aberta; a próxima escolha de verdade, feita no
   * seletor, é que grava.
   */
  const sugerirVisualizacao = useCallback((visualizacao: Visualizacao) => {
    setPreferencia((atual) => (atual.visualizacao === visualizacao ? atual : { ...atual, visualizacao }));
  }, []);

  return {
    ...preferencia,
    sugerirVisualizacao,
    trocarVisualizacao: useCallback(
      (visualizacao: Visualizacao) => atualizar({ visualizacao }),
      [atualizar],
    ),
    trocarOrientacao: useCallback(
      (orientacao: Orientacao) => atualizar({ orientacao }),
      [atualizar],
    ),
    trocarAgrupamento: useCallback(
      (agrupamento: AgrupamentoDeRaia) => atualizar({ agrupamento }),
      [atualizar],
    ),
  };
}
