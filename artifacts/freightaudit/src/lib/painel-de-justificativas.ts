import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { normalizarEquipamento } from "@workspace/curation/equipamento";

import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { EQUIPAMENTOS_DO_AMBIENTE, rotuloDoTipo, type Equipamento } from "@/lib/frota";

/**
 * Painel de Justificativas — a leitura de cobertura do Plano de Ação.
 *
 * A fila (`pages/justificativas.tsx`) responde "o que eu justifico agora": uma
 * vigência, uma aba, os cards das placas que mudaram. O painel responde a
 * pergunta de quem **cobra** o trabalho — quanto do que mudou já está
 * explicado, quanto falta, em que tipo de ativo a pendência está e quem
 * escreveu o que já está escrito. É a mesma justificativa do módulo
 * Justificativas: a que o gestor deve a cada alteração que subiu ou desceu um
 * valor.
 *
 * As contas moram aqui, e não na página, pelo motivo de sempre nesta casa: são
 * strings e números entrando e saindo, e é o que permite prendê-las em teste
 * sem montar tela nenhuma. A página fica com o desenho.
 *
 * **Nada aqui inventa número.** Enquanto a cobertura não chegou, os totais são
 * `null` — e não zero, que se leria como "nada foi justificado" no meio do
 * carregamento. É a mesma escolha de `useContagensPorTipo`, em
 * `lib/justificativas.ts`.
 */

/** Uma linha de `/justificativas/painel`: a cobertura de um tipo numa vigência. */
export interface CoberturaDeJustificativas {
  changeSetId: string;
  /** Cru, como a alteração o gravou — quem normaliza é este arquivo. */
  entityType: string | null;
  alteracoes: number;
  justificadas: number;
  placas: number;
  placasPendentes: number;
}

export interface AutorDeJustificativas {
  changeSetId: string;
  criadoPor: string;
  justificadas: number;
  ultimaEm: string;
}

export interface LinhaDoPainel {
  changeId: number;
  changeSetId: string;
  entityLabel: string;
  entityType: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaAbsolute: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  texto: string | null;
  criadoPor: string | null;
  criadoEm: string | null;
}

export type SituacaoDaJustificativa = "PENDENTE" | "JUSTIFICADA";
export type DirecaoDoImpacto = "TODAS" | "AUMENTO" | "REDUCAO";

/** O que o painel mostra nos cartões e na rosca. */
export interface ResumoDoPainel {
  alteracoes: number;
  justificadas: number;
  pendentes: number;
  placas: number;
  placasPendentes: number;
  /** `0` a `100`; `0` quando não há o que justificar — e não `NaN`. */
  cobertura: number;
}

const VAZIO: ResumoDoPainel = {
  alteracoes: 0,
  justificadas: 0,
  pendentes: 0,
  placas: 0,
  placasPendentes: 0,
  cobertura: 0,
};

/**
 * A cobertura somada — do acervo inteiro, de uma vigência, de um tipo, ou do
 * cruzamento dos dois.
 *
 * `changeSetId` nulo é "todas as vigências" e `tipo` nulo é "todos os tipos":
 * são os dois recortes que não recortam, e é assim que o painel abre.
 *
 * As placas **não se somam entre vigências**: a mesma placa que mudou em duas
 * comparações é uma placa, e somar as duas linhas a contaria duas vezes. Ao
 * atravessar vigências, o painel devolve a maior contagem de uma delas — o
 * piso honesto do que se pode afirmar sem a lista de placas em mãos —, e é por
 * isso que o cartão de placas fala em pendência por vigência, não em frota.
 */
export function resumoDoPainel(
  cobertura: readonly CoberturaDeJustificativas[] | null,
  changeSetId: string | null,
  tipo: string | null,
): ResumoDoPainel | null {
  if (!cobertura) return null;
  const alvo = tipo === null ? null : normalizarEquipamento(tipo);
  const linhas = cobertura.filter(
    (l) =>
      (changeSetId === null || l.changeSetId === changeSetId) &&
      (alvo === null || normalizarEquipamento(l.entityType) === alvo),
  );
  if (linhas.length === 0) return { ...VAZIO };

  const porVigencia = new Map<string, { placas: number; placasPendentes: number }>();
  let alteracoes = 0;
  let justificadas = 0;
  for (const linha of linhas) {
    alteracoes += linha.alteracoes;
    justificadas += linha.justificadas;
    const atual = porVigencia.get(linha.changeSetId) ?? { placas: 0, placasPendentes: 0 };
    porVigencia.set(linha.changeSetId, {
      placas: atual.placas + linha.placas,
      placasPendentes: atual.placasPendentes + linha.placasPendentes,
    });
  }

  const placas = Math.max(...[...porVigencia.values()].map((v) => v.placas));
  const placasPendentes = Math.max(
    ...[...porVigencia.values()].map((v) => v.placasPendentes),
  );

  return {
    alteracoes,
    justificadas,
    pendentes: alteracoes - justificadas,
    placas,
    placasPendentes,
    cobertura: alteracoes === 0 ? 0 : (justificadas / alteracoes) * 100,
  };
}

