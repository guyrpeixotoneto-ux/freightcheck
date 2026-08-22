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
import { resolverContexto, type Evidencia, type Fato } from "./ferramentas";
import { garantirComparacoes } from "@workspace/comparison";
import {
  disponivel,
  modeloConfigurado,
  redigir,
  redigirEmFluxo,
  type PedidoDeRedacao,
  type TurnoAnterior,
} from "./llm";
import { registrar, type EventoDeIa } from "./observabilidade";
import type { Intencao } from "./interpretacao";
import {
  citacoesSemFonte,
  emFrases,
  itensCitaveis,
  numerosSemLastro,
  orquestrar,
  sanear,
  contextoDoTurno,
  recorteDoDossie,
  type Dossie,
  type Etapa,
  type Lacuna,
} from "./orquestrador";
import { agenteLigado, evidenciasDaInvestigacao, investigar, type Investigacao } from "./agente";
import { registroPadrao } from "./ferramentas/registro";
import { montarRastro, type RastroDaResposta } from "./rastro";
import { SUGESTOES } from "./conhecimento";
import { termos } from "./normalizar";
import {
  contextoParaOModelo,
  explicarRedacao,
  type CausaDaRedacao,
  type ContextoParaOModelo,
  type MotorDaResposta,
} from "./medicao";

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
  /**
   * O que é preciso guardar para explicar esta resposta depois dela.
   *
   * Sai de `responder` já montado, e não da rota, por uma razão de contrato:
   * quem constrói a resposta é quem tem o plano à mão — `scopeHash`, origem do
   * recorte, período recusado —, e nada disso aparece na superfície pública da
   * `Resposta`. Montá-lo na rota exigiria expor o plano inteiro só para que
   * alguém lá fora o remontasse.
   */
  rastro: RastroDaResposta;
  tecnico: {
    intencao: Intencao;
    porque: string;
    herdado: string[];
    ferramentas: string[];
    numerosRecusados: string[];
    /**
     * A investigação do agente — `null` no caminho determinístico.
     *
     * **Rodadas e consultas são medidas separadas, e é deliberado.** Uma rodada
     * é um turno do modelo; ela pode pedir várias ferramentas de uma vez,
     * porque consultas independentes partem juntas. Daí um teto de seis rodadas
     * comportar onze consultas sem violar nada — e daí somar as duas num número
     * só apagar justamente a diferença que interessa: seis rodadas com seis
     * consultas é uma investigação funda e estreita; duas rodadas com onze é uma
     * varredura larga e rasa.
     *
     * Foi uma métrica agregada que já descreveu uma rodada ao contrário nesta
     * migração. Esta expõe as duas contagens e o rastro de cada chamada, para
     * que ninguém precise inferir a segunda a partir da primeira.
     */
    agente: {
      rodadas: number;
      consultas: number;
      parou: Investigacao["parou"];
      chamadas: {
        nome: string;
        argumentos: Record<string, unknown>;
        ok: boolean;
        erro: string | null;
        evidencias: number;
        /** Índice da consulta anterior de cujo resultado esta saiu. */
        derivaDe: number | null;
      }[];
    } | null;
    /**
     * O rastro que explica esta resposta **depois** que ela aconteceu.
     *
     * Sem ele, investigar uma resposta ruim é reproduzir a pergunta à mão e
     * instrumentar o código — que é o que a auditoria teve de fazer para
     * descobrir que "remuneração" era palavra de bloqueio. Cada campo aqui é
     * uma pergunta que alguém faz olhando para uma resposta que decepcionou:
     * o que ele entendeu que eu queria, o que ele foi buscar, quanto material
     * havia, com que folga o corte passou, e onde o tempo foi.
     */
    rastro: {
      /** O assunto reconhecido, e por qual caminho. */
      assunto: string | null;
      comoReconheceu: string | null;
      /** Tudo o que o plano decidiu descobrir, não só o que deu nome. */
      necessidades: string[];
      /** O que a busca no Book viu, antes e depois do limiar. */
      book: { candidatos: number; selecionados: number; melhorPontuacao: number };
      /** Cada etapa e o instante em que ela começou. */
      etapas: { nome: string; ms: number }[];
      /** Quanto a orquestração levou, sem a chamada ao modelo. */
      orquestracaoMs: number;
      /** Quantas frases a trava removeu, de quantas. */
      frasesPodadas: number;
      frasesTotais: number;
    };
    /**
     * Quem escreveu este texto, e por quê — **sempre preenchido**.
     *
     * `ia` abaixo continua sendo a medição da chamada, e por isso continua
     * `null` quando não houve chamada. O que faltava era justamente o caso em
     * que não houve: `ia: null` dizia a mesma coisa para "não há chave" e para
     * "quem chamou pediu sem modelo", e nenhuma das duas se lia da resposta.
     * Aqui a causa é dita por extenso, em toda resposta, com os números que a
     * sustentam.
     */
    motor: MotorDaResposta;
    /**
     * O que foi entregue ao modelo — ou o que teria sido, quando não houve
     * chamada.
     *
     * É a pergunta que a tela não sabia responder: uma resposta pobre veio de
     * modelo ruim ou de dossiê magro? Sem isto, as duas hipóteses custam a
     * mesma investigação manual, e só uma delas tem conserto no prompt.
     */
    contexto: ContextoParaOModelo;
    /**
     * O que aconteceu com a chamada ao modelo — `null` quando não houve uma.
     *
     * Sem isto, `redacao: "DETERMINISTICA"` é ambíguo de um jeito caro: não se
     * distingue "não há chave configurada" de "o modelo respondeu e a trava
     * descartou" nem de "a chamada deu erro". As três exigem ações opostas — a
     * primeira é configuração, a segunda é dossiê pobre, a terceira é a API
     * fora — e a tela dizia a mesma palavra para todas.
     */
    ia: {
      desfecho: EventoDeIa["desfecho"];
      modelo: string;
      latenciaMs: number;
      erro: string | null;
      /** O custo da chamada, para a bateria poder somá-lo. */
      tokensEntrada: number;
      tokensSaida: number;
      origemDosTokens: "usage" | "estimativa";
      custoUsd: number;
    } | null;
  };
}

// ── Redação em código ───────────────────────────────────────────────────────

/**
 * O que a resposta pode citar, com o número de cada coisa.
 *
 * A numeração é a de `itensCitaveis` — a mesma que o modelo recebe e a mesma
 * que a validação confere. Nenhum arquivo conta por si.
 */
