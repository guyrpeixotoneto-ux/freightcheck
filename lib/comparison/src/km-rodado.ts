/**
 * Km Rodado — o comportamento da quilometragem contratada, por vigência.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo mede, e o que ele recusa medir
 * ---------------------------------------------------------------------------
 * Ele lê **km contratado**: o que a tabela de frete declara para cada trecho
 * numa vigência. Não é hodômetro, não é GPS e não é telemetria — nada disso
 * existe neste acervo, e chamar o contratado de realizado seria a mesma
 * confusão que `docs/DICIONARIO-TABELA-DE-FRETE.md` adverte sobre planejado e
 * realizado. Toda frase da tela diz "contratado" por isso.
 *
 * O grão é o do próprio export: uma linha por (trecho, capacidade, vigência).
 * `kmRodado` é o km do **ciclo** — ida mais volta —, e é o que o dicionário
 * chama de "o denominador de todos os R$/km e o multiplicador de todos os
 * R$/viagem". Ele não é dinheiro; é o que multiplica o dinheiro.
 *
 * ---------------------------------------------------------------------------
 * As fórmulas, e onde elas foram conferidas
 * ---------------------------------------------------------------------------
 * Nenhuma delas foi inventada aqui. As três primeiras foram medidas contra o
 * export real da vigência `EMPURRADA_1_9_2026` (2.497 trechos, 6 unidades, 2
 * operadores) e reproduzem o arquivo linha a linha:
 *
 *   kmRodado             = kmIda + kmVolta                       2.497 / 2.497
 *   tempoTrajetoMinuto   = kmRodado ÷ velocidadeMediaKmH × 60     2.497 / 2.497
 *   kmRodadoMesPorEquipe = kmRodado × previsaoViagens × diasMes   2.436 / 2.497
 *
 * A terceira "erra" em 61 linhas, e o erro não é da fórmula: `previsaoViagens`
 * sai do export arredondado a duas casas, e 0,13 no lugar de 0,126 desloca a
 * projeção em até 3%. Por isso {@link conferirProjecaoMensal} não compara com
 * tolerância fixa — ela reconstrói a faixa que o arredondamento admite e só
 * acusa o que cai fora dela. Um teste prende as duas pontas.
 *
 * A segunda fórmula tem uma consequência que a tela precisa dizer em voz alta:
 * **`velocidadeMediaKmH` não é medição.** Ela é parâmetro de entrada — 60 na
 * quase totalidade das linhas — e é ela que *produz* o tempo de trajeto, e não
 * o contrário. Um módulo de velocidade média construído sobre ela mostraria o
 * número que alguém digitou, não o que a operação andou.
 *
 * ---------------------------------------------------------------------------
 * A identidade do trecho, e os 65 km que ela salva
 * ---------------------------------------------------------------------------
 * `lib/ingest/src/tipos.ts` identifica TRECHO por `chaveTrecho`. No export real
 * essa chave **repete**: 2.326 valores distintos para 2.497 linhas. Das 171
 * linhas que ela colapsa, 86 são duplicata inofensiva — mesma linha, mesmo km —
 * e **65 grupos carregam km diferente entre si**. Esses 65 são perda: uma das
 * linhas sobrescreve a outra em silêncio, e o que se perde é uma distância.
 *
 * A causa é que `chaveTrecho` nomeia a unidade por extenso, e o mesmo nome
 * atende CNPJs diferentes. `Unidade - CNPJ` separa 139 dos 147 grupos; os SAP
 * de origem e destino fecham o resto. A identidade deste módulo é, então,
 * {@link chaveDeIdentidade}:
 *
 *     chaveTrecho + Unidade - CNPJ + destino SAP + origem SAP
 *
 * Sobre o arquivo real ela produz 2.492 identidades para 2.497 linhas, **zero
 * conflitos de km**, e 5 colisões que são linhas idênticas byte a byte exceto
 * pelo `_id` — duplicata do próprio export, que {@link deduplicarIdenticos}
 * colapsa com segurança **porque conferiu que são iguais**, e não porque
 * assumiu.
 *
 * As quatro colunas são do export oficial, e isso é requisito e não detalhe. A
 * planilha de trabalho do transportador tem uma coluna `Trecho` — o código TMS,
 * `BR04xBR5Dx29032564.0` — que separaria os mesmos grupos sozinha; ela **não
 * existe no export** que a Ambev manda (as 110 colunas declaradas vão de
 * `Vigencia` a `_id`), e uma identidade que dependesse dela funcionaria na
 * cópia de trabalho e falharia na importação de verdade.
 *
 * `_id` não serve de identidade e nunca serviu: `docs/ARQUITETURA.md` já o
 * classificou como UUID novo a cada export. Ele identifica dentro de um
 * arquivo, não entre vigências.
 *
 * ---------------------------------------------------------------------------
 * O que entra na conta, e o que fica de fora
 * ---------------------------------------------------------------------------
 * O critério de exclusão é um só e está em {@link avaliarTrecho}. Um trecho
 * excluído **não vira zero**: ele sai do numerador e do denominador, e aparece
 * na tabela com o motivo escrito. É a diferença entre "a operação não rodou" e
 * "não sabemos quanto ela rodou", e as duas se parecem num total.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { channelSql, operacaoFilter, type RequestedContext } from "./series";

/** Um trecho como ele sai do canônico — números já convertidos, nulos preservados. */
export interface TrechoKm {
  /** `entity.id` — a ponta da trilha até a célula que originou cada número. */
  entityId: string;
  /** `chaveTrecho` (`UNIDADE_DESTINO_CAPACIDADE_false`). A âncora da identidade. */
  chaveTrecho: string | null;
  /** O CNPJ da unidade — separa dois CDDs que a chave chama pelo mesmo nome. */
  unidadeCnpj: string | null;
  /** Código SAP da origem. Fecha a identidade junto com o do destino. */
  origemSap: string | null;
  /** Código SAP do destino. */
  destinoSap: string | null;
  unidade: string | null;
  operador: string | null;
  regional: string | null;
  origem: string | null;
  destino: string | null;
  /** `Pallets: 28` — como o export escreve. Ver {@link palletsDaCapacidade}. */
  capacidade: string | null;
  kmIda: number | null;
  kmVolta: number | null;
  kmRodado: number | null;
  kmRodadoMesPorEquipe: number | null;
  previsaoViagens: number | null;
  diasMes: number | null;
}

