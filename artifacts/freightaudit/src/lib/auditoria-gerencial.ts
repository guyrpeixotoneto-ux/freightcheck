import { periodosDoAno, quinzenaDaData, type PeriodoDaQuinzena } from "./calendario";

/**
 * A aritmética da Visão Gerencial da Auditoria — o acervo visto de cima.
 *
 * O ambiente tinha o retrato de **uma** unidade numa vigência (a Visão geral) e
 * nenhum retrato do conjunto. Quem responde pela auditoria não pergunta "o que
 * mudou em CAMAÇARI em agosto"; pergunta *quanto do que chegou já foi
 * comparado, em quais unidades, e onde está o que ninguém olhou* — e essa
 * pergunta não tinha tela. Esta é a irmã da Visão Gerencial do Fechamento, com
 * o mesmo formato e outro assunto: lá o eixo é a competência que fecha, aqui é
 * a vigência que chega.
 *
 * Como aquela, esta é uma home: responde antes de alguém escolher qualquer
 * coisa, e por isso é o pior lugar do produto para um número errado — ele será
 * lido primeiro, por quem tem menos contexto, e repetido numa reunião antes de
 * alguém abrir o detalhe. Daí as quatro regras que valem para tudo o que está
 * neste arquivo:
 *
 * 1. **Nada aqui recompara nada.** `alteracoes`, `inconclusivas`, `semPreco` e
 *    `impacto` são o que o motor gravou em `change_set` quando a comparação
 *    rodou, agrupados por unidade e nada mais. A comparação mora no servidor —
 *    ver o cabeçalho de `@workspace/comparison/gerencial`.
 * 2. **Periodicidade nunca soma.** O impacto sai como um mapa por
 *    periodicidade, e ele é somado *dentro* de cada uma. R$/mês e R$/ano são
 *    grandezas diferentes numa vigência e continuam diferentes em cinquenta.
 * 3. **Percentual sobre denominador vazio é `null`, nunca zero.** Uma unidade
 *    cuja única vigência do ano é a primeira da série não está com 0% de
 *    auditoria: ela não tem transição nenhuma a auditar, e o cartão diz isso em
 *    palavras em vez de desenhar uma barra vazia que se lê como fracasso.
 * 4. **Vigência não comparada não é vigência sem alteração.** As duas dariam
 *    zero numa contagem ingênua, e são opostas: uma é "o cliente não mexeu",
 *    a outra é "ninguém olhou". É o mesmo defeito que `garantia.ts` fecha do
 *    lado do servidor, e é a informação mais importante que esta tela tem para
 *    dar.
 *
 * **Por que a quinzena é a casa da faixa.** O ambiente chama a vigência de
 * quinzena — é assim que a aba Impacto põe "cada ativo em cada quinzena" —, e
 * as vigências chegam datadas no início ou no meio do mês. A faixa do ano tem,
 * por isso, as mesmas 24 casas da Visão Gerencial do Fechamento, e cada
 * vigência cai na casa que contém a data dela.
 *
 * **Vigência é toda vigência viva.** A leitura não separa por família de dados:
 * o quadro de pessoal forma vigências próprias na mesma unidade e canal, e o
 * motor as compara entre si como compara as de equipamento. Elas entram aqui
 * pela mesma porta, e a linha de cobertura do cartão diz qual é qual. Escondê-las
 * daria um percentual que descreve parte do acervo com cara de descrever todo
 * ele.
 *
 * **E por que quinzena sem vigência não é alarme.** No Fechamento, a quinzena é
 * uma obrigação do calendário: passou sem competência, alguém está devendo.
 * Aqui não — a fonte publica uma vigência quando muda alguma coisa, e uma
 * quinzena sem publicação é o cadastro parado, não trabalho atrasado. Ela
 * aparece como ausência (casa apagada, contada em `lacunas`) e nunca em
 * vermelho. O vermelho é só de `PENDENTE`: a vigência que chegou e continua sem
 * comparação.
 */

// ---------------------------------------------------------------------------
// O que o servidor devolve
// ---------------------------------------------------------------------------

/**
 * Os tipos abaixo espelham `GET /gerencial/vigencias` — ver
 * `@workspace/comparison/gerencial`, que é quem os produz.
 */
export interface ComparacaoDaVigencia {
  id: string;
  /** `DONE` é o que se pode ler; `PENDING` e `STALE` são pendência, não número. */
  status: string;
  alteracoes: number;
  entrantes: number;
  saintes: number;
  /** As alterações que não puderam ser comparadas com confiança. */
  inconclusivas: number;
  /** Alterações reais cujo impacto o motor não consegue apurar. */
  semPreco: number;
  /** Quantas ficaram fora da soma por dupla contagem. Contagem, não dinheiro. */
  foraDoTotal: number;
  /** O impacto oficial, por periodicidade. Nunca um escalar. */
  impacto: Record<string, number>;
}

