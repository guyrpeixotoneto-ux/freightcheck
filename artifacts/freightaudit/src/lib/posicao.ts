import type { AtributoNaPonta, UniversoDoTipo } from "./analise";

/**
 * As regras da tela de posição, fora do JSX.
 *
 * A tela desenha; quem decide o que entra em cada bloco, o que fica de fora e o
 * que os contadores dizem é este arquivo — pelo mesmo motivo que
 * `auditoria-gerencial.ts` existe: uma regra escondida no meio de um componente
 * é uma regra que ninguém audita.
 *
 * **Nenhuma função daqui soma dinheiro.** O impacto de cada linha chega pronto
 * da autoridade, por periodicidade, e é publicado como veio. Uma soma nesta
 * camada produziria um número plausível que ninguém assinou — a exclusão por
 * dupla contagem é por ativo e olha para fora do par.
 */

export interface TipoDaRemuneracao {
  entityType: string;
  titulo: string;
  /** O que dizer quando este tipo não tem vigência nenhuma no recorte. */
  semDado: string;
}

/**
 * Os tipos que a remuneração de facto tem, na ordem em que se lê a operação.
 *
 * **Cinco, e não seis.** Não há "Conjunto", e a ausência é a decisão: conjunto é
 * *escopo* — o valor que cobre cavalo e carreta juntos —, e não um tipo de
 * entidade irmão dos outros. Um sexto bloco mostraria pela terceira vez o
 * dinheiro que a dedução já retirou da soma exactamente para não o contar duas
 * vezes. O conjunto ganha um selo na linha, alimentado pela decisão do
 * deduplicador.
 */
export const TIPOS_DA_REMUNERACAO: TipoDaRemuneracao[] = [
  {
    entityType: "CAVALO",
    titulo: "Cavalo",
    semDado: "Nenhuma vigência de cavalo neste período para esta unidade.",
  },
  {
    entityType: "CARRETA",
    titulo: "Carreta",
    semDado: "Nenhuma vigência de carreta neste período para esta unidade.",
  },
  {
    entityType: "TRECHO",
    titulo: "Trecho",
    semDado: "Nenhuma vigência de trecho neste período para esta unidade.",
  },
  {
    entityType: "QLP_ADMINISTRATIVO",
    titulo: "QLP Administrativo",
    semDado:
      "Nenhuma vigência do quadro administrativo neste período. O QLP tem identidade e calendário próprios — ele não acompanha as vigências de equipamento.",
  },
  {
    entityType: "QLP_OPERACIONAL",
    titulo: "QLP Operacional",
    semDado:
      "Sem dados disponíveis. O tipo de importação existe, e o export do quadro operacional ainda não chegou — enquanto não chegar, não há quadro para mostrar.",
  },
];

export interface BlocoDaPosicao {
  tipo: TipoDaRemuneracao;
  /** `null` quando o tipo não tem vigência nenhuma no recorte. */
  universo: UniversoDoTipo | null;
  linhas: AtributoNaPonta[];
}

export interface BlocosDaPosicao {
  blocos: BlocoDaPosicao[];
  /**
   * Linhas cujo atributo não declara equipamento.
   *
   * Não cabem em bloco nenhum e **não somem**: é defeito de classificação na
   * origem, e uma tela que se apresenta como o retrato da remuneração inteira
   * não pode engolir em silêncio a linha que não soube arrumar.
   */
  semEquipamento: AtributoNaPonta[];
}

/**
 * Os blocos da tela, na ordem, com as linhas de cada um.
 *
 * **Os cinco conhecidos aparecem sempre**, mesmo sem dado: um bloco que sumisse
 * deixaria quem lê concluir que a unidade não tem trechos, quando o que não há é
 * export.
 *
 * **E um tipo que o produto ainda não nomeia ganha bloco na mesma.** A lista dos
 * cinco é o que sabemos hoje, e não um filtro — um equipamento novo no export
 * (um DOLLY, digamos) sumiria de uma tela que promete o retrato inteiro, e
 * sumiria calado. É a mesma razão que faz o denominador sair do universo
 * canônico e não do catálogo.
 */
export function blocosDaPosicao(
  universo: UniversoDoTipo[],
  linhas: AtributoNaPonta[],
): BlocosDaPosicao {
  const porTipo = new Map(universo.map((u) => [u.entityType, u]));
  const conhecidos = new Set(TIPOS_DA_REMUNERACAO.map((t) => t.entityType));

  const doTipo = (entityType: string) =>
    linhas.filter((l) => l.entityType === entityType);

  const blocos: BlocoDaPosicao[] = [
    ...TIPOS_DA_REMUNERACAO.map((tipo) => ({
      tipo,
      universo: porTipo.get(tipo.entityType) ?? null,
      linhas: doTipo(tipo.entityType),
    })),
    ...universo
      .filter((u) => !conhecidos.has(u.entityType))
      .map((u) => ({
        tipo: {
          entityType: u.entityType,
          titulo: u.equipment,
          semDado: "Nenhuma vigência deste equipamento no período.",
        },
        universo: u,
        linhas: doTipo(u.entityType),
      })),
  ];

  return {
    blocos,
    semEquipamento: linhas.filter((l) => l.entityType === null),
  };
}

export interface TotaisDaPosicao {
  alterados: number;
  revertidos: number;
  /** O denominador: o universo canônico somado sobre os equipamentos. */
  atributos: number;
}

/**
 * Os contadores do topo — a soma dos blocos, e não uma segunda contagem.
 *
 * Contar as linhas aqui e os universos ali daria dois denominadores para a mesma
 * tela, e o dia em que discordassem seria o dia em que nenhum dos dois seria
 * lido.
 */
export function totaisDaPosicao(universo: UniversoDoTipo[]): TotaisDaPosicao {
  return {
    alterados: universo.reduce((t, u) => t + u.alterados, 0),
    revertidos: universo.reduce((t, u) => t + u.revertidos, 0),
    atributos: universo.reduce((t, u) => t + u.atributos, 0),
  };
}

/**
 * As linhas de um bloco, agrupadas pelo parâmetro a que pertencem.
 *
 * O parâmetro **agrupa e não ordena**: a ordem dentro do bloco continua a do
 * servidor, que é a do dinheiro. Reordenar por nome faria a linha de maior
 * impacto aparecer no meio da tabela porque o nome dela começa com R.
 *
 * O `Map` preserva a ordem de inserção, e é essa a propriedade de que isto
 * depende: o primeiro grupo é o do primeiro parâmetro a aparecer na lista já
 * ordenada.
 */
export function agruparPorParametro(
  linhas: AtributoNaPonta[],
): [string, AtributoNaPonta[]][] {
  const grupos = new Map<string, AtributoNaPonta[]>();
  for (const linha of linhas) {
    grupos.set(linha.parameterName, [
      ...(grupos.get(linha.parameterName) ?? []),
      linha,
    ]);
  }
  return [...grupos.entries()];
}
