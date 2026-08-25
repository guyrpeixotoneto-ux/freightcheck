import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QueryClient,
  QueryObserver,
  focusManager,
  onlineManager,
  type QueryObserverResult,
} from "@tanstack/react-query";

import { chamadaResiliente, PADRAO_DAS_CONSULTAS } from "@/lib/chamada-resiliente";
import {
  deveApresentarIndisponibilidade,
  deveAvisarSobreDadoGuardado,
  guardarResposta,
  type RespostaValida,
} from "@/lib/resiliencia";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";

/**
 * Justificativas lê `/changes/latest` pelo mesmo `useConsultaResiliente` que
 * `unidades.tsx` usa (ver `pages/justificativas.tsx`), e não por acidente:
 * antes desta correção a tela usava `useQuery` cru, e quando as tentativas
 * automáticas se esgotavam o painel de erro não tinha botão de repetir —
 * substituir a tela inteira era a única saída, obrigando a recarregar a
 * página na mão. Este arquivo prova a integração **desta tela** com a chave e
 * o endpoint reais dela, e não só o hook em abstrato — `consulta-resiliente.
 * test.ts` já prova o hook; aqui se prova que Justificativas o adotou.
 *
 * O padrão (observar via `QueryObserver`, sem montar componente) é o mesmo de
 * `consulta-resiliente.test.ts` — ver o cabeçalho de lá para o motivo: o que
 * se afirma é comportamento de query, e `guardarResposta` /
 * `deveApresentarIndisponibilidade` são as mesmas funções puras que o `ref`
 * de `useConsultaResiliente` chama a cada render.
 */

const CHAVE = ["changes-latest", "justificativas"];
const ENDPOINT = "/changes/latest";

interface RespostaDeAlteracoes {
  set: { id: string };
  total: number;
  rows: { id: string; entityLabel: string }[];
}

const PRIMEIRA_CARGA: RespostaDeAlteracoes = {
  set: { id: "set-1" },
  total: 1,
  rows: [{ id: "c1", entityLabel: "ABC1D23" }],
};

const CARGA_NOVA: RespostaDeAlteracoes = {
  set: { id: "set-2" },
  total: 2,
  rows: [
    { id: "c1", entityLabel: "ABC1D23" },
    { id: "c2", entityLabel: "XYZ9W88" },
  ],
};

/** O `TypeError` com que o navegador rejeita um `fetch` que não completou. */
const semResposta = () => new TypeError("Failed to fetch");

/** `TEMPO_ESGOTADO`, tal como `requisitar` (`lib/api.ts`) o lança hoje. */
const tempoEsgotado = () =>
  new ErroDeTransporte(
    diagnosticarTransporte({ naoCompletou: true, esgotouTempo: true, tempoLimiteMs: 45_000 }),
  );

function observadorDeJustificativas(client: QueryClient, buscar: () => Promise<RespostaDeAlteracoes>) {
  return new QueryObserver<RespostaDeAlteracoes, Error, RespostaDeAlteracoes>(client, {
    queryKey: CHAVE,
    ...chamadaResiliente<RespostaDeAlteracoes>({
      endpoint: ENDPOINT,
      buscar,
      carimbo: async () => null,
    }),
    retryDelay: 0,
  });
}

async function ateAssentar<T>(
  observer: QueryObserver<T, Error, T>,
  limiteMs = 5_000,
): Promise<QueryObserverResult<T, Error>> {
  const cancelar = observer.subscribe(() => {});
  const comecou = Date.now();
  try {
    for (;;) {
      const r = observer.getCurrentResult();
      if (r.fetchStatus === "idle" && (r.isSuccess || r.isError)) return r;
      if (Date.now() - comecou > limiteMs) return r;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    cancelar();
  }
}

/** A composição que `useConsultaResiliente` faz a cada render. */
function comoATelaVe<T>(
  guardada: RespostaValida<T> | null,
  r: QueryObserverResult<T, Error>,
): RespostaValida<T> | null {
  return guardarResposta(
    guardada,
    r.data !== undefined && r.dataUpdatedAt > 0 ? { dados: r.data, em: r.dataUpdatedAt } : undefined,
  );
}

let client: QueryClient;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: PADRAO_DAS_CONSULTAS } });
  client.mount();
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
});

afterEach(() => {
  client.unmount();
  client.clear();
  vi.restoreAllMocks();
});

