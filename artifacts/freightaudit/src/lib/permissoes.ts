import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";
import { navGroupsFechamento } from "@/components/layout/nav-fechamento";
import { GRUPO_ADMINISTRACAO } from "@/components/layout/nav-administracao";
import { chaveDaSecao, nivelDoModulo } from "@workspace/acesso";
import {
  AMBIENTES,
  BASES_DE_AUDITORIA,
  BASES_DE_FECHAMENTO,
  ambienteDe,
  type Ambiente,
  type AmbienteDeAuditoria,
  type AmbienteDeFechamento,
  type DescricaoDeAmbiente,
} from "@/lib/ambiente";
import { useAuth, type Nivel } from "@/lib/auth";

export { chaveDaSecao } from "@workspace/acesso";

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
  /**
   * O id da seção — a chave da decisão da casa sobre a seção inteira.
   *
   * É o que permite a precedência funcionar longe do menu: `nivelDe` recebe um
   * endereço e nada mais, e é daqui que ele descobre de que seção aquele
   * endereço é. Ver `nivelDoModulo`, em `@workspace/acesso`.
   */
  secao: string;
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

/**
 * O catálogo, montado a partir de **todas** as laterais que existem.
 *
 * Era `navGroupsAuditoria("auditoria")` — a Empurrada, e só ela —, e a conta
 * disso era um buraco de governança: `/caminhao-360` e `/carroceria-360` só
 * aparecem na Rota e no AS, `/empilhadeira-360` só no Apoio, e as três não
 * existiam no catálogo. Estavam no menu de quem trabalha lá e não estavam em
 * Módulos Universais nem em Permissões — telas que nenhuma das três camadas de
 * acesso alcançava, e que continuavam no menu depois de a casa desligar a seção
 * Frota inteira.
 *
 * Agora percorre as quatro auditorias e os quatro fechamentos. O `Map` por
 * chave é o que impede a repetição virar duplicata: `/alteracoes` é a mesma tela
 * nas quatro auditorias, e uma chave só é justamente a decisão de
 * `chaveDoModulo` — cobrar permissão separada por ambiente seria pedir a mesma
 * decisão sete vezes, e esquecer uma.
 *
 * **A primeira seção do Fechamento recebe um nome canônico**, e não o do
 * ambiente. `navGroupsFechamento` batiza o primeiro grupo com o nome da
 * operação — "Fechamento Rota", "Fechamento AS" — porque é isso que quem está
 * lá dentro precisa ler. O catálogo não pode herdar essa variação: são quatro
 * rótulos para uma seção só, e o `id` dela (`fechamento`) já diz isso. O rótulo
 * canônico é o que a tela de Módulos Universais mostra.
 */
