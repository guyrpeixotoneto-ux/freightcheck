import { severityOf, type PriorityReason, type Severity } from "./cockpit";
import {
  ROTULO_DO_QUADRO,
  TIPO_DO_QUADRO,
  type PapelNoQuadro,
  type QuadroDeQlp,
} from "./qlp";
import {
  SEM_IMPACTO_FINANCEIRO,
  movimentoDoEfetivo,
  type LinhaDeQlpComparado,
  type MovimentoDoEfetivo,
} from "./qlp-comparacao";
import type { EstadoDaLinha, MedidaDaVariavel } from "./recorte-de-rubrica";

/**
 * O MONITOR EQUIPE — a composição das respostas do quadro de pessoal, e nunca
 * uma resposta nova.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo é
 * ---------------------------------------------------------------------------
 * Ele é, para a seção Equipe, o que `monitor-custo-fixo.ts` é para a seção
 * Custo Fixo: põe lado a lado **todos os módulos por assunto** — salário,
 * encargos, vale-transporte, plano de saúde, refeição… — nos **dois quadros**,
 * para que alguém abra o dia sem passar por dezesseis telas. E é só isso: ele
 * compõe o que `qlp-comparacao.ts` já decidiu, linha a linha, e não re-decide
 * nada.
 *
 * Quem quiser o cargo inteiro, a rosca de estados ou a exportação continua indo
 * ao módulo (`/qlp/<rubrica>`) ou ao quadro (`/qlp-operacional`,
 * `/qlp-administrativo`). O Monitor não copia nenhuma das duas telas — ele
 * responde a pergunta que nenhuma responde, que é *o que mudou hoje no quadro
 * de pessoal inteiro*, e devolve para a tela de origem no primeiro clique.
 *
 * ---------------------------------------------------------------------------
 * A recusa que este Monitor herda, e que o distingue do outro
 * ---------------------------------------------------------------------------
 * **Aqui não se soma dinheiro, e não é por prudência: é o mesmo portão que a
 * aba do Quadro e a comparação por cargo já sustentam.** As colunas do QLP
 * chegam sem semântica confirmada (`docs/ACHADO-QLP.md`), e um cartão de
 * "impacto em reais" aqui seria a primeira soma monetária do QLP no produto
 * inteiro, feita justamente na tela que consolida dezesseis recortes — o lugar
 * onde ninguém iria conferi-la. A frase do travamento viaja no consolidado
 * ({@link SEM_IMPACTO_FINANCEIRO}, reexportada de `qlp-comparacao.ts` e não
 * redigitada) e a tela a escreve onde o Monitor Custo Fixo escreve reais.
 *
 * O que sobra é o que o quadro sabe responder: **contagens** — quantas
 * alterações, em que assunto, em que cargo, de que natureza — e **uma** soma, a
 * do efetivo, que é de gente e não de dinheiro. E mesmo ela não nasce aqui: ela
 * é `movimentoDoEfetivo`, a função que a comparação por cargo já usa, chamada
 * sobre os totais das duas pontas que a rota leu.
 *
 * ---------------------------------------------------------------------------
 * Por que o par é por quadro, e não um só da tela
 * ---------------------------------------------------------------------------
 * Porque o motor recusa comparar coberturas diferentes (`engine.ts`), e o
 * administrativo e o operacional são séries próprias dentro da mesma família:
 * cada um tem as vigências dele. Um par único da tela obrigaria a inventar uma
 * correspondência entre as duas séries — e a inventaria em silêncio, na tela
 * cujo trabalho é dizer o que se moveu.
 *
 * É a mesma decisão que `ParDoMonitor` documenta do outro lado, e ela foi
 * escrita lá **antecipando este módulo**: "quebraria no dia em que o QLP entrar,
 * que é de outra família e tem vigências próprias". Este é o dia.
 *
 * Um quadro sem par não some da tela: ele entra com o motivo por extenso
 * ({@link QuadroNoMonitor.ausente}), pela mesma razão que a aba sem coluna
 * aparece dizendo por que está vazia — esconder faria a ausência parecer
 * escolha da tela.
 *
 * Sem SQL e sem React, como os recortes que ele compõe: é sobre estas funções
 * que os testes rodam sem um Postgres de pé.
 */

