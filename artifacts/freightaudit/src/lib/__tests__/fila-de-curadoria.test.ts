import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryObserver,
  focusManager,
  onlineManager,
  type QueryObserverResult,
} from "@tanstack/react-query";

import { ApiError } from "@/lib/api";
import { chamadaResiliente } from "@/lib/chamada-resiliente";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";
import {
  deveApresentarIndisponibilidade,
  preservarUltimoValido,
  TENTATIVAS_AUTOMATICAS,
} from "@/lib/resiliencia";
import {
  classificarInterrupcao,
  falhasRegistradas,
  limparRegistro,
  marcarOrigem,
  type Carimbo,
} from "@/lib/registro-de-falhas";

/**
 * A fila de curadoria atravessando as falhas que ela tem de atravessar.
 *
 * Estes seis casos são o contrato desta correção, e nenhum deles é reproduzível
 * contra um servidor de verdade: "a conexão cai e volta" não se agenda, e
 * "a API fica inacessível para sempre" não se pede a um ambiente compartilhado.
 * O que os torna executáveis é `chamadaResiliente` aceitar o `buscar` de fora
 * — e o que os torna **verdadeiros** é ser o objeto de opções da tela que roda
 * aqui, e não uma reescrita da política dentro do teste.
 *
 * Roda-se `QueryObserver` direto, sem React: o que se afirma é comportamento de
 * query — quantas tentativas, o que sobra em `data`, quando `error` aparece —,
 * e montar componente para isso acrescentaria um DOM sem acrescentar
 * uma asserção. É a mesma linha do `vitest.config.ts`: aqui se testa lógica.
 */

const ENDPOINT = "/curation/queue";

const CARIMBO: Carimbo = {
  revision: "abc1234",
  builtAt: "2026-08-19T12:00:00.000Z",
  startedAt: "2026-08-19T12:00:05.000Z",
};

/** A fila como o servidor a manda — dois itens bastam para reconhecê-la. */
const FILA = [{ code: "peso_bruto" }, { code: "ipva_mensal" }];

/** O `TypeError` com que o navegador rejeita um `fetch` que não completou. */
const falhouAntesDeResponder = () => new TypeError("Failed to fetch");

/** O 500 desta API, já classificado como a rota o classificaria. */
const respondeu500 = () =>
  new ApiError("o servidor respondeu 500.", 500);

/** O 502 de corpo vazio do roteador — a API fora do ar, de verdade. */
const roteadorSemNinguemAtras = () =>
  new ErroDeTransporte(
    diagnosticarTransporte({ status: 502, corpoVazio: true }),
  );

/**
 * Observar uma query até ela parar de mexer.
 *
 * Espera o `fetchStatus` voltar a `idle`, que é o único sinal confiável de que
 * as tentativas acabaram: `isError` sozinho chega antes, entre uma repetição e
 * a seguinte, e um teste que decidisse por ele afirmaria o contrário do que
 * quer afirmar.
 */
