import { Wrench } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_MANUTENCAO,
  codigosDoRecorteDeManutencao,
} from "@workspace/comparison/manutencao";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de Manutenção na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira mora em `comparacao/evolucao/painel.tsx`, com as outras
 * rubricas.
 *
 * **Aqui a matriz é quase toda "sem valoração", e isso é honesto.** R$/km, meses
 * e percentual não viram reais, e o motor não os precifica: a coluna do mês
 * mostra que houve alteração e recusa escrever um valor. Uma matriz que
 * mostrasse R$ 0,00 no lugar afirmaria que o contrato mudou e não custou nada.
 */
export const EVOLUCAO_DA_MANUTENCAO: RubricaDaEvolucao = {
  nome: "manutenção",
  icone: Wrench,
  idPrefixo: "manutencao",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_MANUTENCAO,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeManutencao(recorte),
  leitura: {
    titulo: "Variação da manutenção por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "R$/km, vida em meses, free maintenance e reajuste",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo contrato de manutenção em todos os caminhões. Troque o ano ou o ` +
    `equipamento.`,
};