// ---------------------------------------------------------------------------
// Os módulos
// ---------------------------------------------------------------------------

/**
 * O módulo de uma linha é a **rubrica** dela, e ela vem do catálogo.
 *
 * Não há lista escrita aqui, e é de propósito: `modulosDoQlp()` deriva os
 * módulos das colunas que cada quadro declara, e é ele que decide quais
 * existem. Uma lista neste arquivo concordaria com o catálogo no dia em que
 * fosse escrita — e no dia seguinte diria que refeição só existe no
 * operacional, mesmo depois de a Ambev mandar o administrativo decomposto. A
 * mesma razão que a seção Equipe dá na lateral.
 */
export type ModuloDeEquipe = string;

/**
 * O módulo das linhas que **não citam atributo**: um cargo que entrou ou saiu.
 *
 * O motor grava entrada e saída uma vez por entidade, sem atributo — então elas
 * não têm rubrica, e nenhum módulo por assunto as reivindica. Sumir com elas
 * esconderia a metade mais visível do que muda num quadro de pessoal, e
 * empurrá-las para uma rubrica qualquer diria que quem saiu do quadro saiu "de
 * salário".
 *
 * Elas entram como módulo próprio, e o endereço delas é o do **quadro**, não o
 * de uma rubrica: é lá que se lê o cargo inteiro. Com isso a identidade fecha —
 * a soma das alterações dos módulos é a contagem do consolidado, sem resto.
 */
export const MODULO_DO_CARGO: ModuloDeEquipe = "cargo";

/**
 * A rubrica sob a qual entra a coluna que o catálogo trouxe sem nenhuma.
 *
 * É o valor que `qlp.ts` já usa no catálogo, e não um nome novo: o Monitor não
 * inventa gaveta para o que a curadoria ainda não gavetou.
 */
export const MODULO_SEM_RUBRICA: ModuloDeEquipe = "nao_identificado";

/** O endereço da tela de cada quadro — a origem de "Abrir o quadro". */
export const ROTA_DO_QUADRO: Record<QuadroDeQlp, string> = {
  ADMINISTRATIVO: "/qlp-administrativo",
  OPERACIONAL: "/qlp-operacional",
};

/**
 * O endereço de um módulo — a origem de "Abrir o módulo".
 *
 * Mora aqui, e não na tela, pela razão que `ROTA_DO_MODULO` dá do outro lado: é
 * o domínio que sabe qual módulo produziu a linha, e um endereço montado à mão
 * dentro de um componente é onde a promessa vazia nasce.
 */
export function rotaDoModuloDeEquipe(
  modulo: ModuloDeEquipe,
  quadro: QuadroDeQlp,
): string {
  return modulo === MODULO_DO_CARGO ? ROTA_DO_QUADRO[quadro] : `/qlp/${modulo}`;
}

// ---------------------------------------------------------------------------
// A situação de uma alteração diante da agregação
// ---------------------------------------------------------------------------

/**
 * O que se pode **fazer com o número** desta alteração — quatro situações, e
 * elas particionam a lista.
 *
 * O Monitor Custo Fixo tem quatro situações porque lá a pergunta é *virou
 * dinheiro?*. Aqui a pergunta é outra, porque a resposta de dinheiro já está
 * dada para o quadro inteiro: nenhuma coluna do QLP vira reais enquanto a
 * semântica não for confirmada. O que resta perguntar é *que grandeza é esta, e
 * o que o produto tem direito de fazer com ela*:
 *
 * - `EFETIVO` — é contagem de gente (papel `QUANTIDADE`). É a **única**
 *   grandeza que este produto soma no QLP, e é a que move o cartão de efetivo.
 * - `SEM_VALORACAO` — é dinheiro, e não vira número: montante e parâmetro
 *   unitário chegam sem semântica confirmada. **Nunca vira R$ 0,00** — zero é
 *   uma medição, e isto é a ausência de uma. O motivo é a frase do travamento,
 *   e não um palpite desta tela.
 * - `FORA_DA_SOMA` — é dinheiro que já está contado noutra linha (subtotal) ou
 *   que não é custo (benchmark, a régua da auditoria bimestral), ou ainda a
 *   coluna que o catálogo marcou com o aviso de não somar. Separada da de cima
 *   porque as duas são coisas diferentes: uma é uma conversão que falta, a
 *   outra é uma soma que não deve acontecer nunca.
 * - `NAO_MONETARIA` — não é dinheiro **por natureza**: turno, cargo, unidade,
 *   percentual, data. Dizer "sem valoração" sobre um turno mandaria alguém
 *   procurar uma curadoria que nunca vai vir.
 *
 * A identidade fecha por construção — cada linha tem exatamente uma situação —,
 * e é o que permite ao cartão dizer
 * `efetivo + sem valoração + fora da soma + não monetárias = alterações`.
 */
