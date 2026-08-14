/**
 * O Book do Operador como material de consulta — e não como um anexo por bloco.
 *
 * **O que existia.** Duas portas, as duas estreitas. `buscarNoTextoDoBook`
 * procurava o termo dentro das entradas escritas à mão, com um `ILIKE` que só
 * acerta quem digitou exatamente a palavra que está lá; e `anexoDoBook` pegava
 * o arquivo **do bloco que a pergunta nomeava** e o mandava inteiro ao modelo.
 * Nenhuma das duas alcançava o conteúdo dos documentos: a regra de QLP ADM
 * podia estar escrita dentro do `.docx` de DESCONTO QLP ADM, e uma pergunta que
 * não dissesse o nome exato do bloco nunca chegava lá.
 *
 * **O que existe agora.** Todo o Book — regra escrita e documento anexado —
 * quebrado em trechos que sabem de onde vieram, indexado uma vez por revisão, e
 * procurável por qualquer pergunta. O que sai é um punhado de trechos ranqueados
 * com o bloco, a seção e o arquivo de cada um; o que a resposta afirmar sobre
 * eles é conferível abrindo o mesmo documento na tela do Book.
 *
 * **Por que léxico, e não embedding.** Três razões, e nenhuma é preguiça. O
 * vocabulário deste domínio é feito de siglas e nomes próprios — QLP ADM, CIVF,
 * PGR, 2nd Tier —, e é exatamente aí que a busca vetorial erra e a lexical
 * acerta: "QLP" não tem vizinhança semântica, tem grafia. O corpus inteiro cabe
 * em memória, então não há ganho de escala a colher. E o critério de seleção
 * precisa ser explicável a quem discordar da resposta: `pontos = cobertura +
 * frase + sigla + título` se lê em dez linhas; um vetor de 1536 dimensões, não.
 * O que a busca vetorial resolveria — sinônimo e paráfrase — é resolvido aqui
 * pela expansão a partir do próprio índice: quem escreve "QLP" recebe os outros
 * termos dos blocos cujo título contém QLP.
 *
 * **Duas etapas, e a segunda é que decide.** A primeira varre tudo e guarda os
 * trinta candidatos mais prováveis; a segunda reordena esses trinta com os
 * sinais caros — frase exata, casamento de título, seção, densidade — e devolve
 * meia dúzia. É a etapa que faltava: o primeiro resultado lexical quase nunca é
 * o melhor trecho, e sem reordenar o assistente respondia com o parágrafo que
 * tinha a palavra, não com o que tinha a regra.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { bookEntryTable, type Database } from "@workspace/db";
import { extrairDocumento } from "./anexos";
import {
  blocosDoTexto,
  renderizarBlocos,
  type BlocoDeDocumento,
} from "./documento";
import { normalizar, termos } from "./normalizar";

// ── O que um trecho é ───────────────────────────────────────────────────────

export interface TrechoDoBook {
  /** `Gente::QLP ADM#3#2` — bloco, revisão, posição. Estável entre buscas. */
  id: string;
  blockKey: string;
  bloco: string;
  categoria: string;
  revisao: number;
  tipo: "TEXTO" | "DOCUMENTO";
  /** O nome do arquivo, quando a entrada é um documento. */
  arquivo: string | null;
  /** O caminho de títulos até aqui: "Auditoria QLP ADM › Frequência". */
  secao: string | null;
  /** A ordem deste trecho dentro da entrada. */
  posicao: number;
  /** O trecho em markdown — tabela continua tabela. */
  texto: string;
  temTabela: boolean;
}

export interface TrechoDoBookRanqueado {
  trecho: TrechoDoBook;
  pontos: number;
  /** Por que este trecho subiu — para o painel técnico, nunca para a resposta. */
  porque: string[];
}

// ── Chunking ────────────────────────────────────────────────────────────────

/**
 * O tamanho que um trecho persegue, em caracteres.
 *
 * Grande o bastante para uma regra caber inteira com o título que a nomeia;
 * pequeno o bastante para meia dúzia deles caberem no contexto sem empurrar o
 * resto do dossiê para fora. O corte nunca acontece no meio de uma tabela nem
 * separa um título do primeiro parágrafo que vem sob ele — são as duas formas
 * de partir um documento que destroem justamente o que se queria recuperar.
 */
