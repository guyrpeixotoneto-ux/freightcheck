/**
 * O que dá para conferir por máquina numa resposta — e o que não dá.
 *
 * **A divisão importa mais que as regras.** Correção factual, clareza e
 * qualidade executiva são julgamento: quem lê decide, e um juiz-modelo pode
 * opinar. Já "a resposta mostrou a mecânica interna", "citou fonte que não
 * existe", "trouxe número que nenhuma consulta devolveu" e "usou as duas fontes
 * que a pergunta exigia" são fatos sobre o texto, conferíveis sem opinião. Estes
 * ficam aqui, e são eles que sustentam a comparação entre duas rodadas da
 * bateria: um relatório em que tudo é nota de juiz não distingue melhora de
 * mudança de humor do juiz.
 *
 * **Cada verificação nasceu de um defeito visto na tela.** A lista de palavras
 * proibidas não é estilística — cada uma apareceu numa resposta real, e a
 * primeira delas abria a resposta que motivou esta fase inteira.
 */

import type { Resposta } from "../resposta";
import type { Espera } from "./bateria";

export interface Falha {
  regra: string;
  detalhe: string;
}

/**
 * O vocabulário que denuncia a máquina.
 *
 * "Revisão vigente: 1 — 1 revisão guardada" foi a primeira linha de uma
 * resposta sobre o que é o QLP ADM. Nada ali era falso; era tudo administração
 * do Book, apresentada como se fosse a explicação pedida.
 */
const MECANICA = [
  "revisão vigente",
  "revisões guardadas",
  "revisão guardada",
  "documento anexado",
  "block_key",
  "blockkey",
  "dossiê",
  "dossie",
  "chunk",
  "trecho recuperado",
  "trechos recuperados",
  "retrieval",
  "índice do book",
  "diagramação",
  "extração",
  "com base no contexto",
  "conforme o contexto",
  "de acordo com o contexto",
  "contexto fornecido",
  "com base nas informações acima",
  "getfamiliesview",
  "book_entry",
];

/**
 * Aberturas que não respondem.
 *
 * A primeira frase é a que decide se alguém continua lendo. Anunciar a busca,
 * repetir a pergunta ou pedir licença gasta essa frase com o processo.
 */
const ABERTURA_RUIM =
  /^\s*(com base|de acordo|conforme|segundo (o dossiê|as informações)|encontrei|procurei|localizei|vou (verificar|consultar|buscar)|deixa eu|analisando|após (consultar|analisar)|para responder)/i;

/** Um número escrito no texto, ignorando o marcador de citação. */
function numerosDoTexto(texto: string): string[] {
  return texto.replace(/\[\d{1,2}\]/g, " ").match(/\d[\d.,]*/g) ?? [];
}

/**
 * Confere o que é conferível. Devolve as falhas — vazio é aprovação.
 *
 * `usaBook` e `usaDado` são medidos pelas **fontes** da resposta, não pelo
 * texto: é a lista que a tela mostra, e é ela que quem lê vai abrir para
 * conferir. Uma resposta que fala do Book sem ter uma fonte do Book está
 * afirmando de memória.
 */
