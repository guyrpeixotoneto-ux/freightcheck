import { ApiError } from "@/lib/api";
import { ErroDeTransporte } from "@/lib/transporte";

/**
 * O que se sabe de uma chamada que falhou — gravado onde dá para ler depois.
 *
 * A pergunta que este módulo existe para responder não é "falhou?". É **qual
 * das quatro**: cold start do Autoscale, processo reiniciado, deploy no meio da
 * chamada, ou a rede de quem estava na tela. As quatro produzem exatamente o
 * mesmo `TypeError: Failed to fetch` no navegador, e enquanto era só isso que
 * se registrava, escolher entre elas era chute — inclusive o chute que mandava
 * conferir um processo que estava de pé o tempo todo.
 *
 * **A instrumentação não pode depender da rede, porque a rede é o que falhou.**
 * É a restrição que decide o desenho inteiro: mandar a falha para o servidor no
 * momento em que ela acontece é mandá-la exatamente pelo caminho que acabou de
 * se romper — o registro se perde junto com a chamada, e some justamente a
 * falha que mais interessa. Por isso o registro é local e limitado
 * (`ULTIMAS`), e o enriquecimento vem **depois**, quando a chamada seguinte
 * volta a responder.
 *
 * O que o enriquecimento traz é o que separa as quatro: o carimbo de `/api/build`
 * antes e depois da interrupção. Mesmo processo dos dois lados quer dizer que
 * ninguém caiu e o problema foi o caminho; processo novo com o mesmo build é
 * partida a frio; build diferente é deploy. Ver `classificarInterrupcao`.
 */

/** O carimbo de `/api/build`: de qual código, e desde quando no ar. */
export interface Carimbo {
  revision: string;
  builtAt: string;
  /** Quando **este processo** subiu. É o campo que denuncia a partida a frio. */
  startedAt: string;
}

/**
 * O que provocou a chamada. Sem isto, "falhou às 14h03" não se interpreta.
 *
 * `foco` continua no tipo mesmo tendo sido desligado na fila da Curadoria: o
 * refetch por foco existe em outras queries (`auth.tsx`), e um registro que não
 * soubesse nomeá-lo atribuiria a falha a "desconhecida" — que é o valor que não
 * ensina nada.
 */
export type OrigemDoRefetch =
  | "montagem"
  | "foco"
  | "reconexao"
  | "manual"
  | "intervalo"
  | "desconhecida";

/** A que se atribui a interrupção, depois de comparados os dois carimbos. */
export type Interrupcao =
  /** Processo novo, mesmo build: o servidor foi recolhido e subiu de novo. */
  | "COLD_START"
  /** Build diferente: publicaram no meio. */
  | "DEPLOY"
  /** Mesmo processo dos dois lados: quem caiu foi o caminho, não o servidor. */
  | "REDE"
  /** O navegador estava offline: nem chegou a sair da máquina. */
  | "QUEDA_LOCAL"
  /** Falta o carimbo de antes — primeira falha da sessão, tipicamente. */
  | "INDETERMINADA";

export interface FalhaDeChamada {
  /** A rota, como a interface a pede: `/curation/queue`. */
  endpoint: string;
  /** Quando falhou, em ISO. */
  em: string;
  /** Quanto tempo a chamada levou até falhar. Separa recusa de espera. */
  duracaoMs: number;
  /** `development`, `production` — o modo com que este bundle foi construído. */
  ambiente: string;
  /** O último `revision` conhecido do servidor, ou `desconhecida`. */
  revision: string;
  /** Qual tentativa foi esta, contando de 1. */
  tentativa: number;
  /** O navegador se considerava online no instante da falha. */
  online: boolean;
  /** O que provocou a chamada. */
  origem: OrigemDoRefetch;
  /** O estado do transporte, ou `HTTP` quando houve resposta com status. */
  estado: string;
  status?: number;
  mensagem: string;
  /** Preenchido quando a chamada seguinte volta a responder. */
  desfecho?: { carimbo: Carimbo; interrupcao: Interrupcao };
}

/**
 * A quem atribuir a interrupção, comparando os dois carimbos.
 *
 * Pura, e é o coração do módulo: é a única função aqui que **conclui** alguma
 * coisa, e por isso é a única que precisa ser exercitada caso a caso. As
 * demais coletam.
 *
 * A ordem das perguntas não é intercambiável. `online` vem primeiro porque um
 * navegador offline não chegou a consultar servidor nenhum — os carimbos podem
 * até diferir, e a diferença não teve nada a ver com a falha. O `revision` vem
 * antes do `startedAt` porque todo deploy também troca o processo: perguntar
 * pelo processo primeiro classificaria toda publicação como partida a frio.
 */
