import { and, desc, eq } from "drizzle-orm";
import {
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
  ["/configuracoes", ["/users"]],
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

/** As decisões tomadas sobre uma pessoa — só os módulos que têm linha. */
export async function permissoesDe(
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
 * Grava as decisões de uma pessoa, e só as que mudaram.
 *
 * Voltar um módulo para o padrão é apagar a linha, não gravar `EDITAR`: assim a
 * tabela continua sendo a lista do que foi tirado, e não uma cópia do menu por
 * pessoa. O histórico recebe a mudança dos dois jeitos — inclusive a volta ao
 * padrão, que também é decisão de alguém.
 */
export async function definirPermissoes(
  db: Database,
  entrada: {
    userId: string;
    /** Módulo → nível pedido. `EDITAR` volta o módulo ao padrão. */
    niveis: Record<string, Nivel>;
    /** O e-mail de quem decidiu. */
    por: string;
  },
): Promise<Record<string, Nivel>> {
  const atuais = await permissoesDe(db, entrada.userId);

  for (const [modulo, nivel] of Object.entries(entrada.niveis)) {
    const anterior = atuais[modulo];
    if ((anterior ?? NIVEL_PADRAO) === nivel) continue;

    if (nivel === NIVEL_PADRAO) {
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
