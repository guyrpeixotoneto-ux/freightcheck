import type { Database } from "@workspace/db";
import {
  coberturaComum,
  computeChangeSet,
  formamParDeVigencias,
  frotaDoEquipamento,
  frotaPorTipo,
  getChangeSetForPair,
  listChanges,
  leituraDoImpacto,
  listComparableSnapshots,
  vigenciasQueCobrem,
  type FrotaNoRecorte,
  type Operacao,
} from "@workspace/comparison";

/**
 * O QUE CADA CANDIDATA A "DE" PRODUZ CONTRA O "PARA" ESCOLHIDO.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é um módulo e não um trecho de rota
 * ---------------------------------------------------------------------------
 * Porque a parte difícil não é a consulta — é o **orçamento**, e ele precisa
 * ser um só. Calcular uma comparação nova custa segundos; calcular cinco de uma
 * vez estoura o prazo de qualquer proxy no caminho. A regra que decide o que
 * cabe, o que volta sem número e como o cliente continua de onde parou é
 * sutil, e duas cópias dela envelhecem diferente: no dia em que uma ganhasse um
 * segundo a mais, o FINAME e o IPVA responderiam com fôlegos distintos à mesma
 * pergunta, sem que nada na tela dissesse por quê.
 *
 * O que muda de uma rubrica para outra é só o recorte — quais atributos ler e
 * como contar o que mudou —, e isso entra por parâmetro.
 *
 * ---------------------------------------------------------------------------
 * As três garantias
 * ---------------------------------------------------------------------------
 * **A lista é da mesma unidade e da mesma cobertura.** São as recusas do motor
 * antecipadas (`engine.ts`), e ficam aqui e não na tela: um `para` de Camaçari
 * nunca devolve candidata de Pernambuco, mesmo que alguém monte o endereço à
 * mão.
 *
 * **Nada é recalculado à toa.** `getChangeSetForPair` responde por quem já foi
 * comparado alguma vez; só quem nunca foi passa por `computeChangeSet`. É o
 * mesmo caminho das rotas de comparação, de modo que o número do menu é o mesmo
 * que a tela mostra depois do clique — nunca uma segunda conta.
 *
 * **Quem não coube volta sem número, e isso é dito.** `numeros: null` quer
 * dizer *ainda não sei*, e nunca *zero*. O cliente pede de novo e a rota
 * continua de onde parou, porque o que foi calculado ficou gravado.
 */

/** Quanto tempo esta rota gasta calculando comparações que ainda não existem. */
export const ORCAMENTO_DE_CANDIDATAS_MS = 8_000;

/** O teto de conexão da rota — folgado sobre o orçamento, e bem abaixo do pool. */
export const TETO_DE_CANDIDATAS_MS = 12_000;

/**
 * Um balde de dinheiro de um par — a periodicidade e o líquido dela.
 *
 * Houve aqui um terceiro campo, `natureza`, que separava `CUSTO` de `RECEITA`.
 * Ele existia por um recorte só — o Monitor Custo Fixo, que lê os cinco módulos
 * de uma vez —, e saiu junto com a natureza: as cinco rubricas falam o idioma
 * de quem recebe, positivo é ganho e negativo é perda, e por isso uma
 * periodicidade volta a ter **um** líquido.
 *
 * Continua sendo uma lista, e não um `Record<string, number>`, porque é assim
 * que ela atravessa o JSON dizendo o nome de cada campo — e porque a chave
 * seguiu sendo a periodicidade, que nunca se mistura com outra.
 */