export interface ContextoDaVigencia {
  scopeHash: string;
  channel: string | null;
  /** "CAMAÇARI · EMPURRADA" — o mesmo rótulo do seletor de contexto. */
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
}

export interface VigenciaDaAuditoria {
  contexto: ContextoDaVigencia;
  snapshotId: string;
  sourceLabel: string;
  /** `AAAA-MM-DD`. */
  effectiveDate: string;
  entityTypeSet: string;
  ativos: number;
  /** Nula na primeira vigência da série — não há anterior com que comparar. */
  anterior: { snapshotId: string; sourceLabel: string; effectiveDate: string } | null;
  /** Nula quando o par canônico nunca foi comparado. Nula não é zero. */
  comparacao: ComparacaoDaVigencia | null;
}

// ---------------------------------------------------------------------------
// A situação de uma quinzena
// ---------------------------------------------------------------------------

/**
 * Em que pé está a auditoria de uma quinzena do ano, para uma unidade.
 *
 * Cinco situações, e as diferenças entre as três últimas são o que dá valor à
 * faixa. `PENDENTE` é a única que é alarme: a vigência chegou, tem anterior com
 * que ser comparada, e a comparação não existe (ou não está pronta) — é
 * trabalho que ninguém fez. `INICIAL` é a primeira vigência de uma série, que
 * não tem anterior e por isso não pode ser comparada; contá-la como pendência
 * faria toda unidade estrear reprovada. `SEM_VIGENCIA` é a quinzena em que a
 * fonte não publicou nada, que é o cadastro parado e não atraso de ninguém.
 */
export type SituacaoDaAuditoria =
  | "AUDITADA"
  | "PENDENTE"
  | "INICIAL"
  | "SEM_VIGENCIA"
  | "FUTURA";

export const NOME_DA_SITUACAO: Record<SituacaoDaAuditoria, string> = {
  AUDITADA: "Auditada",
  PENDENTE: "Sem comparação",
  INICIAL: "Primeira da série",
  SEM_VIGENCIA: "Sem vigência",
  FUTURA: "A vencer",
};

/** O que cada situação quer dizer, na frase que a legenda usa. */
export const EXPLICACAO_DA_SITUACAO: Record<SituacaoDaAuditoria, string> = {
  AUDITADA: "A vigência chegou e foi comparada com a anterior da série — o que mudou está apurado.",
  PENDENTE: "A vigência chegou e continua sem comparação. É o que ninguém olhou.",
  INICIAL: "A primeira vigência da série; não há anterior com que compará-la.",
  SEM_VIGENCIA: "A quinzena passou e a fonte não publicou vigência nenhuma.",
  FUTURA: "A quinzena ainda não terminou.",
};

/** A comparação está pronta para ser lida — só o que está `DONE` vira número. */
export function estaAuditada(vigencia: VigenciaDaAuditoria): boolean {
  return vigencia.comparacao !== null && vigencia.comparacao.status === "DONE";
}

/**
 * A vigência devia ter comparação e não tem.
 *
 * `STALE` conta como pendente junto com a ausência: a migration que criou o
 * impacto oficial marcou assim toda comparação anterior a ele, e os totais dela
 * são zero. Somá-los seria publicar "nenhuma alteração" sobre uma vigência que
 * ninguém recomparou — exatamente a confusão que a regra 4 do cabeçalho recusa.
 */
export function estaPendente(vigencia: VigenciaDaAuditoria): boolean {
  return vigencia.anterior !== null && !estaAuditada(vigencia);
}

// ---------------------------------------------------------------------------
// O dinheiro
// ---------------------------------------------------------------------------

export interface ImpactoDaPeriodicidade {
  periodicity: string;
  amount: number;
}

/** Soma `origem` em `destino`, dentro de cada periodicidade. Nunca entre elas. */
function acumularImpacto(destino: Record<string, number>, origem: Record<string, number>): void {
  for (const [periodicidade, valor] of Object.entries(origem)) {
    destino[periodicidade] = (destino[periodicidade] ?? 0) + valor;
  }
}

/**
 * O impacto por periodicidade, o maior em módulo primeiro.
 *
 * Por módulo e não por sinal: o que decide a atenção de quem lê é o tamanho do
 * número, e um ano pode muito bem ter o maior movimento a favor.
 */
