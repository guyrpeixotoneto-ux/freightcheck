import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  integracaoChamadaTable,
  integracaoChaveTable,
  integracaoTable,
  type Database,
} from "@workspace/db";
import {
  IntegracaoNaoEncontrada,
  NomeDeIntegracaoJaUsado,
  chaveConfere,
  decidir,
  emitirChave,
  escoposConhecidos,
  hashDaChave,
  prefixoDe,
  recusar,
  type ChaveEmitida,
  type ChaveGuardada,
  type Decisao,
  type Escopo,
} from "@workspace/integrations";

/**
 * A gestão das integrações, e a conferência da chave — as duas contra o banco.
 *
 * A regra de **decidir** não mora aqui: mora em `@workspace/integrations`, sem
 * banco e sem HTTP, e é lá que ela é testada caso a caso. O que este arquivo
 * faz é o trabalho que exige tabela — achar a chave pelo prefixo, gravar a
 * chamada, listar o que a tela mostra — e nada mais. A divisão é a mesma de
 * todo o resto deste servidor: as rotas não decidem, e o acesso ao banco não
 * inventa política.
 */

/** Uma integração como a tela a lista, com o resumo que responde "está viva?". */
export interface IntegracaoNaTela {
  id: string;
  nome: string;
  sistema: string;
  descricao: string | null;
  criadaEm: string;
  criadaPor: string;
  desativadaEm: string | null;
  desativadaPor: string | null;
  chaves: ChaveNaTela[];
  /** Chamadas nas últimas 24 horas, por desfecho. */
  ultimas24h: { ok: number; recusadas: number; falhas: number };
  ultimaChamadaEm: string | null;
}

export interface ChaveNaTela {
  id: string;
  prefixo: string;
  apelido: string | null;
  escopos: Escopo[];
  criadaEm: string;
  criadaPor: string;
  ultimaChamadaEm: string | null;
  revogadaEm: string | null;
  revogadaPor: string | null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/**
 * A lista da tela: toda integração, com as chaves e o resumo de 24 horas.
 *
 * Três consultas, e não uma por integração: são poucas linhas em qualquer
 * cenário plausível — uma casa tem meia dúzia de sistemas conversando com esta
 * —, e o N+1 apareceria justamente no dia em que houvesse muitas.
 */
export async function listarIntegracoes(db: Database): Promise<IntegracaoNaTela[]> {
  const integracoes = await db
    .select()
    .from(integracaoTable)
    .orderBy(desc(integracaoTable.criadaEm));
  if (integracoes.length === 0) return [];

  const chaves = await db
    .select()
    .from(integracaoChaveTable)
    .orderBy(desc(integracaoChaveTable.criadaEm));

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const resumo = await db
    .select({
      integracaoId: integracaoChamadaTable.integracaoId,
      resultado: integracaoChamadaTable.resultado,
      quantas: sql<number>`count(*)::int`,
    })
    .from(integracaoChamadaTable)
    .where(gte(integracaoChamadaTable.em, desde))
    .groupBy(integracaoChamadaTable.integracaoId, integracaoChamadaTable.resultado);

  return integracoes.map((i) => {
    const minhas = chaves.filter((c) => c.integracaoId === i.id);
    const meuResumo = resumo.filter((r) => r.integracaoId === i.id);
    const conta = (resultado: string) =>
      meuResumo.find((r) => r.resultado === resultado)?.quantas ?? 0;
    /*
      A última chamada da integração é a mais recente entre as das chaves dela —
      inclusive as revogadas. É o carimbo que responde "este sistema ainda está
      falando com o nosso?", e uma chave revogada ontem responde essa pergunta.
    */
    const ultimas = minhas
      .map((c) => c.ultimaChamadaEm)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime());

    return {
      id: i.id,
      nome: i.nome,
      sistema: i.sistema,
      descricao: i.descricao,
      criadaEm: i.criadaEm.toISOString(),
      criadaPor: i.criadaPor,
      desativadaEm: iso(i.desativadaEm),
      desativadaPor: i.desativadaPor,
      chaves: minhas.map((c) => ({
        id: c.id,
        prefixo: c.prefixo,
        apelido: c.apelido,
        escopos: escoposConhecidos(c.escopos),
        criadaEm: c.criadaEm.toISOString(),
        criadaPor: c.criadaPor,
        ultimaChamadaEm: iso(c.ultimaChamadaEm),
        revogadaEm: iso(c.revogadaEm),
        revogadaPor: c.revogadaPor,
      })),
      ultimas24h: {
        ok: conta("OK"),
        recusadas: conta("RECUSADA"),
        falhas: conta("FALHA"),
      },
      ultimaChamadaEm: iso(ultimas[0] ?? null),
    };
  });
}

