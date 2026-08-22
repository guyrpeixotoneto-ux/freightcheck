/**
 * O cálculo derivado — determinístico, auditável, e preso ao que foi apurado.
 *
 * **O buraco que ele fecha.** "Quanto isso dá por ano?", "que percentual isso
 * representa?", "e a diferença entre os dois?" são perguntas de analista, e o
 * assistente tinha duas saídas para elas, as duas ruins: devolver um agregado
 * que não responde, ou recusar. A terceira — deixar o modelo calcular — é a
 * pior, e é a que este produto não faz: um número que o modelo somou não tem
 * onde ser conferido.
 *
 * **A regra que torna isto seguro.** A conta só roda sobre números que **já
 * têm lastro** nesta conversa. Cada operando é conferido contra o que as
 * consultas apuraram; um operando que não veio de consulta nenhuma não é
 * calculado — é recusado, com o nome de `CALCULO_NAO_APURADO`. Não há caminho
 * em que um número inventado entre de um lado e saia do outro travestido de
 * resultado.
 *
 * **Por que aqui e não no motor de domínio.** Nada disto é regra de negócio.
 * Somar duas parcelas, dividir uma pela outra, multiplicar por doze — é
 * aritmética sobre resultados que os motores já produziram, e reimplementar
 * impacto, cobertura ou DRE aqui seria a linha que este arquivo não cruza. O
 * que ele acrescenta é a operação que ninguém tinha: **compor** dois números
 * apurados.
 *
 * **A projeção é hipótese, e sai marcada como hipótese.** "Se continuar assim
 * por doze meses" não é uma apuração anual: é uma conta condicional sobre um
 * valor mensal. Ela é útil e ela não é fato, e a evidência que sai daqui diz
 * isso no título — porque a alternativa é um número anual indistinguível de um
 * apurado circulando numa apresentação.
 */

import type { Evidencia, Fato } from "./ferramentas";
import { INTEIRO, REAIS } from "./formato";

export type Operacao =
  /** a ÷ b × 100 — "que percentual isso representa?" */
  | "PROPORCAO"
  /** (depois − antes) ÷ |antes| × 100 — "quanto variou?" */
  | "VARIACAO"
  /** a − b — "qual a diferença?" */
  | "DIFERENCA"
  /** a + b + … — "quanto dá tudo somado?" */
  | "SOMA"
  /** (a + b + …) ÷ n — "qual a média?" */
  | "MEDIA"
  /** a × n — "se continuar assim por doze meses?" */
  | "PROJECAO";

/** A grandeza do resultado — é ela que a trava por tipo vai conferir. */
export type Grandeza = "MOEDA" | "PERCENTUAL" | "NUMERO";

export interface Operando {
  /** O nome de quem perguntou: "impacto de agosto", "receita apurada". */
  rotulo: string;
  valor: number;
}

export interface PedidoDeCalculo {
  operacao: Operacao;
  operandos: Operando[];
  /** Para PROJECAO: por quantos períodos. */
  fator?: number | undefined;
  /** A grandeza dos operandos, quando quem chama a conhece. */
  grandeza?: Grandeza | undefined;
}

export type ResultadoDoCalculo =
  | {
      apurado: true;
      operacao: Operacao;
      /** "R$ 52.500,00 ÷ R$ 84.300,00 × 100 = 62,28%" — a conta por extenso. */
      expressao: string;
      valor: number;
      grandeza: Grandeza;
      /** O resultado como se escreve, já com o tipo declarado. */
      escrito: string;
      /** Verdadeiro para PROJECAO: o número é condicional, não apurado. */
      hipotetico: boolean;
      /** Os rótulos dos operandos — a ligação com as evidências de entrada. */
      de: string[];
    }
  | {
      apurado: false;
      motivo: "CALCULO_NAO_APURADO";
      explicacao: string;
    };

/**
 * As grandezas que este conjunto de evidências autoriza usar como operando.
 *
 * A mesma fonte da trava de lastro: os valores crus e cada número escrito nos
 * fatos. Um operando fora disto não veio de consulta nenhuma.
 */
export function grandezasApuradas(evidencias: readonly Evidencia[]): number[] {
  const saida: number[] = [];
  const daFrase = (texto: string | undefined) => {
    if (!texto) return;
    for (const t of texto.match(/\d[\d.,]*\d|\d/g) ?? []) {
      const n = Number(
        t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/\.(?=\d{3}\b)/g, ""),
      );
      if (Number.isFinite(n)) saida.push(Math.abs(n));
    }
  };

  for (const e of evidencias) {
    for (const n of e.numeros) saida.push(Math.abs(n));
    for (const f of e.fatos) {
      daFrase(f.valor);
      daFrase(f.detalhe);
    }
  }
  return saida;
}

