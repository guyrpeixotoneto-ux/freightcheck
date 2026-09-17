import type { LinhaDeAluguel } from "@workspace/comparison/aluguel";
import { VARIAVEIS_DE_DETALHE_DE_ALUGUEL } from "@workspace/comparison/aluguel";
import {
  DetalheDoVeiculo as Gaveta,
  type DetalheDaRubrica,
} from "@/components/comparacao/detalhe-do-veiculo";
import { ESCRITA_DO_ALUGUEL } from "@/components/aluguel/tabela";
import { escreverDiferenca, escreverValor } from "@/lib/aluguel";

/**
 * O diagnóstico de uma placa — regras determinísticas, nunca texto gerado.
 *
 * Cada frase sai de uma comparação sobre os deltas que o motor já gravou. Uma
 * placa em que nada se moveu não recebe frase nenhuma: inventar uma seria ruído
 * com cara de achado.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeAluguel[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const aluguel = por("aluguel");
  const parcela = por("parcela_finame");
  const veiculo = por("veiculo");

  if (aluguel && aluguel.estado === "ALTERADO" && aluguel.diferenca !== null) {
    const direcao = aluguel.diferenca > 0 ? "subiu" : "caiu";
    frases.push(
      `O aluguel ${direcao} ${semSinal(escreverDiferenca(aluguel.diferenca, "DINHEIRO"))} ` +
        `por mês — de ${escreverValor(aluguel.base, "DINHEIRO")} para ` +
        `${escreverValor(aluguel.comparada, "DINHEIRO")}. É contrato de locação deste ` +
        `implemento, negociado por ativo: mudou aqui, mudou nesta placa, e não numa ` +
        `tabela que vale para a frota.`,
    );
  }

  if (aluguel && parcela && aluguel.estado === "ALTERADO") {
    frases.push(
      "A parcela FINAME desta placa muda junto, e pelo mesmo valor: nos implementos " +
        "alugados ela é o aluguel. Por isso a parcela sai do total da Auditoria de " +
        "FINAME quando esta linha se move — as duas são o mesmo dinheiro, e quem o soma " +
        "é esta tela.",
    );
  }

  const virouAlugado =
    aluguel && Number(aluguel.base ?? 0) === 0 && Number(aluguel.comparada ?? 0) > 0;
  if (virouAlugado) {
    frases.push(
      `Este implemento passou a ser alugado nesta vigência: não tinha aluguel na base e ` +
        `passou a ter ${escreverValor(aluguel.comparada, "DINHEIRO")} por mês. Vale ` +
        `conferir se a amortização e os juros dele zeraram na mesma vigência — no ` +
        `alugado, o custo inteiro está no aluguel.`,
    );
  }

  const deixouDeSerAlugado =
    aluguel && Number(aluguel.base ?? 0) > 0 && Number(aluguel.comparada ?? 0) === 0;
  if (deixouDeSerAlugado) {
    frases.push(
      "Este implemento deixou de declarar aluguel. Ou ele saiu do contrato de locação, " +
        "ou passou a ser financiado — e nos dois casos a parcela FINAME dele muda de " +
        "natureza, ainda que o valor se pareça.",
    );
  }

  if (veiculo && veiculo.estado === "NOVO_NA_VIGENCIA" && aluguel?.comparada) {
    frases.push(
      `Esta placa entrou na frota já alugada, a ${escreverValor(
        aluguel.comparada,
        "DINHEIRO",
      )} por mês. É custo mensal novo que entra no acervo sem vigência anterior com que ` +
        `ser comparado.`,
    );
  }

  return frases;
}

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "o aluguel caiu +R$ 300,00" foi
 * o defeito que a tela de FINAME mostrou na primeira renderização sobre dado
 * real.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

const DETALHE_DO_ALUGUEL: DetalheDaRubrica<LinhaDeAluguel> = {
  diagnostico: diagnosticoDoVeiculo,
  notaDoDiagnostico:
    "Regras determinísticas sobre os deltas gravados pelo motor. Nenhuma frase é gerada, e " +
    "nenhuma soma é feita aqui.",
  chavesDeDetalhe: VARIAVEIS_DE_DETALHE_DE_ALUGUEL.map((v) => v.chave),
  aviso: (
    <>
      <strong className="font-semibold">
        A parcela FINAME está aqui para conferir o aluguel, não para somar com ele.
      </strong>{" "}
      Nos implementos alugados as duas são o mesmo dinheiro — amortização e juros são zero, e a
      parcela é o aluguel ao centavo, em todas as linhas do acervo. Quem soma a parcela é a
      Auditoria de FINAME, e ela sai do total de lá quando o aluguel se move. O aluguel do
      cavalo também não soma: é zero em 558 de 558 linhas, com semântica presumida.
    </>
  ),
};

/** O detalhe de uma placa — as variáveis lado a lado, na mesma gaveta. */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeAluguel[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  return (
    <Gaveta
      veiculo={veiculo}
      linhas={linhas}
      escrita={ESCRITA_DO_ALUGUEL}
      detalhe={DETALHE_DO_ALUGUEL}
      rotuloBase={rotuloBase}
      rotuloComparada={rotuloComparada}
      onFechar={onFechar}
    />
  );
}