/** Cria a integração. O nome é único, e a recusa por nome repetido é do domínio. */
export async function criarIntegracao(
  db: Database,
  dados: { nome: string; sistema: string; descricao: string | null; por: string },
): Promise<{ id: string }> {
  const jaExiste = await db
    .select({ id: integracaoTable.id })
    .from(integracaoTable)
    .where(eq(integracaoTable.nome, dados.nome))
    .limit(1);
  if (jaExiste.length > 0) throw new NomeDeIntegracaoJaUsado(dados.nome);

  const [criada] = await db
    .insert(integracaoTable)
    .values({
      nome: dados.nome,
      sistema: dados.sistema,
      descricao: dados.descricao,
      criadaPor: dados.por,
    })
    .returning({ id: integracaoTable.id });
  return { id: criada!.id };
}

/**
 * Desativa ou reativa a integração inteira.
 *
 * É o botão de pânico, e por isso ele não é "excluir": desligar a porta sem
 * perder o registro do que passou por ela é o que se quer às três da manhã.
 * Reativar existe pela mesma razão — a suspeita que motivou o desligamento nem
 * sempre se confirma, e voltar não deveria custar chave nova.
 */
export async function ajustarIntegracao(
  db: Database,
  id: string,
  ativa: boolean,
  por: string,
): Promise<void> {
  const [alterada] = await db
    .update(integracaoTable)
    .set(
      ativa
        ? { desativadaEm: null, desativadaPor: null }
        : { desativadaEm: new Date(), desativadaPor: por },
    )
    .where(eq(integracaoTable.id, id))
    .returning({ id: integracaoTable.id });
  if (!alterada) throw new IntegracaoNaoEncontrada();
}

/**
 * Emite uma chave. O segredo volta **uma vez**, aqui, e não é gravado.
 *
 * Quem chama tem uma responsabilidade: entregá-lo na resposta e não guardá-lo
 * em lugar nenhum — nem em log, nem em variável que vá parar num relatório de
 * erro.
 */
export async function emitirChaveDaIntegracao(
  db: Database,
  integracaoId: string,
  dados: { escopos: Escopo[]; apelido: string | null; por: string },
): Promise<{ segredo: string; chave: ChaveNaTela }> {
  const [integracao] = await db
    .select({ id: integracaoTable.id })
    .from(integracaoTable)
    .where(eq(integracaoTable.id, integracaoId))
    .limit(1);
  if (!integracao) throw new IntegracaoNaoEncontrada();

  const emitida: ChaveEmitida = emitirChave();
  const [linha] = await db
    .insert(integracaoChaveTable)
    .values({
      integracaoId,
      prefixo: emitida.prefixo,
      hash: emitida.hash,
      escopos: dados.escopos,
      apelido: dados.apelido,
      criadaPor: dados.por,
    })
    .returning();

  return {
    segredo: emitida.segredo,
    chave: {
      id: linha!.id,
      prefixo: linha!.prefixo,
      apelido: linha!.apelido,
      escopos: escoposConhecidos(linha!.escopos),
      criadaEm: linha!.criadaEm.toISOString(),
      criadaPor: linha!.criadaPor,
      ultimaChamadaEm: null,
      revogadaEm: null,
      revogadaPor: null,
    },
  };
}

/**
 * Revoga uma chave, e revogar é para sempre.
 *
 * Não há "desrevogar": a chave revogada já foi tratada como comprometida por
 * quem clicou, e devolvê-la ao ar apagaria o sentido do gesto. Quem revogou por
 * engano emite outra, que custa um clique.
 *
 * A revogação de uma chave que já estava revogada não é erro — é o mesmo
 * estado, e responder recusa faria quem clicou duas vezes achar que a primeira
 * não valeu.
 */
export async function revogarChave(
  db: Database,
  chaveId: string,
  por: string,
): Promise<void> {
  const [alterada] = await db
    .update(integracaoChaveTable)
    .set({ revogadaEm: new Date(), revogadaPor: por })
    .where(
      and(
        eq(integracaoChaveTable.id, chaveId),
        sql`${integracaoChaveTable.revogadaEm} IS NULL`,
      ),
    )
    .returning({ id: integracaoChaveTable.id });
  if (alterada) return;

  const [existe] = await db
    .select({ id: integracaoChaveTable.id })
    .from(integracaoChaveTable)
    .where(eq(integracaoChaveTable.id, chaveId))
    .limit(1);
  if (!existe) throw new IntegracaoNaoEncontrada("Esta chave não existe.");
}

/** Uma linha do log, como a tela a mostra. */
export interface ChamadaNaTela {
  id: string;
  em: string;
  metodo: string;
  caminho: string;
  status: number;
  duracaoMs: number;
  resultado: string;
  motivo: string | null;
  bytes: number;
  prefixo: string | null;
  importRunId: string | null;
}

/** As últimas chamadas de uma integração — a prova de que a porta é usada. */
export async function listarChamadas(
  db: Database,
  integracaoId: string,
  limite = 100,
): Promise<ChamadaNaTela[]> {
  const linhas = await db
    .select({
      chamada: integracaoChamadaTable,
      prefixo: integracaoChaveTable.prefixo,
    })
    .from(integracaoChamadaTable)
    .leftJoin(
      integracaoChaveTable,
      eq(integracaoChaveTable.id, integracaoChamadaTable.chaveId),
    )
    .where(eq(integracaoChamadaTable.integracaoId, integracaoId))
    .orderBy(desc(integracaoChamadaTable.em))
    .limit(Math.min(Math.max(limite, 1), 500));

  return linhas.map(({ chamada, prefixo }) => ({
    id: chamada.id,
    em: chamada.em.toISOString(),
    metodo: chamada.metodo,
    caminho: chamada.caminho,
    status: chamada.status,
    duracaoMs: chamada.duracaoMs,
    resultado: chamada.resultado,
    motivo: chamada.motivo,
    bytes: chamada.bytes,
    prefixo,
    importRunId: chamada.importRunId,
  }));
}

