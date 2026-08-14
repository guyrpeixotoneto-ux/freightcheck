/**
 * Do dossiê ao texto — e a trava que impede o texto de ir além do dossiê.
 *
 * **A resposta começa respondendo.** A versão anterior abria com o cartão de
 * dados e empurrava o conceito para o fim; quem perguntava "como funciona o
 * combustível?" lia primeiro "Alterações: 267". Aqui a primeira frase responde a
 * pergunta feita, e a evidência vem depois — que é a ordem em que se lê, não a
 * ordem em que o servidor consultou.
 *
 * **Nenhum número sem lastro, mecanicamente.** Depois de o modelo escrever,
 * `numerosSemLastro` confere cada token numérico do texto contra o que as
 * evidências autorizam. Se sobrar algum, a resposta do modelo é descartada e
 * sai a redação em código. Não é desconfiança do modelo: é que numa aplicação
 * de auditoria a diferença entre um número consultado e um número plausível não
 * pode depender de ninguém reler.
 *
 * **E a trava não afrouxou para o texto poder sair enquanto é escrito.** A
 * conferência passou a rodar **por frase**, antes de cada pedaço chegar à tela:
 * uma frase só é liberada depois de os seus números e as suas citações
 * passarem. Como a conferência é por token contra um conjunto fechado, o
 * veredito por frase é o mesmo da resposta inteira — o que muda é o momento em
 * que ele acontece, não o rigor. Na primeira frase que reprova, o fluxo para; o
 * evento final da rota carrega o texto que vale, e é ele que a tela mostra.
 */

import type { Database } from "@workspace/db";
import {
  ESTADO_VAZIO,
  avancarEstado,
  type EstadoDaConversa,
} from "./conversa";
import type { Evidencia, Fato } from "./ferramentas";
import {
  disponivel,
  modeloConfigurado,
  redigir,
  redigirEmFluxo,
  type PedidoDeRedacao,
  type TurnoAnterior,
} from "./llm";
import { registrar } from "./observabilidade";
import type { Intencao } from "./interpretacao";
import {
  citacoesSemFonte,
  numerosSemLastro,
  orquestrar,
  recorteDoDossie,
  type Dossie,
  type Etapa,
  type Lacuna,
} from "./orquestrador";
import { SUGESTOES } from "./conhecimento";
import { termos } from "./normalizar";

export interface Fonte {
  /** "1", "2" — o número da citação. */
  id: string;
  tipo: "CATALOGO" | "BOOK" | "ARTIGO" | "DADO";
  titulo: string;
  /** A localização exata: seção › cartão, ou a consulta e o recorte. */
  origem: string;
  detalhe?: string;
  tela?: { label: string; href: string };
}

export interface Resposta {
  pergunta: string;
  texto: string;
  /** Quem redigiu. Vai para o painel técnico, não para a leitura. */
  redacao: "IA" | "DETERMINISTICA";
  modelo: string | null;
  intencao: Intencao;
  /** "CAMAÇARI · EMPURRADA · agosto/2026" — o que esta resposta descreve. */
  recorte: string | null;
  fontes: Fonte[];
  etapas: Etapa[];
  lacunas: Lacuna[];
  /** Próximas perguntas, derivadas desta. */
  sugestoes: string[];
  desambiguacao: { termo: string; opcoes: string[] } | null;
  /** O estado a persistir para a próxima pergunta. */
  estado: EstadoDaConversa;
  tecnico: {
    intencao: Intencao;
    porque: string;
    herdado: string[];
    ferramentas: string[];
    numerosRecusados: string[];
  };
}

// ── Fontes ──────────────────────────────────────────────────────────────────

