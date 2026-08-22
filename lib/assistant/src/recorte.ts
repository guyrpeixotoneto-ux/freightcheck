/**
 * De que unidade, canal e vigência este turno fala — **decidido uma vez**.
 *
 * **O defeito que este módulo fecha.** O recorte chegava de três lugares (a
 * query string da tela, o estado da conversa, e o padrão de `resolveContext`) e
 * de nenhum deles vinha a pergunta. Uma frase como "só Camaçari" era lida,
 * tokenizada, comparada com o vocabulário do produto — e depois descartada: não
 * existia caminho de nome de unidade para `scopeHash`. O efeito era a pior
 * classe de resposta que uma aplicação de auditoria pode dar, porque ela não
 * parece errada: números corretos, sob o título de outra operação, sem nada na
 * tela dizendo que o pedido foi ignorado.
 *
 * **O reconhecimento é por dado, nunca por lista.** Não há gazetteer de cidades
 * aqui. O que decide é o nome dos escopos que o banco de fato tem — os mesmos
 * que a tela de Vigências mostra. Uma unidade que não foi importada não é
 * reconhecida, e é o portão de correspondência que diz isso a quem perguntou.
 * É a mesma inversão de `assunto.ts`: existe o que o produto sabe nomear.
 *
 * **A cobertura é total, e é de propósito.** Todas as palavras do nome do
 * escopo precisam estar na pergunta. `CENTRO DE DISTRIBUIÇÃO NORTE` não casa
 * com quem escreveu só "norte" — casar por prefixo aqui trocaria a unidade da
 * resposta por semelhança, que é exatamente o que o portão de correspondência
 * existe para impedir noutro eixo.
 */

import type { ContextInfo, SeriesContext } from "@workspace/comparison";
import type { EstadoDaConversa } from "./conversa";
import { normalizar, termos } from "./normalizar";

/** De onde saiu o recorte deste turno. Vai para a resposta, nunca fica implícito. */
export type OrigemDoRecorte =
  /** A pergunta nomeou a unidade, e o produto a reconheceu. */
  | "PERGUNTA"
  /** A tela mandou `scopeHash` — o seletor, ou um link que o carrega. */
  | "TELA"
  /** O fio da conversa já estava numa unidade. */
  | "CONVERSA"
  /** Ninguém escolheu: é o primeiro contexto que o banco devolve. */
  | "PADRAO";

export interface UnidadeReconhecida {
  /** O contexto inteiro, para quem precisa do rótulo e das vigências. */
  contexto: ContextInfo;
  /** O nome do escopo, como o banco o guarda: "CAMAÇARI". */
  nome: string;
  /** O tipo do escopo que casou: UNIDADE, REGIONAL, OPERADOR. */
  tipo: string;
}

export interface RecorteDoTurno {
  /** O que vai para `resolverContexto`. */
  pedido: Partial<SeriesContext>;
  origem: OrigemDoRecorte;
  /** A unidade que a pergunta nomeou, quando nomeou uma reconhecida. */
  citada: UnidadeReconhecida | null;
}

/**
 * A unidade que a pergunta nomeia, entre as que existem.
 *
 * Devolve `null` quando a pergunta não nomeia nenhuma — que é o caso comum e
 * não é falha. Quem quer saber se ela nomeou uma que **não** existe pergunta ao
 * portão de correspondência, que é outro assunto: aqui só se reconhece.
 *
 * **A ordem do desempate não é arbitrária.** Primeiro o tipo de escopo, porque
 * `UNIDADE` é o que quem opera chama de unidade e `OPERADOR` é a transportadora
 * inteira; depois o nome mais específico, porque um nome de duas palavras que
 * casou inteiro descreve melhor do que um de uma; e por fim o canal que já
 * estava em pé, para "só Camaçari" não trocar de canal junto.
 */
