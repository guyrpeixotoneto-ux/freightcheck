import { and, desc, eq } from "drizzle-orm";
import {
  appUserTable,
  papelPermissaoTable,
  permissaoDeModuloEventoTable,
  permissaoDeModuloTable,
  type Database,
} from "@workspace/db";

/**
 * Permissão por módulo — a leitura, a escrita e o que o servidor recusa.
 *
 * O modelo inteiro em três frases:
 *
 * · **O módulo é o item do menu**, identificado pelo endereço dele
 *   (`/curadoria`, `/importacoes`). Não há catálogo de módulos no banco — o
 *   menu é o catálogo, e uma segunda lista só teria como destino divergir dele.
 * · **A ausência de linha é edição.** É o que toda conta tinha antes desta
 *   tabela existir; ler o silêncio como bloqueio transformaria a migration num
 *   apagão. Permissão aqui é o que se tira.
 * · **Quem tira responde pelo que tirou**: cada mudança grava um evento com
 *   autor e carimbo, e o evento nunca é apagado.
 *
 * E há uma **segunda camada**, desde a `0082`: o papel da conta
 * (`lib/papeis.ts`). Ele diz o mesmo tipo de coisa — chave → nível — para todo
 * mundo que o usa, e é lido logo abaixo da exceção da pessoa. A ordem é sempre
 * esta, e o produto inteiro a lê assim:
 *
 *   1. a exceção da pessoa, quando existe;
 *   2. o papel dela, quando existe;
 *   3. `EDITAR` — o padrão que concede.
 *
 * `permissoesDe` devolve **a soma**, já resolvida, e é por isso que o portão, o
 * menu e a sessão não precisaram mudar uma linha quando o papel nasceu. Quem
 * precisa ver as duas camadas separadas — a tela de Permissões, que mostra o que
 * é herança e o que é exceção — chama `permissoesDetalhadasDe`.
 *
 * E há um segundo eixo, na mesma tabela e com as mesmas três frases: o
 * **ambiente de trabalho** — as quatro auditorias e os quatro fechamentos.
 * Módulo responde "que telas", ambiente responde "de qual operação", e as duas
 * perguntas são independentes: quem edita Alterações na Empurrada pode não
 * entrar no Fechamento AS. Ver {@link AMBIENTES}, logo abaixo, e
 * `chaveDoAmbiente` para o formato da chave.
 *
 * O que este arquivo **não** faz, e é melhor dizê-lo aqui do que descobrir na
 * tela: ele não esconde leitura. `escritasDoModulo` mapeia módulo → prefixo de
 * API, e o portão (`middlewares/portao-de-permissao.ts`) recusa **escrita** —
 * `POST`, `PUT`, `PATCH`, `DELETE` — de quem não tem edição no módulo dono
 * daquele prefixo. Leitura continua aberta a quem tem sessão, e o menu é quem
 * deixa de mostrar o módulo sem acesso. A razão é honesta e vale escrita: as
 * telas compartilham endpoints de leitura — `/changes` serve o Dashboard, as
 * Alterações e o Resumo —, e fingir um bloqueio de leitura por módulo sobre
 * endpoints compartilhados quebraria telas permitidas para proteger nada. O
 * que dá para garantir de verdade é que **ninguém escreve onde não tem
 * edição**, e é isso que está garantido.
 */

/**
 * Os oito ambientes de trabalho, e por que eles são permissão como os módulos.
 *
 * O produto é um só, mas os espaços de trabalho são oito — quatro auditorias e
 * quatro fechamentos, um por operação (`artifacts/freightaudit/src/lib/
 * ambiente.ts`, que é onde eles se chamam pelo nome). Quem trabalha só na
 * empurrada não tem o que fazer no Fechamento AS, e até aqui o produto não
 * tinha como dizer isso: a permissão era por módulo, e módulo é o mesmo nos
 * quatro ambientes de propósito — `/alteracoes` na Rota e na Empurrada é a
 * mesma tela sobre acervos diferentes.
 *
 * Então o ambiente é o **segundo eixo**, e ele mora na mesma tabela: a chave é
 * `@` mais o id do ambiente, que nenhum módulo pode ter porque módulo começa
 * por barra. Sem tabela nova, sem migration, e com o histórico, o padrão que
 * concede e o portão de escrita valendo para os dois eixos sem uma linha a
 * mais.
 *
 * A lista é escrita aqui e lá, e é curta o bastante para isso não doer: os oito
 * ids são o eixo do produto, mudam junto com o `?operacao=` que separa os
 * acervos, e o teste de `lib/ambiente.ts` do lado da interface os enumera um a
 * um. O que este arquivo não pode é derivar a lista da interface — são dois
 * pacotes, e o servidor não importa a tela.
 */
