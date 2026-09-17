/**
 * O MONITOR CUSTO FIXO — a composição das respostas, e nunca uma resposta nova.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo é, e o que ele recusa ser
 * ---------------------------------------------------------------------------
 * Ele põe lado a lado os quatro recortes de rubrica do custo fixo — FINAME,
 * IPVA, Lucro Fixo e Impostos — para que alguém acompanhe o dia sem abrir
 * quatro telas. E é **só isso**: nenhuma soma, subtração, conversão ou
 * deduplicação financeira nasce aqui.
 *
 * As três recusas, que são o desenho inteiro:
 *
 * 1. **O número financeiro é o do módulo.** O impacto de FINAME que este
 *    arquivo publica é o que `impactoPorPeriodicidade` devolveu, balde a balde,
 *    sem passar por nenhuma conta daqui. O teste de reconciliação compara os
 *    dois objetos.
 * 2. **Nenhuma coluna é somada duas vezes, e não porque este arquivo a
 *    desconte.** Cada coluna monetária tem um módulo dono, garantido na origem e
 *    prendido por `__tests__/posse-da-soma-do-custo-fixo.test.ts`. Se um dia
 *    dois módulos voltarem a somar a mesma coluna, quem reprova é aquele portão
 *    — não uma compensação escondida aqui.
 * 3. **Periodicidade nunca se mistura.** Não existe um escalar de impacto em
 *    lugar nenhum deste arquivo: o que existe é um balde por periodicidade, e
 *    dentro dele o custo e a receita separados.
 *
 * ---------------------------------------------------------------------------
 * Por que custo e receita não se somam
 * ---------------------------------------------------------------------------
 * Lucro Fixo é receita (`lucro-fixo.ts`: `DIRECAO_ECONOMICA = "RECEITA"`), e um
 * valor positivo ali é mais dinheiro **entrando**. Os outros três são custo, e
 * um valor positivo é mais dinheiro saindo. Somá-los num total só daria, nas
 * palavras do próprio módulo, "um número que não é de lado nenhum da DRE".
 *
 * Então o balde tem os dois em campos diferentes, com o sinal **como o módulo o
 * publicou** — nada é invertido para caber no painel —, e um terceiro campo,
 * `resultado`, que é a leitura de quem olha a DRE: `receita − custo`. Ele é
 * derivado à vista, com os dois componentes sempre ao lado, e não substitui
 * nenhum deles.
 *
 * ---------------------------------------------------------------------------
 * Por que a Aquisição não está aqui
 * ---------------------------------------------------------------------------
 * Porque ela não tem número para compor. O valor de nota de compra **não tem
 * módulo dono** — as três telas que o leem o recusam com a mesma frase, "preço
 * do ativo não é custo fixo", e `__tests__/posse-da-soma-do-custo-fixo.test.ts`
 * prende essa recusa —, e a Auditoria de Aquisição, que passou a ser a rubrica
 * dele, manteve a decisão: `impactoDeAquisicao` conta, e nunca soma.
 *
 * Um módulo cujo impacto é vazio por construção entraria aqui como uma coluna
 * de linhas sem valoração — a mesma razão pela qual o QLP está de fora, logo
 * abaixo. Quem quer conferir a nota abre a tela dela; o que o Monitor consolida
 * é dinheiro do período, e a compra do ativo não é.
 *
 * ---------------------------------------------------------------------------
 * Por que o QLP não está aqui
 * ---------------------------------------------------------------------------
 * Porque QLP não compara vigências: as duas telas dele conferem a aritmética
 * **dentro** de uma vigência (`qlp.ts`), e o quadro de pessoal chega sem
 * semântica confirmada, de modo que nenhuma alteração dele viraria dinheiro
 * (`docs/ACHADO-QLP.md`). Entrar agora encheria o Monitor de linhas sem
 * valoração — ruído, e não monitoramento financeiro.
 *
 * O lugar dele está guardado, e guardado de um jeito que não deixa esquecer:
 * {@link ModuloDoMonitor} é o tipo que se estende, e {@link NATUREZA_DO_MODULO}
 * e {@link ROTA_DO_MODULO} são mapas totais sobre ele. Quem acrescentar um
 * quinto módulo sem dizer de que lado da DRE ele está não compila.
 *
 * Sem SQL e sem React, como os quatro recortes que ele compõe: é sobre estas
 * funções que os testes rodam sem um Postgres de pé.
 */

