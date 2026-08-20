import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryObserver,
  focusManager,
  onlineManager,
  type QueryObserverResult,
} from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import {
  PADRAO_DAS_CONSULTAS,
  chamadaResiliente,
} from "@/lib/chamada-resiliente";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";
import {
  deveApresentarIndisponibilidade,
  deveAvisarSobreDadoGuardado,
  esperaDaTentativa,
  guardarResposta,
  TENTATIVAS_AUTOMATICAS,
  type RespostaValida,
} from "@/lib/resiliencia";
import {
  classificarInterrupcao,
  falhasRegistradas,
  limparRegistro,
  marcarOrigem,
  type Carimbo,
} from "@/lib/registro-de-falhas";

/**
 * A política de resiliência da aplicação, atravessando as falhas que ela promete
 * atravessar.
 *
 * Nenhum destes cenários é reproduzível contra um servidor de verdade: "a
 * conexão cai e volta" não se agenda, e "o `/api/build` demora dez segundos" não
 * se pede a um ambiente compartilhado. O que os torna executáveis é
 * `chamadaResiliente` aceitar `buscar` e `carimbo` de fora.
 *
 * O que os torna **verdadeiros** é rodarem sobre os objetos que o produto usa:
 * `PADRAO_DAS_CONSULTAS` é literalmente o que `App.tsx` entrega ao
 * `QueryClient`, e as opções por consulta são as que `useConsultaResiliente`
 * espalha. Não há segunda cópia da política escrita aqui — e isso não é
 * elegância: uma política global cuja prova é uma reescrita dela não prova nada.
 *
 * Roda-se `QueryObserver` direto, sem React. O que se afirma é comportamento de
 * query — quantas tentativas, o que sobra, quando o erro aparece — e o que a
 * tela faz com isso são funções puras (`guardarResposta`,
 * `deveApresentarIndisponibilidade`), exercitadas na mesma composição que o hook
 * faz. Montar componente acrescentaria um DOM sem acrescentar uma asserção.
 */

const ENDPOINT = "/curation/queue";

const CARIMBO: Carimbo = {
  revision: "abc1234",
  builtAt: "2026-08-19T12:00:00.000Z",
  startedAt: "2026-08-19T12:00:05.000Z",
};

const FILA = [{ code: "peso_bruto" }, { code: "ipva_mensal" }];

/** O `TypeError` com que o navegador rejeita um `fetch` que não completou. */
const falhouAntesDeResponder = () => new TypeError("Failed to fetch");

/** O 500 desta API, já classificado como a rota o classificaria. */
const respondeu500 = () => new ApiError("o servidor respondeu 500.", 500);

/** Um 4xx: o pedido está errado, e vai continuar errado na quarta tentativa. */
const respondeu400 = () =>
  new ApiError("a competência já existe.", 409, "COMPETENCIA_DUPLICADA");

/** O 502 de corpo vazio do roteador — a API fora do ar, de verdade. */
const roteadorSemNinguemAtras = () =>
  new ErroDeTransporte(diagnosticarTransporte({ status: 502, corpoVazio: true }));

/**
 * O teto de espera de um ciclo inteiro — derivado da política, nunca transcrito.
 *
 * Este número existia como `5_000` escrito à mão no `ateAssentar` abaixo, e ele
 * era menor que o orçamento real da política. O efeito não foi um teste que
 * reprova: foi um teste que **mede outra coisa**. O helper desistia de esperar
 * no meio do ciclo e devolvia o resultado daquele instante — ainda repetindo,
 * ainda sem erro —, e as asserções sobre "esgotou as tentativas" passavam a
 * falar de uma query que não tinha esgotado nada.
 *
 * Enquanto o orçamento foi de 1,6s o limite de 5s sobrava, e o defeito ficou
 * latente. Ele apareceu no dia em que a política passou a cobrir cold start.
 * Derivar em vez de transcrever é o que impede a terceira versão deste bug, e é
 * o que mantém o teto correto tanto para um cenário que comprime a espera
 * (todos os de baixo, ver `observador`) quanto para um que não comprima.
 */
const ORCAMENTO_DA_POLITICA = Array.from(
  { length: TENTATIVAS_AUTOMATICAS - 1 },
  (_, i) => esperaDaTentativa(i),
).reduce((soma, espera) => soma + espera, 0);