function montarFontes(dossie: Dossie): Fonte[] {
  const fontes: Fonte[] = [];
  let n = 1;

  for (const t of dossie.trechos) {
    fontes.push({
      id: String(n++),
      tipo: t.trecho.corpus === "BOOK_INDICE" ? "BOOK" : t.trecho.corpus === "CATALOGO" ? "CATALOGO" : "ARTIGO",
      titulo: t.trecho.titulo,
      origem: t.trecho.fonte,
      detalhe: t.trecho.secao,
      ...(t.trecho.tela ? { tela: t.trecho.tela } : {}),
    });
  }

  for (const e of dossie.evidencias) {
    const recorte = e.recorte
      ? [e.recorte.contexto, e.recorte.vigencia ?? e.recorte.intervalo].filter(Boolean).join(" · ")
      : undefined;
    fontes.push({
      id: String(n++),
      tipo: e.ferramenta.toLowerCase().includes("book") ? "BOOK" : "DADO",
      titulo: e.titulo,
      origem: e.origem,
      ...(recorte ? { detalhe: recorte } : {}),
      ...(e.tela ? { tela: e.tela } : {}),
    });
  }

  /*
    Os anexos entram por último — e a ordem aqui é contrato, não estilo.

    `emTexto` numera o dossiê na mesma sequência e `citacoesDeAnexo` calcula a
    faixa isenta a partir dela. Trocar a ordem de um dos três sem os outros dois
    faz a resposta citar um documento e a trava conferir uma evidência, o que
    não daria erro em lugar nenhum — só uma isenção aplicada à frase errada.

    E a entrada aqui é o que fecha a promessa da leitura nativa: o modelo leu o
    arquivo, a resposta cita o número, e quem lê abre o mesmo arquivo pela tela
    do Book. Um anexo sem fonte seria um documento lido em silêncio.
  */
  for (const a of dossie.anexos) {
    fontes.push({
      id: String(n++),
      tipo: "BOOK",
      titulo: a.titulo,
      origem: a.origem,
      detalhe:
        a.conteudo.forma === "NATIVO"
          ? `${a.filename} · lido pelo modelo`
          : `${a.filename} · texto e figuras extraídos do arquivo`,
      ...(a.tela ? { tela: a.tela } : {}),
    });
  }

  return fontes;
}

// ── Redação em código ───────────────────────────────────────────────────────

/**
 * A frase de abertura: responde a pergunta antes de qualquer evidência.
 *
 * Devolve junto o número da fonte que a sustenta. Sem isso a abertura citava
 * `[1]` fixo — o primeiro trecho conceitual — enquanto a frase vinha de uma
 * consulta ao banco. Uma citação que aponta para a fonte errada é pior que
 * citação nenhuma: ela convida a conferir e entrega outra coisa.
 */
function abertura(dossie: Dossie): { texto: string; fonte: number | null } | null {
  const { plano, trechos, evidencias } = dossie;

  if (dossie.desambiguacao) {
    const { termo, opcoes } = dossie.desambiguacao;
    return {
      texto:
        `"${termo}" pode ser mais de uma coisa aqui: ${opcoes.join(", ")}. ` +
        `Qual delas você quer?`,
      fonte: null,
    };
  }

  const conceitual =
    plano.intencao === "CONCEITUAL" ||
    plano.intencao === "BOOK" ||
    plano.intencao === "DISPONIBILIDADE";

  /*
    Numa pergunta conceitual o conceito abre — a não ser que a pergunta peça
    uma contagem. "O que é o Book do Operador?" quer a definição; "o Book cobre
    quantos blocos?" quer o número, e abrir com a definição faz quem perguntou
    procurar a resposta no meio do parágrafo.
  */
  const pedeQuantidade = /\bquant(o|os|a|as)\b/i.test(dossie.pergunta);
  if (conceitual && (!pedeQuantidade || evidencias.length === 0)) {
    const principal = trechos[0];
    if (!principal) return null;
    return { texto: principal.trecho.texto, fonte: 1 };
  }

  const escolha = fatoQueResponde(dossie);
  if (!escolha) {
    return trechos[0] ? { texto: trechos[0].trecho.texto, fonte: 1 } : null;
  }

  const { evidencia, fato, indice } = escolha;

  /*
    O recorte entra na frase, e entra uma vez só.

    Quando o fato escolhido é um ponto da série, o rótulo dele **já é** a
    vigência: acrescentar o recorte produzia "agosto/2026 em dezembro/2025 →
    agosto/2026: total 10.875,69", que diz a mesma coisa duas vezes e a segunda
    contradiz a primeira.
  */
  const doRecorte =
    evidencia.recorte?.vigencia ?? evidencia.recorte?.intervalo ?? evidencia.recorte?.contexto;
  const rotuloEhPeriodo = /\/(19|20)\d{2}\b/.test(fato.rotulo);
  const sufixo = doRecorte && !rotuloEhPeriodo ? ` em ${doRecorte}` : "";
  const rotulo = rotuloEhPeriodo ? `Em ${fato.rotulo}` : fato.rotulo;

  return {
    texto: `${rotulo}${sufixo}: ${fato.valor}${fato.detalhe ? ` — ${fato.detalhe}` : ""}.`,
    // Trechos primeiro, evidências depois — a numeração de `montarFontes`.
    fonte: dossie.trechos.length + indice + 1,
  };
}

