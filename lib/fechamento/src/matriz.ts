import { centavos } from "./dominio";
import { diferencaDoTotalGeral, montarFaturado } from "./faturado";
import type { MapaDaQuinzena, QuadroDoResumo } from "./mapa-rota";
import {
  ARREDONDAMENTO_DO_TOTAL,
  DIVERGENCIAS_CONHECIDAS,
  insumosDoGabarito,
  reconciliar,
  TUDO_DO_GABARITO,
  type FechamentoDaPlanilha,
  type ModoDaProva,
  type QuinzenaDaPlanilha,
} from "./reconciliacao";

/**
 * A MATRIZ — as vinte e duas linhas do `RESUMO GERAL`, todas explicadas.
 *
 * `reconciliacao.ts` prova o motor contra a planilha em catorze linhas. São as
 * que têm conta interessante, e por muito tempo foram as únicas que alguém
 * olhava. O problema de parar nelas é que **as oito que sobram somem** — e
 * sumir é diferente de bater: uma linha que ninguém confere não é uma linha
 * correta, é uma linha sem opinião. Entre as oito estavam justamente as três
 * que fecham o documento (`TOTAL GERAL UNIDADE`, `TOTAL GERAL SRTRANS`,
 * `DIFERENÇA - TOTAL GERAL`) e o quadro reservado da equipe de entrega.
 *
 * Esta matriz cobre as vinte e duas e obriga cada uma a ter um {@link
 * StatusDaLinha}. Não há estado "não avaliada": ou a linha é reproduzida, ou a
 * divergência é da planilha e está nomeada, ou a divergência é nossa e é bug,
 * ou falta a fonte operacional e está dito qual, ou a linha não se aplica.
 *
 * **A distinção que a matriz existe para não deixar borrar** é entre
 * `DIVERGENCIA_JUSTIFICADA_PLANILHA` e `DIVERGENCIA_DO_MOTOR`. A primeira é
 * achado — a planilha tem fórmula quebrada, cache, intervalo inválido ou
 * arredondamento de intermediário, e reproduzir isso seria copiar o defeito. A
 * segunda é defeito nosso e tem de quebrar o build. Um status só para as duas
 * transformaria todo bug futuro numa "diferença conhecida".
 *
 * **Nada aqui conserta nada.** O valor do motor é o que o motor calculou, o da
 * planilha é o que ela imprime, e a diferença é a subtração dos dois — inteira,
 * com a causa ao lado.
 */

/** O veredito de uma linha. Toda linha tem um; não existe "não avaliada". */
export type StatusDaLinha =
  /** O motor chega ao mesmo número da planilha nas três colunas. */
  | "REPRODUZIDA"
  /**
   * Os números diferem, e a causa é um defeito da planilha já rastreado.
   *
   * Reproduzi-lo seria copiar o erro para dentro do produto. O valor do motor
   * é o correto, e a diferença fica visível com a causa nomeada.
   */
  | "DIVERGENCIA_JUSTIFICADA_PLANILHA"
  /** Os números diferem e a causa não é da planilha. É bug, e trava o gate. */
  | "DIVERGENCIA_DO_MOTOR"
  /** O sistema ainda não tem de onde tirar esta linha, e está dito qual fonte falta. */
  | "FONTE_NAO_DISPONIVEL"
  /** A planilha não escreve número nesta linha — não há o que reproduzir. */
  | "NAO_SE_APLICA";

/** As três colunas de uma linha. */
export interface TresValores {
  primeira: number | null;
  segunda: number | null;
  total: number | null;
}

export interface LinhaDaMatriz {
  /** A linha no `RESUMO GERAL` — 7 a 40. É o endereço que quem confere procura. */
  linhaNaPlanilha: number;
  chave: string;
  /** O rótulo como a planilha o grita. */
  rotulo: string;
  quadro: string;
  /** As células das três colunas: `AI7 / AJ7 / AK7`. */
  celulas: string;
  /** Que relatório ou cadastro alimenta esta linha no sistema. */
  fonteOperacional: string;
  /** A regra do motor, em português. */
  regraNoSistema: string;
  /** A fórmula da planilha, transcrita do arquivo. */
  formulaDaPlanilha: string;
  planilha: TresValores;
  sistema: TresValores;
  /** `sistema − planilha`. */
  diferenca: TresValores;
  status: StatusDaLinha;
  /** Por que o status não é `REPRODUZIDA`. `null` quando é. */
  causa: string | null;
}

export interface MatrizDaReconciliacao {
  competencia: string;
  arquivo: string;
  modo: ModoDaProva;
  linhas: LinhaDaMatriz[];
  /** Quantas linhas em cada status. Soma sempre `linhas.length`. */
  placar: Record<StatusDaLinha, number>;
  /**
   * De onde vieram os insumos — e, portanto, o que esta matriz prova.
   *
   * `pontaAPonta` só é verdadeiro quando **nenhum** insumo veio do gabarito.
   * Enquanto for falso, a matriz prova que o motor reproduz a planilha dadas as
   * entradas dela — que é uma coisa boa e não é a coisa que se quer provar.
   */
  insumos: {
    pontaAPonta: boolean;
    /** Os insumos que ainda saem do gabarito, nomeados por quinzena. */
    doGabarito: { quinzena: 1 | 2; itens: string[] }[];
  };
}

