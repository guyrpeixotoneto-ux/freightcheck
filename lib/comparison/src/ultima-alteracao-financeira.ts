import {
  AREAS_DO_CATALOGO,
  DESCRICAO_DA_AREA,
  ROTULO_DA_AREA,
  type AreaDoCatalogo,
  type CartaoDeModulo,
  type CoberturaDoCatalogo,
  type NotaDoCartao,
  type ParDoCartao,
} from "./alteracoes-por-modulo";
import {
  NATUREZA_DO_QLP,
  NATUREZA_SEM_MONTANTE,
  type NaturezaDoModulo,
} from "./natureza-do-modulo";
import { placementOf } from "./families";

/**
 * A ÚLTIMA ALTERAÇÃO DE CADA MÓDULO — a escolha do par, e nunca uma conta nova.
 *
 * ---------------------------------------------------------------------------
 * Que pergunta esta leitura responde
 * ---------------------------------------------------------------------------
 * O catálogo por par responde *"o que mudou entre estas duas vigências?"*, e
 * para isso alguém precisa escolher as duas. Esta responde a outra, que não
 * pede escolha nenhuma: *"quando foi a última vez que **este** módulo se
 * moveu, e quanto?"*
 *
 * A diferença não é de apresentação. Um par só, aplicado aos treze módulos,
 * publica "sem alteração" em doze deles sempre que a última quinzena mexeu num
 * — e "sem alteração" ali significa apenas *"não foi neste par"*, que é a
 * resposta errada para a pergunta que se estava fazendo. Com um par por
 * módulo, o IPVA que se moveu em junho continua dizendo junho enquanto o FINAME
 * diz agosto, **na mesma tela**, e as duas frases são verdadeiras.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo decide, e o que ele recusa decidir
 * ---------------------------------------------------------------------------
 * Ele decide **qual par**. Só isso.
 *
 * Nenhum número nasce aqui: o impacto de cada módulo continua saindo da função
 * de impacto dele — `impactoPorPeriodicidade` no FINAME, `impactoDeIpva` no
 * IPVA, e assim por diante —, e o "antes" continua saindo do mesmo laço dessas
 * funções (`basePorPeriodicidade`), sobre as mesmas linhas e com as mesmas
 * exclusões. É isso que faz `antes + impacto === depois` valer por construção,
 * e não por um teste que alguém lembrou de escrever.
 *
 * Ele também recusa **procurar dinheiro onde ele não existe**. Um módulo cuja
 * natureza não produz montante — a manutenção, que mede R$/km; a aquisição, que
 * não tem módulo dono da soma; os assuntos do QLP, que chegam sem semântica
 * confirmada — não é varrido atrás de impacto: ele é varrido atrás de
 * **movimento**, que é o que ele de fato mede. Chamar de "sem alteração
 * financeira" um módulo que nunca teria uma seria publicar uma ausência de
 * dado onde há uma decisão semântica.
 *
 * ---------------------------------------------------------------------------
 * As cinco regras da varredura
 * ---------------------------------------------------------------------------
 * 1. **Só pares consecutivos.** Pular uma vigência para achar movimento mais
 *    longe fabricaria uma comparação acumulada que ninguém pediu, e somaria num
 *    delta só movimentos que aconteceram em vigências diferentes.
 * 2. **Só comparações já calculadas.** A varredura lê o que existe; ela não
 *    manda o motor comparar. Um par elegível sem comparação calculada é uma
 *    **lacuna** — dita em voz alta, com a ação de calcular ao lado —, e nunca
 *    um "sem alteração".
 * 3. **Líquido zero não qualifica.** Um balde que fecha em zero é o módulo não
 *    tendo se movido em dinheiro, ainda que linhas tenham mudado.
 * 4. **`NOT_CALCULABLE` não qualifica.** A régua é a que as funções de impacto
 *    já aplicam, que por sua vez é `viraDinheiro` — o portão único da curadoria.
 * 5. **A varredura para no primeiro par que qualifica.** É a *última*
 *    alteração, não o histórico — o histórico é a Linha do Tempo, a um clique.
 */

// ---------------------------------------------------------------------------
// O estado do cartão — discriminado, para que nenhum campo sobre
// ---------------------------------------------------------------------------