export function impactosOrdenados(impacto: Record<string, number>): ImpactoDaPeriodicidade[] {
  return Object.entries(impacto)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.periodicity.localeCompare(b.periodicity));
}

/**
 * A periodicidade que manda no cartão — a de maior movimento.
 *
 * O cartão tem espaço para um número, e este é o que ele mostra; as outras
 * continuam existindo e a tela as anuncia ao lado ("+1 periodicidade"). O que
 * não pode acontecer é a segunda sumir: um cartão que mostrasse só o mensal de
 * uma unidade que também tem anual estaria escondendo dinheiro, e é assim que
 * um total falso nasce.
 */
export function impactoDominante(impacto: Record<string, number>): ImpactoDaPeriodicidade | null {
  return impactosOrdenados(impacto)[0] ?? null;
}

// ---------------------------------------------------------------------------
// O ano de uma unidade
// ---------------------------------------------------------------------------

const chaveDoContexto = (c: { scopeHash: string; channel: string | null }): string =>
  `${c.scopeHash}|${c.channel ?? ""}`;

/** O ano de uma vigência, lido da data sem passar por `Date` — o fuso não recua o ano. */
const anoDa = (v: VigenciaDaAuditoria): number => Number(v.effectiveDate.slice(0, 4));

export interface QuinzenaAuditada extends PeriodoDaQuinzena {
  /** As vigências que caíram nesta quinzena — uma por série entregue. */
  vigencias: VigenciaDaAuditoria[];
  situacao: SituacaoDaAuditoria;
  auditadas: number;
  pendentes: number;
  iniciais: number;
  alteracoes: number;
  inconclusivas: number;
  semPreco: number;
  impacto: Record<string, number>;
}

function situacaoDa(
  vigencias: VigenciaDaAuditoria[],
  periodo: PeriodoDaQuinzena,
  diaDeHoje: string,
): SituacaoDaAuditoria {
  const passou = periodo.fim < diaDeHoje;
  if (vigencias.length === 0) return passou ? "SEM_VIGENCIA" : "FUTURA";
  if (vigencias.some(estaPendente)) return "PENDENTE";
  if (vigencias.some(estaAuditada)) return "AUDITADA";
  return "INICIAL";
}

/**
 * As 24 quinzenas do ano com as vigências que caíram em cada uma.
 *
 * A grade nasce completa e depois recebe as vigências, e não o contrário:
 * montá-la a partir do que existe faria as quinzenas sem publicação
 * desaparecerem, e com elas o ritmo do cliente — três quinzenas seguidas sem
 * nada dizem "o cadastro parou" sem que ninguém precise contar datas.
 */
export function quinzenasDoAno(
  linhas: VigenciaDaAuditoria[],
  ano: number,
  diaDeHoje: string,
): QuinzenaAuditada[] {
  const porChave = new Map<string, VigenciaDaAuditoria[]>();
  for (const linha of linhas) {
    if (anoDa(linha) !== ano) continue;
    /*
      A casa é a do calendário, e a chave é montada da própria data: o mês vem
      da string `AAAA-MM-DD` sem passar por `Date`, que no fuso de quem lê
      devolveria o dia 1 como o último dia do mês anterior.
    */
    const chave = `${ano}-${linha.effectiveDate.slice(5, 7)}-Q${quinzenaDaData(linha.effectiveDate)}`;
    const lista = porChave.get(chave);
    if (lista) lista.push(linha);
    else porChave.set(chave, [linha]);
  }

  return periodosDoAno(ano).map((periodo) => {
    const vigencias = porChave.get(periodo.chave) ?? [];
    const quinzena: QuinzenaAuditada = {
      ...periodo,
      vigencias,
      situacao: situacaoDa(vigencias, periodo, diaDeHoje),
      auditadas: vigencias.filter(estaAuditada).length,
      pendentes: vigencias.filter(estaPendente).length,
      iniciais: vigencias.filter((v) => v.anterior === null).length,
      alteracoes: 0,
      inconclusivas: 0,
      semPreco: 0,
      impacto: {},
    };
    for (const vigencia of vigencias) {
      if (!estaAuditada(vigencia)) continue;
      const c = vigencia.comparacao!;
      quinzena.alteracoes += c.alteracoes;
      quinzena.inconclusivas += c.inconclusivas;
      quinzena.semPreco += c.semPreco;
      acumularImpacto(quinzena.impacto, c.impacto);
    }
    return quinzena;
  });
}