/* ---------------------------------------------------------------------------
   O catálogo: as vinte e duas linhas, com procedência declarada
   ------------------------------------------------------------------------ */

/** De onde o motor tira o número de uma linha. */
type DoMotor =
  /** Uma linha de um quadro do mapa. */
  | { de: "LINHA"; quadro: QuadroDoResumo; chave: string }
  /** O total de um quadro do mapa. */
  | { de: "TOTAL_DO_QUADRO"; quadro: QuadroDoResumo }
  /** `MapaDaQuinzena.totalGeral`. */
  | { de: "TOTAL_GERAL" }
  /** O `Total Remuneração` do 03.08.20 — ver `faturado.ts`. */
  | { de: "FATURADO" }
  /** `faturado − total geral da unidade`. */
  | { de: "DIFERENCA_GERAL" };

/** De onde a planilha tira o número de uma linha. */
type DaPlanilha =
  | { de: "RESUMO"; chave: string }
  | { de: "TOTAL"; campo: "remuneracao" | "variavel" | "outrosCustos" | "geral" }
  | { de: "PUBLICADO"; campo: "equipeDeEntrega" | "srtrans" | "diferencaGeral" };

/** Uma parcela de que uma linha derivada herda a diferença, com o sinal dela. */
interface Herança {
  chave: string;
  sinal: 1 | -1;
}

interface EntradaDoCatalogo {
  linhaNaPlanilha: number;
  chave: string;
  rotulo: string;
  quadro: string;
  fonteOperacional: string;
  regraNoSistema: string;
  formulaDaPlanilha: string;
  motor: DoMotor;
  planilha: DaPlanilha;
  /**
   * De quais linhas esta é a soma — para a diferença dela poder ser explicada.
   *
   * Uma linha derivada não tem divergência própria: ela tem a soma das
   * divergências das parcelas, mais — se houver — um resíduo que é dela. Sem
   * esta lista, todo total herdeiro de uma divergência conhecida da planilha
   * aparecia como defeito do motor, e o gate ficava vermelho por herança. Com
   * ela, o que sobra depois de descontada a herança é o que de fato tem de
   * quebrar o build. Ver {@link classificar}.
   *
   * As parcelas de desconto já entram negativas no valor, então o sinal é `1`
   * para tudo o que soma e `-1` só onde a fórmula subtrai (a linha 40).
   */
  herdaDe?: Herança[];
}

const CADASTRO = "Cadastro do sistema (Remuneração)";
const DIARIO = "2Art";
const DEMONSTRATIVO = "03.08.20";

/**
 * As vinte e duas linhas, na ordem em que a planilha as empilha.
 *
 * As fórmulas foram transcritas da `Fechamento_Remuneracao.xlsb` de
 * julho/2026 — CDD Belém · Horizonte, célula a célula, com `cellFormula`. Onde
 * está escrito que a fórmula é quebrada, ela foi lida quebrada do arquivo.
 */