import {
  severityOf,
  type PriorityReason,
  type Severity,
} from "./cockpit";
import {
  cobertasPorParcelasEm,
  impactoPorPeriodicidade,
  type ImpactoDeFiname,
  type LinhaDeFiname,
} from "./finame";
import { impactoDeIpva, type ImpactoDeIpva, type LinhaDeIpva } from "./ipva";
import {
  impactoDeImpostos,
  type ImpactoDeImpostos,
  type LinhaDeImpostos,
} from "./impostos";
import {
  impactoDeLucroFixo,
  type ImpactoDeLucroFixo,
  type LinhaDeLucroFixo,
} from "./lucro-fixo";
import { SEM_PERIODICIDADE } from "./deduplicacao";
import type { EstadoDaLinha, MedidaDaVariavel } from "./recorte-de-rubrica";

// ---------------------------------------------------------------------------
// Os módulos
// ---------------------------------------------------------------------------

/** Os módulos que o Monitor consolida hoje. Quatro — ver o cabeçalho. */
export type ModuloDoMonitor = "FINAME" | "IPVA" | "LUCRO_FIXO" | "IMPOSTOS";

export const MODULOS_DO_MONITOR: readonly ModuloDoMonitor[] = [
  "FINAME",
  "IPVA",
  "LUCRO_FIXO",
  "IMPOSTOS",
];

export const ROTULO_DO_MODULO: Record<ModuloDoMonitor, string> = {
  FINAME: "FINAME",
  IPVA: "IPVA",
  LUCRO_FIXO: "Lucro Fixo",
  IMPOSTOS: "Impostos",
};

/**
 * O endereço da auditoria de cada módulo — a origem de "Abrir auditoria".
 *
 * Mora aqui, e não na tela, porque é o domínio que sabe qual módulo produziu a
 * linha. Um endereço montado à mão dentro de um componente é onde a promessa
 * vazia nasce — a mesma razão que `lib/recorte.ts` dá do outro lado.
 */
export const ROTA_DO_MODULO: Record<ModuloDoMonitor, string> = {
  FINAME: "/custo-fixo-finame",
  IPVA: "/custo-fixo-ipva",
  LUCRO_FIXO: "/custo-fixo-lucro-fixo",
  IMPOSTOS: "/custo-fixo-impostos",
};

/**
 * De que lado da DRE o módulo está.
 *
 * Não é rótulo: é o que impede a soma. Ver o cabeçalho deste arquivo.
 */
export type NaturezaEconomica = "CUSTO" | "RECEITA";

export const NATUREZA_DO_MODULO: Record<ModuloDoMonitor, NaturezaEconomica> = {
  FINAME: "CUSTO",
  IPVA: "CUSTO",
  IMPOSTOS: "CUSTO",
  LUCRO_FIXO: "RECEITA",
};

export const ROTULO_DA_NATUREZA: Record<NaturezaEconomica, string> = {
  CUSTO: "Custo",
  RECEITA: "Receita",
};

// ---------------------------------------------------------------------------
// A situação de uma alteração diante do dinheiro
// ---------------------------------------------------------------------------

/**
 * O que aconteceu com o **valor** desta alteração — quatro situações, e elas
 * particionam a lista.
 *
 * - `VALORADO` — o motor precificou e o módulo dono somou. É a única situação
 *   que carrega número.
 * - `SEM_VALORACAO` — era candidata a dinheiro e não virou número, com o motivo
 *   que o motor gravou. **Nunca vira R$ 0,00**: zero é uma medição, e isto é a
 *   ausência de uma.
 * - `NAO_MONETARIA` — não é dinheiro **por natureza**: prazo, ano, data,
 *   alíquota, ciclo. Separada da de cima porque as duas são situações de
 *   domínio diferentes — uma é uma conversão que faltou, a outra é uma conversão
 *   que não existe. Dizer "sem valoração" sobre um prazo manda alguém procurar
 *   uma curadoria que nunca vai vir.
 * - `FORA_DO_TOTAL` — é dinheiro, e ficou fora da soma **deste** módulo, com o
 *   motivo do módulo: ou já está contado noutra linha (as parcelas do FINAME),
 *   ou a rubrica é de outro (a base, os tributos da compra, a coluna do
 *   conjunto).
 *
 * A identidade fecha por construção — cada linha tem exatamente uma situação —,
 * e é o que permite ao cartão dizer
 * `valoradas + sem valoração + não monetárias + fora do total = alterações`.
 */