export interface ResumoDaUnidade {
  scopeHash: string;
  channel: string | null;
  /** "CAMAÇARI · EMPURRADA" — o contexto inteiro, para o rodapé do cartão. */
  label: string;
  /** Só a unidade, para o título do cartão. */
  nome: string;
  /** As coberturas que a unidade entregou no ano (CAVALO, CARRETA…), em ordem. */
  coberturas: string[];
  /** As 24 quinzenas do ano, de janeiro a dezembro. */
  quinzenas: QuinzenaAuditada[];
  vigencias: number;
  /** As vigências que têm anterior — as que podiam ser comparadas. */
  comparaveis: number;
  auditadas: number;
  pendentes: number;
  /** Vigências sem anterior: a primeira de cada série não se compara. */
  iniciais: number;
  /** Quinzenas já vencidas do ano em que a fonte não publicou nada. */
  lacunas: number;
  alteracoes: number;
  entrantes: number;
  saintes: number;
  inconclusivas: number;
  semPreco: number;
  foraDoTotal: number;
  impacto: Record<string, number>;
  /** A vigência mais recente do ano, e a frota que ela declarou. */
  ultimaVigencia: string | null;
  ativos: number;
  /**
   * Quanto das vigências comparáveis do ano já foi comparado, em porcentagem.
   *
   * `null` quando não houve nenhuma — ver a regra 3 do cabeçalho. Acontece de
   * verdade: uma unidade que estreou neste ano com uma vigência só tem 100% do
   * que era possível auditar feito, e nada auditado; as duas leituras são
   * falsas, e a única frase honesta é "a primeira vigência da série".
   */
  percentualAuditado: number | null;
}

/** O nome da unidade dentro do contexto; sem escopo cadastrado, vale o rótulo. */
export function nomeDaUnidade(contexto: ContextoDaVigencia): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

/**
 * Uma linha por contexto — unidade e canal —, com o ano inteiro dentro.
 *
 * **O cartão é do contexto, e não da unidade sozinha.** Duas séries da mesma
 * unidade em canais diferentes descrevem remunerações que não se sucedem: o
 * motor recusa-se a comparar uma com a outra, e um cartão que as somasse
 * anunciaria um total que o produto não calcula. É a mesma decisão da tela de
 * Unidades, e é por isso que o título do cartão é a unidade e o rodapé é o
 * contexto inteiro.
 *
 * **O denominador do percentual são as vigências comparáveis**, e não as
 * vigências do ano: a primeira de uma série não tem anterior, e dividi-la
 * dentro do total faria uma unidade recém-chegada aparecer eternamente
 * atrasada por uma comparação que não existe. O que ela tem a dizer não se
 * perde — vira `iniciais`, e a faixa mostra a casa pelo nome.
 *
 * **A transição pertence ao ano da vigência nova.** A comparação de janeiro é
 * contra dezembro do ano anterior, e ela conta aqui: a alteração aconteceu
 * quando a vigência de janeiro chegou. Cada transição é contada uma única vez,
 * no ano da ponta de cima.
 *
 * **A ordem é a do trabalho que falta**, e não a alfabética: primeiro quem tem
 * mais vigência sem comparação, depois quem tem mais alteração que a comparação
 * não conseguiu ler, e só então o nome.
 */
