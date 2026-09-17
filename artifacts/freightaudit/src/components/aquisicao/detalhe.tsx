import type { LinhaDeAquisicao } from "@workspace/comparison/aquisicao";
import { VARIAVEIS_DE_DETALHE_DE_AQUISICAO } from "@workspace/comparison/aquisicao";
import {
  DetalheDoVeiculo as Gaveta,
  type DetalheDaRubrica,
} from "@/components/comparacao/detalhe-do-veiculo";
import { ESCRITA_DA_AQUISICAO } from "@/components/aquisicao/tabela";
import { escreverData, escreverDiferenca, escreverValor } from "@/lib/aquisicao";

/**
 * O diagnóstico de uma placa — regras determinísticas, nunca texto gerado.
 *
 * Cada frase sai de uma comparação sobre os deltas que o motor já gravou. Uma
 * placa em que nada se moveu não recebe frase nenhuma: inventar uma seria ruído
 * com cara de achado — e nesta rubrica, em que o normal é nada se mover, seria
 * ruído em quase toda gaveta.
 */
export function diagnosticoDoVeiculo(linhas: readonly LinhaDeAquisicao[]): string[] {
  const frases: string[] = [];
  const por = (chave: string) => linhas.find((l) => l.variavel === chave);

  const veiculo = por("veiculo");
  const nota = por("valor_nf");

  if (veiculo && veiculo.estado === "NOVO_NA_VIGENCIA") {
    frases.push(
      `Esta placa entrou na frota nesta vigência${
        nota?.comparada
          ? `, com nota de ${escreverValor(nota.comparada, "DINHEIRO")}`
          : ""
      }. É a única forma pela qual uma nota nova entra no acervo — e ela entra sem ` +
        `ter passado por conferência nenhuma, porque não há vigência anterior com que ` +
        `compará-la.`,
    );
  }

  if (veiculo && veiculo.estado === "AUSENTE_NA_COMPARADA") {
    frases.push(
      "Esta placa saiu da frota. A nota dela deixa de compor o valor da frota na vigência " +
        "comparada, e as rubricas que saem dessa nota — IPVA, ICMS, PIS/COFINS e FINAME — " +
        "saem junto.",
    );
  }

  if (nota && nota.estado === "ALTERADO" && nota.diferenca !== null) {
    const direcao = nota.diferenca > 0 ? "subiu" : "caiu";
    frases.push(
      `O valor de nota ${direcao} ${semSinal(escreverDiferenca(nota.diferenca, "DINHEIRO"))} — ` +
        `de ${escreverValor(nota.base, "DINHEIRO")} para ` +
        `${escreverValor(nota.comparada, "DINHEIRO")}. Uma nota que se mexe é sempre ` +
        `assunto: ela é a base do PIS/COFINS, do ICMS, do IPVA do cavalo e do que o ` +
        `FINAME financia, e no acervo inteiro nenhuma placa tinha feito isso até agora.`,
    );
  }

  if (nota && Number(nota.comparada) === 0 && Number(nota.base) !== 0) {
    frases.push(
      "A nota desta placa zerou. Nota zerada, neste acervo, é frota alugada — não foi " +
        "comprada —, e não lacuna de cadastro. Vale conferir se o custo de aluguel apareceu " +
        "na mesma vigência.",
    );
  }

  const entrada = por("percentual_entrada");
  if (entrada && entrada.estado === "ALTERADO" && entrada.diferenca !== null) {
    frases.push(
      `O percentual de entrada mudou ` +
        `${semSinal(escreverDiferenca(entrada.diferenca, "PERCENTUAL"))}. Ele é constante do ` +
        `modelo — 20% em todos os ativos comprados do acervo —, então uma placa que sai ` +
        `dessa constante é exceção declarada ou erro de cadastro.`,
    );
  }

  const data = por("data_de_entrada");
  if (data && data.estado === "ALTERADO") {
    frases.push(
      `A data de entrada mudou de ${escreverData(data.base)} para ` +
        `${escreverData(data.comparada)}. O ano e o mês de entrada são derivados dela: se um ` +
        `deles não acompanhou a mudança, o cadastro desta placa ficou inconsistente consigo ` +
        `mesmo.`,
    );
  }

  return frases;
}

/**
 * Um valor absoluto, sem o sinal que a frase já diz.
 *
 * `escreverDiferenca` carimba o sinal de propósito — numa coluna de números ele
 * é a única coisa que separa uma alta de uma queda. Na frase, a direção já está
 * na palavra, e o sinal volta como contradição: "a nota caiu +R$ 1.570,00" foi o
 * defeito que a tela de FINAME mostrou na primeira renderização sobre dado real.
 */
function semSinal(texto: string): string {
  return texto.replace(/^[+−-]/, "");
}

const DETALHE_DA_AQUISICAO: DetalheDaRubrica<LinhaDeAquisicao> = {
  diagnostico: diagnosticoDoVeiculo,
  notaDoDiagnostico:
    "Regras determinísticas sobre os deltas gravados pelo motor. Nenhuma frase é gerada, e " +
    "nenhuma soma é feita aqui.",
  chavesDeDetalhe: VARIAVEIS_DE_DETALHE_DE_AQUISICAO.map((v) => v.chave),
  aviso: (
    <>
      <strong className="font-semibold">
        O ano e o mês de entrada são a data de entrada, escrita de novo.
      </strong>{" "}
      São o ano e o mês dela em 558 de 558 linhas do cavalo e 1.314 de 1.314 da carreta — três
      colunas para um fato só —, e por isso ficam fora de toda soma e de toda contagem de
      alteração. O percentual de entrada também não soma: é alíquota, não reais.
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
  linhas: LinhaDeAquisicao[];
  rotuloBase: string;
  rotuloComparada: string;
  onFechar: () => void;
}) {
  return (
    <Gaveta
      veiculo={veiculo}
      linhas={linhas}
      escrita={ESCRITA_DA_AQUISICAO}
      detalhe={DETALHE_DA_AQUISICAO}
      rotuloBase={rotuloBase}
      rotuloComparada={rotuloComparada}
      onFechar={onFechar}
    />
  );
}