const CATALOGO: EntradaDoCatalogo[] = [
  {
    linhaNaPlanilha: 7,
    chave: "rota_dvs",
    rotulo: "TOTAL REMUNERAÇÃO ROTA DVS",
    quadro: "Rota — remuneração",
    fonteOperacional: DIARIO,
    regraNoSistema:
      "frota fixa + agregado + recarga/noturna + vans — o custo variável inteiro",
    formulaDaPlanilha: "='Mapa Rota'!AI131 = SUM(AI127:AI130)",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "rota_dvs" },
    planilha: { de: "RESUMO", chave: "rota_dvs" },
  },
  {
    linhaNaPlanilha: 8,
    chave: "custo_fixo_padronizado",
    rotulo: "CUSTO FIXO PADRONIZADO",
    quadro: "Rota — remuneração",
    fonteOperacional: CADASTRO,
    regraNoSistema:
      "(soma das 4 parcelas por veículo ÷ 2) × veículos ativos × fator de imposto",
    formulaDaPlanilha:
      "='Mapa Rota'!AI133 — Cadastro!C18,C19,C21,C22,C13 pesados por C49/C50",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "custo_fixo_padronizado" },
    planilha: { de: "RESUMO", chave: "custo_fixo_padronizado" },
  },
  {
    linhaNaPlanilha: 9,
    chave: "custo_fixo_inativos",
    rotulo: "CUSTO FIXO INATIVOS",
    quadro: "Rota — remuneração",
    fonteOperacional: CADASTRO,
    regraNoSistema: "(remuneração inativa ÷ 2) × veículos inativos × fator",
    formulaDaPlanilha: "='Mapa Rota'!AI136 — Cadastro!C27,C14",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "custo_fixo_inativos" },
    planilha: { de: "RESUMO", chave: "custo_fixo_inativos" },
  },
  {
    linhaNaPlanilha: 10,
    chave: "custo_vans_inativas",
    rotulo: "CUSTO VANS INATIVAS",
    quadro: "Rota — remuneração",
    fonteOperacional: CADASTRO,
    regraNoSistema: "(remuneração das vans inativas ÷ 2) × vans inativas × fator",
    formulaDaPlanilha: "='Mapa Rota'!AI137 — Cadastro!C37,C36",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "custo_vans_inativas" },
    planilha: { de: "RESUMO", chave: "custo_vans_inativas" },
  },
  {
    linhaNaPlanilha: 11,
    chave: "indisponibilidade_fixo",
    rotulo: "INDISPONIBILIDADE",
    quadro: "Rota — remuneração",
    fonteOperacional: DIARIO,
    regraNoSistema:
      "soma do ValorFaturado das viagens de Rota com marca em `TipoIndisp`",
    formulaDaPlanilha: "='Mapa Rota'!AI132 = SUM(D132:R132), cada dia = SUM(<dia>!$BP:$BP)",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "indisponibilidade_fixo" },
    planilha: { de: "RESUMO", chave: "indisponibilidade_fixo" },
  },
  {
    linhaNaPlanilha: 12,
    chave: "custo_fixo_especiais",
    rotulo: "CUSTO FIXO - ESPECIAIS",
    quadro: "Rota — remuneração",
    fonteOperacional: CADASTRO,
    regraNoSistema: "(noturna × fator ÷ 2) × rotas noturnas + (marketing × fator ÷ 2)",
    formulaDaPlanilha: "='Mapa Rota'!AI134 — Cadastro!C42,C40,C46 × (C49+C50)",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "custo_fixo_especiais" },
    planilha: { de: "RESUMO", chave: "custo_fixo_especiais" },
  },
  {
    linhaNaPlanilha: 13,
    chave: "custo_fixo_vans",
    rotulo: "CUSTO FIXO - VANS",
    quadro: "Rota — remuneração",
    fonteOperacional: CADASTRO,
    regraNoSistema: "(custo fixo da van + equipe da van) × vans ativas × fator ÷ 2",
    formulaDaPlanilha: "='Mapa Rota'!AI135 = Cadastro!C33/2",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "custo_fixo_vans" },
    planilha: { de: "RESUMO", chave: "custo_fixo_vans" },
  },
  {
    linhaNaPlanilha: 14,
    chave: "desconto_devolucao_percentual",
    rotulo: "DESCONTO DE DEVOLUÇÃO %",
    quadro: "Rota — remuneração",
    fonteOperacional: DEMONSTRATIVO,
    regraNoSistema: "−(base `Desconto Devolucao` sem imposto × fator)",
    formulaDaPlanilha:
      "='Mapa Rota'!AI138 — a base R138 é **digitada**, sem fórmula que a derive",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "desconto_devolucao_percentual" },
    planilha: { de: "RESUMO", chave: "desconto_devolucao_percentual" },
  },
  {
    linhaNaPlanilha: 15,
    chave: "desconto_disponibilidade",
    rotulo: "DESCONTO DE DISPONIBILIDADE",
    quadro: "Rota — remuneração",
    fonteOperacional: `${DEMONSTRATIVO} — decisão de domínio pendente, ver DECISOES_PENDENTES`,
    regraNoSistema:
      "−(soma dos quatro blocos `DESCONTO DISPONIBILIDADE` do 03.08.20 × fator)",
    formulaDaPlanilha:
      "='Mapa Rota'!AI139 — a base R139 é **digitada**; na 1ª quinzena ela traz o " +
      "frete mínimo do 03.08.20, não uma disponibilidade",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "desconto_disponibilidade" },
    planilha: { de: "RESUMO", chave: "desconto_disponibilidade" },
  },
  {
    linhaNaPlanilha: 16,
    chave: "desconto_complementar_negativo",
    rotulo: "DESCONTO COMPLEMENTAR NEGATIVO",
    quadro: "Rota — remuneração",
    fonteOperacional: DEMONSTRATIVO,
    regraNoSistema: "−(`Desconto Frete Minimo` do 03.08.20), **sem** fator",
    formulaDaPlanilha: "=-R140 — a base AH140 é **digitada**",
    motor: { de: "LINHA", quadro: "REMUNERACAO", chave: "desconto_complementar_negativo" },
    planilha: { de: "RESUMO", chave: "desconto_complementar_negativo" },
  },
  {
    linhaNaPlanilha: 17,
    chave: "total_remuneracao_rota",
    rotulo: "TOTAL REMUNERAÇÃO ROTA",
    quadro: "Rota — remuneração",
    fonteOperacional: "derivada — soma do quadro",
    regraNoSistema: "parcelas menos descontos do quadro; `null` se faltar qualquer uma",
    formulaDaPlanilha: "=SUM(AI7:AI16)",
    motor: { de: "TOTAL_DO_QUADRO", quadro: "REMUNERACAO" },
    planilha: { de: "TOTAL", campo: "remuneracao" },
    herdaDe: [
      "rota_dvs",
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "indisponibilidade_fixo",
      "custo_fixo_especiais",
      "custo_fixo_vans",
      "desconto_devolucao_percentual",
      "desconto_disponibilidade",
      "desconto_complementar_negativo",
    ].map((chave) => ({ chave, sinal: 1 as const })),
  },
  {
    linhaNaPlanilha: 21,
    chave: "custo_variavel_frota_fixa",
    rotulo: "CUSTO VARIÁVEL (FROTA FIXA)",
    quadro: "Rota — variável",
    fonteOperacional: `${DIARIO} + ${CADASTRO}`,
    regraNoSistema:
      "por dia: (previsto ÷ 25) ÷ divisor, pelo split ISS/ICMS do dia × mapas fechados",
    formulaDaPlanilha: "='Mapa Rota'!AI127 = SUM(D127:R127), cada dia = R125*R121",
    motor: { de: "LINHA", quadro: "VARIAVEL", chave: "custo_variavel_frota_fixa" },
    planilha: { de: "RESUMO", chave: "custo_variavel_frota_fixa" },
  },
  {
    linhaNaPlanilha: 22,
    chave: "custo_variavel_agregado",
    rotulo: "CUSTO VARIÁVEL (AGREGADO)",
    quadro: "Rota — variável",
    fonteOperacional: DIARIO,
    regraNoSistema: "soma do ValorFaturado das viagens de frota `Spot`",
    formulaDaPlanilha: "='Mapa Rota'!AI128 — SUMPRODUCT por tabela de tarifa",
    motor: { de: "LINHA", quadro: "VARIAVEL", chave: "custo_variavel_agregado" },
    planilha: { de: "RESUMO", chave: "custo_variavel_agregado" },
  },
  {
    linhaNaPlanilha: 23,
    chave: "desconto_devolucao_variavel",
    rotulo: "DESCONTO DE DEVOLUÇÃO",
    quadro: "Rota — variável",
    fonteOperacional: DEMONSTRATIVO,
    regraNoSistema: "a mesma linha 14 repetida no quadro, como a planilha a repete",
    formulaDaPlanilha: "='Mapa Rota'!AI138 — a mesma célula da linha 14",
    motor: { de: "LINHA", quadro: "VARIAVEL", chave: "desconto_devolucao_percentual" },
    planilha: { de: "RESUMO", chave: "desconto_devolucao_percentual" },
  },
  {
    linhaNaPlanilha: 24,
    chave: "indisponibilidade_variavel",
    rotulo: "INDISPONIBILIDADE (variável)",
    quadro: "Rota — variável",
    fonteOperacional: DEMONSTRATIVO,
    regraNoSistema: "a mesma linha 15 repetida no quadro, com o nome da causa",
    formulaDaPlanilha: "='Mapa Rota'!AI139 — a mesma célula da linha 15",
    motor: { de: "LINHA", quadro: "VARIAVEL", chave: "indisponibilidade_variavel" },
    planilha: { de: "RESUMO", chave: "indisponibilidade_variavel" },
  },
  {
    linhaNaPlanilha: 25,
    chave: "total_remuneracao_rota_variavel",
    rotulo: "TOTAL REMUNERAÇÃO ROTA (variável)",
    quadro: "Rota — variável",
    fonteOperacional: "derivada — soma do quadro",
    regraNoSistema: "parcelas menos descontos do quadro",
    formulaDaPlanilha: "=SUM(AI21:AI24)",
    motor: { de: "TOTAL_DO_QUADRO", quadro: "VARIAVEL" },
    planilha: { de: "TOTAL", campo: "variavel" },
    herdaDe: [
      "custo_variavel_frota_fixa",
      "custo_variavel_agregado",
      "desconto_devolucao_variavel",
      "indisponibilidade_variavel",
    ].map((chave) => ({ chave, sinal: 1 as const })),
  },
  {
    linhaNaPlanilha: 29,
    chave: "outros_custos",
    rotulo: "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS",
    quadro: "Outros custos",
    fonteOperacional: "03.08.12.09",
    regraNoSistema:
      "soma sem imposto das requisições **aprovadas** do canal (mesmo filtro da apuração)",
    formulaDaPlanilha: "='Outros Custos'!F4 = SUM(F5:F34)",
    motor: { de: "LINHA", quadro: "OUTROS_CUSTOS", chave: "outros_custos" },
    planilha: { de: "RESUMO", chave: "outros_custos" },
  },
  {
    linhaNaPlanilha: 30,
    chave: "total_outros_custos",
    rotulo: "TOTAL OUTROS CUSTOS",
    quadro: "Outros custos",
    fonteOperacional: "derivada — soma do quadro",
    regraNoSistema: "a única parcela do quadro; total e parcela são o mesmo número",
    formulaDaPlanilha:
      "=SUM(AI1048605:AI1048605) — **intervalo inválido**, o valor exibido é cache",
    motor: { de: "TOTAL_DO_QUADRO", quadro: "OUTROS_CUSTOS" },
    planilha: { de: "TOTAL", campo: "outrosCustos" },
    herdaDe: [{ chave: "outros_custos", sinal: 1 }],
  },
  {
    linhaNaPlanilha: 34,
    chave: "equipe_de_entrega",
    rotulo: "REMUNERAÇÃO VARIÁVEL - EQUIPE DE ENTREGA",
    quadro: "Equipe de entrega",
    fonteOperacional: "nenhuma — quadro reservado e vazio na planilha",
    regraNoSistema:
      "quadro sem linha; soma zero por não ter parcela, nunca por ter medido zero",
    formulaDaPlanilha: "AI34 e AJ34 **não existem como célula**; só AK34 = SUM(AI34+AJ34)",
    motor: { de: "TOTAL_DO_QUADRO", quadro: "EQUIPE_DE_ENTREGA" },
    planilha: { de: "PUBLICADO", campo: "equipeDeEntrega" },
  },
  {
    linhaNaPlanilha: 36,
    chave: "total_geral_unidade",
    rotulo: "TOTAL GERAL UNIDADE",
    quadro: "Fecho",
    fonteOperacional: "derivada — remuneração + outros custos + equipe de entrega",
    regraNoSistema: "os três quadros que a planilha soma; o variável fica fora",
    formulaDaPlanilha: "=SUM(AI17+AI30+AI34)",
    motor: { de: "TOTAL_GERAL" },
    planilha: { de: "TOTAL", campo: "geral" },
    herdaDe: [
      { chave: "total_remuneracao_rota", sinal: 1 },
      { chave: "total_outros_custos", sinal: 1 },
      { chave: "equipe_de_entrega", sinal: 1 },
    ],
  },
  {
    linhaNaPlanilha: 38,
    chave: "total_geral_srtrans",
    rotulo: "TOTAL GERAL SRTRANS",
    quadro: "Fecho",
    fonteOperacional: DEMONSTRATIVO,
    regraNoSistema:
      "`Total Remuneração` do 03.08.20 do canal; a decomposição por documentos é " +
      "conferência, não fonte — ver `faturado.ts`",
    formulaDaPlanilha: "=Abertura!$F$45 = SUM(F16+F29+F43)",
    motor: { de: "FATURADO" },
    planilha: { de: "PUBLICADO", campo: "srtrans" },
  },
  {
    linhaNaPlanilha: 40,
    chave: "diferenca_total_geral",
    rotulo: "DIFERENÇA - TOTAL GERAL",
    quadro: "Fecho",
    fonteOperacional: "derivada — SRTrans menos unidade",
    regraNoSistema: "faturado − total geral da unidade, no sinal da planilha",
    formulaDaPlanilha: "=AI38-AI36",
    motor: { de: "DIFERENCA_GERAL" },
    planilha: { de: "PUBLICADO", campo: "diferencaGeral" },
    herdaDe: [
      { chave: "total_geral_srtrans", sinal: 1 },
      { chave: "total_geral_unidade", sinal: -1 },
    ],
  },
];

