import {
  ROTULO_DO_RECORTE,
  periodicidadeDaLeitura,
  periodicidadePrincipal,
  temMaisDeUmaPeriodicidade,
  type EstadoDaApuracao,
  type LeituraDeImpacto,
  type PeriodicidadeApurada,
  type TipoDeRecorte,
} from "@workspace/comparison/contrato-de-impacto";
import { periodicitySuffix } from "@workspace/comparison/labels";
import { formatBrlShort } from "@/lib/format";

/**
 * O CONTRATO DE IMPACTO NA INTERFACE — as frases, e nada além delas.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo não calcula nada
 * ---------------------------------------------------------------------------
 * A leitura chega pronta do servidor (`LeituraDeImpacto`, montada em
 * `lib/comparison/src/contrato-de-impacto.ts`). O que falta é **como dizê-la**,
 * e é só isso o que mora aqui: qual frase cada estado recebe, como o par é
 * nomeado, como a periodicidade viaja colada ao número.
 *
 * A separação não é organizacional. Enquanto a decisão de "o que posso
 * afirmar" morava em cada componente, quatro superfícies da mesma tela
 * afirmavam coisas diferentes sobre o mesmo dinheiro — e nenhuma sabia da
 * outra. Qualquer regra nova sobre zero, cobertura ou periodicidade pertence ao
 * domínio; qualquer palavra nova pertence a este arquivo. Um componente que
 * precise de uma terceira coisa está prestes a recriar a divergência.
 *
 * ---------------------------------------------------------------------------
 * Os dois estados que o servidor não tem
 * ---------------------------------------------------------------------------
 * `EstadoDaApuracao` descreve o **dado**. Uma tela também pode estar sem dado
 * nenhum — esperando, ou diante de uma falha —, e esses dois não são estados do
 * dado: são a ausência dele. Misturá-los no mesmo tipo é como um erro de rede
 * vira `R$ 0` na tela, que é a pior das mentiras possíveis aqui, porque é a
 * única indistinguível de uma resposta verdadeira.
 */

export type {
  EstadoDaApuracao,
  LeituraDeImpacto,
  PeriodicidadeApurada,
  TipoDeRecorte,
};
export { ROTULO_DO_RECORTE, periodicidadeDaLeitura, periodicidadePrincipal, temMaisDeUmaPeriodicidade };

/**
 * O que a tela tem em mãos: uma leitura, uma espera, ou uma falha.
 *
 * `CARREGANDO` e `ERRO` **não** são estados de apuração, e por isso não estão
 * em `EstadoDaApuracao`: eles não afirmam nada sobre o dinheiro. É esta
 * separação que impede um `catch` de virar zero.
 */
export type EstadoEmTela =
  | { situacao: "CARREGANDO" }
  | { situacao: "ERRO"; detalhe?: string }
  | { situacao: "LIDO"; leitura: LeituraDeImpacto };

/** A leitura quando ela existe — `null` na espera e na falha. */
export function leituraDe(estado: EstadoEmTela): LeituraDeImpacto | null {
  return estado.situacao === "LIDO" ? estado.leitura : null;
}

/**
 * A tela em que a leitura vira frase.
 *
 * `titulo` é o que substitui o número quando não há número a publicar;
 * `detalhe` é a linha de baixo, que diz por quê. Os dois juntos são o que
 * separa os quatro zeros que a tela publicava como um só.
 */
export interface FraseDaLeitura {
  /** O título quando não há valor a publicar. `null` quando há. */
  titulo: string | null;
  detalhe: string;
  /** Publicar um valor em dinheiro é honesto neste estado? */
  publicaValor: boolean;
  /** O valor publicado está incompleto e precisa da cobertura ao lado. */
  parcial: boolean;
}

const SEM_DADO: Record<"CARREGANDO" | "ERRO", FraseDaLeitura> = {
  CARREGANDO: {
    titulo: "Carregando o impacto…",
    detalhe: "A apuração desta comparação ainda está sendo lida.",
    publicaValor: false,
    parcial: false,
  },
  ERRO: {
    titulo: "Não foi possível carregar o impacto",
    detalhe:
      "A leitura falhou — isto não quer dizer que o impacto seja zero. " +
      "Tente de novo; se persistir, o dado não chegou até aqui.",
    publicaValor: false,
    parcial: false,
  },
};

/**
 * A frase de cada estado — **a única redação** destas quatro afirmações.
 *
 * Elas eram cinco redações diferentes em cinco componentes, e três delas
 * usavam a mesma palavra para fatos opostos: "sem impacto" dizia tanto "a conta
 * deu zero" quanto "ninguém fez a conta".
 */
