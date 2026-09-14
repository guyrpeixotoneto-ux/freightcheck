import { describe, expect, it } from "vitest";
import {
  AMBIENTES_DE_AUDITORIA,
  OPERACAO_DA_AUDITORIA,
  recorteDaAuditoria,
} from "../ambiente-da-auditoria";
import { AMBIENTES } from "../permissoes";

/**
 * **O par ambiente + operação, conferido sem banco.**
 *
 * Os dois eixos existiam e eram lidos em separado: `?ambiente=` decidia
 * permissão e `?operacao=` decidia acervo. Nada impedia o par incompatível — o
 * ambiente a que se tem acesso junto com a operação de outro —, que é uma
 * leitura do acervo alheio com a permissão do próprio.
 *
 * Os casos de rota provam o comportamento ponta a ponta; estes provam o que é
 * caro provar lá: que **os quatro** ambientes têm operação, que nenhum de
 * fechamento entra, e que as recusas não se confundem entre si.
 */

const pedido = (ambiente?: string, operacao?: string) => ({
  ...(ambiente === undefined ? {} : { ambiente }),
  ...(operacao === undefined ? {} : { operacao }),
});

describe("o vínculo entre ambiente e operação", () => {
  it("aceita os quatro ambientes de auditoria, cada um com a sua operação", () => {
    for (const ambiente of AMBIENTES_DE_AUDITORIA) {
      const esperada = OPERACAO_DA_AUDITORIA[ambiente];
      const r = recorteDaAuditoria(pedido(ambiente, esperada));

      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("recusou o par certo");
      expect(r.operacao).toBe(esperada);
    }
  });

  it("os quatro têm operação declarada, e nenhuma se repete", () => {
    /*
      A lista é escrita aqui e na tela (`lib/ambiente.ts`), porque são dois
      pacotes e o servidor não importa a tela. Este caso é o que impede a cópia
      de envelhecer pela metade: um ambiente novo sem operação cai aqui.
    */
    const operacoes = AMBIENTES_DE_AUDITORIA.map((a) => OPERACAO_DA_AUDITORIA[a]);
    expect(operacoes.filter((o) => o === undefined || o === "")).toEqual([]);
    expect(new Set(operacoes).size).toBe(AMBIENTES_DE_AUDITORIA.length);
  });

  it("recusa a operação de outra auditoria, e a recusa nada diz do acervo", () => {
    const r = recorteDaAuditoria(pedido("auditoria", "ROTA"));

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("aceitou o par trocado");
    expect(r.code).toBe("PAR_INCOMPATIVEL");
    /* Nem a operação do ambiente sai na frase: ela não é informação de quem errou. */
    expect(r.error).not.toContain("EMPURRADA");
  });

  it("recusa um valor de operação que não é de nenhum ambiente", () => {
    /*
      `normalizarOperacao` não recusa nada — ela normaliza qualquer texto num
      token, e `ROTAA` viraria `ROTAA`, filtrando zero linha sem erro nenhum.
      Derivar do ambiente é o que cria a lista fechada que faltava.
    */
    const r = recorteDaAuditoria(pedido("auditoria-rota", "ROTAA"));

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("aceitou operação inexistente");
    expect(r.code).toBe("PAR_INCOMPATIVEL");
  });

  it("aceita a operação em qualquer caixa — a normalização é a mesma do banco", () => {
    const r = recorteDaAuditoria(pedido("auditoria-rota", "rota"));
    expect(r.ok).toBe(true);
  });

  it("separa ambiente ausente de ambiente desconhecido", () => {
    expect(recorteDaAuditoria(pedido(undefined, "EMPURRADA"))).toMatchObject({
      ok: false,
      code: "AMBIENTE_AUSENTE",
    });
    expect(recorteDaAuditoria(pedido("", "EMPURRADA"))).toMatchObject({
      ok: false,
      code: "AMBIENTE_AUSENTE",
    });
    expect(recorteDaAuditoria(pedido("auditoria-marte", "EMPURRADA"))).toMatchObject({
      ok: false,
      code: "AMBIENTE_INVALIDO",
    });
  });

  it("separa operação ausente de operação ilegível", () => {
    expect(recorteDaAuditoria(pedido("auditoria"))).toMatchObject({
      ok: false,
      code: "OPERACAO_AUSENTE",
    });
    expect(recorteDaAuditoria(pedido("auditoria", "---"))).toMatchObject({
      ok: false,
      code: "OPERACAO_INVALIDA",
    });
  });

  it("recusa os quatro ambientes de fechamento, dizendo por quê", () => {
    /*
      Eles são permissão do mesmo jeito, e o eixo de operação deles é outro —
      `competencia.tipo_de_operacao`, não `snapshot.canal`. Aceitá-los daria uma
      resposta sobre um acervo que a pergunta não descreve.
    */
    const deFechamento = AMBIENTES.filter((a) => a.startsWith("fechamento-"));
    expect(deFechamento.length).toBe(4);

    for (const ambiente of deFechamento) {
      const r = recorteDaAuditoria(pedido(ambiente, "ROTA"));
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("aceitou ambiente de fechamento");
      expect(r.code).toBe("AMBIENTE_INVALIDO");
      expect(r.error).toMatch(/Fechamento/);
    }
  });

  it("não lê mais nada da query — nem scopeHash, nem period", () => {
    /*
      Esta porta decide sobre a **forma** do pedido, e a forma não depende do
      acervo. Quem resolve unidade, canal e competência é `resolveContext`,
      depois — e é por isso que nenhuma recusa daqui revela que eles existem.
    */
    const r = recorteDaAuditoria({
      ambiente: "auditoria",
      operacao: "EMPURRADA",
      scopeHash: "hash-que-nao-existe",
      period: "1999-01-01",
    });

    expect(r).toEqual({ ok: true, ambiente: "auditoria", operacao: "EMPURRADA" });
  });
});
