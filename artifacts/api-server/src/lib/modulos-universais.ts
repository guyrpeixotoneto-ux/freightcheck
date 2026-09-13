import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  moduloUniversalEventoTable,
  moduloUniversalTable,
  type Database,
} from "@workspace/db";
import { espelharDecisaoDaCasa } from "@workspace/db/decisao-da-casa";

/**
 * Módulos universais — o que a instalação inteira desligou.
 *
 * É a terceira camada do acesso, e a única que não fala de gente. As outras
 * duas respondem "quem alcança o quê": a exceção da pessoa
 * (`permissao_de_modulo`) e o papel dela (`papel_permissao`). Esta responde
 * **se a casa usa aquela parte do produto** — e por isso ela fica acima das
 * duas: chave desligada aqui é `SEM_ACESSO` para todo mundo, papel nenhum
 * devolve, exceção nenhuma devolve.
 *
 * Ela só tira, e tem dois estados (ver `schema/modulo-universal.ts`, onde a
 * decisão está por extenso). A ausência de linha é ligado — o mesmo silêncio
 * que concede nas outras duas tabelas —, e é o que faz esta camada nascer sem
 * mudar o menu de ninguém.
 *
 * **A seção do menu não tem chave.** Desligar "Processos" é desligar os módulos
 * dela; a seção some sozinha quando fica vazia (`filtrarGrupos`, na interface).
 * A tela agrupa as chaves como o menu as agrupa e oferece o botão da seção
 * inteira, que é o pedido de quem abre — mas o que trafega e o que é gravado
 * continuam sendo chaves de módulo, as mesmas que o portão de escrita já sabe
 * ler.
 */

/**
 * O que não se desliga, e por quê.
 *
 * `/configuracoes` é a porta de volta: é dentro dele que mora esta tela. Uma
 * casa que se desligasse a si mesma ficaria sem lugar nenhum na interface para
 * voltar atrás — o conserto seria um `DELETE` no banco, que é exatamente o tipo
 * de saída que este produto recusa oferecer como plano.
 *
 * O resto é desligável, inclusive os ambientes de trabalho: uma instalação que
 * não tem Fechamento AS não deve carregar o Fechamento AS no seletor do topo.
 */
export const CHAVES_PROTEGIDAS: readonly string[] = [
  "/configuracoes",
  /*
    E a **seção** onde ele mora, pela mesma razão e com mais força.

    Desde que a seção virou decisão própria, desligar `#administracao` esconderia
    `/configuracoes` sem nunca tocar na chave dele — a porta continuaria
    destrancada e a casa ficaria do lado de fora assim mesmo. Proteger o módulo e
    deixar a seção aberta seria proteger a fechadura e não a porta.
  */
  "#administracao",
];

/** As três formas de chave que esta camada aceita — módulo, ambiente e seção. */
function formaValida(chave: string): boolean {
  return (
    chave.startsWith("/") || chave.startsWith("@") || chave.startsWith("#")
  );
}

export interface ModuloUniversalDesligado {
  chave: string;
  desligadoEm: string;
  desligadoPor: string;
  motivo: string | null;
}

/** As chaves desligadas, com quem desligou e quando. */
export async function listarModulosDesligados(
  db: Database,
): Promise<ModuloUniversalDesligado[]> {
  const linhas = await db
    .select({
      chave: moduloUniversalTable.chave,
      desligadoEm: moduloUniversalTable.desligadoEm,
      desligadoPor: moduloUniversalTable.desligadoPor,
      motivo: moduloUniversalTable.motivo,
    })
    .from(moduloUniversalTable)
    .orderBy(moduloUniversalTable.chave);

  return linhas.map((l) => ({ ...l, desligadoEm: l.desligadoEm.toISOString() }));
}

/**
 * Só as chaves, que é o que a leitura do acesso precisa.
 *
 * É chamada uma vez por requisição autenticada, dentro de `permissoesDe`, e por
 * isso devolve o mínimo: um `Set` de texto, sem carimbo e sem autor. A tabela é
 * a lista do que a casa **não** usa — ela tem dezenas de linhas no pior caso, e
 * zero no caso normal.
 */
export async function chavesDesligadas(db: Database): Promise<Set<string>> {
  const linhas = await db
    .select({ chave: moduloUniversalTable.chave })
    .from(moduloUniversalTable);
  return new Set(linhas.map((l) => l.chave));
}

/**
 * A recusa de uma chave, em uma frase — ou `null` quando ela serve.
 *
 * Ligar é sempre permitido, inclusive uma chave protegida que tenha entrado no
 * banco por outro caminho: o que se recusa é **desligar** o que trancaria a
 * porta por dentro.
 */
export function problemaDaChave(chave: string, ligado: boolean): string | null {
  if (typeof chave !== "string" || chave.trim() === "") {
    return "Chave de módulo vazia.";
  }
  /*
    A forma é conferida na escrita, e não na leitura, porque é na escrita que
    ela ainda pode ser recusada. Uma chave fora das três formas não desliga
    nada — nenhum leitor pergunta por ela — e ficaria no banco parecendo uma
    decisão que vale, com autor e carimbo, para sempre.
  */
  if (!formaValida(chave)) {
    return `${chave} não é uma chave conhecida: módulo começa por "/", ambiente por "@" e seção por "#".`;
  }
  if (!ligado && CHAVES_PROTEGIDAS.includes(chave)) {
    return `${chave} não pode ser desligado: é onde mora esta tela, e sem ele ninguém desfaria a decisão.`;
  }
  return null;
}