export const AMBIENTES = [
  "auditoria",
  "auditoria-rota",
  "auditoria-as",
  "auditoria-apoio",
  "fechamento-rota",
  "fechamento-empurrada",
  "fechamento-as",
  "fechamento-apoio",
] as const;
export type Ambiente = (typeof AMBIENTES)[number];

/** A chave de um ambiente na tabela de permissões — `@fechamento-rota`. */
export function chaveDoAmbiente(id: Ambiente): string {
  return `@${id}`;
}

/** Se uma chave é de ambiente, e não de módulo. */
export function ehChaveDeAmbiente(chave: string): boolean {
  return (AMBIENTES as readonly string[]).some((id) => `@${id}` === chave);
}

/**
 * O ambiente que a requisição declara, em `?ambiente=`.
 *
 * Quem carimba é o cliente, num lugar só (`lib/api.ts`, em `getApiUrl`), pela
 * mesma razão pela qual `?operacao=` é carimbado lá: são mais de cem chamadas,
 * e a que alguém esquecesse seria uma restrição que não vale numa tela — sem
 * erro nenhum, que é a forma mais cara de isso aparecer.
 *
 * Valor desconhecido vira `null` — não vira recusa. Um ambiente que este
 * servidor não conhece é um cliente mais novo do que ele, e responder 403 a
 * isso seria transformar um deploy fora de ordem em bloqueio de trabalho
 * legítimo.
 */
export function ambienteDaConsulta(
  query: Record<string, unknown>,
): Ambiente | null {
  const bruto = query["ambiente"];
  return typeof bruto === "string" &&
    (AMBIENTES as readonly string[]).includes(bruto)
    ? (bruto as Ambiente)
    : null;
}

/**
 * As escritas que **não** pertencem a ambiente nenhum.
 *
 * A Administração vale para o produto inteiro — contas, unidades, o cadastro da
 * casa e a própria sessão — e é por isso que ela vive fora dos prefixos de
 * ambiente na interface. O carimbo de `?ambiente=` não sabe disso: fora de um
 * ambiente prefixado ele manda `auditoria`, que é o que sobra quando nenhum
 * prefixo casa. Sem esta lista, tirar a Auditoria Empurrada de alguém tiraria
 * junto o botão de trocar a própria senha e o cadastro de cargos — dois
 * bloqueios que ninguém pediu e que ninguém saberia explicar.
 */
const ESCRITAS_FORA_DO_AMBIENTE: readonly string[] = [
  "/auth",
  "/users",
  "/papeis",
  "/unidades",
  "/cadastro",
];

/** Se um caminho de API é de Administração — ver a lista acima. */
export function escritaForaDoAmbiente(caminho: string): boolean {
  return ESCRITAS_FORA_DO_AMBIENTE.some(
    (prefixo) => caminho === prefixo || caminho.startsWith(`${prefixo}/`),
  );
}

export const NIVEIS = ["EDITAR", "VISUALIZAR", "SEM_ACESSO"] as const;
export type Nivel = (typeof NIVEIS)[number];

/** O que vale para quem nunca teve uma decisão tomada a respeito. */
export const NIVEL_PADRAO: Nivel = "EDITAR";

export function ehNivel(valor: unknown): valor is Nivel {
  return typeof valor === "string" && (NIVEIS as readonly string[]).includes(valor);
}

/**
 * Os módulos cuja escrita o servidor sabe reconhecer, e o prefixo de API de
 * cada um.
 *
 * A chave é o endereço do item no menu; o valor, os prefixos de `/api` que só
 * aquele módulo escreve. Prefixo mais específico primeiro — `/curation/categorias`
 * é de Categorias, e o resto de `/curation` é da Curadoria; a ordem desta lista
 * é o desempate, e inverter as duas linhas mudaria quem pode o quê.
 *
 * Um módulo fora desta lista não tem escrita reconhecida: ou não escreve nada,
 * ou escreve por um endpoint que outro módulo também escreve — e nesse caso
 * chutar o dono seria pior do que não bloquear.
 */
