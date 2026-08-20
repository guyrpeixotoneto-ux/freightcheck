import type { Competencia, ResumoDeApuracao } from "@/lib/fechamento";
import { periodosDoAno, type PeriodoDaQuinzena } from "./calendario";

/**
 * A aritmética da Visão Gerencial — o fechamento visto de cima.
 *
 * A Visão Gerencial é a home do ambiente, e a home é a tela que responde antes
 * de perguntar: quem a abre não escolheu nada e mesmo assim recebe um
 * percentual por unidade. Isso a torna, aqui, o que a Visão geral é na
 * Auditoria — o pior lugar do produto para um número errado, porque ele será
 * lido primeiro, por quem tem menos contexto, e repetido numa reunião antes de
 * alguém abrir o detalhe. Daí as regras que valem para tudo o que está neste
 * arquivo:
 *
 * 1. **Nada aqui recompõe remuneração.** `emitido`, `naoConferido` e
 *    `aQuestionar` são o que a apuração gravou quando rodou, somados por
 *    unidade e nada mais — a mesma soma que a tela de Apurações já faz por
 *    quinzena. A conta continua morando no servidor; ver o cabeçalho de
 *    `lib/fechamento.ts`.
 * 2. **Percentual sobre denominador vazio é `null`, nunca zero.** Uma unidade
 *    sem competência no ano não está com 0% de fechamento: ela não tem
 *    fechamento nenhum a medir, e o cartão diz isso em palavras em vez de
 *    desenhar uma barra vazia que se lê como fracasso.
 * 3. **O calendário é fato, o resto é registro.** As 24 quinzenas do ano
 *    existem no calendário quer haja competência ou não, e é por isso que a
 *    grade do ano nasce completa: a quinzena que passou sem competência aberta
 *    é a informação mais importante que esta tela tem para dar, e ela só
 *    aparece se houver uma casa vazia esperando por ela.
 *
 * **Por que a quinzena é remontada na interface.** O período (1 a 15, 16 ao fim
 * do mês) é a mesma regra de `@workspace/fechamento/periodo`, e ela não é
 * importada de lá de propósito: o bundle da interface não carrega o motor de
 * apuração, pela razão escrita no cabeçalho de `lib/fechamento.ts`. O que se
 * duplica é aritmética de calendário — não remuneração —, e o teste
 * `fechamento-gerencial.test.ts` prende as duas ao mesmo resultado. A conta
 * mora em `lib/calendario.ts` e continua saindo daqui, logo abaixo.
 */

/*
  O calendário mora em `lib/calendario.ts` desde que a Visão Gerencial da
  Auditoria passou a montar o ano da unidade pela mesma régua — os nomes dos
  meses, o dia de hoje e as 24 quinzenas. O que é aritmética de calendário não
  é de nenhum dos dois ambientes, e duas cópias dela seriam duas faixas do ano
  que podem discordar sem que o compilador perceba.

  Continuam saindo daqui para quem já os importava deste arquivo: a extração não
  é motivo para uma tela do Fechamento trocar de endereço.
*/
export {
  emDiaCurto,
  hojeEm,
  MES_CURTO,
  MES_LONGO,
  mesPorExtenso,
  periodoDaQuinzena,
  periodosDoAno,
  type PeriodoDaQuinzena,
} from "./calendario";

/** Uma parte pelo nome que ela tem, ou pelo código quando não tem nome. */
export const nomeDaParte = (p: { codigo: string; nome: string | null }): string =>
  p.nome ?? p.codigo;

/**
 * Em que pé está uma quinzena do ano, para uma unidade.
 *
 * Cinco situações, e a diferença entre as duas últimas é a que dá valor à
 * grade: uma quinzena que passou sem competência aberta (`SEM_COMPETENCIA`) é
 * trabalho que ninguém começou; uma que ainda não venceu (`FUTURA`) é o
 * calendário seguindo o seu curso. Pintá-las igual transformaria dezembro
 * inteiro em alarme falso todo mês de janeiro.
 */
