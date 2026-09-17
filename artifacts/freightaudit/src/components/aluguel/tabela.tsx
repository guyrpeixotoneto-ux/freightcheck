import { AGRUPAMENTO_DE_ALUGUEL } from "@workspace/comparison/aluguel";
import type { LinhaDeAluguel, VeiculoDeAluguel } from "@workspace/comparison/aluguel";
import {
  TabelaPorVeiculo,
  type EscritaDaRubrica,
  type SelecaoEmLote,
} from "@/components/comparacao/tabela-por-veiculo";
import type { AbrirJustificativa } from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/aluguel";

/**
 * A escrita desta rubrica — o vocabulário que a tabela e a gaveta compartilham.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx` e
 * `comparacao/detalhe-do-veiculo.tsx`, com as outras auditorias. Este arquivo é
 * o que só o aluguel tem a dizer.
 *
 * **A coluna de dinheiro da placa é o aluguel**, e não a parcela FINAME. As duas
 * são o mesmo número nos implementos alugados — e é justamente por isso que o
 * destaque tem de ser uma delas só: uma placa cujo "total" mostrasse a soma das
 * duas apareceria custando o dobro do que custa.
 */
export const ESCRITA_DO_ALUGUEL: EscritaDaRubrica<LinhaDeAluguel, VeiculoDeAluguel> = {
  rubrica: "aluguel de frota",
  destaque: "Aluguel",
  agrupamento: AGRUPAMENTO_DE_ALUGUEL,
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
};

export function TabelaDeAluguel({
  veiculos,
  justificadaPor,
  selecao,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeAluguel[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  /** Ausente, a tabela é a de sempre — o modo em lote desligado. */
  selecao?: SelecaoEmLote;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DO_ALUGUEL}
      justificadaPor={justificadaPor}
      selecao={selecao}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