/**
 * Por que um trecho ficou fora da conta.
 *
 * Texto livre não entra aqui de propósito: cada motivo vira uma linha do cartão
 * de descartes na tela, e um motivo que só existe em produção é um cartão que
 * ninguém desenhou.
 */
export type MotivoDeExclusao =
  | "SEM_KM"
  | "KM_NAO_POSITIVO"
  | "CICLO_NAO_FECHA"
  | "SEM_IDENTIDADE";

export const MOTIVOS: Record<MotivoDeExclusao, string> = {
  SEM_KM: "O export não trouxe km para este trecho.",
  KM_NAO_POSITIVO: "Km zero ou negativo — distância não é grandeza negativa, e zero aqui é ausência.",
  CICLO_NAO_FECHA: "kmRodado não é kmIda + kmVolta: as três colunas se contradizem.",
  SEM_IDENTIDADE: "Sem chave de trecho — não há como dizer de que trecho é este km.",
};

/**
 * A tolerância com que o ciclo tem de fechar, em km.
 *
 * Um centésimo de quilômetro é um metro. O export escreve km com duas casas, e
 * somar duas parcelas de duas casas produz erro de no máximo meio centésimo —
 * então esta folga absorve a aritmética de ponto flutuante e nada mais. Ela não
 * é um limiar de negócio: no arquivo real as 2.497 linhas fecham exatamente, e
 * uma que não feche é contradição da fonte, não arredondamento.
 */
export const TOLERANCIA_DO_CICLO_KM = 0.01;

export interface TrechoAvaliado {
  trecho: TrechoKm;
  /** A identidade estável, ou `null` quando o trecho não tem nenhuma. */
  identidade: string | null;
  /** `null` quando o trecho entrou na conta. */
  exclusao: MotivoDeExclusao | null;
  /** O km do ciclo, só quando `exclusao === null`. */
  km: number | null;
  /** |kmIda − kmVolta|, quando as duas pernas existem. Ver {@link resumirAssimetria}. */
  assimetria: number | null;
}

/**
 * O separador das partes da identidade — o "unit separator" do ASCII.
 *
 * Escrito por código, e não como escape no literal, porque um caractere de
 * controle no meio do fonte não sobrevive a uma cópia: ele some no diff, no
 * editor e no navegador. Serve porque nenhuma das quatro colunas pode contê-lo,
 * e é isso que impede `A` + `B\u001fC` de virar a mesma chave que `A\u001fB` + `C`.
 */
const SEPARADOR = String.fromCharCode(31);

