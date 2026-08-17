import { describe, expect, it } from "vitest";
import { aplicarContexto, enderecoComContexto } from "../contexto";

/**
 * A regra de troca de contexto, provada sem DOM.
 *
 * A barra em si é layout e não se testa aqui — o que se testa é a única parte
 * dela que tem regra: o que acontece com a vigência quando alguém troca de
 * unidade. Início sabia a resposta e a escrevia à mão; as outras oito telas não
 * sabiam, e cada uma reescrevia a URL do seu jeito.
 */

describe("trocar de unidade apaga a vigência", () => {
  it("a data de uma unidade não é oferecida à outra", () => {
    /*
      O caso concreto: alguém está vendo agosto de Camaçari e troca para Juiz de
      Fora, que só entregou em fevereiro. Levar `period=2026-08-01` junto abriria
      uma tela vazia — e vazia sem causa, que é o defeito que esta auditoria
      persegue.
    */
    const params = aplicarContexto("scopeHash=camacari&period=2026-08-01", {
      scopeHash: "juizdefora",
    });
    expect(params.get("scopeHash")).toBe("juizdefora");
    expect(params.get("period")).toBeNull();
  });

  it("trocar de canal também apaga: EMPURRADA e ROTA não dividem calendário", () => {
    const params = aplicarContexto("scopeHash=x&canal=EMPURRADA&period=2026-08-01", {
      canal: "ROTA",
    });
    expect(params.get("canal")).toBe("ROTA");
    expect(params.get("period")).toBeNull();
  });

  it("reescolher a mesma unidade não apaga nada", () => {
    // Não é caso teórico: a barra dispara `onChange` com o valor atual quando o
    // componente remonta, e apagar a vigência ali jogaria o usuário para a mais
    // recente sem que ele tivesse pedido.
    const params = aplicarContexto("scopeHash=camacari&period=2026-08-01", {
      scopeHash: "camacari",
    });
    expect(params.get("period")).toBe("2026-08-01");
  });
});

describe("trocar de vigência mantém o recorte", () => {
  it("a unidade e o canal continuam onde estavam", () => {
    const params = aplicarContexto("scopeHash=camacari&canal=EMPURRADA", {
      period: "2026-07-01",
    });
    expect(params.get("scopeHash")).toBe("camacari");
    expect(params.get("canal")).toBe("EMPURRADA");
    expect(params.get("period")).toBe("2026-07-01");
  });

  it("o que a tela guarda na URL por conta própria sobrevive", () => {
    // Parâmetros guarda o cartão aberto, Composição guarda o equipamento. Uma
    // troca de vigência não pode fechar o que o usuário abriu.
    const params = aplicarContexto("cartao=frota&equipamento=CAVALO", {
      period: "2026-07-01",
    });
    expect(params.get("cartao")).toBe("frota");
    expect(params.get("equipamento")).toBe("CAVALO");
  });
});

describe("o canal vazio é uma partição, não a ausência de filtro", () => {
  it("canal null tira o parâmetro; canal vazio o mantém", () => {
    /*
      `?canal=` quer dizer "as vigências sem canal legível no rótulo", que é um
      conjunto real. `null` quer dizer "não filtre por canal". As duas coisas
      escrevem URLs diferentes de propósito — confundi-las foi como o canal
      virou regex em `series.ts`, na divergência D2.
    */
    expect(aplicarContexto("canal=ROTA", { canal: null }).has("canal")).toBe(false);
    expect(aplicarContexto("canal=ROTA", { canal: "" }).get("canal")).toBe("");
  });
});

describe("o endereço montado", () => {
  it("sem parâmetro nenhum, não deixa a interrogação sobrando", () => {
    expect(enderecoComContexto("/dre", "", {})).toBe("/dre");
  });

  it("com recorte, monta a query inteira", () => {
    expect(enderecoComContexto("/dre", "", { scopeHash: "x", period: "2026-08-01" })).toBe(
      "/dre?scopeHash=x&period=2026-08-01",
    );
  });
});