export type SituacaoDaLinhaDeEquipe =
  | "EFETIVO"
  | "SEM_VALORACAO"
  | "FORA_DA_SOMA"
  | "NAO_MONETARIA";

export const SITUACOES_DA_EQUIPE: readonly SituacaoDaLinhaDeEquipe[] = [
  "EFETIVO",
  "SEM_VALORACAO",
  "FORA_DA_SOMA",
  "NAO_MONETARIA",
];

export const ROTULO_DA_SITUACAO_DE_EQUIPE: Record<SituacaoDaLinhaDeEquipe, string> = {
  EFETIVO: "Efetivo",
  SEM_VALORACAO: "Sem valoração",
  FORA_DA_SOMA: "Fora da soma",
  NAO_MONETARIA: "Não monetária",
};

const MOTIVO_DE_SUBTOTAL =
  "Subtotal e benchmark não entram em soma: o primeiro já contém as parcelas " +
  "que estão nas outras linhas, e o segundo é a régua da auditoria, não um " +
  "custo. Somá-los junto das parcelas dobraria a folha.";

const MOTIVO_NAO_MONETARIA =
  "Esta coluna não mede dinheiro — ela situa o cargo (turno, unidade, cargo) " +
  "ou declara uma taxa. Não há conversão em reais a esperar por ela.";

/**
 * A situação de uma linha — a decisão que o cartão e a tabela publicam.
 *
 * A ordem dos testes importa, e é a mesma lógica da função irmã: o que nunca
 * pode ser somado sai primeiro, depois o que é gente, depois o que é dinheiro
 * travado, e por último o que não é nenhum dos três.
 *
 * O aviso do catálogo (`foraDaSoma`) entra no primeiro teste junto do papel
 * porque ele é a mesma decisão dita de outro jeito — é o vale-transporte do
 * administrativo, que fica fora de toda soma enquanto a Ambev não disser se ele
 * já está dentro da despesa de benefício. Ficar fora da soma **não** o tira do
 * Monitor: ele continua linha, continua contado, e diz por que não soma.
 */
export function situacaoDaLinhaDeEquipe(l: {
  medida: MedidaDaVariavel;
  papel: PapelNoQuadro;
  foraDaSoma: string | null;
  motivo: string | null;
}): { situacao: SituacaoDaLinhaDeEquipe; motivo: string | null } {
  if (l.papel === "SUBTOTAL" || l.papel === "BENCHMARK") {
    return { situacao: "FORA_DA_SOMA", motivo: l.foraDaSoma ?? MOTIVO_DE_SUBTOTAL };
  }
  if (l.foraDaSoma) {
    return { situacao: "FORA_DA_SOMA", motivo: l.foraDaSoma };
  }
  if (l.papel === "QUANTIDADE") {
    return { situacao: "EFETIVO", motivo: l.motivo };
  }
  if (l.medida === "DINHEIRO") {
    return { situacao: "SEM_VALORACAO", motivo: l.motivo ?? SEM_IMPACTO_FINANCEIRO };
  }
  return { situacao: "NAO_MONETARIA", motivo: l.motivo ?? MOTIVO_NAO_MONETARIA };
}

// ---------------------------------------------------------------------------
// O par, por quadro
// ---------------------------------------------------------------------------