/**
 * De tudo o que foi consultado, o fato que responde **esta** pergunta.
 *
 * A versão anterior pegava o primeiro fato numérico da primeira evidência, e a
 * ordem das evidências é a ordem em que a orquestração consultou — não a ordem
 * em que as respostas importam. Isso produzia respostas verdadeiras e fora do
 * assunto: "quantos veículos temos?" abria com o número de vigências, e "qual o
 * valor do IPVA?" abria com "0 alterações nesta vigência", que é sobre
 * movimento e não sobre valor.
 *
 * A escolha aqui é por sobreposição com a pergunta, e é isso que a torna
 * estável: nada nesta função sabe o nome de uma ferramenta ou de um parâmetro.
 * Grandeza desempata — uma consulta que devolveu só zeros perde para uma que
 * trouxe número — e só desempata: quando tudo deu zero, zero é a resposta.
 */
interface Escolha {
  evidencia: Evidencia;
  fato: Fato;
  /** A posição da evidência na lista — vira o número da citação. */
  indice: number;
}

function fatoQueResponde(dossie: Dossie): Escolha | null {
  const palavras = new Set(termos(dossie.pergunta));
  const casa = (texto: string | undefined): number => {
    if (!texto) return 0;
    return termos(texto).filter((p) => palavras.has(p)).length;
  };

  let melhor: (Escolha & { pontos: number }) | null = null;

  dossie.evidencias.forEach((evidencia, indice) => {
    const temGrandeza = evidencia.numeros.some((n) => n !== 0);
    const doTitulo = casa(evidencia.titulo);

    for (const fato of evidencia.fatos) {
      if (!/\d/.test(fato.valor)) continue;

      const pontos =
        (doTitulo + casa(fato.rotulo) + casa(fato.detalhe)) * 2 +
        (temGrandeza ? 1 : 0) +
        (evidencia.destaque === fato.rotulo ? 0.5 : 0);

      if (!melhor || pontos > melhor.pontos) melhor = { evidencia, fato, indice, pontos };
    }
  });

  if (melhor) {
    const { evidencia, fato, indice } = melhor as Escolha & { pontos: number };
    return { evidencia, fato, indice };
  }

  // Nenhum fato com número: abre com o primeiro que houver.
  const primeira = dossie.evidencias[0];
  return primeira?.fatos[0] ? { evidencia: primeira, fato: primeira.fatos[0], indice: 0 } : null;
}

/**
 * A resposta montada em código.
 *
 * Não é um degrau abaixo do modelo: é o mesmo material, com a mesma ordem, sem
 * a reescrita na forma da pergunta. Ela existe porque o produto responde sem
 * chave — e porque é para ela que a validação cai quando o modelo cita um
 * número que ninguém consultou.
 */
