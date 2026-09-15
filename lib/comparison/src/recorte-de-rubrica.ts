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
// ---------------------------------------------------------------------------
// O par de vigências — qual unidade, e quais duas pontas
// ---------------------------------------------------------------------------
//
// Este bloco chegou de `artifacts/freightaudit/src/lib/finame.ts`, onde nasceu
// junto com a primeira tela de rubrica. Nada nele é de financiamento: são
// vigências, unidades e datas, e a segunda tela precisava das três funções
// exatamente como a primeira as usa.
//
// O `scopeHash` é a razão de elas serem compartilhadas e não copiadas.
// `/snapshots` responde pela operação inteira, e uma importação do arquivo da
// Ambev produz uma vigência **por unidade** com o mesmo `sourceLabel` e a mesma
// data — no acervo medido, seis vigências × cinco unidades. Um par escolhido sem
// olhar o escopo casa CAMAÇARI com PERNAMBUCO, que é o único par que o motor
// recusa por construção (`engine.ts`: "Escopos diferentes"), e a tela abre num
// erro que ninguém provocou.

/**
 * O mínimo que se precisa saber de uma vigência para emparelhá-la.
 *
 * Estrutural de propósito: quem chama é a tela, com o que `/snapshots`
 * devolveu (`VigenciaEscolhivel`), e este módulo não precisa do resto.
 */
export interface VigenciaEmparelhavel {
  id: string;
  effectiveDate: string;
  entityTypeSet: string;
  scopeHash: string;
}

/**
 * As vigências da unidade aberta — e todas quando não há unidade aberta.
 *
 * `/snapshots` responde pela operação inteira: dentro dela, PERNAMBUCO e
 * CAMAÇARI importadas do mesmo arquivo têm o **mesmo rótulo e a mesma data**, e
 * viram duas linhas idênticas no seletor. Sem este recorte, a tela oferecia as
 * duas sem dizer qual é qual, e a lateral, ao lado, nomeava uma delas.
 *
 * Sem `scopeHash` a lista sai inteira — o caso em que nem a URL nem `/contexts`
 * sabem dizer qual unidade está aberta. Quem chama resolve a unidade antes
 * (`contextoAberto`, em `lib/contextos.ts`), de modo que na prática isto é o
 * degrau final: só o acervo inteiro é melhor do que nada em tela.
 */
export function vigenciasDaUnidade<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
  scopeHash: string | null,
): T[] {
  if (!scopeHash) return [...vigencias];
  return vigencias.filter((v) => v.scopeHash === scopeHash);
}

/**
 * O par de partida: as duas vigências mais recentes que **formam par de
 * verdade** — mesma unidade e mesma cobertura.
 *
 * As duas condições são a recusa do motor antecipada: `engine.ts` não compara
 * escopos diferentes nem coberturas diferentes, e a tela que oferece um par
 * assim abre num erro que não é de quem abriu. A cobertura já estava aqui — era
 * o que impedia cavalo de casar com carreta; o escopo faltava, e era o que
 * fazia a tela abrir recusada assim que duas unidades dividiam a mesma data.
 *
 * **Procura, em vez de olhar só a primeira linha.** Sem unidade aberta, a
 * vigência mais recente do acervo pode ser de uma unidade que só tem aquela —
 * e parar ali diria "não há par" com nove pares disponíveis logo abaixo. A
 * ponta comparada é a mais recente que tem com quem se comparar.
 *
 * Devolve `null` quando não há par nenhum: uma unidade com uma vigência só não
 * tem comparação, e isso é uma tela vazia com a frase que explica — nunca um
 * pedido ao servidor que já se sabe que vai ser recusado.
 */