async function ateAssentar<T>(
  observer: QueryObserver<T, Error, T>,
  opcoes: { limiteMs?: number } = {},
): Promise<QueryObserverResult<T, Error>> {
  /*
    A folga cobre o que o orçamento não conta: a própria execução de `buscar`, o
    passo de 10ms deste laço, e o agendamento do React Query entre tentativas.
  */
  const limite = opcoes.limiteMs ?? ORCAMENTO_DA_POLITICA + 5_000;
  const cancelar = observer.subscribe(() => {});
  const comecou = Date.now();
  try {
    for (;;) {
      const r = observer.getCurrentResult();
      if (r.fetchStatus === "idle" && (r.isSuccess || r.isError)) return r;
      if (Date.now() - comecou > limite) return r;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    cancelar();
  }
}

/**
 * Um observador com as opções que `useConsultaResiliente` espalha.
 *
 * **A espera entre tentativas é a única coisa comprimida**, e a exceção é
 * declarada aqui em vez de acontecer por acidente. Tudo o mais é o objeto de
 * produção: `queryFn`, `retry` (`deveTentarDeNovo`, a decisão de repetir),
 * `TENTATIVAS_AUTOMATICAS`, o registro de falhas e o `placeholderData`.
 *
 * O que estes cenários afirmam são **decisões** — repete ou não, o que sobra em
 * tela, o que chega ao registro, com que origem — e nenhuma delas muda com o
 * tamanho do intervalo entre uma tentativa e a seguinte. O cronograma em si é
 * afirmado exatamente, e sem esperar nada, em "o orçamento de espera" logo
 * abaixo: lá os 400ms, o teto e a soma são medidos direto de
 * `esperaDaTentativa`.
 *
 * Sem a compressão o arquivo levava 173s, com três cenários pousando a 26,4s de
 * um `testTimeout` de 30s — uma reprovação por máquina lenta esperando
 * acontecer, comprada por nenhuma verdade a mais.
 */
function observador<T>(
  client: QueryClient,
  buscar: () => Promise<T>,
  opcoes: { chave?: unknown[]; carimbo?: () => Promise<Carimbo | null> } = {},
) {
  return new QueryObserver<T, Error, T>(client, {
    queryKey: opcoes.chave ?? ["curation", "queue", false],
    ...chamadaResiliente<T>({
      endpoint: ENDPOINT,
      buscar,
      carimbo: opcoes.carimbo ?? (async () => CARIMBO),
    }),
    retryDelay: 0,
  });
}

/**
 * A composição que a tela faz: dobrar cada resultado por `guardarResposta`.
 *
 * É o que o `ref` de `useConsultaResiliente` faz a cada renderização, e é aqui
 * porque `data` sozinho **não** responde a pergunta: `keepPreviousData` solta o
 * dado no instante do erro.
 */
function comoATelaVe<T>(
  guardada: RespostaValida<T> | null,
  r: QueryObserverResult<T, Error>,
): RespostaValida<T> | null {
  return guardarResposta(
    guardada,
    r.data !== undefined && r.dataUpdatedAt > 0
      ? { dados: r.data, em: r.dataUpdatedAt }
      : undefined,
  );
}

let client: QueryClient;

beforeEach(() => {
  limparRegistro();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  /*
    Os mesmos defaults que `App.tsx` entrega ao produto, e `mount()` para que o
    `focusManager` e o `onlineManager` cheguem ao cache — sem ele os dois viram
    enfeite e nenhuma query refaz por foco ou por reconexão, o que faria o teste
    de foco passar por não medir nada. Ver o teste de controle.
  */
  client = new QueryClient({ defaultOptions: { queries: PADRAO_DAS_CONSULTAS } });
  client.mount();
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
});

afterEach(() => {
  client.unmount();
  client.clear();
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  vi.restoreAllMocks();
});

/**
 * O orçamento de espera, medido em vez de deduzido do comentário.
 *
 * Estas asserções são puras e instantâneas, e existem por causa de um defeito
 * que nenhum dos cenários abaixo pegava: eles perguntam *se* a política repete,
 * e o defeito era *por quanto tempo*. O orçamento era de 1,6s — calibrado para
 * o pacote perdido — enquanto a causa que a tela nomeia primeiro quando não
 * houve resposta é a origem acordando, que leva segundos. As três tentativas se
 * esgotavam antes de o servidor terminar de subir, e o painel vermelho era
 * garantido em todo cold start.
 *
 * O que o número precisa cobrir é isso, então é isso que se afirma aqui.
 */
describe("o orçamento de espera", () => {
  const degraus = Array.from({ length: TENTATIVAS_AUTOMATICAS - 1 }, (_, i) =>
    esperaDaTentativa(i),
  );

  it("começa curto: os dois primeiros degraus cobrem o pacote perdido", () => {
    expect(degraus.slice(0, 2)).toEqual([400, 1200]);
  });

  it("cobre um cold start: a soma passa de dez segundos", () => {
    const total = degraus.reduce((soma, espera) => soma + espera, 0);
    expect(total).toBeGreaterThan(10_000);
  });

  /*
    Sem teto a progressão por três chegaria a 10,8s num degrau só, e o total
    passaria de 16s — que é atraso puro: o que não subiu em treze segundos não
    sobe no vigésimo.
  */
  it("nenhum degrau sozinho passa de oito segundos", () => {
    for (const espera of degraus) expect(espera).toBeLessThanOrEqual(8_000);
  });
});

describe("a repetição, e a quem ela se aplica", () => {
  it("primeira chamada falha, segunda funciona: a tela nunca vê erro", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      if (n === 1) throw falhouAntesDeResponder();
      return FILA;
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(2);
    expect(r.data).toEqual(FILA);
    expect(r.error).toBeNull();
    expect(deveApresentarIndisponibilidade(true, r.error)).toBe(false);
  });

  it("API 5xx sem código: repete até o limite e então declara indisponível", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      throw respondeu500();
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(TENTATIVAS_AUTOMATICAS);
    expect(r.error).toBeInstanceOf(ApiError);
    expect(deveApresentarIndisponibilidade(false, r.error)).toBe(true);
  });

  /**
   * O outro lado da política, e o que a torna barata.
   *
   * Um 4xx com código do servidor não muda de ideia na quinta tentativa: ele
   * descreve o pedido, não o caminho. Repeti-lo só atrasa em 13,2s o aviso que
   * a pessoa precisa ler — e essa era a queixa que fez a política global
   * existir. O orçamento cresceu para cobrir cold start, o que torna esta
   * metade da política mais valiosa, não menos: é ela que garante que o
   * orçamento novo não caia sobre quem não tem nada a ganhar esperando.
   */
  it("erro 4xx com código não é repetido nenhuma vez", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      throw respondeu400();
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(1);
    expect((r.error as ApiError).status).toBe(409);
  });

  it("API totalmente inacessível: repete até o limite, e o registro numera 1 a N", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      throw roteadorSemNinguemAtras();
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(TENTATIVAS_AUTOMATICAS);
    expect((r.error as ErroDeTransporte).diagnostico.estado).toBe("API_AUSENTE");
    expect(falhasRegistradas().map((f) => f.tentativa)).toEqual(
      Array.from({ length: TENTATIVAS_AUTOMATICAS }, (_, i) => i + 1),
    );
  });
});

