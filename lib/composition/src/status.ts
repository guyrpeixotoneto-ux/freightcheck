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
import type { MotivoDeExclusao } from "./regras";

export type Farol = "NORMAL" | "ATENCAO" | "CRITICO" | "INCOMPLETO";

// ---------------------------------------------------------------------------
// Por que não há remuneração apurada
// ---------------------------------------------------------------------------

/**
 * A pergunta que "não apurado" não respondia.
 *
 * Um ativo sem remuneração mensal aparecia na tela com duas palavras que
 * serviam para três situações sem nada em comum — e a diferença entre elas é a
 * diferença entre *quem* resolve e *se* dá para resolver:
 *
 * - `SEMANTICA_NAO_CONFIRMADA` — o número está no banco e ninguém carimbou o
 *   que a coluna mede. Resolve-se com curadoria, sem pedir nada a ninguém de
 *   fora, e some sozinho para tudo o que está no registro canônico.
 * - `PRODUCAO_AUSENTE` — o significado está confirmado e o que falta é o
 *   **fato de produção** da placa no período: R$/km sem quilometragem, km/l sem
 *   litros. Nenhuma curadoria destrava isto. Só um dado novo destrava, e
 *   multiplicar a razão por uma quantidade estimada seria inventar o número.
 * - `VALOR_AUSENTE` — a coluna está confirmada, a conta existe, e a célula veio
 *   vazia ou não-numérica nesta vigência. É pergunta para a fonte.
 * - `SEM_COMPONENTE_MENSAL` — o ativo tem valores apurados, mas nenhum deles é
 *   mensal (só anuais, só de aquisição). Não é lacuna: é o que a vigência
 *   entregou.
 *
 * Chamar as quatro de "não apurado" ensinava que o produto não sabe. Ele sabe,
 * e agora diz.
 */
export type MotivoDaNaoApuracao =
  | "SEMANTICA_NAO_CONFIRMADA"
  | "PRODUCAO_AUSENTE"
  | "VALOR_AUSENTE"
  | "SEM_COMPONENTE_MENSAL";

/** O rótulo curto, para onde antes se lia "não apurado". */
export const ROTULO_DA_NAO_APURACAO: Record<MotivoDaNaoApuracao, string> = {
  SEMANTICA_NAO_CONFIRMADA: "aguardando curadoria",
  PRODUCAO_AUSENTE: "aguardando produção",
  VALOR_AUSENTE: "sem valor na vigência",
  SEM_COMPONENTE_MENSAL: "nada mensal nesta vigência",
};

/** A frase que explica, e que vira o alerta do ativo. */
export const FRASE_DA_NAO_APURACAO: Record<MotivoDaNaoApuracao, string> = {
  SEMANTICA_NAO_CONFIRMADA:
    "Nenhum componente mensal pôde ser apurado: os valores estão na fonte, mas o " +
    "significado das colunas ainda não foi confirmado. É curadoria, não falta de dado.",
  PRODUCAO_AUSENTE:
    "Nenhum componente mensal pôde ser apurado: o que este ativo tem são razões " +
    "(R$/km, km/l) e falta o fato de produção da placa no período. Sem quilometragem " +
    "medida, transformá-las em remuneração seria inventar o número.",
  VALOR_AUSENTE:
    "Nenhum componente mensal pôde ser apurado: as colunas estão confirmadas e vieram " +
    "sem valor nesta vigência. Ausência não é zero — é pergunta para a fonte.",
  SEM_COMPONENTE_MENSAL:
    "Este ativo não tem componente mensal nesta vigência — o que a fonte entregou " +
    "dele é de outra periodicidade.",
};

/** O que o cálculo do motivo precisa saber de cada componente que ficou fora. */
export interface ComponenteExcluido {
  motivo: MotivoDeExclusao;
  monetarioPotencial: boolean;
}

/**
 * De que classe é a lacuna deste ativo.
 *
 * A ordem das perguntas é a ordem de quem consegue agir primeiro: enquanto
 * houver coluna sem significado confirmado, é isso que a tela tem de pedir —
 * confirmar uma delas pode revelar que a produção nem era necessária. Só
 * quando a curadoria não tem mais o que fazer é que a falta de produção passa a
 * ser a resposta honesta, e só depois dela a célula vazia.
 *
 * Olha apenas os componentes que **parecem dinheiro do equipamento**: um
 * booleano sem semântica não é o motivo de a remuneração não ter sido apurada,
 * e deixá-lo entrar faria toda linha responder "aguardando curadoria" para
 * sempre.
 */
export function motivoDaNaoApuracao(
  naoApurados: ComponenteExcluido[],
): MotivoDaNaoApuracao {
  const pendentes = naoApurados.filter((n) => n.monetarioPotencial);
  const tem = (...motivos: MotivoDeExclusao[]) =>
    pendentes.some((n) => motivos.includes(n.motivo));

  if (tem("SEMANTICA_NAO_CONFIRMADA", "SEM_PERIODICIDADE")) {
    return "SEMANTICA_NAO_CONFIRMADA";
  }
  if (tem("BASE_AUSENTE")) return "PRODUCAO_AUSENTE";
  if (tem("VALOR_AUSENTE", "VALOR_NAO_NUMERICO")) return "VALOR_AUSENTE";
  return "SEM_COMPONENTE_MENSAL";
}

export interface StatusDoEquipamento {
  farol: Farol;
  /** Uma frase por motivo, na ordem em que pesaram. Vazio só em NORMAL. */
  motivos: string[];
  /** Quantos motivos há — é o número da coluna "Alertas". */
  alertas: number;
  /**
   * Quando não há remuneração mensal apurada, de que classe é a lacuna.
   *
   * Nulo quando há valor apurado — e nulo também quando o ativo não está na
   * vigência, porque aí não há lacuna a classificar: ele não está aqui.
   */
  naoApuradoPor: MotivoDaNaoApuracao | null;
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
  /** Os componentes que ficaram de fora, para classificar a lacuna. */
  naoApurados: ComponenteExcluido[];
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
      naoApuradoPor: null,
    };
  }
  if (entrada.mensal === null) {
    /*
      O alerta diz de que classe é a lacuna, e não só que ela existe. A frase
      genérica que ficava aqui — "nenhum componente mensal pôde ser apurado com
      segurança" — descrevia igualmente uma base sem curadoria e um caminhão sem
      quilometragem medida, que são problemas de donos diferentes.
    */
    const porque = motivoDaNaoApuracao(entrada.naoApurados);
    return {
      farol: "INCOMPLETO",
      motivos: [FRASE_DA_NAO_APURACAO[porque]],
      alertas: 1,
      naoApuradoPor: porque,
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
    return { farol: "CRITICO", motivos, alertas: motivos.length, naoApuradoPor: null };
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
    return { farol: "ATENCAO", motivos, alertas: motivos.length, naoApuradoPor: null };
  }

  /* 🟢 Sem movimento e sem inconsistência. */
  return { farol: "NORMAL", motivos: [], alertas: 0, naoApuradoPor: null };
}

export const ROTULO_DO_FAROL: Record<Farol, string> = {
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
  INCOMPLETO: "Incompleto",
};
