/**
 * Conjuntos — o cavalo e a carreta lidos como uma unidade só.
 *
 * **A pergunta que esta visão responde, e que nenhuma outra tela responde.** A
 * fonte declara a remuneração do conjunto pronta, numa coluna: `carreta.custo_fixo`.
 * O produto, do seu lado, apura o que cada equipamento recebe separadamente — o
 * cavalo pela ficha dele, a carreta pela dela. Os dois caminhos têm de chegar ao
 * mesmo lugar:
 *
 * ```
 * (finameImplemento + lucroFixomodeloNovoCiclo) + finameCavalo = custoFixo
 *  \____________ carreta ____________/           \_ cavalo _/    \ conjunto /
 * ```
 *
 * Esta é **a conferência**, e é ela a razão de a aba existir. Enquanto ela não
 * estava na tela, a identidade vivia só num teste de regressão: verdadeira em
 * 558 de 558 pares medidos em agosto de 2026, e muda a respeito da vigência que
 * chegar amanhã. Aqui ela é refeita a cada leitura, par a par, e o que não fecha
 * aparece com o nome do conjunto e o tamanho da diferença.
 *
 * **Por que isto não é a repetição da coluna `custoFixo`** — que foi o motivo,
 * escrito e correto, de a aba ter ficado desligada até agora. Repetir seria
 * mostrar o número da fonte de novo. O que a tela mostra é o número da fonte
 * **contra** a soma que o produto apurou por outro caminho, mais o que só existe
 * quando se olha para o par: quem trocou de carreta entre vigências, que placa
 * apontada não tem carreta, que carreta nenhum cavalo puxa. Nada disso está na
 * ficha do cavalo nem na da carreta, porque nenhuma das duas vê o outro lado.
 *
 * **O que esta aba não é.** Não é a DRE do conjunto — aquela pergunta o que
 * sobra depois do custo, e vive em `@workspace/dre` com escopo CONJUNTO. Esta
 * pergunta se a remuneração do conjunto e a dos dois equipamentos contam a mesma
 * história. São a mesma frota lida com perguntas diferentes, e as duas usam o
 * mesmo motor: `comporDeFatos`, uma vez por ativo.
 */

import type { Database } from "@workspace/db";
import {
  resolveContext,
  type AttributeClassification,
  type SeriesContext,
} from "@workspace/comparison";
import {
  calcularVariacao,
  comporDeFatos,
  lerIdentidades,
  lerVigencia,
  listarVigencias,
  mensalDe,
  unidadeDe,
  TOLERANCIA_CENTAVO,
  type FatoDoAtivo,
  type Identidade,
  type Variacao,
} from "./motor";
import { serieFoiEntregue } from "./frota";
import { regraDe } from "./regras";
import {
  motivoDaNaoApuracao,
  LIMIAR_CRITICO_PERCENTUAL,
  type Farol,
  type MotivoDaNaoApuracao,
} from "./status";
import {
  indexarVinculos,
  parearConjuntos,
  rotuloDoPar,
  FRASE_DA_NATUREZA,
  type AtivoDoVinculo,
  type NaturezaDoVinculo,
  type ParDoConjunto,
} from "./vinculo";

/** Os dois lados que formam um conjunto. Não há um terceiro. */
const TIPOS_DO_CONJUNTO = ["CAVALO", "CARRETA"];

/**
 * A diferença até a qual a conferência é considerada fechada.
 *
 * O mesmo centavo com que o motor confere um total contra as suas parcelas — e
 * pelo mesmo motivo: a planilha de origem arredonda em centavos, e um limiar
 * mais apertado transformaria arredondamento em achado de auditoria.
 */
export const TOLERANCIA_DA_CONFERENCIA = TOLERANCIA_CENTAVO;

// ---------------------------------------------------------------------------
// Formato de saída
// ---------------------------------------------------------------------------

/** Um componente mensal que entrou no que este lado recebe. */
export interface ComponenteDoLado {
  code: string;
  titulo: string;
  valor: number;
}