describe("o que sobra em tela", () => {
  /** Cenário 1: havia dado, a atualização falhou, o dado fica. */
  it("dado anterior + falha transitória: a lista continua, sem painel", async () => {
    let respondendo = true;
    const buscar = async () => {
      if (!respondendo) throw falhouAntesDeResponder();
      return FILA;
    };

    const obs = observador(client, buscar);
    let guardada = comoATelaVe<typeof FILA>(null, await ateAssentar(obs));
    expect(guardada?.dados).toEqual(FILA);

    // A troca de aba muda a chave do mesmo `useQuery` — é aqui que sumia.
    respondendo = false;
    obs.setOptions({
      queryKey: ["curation", "queue", true],
      ...chamadaResiliente<typeof FILA>({
        endpoint: ENDPOINT,
        buscar,
        carimbo: async () => CARIMBO,
      }),
      // Pelo mesmo motivo de `observador`: este cenário afirma o que sobra em
      // tela, não quanto se espera. Sem esta linha ele sozinho custa 13,2s.
      retryDelay: 0,
    });
    const cancelar = obs.subscribe((r) => {
      guardada = comoATelaVe(guardada, r);
    });
    const depois = await ateAssentar(obs);
    guardada = comoATelaVe(guardada, depois);
    cancelar();

    // O React Query soltou o dado — o limite é real, e é por isso que o hook
    // guarda a resposta por fora.
    expect(depois.data).toBeUndefined();
    expect(depois.error).toBeInstanceOf(TypeError);

    expect(guardada?.dados).toEqual(FILA);
    expect(deveApresentarIndisponibilidade(guardada !== null, depois.error)).toBe(
      false,
    );
    expect(deveAvisarSobreDadoGuardado(guardada !== null, depois.error)).toBe(true);
  });

  /**
   * Cenário 2, e o defeito que a primeira versão tinha.
   *
   * Uma fila vazia é um **resultado**: quer dizer "não há coluna pendente", que
   * é a melhor notícia que a Curadoria pode dar. Enquanto a autoridade era
   * `dados.length > 0`, a falha seguinte trocava essa boa notícia pelo painel de
   * indisponibilidade — a tela afirmando que o servidor não respondeu uma
   * pergunta que ele respondeu perfeitamente.
   */
  it("resultado anterior legitimamente vazio + falha: não é indisponibilidade", async () => {
    let respondendo = true;
    const vazio: typeof FILA = [];
    const obs = observador(client, async () => {
      if (!respondendo) throw falhouAntesDeResponder();
      return vazio;
    });

    let guardada = comoATelaVe<typeof FILA>(null, await ateAssentar(obs));
    expect(guardada?.dados).toEqual([]);
    expect(guardada).not.toBeNull();

    respondendo = false;
    const depois = await ateAssentar(obs);
    guardada = comoATelaVe(guardada, depois);

    // A prova do ponto: a contagem diz zero, e mesmo assim houve resposta.
    expect(guardada?.dados).toHaveLength(0);
    expect(deveApresentarIndisponibilidade(guardada !== null, depois.error)).toBe(
      false,
    );
    expect(deveAvisarSobreDadoGuardado(guardada !== null, depois.error)).toBe(true);
    // E o critério errado teria dado o contrário — é o que se está impedindo.
    expect(
      deveApresentarIndisponibilidade(
        (guardada?.dados.length ?? 0) > 0,
        depois.error,
      ),
    ).toBe(true);
  });

  /** Cenário 3: nunca houve resposta. Aí o painel é a única coisa que há. */
  it("primeira carga sem nenhum dado + tentativas esgotadas: indisponibilidade", async () => {
    const obs = observador(client, async () => {
      throw falhouAntesDeResponder();
    });

    const r = await ateAssentar(obs);
    const guardada = comoATelaVe<typeof FILA>(null, r);

    expect(guardada).toBeNull();
    expect(deveApresentarIndisponibilidade(false, r.error)).toBe(true);
    expect(deveAvisarSobreDadoGuardado(false, r.error)).toBe(false);
  });
});

