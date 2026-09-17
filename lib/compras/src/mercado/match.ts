/**
 * O MATCH — a oferta encontrada é mesmo o item pesquisado?
 *
 * É a pergunta que separa uma pesquisa de preço de uma armadilha. O pneu de
 * R$ 890 existe, o preço está certo, a página é real — e ele é 215/75 R17.5,
 * que não entra no cavalo. Apresentá-lo como "melhor cotação" seria a pior
 * resposta que este agente pode dar, porque ela é ao mesmo tempo verdadeira e
 * inútil.
 *
 * **A classificação é por regra, sobre atributos canônicos** — não por opinião
 * do modelo. `especificacao.ts` reconhece os atributos do item (medida, volume,
 * peso, norma) e o extrator reconhece os da oferta; aqui os dois conjuntos são
 * comparados. É por isso que o match é reprodutível: a mesma oferta contra a
 * mesma especificação cai sempre na mesma classe, e quem discordar consegue ver
 * qual atributo bateu e qual não.
 *
 * **Sem atributo na especificação não existe EXATO.** Uma busca por "Pneus", sem
 * medida, não tem como confirmar que a oferta é o pneu certo — e o teto da
 * classificação passa a ser COMPATIVEL. Isso é o desenho, não uma limitação a
 * contornar: a resposta diz que falta especificar, em vez de fingir precisão.
 */

import { atributosDoTexto, type EspecificacaoDeCompra } from "./especificacao";
import type { OfertaCapturada } from "./oferta";

export type ClasseDeMatch =
  "EXATO" | "COMPATIVEL" | "PARCIAL" | "NAO_COMPARAVEL";

export const ROTULO_DO_MATCH: Record<ClasseDeMatch, string> = {
  EXATO: "Exato",
  COMPATIVEL: "Compatível",
  PARCIAL: "Parcial",
  NAO_COMPARAVEL: "Não comparável",
};

export const EXPLICACAO_DO_MATCH: Record<ClasseDeMatch, string> = {
  EXATO: "Todos os atributos técnicos da especificação batem com os da oferta.",
  COMPATIVEL:
    "Nenhum atributo conflita, e a oferta não confirma todos — serve para comparar, com ressalva.",
  PARCIAL: "Parte dos atributos bate e parte não foi confirmada pela oferta.",
  NAO_COMPARAVEL: "Ao menos um atributo da oferta contradiz a especificação.",
};

/** O confronto de um atributo entre a especificação e a oferta. */
export interface AtributoConfrontado {
  tipo: string;
  esperado: string;
  encontrado: string | null;
  /** `BATE`, `DIVERGE` ou `NAO_DECLARADO` — os três estados possíveis. */
  desfecho: "BATE" | "DIVERGE" | "NAO_DECLARADO";
}

export interface Match {
  classe: ClasseDeMatch;
  atributos: AtributoConfrontado[];
  /** Por que esta classe, em uma frase que cita os atributos. */
  porque: string;
  /** Verdadeiro quando a oferta entra nas contas de mercado. */
  comparavel: boolean;
}

/**
 * Classifica uma oferta contra a especificação.
 *
 * O texto da oferta que entra na leitura de atributos é o do **produto, marca e
 * especificação declarada** — nunca o trecho de preço. O trecho contém números
 * de dinheiro, e passá-lo pelos reconhecedores faria "R$ 1.100,00" virar
 * medida de pneu (`1100x20`) na primeira página de e-commerce.
 */
export function classificar(
  especificacao: EspecificacaoDeCompra,
  oferta: OfertaCapturada,
): Match {
  const textoDaOferta = [oferta.produto, oferta.marca, oferta.especificacao]
    .filter((t): t is string => typeof t === "string" && t.trim() !== "")
    .join(" · ");

  const daOferta = atributosDoTexto(textoDaOferta, "Oferta");
  const porTipo = new Map(daOferta.map((a) => [a.tipo, a]));

  const atributos: AtributoConfrontado[] = especificacao.atributos.map(
    (esperado) => {
      const encontrado = porTipo.get(esperado.tipo);
      if (!encontrado) {
        return {
          tipo: esperado.tipo,
          esperado: esperado.canonico,
          encontrado: null,
          desfecho: "NAO_DECLARADO" as const,
        };
      }
      return {
        tipo: esperado.tipo,
        esperado: esperado.canonico,
        encontrado: encontrado.canonico,
        desfecho:
          encontrado.canonico.toLowerCase() === esperado.canonico.toLowerCase()
            ? ("BATE" as const)
            : ("DIVERGE" as const),
      };
    },
  );

  const diverge = atributos.filter((a) => a.desfecho === "DIVERGE");
  const bate = atributos.filter((a) => a.desfecho === "BATE");
  const naoDeclarado = atributos.filter((a) => a.desfecho === "NAO_DECLARADO");

  /*
    Um atributo que **contradiz** derruba a oferta inteira, e não importa
    quantos outros batem: um pneu da medida errada não é um pneu 80% certo, é
    um pneu que não serve. É a regra que impede a oferta mais barata e errada de
    encabeçar a lista.
  */
  if (diverge.length > 0) {
    return {
      classe: "NAO_COMPARAVEL",
      atributos,
      porque: `A oferta declara ${diverge
        .map((a) => `${a.encontrado} onde a especificação pede ${a.esperado}`)
        .join("; ")}.`,
      comparavel: false,
    };
  }

  if (especificacao.atributos.length === 0) {
    return {
      classe: "COMPATIVEL",
      atributos,
      porque:
        "A especificação não declara atributo técnico nenhum, então nada pode ser confirmado " +
        "nem contrariado. Sem isso não existe oferta exata — descreva o item para subir daqui.",
      comparavel: true,
    };
  }

  if (bate.length === especificacao.atributos.length) {
    return {
      classe: "EXATO",
      atributos,
      porque: `Todos os atributos batem: ${bate.map((a) => a.esperado).join(", ")}.`,
      comparavel: true,
    };
  }

  if (bate.length === 0) {
    return {
      classe: "COMPATIVEL",
      atributos,
      porque:
        `A oferta não declara ${naoDeclarado.map((a) => a.tipo.toLowerCase()).join(", ")}. ` +
        "Nada conflita, e nada foi confirmado.",
      comparavel: true,
    };
  }

  return {
    classe: "PARCIAL",
    atributos,
    porque:
      `Batem ${bate.map((a) => a.esperado).join(", ")}; ` +
      `a oferta não declara ${naoDeclarado.map((a) => a.tipo.toLowerCase()).join(", ")}.`,
    comparavel: true,
  };
}

/**
 * A ordem de qualidade das classes, para ordenar e para decidir o corte.
 *
 * Maior é melhor. `NAO_COMPARAVEL` é zero e nunca entra em conta nenhuma — ele
 * aparece na lista, marcado, porque sumir com ele faria a pessoa procurar de
 * novo a mesma oferta barata que já foi descartada.
 */
export const PESO_DO_MATCH: Record<ClasseDeMatch, number> = {
  EXATO: 3,
  PARCIAL: 2,
  COMPATIVEL: 1,
  NAO_COMPARAVEL: 0,
};
