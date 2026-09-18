import {
  ROTULO_DO_MODULO,
  type ResumoDoModulo,
  type ImpactoDoModulo,
} from "./monitor-custo-fixo";
import type { ResumoDoModuloDeEquipe } from "./monitor-equipe";

/**
 * ALTERAÇÕES POR MÓDULO — o catálogo inteiro do produto num cartão cada.
 *
 * ---------------------------------------------------------------------------
 * Que pergunta esta leitura responde, e por que ela é executiva
 * ---------------------------------------------------------------------------
 * O Monitor Custo Fixo quebra **cinco** rubricas por cartão; o Monitor Equipe
 * quebra os **dezesseis** assuntos do quadro; e cada rubrica de custo variável
 * tem a auditoria dela. Nenhuma das três diz o que quem abre a Visão executiva
 * pergunta primeiro: *das três famílias de custo que este produto audita, quais
 * se moveram desde a última vigência?*
 *
 * Responder isso abrindo três telas é o que já existe. Esta leitura põe as três
 * lado a lado, no mesmo formato de cartão que as duas primeiras já publicam — e
 * é de propósito que o formato seja o mesmo: quem lê o cartão do IPVA no
 * Monitor reconhece o de Pneu aqui sem aprender um segundo vocabulário.
 *
 * ---------------------------------------------------------------------------
 * O par pertence ao cartão, e não ao catálogo
 * ---------------------------------------------------------------------------
 * É a regra que `ParDoMonitor` já antecipava, e aqui ela deixa de ser previsão e
 * vira necessidade: as três famílias leem **coberturas diferentes do acervo**.
 * Custo fixo e manutenção leem equipamento (`CAVALO`/`CARRETA`); consumo, pneu,
 * km rodado, velocidade média e TMA leem trecho; o quadro de pessoal lê os dois
 * quadros do QLP, cada um com a série dele. O motor recusa um par entre
 * coberturas diferentes — então não há *um* par desta tela, e publicar um seria
 * publicar uma coincidência como contrato.
 *
 * Cada cartão carrega, portanto, o par contra o qual **ele** foi apurado. E o
 * módulo que não tem par não some da resposta: volta com `ausente` preenchido,
 * com a frase que diz por quê. Sumir com ele faria a ausência parecer escolha
 * da tela — e é justamente a ausência que interessa a quem audita.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo nunca faz
 * ---------------------------------------------------------------------------
 * **Não soma periodicidades diferentes.** R$/mês e R$/ano não viram um total,
 * aqui como em todo o resto do produto. O balde de uma área é a soma, por
 * periodicidade, do que cada módulo daquela área já tinha publicado.
 *
 * **Não soma áreas.** Custo fixo, custo variável e equipe não têm um total
 * comum: o primeiro publica reais do período, o segundo publica razões (R$/km,
 * minutos) que só viram dinheiro multiplicadas por produção, e o terceiro não
 * publica dinheiro nenhum enquanto a curadoria não confirmar a semântica das
 * colunas do QLP. Um "total geral" aqui seria três réguas fundidas numa.
 *
 * **Não reescreve os números de ninguém.** Todo campo de cartão é o que o
 * resumo nativo do módulo publicou — `impactoDeOrigem` inteiro no custo fixo, o
 * `impactoDeX` da rubrica no custo variável, as contagens do QLP na equipe.
 */

// ---------------------------------------------------------------------------
// As três áreas
// ---------------------------------------------------------------------------

export type AreaDoCatalogo = "CUSTO_FIXO" | "CUSTO_VARIAVEL" | "EQUIPE";

/**
 * A ordem é a do caminho do custo, e é a mesma da lateral: primeiro o que se
 * paga por **ter** o ativo, depois o que se paga por **rodar** com ele, e por
 * fim o que se paga pelo **quadro** que o opera.
 */
export const AREAS_DO_CATALOGO: readonly AreaDoCatalogo[] = [
  "CUSTO_FIXO",
  "CUSTO_VARIAVEL",
  "EQUIPE",
];

export const ROTULO_DA_AREA: Record<AreaDoCatalogo, string> = {
  CUSTO_FIXO: "Custo Fixo",
  CUSTO_VARIAVEL: "Custo Variável",
  EQUIPE: "Equipe",
};