function montarFontes(dossie: Dossie): Fonte[] {
  return itensCitaveis(dossie).map((item): Fonte => {
    const id = String(item.id);

    if (item.tipo === "CONCEITO") {
      const t = item.trecho.trecho;
      return {
        id,
        tipo: t.corpus === "BOOK_INDICE" ? "BOOK" : t.corpus === "CATALOGO" ? "CATALOGO" : "ARTIGO",
        titulo: t.titulo,
        origem: t.fonte,
        detalhe: t.secao,
        ...(t.tela ? { tela: t.tela } : {}),
      };
    }

    if (item.tipo === "BOOK") {
      const d = item.documento.trecho;
      /*
        A fonte de um trecho do Book aponta para onde ele está **dentro** do
        documento. "Book do Operador · QLP ADM" manda quem quer conferir abrir
        um arquivo e procurar; com a seção, ele abre na regra.
      */
      return {
        id,
        tipo: "BOOK",
        titulo: d.bloco,
        origem: d.arquivo
          ? `${d.arquivo} · ${d.categoria} › ${d.bloco}`
          : `regra escrita · ${d.categoria} › ${d.bloco}`,
        ...(d.secao ? { detalhe: d.secao } : {}),
        tela: { label: "Book do Operador", href: "/book-operador" },
      };
    }

    if (item.tipo === "DADO") {
      const e = item.evidencia;
      const recorte = e.recorte
        ? [e.recorte.contexto, e.recorte.vigencia ?? e.recorte.intervalo].filter(Boolean).join(" · ")
        : undefined;
      return {
        id,
        tipo: e.ferramenta.toLowerCase().includes("book") ? "BOOK" : "DADO",
        titulo: e.titulo,
        origem: e.origem,
        ...(recorte ? { detalhe: recorte } : {}),
        ...(e.tela ? { tela: e.tela } : {}),
      };
    }

    const a = item.anexo;
    return {
      id,
      tipo: "BOOK",
      titulo: a.titulo,
      origem: a.origem,
      detalhe: `${a.filename} · lido pelo modelo`,
      ...(a.tela ? { tela: a.tela } : {}),
    };
  });
}

/**
 * De tudo o que foi consultado, o fato que responde **esta** pergunta.
 *
 * A escolha é por sobreposição com a pergunta, e é isso que a torna estável:
 * nada nesta função sabe o nome de uma ferramenta ou de um parâmetro. Grandeza
 * desempata — uma consulta que devolveu só zeros perde para uma que trouxe
 * número — e só desempata: quando tudo deu zero, zero é a resposta.
 */
interface Escolha {
  evidencia: Evidencia;
  fato: Fato;
  /** O número da citação desta evidência. */
  fonte: number;
}

function fatoQueResponde(dossie: Dossie): Escolha | null {
  const palavras = new Set(termos(dossie.pergunta));
  const casa = (texto: string | undefined): number => {
    if (!texto) return 0;
    return termos(texto).filter((p) => palavras.has(p)).length;
  };

  const doDado = itensCitaveis(dossie).filter(
    (i): i is Extract<typeof i, { tipo: "DADO" }> => i.tipo === "DADO",
  );

  let melhor: (Escolha & { pontos: number }) | null = null;

  for (const { evidencia, id } of doDado) {
    const temGrandeza = evidencia.numeros.some((n) => n !== 0);
    const doTitulo = casa(evidencia.titulo);

    for (const fato of evidencia.fatos) {
      // Mecânica não responde pergunta nenhuma — nem quando tem número.
      if (fato.interno) continue;
      if (!/\d/.test(fato.valor)) continue;

      const pontos =
        (doTitulo + casa(fato.rotulo) + casa(fato.detalhe)) * 2 +
        (temGrandeza ? 1 : 0) +
        (evidencia.destaque === fato.rotulo ? 0.5 : 0);

      if (!melhor || pontos > melhor.pontos) melhor = { evidencia, fato, fonte: id, pontos };
    }
  }

  if (melhor) {
    const { evidencia, fato, fonte } = melhor as Escolha & { pontos: number };
    return { evidencia, fato, fonte };
  }

  const primeira = doDado[0];
  const visivel = primeira?.evidencia.fatos.find((f) => !f.interno);
  return visivel ? { evidencia: primeira.evidencia, fato: visivel, fonte: primeira.id } : null;
}

/**
 * Linhas que são carimbo do documento, não conteúdo dele.
 *
 * O primeiro trecho de um `.docx` de operação costuma trazer o cabeçalho de
 * quem o exportou: a etiqueta da categoria (`#Equipamentos`) e a data-hora da
 * geração. Numa resposta a "teve alteração na remuneração?", isso apareceu
 * assim, na tela: título, hashtag, `05/05/2022 11:49:26`. É conteúdo do
 * arquivo e não é resposta a nada — some quando a redação em código transcreve.
 */
