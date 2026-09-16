import { ShieldCheck } from "lucide-react";
import {
  CODIGOS_DA_TABELA_DE_SEGURO,
  codigosDoRecorteDeSeguro,
} from "@workspace/comparison/seguro";
import type { RubricaDaEvolucao } from "@/components/comparacao/evolucao/painel";

/**
 * A Auditoria de Seguro e Aparato na aba Evolução — o que só ela tem a dizer.
 *
 * A tela inteira (a matriz, os cartões, o seletor de ano, a gaveta da placa)
 * mora em `comparacao/evolucao/painel.tsx`, com as outras rubricas.
 *
 * O `custo_fixo` e o `custo_aluguel` ficam fora daqui, como ficam fora de toda
 * soma: o primeiro é total e já contém FINAME e lucro fixo; o segundo é outro
 * contrato. Acompanhá-los ao longo do ano ao lado do aparato somaria o mesmo
 * dinheiro duas vezes, mês a mês.
 */
export const EVOLUCAO_DO_SEGURO: RubricaDaEvolucao = {
  nome: "seguro e aparato",
  icone: ShieldCheck,
  idPrefixo: "seguro",
  codigosDaTabela: CODIGOS_DA_TABELA_DE_SEGURO,
  codigosDoRecorte: (recorte) => codigosDoRecorteDeSeguro(recorte),
  leitura: {
    titulo: "Variação do aparato por veículo ao longo do ano",
    acumulado: "Variação no ano",
  },
  semValoracao: "nenhuma — as cinco colunas são dinheiro",
  descricaoSemMovimento: (colunas) =>
    `As ${colunas} ${colunas === 1 ? "vigência comparada" : "vigências comparadas"} deste ` +
    `recorte têm o mesmo aparato em todas as carretas. Três das cinco colunas são taxa fixa, ` +
    `então este é o resultado esperado — troque o ano ou o equipamento.`,
};