/**
 * O operando tem lastro?
 *
 * A tolerância é a mesma que a trava aceita no outro sentido: o valor pode
 * chegar arredondado às casas com que foi escrito. Sem ela, um operando lido de
 * "R$ 28,5 mil" nunca casaria com o apurado de 28.511,24 — e a recusa seria
 * pela formatação, não pela procedência.
 */
export function temLastro(valor: number, apurados: readonly number[]): boolean {
  const alvo = Math.abs(valor);
  if (apurados.some((v) => v === alvo)) return true;
  for (const casas of [0, 1, 2]) {
    const p = 10 ** casas;
    if (apurados.some((v) => Math.round(v * p) / p === Math.round(alvo * p) / p)) return true;
  }
  for (const fator of [1_000, 1_000_000]) {
    if (apurados.some((v) => Math.round((v / fator) * 100) / 100 === Math.round(alvo * 100) / 100)) {
      return true;
    }
  }
  return false;
}

function escrever(valor: number, grandeza: Grandeza): string {
  if (grandeza === "MOEDA") {
    const sinal = valor < 0 ? "−" : "";
    return `${sinal}${REAIS.format(Math.abs(valor))}`;
  }
  if (grandeza === "PERCENTUAL") {
    const n = Number(valor.toFixed(2));
    return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  return INTEIRO.format(Number(valor.toFixed(2)));
}

const QUANTOS: Record<Operacao, { minimo: number; maximo: number }> = {
  PROPORCAO: { minimo: 2, maximo: 2 },
  VARIACAO: { minimo: 2, maximo: 2 },
  DIFERENCA: { minimo: 2, maximo: 2 },
  PROJECAO: { minimo: 1, maximo: 1 },
  SOMA: { minimo: 2, maximo: 24 },
  MEDIA: { minimo: 2, maximo: 24 },
};

/**
 * A conta, feita aqui e conferida contra o que foi apurado.
 *
 * Nunca lança: um pedido impossível é uma resposta — `CALCULO_NAO_APURADO`, com
 * a razão dita —, porque a alternativa é o chamador tratar exceção e a pior
 * saída disso é o silêncio.
 */
export function calcular(
  pedido: PedidoDeCalculo,
  apurados: readonly number[],
): ResultadoDoCalculo {
  const naoApurado = (explicacao: string): ResultadoDoCalculo => ({
    apurado: false,
    motivo: "CALCULO_NAO_APURADO",
    explicacao,
  });

  const limites = QUANTOS[pedido.operacao];
  if (!limites) return naoApurado(`operação desconhecida: ${String(pedido.operacao)}`);
  if (pedido.operandos.length < limites.minimo || pedido.operandos.length > limites.maximo) {
    return naoApurado(
      `${pedido.operacao} precisa de ${limites.minimo}` +
        `${limites.maximo !== limites.minimo ? ` a ${limites.maximo}` : ""} ` +
        `valor(es); vieram ${pedido.operandos.length}`,
    );
  }

  /*
    O gate. Um operando sem lastro não é calculado — nem com aviso, nem com
    ressalva. É o que impede a conta de virar a porta dos fundos por onde um
    número inventado entra travestido de resultado.
  */
  const semLastro = pedido.operandos.filter((o) => !temLastro(o.valor, apurados));
  if (semLastro.length > 0) {
    return naoApurado(
      "estes valores não saíram de nenhuma consulta desta conversa: " +
        semLastro.map((o) => `${o.rotulo} (${o.valor})`).join(", ") +
        ". Consulte-os antes de compor.",
    );
  }

  const v = pedido.operandos.map((o) => o.valor);
  const r = pedido.operandos.map((o) => o.rotulo);
  const g: Grandeza = pedido.grandeza ?? "NUMERO";

  switch (pedido.operacao) {
    case "PROPORCAO": {
      if (v[1] === 0) return naoApurado("a base da proporção é zero; a divisão não tem resultado");
      const valor = (Math.abs(v[0]!) / Math.abs(v[1]!)) * 100;
      return {
        apurado: true,
        operacao: "PROPORCAO",
        expressao: `${escrever(v[0]!, g)} ÷ ${escrever(v[1]!, g)} × 100 = ${escrever(valor, "PERCENTUAL")}`,
        valor,
        grandeza: "PERCENTUAL",
        escrito: escrever(valor, "PERCENTUAL"),
        hipotetico: false,
        de: r,
      };
    }
    case "VARIACAO": {
      /* Convenção: o primeiro operando é o **depois**, o segundo é o **antes**. */
      if (v[1] === 0) return naoApurado("a base da variação é zero; a variação percentual não existe");
      const valor = ((v[0]! - v[1]!) / Math.abs(v[1]!)) * 100;
      return {
        apurado: true,
        operacao: "VARIACAO",
        expressao:
          `(${escrever(v[0]!, g)} − ${escrever(v[1]!, g)}) ÷ ${escrever(Math.abs(v[1]!), g)} × 100 ` +
          `= ${escrever(valor, "PERCENTUAL")}`,
        valor,
        grandeza: "PERCENTUAL",
        escrito: escrever(valor, "PERCENTUAL"),
        hipotetico: false,
        de: r,
      };
    }
    case "DIFERENCA": {
      const valor = v[0]! - v[1]!;
      return {
        apurado: true,
        operacao: "DIFERENCA",
        expressao: `${escrever(v[0]!, g)} − ${escrever(v[1]!, g)} = ${escrever(valor, g)}`,
        valor,
        grandeza: g,
        escrito: escrever(valor, g),
        hipotetico: false,
        de: r,
      };
    }
    case "SOMA": {
      const valor = v.reduce((s, x) => s + x, 0);
      return {
        apurado: true,
        operacao: "SOMA",
        expressao: `${v.map((x) => escrever(x, g)).join(" + ")} = ${escrever(valor, g)}`,
        valor,
        grandeza: g,
        escrito: escrever(valor, g),
        hipotetico: false,
        de: r,
      };
    }
    case "MEDIA": {
      const soma = v.reduce((s, x) => s + x, 0);
      const valor = soma / v.length;
      return {
        apurado: true,
        operacao: "MEDIA",
        expressao: `(${v.map((x) => escrever(x, g)).join(" + ")}) ÷ ${v.length} = ${escrever(valor, g)}`,
        valor,
        grandeza: g,
        escrito: escrever(valor, g),
        hipotetico: false,
        de: r,
      };
    }
    case "PROJECAO": {
      const fator = pedido.fator;
      if (!fator || !Number.isFinite(fator) || fator <= 0 || fator > 120) {
        return naoApurado("a projeção precisa de quantos períodos, entre 1 e 120");
      }
      const valor = v[0]! * fator;
      return {
        apurado: true,
        operacao: "PROJECAO",
        expressao: `${escrever(v[0]!, g)} × ${fator} = ${escrever(valor, g)}`,
        valor,
        grandeza: g,
        escrito: escrever(valor, g),
        /*
          A marca que impede o número condicional de circular como apurado.
          Quem monta a evidência lê este campo e escreve "se continuar assim"
          no título — não como enfeite, mas porque é a única coisa que separa
          uma projeção de uma medição na leitura de quem recebe a resposta.
        */
        hipotetico: true,
        de: r,
      };
    }
  }
}

/**
 * O cálculo como evidência — para a trava conferir e a tela mostrar a conta.
 *
 * O resultado entra **formatado com o tipo declarado** (`%`, `R$`), e é isso
 * que autoriza a frase correspondente na régua por tipo. Uma evidência que
 * devolvesse só o número cru autorizaria um percentual sem ninguém ter
 * calculado percentual nenhum, que é o defeito que a régua nova fecha.
 */
export function evidenciaDoCalculo(
  r: Extract<ResultadoDoCalculo, { apurado: true }>,
): Evidencia {
  const fatos: Fato[] = [
    { rotulo: r.hipotetico ? "Projeção (não apurado)" : "Resultado", valor: r.escrito },
    { rotulo: "Conta", valor: r.expressao },
    { rotulo: "A partir de", valor: r.de.join(" · ") },
  ];

  return {
    ferramenta: `calculo:${r.operacao.toLowerCase()}`,
    titulo: r.hipotetico
      ? `Projeção — ${r.expressao} (condicional, não apurado)`
      : `Cálculo — ${r.expressao}`,
    fatos,
    /*
      O valor cheio **e** o valor como ele é escrito.

      62,2775800711…% é o resultado da divisão; `62,28%` é o que a pessoa lê.
      Autorizar só o primeiro deixaria a resposta que repete o número mostrado
      sem lastro — a conta certa, feita no lugar certo, e a frase podada. E
      autorizar só o segundo perderia a precisão para uma composição seguinte.
      Autorização se acrescenta, nunca se retira.
    */
    numeros: [r.valor, Number(r.valor.toFixed(2))],
    origem: "cálculo determinístico sobre valores já apurados nesta conversa",
    ...(r.hipotetico
      ? {
          nota:
            "Projeção sobre um valor apurado: vale enquanto a condição se mantiver. " +
            "Não é uma apuração do período projetado.",
        }
      : {}),
  };
}

// ── O caminho determinístico: da frase ao pedido de cálculo ─────────────────

/**
 * Qual composição a frase pede.
 *
 * Quatro formas, e não uma por pergunta. O detector do plano já decidiu que
 * **é** um cálculo derivado; o que falta é qual dos quatro, e isso está no
 * vocabulário da própria frase: projetar, proporção, média, diferença. Uma
 * quinta forma não se acrescenta com um `if` — ela é uma operação nova em
 * `Operacao`, com a conta escrita ao lado.
 */
export function operacaoDaFrase(frase: string): { operacao: Operacao; fator?: number } | null {
  const f = frase
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/\b(por ano|ao ano|anualiz|em 12 meses|em doze meses|se continuar|se (isso|se) manti|projet|extrapol)/.test(f)) {
    const meses = f.match(/\b(\d{1,3})\s*mes/);
    return { operacao: "PROJECAO", fator: meses ? Number(meses[1]) : 12 };
  }
  if (/\b(percentual|porcentagem|por cento|proporcao|fracao|representa)/.test(f)) {
    return /\bvaria/.test(f) ? { operacao: "VARIACAO" } : { operacao: "PROPORCAO" };
  }
  if (/\bmedia\b/.test(f)) return { operacao: "MEDIA" };
  if (/\bdiferenca\b/.test(f)) return { operacao: "DIFERENCA" };
  return null;
}

