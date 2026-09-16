import { Landmark } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_IMPOSTOS,
  codigosDoRecorteDeImpostos,
} from "@workspace/comparison/impostos";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de impostos na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * As alíquotas declaradas viajam junto e contam como alteração, mas nunca
 * viram reais: o dinheiro do intervalo é o dos montantes. E o montante de ICMS
 * vem zerado no acervo inteiro — o que se move aqui, na prática, é o PIS/COFINS
 * da compra.
 */
export const EVOLUCAO_DOS_IMPOSTOS: RubricaDaEvolucao = {
  nome: "impostos",
  icone: Landmark,
  idPrefixo: "impostos",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_IMPOSTOS,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeImpostos(recorte),
  leitura: {
    titulo: "Variação dos impostos por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "ICMS declarado, PIS/COFINS declarado",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm os mesmos impostos em todos os veículos. Troque o ano ou o equipamento.`,
};
