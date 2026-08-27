import type { FluxoDeclarado } from "../modelo";

/**
 * "NF até pagamento" — o teste arquitetural, escrito como dado.
 *
 * Este arquivo existe por uma razão só: provar que o segundo fluxo não custa
 * nada. Ele é de outro domínio (contas a pagar, não faturamento), tem outro
 * dono, outra categoria, outros sistemas e outra forma de grafo — e não exigiu
 * uma tabela, uma rota, um componente ou um tipo novo. É montado pelas mesmas
 * funções que o do CTe, e é isso que `__tests__/motor-generico.test.ts` afirma.
 *
 * **Não é semeado por padrão.** Ele nasce na tela de exemplos, para quem quiser
 * partir de algo, e no teste. Encher a instalação de alguém com processos que
 * não são dela seria o inverso do que este módulo promete.
 */
export const NF_ATE_PAGAMENTO: FluxoDeclarado = {
  nome: "NF até pagamento",
  slug: "nf-ate-pagamento",
  categoria: "Financeiro",
  status: "RASCUNHO",
  dono: "Contas a pagar",
  descricao:
    "O caminho de uma nota fiscal de fornecedor: da chegada do documento até a baixa do pagamento.",
  objetivo: "Mostrar onde uma NF de entrada trava entre o recebimento e o pagamento.",
  etapas: [
    {
      chave: "recebimento-nf",
      nome: "Recebimento da NF",
      tipo: "INICIO",
      ordem: 0,
      area: "Suprimentos",
      objetivo: "Receber e registrar a nota do fornecedor.",
      itens: [
        { especie: "SISTEMA", nome: "ERP" },
        { especie: "DOCUMENTO", nome: "XML da NF-e", obrigatorio: true },
        { especie: "FALHA", nome: "NF sem pedido de compra" },
      ],
    },
    {
      chave: "conferencia",
      nome: "Conferência contra o pedido",
      tipo: "VALIDACAO",
      ordem: 1,
      area: "Suprimentos",
      objetivo: "Casar quantidade, preço e condição com o pedido de compra.",
      itens: [
        { especie: "FALHA", nome: "Valor divergente do pedido" },
        { especie: "GARGALO", nome: "Conferência manual" },
      ],
    },
    {
      chave: "decisao-conferencia",
      nome: "Conferiu?",
      tipo: "DECISAO",
      ordem: 2,
      area: "Suprimentos",
    },
    {
      chave: "divergencia",
      nome: "Tratamento de divergência",
      tipo: "PENDENCIA",
      ordem: 3,
      area: "Suprimentos",
      status: "ATENCAO",
      objetivo: "Negociar com o fornecedor a correção ou a nota de ajuste.",
      itens: [{ especie: "GARGALO", nome: "Dependência do fornecedor" }],
    },
    {
      chave: "aprovacao",
      nome: "Aprovação de pagamento",
      tipo: "PROCESSO",
      ordem: 4,
      area: "Financeiro",
      objetivo: "Obter o aceite de quem tem alçada para pagar.",
      itens: [{ especie: "GARGALO", nome: "Demora de aprovação" }],
    },
    {
      chave: "pagamento",
      nome: "Pagamento",
      tipo: "PROCESSO",
      ordem: 5,
      area: "Financeiro",
      itens: [
        { especie: "SISTEMA", nome: "Banco" },
        { especie: "DOCUMENTO", nome: "Comprovante bancário", obrigatorio: true },
      ],
    },
    {
      chave: "baixa",
      nome: "Baixa no contas a pagar",
      tipo: "FIM",
      ordem: 6,
      area: "Financeiro",
    },
  ],
  conexoes: [
    { de: "recebimento-nf", para: "conferencia" },
    { de: "conferencia", para: "decisao-conferencia" },
    { de: "decisao-conferencia", para: "aprovacao", tipo: "DECISAO_SIM", rotulo: "Sim" },
    { de: "decisao-conferencia", para: "divergencia", tipo: "DECISAO_NAO", rotulo: "Não" },
    { de: "divergencia", para: "conferencia", tipo: "RETRABALHO", rotulo: "Corrigido" },
    { de: "aprovacao", para: "pagamento" },
    { de: "pagamento", para: "baixa" },
  ],
};
