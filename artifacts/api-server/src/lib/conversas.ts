/**
 * O armazém das conversas — e o portão do dono, num lugar só.
 *
 * **Conversa é privada de quem a criou.** Toda função aqui recebe `ownerId` como
 * primeiro argumento depois do banco, e nenhuma delas tem sobrecarga que o
 * dispense. Uma rota nova que esqueça o dono não compila; era o único jeito de
 * a regra não depender de alguém reler cada rota.
 *
 * **Por que isto não vive dentro das rotas.** Vivia, e a regra só podia ser
 * verificada à mão contra um servidor de pé. Aqui ela é uma função com banco
 * real, e a suíte confere que um segundo usuário não lê, não renomeia, não
 * arquiva e não escreve na conversa do primeiro — que é a única forma de essa
 * promessa sobreviver à próxima rota.
 *
 * **Excluir é arquivar.** `archivedAt` recebe a data e a conversa some da
 * lista; nenhuma linha é apagada. É a mesma regra do Book e das contas: o
 * histórico que sustentou uma decisão de auditoria não se apaga porque alguém
 * arrumou a barra lateral.
 *
 * O compartilhamento entre pessoas não existe hoje e não foi fechado fora: a
 * coluna é `owner_id`, não `user_id`, e todo caminho de leitura passa por
 * `daPessoa()` — o dia em que houver convidado, é ali que ele entra.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ehSaudacao } from "@workspace/assistant";
import {
  assistantConversationTable,
  assistantMessageTable,
  type Database,
} from "@workspace/db";

/** O filtro do dono. Toda consulta de conversa passa por aqui. */
function daPessoa(ownerId: string, conversationId?: string) {
  const base = and(
    eq(assistantConversationTable.ownerId, ownerId),
    isNull(assistantConversationTable.archivedAt),
  );
  return conversationId
    ? and(base, eq(assistantConversationTable.id, conversationId))
    : base;
}

/** O nome que se dá a uma conversa que ainda não disse do que trata. */
export const CONVERSA_SEM_ASSUNTO = "Nova conversa";

/*
  ---- caixa alta ----------------------------------------------------------

  Os nomes de bloco e de parâmetro chegam do Book em CAIXA ALTA, porque é
  assim que a planilha os escreve. A barra lateral repetia isso e ficava uma
  coluna de gritos: PREÇO COMBUSTÍVEIS, CUSTO FIXO DE EQUIPAMENTOS. Título de
  conversa é texto para ler de relance, não cabeçalho de tabela.

  A conversão só acontece quando **não há nenhuma minúscula** no texto — quem
  escreve "Preço de combustíveis" já decidiu a caixa, e ninguém mexe. As
  siglas do domínio sobrevivem: elas são o que distingue um título do outro.
*/

/* prettier-ignore */
const PALAVRAS_VAZIAS = new Set([
  // artigos, preposições e conectivos
  "a", "à", "ao", "aos", "as", "às", "com", "da", "das", "de", "do", "dos",
  "e", "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "pela",
  "pelas", "pelo", "pelos", "por", "pra", "que", "se", "um", "uma", "umas",
  "uns",
  // o que só faz sentido diante da tela: demonstrativos e pronomes
  "aquele", "aquela", "aquilo", "aí", "ali", "aqui", "dela", "dele", "delas",
  "deles", "disso", "dessa", "desse", "desta", "deste", "ela", "ele", "elas",
  "eles", "essa", "esse", "esta", "este", "isso", "isto", "me", "mim", "meu",
  "minha", "nisso", "você", "voce", "favor",
]);

