import { describe, expect, it } from "vitest";
import {
  anosDasVigencias,
  ehModoDaAuditoria,
  ehRecorteDeTipo,
  pontasDoAno,
  trocaNaRota,
} from "../modo-da-auditoria";

/**
 * OS DOIS MODOS, AGORA NAS QUATRO AUDITORIAS DE CUSTO FIXO.
 *
 * `finame-evolucao.test.ts` prende as mesmas promessas pela porta do FINAME, que
 * é onde elas nasceram. O que se prova aqui é que elas continuam valendo quando
 * a rota é outra — que é a única coisa que muda de uma tela para a outra.
 */

const ROTAS = ["/custo-fixo-ipva", "/custo-fixo-lucro-fixo", "/custo-fixo-impostos"];

describe("o modo, lido do endereço", () => {
  it("aceita os dois modos e recusa o resto", () => {
    expect(ehModoDaAuditoria("comparacao")).toBe(true);
    expect(ehModoDaAuditoria("evolucao")).toBe(true);
    /* Endereço adulterado cai na comparação — a tela que sempre existiu —, e
       nunca numa tela em branco que se pareceria com "não há nada aqui". */
    expect(ehModoDaAuditoria("evolução")).toBe(false);
    expect(ehModoDaAuditoria("EVOLUCAO")).toBe(false);
    expect(ehModoDaAuditoria(null)).toBe(false);
    expect(ehModoDaAuditoria(undefined)).toBe(false);
  });

  it("aceita os três recortes da evolução e recusa o resto", () => {
    expect(ehRecorteDeTipo("TODOS")).toBe(true);
    expect(ehRecorteDeTipo("CAVALO")).toBe(true);
    expect(ehRecorteDeTipo("CARRETA")).toBe(true);
    expect(ehRecorteDeTipo("cavalo")).toBe(false);
    expect(ehRecorteDeTipo(null)).toBe(false);
  });
});

describe("a ida e a volta, em cada uma das três rotas", () => {
  it("entrar na Evolução preserva tudo que estava aberto", () => {
    for (const rota of ROTAS) {
      const trocar = trocaNaRota(rota);
      const destino = trocar("scopeHash=abc&canal=EMPURRADA&base=7&comparada=8", {
        modo: "evolucao",
      });
      expect(destino.startsWith(`${rota}?`)).toBe(true);

      const q = new URLSearchParams(destino.split("?")[1]);
      expect(q.get("scopeHash")).toBe("abc");
      expect(q.get("canal")).toBe("EMPURRADA");
      expect(q.get("base")).toBe("7");
      expect(q.get("comparada")).toBe("8");
      expect(q.get("modo")).toBe("evolucao");
    }
  });

  it("e voltar devolve exatamente o endereço de origem", () => {
    const trocar = trocaNaRota("/custo-fixo-impostos");
    const origem = "scopeHash=abc&base=7&comparada=8";
    const ida = trocar(origem, { modo: "evolucao" });
    const dentro = trocar(ida.split("?")[1], { recorteEvolucao: "CAVALO", ano: "2026" });
    const volta = trocar(dentro.split("?")[1], { modo: null });

    const q = new URLSearchParams(volta.split("?")[1]);
    expect(q.get("modo")).toBeNull();
    expect(q.get("scopeHash")).toBe("abc");
    expect(q.get("base")).toBe("7");
    expect(q.get("comparada")).toBe("8");
  });

  /* Um `?modo=` pendurado no endereço seria um modo que o leitor descarta em
     silêncio, e a tela anunciaria um estado que não existe. */
  it("apaga a chave em vez de escrever vazio", () => {
    const trocar = trocaNaRota("/custo-fixo-ipva");
    expect(trocar("modo=evolucao", { modo: "" })).toBe("/custo-fixo-ipva");
    expect(trocar("modo=evolucao", { modo: null })).toBe("/custo-fixo-ipva");
  });
});

describe("o ano é atalho para as pontas, e não um eixo", () => {
  it("sai das vigências que existem, do mais recente ao mais antigo", () => {
    expect(anosDasVigencias(["2026-01-16", "2025-12-01", "2026-08-16"])).toEqual([
      "2026",
      "2025",
    ]);
  });

  it("parte da última vigência anterior ao ano, que não entra na soma", () => {
    expect(pontasDoAno("2026", ["2025-12-01", "2026-01-16", "2026-08-16"])).toEqual({
      de: "2025-12-01",
      ate: "2026-08-16",
    });
  });

  it("não devolve intervalo para um ano sem vigência", () => {
    expect(pontasDoAno("2024", ["2026-01-16"])).toBeNull();
  });
});
