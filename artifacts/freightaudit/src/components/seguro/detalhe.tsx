import type { LinhaDeSeguro } from "@workspace/comparison/seguro";
import { VARIAVEIS_DE_DETALHE_DE_SEGURO } from "@workspace/comparison/seguro";
import {
  DetalheDoVeiculo as Gaveta,
  type DetalheDaRubrica,
} from "@/components/comparacao/detalhe-do-veiculo";
import { ESCRITA_DO_SEGURO } from "@/components/seguro/tabela";
import { escreverDiferenca, escreverValor } from "@/lib/seguro";

/**
 * O diagnóstico de uma carreta — regras determinísticas, nunca texto gerado.
 *
 * Cada frase sai de uma comparação sobre os deltas que o motor já gravou. Uma
 * placa em que nada se moveu não recebe frase nenhuma: inventar uma seria ruído
 * com cara de achado.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeSeguro[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const seguro = por("seguro");
  if (seguro && seguro.estado === "ALTERADO" && seguro.diferenca !== null) {
    const direcao = seguro.diferenca > 0 ? "subiu" : "caiu";
    frases.push(
      `O seguro ${direcao} ${semSinal(escreverDiferenca(seguro.diferenca, "DINHEIRO"))} — de ` +
        `${escreverValor(seguro.base, "DINHEIRO")} para ` +
        `${escreverValor(seguro.comparada, "DINHEIRO")}. É a única coluna desta rubrica ` +
        `negociada por ativo, então esta é uma mudança desta carreta, e não da tabela.`,
    );
  }

  /*
    As três taxas se movem em bloco. Dizer isso aqui é o que impede alguém de
    abrir uma placa, ver "revestimento +R$ 12,00" e abrir um chamado sobre ela:
    se mudou numa, mudou em todas.
  */
  const taxas = (["revestimento", "faixa_reflexiva", "tacografo"] as const)
    .map((chave) => por(chave))
    .filter((l): l is LinhaDeSeguro => l !== undefined && l.estado === "ALTERADO");
  if (taxas.length > 0) {
    const nomes = taxas.map((l) => l.rotuloDaVariavel.toLowerCase()).join(", ");
    frases.push(
      `Mudou também ${nomes} — ${taxas.length === 1 ? "essa é taxa" : "essas são taxas"} com ` +
        `um valor só para a frota inteira. Se mudou aqui, mudou em todas as carretas da ` +
        `vigência: é alteração de tabela, não negociação desta placa.`,
    );
  }

  const tacografo = por("tacografo");
  if (tacografo && Number(tacografo.comparada) === 0 && Number(tacografo.base) !== 0) {
    frases.push(
      "O tacógrafo deixou de ser tarifado nesta carreta. É o único zero desta rubrica que " +
        "convive com valor na mesma coluna — 99 das 657 linhas do acervo estão assim —, " +
        "então ele é um caso, e não ausência de dado.",
    );
  }

  const rastreador = por("rastreador");
  if (rastreador) {
    frases.push(
      "O rastreador chega zerado, como em todas as 657 linhas do acervo. É coluna sem dado, " +
        "não rastreamento gratuito — e por isso ele não entra em soma nenhuma desta tela.",
    );
  }

  const custoFixo = por("custo_fixo");
  if (custoFixo && custoFixo.estado === "ALTERADO" && custoFixo.diferenca !== null) {
    const direcao = custoFixo.diferenca > 0 ? "subiu" : "caiu";
    frases.push(
      `O custo fixo declarado ${direcao} ` +
        `${semSinal(escreverDiferenca(custoFixo.diferenca, "DINHEIRO"))}, mas isso não é ` +
        `desta rubrica: ele é FINAME mais lucro fixo, e o aparato desta tela não está ` +
        `dentro dele. Quem move o custo fixo é uma daquelas duas parcelas.`,
    );
  }

  return frases;
}

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "o seguro caiu +R$ 15,00" foi o
 * defeito que a tela de FINAME mostrou na primeira renderização sobre dado real.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

const DETALHE_DO_SEGURO: DetalheDaRubrica<LinhaDeSeguro> = {
  diagnostico: diagnosticoDoVeiculo,
  notaDoDiagnostico:
    "Regras determinísticas sobre os deltas gravados pelo motor. Nenhuma frase é gerada, e " +
    "nenhuma soma é feita aqui.",
  chavesDeDetalhe: VARIAVEIS_DE_DETALHE_DE_SEGURO.map((v) => v.chave),
  aviso: (
    <>
      <strong className="font-semibold">
        O custo fixo do conjunto está aqui para ser conferido, não para ser somado.
      </strong>{" "}
      Ele é total — em 657 de 657 linhas do acervo é FINAME mais lucro fixo, ao centavo —, e o
      aparato desta tela não está dentro dele. O rastreador também não soma: é zero em todas as
      linhas, e um total que o inclui afirma que rastrear custa R$ 0,00.
    </>
  ),
};

/** O detalhe de uma carreta — as variáveis lado a lado, na mesma gaveta. */
export function DetalheDoVeiculo({
  veiculo,
  linhas,
  rotuloBase,
  rotuloComparada,
  onFechar,
}: {
  veiculo: { entityLabel: string | null; entityType: string } | null;
  linhas: LinhaDeSeguro[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  return (
    <Gaveta
      veiculo={veiculo}
      linhas={linhas}
      escrita={ESCRITA_DO_SEGURO}
      detalhe={DETALHE_DO_SEGURO}
      rotuloBase={rotuloBase}
      rotuloComparada={rotuloComparada}
      onFechar={onFechar}
    />
  );
}