async function ateAssentar<T>(
  observer: QueryObserver<T, Error, T>,
  opcoes: { limiteMs?: number } = {},
): Promise<QueryObserverResult<T, Error>> {
  const limite = opcoes.limiteMs ?? 5_000;
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

function observador<T>(
  client: QueryClient,
  buscar: () => Promise<T>,
  chave: unknown[] = ["curation", "queue", false],
) {
  return new QueryObserver<T, Error, T>(client, {
    queryKey: chave,
    ...chamadaResiliente<T>({
      endpoint: ENDPOINT,
      buscar,
      // Sem ir à rede: o carimbo é o que o `/api/build` responderia.
      carimbo: async () => CARIMBO,
    }),
  });
}

let client: QueryClient;

beforeEach(() => {
  limparRegistro();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  client = new QueryClient();
  /*
    `mount()` é o que liga o cliente ao `focusManager` e ao `onlineManager`.

    Sem ele os dois viram enfeite: `setFocused` e `setOnline` mudam o estado
    global e ninguém no cache escuta, então **nenhuma** query refaz por foco ou
    por reconexão. Um teste de "o foco não refaz" ficaria verde num ambiente em
    que foco nunca refaz nada — verde por não medir. Foi o teste de controle
    abaixo que denunciou isso, falhando quando deveria passar.
  */
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

describe("a política que a fila usa", () => {
  /**
   * O caso mais comum de todos, e o que dava o painel amarelo.
   *
   * Uma chamada que falha e a seguinte que responde é o soluço de rede
   * inteiro — a interrupção durou menos que a espera do primeiro degrau. A
   * tela não pode ter contado nada a ninguém.
   */
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
    // A regra da tela, com os mesmos valores que ela usaria.
    expect(deveApresentarIndisponibilidade((r.data ?? []).length > 0, r.error)).toBe(
      false,
    );
  });

  /**
   * O gatilho que fazia o erro "continuar dando".
   *
   * Não se testa que o refetch por foco falha bonito: testa-se que **ele não
   * acontece**. Enquanto acontecia, voltar para a aba num momento ruim
   * repunha o painel sem ninguém ter pedido nada, e quem via lia como o
   * produto quebrando de novo.
   */
  it("falha durante window focus: o foco não refaz a chamada", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      return FILA;
    });

    /*
      A assinatura fica viva o tempo todo. Assinar de novo depois de soltar
      dispara um refetch por montagem (`refetchOnMount`, com `staleTime` zero) —
      e esse refetch entraria na conta como se fosse do foco, fazendo o teste
      acusar um gatilho que não é o que está sendo medido. Foi o que ele fez na
      primeira escrita.
    */
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
   * O controle do teste acima.
   *
   * Sem ele, "o foco não refez a chamada" passaria também num mundo em que o
   * foco nunca refaz chamada nenhuma — se o `focusManager` fosse inerte fora do
   * navegador, por exemplo, o teste ficaria verde sem medir nada. Aqui a mesma
   * sequência, com o padrão do React Query no lugar da nossa opção, **precisa**
   * refazer. É a diferença entre as duas que prova o ponto.
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
   * A conexão cai e volta — e é a volta que repõe a tela, sozinha.
   *
   * `refetchOnReconnect` é a contrapartida de ter desligado o foco: sem ele a
   * tela ficaria parada no dado velho até alguém reparar e clicar. Com o
   * navegador offline o React Query nem chega a tentar (`fetchStatus:
   * "paused"`), que é o comportamento certo: tentar offline é queimar uma
   * tentativa numa falha garantida.
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
    expect(obs.getCurrentResult().data).toEqual(FILA);
    expect(obs.getCurrentResult().error).toBeNull();
  });

  /**
   * 500 é transitório e por isso é repetido — mas não para sempre.
   *
   * O 500 sem `code` é a única falha de status que este repositório considera
   * passageira: as classificadas (`SCHEMA_AUSENTE` e companhia) respondem igual
   * na quarta tentativa, e repeti-las só atrasa o aviso.
   */
  it("API responde 500: repete até o limite e então declara indisponível", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      throw respondeu500();
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(TENTATIVAS_AUTOMATICAS);
    expect(r.error).toBeInstanceOf(ApiError);
    expect(deveApresentarIndisponibilidade((r.data ?? []).length > 0, r.error)).toBe(
      true,
    );
  });

  /**
   * A API inacessível de verdade — aí o painel é o certo, e precisa aparecer.
   *
   * Esta correção não pode ter comprado o silêncio: uma indisponibilidade real
   * continua chegando à tela, e chega **depois** de as tentativas esgotarem,
   * não antes. É o outro lado do contrato.
   */
  it("API totalmente inacessível: três tentativas, e aí sim indisponibilidade", async () => {
    let n = 0;
    const obs = observador(client, async () => {
      n += 1;
      throw roteadorSemNinguemAtras();
    });

    const r = await ateAssentar(obs);

    expect(n).toBe(TENTATIVAS_AUTOMATICAS);
    expect(r.error).toBeInstanceOf(ErroDeTransporte);
    expect((r.error as ErroDeTransporte).diagnostico.estado).toBe("API_AUSENTE");
    expect(deveApresentarIndisponibilidade(false, r.error)).toBe(true);
    // E o registro guardou as três, com a tentativa numerada de 1 a 3.
    expect(falhasRegistradas().map((f) => f.tentativa)).toEqual([1, 2, 3]);
  });

  /**
   * O ponto do item 3, e o mais fácil de perder numa refatoração.
   *
   * A fila carregada continua em tela mesmo depois de um ciclo inteiro de
   * falhas esgotar — inclusive quando a chave muda, que é o caso em que o
   * React Query esvaziaria `data` sem `keepPreviousData`. Com dado em tela, a
   * regra da tela devolve "não é indisponibilidade", e o que aparece é a tira
   * de rodapé.
   */
  it("dados anteriores permanecem visíveis durante falha transitória", async () => {
    let respondendo = true;
    const buscar = async () => {
      if (!respondendo) throw falhouAntesDeResponder();
      return FILA;
    };

    const obs = observador(client, buscar, ["curation", "queue", false]);
    const carregado = await ateAssentar(obs);
    expect(carregado.data).toEqual(FILA);

    /*
      A troca de aba muda a chave **do mesmo `useQuery`**, e é isso que o
      `setOptions` reproduz. Um segundo observador seria outro teste: recém
      nascido, ele não tem resultado anterior para preservar.

      E a composição é a da tela, não uma asserção sobre `result.data`. Foi
      medindo `result.data` que este teste reprovou a primeira versão — com
      razão: `keepPreviousData` solta o dado no instante do erro, e sozinho ele
      **não** cumpre o item 3. O que a tela faz, e o que se afirma aqui, é
      dobrar cada resultado emitido por `preservarUltimoValido`, do mesmo jeito
      que o `ref` da Curadoria dobra.
    */
    respondendo = false;
    let emTela: typeof FILA | undefined = carregado.data;
    obs.setOptions({
      queryKey: ["curation", "queue", true],
      ...chamadaResiliente<typeof FILA>({
        endpoint: ENDPOINT,
        buscar,
        carimbo: async () => CARIMBO,
      }),
    });
    const cancelar = obs.subscribe((r) => {
      emTela = preservarUltimoValido(emTela, r.data);
    });
    const depois = await ateAssentar(obs);
    emTela = preservarUltimoValido(emTela, depois.data);
    cancelar();

    // O React Query soltou o dado — este é o limite, e ele é real.
    expect(depois.data).toBeUndefined();
    expect(depois.error).toBeInstanceOf(TypeError);

    // A tela não soltou: a fila continua lá, e por isso não há indisponibilidade.
    expect(emTela).toEqual(FILA);
    expect(
      deveApresentarIndisponibilidade((emTela ?? []).length > 0, depois.error),
    ).toBe(false);
  });
});