/**
 * O par de vigências de um quadro.
 *
 * Carrega o quadro dentro de si porque é ele que identifica a série: um par
 * sem o quadro seria dois identificadores que a tela teria de casar com uma
 * aba, e casar identificadores por posição é como o par errado aparece embaixo
 * do rótulo certo.
 */
export interface ParDoMonitorDeEquipe {
  quadro: QuadroDeQlp;
  baseId: string;
  comparadaId: string;
  baseRotulo: string | null;
  comparadaRotulo: string | null;
  baseData: string | null;
  comparadaData: string | null;
}

// ---------------------------------------------------------------------------
// A linha normalizada
// ---------------------------------------------------------------------------

export interface LinhaDoMonitorDeEquipe {
  /**
   * A chave desta linha dentro do Monitor.
   *
   * Carrega o quadro porque o mesmo cargo pode existir nos dois, e carrega o
   * `changeId` porque é ele que liga à justificativa e à proveniência. Nas
   * linhas que o motor não produziu, cai no par cargo+variável, que é o que as
   * identifica.
   */
  id: string;
  modulo: ModuloDeEquipe;
  quadro: QuadroDeQlp;
  /** O `change.id`. É por ele que se chega à comparação original e ao rastro. */
  changeId: number | null;
  par: ParDoMonitorDeEquipe;
  cargo: {
    /**
     * O cargo como o motor o rotula — a **chave normalizada**.
     *
     * A forma legível não vem daqui, e isso não é esquecimento: ela mora em
     * `entity_identifier.identifier_value_raw`, e quem a lê é a rota, que
     * devolve o dicionário de rótulos junto. É a mesma decisão de
     * `/qlp/comparacao`, e pela mesma razão — 41 cargos e centenas de linhas,
     * e repetir o rótulo em cada uma seria mandar a mesma frase dezenas de
     * vezes.
     */
    chave: string;
    entityType: string;
  };
  variavel: {
    chave: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    papel: PapelNoQuadro;
    attributeCode: string | null;
  };
  estado: EstadoDaLinha;
  /** O texto do valor, como o recorte o entregou. O Monitor não converte. */
  valorAnterior: string | null;
  valorAtual: string | null;
  /** `Para − De`, como o motor a produziu. Nula quando ele não a produziu. */
  diferenca: number | null;
  /** A variação em pontos percentuais, como o motor a produziu. */
  variacao: number | null;
  situacao: {
    tipo: SituacaoDaLinhaDeEquipe;
    /** Por que esta linha não soma, na frase de quem decidiu. */
    motivo: string | null;
  };
  prioridade: { nivel: Severity; score: number; motivos: PriorityReason[] };
  origem: {
    modulo: ModuloDeEquipe;
    quadro: QuadroDeQlp;
    rota: string;
    changeSetId: string | null;
  };
}

/**
 * A prioridade de uma alteração do quadro — **a régua do cockpit, sobre os
 * fatos que o QLP tem**.
 *
 * A tradução score → severidade é `severityOf`, importada de `cockpit.ts` e não
 * redigitada, pela mesma razão que o Monitor Custo Fixo a importa: duas tabelas
 * de corte divergiriam, e a fila do Monitor deixaria de ser a mesma fila do
 * resto do produto.
 *
 * **O que muda são os critérios, e eles mudam porque o fato financeiro não
 * existe aqui.** Lá, os 35 pontos do topo são "impacto financeiro apurado".
 * Aqui não há impacto apurado em lugar nenhum, e fabricar um para poder somar
 * os mesmos pontos seria dar o nome daquela conta a outra conta. Os 35 vão para
 * os dois fatos que, num quadro de pessoal, são o equivalente: o cargo entrou
 * ou saiu, e o efetivo dele mudou. São as duas coisas que mexem na folha sem
 * depender de nenhuma curadoria.
 *
 * | critério | pontos |
 * |---|---|
 * | o cargo entrou ou saiu do quadro | 35 |
 * | o efetivo do cargo mudou | 35 |
 * | valor em dinheiro se moveu (sem valoração) | 20 |
 * | o valor conflitou ou ficou incompleto | 10 |
 * | variação de 100% / 50% / 20% ou mais | 20 / 12 / 6 |
 *
 * E a fila fica explicável: `motivos` é a lista de parcelas que somaram o
 * score, e é ela que o painel lateral mostra, com os pontos de cada uma.
 */
