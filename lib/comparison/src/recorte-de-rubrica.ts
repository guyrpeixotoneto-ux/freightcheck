/**
 * O VOCABULÁRIO COMUM DOS RECORTES DE RUBRICA.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Porque agora há **dois** recortes nomeados do mesmo motor — FINAME
 * (`finame.ts`) e IPVA (`ipva.ts`) — e eles têm de dizer a mesma coisa com a
 * mesma palavra. "Conflito" na Auditoria de FINAME e "Conflito" na Auditoria de
 * IPVA precisam significar exatamente o mesmo estado do `change_set`; duas
 * cópias da mesma tradução divergiriam no primeiro dia em que alguém
 * acrescentasse um `changeType` a uma e esquecesse na outra, e as duas telas
 * passariam a classificar a mesma linha de dois jeitos.
 *
 * O que mora aqui é só o que é **comum a qualquer rubrica**: o que uma variável
 * mede, os seis estados, a forma da alteração como o motor a grava e a tradução
 * de uma para a outra. O que é de FINAME — quais são as catorze colunas do
 * financiamento, que a parcela da carreta embute a do cavalo — continua em
 * `finame.ts`; o que é de IPVA — que a coluna "mensal" da carreta não é 1/12 da
 * anual — continua em `ipva.ts`.
 *
 * `finame.ts` reexporta tudo daqui com os nomes que já publicava, de modo que
 * nenhum importador dele mudou de linha.
 *
 * Sem SQL e sem React, pelo mesmo motivo dos dois: é sobre estas funções que os
 * testes rodam sem um Postgres de pé, e é este mesmo módulo que o servidor e o
 * navegador importam.
 */

// ---------------------------------------------------------------------------
// O que uma variável mede
// ---------------------------------------------------------------------------

/** O que a variável mede — e, por consequência, como a tela a escreve. */
export type MedidaDaVariavel =
  | "DINHEIRO"
  | "PERCENTUAL"
  | "MESES"
  | "ANO"
  | "DATA";

// ---------------------------------------------------------------------------
// Os seis estados
// ---------------------------------------------------------------------------

/**
 * O que aconteceu com esta variável, neste veículo, entre as duas vigências.
 *
 * Os seis são exaustivos e nenhum deles é "não sei": `DADO_INCOMPLETO` e
 * `CONFLITO` são as duas formas honestas de dizer que **houve** algo e que ele
 * não vira número, cada uma com o motivo que o motor gravou.
 */
export type EstadoDaLinha =
  | "SEM_ALTERACAO"
  | "ALTERADO"
  | "NOVO_NA_VIGENCIA"
  | "AUSENTE_NA_COMPARADA"
  | "DADO_INCOMPLETO"
  | "CONFLITO";

export const ROTULO_DO_ESTADO: Record<EstadoDaLinha, string> = {
  SEM_ALTERACAO: "Sem alteração",
  ALTERADO: "Alterado",
  NOVO_NA_VIGENCIA: "Novo na vigência",
  AUSENTE_NA_COMPARADA: "Ausente na vigência comparada",
  DADO_INCOMPLETO: "Dado incompleto",
  CONFLITO: "Conflito",
};

/**
 * A ordem de gravidade — qual estado ganha quando um veículo tem vários.
 *
 * Um veículo aparece numa fatia só da rosca, e é esta lista que decide qual:
 * quem tem conflito conta como conflito ainda que também tenha uma variável
 * alterada. Sem a regra, a soma das fatias passaria do total de veículos, e uma
 * rosca cujas partes somam 113% é um gráfico em que ninguém acredita.
 */
export const GRAVIDADE: readonly EstadoDaLinha[] = [
  "CONFLITO",
  "AUSENTE_NA_COMPARADA",
  "NOVO_NA_VIGENCIA",
  "DADO_INCOMPLETO",
  "ALTERADO",
  "SEM_ALTERACAO",
];

/**
 * A alteração como o motor a grava, reduzida ao que estes módulos leem.
 *
 * Estruturalmente compatível com `ChangeRow` (`query.ts`) — é ele que chega
 * aqui em produção. Escrito como interface própria para que o teste construa
 * uma linha à mão sem montar as trinta colunas da tabela.
 */
export interface AlteracaoDoMotor {
  id?: number;
  changeType: string;
  nature?: string | null;
  attributeCode: string | null;
  attributeName?: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  isNullBefore?: boolean | null;
  isNullAfter?: boolean | null;
  nullReasonBefore?: string | null;
  nullReasonAfter?: string | null;
  /** `numeric` do Postgres chega como string. A conversão mora aqui. */
  deltaAbsolute: string | number | null;
  deltaPercent: string | number | null;
  comparability: string;
  inconclusiveReason?: string | null;
  impactConfidence?: string | null;
  impactAmount?: string | number | null;
  impactPeriodicity?: string | null;
}

/**
 * O estado de uma alteração — a tradução do motor para a tela.
 *
 * A ordem dos testes é deliberada: o eixo da frota decide antes do valor, e a
 * incomparabilidade decide antes de qualquer número. Uma linha `INCONCLUSIVE`
 * com `delta` nulo classificada como "Alterado" mostraria um travessão sob o
 * rótulo de uma alteração medida.
 */
export function estadoDaAlteracao(a: AlteracaoDoMotor): EstadoDaLinha {
  if (a.changeType === "ENTITY_ADDED" || a.changeType === "ATTRIBUTE_ADDED") {
    return "NOVO_NA_VIGENCIA";
  }
  if (a.changeType === "ENTITY_REMOVED" || a.changeType === "ATTRIBUTE_REMOVED") {
    return "AUSENTE_NA_COMPARADA";
  }
  if (a.comparability === "INCONCLUSIVE") {
    /*
      Duas famílias de incomparável, e elas não se dizem com a mesma palavra.

      Um valor que apareceu, sumiu ou trocou de motivo de ausência é **dado
      incompleto**: o acervo tem um buraco, e o buraco é o achado. Um tipo que
      mudou, uma coluna que a fonte entrega com dois tipos no mesmo import e uma
      semântica que se moveu são **conflito**: os dois lados existem e não podem
      ser postos lado a lado com segurança. Chamar os dois de "incompleto"
      mandaria alguém procurar um dado que está lá.
    */
    const ausencia =
      a.nature === "APPEARED" || a.nature === "DISAPPEARED" || a.nature === "NULL_REASON";
    return ausencia ? "DADO_INCOMPLETO" : "CONFLITO";
  }
  return "ALTERADO";
}

/** `numeric` do Postgres chega como string; nulo continua nulo. */
export function numero(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** A chave de um veículo dentro de um recorte: rótulo mais tipo. */
export function chaveDoVeiculo(l: {
  entityLabel: string | null;
  entityType: string;
}): string {
  return `${l.entityLabel}${l.entityType}`;
}