const ALVO_DO_TRECHO = 900;
const TETO_DO_TRECHO = 2600;
/** Linhas de uma tabela por trecho, quando ela sozinha passa do teto. */
const LINHAS_POR_FATIA = 25;

interface MetaDoTrecho {
  blockKey: string;
  bloco: string;
  categoria: string;
  revisao: number;
  tipo: "TEXTO" | "DOCUMENTO";
  arquivo: string | null;
}

/** O caminho de títulos vigente, do mais externo ao mais interno. */
function caminho(pilha: (string | null)[]): string | null {
  const partes = pilha.filter((t): t is string => Boolean(t));
  return partes.length > 0 ? partes.join(" › ") : null;
}

/**
 * Uma tabela grande demais vira fatias, cada uma repetindo o cabeçalho.
 *
 * Sem repetir o cabeçalho, a segunda metade de uma tabela de critérios chega ao
 * modelo como uma grade de valores sem nome de coluna — que é pior do que não
 * mandá-la, porque parece informação.
 */
function fatiarTabela(bloco: Extract<BlocoDeDocumento, { tipo: "TABELA" }>) {
  const fatias: BlocoDeDocumento[][] = [];
  for (let i = 0; i < bloco.linhas.length; i += LINHAS_POR_FATIA) {
    fatias.push([
      { tipo: "TABELA", cabecalho: bloco.cabecalho, linhas: bloco.linhas.slice(i, i + LINHAS_POR_FATIA) },
    ]);
  }
  return fatias.length > 0 ? fatias : [[bloco]];
}

/**
 * Os trechos de uma entrada do Book, na ordem do documento.
 *
 * A regra de corte é uma só, dita de três formas: um título sempre começa um
 * trecho novo (é ele que dá nome ao que vem abaixo), uma tabela nunca é partida
 * a não ser que sozinha estoure o teto, e o acúmulo fecha quando passa do alvo.
 */
export function trechosDosBlocos(
  blocos: BlocoDeDocumento[],
  meta: MetaDoTrecho,
): TrechoDoBook[] {
  const trechos: TrechoDoBook[] = [];
  const pilha: (string | null)[] = [];

  let atual: BlocoDeDocumento[] = [];
  let secaoDoAtual: string | null = null;
  let tamanho = 0;

  const fechar = () => {
    if (atual.length === 0) return;
    const texto = renderizarBlocos(atual);
    if (texto.trim()) {
      trechos.push({
        id: `${meta.blockKey}#${meta.revisao}#${trechos.length}`,
        blockKey: meta.blockKey,
        bloco: meta.bloco,
        categoria: meta.categoria,
        revisao: meta.revisao,
        tipo: meta.tipo,
        arquivo: meta.arquivo,
        secao: secaoDoAtual,
        posicao: trechos.length,
        texto,
        temTabela: atual.some((b) => b.tipo === "TABELA"),
      });
    }
    atual = [];
    tamanho = 0;
  };

  for (const bloco of blocos) {
    if (bloco.tipo === "TITULO") {
      /*
        O título fecha o trecho anterior e abre o seguinte — mas só quando já
        há conteúdo. Dois títulos seguidos ("QLP ADM" / "Frequência") pertencem
        ao mesmo trecho: separá-los produziria um trecho que é só um título.
      */
      if (atual.some((b) => b.tipo !== "TITULO")) fechar();
      pilha[bloco.nivel - 1] = bloco.texto;
      pilha.length = bloco.nivel;
      if (atual.length === 0) secaoDoAtual = caminho(pilha);
      atual.push(bloco);
      tamanho += bloco.texto.length;
      continue;
    }

    if (bloco.tipo === "TABELA") {
      const tamanhoDaTabela =
        bloco.linhas.reduce((n, l) => n + l.join("").length, 0) + bloco.cabecalho.join("").length;

      if (tamanhoDaTabela > TETO_DO_TRECHO) {
        fechar();
        for (const fatia of fatiarTabela(bloco)) {
          secaoDoAtual = caminho(pilha);
          atual = fatia;
          fechar();
        }
        continue;
      }

      if (tamanho + tamanhoDaTabela > TETO_DO_TRECHO) fechar();
      if (atual.length === 0) secaoDoAtual = caminho(pilha);
      atual.push(bloco);
      tamanho += tamanhoDaTabela;
      if (tamanho >= ALVO_DO_TRECHO) fechar();
      continue;
    }

    if (atual.length === 0) secaoDoAtual = caminho(pilha);
    atual.push(bloco);
    tamanho += bloco.texto.length;
    if (tamanho >= ALVO_DO_TRECHO) fechar();
  }

  fechar();
  return trechos;
}