describe("o que o registro guardou", () => {
  /**
   * Sem estes campos, "falhou às 14h03" não se interpreta — e era só isso que
   * havia. Ver `registro-de-falhas.ts`.
   */
  it("cada falha traz endpoint, horário, duração, ambiente, tentativa, online e origem", async () => {
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
    expect(primeira.estado).toBe("SEM_RESPOSTA");
    // Primeira chamada da sessão para este endpoint: a origem se deduz.
    expect(primeira.origem).toBe("montagem");
  });

  /** A origem marcada vale para o ciclo inteiro, e não só para a tentativa 1. */
  it("as repetições herdam a origem de quem começou o ciclo", async () => {
    const obs = observador(client, async () => {
      throw falhouAntesDeResponder();
    });
    await ateAssentar(obs);
    limparRegistro();

    marcarOrigem(ENDPOINT, "manual");
    await obs.refetch();

    const origens = falhasRegistradas().map((f) => f.origem);
    expect(origens).toEqual(["manual", "manual", "manual"]);
  });

  /**
   * A pergunta que a instrumentação existe para responder.
   *
   * Falhou, voltou, e o servidor do outro lado é o mesmo processo do começo:
   * ninguém caiu, e o que caiu foi o caminho. É o que distingue uma falha de
   * rede de uma partida a frio sem ter de adivinhar por horário.
   */
  it("a recuperação atribui a interrupção comparando os carimbos", async () => {
    /*
      A sequência é a real, e ela começa dando certo: a tela carrega, o carimbo
      daquele momento fica de base, e só então algo falha. Sem a carga inicial
      não há com o que comparar e o veredito é `INDETERMINADA` — que foi o que
      este teste devolveu enquanto começava pela falha, e é a resposta certa:
      sem base, a honesta é não saber.
    */
    let respondendo = true;
    const obs = observador(client, async () => {
      if (!respondendo) throw falhouAntesDeResponder();
      return FILA;
    });
    await ateAssentar(obs);
    expect(falhasRegistradas()).toHaveLength(0);

    respondendo = false;
    await ateAssentar(obs);
    expect(falhasRegistradas().length).toBeGreaterThan(0);

    respondendo = true;
    await obs.refetch();

    const [falha] = falhasRegistradas();
    // Mesmo processo dos dois lados: ninguém caiu; caiu o caminho.
    expect(falha.desfecho?.interrupcao).toBe("REDE");
    expect(falha.desfecho?.carimbo).toEqual(CARIMBO);
  });

  /**
   * As quatro leituras possíveis, exercitadas na função que decide.
   *
   * É pelo par de carimbos que "cold start" deixa de ser hipótese e vira
   * observação: mesmo build com processo novo só acontece quando o servidor foi
   * recolhido e subiu de novo. A ordem das perguntas importa — todo deploy
   * também troca o processo, e perguntar pelo processo primeiro classificaria
   * publicação como partida a frio.
   */
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