export function unidadeCitada(
  pergunta: string,
  contextos: readonly ContextInfo[],
  canalCorrente?: string | null,
): UnidadeReconhecida | null {
  const naPergunta = new Set(termos(pergunta));
  if (naPergunta.size === 0) return null;

  const prioridade = (tipo: string): number =>
    tipo === "UNIDADE" ? 0 : tipo === "REGIONAL" ? 1 : 2;

  const candidatos: (UnidadeReconhecida & { palavras: number })[] = [];
  for (const contexto of contextos) {
    for (const escopo of contexto.scopes) {
      const nome = escopo.name?.trim();
      if (!nome) continue;
      const palavras = termos(nome);
      /*
        Um nome que não sobra nenhuma palavra depois da poda não identifica
        coisa alguma — e casaria toda pergunta, porque a condição "todas as
        palavras estão na frase" é trivialmente verdadeira para o conjunto
        vazio. É a mesma armadilha de `cobre` em `correspondencia.ts`, e aqui
        ela custaria a unidade da resposta.
      */
      if (palavras.length === 0) continue;
      if (!palavras.every((p) => naPergunta.has(p))) continue;
      candidatos.push({
        contexto,
        nome,
        tipo: escopo.scopeType,
        palavras: palavras.length,
      });
    }
  }

  if (candidatos.length === 0) return null;

  candidatos.sort((a, b) => {
    const porTipo = prioridade(a.tipo) - prioridade(b.tipo);
    if (porTipo !== 0) return porTipo;
    const porNome = b.palavras - a.palavras;
    if (porNome !== 0) return porNome;
    const aMantemCanal = a.contexto.channel === canalCorrente ? 0 : 1;
    const bMantemCanal = b.contexto.channel === canalCorrente ? 0 : 1;
    return aMantemCanal - bMantemCanal;
  });

  const { contexto, nome, tipo } = candidatos[0]!;
  return { contexto, nome, tipo };
}

/**
 * O recorte deste turno, com a precedência declarada.
 *
 * **A ordem é por quão recente é a declaração, não por qual canal a trouxe.**
 * Cinco degraus:
 *
 * 1. a unidade nomeada **nesta** pergunta;
 * 2. a tela, quando ela **mudou** desde o turno anterior — trocar o seletor é
 *    uma declaração tão explícita quanto escrever o nome;
 * 3. a unidade que a pessoa fixou por escrito num turno anterior;
 * 4. a tela repetindo o que já dizia;
 * 5. o fio, por qualquer outra origem — e, por fim, o padrão do banco.
 *
 * Os degraus 2 e 3 são o par que importa, e inverter os dois é o defeito que
 * esta ordem corrige: com a tela sempre à frente, "e somente cavalos" — que não
 * nomeia unidade — desfazia o "só Camaçari" do turno anterior, porque a tela
 * continuava mandando a unidade de onde a pessoa tinha saído.
 *
 * **`origem` sai junto, sempre.** Um recorte escolhido em silêncio é o defeito
 * que este módulo fecha; devolver de onde ele veio é o que permite à resposta
 * dizê-lo e ao painel técnico explicá-lo depois.
 */
export function resolverRecorteDoTurno(entrada: {
  pergunta: string;
  pedidoDaTela?: { scopeHash?: string; channel?: string | null } | undefined;
  estado?: EstadoDaConversa | null | undefined;
  contextos: readonly ContextInfo[];
}): RecorteDoTurno {
  const { pergunta, pedidoDaTela, estado, contextos } = entrada;

  const canalCorrente = pedidoDaTela?.channel ?? estado?.canal ?? null;
  const citada = unidadeCitada(pergunta, contextos, canalCorrente);

  if (citada) {
    return {
      pedido: {
        scopeHash: citada.contexto.scopeHash,
        channel: citada.contexto.channel,
      },
      origem: "PERGUNTA",
      citada,
    };
  }

  /*
    A tela vence quando ela **mudou** — e só então.

    Trocar a unidade no seletor é uma declaração tão explícita quanto escrevê-la
    na frase, e ela tem de valer. O que não pode valer é a tela **repetir** a
    seleção antiga e desfazer, a cada turno, a unidade que a pessoa fixou na
    conversa: sem esta distinção, "e somente cavalos" — que não nomeia unidade —
    voltava sozinha para a unidade de onde a pessoa tinha saído dois turnos
    antes, e nada na tela dizia isso.
  */
  const telaMudou =
    Boolean(pedidoDaTela?.scopeHash) && pedidoDaTela!.scopeHash !== estado?.telaScopeHash;
  if (telaMudou) {
    return {
      pedido: {
        scopeHash: pedidoDaTela!.scopeHash!,
        ...(pedidoDaTela!.channel !== undefined ? { channel: pedidoDaTela!.channel } : {}),
      },
      origem: "TELA",
      citada: null,
    };
  }

  /*
    A unidade que a pessoa fixou **por escrito** sobrevive aos turnos seguintes.

    Ela vem antes da tela porque é a declaração mais recente de quem pergunta —
    e depois da tela que mudou, porque essa é ainda mais recente.
  */
  if (estado?.scopeHash && estado.origemDoRecorte === "PERGUNTA") {
    return {
      pedido: {
        scopeHash: estado.scopeHash,
        ...(estado.canal !== null ? { channel: estado.canal } : {}),
      },
      origem: "CONVERSA",
      citada: null,
    };
  }

  if (pedidoDaTela?.scopeHash) {
    return {
      pedido: {
        scopeHash: pedidoDaTela.scopeHash,
        ...(pedidoDaTela.channel !== undefined ? { channel: pedidoDaTela.channel } : {}),
      },
      origem: "TELA",
      citada: null,
    };
  }

  if (estado?.scopeHash) {
    return {
      pedido: {
        scopeHash: estado.scopeHash,
        ...(estado.canal !== null ? { channel: estado.canal } : {}),
      },
      origem: "CONVERSA",
      citada: null,
    };
  }

  return {
    pedido: pedidoDaTela?.channel !== undefined ? { channel: pedidoDaTela.channel } : {},
    origem: "PADRAO",
    citada: null,
  };
}

