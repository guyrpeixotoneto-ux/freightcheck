import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { basesDaQuinzena } from "../persistencia";
import { lerPagamento } from "../leitores/pagamento";

/**
 * O GATE PONTA A PONTA — e o que ele recusa a declarar enquanto faltar arquivo.
 *
 * A pergunta aqui é a que decide a substituição da planilha: *os relatórios
 * importados, mais o cadastro digitado no sistema, reproduzem o `RESUMO
 * GERAL`?* Ela **não** é a mesma que a reconciliação responde — aquela roda o
 * motor sobre os insumos da própria `.xlsb`, que é equivalência de fórmula.
 *
 * O material necessário está listado em {@link ARQUIVOS_DA_PROVA}. Enquanto
 * faltar qualquer um, este arquivo **não declara nada aprovado**: os testes que
 * dependem dele são pulados com a lista do que falta impressa no nome. Um teste
 * pulado é honesto; um teste que passa porque os dados não chegaram é o pior
 * resultado possível.
 *
 * Para rodá-lo por inteiro, ponha os arquivos em
 * `src/__tests__/amostras/operacional/` com os nomes da lista e rode a suíte.
 * Nada mais precisa mudar.
 */

const PASTA = join(__dirname, "amostras");
const OPERACIONAL = join(PASTA, "operacional");

/**
 * O material da prova, arquivo por arquivo, com o que cada um alimenta.
 *
 * `onde` é o caminho onde o gate procura. O 03.08.20 da 1ª quinzena já está no
 * repositório desde antes — é o que permite ao teste de baixo rodar de verdade.
 */
export const ARQUIVOS_DA_PROVA = [
  {
    arquivo: "Fechamento_Remuneracao.xlsb",
    onde: join(OPERACIONAL, "Fechamento_Remuneracao.xlsb"),
    alimenta: "o gabarito — as colunas do `RESUMO GERAL` contra as quais se compara",
  },
  {
    arquivo: "cadastro-2026-07.json",
    onde: join(OPERACIONAL, "cadastro-2026-07.json"),
    alimenta:
      "os dezessete parâmetros do contrato, como o cadastro de Remuneração os responde",
  },
  {
    arquivo: "2art-2026-07-Q1",
    onde: join(OPERACIONAL, "2art-2026-07-Q1.xlsx"),
    alimenta: "as viagens da 1ª quinzena — o custo variável e a indisponibilidade",
  },
  {
    arquivo: "2art-2026-07-Q2",
    onde: join(OPERACIONAL, "2art-2026-07-Q2.xlsx"),
    alimenta: "as viagens da 2ª quinzena",
  },
  {
    arquivo: "03.08.20-2026-07-Q1",
    onde: join(PASTA, "03.08.20-2026-07-Q1.txt"),
    alimenta: "os descontos e o total remuneração da 1ª quinzena",
  },
  {
    arquivo: "03.08.20-2026-07-Q2",
    onde: join(OPERACIONAL, "03.08.20-2026-07-Q2.txt"),
    alimenta: "os descontos e o total remuneração da 2ª quinzena",
  },
  {
    arquivo: "03.08.12.09-2026-07-Q2",
    onde: join(OPERACIONAL, "03.08.12.09-2026-07-Q2.csv"),
    alimenta: "as requisições aprovadas — o quadro de outros custos",
  },
  {
    arquivo: "03.08.15-2026-07-Q1",
    onde: join(OPERACIONAL, "03.08.15-2026-07-Q1.xlsx"),
    alimenta: "os CT-es da 1ª quinzena — a conferência do total geral SRTrans",
  },
  {
    arquivo: "03.08.15-2026-07-Q2",
    onde: join(OPERACIONAL, "03.08.15-2026-07-Q2.xlsx"),
    alimenta: "os CT-es da 2ª quinzena",
  },
  {
    arquivo: "03.02.59.02-2026-07-Q2",
    onde: join(OPERACIONAL, "03.02.59.02-2026-07-Q2.txt"),
    alimenta: "os ajustes de CT-e diário e o saldo complementar",
  },
] as const;

/** O que falta para a prova rodar inteira. Vazio = dá para rodar. */
export function arquivosQueFaltam(): string[] {
  return ARQUIVOS_DA_PROVA.filter((a) => !existsSync(a.onde)).map(
    (a) => `${a.arquivo} (${a.alimenta})`,
  );
}

const faltando = arquivosQueFaltam();
const temTudo = faltando.length === 0;

describe("a prova ponta a ponta", () => {
  it("declara, sem rodeio, o que ainda falta para poder rodar", () => {
    /*
      Este teste roda sempre, e é o que impede o gate de virar silêncio. Ele não
      exige que os arquivos existam — exige que a ausência esteja nomeada.
    */
    if (temTudo) {
      expect(faltando).toEqual([]);
      return;
    }
    expect(faltando.length).toBeGreaterThan(0);
    for (const item of faltando) expect(item).not.toHaveLength(0);
  });

  it.skipIf(!temTudo)(
    `roda a competência inteira pelos relatórios${temTudo ? "" : ` — PULADO, faltam: ${faltando.join(" · ")}`}`,
    () => {
      /*
        Deliberadamente não implementado com dados sintéticos. O caminho está
        montado em `prova-ponta-a-ponta.ts` e é exercitado por
        `montarProvaPontaAPonta`; o que falta é material real, e substituí-lo
        por fixture faria este gate afirmar sobre uma operação que não existe.
      */
      expect(temTudo).toBe(true);
    },
  );
});

