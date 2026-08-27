import type { FluxoDeclarado } from "../modelo";
import { CTE_ATE_RECEBIMENTO } from "./cte-ate-recebimento";
import { NF_ATE_PAGAMENTO } from "./nf-ate-pagamento";
import { OPERACAO_EMPURRADA } from "./operacao-empurrada";

/**
 * Os modelos de fluxo que acompanham o produto — e o que os separa.
 *
 * `semeado: true` significa "esta instalação começa com ele". Hoje é um só, o
 * do CTe, porque foi o pedido. Os demais aparecem na tela como ponto de partida
 * para quem quiser, e não entram sozinhos: semear processos que não são da
 * empresa seria poluir o cadastro dela com material de demonstração.
 *
 * Acrescentar um modelo é acrescentar um arquivo de dado ao lado destes e uma
 * linha nesta lista. Nada além.
 */
export interface ModeloDeFluxo {
  declarado: FluxoDeclarado;
  /** Entra na semeadura automática da instalação? */
  semeado: boolean;
  /** A frase que a tela mostra ao oferecer o modelo. */
  resumo: string;
}

export const MODELOS: readonly ModeloDeFluxo[] = [
  {
    declarado: CTE_ATE_RECEBIMENTO,
    semeado: true,
    resumo: "Da negociação com o cliente ao dinheiro conciliado no extrato.",
  },
  {
    declarado: NF_ATE_PAGAMENTO,
    semeado: false,
    resumo: "Da chegada da nota do fornecedor à baixa do pagamento.",
  },
  {
    declarado: OPERACAO_EMPURRADA,
    semeado: false,
    resumo:
      "O macrofluxo da operação empurrada: origem da tarifa, emissão, integrações em paralelo, pendências e conciliação.",
  },
];

export { CTE_ATE_RECEBIMENTO, NF_ATE_PAGAMENTO, OPERACAO_EMPURRADA };