// ── O índice ────────────────────────────────────────────────────────────────

interface EntradaBruta extends Record<string, unknown> {
  blockKey: string;
  blockCategory: string;
  blockTitle: string;
  kind: string;
  revision: number;
  filename: string | null;
  mimeType: string | null;
  bodyText: string | null;
  byteSize: string | number | null;
}

/**
 * O que já foi extraído, por bloco e revisão.
 *
 * Extrair um `.docx` é barato uma vez e caro a cada pergunta. A chave inclui a
 * revisão: uma revisão nova é outra entrada, e o cache não tem como servir o
 * documento velho — que é o defeito clássico deste tipo de cache, e o pior
 * possível num produto de auditoria.
 */
const cache = new Map<string, TrechoDoBook[]>();

/** O teto de um documento que entra no índice. Acima disso, só o índice sabe dele. */
const TETO_DO_ARQUIVO = 8 * 1024 * 1024;

/**
 * Todo o Book em trechos — regra escrita e documento anexado.
 *
 * Uma consulta só ao banco: a lista das entradas vigentes com o conteúdo. O
 * `content` só é lido para as entradas cuja revisão ainda não está no cache, e
 * é por isso que a segunda pergunta da conversa não paga a extração de novo.
 */
export async function trechosDoBook(db: Database): Promise<TrechoDoBook[]> {
  const { rows } = await db.execute<EntradaBruta>(sql`
    SELECT DISTINCT ON (block_key)
           block_key AS "blockKey", block_category AS "blockCategory",
           block_title AS "blockTitle", kind::text AS kind, revision,
           filename, mime_type AS "mimeType", body_text AS "bodyText",
           byte_size AS "byteSize"
      FROM book_entry
     ORDER BY block_key, revision DESC
  `);

  const saida: TrechoDoBook[] = [];
  const faltando: EntradaBruta[] = [];
  const porChave = new Map<string, Buffer | null>();

  for (const linha of rows) {
    const chave = `${linha.blockKey}#${linha.revision}`;
    const guardado = cache.get(chave);
    if (guardado) saida.push(...guardado);
    else faltando.push(linha);
  }

  /*
    Só se buscam os bytes de quem vai ser lido.

    O `content` de uma entrada é um `bytea` que pode ter megabytes, e trazer
    todos numa consulta de partida é a diferença entre a primeira pergunta da
    sessão levar um segundo e levar dez. Entrada de texto não tem arquivo, e
    arquivo acima do teto não é aberto de qualquer forma.
  */
  const comArquivo = faltando.filter(
    (f) => f.kind !== "TEXTO" && Number(f.byteSize ?? 0) <= TETO_DO_ARQUIVO,
  );

  if (comArquivo.length > 0) {
    const conteudos = await db
      .select({
        blockKey: bookEntryTable.blockKey,
        revision: bookEntryTable.revision,
        content: bookEntryTable.content,
      })
      .from(bookEntryTable)
      .where(
        sql`(${bookEntryTable.blockKey}, ${bookEntryTable.revision}) IN (${sql.join(
          comArquivo.map((f) => sql`(${f.blockKey}, ${f.revision})`),
          sql`, `,
        )})`,
      );

    for (const c of conteudos) porChave.set(`${c.blockKey}#${c.revision}`, c.content);
  }

  if (faltando.length > 0) {
    for (const linha of faltando) {
      const chave = `${linha.blockKey}#${linha.revision}`;
      const meta: MetaDoTrecho = {
        blockKey: linha.blockKey,
        bloco: linha.blockTitle,
        categoria: linha.blockCategory,
        revisao: Number(linha.revision),
        tipo: linha.kind === "TEXTO" ? "TEXTO" : "DOCUMENTO",
        arquivo: linha.filename,
      };

      let blocos: BlocoDeDocumento[] = [];

      if (meta.tipo === "TEXTO") {
        blocos = blocosDoTexto(linha.bodyText ?? "");
      } else if (Number(linha.byteSize ?? 0) <= TETO_DO_ARQUIVO) {
        const bytes = porChave.get(chave);
        const documento = bytes
          ? extrairDocumento(linha.mimeType ?? "", Buffer.from(bytes))
          : null;
        blocos = documento?.blocos ?? [];
      }

      const trechos = trechosDosBlocos(blocos, meta);
      cache.set(chave, trechos);
      saida.push(...trechos);
    }
  }

  return saida;
}