export type SituacaoDoImpacto =
  | "VALORADO"
  | "SEM_VALORACAO"
  | "NAO_MONETARIA"
  | "FORA_DO_TOTAL";

export const SITUACOES_DO_IMPACTO: readonly SituacaoDoImpacto[] = [
  "VALORADO",
  "SEM_VALORACAO",
  "NAO_MONETARIA",
  "FORA_DO_TOTAL",
];

export const ROTULO_DA_SITUACAO: Record<SituacaoDoImpacto, string> = {
  VALORADO: "Valorado",
  SEM_VALORACAO: "Sem valoração",
  NAO_MONETARIA: "Não monetária",
  FORA_DO_TOTAL: "Fora do total",
};

/**
 * Para que lado a **rubrica** se moveu — nunca para que lado o resultado foi.
 *
 * Num módulo de receita, `AUMENTO` é mais receita. Quem diz se isso é bom é
 * {@link NATUREZA_DO_MODULO}, ao lado; inverter o sinal aqui para que "aumento"
 * significasse sempre "pior" apagaria o número que a fonte declarou.
 */
export type DirecaoDaRubrica = "AUMENTO" | "REDUCAO" | "NEUTRO";

/**
 * O que a linha identifica.
 *
 * Os quatro módulos de hoje são de placa, e mesmo assim o tipo não se chama
 * "veículo": o Monitor foi desenhado para receber o QLP, que é de cargo, e uma
 * coluna chamada "Veículo" obrigaria a renomear tela, contrato e teste no dia
 * em que ele entrar.
 */
export type TipoDeEntidade = "VEICULO" | "UNIDADE" | "CARGO" | "OUTRA";

// ---------------------------------------------------------------------------
// A linha normalizada
// ---------------------------------------------------------------------------

/**
 * O que os quatro recortes têm em comum, estruturalmente.
 *
 * Os quatro tipos de linha satisfazem isto sem nenhuma conversão — e passaram a
 * satisfazê-lo **inteiramente** quando `foraDaSoma` entrou no FINAME, com a
 * correção de `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`. Antes dela o FINAME
 * era o único sem o campo, e a normalização teria de tratá-lo à parte.
 */
export interface LinhaDeRubrica {
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  attributeCode: string | null;
  base: string | null;
  comparada: string | null;
  diferenca: number | null;
  variacao: number | null;
  estado: EstadoDaLinha;
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  foraDaSoma: string | null;
}

/**
 * O par de vigências de um módulo.
 *
 * É **por módulo**, e não um par global da tela, porque o par pertence à família
 * de dados de cada um. Hoje os quatro leem a mesma família (equipamento) e na
 * prática compartilham o par; escrever isso como um campo único do consolidado
 * transformaria uma coincidência de hoje em contrato, e quebraria no dia em que
 * o QLP entrar com a família dele.
 */
export interface ParDoMonitor {
  baseId: string;
  comparadaId: string;
  baseRotulo: string | null;
  comparadaRotulo: string | null;
  baseData: string | null;
  comparadaData: string | null;
}