/* ---------------------------------------------------------------------------
   As decisões que faltam — registradas, não assumidas
   ------------------------------------------------------------------------ */

/**
 * O que ainda não se sabe, com a evidência levantada e o que resolveria.
 *
 * Está no código, e não num documento, porque é o código que sustenta a
 * afirmação: a linha da matriz aponta para a chave daqui, e quem lê a matriz
 * chega ao motivo sem procurar.
 */
export const DECISOES_PENDENTES: Record<
  string,
  { pergunta: string; evidencia: string; resolve: string }
> = {
  desconto_disponibilidade: {
    pergunta:
      "Qual documento é a fonte canônica do desconto de disponibilidade: o 03.08.18, " +
      "que mede a frota contratada contra a realizada, ou o 03.08.20, que publica o " +
      "desconto já calculado?",
    evidencia:
      "Na 1ª quinzena de julho/2026 os três candidatos dão números diferentes, e por " +
      "isso a escolha não pode ser feita por coincidência. O 03.08.18 soma " +
      "R$ 42.939,35 no canal (Desc.FF Custo Fixo 5.870,63 + Desc.FF Equipe 36.747,87 + " +
      "Indiretos 0,00 + Desconto FA 320,85, dias 1 a 15). O 03.08.20 da mesma quinzena " +
      "**não traz bloco de disponibilidade nenhum** — traz `Desconto Devolucao` " +
      "13.328,30 e `Desconto Frete mínimo` 11.649,87, e nada mais. A planilha digita " +
      "11.649,87 na linha da disponibilidade (`Mapa Rota!R139`), que é exatamente o " +
      "frete mínimo do 03.08.20 — ou seja, ela põe o frete mínimo na linha errada e " +
      "deixa o complementar negativo zerado. Na 2ª quinzena a planilha digita 91.642,50, " +
      "que brutado dá os R$ 125.271,68 que ela imprime, e o 03.08.18 soma R$ 29.075,62. " +
      "Nenhuma das duas quinzenas casa com o 03.08.18.",
    resolve:
      "Um 03.08.20 de 2ª quinzena para conferir se o bloco de disponibilidade dele " +
      "bate com os 91.642,50 digitados, e uma segunda competência para ver se o " +
      "03.08.18 alguma vez reproduz a base. Enquanto isso, a regra do sistema " +
      "permanece a que está: o valor sai do 03.08.20, que é onde ele aparece como " +
      "dinheiro; o 03.08.18 é a evidência de frota por trás dele, e serve de " +
      "conferência.",
  },
};

