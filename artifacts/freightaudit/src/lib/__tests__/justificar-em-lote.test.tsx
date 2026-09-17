// @vitest-environment jsdom
//
// O ESTADO DO MODO EM LOTE — a regra que protege quem clica.
//
// O caso que este arquivo prende tem nome e é o pior desfecho possível desta
// funcionalidade: alguém seleciona "todos os 206 resultados", troca a aba (ou
// digita uma placa na busca, ou muda a variável), e confirma achando que está
// gravando o que via antes. Herdar a seleção global para o recorte novo
// aplicaria uma decisão a um conjunto que quem decidiu nunca viu.
//
// Aqui se prova que ela **cai**, que o aviso aparece, e que a seleção a dedo
// sobrevive **recortada** ao que continua no universo — marcar cinco placas,
// buscar por uma delas e justificar não pode gravar nas quatro que saíram da
// tela.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AlteracaoDoLote,
  EscopoDoLote,
} from "@workspace/comparison/justificativa-em-lote";

import { useJustificarEmLote } from "@/lib/justificar-em-lote";
import type { Justificativa } from "@/lib/justificativas";

vi.mock("@/lib/auth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: "u1", name: "Chefe", email: "chefe@x.com", role: "OPERADOR" },
  }),
}));

const gravou: { path: string; corpo: Record<string, unknown> }[] = [];

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (path: string, init?: RequestInit) => {
    gravou.push({ path, corpo: JSON.parse(String(init?.body ?? "{}")) });
    return { resumo: { universo: 2, aplicadas: 2, preservadas: 0, sobrescritas: 0 } };
  }),
}));

afterEach(() => {
  gravou.length = 0;
});

const alteracao = (id: number, over: Partial<AlteracaoDoLote> = {}): AlteracaoDoLote => ({
  id,
  entityLabel: `PLACA${id}`,
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  base: "7210.00",
  comparada: "4145.26",
  ...over,
});

const FILTROS = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "ALTERADO",
  soNegativos: false,
};

/** O recorte que o hook monta a partir do par e dos filtros. */
const RECORTE: EscopoDoLote = {
  tipo: "FILTRO",
  rubrica: "ipva",
  base: "v1",
  comparada: "v2",
  filtros: FILTROS,
  semAlteracao: false,
};

/**
 * A "assinatura" dos testes é o que **de fato** muda o recorte: um filtro.
 *
 * O hook não recebe mais uma string de assinatura — ele a deriva dos filtros —,
 * e é o que estes testes exercitam: mexer na busca é mexer no universo, e é
 * disso que a regra da seleção global tem de dar conta.
 */
function montar(inicial: {
  alteracoes: AlteracaoDoLote[];
  assinatura: string;
  justificadaPor?: Map<number, Justificativa>;
}) {
  const envolver = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
  return renderHook(
    (props: { alteracoes: AlteracaoDoLote[]; assinatura: string }) =>
      useJustificarEmLote({
        changeSetId: "cs1",
        contexto: "comparação julho/2026 → agosto/2026",
        justificadaPor: inicial.justificadaPor ?? new Map(),
        alteracoesDoRecorte: props.alteracoes,
        rubrica: "ipva",
        base: "v1",
        comparada: "v2",
        filtros: { ...FILTROS, busca: props.assinatura },
        filtrosVazios: { ...FILTROS, estado: "TODAS" },
        semAlteracao: false,
      }),
    { wrapper: envolver, initialProps: { alteracoes: inicial.alteracoes, assinatura: inicial.assinatura } },
  );
}

const JUSTIFICATIVA = {
  formula: "IPVA = valor de nota × alíquota",
  regra: "Muda quando a alíquota do estado muda.",
  conforme: true,
  naoConformidade: null,
  motivoExcecao: null,
  responsavelAprovacao: null,
};

describe("a seleção de todos os resultados", () => {
  it("cai quando um filtro muda, e a barra diz que caiu", async () => {
    const { result, rerender } = montar({
      alteracoes: [alteracao(1), alteracao(2), alteracao(3)],
      assinatura: "aba=ALTERADO",
    });

    act(() => result.current.propsDaBarra.onTodosOsResultados());
    expect(result.current.propsDaBarra.todosOsResultados).toBe(true);
    expect(result.current.propsDaBarra.selecionadas).toBe(3);

    rerender({ alteracoes: [alteracao(4)], assinatura: "aba=CONFLITO" });

    await waitFor(() => {
      expect(result.current.propsDaBarra.todosOsResultados).toBe(false);
      expect(result.current.propsDaBarra.recorteMudou).toBe(true);
      expect(result.current.propsDaBarra.selecionadas).toBe(0);
    });
  });

  it("grava o recorte, e não a lista de ids", async () => {
    const { result } = montar({
      alteracoes: [alteracao(1), alteracao(2)],
      assinatura: "a",
    });
    act(() => result.current.propsDaBarra.onTodosOsResultados());
    await act(async () => {
      await result.current.propsDoDialogo.onConfirmar(JUSTIFICATIVA, false);
    });
    expect(gravou).toHaveLength(1);
    expect(gravou[0]!.path).toBe("/justificativas/lote");
    expect(gravou[0]!.corpo.escopo).toEqual({ ...RECORTE, filtros: { ...FILTROS, busca: "a" } });
  });

  it("tirar uma linha da seleção global a transforma numa lista", async () => {
    const { result } = montar({
      alteracoes: [alteracao(1), alteracao(2)],
      assinatura: "a",
    });
    act(() => result.current.propsDaBarra.onTodosOsResultados());
    act(() => result.current.selecao.onMarcar([2], false));
    expect(result.current.propsDaBarra.todosOsResultados).toBe(false);

    await act(async () => {
      await result.current.propsDoDialogo.onConfirmar(JUSTIFICATIVA, false);
    });
    expect(gravou[0]!.corpo.escopo).toEqual({ tipo: "SELECAO", changeIds: [1] });
  });

  it("cai inteira, e não recortada ao que sobrou do filtro novo", async () => {
    /*
      O caso medido no navegador: 206 resultados selecionados, uma busca por
      "RPG" depois, e 25 deles continuavam marcados. Ninguém escolheu aquelas
      25 — elas sobraram por acidente de filtro.
    */
    const { result, rerender } = montar({
      alteracoes: [alteracao(1), alteracao(2), alteracao(3)],
      assinatura: "busca=",
    });
    act(() => result.current.propsDaBarra.onTodosOsResultados());
    rerender({ alteracoes: [alteracao(2)], assinatura: "busca=PLACA2" });

    await waitFor(() => {
      expect(result.current.propsDaBarra.selecionadas).toBe(0);
      expect(result.current.propsDaBarra.recorteMudou).toBe(true);
    });
  });
});