/**
 * A identidade de um trecho: chave do trecho, CNPJ da unidade e os dois SAP.
 *
 * A chave do trecho é a âncora — sem ela não há trecho a identificar, e
 * {@link avaliarTrecho} exclui a linha. As outras três qualificam: existem para
 * separar o que a chave junta por homonímia de unidade, e uma ausente entra
 * como vazio em vez de derrubar a identidade inteira. Perder um km por rigor de
 * chave seria trocar um erro por outro.
 */
export function chaveDeIdentidade(t: TrechoKm): string | null {
  const chave = (t.chaveTrecho ?? "").trim();
  if (chave === "") return null;
  const parte = (v: string | null) => (v ?? "").trim();
  return [chave, parte(t.unidadeCnpj), parte(t.destinoSap), parte(t.origemSap)].join(SEPARADOR);
}

/**
 * A chave do trecho **sem** a capacidade — o que permite comparar 28 com 30.
 *
 * `chaveTrecho` é `UNIDADE_DESTINO_CAPACIDADE_false`, e é a capacidade no meio
 * dela que impede o mesmo percurso de se reconhecer entre configurações. Tirar
 * os dois últimos segmentos devolve o percurso, que é o que
 * {@link divergenciaEntreCapacidades} agrupa.
 *
 * Feito por posição, e não por `split("_")`: nome de cliente tem sublinhado, e
 * quebrar pelo separador partiria a chave no lugar errado.
 */
export function percursoDaChave(chaveTrecho: string | null): string | null {
  const chave = (chaveTrecho ?? "").trim();
  if (chave === "") return null;
  const corte = chave.lastIndexOf("_", chave.lastIndexOf("_") - 1);
  return corte <= 0 ? chave : chave.slice(0, corte);
}

/**
 * Quantos pallets a capacidade declara.
 *
 * O export escreve `Pallets: 28` — rótulo colado no valor, a armadilha que
 * `docs/ARQUITETURA.md` cataloga. Devolve `null` para o que não casar, em vez
 * de zero: uma capacidade ilegível não é um caminhão vazio.
 */