export function fraseDaLeitura(estado: EstadoEmTela): FraseDaLeitura {
  if (estado.situacao !== "LIDO") return SEM_DADO[estado.situacao];
  const { leitura } = estado;

  switch (leitura.estado) {
    case "SEM_ALTERACAO":
      return {
        titulo: "Nada mudou",
        detalhe: "Não há alteração nenhuma entre estas duas vigências.",
        publicaValor: false,
        parcial: false,
      };

    case "NAO_CALCULAVEL":
      return {
        titulo: "Impacto financeiro ainda não calculado",
        detalhe:
          `${inteiro(leitura.totais.alteracoes)} ${plural(leitura.totais.alteracoes, "alteração", "alterações")} ` +
          `${plural(leitura.totais.alteracoes, "foi detectada", "foram detectadas")} e nenhuma delas tem preço apurado. ` +
          "O resultado não é zero: ele é desconhecido.",
        publicaValor: false,
        parcial: false,
      };

    case "PARCIALMENTE_CALCULADO":
      return {
        titulo: null,
        detalhe:
          `Impacto parcial · ${inteiro(leitura.totais.calculadas)} de ${inteiro(leitura.totais.alteracoes)} ` +
          `alterações calculadas · cobertura de ${percentual(leitura.cobertura?.percentual ?? 0)}. ` +
          `${inteiro(leitura.totais.naoCalculaveis)} ${plural(leitura.totais.naoCalculaveis, "alteração aguarda", "alterações aguardam")} apuração.`,
        publicaValor: true,
        parcial: true,
      };

    case "CALCULADO":
      return {
        titulo: null,
        detalhe:
          leitura.periodicidades.some((p) => p.temMovimento)
            ? `Todas as ${inteiro(leitura.totais.alteracoes)} alterações foram apuradas.`
            : `Sem alteração financeira: as ${inteiro(leitura.totais.alteracoes)} alterações foram apuradas e não moveram o valor.`,
        publicaValor: true,
        parcial: false,
      };
  }
}

/**
 * O par, escrito — `julho/2026 → agosto/2026 · 1ª quinzena`.
 *
 * Todo cartão, gráfico e tabela de comparação mostra isto. Era o que faltava
 * para que o número do cartão e o número do seletor parassem de parecer o
 * mesmo: eles nunca foram, e nada na tela dizia qual era qual.
 */
export function rotuloDoPar(leitura: LeituraDeImpacto): string {
  if (leitura.pontaDePorUnidade) {
    return `${leitura.para.label} · cada unidade contra a anterior dela`;
  }
  if (leitura.de === null) return `${leitura.para.label} · primeira do histórico`;
  return `${leitura.de.label} → ${leitura.para.label}`;
}

/** O recorte, em duas palavras, para ir colado ao número. */
export function rotuloDoRecorte(leitura: LeituraDeImpacto): string {
  return ROTULO_DO_RECORTE[leitura.recorte];
}

/**
 * O aviso do par salteado — `null` quando ele é consecutivo.
 *
 * Um par com vigências no meio publica o que **dois ou mais passos somaram**, e
 * a frase "o que esta vigência custou" deixa de ser verdadeira ali. Quem lê
 * precisa saber disso antes de usar o número.
 */
export function avisoDeSalteado(leitura: LeituraDeImpacto): string | null {
  if (leitura.consecutivo || leitura.de === null) return null;
  const n = leitura.intermediarias.length;
  if (n === 0) {
    return (
      "Comparação não consecutiva: estas duas vigências não se sucedem no histórico, " +
      "e o resultado é o que o caminho entre elas somou."
    );
  }
  return (
    `Comparação não consecutiva: ${n === 1 ? "existe uma vigência intermediária" : `existem ${inteiro(n)} vigências intermediárias`} ` +
    `que ${n === 1 ? "não está incluída" : "não estão incluídas"} como etapa isolada nesta comparação.`
  );
}

/** O aviso da volta — `null` quando o par está na direção do histórico. */
export function avisoDeInversao(leitura: LeituraDeImpacto): string | null {
  return leitura.invertido
    ? "Comparação invertida: a ponta de partida é posterior à de chegada, e a variação percentual não é o inverso da ida."
    : null;
}

/**
 * O dinheiro com a unidade colada — `−R$ 39.936/mês`.
 *
 * A periodicidade **nunca** some nesta redução: é ela que diz se o número
 * acontece toda vez ou uma vez só, e `R$ 39.936` sem o `/mês` é outra frase.
 */
export function escreverValor(p: PeriodicidadeApurada): string {
  return `${formatBrlShort(p.liquido)}${periodicitySuffix(p.periodicity)}`;
}

/**
 * As periodicidades que a tela precisa publicar, na ordem do contrato.
 *
 * Quem tem espaço para uma só usa a primeira **e** escreve a linha de
 * {@link avisoDeOutrasPeriodicidades}: R$/mês e R$/ano não somam, e sumir com
 * uma delas é o defeito que o gráfico tinha.
 */
export function periodicidadesComMovimento(
  leitura: LeituraDeImpacto,
): PeriodicidadeApurada[] {
  return leitura.periodicidades.filter((p) => p.temMovimento);
}

/** A linha que impede a segunda grandeza de sumir — `null` quando só há uma. */
export function avisoDeOutrasPeriodicidades(
  leitura: LeituraDeImpacto,
  publicada: string | null,
): string | null {
  const outras = periodicidadesComMovimento(leitura).filter(
    (p) => p.periodicity !== publicada,
  );
  if (outras.length === 0) return null;
  return (
    `Esta comparação também tem ${outras.map(escreverValor).join(" e ")} — ` +
    "grandezas que não somam com a de cima."
  );
}

const INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const inteiro = (n: number) => INTEIRO.format(n);
const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);
const percentual = (n: number) =>
  `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