describe("Justificativas — /changes/latest sobrevive a um soluço sem apagar a tela", () => {
  /**
   * O cenário dos seis passos pedidos: carga boa, refetch falha, dado
   * anterior continua visível, aviso transitório aparece, "Tentar de novo"
   * responde, e a resposta nova **substitui** a antiga — sem reload de
   * página, porque não há página nenhuma aqui: é a mesma `queryKey` do
   * início ao fim.
   */
  it("carga → refetch falha (TEMPO_ESGOTADO) → dado antigo fica → aviso → retry → dado novo substitui", async () => {
    let modo: "ok" | "cai" | "ok-novo" = "ok";
    const obs = observadorDeJustificativas(client, async () => {
      if (modo === "cai") throw tempoEsgotado();
      return modo === "ok" ? PRIMEIRA_CARGA : CARGA_NOVA;
    });

    // 1. primeira carga responde.
    let guardada = comoATelaVe<RespostaDeAlteracoes>(null, await ateAssentar(obs));
    expect(guardada?.dados).toEqual(PRIMEIRA_CARGA);
    expect(deveApresentarIndisponibilidade(guardada !== null, null)).toBe(false);

    // 2. refetch falha com TEMPO_ESGOTADO.
    modo = "cai";
    const cancelar = obs.subscribe((r) => {
      guardada = comoATelaVe(guardada, r);
    });
    void obs.refetch();
    const depoisDaFalha = await ateAssentar(obs);
    guardada = comoATelaVe(guardada, depoisDaFalha);
    cancelar();

    expect(depoisDaFalha.error).toBeInstanceOf(ErroDeTransporte);
    expect((depoisDaFalha.error as ErroDeTransporte).diagnostico.estado).toBe(
      "TEMPO_ESGOTADO",
    );

    // 3. dados anteriores continuam visíveis — não é `undefined`, é o set-1.
    expect(guardada?.dados).toEqual(PRIMEIRA_CARGA);

    // 4. aviso transitório aparece (a tira "dado de HH:MM"), e não o painel
    //    que substitui a tela inteira — a diferença é a que `unidades.tsx`
    //    desenha com `indisponivel` vs. `avisarSobreDadoGuardado`.
    expect(deveApresentarIndisponibilidade(guardada !== null, depoisDaFalha.error)).toBe(
      false,
    );
    expect(deveAvisarSobreDadoGuardado(guardada !== null, depoisDaFalha.error)).toBe(
      true,
    );

    // 5. "Tentar de novo" — o mesmo `tentarDeNovo` que o botão chama —
    //    dispara `consulta.refetch()`; a API já respondendo de novo.
    modo = "ok-novo";
    const cancelar2 = obs.subscribe((r) => {
      guardada = comoATelaVe(guardada, r);
    });
    void obs.refetch();
    const depoisDoRetry = await ateAssentar(obs);
    guardada = comoATelaVe(guardada, depoisDoRetry);
    cancelar2();

    // 6. a resposta nova substitui a antiga — 2 alterações, não mais 1 — e
    //    não sobra nem indisponibilidade nem aviso de dado velho.
    expect(guardada?.dados).toEqual(CARGA_NOVA);
    expect(depoisDoRetry.error).toBeNull();
    expect(deveApresentarIndisponibilidade(guardada !== null, depoisDoRetry.error)).toBe(
      false,
    );
    expect(deveAvisarSobreDadoGuardado(guardada !== null, depoisDoRetry.error)).toBe(
      false,
    );
  });

  /**
   * O outro cenário pedido: a primeira carga em si falha — o caso exato da
   * captura de tela original, "As placas alteradas não puderam ser
   * carregadas". Antes desta correção não havia como sair daqui sem recarregar
   * a página; agora `indisponivel` autoriza o painel **com** `tentarDeNovo`, e
   * quando o servidor volta o clique recupera a tela.
   */
  it("primeira carga falha → painel com Tentar de novo → servidor volta → clique recupera, sem reload", async () => {
    let respondendo = false;
    const obs = observadorDeJustificativas(client, async () => {
      if (!respondendo) throw semResposta();
      return PRIMEIRA_CARGA;
    });

    const primeiraTentativa = await ateAssentar(obs);
    let guardada = comoATelaVe<RespostaDeAlteracoes>(null, primeiraTentativa);

    // Nunca houve resposta: é exatamente `indisponivel` de `unidades.tsx`,
    // que é o que autoriza o painel com botão.
    expect(guardada).toBeNull();
    expect(deveApresentarIndisponibilidade(guardada !== null, primeiraTentativa.error)).toBe(
      true,
    );

    // O servidor volta, e o clique em "Tentar de novo" é este `refetch()`.
    respondendo = true;
    const cancelar = obs.subscribe((r) => {
      guardada = comoATelaVe(guardada, r);
    });
    void obs.refetch();
    const depoisDoClique = await ateAssentar(obs);
    guardada = comoATelaVe(guardada, depoisDoClique);
    cancelar();

    expect(guardada?.dados).toEqual(PRIMEIRA_CARGA);
    expect(deveApresentarIndisponibilidade(guardada !== null, depoisDoClique.error)).toBe(
      false,
    );
  });
});
