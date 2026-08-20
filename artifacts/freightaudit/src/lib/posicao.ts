import type { AtributoNaPonta, UniversoDoTipo } from "./analise";
import { ESCOPOS, escopoDoAtributo, type EscopoCode } from "./escopos";

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

/**
 * O que dizer quando um equipamento não tem vigência nenhuma no recorte.
 *
 * A frase é da tela, e por isso mora aqui; o **nome** do equipamento não é —
 * ele vem de `ESCOPOS`, que é o vocabulário do produto para "de que isto é
 * atributo?". Duas listas de rótulos para os mesmos cinco tipos discordariam no
 * dia em que uma delas mudasse, e o dia em que discordassem seria o dia em que
 * nenhuma das duas seria lida.
 */
const SEM_DADO: Partial<Record<EscopoCode, string>> = {
  CAVALO: "Nenhuma vigência de cavalo neste período para esta unidade.",
  CARRETA: "Nenhuma vigência de carreta neste período para esta unidade.",
  TRECHO: "Nenhuma vigência de trecho neste período para esta unidade.",
  QLP_ADMINISTRATIVO:
    "Nenhuma vigência do quadro administrativo neste período. O QLP tem identidade e calendário próprios — ele não acompanha as vigências de equipamento.",
  QLP_OPERACIONAL:
    "Sem dados disponíveis. O tipo de importação existe, e o export do quadro operacional ainda não chegou — enquanto não chegar, não há quadro para mostrar.",
};

export interface TipoDaRemuneracao {
  entityType: string;
  titulo: string;
  semDado: string;
}

/**
 * Os equipamentos que viram bloco — os cinco importáveis, na ordem de `ESCOPOS`.
 *
 * **Cinco, e não os seis escopos.** Parâmetros oferece CONJUNTO como escopo
 * próprio, e com razão: lá a pergunta é *de que isto é atributo*, e
 * `carreta.finame` é do par, não da carreta. Aqui a pergunta é outra — *como
 * está a posição de cada equipamento* —, e cada bloco carrega dinheiro. Um bloco
 * CONJUNTO exibiria, com título próprio, exactamente as linhas que a dedução
 * retirou da soma para não contar o cavalo duas vezes: o mesmo dinheiro
 * apresentado uma terceira vez, agora com aparência de total.
 *
 * As linhas de conjunto não somem por isso. Elas ficam no bloco do equipamento
 * em cuja tabela a linha existe, com o selo que diz o que são — e o selo sai de
 * `escopoDoAtributo`, o mesmo classificador que Parâmetros usa. As duas telas
 * agrupam diferente e **classificam igual**, que é o que impede a divergência.
 */
export const TIPOS_DA_REMUNERACAO: TipoDaRemuneracao[] = ESCOPOS.filter(
  (e) => e.code !== "CONJUNTO",
).map((escopo) => ({
  entityType: escopo.code,
  titulo: escopo.nome,
  semDado: SEM_DADO[escopo.code] ?? "Nenhuma vigência deste equipamento no período.",
}));

/**
 * Se esta linha é de uma coluna que já embute o cavalo vinculado.
 *
 * Pergunta ao classificador do produto, e não ao deduplicador: são duas
 * perguntas diferentes. `escopoDoAtributo` responde *o que o atributo é* —
 * verdade do cadastro, estável; `foraDaSoma` responde *se o dinheiro desta
 * leitura saiu da soma* — decisão por ativo, que pode não ocorrer numa
 * comparação em que a parcela não se mexeu. O selo é sobre a primeira; a frase
 * que o acompanha, sobre a segunda.
 */
export function ehDoConjunto(linha: AtributoNaPonta): boolean {
  return escopoDoAtributo(linha.attributeCode, linha.entityType) === "CONJUNTO";
}

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
