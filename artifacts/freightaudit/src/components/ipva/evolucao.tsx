import { Receipt } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_IPVA,
  codigosDoRecorteDeIpva,
} from "@workspace/comparison/ipva";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de IPVA na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * Os códigos são os da tabela, e não os do detalhe: a coluna "mensal" da
 * carreta fica fora daqui como fica fora de toda soma — ela não é 1/12 da anual,
 * e somá-la ao longo do ano multiplicaria um número que ninguém sabe o que é.
 */
export const EVOLUCAO_DO_IPVA: RubricaDaEvolucao = {
  nome: "IPVA",
  icone: Receipt,
  idPrefixo: "ipva",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_IPVA,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeIpva(recorte),
  leitura: {
    titulo: "Variação do IPVA por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "ano, data de entrada",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo IPVA em todos os veículos. Troque o ano ou o equipamento.`,
};
