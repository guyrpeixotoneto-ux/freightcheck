/**
 * A trava de lastro, por **tipo de afirmação** — e não só por dígito.
 *
 * **O risco que este módulo fecha.** A conferência anterior perguntava uma coisa
 * só: "este número existe em algum lugar do dossiê?". A pergunta certa é outra:
 * "*esta afirmação* existe no dossiê?". As duas divergem exatamente onde mais
 * dói. Um dossiê que apurou `62 veículos` autorizava a frase `62%`, porque os
 * dígitos batem; um que apurou `R$ 52.500` autorizava `52.500 veículos`. Nos
 * dois casos a trava aprova uma afirmação que ninguém apurou, e ela aprova com
 * a mesma confiança com que aprova as verdadeiras.
 *
 * **A correção é cirúrgica de propósito.** Ela não substitui a régua antiga: a
 * régua antiga continua valendo para todo número escrito **sem tipo declarado**
 * — "o impacto foi de 28.511,24" segue conferido exatamente como antes. O que
 * este módulo acrescenta são duas recusas, e só duas:
 *
 * 1. **Percentual precisa de percentual.** Uma afirmação em `%` só passa se o
 *    dossiê tiver escrito aquela grandeza com `%`. Percentual é grandeza
 *    derivada: ou uma ferramenta o calculou e o formatou, ou o cálculo derivado
 *    o produziu (ver `calculo.ts`). Dígito solto nunca vira percentual.
 * 2. **Contagem não sai de dinheiro.** Uma grandeza que o dossiê declarou
 *    **só** como dinheiro não autoriza uma contagem com o mesmo número.
 *
 * Tudo o mais passa como passava. É por isso que esta mudança pode ser feita
 * sem afrouxar nada e sem descartar resposta correta: ela não retira
 * autorização de nenhuma afirmação que o dossiê sustente.
 *
 * **O que ela não faz.** Não confere o *sentido* — se o percentual é do total
 * certo, se a contagem é da frota certa. Isso é trabalho da evidência, não da
 * trava. A trava responde uma pergunta menor e exata: quem lê tem onde
 * conferir esta afirmação, na forma em que ela foi escrita?
 */

/**
 * O tipo que o **próprio texto** declara para um número.
 *
 * `INDEFINIDO` não é uma falha da classificação: é a maioria dos números de uma
 * resposta boa, e é o caso que segue pela régua antiga. Tipar por adivinhação o
 * que o texto não declarou seria inventar rigor.
 */
export type TipoDeAfirmacao =
  /** "R$ 52.500", "52.500 reais" */
  | "MOEDA"
  /** "62%", "62 por cento", "3 p.p." */
  | "PERCENTUAL"
  /** "62 veículos", "267 alterações" — número seguido do que ele conta. */
  | "CONTAGEM"
  /** Uma placa. Conferida por `identificadoresSemLastro`, não aqui. */
  | "IDENTIFICADOR"
  /** "01/08/2026", "2026-08-01" — conferida pela régua de datas. */
  | "DATA"
  /** Sem tipo declarado — segue pela conferência por token. */
  | "INDEFINIDO";

export interface Afirmacao {
  /** O número como está escrito, com a formatação que o texto usou. */
  escrito: string;
  /** A grandeza, sempre positiva: sinal é direção, não outra quantidade. */
  valor: number;
  tipo: TipoDeAfirmacao;
  /** O trecho que declarou o tipo — para o painel dizer por que recusou. */
  contexto: string;
}

/**
 * O que uma contagem conta, neste produto.
 *
 * É vocabulário de domínio, não uma lista de perguntas: nenhum item aqui
 * responde a uma pergunta do benchmark, e acrescentar um não faz nenhuma
 * pergunta passar. O que a lista decide é quando um número escrito no texto
 * **declara** que é uma contagem — e é só nesse caso que a régua nova opina.
 */