/**
 * As barras de "Pendências por tipo de ativo" — uma por tipo, na ordem em que
 * a operação os lista.
 *
 * O gráfico do desenho original contava vencimentos, e prazo é coisa que este
 * produto não tem: nenhuma justificativa vence. O que ele responde no lugar é a
 * pergunta que existe — **onde** está a pendência —, porque justificar é
 * trabalho por tipo de ativo: quem explica o reajuste de um cavalo não é quem
 * explica a quilometragem de um trecho, e uma barra por tipo diz a quem
 * mandar a fila.
 *
 * Os tipos fixos da operação aparecem mesmo zerados, pela razão das abas da
 * fila (`abasDaVigencia`): uma barra zerada diz "nenhum trecho está pendente";
 * a barra ausente deixa em aberto se não há trecho ou se a tela não sabe
 * mostrá-lo.
 */
export interface BarraDoPainel {
  tipo: string;
  rotulo: string;
  pendentes: number;
  justificadas: number;
}

export function pendenciasPorTipo(
  cobertura: readonly CoberturaDeJustificativas[] | null,
  changeSetId: string | null,
  fixos: readonly Equipamento[] = EQUIPAMENTOS_DO_AMBIENTE.auditoria,
): BarraDoPainel[] {
  if (!cobertura) return [];
  const linhas = cobertura.filter(
    (l) => changeSetId === null || l.changeSetId === changeSetId,
  );

  const totais = new Map<string, { pendentes: number; justificadas: number }>();
  for (const tipo of fixos) totais.set(tipo, { pendentes: 0, justificadas: 0 });
  for (const linha of linhas) {
    const tipo = normalizarEquipamento(linha.entityType);
    /* Sem tipo declarado não há barra a que pertencer — e inventar uma
       chamada "—" prometeria uma aba que a fila não tem. Ver `abasDaVigencia`. */
    if (tipo === null) continue;
    const atual = totais.get(tipo) ?? { pendentes: 0, justificadas: 0 };
    totais.set(tipo, {
      pendentes: atual.pendentes + (linha.alteracoes - linha.justificadas),
      justificadas: atual.justificadas + linha.justificadas,
    });
  }

  const fixas = [...fixos] as string[];
  const extras = [...totais.keys()]
    .filter((tipo) => !fixas.includes(tipo))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [...fixas, ...extras].map((tipo) => ({
    tipo,
    rotulo: rotuloDoTipo(tipo),
    ...(totais.get(tipo) ?? { pendentes: 0, justificadas: 0 }),
  }));
}

/**
 * As vigências que o painel lista, da mais pendente para a menos — porque é a
 * linha com pendência que se abre, e uma tabela ordenada por data faria o
 * gestor procurar a única que importa.
 */
export interface VigenciaDoPainel {
  changeSetId: string;
  alteracoes: number;
  justificadas: number;
  pendentes: number;
  cobertura: number;
}

export function vigenciasDoPainel(
  cobertura: readonly CoberturaDeJustificativas[] | null,
  tipo: string | null,
): VigenciaDoPainel[] {
  if (!cobertura) return [];
  const alvo = tipo === null ? null : normalizarEquipamento(tipo);
  const porVigencia = new Map<string, { alteracoes: number; justificadas: number }>();
  for (const linha of cobertura) {
    if (alvo !== null && normalizarEquipamento(linha.entityType) !== alvo) continue;
    const atual = porVigencia.get(linha.changeSetId) ?? { alteracoes: 0, justificadas: 0 };
    porVigencia.set(linha.changeSetId, {
      alteracoes: atual.alteracoes + linha.alteracoes,
      justificadas: atual.justificadas + linha.justificadas,
    });
  }

  return [...porVigencia.entries()]
    .map(([changeSetId, t]) => ({
      changeSetId,
      alteracoes: t.alteracoes,
      justificadas: t.justificadas,
      pendentes: t.alteracoes - t.justificadas,
      cobertura: t.alteracoes === 0 ? 0 : (t.justificadas / t.alteracoes) * 100,
    }))
    .sort((a, b) => b.pendentes - a.pendentes || b.alteracoes - a.alteracoes);
}

/**
 * Quem justificou, somado no recorte aberto — o "Responsável" do filtro e a
 * lista de autores.
 */
export interface ResponsavelDoPainel {
  criadoPor: string;
  justificadas: number;
  ultimaEm: string;
}

export function responsaveisDoPainel(
  autores: readonly AutorDeJustificativas[] | null,
  changeSetId: string | null,
): ResponsavelDoPainel[] {
  if (!autores) return [];
  const porAutor = new Map<string, ResponsavelDoPainel>();
  for (const autor of autores) {
    if (changeSetId !== null && autor.changeSetId !== changeSetId) continue;
    const atual = porAutor.get(autor.criadoPor);
    porAutor.set(autor.criadoPor, {
      criadoPor: autor.criadoPor,
      justificadas: (atual?.justificadas ?? 0) + autor.justificadas,
      ultimaEm:
        atual && atual.ultimaEm > autor.ultimaEm ? atual.ultimaEm : autor.ultimaEm,
    });
  }
  return [...porAutor.values()].sort(
    (a, b) => b.justificadas - a.justificadas || a.criadoPor.localeCompare(b.criadoPor),
  );
}