export interface BaldeDoImpacto {
  periodicidade: string;
  valor: number;
  /**
   * De que **régua** é este dinheiro — ausente em quem tem uma só.
   *
   * As dezesseis telas de rubrica não o preenchem, e não têm o que preencher:
   * ali todo balde é da mesma família de custo, e um rótulo repetido em toda
   * linha do menu só roubaria espaço do número.
   *
   * Quem o preenche é o catálogo de Alterações por Módulo, e ali ele é
   * obrigatório pela recusa que `alteracoes-por-modulo.ts` escreve por extenso:
   * custo fixo publica reais do período, custo variável publica razões (R$/km,
   * minutos) que só viram dinheiro multiplicadas por produção, e as duas coisas
   * não somam. Com a periodicidade sozinha por chave, o `MENSAL` de uma cairia
   * no mesmo balde que o `MENSAL` da outra — duas réguas fundidas numa, que é
   * exatamente o "total geral" que aquele arquivo proíbe. O rótulo é o que
   * mantém as linhas separadas na tela e a soma separada aqui.
   */
  rotulo?: string;
}

/**
 * O movimento de um percentual declarado entre as duas vigências — pontos, e
 * nunca dinheiro.
 *
 * Nasceu nos Impostos, e o motivo é do domínio: lá a coluna de dinheiro é `R$
 * 0,00` em toda linha por construção — o montante de ICMS é coluna nunca
 * preenchida e o PIS/COFINS de aquisição é fórmula sobre a nota —, de modo que
 * o menu respondia "nada mudou" a quem pergunta por alíquota. A grandeza que
 * aquela tela audita é o ponto percentual, e é ela que a linha passa a levar.
 *
 * É genérico de propósito, como todo o resto deste módulo: quem o preenche diz
 * o `rotulo` ("ICMS", "PIS/COFINS") e o que ele significa; aqui não há tributo
 * nenhum. A régua de agregação é do chamador, e a dos Impostos está em
 * `movimentoDeAliquotas` — que não soma pontos, publica o maior.
 */
export interface MovimentoDePercentual {
  /** Como a linha chama este percentual — "ICMS", "PIS/COFINS". */
  rotulo: string;
  /** Quantas linhas daquele percentual se moveram no par. */
  alteradas: number;
  /**
   * O maior movimento, em pontos percentuais, com sinal — `null` quando
   * nenhuma das alteradas trouxe medida do motor.
   */
  maior: number | null;
  /** Subiu num item e caiu noutro: o sinal de `maior` não descreve o conjunto. */
  ambasDirecoes: boolean;
}

/**
 * A frota entrando e saindo entre as duas vigências — ativos, nunca variáveis.
 *
 * É a outra metade do que separa duas vigências, e a que a contagem de
 * alterações **não** conta: `alteracoes` são variáveis que se moveram num ativo
 * presente nas duas pontas, e um ativo que entrou ou saiu não move variável
 * nenhuma — ele muda o conjunto sobre o qual toda a conta é feita.
 *
 * Nasceu nos Impostos, e o par março/2026 → agosto/2026 do acervo é o caso
 * inteiro: `0 alterações`, `sem movimento de alíquota` — e R$ 99 mil a menos de
 * PIS/COFINS de carreta no total da tela, porque nove carretas saíram e quatro
 * entraram, sem uma única alíquota se mover. As duas
 * leituras estão certas e falam de coisas diferentes; sem esta terceira, quem lê
 * o menu junta as duas e entende "o imposto não mudou", quando o que se pode
 * afirmar é "nenhum ativo teve o imposto mexido".
 *
 * Genérico como o resto do módulo: quem pede diz o recorte, e aqui não há
 * rubrica nenhuma.
 */
export interface MovimentoDaFrota {
  /** Ativos presentes só na vigência "Para". */
  entraram: number;
  /** Ativos presentes só na candidata a "De". */
  sairam: number;
}