describe("os gatilhos: foco e reconexão", () => {
  /**
   * O gatilho que fazia o erro "continuar dando".
   *
   * Não se testa que o refetch por foco falha bonito: testa-se que **ele não
   * acontece**. E com `PADRAO_DAS_CONSULTAS`, o que está sendo medido é o
   * default global — vale para as 104 consultas, não só para as convertidas.
   */
  it("troca de aba não dispara consulta nova, e portanto não repõe erro", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      return FILA;
    });

    // A assinatura fica viva: reassinar dispararia um refetch por montagem, que
    // entraria na conta como se fosse do foco.
    const cancelar = obs.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 60));
    const antesDoFoco = n;
    expect(antesDoFoco).toBe(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    cancelar();

    expect(n).toBe(antesDoFoco);
    expect(obs.getCurrentResult().data).toEqual(FILA);
  });

  /**
   * O controle do teste acima — e ele já ganhou o seu salário.
   *
   * Sem ele, "o foco não refez a chamada" passaria também num mundo em que o
   * foco nunca refaz chamada nenhuma. Foi assim que a primeira versão passou
   * verde sem medir nada: faltava `client.mount()`, e o `focusManager` não
   * chegava ao cache. Aqui a mesma sequência, com o padrão do React Query no
   * lugar da nossa opção, **precisa** refazer.
   */
  it("controle: com o padrão do React Query, o mesmo foco refaria", async () => {
    let n = 0;
    const obs = new QueryObserver<typeof FILA, Error, typeof FILA>(client, {
      queryKey: ["controle", "foco"],
      queryFn: async () => {
        n += 1;
        return FILA;
      },
      refetchOnWindowFocus: true,
    });

    const cancelar = obs.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(n).toBe(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    cancelar();

    expect(n).toBe(2);
  });

  /**
   * A contrapartida de ter desligado o foco.
   *
   * Com o navegador offline o React Query nem tenta (`fetchStatus: "paused"`),
   * que é o certo — tentar offline queima uma tentativa numa falha garantida —,
   * e a volta da conexão repõe a tela sozinha.
   */
  it("conexão cai e volta: pausa enquanto offline e refaz ao reconectar", async () => {
    let n = 0;
    let respondendo = true;
    const obs = observador(client, async () => {
      n += 1;
      if (!respondendo) throw falhouAntesDeResponder();
      return FILA;
    });

    await ateAssentar(obs);
    expect(n).toBe(1);

    const cancelar = obs.subscribe(() => {});

    respondendo = false;
    onlineManager.setOnline(false);
    await client.invalidateQueries({
      queryKey: ["curation", "queue", false],
      refetchType: "none",
    });
    void obs.refetch();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(obs.getCurrentResult().fetchStatus).toBe("paused");
    expect(obs.getCurrentResult().data).toEqual(FILA);

    respondendo = true;
    onlineManager.setOnline(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    cancelar();

    expect(n).toBeGreaterThan(1);
    expect(obs.getCurrentResult().error).toBeNull();
  });
});