/**
 * As iniciais do responsável, como a coluna as mostra — `joao.silva@x.com` →
 * `JS`. Duas letras no máximo, e a primeira do endereço quando não há sobrenome
 * nenhum a abreviar.
 */
export function iniciaisDoResponsavel(criadoPor: string): string {
  const nome = criadoPor.split("@")[0] ?? criadoPor;
  const partes = nome.split(/[.\-_\s]+/).filter(Boolean);
  if (partes.length === 0) return criadoPor.slice(0, 2).toUpperCase();
  return partes
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/**
 * O que a alteração fez ao valor — o recorte que o gestor pede por nome.
 *
 * Justificar existe por causa do impacto: o que se cobra explicação é da
 * alteração que subiu ou desceu um número. A alteração sem delta — texto, data,
 * entrou/saiu — não é aumento nem redução, e sai como `null` em vez de cair no
 * maior dos dois.
 */
export function direcaoDaLinha(linha: LinhaDoPainel): "AUMENTO" | "REDUCAO" | null {
  if (linha.deltaAbsolute === null || linha.deltaAbsolute === 0) return null;
  return linha.deltaAbsolute > 0 ? "AUMENTO" : "REDUCAO";
}

// ---------------------------------------------------------------------------
// As consultas
// ---------------------------------------------------------------------------

/**
 * A cobertura do acervo, uma vez só — a mesma escolha de `useContagensPorTipo`:
 * são poucas comparações, a tela precisa de todas para montar os cartões e a
 * tabela por vigência, e uma chamada por vigência daria a mesma resposta por N
 * vezes o custo.
 */
export function usePainelDeJustificativas(escopo: string | null) {
  /*
    O `scopeHash` da unidade aberta viaja na consulta: o painel é o da unidade
    que a lateral nomeia, e sem ele o servidor soma a operação inteira — cinco
    unidades num total escrito sob a palavra PERNAMBUCO. `escopo` nulo é a
    Visão Geral, que é a soma pedida de propósito.
  */
  const endereco = escopo
    ? `/justificativas/painel?scopeHash=${encodeURIComponent(escopo)}`
    : "/justificativas/painel";
  const consulta = useConsultaResiliente<{
    cobertura: CoberturaDeJustificativas[];
    autores: AutorDeJustificativas[];
  }>({
    queryKey: ["justificativas", "painel", escopo ?? "todas"],
    endpoint: "/justificativas/painel",
    buscar: () =>
      fetchJson<{
        cobertura: CoberturaDeJustificativas[];
        autores: AutorDeJustificativas[];
      }>(endereco),
  });

  /* `null` enquanto não chegou — ver o cabeçalho do arquivo. */
  const cobertura = consulta.dados?.cobertura ?? null;
  const autores = consulta.dados?.autores ?? null;

  return { cobertura, autores, consulta };
}

export interface ConsultaDeLinhas {
  /** A unidade aberta na lateral; `null` é a Visão Geral. */
  escopo: string | null;
  changeSetId: string | null;
  tipo: string | null;
  situacao: SituacaoDaJustificativa;
  direcao: DirecaoDoImpacto;
  autor: string | null;
  pagina: number;
  porPagina: number;
}

/** O endereço de `/justificativas/pendencias` para um recorte da tela. */
export function enderecoDasLinhas(consulta: ConsultaDeLinhas): string {
  const q = new URLSearchParams();
  /* A unidade aberta, como em `usePainelDeJustificativas` — a lista é a mesma
     que os cartões somam. Uma vigência escolhida já é de uma unidade só, e o
     servidor a recorta por id. */
  if (consulta.escopo) q.set("scopeHash", consulta.escopo);
  if (consulta.changeSetId) q.set("changeSetId", consulta.changeSetId);
  if (consulta.tipo) q.set("entityType", consulta.tipo);
  q.set("situacao", consulta.situacao);
  if (consulta.direcao !== "TODAS") q.set("direcao", consulta.direcao);
  /* O autor só existe sobre as justificadas: uma pendência não tem quem a
     tenha escrito, e o filtro aplicado ali esvaziaria a lista sempre. */
  if (consulta.autor && consulta.situacao === "JUSTIFICADA") q.set("autor", consulta.autor);
  q.set("limit", String(consulta.porPagina));
  q.set("offset", String((consulta.pagina - 1) * consulta.porPagina));
  return `/justificativas/pendencias?${q.toString()}`;
}

export function useLinhasDoPainel(consulta: ConsultaDeLinhas) {
  const endereco = enderecoDasLinhas(consulta);
  const resposta = useQuery({
    queryKey: ["justificativas", "painel", "linhas", endereco],
    queryFn: () => fetchJson<{ total: number; linhas: LinhaDoPainel[] }>(endereco),
    placeholderData: (anterior) => anterior,
  });

  const linhas = useMemo(() => resposta.data?.linhas ?? [], [resposta.data]);
  return { linhas, total: resposta.data?.total ?? 0, consulta: resposta };
}