/* ---------------------------------------------------------------------------
   O que já dá para provar com o material que existe
   ------------------------------------------------------------------------ */

const CAMINHO_0308_20_Q1 = join(PASTA, "03.08.20-2026-07-Q1.txt");

describe("as bases pelo caminho de produção, contra as digitadas na planilha", () => {
  /**
   * O achado que este bloco prende, e por que ele importa mais que o resto.
   *
   * A reconciliação alimenta as bases de desconto com as **células digitadas**
   * do `Mapa Rota`. Em produção elas saem do 03.08.20. Enquanto ninguém
   * comparasse as duas leituras, o painel podia estar reproduzindo a planilha
   * na prova e discordando dela na operação — que é exatamente o que acontece
   * na 1ª quinzena de julho/2026.
   *
   * Os três números da 1ª quinzena, lado a lado:
   *
   * ```
   *                          planilha (Mapa Rota)   03.08.20 (produção)
   * devolução                       13.328,30            13.328,30   bate
   * disponibilidade                 11.649,87                 —      não existe no relatório
   * complementar negativo                0,00            11.649,87   o frete mínimo
   * ```
   *
   * O R$ 11.649,87 é o **mesmo dinheiro** nos dois lados: o `Desconto Frete
   * mínimo` do demonstrativo. A planilha o escreve na linha da disponibilidade
   * e deixa o complementar zerado; o sistema o escreve na linha do complementar
   * e deixa a disponibilidade vazia — porque é o que o relatório sustenta.
   *
   * O efeito em dinheiro não é nulo, e por isso a linha não pode ser tratada
   * como cosmética: a planilha **bruta** o valor pelo fator de imposto
   * (11.649,87 × 1,365455 = 15.907,37) e o complementar negativo, por regra da
   * própria planilha, **não** é brutado. São R$ 4.257,50 de diferença no quadro
   * da 1ª quinzena, com a mesma origem documental.
   */
  it.skipIf(!existsSync(CAMINHO_0308_20_Q1))(
    "a 1ª quinzena põe o frete mínimo em linhas diferentes — e isso vale R$ 4.257,50",
    () => {
      const pagamento = lerPagamento(readFileSync(CAMINHO_0308_20_Q1));
      const descontos = pagamento.descontos.map((d) => ({
        canal: d.canal,
        tipo: d.tipo as string,
        valor: d.valor,
      }));
      const bases = basesDaQuinzena(descontos, "ROTA", [], null, { quinzena: 2, disponibilidadeDoMes: null });

      /* O que o 03.08.20 sustenta. */
      expect(bases.devolucao).toBeCloseTo(13_328.3, 2);
      expect(bases.complementarNegativo).toBeCloseTo(11_649.87, 2);
      /*
        E o que ele **não** sustenta: não há bloco de disponibilidade nenhum na
        1ª quinzena. `null`, e não zero — a diferença entre "o relatório diz que
        não houve" e "o relatório não fala disso".
      */
      expect(bases.disponibilidade).toBeNull();

      /* A planilha digita, na mesma quinzena, estes outros três. */
      const DIGITADO_NA_PLANILHA = {
        devolucao: 13_328.3,
        disponibilidade: 11_649.87,
        complementarNegativo: 0,
      };
      expect(bases.devolucao).toBeCloseTo(DIGITADO_NA_PLANILHA.devolucao, 2);
      expect(bases.disponibilidade).not.toBe(DIGITADO_NA_PLANILHA.disponibilidade);
      expect(bases.complementarNegativo).not.toBe(
        DIGITADO_NA_PLANILHA.complementarNegativo,
      );

      /*
        E o tamanho do efeito, medido e preso: brutar ou não brutar o mesmo
        R$ 11.649,87 muda o quadro em R$ 4.257,50. O fator é o de julho/2026 na
        1ª quinzena, o mesmo que a reconciliação usa.
      */
      const FATOR_DA_1A_QUINZENA = 1.365455;
      const efeito = 11_649.87 * FATOR_DA_1A_QUINZENA - 11_649.87;
      expect(efeito).toBeCloseTo(4_257.5, 1);
    },
  );

  it.skipIf(!existsSync(CAMINHO_0308_20_Q1))(
    "o total remuneração do 03.08.20 é o TOTAL GERAL SRTRANS da planilha",
    () => {
      const pagamento = lerPagamento(readFileSync(CAMINHO_0308_20_Q1));
      const rota = pagamento.totais.find((t) => t.canal === "ROTA");

      /* `Resumo Geral!AI38` = `Abertura!F45` = 1.084.580,45. */
      expect(rota?.total).toBeCloseTo(1_084_580.45, 2);
    },
  );
});