function redacaoDeterministica(dossie: Dossie): string {
  /*
    Um cumprimento se responde cumprimentando.

    Não há dossiê a percorrer aqui — a orquestração não consultou nada, e é
    justamente esse o ponto. O que sai é quem o assistente é e o que dá para
    perguntar a ele; os exemplos ficam com as sugestões clicáveis, que é onde a
    tela já os oferece, em vez de repetidos no meio do texto.
  */
  if (dossie.plano.intencao === "SAUDACAO") {
    return (
      "Olá. Sou o assistente do FreightCheck: respondo sobre os parâmetros do modelo de " +
      "remuneração, o que mudou entre as vigências, quanto isso pesou em dinheiro e o que " +
      "o Book do Operador registra — sempre a partir do que foi importado, com a fonte ao " +
      "lado para você conferir.\n\nSobre o que você quer saber?"
    );
  }

  const partes: string[] = [];
  // A numeração das citações é a de `montarFontes`: trechos, depois evidências.
  const primeiraEvidencia = dossie.trechos.length + 1;

  const inicio = abertura(dossie);
  if (inicio) {
    partes.push(inicio.fonte ? `${inicio.texto} [${inicio.fonte}]` : inicio.texto);
  }

  for (const lacuna of dossie.lacunas) partes.push(lacuna.explicacao);

  if (!dossie.desambiguacao) {
    /*
      Os fatos entram em frase, não em lista de rótulos.

      A versão anterior despejava `- **Alterações:** 267` para cada fato de cada
      evidência — o "relatório técnico produzido pelo backend" que esta reescrita
      existe para não ser. Uma lista de rótulo e valor é o formato de um cartão
      de tela, não o de alguém explicando o que aconteceu.

      A lista sobrevive num caso: quando os fatos **são** uma enumeração — as
      vigências que existem, os veículos mais afetados. Aí cada linha é um item
      comparável, e a coluna ajuda a ler.
    */
    dossie.evidencias.forEach((e, i) => {
      const n = primeiraEvidencia + i;
      const uteis = e.fatos.filter((f) => f.valor && f.valor !== "—");
      if (uteis.length === 0) return;

      /*
        A evidência que já abriu a resposta não se repete inteira.

        Ela entra só se tiver mais a dizer do que a frase de abertura levou —
        senão a resposta começava com "Alterações em agosto/2026: 267" e logo
        abaixo repetia "alterações, 267" com outras palavras.
      */
      const jaAberta = inicio?.fonte === n;
      const restantes = jaAberta
        ? uteis.filter((f) => !inicio!.texto.includes(f.valor))
        : uteis;
      if (restantes.length === 0) return;

      if (restantes.length > 3) {
        // Muitos fatos são uma enumeração — vigências, veículos, colunas. Aí a
        // lista ajuda a ler, porque cada linha é um item comparável.
        const linhas = restantes
          .map((f) => `- **${f.rotulo}:** ${f.valor}${f.detalhe ? ` — ${f.detalhe}` : ""}`)
          .join("\n");
        partes.push(`${e.titulo} [${n}]:\n\n${linhas}`);
      } else {
        const frase = restantes
          .map((f) => `${f.rotulo.toLowerCase()}: ${f.valor}${f.detalhe ? ` (${f.detalhe})` : ""}`)
          .join("; ");
        partes.push(`${frase} [${n}].`);
      }
      if (e.nota) partes.push(e.nota);
    });

    // O conceito de apoio, quando já houve dado — um trecho só, e depois.
    if (dossie.evidencias.length > 0 && dossie.trechos.length > 0) {
      partes.push(`${dossie.trechos[0].trecho.texto} [1]`);
    }
  }

  if (partes.length === 0) {
    const exemplos = SUGESTOES.slice(0, 4).map((s) => `- ${s.pergunta}`).join("\n");
    return (
      "Não encontrei nada que este produto sustente sobre isso — nem no conhecimento " +
      "registrado, nem no banco deste recorte.\n\n" +
      `Perguntas que ele responde:\n${exemplos}`
    );
  }

  return partes.join("\n\n");
}

// ── O portão do texto em fluxo ──────────────────────────────────────────────

/**
 * A última posição em que dá para cortar sem partir uma frase.
 *
 * Quebra de linha sempre corta. Ponto, interrogação e exclamação só cortam
 * quando vem espaço depois — é o que separa o fim de "…caiu em onze veículos."
 * do ponto de milhar em "28.511,24", que não pode virar fronteira sob pena de o
 * número chegar pela metade à conferência e reprovar por não existir no dossiê.
 */
function ultimaFronteira(texto: string): number {
  let corte = -1;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === "\n") {
      corte = i + 1;
    } else if ((c === "." || c === "!" || c === "?") && /\s/.test(texto[i + 1] ?? "")) {
      corte = i + 1;
    }
  }
  return corte;
}