export function prioridadeDaLinhaDeEquipe(
  l: { estado: EstadoDaLinha; variacao: number | null },
  situacao: SituacaoDaLinhaDeEquipe,
): { nivel: Severity; score: number; motivos: PriorityReason[] } {
  const motivos: PriorityReason[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) motivos.push({ label, points });
  };

  const entrouOuSaiu =
    l.estado === "NOVO_NA_VIGENCIA" || l.estado === "AUSENTE_NA_COMPARADA";

  if (entrouOuSaiu) {
    add("o cargo entrou ou saiu do quadro", 35);
  } else if (situacao === "EFETIVO" && l.estado === "ALTERADO") {
    add("o efetivo do cargo mudou", 35);
  } else if (situacao === "SEM_VALORACAO" && l.estado === "ALTERADO") {
    add("valor em dinheiro se moveu, e o QLP não o precifica", 20);
  }

  if (l.estado === "CONFLITO" || l.estado === "DADO_INCOMPLETO") {
    add("o valor conflitou ou ficou incompleto", 10);
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

/**
 * As linhas de um quadro, normalizadas. Nenhuma agregação acontece aqui.
 *
 * Recebe exatamente o que `linhasDeQlpComparado` devolve — a mesma lista que a
 * comparação por cargo desenha —, e o que ela faz é carimbar o módulo, o par e
 * a situação. É este o ponto em que o Monitor deixa de decidir: daqui para
 * baixo, cada campo é o que o recorte publicou.
 */
export function normalizarLinhasDeEquipe(
  linhas: readonly LinhaDeQlpComparado[],
  par: ParDoMonitorDeEquipe,
  changeSetId: string | null,
): LinhaDoMonitorDeEquipe[] {
  return linhas.map((l) => {
    const { situacao, motivo } = situacaoDaLinhaDeEquipe(l);
    /*
      A linha sem `attributeCode` é a entrada ou a saída de um cargo — o motor
      a grava por entidade, e ela não tem rubrica. As demais caem na rubrica do
      catálogo, e as que o catálogo trouxe sem rubrica caem na gaveta que ele
      mesmo declara para elas.
    */
    const modulo =
      l.attributeCode === null
        ? MODULO_DO_CARGO
        : (l.rubrica ?? MODULO_SEM_RUBRICA);
    const chaveDoCargo = l.entityLabel ?? "(sem identificação)";
    return {
      id: `${par.quadro}:${modulo}:${l.id ?? `${chaveDoCargo}:${l.variavel}`}`,
      modulo,
      quadro: par.quadro,
      changeId: l.id,
      par,
      cargo: {
        chave: chaveDoCargo,
        entityType: l.entityType || TIPO_DO_QUADRO[par.quadro],
      },
      variavel: {
        chave: l.variavel,
        rotulo: l.rotuloDaVariavel,
        medida: l.medida,
        papel: l.papel,
        attributeCode: l.attributeCode,
      },
      estado: l.estado,
      valorAnterior: l.base,
      valorAtual: l.comparada,
      diferenca: l.diferenca,
      variacao: l.variacao,
      situacao: { tipo: situacao, motivo },
      prioridade: prioridadeDaLinhaDeEquipe(l, situacao),
      origem: {
        modulo,
        quadro: par.quadro,
        rota: rotaDoModuloDeEquipe(modulo, par.quadro),
        changeSetId,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Os agregados
// ---------------------------------------------------------------------------

/** O separador de chaves. Mesmo caractere que os recortes usam. */
const SEP = "";

const zeradoPorSituacao = (): Record<SituacaoDaLinhaDeEquipe, number> =>
  Object.fromEntries(SITUACOES_DA_EQUIPE.map((s) => [s, 0])) as Record<
    SituacaoDaLinhaDeEquipe,
    number
  >;

export interface ResumoDoModuloDeEquipe {
  modulo: ModuloDeEquipe;
  /** Os quadros em que **este recorte** trouxe linha deste módulo. */
  quadros: QuadroDeQlp[];
  /** Quantas alterações em cada quadro. A soma é `alteracoes`. */
  porQuadro: { quadro: QuadroDeQlp; alteracoes: number }[];
  alteracoes: number;
  porSituacao: Record<SituacaoDaLinhaDeEquipe, number>;
  /** As linhas em que o valor de fato mudou — `ALTERADO`, e nada mais. */
  variaveisAlteradas: number;
  /** Cargos que entraram e que saíram do quadro, neste módulo. */
  cargosQueEntraram: number;
  cargosQueSairam: number;
  /** Contagens de efetivo: em quantos cargos ele subiu e em quantos desceu. */
  quantidadesQueSubiram: number;
  quantidadesQueDesceram: number;
  /** Os cargos distintos tocados. A lista, e não só o tamanho — ver {@link consolidarEquipe}. */
  cargos: string[];
}

/**
 * O resumo de um módulo — contagens, e só contagens.
 *
 * Não há `impactoDeOrigem` como no Monitor Custo Fixo, e a ausência é o
 * conteúdo: lá cada módulo publica um resumo financeiro nativo, e o consolidado
 * o repassa inteiro para não achatar os achados de cada rubrica. Aqui nenhum
 * módulo publica número financeiro nenhum — publicar um campo vazio com esse
 * nome sugeriria que um dia ele vem cheio sem que nada mude na curadoria.
 *
 * As direções do efetivo saem de `diferenca`, que é o que o **motor** produziu
 * para aquela linha, e nunca de uma subtração feita aqui. E elas são
 * **contagens de cargos**, não posições: quantas posições o quadro ganhou ou
 * perdeu é uma pergunta sobre as duas pontas inteiras, e quem a responde é
 * {@link QuadroNoMonitor.efetivo} — pela razão que `movimentoDoEfetivo`
 * documenta, e que já custou um número errado antes de existir.
 */
export function resumirModuloDeEquipe(
  modulo: ModuloDeEquipe,
  linhas: readonly LinhaDoMonitorDeEquipe[],
): ResumoDoModuloDeEquipe {
  const porSituacao = zeradoPorSituacao();
  const cargos = new Set<string>();
  const porQuadro = new Map<QuadroDeQlp, number>();
  let variaveisAlteradas = 0;
  let cargosQueEntraram = 0;
  let cargosQueSairam = 0;
  let quantidadesQueSubiram = 0;
  let quantidadesQueDesceram = 0;

  for (const l of linhas) {
    porSituacao[l.situacao.tipo]++;
    cargos.add(`${l.quadro}${SEP}${l.cargo.chave}`);
    porQuadro.set(l.quadro, (porQuadro.get(l.quadro) ?? 0) + 1);
    if (l.estado === "ALTERADO") variaveisAlteradas++;
    if (l.estado === "NOVO_NA_VIGENCIA") cargosQueEntraram++;
    if (l.estado === "AUSENTE_NA_COMPARADA") cargosQueSairam++;
    if (l.situacao.tipo === "EFETIVO" && l.estado === "ALTERADO" && l.diferenca !== null) {
      if (l.diferenca > 0) quantidadesQueSubiram++;
      if (l.diferenca < 0) quantidadesQueDesceram++;
    }
  }

  return {
    modulo,
    quadros: [...porQuadro.keys()],
    porQuadro: [...porQuadro.entries()].map(([quadro, alteracoes]) => ({
      quadro,
      alteracoes,
    })),
    alteracoes: linhas.length,
    porSituacao,
    variaveisAlteradas,
    cargosQueEntraram,
    cargosQueSairam,
    quantidadesQueSubiram,
    quantidadesQueDesceram,
    cargos: [...cargos],
  };
}

/**
 * Um quadro dentro do Monitor — o par dele, o que ele moveu, ou por que ele não
 * está aqui.
 *
 * `ausente` é uma frase, e não um booleano, porque as razões de um quadro não
 * entrar são diferentes entre si e pedem frases diferentes de quem lê: só uma
 * vigência importada, nenhuma, ou duas de unidades que o motor não casa. Quem
 * escreve a frase é a rota, que é quem leu o acervo.
 */
export interface QuadroNoMonitor {
  quadro: QuadroDeQlp;
  rotulo: string;
  rota: string;
  /** `null` quando o quadro não entrou — e então `ausente` diz por quê. */
  par: ParDoMonitorDeEquipe | null;
  ausente: string | null;
  alteracoes: number;
  cargosAfetados: number;
  /**
   * O que o efetivo fez entre as duas pontas.
   *
   * `null` quando o quadro não entrou. Quando entra, é
   * {@link movimentoDoEfetivo} — a função da comparação por cargo, chamada
   * sobre os totais que a rota leu das duas pontas inteiras. Derivá-lo da lista
   * de alterações daria −1 num quadro que perdeu um cargo de quatro posições,
   * que é o defeito que aquela função documenta.
   */
  efetivo: MovimentoDoEfetivo | null;
}

export interface ResumoDoMonitorDeEquipe {
  alteracoes: number;
  porSituacao: Record<SituacaoDaLinhaDeEquipe, number>;
  variaveisAlteradas: number;
  cargosQueEntraram: number;
  cargosQueSairam: number;
  /** Cargos distintos tocados, **sem contar o mesmo duas vezes**. */
  cargosAfetados: number;
  porQuadro: QuadroNoMonitor[];
  porModulo: ResumoDoModuloDeEquipe[];
  /**
   * Por que esta tela não mostra impacto em dinheiro — a frase do travamento,
   * a mesma que a comparação por cargo publica, e não uma segunda redação dela.
   */
  semImpactoFinanceiro: string;
}

/** O quadro de um par, montado com o que o Monitor sabe sobre ele. */
export function quadroDoMonitor(
  quadro: QuadroDeQlp,
  par: ParDoMonitorDeEquipe | null,
  linhas: readonly LinhaDoMonitorDeEquipe[],
  totaisDoEfetivo: { base: number | null; comparada: number | null } | null,
  ausente: string | null,
): QuadroNoMonitor {
  const doQuadro = linhas.filter((l) => l.quadro === quadro);
  const cargos = new Set(doQuadro.map((l) => l.cargo.chave));
  return {
    quadro,
    rotulo: ROTULO_DO_QUADRO[quadro],
    rota: ROTA_DO_QUADRO[quadro],
    par,
    ausente,
    alteracoes: doQuadro.length,
    cargosAfetados: cargos.size,
    /*
      O movimento do efetivo é a função da comparação por cargo, sobre as linhas
      deste quadro e os totais das duas pontas. Uma segunda conta aqui seria a
      segunda régua do mesmo efetivo — e a primeira a divergir seria esta, que é
      a que ninguém abre para conferir.
    */
    efetivo:
      totaisDoEfetivo === null
        ? null
        : movimentoDoEfetivo(linhasDeOrigem(doQuadro), quadro, totaisDoEfetivo),
  };
}

/**
 * As linhas do Monitor de volta à forma que `movimentoDoEfetivo` lê.
 *
 * A função irmã filtra por `attributeCode` e olha `base`, `comparada` e
 * `estado` — três campos que a linha normalizada carrega com outros nomes.
 * Traduzir de volta é mais honesto do que reescrever a contagem aqui: a régua
 * do efetivo continua sendo uma só, e ela continua morando onde a comparação
 * por cargo a mantém sob teste.
 */
function linhasDeOrigem(
  linhas: readonly LinhaDoMonitorDeEquipe[],
): LinhaDeQlpComparado[] {
  return linhas.map((l) => ({
    id: l.changeId,
    entityLabel: l.cargo.chave,
    entityType: l.cargo.entityType,
    quadro: l.quadro,
    variavel: l.variavel.chave,
    rotuloDaVariavel: l.variavel.rotulo,
    medida: l.variavel.medida,
    papel: l.variavel.papel,
    rubrica: l.modulo === MODULO_DO_CARGO ? null : l.modulo,
    attributeCode: l.variavel.attributeCode,
    base: l.valorAnterior,
    comparada: l.valorAtual,
    diferenca: l.diferenca,
    variacao: l.variacao,
    estado: l.estado,
    motivo: l.situacao.motivo,
    foraDaSoma: null,
  }));
}

/**
 * O consolidado — a composição dos resumos, e nada além disso.
 *
 * A única aritmética aqui é **contar**: alterações, cargos, situações. Não há
 * soma de dinheiro porque não há dinheiro, e não há soma de efetivo porque a do
 * efetivo mora no quadro, sobre as duas pontas inteiras.
 *
 * `cargosAfetados` sai da **união** dos conjuntos, e não da soma das contagens:
 * o mesmo cargo aparece em salário e em encargos, e somar daria mais cargos do
 * que o quadro tem. É o mesmo defeito que `consolidar` corrige do outro lado, e
 * a mesma correção.
 */
export function consolidarEquipe(
  modulos: readonly ResumoDoModuloDeEquipe[],
  quadros: readonly QuadroNoMonitor[],
): ResumoDoMonitorDeEquipe {
  const porSituacao = zeradoPorSituacao();
  const cargos = new Set<string>();
  let alteracoes = 0;
  let variaveisAlteradas = 0;
  let cargosQueEntraram = 0;
  let cargosQueSairam = 0;

  for (const m of modulos) {
    alteracoes += m.alteracoes;
    variaveisAlteradas += m.variaveisAlteradas;
    cargosQueEntraram += m.cargosQueEntraram;
    cargosQueSairam += m.cargosQueSairam;
    for (const s of SITUACOES_DA_EQUIPE) porSituacao[s] += m.porSituacao[s];
    for (const c of m.cargos) cargos.add(c);
  }

  return {
    alteracoes,
    porSituacao,
    variaveisAlteradas,
    cargosQueEntraram,
    cargosQueSairam,
    cargosAfetados: cargos.size,
    porQuadro: [...quadros],
    porModulo: [...modulos],
    semImpactoFinanceiro: SEM_IMPACTO_FINANCEIRO,
  };
}

/**
 * As linhas agrupadas por módulo, já resumidas — na ordem em que o catálogo
 * declara os módulos.
 *
 * A ordem vem de fora, e não de um `sort` por contagem: a lateral lista os
 * módulos na ordem do catálogo, e uma tela que os reordenasse pelo movimento do
 * dia obrigaria quem procura "refeição" a varrer a lista inteira a cada
 * recorte. O módulo do cargo vai no fim, porque ele não é assunto — é o eixo.
 */
export function resumirModulosDeEquipe(
  linhas: readonly LinhaDoMonitorDeEquipe[],
  ordem: readonly ModuloDeEquipe[],
): ResumoDoModuloDeEquipe[] {
  const porModulo = new Map<ModuloDeEquipe, LinhaDoMonitorDeEquipe[]>();
  for (const l of linhas) {
    const lista = porModulo.get(l.modulo);
    if (lista) lista.push(l);
    else porModulo.set(l.modulo, [l]);
  }

  const ordenados = [
    ...ordem.filter((m) => porModulo.has(m)),
    /* O que veio e não estava na ordem declarada — e o eixo do cargo, no fim. */
    ...[...porModulo.keys()].filter((m) => !ordem.includes(m) && m !== MODULO_DO_CARGO),
    ...(porModulo.has(MODULO_DO_CARGO) ? [MODULO_DO_CARGO] : []),
  ];

  return ordenados.map((m) => resumirModuloDeEquipe(m, porModulo.get(m) ?? []));
}

/*
  O vocabulário comum, reexportado com os nomes que ele já tem — a mesma escolha
  de `qlp-comparacao.ts`. Quem lê esta tela precisa do estado e do quadro, e
  importá-los de três módulos obrigaria cada componente a saber de onde veio
  cada palavra.
*/
export { SEM_IMPACTO_FINANCEIRO } from "./qlp-comparacao";
export { ROTULO_DO_QUADRO } from "./qlp";
export type { MovimentoDoEfetivo } from "./qlp-comparacao";
export type { PapelNoQuadro, QuadroDeQlp } from "./qlp";
export type { EstadoDaLinha, MedidaDaVariavel } from "./recorte-de-rubrica";