/**
 * Em que situação um cartão está — e a união é fechada de propósito.
 *
 * Cada estado carrega campos diferentes porque as situações **são** diferentes:
 * exibir "R$ 0,00" num módulo que não produz montante, só para que todos os
 * cartões tenham a mesma altura, é publicar um número que não existe.
 */
export type EstadoDoCartao =
  /** Módulo financeiro, e a varredura achou o par em que ele se moveu. */
  | "COM_MOVIMENTO_FINANCEIRO"
  /** Módulo financeiro varrido de ponta a ponta, sem nenhum par com dinheiro. */
  | "SEM_MOVIMENTO_FINANCEIRO"
  /** A natureza atual do módulo não permite apurar montante. */
  | "SEM_MONTANTE_APURAVEL"
  /** Há par elegível, e a comparação dele ainda não foi calculada. */
  | "LACUNA_DE_CALCULO"
  /** Não há par possível nesta cobertura — a frase do domínio diz por quê. */
  | "SEM_COBERTURA";

/**
 * Um balde de periodicidade, inteiro — e nunca convertido.
 *
 * `antes`, `depois` e `impacto` são do **mesmo** balde, porque misturá-los é a
 * única forma de errar aqui: R$/mês e R$/ano não se somam, e um "impacto
 * mensal" derivado de um balde anual seria uma divisão por doze que o produto
 * recusa em todas as outras telas.
 */
export interface BaldeDoCartao {
  periodicidade: string;
  /** O que as linhas que se moveram valiam antes. Nunca o custo da rubrica. */
  antes: number;
  /** `antes + impacto`, por construção. */
  depois: number;
  impacto: number;
  /**
   * `impacto / antes`, em fração — ou `null` quando não há base.
   *
   * Nulo, e não infinito: uma rubrica que sai de zero teve um começo, não um
   * aumento percentual. A tela escreve a frase; este arquivo não formata.
   */
  variacao: number | null;
}

/** O movimento que um módulo teve, com ou sem dinheiro atrás dele. */
export interface MovimentoDoCartao {
  alteracoes: number;
  entidades: number;
  /** Como se chamam as entidades desta rubrica — placas, trechos, cargos. */
  rotuloDaEntidade: string;
  /** A grandeza em que este módulo mede, quando não é dinheiro. */
  unidade: string | null;
  notas: NotaDoCartao[];
}

/** O que a varredura percorreu — o que faz "sem alteração" ser verificável. */
export interface VarreduraDoCartao {
  /** Quantos pares consecutivos foram lidos. */
  pares: number;
  /** A ponta mais antiga varrida. Nula quando não havia par nenhum. */
  de: string | null;
  /** A ponta mais recente varrida. */
  ate: string | null;
  /** Pares elegíveis sem comparação calculada, do mais recente ao mais antigo. */
  lacunas: LacunaDeCalculo[];
}

/** Um par que existe no acervo e cuja comparação ainda não foi calculada. */
export interface LacunaDeCalculo {
  baseId: string;
  comparadaId: string;
  baseData: string | null;
  comparadaData: string | null;
}

/**
 * Um assunto dentro de um cartão de quadro — o grão do QLP.
 *
 * Ele carrega o **par dele**, e não o do cartão: dois assuntos do mesmo quadro
 * podem ter se movido em vigências diferentes, e eleger um período para
 * representar os dezesseis esconderia exatamente o que esta leitura existe para
 * mostrar.
 */
export interface AssuntoDoCartao {
  modulo: string;
  rota: string;
  /** O recorte de "Ver histórico" deste assunto — ver o campo homônimo do cartão. */
  parametrosDoHistorico: string[];
  estado: EstadoDoCartao;
  par: ParDoCartao | null;
  movimento: MovimentoDoCartao;
  /** A frase do domínio, quando o assunto não tem montante apurável. */
  motivo: string | null;
}

