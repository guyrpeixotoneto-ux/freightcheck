import type { Catalogo, FluxoCompleto } from "@/lib/fluxos";
import type { CampoEditavelNaLista } from "@/lib/fluxos-analise";

/**
 * O CONTRATO DE UMA VISUALIZAÇÃO — o que toda projeção recebe, e nada além.
 *
 * Todas as seis recebem exatamente isto: o fluxo (a fonte de verdade), o
 * catálogo, qual etapa está aberta e se dá para editar. Nenhuma recebe uma
 * cópia própria do processo, nenhuma busca dado por conta própria e nenhuma
 * grava direto — as escritas continuam todas na página, num lugar só.
 *
 * É esse contrato que faz a promessa se sustentar: uma alteração feita em
 * qualquer lugar aparece nas outras porque não existe "as outras" — existe um
 * `FluxoCompleto` no cache, e seis funções que o desenham.
 */
export interface PropsDaVisao {
  completo: FluxoCompleto;
  catalogo: Catalogo | undefined;
  /** A etapa aberta no painel de detalhe. */
  etapaSelecionada: string | null;
  onSelecionarEtapa: (etapaId: string | null) => void;
  somenteLeitura: boolean;
  /**
   * Gravar um campo de uma etapa a partir da própria visualização.
   *
   * É o que permite editar uma célula da Lista sem abrir o editor, sem que a
   * visualização deixe de ser uma projeção: ela não sabe de `escritas`, de
   * empresa nem de cache — pede a gravação e espera a promessa. Quem grava
   * continua sendo a página, num lugar só, e por isso o modo de leitura, a
   * recarga e a mensagem de erro continuam valendo iguais nas seis.
   *
   * A promessa é rejeitada com o erro do servidor: quem chamou mantém o que
   * foi digitado na tela e mostra a frase, em vez de perder o texto.
   */
  onEditarCampoDaEtapa: (
    etapaId: string,
    campo: CampoEditavelNaLista,
    valor: string,
  ) => Promise<void>;
}

/** O que as visualizações desenhadas no canvas precisam a mais. */
export interface PropsDaVisaoNoCanvas extends PropsDaVisao {
  onMoverEtapas: (posicoes: { etapaId: string; posX: number; posY: number }[]) => void;
  onConectar: (origemEtapaId: string, destinoEtapaId: string) => void;
  onAbrirConexao: (conexaoId: string) => void;
}

export type { Catalogo, FluxoCompleto, CampoEditavelNaLista };