export function palletsDaCapacidade(capacidade: string | null): number | null {
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(capacidade ?? "");
  if (m === null) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Decide se o trecho entra na conta, e por que não quando não entra. */
export function avaliarTrecho(t: TrechoKm): TrechoAvaliado {
  const identidade = chaveDeIdentidade(t);
  const base: Omit<TrechoAvaliado, "exclusao" | "km" | "assimetria"> = { trecho: t, identidade };

  const fora = (exclusao: MotivoDeExclusao): TrechoAvaliado => ({
    ...base,
    exclusao,
    km: null,
    assimetria: null,
  });

  if (identidade === null) return fora("SEM_IDENTIDADE");
  if (t.kmRodado === null || !Number.isFinite(t.kmRodado)) return fora("SEM_KM");
  if (t.kmRodado <= 0) return fora("KM_NAO_POSITIVO");

  /*
    O ciclo só é conferido quando as duas pernas vieram. O export sempre as
    traz, mas exigir as três colunas para aceitar a primeira transformaria uma
    ausência de perna em descarte de km — e o km está lá, íntegro, na coluna
    que a tela soma.
  */
  if (t.kmIda !== null && t.kmVolta !== null) {
    const soma = t.kmIda + t.kmVolta;
    if (Math.abs(soma - t.kmRodado) > TOLERANCIA_DO_CICLO_KM) return fora("CICLO_NAO_FECHA");
  }

  const assimetria =
    t.kmIda !== null && t.kmVolta !== null ? Math.abs(t.kmIda - t.kmVolta) : null;

  return { ...base, exclusao: null, km: t.kmRodado, assimetria };
}

/**
 * A conferência da projeção mensal, com a faixa que o arredondamento admite.
 *
 * `previsaoViagens` chega do export com duas casas decimais. Quem escreveu 0,13
 * pode ter querido qualquer coisa em [0,125 ; 0,135), e a projeção mensal que
 * essa faixa produz é um intervalo, não um ponto. Comparar contra o ponto
 * acusaria 61 trechos de erro que não cometeram.
 *
 * Devolve `null` quando falta qualquer das parcelas — não há o que conferir, e
 * "não confere" não é a mesma resposta que "não dá para conferir".
 */
export function conferirProjecaoMensal(t: TrechoKm): { confere: boolean; esperado: [number, number] } | null {
  const { kmRodado, previsaoViagens, diasMes, kmRodadoMesPorEquipe } = t;
  if (
    kmRodado === null ||
    previsaoViagens === null ||
    diasMes === null ||
    kmRodadoMesPorEquipe === null
  ) {
    return null;
  }
  const meio = 0.005;
  const piso = Math.max(0, previsaoViagens - meio) * kmRodado * diasMes;
  const teto = (previsaoViagens + meio) * kmRodado * diasMes;
  const esperado: [number, number] = [Math.min(piso, teto), Math.max(piso, teto)];
  return {
    confere: kmRodadoMesPorEquipe >= esperado[0] - 0.01 && kmRodadoMesPorEquipe <= esperado[1] + 0.01,
    esperado,
  };
}

/**
 * Colapsa linhas que são a mesma linha.
 *
 * Duas linhas com a mesma identidade **e o mesmo km** são o export repetindo-se
 * — aconteceu 5 vezes no arquivo real. Duas com a mesma identidade e km
 * diferente são outra coisa inteiramente: são a contradição que o módulo existe
 * para mostrar, e colapsá-las escolheria um dos dois números em silêncio. Estas
 * ficam, todas, e a tela as marca.
 *
 * Devolve as linhas que sobrevivem e quantas foram colapsadas, porque o número
 * de descartes é parte da cobertura e não pode desaparecer no caminho.
 */
export function deduplicarIdenticos(avaliados: TrechoAvaliado[]): {
  linhas: TrechoAvaliado[];
  colapsadas: number;
  conflitantes: TrechoAvaliado[][];
} {
  const porIdentidade = new Map<string, TrechoAvaliado[]>();
  const semIdentidade: TrechoAvaliado[] = [];
  for (const a of avaliados) {
    if (a.identidade === null) {
      semIdentidade.push(a);
      continue;
    }
    const grupo = porIdentidade.get(a.identidade);
    if (grupo === undefined) porIdentidade.set(a.identidade, [a]);
    else grupo.push(a);
  }

  const linhas: TrechoAvaliado[] = [];
  const conflitantes: TrechoAvaliado[][] = [];
  let colapsadas = 0;

  for (const grupo of porIdentidade.values()) {
    if (grupo.length === 1) {
      linhas.push(grupo[0]!);
      continue;
    }
    const distintos = new Set(grupo.map((a) => (a.km === null ? "∅" : a.km.toFixed(6))));
    if (distintos.size === 1) {
      linhas.push(grupo[0]!);
      colapsadas += grupo.length - 1;
    } else {
      linhas.push(...grupo);
      conflitantes.push(grupo);
    }
  }

  return { linhas: [...linhas, ...semIdentidade], colapsadas, conflitantes };
}

export interface ResumoDeKm {
  /** Quantos trechos entraram na conta. */
  trechos: number;
  /** Quantos o export trouxe, antes de qualquer exclusão. */
  trechosNoExport: number;
  /** trechos ÷ trechosNoExport. `null` quando o export veio vazio. */
  cobertura: number | null;
  /** A soma do km de ciclo. `null` quando nenhum trecho entrou. */
  kmTotal: number | null;
  media: number | null;
  mediana: number | null;
  p90: number | null;
  minimo: number | null;
  maximo: number | null;
  /** Quantos ficaram de fora, por motivo. Zero aparece: o cartão é fixo. */
  excluidos: Record<MotivoDeExclusao, number>;
  /** Linhas idênticas colapsadas — ver {@link deduplicarIdenticos}. */
  colapsadas: number;
}

/**
 * O percentil por posto mais próximo, sem interpolar.
 *
 * Interpolar inventaria um km que nenhum trecho tem, e o valor desta tela é
 * poder clicar no número e achar a linha que o produziu. O posto é o do método
 * mais simples que faz isso: ordena, e devolve o elemento na posição.
 */
export function percentil(ordenados: number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  const posto = Math.ceil((p / 100) * ordenados.length);
  return ordenados[Math.min(Math.max(posto, 1), ordenados.length) - 1] ?? null;
}

export function mediana(ordenados: number[]): number | null {
  if (ordenados.length === 0) return null;
  const meio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 1) return ordenados[meio] ?? null;
  const a = ordenados[meio - 1];
  const b = ordenados[meio];
  return a === undefined || b === undefined ? null : (a + b) / 2;
}