export function classificarInterrupcao(
  antes: Carimbo | null,
  depois: Carimbo,
  online: boolean,
): Interrupcao {
  if (!online) return "QUEDA_LOCAL";
  if (antes === null) return "INDETERMINADA";
  if (antes.revision !== depois.revision) return "DEPLOY";
  if (antes.startedAt !== depois.startedAt) return "COLD_START";
  return "REDE";
}

/**
 * Como nomear o estado de um erro, para o registro.
 *
 * Não reclassifica nada: lê o que `diagnosticarTransporte` e a rota já
 * decidiram. Uma segunda classificação aqui seria a mesma armadilha que
 * `apresentar-erro.ts` existe para fechar — dois lugares opinando sobre o mesmo
 * erro, livres para divergir.
 */
export function descreverErro(erro: unknown): {
  estado: string;
  status?: number;
  mensagem: string;
} {
  if (erro instanceof ErroDeTransporte) {
    const { estado, status } = erro.diagnostico;
    return {
      estado,
      ...(status === undefined ? {} : { status }),
      mensagem: erro.message,
    };
  }
  if (erro instanceof ApiError) {
    return {
      estado: erro.code ?? "HTTP",
      status: erro.status,
      mensagem: erro.message,
    };
  }
  if (erro instanceof TypeError) {
    // O `fetch` rejeitado antes de existir resposta. `apresentar-erro.ts` faz a
    // mesma leitura, e pelo mesmo motivo: nenhum erro nosso é `TypeError`.
    return { estado: "SEM_RESPOSTA", mensagem: erro.message };
  }
  return {
    estado: "DESCONHECIDO",
    mensagem: erro instanceof Error ? erro.message : String(erro),
  };
}

/**
 * Quantas falhas ficam guardadas.
 *
 * Vinte: o suficiente para cobrir um episódio inteiro (três tentativas por
 * chamada, algumas chamadas, a recuperação) e pouco o bastante para uma aba
 * aberta a semana toda não virar um vazamento de memória lento.
 */
const ULTIMAS = 20;

const registradas: FalhaDeChamada[] = [];

/** O último carimbo que o servidor deu — a base de comparação da próxima falha. */
let ultimoCarimbo: Carimbo | null = null;

/**
 * O nome pelo qual isto se lê do console do navegador.
 *
 * Não é conveniência: é a única saída que sobra. Quando o transporte está
 * quebrado não há como mandar nada para lugar nenhum, e a pessoa que está na
 * tela precisa conseguir extrair a evidência com uma linha digitada. Quem
 * atende o chamado pede `__freightcheck_falhas` e recebe as vinte últimas, com
 * horário, duração e desfecho.
 */
const NOME_NO_CONSOLE = "__freightcheck_falhas";

function ambienteDoBundle(): string {
  try {
    return import.meta.env.MODE ?? "desconhecido";
  } catch {
    return "desconhecido";
  }
}