/** Para os testes e para o dia em que o Book mudar sem o processo reiniciar. */
export function esquecerIndice(): void {
  cache.clear();
}

// ── Busca ───────────────────────────────────────────────────────────────────

/** Quantos candidatos a primeira etapa guarda para a segunda reordenar. */
const CANDIDATOS = 30;
/** Quantos trechos do mesmo bloco podem entrar na resposta. */
const POR_BLOCO = 3;

export interface OpcoesDaBusca {
  /** Quantos trechos entregar. */
  limite?: number;
  /**
   * O bloco de que a conversa já estava falando.
   *
   * É o que faz "qual a frequência?" continuar dentro do QLP ADM em vez de
   * procurar "frequência" nos sessenta e seis blocos — a pergunta de
   * continuidade não repete o assunto, e sem esta pista ela recomeça do zero.
   */
  blocoPreferido?: string | null;
  /** Termos extras que a orquestração já resolveu: o parâmetro, o equipamento. */
  termosExtras?: string[];
}

/** Uma sigla é curta, escrita em caixa alta, e não se parece com palavra. */
function siglasDe(pergunta: string): string[] {
  return [...pergunta.matchAll(/\b[A-Z][A-Z0-9]{1,5}\b/g)]
    .map((m) => normalizar(m[0]))
    .filter((s) => s.length >= 2);
}

/**
 * Os termos que a pergunta traz, mais os que o próprio Book associa a eles.
 *
 * A expansão não vem de dicionário: vem do índice. Quem escreve "QLP" casa o
 * título "QLP ADM" e "DESCONTO QLP ADM", e recebe de volta "adm" e "desconto"
 * como termos secundários — que é como um humano expandiria a busca depois de
 * ver a lista de blocos. Um dicionário de sinônimos escrito à mão precisaria
 * conhecer o vocabulário da Ambev de antemão, e envelheceria no primeiro bloco
 * novo.
 */
function expandir(
  palavras: string[],
  trechos: TrechoDoBook[],
): { principais: Set<string>; secundarios: Set<string> } {
  const principais = new Set(palavras);
  const secundarios = new Set<string>();

  const titulos = new Map<string, string[]>();
  for (const t of trechos) {
    if (!titulos.has(t.bloco)) titulos.set(t.bloco, termos(`${t.categoria} ${t.bloco}`));
  }

  for (const [, termosDoTitulo] of titulos) {
    if (!termosDoTitulo.some((t) => principais.has(t))) continue;
    for (const termo of termosDoTitulo) {
      if (!principais.has(termo)) secundarios.add(termo);
    }
  }

  return { principais, secundarios };
}

/** Quanto do texto casa com o conjunto de termos, com peso por tamanho. */
function cobertura(texto: string[], alvo: Set<string>): number {
  if (alvo.size === 0) return 0;
  let acertos = 0;
  for (const termo of alvo) if (texto.includes(termo)) acertos++;
  return acertos / alvo.size;
}

/**
 * Ranqueia os trechos para esta pergunta — recall primeiro, precisão depois.
 *
 * Separado da consulta ao banco de propósito: assim ele é testável com trechos
 * escritos à mão, e o critério de seleção — a decisão mais consequente do
 * retrieval — pode ser exercitado sem Postgres e sem rede.
 */
