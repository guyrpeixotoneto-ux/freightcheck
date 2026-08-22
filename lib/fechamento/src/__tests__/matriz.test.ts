import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DECISOES_PENDENTES,
  DECISOES_RESOLVIDAS,
  LINHAS_DO_RESUMO_GERAL,
  montarMatriz,
  type StatusDaLinha,
} from "../matriz";
import { interpretarAmostra } from "../reconciliacao";

/**
 * O GATE DA MATRIZ — cem por cento das linhas explicadas, e nenhuma delas nossa.
 *
 * Este teste responde, para as vinte e duas linhas do `RESUMO GERAL`, a
 * pergunta que decide a substituição da planilha: *de onde esse número veio,
 * qual regra o calculou, e por que ele é igual — ou justificadamente diferente
 * — ao número da planilha?*
 *
 * **O que ele impede.** Duas coisas, e as duas já aconteceram no histórico
 * deste produto. A primeira é uma linha sumir da conferência e ninguém notar:
 * oito das vinte e duas não eram olhadas por nada, incluindo as três que fecham
 * o documento. A segunda é uma divergência nova nascer e se disfarçar de
 * conhecida — por isso `DIVERGENCIA_DO_MOTOR` tem asserção própria, e por isso
 * o conjunto das linhas justificadas é preso nome a nome.
 */

/*
  Lida do disco, e não por `import ... with { type: "json" }` — a mesma escolha
  de `reconciliacao.test.ts`, e pelo mesmo motivo: a amostra é dado de teste, e
  mantê-la fora do grafo de compilação evita que o `tsconfig` do pacote precise
  conhecer um arquivo que só o teste abre.
*/
const CAMINHO_DA_AMOSTRA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "amostras",
  "julho-2026.json",
);
const fechamento = interpretarAmostra(
  JSON.parse(readFileSync(CAMINHO_DA_AMOSTRA, "utf8")),
);

describe("a matriz cobre o RESUMO GERAL inteiro", () => {
  const matriz = montarMatriz(fechamento, "REGRA_CANONICA");

  it("tem uma linha para cada linha do resumo, e todas com status", () => {
    expect(matriz.linhas).toHaveLength(LINHAS_DO_RESUMO_GERAL);
    expect(matriz.linhas).toHaveLength(22);
    for (const l of matriz.linhas) {
      expect(l.status, `${l.rotulo} ficou sem status`).toBeTruthy();
    }
    const soma = Object.values(matriz.placar).reduce((s, n) => s + n, 0);
    expect(soma).toBe(matriz.linhas.length);
  });

  it("cobre as linhas da planilha pelo número delas, sem buraco", () => {
    /*
      Os números são os do arquivo, e a lista é fechada: 18, 19, 20, 26, 27, 28,
      31, 32, 33, 35, 37 e 39 são separadores e cabeçalhos, e 34 é a linha de
      dados do quadro reservado. Uma linha nova que apareça na planilha e não
      aqui derruba este teste, que é o ponto.
    */
    expect(matriz.linhas.map((l) => l.linhaNaPlanilha)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 29, 30, 34, 36, 38, 40,
    ]);
  });

  it("toda linha diz de onde o número sai e que regra o calcula", () => {
    for (const l of matriz.linhas) {
      expect(l.fonteOperacional, `${l.rotulo} sem fonte`).not.toHaveLength(0);
      expect(l.regraNoSistema, `${l.rotulo} sem regra`).not.toHaveLength(0);
      expect(l.formulaDaPlanilha, `${l.rotulo} sem fórmula da planilha`).not.toHaveLength(0);
    }
  });

  it("toda linha que não é REPRODUZIDA traz a causa escrita", () => {
    for (const l of matriz.linhas) {
      if (l.status === "REPRODUZIDA") expect(l.causa).toBeNull();
      else expect(l.causa, `${l.rotulo} (${l.status}) sem causa`).toBeTruthy();
    }
  });

  it("nenhuma divergência é do motor", () => {
    const doMotor = matriz.linhas.filter((l) => l.status === "DIVERGENCIA_DO_MOTOR");
    expect(
      doMotor.map((l) => `${l.linhaNaPlanilha} ${l.rotulo}: ${l.causa}`),
      "apareceu divergência sem causa conhecida — é defeito do motor até alguém nomeá-la",
    ).toEqual([]);
  });

  it("as linhas justificadas são exatamente estas, nome a nome", () => {
    /*
      Preso nome a nome de propósito. Uma lista que só contasse deixaria uma
      linha nova entrar como justificada no lugar de outra que saiu, e o número
      continuaria batendo.
    */
    const porStatus = (s: StatusDaLinha) =>
      matriz.linhas.filter((l) => l.status === s).map((l) => l.linhaNaPlanilha);

    expect(porStatus("DIVERGENCIA_JUSTIFICADA_PLANILHA")).toEqual([
      7, 8, 10, 14, 17, 21, 22, 23, 25, 36,
    ]);
    expect(porStatus("REPRODUZIDA")).toEqual([9, 11, 12, 13, 15, 16, 24, 29, 30]);
    expect(porStatus("NAO_SE_APLICA")).toEqual([34]);
    expect(porStatus("FONTE_NAO_DISPONIVEL")).toEqual([38, 40]);
    expect(porStatus("DIVERGENCIA_DO_MOTOR")).toEqual([]);
  });

  it("o total geral não diverge por conta própria — a diferença é toda herdada", () => {
    const geral = matriz.linhas.find((l) => l.chave === "total_geral_unidade")!;
    expect(geral.status).toBe("DIVERGENCIA_JUSTIFICADA_PLANILHA");
    expect(geral.causa).toContain("Não diverge por conta própria");
  });

  it("o quadro reservado não se aplica, e não vira zero medido", () => {
    const equipe = matriz.linhas.find((l) => l.chave === "equipe_de_entrega")!;
    expect(equipe.status).toBe("NAO_SE_APLICA");
    /* A planilha não escreve célula nenhuma ali. */
    expect(equipe.planilha.primeira).toBeNull();
    expect(equipe.planilha.segunda).toBeNull();
  });
});