/**
 * Liga e desliga chaves, e grava só o que mudou.
 *
 * Pedir "ligado" para uma chave que já está ligada não escreve nada e não vai
 * para o histórico: o histórico é a lista de decisões, e não a de cliques.
 */
export async function definirModulosUniversais(
  db: Database,
  entrada: {
    /** Chave → ligado. `false` desliga para todo mundo; `true` devolve ao menu. */
    chaves: Record<string, boolean>;
    /** Por que a casa não usa isto. Vale para todas as chaves deste pedido. */
    motivo?: string | null;
    /** O e-mail de quem decidiu. */
    por: string;
  },
): Promise<ModuloUniversalDesligado[]> {
  const motivo = entrada.motivo?.trim() ? entrada.motivo.trim() : null;

  /*
    Tudo numa transação só, e o espelho da casa dentro dela.

    Eram quatro escritas soltas — a linha desligada, a linha apagada, o evento e
    (agora) o espelho —, e cada fronteira entre elas era um estado que alguém
    podia ler: decisão sem histórico, histórico sem decisão. Nenhuma delas é
    grande, e é justamente por isso que não havia razão para deixá-las soltas.

    A transação é também o que faz a resposta desta função **merecer** o sucesso
    que a tela mostra: o que ela devolve é relido do banco depois do commit, e
    não montado a partir do que se pediu. Uma falha de gravação vira erro — não
    vira uma tela dizendo "desligado" sobre um banco que não desligou nada.
  */
  return db.transaction(async (tx) => {
    const desligadas = await chavesDesligadas(tx as unknown as Database);

    const paraDesligar: string[] = [];
    const paraLigar: string[] = [];

    for (const [chave, ligado] of Object.entries(entrada.chaves)) {
      const estaDesligada = desligadas.has(chave);
      if (ligado === !estaDesligada) continue;
      (ligado ? paraLigar : paraDesligar).push(chave);
    }

    for (const chave of paraDesligar) {
      await tx
        .insert(moduloUniversalTable)
        .values({ chave, desligadoPor: entrada.por, motivo })
        .onConflictDoUpdate({
          target: moduloUniversalTable.chave,
          set: { desligadoPor: entrada.por, desligadoEm: new Date(), motivo },
        });
    }

    if (paraLigar.length > 0) {
      await tx
        .delete(moduloUniversalTable)
        .where(inArray(moduloUniversalTable.chave, paraLigar));
    }

    const eventos = [
      ...paraDesligar.map((chave) => ({
        chave,
        ligado: false,
        motivo,
        por: entrada.por,
      })),
      ...paraLigar.map((chave) => ({
        chave,
        ligado: true,
        motivo: null,
        por: entrada.por,
      })),
    ];
    if (eventos.length > 0) {
      await tx.insert(moduloUniversalEventoTable).values(eventos);
    }

    /*
      O espelho fora de `public`, refeito aqui e só aqui — ver
      `@workspace/db/decisao-da-casa`, onde está escrito por que ele existe e
      por que não é uma segunda fonte de verdade. Dentro da transação: ou a
      decisão e o espelho dela entram juntos, ou nenhum dos dois entra.
    */
    await espelharDecisaoDaCasa(async (texto) => {
      const resultado = await tx.execute(sql.raw(texto));
      return (resultado as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
    });

    return listarModulosDesligados(tx as unknown as Database);
  });
}

/** O histórico da casa, do mais recente para o mais antigo. */
export async function historicoDosModulosUniversais(
  db: Database,
): Promise<
  Array<{
    chave: string;
    ligado: boolean;
    motivo: string | null;
    em: string;
    por: string;
  }>
> {
  const linhas = await db
    .select({
      chave: moduloUniversalEventoTable.chave,
      ligado: moduloUniversalEventoTable.ligado,
      motivo: moduloUniversalEventoTable.motivo,
      em: moduloUniversalEventoTable.em,
      por: moduloUniversalEventoTable.por,
    })
    .from(moduloUniversalEventoTable)
    .orderBy(desc(moduloUniversalEventoTable.em))
    .limit(200);

  return linhas.map((l) => ({ ...l, em: l.em.toISOString() }));
}

/** O histórico de uma chave só — para quem pergunta por uma tela que sumiu. */
export async function historicoDaChave(
  db: Database,
  chave: string,
): Promise<Array<{ ligado: boolean; em: string; por: string }>> {
  const linhas = await db
    .select({
      ligado: moduloUniversalEventoTable.ligado,
      em: moduloUniversalEventoTable.em,
      por: moduloUniversalEventoTable.por,
    })
    .from(moduloUniversalEventoTable)
    .where(eq(moduloUniversalEventoTable.chave, chave))
    .orderBy(desc(moduloUniversalEventoTable.em))
    .limit(50);

  return linhas.map((l) => ({ ...l, em: l.em.toISOString() }));
}
