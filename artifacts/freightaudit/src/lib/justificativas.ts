import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizarEquipamento } from "@workspace/curation/equipamento";
import { rotuloCurtoDaVigencia } from "@workspace/comparison/labels";

import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { EQUIPAMENTOS_DO_AMBIENTE, rotuloDoTipo, type Equipamento } from "@/lib/frota";

/**
 * O que Chamados — Justificativas e a tela de detalhe por placa têm em
 * comum: o tipo da justificativa, a lista de vigências para o seletor, e a
 * leitura das justificativas já gravadas de uma comparação. Extraído para cá
 * quando a segunda tela (`justificativas-placa.tsx`) passou a precisar do
 * mesmo tipo e da mesma consulta que `justificativas.tsx` já tinha.
 */
export interface Justificativa {
  id: string;
  changeSetId: string;
  changeId: number;
  entityLabel: string;
  entityType: string | null;
  texto: string;
  criadoPor: string;
  criadoEm: string;
}

/** Uma comparação já calculada, como `/change-sets` a lista — colunas em snake_case, é SQL cru. */
interface ChangeSetRow {
  id: string;
  snapshot_b_label: string | null;
  snapshot_b_date: string | null;
  /** Quantas alterações de valor a comparação apurou — a mesma coluna que a bolinha do menu soma. */
  value_changes: number | string | null;
  /** De qual contexto é esta comparação — o que dá nome à unidade no seletor. */
  snapshot_b_scope_hash: string | null;
}

export interface Comparacao {
  id: string;
  snapshotBLabel: string;
  snapshotBDate: string;
  /** Ver `ChangeSetRow.value_changes`. */
  alteracoes: number;
  scopeHash: string | null;
}

/**
 * As comparações já calculadas, mais recente primeiro — a mesma listagem que
 * `useAlteracoesDaVigencia` (`components/layout/contadores.ts`) lê, e pelo
 * mesmo motivo: é leitura de tabela, não o cálculo sob demanda de
 * `/changes/latest`. O seletor de vigência não pode disparar esse cálculo só
 * por estar em tela.
 */
/**
 * `2026-08-01` → `01/08/26`, como a planilha do cliente escreve.
 *
 * Mora aqui, e não no seletor de janela onde nasceu, porque as duas telas do
 * Chamados escrevem a mesma data: a lista (`pages/justificativas.tsx`,
 * pelo seletor) e a grade por placa (`pages/justificativas-placa.tsx`, nos
 * cabeçalhos das colunas). Duas cópias do mesmo formato concordam no dia em que
 * são escritas e discordam no seguinte — e a data da coluna precisa ser a mesma
 * data do seletor logo acima dela.
 */