describe("a instrumentação", () => {
  it("cada falha traz endpoint, horário, duração, ambiente, tentativa, online e origem", async () => {
    marcarOrigem(ENDPOINT, "montagem");
    const obs = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(obs);

    const primeira = falhasRegistradas()[0];
    expect(primeira.endpoint).toBe(ENDPOINT);
    expect(Date.parse(primeira.em)).not.toBeNaN();
    expect(primeira.duracaoMs).toBeGreaterThanOrEqual(0);
    expect(primeira.ambiente).toBeTruthy();
    expect(primeira.tentativa).toBe(1);
    expect(primeira.online).toBe(true);
    expect(primeira.origem).toBe("montagem");
  });

  /** `TypeError` de transporte é `SEM_RESPOSTA`; 5xx vazio é `API_AUSENTE`. */
  it("os dois estados de transporte chegam nomeados ao registro", async () => {
    const semResposta = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(semResposta);
    expect(falhasRegistradas().at(-1)?.estado).toBe("SEM_RESPOSTA");

    limparRegistro();
    const apiAusente = observador(
      client,
      async () => {
        throw roteadorSemNinguemAtras();
      },
      { chave: ["outra", "chave"] },
    );
    await ateAssentar(apiAusente);
    expect(falhasRegistradas().at(-1)?.estado).toBe("API_AUSENTE");
    expect(falhasRegistradas().at(-1)?.status).toBe(502);
  });

  it("as repetições herdam a origem de quem começou o ciclo", async () => {
    const obs = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(obs);
    limparRegistro();

    marcarOrigem(ENDPOINT, "manual");
    await obs.refetch();

    expect(falhasRegistradas().map((f) => f.origem)).toEqual(
      Array.from({ length: TENTATIVAS_AUTOMATICAS }, () => "manual"),
    );
  });

  /**
   * Cenário 10: desmontar e montar de novo sem corromper a classificação.
   *
   * A primeira versão deduzia `montagem` da primeira chamada que via para cada
   * endpoint, guardando os vistos num `Set` global. A dedução acertava uma vez e
   * errava em todas as seguintes: voltar para a tela produzia uma montagem
   * legítima registrada como `desconhecida`, justamente num dos momentos que
   * mais se quer distinguir. Agora `useConsultaResiliente` marca a origem em
   * toda montagem, e o `Set` deixou de existir.
   */
  it("montar, desmontar e montar de novo registra as duas montagens", async () => {
    // Primeira montagem do componente.
    marcarOrigem(ENDPOINT, "montagem");
    const primeira = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(primeira);
    expect(falhasRegistradas().at(-1)?.origem).toBe("montagem");

    limparRegistro();
    client.clear(); // desmontou: o cache daquela tela foi embora

    // Segunda montagem — mesma tela, mesmo endpoint, sessão contínua.
    marcarOrigem(ENDPOINT, "montagem");
    const segunda = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(segunda);

    expect(falhasRegistradas().at(-1)?.origem).toBe("montagem");
    expect(falhasRegistradas().map((f) => f.origem)).not.toContain("desconhecida");
  });

  it("a recuperação atribui a interrupção comparando os carimbos", async () => {
    let respondendo = true;
    const obs = observador(client, async () => {
      if (!respondendo) throw falhouAntesDeResponder();
      return FILA;
    });
    await ateAssentar(obs);
    // O carimbo da carga inicial é lido fora do caminho crítico; a asserção
    // seguinte espera por ele.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(falhasRegistradas()).toHaveLength(0);

    respondendo = false;
    await ateAssentar(obs);
    expect(falhasRegistradas().length).toBeGreaterThan(0);

    respondendo = true;
    await obs.refetch();
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Mesmo processo dos dois lados: ninguém caiu; caiu o caminho.
    expect(falhasRegistradas()[0].desfecho?.interrupcao).toBe("REDE");
  });

  it("classificarInterrupcao separa cold start, deploy, rede e queda local", () => {
    const base = CARIMBO;
    const outroProcesso: Carimbo = { ...base, startedAt: "2026-08-19T15:00:00.000Z" };
    const outroBuild: Carimbo = {
      revision: "def5678",
      builtAt: "2026-08-19T14:00:00.000Z",
      startedAt: "2026-08-19T15:00:00.000Z",
    };

    expect(classificarInterrupcao(base, outroProcesso, true)).toBe("COLD_START");
    expect(classificarInterrupcao(base, outroBuild, true)).toBe("DEPLOY");
    expect(classificarInterrupcao(base, base, true)).toBe("REDE");
    expect(classificarInterrupcao(base, outroProcesso, false)).toBe("QUEDA_LOCAL");
    expect(classificarInterrupcao(null, base, true)).toBe("INDETERMINADA");
  });
});