/**
 * Deixa passar o que já foi conferido, e fecha na primeira frase que reprova.
 *
 * A alternativa era transmitir cru e corrigir depois — mostrar um número que
 * ninguém consultou e retirá-lo em seguida. Num produto cuja regra é não exibir
 * o que não se pode sustentar, o instante em que o número aparece na tela já é
 * o dano; retirá-lo depois não desfaz a leitura.
 */
export function portaoDeLastro(dossie: Dossie, aoTexto: (pedaco: string) => void) {
  let bruto = "";
  let liberado = 0;
  let fechado = false;

  return {
    receber(pedaco: string): void {
      bruto += pedaco;
      if (fechado) return;

      const pendente = bruto.slice(liberado);
      const corte = ultimaFronteira(pendente);
      if (corte <= 0) return;

      const candidato = pendente.slice(0, corte);
      if (
        numerosSemLastro(candidato, dossie).length > 0 ||
        citacoesSemFonte(candidato, dossie).length > 0
      ) {
        // A resposta inteira vai ser descartada pela conferência final — o
        // veredito por frase e o da resposta inteira são o mesmo. Parar aqui só
        // evita continuar mostrando um texto que já não vale.
        fechado = true;
        return;
      }

      aoTexto(candidato);
      liberado += corte;
    },
  };
}

// ── Sugestões contextuais ───────────────────────────────────────────────────

/** As próximas perguntas que fazem sentido depois desta. */
function sugerir(dossie: Dossie): string[] {
  const { plano } = dossie;
  const gaveta = plano.alvo?.parametro;
  const saida: string[] = [];

  switch (plano.intencao) {
    /*
      Depois de um "bom dia", as sugestões são o próprio convite: elas dizem, em
      forma clicável, o que este assistente sabe responder. É por isso que a
      apresentação não repete exemplos no texto.
    */
    case "SAUDACAO":
      return SUGESTOES.slice(0, 3).map((s) => s.pergunta);

    case "CONCEITUAL":
    case "DISPONIBILIDADE":
      if (gaveta) {
        saida.push(`Quanto ${gaveta} mudou na última vigência?`);
        saida.push(`O que o Book do Operador diz sobre ${gaveta}?`);
      }
      break;
    case "MOVIMENTO":
      saida.push("Onde perdemos mais dinheiro?");
      saida.push("Quais veículos foram mais impactados?");
      break;
    case "EVOLUCAO":
    case "COMPARACAO":
      if (gaveta) saida.push(`O que o Book diz sobre ${gaveta}?`);
      saida.push("Quais veículos foram mais impactados?");
      break;
    case "RANKING_PERDA":
      saida.push("Onde ganhamos mais dinheiro?");
      saida.push("Quais parâmetros ficaram sem preço?");
      break;
    case "RANKING_GANHO":
      saida.push("Onde perdemos mais dinheiro?");
      break;
    case "VEICULOS":
      saida.push("Por quê?");
      break;
    case "BOOK":
      if (gaveta) saida.push(`Quanto ${gaveta} mudou na última vigência?`);
      break;
    default:
      break;
  }

  if (plano.contexto && plano.periodo && saida.length < 3) {
    saida.push("Compare com a vigência anterior.");
  }

  return [...new Set(saida)].slice(0, 3);
}

// ── Entrada pública ─────────────────────────────────────────────────────────

export interface PerguntaOptions {
  recorte?: { scopeHash?: string; channel?: string | null; period?: string };
  estado?: EstadoDaConversa | null;
  /** Desliga o modelo mesmo com chave — usado pelas evals e pelo painel. */
  semIa?: boolean;
  /** Repassado à orquestração: cada etapa, no instante em que começa. */
  aoAvancar?: (etapa: Etapa) => void;
  /**
   * Os turnos anteriores desta conversa, do mais antigo ao mais recente.
   *
   * O estado estruturado (`estado`) resolve o que a próxima pergunta herda em
   * parâmetro, período e recorte; ele não resolve o que se pede em linguagem.
   * "Explica melhor" e "e por que isso importa?" só têm âncora se o modelo vir
   * o que foi dito — e é para isso que isto existe.
   */
  historico?: TurnoAnterior[];
  /**
   * Chamado com cada pedaço de texto **já conferido**, enquanto o modelo
   * escreve. Quando presente, a redação passa a ser em fluxo.
   *
   * O que chega aqui já passou pela trava de lastro; o que não passou não chega
   * — e nesse caso o texto final desta função é a redação em código, que o
   * chamador deve usar no lugar do que transmitiu.
   */
  aoTexto?: (pedaco: string) => void;
}