export type SituacaoDaQuinzena =
  | "ENCERRADA"
  | "VENCIDA"
  | "EM_CURSO"
  | "SEM_COMPETENCIA"
  | "FUTURA";

export const NOME_DA_SITUACAO: Record<SituacaoDaQuinzena, string> = {
  ENCERRADA: "Encerrada",
  VENCIDA: "Vencida em aberto",
  EM_CURSO: "Em curso",
  SEM_COMPETENCIA: "Sem competência",
  FUTURA: "A vencer",
};

/** O que cada situação quer dizer, na frase que a legenda usa. */
export const EXPLICACAO_DA_SITUACAO: Record<SituacaoDaQuinzena, string> = {
  ENCERRADA: "A quinzena foi conferida, aprovada e congelada — o fechamento aconteceu.",
  VENCIDA: "A quinzena já terminou e a competência continua sem encerrar. É o que atrasa.",
  EM_CURSO: "A competência está aberta e a quinzena ainda está correndo.",
  SEM_COMPETENCIA: "A quinzena terminou e nenhuma competência foi aberta para ela.",
  FUTURA: "A quinzena ainda não terminou e não há competência aberta.",
};

export interface QuinzenaDoAno extends PeriodoDaQuinzena {
  /** As competências da unidade nesta quinzena — uma por transportadora. */
  competencias: ResumoDeApuracao[];
  situacao: SituacaoDaQuinzena;
  encerradas: number;
  apuradas: number;
  emitido: number;
  naoConferido: number;
  aQuestionar: number;
  aQuestionarQuantidade: number;
}

/**
 * Quanto do emitido a apuração conseguiu sustentar, em porcentagem.
 *
 * `naoConferido` é a parte do CT-e emitido que nenhuma das fontes da quinzena
 * explica; o conferido é o resto. Devolve `null` quando não houve emissão
 * alguma — `0/0` não é 100% conferido nem 0%, é um período sem o que conferir,
 * e desenhar uma barra cheia ali seria mentir por arredondamento.
 */
export function percentualConferido(a: { emitido: number; naoConferido: number }): number | null {
  if (a.emitido <= 0) return null;
  return ((a.emitido - a.naoConferido) / a.emitido) * 100;
}

/** A competência já venceu — a quinzena dela terminou antes de hoje. */
function venceu(c: Competencia, diaDeHoje: string): boolean {
  return c.fim < diaDeHoje;
}

function situacaoDa(
  competencias: ResumoDeApuracao[],
  periodo: PeriodoDaQuinzena,
  diaDeHoje: string,
): SituacaoDaQuinzena {
  const passou = periodo.fim < diaDeHoje;
  if (competencias.length === 0) return passou ? "SEM_COMPETENCIA" : "FUTURA";
  if (competencias.every((l) => l.competencia.estado === "ENCERRADA")) return "ENCERRADA";
  return passou ? "VENCIDA" : "EM_CURSO";
}

/**
 * As 24 quinzenas do ano com o que cada uma tem dentro.
 *
 * A grade nasce completa e depois recebe as competências, e não o contrário:
 * montá-la a partir do que existe faria as quinzenas sem competência
 * desaparecerem da tela, que é exatamente o buraco que esta grade existe para
 * mostrar. É a mesma decisão da grade de dias da competência — o dia sem
 * operação aparece, apagado, em vez de sumir.
 */
