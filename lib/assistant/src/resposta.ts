/**
 * Onde a pergunta vira resposta — e onde ela deixa de virar.
 *
 * A ordem aqui é a tese do módulo inteiro: **recuperar primeiro, escrever
 * depois.** O material é fechado antes de existir uma frase — os artigos que
 * este repositório aprovou e as consultas que este banco respondeu —, e só
 * então alguém redige sobre ele: o modelo, quando há um configurado; o código,
 * quando não há. Os dois escrevem do mesmo dossiê, e o dossiê vai junto para a
 * tela.
 *
 * A inversão dessa ordem é o defeito clássico do gênero: gerar a frase e depois
 * procurar com que sustentá-la. Ela produz respostas que soam bem e não se
 * conferem, que é o oposto do que este produto se propõe a fazer.
 *
 * **Não achar é um desfecho.** Quando nem o conhecimento nem o banco têm o que
 * responder, sai uma resposta que diz isso, com o que perguntar em vez disso. O
 * assistente que sempre responde é o assistente em que não dá para confiar,
 * porque a confiança dele soa igual quando ele sabe e quando ele não sabe.
 */

import type { Database } from "@workspace/db";
import { ARTIGOS, SUGESTOES, type Artigo } from "./conhecimento";
import {
  blocoDoBook,
  buscarNoTextoDoBook,
  coberturaDoBook,
  panorama,
  parametro,
  resumoDaVigencia,
  type BlocoDeDado,
  type Recorte,
} from "./dados";
import { disponivel, modeloConfigurado, redigir } from "./llm";
import { alvoProvavel, normalizar } from "./normalizar";
import { buscar, LIMIAR_DE_APOIO, type ArtigoRelevante } from "./recuperacao";

export interface FonteDeConhecimento {
  id: string;
  titulo: string;
  area: Artigo["area"];
  /** O arquivo, tela ou documento onde este artigo pode ser conferido. */
  fonte: string;
}

export interface Resposta {
  pergunta: string;
  /** O texto que a pessoa lê. */
  texto: string;
  /** Quem escreveu o texto — o modelo, ou o código. A tela mostra isto. */
  redacao: "IA" | "DETERMINISTICA";
  /** Qual modelo, quando foi um. */
  modelo: string | null;
  /** Os artigos que sustentam o texto. */
  conhecimento: FonteDeConhecimento[];
  /** Os números consultados, com origem — o lastro da resposta. */
  dados: BlocoDeDado[];
  /** Onde conferir no produto. */
  telas: { label: string; href: string }[];
  /** `true` quando nada foi encontrado e o texto diz isso. */
  semResposta: boolean;
}

// ── O que a pergunta está pedindo ───────────────────────────────────────────

interface Intencao {
  /** A pergunta pede algo que mora no banco — um número ou uma regra escrita. */
  querDado: boolean;
  book: boolean;
  parametros: boolean;
  panorama: boolean;
}

/**
 * Termos que só aparecem quando alguém quer um número.
 *
 * A distinção importa por dois motivos. O primeiro é honestidade: "o que é
 * cobertura da apuração" se responde com o artigo, e ir ao banco buscar a
 * cobertura de uma vigência qualquer para enfeitar a resposta anexaria um
 * número que ninguém pediu — e números anexados sem pedido são lidos como
 * resposta. O segundo é custo: cada consulta destas atravessa o motor de
 * comparação, e não vale a pena para quem perguntou o que uma palavra
 * significa.
 */
const PEDE_NUMERO = [
  "quanto", "quantos", "quantas", "qual o impacto", "quanto mudou", "qual foi",
  "mudou", "mudaram", "subiu", "caiu", "aumentou", "diminuiu", "variou",
  "ultima vigencia", "nesta vigencia", "no periodo", "resumo", "total",
  "quais blocos", "ja tem", "tem regra", "esta registrado", "quantos blocos",
  "o que temos", "o que ja foi", "importado", "importadas", "situacao", "status",
];