export interface LinhaDoMonitor {
  /**
   * A chave desta linha dentro do Monitor.
   *
   * Carrega o módulo porque dois módulos descrevem o mesmo veículo na mesma
   * vigência, e carrega o `changeId` porque é ele que liga à justificativa e à
   * proveniência. Nas linhas que o motor não produziu, cai no par
   * entidade+variável, que é o que as identifica.
   */
  id: string;
  modulo: ModuloDoMonitor;
  /** O `change.id`. É por ele que se chega à auditoria original e ao rastro. */
  changeId: number | null;
  par: ParDoMonitor;
  entidade: {
    tipo: TipoDeEntidade;
    rotulo: string;
    /** O tipo cru do acervo — `CAVALO`, `CARRETA`. É o que o filtro usa. */
    entityType: string;
    /** A placa, quando a entidade é um veículo. */
    placa: string | null;
  };
  variavel: {
    chave: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    attributeCode: string | null;
  };
  estado: EstadoDaLinha;
  /** O texto do valor, como o módulo o entregou. O Monitor não converte. */
  valorAnterior: string | null;
  valorAtual: string | null;
  /** A variação em pontos percentuais, como o motor a produziu. */
  variacao: number | null;
  impacto: {
    situacao: SituacaoDoImpacto;
    /** Só em `VALORADO`. */
    direcao: DirecaoDaRubrica | null;
    /** Só em `VALORADO`. Nas outras é `null` — e nunca zero. */
    valor: number | null;
    /** Só em `VALORADO`. */
    periodicidade: string | null;
    /** De que lado da DRE este valor está. */
    natureza: NaturezaEconomica;
    /** Por que não virou número, na frase de quem decidiu. */
    motivo: string | null;
  };
  prioridade: { nivel: Severity; score: number; motivos: PriorityReason[] };
  origem: {
    modulo: ModuloDoMonitor;
    rotulo: string;
    rota: string;
    changeSetId: string | null;
  };
}

// ---------------------------------------------------------------------------
// A normalização
// ---------------------------------------------------------------------------

/**
 * Quais chaves de variável cada módulo considera **rubrica própria**.
 *
 * Esta é a única declaração deste arquivo que espelha uma decisão tomada dentro
 * dos módulos, e ela existe por uma razão concreta: as funções de impacto tomam
 * essa decisão **dentro** do laço de soma, sem publicá-la linha a linha —
 * `impactoDeIpva` escreve `if (l.variavel !== "ipva") continue` —, e o Monitor
 * precisa dizer, sobre aquela linha, *por que* ela não entrou.
 *
 * Duas salvaguardas impedem que isto vire uma segunda régua:
 *
 * - **o número financeiro nunca sai daqui** — ele vem de `impactoDeX`, inteiro;
 * - `__tests__/monitor-custo-fixo.test.ts` compara, sobre listas construídas à
 *   mão, esta classificação com os contadores que `impactoDeX` publica. Se
 *   divergirem, reprova.
 *
 * O FINAME não aparece na lista porque nele a decisão não é por chave: é a regra
 * de parcelas, que é por veículo e mora em {@link cobertasPorParcelasEm}.
 */
const RUBRICA_PROPRIA: Partial<Record<ModuloDoMonitor, readonly string[]>> = {
  IPVA: ["ipva"],
  LUCRO_FIXO: ["lucro_fixo"],
};

const MOTIVO_DE_OUTRA_RUBRICA =
  "É conferência, não a rubrica desta auditoria: a linha está na tabela para " +
  "explicar o valor ao lado, e quem a soma é o módulo dono dela — ou ninguém, " +
  "quando ela é base de cálculo.";

const MOTIVO_COBERTA_POR_PARCELAS =
  "Já contado nas parcelas deste mesmo veículo — somar o total junto das partes " +
  "contaria o mesmo dinheiro duas vezes.";

const MOTIVO_SEM_NUMERO =
  "O motor não produziu um valor para esta alteração, e ausência de número não " +
  "é R$ 0,00.";

/** O separador de chaves. Mesmo caractere que os recortes usam. */
const SEP = "";

/** A chave de uma linha de FINAME dentro da regra de parcelas. */
const chaveDaParcela = (l: LinhaDeRubrica) =>
  `${l.entityLabel}${SEP}${l.entityType}${SEP}${l.variavel}`;

/**
 * A situação de uma linha — a decisão que o cartão e a tabela publicam.
 *
 * A ordem dos testes é a mesma das funções de impacto dos módulos, e ela
 * importa: o que não é dinheiro sai antes de tudo, porque perguntar "faltou
 * precificar?" sobre um prazo é prometer uma conversão que não existe.
 */