export function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano.slice(2)}` : iso;
}

export function useComparacoes() {
  return useQuery({
    queryKey: ["change-sets", "justificativas"],
    queryFn: async () => {
      const rows = await fetchJson<ChangeSetRow[]>("/change-sets");
      return rows.map(
        (r): Comparacao => ({
          id: String(r.id),
          snapshotBLabel: r.snapshot_b_label ?? "",
          snapshotBDate: r.snapshot_b_date ?? "",
          alteracoes: Number(r.value_changes ?? 0),
          scopeHash: r.snapshot_b_scope_hash ?? null,
        }),
      );
    },
  });
}

/**
 * As comparações como o seletor de vigência as escreve.
 *
 * O seletor listava `EMPURRADA_2_8_2026 · 02/08/26` — o rótulo do arquivo
 * importado, que é o mesmo texto em todas as unidades da mesma data. Com cinco
 * unidades no acervo, a lista abria com cinco linhas idênticas para cada
 * competência e nenhuma pista de qual era qual: escolher ali era chutar.
 *
 * O formato agora é o dos demais seletores de vigência do produto (ver
 * `components/vigencia/seletor-de-vigencia.tsx`): a competência à esquerda, no
 * mesmo `rotuloCurtoDaVigencia` que o resto da casa usa, e quantas alterações
 * a comparação apurou à direita. A unidade entra junto da data porque aqui —
 * ao contrário do cabeçalho, que já está dentro de uma unidade — a lista
 * atravessa todas elas, e sem ela duas linhas continuariam indistinguíveis.
 *
 * O nome da unidade vem de `/contexts`, casado pelo `scope_hash` da vigência
 * comparada. Quando a lista de contextos ainda não chegou (ou a vigência é
 * anterior à coluna), a linha fica só com a data e a contagem — nada aqui
 * inventa nome de unidade.
 */
export interface OpcaoDeVigencia {
  id: string;
  /** `02/08/2026` — a mesma régua dos outros seletores. */
  competencia: string;
  /** `PERNAMBUCO · EMPURRADA`, quando `/contexts` sabe dizer. */
  unidade: string | null;
  alteracoes: number;
}

export function opcoesDeVigencia(
  comparacoes: Comparacao[],
  contextos: { scopeHash: string; label: string }[],
): OpcaoDeVigencia[] {
  const datas = comparacoes.map((c) => c.snapshotBDate.slice(0, 10));
  const nomePorEscopo = new Map<string, string>();
  for (const contexto of contextos) {
    if (!nomePorEscopo.has(contexto.scopeHash)) nomePorEscopo.set(contexto.scopeHash, contexto.label);
  }

  return comparacoes.map((comparacao) => ({
    id: comparacao.id,
    competencia: rotuloCurtoDaVigencia(comparacao.snapshotBDate.slice(0, 10), datas),
    unidade: comparacao.scopeHash ? (nomePorEscopo.get(comparacao.scopeHash) ?? null) : null,
    alteracoes: comparacao.alteracoes,
  }));
}

/** As justificativas de uma comparação, por `changeId` — sempre a mais recente. */
export function useJustificadaPor(changeSetId: string | undefined) {
  const consulta = useConsultaResiliente<{ justificativas: Justificativa[] }>({
    queryKey: ["justificativas", changeSetId],
    endpoint: "/justificativas",
    buscar: () =>
      fetchJson<{ justificativas: Justificativa[] }>(
        `/justificativas?changeSetId=${changeSetId}`,
      ),
    enabled: !!changeSetId,
  });

  const justificadaPor = useMemo(() => {
    const mapa = new Map<number, Justificativa>();
    for (const j of consulta.dados?.justificativas ?? []) mapa.set(j.changeId, j);
    return mapa;
  }, [consulta.dados]);

  return { justificadaPor, consulta };
}

// ---------------------------------------------------------------------------
// O que cada vigência tem, por tipo de ativo
// ---------------------------------------------------------------------------

/**
 * Uma linha de `/change-sets/tipos`: quantas placas e quantas alterações de um
 * tipo de ativo uma comparação carrega. `entityType` vem cru, como a alteração
 * o gravou — quem normaliza é `indexarContagens`.
 */
export interface ContagemPorTipo {
  changeSetId: string;
  entityType: string | null;
  placas: number;
  alteracoes: number;
}

export interface TotalDoTipo {
  placas: number;
  alteracoes: number;
}

/** `changeSetId → tipo normalizado → totais`. `null` é o tipo que a linha não declarou. */
export type ContagensPorVigencia = Map<string, Map<string | null, TotalDoTipo>>;

/**
 * As contagens do acervo inteiro, uma vez só.
 *
 * O seletor de vigência de cada aba precisa saber, **antes** de abrir
 * comparação nenhuma, quais vigências têm trecho — e a lista de `/change-sets`
 * não diz: um `change_set` é de uma série, e a série é `(escopo,
 * entity_type_set)`, então a mesma data da mesma unidade aparece nela uma vez
 * com o arquivo de equipamento e outra com o de trecho, sem nada que
 * distinga uma linha da outra. Era daí que vinha a lista gigante de vigências
 * repetidas, misturando cavalo, carreta e trecho.
 */
export function useContagensPorTipo() {
  const consulta = useQuery({
    queryKey: ["change-sets", "tipos"],
    queryFn: () =>
      fetchJson<{ contagens: ContagemPorTipo[] }>("/change-sets/tipos"),
  });

  const contagens = useMemo(
    () => (consulta.data ? indexarContagens(consulta.data.contagens) : null),
    [consulta.data],
  );

  /*
    `null` enquanto a resposta não chegou — e não um mapa vazio, que se leria
    como "nenhuma vigência tem nada" e esvaziaria o seletor no meio do
    carregamento. Ver `vigenciasDaAba`.
  */
  return { contagens, consulta };
}

export function indexarContagens(
  linhas: ContagemPorTipo[],
): ContagensPorVigencia {
  const porVigencia: ContagensPorVigencia = new Map();
  for (const linha of linhas) {
    const porTipo = porVigencia.get(linha.changeSetId) ?? new Map();
    const tipo = normalizarEquipamento(linha.entityType);
    const atual = porTipo.get(tipo) ?? { placas: 0, alteracoes: 0 };
    porTipo.set(tipo, {
      placas: atual.placas + linha.placas,
      alteracoes: atual.alteracoes + linha.alteracoes,
    });
    porVigencia.set(linha.changeSetId, porTipo);
  }
  return porVigencia;
}

/** Os totais de uma vigência na aba pedida — `null` é "Todas", que soma os tipos. */
export function totalDaVigencia(
  contagens: ContagensPorVigencia,
  changeSetId: string,
  tipo: string | null,
): TotalDoTipo {
  const porTipo = contagens.get(changeSetId);
  if (!porTipo) return { placas: 0, alteracoes: 0 };
  if (tipo !== null) {
    return (
      porTipo.get(normalizarEquipamento(tipo)) ?? { placas: 0, alteracoes: 0 }
    );
  }
  let placas = 0;
  let alteracoes = 0;
  for (const total of porTipo.values()) {
    placas += total.placas;
    alteracoes += total.alteracoes;
  }
  return { placas, alteracoes };
}

/**
 * As comparações da unidade aberta — e só elas.
 *
 * A lateral nomeia uma unidade ("Unidade atual: PERNAMBUCO"), e esta tela
 * listava as comparações de todas: o seletor de vigência de PERNAMBUCO
 * oferecia CAMAÇARI, MANAUS e CDD CEBRASA, e escolher uma delas trocava a
 * unidade sem que nada em tela dissesse isso — a lateral continuava escrita
 * PERNAMBUCO. É o mesmo desencontro que a Cobertura de dados tinha antes de
 * ler o par (ver `TELAS_QUE_HONRAM_ESCOPO`, em `lib/navegacao-do-escopo.ts`).
 *
 * `escopo` nulo é a Visão Geral — a soma escolhida de propósito, em que a
 * lista atravessa as unidades e cada linha traz o nome da sua. Não é o mesmo
 * que "ninguém escolheu": quem não escolheu cai na unidade que a lateral
 * nomeia, que é a primeira de `/contexts`.
 *
 * Comparação sem `scopeHash` — anterior à coluna — fica fora do recorte de uma
 * unidade e só aparece na Visão Geral: atribuí-la à unidade aberta seria
 * afirmar uma origem que o dado não tem.
 */
export function comparacoesDoEscopo(
  comparacoes: Comparacao[],
  escopo: string | null,
): Comparacao[] {
  if (escopo === null) return comparacoes;
  return comparacoes.filter((c) => c.scopeHash === escopo);
}

/**
 * As vigências que a aba pode abrir — e só elas.
 *
 * A vigência é escolhida **dentro da aba** porque é a aba que dá sentido à
 * lista: uma comparação de trecho e uma de equipamento da mesma data da mesma
 * unidade escrevem a mesma linha no seletor, e escolher entre as duas era
 * chutar. Recortada pelo tipo, a lista da aba Trecho só oferece as vigências
 * que têm trecho, e a contagem à direita é a de trecho — não a da comparação
 * inteira.
 *
 * `contagens` nulo é "ainda não sei": a lista sai inteira, com a contagem da
 * comparação. É o estado de carregamento, e nele esconder vigência seria pior
 * do que mostrar todas — o seletor apareceria vazio por um instante e quem
 * estava escolhendo perderia a linha que estava mirando.
 */
export function vigenciasDaAba(
  comparacoes: Comparacao[],
  contextos: { scopeHash: string; label: string }[],
  contagens: ContagensPorVigencia | null,
  tipo: string | null,
): OpcaoDeVigencia[] {
  const opcoes = opcoesDeVigencia(comparacoes, contextos);
  if (!contagens) return opcoes;
  return opcoes
    .map((opcao) => ({
      ...opcao,
      alteracoes: totalDaVigencia(contagens, opcao.id, tipo).alteracoes,
    }))
    .filter((opcao) => opcao.alteracoes > 0);
}

// ---------------------------------------------------------------------------
// As abas por tipo de ativo
// ---------------------------------------------------------------------------

/**
 * O mínimo de que o recorte por aba precisa de cada placa agrupada.
 *
 * `entityType` é `string | null` porque é assim que a comparação o devolve —
 * `entity_type` é texto livre no banco de propósito, e a linha pode vir sem
 * tipo nenhum.
 */
export interface PlacaComTipo {
  entityType: string | null;
}

export interface AbaDeTipo {
  /** `null` na aba "Todas" — o recorte que não recorta. */
  tipo: string | null;
  rotulo: string;
  /**
   * Quantas placas esperam nesta aba, na vigência **dela**. `null` enquanto as
   * contagens não chegaram: um zero ali seria uma afirmação que ainda não se
   * pode fazer.
   */
  total: number | null;
  /**
   * A vigência que a aba abre — a escolhida, quando ela tem deste tipo, e a
   * mais recente que tem, quando não. `undefined` quando nenhuma tem.
   */
  changeSetId: string | undefined;
}

/**
 * As abas de Chamados: "Todas", os tipos com tela 360° **da operação
 * auditada** e o que mais o acervo trouxer — **cada uma com a vigência dela**.
 *
 * A tela agrupava por placa e mostrava o tipo como etiqueta dentro do card —
 * o que respondia "de que é esta placa" e não "o que mudou nos trechos". São
 * perguntas diferentes: justificar é um trabalho por tipo de ativo (quem
 * explica reajuste de cavalo não é quem explica quilometragem de trecho), e
 * sem o recorte a fila chegava misturada.
 *
 * A vigência vive dentro da aba pelo mesmo motivo, um andar acima: a série de
 * uma comparação é `(escopo, entity_type_set)`, então o arquivo de trecho e o
 * de equipamento da mesma unidade na mesma data são duas comparações — e o
 * seletor único as listava como duas linhas idênticas, misturando cavalo,
 * carreta e trecho numa lista que só crescia. Cada aba oferece agora as
 * vigências que têm o que ela mostra, e a escolhida acompanha a troca de aba
 * quando serve às duas: quem está numa vigência que tem cavalo e trecho não é
 * jogado para outra data por trocar de aba.
 *
 * Os três fixos aparecem **mesmo vazios**, pela razão de
 * `abasDeEquipamento` (`lib/curadoria.ts`): uma aba escrita `Trecho 0` diz
 * "nenhum trecho mudou"; a ausência da aba deixa em aberto se não houve trecho
 * ou se a tela não sabe mostrá-lo. Um tipo que não está na lista — o `DOLLY`
 * que um dia venha do Freightech — entra depois deles, em ordem alfabética,
 * sem mudança nenhuma aqui.
 *
 * O total conta **placas**, e não alterações, porque é a placa que o card
 * representa: `Trecho 6` que abre com seis cards é a aba dizendo a verdade
 * sobre o que há atrás dela; contando alterações, ela prometeria dezesseis
 * cards e mostraria seis.
 */
export function abasDaVigencia(
  /** As comparações como `/change-sets` as devolve: da mais recente para a mais antiga. */
  comparacoes: readonly Comparacao[],
  contagens: ContagensPorVigencia | null,
  escolhida: string | undefined,
  /*
    Os tipos fixos são os **da operação auditada**, e não os seis que existem: no
    Apoio, uma aba "Carreta 0" prometeria uma fila que aquela operação nunca vai
    ter, e a empilhadeira — que é o ativo de lá — ficaria fora dos fixos,
    aparecendo só quando alguma vigência trouxesse uma. Ver
    `EQUIPAMENTOS_DO_AMBIENTE`, em `lib/frota.ts`. O padrão é a lista da
    Empurrada, que é o ambiente em que esta tela nasceu.
  */
  fixos: readonly Equipamento[] = EQUIPAMENTOS_DO_AMBIENTE.auditoria,
): AbaDeTipo[] {
  const vistos = new Set<string>();
  if (contagens) {
    for (const porTipo of contagens.values()) {
      for (const tipo of porTipo.keys()) if (tipo !== null) vistos.add(tipo);
    }
  }
  const fixas: string[] = [...fixos];
  const extras = [...vistos]
    .filter((tipo) => !fixas.includes(tipo))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const aba = (tipo: string | null, rotulo: string): AbaDeTipo => {
    if (!contagens) {
      return { tipo, rotulo, total: null, changeSetId: escolhida };
    }
    const temAqui = (id: string | undefined) =>
      !!id && totalDaVigencia(contagens, id, tipo).placas > 0;
    const changeSetId = temAqui(escolhida)
      ? escolhida
      : comparacoes.find((c) => temAqui(c.id))?.id;
    return {
      tipo,
      rotulo,
      total: changeSetId
        ? totalDaVigencia(contagens, changeSetId, tipo).placas
        : 0,
      changeSetId,
    };
  };

  return [
    aba(null, "Todas"),
    ...[...fixas, ...extras].map((tipo) => aba(tipo, rotuloDoTipo(tipo))),
  ];
}

/** A aba de um tipo, achada pela mesma normalização que as monta. */
export function abaDoTipo(
  abas: readonly AbaDeTipo[],
  tipo: string | null,
): AbaDeTipo | undefined {
  const alvo = tipo === null ? null : normalizarEquipamento(tipo);
  return abas.find((aba) => aba.tipo === alvo);
}

/**
 * As placas da aba escolhida — `null` (Todas) não recorta nada.
 *
 * A comparação com o tipo passa pela mesma normalização das abas: a escolha
 * viaja no endereço, e um link escrito à mão com `?tipo=cavalo` tem de abrir
 * a mesma lista que o clique abre.
 */
export function placasDaAba<T extends PlacaComTipo>(
  placas: readonly T[],
  tipo: string | null,
): T[] {
  if (tipo === null) return [...placas];
  const alvo = normalizarEquipamento(tipo);
  return placas.filter((p) => normalizarEquipamento(p.entityType) === alvo);
}
