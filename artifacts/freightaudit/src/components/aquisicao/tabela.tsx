import { AGRUPAMENTO_DE_AQUISICAO } from "@workspace/comparison/aquisicao";
import type { LinhaDeAquisicao, VeiculoDeAquisicao } from "@workspace/comparison/aquisicao";
import {
  TabelaPorVeiculo,
  type EscritaDaRubrica,
} from "@/components/comparacao/tabela-por-veiculo";
import type { AbrirJustificativa } from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_PAPEL,
  SELO_DO_ESTADO,
  UNIDADE_DO_PAPEL,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/aquisicao";

/**
 * A escrita desta rubrica — o vocabulário que a tabela e a gaveta compartilham.
 *
 * A estrutura toda mora em `comparacao/tabela-por-veiculo.tsx` e
 * `comparacao/detalhe-do-veiculo.tsx`, com as outras auditorias. Este arquivo é
 * o que só a aquisição tem a dizer.
 *
 * **A coluna de dinheiro da placa é o valor de nota**, e é a única candidata:
 * das cinco colunas da rubrica, ela é a única em reais. As outras quatro são um
 * percentual e três formas de dizer a mesma data.
 *
 * **O aviso ao lado do nome da variável é o papel dela.** Numa coluna de números
 * em que a linha de cima é R$ 665.929,99, o `20` da linha de baixo pede o aviso
 * de que é percentual e não entra em soma nenhuma — a mesma decisão da tabela de
 * Impostos, pelo mesmo motivo.
 */
export const ESCRITA_DA_AQUISICAO: EscritaDaRubrica<LinhaDeAquisicao, VeiculoDeAquisicao> = {
  rubrica: "aquisição",
  destaque: "Valor de NF",
  agrupamento: AGRUPAMENTO_DE_AQUISICAO,
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
  avisoDaVariavel: (linha) =>
    linha.papel === "MONTANTE"
      ? null
      : {
          rotulo: `${ROTULO_DO_PAPEL[linha.papel]} · ${UNIDADE_DO_PAPEL[linha.papel]}`,
          texto:
            linha.papel === "ALIQUOTA"
              ? "Percentual, e não reais. Não entra em soma de dinheiro nenhuma desta tela."
              : linha.derivadaDe
                ? "Cadastro derivado da data de entrada — o mesmo fato, escrito de novo. Fora de toda soma."
                : "Cadastro do ativo. A curadoria o marcou como não aplicável a custo, e ele não entra em total nenhum.",
        },
};

export function TabelaDeAquisicao({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeAquisicao[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DA_AQUISICAO}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}