export const DESCRICAO_DA_AREA: Record<AreaDoCatalogo, string> = {
  CUSTO_FIXO: "O que se paga por ter o ativo e a estrutura, rubrica a rubrica",
  CUSTO_VARIAVEL: "O que se paga por rodar com o ativo",
  EQUIPE: "O quadro de pessoal — cada rubrica do QLP por assunto",
};

// ---------------------------------------------------------------------------
// As coberturas
// ---------------------------------------------------------------------------

/**
 * A cobertura do acervo que um módulo lê — e, por consequência, de que lista de
 * vigências sai o par dele.
 *
 * Não é detalhe de implementação: é o que explica, na tela, por que o cartão de
 * FINAME e o de Pneu podem estar comparando vigências diferentes na mesma
 * leitura. Sem isso, dois números apurados contra pares distintos apareceriam
 * lado a lado como se fossem do mesmo recorte.
 */
export type CoberturaDoCatalogo =
  | "EQUIPAMENTO"
  | "TRECHO"
  | "QLP_OPERACIONAL"
  | "QLP_ADMINISTRATIVO";

/**
 * As quatro coberturas, na ordem em que a tela as oferece.
 *
 * Morava em `lib/alteracoes-por-modulo.ts`, no navegador, e desceu para cá
 * quando o servidor passou a precisar dela: a rota de candidatas do catálogo
 * percorre as mesmas quatro, na mesma ordem, e uma segunda lista escrita à mão
 * do outro lado divergiria da primeira no dia em que uma quinta cobertura
 * entrasse — com a tela mostrando um número apurado sobre três.
 */
export const COBERTURAS: readonly CoberturaDoCatalogo[] = [
  "EQUIPAMENTO",
  "TRECHO",
  "QLP_OPERACIONAL",
  "QLP_ADMINISTRATIVO",
];

export const ROTULO_DA_COBERTURA: Record<CoberturaDoCatalogo, string> = {
  EQUIPAMENTO: "Equipamento",
  TRECHO: "Trecho",
  QLP_OPERACIONAL: "QLP operacional",
  QLP_ADMINISTRATIVO: "QLP administrativo",
};

// ---------------------------------------------------------------------------
// O cartão
// ---------------------------------------------------------------------------

/** O par contra o qual um cartão foi apurado — o mesmo formato dos Monitores. */
export interface ParDoCartao {
  baseId: string;
  comparadaId: string;
  baseRotulo: string | null;
  comparadaRotulo: string | null;
  baseData: string | null;
  comparadaData: string | null;
}

/**
 * Uma pendência do módulo, em duas partes — o número e a frase.
 *
 * Separadas de propósito: a frase é do **domínio** (só o IPVA sabe que uma
 * ponta negativa é estorno ou erro de cadastro), e a formatação do número é da
 * **tela** (é ela que sabe escrever milhar em português). Devolver a frase já
 * montada obrigaria este pacote a formatar número, que é a fronteira que o
 * resto do produto não cruza.
 */
export interface NotaDoCartao {
  quantidade: number;
  frase: string;
}

export interface CartaoDeModulo {
  area: AreaDoCatalogo;
  /** A chave estável do módulo dentro da área — nunca um rótulo. */
  modulo: string;
  /**
   * O nome do módulo, quando o **domínio** o conhece.
   *
   * `null` nos módulos do QLP, e a ausência é o conteúdo: lá o nome da rubrica é
   * apresentação e mora na tela (`ROTULO_DA_RUBRICA`), por decisão de
   * `qlp-comparacao.ts`. Quem desenha resolve o nulo; quem calcula não inventa
   * um segundo dicionário.
   */
  rotulo: string | null;
  /** O endereço da auditoria deste módulo — a origem de "Abrir auditoria". */
  rota: string;
  cobertura: CoberturaDoCatalogo;
  /** `null` quando o módulo não entrou — e então `ausente` diz por quê. */
  par: ParDoCartao | null;
  ausente: string | null;
  alteracoes: number;
  /** As entidades distintas tocadas — placas, trechos ou cargos. */
  entidades: number;
  /** Como se chamam essas entidades nesta rubrica. */
  rotuloDaEntidade: string;
  /**
   * Quantas alterações foram para cada lado — contagens, nunca dinheiro.
   *
   * `null` onde a direção não existe como leitura do módulo: no custo variável a
   * maior parte das colunas é razão ou tempo, e chamar de "ganho" a subida de um
   * R$/km seria decidir pela operação o que ela significa.
   */
  ganhos: number | null;
  perdas: number | null;
  /** O impacto do módulo, balde a balde, como ele o publicou. Nunca somado. */
  porPeriodicidade: Record<string, number>;
  /**
   * O que as **mesmas linhas** que o módulo somou valiam na vigência base.
   *
   * Vazio onde o módulo não publica montante. Serve ao cartão de última
   * alteração, que escreve "antes" e "depois" sem refazer conta nenhuma: o
   * número vem do mesmo laço da função de impacto do módulo.
   */
  basePorPeriodicidade: Record<string, number>;
  /**
   * Por que não há dinheiro neste cartão, quando não há **por natureza**.
   *
   * Preenchida onde a ausência é estrutural (o QLP sem semântica confirmada, o
   * TMA que mede minuto), e nula onde o balde vazio é apenas o resultado deste
   * recorte. A tela precisa da diferença: uma pede explicação permanente, a
   * outra pede outro par de vigências.
   */
  semImpacto: string | null;
  /** As situações especiais que **só este módulo** conhece. */
  notas: NotaDoCartao[];
}