export const ESCRITAS_POR_MODULO: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/categorias", ["/curation/categorias"]],
  ["/curadoria", ["/curation"]],
  ["/importacoes", ["/imports"]],
  ["/fluxos", ["/fluxos"]],
  ["/book-operador", ["/book"]],
  ["/assistente", ["/assistant"]],
  ["/dados", ["/coverage"]],
  ["/alteracoes", ["/change-sets"]],
  ["/justificativas", ["/justificativas"]],
  ["/remunerado", ["/compras"]],
  /* Papéis é a mesma tela que contas, e por isso o mesmo módulo: quem tem
     Configurações administra as duas, quem não tem não administra nenhuma. */
  ["/configuracoes", ["/users", "/papeis"]],
];

/** O módulo dono de um caminho de API, ou `null` quando ninguém o reivindica. */
export function moduloDaEscrita(caminho: string): string | null {
  for (const [modulo, prefixos] of ESCRITAS_POR_MODULO) {
    for (const prefixo of prefixos) {
      if (caminho === prefixo || caminho.startsWith(`${prefixo}/`)) return modulo;
    }
  }
  return null;
}

/** As exceções tomadas sobre uma pessoa — só as chaves que têm linha. */
export async function excecoesDe(
  db: Database,
  userId: string,
): Promise<Record<string, Nivel>> {
  const linhas = await db
    .select({
      modulo: permissaoDeModuloTable.modulo,
      nivel: permissaoDeModuloTable.nivel,
    })
    .from(permissaoDeModuloTable)
    .where(eq(permissaoDeModuloTable.userId, userId));

  const mapa: Record<string, Nivel> = {};
  for (const linha of linhas) {
    if (ehNivel(linha.nivel)) mapa[linha.modulo] = linha.nivel;
  }
  return mapa;
}

/** O que um papel decide, chave a chave — só as que têm linha. */
export async function permissoesDoPapel(
  db: Database,
  papelId: string,
): Promise<Record<string, Nivel>> {
  const linhas = await db
    .select({ chave: papelPermissaoTable.chave, nivel: papelPermissaoTable.nivel })
    .from(papelPermissaoTable)
    .where(eq(papelPermissaoTable.papelId, papelId));

  const mapa: Record<string, Nivel> = {};
  for (const linha of linhas) {
    if (ehNivel(linha.nivel)) mapa[linha.chave] = linha.nivel;
  }
  return mapa;
}

/** O papel de uma conta, ou `null` — conta anterior à `0082`, ou do terminal. */
export async function papelDaConta(
  db: Database,
  userId: string,
): Promise<string | null> {
  const [linha] = await db
    .select({ papelId: appUserTable.papelId })
    .from(appUserTable)
    .where(eq(appUserTable.id, userId))
    .limit(1);
  return linha?.papelId ?? null;
}

/**
 * As duas camadas de uma conta, separadas — e a soma delas.
 *
 * Só a tela de Permissões precisa das duas: ela mostra, chave a chave, o que
 * veio do papel e o que é exceção daquela pessoa. Quem só quer saber o que vale
 * — o portão, o menu, a sessão — chama `permissoesDe` e recebe a soma pronta.
 */
export interface PermissoesDaConta {
  doPapel: Record<string, Nivel>;
  daPessoa: Record<string, Nivel>;
  efetivas: Record<string, Nivel>;
}

export async function permissoesDetalhadasDe(
  db: Database,
  userId: string,
): Promise<PermissoesDaConta> {
  const papelId = await papelDaConta(db, userId);
  const doPapel = papelId === null ? {} : await permissoesDoPapel(db, papelId);
  const daPessoa = await excecoesDe(db, userId);
  return { doPapel, daPessoa, efetivas: { ...doPapel, ...daPessoa } };
}

/**
 * O que vale para uma pessoa, com as duas camadas já somadas.
 *
 * A exceção vence o papel — é a decisão mais recente e mais informada, tomada
 * sobre aquela conta sabendo qual é o papel dela. Chave sem linha em nenhuma das
 * duas não aparece no mapa, e quem lê o mapa (`nivelDe`) devolve o padrão, que
 * concede: o silêncio continua significando a mesma coisa nas duas camadas, e é
 * o que permite empilhá-las sem que a soma mude de sentido.
 */