function semCarimboDoDocumento(texto: string): string {
  return texto
    .split("\n")
    .filter((linha) => {
      const limpa = linha.trim();
      if (/^#[A-Za-zÀ-ÿ][\wÀ-ÿ-]*$/.test(limpa)) return false;
      if (/^\d{2}\/\d{2}\/\d{4}(\s+\d{2}:\d{2}(:\d{2})?)?$/.test(limpa)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Quanto do documento a redação em código transcreve.
 *
 * Ela não resume — sem modelo, resumir seria inventar —, então o que ela pode
 * fazer é escolher bem e parar cedo. Mil caracteres cobrem a regra que
 * responde; o resto do documento continua a um clique, pela fonte. O teto era
 * quase o dobro, e o efeito era o que se via na tela: um bloco de documento
 * colado, que é exatamente a impressão que esta revisão existe para desfazer.
 */
const TETO_DA_ABERTURA = 1000;
/** E de quantos pedaços ela pode ser feita. */
const TRECHOS_NA_ABERTURA = 2;

/**
 * A resposta montada em código.
 *
 * **Ela não é mais um relatório do dossiê.** A versão anterior percorria as
 * evidências e imprimia rótulo e valor de cada fato — "Revisão vigente: 1 — 1
 * revisão guardada", "tipo: documento anexado" —, e terminava repetindo o
 * parágrafo com que tinha aberto. Quem perguntava a regra de um bloco recebia a
 * ficha administrativa dele.
 *
 * **Ordem única: responde, ressalva, complementa.** Quando há conteúdo do Book,
 * ele abre — é a resposta, transcrita do documento e com a citação ao lado.
 * Quando a pergunta é de número, abre o número. O conceito entra depois, e só
 * quando acrescenta. Nada de mecânica, em lugar nenhum.
 *
 * Ela continua existindo para quando não há modelo, e continua sendo o destino
 * de uma resposta descartada pela trava — mas deixou de ser o teto de qualidade
 * do produto, que é o papel que ela vinha ocupando sem que ninguém tivesse
 * decidido isso.
 */
export function redacaoDeterministica(dossie: Dossie): string {
  if (dossie.plano.intencao === "SAUDACAO") {
    return (
      "Olá. Sou o assistente do FreightCheck: respondo sobre os parâmetros do modelo de " +
      "remuneração, o que mudou entre as vigências, quanto isso pesou em dinheiro e o que " +
      "o Book do Operador registra — sempre a partir do que foi importado, com a fonte ao " +
      "lado para você conferir.\n\nSobre o que você quer saber?"
    );
  }

  if (dossie.desambiguacao) {
    const { termo, opcoes } = dossie.desambiguacao;
    /*
      Duas coisas diferentes chegam aqui, e elas não podem receber a mesma frase.

      A ambiguidade de sempre é **uma coisa que existe com mais de um nome
      possível**: "manutenção" casa duas gavetas, e perguntar qual delas é a
      resposta certa. A que o portão de correspondência produz é o oposto — o
      que foi pedido **não existe**, e o que existe é um vizinho. Dizer
      `"qlp administrativo" pode ser mais de uma coisa aqui: DESCONTO QLP ADM,
      QLP ADM` afirma que o termo pedido é uma dessas duas, que é a troca
      silenciosa entrando pela porta da redação depois de a orquestração a ter
      barrado.

      Quando há lacuna, é ela que abre: `explicarFalta` já escreve as duas
      metades obrigatórias — não encontrei X, encontrei Y, era Y?
    */
    const naoEncontrei = dossie.lacunas.find((l) => l.tipo === "NAO_ENCONTREI");
    if (naoEncontrei) return naoEncontrei.explicacao;
    return `"${termo}" pode ser mais de uma coisa aqui: ${opcoes.join(", ")}. Qual delas você quer?`;
  }

  const partes: string[] = [];
  const itens = itensCitaveis(dossie);
  const doBook = itens.filter((i): i is Extract<typeof i, { tipo: "BOOK" }> => i.tipo === "BOOK");
  const conceito = itens.find(
    (i): i is Extract<typeof i, { tipo: "CONCEITO" }> => i.tipo === "CONCEITO",
  );

  /*
    O Book abre quando ele tem o que responder.

    O que sai é o texto do documento como ele está escrito — tabela inclusive —,
    e não uma paráfrase: sem modelo, parafrasear seria inventar. O teto existe
    porque a abertura é uma resposta, não o documento inteiro; o resto continua
    no Book, a um clique pela fonte.
  */
  if (doBook.length > 0) {
    let acumulado = 0;
    for (const item of doBook.slice(0, TRECHOS_NA_ABERTURA)) {
      const texto = semCarimboDoDocumento(item.documento.trecho.texto);
      if (!texto) continue;
      if (acumulado > 0 && acumulado + texto.length > TETO_DA_ABERTURA) break;
      partes.push(`${texto} [${item.id}]`);
      acumulado += texto.length;
      if (acumulado >= TETO_DA_ABERTURA) break;
    }
  } else {
    const escolha = fatoQueResponde(dossie);
    if (escolha) {
      const { evidencia, fato, fonte } = escolha;
      /*
        O recorte entra na frase, e entra uma vez só: quando o rótulo do fato
        já é a vigência, repeti-lo produzia "agosto/2026 em agosto/2026".
      */
      const doRecorte =
        evidencia.recorte?.vigencia ?? evidencia.recorte?.intervalo ?? evidencia.recorte?.contexto;
      const rotuloEhPeriodo = /\/(19|20)\d{2}\b/.test(fato.rotulo);
      const sufixo = doRecorte && !rotuloEhPeriodo ? ` em ${doRecorte}` : "";
      const rotulo = rotuloEhPeriodo ? `Em ${fato.rotulo}` : fato.rotulo;
      partes.push(
        `${rotulo}${sufixo}: ${fato.valor}${fato.detalhe ? ` — ${fato.detalhe}` : ""} [${fonte}].`,
      );
    } else if (conceito) {
      partes.push(`${conceito.trecho.trecho.texto} [${conceito.id}]`);
    }
  }

  for (const lacuna of dossie.lacunas) partes.push(lacuna.explicacao);

  /*
    O resto do dado entra depois da abertura — em frase, nunca em ficha.

    A lista sobrevive num caso: quando os fatos **são** uma enumeração (as
    vigências que existem, os veículos mais afetados). Aí cada linha é um item
    comparável, e a coluna ajuda a ler.
  */
  for (const item of itens) {
    if (item.tipo !== "DADO") continue;
    const e = item.evidencia;
    const uteis = e.fatos.filter((f) => !f.interno && f.valor && f.valor !== "—");
    if (uteis.length === 0) continue;

    const jaDito = partes.join(" ");
    const restantes = uteis.filter((f) => !jaDito.includes(f.valor));
    if (restantes.length === 0) continue;

    if (restantes.length > 3) {
      const linhas = restantes
        .map((f) => `- **${f.rotulo}:** ${f.valor}${f.detalhe ? ` — ${f.detalhe}` : ""}`)
        .join("\n");
      partes.push(`${e.titulo} [${item.id}]:\n\n${linhas}`);
    } else {
      const frase = restantes
        .map((f) => `${f.rotulo.toLowerCase()}: ${f.valor}${f.detalhe ? ` (${f.detalhe})` : ""}`)
        .join("; ");
      partes.push(`${frase} [${item.id}].`);
    }
    if (e.nota) partes.push(e.nota);
  }

  /*
    O conceito fecha, e só quando não abriu.

    Ele situa o que foi dito — "o Book é o contraponto do export" — e por isso
    vem depois do que responde. Repeti-lo quando ele já foi a abertura era o
    defeito mais visível da versão anterior: a mesma frase duas vezes, com a
    mesma citação.
  */
  if (conceito && partes.length > 0 && !partes[0].startsWith(conceito.trecho.trecho.texto)) {
    partes.push(`${conceito.trecho.trecho.texto} [${conceito.id}]`);
  }

  if (partes.length === 0) {
    const exemplos = SUGESTOES.slice(0, 4).map((s) => `- ${s.pergunta}`).join("\n");
    return (
      "Não encontrei nada que este produto sustente sobre isso — nem no conhecimento " +
      "registrado, nem no Book do Operador, nem no banco deste recorte.\n\n" +
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
 * Deixa passar o que já foi conferido, e **pula** o que não passa.
 *
 * A alternativa era transmitir cru e corrigir depois — mostrar um número que
 * ninguém consultou e retirá-lo em seguida. Num produto cuja regra é não exibir
 * o que não se pode sustentar, o instante em que o número aparece na tela já é
 * o dano; retirá-lo depois não desfaz a leitura.
 *
 * O que mudou é o que acontece com a frase que reprova. Antes o portão fechava
 * e nada mais saía: a pessoa via meia resposta parar no meio e, no fim, ser
 * substituída inteira. Agora a frase é pulada e o resto continua — o mesmo que
 * a conferência final faz com o texto completo, de modo que o que se lê durante
 * a escrita é o que fica no fim.
 */
export function portaoDeLastro(dossie: Dossie, aoTexto: (pedaco: string) => void) {
  let bruto = "";
  let liberado = 0;

  return {
    receber(pedaco: string): void {
      bruto += pedaco;

      const pendente = bruto.slice(liberado);
      const corte = ultimaFronteira(pendente);
      if (corte <= 0) return;

      for (const frase of emFrases(pendente.slice(0, corte))) {
        if (
          numerosSemLastro(frase, dossie).length > 0 ||
          citacoesSemFonte(frase, dossie).length > 0
        ) {
          continue;
        }
        aoTexto(frase);
      }
      liberado += corte;
    },
  };
}

// ── Sugestões contextuais ───────────────────────────────────────────────────

/**
 * As próximas perguntas que fazem sentido **depois desta**.
 *
 * A regra é a mesma da resposta: específica ou nenhuma. "Posso ajudar em mais
 * alguma coisa?" e "quer saber mais?" não são sugestões — são preenchimento. O
 * que vale é o próximo passo que a conversa acabou de tornar possível: quem
 * ouviu a regra de um bloco pode querer o número daquele assunto; quem ouviu o
 * número pode querer a regra.
 */
function sugerir(dossie: Dossie): string[] {
  const { plano } = dossie;
  const gaveta = plano.alvo?.parametro;
  const bloco = dossie.documentos[0]?.trecho.bloco;
  const saida: string[] = [];

  /*
    Depois de um "bom dia", as sugestões são o próprio convite: elas dizem, em
    forma clicável, o que este assistente sabe responder.
  */
  if (plano.intencao === "SAUDACAO") return SUGESTOES.slice(0, 3).map((s) => s.pergunta);

  /*
    A ponte entre as duas fontes é a sugestão mais útil que existe aqui, e ela
    vale nos dois sentidos: quem acabou de ler a regra pergunta quanto aquilo
    mexeu; quem acabou de ver o número pergunta o que a regra diz.
  */
  if (bloco) {
    const outrasSecoes = [
      ...new Set(
        dossie.documentos
          .map((d) => d.trecho.secao?.split(" › ").pop())
          .filter((s): s is string => Boolean(s) && s !== bloco),
      ),
    ];
    for (const secao of outrasSecoes.slice(0, 2)) {
      saida.push(`O que o Book diz sobre ${secao.toLowerCase()} em ${bloco}?`);
    }
    saida.push(`Algum parâmetro relacionado a ${bloco} mudou na última vigência?`);
  }

  switch (plano.intencao) {
    case "CONCEITUAL":
    case "DISPONIBILIDADE":
      if (gaveta) saida.push(`Quanto ${gaveta} mudou na última vigência?`);
      break;
    case "MOVIMENTO":
      saida.push("Onde perdemos mais dinheiro?");
      saida.push("Quais veículos foram mais impactados?");
      break;
    /*
      Depois da fila, o próximo passo é sempre o primeiro item dela — e ele tem
      nome. Perguntar pela regra do que ficou em primeiro lugar é o movimento
      natural de quem acabou de saber por onde começar.
    */
    case "ATENCAO": {
      const primeiro = dossie.evidencias.find((e) => e.assuntoEmDestaque)?.assuntoEmDestaque;
      if (primeiro) {
        saida.push(`O que o Book diz sobre ${primeiro.toLowerCase()}?`);
        saida.push(`Quais veículos foram afetados em ${primeiro.toLowerCase()}?`);
      }
      saida.push("Onde perdemos mais dinheiro?");
      break;
    }
    case "EVOLUCAO":
    case "COMPARACAO":
      if (gaveta && !bloco) saida.push(`O que o Book do Operador diz sobre ${gaveta}?`);
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
      if (gaveta && !bloco) saida.push(`Quanto ${gaveta} mudou na última vigência?`);
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
  /**
   * Junta o dossiê inteiro, como texto, em `tecnico.contexto.dossie`.
   *
   * A contagem do contexto sai sempre; o texto integral só aqui, porque ele é
   * grande e é material interno. Quem liga isto é a bateria de aceitação, que
   * precisa mostrar **com o quê** o modelo teria respondido cada pergunta.
   */
  diagnostico?: boolean;
  /**
   * Liga ou desliga o agente **nesta chamada**, ignorando a variável.
   *
   * A flag continua sendo de ambiente para produção; isto existe para quem
   * precisa exercitar os dois caminhos no mesmo processo. O teste de
   * reversibilidade fazia isso mutando `process.env`, e a mutação vazava: o
   * vitest reaproveita worker entre arquivos, e um benchmark que rodasse na
   * janela em que a flag estava ligada media o agente achando que media o
   * planejador — falhava na suíte e passava isolado.
   *
   * Um parâmetro não tem janela.
   */
  agente?: boolean;
}

/**
 * A resposta do agente, montada sobre o mesmo contrato da outra.
 *
 * Ela sai por aqui e não pelo caminho de baixo por uma razão de honestidade: a
 * numeração das citações, as fontes da tela e as sugestões são todas derivadas
 * do dossiê da orquestração, e no caminho do agente o material veio de outro
 * lugar. Misturar os dois produziria uma tela em que a fonte [3] aponta para
 * uma consulta que não participou da resposta.
 *
 * O que **não** muda: a trava de lastro é a mesma função, com a mesma regra de
 * um terço. O que muda é a lista de números que ela aceita — agora a das
 * ferramentas que o modelo chamou.
 */
/**
 * De qual consulta anterior cada consulta saiu — o encadeamento, medido.
 *
 * **A pergunta que isto responde.** "O agente investiga mais" não pode ser
 * provado contando consultas: dez buscas independentes disparadas de uma vez
 * são largura, não profundidade. O que separa investigar de consultar muito é
 * uma consulta cujo **argumento veio do resultado de outra** — "achei o grupo
 * mais crítico, agora abro ele". Essa é uma decisão tomada depois de ver o
 * dado, e é a única forma de encadeamento que se pode verificar sem perguntar
 * ao modelo o que ele quis dizer.
 *
 * Devolve, para cada chamada, o índice da anterior cujo conteúdo continha um
 * dos argumentos dela — ou `null`. Valores curtos ficam de fora: um `5` de
 * `limite` casaria com qualquer resultado e transformaria a medida em ruído.
 */
function encadeamentoDe(chamadas: Investigacao["chamadas"]): (number | null)[] {
  const textos = chamadas.map((c) => JSON.stringify(c.conteudo ?? null));

  return chamadas.map((c, i) => {
    const valores = Object.values(c.argumentos ?? {})
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      .map(String)
      .filter((v) => v.length >= 4);

    for (let j = i - 1; j >= 0; j--) {
      if (valores.some((v) => textos[j]!.includes(v))) return j;
    }
    return null;
  });
}


/**
 * O rastro desta resposta, a partir do que os dois caminhos têm em mãos.
 *
 * Escrito uma vez porque as duas montagens — planejador e agente — devolvem o
 * mesmo contrato e diferem só no que preenche `tecnico.agente`. Duplicá-lo
 * faria o rastro do agente sair de sincronia com o do planejador no primeiro
 * campo novo, que é exatamente a classe de defeito que o rastro existe para
 * tornar investigável.
 */

/**
 * O que esta chamada **exerceu** — e não só como o modelo a chamou.
 *
 * **O defeito que isto fecha, e por que ele custou caro.** `ChamadaDeFerramenta`
 * guarda o nome cru que o modelo pediu: `"alteracoes"`. O nível — `total`,
 * `grupos`, `linhas` — vive nos argumentos e reaparece em `Evidencia.ferramenta`
 * como `alteracoes:linhas`, que é a granularidade em que a bateria de aceitação
 * decide se uma capacidade foi exercida. Como `tecnico.ferramentas` carregava só
 * o nome, `capacidadesDe` caía no casamento por prefixo — e o prefixo devolve a
 * **primeira** entrada do mapa, que é a mais fraca (`alteracoes:total` →
 * MOVIMENTO_AGREGADO).
 *
 * O efeito prático: o agente descia ao veículo, exercia ALTERACOES_DETALHADAS, e
 * a régua registrava "capacidade-ausente". Uma decisão de virada de chave tomada
 * sobre esse número reprova o agente por uma capacidade que ele exerceu.
 *
 * A evidência é a autoridade porque é ela que a trava de lastro confere e é ela
 * que numera as citações: se a capacidade fosse lida de um lugar e o lastro de
 * outro, os dois sairiam de sincronia sem nada quebrar.
 *
 * Uma chamada que falhou não tem evidência e não exerceu capacidade nenhuma —
 * ela mantém o nome cru com o carimbo de falha, que é o que a régua precisa para
 * não a contar como exercício.
 */

/**
 * A primeira frase da narração, em tamanho de etapa.
 *
 * O modelo narra em prosa — às vezes um parágrafo — e a tela mostra etapas de
 * uma linha. Cortar no fim da primeira frase preserva a informação que
 * interessa ("vou olhar os grupos de alteração") e descarta o resto, que numa
 * lista de progresso vira ruído. O corte por caracteres é o teto de segurança
 * para uma narração sem pontuação.
 */
function primeiraFrase(texto: string): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const fim = limpo.search(/[.!?](\s|$)/);
  const frase = fim > 0 ? limpo.slice(0, fim + 1) : limpo;
  return frase.length > 120 ? `${frase.slice(0, 117)}…` : frase;
}

function capacidadeExercida(chamada: Investigacao["chamadas"][number]): string {
  if (!chamada.ok) return `${chamada.nome} (falhou)`;
  const daEvidencia = [...new Set(chamada.evidencias.map((e) => e.ferramenta))];
  if (daEvidencia.length > 0) return daEvidencia.join(" + ");
  /*
    Chamada sem evidência não exerceu capacidade — mesmo tendo `ok: true`.

    `ok` diz que a ferramenta não lançou; não diz que ela respondeu. `alteracoes`
    com `nivel: "linhas"` e sem `atributo` é o caso exemplar: ela devolve, de
    propósito, um conteúdo que **explica ao modelo** o que faltou — e nenhuma
    evidência, porque não há o que citar. Devolver o nome cru aqui fazia a régua
    casá-lo por prefixo e registrar MOVIMENTO_AGREGADO: uma consulta que não
    respondeu nada contava como agregado entregue.

    O carimbo mantém a consulta visível no log — ela aconteceu, custou uma
    rodada, e quem investiga a resposta precisa vê-la — e a tira da conta de
    capacidades, que é onde ela não pode entrar.
  */
  return `${chamada.nome} (sem evidência)`;
}

function rastroDe(
  dossie: Dossie,
  resposta: Omit<Resposta, "rastro">,
): RastroDaResposta {
  return montarRastro({
    recorte: resposta.recorte,
    lacunas: resposta.lacunas,
    plano: {
      scopeHash: dossie.plano.contexto?.contexto.scopeHash ?? null,
      canal: dossie.plano.contexto?.contexto.channel ?? null,
      origemDoRecorte: dossie.plano.origemDoRecorte,
      unidadeCitada: dossie.plano.unidadeCitada,
      periodo: dossie.plano.periodo,
      periodoImpossivel: dossie.plano.periodoImpossivel,
    },
    tecnico: resposta.tecnico,
  });
}

function montarComAgente(
  dossie: Dossie,
  investigacao: Investigacao,
  opcoes: PerguntaOptions,
  pergunta: string,
): Resposta {
  const daFerramenta = evidenciasDaInvestigacao(investigacao);
  const encadeamento = encadeamentoDe(investigacao.chamadas);
  /*
    O dossiê que a trava confere é o do agente: as evidências das ferramentas,
    e não as da orquestração. Somar as duas listas deixaria o modelo citar um
    número de uma consulta que ele não pediu — que é lastro emprestado, e lastro
    emprestado não é lastro.
  */
  const paraConferir: Dossie = { ...dossie, evidencias: daFerramenta, trechos: [], documentos: [], anexos: [] };

  let texto = redacaoDeterministica(dossie);
  let redacao: Resposta["redacao"] = "DETERMINISTICA";
  let causa: CausaDaRedacao =
    investigacao.parou === "RECUSA" ? "RECUSA" : investigacao.parou === "RESPONDEU" ? "IA_OK" : "ERRO";
  let numerosRecusados: string[] = [];
  let frasesPodadas = 0;
  let frasesTotais = 0;

  if (investigacao.texto) {
    const saneamento = sanear(investigacao.texto, paraConferir);
    numerosRecusados = saneamento.recusados;
    frasesPodadas = saneamento.removidas;
    frasesTotais = saneamento.total;

    if (saneamento.recusados.length === 0) {
      texto = investigacao.texto;
      redacao = "IA";
      causa = "IA_OK";
    } else if (!saneamento.irrecuperavel) {
      texto = saneamento.texto;
      redacao = "IA";
      causa = "IA_PODADA";
    } else {
      causa = "DESCARTADA";
    }
  }

  const evento = registrar({
    modelo: investigacao.medicao.modelo,
    esforco: investigacao.medicao.esforco,
    fluxo: false,
    latenciaMs: investigacao.medicao.latenciaMs,
    tokensEntrada: investigacao.medicao.tokensEntrada,
    tokensSaida: investigacao.medicao.tokensSaida,
    origemDosTokens: investigacao.medicao.origemDosTokens,
    turnosNoHistorico: Math.min((opcoes.historico ?? []).length, 8),
    intencao: dossie.plano.intencao,
    desfecho:
      causa === "IA_OK" ? "IA" : causa === "IA_PODADA" ? "PODADA" : causa === "DESCARTADA" ? "DESCARTADA" : investigacao.medicao.desfecho,
    erro: investigacao.medicao.erro,
  });

  /*
    As fontes da tela passam a ser as consultas que o agente fez, na ordem em
    que ele as fez. É o rastro que responde "o que ele olhou antes de dizer
    isso?" — e é a mesma lista que a trava usou.
  */
  const fontes: Fonte[] = daFerramenta.map((e, i) => ({
    id: String(i + 1),
    tipo: e.ferramenta.toLowerCase().includes("book") ? "BOOK" : "DADO",
    titulo: e.titulo,
    origem: e.origem,
    ...(e.recorte
      ? { detalhe: [e.recorte.contexto, e.recorte.vigencia].filter(Boolean).join(" · ") }
      : {}),
    ...(e.tela ? { tela: e.tela } : {}),
  }));

  const montada: Omit<Resposta, "rastro"> = {
    pergunta,
    texto,
    redacao,
    modelo: redacao === "IA" ? modeloConfigurado() : null,
    intencao: dossie.plano.intencao,
    recorte: recorteDoDossie(dossie),
    fontes,
    etapas: dossie.etapas,
    lacunas: dossie.lacunas,
    sugestoes: sugerir(dossie),
    desambiguacao: dossie.desambiguacao,
    estado: avancarEstado(opcoes.estado ?? ESTADO_VAZIO, dossie),
    tecnico: {
      intencao: dossie.plano.intencao,
      porque: dossie.plano.porque,
      herdado: dossie.plano.herdado,
      /*
        O log completo: **capacidade** e desfecho de cada consulta, na ordem.
        Ver `capacidadeExercida` — o nome cru perde o nível, e o nível é o que
        diz o que foi exercido.
      */
      ferramentas: investigacao.chamadas.map(capacidadeExercida),
      numerosRecusados,
      agente: {
        rodadas: investigacao.rodadas,
        consultas: investigacao.chamadas.length,
        parou: investigacao.parou,
        chamadas: investigacao.chamadas.map((c, i) => ({
          nome: c.nome,
          argumentos: (c.argumentos ?? {}) as Record<string, unknown>,
          ok: c.ok,
          erro: c.erro,
          evidencias: c.evidencias.length,
          /*
            A referência que prova encadeamento.

            É o que separa investigar de consultar muito: uma chamada cujo
            argumento saiu do resultado de outra é uma decisão tomada **depois**
            de ver o dado — "achei o grupo mais crítico, agora abro ele". Contar
            só o número de consultas trataria isso igual a disparar dez buscas
            independentes de uma vez, que é o oposto.
          */
          derivaDe: encadeamento[i] ?? null,
        })),
      },
      motor: explicarRedacao({ codigo: causa, frasesPodadas, frasesTotais, numerosRecusados, erro: investigacao.medicao.erro }),
      contexto: contextoParaOModelo(paraConferir, {
        ...(opcoes.historico ? { historico: opcoes.historico } : {}),
        ...(opcoes.diagnostico ? { incluirTexto: true } : {}),
      }),
      ia: {
        desfecho: evento.desfecho,
        modelo: evento.modelo,
        latenciaMs: evento.latenciaMs,
        erro: evento.erro,
        tokensEntrada: evento.tokensEntrada,
        tokensSaida: evento.tokensSaida,
        origemDosTokens: evento.origemDosTokens,
        custoUsd: evento.custoUsd,
      },
      rastro: {
        assunto: dossie.plano.assunto,
        comoReconheceu: dossie.plano.comoReconheceu,
        necessidades: dossie.plano.necessidades,
        book: dossie.diagnostico.book,
        etapas: dossie.etapas.map((e) => ({ nome: e.nome, ms: e.ms })),
        orquestracaoMs: dossie.diagnostico.ms,
        frasesPodadas,
        frasesTotais,
      },
    },
  };
  return { ...montada, rastro: rastroDe(dossie, montada) };
}

/**
 * As comparações que esta conversa vai precisar, materializadas — uma vez.
 *
 * **A pergunta que isto responde é de quem é a pré-condição.** `change` e
 * `change_set` são estado derivado: eles nascem de `computeChangeSet` e, até
 * este ponto, seis lugares os criavam por conta própria — a promoção de uma
 * importação, dois endpoints de tela, a ficha de composição, a série
 * consolidada, um CLI — e um sétimo, a orquestração do planejador, criava-os
 * por pergunta. Sete iniciativas, nenhum dono; quem esquecesse lia zero e não
 * tinha como saber que era zero por falta de cálculo.
 *
 * **Por que aqui e não em cada ferramenta.** Uma ferramenta que garante a
 * própria pré-condição vira escrita disfarçada de leitura, e seriam N delas —
 * `alteracoes`, `ordenacao`, `comparar`, `resultado`, `veiculos` — cada uma com
 * a chance de esquecer. Seria trocar sete donos por doze.
 *
 * **Por que aqui e não no orquestrador, onde estava.** Porque o orquestrador é
 * o caminho que esta migração aposenta. Enquanto a garantia morasse lá, o
 * agente a recebia de carona — `responder` orquestra antes de investigar — e o
 * dia em que o planejador saísse levaria a pré-condição junto, num diff que não
 * fala de comparações. Esta função é o único ponto por onde os dois caminhos
 * passam **e** que sobrevive à remoção de um deles.
 *
 * **Por que não deixar a leitura calcular.** `getGroupedView` recusa-se a
 * calcular de propósito, e a decisão é boa: abrir uma tela não deve disparar
 * trabalho pesado nem produzir números diferentes conforme quem abriu primeiro.
 * O que faltava lá não era o cálculo — era dizer que não havia o que ler, e é
 * o que `naoComparada` agora diz. Repara-se num lugar; lê-se com honestidade em
 * todos.
 *
 * Falha em silêncio de propósito: um par que não se compara — escopo, canal ou
 * cobertura diferentes — é condição legítima do domínio, e derrubar a pergunta
 * por causa dele trocaria resposta incompleta por resposta nenhuma. O que
 * sobra, quem lê declara.
 */
async function garantirRecorte(
  db: Database,
  pergunta: string,
  opcoes: PerguntaOptions,
): Promise<void> {
  /*
    A pré-condição é garantida no recorte que a **pergunta** descreve.

    Enquanto ela usava só a tela e o fio, "só Camaçari" fazia a orquestração
    consultar Camaçari e a garantia materializar as comparações da unidade
    anterior — e a diferença aparecia como uma resposta sem alterações numa
    vigência que tinha várias. É a mesma decisão em dois lugares; agora é a
    mesma função.
  */
  const { resolvido } = await contextoDoTurno(db, pergunta, {
    ...(opcoes.recorte ? { recorte: opcoes.recorte } : {}),
    estado: opcoes.estado ?? null,
  }).catch(() => ({ resolvido: null }));
  if (!resolvido) return;
  opcoes.aoAvancar?.({
    nome: "garantirComparacoes",
    rotulo: "Conferindo as comparações da vigência",
    ms: 0,
  });
  await garantirComparacoes(db, resolvido.contexto).catch(() => null);
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
  /*
    Antes de orquestrar e antes de investigar, e por isso vale para os dois.
    Ver `garantirRecorte` acima para por que a pré-condição mora aqui.
  */
  await garantirRecorte(db, pergunta, opcoes);

  const dossie = await orquestrar(db, pergunta.trim(), {
    ...(opcoes.recorte ? { recorte: opcoes.recorte } : {}),
    estado: opcoes.estado ?? null,
    ...(opcoes.aoAvancar ? { aoAvancar: opcoes.aoAvancar } : {}),
  });

  const determinista = redacaoDeterministica(dossie);
  let texto = determinista;
  let redacao: Resposta["redacao"] = "DETERMINISTICA";
  let numerosRecusados: string[] = [];
  let ia: Resposta["tecnico"]["ia"] = null;
  let frasesPodadas = 0;
  let frasesTotais = 0;
  /*
    A causa começa no caso em que não houve chamada, e é corrigida se houver.

    Escrever assim — em vez de deduzir a causa no fim a partir de `ia === null`
    — é o que torna as duas situações distinguíveis: `disponivel()` e `semIa`
    são perguntas diferentes, e só aqui as duas ainda estão à mão.
  */
  let causa: CausaDaRedacao = opcoes.semIa ? "IA_DESLIGADA" : "SEM_CHAVE";

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
    /*
      ---- o caminho do agente, atrás da flag ---------------------------------

      Com `ASSISTENTE_AGENTE=1` o modelo passa a escolher o que consultar. Tudo
      o mais continua: a orquestração roda antes (o dossiê ainda é montado, e é
      ele que a comparação "antes × depois" usa como referência), a trava
      confere o texto, e a redação em código continua sendo o destino de uma
      resposta que não se sustente.

      **As evidências das ferramentas entram no lastro desde já.** Seria
      possível deixar para o PR 3 e ligar a flag num estado em que toda resposta
      do agente é descartada — falharia fechado, que é seguro, e seria um flag
      impossível de avaliar. Rastreabilidade é requisito do desenho, não etapa
      da migração: um número só chega à tela se tiver voltado de uma consulta,
      e agora "consulta" inclui as que o modelo escolheu.
    */
    if (opcoes.agente ?? agenteLigado()) {
      const investigacao = await investigar({
        pergunta,
        registro: registroPadrao(),
        /*
          O recorte das ferramentas é o que a orquestração **resolveu**, e não o
          que a tela mandou.

          A diferença aparece na frase que nomeia a unidade: `plano.contexto` já
          é Camaçari quando alguém escreveu "só Camaçari", e `opcoes.recorte`
          continua sendo a unidade do link. Passar o segundo faria o agente
          investigar uma operação e a resposta anunciar outra — com o rótulo do
          recorte, que vem do dossiê, dizendo a certa.
        */
        ferramentas: {
          db,
          recorte: dossie.plano.contexto
            ? {
                scopeHash: dossie.plano.contexto.contexto.scopeHash,
                channel: dossie.plano.contexto.contexto.channel,
              }
            : {
                ...(opcoes.recorte?.scopeHash ? { scopeHash: opcoes.recorte.scopeHash } : {}),
                ...(opcoes.recorte?.channel !== undefined
                  ? { channel: opcoes.recorte.channel }
                  : {}),
              },
          ...(dossie.plano.periodo ? { periodo: dossie.plano.periodo } : {}),
          /*
            Os filtros do fio, injetados como o recorte.

            `dossie.leitura.entidades.equipamento` já é o desta pergunta ou o
            herdado — a orquestração resolveu essa precedência antes de chegar
            aqui. O que o executor faz é aplicá-lo como padrão, para que o
            modelo não precise repetir "cavalos" em toda chamada e, sobretudo,
            para que esquecer de repetir não devolva a resposta à frota inteira.
          */
          filtros: {
            ...(dossie.leitura.entidades.equipamento
              ? { equipamento: dossie.leitura.entidades.equipamento }
              : {}),
            ...(opcoes.estado?.pagina
              ? {
                  apartirDe: opcoes.estado.pagina.apartirDe,
                  limite: opcoes.estado.pagina.tamanho,
                }
              : {}),
          },
        },
        ...(opcoes.historico?.length ? { historico: opcoes.historico } : {}),
        /*
          Os três canais de progresso, e por que os três precisam existir.

          A investigação do agente leva de vinte a trinta segundos, e até aqui a
          tela recebia **um** deles — `aoConsultar`. Entre duas consultas, e
          durante a rodada que redige, não chegava nada: a experiência era um
          cursor parado por dezenas de segundos numa aplicação que acabou de
          prometer investigar.

          - `aoRodada` diz que o modelo voltou a pensar. É o que preenche o
            intervalo entre o resultado de uma consulta e o pedido da próxima.
          - `aoConsultar` diz o que está sendo consultado agora — já existia.
          - `aoNarrar` traz a frase que o modelo escreve antes de consultar
            ("deixa eu ver os grupos de alteração"). Ela é progresso de verdade,
            escrita por quem está investigando, e **era descartada**: o campo
            existia em `investigar` desde o PR 2 e nenhum chamador o passava.

          **O que deliberadamente não se faz: transmitir o texto da resposta
          enquanto ele é escrito.** No caminho determinístico isso é seguro
          porque o dossiê está fechado antes da primeira palavra — a trava
          confere frase a frase contra um conjunto que não muda mais. No laço do
          agente não há esse conjunto: uma rodada que parece estar redigindo pode
          terminar pedindo mais uma consulta, e o que já teria aparecido na tela
          seria narração exibida como resposta. Preferir o congelamento de uma
          rodada a mostrar uma resposta que não é a resposta é a mesma escolha
          que este produto faz em toda tela.
        */
        ...(opcoes.aoAvancar
          ? {
              aoRodada: (rodada: number) =>
                opcoes.aoAvancar!({
                  nome: "rodada",
                  rotulo: rodada === 1 ? "Investigando" : `Investigando · rodada ${rodada}`,
                  ms: 0,
                }),
              aoConsultar: (nome: string) =>
                opcoes.aoAvancar!({ nome: "ferramenta", rotulo: `Consultando ${nome}`, ms: 0 }),
              aoNarrar: (texto: string) =>
                opcoes.aoAvancar!({ nome: "narracao", rotulo: primeiraFrase(texto), ms: 0 }),
            }
          : {}),
      });

      return montarComAgente(dossie, investigacao, opcoes, pergunta);
    }

    const portao = opcoes.aoTexto ? portaoDeLastro(dossie, opcoes.aoTexto) : null;
    const { texto: doModelo, medicao } = portao
      ? await redigirEmFluxo(pedido, (pedaco) => portao.receber(pedaco))
      : await redigir(pedido);

    let desfecho = medicao.desfecho;

    if (doModelo) {
      /*
        O que não se sustenta sai; o que se sustenta fica.

        A regra anterior descartava a resposta inteira ao primeiro número sem
        lastro. Ela cumpria a promessa e cobrava caro por ela: uma data de
        vigência ou um valor arredondado — texto fiel ao dossiê — derrubava
        análises inteiras, e quanto melhor a redação, maior a chance de cair.

        A promessa nunca foi "a resposta é atômica"; foi "nada sem lastro chega
        à tela". Podar a frase cumpre isso por inteiro. E quando a poda passa de
        um terço das frases, o descarte volta a ser total — aí não é um número
        fora do lugar, é uma resposta construída sobre material que não existe.
      */
      const saneamento = sanear(doModelo, dossie);
      numerosRecusados = saneamento.recusados;
      frasesPodadas = saneamento.removidas;
      frasesTotais = saneamento.total;

      if (saneamento.recusados.length === 0) {
        texto = doModelo;
        redacao = "IA";
        causa = "IA_OK";
      } else if (!saneamento.irrecuperavel) {
        texto = saneamento.texto;
        redacao = "IA";
        desfecho = "PODADA";
        causa = "IA_PODADA";
      } else {
        desfecho = "DESCARTADA";
        causa = "DESCARTADA";
      }
    } else {
      /*
        Sem texto do modelo: ou ele recusou, ou a chamada quebrou. `medicao`
        distingue as duas, e nenhuma delas é "sem chave" — o `disponivel()`
        acima já garantiu que havia chave para tentar.
      */
      causa = medicao.desfecho === "RECUSA" ? "RECUSA" : "ERRO";
    }

    const evento = registrar({ ...medicao, intencao: dossie.plano.intencao, desfecho });
    /*
      O mesmo evento que vai para o anel volta com a resposta.

      O anel responde "como está agora" e some no restart; esta cópia responde
      "o que aconteceu **nesta** pergunta", que é a que alguém faz olhando para
      um texto que não parece ter saído de um modelo.
    */
    ia = {
      desfecho: evento.desfecho,
      modelo: evento.modelo,
      latenciaMs: evento.latenciaMs,
      erro: evento.erro,
      tokensEntrada: evento.tokensEntrada,
      tokensSaida: evento.tokensSaida,
      origemDosTokens: evento.origemDosTokens,
      custoUsd: evento.custoUsd,
    };
  }

  const estado = avancarEstado(opcoes.estado ?? ESTADO_VAZIO, dossie);

  const montada: Omit<Resposta, "rastro"> = {
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
      // O caminho determinístico não investiga: não há rodadas a relatar.
      agente: null,
      motor: explicarRedacao({
        codigo: causa,
        frasesPodadas,
        frasesTotais,
        numerosRecusados,
        erro: ia?.erro ?? null,
      }),
      contexto: contextoParaOModelo(dossie, {
        ...(opcoes.historico ? { historico: opcoes.historico } : {}),
        ...(opcoes.diagnostico ? { incluirTexto: true } : {}),
      }),
      ia,
      rastro: {
        assunto: dossie.plano.assunto,
        comoReconheceu: dossie.plano.comoReconheceu,
        necessidades: dossie.plano.necessidades,
        book: dossie.diagnostico.book,
        etapas: dossie.etapas.map((e) => ({ nome: e.nome, ms: e.ms })),
        orquestracaoMs: dossie.diagnostico.ms,
        frasesPodadas,
        frasesTotais,
      },
    },
  };
  return { ...montada, rastro: rastroDe(dossie, montada) };
}

/** As perguntas oferecidas quando não há conversa. */
export function sugestoes(): typeof SUGESTOES {
  return SUGESTOES;
}