/** O resumo que os cartões da tela mostram — com o denominador sempre junto. */
export function resumirKm(avaliados: TrechoAvaliado[], colapsadas = 0): ResumoDeKm {
  const excluidos: Record<MotivoDeExclusao, number> = {
    SEM_KM: 0,
    KM_NAO_POSITIVO: 0,
    CICLO_NAO_FECHA: 0,
    SEM_IDENTIDADE: 0,
  };
  const kms: number[] = [];
  for (const a of avaliados) {
    if (a.exclusao !== null) excluidos[a.exclusao]++;
    else if (a.km !== null) kms.push(a.km);
  }
  kms.sort((x, y) => x - y);

  const trechosNoExport = avaliados.length + colapsadas;
  const total = kms.length === 0 ? null : kms.reduce((s, k) => s + k, 0);

  return {
    trechos: kms.length,
    trechosNoExport,
    cobertura: trechosNoExport === 0 ? null : kms.length / trechosNoExport,
    kmTotal: total,
    media: total === null ? null : total / kms.length,
    mediana: mediana(kms),
    p90: percentil(kms, 90),
    minimo: kms[0] ?? null,
    maximo: kms[kms.length - 1] ?? null,
    excluidos,
    colapsadas,
  };
}

export interface CorteDeKm {
  /** O valor da dimensão — `null` vira a linha "Sem informação", nunca some. */
  chave: string | null;
  trechos: number;
  kmTotal: number;
  kmMedio: number;
}

/**
 * Km por dimensão — unidade, operador, regional, capacidade.
 *
 * `null` e string vazia viram a mesma linha, rotulada pela tela como "sem
 * informação". Somar essa linha ao resto seria afirmar que o km sem dono é de
 * alguém; escondê-la seria afirmar que ele não existe. Ela aparece, separada.
 */
export function segmentar(
  avaliados: TrechoAvaliado[],
  dimensao: (t: TrechoKm) => string | null,
): CorteDeKm[] {
  const por = new Map<string | null, { trechos: number; kmTotal: number }>();
  for (const a of avaliados) {
    if (a.exclusao !== null || a.km === null) continue;
    const bruta = dimensao(a.trecho);
    const chave = bruta === null || bruta.trim() === "" ? null : bruta.trim();
    const atual = por.get(chave) ?? { trechos: 0, kmTotal: 0 };
    atual.trechos++;
    atual.kmTotal += a.km;
    por.set(chave, atual);
  }
  return [...por.entries()]
    .map(([chave, v]) => ({ chave, trechos: v.trechos, kmTotal: v.kmTotal, kmMedio: v.kmTotal / v.trechos }))
    .sort((a, b) => b.kmTotal - a.kmTotal);
}

export interface AssimetriaDoCiclo {
  /** Trechos em que ida e volta têm a mesma distância. */
  simetricos: number;
  /** Trechos em que elas diferem — rota de retorno diferente, ou erro de cadastro. */
  assimetricos: number;
  /** Sem as duas pernas: não dá para dizer. */
  indeterminados: number;
  /** A maior diferença absoluta observada, em km. */
  maiorDiferenca: number | null;
}

/**
 * Ida contra volta — o comportamento do km que só o ciclo revela.
 *
 * O dicionário já avisa que `kmVolta` "pode diferir da ida por rota, por
 * sinergia (F-MOV) ou por retorno vazio". A tela mostra quantos diferem porque
 * é a pergunta seguinte: um retorno mais longo que a ida é operação, e um
 * retorno **muito** mais longo costuma ser cadastro.
 */
export function resumirAssimetria(avaliados: TrechoAvaliado[]): AssimetriaDoCiclo {
  let simetricos = 0;
  let assimetricos = 0;
  let indeterminados = 0;
  let maiorDiferenca: number | null = null;
  for (const a of avaliados) {
    if (a.exclusao !== null) continue;
    if (a.assimetria === null) {
      indeterminados++;
      continue;
    }
    if (a.assimetria <= TOLERANCIA_DO_CICLO_KM) simetricos++;
    else {
      assimetricos++;
      if (maiorDiferenca === null || a.assimetria > maiorDiferenca) maiorDiferenca = a.assimetria;
    }
  }
  return { simetricos, assimetricos, indeterminados, maiorDiferenca };
}

export interface DivergenciaDeCapacidade {
  percurso: string;
  unidade: string | null;
  destino: string | null;
  /** Uma entrada por capacidade, da menor para a maior. */
  porCapacidade: { capacidade: string | null; pallets: number | null; km: number }[];
  /** maior km − menor km, entre as capacidades deste percurso. */
  amplitude: number;
  /** amplitude ÷ menor km. */
  amplitudeRelativa: number;
}

/**
 * O mesmo percurso, capacidades diferentes, km diferente.
 *
 * É a auditoria que hoje se faz à mão no Excel, e a razão de ela existir é
 * física: a distância entre duas portas não depende de quantos pallets o
 * caminhão leva. Quando depende, uma das linhas está errada — e qual das duas
 * está é decisão de quem negocia, não deste código. O módulo mostra as duas,
 * lado a lado, com a amplitude; não elege vencedor.
 *
 * Só entram percursos com **mais de uma** capacidade: um percurso que só existe
 * em 28 pallets não tem com o que divergir, e listá-lo com amplitude zero
 * encheria a tela de linhas que não dizem nada.
 */