// ── A vigência ──────────────────────────────────────────────────────────────

/**
 * O que aconteceu ao tentar resolver o período que a pergunta pediu.
 *
 * **Os dois `null` que eram um só.** `resolverPeriodo` devolvia `null` para
 * "ninguém pediu período" e para "pediram um período que não existe", e o
 * chamador tratava os dois como o primeiro: seguia com a vigência corrente. Uma
 * pergunta sobre fevereiro de 1998 era respondida com números de agosto de
 * 2026, corretos, sob um título que não os contradizia. Distinguir os dois
 * estados é a diferença entre um filtro que não foi pedido e um pedido que não
 * pode ser atendido — e o segundo é uma resposta, não um caso omisso.
 */
export type ResolucaoDePeriodo =
  | { tipo: "SEM_PEDIDO" }
  | { tipo: "RESOLVIDO"; data: string }
  | { tipo: "INEXISTENTE"; pedido: string; disponiveis: string[] };

/** "fevereiro de 1998", "1998", "última" — o pedido como quem o escreveu o diria. */
export function comoSePediu(pedido: {
  mes?: string;
  ano?: number;
  relativo?: "ULTIMA" | "ANTERIOR" | "PRIMEIRA";
}): string {
  if (pedido.relativo === "ULTIMA") return "a vigência mais recente";
  if (pedido.relativo === "ANTERIOR") return "a vigência anterior";
  if (pedido.relativo === "PRIMEIRA") return "a primeira vigência";
  if (pedido.mes && pedido.ano) return `${normalizar(pedido.mes)} de ${pedido.ano}`;
  if (pedido.mes) return String(pedido.mes);
  if (pedido.ano) return String(pedido.ano);
  return "o período pedido";
}

/**
 * A frase que a resposta é obrigada a dizer quando o período não existe.
 *
 * Escrita aqui, e nunca pelo modelo, pela mesma razão das outras quatro
 * lacunas: ela é a única coisa que impede a resposta de mudar de período em
 * silêncio, e uma garantia que depende de redação não é garantia.
 */
export function explicarPeriodoInexistente(
  pedido: string,
  disponiveis: readonly string[],
): string {
  if (disponiveis.length === 0) {
    return `Não há nenhuma vigência importada neste recorte, então não há como responder sobre ${pedido}.`;
  }
  const primeira = disponiveis[disponiveis.length - 1];
  const ultima = disponiveis[0];
  return (
    `Não existe vigência para ${pedido} neste recorte — o que foi importado vai de ` +
    `${primeira} a ${ultima}, ${disponiveis.length} vigência(s). ` +
    `Nenhum número desta resposta descreve ${pedido}: responder com outra vigência ` +
    `seria trocar o período sem avisar.`
  );
}