/** Um dos dois lados do conjunto, com o que a ficha dele apura. */
export interface LadoDoConjunto {
  entityId: string;
  entityType: string;
  placa: string | null;
  chassi: string | null;
  /** A remuneração mensal apurada deste lado — o mesmo número da ficha dele. */
  mensal: number | null;
  /** Os componentes mensais que a formaram, para a conta poder ser refeita. */
  componentes: ComponenteDoLado[];
  semRegraFinanceira: number;
  /** Quando não há mensal apurado: de que classe é a lacuna. */
  naoApuradoPor: MotivoDaNaoApuracao | null;
}

export interface StatusDoConjunto {
  farol: Farol;
  motivos: string[];
  alertas: number;
}

export interface LinhaDoConjunto {
  /** A chave estável: o cavalo, ou a carreta quando ela é órfã. */
  id: string;
  rotulo: string;
  natureza: NaturezaDoVinculo;
  /**
   * Como este conjunto se formou, em uma frase.
   *
   * Vem sempre, inclusive quando não há alerta nenhum: uma carreta órfã é
   * estado normal e ainda assim é a pergunta que quem abre a linha faz primeiro
   * ("e o cavalo dela?"). O farol responde "mudou? fecha?"; isto responde "como
   * este par existe?", e são perguntas diferentes.
   */
  explicacaoDoVinculo: string;
  /** A placa que o cavalo declarou, tenha ela encontrado carreta ou não. */
  placaApontada: string | null;
  /** Falso quando o conjunto estava na vigência anterior e não está nesta. */
  presente: boolean;
  cavalo: LadoDoConjunto | null;
  carreta: LadoDoConjunto | null;
  /** A soma do que as duas fichas apuram. Nulo quando nenhum lado apurou nada. */
  apurado: number | null;
  /** O total do conjunto como a fonte o declara. */
  declarado: number | null;
  /** Qual coluna carrega o total declarado, e como ela se chama na tela. */
  declaradoCode: string | null;
  declaradoTitulo: string | null;
  /** De que arquivo veio o total declarado. */
  fonte: string | null;
  /**
   * `declarado − apurado`. Nulo quando falta uma das duas pontas — e nulo não é
   * zero: é a conferência que não pôde ser feita.
   */
  divergencia: number | null;
  /** Verdadeiro quando a conferência fecha dentro da tolerância. */
  fecha: boolean | null;
  /** A variação do total declarado contra a vigência anterior. */
  variacao: Variacao | null;
  /** A placa da carreta na vigência anterior, quando o cavalo trocou de carreta. */
  carretaAnterior: string | null;
  status: StatusDoConjunto;
}

export interface ResumoDosConjuntos {
  conjuntos: number;
  pareados: number;
  carretasOrfas: number;
  cavalosSemCarreta: number;
  /** Placa apontada sem carreta na vigência, ou disputada por dois cavalos. */
  vinculosQuebrados: number;
  /** Quantos têm total de conjunto declarado pela fonte. */
  comDeclarado: number;
  declaradoTotal: number | null;
  apuradoTotal: number | null;
  /** Quantos puderam ser conferidos — têm as duas pontas. */
  conferidos: number;
  fecham: number;
  divergem: number;
  /** A soma das diferenças dos que foram conferidos. */
  divergenciaTotal: number | null;
  variacaoTotal: number | null;
  comAumento: number;
  comReducao: number;
  trocaramDeCarreta: number;
  porFarol: Record<Farol, number>;
}

export interface FiltrosDeConjuntos {
  /** Placa de qualquer um dos dois lados, ou pedaço dela. */
  busca?: string;
  status?: Farol;
  /** Só os que a conferência não fecha. */
  comDivergencia?: boolean;
  /** Só os que não formaram par. */
  semPar?: boolean;
  /** Só os que mudaram de total contra a vigência anterior. */
  comAlteracao?: boolean;
}