/* ---------------------------------------------------------------------------
   A montagem
   ------------------------------------------------------------------------ */

const VAZIO: TresValores = { primeira: null, segunda: null, total: null };
const zero = (n: number | null) => n !== null && Math.abs(n) < 0.005;

function tres(primeira: number | null, segunda: number | null): TresValores {
  return {
    primeira,
    segunda,
    total:
      primeira === null || segunda === null ? null : centavos(primeira + segunda),
  };
}

function subtrair(a: TresValores, b: TresValores): TresValores {
  const menos = (x: number | null, y: number | null) =>
    x === null || y === null ? null : centavos(x - y);
  return {
    primeira: menos(a.primeira, b.primeira),
    segunda: menos(a.segunda, b.segunda),
    total: menos(a.total, b.total),
  };
}

/** O número do motor para uma linha, numa quinzena. */
function doMotor(
  origem: DoMotor,
  mapa: MapaDaQuinzena | undefined,
  q: QuinzenaDaPlanilha | undefined,
): number | null {
  if (!mapa) return null;
  switch (origem.de) {
    case "LINHA":
      return (
        mapa.quadros
          .find((x) => x.quadro === origem.quadro)
          ?.linhas.find((l) => l.chave === origem.chave)?.valor ?? null
      );
    case "TOTAL_DO_QUADRO":
      return mapa.quadros.find((x) => x.quadro === origem.quadro)?.total ?? null;
    case "TOTAL_GERAL":
      return mapa.totalGeral;
    case "FATURADO":
      return q?.faturado ? montarFaturado(q.faturado).total : null;
    case "DIFERENCA_GERAL":
      return q?.faturado
        ? diferencaDoTotalGeral(montarFaturado(q.faturado).total, mapa.totalGeral)
        : null;
  }
}