function estaOnline(): boolean {
  // Fora do navegador — vitest, um render de servidor — não há offline a
  // observar, e assumir "online" é o que mantém a classificação honesta: sem
  // navegador, `QUEDA_LOCAL` nunca é a resposta.
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * Gravar uma falha. Devolve o registro, para quem quiser encadear o desfecho.
 *
 * @param agora  o relógio, injetável. Um teste que dependesse de `Date.now()`
 *               real não conseguiria afirmar nada sobre `duracaoMs`.
 */
export function registrarFalha(
  dados: {
    endpoint: string;
    duracaoMs: number;
    tentativa: number;
    origem: OrigemDoRefetch;
    erro: unknown;
  },
  agora: () => Date = () => new Date(),
): FalhaDeChamada {
  const falha: FalhaDeChamada = {
    endpoint: dados.endpoint,
    em: agora().toISOString(),
    duracaoMs: dados.duracaoMs,
    ambiente: ambienteDoBundle(),
    revision: ultimoCarimbo?.revision ?? "desconhecida",
    tentativa: dados.tentativa,
    online: estaOnline(),
    origem: dados.origem,
    ...descreverErro(dados.erro),
  };

  registradas.push(falha);
  if (registradas.length > ULTIMAS) registradas.shift();

  /*
    Uma linha por falha, e `warn` e não `error`: uma falha transitória que a
    tentativa seguinte resolveu não é um erro do produto, e marcá-la como tal
    treina quem opera a ignorar o console vermelho — que é onde os erros de
    verdade aparecem.
  */
  console.warn(
    `[transporte] ${falha.endpoint} — tentativa ${falha.tentativa}, ` +
      `${falha.estado}${falha.status === undefined ? "" : ` ${falha.status}`}, ` +
      `${falha.duracaoMs}ms, origem ${falha.origem}, ` +
      `${falha.online ? "online" : "offline"}. ` +
      `O registro inteiro sai em ${NOME_NO_CONSOLE}.`,
  );

  return falha;
}

/**
 * Uma chamada deu certo: fecha o que estava aberto e atualiza a base.
 *
 * **Uma função só para os dois casos**, e é onde a primeira versão errou. Havia
 * duas — uma para "recuperou", outra para "deu certo e nada havia falhado" — e
 * quem chamava escolhia entre elas perguntando se a *tentativa anterior daquele
 * ciclo* falhara. A pergunta parecia equivalente e não é: quando as três
 * tentativas se esgotam, o ciclo seguinte começa do zero, então a chamada que
 * finalmente responde acha que nada falhou antes dela — e o episódio inteiro
 * ficava sem desfecho, justamente o episódio longo, que é o que mais interessa.
 *
 * A pergunta certa não é sobre o ciclo, é sobre o registro: **há falha em
 * aberto?**. Quem sabe respondê-la é este módulo, e por isso a decisão mudou
 * de lado — quem chama só avisa que deu certo.
 *
 * Fecha **todas** as falhas em aberto, e não só a última: um episódio derruba
 * várias chamadas juntas (a fila, o resumo, o detalhe), e todas foram
 * interrompidas pela mesma coisa.
 *
 * @returns a que se atribuiu a interrupção, ou `null` se não havia nenhuma.
 */
export function registrarSucesso(carimbo: Carimbo): Interrupcao | null {
  const emAberto = registradas.filter((f) => f.desfecho === undefined);
  if (emAberto.length === 0) {
    /*
      Nada em aberto: este carimbo não explica nada, fica de base para a
      próxima falha. É o que dá comparação à **primeira** falha da sessão, que
      sem isto seria sempre `INDETERMINADA` — e a primeira é justamente a que
      se quer entender.
    */
    ultimoCarimbo = carimbo;
    return null;
  }

  const interrupcao = classificarInterrupcao(
    ultimoCarimbo,
    carimbo,
    emAberto[emAberto.length - 1].online,
  );
  for (const falha of emAberto) falha.desfecho = { carimbo, interrupcao };
  ultimoCarimbo = carimbo;
  return interrupcao;
}

export function carimboConhecido(): Carimbo | null {
  return ultimoCarimbo;
}

// ---------------------------------------------------------------------------
// A origem do refetch
// ---------------------------------------------------------------------------

/*
  Por que isto precisa ser rastreado à mão.

  O React Query não conta ao `queryFn` por que o chamou, e a diferença importa
  mais do que qualquer outro campo deste registro: uma falha na montagem da tela
  é uma coisa, e a mesma falha logo depois de a conexão voltar é outra —
  a segunda diz que a reconexão foi anunciada cedo demais, a primeira não diz
  nada sobre reconexão nenhuma. Sem este campo, os dois casos ficam
  indistinguíveis no registro, e foi assim que "falhou às 14h03" virou uma linha
  que não se conseguia interpretar.

  Por endpoint, e não uma variável só: duas telas falhando juntas embaralhariam
  as origens uma da outra, e o registro passaria a mentir com precisão de
  relógio. A primeira pergunta sobre um endpoint é sempre `montagem` — é a
  única origem que se deduz sem ninguém marcar.
*/
const jaChamados = new Set<string>();
const origensMarcadas = new Map<string, OrigemDoRefetch>();

/** Quem dispara um refetch deliberado diz aqui por quê, antes de disparar. */
export function marcarOrigem(endpoint: string, origem: OrigemDoRefetch): void {
  origensMarcadas.set(endpoint, origem);
}

/**
 * A origem desta chamada, consumida — a marca vale para uma chamada só.
 *
 * Não sobreviver ao uso é o que impede um clique em "tentar de novo" de
 * carimbar `manual` em todo refetch das duas horas seguintes.
 */
export function consumirOrigem(endpoint: string): OrigemDoRefetch {
  const marcada = origensMarcadas.get(endpoint);
  origensMarcadas.delete(endpoint);
  const primeira = !jaChamados.has(endpoint);
  jaChamados.add(endpoint);
  if (marcada !== undefined) return marcada;
  return primeira ? "montagem" : "desconhecida";
}

export function falhasRegistradas(): readonly FalhaDeChamada[] {
  return registradas;
}

/** Só para os testes: o registro é global de propósito, e precisa zerar. */
export function limparRegistro(): void {
  registradas.length = 0;
  ultimoCarimbo = null;
  jaChamados.clear();
  origensMarcadas.clear();
}

/**
 * Pendurar o registro no `window`, uma vez, na partida da aplicação.
 *
 * Fora do navegador não faz nada — é o que mantém este módulo importável pelos
 * testes sem um DOM.
 */
export function publicarNoConsole(): void {
  if (typeof window === "undefined") return;
  Object.defineProperty(window, NOME_NO_CONSOLE, {
    get: falhasRegistradas,
    configurable: true,
  });
}
