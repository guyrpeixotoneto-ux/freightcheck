import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";
import { navGroupsFechamento } from "@/components/layout/nav-fechamento";
import { GRUPO_ADMINISTRACAO } from "@/components/layout/nav-administracao";
import {
  BASES_DE_AUDITORIA,
  BASES_DE_FECHAMENTO,
  BASE_PADRAO_DE_FECHAMENTO,
} from "@/lib/ambiente";
import { useAuth, type Nivel } from "@/lib/auth";

/**
 * Permissão por módulo, do lado da interface.
 *
 * **O menu é o catálogo.** Não há lista de módulos escrita aqui: `MODULOS` é
 * montado a partir das mesmas funções que desenham as laterais, e é por isso
 * que ele não tem como divergir delas. Item novo no menu aparece sozinho na
 * tela de Permissões; item que sai do menu deixa de ser oferecido — e a linha
 * que sobrou no banco não concede nada a ninguém, porque ninguém pergunta por
 * ela.
 *
 * **A chave é o endereço do item, sem a base do ambiente.** As quatro
 * auditorias e os três fechamentos são o mesmo código montado sob bases
 * diferentes; `/auditoria-rota/curadoria` e `/curadoria` são a mesma tela vista
 * de dois lugares, e cobrar permissão separada para cada uma seria pedir a um
 * administrador que repetisse sete vezes a mesma decisão — e esquecesse uma.
 *
 * **A ausência de decisão concede.** `nivelDe` devolve `EDITAR` para todo
 * módulo que não esteja no mapa da sessão, que é o que toda conta tinha antes
 * de existir permissão. O servidor lê o mesmo padrão
 * (`artifacts/api-server/src/lib/permissoes.ts`), e as duas pontas precisam
 * concordar: se a interface fechasse por padrão, o menu sumiria para todo mundo
 * no dia do deploy enquanto a API continuaria aceitando tudo.
 *
 * **O que isto esconde, e o que o servidor recusa.** Aqui some do menu, e a
 * rota aberta na mão responde com a tela de acesso negado. O que garante que
 * ninguém *muda* o que não pode é o portão do servidor, que recusa escrita sem
 * `EDITAR`. Esconder é conveniência; recusar é a garantia — e é lá que ela
 * está.
 */

export type { Nivel };

export const NIVEIS: Nivel[] = ["EDITAR", "VISUALIZAR", "SEM_ACESSO"];

export const NIVEL_PADRAO: Nivel = "EDITAR";

/** O que cada nível quer dizer, em uma linha — a mesma frase na tela e aqui. */
export const EXPLICACAO_DO_NIVEL: Record<Nivel, string> = {
  EDITAR: "Abre o módulo e pode alterar.",
  VISUALIZAR: "Abre o módulo; qualquer alteração é recusada pelo servidor.",
  SEM_ACESSO: "O módulo não aparece no menu, e a rota responde acesso negado.",
};

export interface Modulo {
  /** O endereço do item no menu, sem a base do ambiente — é a chave no banco. */
  chave: string;
  rotulo: string;
  /** A seção do menu onde ele vive, para agrupar a lista na tela. */
  grupo: string;
  /** Em que lateral ele aparece — a mesma tela pode estar em mais de uma. */
  ambiente: "Auditoria" | "Fechamento" | "Administração";
}

/** Tira a base do ambiente e o `~` do wouter: sobra a chave do módulo. */
export function chaveDoModulo(href: string): string {
  const semTil = href.startsWith("~") ? href.slice(1) : href;
  for (const base of [
    ...Object.values(BASES_DE_AUDITORIA),
    ...Object.values(BASES_DE_FECHAMENTO),
  ]) {
    if (base !== "" && (semTil === base || semTil.startsWith(`${base}/`))) {
      const resto = semTil.slice(base.length);
      return resto === "" ? "/" : resto;
    }
  }
  return semTil === "" ? "/" : semTil;
}