export function quinzenasDoAno(
  linhas: ResumoDeApuracao[],
  ano: number,
  diaDeHoje: string,
): QuinzenaDoAno[] {
  const porChave = new Map<string, ResumoDeApuracao[]>();
  for (const linha of linhas) {
    if (linha.competencia.ano !== ano) continue;
    const chave = linha.competencia.chave;
    const lista = porChave.get(chave);
    if (lista) lista.push(linha);
    else porChave.set(chave, [linha]);
  }

  return periodosDoAno(ano).map((periodo) => {
    const competencias = porChave.get(periodo.chave) ?? [];
    const quinzena: QuinzenaDoAno = {
      ...periodo,
      competencias,
      situacao: situacaoDa(competencias, periodo, diaDeHoje),
      encerradas: competencias.filter((l) => l.competencia.estado === "ENCERRADA").length,
      apuradas: 0,
      emitido: 0,
      naoConferido: 0,
      aQuestionar: 0,
      aQuestionarQuantidade: 0,
    };
    for (const { apuracao } of competencias) {
      if (!apuracao) continue;
      quinzena.apuradas += 1;
      quinzena.emitido += apuracao.emitido;
      quinzena.naoConferido += apuracao.naoConferido;
      quinzena.aQuestionar += apuracao.aQuestionar;
      quinzena.aQuestionarQuantidade += apuracao.aQuestionarQuantidade;
    }
    return quinzena;
  });
}

export interface ResumoDaUnidade {
  codigo: string;
  nome: string | null;
  /** As transportadoras que atenderam a unidade no ano, em ordem alfabética. */
  transportadoras: string[];
  /** As 24 quinzenas do ano, de janeiro a dezembro. */
  quinzenas: QuinzenaDoAno[];
  competencias: number;
  encerradas: number;
  apuradas: number;
  /** Competências de quinzena já vencida que continuam sem encerrar. */
  vencidas: number;
  /** Competências cuja quinzena ainda está correndo. */
  emCurso: number;
  /** Quinzenas já vencidas do ano em que nenhuma competência foi aberta. */
  lacunas: number;
  emitido: number;
  naoConferido: number;
  aQuestionar: number;
  aQuestionarQuantidade: number;
  /**
   * Quanto das competências do ano já foi encerrado, em porcentagem.
   *
   * Sempre um número, e não `number | null` como no resumo do ano inteiro: a
   * unidade só aparece nesta lista porque tem competência, então o denominador
   * nunca é zero. Um `null` aqui obrigaria a tela a desenhar um caso que não
   * existe.
   */
  percentualEncerrado: number;
}

/**
 * Uma linha por unidade, com o ano inteiro dentro.
 *
 * **O denominador do percentual é a competência, e não a quinzena do
 * calendário.** "Fechamento realizado" conta sobre o fechamento que existe
 * como registro: uma unidade com 12 competências no ano e 7 encerradas está em
 * 58%, mesmo que o ano tenha 24 quinzenas. Dividir por 24 daria um número
 * menor e mais alarmante que também seria falso — o sistema não sabe se a
 * unidade deveria ter operado em janeiro, e uma unidade que começou em julho
 * apareceria eternamente reprovada por um passado que não é dela.
 *
 * O que o calendário tem a dizer não se perde: ele vira `lacunas`, contado
 * apenas nas quinzenas que **já venceram**, e a grade do ano mostra cada uma
 * pelo nome. Duas informações separadas, cada uma com o seu denominador, em vez
 * de uma só que mistura as duas e não responde nenhuma.
 *
 * **A ordem é a do trabalho que falta**, e não a alfabética: primeiro quem tem
 * mais quinzena vencida em aberto, depois quem tem mais lacuna, e só então o
 * nome. É a mesma regra dos contadores da lateral — destaque para o que tem
 * fila atrás.
 */
