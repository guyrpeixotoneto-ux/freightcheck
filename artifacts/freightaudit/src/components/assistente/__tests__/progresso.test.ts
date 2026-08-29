import { describe, expect, it } from "vitest";
import {
  avancar,
  frase,
  MACROETAPA_INICIAL,
  telaDoTurno,
  type Macroetapa,
} from "../progresso";

/**
 * O que estes testes protegem: o processo interno não chega à tela.
 *
 * A orquestração emite doze a vinte eventos por pergunta, e todos eles são
 * verdadeiros — rodada do agente, nome de ferramenta, decisão de o que
 * consultar, a frase que o modelo escreve antes de pedir a consulta. A tela
 * mostrava a lista inteira; o resultado era um log acima da resposta, que numa
 * aplicação de auditoria lê como defeito.
 *
 * A prova aqui é a da camada, não a do componente: o componente só renderiza o
 * que estas funções devolvem, então provar que elas nunca devolvem mais de um
 * status — e nunca devolvem texto de origem interna — é provar a tela.
 */

/** O roteiro real de "Onde tivemos maior perda?", como o servidor o emite. */
const ROTEIRO = [
  { nome: "interpretar", rotulo: "Analisando sua pergunta", ms: 1 },
  { nome: "book", rotulo: "Procurando no Book do Operador", ms: 2 },
  { nome: "planejar", rotulo: "Decidindo o que consultar", ms: 3 },
  { nome: "resolverContexto", rotulo: "Resolvendo unidade e canal", ms: 4 },
  { nome: "consultar", rotulo: "Consultando alteracoes", ms: 5 },
  { nome: "consultar", rotulo: "Consultando recortes", ms: 6 },
  { nome: "calcular", rotulo: "Calculando impacto", ms: 7 },
  { nome: "aprofundar", rotulo: "Descendo até a causa", ms: 8 },
  { nome: "rodada", rotulo: "Investigando", ms: 9 },
  { nome: "narracao", rotulo: "deixa eu ver os grupos de alteração", ms: 10 },
  { nome: "ferramenta", rotulo: "Consultando alteracoes", ms: 11 },
  { nome: "rodada", rotulo: "Investigando · rodada 2", ms: 12 },
  { nome: "rodada", rotulo: "Investigando · rodada 3", ms: 13 },
];

/** O que a tela mostraria, quadro a quadro, para um roteiro de eventos. */
function quadros(eventos: { nome: string }[]) {
  const vistos: { titulo: string; detalhe: string | null }[] = [];
  let macroetapa: Macroetapa = MACROETAPA_INICIAL;
  vistos.push(frase(macroetapa));
  for (const evento of eventos) {
    macroetapa = avancar(macroetapa, evento);
    vistos.push(frase(macroetapa));
  }
  return vistos;
}

describe("a camada de apresentação do progresso", () => {
  it("reduz muitos eventos internos a um punhado de frases, sem acumular", () => {
    const distintos = [...new Set(quadros(ROTEIRO).map((q) => q.titulo))];

    /*
      Treze eventos internos, três frases possíveis — e a asserção que importa
      não é a contagem, é que nenhuma delas é a lista das outras.
    */
    expect(ROTEIRO.length).toBeGreaterThan(distintos.length);
    expect(distintos).toEqual([
      "Analisando sua pergunta",
      "Analisando os dados",
      "Identificando a principal causa",
    ]);
  });

  it("nunca deixa escapar rodada, nome de ferramenta ou narração do modelo", () => {
    const texto = quadros(ROTEIRO)
      .flatMap((q) => [q.titulo, q.detalhe ?? ""])
      .join(" ");

    expect(texto).not.toMatch(/rodada/i);
    expect(texto).not.toMatch(/Investigando/i);
    expect(texto).not.toMatch(/alteracoes|recortes|ordenacao/i);
    expect(texto).not.toMatch(/deixa eu ver/i);
    expect(texto).not.toMatch(/Book do Operador/i);
    expect(texto).not.toMatch(/Decidindo o que consultar/i);
  });

  it("uma etapa que ninguém mapeou não muda nada — nem aparece", () => {
    const antes = MACROETAPA_INICIAL;
    const depois = avancar(antes, { nome: "ferramentaQueAindaNaoExiste" });

    expect(depois).toBe(antes);
    expect(frase(depois)).toEqual(frase(antes));
  });

  it("a narração do modelo é ignorada como qualquer evento não mapeado", () => {
    expect(avancar("CONSULTAR", { nome: "narracao" })).toBe("CONSULTAR");
  });

  it("o status substitui o anterior e nunca anda para trás", () => {
    let macroetapa: Macroetapa = MACROETAPA_INICIAL;
    macroetapa = avancar(macroetapa, { nome: "consultar" });
    expect(macroetapa).toBe("CONSULTAR");
    macroetapa = avancar(macroetapa, { nome: "aprofundar" });
    expect(macroetapa).toBe("APROFUNDAR");

    /*
      O laço do agente volta a consultar depois de aprofundar. Sem a ordem, a
      linha oscilaria entre duas frases — a mesma poluição, piscando.
    */
    macroetapa = avancar(macroetapa, { nome: "rodada" });
    macroetapa = avancar(macroetapa, { nome: "ferramenta" });
    expect(macroetapa).toBe("APROFUNDAR");
  });
});

describe("o que fica visível em cada instante do turno", () => {
  const base = { pendente: true, macroetapa: "CONSULTAR" as Macroetapa, parcial: "", erro: false };

  it("enquanto não há texto, mostra um único status", () => {
    const tela = telaDoTurno(base);

    expect(tela.status).toEqual({
      titulo: "Analisando os dados",
      detalhe: "Comparando unidades, canais e principais impactos.",
    });
    expect(tela.parcial).toBeNull();
  });

  it("quando o texto começa a chegar, o status sai de cena", () => {
    const tela = telaDoTurno({ ...base, parcial: "Camaçari teve a maior perda" });

    expect(tela.status).toBeNull();
    expect(tela.parcial).toBe("Camaçari teve a maior perda");
  });

  it("com a resposta final, não sobra status nem texto intermediário", () => {
    const tela = telaDoTurno({ ...base, pendente: false, parcial: "parcial descartada" });

    expect(tela).toEqual({ status: null, parcial: null });
  });

  it("no erro o status some, para o aviso da falha ficar sozinho", () => {
    const tela = telaDoTurno({ ...base, erro: true, parcial: "meia resposta" });

    expect(tela).toEqual({ status: null, parcial: null });
  });

  it("em nenhum instante do roteiro há mais de um status visível", () => {
    let macroetapa: Macroetapa = MACROETAPA_INICIAL;
    for (const evento of ROTEIRO) {
      macroetapa = avancar(macroetapa, evento);
      const tela = telaDoTurno({ pendente: true, macroetapa, parcial: "", erro: false });
      expect(tela.status).not.toBeNull();
      expect(Object.keys(tela.status!)).toEqual(["titulo", "detalhe"]);
    }
  });
});