/** O número que a planilha imprime para uma linha, numa quinzena. */
function daPlanilha(origem: DaPlanilha, q: QuinzenaDaPlanilha | undefined): number | null {
  if (!q) return null;
  switch (origem.de) {
    case "RESUMO":
      return q.resumoGeral[origem.chave] ?? null;
    case "TOTAL":
      return q.totais[origem.campo] ?? null;
    case "PUBLICADO":
      return q.totais[origem.campo] ?? null;
  }
}

/**
 * O veredito de uma linha.
 *
 * A ordem das perguntas é o desenho: primeiro "a planilha escreve alguma coisa
 * aqui?", depois "o sistema tem de onde tirar?", depois "os dois batem?", e só
 * então "a diferença tem causa conhecida?". Inverter a ordem faria uma linha
 * sem fonte parecer divergência do motor — que é o erro que o gate mais paga
 * caro para não cometer.
 */
function classificar(
  entrada: EntradaDoCatalogo,
  planilha: TresValores,
  sistema: TresValores,
  diferenca: TresValores,
  /** As linhas já classificadas, para uma derivada poder olhar as parcelas. */
  jaClassificadas: Map<string, LinhaDaMatriz>,
): { status: StatusDaLinha; causa: string | null } {
  const chave = entrada.chave;
  const planilhaEscreve = [planilha.primeira, planilha.segunda].some((n) => n !== null);
  if (!planilhaEscreve) {
    return {
      status: "NAO_SE_APLICA",
      causa:
        "A planilha não escreve número nesta linha em nenhuma das duas quinzenas — " +
        "não há o que reproduzir.",
    };
  }

  const sistemaTem = [sistema.primeira, sistema.segunda].some((n) => n !== null);
  if (!sistemaTem) {
    return {
      status: "FONTE_NAO_DISPONIVEL",
      causa:
        "O sistema não tem, neste material, a fonte operacional desta linha. " +
        "A coluna `fonteOperacional` diz qual é.",
    };
  }

  const quinzenasFecham = zero(diferenca.primeira) && zero(diferenca.segunda);
  if (quinzenasFecham && zero(diferenca.total)) {
    return { status: "REPRODUZIDA", causa: null };
  }
  if (quinzenasFecham) {
    /* As duas quinzenas batem e só o total não: é arredondamento de intermediário. */
    return { status: "DIVERGENCIA_JUSTIFICADA_PLANILHA", causa: ARREDONDAMENTO_DO_TOTAL };
  }

  const conhecida = DIVERGENCIAS_CONHECIDAS[chave] ?? null;
  if (conhecida) return { status: "DIVERGENCIA_JUSTIFICADA_PLANILHA", causa: conhecida };

  /*
    A linha derivada não tem divergência própria enquanto a diferença dela for
    exatamente a soma das diferenças das parcelas. O que sobra depois de
    descontada a herança é o resíduo — e **esse** é do motor.

    A verificação é aritmética, e não uma isenção por parentesco: um total cuja
    fórmula estivesse errada teria resíduo mesmo com todas as parcelas
    justificadas, e cairia em `DIVERGENCIA_DO_MOTOR` como deve.
  */
  if (entrada.herdaDe) {
    const parcelas = entrada.herdaDe.map((h) => ({
      ...h,
      linha: jaClassificadas.get(h.chave) ?? null,
    }));

    /*
      A parcela que a planilha não escreve contribui **zero** para a diferença,
      e não `null`. É o caso do quadro reservado: `AI34` não existe, a soma da
      planilha o trata como zero, e o motor também soma zero — os dois
      concordam, e concordar não pode apagar a explicação do total inteiro.
    */
    const contribuicao = (
      linha: LinhaDaMatriz | null,
      coluna: keyof TresValores,
    ): number | null => {
      if (!linha) return null;
      if (linha.diferenca[coluna] !== null) return linha.diferenca[coluna];
      if (linha.status === "NAO_SE_APLICA" && zero(linha.sistema[coluna])) return 0;
      return null;
    };

    const herdado = (coluna: keyof TresValores) => {
      let soma = 0;
      for (const p of parcelas) {
        const c = contribuicao(p.linha, coluna);
        if (c === null) return null;
        soma += p.sinal * c;
      }
      return centavos(soma);
    };
    const residuo = (coluna: keyof TresValores) => {
      const h = herdado(coluna);
      const propria = diferenca[coluna];
      if (h === null || propria === null) return null;
      return centavos(propria - h);
    };

    /*
      O envelope do arredondamento, e por que ele não é uma tolerância.

      A planilha soma as parcelas **sem arredondar** — cada `AI7`…`AI16` carrega
      dez casas — e o motor arredonda cada linha a centavo, que é o que se
      fatura. Somando `n` parcelas, a distância máxima que só isso pode produzir
      é `n × meio centavo`. Não é um número escolhido para o teste passar: é o
      limite analítico do fenômeno, e ele **encolhe** quando o quadro tem menos
      linhas. Um resíduo maior que o envelope não é arredondamento e cai como
      defeito do motor, que é o que se quer.
    */
    const envelope = 0.005 * parcelas.length;
    const dentroDoEnvelope = (["primeira", "segunda", "total"] as const).every((c) => {
      const r = residuo(c);
      return r !== null && Math.abs(r) <= envelope + 1e-9;
    });

    if (dentroDoEnvelope) {
      const divergentes = parcelas
        .filter(
          (p) =>
            p.linha &&
            !(zero(p.linha.diferenca.primeira) && zero(p.linha.diferenca.segunda)),
        )
        .map((p) => p.linha!.rotulo);
      const maiorResiduo = Math.max(
        ...(["primeira", "segunda", "total"] as const).map((c) =>
          Math.abs(residuo(c) ?? 0),
        ),
      );
      const heranca =
        divergentes.length > 0
          ? `a diferença desta linha é a soma das diferenças de ${divergentes.join(", ")}, ` +
            "que já estão justificadas"
          : "nenhuma parcela diverge";
      return {
        status: "DIVERGENCIA_JUSTIFICADA_PLANILHA",
        causa:
          `Não diverge por conta própria: ${heranca}. Resíduo próprio de ` +
          `R$ ${maiorResiduo.toFixed(2)}, dentro do envelope de arredondamento de ` +
          `R$ ${envelope.toFixed(3)} (${parcelas.length} parcelas × meio centavo): a ` +
          "planilha soma as parcelas sem arredondar e o motor arredonda cada uma, que é " +
          "o que se fatura.",
      };
    }
  }

  return {
    status: "DIVERGENCIA_DO_MOTOR",
    causa:
      "Os números diferem e a causa não está entre os defeitos rastreados da planilha. " +
      "Até que alguém a nomeie, isto é defeito do motor.",
  };
}

