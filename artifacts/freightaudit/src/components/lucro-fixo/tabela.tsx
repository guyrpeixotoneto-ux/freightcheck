import { AGRUPAMENTO_DE_LUCRO_FIXO } from "@workspace/comparison/lucro-fixo";
import type { LinhaDeLucroFixo, VeiculoDeLucroFixo } from "@workspace/comparison/lucro-fixo";
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
} from "@/lib/lucro-fixo";

/**
 * A tabela da comparação de lucro fixo — **uma linha por placa**.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx`, com as outras
 * três rubricas de custo fixo. Este arquivo é o que só o lucro fixo tem a dizer.
 *
 * **A coluna de dinheiro é o lucro fixo próprio do equipamento**, e nunca a do
 * conjunto: aquela embute a parcela do cavalo vinculado, e usá-la na linha da
 * carreta contaria o mesmo dinheiro nas duas placas. Ela continua na expansão,
 * marcada como fora do total — some da tela seria deixar quem confere a planilha
 * procurando por que o nosso número não bate com o dela.
 *
 * **A amortização também não entra na coluna de dinheiro**, e ela é a outra
 * metade do par: as duas nunca coexistem — ciclo 1 amortiza e não remunera,
 * ciclo 2 remunera e não amortiza —, e somá-las escreveria como um só dois
 * números que a planilha mantém separados. Ela continua na expansão, que é onde
 * ela explica um lucro fixo zerado.
 *
 * **A cor passa a variável junto.** Nesta tela convivem uma receita (o lucro
 * fixo) e um custo (a amortização), e a mesma seta para cima significa coisas
 * opostas nas duas linhas. Quem decide é `corDaDiferenca`, por variável — ver
 * `lib/lucro-fixo.ts`.
 */
const ESCRITA_DO_LUCRO_FIXO: EscritaDaRubrica<LinhaDeLucroFixo, VeiculoDeLucroFixo> = {
  rubrica: "lucro fixo",
  destaque: "Lucro fixo",
  agrupamento: AGRUPAMENTO_DE_LUCRO_FIXO,
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
};

export function TabelaDeLucroFixo({
  veiculos,
  justificadaPor,
  selecao,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeLucroFixo[];
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
      escrita={ESCRITA_DO_LUCRO_FIXO}
      justificadaPor={justificadaPor}
      selecao={selecao}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
