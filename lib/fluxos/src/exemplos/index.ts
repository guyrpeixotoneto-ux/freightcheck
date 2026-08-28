import type { FluxoDeclarado } from "../modelo";
import { CTE_ATE_RECEBIMENTO } from "./cte-ate-recebimento";
import { NF_ATE_PAGAMENTO } from "./nf-ate-pagamento";
import { OPERACAO_EMPURRADA } from "./operacao-empurrada";

/**
 * Os fluxos que acompanham o produto — e o que separa um mapa de um modelo.
 *
 * Há duas coisas diferentes nesta lista, e confundi-las é o que deixava a tela
 * errada. Um **modelo** é ponto de partida: um processo realista de transporte,
 * escrito para quem quer começar de algo e adaptar. Um **processo já mapeado**
 * (`jaMapeado: true`) é o levantamento da própria empresa, feito em reunião e
 * cadastrado como dado — ele não é oferecido como sugestão, ele é o mapa dela,
 * e por isso entra na lista de fluxos sozinho, sem ninguém precisar clicar em
 * "usar modelo" para ter de volta o que já foi levantado.
 *
 * Hoje só a "Operação Empurrada" é `jaMapeado`. Os dois de exemplo continuam
 * fora da semeadura: semear processos que não são da empresa seria poluir o
 * cadastro dela com material de demonstração.
 *
 * Acrescentar um dos dois é acrescentar um arquivo de dado ao lado destes e uma
 * linha nesta lista. Nada além.
 */
export interface ModeloDeFluxo {
  declarado: FluxoDeclarado;
  /**
   * É o processo levantado da própria empresa — e não um exemplo?
   *
   * Quando verdadeiro, ele é semeado na lista da empresa na primeira vez que a
   * tela de fluxos abre, e deixa de aparecer entre os modelos oferecidos: um
   * mapa que a empresa já tem não é uma sugestão a ser aceita.
   */
  jaMapeado: boolean;
  /** A frase que a tela mostra ao oferecer o modelo. */
  resumo: string;
}

export const MODELOS: readonly ModeloDeFluxo[] = [
  {
    declarado: CTE_ATE_RECEBIMENTO,
    jaMapeado: false,
    resumo: "Da negociação com o cliente ao dinheiro conciliado no extrato.",
  },
  {
    declarado: NF_ATE_PAGAMENTO,
    jaMapeado: false,
    resumo: "Da chegada da nota do fornecedor à baixa do pagamento.",
  },
  {
    declarado: OPERACAO_EMPURRADA,
    jaMapeado: true,
    resumo:
      "O macrofluxo da operação empurrada: origem da tarifa, emissão, integrações em paralelo, pendências e conciliação.",
  },
];

export { CTE_ATE_RECEBIMENTO, NF_ATE_PAGAMENTO, OPERACAO_EMPURRADA };
