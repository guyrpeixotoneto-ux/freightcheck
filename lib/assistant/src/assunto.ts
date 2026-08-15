/**
 * O que a pergunta **nomeia** — reconhecido, nunca deduzido por subtração.
 *
 * **O desenho que este módulo substitui.** A extração anterior devolvia tudo o
 * que não estivesse numa lista de bloqueio escrita à mão: o assunto era "o que
 * sobrou da frase". Uma lista assim nunca fica pronta — ela cresce com o
 * vocabulário de quem pergunta, não com o do produto —, e cada palavra que
 * faltava nela virava um parâmetro que não existe. "Qual foi o impacto
 * **dessas** alterações?" procurava uma gaveta chamada `dessas`, não achava, e
 * o portão que impede responder o agregado sobre o assunto errado desligava
 * todas as consultas. A pergunta terminava sem evidência nenhuma — e havia 46
 * perguntas assim na bateria de 103.
 *
 * **A inversão.** Aqui um assunto só existe se o produto o reconhecer. O
 * vocabulário de comparação não é uma lista escrita para este fim: é o que o
 * produto já sabe de si — o dicionário de parâmetros do banco, os blocos do
 * Book do Operador e os cartões do catálogo do Freightech. Nada casou? Então a
 * pessoa não nomeou coisa nenhuma, e a pergunta é sobre o recorte inteiro.
 *
 * **Três estados, e o terceiro é o que faltava.** O desenho anterior tinha
 * dois: ou havia assunto, ou havia assunto que não resolvia. Faltava
 * justamente o caso mais comum numa conversa — *não há assunto*, a pergunta é
 * sobre o que está em pé. Com ele, "quanto isso custou?" volta a consultar o
 * movimento da vigência, e "quanto mudou o pedágio?" continua dizendo que o
 * export não traz pedágio.
 *
 * **Equipamento não passa por aqui.** "Cavalo" e "carreta" nomeiam uma
 * dimensão do recorte, não uma gaveta — e por casarem o nome de gavetas que os
 * contêm ("Manutenção cavalo"), deixá-los entrar produzia uma resposta
 * verdadeira sobre um assunto que ninguém pediu. Eles são removidos do
 * candidato antes do reconhecimento e viajam em `Leitura.entidades.equipamento`,
 * onde sempre deveriam ter estado.
 */

import type { Database } from "@workspace/db";
import { BLOCOS_BOOK, CATALOGO_FREIGHTECH } from "@workspace/knowledge";
import { normalizar, termos } from "./normalizar";
import { carregarDicionario, resolverParametro, type Alvo, type Resolucao } from "./parametros";

/**
 * As palavras com que se nomeia um equipamento.
 *
 * Acompanha `lerEquipamento` em `interpretacao.ts`: lá elas decidem a dimensão,
 * aqui elas são retiradas do candidato a assunto. São os dois lados da mesma
 * decisão — equipamento é recorte, não gaveta — e é por isso que a lista mora
 * exportada, onde quem acrescentar "bitrem" veja os dois usos de uma vez.
 */
export const TERMOS_DE_EQUIPAMENTO: ReadonlySet<string> = new Set([
  "cavalo", "cavalos", "caminhao", "caminhoes", "trator", "tratores",
  "carreta", "carretas", "implemento", "implementos", "reboque", "reboques",
]);

/**
 * Termos que nomeiam o domínio inteiro, e por isso não recortam nada.
 *
 * "Remuneração" é o assunto de **todo** este produto: usá-la para escolher uma
 * gaveta responderia sobre um pedaço arbitrário do que foi perguntado. Ela
 * saiu da lista de bloqueio da interpretação — onde era tratada como ruído, e
 * por isso levava junto a busca no Book — e passou a ser o que é: um termo
 * verdadeiro, amplo demais para narrar uma consulta.
 *
 * A lista é curta e fica curta. Um termo só entra aqui quando cobrir
 * praticamente todo o catálogo; qualquer coisa mais específica é assunto.
 */
const TERMOS_ABRANGENTES: ReadonlySet<string> = new Set([
  "remuneracao", "remuneracoes", "remunerar", "remunerado", "remunerada",
  "frota", "frotas", "operacao", "operacoes", "modelo", "modelos",
  /*
    "Impacto" nomeia a **medida**, nunca a coisa medida.

    "Qual teve maior impacto?" é a pergunta que mais aparece depois de um
    resumo, e ela não recorta gaveta nenhuma — pede o ranking do que já está em
    discussão. Tratada como assunto, ela casava o vocabulário do catálogo,
    virava "conhecido sem dado" e desligava todas as consultas do turno.
  */
  "impacto", "impactos",
]);

// ── O vocabulário do produto ────────────────────────────────────────────────

/**
 * Tudo o que o produto sabe nomear, além do dicionário de parâmetros.
 *
 * O Book diz de que assuntos a operação escreveu regra; o catálogo diz o que o
 * Freightech publica. Os dois juntos são o que separa "o produto conhece isto
 * e o export não traz" de "isto não existe aqui" — e essa distinção é a razão
 * de a lacuna de pedágio continuar existindo depois desta mudança.
 */
let vocabularioEstatico: Set<string> | null = null;

function vocabularioDoProduto(): Set<string> {
  if (vocabularioEstatico) return vocabularioEstatico;

  const palavras = new Set<string>();
  const registrar = (texto: string | undefined | null) => {
    if (!texto) return;
    for (const palavra of termos(texto)) palavras.add(palavra);
  };

  for (const bloco of BLOCOS_BOOK) {
    registrar(bloco.titulo);
    registrar(bloco.categoria);
  }
  for (const secao of CATALOGO_FREIGHTECH) {
    registrar(secao.titulo);
    for (const cartao of secao.cartoes) {
      registrar(cartao.nome);
      for (const coluna of cartao.colunas ?? []) registrar(coluna);
      for (const parametro of cartao.parametros ?? []) registrar(parametro);
    }
  }

  vocabularioEstatico = palavras;
  return palavras;
}

