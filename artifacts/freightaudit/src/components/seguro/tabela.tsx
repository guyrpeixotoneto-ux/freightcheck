import type { LinhaDeSeguro, VeiculoDeSeguro } from "@workspace/comparison/seguro";
import {
  TabelaPorVeiculo,
  type EscritaDaRubrica,
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
} from "@/lib/seguro";

/**
 * A escrita desta rubrica — o vocabulário que a tabela e a gaveta compartilham.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx` e
 * `comparacao/detalhe-do-veiculo.tsx`, com as outras auditorias. Este arquivo é
 * o que só o aparato tem a dizer.
 *
 * **A coluna de dinheiro da placa é o seguro**, e não a soma do aparato. As
 * outras quatro colunas têm um valor só para a frota inteira: uma placa cujo
 * "total" subisse R$ 15,94 porque a faixa refletiva mudou pareceria ter
 * negociado algo, e não negociou nada. O seguro é a única que fala daquela
 * carreta — 38 valores distintos no acervo.
 */
export const ESCRITA_DO_SEGURO: EscritaDaRubrica<LinhaDeSeguro, VeiculoDeSeguro> = {
  rubrica: "seguro e aparato",
  destaque: "Seguro",
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
};

export function TabelaDeSeguro({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeSeguro[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DO_SEGURO}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