export interface CartaoDeUltimaAlteracao {
  area: AreaDoCatalogo;
  modulo: string;
  /** `null` quando o nome da rubrica é apresentação e mora na tela. */
  rotulo: string | null;
  rota: string;
  cobertura: CoberturaDoCatalogo;
  estado: EstadoDoCartao;
  /** O par contra o qual **este** cartão foi apurado. */
  par: ParDoCartao | null;
  /** A comparação de onde os números saíram — a origem de "Ver alterações". */
  changeSetId: string | null;
  /** Os baldes, inteiros. Vazio fora de `COM_MOVIMENTO_FINANCEIRO`. */
  baldes: BaldeDoCartao[];
  movimento: MovimentoDoCartao;
  varredura: VarreduraDoCartao;
  /** Por que não há montante — a frase do domínio, nunca escrita aqui. */
  motivo: string | null;
  /** Os assuntos, nos dois cartões de quadro. `null` em todos os outros. */
  assuntos: AssuntoDoCartao[] | null;
  /**
   * O recorte que "Ver histórico" leva para a Linha do Tempo.
   *
   * São `parameterKey`s, e não códigos de atributo — a distinção que
   * `docs/` e a skill de prova já custaram caro uma vez: `getRangeAnalysis`
   * recorta por `FAMÍLIA|parâmetro`, e mandar código de atributo abriria a tela
   * com o cartão vazio e nenhum erro. Vêm de `placementOf`, que é a **mesma**
   * função que o destino usa para agrupar.
   *
   * Vazio quando o módulo não tem recorte a oferecer — e aí o link não promete
   * um filtro que a outra tela ignoraria.
   */
  parametrosDoHistorico: string[];
  /**
   * O recorte por tipo da Linha do Tempo, quando a cobertura do cartão o exige.
   *
   * Só o trecho: ele vive numa série própria que a leitura sem recorte exclui
   * de propósito, e sem isto o histórico de Consumo abriria sobre a frota.
   */
  tipoDoHistorico: string | null;
}

// ---------------------------------------------------------------------------
// A escolha do par
// ---------------------------------------------------------------------------

/**
 * O que um módulo publicou sobre **um** par — a forma mínima que a varredura lê.
 *
 * Deliberadamente pobre: ela não conhece FINAME nem IPVA, e recebe pronto o que
 * a função de impacto de cada um devolveu. É o que permite testar a regra da
 * varredura sem um Postgres e sem as treze rubricas.
 */
export interface ApuracaoDoPar {
  par: ParDoCartao;
  changeSetId: string;
  /** O impacto do módulo, balde a balde, como ele o publicou. */
  porPeriodicidade: Record<string, number>;
  /** O que as mesmas linhas valiam antes, balde a balde. */
  basePorPeriodicidade: Record<string, number>;
  movimento: MovimentoDoCartao;
}

/** Sem dinheiro no balde não há alteração financeira — zero inclusive. */
function temDinheiro(porPeriodicidade: Record<string, number>): boolean {
  return Object.values(porPeriodicidade).some((v) => v !== 0);
}

/**
 * Os baldes de um par, montados sem nenhuma conversão.
 *
 * A única aritmética aqui é `antes + impacto` e `impacto / antes`, e as duas
 * acontecem **dentro** de um balde. Nada atravessa periodicidade.
 */
export function baldesDaApuracao(apuracao: ApuracaoDoPar): BaldeDoCartao[] {
  const baldes: BaldeDoCartao[] = [];
  for (const [periodicidade, impacto] of Object.entries(apuracao.porPeriodicidade)) {
    if (impacto === 0) continue;
    const antes = apuracao.basePorPeriodicidade[periodicidade] ?? 0;
    baldes.push({
      periodicidade,
      antes: centavos(antes),
      depois: centavos(antes + impacto),
      impacto: centavos(impacto),
      /* Sem base não há percentual — e não há infinito. Quem escreve a frase é
         a tela; aqui a ausência é `null`, como em todo o resto do produto. */
      variacao: antes === 0 ? null : impacto / antes,
    });
  }
  /* O balde de maior movimento primeiro: é o que o cartão põe em destaque. */
  return baldes.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto));
}

const centavos = (n: number) => Number(n.toFixed(2));