/**
 * O que a frase está compondo, e contra o quê — lido do que a conversa apurou.
 *
 * **O primeiro operando é o foco**: "isso" é o item de que a conversa está
 * falando, e o foco é justamente esse item por referência (ver `foco.ts`).
 *
 * **O segundo, quando a operação precisa dele, é a base.** Ela é procurada
 * entre os fatos das evidências anteriores pelo que ela é — total, base,
 * receita, resultado apurado do recorte — e não pela posição. Quando não há
 * uma base identificável, isto **não escolhe uma**: devolve a lista do que há,
 * e quem responde pergunta qual. Escolher a base errada produziria um
 * percentual perfeitamente formatado sobre a coisa errada, que é a forma mais
 * difícil de detectar de uma resposta errada.
 */
export interface OperandosDoFio {
  operandos: Operando[];
  grandeza: Grandeza;
  /** Quando faltou operando: o que existe para compor, para quem responde perguntar. */
  disponiveis: { rotulo: string; escrito: string }[];
}

/** Os rótulos que declaram uma base — o denominador natural de uma proporção. */
const BASE = /\b(total|base|receita|apurad|consolidad|frota inteira|do periodo)\b/i;

export function operandosDoFio(
  operacao: Operacao,
  foco: { rotulo: string; valor: { numero: number; escrito: string; grandeza: Grandeza } | null } | null,
  anteriores: readonly Evidencia[],
): OperandosDoFio {
  const disponiveis: { rotulo: string; escrito: string }[] = [];
  for (const e of anteriores) {
    for (const f of e.fatos) {
      if (!f.interno && /\d/.test(f.valor)) disponiveis.push({ rotulo: f.rotulo, escrito: f.valor });
    }
  }

  if (!foco?.valor) return { operandos: [], grandeza: "NUMERO", disponiveis };

  const primeiro: Operando = { rotulo: foco.rotulo, valor: foco.valor.numero };
  const grandeza = foco.valor.grandeza;

  if (QUANTOS[operacao].minimo === 1) return { operandos: [primeiro], grandeza, disponiveis };

  for (const e of anteriores) {
    for (const f of e.fatos) {
      if (f.interno || !BASE.test(f.rotulo) || !/\d/.test(f.valor)) continue;
      const bruto = f.valor.match(/\d[\d.,]*/)?.[0];
      if (!bruto) continue;
      const n = Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto.replace(/\.(?=\d{3}\b)/g, ""));
      if (!Number.isFinite(n) || Math.abs(n) === Math.abs(primeiro.valor)) continue;
      return { operandos: [primeiro, { rotulo: f.rotulo, valor: n }], grandeza, disponiveis };
    }
  }

  return { operandos: [primeiro], grandeza, disponiveis };
}