/**
 * Termos de quem quer o **conteúdo** registrado, não um número.
 *
 * Esta lista nasceu de um defeito: "qual a regra do bloco PNEU?" não continha
 * nenhum termo de `PEDE_NUMERO`, então o assistente nunca consultava o banco e
 * respondia com o artigo genérico sobre o que é o Book — enquanto a regra
 * pedida estava gravada em `book_entry`, a uma consulta de distância. Uma regra
 * escrita mora no banco tanto quanto um valor mora; o portão que decide ir até
 * lá não podia reconhecer só um dos dois.
 */
const PEDE_CONTEUDO = [
  "regra", "regras", "como funciona", "como e composto", "como e calculado",
  "composicao", "o que diz", "esta escrito", "documento", "anexo", "conteudo",
  "onde esta", "qual bloco", "qual o bloco",
];

const TERMOS_BOOK = [
  "book", "bloco", "blocos", "regra", "regras", "documento", "anexo", "revisao",
  "contrato", "manual", "operador",
];

const TERMOS_PARAMETRO = [
  "parametro", "parametros", "vigencia", "vigencias", "impacto", "alteracao",
  "alteracoes", "cobertura", "familia", "familias", "cartao", "segmento",
  "veiculo", "veiculos", "frota", "apuracao", "periodicidade",
];

const TERMOS_PANORAMA = [
  "importado", "importadas", "importacoes", "o que temos", "banco", "base",
  "panorama", "situacao", "cobertura geral", "quantas vigencias", "quantos ativos",
];

function contem(frase: string, termos: string[]): boolean {
  return termos.some((termo) => frase.includes(normalizar(termo)));
}

function lerIntencao(pergunta: string, relevantes: ArtigoRelevante[]): Intencao {
  const frase = normalizar(pergunta);
  const areas = new Set(relevantes.map((r) => r.artigo.area));

  const querDado = contem(frase, PEDE_NUMERO) || contem(frase, PEDE_CONTEUDO);

  return {
    querDado,
    book: contem(frase, TERMOS_BOOK) || areas.has("BOOK"),
    parametros: contem(frase, TERMOS_PARAMETRO) || areas.has("PARAMETROS"),
    panorama: contem(frase, TERMOS_PANORAMA),
  };
}

// ── Recuperação dos dados ───────────────────────────────────────────────────

/**
 * As consultas que esta pergunta justifica, todas em paralelo.
 *
 * Cada uma pode devolver `null` — o parâmetro não existe, o bloco não foi
 * achado, o banco está vazio — e `null` é filtrado sem virar erro. Um dossiê
 * menor é uma resposta mais curta e ainda verdadeira; um erro aqui seria uma
 * tela em branco por causa de uma consulta acessória.
 */
async function reunirDados(
  db: Database,
  pergunta: string,
  intencao: Intencao,
  recorte: Recorte,
): Promise<BlocoDeDado[]> {
  if (!intencao.querDado) return [];

  const alvo = alvoProvavel(pergunta);
  const pedidos: Promise<BlocoDeDado | null>[] = [];

  if (intencao.book) {
    pedidos.push(coberturaDoBook(db));
    if (alvo) {
      pedidos.push(blocoDoBook(db, alvo));
      pedidos.push(buscarNoTextoDoBook(db, alvo));
    }
  }

  /*
    Pergunta por número que não é sobre o Book é pergunta sobre a vigência —
    ainda que não diga a palavra "parâmetro".

    Este gate já exigiu um termo da lista `TERMOS_PARAMETRO` na frase, e o
    efeito foi perder a pergunta mais natural que existe neste produto:
    "quanto mudou no financiamento?" não contém "parâmetro", não contém
    "vigência" e não contém "impacto" — contém o nome da gaveta, que é como
    quem opera fala. A resposta caía no panorama do banco inteiro, um número
    verdadeiro sobre uma pergunta que ninguém fez.

    Consultar a mais é barato aqui: `parametro` devolve `null` quando nada
    casa, e um bloco a menos no dossiê não custa nada. Deixar de consultar é
    que sai caro.
  */
  if (intencao.parametros || (!intencao.book && !intencao.panorama)) {
    pedidos.push(resumoDaVigencia(db, recorte));
    if (alvo) pedidos.push(parametro(db, alvo, recorte));
  }

  if (intencao.panorama || pedidos.length === 0) {
    pedidos.push(panorama(db));
  }

  const resultados = await Promise.all(
    pedidos.map((p) =>
      p.catch(() => {
        // Uma consulta que falha não derruba as outras. O bloco simplesmente
        // não entra no dossiê, e a resposta é montada com o que respondeu.
        return null;
      }),
    ),
  );

  const blocos = resultados.filter((bloco): bloco is BlocoDeDado => bloco !== null);
  if (blocos.length > 0) return blocos;

  /*
    Pediram um número e nenhuma consulta respondeu.

    Sem isto, quem perguntasse "quanto mudou na última vigência?" com o banco
    vazio recebia dois artigos explicando o que é uma vigência e nenhuma
    menção ao fato de que não há vigência nenhuma importada — a resposta
    conversava sobre o conceito e deixava a pergunta de pé. O panorama sempre
    responde, e com o banco vazio ele responde "0 vigências importadas", que é
    a resposta que a pessoa foi buscar.
  */
  const geral = await panorama(db).catch(() => null);
  return geral ? [geral] : [];
}

