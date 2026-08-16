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
 * Vocabulário de sistema numa resposta que ninguém pediu técnica.
 *
 * `Precoanp` e `cavalo.combustivel_consumo_neg` são nomes de campo. Eles são a
 * resposta certa para "qual coluna alimenta isso?" e são ruído em "como
 * funciona o preço do combustível?" — e apareciam na segunda porque estavam no
 * material. A conferência é sobre a forma do token, não sobre uma lista de
 * nomes: qualquer coisa em `snake_case`, `ponto.separado` ou CamelCase colado
 * é nome de máquina.
 */
const NOME_DE_CAMPO =
  /\b[a-z]+[._][a-z_.]{3,}\b|\b[a-z]+[A-Z][a-zA-Z]{3,}\b|\bPreco[a-z]{3,}\b/;

/** Termos de estrutura interna que a resposta traduz em vez de citar. */
const JARGAO_INTERNO = [
  "gaveta",
  "export de equipamento",
  "coluna do export",
  "colunas do export",
  "scope_hash",
  "entity_type",
  "effective_date",
  "atributo monetário",
];

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
export function verificar(
  resposta: Resposta,
  espera: Espera = {},
  /** Quando a pergunta é técnica, nome de campo é resposta e não ruído. */
  tecnica = false,
): Falha[] {
  const falhas: Falha[] = [];
  const texto = resposta.texto ?? "";
  const minusculo = texto.toLowerCase();

  for (const termo of MECANICA) {
    if (minusculo.includes(termo)) {
      falhas.push({ regra: "sem-mecanica", detalhe: `a resposta contém "${termo}"` });
    }
  }

  /*
    Jargão e nome de campo só passam quando a pergunta os pediu.
  */
  if (!tecnica) {
    const campo = NOME_DE_CAMPO.exec(texto.replace(/`[^`]*`/g, " "));
    if (campo) {
      falhas.push({
        regra: "sem-nome-de-campo",
        detalhe: `nome de campo do sistema no texto: "${campo[0]}"`,
      });
    }
    for (const termo of JARGAO_INTERNO) {
      if (minusculo.includes(termo)) {
        falhas.push({ regra: "traduz-jargao", detalhe: `usa "${termo}" em vez de linguagem de operação` });
      }
    }
  }

  /*
    Repetição: a mesma frase dita duas vezes.

    Duas fontes que dizem o mesmo aumentam a confiança, não o tamanho da
    resposta. A conferência é por frase normalizada — reescrever a mesma ideia
    com outras palavras é legítimo e não é detectável aqui; repetir a frase é
    detectável e é sempre defeito.
  */
  const frases = texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.replace(/\[\d{1,2}\]/g, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((f) => f.length > 40);
  const vistas = new Set<string>();
  for (const frase of frases) {
    if (vistas.has(frase)) {
      falhas.push({ regra: "sem-repeticao", detalhe: `frase repetida: "${frase.slice(0, 60)}…"` });
      break;
    }
    vistas.add(frase);
  }

  /*
    A lacuna não pode sequestrar a resposta.

    O comportamento que se quer é responder o que dá e depois dizer o que
    falta. O que acontecia era o contrário: a limitação era a única frase
    categórica do material, e virava o assunto. Um terço do texto é o limite
    razoável para a ressalva de uma pergunta que tem resposta parcial.
  */
  /*
    A pré-condição estava no comentário e não no código: **uma pergunta que tem
    resposta parcial.**

    Quando não há resposta nenhuma — nenhuma evidência recuperada — a ressalva
    ocupar 100% do texto não é a lacuna sequestrando a resposta: é a resposta.
    "Qual foi a inflação do último trimestre?" deve ser recusada por inteiro, e
    o portão de correspondência acrescentou três casos da mesma natureza — placa,
    unidade e bloco inexistentes. Sem esta guarda, a bateria reprovava
    exatamente as recusas que ela existe para exigir, e a métrica ficava parada
    enquanto o comportamento melhorava: uma reprovação real saía e uma falsa
    entrava no lugar.

    `fontes` vazio é o sinal, e é o certo: ele quer dizer que nada foi
    recuperado, então não havia o que responder antes de dizer o que falta.
  */
  const semNadaAResponder = resposta.fontes.length === 0;

  if (resposta.lacunas.length > 0 && texto.length > 0 && !semNadaAResponder) {
    const tamanhoDasLacunas = resposta.lacunas.reduce((n, l) => n + l.explicacao.length, 0);
    if (tamanhoDasLacunas / texto.length > 0.34 && texto.length < 900) {
      falhas.push({
        regra: "lacuna-nao-domina",
        detalhe: `a ressalva ocupa ${Math.round((tamanhoDasLacunas / texto.length) * 100)}% da resposta`,
      });
    }
  }

  /*
    Numa recusa, anunciar onde se procurou **é** a resposta.

    A regra vale para quem tem o que dizer: gastar a primeira frase com o
    processo em vez do fato. Quem não achou nada não tem outro fato — "procurei
    nos três lugares que este produto tem e não encontrei" é a informação, e
    reprová-la por começar com "procurei" é cobrar uma abertura que só existe
    quando existe resposta.
  */
  if (ABERTURA_RUIM.test(texto) && !semNadaAResponder) {
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
  /*
    Marcador de forma que a tela não conhece.

    A resposta pode usar `:::cards` e `:::abas`; qualquer outra cerca é sintaxe
    inventada. A tela degrada bem — mostra o conteúdo sem a moldura —, mas o
    modelo estar inventando forma é sinal de que a instrução não está clara, e
    isso se conserta na instrução, não na tela.
  */
  for (const cerca of texto.matchAll(/^:::\s*([a-zA-Z]*)/gm)) {
    const nome = (cerca[1] ?? "").toLowerCase();
    if (nome && !["cards", "cartoes", "abas"].includes(nome)) {
      falhas.push({ regra: "forma-conhecida", detalhe: `bloco ":::${nome}" não existe na tela` });
    }
  }

  /*
    Citação em excesso também é defeito.

    Uma por afirmação, não uma por frase: o corpo é para ler e a lista de
    fontes é para auditar. Acima de uma citação a cada duas frases, o texto
    vira um documento anotado.
  */
  const frasesTotais = texto.split(/(?<=[.!?])\s+|\n+/).filter((f) => f.trim().length > 30).length;
  if (frasesTotais >= 4 && citadas.length > frasesTotais * 0.6) {
    falhas.push({
      regra: "citacao-sem-excesso",
      detalhe: `${citadas.length} citações para ${frasesTotais} frases`,
    });
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
    (resposta.estado.assunto ?? "").toLowerCase().includes(alvo);
  return nasFontes || noRecorte || noEstado;
}