/** Uma área e os cartões dela, com o balde que os módulos já tinham publicado. */
export interface AreaNoCatalogo {
  area: AreaDoCatalogo;
  rotulo: string;
  descricao: string;
  cartoes: CartaoDeModulo[];
  /**
   * O impacto da área, por periodicidade — a soma, balde a balde, do que cada
   * cartão publicou. Nunca um total único, e nunca entre áreas.
   */
  porPeriodicidade: Record<string, number>;
  alteracoes: number;
  /** Quantos módulos desta área entraram com par, e quantos não entraram. */
  modulosApurados: number;
  modulosAusentes: number;
}

// ---------------------------------------------------------------------------
// As pendências de cada família
// ---------------------------------------------------------------------------

/**
 * As situações especiais que cada rubrica de custo fixo conhece.
 *
 * Saiu do componente que as desenhava (`components/monitor/por-modulo.tsx`) e
 * veio para cá quando a segunda tela passou a precisar das mesmas frases: duas
 * réguas para a mesma pendência divergiriam no dia em que uma rubrica ganhasse
 * um indicador novo, e a tela que não fosse atualizada passaria a esconder um
 * achado sem que nada quebrasse.
 *
 * O `switch` existe para que um módulo novo no tipo não passe em silêncio sem
 * alguém dizer que pendências dele merecem aparecer.
 */
export function notasDoCustoFixo(impacto: ImpactoDoModulo): NotaDoCartao[] {
  const notas: NotaDoCartao[] = [];
  const nota = (quantidade: number, frase: string) => {
    if (quantidade > 0) notas.push({ quantidade, frase });
  };

  nota(impacto.naoCalculavel, "em coluna de dinheiro sem preço apurado");

  switch (impacto.modulo) {
    case "FINAME":
      nota(impacto.cobertasPorParcelas, "já contadas nas parcelas do veículo");
      nota(impacto.foraDaSoma, "de outra rubrica (base e tributos)");
      break;
    case "IPVA":
      nota(impacto.foraDaSoma, "fora da soma");
      nota(
        impacto.valoresNegativos,
        "com uma das pontas negativa — estorno ou erro de cadastro",
      );
      break;
    case "IMPOSTOS":
      nota(impacto.foraDaSoma, "fora da soma");
      nota(
        impacto.aliquotasAlteradas,
        "alíquotas se moveram — taxa não soma, mas pede explicação",
      );
      break;
    case "LUCRO_FIXO":
      nota(impacto.foraDaSoma, "da coluna do conjunto, fora da soma");
      break;
    case "ALUGUEL":
      break;
  }

  return notas;
}

/**
 * O que **só a equipe** vê mexer — entradas, saídas e efetivo.
 *
 * Pela mesma razão da função acima: as frases eram do componente do Monitor
 * Equipe e passaram a servir duas telas. As direções saem de `diferenca`, que é
 * o que o motor produziu, e são **contagens de cargos** — quantas posições o
 * quadro ganhou ou perdeu é outra pergunta, e quem a responde é o cartão de
 * efetivo do Monitor.
 */
