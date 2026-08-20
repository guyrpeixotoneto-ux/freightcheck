import { describe, expect, it } from "vitest";

import {
  avisoDoEnvio,
  chaveDaCompetencia,
  chaveDoDia,
  chaveDoDiagnostico,
  chaveDoDiario,
  chaveDoPainel,
  estadoDaFonte,
} from "@/lib/fechamento-tela";
import type { Documento, DocumentoRecebido } from "@/lib/fechamento";

/**
 * As duas decisões que a tela do Fechamento toma antes de desenhar.
 *
 * Nenhuma delas era testável enquanto morava dentro do JSX — e as duas erravam
 * de um jeito que só aparecia com o produto na mão: o painel servido do cache
 * negando um arquivo que a lista mostrava, e o `202` da quarentena passando por
 * sucesso mudo.
 */

const DOCUMENTO: Documento = {
  id: "d1",
  tipo: "PAGAMENTO",
  nomeDoArquivo: "03.08.20_1Q_JUL.txt",
  linhasLidas: 14,
  recusas: [],
  vigente: true,
  enviadoEm: "2026-08-20T12:00:00.000Z",
  verbas: 10,
};

const RECEBIDO: DocumentoRecebido = {
  id: "d1",
  tipo: "PAGAMENTO",
  nomeDoArquivo: "03.08.20_1Q_JUL.txt",
  linhasLidas: 14,
  recusas: [],
  enviadoEm: "2026-08-20T12:00:00.000Z",
  desfecho: "PROMOVIDO",
  motivoDaQuarentena: null,
  substituiu: null,
};

describe("a chave de uma competência", () => {
  const id = "c1";

  /*
    A afirmação que fecha a porta. Invalidar por chave, no react-query, é por
    prefixo: enquanto o painel era `["fechamento", "painel", id]`, nenhuma das
    invalidações da competência o alcançava — e a próxima consulta que alguém
    escrevesse nasceria irmã do mesmo jeito. Aqui a relação é afirmada uma vez,
    e uma chave nova que não a cumpra quebra este teste antes de ir para a tela.
  */
  it("é prefixo de tudo que se pergunta sobre ela", () => {
    const raiz = chaveDaCompetencia(id);
    for (const filha of [chaveDoPainel(id), chaveDoDiario(id), chaveDoDia(id, "2026-07-03")]) {
      expect(filha.slice(0, raiz.length)).toEqual([...raiz]);
      expect(filha.length).toBeGreaterThan(raiz.length);
    }
  });

  it("não alcança o diagnóstico de um documento, e é de propósito", () => {
    /* Ele responde sobre bytes que não mudam nunca; refazê-lo a cada envio seria
       pagar a releitura de um arquivo para receber a mesma resposta. */
    expect(chaveDoDiagnostico("d1").slice(0, 3)).not.toEqual([...chaveDaCompetencia(id)]);
  });

  it("distingue duas competências", () => {
    expect(chaveDaCompetencia("c1")).not.toEqual([...chaveDaCompetencia("c2")]);
  });
});

describe("o que a lista de relatórios diz de uma fonte", () => {
  it("sem documento vigente, a fonte está ausente", () => {
    expect(estadoDaFonte(undefined)).toBe("AUSENTE");
  });

  it("com documento e verbas, está importada", () => {
    expect(estadoDaFonte(DOCUMENTO)).toBe("IMPORTADA");
  });

  it("com documento e nenhuma verba, é um estado próprio — nem ausente nem importada", () => {
    /* O caso relatado da tela: visto verde e "14 linhas" ao lado de um painel
       dizendo que o arquivo não tinha sido importado. */
    expect(estadoDaFonte({ ...DOCUMENTO, verbas: 0 })).toBe("SEM_VERBA");
  });

  it("as cinco fontes sem verba a ter não são acusadas", () => {
    /* `verbas` é `null` nelas, e `null` não é zero: um `!documento.verbas`
       poria o triângulo âmbar no 2Art, no 03.08.15 e nas outras três. */
    expect(estadoDaFonte({ ...DOCUMENTO, tipo: "OPERACAO", verbas: null })).toBe("IMPORTADA");
  });
});

describe("o aviso depois de um envio aceito", () => {
  it("o arquivo promovido não gera aviso — a lista já mostra o resultado", () => {
    expect(avisoDoEnvio(RECEBIDO)).toBeNull();
  });

  it("o arquivo em quarentena gera aviso, com o nome e o motivo do servidor", () => {
    /* O `202` é `ok` para o `fetch` e não é sucesso. Tratá-lo como o `201` foi
       o que fez alguém subir o 03.08.20, não ver aviso nenhum e concluir que
       estava importado. */
    const aviso = avisoDoEnvio({
      ...RECEBIDO,
      desfecho: "EM_QUARENTENA",
      motivoDaQuarentena: '"03.08.20 (truncado).txt" trouxe 4 registro(s), mas nenhuma verba.',
    });
    expect(aviso).toEqual({
      nomeDoArquivo: "03.08.20_1Q_JUL.txt",
      motivo: '"03.08.20 (truncado).txt" trouxe 4 registro(s), mas nenhuma verba.',
    });
  });

  it("quarentena sem motivo escrito ainda avisa que o arquivo não valeu", () => {
    const aviso = avisoDoEnvio({ ...RECEBIDO, desfecho: "EM_QUARENTENA", motivoDaQuarentena: null });
    expect(aviso?.motivo).toContain("não virou a conta");
  });
});
