/**
 * O farol do equipamento — e por que ele acende.
 *
 * Um status de cor é a coisa mais fácil de inventar num produto e a mais cara
 * de manter honesta: quem olha para a bolinha decide se abre o registro, e uma
 * bolinha que acende pelo motivo errado ensina a pessoa a ignorá-la. Por isso
 * as regras estão aqui, em código, com o limiar nomeado, e a avaliação devolve
 * **os motivos** junto com a cor. A tela nunca mostra o farol sem poder dizer
 * o que o acendeu.
 *
 * **O que o farol deliberadamente não mede: completude.** A tentação era pintar
 * de amarelo todo equipamento com componente sem regra financeira — e nesta
 * base isso seria *todo* equipamento, porque `valorPneu`, `seguro` e uma dúzia
 * de outras colunas continuam sem semântica confirmada. Um farol que está
 * sempre amarelo não informa nada. A completude é uma dimensão própria, dita
 * com números em "R$ X apurados · Y componentes sem regra", que melhora com a
 * curadoria e não compete com o farol. O farol mede **movimento e
 * integridade**: mudou? fecha?
 */

import type { AlertaDeIntegridade, Variacao } from "./motor";

export type Farol = "NORMAL" | "ATENCAO" | "CRITICO" | "INCOMPLETO";

export interface StatusDoEquipamento {
  farol: Farol;
  /** Uma frase por motivo, na ordem em que pesaram. Vazio só em NORMAL. */
  motivos: string[];
  /** Quantos motivos há — é o número da coluna "Alertas". */
  alertas: number;
}

/**
 * A variação percentual a partir da qual um movimento deixa de ser rotina.
 *
 * Dez por cento no valor mensal de um ativo. Calibrado contra a série real: as
 * variações de reajuste desta base ficam na casa de um dígito, e os eventos que
 * mereceram investigação — o IPVA caindo 63% de uma vigência para outra, um
 * FINAME zerando — passam de longe deste limiar.
 */
export const LIMIAR_CRITICO_PERCENTUAL = 10;

export interface EntradaDoStatus {
  presente: boolean;
  mensal: number | null;
  variacao: Variacao | null;
  integridade: AlertaDeIntegridade[];
  /** Se o ativo existia na vigência anterior. Nulo quando não há anterior. */
  anteriorPresente: boolean | null;
}

export function avaliarStatus(entrada: EntradaDoStatus): StatusDoEquipamento {
  const motivos: string[] = [];

  /* ⚪ Sem dado suficiente para analisar. Vem antes de tudo: um farol verde
     sobre um ativo do qual não se apurou nada seria a mentira mais confortável
     que este produto poderia contar. */
  if (!entrada.presente) {
    return {
      farol: "INCOMPLETO",
      motivos: [
        entrada.anteriorPresente === true
          ? "O equipamento saiu da frota nesta vigência — estava na anterior e não está aqui."
          : "O equipamento não aparece nesta vigência.",
      ],
      alertas: 1,
    };
  }
  if (entrada.mensal === null) {
    return {
      farol: "INCOMPLETO",
      motivos: [
        "Nenhum componente mensal pôde ser apurado com segurança nesta vigência.",
      ],
      alertas: 1,
    };
  }

  /* 🔴 Integridade primeiro: um total que não fecha com as próprias parcelas, ou
     uma coluna cujo significado a fonte mudou no meio da série, contaminam a
     leitura do valor — antes de discutir se subiu ou desceu. */
  for (const alerta of entrada.integridade) motivos.push(alerta.mensagem);
  const temIntegridade = entrada.integridade.length > 0;

  const variacao = entrada.variacao;
  const percentual = variacao?.percentual ?? null;
  const saltou = percentual !== null && Math.abs(percentual) >= LIMIAR_CRITICO_PERCENTUAL;

  if (saltou) {
    motivos.push(
      `A remuneração mensal variou ${percentual! > 0 ? "+" : ""}${percentual!.toLocaleString(
        "pt-BR",
        { maximumFractionDigits: 1 },
      )}% contra a vigência anterior — acima do limiar de ${LIMIAR_CRITICO_PERCENTUAL}%.`,
    );
  }

  if (temIntegridade || saltou) {
    return { farol: "CRITICO", motivos, alertas: motivos.length };
  }

  /* 🟡 Movimento sem gravidade: mudou, e a mudança precisa ser vista. */
  if (entrada.anteriorPresente === false) {
    motivos.push("O equipamento entrou na frota nesta vigência.");
  } else if (variacao !== null && variacao.absoluta !== 0) {
    motivos.push(
      `A remuneração mensal mudou em ${variacao.absoluta > 0 ? "+" : "−"}R$ ${Math.abs(
        variacao.absoluta,
      ).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
        (percentual === null
          ? " (a vigência anterior era zero, então não há percentual)."
          : ` (${percentual > 0 ? "+" : ""}${percentual.toLocaleString("pt-BR", {
              maximumFractionDigits: 1,
            })}%).`),
    );
  }

  if (motivos.length > 0) {
    return { farol: "ATENCAO", motivos, alertas: motivos.length };
  }

  /* 🟢 Sem movimento e sem inconsistência. */
  return { farol: "NORMAL", motivos: [], alertas: 0 };
}

export const ROTULO_DO_FAROL: Record<Farol, string> = {
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  INCOMPLETO: "Incompleto",
};