/** Os números de um par, no recorte de quem perguntou. */
export interface NumerosDoPar {
  alteracoes: number;
  impacto: { baldes: BaldeDoImpacto[] };
  /**
   * O movimento dos percentuais declarados — **presente e vazio** quando o
   * recorte os audita e nenhum andou.
   *
   * A distinção entre ausente e vazio é a mesma que `semImpacto` faz do outro
   * lado, e vale pela mesma razão. Ausente quer dizer *este recorte não olha
   * percentual* — é o caso das outras quatro rubricas, cujas linhas do menu
   * seguem exatamente como eram. Vazio quer dizer *olhei as alíquotas e nenhuma
   * se moveu*, que é notícia numa tela de imposto e é escrita por extenso.
   *
   * Tributo que não moveu nada não vira balde: a lista traz só quem andou.
   */
  percentuais?: MovimentoDePercentual[];
  /**
   * O que entrou e o que saiu da frota entre as duas vigências.
   *
   * Opcional pela mesma régua dos percentuais, e com a mesma leitura: **ausente**
   * é o recorte que não pediu a frota (`frotaDoPar`), e a linha dele segue como
   * era; **presente e zerado** é o que pediu e viu a frota parada — que é notícia,
   * e sai escrita, do mesmo jeito que o `R$ 0,00` de uma conta que deu zero.
   */
  frota?: MovimentoDaFrota;
  /**
   * Por que este recorte **não publica dinheiro** — e não "publicou zero".
   *
   * Nasceu com o QLP, onde a recusa é do domínio: as colunas do quadro chegam
   * sem semântica confirmada, e somar o que a curadoria não confirmou seria
   * adivinhação (`SEM_IMPACTO_FINANCEIRO`). Sem este campo, `baldes: []` desceria
   * para a tela e viraria `R$ 0,00` na linha do menu — a tela afirmando que
   * nada mudou de dinheiro numa comparação que nunca mediu dinheiro. É
   * exatamente a mentira por omissão que `numeros: null` evita do outro lado.
   *
   * Ausente, o recorte publica dinheiro e `baldes` vazio quer dizer o que sempre
   * quis: calculei, e deu zero.
   */
  semImpacto?: string;
}

/**
 * O impacto de uma rubrica — `Record<periodicidade, líquido>` — como baldes.
 *
 * Todas as auditorias publicam o impacto nesse formato desde sempre
 * (`impactoPorPeriodicidade` e irmãs). Esta é a tradução de uma ponta à outra,
 * num lugar só, para que elas não escrevam o mesmo `Object.entries` cada uma.
 */
export function baldesDoImpacto(
  porPeriodicidade: Record<string, number>,
): BaldeDoImpacto[] {
  return Object.entries(porPeriodicidade).map(([periodicidade, valor]) => ({
    periodicidade,
    valor,
  }));
}

/**
 * O impacto de um recorte virando o que a linha do menu pode afirmar.
 *
 * Os três estados moram em `@workspace/comparison/politica-do-impacto`, com a
 * razão inteira; esta função é a tradução deles para a forma que a linha do
 * menu tem. Ela desceu para o domínio em 17/09/2026 porque **quatro**
 * superfícies respondem pela mesma comparação — o menu, o cartão de impacto, a
 * tabela e o painel de evolução — e as outras três decidiam sozinhas: o cartão
 * dizia "Sem impacto precificável" enquanto a tabela, logo abaixo, publicava
 * `+R$ 317,07` sem ressalva.
 *
 * **Não há regra por atributo aqui, e não pode haver.** O que decide é
 * `naoPublicadas`, que cada rubrica tira do seu próprio impacto — no seguro, o
 * `naoCalculavel` de `impactoDeSeguro`, que conta as alterações de medida
 * DINHEIRO que o motor recusou precificar.
 */
export function impactoPublicavel(
  porPeriodicidade: Record<string, number>,
  {
    naoPublicadas,
    semImpacto,
  }: {
    /** Alterações monetárias que ficaram sem valor — não zero, sem valor. */
    naoPublicadas: number;
    /** A frase do porquê, da rubrica. Só desce quando é ela que responde. */
    semImpacto: string;
  },
): Pick<NumerosDoPar, "impacto" | "semImpacto"> {
  const baldes = baldesDoImpacto(porPeriodicidade);
  const leitura = leituraDoImpacto(porPeriodicidade, naoPublicadas);
  return leitura.publicaValor ? { impacto: { baldes } } : { impacto: { baldes }, semImpacto };
}