/**
 * Monta a matriz completa — as vinte e duas linhas, cada uma com veredito.
 *
 * Roda o motor **uma vez** (via {@link reconciliar}, que devolve os mapas) e lê
 * dali. Rodá-lo de novo aqui seria manter duas execuções do mesmo cálculo, que
 * é como se chega a duas verdades sobre o mesmo número.
 */
export function montarMatriz(
  fechamento: FechamentoDaPlanilha,
  modo: ModoDaProva = "REGRA_CANONICA",
): MatrizDaReconciliacao {
  const reconciliacao = reconciliar(fechamento, modo);
  const porQuinzena = new Map(fechamento.quinzenas.map((q) => [q.quinzena, q]));

  /*
    A ordem do catálogo é a da planilha, e ela é também a ordem de dependência:
    toda linha derivada vem depois das parcelas que soma. Por isso o mapa de
    já-classificadas se enche à medida que a lista anda, e uma derivada sempre
    encontra as parcelas dela prontas.
  */
  const jaClassificadas = new Map<string, LinhaDaMatriz>();
  const linhas = CATALOGO.map((e): LinhaDaMatriz => {
    const q1 = porQuinzena.get(1);
    const q2 = porQuinzena.get(2);
    const planilha = tres(daPlanilha(e.planilha, q1), daPlanilha(e.planilha, q2));
    const sistema = tres(
      doMotor(e.motor, reconciliacao.mapas.get(1), q1),
      doMotor(e.motor, reconciliacao.mapas.get(2), q2),
    );
    const diferenca = subtrair(sistema, planilha);
    const { status, causa } = classificar(e, planilha, sistema, diferenca, jaClassificadas);

    const montada: LinhaDaMatriz = {
      linhaNaPlanilha: e.linhaNaPlanilha,
      chave: e.chave,
      rotulo: e.rotulo,
      quadro: e.quadro,
      celulas: `AI${e.linhaNaPlanilha} / AJ${e.linhaNaPlanilha} / AK${e.linhaNaPlanilha}`,
      fonteOperacional: e.fonteOperacional,
      regraNoSistema: e.regraNoSistema,
      formulaDaPlanilha: e.formulaDaPlanilha,
      planilha,
      sistema,
      diferenca,
      status,
      causa,
    };
    jaClassificadas.set(e.chave, montada);
    return montada;
  });

  const placar: Record<StatusDaLinha, number> = {
    REPRODUZIDA: 0,
    DIVERGENCIA_JUSTIFICADA_PLANILHA: 0,
    DIVERGENCIA_DO_MOTOR: 0,
    FONTE_NAO_DISPONIVEL: 0,
    NAO_SE_APLICA: 0,
  };
  for (const l of linhas) placar[l.status] += 1;

  const doGabarito = fechamento.quinzenas
    .map((q) => ({
      quinzena: q.quinzena,
      itens: insumosDoGabarito(q.procedencia ?? TUDO_DO_GABARITO),
    }))
    .filter((q) => q.itens.length > 0);

  return {
    competencia: fechamento.competencia,
    arquivo: fechamento.arquivo,
    modo,
    linhas,
    placar,
    insumos: { pontaAPonta: doGabarito.length === 0, doGabarito },
  };
}

