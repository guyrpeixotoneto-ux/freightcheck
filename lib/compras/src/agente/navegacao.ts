/**
 * Os atalhos que levam da resposta até a origem dela.
 *
 * Uma resposta do Agente de Compras cita um valor remunerado, uma vigência e um
 * item do catálogo. Cada uma dessas três coisas **existe numa tela** deste
 * produto, e o que este arquivo monta é o caminho até lá — "Ver remuneração",
 * "Abrir item", "Ver composição", "Ver histórico".
 *
 * **Por que os endereços moram aqui e não na tela.** Porque quem sabe o que a
 * resposta citou é quem a montou. A alternativa seria a tela reconstruir os
 * links a partir do texto, o que é adivinhar: o mesmo botão "Ver remuneração"
 * teria de apontar para a matriz numa resposta de frota e para o quadro numa de
 * QLP, e a diferença não está no texto — está no produto que a resposta usou.
 *
 * Os endereços não levam prefixo de ambiente, como os da lateral: quem põe
 * `/auditoria-rota` na frente é o roteador aninhado do wouter. Ver o cabeçalho
 * de `nav-auditoria.ts`.
 */

import type { ProdutoDeCompra } from "../catalogo";

/** Um atalho da resposta para a tela que sustenta o que ela disse. */
export interface Atalho {
  /** O que o botão diz. Vocabulário fechado — ver {@link ROTULO_DO_ATALHO}. */
  tipo: TipoDeAtalho;
  rotulo: string;
  href: string;
  /** O que se encontra lá, numa frase. */
  porque: string;
}

export type TipoDeAtalho =
  | "REMUNERACAO"
  | "ITEM"
  | "COMPOSICAO"
  | "HISTORICO"
  | "ALTERACAO"
  | "VIGENCIA"
  | "FORNECEDOR"
  | "COTACAO";

export const ROTULO_DO_ATALHO: Record<TipoDeAtalho, string> = {
  REMUNERACAO: "Ver remuneração",
  ITEM: "Abrir item",
  COMPOSICAO: "Ver composição",
  HISTORICO: "Ver histórico",
  ALTERACAO: "Abrir alteração",
  VIGENCIA: "Ver vigência",
  FORNECEDOR: "Ver fornecedor",
  COTACAO: "Ver cotação",
};

function com(base: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== null && valor !== undefined && valor !== "") q.set(chave, valor);
  }
  const texto = q.toString();
  return texto === "" ? base : `${base}?${texto}`;
}

/**
 * Os atalhos de uma resposta sobre um item.
 *
 * A aba do Remunerado sai do balcão do produto, e não de um padrão: mandar quem
 * perguntou de uniforme para a aba da frota o faria procurar uma placa para um
 * item que não tem nenhuma.
 */
export function atalhosDoItem(
  produto: ProdutoDeCompra,
  contexto: { placa?: string | null; period?: string | null } = {},
): Atalho[] {
  const aba =
    produto.balcao === "FROTA"
      ? "frota"
      : produto.balcao === "QLP_ADMINISTRATIVO"
        ? "qlp"
        : "qlp-operacional";

  const atalhos: Atalho[] = [
    {
      tipo: "REMUNERACAO",
      rotulo: ROTULO_DO_ATALHO.REMUNERACAO,
      href: com("/remunerado", { aba, period: contexto.period }),
      porque: "O que a Ambev remunera neste balcão, na vigência lida.",
    },
    {
      tipo: "ITEM",
      rotulo: ROTULO_DO_ATALHO.ITEM,
      href: com("/remunerado", {
        aba,
        visao: "produto",
        produto: produto.chave,
        period: contexto.period,
      }),
      porque: `${produto.rotulo}, item a item, com a régua e o que ficou de fora.`,
    },
  ];

  if (contexto.placa) {
    atalhos.push({
      tipo: "COMPOSICAO",
      rotulo: ROTULO_DO_ATALHO.COMPOSICAO,
      href: com("/remunerado", { aba: "frota", placa: contexto.placa, period: contexto.period }),
      porque: `A ficha da placa ${contexto.placa}, coluna a coluna.`,
    });
  }

  atalhos.push(
    {
      tipo: "HISTORICO",
      rotulo: ROTULO_DO_ATALHO.HISTORICO,
      href: com("/alteracoes", { busca: produto.parametros[0] ?? produto.rotulo }),
      porque: "O que mudou nesta rubrica entre vigências, e quanto custou.",
    },
    {
      tipo: "VIGENCIA",
      rotulo: ROTULO_DO_ATALHO.VIGENCIA,
      href: "/vigencias",
      porque: "As vigências deste acervo e o que cada uma trouxe.",
    },
  );

  return atalhos;
}

/** O atalho para uma cotação, dentro da própria tela do agente. */
export function atalhoDaCotacao(id: string, fornecedor: string): Atalho {
  return {
    tipo: "COTACAO",
    rotulo: ROTULO_DO_ATALHO.COTACAO,
    href: com("/agente-compras", { cotacao: id }),
    porque: `A proposta de ${fornecedor}, como foi registrada.`,
  };
}

/** O atalho para tudo o que um fornecedor cotou. */
export function atalhoDoFornecedor(fornecedor: string): Atalho {
  return {
    tipo: "FORNECEDOR",
    rotulo: ROTULO_DO_ATALHO.FORNECEDOR,
    href: com("/agente-compras", { fornecedor }),
    porque: `As propostas de ${fornecedor} registradas neste acervo.`,
  };
}