/**
 * O par de um módulo **financeiro** — o primeiro, do mais recente ao mais
 * antigo, em que o impacto dele não é zero.
 *
 * `apuracoes` chega ordenada da vigência mais recente para a mais antiga, e a
 * varredura para no primeiro acerto: é a *última* alteração que se procura.
 * `lacunas` são os pares que existiam no acervo e não tinham comparação
 * calculada — eles entram na resposta mesmo quando um par mais antigo qualifica,
 * porque uma lacuna **mais recente** que o achado significa que pode haver
 * alteração mais nova que ninguém apurou.
 */
export function ultimaAlteracaoFinanceira(
  apuracoes: readonly ApuracaoDoPar[],
  varredura: VarreduraDoCartao,
): {
  estado: EstadoDoCartao;
  escolhida: ApuracaoDoPar | null;
} {
  for (const apuracao of apuracoes) {
    if (temDinheiro(apuracao.porPeriodicidade)) {
      return { estado: "COM_MOVIMENTO_FINANCEIRO", escolhida: apuracao };
    }
  }
  /*
    Nenhum par com dinheiro. Antes de dizer "não se moveu", a lacuna tem
    precedência: dizer que não houve alteração num intervalo que não foi todo
    apurado é afirmar mais do que se leu.
  */
  if (varredura.lacunas.length > 0) return { estado: "LACUNA_DE_CALCULO", escolhida: null };
  return { estado: "SEM_MOVIMENTO_FINANCEIRO", escolhida: null };
}

/**
 * O par de um módulo **sem montante apurável** — o primeiro em que ele se
 * moveu, com dinheiro ou sem.
 *
 * A pergunta muda junto com a natureza do módulo: num que mede R$/km, "a última
 * alteração" é a última vez que o R$/km mudou, e procurar impacto ali devolveria
 * sempre vazio — o que a tela leria como "nada aconteceu" num módulo com
 * seiscentas linhas alteradas.
 */
