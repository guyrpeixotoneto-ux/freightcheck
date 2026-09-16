import type { Database } from "@workspace/db";
import {
  coberturaComum,
  computeChangeSet,
  formamParDeVigencias,
  getChangeSetForPair,
  listChanges,
  listComparableSnapshots,
  vigenciasQueCobrem,
  type NaturezaEconomica,
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
 * Um balde de dinheiro de um par — a periodicidade, a natureza e o líquido.
 *
 * `natureza` é `null` no recorte de uma rubrica só, e é isso que mantém a linha
 * do menu das quatro auditorias exatamente como sempre foi: `+R$ 7.238,85/mês`,
 * sem prefixo. FINAME, IPVA e Impostos são custo inteiro; Lucro Fixo é receita
 * inteira. Dizer "Custo" ao lado de um número numa tela cujo nome já é o da
 * rubrica é repetir o que a tela inteira diz.
 *
 * Ela deixa de ser `null` no primeiro recorte que mistura as duas — o Monitor
 * Custo Fixo, que lê os quatro módulos de uma vez. Ali o prefixo é obrigatório:
 * um número só, somando o custo que subiu com a receita que subiu, é
 * exatamente o escalar que `CartoesDoMonitor` recusa publicar ("não há cartão
 * de Impacto líquido"), e o menu não pode ser a porta dos fundos por onde ele
 * entra.
 *
 * Por que uma lista e não um `Record<string, number>`: porque a chave passou a
 * ser **dupla** — periodicidade e natureza —, e um objeto de chave composta
 * (`CUSTO:MENSAL`) seria um formato que só o cliente sabe abrir. Uma lista diz
 * os dois campos com o nome de cada um.
 */
export interface BaldeDoImpacto {
  periodicidade: string;
  /** `null` quando o recorte é de uma natureza só — as quatro rubricas. */
  natureza: NaturezaEconomica | null;
  valor: number;
}

/** Os números de um par, no recorte de quem perguntou. */
export interface NumerosDoPar {
  alteracoes: number;
  impacto: { baldes: BaldeDoImpacto[] };
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
 * As quatro auditorias publicam o impacto nesse formato desde sempre
 * (`impactoPorPeriodicidade` e irmãs), e nenhuma delas tem duas naturezas para
 * separar. Esta é a tradução de uma ponta à outra, num lugar só, para que as
 * quatro não escrevam quatro vezes o mesmo `Object.entries`.
 */
export function baldesDeUmaNatureza(
  porPeriodicidade: Record<string, number>,
): BaldeDoImpacto[] {
  return Object.entries(porPeriodicidade).map(([periodicidade, valor]) => ({
    periodicidade,
    natureza: null,
    valor,
  }));
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
    candidatos.push({
      id: candidata.id,
      numeros: recorte.numeros(rows, {
        baseId: candidata.id,
        comparadaId: destino.id,
        changeSetId: resumo.id,
      }),
    });
  }

  return { para: destino.id, candidatos, pendentes };
}
