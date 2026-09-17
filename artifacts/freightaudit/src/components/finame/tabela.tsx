import { AGRUPAMENTO_DE_FINAME } from "@workspace/comparison/finame";
import type { LinhaDeFiname, VeiculoDeFiname } from "@workspace/comparison/finame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TabelaPorVeiculo,
  type EscritaDaRubrica,
} from "@/components/comparacao/tabela-por-veiculo";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDataDeCadastro,
  escreverDiferenca,
  escreverPeriodo,
  escreverValor,
  escreverVariacao,
} from "@/lib/finame";
import type { AbrirJustificativa } from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";

/**
 * A tabela da comparação de FINAME — **uma linha por placa**.
 *
 * A estrutura toda (o agrupamento, a expansão, a fila de justificar, o estado
 * mais grave) mora em `comparacao/tabela-por-veiculo.tsx`, com as outras três
 * rubricas de custo fixo. Este arquivo é o que só o FINAME tem a dizer: as três
 * colunas de contexto do contrato, e o vocabulário das colunas de dinheiro.
 *
 * **As colunas de contexto são do veículo, e não da comparação.** Prazo, data de
 * cadastro e fim do contrato não são variáveis que se moveram: são a resposta da
 * coluna. Uma amortização que cai para R$ 0,00 e um prazo de 60 meses contados
 * desde 2019 são a mesma frase — o contrato acabou —, e sem elas ao lado quem lê
 * precisa abrir o detalhe de cada placa para saber se a queda é o fim do
 * financiamento ou um erro de digitação da planilha.
 *
 * **A coluna de dinheiro é a parcela, e não a soma das monetárias.** Somar
 * parcela, juros e amortização numa célula contaria o mesmo dinheiro duas vezes,
 * porque a parcela é a soma dos outros dois. Quem escolhe é
 * `AGRUPAMENTO_DE_FINAME`, no núcleo.
 */
const ESCRITA_DO_FINAME: EscritaDaRubrica<LinhaDeFiname, VeiculoDeFiname> = {
  rubrica: "FINAME",
  destaque: "Parcela",
  agrupamento: AGRUPAMENTO_DE_FINAME,
  escreverValor,
  escreverDiferenca,
  escreverVariacao,
  corDaDiferenca,
  selo: SELO_DO_ESTADO,
  rotuloDoEstado: ROTULO_DO_ESTADO,
  colunasDoVeiculo: [
    {
      titulo: "Período FINAME",
      direita: true,
      celula: (v) => escreverPeriodo(v.periodoFiname),
    },
    {
      titulo: "Data de cadastro",
      direita: true,
      celula: (v) => escreverDataDeCadastro(v.dataDeCadastro),
    },
    { titulo: "Fim do contrato", direita: true, celula: (v) => <FimDoContrato veiculo={v} /> },
  ],
  /* O fim do contrato saiu da expansão para a coluna, e repeti-lo lá seria
     mostrá-lo duas vezes na mesma linha. */
  foraDaExpansao: ["data_fim_contrato"],
};

export function TabelaDeFiname({
  veiculos,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  veiculos: VeiculoDeFiname[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (veiculo: { entityLabel: string | null; entityType: string }) => void;
  /** Ausente, a coluna fica só de leitura. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <TabelaPorVeiculo
      veiculos={veiculos}
      escrita={ESCRITA_DO_FINAME}
      justificadaPor={justificadaPor}
      onAbrir={onAbrir}
      onJustificar={onJustificar}
    />
  );
}

/**
 * O fim do contrato da placa — com a ponta anterior no tooltip, quando mudou.
 *
 * Mover-se é o caso comum aqui, porque o contrato que acabou é justamente o que
 * a tela está lendo. O tooltip é o que permite tirar a linha da expansão sem
 * perder o "de": a coluna diz onde o contrato termina hoje, e quem precisa do
 * valor antigo o encontra sem abrir nada.
 */
function FimDoContrato({ veiculo: v }: { veiculo: VeiculoDeFiname }) {
  const linhaDoFim = v.linhas.find((l) => l.variavel === "data_fim_contrato") ?? null;
  const fim = v.fimDoContrato ?? linhaDoFim?.comparada ?? linhaDoFim?.base ?? null;
  const anterior =
    linhaDoFim?.estado === "ALTERADO" && linhaDoFim.base !== linhaDoFim.comparada
      ? linhaDoFim.base
      : null;

  if (anterior === null) return <>{escreverDataDeCadastro(fim)}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="underline decoration-dotted underline-offset-2">
          {escreverDataDeCadastro(fim)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-xs">
        {`Fim do contrato: de ${escreverDataDeCadastro(anterior)} para ${escreverDataDeCadastro(
          fim,
        )}`}
      </TooltipContent>
    </Tooltip>
  );
}
