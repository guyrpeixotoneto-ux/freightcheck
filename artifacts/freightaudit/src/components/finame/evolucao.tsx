import { Banknote } from "lucide-react";
import {
  CODIGOS_DA_TABELA,
  codigosDoRecorte,
} from "@workspace/comparison/finame";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de FINAME na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas de custo
 * fixo. Daqui saem o nome, o ícone, os códigos de atributo e as palavras.
 *
 * A rubrica é a tabela de frete, e não a despesa da casa: quando
 * `cavalo.finame_cavalo` cai de R$ 10.578,03 para R$ 0, o impacto é −10.578,03
 * porque é isso que deixa de entrar.
 */
export const EVOLUCAO_DO_FINAME: RubricaDaEvolucao = {
  nome: "FINAME",
  icone: Banknote,
  idPrefixo: "finame",
  codigosDaTabela: CODIGOS_DA_TABELA,
  codigosDoRecorte: (recorte) => codigosDoRecorte(recorte),
  leitura: {
    titulo: "Variação do FINAME por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "taxa, prazo, carência",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo financiamento em todos os veículos. Troque o ano ou o equipamento.`,
};
