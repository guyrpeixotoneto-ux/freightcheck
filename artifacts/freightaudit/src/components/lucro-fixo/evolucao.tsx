import { TrendingUp } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_LUCRO_FIXO,
  codigosDoRecorteDeLucroFixo,
} from "@workspace/comparison/lucro-fixo";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de lucro fixo na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * A coluna do conjunto fica fora daqui, como fica fora de toda soma: ela
 * embute a parcela do cavalo vinculado, e acompanhá-la ao lado da parcela
 * própria contaria o mesmo dinheiro nas duas placas, mês a mês.
 */
export const EVOLUCAO_DO_LUCRO_FIXO: RubricaDaEvolucao = {
  nome: "lucro fixo",
  icone: TrendingUp,
  idPrefixo: "lucro-fixo",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_LUCRO_FIXO,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeLucroFixo(recorte),
  leitura: {
    titulo: "Variação do lucro fixo por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "ciclo, ano",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo lucro fixo em todos os veículos. Troque o ano ou o equipamento.`,
};
