import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";

import { placarDoGate, rodarGate, statusDoGate } from "../reconciliar-real-cli";
import type { RelatoriosDaQuinzena } from "../prova-ponta-a-ponta";
import { readFileSync } from "node:fs";

/**
 * O GATE PONTA A PONTA — a pergunta que decide a substituição da planilha.
 *
 * *Importando os relatórios e digitando o cadastro, o sistema chega sozinho ao
 * `RESUMO GERAL`?* A `.xlsb` entra por uma porta só — a coluna de referência —
 * e nenhum número dela alimenta cálculo.
 *
 * **O critério é `ERRO DO SISTEMA = 0`, e não "tudo bate".** Divergência
 * comprovada da planilha é achado, dado ausente é trabalho de quem importa, e
 * regra a definir é decisão de domínio. Nenhum dos três é defeito de código, e
 * exigir zero divergência obrigaria o motor a copiar os defeitos da `.xlsb` —
 * que é exatamente o que este pacote recusa. O que **não** pode existir é
 * diferença sem causa nomeada.
 *
 * **Roda com material real ou não roda.** Substituí-lo por dados sintéticos
 * transformaria o gate numa afirmação sobre o próprio gerador. Enquanto os
 * arquivos não estiverem na pasta, o teste de cima nomeia o que falta — e é ele
 * que impede a ausência de virar silêncio.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const OPERACIONAL = join(AQUI, "amostras", "operacional");
const GABARITO = join(AQUI, "amostras", "julho-2026.json");

/** Os arquivos de cada quinzena, com a fonte que cada um alimenta. */
const MATERIAL = {
  1: {
    operacao: "2art-2026-07-Q1.xlsx",
    pagamento: "03.08.20-2026-07-Q1.txt",
    disponibilidade: "03.08.18-2026-07-Q1.xlsx",
    ctes: "03.08.15-2026-07-Q1.xlsx",
    conciliacao: "03.02.59.02-2026-07-Q1.txt",
  },
  2: {
    operacao: "2art-2026-07-Q2.xlsx",
    pagamento: "03.08.20-2026-07-Q2.txt",
    disponibilidade: "03.08.18-2026-07-Q2.xlsx",
    requisicoes: "03.08.12.09-2026-07-Q2.csv",
    ctes: "03.08.15-2026-07-Q2.xlsx",
    conciliacao: "03.02.59.02-2026-07-Q2.txt",
  },
} as const;

function faltando(): string[] {
  const fora: string[] = [];
  for (const [quinzena, fontes] of Object.entries(MATERIAL)) {
    for (const nome of Object.values(fontes)) {
      if (!existsSync(join(OPERACIONAL, nome))) fora.push(`${quinzena}ª: ${nome}`);
    }
  }
  return fora;
}

function relatorios(quinzena: 1 | 2): RelatoriosDaQuinzena {
  const out: Record<string, unknown> = { quinzena };
  for (const [fonte, nome] of Object.entries(MATERIAL[quinzena])) {
    out[fonte] = readFileSync(join(OPERACIONAL, nome));
  }
  return out as unknown as RelatoriosDaQuinzena;
}

const fora = faltando();
const temTudo = fora.length === 0 && existsSync(GABARITO);

describe("o gate ponta a ponta com os relatórios reais", () => {
  it("declara o que falta para poder rodar, em vez de calar", () => {
    if (temTudo) {
      expect(fora).toEqual([]);
      return;
    }
    expect(fora.length).toBeGreaterThan(0);
    for (const item of fora) expect(item).not.toHaveLength(0);
  });

  it.skipIf(!temTudo)(
    `nenhuma linha do RESUMO GERAL diverge sem causa${temTudo ? "" : " — PULADO, falta material"}`,
    () => {
      const matriz = rodarGate({
        ano: 2026,
        mes: 7,
        canal: "ROTA",
        caminhoDoGabarito: GABARITO,
        relatorios: [relatorios(1), relatorios(2)],
      });

      const doSistema = matriz.linhas
        .filter((l) => statusDoGate(l) === "ERRO DO SISTEMA")
        .map((l) => `${l.linhaNaPlanilha} ${l.rotulo}: ${l.causa}`);

      expect(
        doSistema,
        "linha com diferença sem causa nomeada — é defeito nosso até alguém explicá-la",
      ).toEqual([]);
    },
  );

  it.skipIf(!temTudo)(
    `toda linha tem origem e dependências declaradas${temTudo ? "" : " — PULADO, falta material"}`,
    () => {
      const matriz = rodarGate({
        ano: 2026,
        mes: 7,
        canal: "ROTA",
        caminhoDoGabarito: GABARITO,
        relatorios: [relatorios(1), relatorios(2)],
      });

      for (const l of matriz.linhas) {
        expect(["CAD", "DOC", "CALC", "SUB"], `${l.rotulo} sem origem`).toContain(l.origem);
        /* Só a linha derivada pode não ter dependência: as dela são as parcelas. */
        if (l.origem !== "SUB") {
          expect(l.dependencias.length, `${l.rotulo} sem dependência`).toBeGreaterThan(0);
        }
      }

      /* O placar soma sempre o total de linhas — nenhuma escapa da classificação. */
      const placar = placarDoGate(matriz);
      const soma = Object.values(placar).reduce((s, n) => s + n, 0);
      expect(soma).toBe(matriz.linhas.length);
    },
  );
});
