import type {
  LinhaDeManutencao,
  VeiculoDeManutencao,
} from "@workspace/comparison/manutencao";
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
} from "@/lib/manutencao";

/**
 * A escrita desta rubrica — o vocabulário que a tabela e a gaveta compartilham.
 *
 * **A coluna de destaque é medida em R$/km, e não em reais.** É a única das seis
 * auditorias em que isso acontece, e é por isso que `medidaDoDestaque` existe:
 * sem ela a coluna escreveria "R$ 0,34" onde a fonte disse trinta e quatro
 * centavos por quilômetro — o mesmo número, a conta errada.
 */
export const ESCRITA_DA_MANUTENCAO: EscritaDaRubrica<
  LinhaDeManutencao,
  VeiculoDeManutencao
> = {
  rubrica: "manutenção e pneu",
  destaque: "R$/km",
  medidaDoDestaque: "REAIS_POR_KM",
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
};

export function TabelaDeManutencao({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeManutencao[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DA_MANUTENCAO}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