// ── O dossiê ────────────────────────────────────────────────────────────────

/** O material fechado, em texto — o mesmo que a tela mostra ao lado. */
function montarDossie(relevantes: ArtigoRelevante[], dados: BlocoDeDado[]): string {
  const partes: string[] = [];

  if (relevantes.length > 0) {
    partes.push(
      "## CONHECIMENTO\n\n" +
        relevantes
          .map(
            ({ artigo }) =>
              `### ${artigo.titulo}\n(fonte: ${artigo.fonte})\n\n${artigo.corpo}`,
          )
          .join("\n\n"),
    );
  }

  if (dados.length > 0) {
    partes.push(
      "## DADOS CONSULTADOS AGORA\n\n" +
        dados
          .map((bloco) => {
            const fatos = bloco.fatos
              .map(
                (f) =>
                  `- ${f.rotulo}: ${f.valor}` + (f.detalhe ? ` — ${f.detalhe}` : ""),
              )
              .join("\n");
            const nota = bloco.nota ? `\nRessalva: ${bloco.nota}` : "";
            return `### ${bloco.titulo}\n(origem: ${bloco.origem})\n${fatos}${nota}`;
          })
          .join("\n\n"),
    );
  }

  return partes.join("\n\n") || "(vazio)";
}

// ── A redação sem modelo ────────────────────────────────────────────────────

/**
 * A resposta montada em código, do mesmo dossiê.
 *
 * Não é um degrau abaixo: é o artigo aprovado, escrito por quem o aprovou, com
 * os números consultados logo abaixo. O que ela não faz é reescrever o texto na
 * forma da pergunta — quem perguntou "por que a cobertura está em 0%" recebe o
 * artigo inteiro sobre cobertura, não o parágrafo específico. É a diferença que
 * um modelo configurado resolve, e é só ela.
 */
function redacaoDeterministica(
  relevantes: ArtigoRelevante[],
  dados: BlocoDeDado[],
): string {
  const partes: string[] = [];

  /*
    Quando há dado, o dado vem primeiro.

    Quem pergunta "quanto mudou" quer o número, e ler dois parágrafos de
    conceito antes de chegar nele é a mesma inversão que a tela de Parâmetros
    evita ao colocar o tamanho do movimento acima da explicação. O artigo vira
    o pano de fundo que ele é.
  */
  for (const bloco of dados) {
    const linhas = bloco.fatos
      .map((f) => `- **${f.rotulo}:** ${f.valor}${f.detalhe ? ` — ${f.detalhe}` : ""}`)
      .join("\n");
    partes.push(
      `**${bloco.titulo}**\n\n${linhas}` + (bloco.nota ? `\n\n${bloco.nota}` : ""),
    );
  }

  const quantosArtigos = dados.length > 0 ? 1 : 2;
  for (const { artigo } of relevantes.slice(0, quantosArtigos)) {
    partes.push(`**${artigo.titulo}**\n\n${artigo.corpo}`);
  }

  return partes.join("\n\n");
}