const CONTADOS =
  "veiculos?|caminhoes|caminhao|cavalos?|carretas?|implementos?|placas?|" +
  "alteracoes|alteracao|mudancas?|diferencas?|divergencias?|" +
  "parametros?|atributos?|colunas?|gavetas?|itens|item|linhas?|registros?|" +
  "unidades?|vigencias?|blocos?|secoes|secao|ativos?|componentes?|" +
  "celulas?|importacoes|importacao|arquivos?|documentos?|revisoes|revisao|" +
  "dias?|meses|mes|semanas?|contratos?|operacoes|operacao|" +
  "transportadoras?|escopos?|canais|canal|familias?|conjuntos?";

/** Sem acento e em minúsculas — a comparação de vocabulário é feita aqui. */
function dobrar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * O número escrito em pt-BR, como grandeza.
 *
 * "28.511,24" → 28511.24; "3,4" → 3.4; "1.234" → 1234. O ponto é milhar e a
 * vírgula é decimal, que é a convenção em que este produto escreve — e desfazer
 * isso é o único jeito de comparar grandeza em vez de string.
 */
export function comoGrandeza(escrito: string): number {
  const limpo = escrito.replace(/\s/g, "");
  const temVirgula = limpo.includes(",");
  const normal = temVirgula ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/\.(?=\d{3}\b)/g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

/** A forma de uma placa. A mesma de `orquestrador.ts`. */
const PLACA = /\b[A-Z]{3}\d[A-Z0-9]\d{2}\b/gi;
/** As formas de data que este produto escreve. */
const DATA = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{4})\b/g;

const NUMERO = /\d[\d.,]*\d|\d/g;

/**
 * As afirmações numéricas de um texto, com o tipo que ele declarou para cada.
 *
 * A classificação é por **adjacência**, e isso é uma escolha: só o que está
 * colado ao número declara o tipo dele. `R$` antes, `%` ou o nome do que se
 * conta depois. Olhar a frase inteira acharia um `%` distante e tiparia como
 * percentual um número que não é — trocar um erro por outro não é corrigir.
 */
export function afirmacoesDoTexto(texto: string): Afirmacao[] {
  const semPlaca = texto.replace(PLACA, (m) => " ".repeat(m.length));
  const semData = semPlaca.replace(DATA, (m) => " ".repeat(m.length));
  // `[3]` é a terceira fonte, não a quantia três.
  const base = semData.replace(/\[\d{1,2}\]/g, (m) => " ".repeat(m.length));

  const saida: Afirmacao[] = [];
  for (const achado of base.matchAll(NUMERO)) {
    const escrito = achado[0]!;
    const i = achado.index!;
    const antes = dobrar(base.slice(Math.max(0, i - 14), i));
    const depois = dobrar(base.slice(i + escrito.length, i + escrito.length + 26));

    const valor = comoGrandeza(escrito);
    if (!Number.isFinite(valor)) continue;

    let tipo: TipoDeAfirmacao = "INDEFINIDO";
    if (/(^|[^a-z])(r\$|rs)\s*$/.test(antes)) tipo = "MOEDA";
    else if (/^\s*(reais|mil reais)\b/.test(depois)) tipo = "MOEDA";
    if (/^\s*(%|por\s?cento|p\.?p\.?\b)/.test(depois)) tipo = "PERCENTUAL";
    else if (tipo === "INDEFINIDO" && new RegExp(`^\\s*(${CONTADOS})\\b`).test(depois)) {
      tipo = "CONTAGEM";
    }

    if (tipo === "INDEFINIDO") continue;
    saida.push({ escrito, valor, tipo, contexto: `${antes.trim()}${escrito}${depois.split(/\s+/).slice(0, 3).join(" ")}` });
  }
  return saida;
}

/**
 * O que o dossiê **declarou** sobre cada grandeza.
 *
 * Duas listas, e o que fica de fora delas importa tanto quanto o que entra:
 * um número que o dossiê traz sem formatação nenhuma não entra em nenhuma das
 * duas, e por isso não sofre nem se beneficia da régua nova. Ele segue pela
 * conferência por token, exatamente como antes.
 */