/** Quantas linhas o `RESUMO GERAL` tem — o denominador da cobertura. */
export const LINHAS_DO_RESUMO_GERAL = CATALOGO.length;

const brl = (n: number | null) =>
  n === null
    ? "—"
    : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A matriz em Markdown, para colar num relatório sem reformatar. */
export function matrizEmMarkdown(m: MatrizDaReconciliacao): string {
  const saida: string[] = [];
  saida.push(`### Matriz completa — ${m.competencia} — modo \`${m.modo}\``);
  saida.push("");
  saida.push(
    "| # | Linha | 1ª quinzena | 2ª quinzena | Total | Fonte operacional | Status |",
  );
  saida.push("|---:|---|---:|---:|---:|---|---|");
  for (const l of m.linhas) {
    saida.push(
      `| ${l.linhaNaPlanilha} | ${l.rotulo} | ${brl(l.sistema.primeira)} | ` +
        `${brl(l.sistema.segunda)} | ${brl(l.sistema.total)} | ${l.fonteOperacional} | ` +
        `${l.status} |`,
    );
  }
  saida.push("");
  saida.push("#### Contra a planilha");
  saida.push("");
  saida.push(
    "| # | Linha | Planilha 1ª | Sistema 1ª | Dif 1ª | Planilha 2ª | Sistema 2ª | Dif 2ª | Fórmula da planilha |",
  );
  saida.push("|---:|---|---:|---:|---:|---:|---:|---:|---|");
  for (const l of m.linhas) {
    saida.push(
      `| ${l.linhaNaPlanilha} | ${l.rotulo} | ${brl(l.planilha.primeira)} | ${brl(l.sistema.primeira)} | ` +
        `${brl(l.diferenca.primeira)} | ${brl(l.planilha.segunda)} | ${brl(l.sistema.segunda)} | ` +
        `${brl(l.diferenca.segunda)} | \`${l.formulaDaPlanilha}\` |`,
    );
  }
  saida.push("");
  saida.push(
    `**Placar por status** — reproduzidas: ${m.placar.REPRODUZIDA} · ` +
      `divergência justificada (planilha): ${m.placar.DIVERGENCIA_JUSTIFICADA_PLANILHA} · ` +
      `divergência do motor: ${m.placar.DIVERGENCIA_DO_MOTOR} · ` +
      `fonte não disponível: ${m.placar.FONTE_NAO_DISPONIVEL} · ` +
      `não se aplica: ${m.placar.NAO_SE_APLICA} · ` +
      `total: ${m.linhas.length}`,
  );
  saida.push("");
  if (m.insumos.pontaAPonta) {
    saida.push(
      "**Prova ponta a ponta.** Todos os insumos vieram dos relatórios importados e do " +
        "cadastro do sistema; a `.xlsb` entrou só como gabarito.",
    );
  } else {
    saida.push(
      "**Esta NÃO é a prova ponta a ponta.** O motor rodou sobre insumos do próprio " +
        "gabarito, o que responde *dadas as mesmas entradas, o motor chega ao mesmo " +
        "resultado?* — e não *os relatórios importados mais o cadastro chegam lá?*. " +
        "Ainda saem da planilha:",
    );
    for (const q of m.insumos.doGabarito) {
      saida.push(`- ${q.quinzena}ª quinzena: ${q.itens.join("; ")}.`);
    }
  }

  const comCausa = m.linhas.filter((l) => l.causa);
  if (comCausa.length > 0) {
    saida.push("");
    saida.push("#### A causa de cada linha que não é `REPRODUZIDA`");
    saida.push("");
    for (const l of comCausa) {
      saida.push(`- **${l.rotulo}** (${l.status}) — ${l.causa}`);
      const pendente = DECISOES_PENDENTES[l.chave];
      if (pendente) {
        saida.push(`  - *decisão pendente:* ${pendente.pergunta}`);
        saida.push(`  - *o que resolve:* ${pendente.resolve}`);
      }
    }
  }
  return saida.join("\n");
}