export interface VisaoDeConjuntos {
  context: {
    scopeHash: string;
    channel: string | null;
    label: string;
    unidade: string | null;
  };
  effectiveDate: string;
  periodLabel: string;
  anterior: { effectiveDate: string; periodLabel: string } | null;
  vigencias: { effectiveDate: string; periodLabel: string }[];
  /** Se esta vigência entregou cada uma das duas séries. */
  seriesEntregues: { CAVALO: boolean; CARRETA: boolean };
  toleranciaDaConferencia: number;
  resumo: ResumoDosConjuntos;
  linhas: LinhaDoConjunto[];
  totalSemFiltro: number;
}

// ---------------------------------------------------------------------------
// O material de uma vigência: os dois lados, apurados pelo mesmo motor
// ---------------------------------------------------------------------------

interface ApuracaoDoAtivo {
  mensal: number | null;
  componentes: ComponenteDoLado[];
  semRegraFinanceira: number;
  naoApuradoPor: MotivoDaNaoApuracao | null;
  /** O total do conjunto que este ativo carrega, quando ele carrega um. */
  declarado: number | null;
  declaradoTitulo: string | null;
  fonte: string | null;
}

interface MaterialDoConjunto {
  effectiveDate: string;
  periodLabel: string;
  fatosPorAtivo: Map<string, FatoDoAtivo[]>;
  apuracoes: Map<string, ApuracaoDoAtivo>;
  pares: ParDoConjunto[];
  parPorId: Map<string, ParDoConjunto>;
}

/** A coluna que a fonte usa para declarar o total do conjunto. */
const CODIGO_DO_TOTAL = regraDe("CARRETA").totalDoConjunto ?? null;

/**
 * Apura um ativo pelo motor da composição, e colhe de lado o total do conjunto.
 *
 * O total do conjunto **não** é lido por fora do portão: ele sai de `aprovados`,
 * que é a lista do que passou por semântica confirmada, monetário, somável e com
 * periodicidade — e que existe exatamente para isto. Uma leitura direta do fato
 * daria o número mesmo no dia em que a semântica de `custoFixo` deixasse de
 * estar confirmada, e a conferência passaria a comparar um valor auditado com um
 * valor solto.
 */
function apurar(
  entityType: string,
  fatos: FatoDoAtivo[],
  classificacoes: Map<string, AttributeClassification>,
): ApuracaoDoAtivo {
  const composicao = comporDeFatos(entityType, fatos, classificacoes);
  const mensal = mensalDe(composicao.totais);
  const declarado =
    CODIGO_DO_TOTAL !== null ? (composicao.aprovados.get(CODIGO_DO_TOTAL) ?? null) : null;

  return {
    mensal,
    componentes: composicao.linhas
      .filter((l) => l.gaveta === "MENSAL")
      .map((l) => ({ code: l.code, titulo: l.titulo, valor: l.valor })),
    semRegraFinanceira: composicao.naoApurados.filter((n) => n.monetarioPotencial).length,
    naoApuradoPor:
      mensal === null && fatos.length > 0
        ? motivoDaNaoApuracao(composicao.naoApurados)
        : null,
    declarado: declarado?.valor ?? null,
    declaradoTitulo: declarado?.titulo ?? null,
    fonte: declarado?.fato.source_label ?? null,
  };
}

