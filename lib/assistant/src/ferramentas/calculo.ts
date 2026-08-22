/**
 * A capacidade de **compor** dois números que já foram apurados.
 *
 * **Por que ela é uma ferramenta e não uma instrução no prompt.** "Pode
 * calcular percentual" escrito no prompt significa que o modelo calcula, e um
 * número que o modelo calculou não tem onde ser conferido — ele chega ao texto
 * pela mesma porta por que chegaria um inventado. Aqui a conta roda em código,
 * sobre operandos conferidos contra o que as consultas desta conversa
 * apuraram, e o resultado volta como evidência: numerado, citável, e com a
 * expressão por extenso ao lado.
 *
 * **O eixo, e não uma ferramenta por operação.** Uma só capacidade com
 * `operacao` como argumento — proporção, variação, diferença, soma, média,
 * projeção. Seis ferramentas seriam seis nomes para a mesma coisa, e o catálogo
 * do agente é justamente o lugar onde isso não se faz.
 *
 * **Ela não é o motor.** Impacto, cobertura, DRE e composição continuam nos
 * pacotes de domínio; esta ferramenta não os reimplementa e não os corrige.
 * Ela existe para a pergunta que nenhum motor responde porque ela não é do
 * domínio: "quanto isso representa daquilo?".
 */

import { calcular, evidenciaDoCalculo, grandezasApuradas, type Grandeza, type Operacao } from "../calculo";
import type { Ferramenta } from "./registro";

const OPERACOES = ["proporcao", "variacao", "diferenca", "soma", "media", "projecao"] as const;

export const calculo: Ferramenta = {
  nome: "calculo",
  descricao:
    "Compõe números que **já foram apurados nesta conversa**: que percentual um é do outro, " +
    "quanto variou de um para o outro, a diferença, a soma, a média, e a projeção de um valor " +
    "mensal por N meses. Use quando quem pergunta quiser uma relação entre valores que você já " +
    "consultou — nunca calcule você mesmo. Os valores têm de vir de consultas anteriores: um " +
    "número que não saiu de consulta nenhuma é recusado, e a recusa é a resposta certa. " +
    "A projeção volta marcada como condicional; ela não é uma apuração do período projetado.",
  argumentos: {
    operacao: {
      tipo: "texto",
      descricao:
        "proporcao (a÷b×100) · variacao (do segundo para o primeiro, em %) · diferenca (a−b) · " +
        "soma · media · projecao (o primeiro valor × periodos)",
      opcoes: OPERACOES,
      obrigatorio: true,
    },
    valores: {
      tipo: "lista",
      descricao:
        "Os números, na ordem da operação, como vieram das consultas. Escreva-os como número " +
        '("52500" ou "52500.75"), não formatados. Em variacao o primeiro é o depois e o segundo é o antes.',
      obrigatorio: true,
    },
    rotulos: {
      tipo: "lista",
      descricao:
        "O nome de cada valor, na mesma ordem — o que ele é para quem perguntou: " +
        '"impacto de agosto", "receita apurada". É o que liga o resultado às consultas de origem.',
      obrigatorio: true,
    },
    grandeza: {
      tipo: "texto",
      descricao: "O que os valores são: dinheiro, percentual, ou contagem de alguma coisa.",
      opcoes: ["dinheiro", "percentual", "numero"],
    },
    periodos: {
      tipo: "inteiro",
      descricao: "Só para projecao: por quantos períodos projetar (12 = um ano de um valor mensal).",
      minimo: 1,
      maximo: 120,
    },
  },

  async executar(ctx, args) {
    const operacao = String(args.operacao).toUpperCase() as Operacao;
    const brutos = (args.valores as string[]) ?? [];
    const rotulos = (args.rotulos as string[]) ?? [];
    const grandeza: Grandeza =
      args.grandeza === "dinheiro" ? "MOEDA" : args.grandeza === "percentual" ? "PERCENTUAL" : "NUMERO";

    /*
      A leitura do operando é estrita: "R$ 52.500,00" não é um número, é um
      número já escrito. Aceitar a forma escrita aqui abriria a porta para
      reinterpretar formatação — e o produto tem um lugar só para isso, que é
      a formatação de saída.
    */
    const operandos: { rotulo: string; valor: number }[] = [];
    for (let i = 0; i < brutos.length; i++) {
      const n = Number(String(brutos[i]).replace(/\s/g, ""));
      if (!Number.isFinite(n)) {
        return {
          conteudo: {
            apurado: false,
            motivo: "CALCULO_NAO_APURADO",
            explicacao: `"${brutos[i]}" não é um número. Passe os valores como número, sem formatação.`,
          },
          evidencias: [],
        };
      }
      operandos.push({ rotulo: rotulos[i] ?? `valor ${i + 1}`, valor: n });
    }

    /*
      O lastro vem do que **esta conversa** apurou, e o executor é quem o
      entrega — como o recorte e os filtros. Deixá-lo entrar por argumento
      permitiria ao modelo declarar o próprio lastro, que é o mesmo que não ter
      lastro nenhum.
    */
    const apurados = grandezasApuradas(ctx.apurados?.() ?? []);
    if (apurados.length === 0) {
      return {
        conteudo: {
          apurado: false,
          motivo: "CALCULO_NAO_APURADO",
          explicacao:
            "Nenhuma consulta desta conversa apurou número nenhum ainda. " +
            "Consulte os valores antes de compô-los.",
        },
        evidencias: [],
      };
    }

    const r = calcular(
      {
        operacao,
        operandos,
        grandeza,
        ...(typeof args.periodos === "number" ? { fator: args.periodos } : {}),
      },
      apurados,
    );

    if (!r.apurado) return { conteudo: r, evidencias: [] };

    return {
      conteudo: {
        apurado: true,
        operacao: r.operacao,
        expressao: r.expressao,
        resultado: r.escrito,
        hipotetico: r.hipotetico,
        aPartirDe: r.de,
        ...(r.hipotetico
          ? { aviso: "Projeção condicional. Não diga que este valor foi apurado no período projetado." }
          : {}),
      },
      evidencias: [evidenciaDoCalculo(r)],
    };
  },
};