function situacaoDaLinha(
  l: LinhaDeRubrica,
  modulo: ModuloDoMonitor,
  cobertas: ReadonlySet<string>,
): { situacao: SituacaoDoImpacto; motivo: string | null } {
  if (l.medida !== "DINHEIRO") {
    return { situacao: "NAO_MONETARIA", motivo: null };
  }
  if (l.foraDaSoma) {
    return { situacao: "FORA_DO_TOTAL", motivo: l.foraDaSoma };
  }
  const propria = RUBRICA_PROPRIA[modulo];
  if (propria && !propria.includes(l.variavel)) {
    return { situacao: "FORA_DO_TOTAL", motivo: MOTIVO_DE_OUTRA_RUBRICA };
  }
  if (modulo === "FINAME" && cobertas.has(chaveDaParcela(l))) {
    return { situacao: "FORA_DO_TOTAL", motivo: MOTIVO_COBERTA_POR_PARCELAS };
  }
  if (l.estado !== "ALTERADO" || !l.impactoCalculado || l.impactoAmount === null) {
    return { situacao: "SEM_VALORACAO", motivo: l.motivo ?? MOTIVO_SEM_NUMERO };
  }
  return { situacao: "VALORADO", motivo: null };
}

function direcaoDe(valor: number): DirecaoDaRubrica {
  if (valor > 0) return "AUMENTO";
  if (valor < 0) return "REDUCAO";
  return "NEUTRO";
}

function entidadeDe(l: LinhaDeRubrica): LinhaDoMonitor["entidade"] {
  const tipo = l.entityType.trim().toUpperCase();
  const veiculo = tipo === "CAVALO" || tipo === "CARRETA";
  return {
    tipo: veiculo ? "VEICULO" : "OUTRA",
    rotulo: l.entityLabel ?? "(sem identificação)",
    entityType: l.entityType,
    placa: veiculo ? l.entityLabel : null,
  };
}

/**
 * A prioridade de uma alteração — **a régua do cockpit, sobre menos fatos**.
 *
 * A tradução score → severidade é `severityOf`, importada de `cockpit.ts` e não
 * redigitada: duas tabelas de corte divergiriam, e a fila do Monitor deixaria de
 * ser a mesma fila do Acompanhamento.
 *
 * **O que muda é o conjunto de critérios, e isso está escrito porque é uma
 * limitação, não uma escolha.** `scoreGroup` pontua um grupo — um atributo em
 * toda a frota — e por isso conhece cobertura, padrão dominante, anomalia de
 * formato e selo. O Monitor pontua **uma linha**, e não tem nenhuma dessas
 * coisas à mão. Fabricá-las para poder chamar `scoreGroup` daria o nome daquela
 * conta a outra conta, que é pior do que duas contas com nomes diferentes.
 *
 * Os critérios que sobrevivem valem **os mesmos pontos** que valem lá — é o que
 * faz disto a mesma régua, e não uma segunda inteligência:
 *
 * | critério | pontos | igual ao cockpit? |
 * |---|---|---|
 * | impacto financeiro apurado | 35 | sim |
 * | valor apurado, já contado noutra linha | 20 | sim |
 * | o valor trocou de estado | 10 | sim |
 * | variação de 100% / 50% / 20% ou mais | 20 / 12 / 6 | sim |
 *
 * E a fila fica explicável: `motivos` é a lista de parcelas que somaram o score,
 * e é ela que o painel lateral mostra, com os pontos de cada uma.
 */
export function prioridadeDaLinha(
  l: LinhaDeRubrica,
  situacao: SituacaoDoImpacto,
): { nivel: Severity; score: number; motivos: PriorityReason[] } {
  const motivos: PriorityReason[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) motivos.push({ label, points });
  };

  if (situacao === "VALORADO" && l.impactoAmount !== null && l.impactoAmount !== 0) {
    add("impacto financeiro apurado", 35);
  } else if (situacao === "FORA_DO_TOTAL") {
    add("valor apurado, já contado noutra linha", 20);
  }

  if (l.estado !== "ALTERADO" && l.estado !== "SEM_ALTERACAO") {
    add("o valor trocou de estado (entrou, saiu, conflitou ou ficou incompleto)", 10);
  }

  const variacao = l.variacao === null ? null : Math.abs(l.variacao);
  if (variacao !== null) {
    if (variacao >= 100) add("variação de 100% ou mais", 20);
    else if (variacao >= 50) add("variação de 50% ou mais", 12);
    else if (variacao >= 20) add("variação de 20% ou mais", 6);
  }

  const score = motivos.reduce((total, m) => total + m.points, 0);
  return { nivel: severityOf(score), score, motivos };
}