async function lerMaterial(
  db: Database,
  vigencia: { effectiveDate: string; periodLabel: string },
  context: SeriesContext,
  identidades: Map<string, Identidade>,
): Promise<MaterialDoConjunto> {
  /*
    Uma leitura por tipo, e não uma por ativo. São duas consultas para desenhar
    os 71 conjuntos de uma vigência, e quatro para desenhá-los com a variação —
    a mesma conta que `getVisaoDeFrota` já fazia para um tipo só.
  */
  const [cavalos, carretas] = await Promise.all([
    lerVigencia(db, "CAVALO", vigencia.effectiveDate, context),
    lerVigencia(db, "CARRETA", vigencia.effectiveDate, context),
  ]);

  const fatosPorAtivo = new Map<string, FatoDoAtivo[]>([
    ...cavalos.fatosPorAtivo,
    ...carretas.fatosPorAtivo,
  ]);

  const apuracoes = new Map<string, ApuracaoDoAtivo>();
  for (const [entityId, fatos] of cavalos.fatosPorAtivo) {
    apuracoes.set(entityId, apurar("CAVALO", fatos, cavalos.classificacoes));
  }
  for (const [entityId, fatos] of carretas.fatosPorAtivo) {
    apuracoes.set(entityId, apurar("CARRETA", fatos, carretas.classificacoes));
  }

  const presentes: AtivoDoVinculo[] = [];
  for (const entityId of fatosPorAtivo.keys()) {
    const identidade = identidades.get(entityId);
    if (identidade) presentes.push(identidade);
  }

  const indice = indexarVinculos(identidades.values(), fatosPorAtivo);
  const pares = parearConjuntos(indice, presentes);

  return {
    effectiveDate: vigencia.effectiveDate,
    periodLabel: vigencia.periodLabel,
    fatosPorAtivo,
    apuracoes,
    pares,
    parPorId: new Map(pares.map((p) => [p.id, p])),
  };
}

// ---------------------------------------------------------------------------
// A visão
// ---------------------------------------------------------------------------

export async function getVisaoDeConjuntos(
  db: Database,
  opcoes: {
    period?: string;
    context?: Partial<SeriesContext>;
    filtros?: FiltrosDeConjuntos;
  } = {},
): Promise<VisaoDeConjuntos | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await listarVigencias(db, context);
  if (vigencias.length === 0) return null;

  const alvo =
    opcoes.period !== undefined
      ? vigencias.find((v) => v.effectiveDate === opcoes.period)
      : vigencias[vigencias.length - 1];
  if (!alvo) return null;

  const posicao = vigencias.indexOf(alvo);
  const anterior = posicao > 0 ? vigencias[posicao - 1] : null;

  const identidades = await lerIdentidades(db, TIPOS_DO_CONJUNTO);
  /*
    As duas vigências e as duas séries de uma vez. A visão precisa da anterior
    para dizer o que mudou — e precisa dela **pareada de novo**, e não pareada
    como hoje: um cavalo que trocou de carreta em agosto continuou puxando a
    antiga em julho, e comparar o conjunto de agosto com "o mesmo par lido em
    julho" mediria a diferença contra uma frota que não existiu.
  */
  const [material, materialAnterior, serieDeCavalos, serieDeCarretas] = await Promise.all([
    lerMaterial(db, alvo, context, identidades),
    anterior
      ? lerMaterial(db, anterior, context, identidades)
      : Promise.resolve<MaterialDoConjunto | null>(null),
    serieFoiEntregue(db, "CAVALO", alvo.effectiveDate, context),
    serieFoiEntregue(db, "CARRETA", alvo.effectiveDate, context),
  ]);
  const seriesEntregues = { CAVALO: serieDeCavalos, CARRETA: serieDeCarretas };

  const linhas: LinhaDoConjunto[] = material.pares.map((par) =>
    montarLinha(par, material, materialAnterior, identidades),
  );

  /*
    Quem saiu. Um conjunto que estava na vigência anterior e não está nesta é o
    evento que mais mexe no total da frota, e o único que uma lista "do que está
    aqui" nunca mostra.

    A conferência que este trecho faz antes de emitir a linha existe por causa de
    um falso positivo real: a chave do conjunto é o cavalo, ou a carreta quando
    ela é órfã. Uma carreta órfã em julho que ganha cavalo em agosto muda de
    chave — e sem esta guarda apareceria como "conjunto que saiu" ao lado do
    conjunto novo que a contém. Ela não saiu; ela mudou de conjunto, e é no
    conjunto novo que isso se lê.
  */
  const idsAgora = new Set(material.pares.map((p) => p.id));
  for (const par of materialAnterior?.pares ?? []) {
    if (idsAgora.has(par.id)) continue;
    const aindaNaFrota = [par.cavalo, par.carreta].some(
      (lado) => lado !== null && material.fatosPorAtivo.has(lado.entityId),
    );
    if (aindaNaFrota) continue;
    linhas.push(linhaQueSaiu(par, materialAnterior!));
  }

  linhas.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }));

  return {
    context: {
      scopeHash: context.scopeHash,
      channel: context.channel,
      label: context.label,
      unidade: unidadeDe(context),
    },
    effectiveDate: alvo.effectiveDate,
    periodLabel: alvo.periodLabel,
    anterior: anterior
      ? { effectiveDate: anterior.effectiveDate, periodLabel: anterior.periodLabel }
      : null,
    vigencias: vigencias.map((v) => ({
      effectiveDate: v.effectiveDate,
      periodLabel: v.periodLabel,
    })),
    seriesEntregues,
    toleranciaDaConferencia: TOLERANCIA_DA_CONFERENCIA,
    /* O resumo descreve a frota, e não o recorte — a mesma regra da aba de
       equipamentos: filtrar por "não fecha" não pode encolher o total do mês. */
    resumo: resumir(linhas),
    linhas: aplicarFiltros(linhas, opcoes.filtros ?? {}),
    totalSemFiltro: linhas.length,
  };
}

