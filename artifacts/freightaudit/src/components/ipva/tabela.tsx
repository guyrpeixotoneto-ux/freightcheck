import type { LinhaDeIpva, VeiculoDeIpva } from "@workspace/comparison/ipva";
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
  temValorNegativo,
} from "@/lib/ipva";

/**
 * A tabela da comparação de IPVA — **uma linha por placa**.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx`, com as outras
 * três rubricas de custo fixo. Este arquivo é o que só o IPVA tem a dizer.
 *
 * **A coluna de dinheiro é o IPVA anual**, e nunca a coluna "mensal" da carreta:
 * aquela não é 1/12 desta, ninguém sabe o que ela é, e é por isso que ela fica
 * fora de toda soma. Ela continua aparecendo na expansão, marcada com o ⓘ de
 * "fora do total daqui" — esconder o achado seria apagá-lo.
 *
 * **O negativo é um aviso da placa, e não uma coluna.** Um licenciamento abaixo
 * de zero ou é estorno ou é erro de cadastro, e nos dois casos entra numa soma e
 * a distorce. Ele existe em poucas linhas de cada cem: uma coluna vazia em
 * noventa e oito por cento delas empurraria as úteis para fora da tela.
 */
const ESCRITA_DO_IPVA: EscritaDaRubrica<LinhaDeIpva, VeiculoDeIpva> = {
  rubrica: "IPVA",
  destaque: "IPVA",
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
  avisoDaPlaca: (v) =>
    v.linhas.some(temValorNegativo)
      ? {
          rotulo: "Valor negativo nesta placa: estorno ou erro de cadastro",
          texto:
            "Uma das pontas é negativa. Continua somando, como a planilha a declarou — mas " +
            "um licenciamento negativo ou é estorno, ou é erro de cadastro.",
        }
      : null,
};

export function TabelaDeIpva({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeIpva[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DO_IPVA}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