export function ultimoMovimento(apuracoes: readonly ApuracaoDoPar[]): ApuracaoDoPar | null {
  for (const apuracao of apuracoes) {
    if (apuracao.movimento.alteracoes > 0) return apuracao;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A montagem dos cartões — pura, e por isso provável sem Postgres
// ---------------------------------------------------------------------------

/**
 * A natureza de um cartão — lida do próprio cartão, não de uma segunda lista.
 *
 * Duas fontes, e as duas já existem: o registro de módulos sem montante
 * (`NATUREZA_SEM_MONTANTE`) e o `semImpacto` que o módulo escreveu no cartão. O
 * segundo é o que cobre o TMA e os assuntos do quadro sem repeti-los numa
 * terceira lista que envelheceria sozinha. `null` significa **financeiro**.
 */
export function naturezaDoCartao(cartao: CartaoDeModulo): NaturezaDoModulo | null {
  const registrada = NATUREZA_SEM_MONTANTE[cartao.modulo];
  if (registrada) return registrada;
  if (cartao.area === "EQUIPE") return NATUREZA_DO_QLP;
  if (cartao.semImpacto !== null) return { motivo: cartao.semImpacto, unidade: "—" };
  return null;
}

/** A apuração de um cartão vira a forma mínima que a varredura sabe ler. */
export function apuracaoDoCartao(
  cartao: CartaoDeModulo,
  changeSetId: string,
): ApuracaoDoPar {
  return {
    par: cartao.par as ParDoCartao,
    changeSetId,
    porPeriodicidade: cartao.porPeriodicidade,
    basePorPeriodicidade: cartao.basePorPeriodicidade,
    movimento: {
      alteracoes: cartao.alteracoes,
      entidades: cartao.entidades,
      rotuloDaEntidade: cartao.rotuloDaEntidade,
      unidade: naturezaDoCartao(cartao)?.unidade ?? null,
      notas: cartao.notas,
    },
  };
}

export function movimentoVazio(molde: CartaoDeModulo): MovimentoDoCartao {
  return {
    alteracoes: 0,
    entidades: 0,
    rotuloDaEntidade: molde.rotuloDaEntidade,
    unidade: naturezaDoCartao(molde)?.unidade ?? null,
    notas: [],
  };
}

/**
 * Se um módulo já resolveu — a régua da parada antecipada da varredura.
 *
 * Cada natureza tem a sua: um módulo financeiro resolve quando acha dinheiro, e
 * um módulo sem montante resolve quando acha movimento. Uma régua só faria a
 * varredura ler o acervo inteiro toda vez, atrás de um dinheiro que a manutenção
 * nunca vai ter.
 */
export function moduloResolvido(
  molde: CartaoDeModulo,
  apuracoes: readonly ApuracaoDoPar[],
): boolean {
  return naturezaDoCartao(molde)
    ? apuracoes.some((a) => a.movimento.alteracoes > 0)
    : apuracoes.some((a) => temDinheiro(a.porPeriodicidade));
}

/**
 * O cartão de um módulo, a partir das apurações dele — a tradução do estado.
 *
 * Os dois caminhos são deliberadamente diferentes: um módulo financeiro procura
 * **dinheiro**, e um módulo cuja natureza não produz montante procura
 * **movimento**. Procurar dinheiro no segundo devolveria vazio sempre, e a tela
 * leria "nada aconteceu" num módulo com seiscentas linhas alteradas.
 */
export function cartaoDoModulo(
  molde: CartaoDeModulo,
  apuracoes: readonly ApuracaoDoPar[],
  varredura: VarreduraDoCartao,
  ausente: string | null,
  codigos: readonly string[] = [],
): CartaoDeUltimaAlteracao {
  const base = {
    area: molde.area,
    modulo: molde.modulo,
    rotulo: molde.rotulo,
    rota: molde.rota,
    cobertura: molde.cobertura,
    varredura,
    assuntos: null,
    parametrosDoHistorico: parametrosDoHistorico(codigos),
    tipoDoHistorico: tipoDoHistorico(molde.cobertura),
  };

  if (ausente) {
    return {
      ...base,
      estado: "SEM_COBERTURA",
      par: null,
      changeSetId: null,
      baldes: [],
      movimento: movimentoVazio(molde),
      motivo: ausente,
    };
  }

  const natureza = naturezaDoCartao(molde);
  if (natureza) {
    const escolhida = ultimoMovimento(apuracoes);
    return {
      ...base,
      estado: "SEM_MONTANTE_APURAVEL",
      par: escolhida?.par ?? null,
      changeSetId: escolhida?.changeSetId ?? null,
      baldes: [],
      movimento: escolhida?.movimento ?? movimentoVazio(molde),
      motivo: natureza.motivo,
    };
  }

  const { estado, escolhida } = ultimaAlteracaoFinanceira(apuracoes, varredura);
  return {
    ...base,
    estado,
    par: escolhida?.par ?? null,
    changeSetId: escolhida?.changeSetId ?? null,
    baldes: escolhida ? baldesDaApuracao(escolhida) : [],
    movimento: escolhida?.movimento ?? movimentoVazio(molde),
    motivo: null,
  };
}

/**
 * Os assuntos de um quadro — cada um com o par **dele**.
 *
 * É aqui que a promessa da aba Equipe se cumpre ou se perde: eleger um período
 * para representar os dezesseis esconderia justamente o que a leitura existe
 * para mostrar.
 */
export function assuntosDoQuadro(
  moldes: readonly CartaoDeModulo[],
  apuracoes: Map<string, ApuracaoDoPar[]>,
  ausente: string | null,
  codigosDoAssunto: (modulo: string) => readonly string[] = () => [],
): AssuntoDoCartao[] {
  return moldes.map((molde) => {
    const escolhida = ausente ? null : ultimoMovimento(apuracoes.get(molde.modulo) ?? []);
    return {
      modulo: molde.modulo,
      rota: molde.rota,
      parametrosDoHistorico: parametrosDoHistorico(codigosDoAssunto(molde.modulo)),
      estado: ausente
        ? "SEM_COBERTURA"
        : escolhida
          ? "SEM_MONTANTE_APURAVEL"
          : "SEM_MOVIMENTO_FINANCEIRO",
      par: escolhida?.par ?? null,
      movimento: escolhida?.movimento ?? movimentoVazio(molde),
      motivo: ausente ?? NATUREZA_DO_QLP.motivo,
    };
  });
}

/**
 * Um cartão de quadro — os dezesseis assuntos dentro de um cartão só.
 *
 * Um cartão por assunto seriam trinta e dois cartões repetindo a mesma frase de
 * ausência de montante, que é ruído e não leitura.
 */
export function cartaoDoQuadro(entrada: {
  quadro: string;
  rotulo: string;
  rota: string;
  cobertura: CoberturaDoCatalogo;
  assuntos: AssuntoDoCartao[];
  varredura: VarreduraDoCartao;
  ausente: string | null;
}): CartaoDeUltimaAlteracao {
  const comPar = entrada.assuntos.filter((a) => a.par !== null);
  /* O par do cabeçalho é o **mais recente entre os assuntos**; quantos períodos
     distintos existem embaixo dele é o que a aba conta e o cartão mostra. */
  const maisRecente = comPar
    .map((a) => a.par as ParDoCartao)
    .sort((a, b) => (b.comparadaData ?? "").localeCompare(a.comparadaData ?? ""))[0];

  return {
    area: "EQUIPE",
    modulo: entrada.quadro,
    rotulo: entrada.rotulo,
    rota: entrada.rota,
    cobertura: entrada.cobertura,
    estado: entrada.ausente
      ? "SEM_COBERTURA"
      : comPar.length > 0
        ? "SEM_MONTANTE_APURAVEL"
        : "SEM_MOVIMENTO_FINANCEIRO",
    par: maisRecente ?? null,
    /* O cartão do quadro não tem uma comparação só: cada assunto tem a dele, e
       é de lá que "Ver alterações" sai. */
    changeSetId: null,
    baldes: [],
    movimento: {
      alteracoes: entrada.assuntos.reduce((s, a) => s + a.movimento.alteracoes, 0),
      /*
        Cargos distintos não se somam entre assuntos — o mesmo cargo mexe em
        vários —, então o número do cabeçalho é o maior de um assunto, e não uma
        soma que passaria do tamanho do quadro. A quebra está logo abaixo.
      */
      entidades: entrada.assuntos.reduce((m, a) => Math.max(m, a.movimento.entidades), 0),
      rotuloDaEntidade: "Cargos",
      unidade: NATUREZA_DO_QLP.unidade,
      notas: [],
    },
    varredura: entrada.varredura,
    motivo: entrada.ausente ?? NATUREZA_DO_QLP.motivo,
    assuntos: entrada.assuntos,
    /* O histórico do quadro é a união do dos assuntos: quem clica no cabeçalho
       quer o quadro inteiro, e quem clica numa linha quer aquele assunto. */
    parametrosDoHistorico: [
      ...new Set(entrada.assuntos.flatMap((a) => a.parametrosDoHistorico)),
    ].sort(),
    tipoDoHistorico: tipoDoHistorico(entrada.cobertura),
  };
}

export interface AbaDeUltimasAlteracoes {
  area: AreaDoCatalogo;
  rotulo: string;
  descricao: string;
  cartoes: CartaoDeUltimaAlteracao[];
  /**
   * Quantos períodos distintos os cartões desta aba estão comparando.
   *
   * É o número que torna a promessa da tela verificável: "2 períodos distintos"
   * embaixo de sete cartões diz, antes de qualquer cartão ser lido, que eles
   * **não** estão todos no mesmo par.
   */
  periodosDistintos: number;
  /** A ponta mais recente entre os cartões — a régua da defasagem em âmbar. */
  comparadaMaisRecente: string | null;
}

/**
 * As três abas, na ordem do caminho do custo.
 *
 * A ordenação dentro de cada aba é **recência primeiro, magnitude depois**: os
 * cartões atrasados agrupam-se visivelmente no fim, que é onde alguém que
 * audita quer encontrá-los.
 */
export function agruparEmAbas(
  cartoes: readonly CartaoDeUltimaAlteracao[],
): AbaDeUltimasAlteracoes[] {
  return AREAS_DO_CATALOGO.map((area) => {
    const daArea = cartoes.filter((c) => c.area === area);
    /* Os períodos de um cartão de quadro são os dos assuntos dele: o cabeçalho
       mostra um, e a divergência que a aba conta está embaixo. */
    const datas = new Set(
      daArea.flatMap((c) =>
        (c.assuntos ? c.assuntos.map((a) => a.par) : [c.par])
          .map((p) => p?.comparadaData)
          .filter((d): d is string => typeof d === "string"),
      ),
    );
    const ordenados = [...daArea].sort((a, b) => {
      const recencia = (b.par?.comparadaData ?? "").localeCompare(
        a.par?.comparadaData ?? "",
      );
      if (recencia !== 0) return recencia;
      return magnitude(b) - magnitude(a);
    });
    return {
      area,
      rotulo: ROTULO_DA_AREA[area],
      descricao: DESCRICAO_DA_AREA[area],
      cartoes: ordenados,
      periodosDistintos: datas.size,
      comparadaMaisRecente: [...datas].sort((a, b) => b.localeCompare(a))[0] ?? null,
    };
  });
}

/**
 * O desempate da ordenação — e ele não atravessa periodicidade.
 *
 * O maior balde em módulo, e nunca a soma deles: somar R$/mês com R$/ano para
 * ordenar seria a mesma mistura que a tela recusa exibir. Num módulo sem
 * montante o critério é o volume de alterações, que é o que ele mede.
 */
function magnitude(cartao: CartaoDeUltimaAlteracao): number {
  if (cartao.baldes.length > 0) {
    return Math.max(...cartao.baldes.map((b) => Math.abs(b.impacto)));
  }
  return cartao.movimento.alteracoes;
}

/**
 * Os pares consecutivos de uma lista, do mais recente para o mais antigo.
 *
 * A ordem decrescente não é estética: a pergunta é "a **última** vez", e varrer
 * do mais antigo para o mais novo acharia a primeira. E são consecutivos e só —
 * pular uma vigência fabricaria uma comparação acumulada que ninguém pediu.
 *
 * `teto` é o custo máximo de abrir a tela, e não paginação: o intervalo varrido
 * vai na resposta justamente para que "sem alteração" nunca afirme mais do que
 * se leu.
 */
export function paresConsecutivos<T extends { effectiveDate: string }>(
  vigencias: readonly T[],
  teto: number,
): { base: T; comparada: T }[] {
  const ordenadas = [...vigencias].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  );
  const pares: { base: T; comparada: T }[] = [];
  for (let i = 0; i + 1 < ordenadas.length; i++) {
    pares.push({ base: ordenadas[i + 1], comparada: ordenadas[i] });
  }
  return pares.slice(0, teto);
}

// ---------------------------------------------------------------------------
// O recorte que "Ver histórico" leva — e por que ele não é código de atributo
// ---------------------------------------------------------------------------

/**
 * Os `parameterKey`s de um conjunto de códigos de atributo.
 *
 * É a tradução que o histórico exige, e ela tem história: a Evolução anual do
 * FINAME foi entregue com testes verdes e o cartão vazio porque a tela mandava
 * **código de atributo** para uma leitura que recorta por `FAMÍLIA|parâmetro`.
 * As duas funções estavam certas; o defeito morava na fronteira.
 *
 * Aqui a fronteira deixa de existir: a chave sai de `placementOf`, que é
 * literalmente a função com que `getRangeAnalysis` agrupa do outro lado. Um
 * recorte que não casasse com nada passaria a ser impossível de escrever.
 */
export function parametrosDoHistorico(codigos: readonly string[]): string[] {
  const chaves = new Set<string>();
  for (const codigo of codigos) {
    const { family, parameterKey } = placementOf(codigo);
    /* Um código que o mapa de famílias não conhece cai em `SEM_FAMILIA`, e essa
       chave não recorta nada do outro lado — mandá-la abriria o histórico
       vazio, que é pior do que abri-lo inteiro. */
    if (family === "SEM_FAMILIA") continue;
    chaves.add(parameterKey);
  }
  return [...chaves].sort();
}

/**
 * O recorte por tipo que uma cobertura exige na Linha do Tempo.
 *
 * Só o trecho: ele vive numa série própria que a leitura sem recorte exclui de
 * propósito (ver `getRangeAnalysis`), e o recorte é o que o traz de volta. As
 * outras coberturas abrem na leitura de frota, que é a delas.
 */
export function tipoDoHistorico(cobertura: CoberturaDoCatalogo): string | null {
  return cobertura === "TRECHO" ? "TRECHO" : null;
}