export function notasDaEquipe(resumo: ResumoDoModuloDeEquipe): NotaDoCartao[] {
  const notas: NotaDoCartao[] = [];
  const nota = (quantidade: number, frase: string) => {
    if (quantidade > 0) notas.push({ quantidade, frase });
  };

  nota(resumo.cargosQueEntraram, "cargos entraram no quadro");
  nota(resumo.cargosQueSairam, "cargos saíram do quadro");
  nota(resumo.quantidadesQueSubiram, "quantidades subiram");
  nota(resumo.quantidadesQueDesceram, "quantidades desceram");

  return notas;
}

// ---------------------------------------------------------------------------
// Os cartões
// ---------------------------------------------------------------------------

/** O cartão de uma rubrica de custo fixo, a partir do resumo que o Monitor já compõe. */
export function cartaoDoCustoFixo(resumo: ResumoDoModulo): CartaoDeModulo {
  return {
    area: "CUSTO_FIXO",
    modulo: resumo.modulo,
    rotulo: ROTULO_DO_MODULO[resumo.modulo],
    rota: resumo.rota,
    cobertura: "EQUIPAMENTO",
    par: resumo.par,
    ausente: null,
    alteracoes: resumo.alteracoes,
    entidades: resumo.entidades.length,
    rotuloDaEntidade: "Entidades",
    ganhos: resumo.ganhos,
    perdas: resumo.perdas,
    porPeriodicidade: resumo.porPeriodicidade,
    basePorPeriodicidade: resumo.impactoDeOrigem.basePorPeriodicidade,
    semImpacto: null,
    notas: notasDoCustoFixo(resumo.impactoDeOrigem),
  };
}

/** O cartão de um assunto do QLP, a partir do resumo do Monitor Equipe. */
export function cartaoDeEquipe(
  resumo: ResumoDoModuloDeEquipe,
  entrada: {
    rota: string;
    cobertura: CoberturaDoCatalogo;
    par: ParDoCartao | null;
    /** A frase que diz por que este quadro não publica reais. */
    semImpacto: string;
  },
): CartaoDeModulo {
  return {
    area: "EQUIPE",
    modulo: resumo.modulo,
    /* O nome da rubrica do QLP é apresentação, e mora na tela — ver `rotulo`. */
    rotulo: null,
    rota: entrada.rota,
    cobertura: entrada.cobertura,
    par: entrada.par,
    ausente: null,
    alteracoes: resumo.alteracoes,
    entidades: resumo.cargos.length,
    rotuloDaEntidade: "Cargos",
    /*
      Ganho e perda não existem no QLP, e o nulo é a resposta honesta: sem
      semântica confirmada não há sinal de dinheiro para classificar. O que o
      quadro sabe dizer — quem entrou, quem saiu, onde o efetivo subiu — está nas
      notas, que é onde ele de fato mede alguma coisa.
    */
    ganhos: null,
    perdas: null,
    porPeriodicidade: {},
    basePorPeriodicidade: {},
    semImpacto: entrada.semImpacto,
    notas: notasDaEquipe(resumo),
  };
}

/**
 * O que toda rubrica de recorte publica, custo variável e custo fixo por igual.
 *
 * É a forma que `resumirConsumo`, `resumirPneu`, `resumirManutencao`,
 * `resumirKm`, `resumirVelocidade`, `resumirSeguro` e `resumirAquisicao` já
 * devolvem, campo a campo. Tipar o mínimo comum — e não uma união das sete — é
 * o que permite um construtor só sem que ele passe a conhecer sete rubricas.
 */
export interface LinhaDeRecorte {
  entityLabel: string | null;
}

export interface ImpactoDeRecorte {
  porPeriodicidade: Record<string, number>;
  /** Opcional: só as rubricas que publicam montante o acumulam. */
  basePorPeriodicidade?: Record<string, number>;
  naoCalculavel?: number;
  foraDaSoma: number;
}

/**
 * O cartão de uma rubrica apurada por recorte — as seis do custo variável e as
 * duas de custo fixo que o Monitor não consolida.
 *
 * As contagens saem das linhas, e o dinheiro sai do `impactoDeX` da rubrica: a
 * mesma divisão de trabalho que `resumirModulo` faz do outro lado, e pela mesma
 * razão — a tela fecha com a auditoria por construção, e não por coincidência.
 */