export function ranquear(
  trechos: TrechoDoBook[],
  pergunta: string,
  opcoes: OpcoesDaBusca = {},
): TrechoDoBookRanqueado[] {
  const { limite = 6, blocoPreferido = null, termosExtras = [] } = opcoes;

  const palavras = [...termos(pergunta), ...termosExtras.flatMap((t) => termos(t))];
  if (palavras.length === 0) return [];

  const { principais, secundarios } = expandir(palavras, trechos);
  const siglas = siglasDe(pergunta);
  const frase = normalizar(pergunta).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const alvoPreferido = blocoPreferido ? normalizar(blocoPreferido) : null;

  /*
    ---- etapa 1: recall ------------------------------------------------------

    O bloco do fio entra mesmo sem casar palavra nenhuma. "Qual a frequência?"
    depois de uma explicação sobre o QLP ADM não casa nada num documento que
    escreveu "Periodicidade" — e é uma pergunta perfeitamente clara para quem
    estava na conversa. Descartá-los aqui deixava a segunda etapa sem nada para
    reordenar, e a resposta era "não encontrei" sobre o documento que estava
    aberto no turno anterior. Sinônimo de domínio é o que a busca lexical não
    resolve; o fio resolve, e é evidência melhor que qualquer dicionário —
    ele diz de que documento se estava falando.
  */
  const candidatos = trechos
    .map((trecho) => {
      const vocabulario = termos(`${trecho.bloco} ${trecho.secao ?? ""} ${trecho.texto}`);
      return {
        trecho,
        vocabulario,
        bruto: cobertura(vocabulario, principais) + cobertura(vocabulario, secundarios) * 0.3,
      };
    })
    .filter((c) => c.bruto > 0 || (alvoPreferido && normalizar(c.trecho.bloco) === alvoPreferido))
    .sort((a, b) => b.bruto - a.bruto)
    .slice(0, CANDIDATOS);

  // ---- etapa 2: reranking ---------------------------------------------------
  const ranqueados = candidatos.map(({ trecho, vocabulario, bruto }) => {
    const porque: string[] = [];
    let pontos = bruto;

    const normalizado = normalizar(trecho.texto);
    const noTitulo = cobertura(termos(`${trecho.categoria} ${trecho.bloco}`), principais);
    if (noTitulo > 0.5) {
      pontos += noTitulo;
      porque.push(`título do bloco (${trecho.bloco})`);
    }

    if (trecho.secao) {
      const naSecao = cobertura(termos(trecho.secao), principais);
      if (naSecao > 0.4) {
        pontos += naSecao * 0.6;
        porque.push(`seção "${trecho.secao}"`);
      }
    }

    /*
      A frase inteira vale mais que as palavras soltas.

      "desconto qlp adm" dentro do texto é evidência de que o trecho fala
      **daquilo**; as mesmas três palavras espalhadas em parágrafos diferentes
      são coincidência de vocabulário. Sem este sinal, o trecho longo que
      menciona tudo um pouco ganhava do trecho curto que responde.
    */
    if (frase.length >= 8 && normalizado.includes(frase)) {
      pontos += 1;
      porque.push("a pergunta aparece literalmente");
    }

    for (const sigla of siglas) {
      if (vocabulario.includes(sigla)) {
        pontos += 0.4;
        porque.push(`sigla ${sigla.toUpperCase()}`);
      }
    }

    if (alvoPreferido && normalizar(trecho.bloco) === alvoPreferido) {
      pontos += 0.7;
      porque.push("é o bloco de que a conversa já falava");
    }

    /*
      O começo do documento responde "o que é isto".

      Definição e objetivo moram nos primeiros parágrafos de todo documento de
      operação; procedimento e exceção vêm depois. O empurrão é pequeno de
      propósito — ele desempata, não decide.
    */
    if (trecho.posicao === 0) {
      pontos += 0.2;
      porque.push("abertura do documento");
    }

    // Densidade: um trecho curto que casa vale mais que um longo que casa igual.
    pontos *= 1 + Math.min(300 / Math.max(trecho.texto.length, 100), 1) * 0.15;

    return { trecho, pontos, porque };
  });

  // ---- diversidade ----------------------------------------------------------
  /*
    Três trechos do mesmo documento bastam.

    Sem o teto, um documento longo que casa bem ocupava as seis vagas e a
    resposta ficava cega para o bloco vizinho que tinha a outra metade da regra
    — que é justamente o cruzamento que se quer.
  */
  const porBloco = new Map<string, number>();
  const escolhidos: TrechoDoBookRanqueado[] = [];

  for (const item of ranqueados.sort((a, b) => b.pontos - a.pontos)) {
    const usados = porBloco.get(item.trecho.blockKey) ?? 0;
    if (usados >= POR_BLOCO) continue;
    porBloco.set(item.trecho.blockKey, usados + 1);
    escolhidos.push(item);
    if (escolhidos.length >= limite) break;
  }

  return escolhidos;
}