export interface CandidatasDoPar {
  para: string;
  candidatos: { id: string; numeros: NumerosDoPar | null }[];
  /** Quantas candidatas não couberam no orçamento desta chamada. */
  pendentes: number;
}

/** De qual par saíram as linhas — o que o recorte precisa saber além delas. */
export interface ParCalculado {
  /** A candidata a "De". */
  baseId: string;
  /** O "Para" fixado. */
  comparadaId: string;
  changeSetId: string;
  /**
   * A frota do par, já somada no recorte — só para quem pediu (`frotaDoPar`).
   *
   * Vem do motor (`frotaPorTipo`) e não das linhas, pela razão de sempre: um
   * ativo que entrou ou saiu não produz linha de alteração nenhuma, então
   * derivá-lo da lista daria zero exatamente onde há movimento.
   */
  frota?: FrotaNoRecorte;
}

export interface RecorteDaRubrica {
  /** Os atributos que a rubrica lê — `CODIGOS_DO_DETALHE` da rubrica. */
  attributeCodes: readonly string[];
  /**
   * A família de dados de onde saem as candidatas — o acervo de frete, por
   * omissão.
   *
   * Entrou com o QLP, cujas vigências são de outra família
   * (`DATASET_FAMILY_QUADRO_DE_PESSOAL`). Sem isto, a lista viria do acervo de
   * frete e nenhuma candidata formaria par com o "Para" do quadro — um menu
   * vazio onde a tela mostra oito vigências.
   */
  datasetFamily?: string;
  /**
   * Os tipos de equipamento que esta rubrica **audita** — o recorte da lista.
   *
   * Diferente de `entityType`, logo abaixo, que recorta a contagem de
   * alterações de um par já formado: este decide **quais vigências são
   * candidatas**, antes de qualquer conta.
   *
   * Existe para uma regra do domínio, dita pelo cliente em 16/09/2026: trecho
   * não é assunto de Custo Fixo, e não pode aparecer nem participar de conta
   * nenhuma nas telas daqueles módulos. Sem este recorte, uma vigência que
   * cobrisse `CAVALO+CARRETA+TRECHO` formaria par com uma de `TRECHO` puro — os
   * dois têm trecho em comum —, e o menu do FINAME ofereceria uma vigência de
   * pernas de rota para comparar financiamento.
   *
   * A tela já fazia este recorte do seu lado (`vigenciasQueCobrem`, com
   * `TIPOS_DE_EQUIPAMENTO`). Aqui ele passa a valer também para quem monta o
   * endereço à mão — que é onde um recorte de domínio tem de morar.
   */
  entityTypes?: readonly string[];
  /**
   * O tipo de entidade que este recorte lê — todos, por omissão.
   *
   * Também do QLP: uma vigência do quadro traz o administrativo e o operacional
   * na mesma revisão, e contar sem separar diria que o operacional comparou 47
   * cargos onde ele tem 6. É o mesmo `entityType` que `/qlp/comparacao` passa.
   */
  entityType?: string;
  /**
   * Pedir a frota do par junto das linhas — quem entrou e quem saiu.
   *
   * É uma consulta a mais por candidata (`frotaPorTipo`), e por isso é opt-in:
   * as rubricas que não escrevem frota na linha do menu não a pagam. Quem liga
   * recebe `par.frota` somada no mesmo recorte de equipamento da lista
   * (`entityTypes`), de modo que o número da linha não conte um trecho que a
   * rubrica nem audita.
   */
  frotaDoPar?: boolean;
  /**
   * As linhas e os números daquele recorte, a partir do que o motor devolveu.
   *
   * Recebe as linhas cruas e responde o que a tela publica. Quem implementa
   * chama o próprio `linhasDeX` e o próprio `resumirX` — e é por isso que este
   * módulo não conhece rubrica nenhuma.
   *
   * O segundo argumento é o par de onde as linhas vieram. As quatro auditorias
   * não o usam — o número delas sai das linhas e de mais nada —, e ele está
   * aqui pelo Monitor: `normalizarLinhas` carimba o par e o `change_set` em
   * cada linha, e sem os três identificadores ele teria de inventá-los para
   * chamar a mesma função que a tela chama. Inventar identificador para
   * satisfazer uma assinatura é como um dado errado entra num agregado.
   */
  numeros: (
    rows: Awaited<ReturnType<typeof listChanges>>["rows"],
    par: ParCalculado,
  ) => NumerosDoPar;
}