export function resumirUnidades(
  linhas: ResumoDeApuracao[],
  ano: number,
  diaDeHoje: string,
): ResumoDaUnidade[] {
  const porUnidade = new Map<string, ResumoDeApuracao[]>();
  for (const linha of linhas) {
    if (linha.competencia.ano !== ano) continue;
    const codigo = linha.competencia.unidade.codigo;
    const lista = porUnidade.get(codigo);
    if (lista) lista.push(linha);
    else porUnidade.set(codigo, [linha]);
  }

  const unidades = [...porUnidade].map(([codigo, daUnidade]) => {
    const quinzenas = quinzenasDoAno(daUnidade, ano, diaDeHoje);
    const resumo: ResumoDaUnidade = {
      codigo,
      // O nome mais recente que a unidade recebeu: a lista chega do servidor da
      // quinzena mais nova para a mais antiga, e uma unidade renomeada deve
      // aparecer pelo nome de agora.
      nome: daUnidade.find((l) => l.competencia.unidade.nome !== null)?.competencia.unidade.nome
        ?? null,
      transportadoras: [
        ...new Set(daUnidade.map((l) => nomeDaParte(l.competencia.transportadora))),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
      quinzenas,
      competencias: daUnidade.length,
      encerradas: 0,
      apuradas: 0,
      vencidas: 0,
      emCurso: 0,
      lacunas: quinzenas.filter((q) => q.situacao === "SEM_COMPETENCIA").length,
      emitido: 0,
      naoConferido: 0,
      aQuestionar: 0,
      aQuestionarQuantidade: 0,
      percentualEncerrado: 0,
    };

    for (const { competencia, apuracao } of daUnidade) {
      if (competencia.estado === "ENCERRADA") resumo.encerradas += 1;
      else if (venceu(competencia, diaDeHoje)) resumo.vencidas += 1;
      else resumo.emCurso += 1;
      if (apuracao) {
        resumo.apuradas += 1;
        resumo.emitido += apuracao.emitido;
        resumo.naoConferido += apuracao.naoConferido;
        resumo.aQuestionar += apuracao.aQuestionar;
        resumo.aQuestionarQuantidade += apuracao.aQuestionarQuantidade;
      }
    }

    resumo.percentualEncerrado = (resumo.encerradas / resumo.competencias) * 100;
    return resumo;
  });

  return unidades.sort(
    (a, b) =>
      b.vencidas - a.vencidas ||
      b.lacunas - a.lacunas ||
      nomeDaParte(a).localeCompare(nomeDaParte(b), "pt-BR"),
  );
}

export interface ResumoExecutivo {
  unidades: number;
  competencias: number;
  encerradas: number;
  vencidas: number;
  emCurso: number;
  lacunas: number;
  apuradas: number;
  emitido: number;
  naoConferido: number;
  aQuestionar: number;
  aQuestionarQuantidade: number;
  /** Nulo quando não há competência no ano. Nulo não é zero. */
  percentualEncerrado: number | null;
  /** Nulo quando não houve emissão no ano — `0/0` não é 0% conferido. */
  percentualConferido: number | null;
}

/** O ano inteiro numa linha só — a faixa que abre a Visão Gerencial. */
export function resumoExecutivo(unidades: ResumoDaUnidade[]): ResumoExecutivo {
  const total: ResumoExecutivo = {
    unidades: unidades.length,
    competencias: 0,
    encerradas: 0,
    vencidas: 0,
    emCurso: 0,
    lacunas: 0,
    apuradas: 0,
    emitido: 0,
    naoConferido: 0,
    aQuestionar: 0,
    aQuestionarQuantidade: 0,
    percentualEncerrado: null,
    percentualConferido: null,
  };
  for (const u of unidades) {
    total.competencias += u.competencias;
    total.encerradas += u.encerradas;
    total.vencidas += u.vencidas;
    total.emCurso += u.emCurso;
    total.lacunas += u.lacunas;
    total.apuradas += u.apuradas;
    total.emitido += u.emitido;
    total.naoConferido += u.naoConferido;
    total.aQuestionar += u.aQuestionar;
    total.aQuestionarQuantidade += u.aQuestionarQuantidade;
  }
  total.percentualEncerrado =
    total.competencias === 0 ? null : (total.encerradas / total.competencias) * 100;
  total.percentualConferido = percentualConferido(total);
  return total;
}

/**
 * Os anos que têm competência, do mais recente para o mais antigo.
 *
 * Só os anos que existem: oferecer 2025 num banco que começa em 2026 daria uma
 * grade de 24 casas vazias com cara de ano perdido. O seletor da tela nunca
 * leva ao vazio por escolha de quem escolhe — a mesma regra dos filtros de
 * Apurações.
 */
export function anosComCompetencia(linhas: ResumoDeApuracao[]): number[] {
  return [...new Set(linhas.map((l) => l.competencia.ano))].sort((a, b) => b - a);
}