/**
 * O limiar: abaixo disto o casamento é ruído.
 *
 * Vale a mesma regra do corpus conceitual — quem não passa daqui não entra na
 * resposta, e a resposta certa passa a ser "não encontrei no Book".
 */
export const LIMIAR_DO_BOOK = 0.25;

/** A busca completa: índice, ranqueamento e limiar. */
export async function buscarNoBook(
  db: Database,
  pergunta: string,
  opcoes: OpcoesDaBusca = {},
): Promise<TrechoDoBookRanqueado[]> {
  const trechos = await trechosDoBook(db);
  if (trechos.length === 0) return [];
  return ranquear(trechos, pergunta, opcoes).filter((r) => r.pontos >= LIMIAR_DO_BOOK);
}

/**
 * O documento inteiro de um bloco, quando a pergunta é sobre ele.
 *
 * Trecho serve para achar; documento inteiro serve para explicar. Quando a
 * pergunta nomeia um bloco — "me explique o QLP ADM" —, meia dúzia de trechos
 * espalhados descrevem pedaços, e o que responde é o documento na ordem em que
 * foi escrito. O teto existe porque um manual de duzentas páginas não cabe, e
 * nesse caso os trechos ranqueados continuam sendo a resposta.
 */
export const TETO_DO_DOCUMENTO_INTEIRO = 12000;

export async function documentoDoBloco(
  db: Database,
  blockKey: string,
): Promise<TrechoDoBook[] | null> {
  const trechos = (await trechosDoBook(db)).filter((t) => t.blockKey === blockKey);
  if (trechos.length === 0) return null;
  const tamanho = trechos.reduce((n, t) => n + t.texto.length, 0);
  return tamanho <= TETO_DO_DOCUMENTO_INTEIRO ? trechos : null;
}

/** O texto de um conjunto de trechos, como ele vai ao modelo. */
export function textoDosTrechos(trechos: TrechoDoBook[]): string {
  return trechos.map((t) => t.texto).join("\n\n");
}

/** Os blocos que têm conteúdo registrado — para a cobertura e para o índice. */
export async function blocosComConteudo(
  db: Database,
): Promise<{ blockKey: string; bloco: string; categoria: string; tipo: string }[]> {
  const { rows } = await db.execute<{
    blockKey: string;
    bloco: string;
    categoria: string;
    tipo: string;
  }>(sql`
    SELECT DISTINCT ON (block_key)
           block_key AS "blockKey", block_title AS "bloco",
           block_category AS "categoria", kind::text AS tipo
      FROM book_entry
     ORDER BY block_key, revision DESC
  `);
  return rows;
}

/** O arquivo vigente de um bloco — para quem precisa dos bytes, não do texto. */
export async function arquivoDoBloco(db: Database, blockKey: string) {
  const [linha] = await db
    .select({
      filename: bookEntryTable.filename,
      mimeType: bookEntryTable.mimeType,
      byteSize: bookEntryTable.byteSize,
      revision: bookEntryTable.revision,
      content: bookEntryTable.content,
      blockTitle: bookEntryTable.blockTitle,
    })
    .from(bookEntryTable)
    .where(and(eq(bookEntryTable.blockKey, blockKey), eq(bookEntryTable.kind, "DOCUMENTO")))
    .orderBy(desc(bookEntryTable.revision))
    .limit(1);
  return linha ?? null;
}