export function verificar(resposta: Resposta, espera: Espera = {}): Falha[] {
  const falhas: Falha[] = [];
  const texto = resposta.texto ?? "";
  const minusculo = texto.toLowerCase();

  for (const termo of MECANICA) {
    if (minusculo.includes(termo)) {
      falhas.push({ regra: "sem-mecanica", detalhe: `a resposta contém "${termo}"` });
    }
  }

  if (ABERTURA_RUIM.test(texto)) {
    falhas.push({
      regra: "abre-respondendo",
      detalhe: `abre com "${texto.slice(0, 60).replace(/\n/g, " ")}…"`,
    });
  }

  // ---- citações -------------------------------------------------------------
  const citadas = [...texto.matchAll(/\[(\d{1,2})\]/g)].map((m) => m[1]);
  for (const n of citadas) {
    if (!resposta.fontes.some((f) => f.id === n)) {
      falhas.push({ regra: "citacao-valida", detalhe: `cita [${n}] e a fonte não existe` });
    }
  }
  if (resposta.fontes.length > 0 && citadas.length === 0 && texto.length > 200) {
    falhas.push({
      regra: "citacao-presente",
      detalhe: `${resposta.fontes.length} fonte(s) recuperada(s) e nenhuma citada no texto`,
    });
  }

  // ---- lastro ---------------------------------------------------------------
  if (resposta.tecnico.numerosRecusados.length > 0) {
    falhas.push({
      regra: "sem-numero-inventado",
      detalhe: `a trava recusou: ${resposta.tecnico.numerosRecusados.join(", ")}`,
    });
  }
  if (resposta.tecnico.ia?.desfecho === "DESCARTADA") {
    falhas.push({
      regra: "resposta-do-modelo",
      detalhe: "o modelo escreveu e a trava descartou — o usuário leu a redação em código",
    });
  }

  // ---- fontes exigidas pela categoria ---------------------------------------
  const temBook = resposta.fontes.some((f) => f.tipo === "BOOK");
  const temDado = resposta.fontes.some((f) => f.tipo === "DADO");

  if (espera.usaBook && !temBook) {
    falhas.push({ regra: "usa-book", detalhe: "nenhuma fonte do Book na resposta" });
  }
  if (espera.usaDado && !temDado) {
    falhas.push({ regra: "usa-dado", detalhe: "nenhuma consulta ao banco na resposta" });
  }

  // ---- lacuna e desambiguação -----------------------------------------------
  if (espera.declaraLacuna && resposta.lacunas.length === 0) {
    falhas.push({
      regra: "declara-lacuna",
      detalhe: "a pergunta não tem resposta possível e nenhuma lacuna foi declarada",
    });
  }
  if (espera.desambigua && !resposta.desambiguacao) {
    falhas.push({ regra: "desambigua", detalhe: "escolheu sozinha em vez de perguntar de volta" });
  }

  /*
    Recusa de cálculo: nenhum número **novo**.

    A conferência é contra os números que as fontes já autorizam — os mesmos que
    a trava de lastro usa. Um texto que responde "o impacto apurado é R$ X, e não
    dá para somar com o anual" cita X legitimamente; o que não pode é aparecer
    um valor que ninguém consultou, que é justamente o que a pergunta induz.
  */
  if (espera.recusaCalculo) {
    const autorizados = new Set(
      resposta.fontes.flatMap((f) => numerosDoTexto(`${f.titulo} ${f.origem} ${f.detalhe ?? ""}`)),
    );
    const novos = numerosDoTexto(texto).filter(
      (n) => n.length > 1 && !autorizados.has(n) && !autorizados.has(n.replace(/\./g, "")),
    );
    if (novos.length > 0 && resposta.tecnico.numerosRecusados.length === 0) {
      /*
        Isto é um alerta, não uma reprovação automática: o número pode ter vindo
        de um fato da evidência que não aparece no título da fonte. Quem lê o
        relatório decide — e é por isso que o detalhe traz os números.
      */
      falhas.push({
        regra: "recusa-calculo",
        detalhe: `conferir se estes números têm origem: ${[...new Set(novos)].slice(0, 6).join(", ")}`,
      });
    }
  }

  return falhas;
}

/**
 * A resposta continua tratando do mesmo assunto?
 *
 * Medido pelas fontes e pelo recorte, não pelo texto: uma resposta pode não
 * repetir o nome do bloco (e não deve) e ainda assim estar inteiramente dentro
 * dele. O que denuncia a perda do fio é a fonte apontar para outro lugar.
 */
export function mantemAssunto(resposta: Resposta, assunto: string): boolean {
  const alvo = assunto.toLowerCase();
  const nasFontes = resposta.fontes.some(
    (f) => f.titulo.toLowerCase().includes(alvo) || f.origem.toLowerCase().includes(alvo),
  );
  const noRecorte = (resposta.recorte ?? "").toLowerCase().includes(alvo);
  const noEstado =
    (resposta.estado.blocoDoBook ?? "").toLowerCase().includes(alvo) ||
    (resposta.estado.parametro ?? "").toLowerCase().includes(alvo) ||
    (resposta.estado.termoDoParametro ?? "").toLowerCase().includes(alvo);
  return nasFontes || noRecorte || noEstado;
}
