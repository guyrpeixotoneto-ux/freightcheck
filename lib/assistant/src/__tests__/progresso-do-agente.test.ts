/**
 * ETAPA 3 — a tela deixa de ficar parada durante a investigação.
 *
 * **O que se mede aqui.** Não a latência do modelo, que não depende de nós, mas
 * o que chega à tela **enquanto** ela acontece. A bateria real mediu 28–30 s por
 * pergunta no caminho do agente contra 8–13 s no do planejador, e nesses 30 s a
 * tela recebia um único tipo de evento — o nome da ferramenta consultada. Entre
 * o resultado de uma consulta e o pedido da próxima, e durante a rodada inteira
 * que redige, não chegava nada.
 *
 * **Três canais, e o teste confere os três em ordem.** O roteiro do cliente é
 * fixo, então a sequência de eventos é determinística: é possível afirmar que
 * nenhum trecho da investigação fica sem sinal, e não só que "houve eventos".
 *
 * **O que este arquivo não prova, e não tenta.** Que a resposta é boa. A escolha
 * das ferramentas é do modelo e simulá-la aqui seria falsificar a prova que só a
 * bateria contra a API de verdade pode dar. O que se prova é a mecânica em volta
 * dela — que é justamente o que o relatório de trajetória não isola.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Registro, type Ferramenta } from "../ferramentas/registro";

const criar = vi.hoisted(() => vi.fn());

vi.mock("../llm", async (original) => {
  const real = await original<typeof import("../llm")>();
  return {
    ...real,
    disponivel: () => true,
    obterCliente: () => ({ beta: { messages: { create: criar } } }),
  };
});

const { investigar } = await import("../agente");

const texto = (t: string) => ({ type: "text" as const, text: t });
const usa = (id: string, name: string, input: unknown) => ({
  type: "tool_use" as const,
  id,
  name,
  input,
});
const resposta = (content: unknown[], stop: string) => ({
  content,
  stop_reason: stop,
  usage: { input_tokens: 100, output_tokens: 20 },
});

function registroDeTeste(): Registro {
  const alteracoes: Ferramenta = {
    nome: "alteracoes",
    descricao: "as alterações de uma vigência",
    argumentos: {
      nivel: { tipo: "texto", descricao: "…", opcoes: ["total", "grupos"] as const, obrigatorio: true },
    },
    executar: async () => ({
      conteudo: { totais: { changes: 267 } },
      evidencias: [
        {
          ferramenta: "alteracoes:total",
          titulo: "t",
          fatos: [],
          numeros: [267],
          origem: "teste",
        },
      ],
    }),
  };
  const reg = new Registro();
  reg.registrar(alteracoes);
  return reg;
}

/** Um turno completo, colhendo tudo o que chegaria à tela, na ordem. */
async function investigarColhendo(roteiro: unknown[]) {
  criar.mockReset();
  for (const r of roteiro) criar.mockResolvedValueOnce(r);

  const eventos: { canal: string; valor: string }[] = [];
  const investigacao = await investigar({
    pergunta: "investigue por que o impacto caiu",
    registro: registroDeTeste(),
    ferramentas: { db: {} as never, recorte: {} },
    aoRodada: (r) => eventos.push({ canal: "rodada", valor: String(r) }),
    aoConsultar: (nome) => eventos.push({ canal: "consulta", valor: nome }),
    aoNarrar: (t) => eventos.push({ canal: "narracao", valor: t }),
  });
  return { eventos, investigacao };
}

describe("Etapa 3 — o progresso da investigação chega à tela", () => {
  beforeEach(() => criar.mockReset());

  it("cada rodada é anunciada antes de qualquer consulta dela", async () => {
    const { eventos, investigacao } = await investigarColhendo([
      resposta([texto("Vou ver o total."), usa("t1", "alteracoes", { nivel: "total" })], "tool_use"),
      resposta([texto("Agora os grupos."), usa("t2", "alteracoes", { nivel: "grupos" })], "tool_use"),
      resposta([texto("O impacto caiu por causa do FINAME.")], "end_turn"),
    ]);

    expect(investigacao.rodadas).toBe(3);
    expect(investigacao.parou).toBe("RESPONDEU");

    /*
      A asserção é sobre a **ordem**, e não sobre a contagem: o que tira a tela
      do congelamento é o sinal chegar antes da espera, não depois dela.
    */
    expect(eventos.map((e) => `${e.canal}`)).toEqual([
      "rodada",
      "narracao",
      "consulta",
      "rodada",
      "narracao",
      "consulta",
      "rodada",
    ]);
    expect(eventos[0]!.valor).toBe("1");
    expect(eventos[6]!.valor).toBe("3");
  });

  it("nenhum intervalo da investigação fica sem sinal", async () => {
    const { eventos } = await investigarColhendo([
      resposta([usa("t1", "alteracoes", { nivel: "total" })], "tool_use"),
      resposta([usa("t2", "alteracoes", { nivel: "grupos" })], "tool_use"),
      resposta([texto("Pronto.")], "end_turn"),
    ]);
    /*
      Sem narração — o modelo pediu a ferramenta sem escrever nada antes —, o
      sinal de rodada é o único que resta, e ele tem de estar lá. Este é o caso
      em que a tela ficava mais tempo parada.
    */
    expect(eventos.map((e) => e.canal)).toEqual([
      "rodada",
      "consulta",
      "rodada",
      "consulta",
      "rodada",
    ]);
  });

  it("a narração de uma rodada intermediária não entra no texto final", async () => {
    const { investigacao } = await investigarColhendo([
      resposta([texto("Deixa eu olhar os grupos."), usa("t1", "alteracoes", { nivel: "total" })], "tool_use"),
      resposta([texto("A queda vem do FINAME.")], "end_turn"),
    ]);
    expect(investigacao.texto).toBe("A queda vem do FINAME.");
    expect(investigacao.texto).not.toContain("Deixa eu olhar");
  });

  it("a narração chega inteira ao canal de progresso", async () => {
    const { eventos } = await investigarColhendo([
      resposta([texto("Deixa eu olhar os grupos."), usa("t1", "alteracoes", { nivel: "total" })], "tool_use"),
      resposta([texto("Pronto.")], "end_turn"),
    ]);
    const narracao = eventos.find((e) => e.canal === "narracao");
    expect(narracao?.valor).toBe("Deixa eu olhar os grupos.");
  });

  it("um turno sem chamador de progresso não quebra — os canais são opcionais", async () => {
    criar.mockReset();
    criar.mockResolvedValueOnce(resposta([texto("Resposta direta.")], "end_turn"));
    const investigacao = await investigar({
      pergunta: "o que mudou?",
      registro: registroDeTeste(),
      ferramentas: { db: {} as never, recorte: {} },
    });
    expect(investigacao.texto).toBe("Resposta direta.");
  });

  it("o teto de rodadas continua anunciando cada uma antes de parar", async () => {
    criar.mockReset();
    for (let i = 0; i < 10; i++) {
      criar.mockResolvedValueOnce(
        resposta([usa(`t${i}`, "alteracoes", { nivel: "total" })], "tool_use"),
      );
    }
    const rodadas: number[] = [];
    const investigacao = await investigar({
      pergunta: "investigue",
      registro: registroDeTeste(),
      ferramentas: { db: {} as never, recorte: {} },
      aoRodada: (r) => rodadas.push(r),
    });
    expect(investigacao.parou).toBe("TETO_DE_RODADAS");
    // Seis rodadas, seis anúncios: a tela acompanha até o laço desistir.
    expect(rodadas).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