export function resumirUnidades(
  linhas: VigenciaDaAuditoria[],
  ano: number,
  diaDeHoje: string,
): ResumoDaUnidade[] {
  const porContexto = new Map<string, VigenciaDaAuditoria[]>();
  for (const linha of linhas) {
    if (anoDa(linha) !== ano) continue;
    const chave = chaveDoContexto(linha.contexto);
    const lista = porContexto.get(chave);
    if (lista) lista.push(linha);
    else porContexto.set(chave, [linha]);
  }

  const unidades = [...porContexto.values()].map((daUnidade) => {
    const contexto = daUnidade[0].contexto;
    const quinzenas = quinzenasDoAno(daUnidade, ano, diaDeHoje);
    const ultimaVigencia = daUnidade
      .map((v) => v.effectiveDate)
      .sort((a, b) => b.localeCompare(a))[0];

    const resumo: ResumoDaUnidade = {
      scopeHash: contexto.scopeHash,
      channel: contexto.channel,
      label: contexto.label,
      nome: nomeDaUnidade(contexto),
      coberturas: [...new Set(daUnidade.map((v) => v.entityTypeSet))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
      quinzenas,
      vigencias: daUnidade.length,
      comparaveis: 0,
      auditadas: 0,
      pendentes: 0,
      iniciais: 0,
      lacunas: quinzenas.filter((q) => q.situacao === "SEM_VIGENCIA").length,
      alteracoes: 0,
      entrantes: 0,
      saintes: 0,
      inconclusivas: 0,
      semPreco: 0,
      foraDoTotal: 0,
      impacto: {},
      ultimaVigencia: ultimaVigencia ?? null,
      /*
        A frota é a que a vigência mais recente do ano declarou, somando as
        séries daquela data — cavalos e carretas chegam em snapshots separados,
        e a frota da unidade é a soma dos dois. Somar todas as vigências do ano
        contaria o mesmo caminhão nove vezes.
      */
      ativos: daUnidade
        .filter((v) => v.effectiveDate === ultimaVigencia)
        .reduce((soma, v) => soma + v.ativos, 0),
      percentualAuditado: null,
    };

    for (const vigencia of daUnidade) {
      if (vigencia.anterior === null) resumo.iniciais += 1;
      else resumo.comparaveis += 1;
      if (estaPendente(vigencia)) resumo.pendentes += 1;
      if (!estaAuditada(vigencia)) continue;
      const c = vigencia.comparacao!;
      resumo.auditadas += 1;
      resumo.alteracoes += c.alteracoes;
      resumo.entrantes += c.entrantes;
      resumo.saintes += c.saintes;
      resumo.inconclusivas += c.inconclusivas;
      resumo.semPreco += c.semPreco;
      resumo.foraDoTotal += c.foraDoTotal;
      acumularImpacto(resumo.impacto, c.impacto);
    }

    resumo.percentualAuditado =
      resumo.comparaveis === 0 ? null : (resumo.auditadas / resumo.comparaveis) * 100;
    return resumo;
  });

  return unidades.sort(
    (a, b) =>
      b.pendentes - a.pendentes ||
      b.inconclusivas - a.inconclusivas ||
      a.nome.localeCompare(b.nome, "pt-BR") ||
      (a.channel ?? "").localeCompare(b.channel ?? "", "pt-BR"),
  );
}

export interface ResumoExecutivo {
  /** Contextos — unidade e canal. É o que os cartões contam. */
  contextos: number;
  /** Unidades distintas por trás deles. Duas séries da mesma unidade são uma unidade. */
  unidades: number;
  vigencias: number;
  comparaveis: number;
  auditadas: number;
  pendentes: number;
  iniciais: number;
  lacunas: number;
  alteracoes: number;
  entrantes: number;
  saintes: number;
  inconclusivas: number;
  semPreco: number;
  foraDoTotal: number;
  impacto: Record<string, number>;
  /** Nulo quando não houve vigência comparável no ano. Nulo não é zero. */
  percentualAuditado: number | null;
}

/** O ano inteiro numa linha só — a faixa que abre a Visão Gerencial. */
export function resumoExecutivo(unidades: ResumoDaUnidade[]): ResumoExecutivo {
  const total: ResumoExecutivo = {
    contextos: unidades.length,
    unidades: new Set(unidades.map((u) => u.scopeHash)).size,
    vigencias: 0,
    comparaveis: 0,
    auditadas: 0,
    pendentes: 0,
    iniciais: 0,
    lacunas: 0,
    alteracoes: 0,
    entrantes: 0,
    saintes: 0,
    inconclusivas: 0,
    semPreco: 0,
    foraDoTotal: 0,
    impacto: {},
    percentualAuditado: null,
  };
  for (const u of unidades) {
    total.vigencias += u.vigencias;
    total.comparaveis += u.comparaveis;
    total.auditadas += u.auditadas;
    total.pendentes += u.pendentes;
    total.iniciais += u.iniciais;
    total.lacunas += u.lacunas;
    total.alteracoes += u.alteracoes;
    total.entrantes += u.entrantes;
    total.saintes += u.saintes;
    total.inconclusivas += u.inconclusivas;
    total.semPreco += u.semPreco;
    total.foraDoTotal += u.foraDoTotal;
    acumularImpacto(total.impacto, u.impacto);
  }
  total.percentualAuditado =
    total.comparaveis === 0 ? null : (total.auditadas / total.comparaveis) * 100;
  return total;
}

/**
 * Os anos que têm vigência, do mais recente para o mais antigo.
 *
 * Só os anos que existem: oferecer 2025 num acervo que começa em 2026 daria uma
 * faixa de 24 casas vazias com cara de ano perdido. O seletor da tela nunca
 * leva ao vazio por escolha de quem escolhe.
 */
export function anosComVigencia(linhas: VigenciaDaAuditoria[]): number[] {
  return [...new Set(linhas.map(anoDa))].sort((a, b) => b - a);
}