function ladoDe(
  ativo: AtivoDoVinculo | null,
  identidades: Map<string, Identidade>,
  material: MaterialDoConjunto,
): LadoDoConjunto | null {
  if (ativo === null) return null;
  const apuracao = material.apuracoes.get(ativo.entityId);
  return {
    entityId: ativo.entityId,
    entityType: ativo.entityType,
    placa: ativo.placa,
    chassi: identidades.get(ativo.entityId)?.chassi ?? null,
    mensal: apuracao?.mensal ?? null,
    componentes: apuracao?.componentes ?? [],
    semRegraFinanceira: apuracao?.semRegraFinanceira ?? 0,
    naoApuradoPor: apuracao?.naoApuradoPor ?? null,
  };
}

function montarLinha(
  par: ParDoConjunto,
  material: MaterialDoConjunto,
  anterior: MaterialDoConjunto | null,
  identidades: Map<string, Identidade>,
): LinhaDoConjunto {
  const cavalo = ladoDe(par.cavalo, identidades, material);
  const carreta = ladoDe(par.carreta, identidades, material);

  /*
    O apurado é a soma do que as duas fichas mostram — e é nulo, não zero, quando
    nenhum dos lados apurou nada. Zero seria a afirmação de que o conjunto não
    recebe; nulo é a afirmação de que não sabemos, que é a verdadeira.
  */
  const parcelas = [cavalo?.mensal ?? null, carreta?.mensal ?? null].filter(
    (v): v is number => v !== null,
  );
  const apurado =
    parcelas.length === 0 ? null : Number(parcelas.reduce((a, b) => a + b, 0).toFixed(2));

  const apuracaoDaCarreta = par.carreta
    ? material.apuracoes.get(par.carreta.entityId)
    : undefined;
  const declarado = apuracaoDaCarreta?.declarado ?? null;

  const divergencia =
    declarado === null || apurado === null ? null : Number((declarado - apurado).toFixed(2));

  const parAnterior = anterior?.parPorId.get(par.id) ?? null;
  const declaradoAnterior = parAnterior?.carreta
    ? (anterior!.apuracoes.get(parAnterior.carreta.entityId)?.declarado ?? null)
    : null;

  const carretaAnterior =
    parAnterior !== null &&
    parAnterior.placaApontada !== par.placaApontada &&
    par.natureza !== "CARRETA_ORFA"
      ? parAnterior.placaApontada
      : null;

  const variacao = calcularVariacao(declarado, declaradoAnterior);

  return {
    id: par.id,
    rotulo: rotuloDoPar(par),
    natureza: par.natureza,
    explicacaoDoVinculo: FRASE_DA_NATUREZA[par.natureza],
    placaApontada: par.placaApontada,
    presente: true,
    cavalo,
    carreta,
    apurado,
    declarado,
    declaradoCode: declarado === null ? null : CODIGO_DO_TOTAL,
    declaradoTitulo: apuracaoDaCarreta?.declaradoTitulo ?? null,
    fonte: apuracaoDaCarreta?.fonte ?? null,
    divergencia,
    fecha: divergencia === null ? null : Math.abs(divergencia) <= TOLERANCIA_DA_CONFERENCIA,
    variacao,
    carretaAnterior,
    status: avaliarStatusDoConjunto({
      presente: true,
      anteriorPresente: anterior === null ? null : parAnterior !== null,
      natureza: par.natureza,
      disputantes: par.disputantes.length,
      placaApontada: par.placaApontada,
      declarado,
      apurado,
      divergencia,
      variacao,
      carretaAnterior,
    }),
  };
}