export async function permissoesDe(
  db: Database,
  userId: string,
): Promise<Record<string, Nivel>> {
  return (await permissoesDetalhadasDe(db, userId)).efetivas;
}

/** O nível de uma pessoa num módulo, já com o padrão aplicado. */
export function nivelDe(
  permissoes: Record<string, Nivel>,
  modulo: string,
): Nivel {
  return permissoes[modulo] ?? NIVEL_PADRAO;
}

/** O nível de uma pessoa num ambiente, já com o padrão aplicado. */
export function nivelDoAmbiente(
  permissoes: Record<string, Nivel>,
  id: Ambiente,
): Nivel {
  return permissoes[chaveDoAmbiente(id)] ?? NIVEL_PADRAO;
}

/**
 * Grava as exceções de uma pessoa, e só as que mudaram.
 *
 * **A linha de base é o papel, e não mais `EDITAR`.** Pedir para uma chave o
 * mesmo nível que o papel dela já dá é apagar a linha — a pessoa volta a herdar,
 * e a tabela continua sendo a lista do que foi decidido *à parte do papel*, e
 * não uma cópia dele por pessoa. Foi o que mudou com a `0082`: antes o único
 * jeito de voltar ao normal era `EDITAR`, porque o normal era um só; agora o
 * normal é o do papel de cada um. Gravar `EDITAR` como linha onde o papel dá
 * `EDITAR` faria a pessoa parar de acompanhar o papel dela em silêncio — que é
 * exatamente o defeito que o vínculo existe para não ter.
 *
 * O histórico recebe a mudança dos dois jeitos, inclusive a volta à herança, que
 * também é decisão de alguém.
 */
export async function definirPermissoes(
  db: Database,
  entrada: {
    userId: string;
    /** Chave → nível pedido. O nível do papel devolve a chave à herança. */
    niveis: Record<string, Nivel>;
    /** O e-mail de quem decidiu. */
    por: string;
  },
): Promise<Record<string, Nivel>> {
  const papelId = await papelDaConta(db, entrada.userId);
  const doPapel = papelId === null ? {} : await permissoesDoPapel(db, papelId);
  const atuais = await excecoesDe(db, entrada.userId);

  for (const [modulo, nivel] of Object.entries(entrada.niveis)) {
    const herdado = doPapel[modulo] ?? NIVEL_PADRAO;
    const anterior = atuais[modulo];
    if ((anterior ?? herdado) === nivel) continue;

    if (nivel === herdado) {
      await db
        .delete(permissaoDeModuloTable)
        .where(
          and(
            eq(permissaoDeModuloTable.userId, entrada.userId),
            eq(permissaoDeModuloTable.modulo, modulo),
          ),
        );
    } else {
      await db
        .insert(permissaoDeModuloTable)
        .values({
          userId: entrada.userId,
          modulo,
          nivel,
          definidoPor: entrada.por,
        })
        .onConflictDoUpdate({
          target: [permissaoDeModuloTable.userId, permissaoDeModuloTable.modulo],
          set: { nivel, definidoPor: entrada.por, definidoEm: new Date() },
        });
    }

    await db.insert(permissaoDeModuloEventoTable).values({
      userId: entrada.userId,
      modulo,
      nivelAnterior: anterior ?? null,
      nivel,
      por: entrada.por,
    });
  }

  return permissoesDe(db, entrada.userId);
}

/** O histórico de uma pessoa, do mais recente para o mais antigo. */
export async function historicoDePermissoes(
  db: Database,
  userId: string,
): Promise<
  Array<{
    modulo: string;
    nivelAnterior: string | null;
    nivel: string;
    em: string;
    por: string;
  }>
> {
  const linhas = await db
    .select({
      modulo: permissaoDeModuloEventoTable.modulo,
      nivelAnterior: permissaoDeModuloEventoTable.nivelAnterior,
      nivel: permissaoDeModuloEventoTable.nivel,
      em: permissaoDeModuloEventoTable.em,
      por: permissaoDeModuloEventoTable.por,
    })
    .from(permissaoDeModuloEventoTable)
    .where(eq(permissaoDeModuloEventoTable.userId, userId))
    .orderBy(desc(permissaoDeModuloEventoTable.em))
    .limit(200);

  return linhas.map((l) => ({ ...l, em: l.em.toISOString() }));
}