export function divergenciaEntreCapacidades(
  avaliados: TrechoAvaliado[],
): DivergenciaDeCapacidade[] {
  const por = new Map<
    string,
    { unidade: string | null; destino: string | null; capacidades: Map<string, number> }
  >();

  for (const a of avaliados) {
    if (a.exclusao !== null || a.km === null) continue;
    const percurso = percursoDaChave(a.trecho.chaveTrecho);
    if (percurso === null) continue;
    const grupo =
      por.get(percurso) ??
      { unidade: a.trecho.unidade, destino: a.trecho.destino, capacidades: new Map<string, number>() };
    /*
      A mesma capacidade repetida no mesmo percurso guarda o **maior** km. Não é
      preferência: é a única escolha que não esconde a divergência que a tela
      procura — pegar o menor faria um percurso com 20 e 22,98 em 28 pallets
      parecer consistente com um 30 pallets de 20.
    */
    const cap = a.trecho.capacidade ?? "";
    const atual = grupo.capacidades.get(cap);
    if (atual === undefined || a.km > atual) grupo.capacidades.set(cap, a.km);
    por.set(percurso, grupo);
  }

  const saida: DivergenciaDeCapacidade[] = [];
  for (const [percurso, g] of por) {
    if (g.capacidades.size < 2) continue;
    const porCapacidade = [...g.capacidades.entries()]
      .map(([capacidade, km]) => ({
        capacidade: capacidade === "" ? null : capacidade,
        pallets: palletsDaCapacidade(capacidade),
        km,
      }))
      .sort((x, y) => (x.pallets ?? 0) - (y.pallets ?? 0));
    const kms = porCapacidade.map((c) => c.km);
    const menor = Math.min(...kms);
    const maior = Math.max(...kms);
    const amplitude = maior - menor;
    if (amplitude <= TOLERANCIA_DO_CICLO_KM) continue;
    saida.push({
      percurso,
      unidade: g.unidade,
      destino: g.destino,
      porCapacidade,
      amplitude,
      amplitudeRelativa: menor === 0 ? 0 : amplitude / menor,
    });
  }

  return saida.sort((a, b) => b.amplitude - a.amplitude);
}

export interface PanoramaDeKm {
  resumo: ResumoDeKm;
  porUnidade: CorteDeKm[];
  porOperador: CorteDeKm[];
  porCapacidade: CorteDeKm[];
  porRegional: CorteDeKm[];
  assimetria: AssimetriaDoCiclo;
  divergencias: DivergenciaDeCapacidade[];
  /** Grupos de linhas com a mesma identidade e km diferente — contradição da fonte. */
  conflitos: TrechoAvaliado[][];
  /** As linhas que sobreviveram à deduplicação, para a tabela analítica. */
  linhas: TrechoAvaliado[];
}

/**
 * O panorama inteiro, a partir das linhas cruas — uma passagem, sem I/O.
 *
 * Pura de propósito, como `classificarTrecho` no Radar: a regra vive uma vez, o
 * teste a chama sem banco, e o endpoint a chama com o banco. Um total que a
 * tela mostra e um total que o teste confere são o mesmo total porque são a
 * mesma função.
 */
export function montarPanorama(trechos: TrechoKm[]): PanoramaDeKm {
  const avaliados = trechos.map(avaliarTrecho);
  const { linhas, colapsadas, conflitantes } = deduplicarIdenticos(avaliados);
  return {
    resumo: resumirKm(linhas, colapsadas),
    porUnidade: segmentar(linhas, (t) => t.unidade),
    porOperador: segmentar(linhas, (t) => t.operador),
    porCapacidade: segmentar(linhas, (t) => t.capacidade),
    porRegional: segmentar(linhas, (t) => t.regional),
    assimetria: resumirAssimetria(linhas),
    divergencias: divergenciaEntreCapacidades(linhas),
    conflitos: conflitantes,
    linhas,
  };
}

// ---------------------------------------------------------------------------
// A leitura — duas consultas, nenhuma por trecho.
// ---------------------------------------------------------------------------

