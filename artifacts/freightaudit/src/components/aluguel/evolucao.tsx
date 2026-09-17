import { Key } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_ALUGUEL,
  codigosDoRecorteDeAluguel,
} from "@workspace/comparison/aluguel";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de Aluguel de Frota na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * ---------------------------------------------------------------------------
 * A coluna é uma só, e é da carreta
 * ---------------------------------------------------------------------------
 * `CODIGOS_DA_TABELA_DE_ALUGUEL` tem um código, `carreta.custo_aluguel`: a
 * rubrica é do implemento, e o aluguel do cavalo está fora de toda soma por ser
 * zero em 558 de 558 linhas com semântica presumida. Por isso o recorte de
 * dentro em Cavalo não traz linha nenhuma — como já acontece no Seguro, que
 * também é uma rubrica de carreta —, e a tela vazia diz isso por extenso em vez
 * de publicar uma matriz de zeros.
 *
 * A parcela FINAME não entra aqui pela mesma razão que não entra no catálogo da
 * comparação: ela é o que **confere** o aluguel, e não a rubrica. Somá-la ao
 * longo do ano contaria o mesmo dinheiro duas vezes nos alugados e traria a
 * frota financiada inteira para dentro de uma tela de locação.
 *
 * ---------------------------------------------------------------------------
 * A cor aqui é a do produto, e não a da comparação
 * ---------------------------------------------------------------------------
 * Nos cartões da comparação o aluguel é lido como despesa — subir é vermelho,
 * pela régua de `lib/aluguel.ts`. A matriz da evolução fala o idioma único do
 * produto (`LeituraDaMatriz`): positivo é mais dinheiro entrando, negativo é
 * menos. O sinal é o mesmo nos dois lugares; o que muda é a cor com que cada
 * metade da tela o lê, e nenhum número é tocado por isso.
 */
export const EVOLUCAO_DO_ALUGUEL: RubricaDaEvolucao = {
  nome: "aluguel de frota",
  icone: Key,
  idPrefixo: "aluguel",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_ALUGUEL,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeAluguel(recorte),
  leitura: {
    titulo: "Variação do aluguel por implemento ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "nenhuma — a única coluna da rubrica é dinheiro",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo aluguel em todos os implementos. A frota alugada é uma ` +
    `minoria e os contratos costumam atravessar o ano inteiros — troque o ano ou o ` +
    `equipamento.`,
};
