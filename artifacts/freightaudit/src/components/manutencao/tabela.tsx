import {
  AGRUPAMENTO_DE_MANUTENCAO,
  type LinhaDeManutencao,
  type VeiculoDeManutencao,
} from "@workspace/comparison/manutencao";
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
} from "@/lib/manutencao";

/**
 * A escrita desta rubrica — o vocabulário que a tabela e a gaveta compartilham.
 *
 * **A coluna de destaque é medida em R$/km, e não em reais.** É a única das seis
 * auditorias em que isso acontece, e é por isso que a tabela lê o agrupamento
 * da rubrica: dele saem a unidade do destaque — sem ela a coluna escreveria
 * "R$ 0,34" onde a fonte disse trinta e quatro centavos por quilômetro — e o
 * fato de que aqui **nenhuma** variável é dinheiro, que cala o complemento
 * "(0 em R$)" da contagem de alterações.
 */
export const ESCRITA_DA_MANUTENCAO: EscritaDaRubrica<
  LinhaDeManutencao,
  VeiculoDeManutencao
> = {
  rubrica: "manutenção",
  destaque: "R$/km",
  agrupamento: AGRUPAMENTO_DE_MANUTENCAO,
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
  selecao,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeManutencao[];
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
      escrita={ESCRITA_DA_MANUTENCAO}
      justificadaPor={justificadaPor}
      selecao={selecao}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