export function parDePartida<T extends VigenciaEmparelhavel>(
  vigencias: readonly T[],
): { base: T; comparada: T } | null {
  const ordenadas = [...vigencias].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  );
  for (const comparada of ordenadas) {
    const base = ordenadas.find(
      (v) =>
        v.id !== comparada.id &&
        v.entityTypeSet === comparada.entityTypeSet &&
        v.scopeHash === comparada.scopeHash,
    );
    if (base) return { base, comparada };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Os rótulos do seletor — o que distingue uma linha da outra
// ---------------------------------------------------------------------------

/** O que se precisa de uma vigência para escrever o rótulo dela. */
export interface VigenciaRotulavel extends VigenciaEmparelhavel {
  sourceLabel: string;
  revision?: number | null;
}

/** `2026-08-16` → `16/08/2026`. */
function dataBr(effectiveDate: string): string {
  return effectiveDate.split("-").reverse().join("/");
}

/**
 * O rótulo de cada vigência, **distinto por construção**.
 *
 * O seletor escrevia `sourceLabel · data` e nada mais, e o resultado medido foi
 * uma lista de cinco `EMPURRADA_1_6_2026 · 01/06/2026` seguidas, uma por
 * unidade. Escolher ali é adivinhar: as cinco linhas são a mesma frase, e a
 * recusa do motor — "cobrem unidades/operadores distintos" — só aparece depois
 * do clique, explicando algo que a lista tinha escondido.
 *
 * A régua é **acrescentar só o que desempata**, na ordem em que a pessoa
 * pensa:
 *
 * 1. `sourceLabel · data` — o que já existia, e o que basta na maioria dos
 *    casos;
 * 2. **a unidade**, quando duas linhas iguais são de unidades diferentes. É o
 *    caso desta tela, e é a informação que faltava;
 * 3. **a cobertura**, quando a mesma unidade entregou cavalo e carreta na mesma
 *    data — duas séries que compartilham as datas, e que o motor também não
 *    compara entre si;
 * 4. **a revisão**, o último desempate possível, para o que sobrar.
 *
 * Nada é acrescentado a quem já é único: um rótulo que carrega sempre as quatro
 * coisas é uma linha ilegível, e ilegível também esconde.
 */
export function rotulosDasVigencias<T extends VigenciaRotulavel>(
  vigencias: readonly T[],
  /** O nome da unidade de um escopo, quando se conhece — `/contexts` o sabe. */
  nomeDoEscopo: (scopeHash: string) => string | null = () => null,
): Map<string, string> {
  const sufixos: ((v: T) => string | null)[] = [
    (v) => nomeDoEscopo(v.scopeHash),
    (v) => v.entityTypeSet || null,
    (v) => (v.revision == null ? null : `rev. ${v.revision}`),
  ];

  const rotulos = new Map<string, string>();

  /** Desempata um grupo que hoje divide o mesmo texto, um sufixo por vez. */
  const resolver = (grupo: readonly T[], texto: string, nivel: number): void => {
    if (grupo.length === 1 || nivel >= sufixos.length) {
      for (const v of grupo) rotulos.set(v.id, texto);
      return;
    }
    const porSufixo = new Map<string, T[]>();
    for (const v of grupo) {
      const sufixo = sufixos[nivel](v);
      const chave = sufixo === null ? texto : `${texto} · ${sufixo}`;
      porSufixo.set(chave, [...(porSufixo.get(chave) ?? []), v]);
    }
    /* O sufixo não separou ninguém: não vale escrevê-lo, só o nível seguinte. */
    if (porSufixo.size === 1) {
      resolver(grupo, texto, nivel + 1);
      return;
    }
    for (const [chave, subgrupo] of porSufixo) resolver(subgrupo, chave, nivel + 1);
  };

  const porBase = new Map<string, T[]>();
  for (const v of vigencias) {
    const base = `${v.sourceLabel} · ${dataBr(v.effectiveDate)}`;
    porBase.set(base, [...(porBase.get(base) ?? []), v]);
  }
  for (const [base, grupo] of porBase) resolver(grupo, base, 0);

  return rotulos;
}