export async function candidatasDoPar(
  db: Database,
  para: string,
  recorte: RecorteDaRubrica,
  opts: { operacao?: Operacao | null; computedBy: string } = { computedBy: "api" },
): Promise<CandidatasDoPar | { naoEncontrada: true }> {
  const vigencias = await listComparableSnapshots(db, {
    operacao: opts.operacao ?? null,
    ...(recorte.datasetFamily ? { datasetFamily: recorte.datasetFamily } : {}),
  });
  const destino = vigencias.find((v) => v.id === para);
  if (!destino) return { naoEncontrada: true };

  /* A mesma série do destino, da mais recente para a mais antiga: quem abre o
     menu olha primeiro as de cima, então são elas que ganham o orçamento. */
  /* `formamParDeVigencias` é a mesma função que o seletor das telas usa para montar a
     lista (`recorte-de-rubrica.ts`). Era aqui que a regra morava escrita à mão,
     e o seletor não a tinha: o menu oferecia vigências que esta rota nem
     considerava candidatas, e elas apareciam lá sem número nenhum — uma linha
     em branco que quem lê a tela confunde com "nada mudou". Uma função só, e as
     duas pontas do produto recortam igual. */
  /* O recorte de domínio primeiro: quem esta rubrica nem sabe ler não é
     candidata, e não chega a ser perguntada ao motor. */
  const doRecorte = recorte.entityTypes
    ? vigenciasQueCobrem(vigencias, recorte.entityTypes)
    : vigencias;
  const candidatas = doRecorte
    .filter((v) => formamParDeVigencias(v, destino))
    /* E o par tem de ter em comum um tipo que **esta rubrica audita**: cavalo
       com cavalo, e não a perna de rota que as duas por acaso carregam. */
    .filter(
      (v) =>
        !recorte.entityTypes ||
        coberturaComum(v.entityTypeSet, destino.entityTypeSet).some((t) =>
          recorte.entityTypes!.includes(t),
        ),
    )
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));

  const limite = Date.now() + ORCAMENTO_DE_CANDIDATAS_MS;
  const candidatos: CandidatasDoPar["candidatos"] = [];
  let pendentes = 0;

  for (const candidata of candidatas) {
    const gravado = await getChangeSetForPair(db, candidata.id, destino.id);
    if (!gravado && Date.now() >= limite) {
      candidatos.push({ id: candidata.id, numeros: null });
      pendentes++;
      continue;
    }

    const resumo =
      gravado ??
      (await computeChangeSet(db, candidata.id, destino.id, {
        computedBy: opts.computedBy,
      }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...recorte.attributeCodes],
      ...(recorte.entityType ? { entityType: recorte.entityType } : {}),
      limit: 5000,
    });
    /* A frota é do recorte da rubrica, e não do snapshot inteiro: a soma sai
       por `frotaDoEquipamento`, que é a mesma que os cartões das telas usam.
       Sem `entityTypes`, somam-se os tipos que o par de fato tem — nunca uma
       lista fixa que o recorte não declarou. */
    const frota = recorte.frotaDoPar
      ? await frotaPorTipo(db, resumo.id, destino.id).then((porTipo) =>
          frotaDoEquipamento(
            porTipo,
            recorte.entityTypes ? [...recorte.entityTypes] : Object.keys(porTipo),
          ),
        )
      : undefined;
    candidatos.push({
      id: candidata.id,
      numeros: recorte.numeros(rows, {
        baseId: candidata.id,
        comparadaId: destino.id,
        changeSetId: resumo.id,
        ...(frota ? { frota } : {}),
      }),
    });
  }

  return { para: destino.id, candidatos, pendentes };
}