function semAcento(palavra: string): string {
  return palavra.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/* prettier-ignore */
const SIGLAS = new Set([
  "ADM", "ANTT", "CIF", "CNH", "CRLV", "DPVAT", "FINAME", "FIPE", "FOB",
  "GNV", "ICMS", "IPVA", "PF", "PJ", "QLP", "RNTRC", "SP",
]);

/** Uma palavra que continua em caixa alta: sigla conhecida, curta ou sem vogal. */
function ehSigla(palavra: string): boolean {
  const nu = palavra.replace(/[^\p{L}\p{N}]/gu, "");
  if (!nu) return false;
  if (SIGLAS.has(nu)) return true;
  if (PALAVRAS_VAZIAS.has(nu.toLowerCase())) return false;
  if (nu.length <= 3) return true;
  return !/[AEIOUÁÉÍÓÚÂÊÔÃÕÀ]/u.test(nu);
}

/** Deixa o texto legível quando ele vem todo em caixa alta. */
export function emCaixaDeTitulo(texto: string): string {
  if (/\p{Ll}/u.test(texto)) return texto;

  const palavras = texto.split(/(\s+)/).map((p) => (ehSigla(p) ? p : p.toLowerCase()));

  /*
    A maiúscula volta só na primeira letra da frase — e só se a frase não
    começar por sigla, senão "IPVA e licenciamento" viraria "IPVA E ...".
  */
  return palavras.join("").replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

/*
  ---- o que a pergunta precisa ter para virar nome -------------------------

  "me explica isso aí" e "quanto mudou?" não nomeiam nada: elas apontam para o
  que já estava na tela. Um título feito delas não ajuda ninguém a reencontrar
  a conversa daqui a duas semanas — nesse caso o assunto resolvido (o bloco do
  Book, a gaveta) diz mais.

  O teste é grosseiro de propósito: tirando artigos, preposições e os
  demonstrativos que dependem do contexto, restam pelo menos três palavras?
  Então a frase se sustenta sozinha e é ela que batiza a conversa.
*/

function nomeiaOAssunto(frase: string): boolean {
  const palavras = frase
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((p) => !PALAVRAS_VAZIAS.has(p) && !PALAVRAS_VAZIAS.has(semAcento(p)));
  return palavras.length >= 3;
}

/**
 * O título de uma conversa — **a pergunta que a abriu, quando ela se explica.**
 *
 * A barra lateral tinha meia dúzia de conversas chamadas "ola", porque o
 * título nascia da primeira linha digitada e a primeira linha costuma ser um
 * cumprimento; a correção de então passou a nomear tudo pelo bloco do Book, e
 * a lista virou outra coisa repetida — seis conversas chamadas "CUSTO FIXO DE
 * EQUIPAMENTOS", indistinguíveis entre si.
 *
 * Agora a ordem é a que o ChatGPT e o Claude usam: **quem batiza é a pergunta**,
 * desde que ela nomeie o próprio assunto. Só quando a frase se apoia no que já
 * estava na tela ("me explica isso aí") ou é um cumprimento é que o assunto
 * resolvido entra como nome. Quando nada disso existe, devolve `null`, e quem
 * chama guarda um nome provisório que a próxima pergunta substitui.
 */
export function tituloDe(
  pergunta: string,
  assunto: { bloco?: string | null; parametro?: string | null } = {},
): string | null {
  const daPergunta = tituloDaPergunta(pergunta);
  if (daPergunta) return daPergunta;

  if (assunto.bloco) return emCaixaDeTitulo(assunto.bloco).slice(0, 200);
  if (assunto.parametro) return emCaixaDeTitulo(assunto.parametro).slice(0, 200);
  return null;
}

/** A frase digitada como título, ou `null` quando ela não se sustenta sozinha. */
function tituloDaPergunta(pergunta: string): string | null {
  if (ehSaudacao(pergunta)) return null;

  const limpo = pergunta
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.]+$/, "");
  if (limpo.length < 6) return null;
  if (!nomeiaOAssunto(limpo)) return null;

  const texto = emCaixaDeTitulo(limpo);
  if (texto.length <= 60) return texto;

  const corte = texto.slice(0, 60);
  const espaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, espaco > 0 ? espaco : 60)}…`;
}

/*
  A lista suaviza a caixa alta na leitura, e não com um UPDATE: as conversas
  que já existem foram batizadas com o nome do bloco em CAIXA ALTA, e reescrever
  a coluna apagaria o título que a pessoa por acaso tenha dado à mão. Quem
  escreveu qualquer minúscula não é tocado (ver `emCaixaDeTitulo`).
*/
export async function listarConversas(db: Database, ownerId: string) {
  const linhas = await db
    .select({
      id: assistantConversationTable.id,
      title: assistantConversationTable.title,
      updatedAt: assistantConversationTable.updatedAt,
      createdAt: assistantConversationTable.createdAt,
    })
    .from(assistantConversationTable)
    .where(daPessoa(ownerId))
    .orderBy(desc(assistantConversationTable.updatedAt))
    .limit(100);

  return linhas.map((c) => ({ ...c, title: emCaixaDeTitulo(c.title) }));
}

/** A conversa, se ela for desta pessoa. `null` quando não for — nunca 403. */
export async function acharConversa(db: Database, ownerId: string, id: string) {
  const [conversa] = await db
    .select()
    .from(assistantConversationTable)
    .where(daPessoa(ownerId, id));
  return conversa ?? null;
}

export async function mensagensDaConversa(db: Database, conversationId: string) {
  return db
    .select()
    .from(assistantMessageTable)
    .where(eq(assistantMessageTable.conversationId, conversationId))
    .orderBy(asc(assistantMessageTable.position));
}

export async function renomearConversa(
  db: Database,
  ownerId: string,
  id: string,
  titulo: string,
) {
  const [atualizada] = await db
    .update(assistantConversationTable)
    .set({ title: titulo.slice(0, 200), updatedAt: new Date() })
    .where(daPessoa(ownerId, id))
    .returning();
  return atualizada ?? null;
}

/** Arquiva. Nenhuma linha é apagada, nem a conversa nem as mensagens. */
export async function arquivarConversa(db: Database, ownerId: string, id: string) {
  const [arquivada] = await db
    .update(assistantConversationTable)
    .set({ archivedAt: new Date() })
    .where(daPessoa(ownerId, id))
    .returning({ id: assistantConversationTable.id });
  return arquivada ?? null;
}

export async function criarConversa(
  db: Database,
  ownerId: string,
  titulo: string,
  estado: object,
) {
  const [criada] = await db
    .insert(assistantConversationTable)
    .values({ ownerId, title: titulo, state: estado })
    .returning();
  return criada!;
}

export async function guardarEstado(db: Database, id: string, estado: object) {
  await db
    .update(assistantConversationTable)
    .set({ state: estado, updatedAt: new Date() })
    .where(eq(assistantConversationTable.id, id));
}

/**
 * Grava a pergunta e a resposta como duas linhas consecutivas.
 *
 * A posição vem de `max(position) + 1` lido na hora: é o que mantém a ordem da
 * conversa mesmo se duas abas perguntarem quase junto — a segunda lê a posição
 * depois da primeira ter gravado, e nenhuma das duas sobrescreve a outra.
 */
/**
 * O voto de quem leu, guardado no turno.
 *
 * O filtro do dono passa pela conversa, não pela mensagem: quem vota tem de ser
 * quem perguntou. Sem isso, um id de mensagem adivinhado deixaria qualquer
 * pessoa autenticada escrever no histórico de outra.
 *
 * Votar de novo troca o voto — inclusive para nenhum, que é como se desfaz um
 * clique errado. É a mesma regra de toda opinião: a última vale.
 */
export async function registrarFeedback(
  db: Database,
  ownerId: string,
  conversationId: string,
  messageId: string,
  feedback: "UTIL" | "NAO_UTIL" | null,
  nota?: string | null,
) {
  const conversa = await acharConversa(db, ownerId, conversationId);
  if (!conversa) return null;

  const [linha] = await db
    .update(assistantMessageTable)
    .set({
      feedback,
      feedbackNote: nota ?? null,
      feedbackAt: feedback ? new Date() : null,
    })
    .where(
      and(
        eq(assistantMessageTable.id, messageId),
        eq(assistantMessageTable.conversationId, conversationId),
        eq(assistantMessageTable.role, "RESPOSTA"),
      ),
    )
    .returning({
      id: assistantMessageTable.id,
      feedback: assistantMessageTable.feedback,
    });

  return linha ?? null;
}

export async function gravarTurno(
  db: Database,
  conversationId: string,
  pergunta: string,
  resposta: { texto: string; redacao: string; evidencia: object; rastro?: object | null },
) {
  const [linha] = await db
    .select({
      proxima: sql<number>`coalesce(max(${assistantMessageTable.position}), -1) + 1`.mapWith(
        Number,
      ),
    })
    .from(assistantMessageTable)
    .where(eq(assistantMessageTable.conversationId, conversationId));

  const proxima = linha?.proxima ?? 0;

  const gravadas = await db.insert(assistantMessageTable).values([
    { conversationId, position: proxima, role: "PERGUNTA", content: pergunta },
    {
      conversationId,
      position: proxima + 1,
      role: "RESPOSTA",
      content: resposta.texto,
      writer: resposta.redacao,
      evidence: resposta.evidencia,
      /*
        O rastro entra na mesma escrita que a resposta, e não numa segunda.

        Uma segunda escrita poderia falhar sozinha e deixar a mensagem gravada
        sem rastro — o estado exato que este campo existe para não ter, e o mais
        difícil de notar, porque a conversa continua funcionando.
      */
      trace: resposta.rastro ?? null,
    },
  ]).returning({ id: assistantMessageTable.id, role: assistantMessageTable.role });

  /*
    O id da resposta volta porque a tela precisa dele para votar.

    Sem isto o feedback só existiria depois de recarregar a conversa — e o
    momento em que alguém quer dizer "isto não ajudou" é o momento em que
    acabou de ler.
  */
  return { respostaId: gravadas.find((g) => g.role === "RESPOSTA")?.id ?? null };
}