// ---------------------------------------------------------------------------
// A conferência da chave apresentada
// ---------------------------------------------------------------------------

/**
 * Acha a chave pelo prefixo e decide, sem nunca comparar texto de segredo.
 *
 * O caminho é sempre o mesmo, e a ordem é o que o torna seguro: formato →
 * prefixo → hash em tempo constante → decisão. Uma chave que falha no formato
 * não vira consulta; uma que falha no prefixo não vira comparação; e a
 * comparação, quando acontece, é sobre dois hashes de mesmo tamanho.
 */
export async function conferirChave(
  db: Database,
  segredo: string | null,
  exigido: Escopo | null,
): Promise<Decisao> {
  if (segredo === null) return recusar("CHAVE_AUSENTE");
  const prefixo = prefixoDe(segredo);
  if (prefixo === null) return recusar("CHAVE_MALFORMADA");

  const [linha] = await db
    .select({
      id: integracaoChaveTable.id,
      integracaoId: integracaoChaveTable.integracaoId,
      integracaoNome: integracaoTable.nome,
      prefixo: integracaoChaveTable.prefixo,
      hash: integracaoChaveTable.hash,
      escopos: integracaoChaveTable.escopos,
      revogadaEm: integracaoChaveTable.revogadaEm,
      integracaoDesativadaEm: integracaoTable.desativadaEm,
    })
    .from(integracaoChaveTable)
    .innerJoin(integracaoTable, eq(integracaoTable.id, integracaoChaveTable.integracaoId))
    .where(eq(integracaoChaveTable.prefixo, prefixo))
    .limit(1);

  if (!linha) return recusar("CHAVE_DESCONHECIDA");
  if (!chaveConfere(hashDaChave(segredo), linha.hash)) {
    /*
      Prefixo certo e segredo errado responde a **mesma** frase de prefixo
      desconhecido, de propósito: distinguir os dois diria a quem tentasse que
      metade da chave está certa.
    */
    return recusar("CHAVE_DESCONHECIDA");
  }

  const guardada: ChaveGuardada = {
    id: linha.id,
    integracaoId: linha.integracaoId,
    integracaoNome: linha.integracaoNome,
    prefixo: linha.prefixo,
    escopos: escoposConhecidos(linha.escopos),
    revogadaEm: linha.revogadaEm,
    integracaoDesativadaEm: linha.integracaoDesativadaEm,
  };
  return decidir(guardada, exigido);
}

/** O que se grava de uma chamada, depois que ela terminou. */
export interface ChamadaParaGravar {
  integracaoId: string;
  chaveId: string;
  metodo: string;
  caminho: string;
  status: number;
  duracaoMs: number;
  resultado: "OK" | "RECUSADA" | "FALHA";
  motivo: string | null;
  bytes: number;
  requestId: string | null;
  importRunId: string | null;
}

/**
 * Grava a chamada e carimba a chave — as duas escritas do caminho externo.
 *
 * **Nunca lança.** O registro é do log, e um log que derruba a chamada que ele
 * registra inverte a prioridade: a integração pararia por causa de uma
 * indisponibilidade da tabela de auditoria dela. Quem chama passa o `avisar`
 * para que a falha apareça no log do processo, que é onde ela pode ser vista.
 */
export async function registrarChamada(
  db: Database,
  chamada: ChamadaParaGravar,
  avisar: (err: unknown) => void,
): Promise<void> {
  try {
    await db.insert(integracaoChamadaTable).values({
      integracaoId: chamada.integracaoId,
      chaveId: chamada.chaveId,
      metodo: chamada.metodo,
      caminho: chamada.caminho,
      status: chamada.status,
      duracaoMs: chamada.duracaoMs,
      resultado: chamada.resultado,
      motivo: chamada.motivo,
      bytes: chamada.bytes,
      requestId: chamada.requestId,
      importRunId: chamada.importRunId,
    });
    await db
      .update(integracaoChaveTable)
      .set({ ultimaChamadaEm: new Date() })
      .where(eq(integracaoChaveTable.id, chamada.chaveId));
  } catch (err) {
    avisar(err);
  }
}

/**
 * O desfecho de uma chamada em uma palavra, decidido pelo status.
 *
 * A conta é aqui e num lugar só: escrita na rota, ela seria reescrita na
 * seguinte, e as duas versões discordariam sobre o 409 no dia em que alguém
 * acrescentasse um.
 */
export function resultadoDoStatus(status: number): "OK" | "RECUSADA" | "FALHA" {
  if (status >= 500) return "FALHA";
  if (status >= 400) return "RECUSADA";
  return "OK";
}