function reunir(): Modulo[] {
  const modulos = new Map<string, Modulo>();

  const adicionar = (
    ambiente: Modulo["ambiente"],
    grupo: string,
    href: string,
    rotulo: string,
  ) => {
    const chave = chaveDoModulo(href);
    if (!modulos.has(chave)) modulos.set(chave, { chave, rotulo, grupo, ambiente });
  };

  for (const grupo of navGroupsAuditoria("auditoria")) {
    for (const item of grupo.itens) {
      adicionar("Auditoria", grupo.titulo, item.href, item.label);
    }
  }
  for (const grupo of navGroupsFechamento(BASE_PADRAO_DE_FECHAMENTO, "Fechamento")) {
    for (const item of grupo.itens) {
      adicionar("Fechamento", grupo.titulo, item.href, item.label);
    }
  }
  for (const item of GRUPO_ADMINISTRACAO.itens) {
    adicionar("Administração", GRUPO_ADMINISTRACAO.titulo, item.href, item.label);
  }

  return [...modulos.values()];
}

/**
 * Todos os módulos que existem, uma vez cada.
 *
 * Montado uma vez no carregamento do módulo: as três funções acima são puras e
 * a lista não muda enquanto a aba estiver aberta.
 */
export const MODULOS: Modulo[] = reunir();

/** Os módulos agrupados como o menu os agrupa, na ordem do menu. */
export function modulosPorGrupo(): Array<{
  ambiente: Modulo["ambiente"];
  grupo: string;
  itens: Modulo[];
}> {
  const secoes: Array<{ ambiente: Modulo["ambiente"]; grupo: string; itens: Modulo[] }> = [];
  for (const modulo of MODULOS) {
    const atual = secoes.at(-1);
    if (atual && atual.grupo === modulo.grupo && atual.ambiente === modulo.ambiente) {
      atual.itens.push(modulo);
    } else {
      secoes.push({ ambiente: modulo.ambiente, grupo: modulo.grupo, itens: [modulo] });
    }
  }
  return secoes;
}

/** O nível de um módulo num mapa de permissões, já com o padrão aplicado. */
export function nivelDe(
  permissoes: Record<string, Nivel>,
  href: string,
): Nivel {
  return permissoes[chaveDoModulo(href)] ?? NIVEL_PADRAO;
}

/**
 * O módulo em que um endereço cai — o mais específico que casa.
 *
 * A tela aberta nem sempre é um item do menu: `/composicao/ABC1234` é a
 * Composição de um equipamento, e `/fluxos/7` é um fluxo dentro de Fluxos
 * Operacionais. Casar por prefixo resolve os dois; pegar **o mais longo** é o
 * que impede `/dre` de reivindicar `/dre-veiculo`, que é outro item do menu.
 *
 * `null` é resposta legítima: login, 404 e o que mais não pertencer a módulo
 * nenhum não são restringíveis, e tratá-los como bloqueados trancaria telas que
 * nunca estiveram em decisão nenhuma.
 */
export function moduloDaLocalizacao(location: string): Modulo | null {
  const caminho = chaveDoModulo(location.split("?")[0]);
  let achado: Modulo | null = null;
  for (const modulo of MODULOS) {
    if (modulo.chave === "/" ? caminho === "/" : caminho === modulo.chave || caminho.startsWith(`${modulo.chave}/`)) {
      if (!achado || modulo.chave.length > achado.chave.length) achado = modulo;
    }
  }
  return achado;
}

/**
 * O menu sem o que a pessoa não alcança.
 *
 * Some o item; some também a seção que ficou vazia, porque um título de seção
 * sem nada embaixo é a lista dizendo "havia algo aqui" — que é justamente o que
 * uma restrição não deveria anunciar.
 */
export function filtrarGrupos<
  G extends { itens: Array<{ href: string }> },
>(grupos: G[], permissoes: Record<string, Nivel>): G[] {
  return grupos
    .map((grupo) => ({
      ...grupo,
      itens: grupo.itens.filter((item) => nivelDe(permissoes, item.href) !== "SEM_ACESSO"),
    }))
    .filter((grupo) => grupo.itens.length > 0);
}

/** As permissões de quem está logado — o atalho que as telas usam. */
export function usePermissoes(): {
  nivel: (href: string) => Nivel;
  podeAbrir: (href: string) => boolean;
  podeEditar: (href: string) => boolean;
  permissoes: Record<string, Nivel>;
} {
  const { permissoes } = useAuth();
  return {
    permissoes,
    nivel: (href) => nivelDe(permissoes, href),
    podeAbrir: (href) => nivelDe(permissoes, href) !== "SEM_ACESSO",
    podeEditar: (href) => nivelDe(permissoes, href) === "EDITAR",
  };
}