/**
 * Responde uma pergunta sobre o FreightCheck.
 *
 * O contrato: o texto nunca afirma número que não esteja nas evidências, e as
 * evidências vão na resposta para que isso seja verificável por quem lê — não
 * por quem escreveu.
 */
export async function responder(
  db: Database,
  pergunta: string,
  opcoes: PerguntaOptions = {},
): Promise<Resposta> {
  const dossie = await orquestrar(db, pergunta.trim(), {
    ...(opcoes.recorte ? { recorte: opcoes.recorte } : {}),
    estado: opcoes.estado ?? null,
    ...(opcoes.aoAvancar ? { aoAvancar: opcoes.aoAvancar } : {}),
  });

  const determinista = redacaoDeterministica(dossie);
  let texto = determinista;
  let redacao: Resposta["redacao"] = "DETERMINISTICA";
  let numerosRecusados: string[] = [];

  if (!opcoes.semIa && disponivel()) {
    const pedido: PedidoDeRedacao = {
      pergunta,
      dossie,
      ...(opcoes.historico?.length ? { historico: opcoes.historico } : {}),
    };

    /*
      Com `aoTexto`, o texto sai enquanto é escrito — passando pelo portão, que
      confere frase a frase. Sem ele, é a chamada única de sempre, e as evals
      (que não transmitem nada) seguem exercitando exatamente o caminho antigo.
    */
    const portao = opcoes.aoTexto ? portaoDeLastro(dossie, opcoes.aoTexto) : null;
    const { texto: doModelo, medicao } = portao
      ? await redigirEmFluxo(pedido, (pedaco) => portao.receber(pedaco))
      : await redigir(pedido);

    let desfecho = medicao.desfecho;

    if (doModelo) {
      /*
        Duas travas, e as duas descartam a resposta inteira em vez de remendá-la.

        Um número que nenhuma consulta devolveu provavelmente tem o raciocínio
        construído em cima dele, e trocar o número deixaria a conclusão de pé.
        Uma citação que aponta para fonte inexistente é o mesmo defeito noutra
        moeda: a frase se apresenta como conferível e manda quem lê para um
        lugar que não existe.
      */
      const semLastro = numerosSemLastro(doModelo, dossie);
      const semFonte = citacoesSemFonte(doModelo, dossie);
      if (semLastro.length === 0 && semFonte.length === 0) {
        texto = doModelo;
        redacao = "IA";
      } else {
        numerosRecusados = [...semLastro, ...semFonte];
        desfecho = "DESCARTADA";
      }
    }

    registrar({ ...medicao, intencao: dossie.plano.intencao, desfecho });
  }

  const estado = avancarEstado(opcoes.estado ?? ESTADO_VAZIO, dossie);

  return {
    pergunta: dossie.pergunta,
    texto,
    redacao,
    modelo: redacao === "IA" ? modeloConfigurado() : null,
    intencao: dossie.plano.intencao,
    recorte: recorteDoDossie(dossie),
    fontes: montarFontes(dossie),
    etapas: dossie.etapas,
    lacunas: dossie.lacunas,
    sugestoes: sugerir(dossie),
    desambiguacao: dossie.desambiguacao,
    estado,
    tecnico: {
      intencao: dossie.plano.intencao,
      porque: dossie.plano.porque,
      herdado: dossie.plano.herdado,
      ferramentas: dossie.evidencias.map((e: Evidencia) => e.ferramenta),
      numerosRecusados,
    },
  };
}

/** As perguntas oferecidas quando não há conversa. */
export function sugestoes(): typeof SUGESTOES {
  return SUGESTOES;
}