/**
 * Os atributos que esta tela lê, e nada além deles.
 *
 * A lista é explícita, e não `SELECT *` sobre os 110 do trecho: a consulta
 * varre `fato_visivel`, que é a maior tabela do sistema, e trazer 110 atributos
 * para usar 13 multiplicaria por oito o volume lido sem mudar uma linha da
 * tela. Acrescentar coluna aqui é o passo de quem for acrescentar número lá.
 */
export const CODIGOS_DO_KM = [
  "trecho.chave_trecho",
  "trecho.unidade_cnpj",
  "trecho.unidade_nome",
  "trecho.unidade_regional",
  "trecho.operador_nome",
  "trecho.origem",
  "trecho.origem_sap",
  "trecho.destino",
  "trecho.destino_sap",
  "trecho.capacidade",
  "trecho.km_ida",
  "trecho.km_volta",
  "trecho.km_rodado",
  "trecho.km_rodado_mes_por_equipe",
  "trecho.previsao_viagens",
  "trecho.dias_mes",
] as const;

export interface VigenciaDeTrecho {
  snapshotId: string;
  effectiveDate: string;
  sourceLabel: string;
  scopeHash: string;
  channel: string | null;
}

/**
 * A vigência de trecho que a tela abre — a mais recente do recorte pedido.
 *
 * Mesma resolução de `resolverComparacaoDeTrecho`, e pela mesma razão escrita
 * lá: o dado primeiro, o contexto depois. `listContexts` monta a lista a partir
 * das vigências de **equipamento** e esconde a casca que só traz trecho; boa
 * regra nas telas de cavalo e carreta, exatamente a errada aqui.
 *
 * O que muda é o fim: esta não compara com a anterior. Km Rodado responde
 * "quanto a tabela contrata nesta vigência", e isso não precisa de change-set —
 * a primeira vigência importada é uma resposta legítima, não um 409.
 */
export async function resolverVigenciaDeTrecho(
  db: Database,
  requested?: RequestedContext,
): Promise<VigenciaDeTrecho | null> {
  const escopoPedido = requested?.scopeHash
    ? sql` AND s.scope_hash = ${requested.scopeHash}`
    : sql``;
  const canalPedido =
    requested?.channel !== undefined
      ? sql` AND ${channelSql("s.source_label")} IS NOT DISTINCT FROM ${requested.channel}::text`
      : sql``;
  const daOperacao = sql` AND ${operacaoFilter("s", requested?.operacao)}`;

  const { rows } = await db.execute<{
    id: string;
    effective_date: string;
    source_label: string;
    scope_hash: string;
    channel: string | null;
  }>(sql`
    SELECT s.id,
           s.effective_date::text AS effective_date,
           s.source_label,
           s.scope_hash,
           ${channelSql("s.source_label")} AS channel
      FROM snapshot s
      JOIN fato_visivel f ON f.snapshot_id = s.id
      JOIN entity e       ON e.id = f.entity_id
     WHERE e.entity_type = 'TRECHO'
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (
             SELECT 1 FROM import_run
              WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL
           )${escopoPedido}${canalPedido}${daOperacao}
     ORDER BY s.effective_date DESC, s.scope_hash
     LIMIT 1
  `);

  const achada = rows[0];
  if (!achada) return null;
  return {
    snapshotId: achada.id,
    effectiveDate: achada.effective_date,
    sourceLabel: achada.source_label,
    scopeHash: achada.scope_hash,
    channel: achada.channel,
  };
}

/**
 * Os trechos de uma vigência, já no grão que {@link montarPanorama} consome.
 *
 * Uma varredura só, pivotada em memória. O formato longo do canônico — uma
 * linha por (entidade, atributo) — é o que permite os 110 atributos existirem
 * sem 110 colunas; o preço é que a leitura larga precisa girar o resultado, e o
 * lugar de girar é aqui, uma vez, e não em cada função que usa o número.
 *
 * `value_numeric` é `NUMERIC(18,6)` e chega como string do driver. `Number()`
 * nela é seguro na faixa do km — milhões, não centavos de trilhão —, e é o
 * mesmo que as outras leituras fazem.
 */