export function cartaoDeRubrica(entrada: {
  area: AreaDoCatalogo;
  modulo: string;
  rotulo: string;
  rota: string;
  cobertura: CoberturaDoCatalogo;
  par: ParDoCartao;
  rotuloDaEntidade: string;
  linhas: readonly LinhaDeRecorte[];
  impacto: ImpactoDeRecorte;
  /** Os indicadores que só esta rubrica conhece — ver os `impactoDeX`. */
  notas?: readonly NotaDoCartao[];
  semImpacto?: string | null;
}): CartaoDeModulo {
  const entidades = new Set<string>();
  for (const l of entrada.linhas) {
    if (l.entityLabel !== null) entidades.add(l.entityLabel);
  }

  const notas: NotaDoCartao[] = [];
  const naoCalculavel = entrada.impacto.naoCalculavel ?? 0;
  if (naoCalculavel > 0) {
    notas.push({
      quantidade: naoCalculavel,
      frase: "em coluna de dinheiro sem preço apurado",
    });
  }
  if (entrada.impacto.foraDaSoma > 0) {
    notas.push({ quantidade: entrada.impacto.foraDaSoma, frase: "fora da soma" });
  }
  for (const nota of entrada.notas ?? []) {
    if (nota.quantidade > 0) notas.push(nota);
  }

  return {
    area: entrada.area,
    modulo: entrada.modulo,
    rotulo: entrada.rotulo,
    rota: entrada.rota,
    cobertura: entrada.cobertura,
    par: entrada.par,
    ausente: null,
    alteracoes: entrada.linhas.length,
    entidades: entidades.size,
    rotuloDaEntidade: entrada.rotuloDaEntidade,
    ganhos: null,
    perdas: null,
    porPeriodicidade: entrada.impacto.porPeriodicidade,
    basePorPeriodicidade: entrada.impacto.basePorPeriodicidade ?? {},
    semImpacto: entrada.semImpacto ?? null,
    notas,
  };
}

/**
 * O cartão de um módulo que **não entrou** — e a frase que diz por quê.
 *
 * Ele fica na lista, zerado e explicado, em vez de sumir. Um catálogo que
 * escondesse o módulo sem par publicaria "nada mudou no pneu" quando o que
 * houve foi uma importação que não veio — e são coisas opostas para quem
 * audita.
 */
export function cartaoAusente(entrada: {
  area: AreaDoCatalogo;
  modulo: string;
  rotulo: string | null;
  rota: string;
  cobertura: CoberturaDoCatalogo;
  ausente: string;
  rotuloDaEntidade: string;
}): CartaoDeModulo {
  return {
    area: entrada.area,
    modulo: entrada.modulo,
    rotulo: entrada.rotulo,
    rota: entrada.rota,
    cobertura: entrada.cobertura,
    par: null,
    ausente: entrada.ausente,
    alteracoes: 0,
    entidades: 0,
    rotuloDaEntidade: entrada.rotuloDaEntidade,
    ganhos: null,
    perdas: null,
    porPeriodicidade: {},
    basePorPeriodicidade: {},
    semImpacto: null,
    notas: [],
  };
}

// ---------------------------------------------------------------------------
// O catálogo
// ---------------------------------------------------------------------------

const centavos = (n: number) => Number(n.toFixed(2));

/**
 * As áreas, com os cartões de cada uma agrupados na ordem do catálogo.
 *
 * A única aritmética aqui é **agrupar por periodicidade** números que os módulos
 * já publicaram — o que `deduplicacao.ts` chama de somar resumos já decididos, e
 * que não re-decide nada. Uma área sem cartão nenhum continua na lista: a
 * ausência de uma família inteira é resposta, e não motivo para sumir.
 */
export function agruparPorArea(
  cartoes: readonly CartaoDeModulo[],
): AreaNoCatalogo[] {
  return AREAS_DO_CATALOGO.map((area) => {
    const daArea = cartoes.filter((c) => c.area === area);
    const porPeriodicidade: Record<string, number> = {};
    let alteracoes = 0;
    let modulosApurados = 0;
    let modulosAusentes = 0;

    for (const cartao of daArea) {
      alteracoes += cartao.alteracoes;
      if (cartao.par === null) modulosAusentes++;
      else modulosApurados++;
      for (const [balde, valor] of Object.entries(cartao.porPeriodicidade)) {
        porPeriodicidade[balde] = centavos((porPeriodicidade[balde] ?? 0) + valor);
      }
    }

    return {
      area,
      rotulo: ROTULO_DA_AREA[area],
      descricao: DESCRICAO_DA_AREA[area],
      cartoes: daArea,
      porPeriodicidade,
      alteracoes,
      modulosApurados,
      modulosAusentes,
    };
  });
}