function reunir(): Modulo[] {
  const modulos = new Map<string, Modulo>();

  const adicionar = (
    ambiente: Modulo["ambiente"],
    grupo: string,
    secao: string,
    href: string,
    rotulo: string,
  ) => {
    const chave = chaveDoModulo(href);
    if (!modulos.has(chave)) {
      modulos.set(chave, { chave, rotulo, grupo, secao, ambiente });
    }
  };

  const auditorias = Object.keys(BASES_DE_AUDITORIA) as AmbienteDeAuditoria[];
  for (const auditoria of auditorias) {
    for (const grupo of navGroupsAuditoria(auditoria)) {
      for (const item of grupo.itens) {
        adicionar("Auditoria", grupo.titulo, grupo.id, item.href, item.label);
      }
    }
  }

  const fechamentos = Object.keys(BASES_DE_FECHAMENTO) as AmbienteDeFechamento[];
  for (const fechamento of fechamentos) {
    for (const grupo of navGroupsFechamento(BASES_DE_FECHAMENTO[fechamento], "Fechamento")) {
      for (const item of grupo.itens) {
        adicionar("Fechamento", grupo.titulo, grupo.id, item.href, item.label);
      }
    }
  }

  for (const item of GRUPO_ADMINISTRACAO.itens) {
    adicionar(
      "Administração",
      GRUPO_ADMINISTRACAO.titulo,
      GRUPO_ADMINISTRACAO.id,
      item.href,
      item.label,
    );
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

/**
 * A seção de cada chave de módulo — o índice que a precedência consulta.
 *
 * Montado uma vez, junto com `MODULOS`: `nivelDe` roda a cada item de menu, a
 * cada render, e uma varredura linear sobre o catálogo ali dentro seria uma
 * busca por chave escrita como laço.
 */
const SECAO_DA_CHAVE: ReadonlyMap<string, string> = new Map(
  MODULOS.map((m) => [m.chave, m.secao]),
);

/**
 * A seção de um endereço, ou `null` quando ele não pertence a seção nenhuma.
 *
 * `null` é resposta legítima e não é o mesmo que "seção ligada": é a afirmação
 * de que aquela chave não tem essa dimensão — login, 404, e qualquer endereço
 * que não seja item de menu.
 */
export function secaoDoModulo(href: string): string | null {
  return SECAO_DA_CHAVE.get(chaveDoModulo(href)) ?? null;
}

/** Os módulos agrupados como o menu os agrupa, na ordem do menu. */
export function modulosPorGrupo(): Array<{
  ambiente: Modulo["ambiente"];
  grupo: string;
  /** O id da seção — a chave que o botão da seção liga e desliga. */
  secao: string;
  itens: Modulo[];
}> {
  /*
    Agrupa por seção, e **não** por trecho contíguo do catálogo.

    Era por trecho, e funcionava enquanto o catálogo vinha de uma auditoria só:
    os módulos de uma seção nasciam vizinhos porque o menu os escrevia vizinhos.
    Com as oito laterais isso deixou de valer — `/caminhao-360` e
    `/empilhadeira-360` entram no catálogo depois da Administração, quando a
    varredura chega na Rota e no Apoio, e a Frota passou a aparecer em dois
    trechos separados. O efeito era uma seção partida na tela, duas linhas com o
    mesmo título e duas chaves de React iguais.

    A seção é um conjunto, não um intervalo. A ordem de aparição continua sendo
    a do menu — quem chega primeiro abre a seção, e os retardatários caem dentro
    dela.
  */
  const porChave = new Map<
    string,
    { ambiente: Modulo["ambiente"]; grupo: string; secao: string; itens: Modulo[] }
  >();
  for (const modulo of MODULOS) {
    const chave = `${modulo.ambiente}|${modulo.secao}`;
    const atual = porChave.get(chave);
    if (atual) {
      atual.itens.push(modulo);
    } else {
      porChave.set(chave, {
        ambiente: modulo.ambiente,
        grupo: modulo.grupo,
        secao: modulo.secao,
        itens: [modulo],
      });
    }
  }
  return [...porChave.values()];
}

/**
 * O nível de um módulo num mapa de permissões, com a seção dele já pesada.
 *
 * A regra é a de `@workspace/acesso`, e ela está lá porque o portão de escrita
 * do servidor precisa ler a mesma: **seção desligada vence módulo ligado**.
 * Aqui a seção sai do catálogo — o chamador passa um `href`, e não precisa saber
 * de que seção ele é.
 */
export function nivelDe(
  permissoes: Record<string, Nivel>,
  href: string,
): Nivel {
  const chave = chaveDoModulo(href);
  return nivelDoModulo(permissoes, chave, SECAO_DA_CHAVE.get(chave) ?? null);
}

/** O nível de uma seção do menu — desligada é `SEM_ACESSO`, e só há esses dois. */
export function nivelDaSecao(
  permissoes: Record<string, Nivel>,
  secao: string,
): Nivel {
  return permissoes[chaveDaSecao(secao)] ?? NIVEL_PADRAO;
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
 *
 * **A seção desligada some inteira, e sem consultar item nenhum.** É a diferença
 * que faz o defeito não voltar: a seção sumia antes por *consequência* — todos
 * os itens dela caíam, e o grupo ficava vazio —, e voltava inteira no dia em que
 * um módulo novo entrava nela, porque o módulo novo não tinha decisão nenhuma e
 * o padrão concede. Agora a decisão é sobre a seção, e um item novo dentro dela
 * nasce invisível sem ninguém precisar se lembrar de nada.
 *
 * A seção vem do `id` do grupo, e não do catálogo: aqui o grupo está na mão, e
 * o `id` é o que ele carrega justamente para esta pergunta. É também o que
 * permite a lateral do Fechamento — cujo primeiro grupo muda de título entre os
 * quatro ambientes — responder pela mesma chave nos quatro.
 */
export function filtrarGrupos<
  G extends { id: string; itens: Array<{ href: string }> },
>(grupos: G[], permissoes: Record<string, Nivel>): G[] {
  return grupos
    .filter((grupo) => nivelDaSecao(permissoes, grupo.id) !== "SEM_ACESSO")
    .map((grupo) => ({
      ...grupo,
      itens: grupo.itens.filter((item) => nivelDe(permissoes, item.href) !== "SEM_ACESSO"),
    }))
    .filter((grupo) => grupo.itens.length > 0);
}

/* =========================================================================
 * O ambiente de trabalho — o segundo eixo
 * ====================================================================== */

/**
 * O acesso ao **espaço de trabalho**, que é outra pergunta que a do módulo.
 *
 * Módulo responde "que telas esta pessoa alcança"; ambiente responde "de qual
 * operação". As duas são independentes de propósito: `/alteracoes` é a mesma
 * tela na Empurrada e na Rota — é o acervo embaixo dela que muda —, e por isso
 * o módulo nunca teve como dizer "esta pessoa só trabalha na empurrada". Agora
 * o ambiente diz, e o módulo continua dizendo o que sempre disse.
 *
 * **A chave é `@` mais o id do ambiente**, e mora na mesma tabela dos módulos.
 * Nenhum módulo pode colidir com ela porque módulo é endereço e começa por
 * barra. Sem tabela nova: o padrão que concede, o histórico com autor e o
 * portão de escrita já existiam e passaram a valer para os dois eixos sem uma
 * linha de banco a mais.
 *
 * **O nível efetivo de uma tela é o mais restritivo dos dois** ({@link
 * maisRestritivo}). Quem tem o Fechamento AS em somente leitura não edita
 * Competências lá, mesmo que Competências esteja em `EDITAR` — porque o
 * "EDITAR" do módulo foi decidido sobre a tela, e não sobre aquele acervo. O
 * caminho contrário é o mesmo: entrar num ambiente não devolve um módulo que
 * alguém tirou.
 */
export function chaveDoAmbiente(id: Ambiente): string {
  return `@${id}`;
}

/** O nível de um ambiente num mapa de permissões, já com o padrão aplicado. */
export function nivelDoAmbiente(
  permissoes: Record<string, Nivel>,
  id: Ambiente,
): Nivel {
  return permissoes[chaveDoAmbiente(id)] ?? NIVEL_PADRAO;
}

/**
 * O mais fechado entre dois níveis.
 *
 * `SEM_ACESSO` vence tudo, `VISUALIZAR` vence `EDITAR`. É a composição dos dois
 * eixos, e ela só pode ser esta: um acesso que fosse o mais permissivo dos dois
 * faria a decisão sobre o ambiente ser desfeita por qualquer módulo em padrão —
 * e módulo em padrão é o estado normal de toda conta.
 */
export function maisRestritivo(a: Nivel, b: Nivel): Nivel {
  if (a === "SEM_ACESSO" || b === "SEM_ACESSO") return "SEM_ACESSO";
  if (a === "VISUALIZAR" || b === "VISUALIZAR") return "VISUALIZAR";
  return "EDITAR";
}

/**
 * Os ambientes que a pessoa alcança, na ordem do seletor.
 *
 * É o que o seletor do topo lista. Quem não alcança nenhum não é um estado que
 * a lista precise inventar texto para: o padrão concede os oito, e chegar a
 * zero exige oito decisões tomadas uma a uma — quem as tomou sabe o que fez.
 */
export function ambientesPermitidos(
  permissoes: Record<string, Nivel>,
): DescricaoDeAmbiente[] {
  return AMBIENTES.filter(
    (ambiente) => nivelDoAmbiente(permissoes, ambiente.id) !== "SEM_ACESSO",
  );
}

/**
 * O acesso à tela aberta — os dois eixos já compostos.
 *
 * A Administração fica fora do eixo do ambiente, e é por isso que ela é
 * perguntada aqui e não no chamador: Configurações, Unidades e o cadastro da
 * casa valem para o produto inteiro e vivem fora dos prefixos, então
 * `ambienteDe` responde "Empurrada" por eles — o que sobra quando nenhum
 * prefixo casa. Aplicar o eixo do ambiente ali tiraria a tela de trocar a
 * própria senha de quem trabalha só no Fechamento, que é um bloqueio que
 * ninguém pediu.
 */
export interface AcessoDaTela {
  /** O módulo em que a tela cai, ou `null` fora de módulo (login, 404). */
  modulo: Modulo | null;
  /** O ambiente da tela, ou `null` quando ela é de Administração. */
  ambiente: Ambiente | null;
  doModulo: Nivel;
  doAmbiente: Nivel;
  /** Os dois compostos — o que vale na tela. */
  nivel: Nivel;
}

/**
 * Os módulos que valem para o produto inteiro — a Administração.
 *
 * Vem da mesma lista que desenha o grupo no menu, e não de um `grupo ===
 * "Administração"`: o grupo da Administração é montado dentro da lateral da
 * Auditoria (`nav-auditoria.ts`), então o `ambiente` desses módulos é
 * "Auditoria" por acidente de onde eles são anexados — e um teste que
 * confiasse nisso passaria dizendo que Configurações é tela de auditoria.
 */
const CHAVES_DA_ADMINISTRACAO = new Set(
  GRUPO_ADMINISTRACAO.itens.map((item) => chaveDoModulo(item.href)),
);

export function acessoDaLocalizacao(
  permissoes: Record<string, Nivel>,
  location: string,
): AcessoDaTela {
  const modulo = moduloDaLocalizacao(location);
  const doModulo = modulo ? nivelDe(permissoes, modulo.chave) : NIVEL_PADRAO;

  if (modulo && CHAVES_DA_ADMINISTRACAO.has(modulo.chave)) {
    return {
      modulo,
      ambiente: null,
      doModulo,
      doAmbiente: NIVEL_PADRAO,
      nivel: doModulo,
    };
  }

  const ambiente = ambienteDe(location.split("?")[0]);
  const doAmbiente = nivelDoAmbiente(permissoes, ambiente);
  return {
    modulo,
    ambiente,
    doModulo,
    doAmbiente,
    nivel: maisRestritivo(doModulo, doAmbiente),
  };
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
