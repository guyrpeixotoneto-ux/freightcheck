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
import { registrar, type EventoDeIa } from "./observabilidade";
import type { Intencao } from "./interpretacao";
import {
  citacoesSemFonte,
  itensCitaveis,
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
      const texto = item.documento.trecho.texto;
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
  let ia: Resposta["tecnico"]["ia"] = null;

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
    };
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
      ia,
    },
  };
}

/** As perguntas oferecidas quando não há conversa. */
export function sugestoes(): typeof SUGESTOES {
  return SUGESTOES;
}