describe("a matriz não se engana sobre o que provou", () => {
  const matriz = montarMatriz(fechamento, "REGRA_CANONICA");

  it("a amostra do gabarito NÃO é a prova ponta a ponta, e diz o que falta", () => {
    expect(matriz.insumos.pontaAPonta).toBe(false);
    expect(matriz.insumos.doGabarito).toHaveLength(2);
    for (const q of matriz.insumos.doGabarito) {
      expect(q.itens.join(" ")).toContain("aba `Cadastro` da planilha");
      expect(q.itens.join(" ")).toContain("no lugar do 2Art");
      expect(q.itens.join(" ")).toContain("no lugar do 03.08.20");
    }
  });
});

describe("as decisões de domínio pendentes ficam registradas, não assumidas", () => {
  /*
    A pergunta do desconto de disponibilidade saiu daqui: ela foi respondida
    com prova, e mudou de registro. Ver o bloco abaixo. O que este teste guarda
    hoje é a forma do registro, para que a próxima pendência nasça completa.
  */
  it("toda pendência registrada traz pergunta, evidência e o que a resolve", () => {
    for (const [chave, pendente] of Object.entries(DECISOES_PENDENTES)) {
      expect(pendente.pergunta, `${chave} sem pergunta`).not.toHaveLength(0);
      expect(pendente.evidencia, `${chave} sem evidência`).not.toHaveLength(0);
      expect(pendente.resolve, `${chave} sem saída`).not.toHaveLength(0);
    }
  });
});

describe("a decisão do desconto de disponibilidade foi resolvida com prova", () => {
  it("a resposta é o 03.08.18, acumulado no mês", () => {
    const r = DECISOES_RESOLVIDAS.desconto_disponibilidade;
    expect(r).toBeTruthy();
    expect(r!.resposta).toContain("03.08.18");
    expect(r!.resposta).toContain("mês inteiro");
  });

  /*
    Os três números do encaixe. Fixá-los aqui é o que impede a prova de virar
    uma afirmação sem lastro no dia em que alguém reescrever o texto.
  */
  it("a prova cita as três linhas que fecham ao centavo", () => {
    const r = DECISOES_RESOLVIDAS.desconto_disponibilidade;
    expect(r!.prova).toContain("91.321,65");
    expect(r!.prova).toContain("320,85");
    expect(r!.prova).toContain("91.642,50");
  });

  /* O que enganou por dois documentos, dito, para não enganar uma terceira vez. */
  it("o alcance registra que a comparação por quinzena é a armadilha", () => {
    const r = DECISOES_RESOLVIDAS.desconto_disponibilidade;
    expect(r!.alcance).toContain("29.075,62");
    expect(r!.alcance).toContain("3,152");
    expect(r!.alcance).toContain("uma segunda competência");
  });

  it("a linha da matriz aponta para o 03.08.18 e não mais para uma pendência", () => {
    const matriz = montarMatriz(fechamento, "REGRA_CANONICA");
    const linha = matriz.linhas.find((l) => l.chave === "desconto_disponibilidade")!;
    expect(linha.fonteOperacional).toContain("03.08.18");
    expect(linha.fonteOperacional).not.toContain("DECISOES_PENDENTES");
    expect(linha.regraNoSistema).toContain("mês");
  });
});