describe("a seleção a dedo", () => {
  it("sobrevive à troca de filtro recortada ao que continua no universo", async () => {
    const { result, rerender } = montar({
      alteracoes: [alteracao(1), alteracao(2), alteracao(3)],
      assinatura: "busca=",
    });
    act(() => result.current.selecao.onMarcar([1, 2, 3], true));
    expect(result.current.propsDaBarra.selecionadas).toBe(3);

    rerender({ alteracoes: [alteracao(2)], assinatura: "busca=PLACA2" });

    await waitFor(() => expect(result.current.propsDaBarra.selecionadas).toBe(1));
    await act(async () => {
      await result.current.propsDoDialogo.onConfirmar(JUSTIFICATIVA, false);
    });
    expect(gravou[0]!.corpo.escopo).toEqual({ tipo: "SELECAO", changeIds: [2] });
  });

  it("não se apaga sozinha quando a consulta é relida sem mudar o recorte", () => {
    const { result, rerender } = montar({
      alteracoes: [alteracao(1), alteracao(2)],
      assinatura: "a",
    });
    act(() => result.current.selecao.onMarcar([1], true));
    /* Uma lista nova, com o mesmo conteúdo: é o que um `refetch` produz. */
    rerender({ alteracoes: [alteracao(1), alteracao(2)], assinatura: "a" });
    expect(result.current.propsDaBarra.selecionadas).toBe(1);
  });
});

describe("as alterações iguais", () => {
  it("são oferecidas quando o que está marcado tem um contexto só", () => {
    const { result } = montar({
      alteracoes: [
        alteracao(1),
        alteracao(2),
        alteracao(3, { comparada: "9000.00" }),
      ],
      assinatura: "a",
    });
    act(() => result.current.selecao.onMarcar([1], true));
    expect(result.current.propsDaBarra.iguais).toBe(2);

    act(() => result.current.propsDaBarra.onIguais());
    expect(result.current.propsDaBarra.selecionadas).toBe(2);
    /* Marcadas as duas, não há mais o que oferecer. */
    expect(result.current.propsDaBarra.iguais).toBe(0);
  });

  it("não são oferecidas com dois contextos marcados", () => {
    const { result } = montar({
      alteracoes: [alteracao(1), alteracao(2), alteracao(3, { comparada: "9000.00" })],
      assinatura: "a",
    });
    act(() => result.current.selecao.onMarcar([1, 3], true));
    expect(result.current.propsDaBarra.iguais).toBe(0);
  });
});

describe("o que já está justificado", () => {
  it("é contado, e fica fora do que o botão promete aplicar", () => {
    const gravada = {
      id: "j1",
      changeSetId: "cs1",
      changeId: 2,
      entityLabel: "PLACA2",
    } as Justificativa;
    const { result } = montar({
      alteracoes: [alteracao(1), alteracao(2)],
      assinatura: "a",
      justificadaPor: new Map([[2, gravada]]),
    });
    act(() => result.current.selecao.onMarcar([1, 2], true));
    expect(result.current.propsDoDialogo.resumo.total).toBe(2);
    expect(result.current.propsDoDialogo.resumo.jaJustificadas).toBe(1);
    expect(result.current.propsDoDialogo.aplicaveis).toBe(1);
  });

  it("um operador não recebe a porta de substituir", () => {
    const { result } = montar({ alteracoes: [alteracao(1)], assinatura: "a" });
    expect(result.current.propsDoDialogo.podeSobrescrever).toBe(false);
  });
});

describe("cancelar", () => {
  it("desliga o modo e esquece a seleção", () => {
    const { result } = montar({ alteracoes: [alteracao(1)], assinatura: "a" });
    act(() => result.current.abrirModo());
    act(() => result.current.selecao.onMarcar([1], true));
    expect(result.current.emLote).toBe(true);

    act(() => result.current.propsDaBarra.onCancelar());
    expect(result.current.emLote).toBe(false);
    expect(result.current.propsDaBarra.selecionadas).toBe(0);
  });
});