export async function lerTrechosDaVigencia(
  db: Database,
  snapshotId: string,
): Promise<TrechoKm[]> {
  const { rows } = await db.execute<{
    entity_id: string;
    code: string;
    value_numeric: string | null;
    value_text: string | null;
    is_null: boolean;
  }>(sql`
    SELECT f.entity_id::text AS entity_id,
           a.code,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.is_null
      FROM fato_visivel f
      JOIN entity e    ON e.id = f.entity_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
       AND e.entity_type = 'TRECHO'
       AND a.code IN (${sql.join(
         CODIGOS_DO_KM.map((c) => sql`${c}`),
         sql`, `,
       )})
  `);

  const porEntidade = new Map<string, TrechoKm>();
  const vazio = (entityId: string): TrechoKm => ({
    entityId,
    chaveTrecho: null,
    unidadeCnpj: null,
    origemSap: null,
    destinoSap: null,
    unidade: null,
    operador: null,
    regional: null,
    origem: null,
    destino: null,
    capacidade: null,
    kmIda: null,
    kmVolta: null,
    kmRodado: null,
    kmRodadoMesPorEquipe: null,
    previsaoViagens: null,
    diasMes: null,
  });

  for (const linha of rows) {
    const t = porEntidade.get(linha.entity_id) ?? vazio(linha.entity_id);
    /*
      `is_null` é a ausência declarada, com motivo gravado — não é zero e não é
      string vazia. Ela fica como `null` no grão da tela, que é o que faz o
      trecho cair em SEM_KM em vez de entrar somando nada.
    */
    if (!linha.is_null) {
      const n = linha.value_numeric === null ? null : Number(linha.value_numeric);
      const s = linha.value_text;
      switch (linha.code) {
        case "trecho.chave_trecho": t.chaveTrecho = s; break;
        case "trecho.unidade_cnpj": t.unidadeCnpj = s; break;
        case "trecho.unidade_nome": t.unidade = s; break;
        case "trecho.unidade_regional": t.regional = s; break;
        case "trecho.operador_nome": t.operador = s; break;
        case "trecho.origem": t.origem = s; break;
        case "trecho.origem_sap": t.origemSap = s; break;
        case "trecho.destino": t.destino = s; break;
        case "trecho.destino_sap": t.destinoSap = s; break;
        case "trecho.capacidade": t.capacidade = s; break;
        case "trecho.km_ida": t.kmIda = n; break;
        case "trecho.km_volta": t.kmVolta = n; break;
        case "trecho.km_rodado": t.kmRodado = n; break;
        case "trecho.km_rodado_mes_por_equipe": t.kmRodadoMesPorEquipe = n; break;
        case "trecho.previsao_viagens": t.previsaoViagens = n; break;
        case "trecho.dias_mes": t.diasMes = n; break;
      }
    }
    porEntidade.set(linha.entity_id, t);
  }

  return [...porEntidade.values()];
}

/** O recorte que a tela pede, e que o servidor aplica — nunca o cliente. */
export interface FiltrosDeKm {
  unidade?: string;
  operador?: string;
  capacidade?: string;
  regional?: string;
}

/**
 * O filtro, aplicado sobre os trechos já lidos.
 *
 * Em memória, e não em SQL, e a razão é o tamanho: uma vigência tem milhares de
 * trechos, não milhões, e a varredura que os traz é a mesma com ou sem filtro.
 * Filtrar no SQL trocaria uma consulta por quatro variantes dela, e a cobertura
 * — que precisa do denominador **antes** do filtro para dizer o que ficou de
 * fora — teria de ser uma quinta.
 *
 * Igualdade exata, sem `LIKE`: os valores vêm da própria lista que a tela
 * ofereceu, montada do mesmo acervo. Um filtro por substring casaria "CAMAÇARI"
 * com uma unidade que só tem o nome dentro do dela.
 */
export function aplicarFiltros(trechos: TrechoKm[], filtros: FiltrosDeKm): TrechoKm[] {
  const bate = (valor: string | null, pedido: string | undefined) =>
    pedido === undefined || pedido === "" || (valor ?? "").trim() === pedido.trim();
  return trechos.filter(
    (t) =>
      bate(t.unidade, filtros.unidade) &&
      bate(t.operador, filtros.operador) &&
      bate(t.capacidade, filtros.capacidade) &&
      bate(t.regional, filtros.regional),
  );
}

/** Os valores que os seletores da tela oferecem — só o que o acervo tem. */
export interface OpcoesDeFiltro {
  unidades: string[];
  operadores: string[];
  capacidades: string[];
  regionais: string[];
}

export function opcoesDeFiltro(trechos: TrechoKm[]): OpcoesDeFiltro {
  const colher = (f: (t: TrechoKm) => string | null) =>
    [...new Set(trechos.map(f).filter((v): v is string => v !== null && v.trim() !== ""))].sort(
      (a, b) => a.localeCompare(b, "pt-BR", { numeric: true }),
    );
  return {
    unidades: colher((t) => t.unidade),
    operadores: colher((t) => t.operador),
    capacidades: colher((t) => t.capacidade),
    regionais: colher((t) => t.regional),
  };
}