export interface Autorizacoes {
  /** Grandezas que o dossiê escreveu com `%`. */
  percentual: number[];
  /** Grandezas que o dossiê escreveu com `R$`. */
  moeda: number[];
  /** Grandezas que o dossiê escreveu como contagem de alguma coisa. */
  contagem: number[];
}

/** Um texto do dossiê, lido como fonte de autorização. */
export function autorizacoesDoTexto(texto: string, para: Autorizacoes): void {
  for (const a of afirmacoesDoTexto(texto)) {
    if (a.tipo === "PERCENTUAL") para.percentual.push(a.valor);
    if (a.tipo === "MOEDA") para.moeda.push(a.valor);
    if (a.tipo === "CONTAGEM") para.contagem.push(a.valor);
  }
}

/**
 * O mesmo arredondamento que a régua por token já aceitava.
 *
 * "R$ 28,5 mil" para 28.511,24 continua passando, e é assim que se escreve em
 * português. A tolerância é sempre pelo lado do texto: arredonda-se o valor
 * apurado às casas que a frase usou, nunca o contrário.
 */
function bate(alvo: number, autorizados: readonly number[], escrito: string): boolean {
  const casas = (escrito.split(/[.,]/)[1] ?? "").length;
  const potencia = 10 ** casas;
  return autorizados.some((v) => {
    if (v === alvo) return true;
    if (Math.round(v * potencia) / potencia === alvo) return true;
    /*
      A escala escrita por extenso — "R$ 52,5 mil" — é conferida contra a
      grandeza dividida. Sem isto, a forma como um analista escreve dinheiro
      seria sempre recusada pela régua nova, e a régua nova passaria a
      descartar resposta boa, que é o que ela não pode fazer.
    */
    for (const fator of [1_000, 1_000_000]) {
      if (Math.round((v / fator) * potencia) / potencia === alvo) return true;
    }
    return false;
  });
}

/**
 * As afirmações **tipadas** que o dossiê não sustenta.
 *
 * Devolve a razão por extenso, e não só o número: "62% (o dossiê apurou 62 como
 * contagem, não como percentual)" é diagnosticável; "62" não é. É a mesma
 * decisão que separou placa de número — o motivo da recusa dito com o nome
 * certo.
 */
export function afirmacoesSemLastro(texto: string, autorizado: Autorizacoes): string[] {
  const recusadas: string[] = [];

  for (const a of afirmacoesDoTexto(texto)) {
    if (a.tipo === "PERCENTUAL") {
      /*
        Percentual é grandeza derivada: ou uma consulta o calculou e o escreveu
        com `%`, ou o cálculo derivado o produziu. Não existe caminho em que ele
        apareça de um dígito que por acaso coincide.
      */
      if (!bate(a.valor, autorizado.percentual, a.escrito)) {
        const comoVeio = bate(a.valor, autorizado.moeda, a.escrito)
          ? " — o dossiê traz essa grandeza como dinheiro, não como percentual"
          : bate(a.valor, autorizado.contagem, a.escrito)
            ? " — o dossiê traz essa grandeza como contagem, não como percentual"
            : " — nenhuma consulta apurou esse percentual";
        recusadas.push(`${a.escrito}%${comoVeio}`);
      }
      continue;
    }

    if (a.tipo === "CONTAGEM") {
      /*
        A recusa é estreita de propósito: só quando o dossiê declarou aquela
        grandeza **como dinheiro** e não a declarou como contagem em lugar
        nenhum. Um número que o dossiê traz sem formatação continua passando
        pela régua por token, como sempre passou.
      */
      const soDinheiro =
        bate(a.valor, autorizado.moeda, a.escrito) && !bate(a.valor, autorizado.contagem, a.escrito);
      if (soDinheiro) {
        recusadas.push(`${a.escrito} (contagem) — o dossiê apurou esse valor em dinheiro`);
      }
      continue;
    }
  }

  return [...new Set(recusadas)];
}