describe("o diagnóstico não atrasa o produto", () => {
  /**
   * Cenário 9, e a correção de um defeito que a revisão anterior encontrou.
   *
   * A primeira versão fazia `await carimbo()` entre ter o dado em mãos e
   * devolvê-lo. O efeito é o oposto do que este módulo existe para fazer: toda
   * carga bem-sucedida esperava uma segunda requisição antes de a tela receber o
   * que já estava pronto. E atrasava pior justamente onde dói, porque a partida
   * a frio que se quer diagnosticar é o momento em que o `/build` também
   * responde devagar.
   *
   * Aqui o `/build` demora dez segundos — mais do que o teste inteiro. Se
   * estivesse no caminho crítico, esta asserção estouraria o `ateAssentar`.
   */
  it("/api/build lento não segura o dado principal", async () => {
    let carimboResolvido = false;
    const obs = observador(client, async () => FILA, {
      carimbo: () =>
        new Promise<Carimbo>((resolve) => {
          setTimeout(() => {
            carimboResolvido = true;
            resolve(CARIMBO);
          }, 10_000);
        }),
    });

    const comecou = Date.now();
    const r = await ateAssentar(obs, { limiteMs: 2_000 });
    const levou = Date.now() - comecou;

    expect(r.data).toEqual(FILA);
    expect(levou).toBeLessThan(1_000);
    // E o carimbo de fato ainda não chegou — a prova de que não se esperou.
    expect(carimboResolvido).toBe(false);
  });

  it("/api/build falhando não derruba a chamada que deu certo", async () => {
    const obs = observador(client, async () => FILA, {
      carimbo: async () => {
        throw new Error("/build fora do ar");
      },
    });

    const r = await ateAssentar(obs);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(r.data).toEqual(FILA);
    expect(r.error).toBeNull();
  });
});
