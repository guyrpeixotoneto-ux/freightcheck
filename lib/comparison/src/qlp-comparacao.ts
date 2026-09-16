import {
  GRAVIDADE,
  estadoDaAlteracao,
  numero,
  type AlteracaoDoMotor,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";
import {
  TIPO_DO_QUADRO,
  VARIAVEIS_DO_QUADRO,
  variavelDoQuadroDoCodigo,
  type PapelNoQuadro,
  type QuadroDeQlp,
} from "./qlp";

/**
 * A COMPARAÇÃO DO QLP ENTRE DUAS VIGÊNCIAS — o recorte de rubrica, por cargo.
 *
 * ---------------------------------------------------------------------------
 * Por que ela existe, se `qlp.ts` dizia que a comparação já tinha dono
 * ---------------------------------------------------------------------------
 * Dizia, e o dono era a aba de Alterações: o diff genérico do motor canônico,
 * uma linha por atributo alterado, a mesma lista que Comparar Vigências mostra.
 * Ela responde "o que mudou" e não responde **de quem** mudou: um quadro de 41
 * cargos vira uma lista de alterações soltas em que ninguém acha o cargo que
 * perdeu efetivo. As seis auditorias de rubrica resolveram isso há tempo, e a
 * forma delas é a mesma em todas — FINAME, IPVA, Impostos, Lucro Fixo, Km
 * Rodado, Velocidade Média: uma linha por **ativo e variável**, com o estado, a
 * diferença e a variação de cada uma, e o ativo inteiro numa gaveta.
 *
 * Este módulo é essa forma aplicada ao quadro de pessoal. O que muda é o grão:
 * onde aquelas leem placa, esta lê **cargo** — um por unidade no
 * administrativo, um por unidade e turno no operacional. Nada mais muda, e é de
 * propósito: um sétimo recorte com vocabulário próprio seria a sétima tradução
 * de `changeType` para estado, e a primeira a divergir seria esta.
 *
 * ---------------------------------------------------------------------------
 * A diferença que o QLP obriga: aqui não se soma dinheiro
 * ---------------------------------------------------------------------------
 * As seis auditorias de rubrica somam impacto em reais, e podem: as colunas
 * delas têm semântica confirmada. As do QLP não têm — é o travamento que a aba
 * do Quadro anuncia em toda vigência, e que `podeSomar`/`viraDinheiro`
 * sustentam no resto do produto. Um cartão de "impacto financeiro" aqui seria a
 * primeira soma de dinheiro do QLP no produto inteiro, feita justamente onde
 * ninguém iria conferi-la.
 *
 * Então esta comparação **conta** e **não soma**: quantos cargos mudaram,
 * quantas variáveis mudaram em cada um, quais entraram e quais saíram. A única
 * soma que ela faz é a do efetivo — que é de gente, e não de dinheiro, e é a
 * mesma que `resumirQuadro` já fazia pela mesma razão.
 *
 * Sem SQL e sem React, como os outros seis: é sobre estas funções que os testes
 * rodam sem Postgres, e é este mesmo módulo que o servidor e o navegador leem.
 */

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um cargo, uma variável, os dois lados. */
export interface LinhaDeQlpComparado {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  /**
   * O cargo como o motor o rotula — a chave **normalizada**
   * (`07526557001505CARGOGERENTE…`).
   *
   * A forma legível não vem daqui de propósito: o motor grava
   * `identifier_value` em `change.entity_label`, e a legível mora em
   * `identifier_value_raw` (dívida registrada em `lib/qlp/src/index.ts`). Quem
   * lê traduz na apresentação, com o dicionário que a própria tela já tem —
   * `agruparMovimentos`, no cliente, faz isso desde a aba de Alterações.
   */
  entityLabel: string | null;
  entityType: string;
  quadro: QuadroDeQlp;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  /** O que a coluna é dentro do quadro. Quantidade, parâmetro, montante… */
  papel: PapelNoQuadro;
  /** A rubrica a que a variável pertence, quando há uma. */
  rubrica: string | null;
  attributeCode: string | null;
  /** O texto do valor na ponta "De". Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na ponta "Para". Nulo quando não há. */
  comparada: string | null;
  /** `Para − De`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em pontos percentuais. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinha;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  /** O aviso da coluna que não entra em soma — subtotal, benchmark, VT. */
  foraDaSoma: string | null;
}

/*
  O vocabulário comum, reexportado com os nomes que ele já tem.

  Quem lê esta tela precisa do estado, da medida e do rótulo do estado, e
  importá-los de dois módulos obrigaria cada tela a saber que o estado é do
  recorte genérico e a medida também. As seis auditorias de rubrica fazem o
  mesmo — `finame.ts` reexporta o que `recorte-de-rubrica.ts` define.
*/
export { ROTULO_DO_ESTADO } from "./recorte-de-rubrica";
export type { AlteracaoDoMotor, EstadoDaLinha, MedidaDaVariavel } from "./recorte-de-rubrica";
export type { PapelNoQuadro, QuadroDeQlp } from "./qlp";

/** A linha de um cargo que entrou ou saiu — o eixo do quadro, sem atributo. */
const VARIAVEL_DO_CARGO = "cargo";

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é deste quadro — a função é o filtro e o
 * tradutor ao mesmo tempo, de modo que nenhuma tela precise saber os códigos.
 *
 * **Entrada e saída de cargo não citam atributo**: o motor as grava uma vez por
 * entidade, e elas entram como a linha do cargo inteiro. Sumir com elas
 * esconderia a metade mais visível do que muda num quadro de pessoal — quem
 * entrou e quem saiu.
 */
export function linhaDeQlpDaAlteracao(
  a: AlteracaoDoMotor,
  quadro: QuadroDeQlp,
): LinhaDeQlpComparado | null {
  const doQuadro = (a.entityType ?? "").trim().toUpperCase() === TIPO_DO_QUADRO[quadro];
  if (!doQuadro) return null;

  const variavel = a.attributeCode
    ? variavelDoQuadroDoCodigo(quadro, a.attributeCode)
    : undefined;

  if (!variavel) {
    if (a.changeType !== "ENTITY_ADDED" && a.changeType !== "ENTITY_REMOVED") return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      quadro,
      variavel: VARIAVEL_DO_CARGO,
      rotuloDaVariavel: "Cargo no quadro",
      medida: "TEXTO",
      papel: "CONTEXTO",
      rubrica: null,
      attributeCode: null,
      base: a.valueBefore,
      comparada: a.valueAfter,
      diferenca: null,
      variacao: null,
      estado: estadoDaAlteracao(a),
      motivo: a.inconclusiveReason ?? null,
      foraDaSoma: null,
    };
  }

  return {
    id: a.id ?? null,
    entityLabel: a.entityLabel,
    entityType: a.entityType ?? "",
    quadro,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    rubrica: variavel.rubrica ?? null,
    attributeCode: a.attributeCode,
    base: a.valueBefore,
    comparada: a.valueAfter,
    diferenca: numero(a.deltaAbsolute),
    variacao: numero(a.deltaPercent),
    estado: estadoDaAlteracao(a),
    motivo: a.inconclusiveReason ?? null,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

/** As linhas deste quadro numa lista de alterações, na ordem em que vieram. */
export function linhasDeQlpComparado(
  alteracoes: readonly AlteracaoDoMotor[],
  quadro: QuadroDeQlp,
): LinhaDeQlpComparado[] {
  const linhas: LinhaDeQlpComparado[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeQlpDaAlteracao(a, quadro);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas das duas leituras do quadro, e por isso carregam `id: null`.
 */
export function linhaDeQlpSemAlteracao(par: {
  entityLabel: string | null;
  quadro: QuadroDeQlp;
  attributeCode: string;
  valor: string | null;
}): LinhaDeQlpComparado | null {
  const variavel = variavelDoQuadroDoCodigo(par.quadro, par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: TIPO_DO_QUADRO[par.quadro],
    quadro: par.quadro,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    rubrica: variavel.rubrica ?? null,
    attributeCode: par.attributeCode,
    base: par.valor,
    comparada: par.valor,
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    motivo: null,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

/**
 * As rubricas de um quadro, na ordem do catálogo — o recorte por assunto.
 *
 * Existe porque a pergunta "o que mudou no vale-transporte" é diferente de "o
 * que mudou no quadro", e a segunda não responde a primeira: 50 linhas
 * alteradas numa quinzena escondem as duas que são de transporte. `rubrica` já
 * era campo do catálogo (`qlp.ts`), e o que faltava era poder recortar por ela.
 */
export function rubricasDoQuadro(quadro: QuadroDeQlp): string[] {
  const vistas: string[] = [];
  for (const v of VARIAVEIS_DO_QUADRO[quadro]) {
    if (v.rubrica && !vistas.includes(v.rubrica)) vistas.push(v.rubrica);
  }
  return vistas;
}

/**
 * OS MÓDULOS DO QLP — as rubricas lidas como seção, e de onde elas saem.
 *
 * ---------------------------------------------------------------------------
 * Por que eles são derivados, e não uma lista escrita à mão
 * ---------------------------------------------------------------------------
 * Um menu com "Plano de Saúde", "Refeição", "Salário" e "Vale-transporte"
 * escrito à mão concorda com o catálogo no dia em que é escrito. No dia em que
 * a Ambev mandar o export administrativo decomposto — a pergunta que hoje está
 * aberta —, a lista escrita continuaria dizendo que saúde só existe no
 * operacional, e alguém teria de lembrar de vir aqui. Derivada, a seção acende
 * a aba sozinha: o que decide é a coluna estar no catálogo daquele quadro.
 *
 * O inverso também vale, e é o que importa hoje: o administrativo traz
 * benefício **numa coluna só** e o operacional o decompõe em nove. Um módulo
 * que existe num quadro e não no outro não é defeito da tela — é o que o
 * arquivo diz —, e a leitura derivada é a única que sabe disso sem ninguém
 * declarar.
 *
 * O **rótulo** não mora aqui: nomear "saude" de "Plano de saúde" é decisão de
 * apresentação, e este pacote não fala com a tela. Ver `ROTULO_DA_RUBRICA`, no
 * cliente.
 */
export interface ModuloDoQlp {
  /** A rubrica, como o catálogo a escreve: `salario`, `transporte`, `saude`. */
  chave: string;
  /**
   * Os quadros em que este módulo tem coluna — um, ou os dois.
   *
   * Na ordem do catálogo (administrativo antes de operacional), que é a mesma
   * ordem em que as abas se leem.
   */
  quadros: QuadroDeQlp[];
}

/**
 * Uma rubrica é módulo quando ela tem ao menos uma coluna que **mede** algo.
 *
 * Duas ficam de fora, e as duas pelo mesmo motivo: não são assunto de custo,
 * são eixo de leitura. `subtotais` são montantes que já contêm outros, e
 * `benchmark` é a régua da auditoria bimestral — régua, e não custo. Um menu
 * com "Subtotais" ao lado de "Plano de saúde" ofereceria como assunto o que é
 * a forma de ler os assuntos.
 *
 * **O critério é o papel, e não `foraDaSoma`**, e a diferença decide um módulo
 * inteiro: o vale-transporte do administrativo está fora de toda soma enquanto
 * a Ambev não disser se ele já está dentro da despesa de benefício — e isso é
 * uma regra sobre **somar**, não sobre **comparar**. Esta leitura não soma
 * nada: ela põe os dois lados de cada coluna lado a lado. Gatilhar o módulo em
 * `foraDaSoma` apagaria do menu justamente a coluna sobre a qual há uma
 * pergunta aberta.
 *
 * A regra é derivada, e não uma lista de exceções: uma rubrica nova aparece no
 * menu no dia em que a primeira coluna dela entrar no catálogo.
 */
function ehModulo(quadro: QuadroDeQlp, rubrica: string): boolean {
  return VARIAVEIS_DO_QUADRO[quadro].some(
    (v) =>
      v.rubrica === rubrica &&
      (v.papel === "MONTANTE" || v.papel === "PARAMETRO" || v.papel === "QUANTIDADE"),
  );
}

/** Os módulos que o catálogo sustenta hoje, na ordem em que as rubricas aparecem. */
export function modulosDoQlp(): ModuloDoQlp[] {
  const porChave = new Map<string, ModuloDoQlp>();
  for (const quadro of ["ADMINISTRATIVO", "OPERACIONAL"] as const) {
    for (const rubrica of rubricasDoQuadro(quadro)) {
      if (!ehModulo(quadro, rubrica)) continue;
      const modulo = porChave.get(rubrica);
      if (modulo) modulo.quadros.push(quadro);
      else porChave.set(rubrica, { chave: rubrica, quadros: [quadro] });
    }
  }
  return [...porChave.values()];
}

/** Um módulo pelo nome. `undefined` quando nenhum quadro tem essa rubrica. */
export function moduloDoQlp(chave: string): ModuloDoQlp | undefined {
  return modulosDoQlp().find((m) => m.chave === chave);
}

/** Os códigos de uma rubrica dentro de um quadro. Vazio quando ela não existe. */
export function codigosDaRubrica(quadro: QuadroDeQlp, rubrica: string): string[] {
  return VARIAVEIS_DO_QUADRO[quadro]
    .filter((v) => v.rubrica === rubrica)
    .map((v) => v.codigo);
}

// ---------------------------------------------------------------------------
// O cargo, e não a linha — o agrupamento que o grão exige
// ---------------------------------------------------------------------------

/** A chave de um cargo dentro do recorte. */
export function chaveDoCargo(l: Pick<LinhaDeQlpComparado, "entityLabel">): string {
  return l.entityLabel ?? "";
}

/**
 * O estado de um cargo — o mais grave entre os das variáveis dele.
 *
 * A mesma regra da rosca das outras seis (`GRAVIDADE`): um cargo aparece numa
 * fatia só, e quem tem conflito conta como conflito ainda que também tenha uma
 * variável alterada. Sem ela a soma das fatias passaria do total de cargos.
 */
export function estadoDoCargo(linhas: readonly LinhaDeQlpComparado[]): EstadoDaLinha {
  for (const estado of GRAVIDADE) {
    if (linhas.some((l) => l.estado === estado)) return estado;
  }
  return "SEM_ALTERACAO";
}

/** Um cargo do recorte, com as variáveis dele. */
export interface CargoComparado {
  chave: string;
  estado: EstadoDaLinha;
  linhas: LinhaDeQlpComparado[];
  /** Quantas variáveis deste cargo mudaram de valor. */
  variaveisAlteradas: number;
}

/** As linhas agrupadas por cargo, na ordem em que os cargos apareceram. */
export function cargosComparados(
  linhas: readonly LinhaDeQlpComparado[],
): CargoComparado[] {
  const porCargo = new Map<string, LinhaDeQlpComparado[]>();
  for (const linha of linhas) {
    const chave = chaveDoCargo(linha);
    const lista = porCargo.get(chave);
    if (lista) lista.push(linha);
    else porCargo.set(chave, [linha]);
  }
  return [...porCargo.entries()].map(([chave, doCargo]) => ({
    chave,
    estado: estadoDoCargo(doCargo),
    linhas: doCargo,
    variaveisAlteradas: doCargo.filter((l) => l.estado === "ALTERADO").length,
  }));
}

// ---------------------------------------------------------------------------
// O efetivo — a única soma desta tela
// ---------------------------------------------------------------------------

/** O código do efetivo em cada quadro. Mesma escolha de `resumirQuadro`. */
export function codigoDoEfetivo(quadro: QuadroDeQlp): string {
  return quadro === "ADMINISTRATIVO"
    ? "qlp_administrativo.quantidade_ordenados"
    : "qlp_operacional.quantidade_totalx_caminhao_ativo";
}

/** O que o efetivo fez entre as duas pontas. */
export interface MovimentoDoEfetivo {
  /** O efetivo somado de cada ponta. Nulo quando aquela ponta não foi lida. */
  base: number | null;
  comparada: number | null;
  /** `comparada − base`. Nula quando faltou uma das pontas. */
  diferenca: number | null;
  /** Cargos comparados em que o efetivo subiu e em que desceu. */
  cargosQueSubiram: number;
  cargosQueDesceram: number;
  /** Linhas de efetivo que o motor não soube pôr lado a lado. */
  semLeitura: number;
}

/** Texto do acervo virando número. Vazio continua nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O movimento do efetivo entre as duas vigências — posições, não reais.
 *
 * **É a única soma desta tela, e ela é de gente.** Somar quantidade não depende
 * da curadoria de semântica monetária, que é o que trava toda agregação de
 * dinheiro no QLP; somar despesa dependeria, e por isso nenhum cartão daqui a
 * soma. É a mesma fronteira que `resumirQuadro` já traçava.
 *
 * **A diferença sai dos totais das duas pontas, e não da lista de alterações**,
 * e essa distinção custou um número errado antes de existir: um cargo que
 * **sai** do quadro é uma linha só no motor — a entidade removida, sem atributo
 * —, então o efetivo dele não aparece em alteração nenhuma. Derivado da lista,
 * um quadro que perdeu um cargo de quatro posições e mais uma posição de outro
 * mostrava −1 no cartão. Os totais vêm de quem leu as duas vigências inteiras;
 * a lista continua respondendo **quantos cargos** subiram e desceram, que é uma
 * pergunta sobre os comparados e que ela sabe responder.
 */
export function movimentoDoEfetivo(
  linhas: readonly LinhaDeQlpComparado[],
  quadro: QuadroDeQlp,
  totais: { base: number | null; comparada: number | null },
): MovimentoDoEfetivo {
  const codigo = codigoDoEfetivo(quadro);
  const movimento: MovimentoDoEfetivo = {
    base: totais.base,
    comparada: totais.comparada,
    diferenca:
      totais.base === null || totais.comparada === null
        ? null
        : Number((totais.comparada - totais.base).toFixed(4)),
    cargosQueSubiram: 0,
    cargosQueDesceram: 0,
    semLeitura: 0,
  };

  for (const linha of linhas) {
    if (linha.attributeCode !== codigo) continue;
    if (linha.estado === "CONFLITO" || linha.estado === "DADO_INCOMPLETO") {
      movimento.semLeitura += 1;
      continue;
    }
    const antes = comoNumero(linha.base);
    const depois = comoNumero(linha.comparada);
    const delta =
      antes !== null && depois !== null
        ? depois - antes
        : depois !== null
          ? depois
          : antes !== null
            ? -antes
            : null;
    if (delta === null || delta === 0) continue;
    if (delta > 0) movimento.cargosQueSubiram += 1;
    else movimento.cargosQueDesceram += 1;
  }

  return movimento;
}

/**
 * O efetivo somado de uma vigência inteira — a ponta que a comparação precisa.
 *
 * Recebe os valores como o acervo os guarda (texto), porque quem lê o quadro é
 * quem tem a leitura: este módulo não fala com o banco. Nulo quando a vigência
 * não trouxe a coluna do efetivo — e nulo não é zero, que é o que faria um
 * quadro sem a coluna parecer um quadro sem gente.
 */
export function somarEfetivo(
  valores: readonly (string | null)[],
): number | null {
  let soma: number | null = null;
  for (const valor of valores) {
    const n = comoNumero(valor);
    if (n === null) continue;
    soma = (soma ?? 0) + n;
  }
  return soma === null ? null : Number(soma.toFixed(4));
}

// ---------------------------------------------------------------------------
// Os agregados da tela
// ---------------------------------------------------------------------------

/** Os cargos de cada lado, como o motor os contou. */
export interface QuadroDoPar {
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDaComparacaoDeQlp {
  quadro: QuadroDeQlp;
  cargosComparados: number;
  cargosComAlteracao: number;
  semAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  variaveisAlteradas: number;
  cargosComDadoIncompleto: number;
  cargosComConflito: number;
  efetivo: MovimentoDoEfetivo;
  /**
   * Quantas linhas alteradas são de colunas que não entram em soma.
   *
   * O subtotal do operacional muda junto com as parcelas dele: contá-los no
   * mesmo número diria que mudaram duas coisas onde mudou uma. O cartão mostra
   * o total e mostra quantas dele são de subtotal, e nunca some com as duas.
   */
  alteracoesForaDaSoma: number;
  /**
   * Por que esta tela não mostra impacto em dinheiro. Frase pronta, sempre a
   * mesma — a tela a exibe onde as outras seis mostram reais.
   */
  semImpactoFinanceiro: string;
}

/** A frase do travamento, escrita uma vez. */
export const SEM_IMPACTO_FINANCEIRO =
  "As colunas do QLP chegam sem semântica confirmada, e somar o que a curadoria " +
  "não confirmou seria adivinhação — é o mesmo portão da aba do Quadro. Esta " +
  "comparação conta o que mudou, cargo a cargo, e soma só o efetivo, que é de " +
  "gente e não de dinheiro.";

/**
 * Quantas variáveis do quadro se moveram — a contagem, sozinha.
 *
 * Está fora de `resumirComparacaoDeQlp` porque `/qlp/candidatos` precisa dela e
 * não pode pagar o resto: o resumo inteiro pede o quadro do par (uma consulta) e
 * o efetivo das duas pontas (outra leitura), e o menu perguntaria isso uma vez
 * por candidata. Copiar o `filter` para lá seria a segunda régua — no dia em que
 * "alterado" ganhasse uma nuance, o menu e a tela contariam diferente sem que
 * nada dissesse por quê.
 */
export function variaveisAlteradasDeQlp(linhas: readonly LinhaDeQlpComparado[]): number {
  return linhas.filter((l) => l.estado === "ALTERADO").length;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `cargosComparados` vem da contagem do snapshot, e não do tamanho da lista:
 * um cargo em que nada mudou não produz alteração nenhuma, e derivá-lo da lista
 * daria zero justamente na comparação em que nada se moveu.
 */
export function resumirComparacaoDeQlp(
  linhas: readonly LinhaDeQlpComparado[],
  quadro: QuadroDeQlp,
  quadroDoPar: QuadroDoPar,
  efetivo: { base: number | null; comparada: number | null },
): ResumoDaComparacaoDeQlp {
  const cargos = cargosComparados(linhas);
  const comEstado = (estado: EstadoDaLinha) =>
    cargos.filter((c) => c.estado === estado).length;

  return {
    quadro,
    cargosComparados: quadroDoPar.comparados,
    cargosComAlteracao: comEstado("ALTERADO"),
    semAlteracao: Math.max(0, quadroDoPar.comparados - comEstado("ALTERADO")),
    novosNaVigencia: quadroDoPar.novos,
    ausentesNaComparada: quadroDoPar.ausentes,
    variaveisAlteradas: variaveisAlteradasDeQlp(linhas),
    cargosComDadoIncompleto: comEstado("DADO_INCOMPLETO"),
    cargosComConflito: comEstado("CONFLITO"),
    efetivo: movimentoDoEfetivo(linhas, quadro, efetivo),
    alteracoesForaDaSoma: linhas.filter(
      (l) => l.estado === "ALTERADO" && l.foraDaSoma !== null,
    ).length,
    semImpactoFinanceiro: SEM_IMPACTO_FINANCEIRO,
  };
}

/** Quantas alterações cada variável do quadro sofreu. */
export interface AlteracoesDaVariavelDeQlp {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelNoQuadro;
  rubrica: string | null;
  alteracoes: number;
  foraDaSoma: string | null;
}

/**
 * As variáveis do quadro, da mais alterada para a menos — **todas elas**.
 *
 * Inclusive as que não mudaram, e isso é o ponto: uma barra vazia ao lado de
 * "Salário unitário" diz que ninguém mexeu em salário nesta quinzena, e essa é
 * uma resposta. Uma lista que só mostrasse o que mudou deixaria quem procura a
 * variável sem saber se ela não mudou ou se a tela não a lê.
 */
export function alteracoesPorVariavelDeQlp(
  linhas: readonly LinhaDeQlpComparado[],
  quadro: QuadroDeQlp,
): AlteracoesDaVariavelDeQlp[] {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.estado !== "ALTERADO") continue;
    contagem.set(linha.variavel, (contagem.get(linha.variavel) ?? 0) + 1);
  }
  return VARIAVEIS_DO_QUADRO[quadro]
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      papel: v.papel,
      rubrica: v.rubrica ?? null,
      alteracoes: contagem.get(v.chave) ?? 0,
      foraDaSoma: v.foraDaSoma ?? null,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

/** Uma fatia da rosca: quantos cargos em cada estado. */
export interface FatiaDeEstadoDeQlp {
  estado: EstadoDaLinha;
  cargos: number;
}

/**
 * Os cargos por estado — um cargo numa fatia só, pela gravidade.
 *
 * Os `semAlteracao` não vêm das linhas: o `change_set` não guarda o que não
 * mudou, e contá-los pela lista daria zero. Eles saem da contagem do snapshot,
 * como `cargosComparados`.
 */
export function distribuicaoPorEstadoDeQlp(
  linhas: readonly LinhaDeQlpComparado[],
  quadroDoPar: QuadroDoPar,
): FatiaDeEstadoDeQlp[] {
  const cargos = cargosComparados(linhas);
  const contagem = new Map<EstadoDaLinha, number>();
  for (const cargo of cargos) {
    contagem.set(cargo.estado, (contagem.get(cargo.estado) ?? 0) + 1);
  }
  const mexidos = cargos.filter((c) => c.estado !== "SEM_ALTERACAO").length;
  contagem.set("SEM_ALTERACAO", Math.max(0, quadroDoPar.comparados - mexidos));

  return GRAVIDADE.map((estado) => ({ estado, cargos: contagem.get(estado) ?? 0 })).filter(
    (f) => f.cargos > 0,
  );
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_QLP_COMPARADO = [
  "Cargo",
  "Quadro",
  "Variável",
  "Papel",
  "Rubrica",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/**
 * Uma linha do CSV, na ordem do cabeçalho. Números crus — a tela formata.
 *
 * O aviso da coluna que não soma viaja junto, e existe no arquivo porque o
 * arquivo sai do produto e vira soma na planilha de outra pessoa: um CSV que
 * exporta o subtotal sem dizer que ele embute as parcelas é um convite a dobrar
 * a folha fora daqui. A justificativa vem pelo mesmo motivo que ela está na
 * tabela — a explicação de uma queda vale tanto quanto a queda.
 */
export function celulasDoCsvDeQlpComparado(
  linha: LinhaDeQlpComparado,
  rotuloDoCargo: string,
  rotuloDoEstado: string,
  justificativa: string | null = null,
): (string | number | null)[] {
  return [
    rotuloDoCargo,
    linha.quadro,
    linha.rotuloDaVariavel,
    linha.papel,
    linha.rubrica,
    linha.base,
    linha.comparada,
    linha.diferenca,
    linha.variacao,
    rotuloDoEstado,
    linha.motivo,
    linha.foraDaSoma,
    justificativa,
  ];
}