/** As linhas de um módulo, normalizadas. Nenhuma conta financeira acontece aqui. */
export function normalizarLinhas(
  modulo: ModuloDoMonitor,
  linhas: readonly LinhaDeRubrica[],
  par: ParDoMonitor,
  changeSetId: string | null,
): LinhaDoMonitor[] {
  /*
    A regra de parcelas é por veículo, e por isso precisa da lista inteira antes
    de decidir sobre qualquer linha. Vem de `finame.ts`, da mesma função que a
    soma de lá usa — ver `cobertasPorParcelasEm`.
  */
  const cobertas =
    modulo === "FINAME"
      ? cobertasPorParcelasEm(linhas as readonly LinhaDeFiname[])
      : new Set<string>();

  return linhas.map((l) => {
    const { situacao, motivo } = situacaoDaLinha(l, modulo, cobertas);
    const valorado = situacao === "VALORADO";
    return {
      id: `${modulo}:${l.id ?? `${l.entityLabel}:${l.entityType}:${l.variavel}`}`,
      modulo,
      changeId: l.id,
      par,
      entidade: entidadeDe(l),
      variavel: {
        chave: l.variavel,
        rotulo: l.rotuloDaVariavel,
        medida: l.medida,
        attributeCode: l.attributeCode,
      },
      estado: l.estado,
      valorAnterior: l.base,
      valorAtual: l.comparada,
      variacao: l.variacao,
      impacto: {
        situacao,
        direcao: valorado ? direcaoDe(l.impactoAmount as number) : null,
        valor: valorado ? l.impactoAmount : null,
        periodicidade: valorado ? (l.impactoPeriodicidade ?? SEM_PERIODICIDADE) : null,
        natureza: NATUREZA_DO_MODULO[modulo],
        motivo,
      },
      prioridade: prioridadeDaLinha(l, situacao),
      origem: {
        modulo,
        rotulo: ROTULO_DO_MODULO[modulo],
        rota: ROTA_DO_MODULO[modulo],
        changeSetId,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Os agregados
// ---------------------------------------------------------------------------

/** O impacto nativo de cada módulo, como cada um o declara. */
export type ImpactoDoModulo =
  | ({ modulo: "FINAME" } & ImpactoDeFiname)
  | ({ modulo: "IPVA" } & ImpactoDeIpva)
  | ({ modulo: "IMPOSTOS" } & ImpactoDeImpostos)
  | ({ modulo: "LUCRO_FIXO" } & ImpactoDeLucroFixo);

/**
 * O impacto de um módulo, pedido à função que a tela dele usa.
 *
 * É este o ponto em que o Monitor deixa de decidir: daqui para baixo, o número
 * é o do módulo. O `switch` existe para que acrescentar um módulo ao tipo sem
 * dizer quem calcula o impacto dele não compile.
 */
export function impactoDoModulo(
  modulo: ModuloDoMonitor,
  linhas: readonly LinhaDeRubrica[],
): ImpactoDoModulo {
  switch (modulo) {
    case "FINAME":
      return { modulo, ...impactoPorPeriodicidade(linhas as readonly LinhaDeFiname[]) };
    case "IPVA":
      return { modulo, ...impactoDeIpva(linhas as readonly LinhaDeIpva[]) };
    case "IMPOSTOS":
      return { modulo, ...impactoDeImpostos(linhas as readonly LinhaDeImpostos[]) };
    case "LUCRO_FIXO":
      return { modulo, ...impactoDeLucroFixo(linhas as readonly LinhaDeLucroFixo[]) };
  }
}

const zeradoPorSituacao = (): Record<SituacaoDoImpacto, number> =>
  Object.fromEntries(SITUACOES_DO_IMPACTO.map((s) => [s, 0])) as Record<
    SituacaoDoImpacto,
    number
  >;

const centavos = (n: number) => Number(n.toFixed(2));

/** A parte positiva e a negativa de um líquido, dentro de uma periodicidade. */
export interface DecomposicaoDoBalde {
  aumentos: number;
  reducoes: number;
}

export interface ResumoDoModulo {
  modulo: ModuloDoMonitor;
  rotulo: string;
  natureza: NaturezaEconomica;
  rota: string;
  alteracoes: number;
  porSituacao: Record<SituacaoDoImpacto, number>;
  /** Contagens, não dinheiro: quantas alterações subiram e quantas desceram. */
  aumentos: number;
  reducoes: number;
  /** As entidades distintas tocadas. A lista, e não só o tamanho — ver {@link consolidar}. */
  entidades: string[];
  /** O impacto **do módulo**, balde a balde, exatamente como ele o publicou. */
  porPeriodicidade: Record<string, number>;
  /**
   * A parte positiva e a negativa de cada balde acima.
   *
   * `aumentos + reducoes === porPeriodicidade[balde]` é invariante e está sob
   * teste. Não é um número novo: é o mesmo líquido, aberto — e se a identidade
   * deixar de valer, alguma linha está entrando na abertura sem estar no líquido
   * do módulo, que é defeito e não arredondamento.
   */
  decomposicao: Record<string, DecomposicaoDoBalde>;
  /**
   * O resumo nativo do módulo, inteiro.
   *
   * Vai junto porque cada rubrica tem pendências que só ela conhece — alíquotas
   * que se moveram sem o montante mexer, valores negativos, linhas cobertas
   * pelas parcelas —, e achatá-las num vocabulário comum apagaria o achado. A
   * visão por módulo mostra o que **cada um** tem, e não a interseção dos
   * quatro.
   */
  impactoDeOrigem: ImpactoDoModulo;
  par: ParDoMonitor;
}

/**
 * O resumo de um módulo — contagens daqui, dinheiro de lá.
 *
 * `porPeriodicidade` é o objeto que `impactoDeX` devolveu, sem passar por soma
 * nenhuma deste arquivo. É o que faz o Monitor fechar com a auditoria original
 * por construção, e não por coincidência.
 */
export function resumirModulo(
  modulo: ModuloDoMonitor,
  linhas: readonly LinhaDoMonitor[],
  impacto: ImpactoDoModulo,
  par: ParDoMonitor,
): ResumoDoModulo {
  const porSituacao = zeradoPorSituacao();
  const entidades = new Set<string>();
  const decomposicao: Record<string, DecomposicaoDoBalde> = {};
  let aumentos = 0;
  let reducoes = 0;

  for (const l of linhas) {
    porSituacao[l.impacto.situacao]++;
    entidades.add(`${l.entidade.tipo}${SEP}${l.entidade.rotulo}`);
    if (l.impacto.direcao === "AUMENTO") aumentos++;
    if (l.impacto.direcao === "REDUCAO") reducoes++;

    if (l.impacto.situacao !== "VALORADO" || l.impacto.valor === null) continue;
    const balde = l.impacto.periodicidade ?? SEM_PERIODICIDADE;
    const atual = decomposicao[balde] ?? { aumentos: 0, reducoes: 0 };
    if (l.impacto.valor > 0) atual.aumentos = centavos(atual.aumentos + l.impacto.valor);
    else atual.reducoes = centavos(atual.reducoes + l.impacto.valor);
    decomposicao[balde] = atual;
  }

  return {
    modulo,
    rotulo: ROTULO_DO_MODULO[modulo],
    natureza: NATUREZA_DO_MODULO[modulo],
    rota: ROTA_DO_MODULO[modulo],
    alteracoes: linhas.length,
    porSituacao,
    aumentos,
    reducoes,
    entidades: [...entidades],
    porPeriodicidade: impacto.porPeriodicidade,
    decomposicao,
    impactoDeOrigem: impacto,
    par,
  };
}

/** O impacto de uma natureza dentro de uma periodicidade. */
export interface LadoDoBalde {
  /** O líquido — **o número dos módulos**, agrupado, nunca recomposto. */
  liquido: number;
  /** A parte positiva do líquido. `aumentos + reducoes === liquido`. */
  aumentos: number;
  /** A parte negativa do líquido, com o sinal dela. */
  reducoes: number;
}

/**
 * Uma periodicidade, com os dois lados da DRE separados.
 *
 * Nunca há um campo que some `custo` com `receita`. `resultado` é
 * `receita.liquido − custo.liquido`, e existe porque é a leitura de quem olha o
 * resultado — com os dois componentes sempre à vista, de modo que ninguém
 * precise acreditar nele sozinho.
 */
export interface BaldeDoMonitor {
  periodicidade: string;
  custo: LadoDoBalde;
  receita: LadoDoBalde;
  resultado: number;
}

const ladoVazio = (): LadoDoBalde => ({ liquido: 0, aumentos: 0, reducoes: 0 });

export interface ResumoDoMonitor {
  alteracoes: number;
  porSituacao: Record<SituacaoDoImpacto, number>;
  /** Contagens de alterações, não dinheiro. */
  aumentos: number;
  reducoes: number;
  entidadesAfetadas: number;
  /** Um balde por periodicidade, com custo e receita separados. */
  baldes: BaldeDoMonitor[];
  porModulo: ResumoDoModulo[];
}

/**
 * O consolidado — a composição dos resumos de módulo, e nada além disso.
 *
 * O dinheiro de cada balde vem de `ResumoDoModulo.porPeriodicidade`, que veio de
 * `impactoDeX`. A única aritmética aqui é **agrupar por periodicidade e por
 * natureza** números que os módulos já publicaram — o que `deduplicacao.ts`
 * chama de somar resumos já decididos, e que não re-decide nada.
 *
 * `entidadesAfetadas` sai da **união** dos conjuntos de entidades, e não da soma
 * das contagens: o mesmo cavalo aparece no FINAME e no IPVA, e somar daria mais
 * veículos do que a frota tem. É o mesmo defeito que `ChangeGroup.entityIds`
 * documenta do outro lado, e a mesma correção.
 */
export function consolidar(resumos: readonly ResumoDoModulo[]): ResumoDoMonitor {
  const porSituacao = zeradoPorSituacao();
  const entidades = new Set<string>();
  const baldes = new Map<string, BaldeDoMonitor>();
  let alteracoes = 0;
  let aumentos = 0;
  let reducoes = 0;

  const baldeDe = (periodicidade: string): BaldeDoMonitor => {
    const existente = baldes.get(periodicidade);
    if (existente) return existente;
    const novo: BaldeDoMonitor = {
      periodicidade,
      custo: ladoVazio(),
      receita: ladoVazio(),
      resultado: 0,
    };
    baldes.set(periodicidade, novo);
    return novo;
  };

  for (const r of resumos) {
    alteracoes += r.alteracoes;
    aumentos += r.aumentos;
    reducoes += r.reducoes;
    for (const s of SITUACOES_DO_IMPACTO) porSituacao[s] += r.porSituacao[s];
    for (const e of r.entidades) entidades.add(e);

    for (const [periodicidade, liquido] of Object.entries(r.porPeriodicidade)) {
      const balde = baldeDe(periodicidade);
      const lado = r.natureza === "RECEITA" ? balde.receita : balde.custo;
      const aberto = r.decomposicao[periodicidade] ?? { aumentos: 0, reducoes: 0 };
      lado.liquido = centavos(lado.liquido + liquido);
      lado.aumentos = centavos(lado.aumentos + aberto.aumentos);
      lado.reducoes = centavos(lado.reducoes + aberto.reducoes);
    }
  }

  for (const balde of baldes.values()) {
    balde.resultado = centavos(balde.receita.liquido - balde.custo.liquido);
  }

  return {
    alteracoes,
    porSituacao,
    aumentos,
    reducoes,
    entidadesAfetadas: entidades.size,
    /* Ordem estável, para que a tela não reordene os blocos a cada resposta. */
    baldes: [...baldes.values()].sort((a, b) =>
      a.periodicidade.localeCompare(b.periodicidade),
    ),
    porModulo: [...resumos],
  };
}