/** O texto de quando não há resposta. Diz o que fazer em vez de pedir desculpa. */
function textoSemResposta(): string {
  const exemplos = SUGESTOES.slice(0, 4)
    .map((s) => `- ${s.pergunta}`)
    .join("\n");
  return (
    "Não encontrei nada no que este produto sabe sustentar sobre isso — nem no " +
    "conhecimento registrado sobre o FreightCheck, nem no banco.\n\n" +
    "Este assistente responde sobre o produto e sobre o que está importado nele: " +
    "Parâmetros, Book do Operador, vigências, curadoria, importações e as regras de " +
    "leitura que valem para os números. Ele não responde sobre assuntos fora daqui, e " +
    "prefere dizer isso a improvisar uma resposta que ninguém conseguiria conferir.\n\n" +
    `Perguntas que ele responde:\n${exemplos}`
  );
}

// ── A entrada pública ───────────────────────────────────────────────────────

export interface PerguntaOptions {
  recorte?: Recorte;
  /** Desliga o modelo mesmo quando há chave — usado nos testes e na tela. */
  semIa?: boolean;
}

/**
 * Responde uma pergunta sobre o FreightCheck.
 *
 * O contrato: o `texto` nunca afirma nada que não esteja em `conhecimento` ou
 * em `dados`, e os dois vão na resposta justamente para que isso seja
 * verificável por quem ler. `redacao` diz quem escreveu.
 */
export async function responder(
  db: Database,
  pergunta: string,
  opcoes: PerguntaOptions = {},
): Promise<Resposta> {
  const limpa = pergunta.trim();
  const achados = buscar(limpa);
  const intencao = lerIntencao(limpa, achados);
  const dados = await reunirDados(db, limpa, intencao, opcoes.recorte ?? {});

  /*
    Com dado na mesa, o artigo fraco sai — do texto e do dossiê.

    Sai dos dois pelo mesmo motivo: se ele não é bom o bastante para ser
    impresso, também não é bom o bastante para o modelo se apoiar nele. Filtrar
    só a impressão deixaria o modelo escrevendo sobre um material que a tela não
    mostra, e o dossiê ao lado deixaria de explicar a resposta.
  */
  const relevantes =
    dados.length > 0 ? achados.filter((a) => a.pontos >= LIMIAR_DE_APOIO) : achados;

  const conhecimento: FonteDeConhecimento[] = relevantes.map(({ artigo }) => ({
    id: artigo.id,
    titulo: artigo.titulo,
    area: artigo.area,
    fonte: artigo.fonte,
  }));

  const telas = new Map<string, { label: string; href: string }>();
  for (const { artigo } of relevantes) {
    if (artigo.tela) telas.set(artigo.tela.href, artigo.tela);
  }
  for (const bloco of dados) {
    if (bloco.tela) telas.set(bloco.tela.href, bloco.tela);
  }

  if (achados.length === 0 && dados.length === 0) {
    return {
      pergunta: limpa,
      texto: textoSemResposta(),
      redacao: "DETERMINISTICA",
      modelo: null,
      conhecimento: [],
      dados: [],
      telas: [],
      semResposta: true,
    };
  }

  const dossie = montarDossie(relevantes, dados);
  const usarIa = !opcoes.semIa && disponivel();
  const doModelo = usarIa ? await redigir({ pergunta: limpa, dossie }) : null;

  return {
    pergunta: limpa,
    texto: doModelo ?? redacaoDeterministica(relevantes, dados),
    redacao: doModelo ? "IA" : "DETERMINISTICA",
    modelo: doModelo ? modeloConfigurado() : null,
    conhecimento,
    dados,
    telas: [...telas.values()],
    semResposta: false,
  };
}

/** O que a tela oferece antes de alguém digitar. */
export function sugestoes(): typeof SUGESTOES {
  return SUGESTOES;
}

/** O índice do que o assistente sabe, para a tela poder mostrá-lo. */
export function indiceDeConhecimento(): FonteDeConhecimento[] {
  return ARTIGOS.map((artigo) => ({
    id: artigo.id,
    titulo: artigo.titulo,
    area: artigo.area,
    fonte: artigo.fonte,
  }));
}