/** A linha de um conjunto que estava na vigência anterior e não está nesta. */
function linhaQueSaiu(par: ParDoConjunto, anterior: MaterialDoConjunto): LinhaDoConjunto {
  const declarado = par.carreta
    ? (anterior.apuracoes.get(par.carreta.entityId)?.declarado ?? null)
    : null;
  return {
    id: par.id,
    rotulo: rotuloDoPar(par),
    natureza: par.natureza,
    explicacaoDoVinculo: FRASE_DA_NATUREZA[par.natureza],
    placaApontada: par.placaApontada,
    presente: false,
    cavalo: null,
    carreta: null,
    apurado: null,
    declarado: null,
    declaradoCode: null,
    declaradoTitulo: null,
    fonte: null,
    divergencia: null,
    fecha: null,
    variacao: null,
    carretaAnterior: null,
    status: {
      farol: "INCOMPLETO",
      motivos: [
        `O conjunto saiu da frota nesta vigência — estava em ${anterior.periodLabel}` +
          (declarado === null
            ? "."
            : ` com ${formatarBrl(declarado)}/mês declarados, e não está aqui.`),
      ],
      alertas: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// O farol do conjunto
// ---------------------------------------------------------------------------

interface EntradaDoStatusDoConjunto {
  presente: boolean;
  anteriorPresente: boolean | null;
  natureza: NaturezaDoVinculo;
  disputantes: number;
  placaApontada: string | null;
  declarado: number | null;
  apurado: number | null;
  divergencia: number | null;
  variacao: Variacao | null;
  carretaAnterior: string | null;
}

/**
 * O farol do conjunto — e o que ele deliberadamente **não** acende.
 *
 * Uma carreta órfã não é alerta. São 9 das 71 desta base, todas as vigências, e
 * pintá-las de amarelo para sempre ensinaria quem lê a ignorar o amarelo — a
 * mesma armadilha que `status.ts` já descreve a respeito de completude. A
 * natureza do vínculo é uma coluna da tabela, não um alerta.
 *
 * O que acende:
 *
 * | Cor | Quando |
 * |---|---|
 * | ⚪ Incompleto | saiu da frota, ou não há as duas pontas para conferir |
 * | 🔴 Crítico | a conferência não fecha, o vínculo aponta para o vazio, ou o total variou acima do limiar |
 * | 🟡 Atenção | entrou na frota, trocou de carreta, ou o total mudou |
 * | 🟢 Normal | fecha, sem movimento |
 */
function avaliarStatusDoConjunto(
  entrada: EntradaDoStatusDoConjunto,
): StatusDoConjunto {
  const motivos: string[] = [];

  /*
    O movimento do vínculo é dito sempre, seja qual for a cor que a linha acabe
    tendo. Ele ficava no fim, junto com os movimentos leves, e desaparecia
    exatamente nos conjuntos em que mais importa: um que trocou de carreta *e*
    saltou de valor voltava CRITICO pelo salto, sem uma palavra sobre a troca —
    que é, quase sempre, a explicação do salto.
  */
  if (entrada.carretaAnterior !== null) {
    motivos.push(
      entrada.natureza === "CAVALO_SEM_VINCULO"
        ? `O cavalo deixou de declarar carreta nesta vigência — puxava a ` +
          `${entrada.carretaAnterior} na anterior.`
        : `O cavalo trocou de carreta: puxava a ${entrada.carretaAnterior} na vigência anterior.`,
    );
  }

  if (entrada.natureza === "CAVALO_SEM_VINCULO") {
    motivos.push(
      "Este cavalo não declara carreta nesta vigência, então não há total de conjunto " +
        "na fonte para conferir contra o que as fichas apuram.",
    );
    return { farol: "INCOMPLETO", motivos, alertas: motivos.length };
  }

  /* 🔴 O vínculo existe na fonte e não encontra destino no banco. */
  if (entrada.natureza === "PLACA_SEM_CARRETA") {
    motivos.push(
      `O cavalo aponta a carreta ${entrada.placaApontada ?? "—"}, que não está nesta ` +
        "vigência. O conjunto não pôde ser formado, e o total declarado dela não pôde ser lido.",
    );
  }
  if (entrada.natureza === "PLACA_DISPUTADA") {
    motivos.push(
      `A placa ${entrada.placaApontada ?? "—"} é apontada por ${entrada.disputantes} cavalos ` +
        "nesta vigência. A carreta foi atribuída a um só deles, porque atribuí-la aos dois " +
        "contaria a remuneração dela duas vezes na frota.",
    );
  }

  const vinculoQuebrado =
    entrada.natureza === "PLACA_SEM_CARRETA" || entrada.natureza === "PLACA_DISPUTADA";

  if (entrada.declarado === null || entrada.apurado === null) {
    if (vinculoQuebrado) {
      return { farol: "CRITICO", motivos, alertas: motivos.length };
    }
    motivos.push(
      entrada.declarado === null
        ? "A fonte não declara o total deste conjunto nesta vigência — sem ele não há " +
            "conferência, e o que cada lado recebe continua na ficha dele."
        : "Nenhum dos dois lados teve remuneração mensal apurada, então não há o que " +
            "conferir contra o total declarado.",
    );
    return { farol: "INCOMPLETO", motivos, alertas: motivos.length };
  }

  const naoFecha =
    entrada.divergencia !== null &&
    Math.abs(entrada.divergencia) > TOLERANCIA_DA_CONFERENCIA;

  if (naoFecha) {
    motivos.push(
      `A fonte declara ${formatarBrl(entrada.declarado)}/mês para este conjunto e as duas ` +
        `fichas somam ${formatarBrl(entrada.apurado)}/mês — diferença de ` +
        `${formatarBrl(Math.abs(entrada.divergencia!))}. O valor exibido continua sendo o da ` +
        "fonte, que é o que a Ambev paga; a diferença fica registrada porque é ela a " +
        "informação de auditoria.",
    );
  }

  const percentual = entrada.variacao?.percentual ?? null;
  const saltou = percentual !== null && Math.abs(percentual) >= LIMIAR_CRITICO_PERCENTUAL;
  if (saltou) {
    motivos.push(
      `O total do conjunto variou ${percentual! > 0 ? "+" : ""}` +
        `${percentual!.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% contra a ` +
        `vigência anterior — acima do limiar de ${LIMIAR_CRITICO_PERCENTUAL}%.`,
    );
  }

  if (naoFecha || saltou || vinculoQuebrado) {
    return { farol: "CRITICO", motivos, alertas: motivos.length };
  }

  /* 🟡 Movimento sem gravidade: mudou, e a mudança precisa ser vista. */
  if (entrada.anteriorPresente === false) {
    motivos.push("O conjunto entrou na frota nesta vigência.");
  } else if (entrada.variacao !== null && entrada.variacao.absoluta !== 0) {
    motivos.push(
      `O total do conjunto mudou em ${entrada.variacao.absoluta > 0 ? "+" : "−"}` +
        `${formatarBrl(Math.abs(entrada.variacao.absoluta))}` +
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

  return { farol: "NORMAL", motivos: [], alertas: 0 };
}

function formatarBrl(valor: number): string {
  return `R$ ${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Resumo e filtros
// ---------------------------------------------------------------------------

function resumir(linhas: LinhaDoConjunto[]): ResumoDosConjuntos {
  const porFarol: Record<Farol, number> = {
    NORMAL: 0,
    ATENCAO: 0,
    CRITICO: 0,
    INCOMPLETO: 0,
  };

  let pareados = 0;
  let carretasOrfas = 0;
  let cavalosSemCarreta = 0;
  let vinculosQuebrados = 0;
  let comDeclarado = 0;
  let declaradoTotal: number | null = null;
  let apuradoTotal: number | null = null;
  let conferidos = 0;
  let fecham = 0;
  let divergem = 0;
  let divergenciaTotal: number | null = null;
  let variacaoTotal: number | null = null;
  let comAumento = 0;
  let comReducao = 0;
  let trocaramDeCarreta = 0;

  for (const linha of linhas) {
    porFarol[linha.status.farol] += 1;

    if (linha.presente) {
      if (linha.natureza === "PAREADO") pareados += 1;
      else if (linha.natureza === "CARRETA_ORFA") carretasOrfas += 1;
      else if (linha.natureza === "CAVALO_SEM_VINCULO") cavalosSemCarreta += 1;
      else {
        cavalosSemCarreta += 1;
        vinculosQuebrados += 1;
      }
    }

    if (linha.declarado !== null) {
      comDeclarado += 1;
      declaradoTotal = (declaradoTotal ?? 0) + linha.declarado;
    }
    if (linha.apurado !== null) apuradoTotal = (apuradoTotal ?? 0) + linha.apurado;

    if (linha.divergencia !== null) {
      conferidos += 1;
      divergenciaTotal = (divergenciaTotal ?? 0) + linha.divergencia;
      if (linha.fecha) fecham += 1;
      else divergem += 1;
    }

    if (linha.variacao !== null) {
      variacaoTotal = (variacaoTotal ?? 0) + linha.variacao.absoluta;
      if (linha.variacao.absoluta > 0) comAumento += 1;
      else if (linha.variacao.absoluta < 0) comReducao += 1;
    }

    if (linha.carretaAnterior !== null) trocaramDeCarreta += 1;
  }

  const arredondar = (v: number | null) => (v === null ? null : Number(v.toFixed(2)));

  return {
    conjuntos: linhas.filter((l) => l.presente).length,
    pareados,
    carretasOrfas,
    cavalosSemCarreta,
    vinculosQuebrados,
    comDeclarado,
    declaradoTotal: arredondar(declaradoTotal),
    apuradoTotal: arredondar(apuradoTotal),
    conferidos,
    fecham,
    divergem,
    divergenciaTotal: arredondar(divergenciaTotal),
    variacaoTotal: arredondar(variacaoTotal),
    comAumento,
    comReducao,
    trocaramDeCarreta,
    porFarol,
  };
}

function aplicarFiltros(
  linhas: LinhaDoConjunto[],
  filtros: FiltrosDeConjuntos,
): LinhaDoConjunto[] {
  const busca = filtros.busca?.trim().toUpperCase();
  return linhas.filter((linha) => {
    if (busca) {
      const alvo = [
        linha.rotulo,
        linha.placaApontada ?? "",
        linha.cavalo?.chassi ?? "",
        linha.carreta?.chassi ?? "",
      ]
        .join(" ")
        .toUpperCase();
      if (!alvo.includes(busca)) return false;
    }
    if (filtros.status && linha.status.farol !== filtros.status) return false;
    if (filtros.comDivergencia && linha.fecha !== false) return false;
    if (filtros.semPar && linha.natureza === "PAREADO") return false;
    if (filtros.comAlteracao && (linha.variacao === null || linha.variacao.absoluta === 0)) {
      return false;
    }
    return true;
  });
}