/** Só para os testes, quando o catálogo muda debaixo do processo. */
export function esquecerVocabulario(): void {
  vocabularioEstatico = null;
}

// ── O resultado ─────────────────────────────────────────────────────────────

export type ComoReconheceu =
  /** Casou o dicionário de parâmetros: há coluna, há número. */
  | "PARAMETRO"
  /** O Book ou o catálogo conhecem o assunto; este export não o traz. */
  | "CONHECIDO_SEM_DADO";

export interface AssuntoReconhecido {
  /** O termo como a pessoa o escreveu, sem o equipamento. */
  termo: string;
  como: ComoReconheceu;
  /** A gaveta, quando houver. `null` em `CONHECIDO_SEM_DADO`. */
  alvo: Alvo | null;
  /** A resolução completa, para a desambiguação e para o painel técnico. */
  resolucao: Resolucao | null;
}

/**
 * O candidato, limpo do que não é assunto.
 *
 * Devolve `null` quando não sobra nada — e "nada" aqui inclui a frase feita só
 * de equipamento ("e os cavalos?") e a feita só de termo abrangente ("teve
 * alteração na remuneração?"). Nos dois casos a pessoa disse algo verdadeiro
 * que não recorta gaveta nenhuma, e insistir em procurar uma é o defeito que
 * este módulo existe para não ter.
 */
export function candidatoLimpo(candidato: string | null): string | null {
  if (!candidato) return null;
  const palavras = termos(candidato).filter(
    (p) => !TERMOS_DE_EQUIPAMENTO.has(p) && !TERMOS_ABRANGENTES.has(p),
  );
  return palavras.length > 0 ? palavras.join(" ") : null;
}

/**
 * O assunto desta pergunta — ou a informação de que ela não tem um.
 *
 * `null` não é falha: é o estado normal de "o que mudou?", "qual foi o
 * impacto?", "e nos cavalos?". Quem chama trata `null` como permissão para
 * consultar o recorte inteiro, que é exatamente o que essas perguntas pedem.
 */
export async function reconhecerAssunto(
  db: Database,
  candidato: string | null,
  opcoes: { equipamento?: string } = {},
): Promise<AssuntoReconhecido | null> {
  const termo = candidatoLimpo(candidato);
  if (!termo) return null;

  /*
    A segunda leitura devolve **só** o equipamento, nunca o termo abrangente.

    Devolver o candidato cru trazia "remuneração" de volta junto, e uma frase
    como "reduzir remuneração" voltava a casar uma gaveta por semelhança
    textual — o parâmetro fantasma entrando pela porta dos fundos.
  */
  const comEquipamento = termos(candidato ?? "")
    .filter((p) => !TERMOS_ABRANGENTES.has(p))
    .join(" ");
  const opcoesDeEquipamento = opcoes.equipamento ? { equipamento: opcoes.equipamento } : {};

  /*
    A gaveta primeiro: é a única forma de reconhecimento que traz número.

    E ela é tentada **com** o equipamento antes de sem ele, porque há gavetas
    cujo nome o contém: "Manutenção cavalo" e "Manutenção BID" só se distinguem
    pela palavra que a limpeza acabou de tirar. Tirá-la sempre trocava uma
    resposta certa por uma pergunta de desambiguação.

    A ordem é a que preserva as duas leituras: quem escreveu o nome inteiro da
    gaveta ganha a gaveta; quem só disse "e nos cavalos?" não chega aqui — o
    candidato limpo ficou vazio e a função já devolveu `null` acima.
  */
  if (comEquipamento !== termo) {
    const comNome = await resolverParametro(db, comEquipamento, opcoesDeEquipamento);
    if (comNome.escolhido) {
      return { termo: comEquipamento, como: "PARAMETRO", alvo: comNome.escolhido, resolucao: comNome };
    }
  }

  const resolucao = await resolverParametro(db, termo, opcoesDeEquipamento);

  if (resolucao.escolhido || resolucao.ambiguo) {
    return { termo, como: "PARAMETRO", alvo: resolucao.escolhido, resolucao };
  }

  /*
    Sem gaveta, a pergunta é se o produto conhece o assunto por outro caminho.

    O dicionário entra aqui também — e não só pela gaveta — porque uma coluna
    pode existir com semântica pendente e ficar abaixo da confiança mínima da
    resolução. Reconhecer o termo sem eleger a gaveta é a resposta honesta:
    existe, não dá para consultar.
  */
  const palavras = termos(termo);
  const doProduto = vocabularioDoProduto();
  const dicionario = await carregarDicionario(db);

  const conhecida = (palavra: string): boolean => {
    if (doProduto.has(palavra)) return true;
    if (palavra.length < 4) return false;
    for (const conhecido of doProduto) {
      if (conhecido.startsWith(palavra) || palavra.startsWith(conhecido)) return true;
    }
    return dicionario.some((p) => p.termos.some((t) => t === palavra));
  };

  if (palavras.some(conhecida)) {
    return { termo, como: "CONHECIDO_SEM_DADO", alvo: null, resolucao };
  }

  /*
    Nada casou: a pessoa não nomeou coisa nenhuma.

    Este é o retorno que apagou 46 parâmetros fantasmas. Note o que ele **não**
    faz: não afirma que o termo não existe. Ele afirma que o produto não tem
    como tratá-lo como assunto — e quem chama responde sobre o recorte, que é
    o que a pergunta pedia desde o começo.
  */
  return null;
}
