import { normalizarEquipamento } from "@workspace/curation/equipamento";
import { foraDoPainelDeJustificativas } from "@workspace/comparison/painel-de-justificativas-escopo";
import {
  MODULOS_DE_JUSTIFICATIVA,
  descreverRubrica,
  moduloDeJustificativa,
  type ChaveDeModulo,
} from "@workspace/comparison/modulos-de-justificativa";

import { fetchJson } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { escreverRubrica } from "@/lib/qlp-comparacao";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import type { Ambiente } from "@/lib/ambiente";
import {
  EQUIPAMENTOS_DO_AMBIENTE,
  equipamentosDoAmbiente,
  rotuloDoTipo,
  type Equipamento,
} from "@/lib/frota";

/**
 * Painel de Justificativas — a leitura de cobertura de Chamados.
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

/**
 * Os tipos de ativo que **este painel** oferece — as abas, as barras e as
 * opções da caixa "Tipo de ativo".
 *
 * São os da operação aberta (`equipamentosDoAmbiente`) menos os que o painel
 * não cobra: hoje, o trecho na empurrada. A razão de ele estar fora está em
 * `@workspace/comparison/painel-de-justificativas-escopo`, e é a mesma lista
 * que o servidor aplica às três consultas — é por isso que ela vem de lá, e
 * não de uma segunda cópia escrita aqui.
 *
 * A lista serve também de régua do endereço: `?tipo=` que não esteja nela cai
 * na Geral, como já caía o tipo de outro ambiente. Um link antigo para a aba de
 * trecho abre no painel inteiro, e não numa aba que não existe mais.
 */
export function tiposDoPainel(ambiente: Ambiente): Equipamento[] {
  return equipamentosDoAmbiente(ambiente).filter(
    (tipo) => !foraDoPainelDeJustificativas(tipo),
  );
}

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
  /** `FIXO` | `VARIAVEL` | `null` — de que módulo a alteração é. */
  costClass: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaAbsolute: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  texto: string | null;
  /* A justificativa estruturada da linha — reabrir uma já justificada traz de
     volta a fórmula e a regra gravadas, em vez de pedi-las de novo. */
  formula: string | null;
  regra: string | null;
  conforme: boolean | null;
  /** `EXCECAO` ou `DESCUMPRIMENTO`, de `0100` em diante. */
  naoConformidade: string | null;
  motivoExcecao: string | null;
  responsavelAprovacao: string | null;
  criadoPor: string | null;
  criadoEm: string | null;
}

/**
 * O recorte de situação da lista.
 *
 * `TODAS` é o da exportação do Monitor: depois que a lista por alteração saiu
 * da tela, o CSV é o único lugar onde ela mora, e um arquivo com só metade das
 * linhas seria a exportação mentindo sobre o próprio nome.
 */
export type SituacaoDaJustificativa = "TODAS" | "PENDENTE" | "JUSTIFICADA";
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
 * explica a troca do implemento de uma carreta, e uma barra por tipo diz a quem
 * mandar a fila.
 *
 * Os tipos fixos da operação aparecem mesmo zerados, pela razão das abas da
 * fila (`abasDaVigencia`): uma barra zerada diz "nenhuma carreta está
 * pendente"; a barra ausente deixa em aberto se não há carreta ou se a tela não
 * sabe mostrá-la.
 *
 * O que o painel não cobra não vira barra — nem entre os fixos, nem entre os
 * extras que vierem do dado. A barra é clicável e leva à aba (ou ao filtro) do
 * tipo, e uma barra para um tipo que a tela não sabe abrir prometeria uma fila
 * que não existe. Ver `tiposDoPainel`, acima.
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

  const fixas = (fixos as readonly string[]).filter(
    (tipo) => !foraDoPainelDeJustificativas(tipo),
  );

  const totais = new Map<string, { pendentes: number; justificadas: number }>();
  for (const tipo of fixas) totais.set(tipo, { pendentes: 0, justificadas: 0 });
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

  const extras = [...totais.keys()]
    .filter((tipo) => !fixas.includes(tipo) && !foraDoPainelDeJustificativas(tipo))
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
// A leitura por módulo — o que o Monitor cobra
// ---------------------------------------------------------------------------

/**
 * A cobertura de uma rubrica numa vigência, como o servidor a devolve.
 *
 * `ultimaEm` chega como texto, e não como `Date`: é JSON no fio, e converter
 * aqui uma vez é o que evita cada leitura da tela decidir sozinha o fuso.
 */
export interface CoberturaDeRubrica {
  changeSetId: string;
  entityType: string | null;
  modulo: ChaveDeModulo;
  /** A chave de `modulos-de-justificativa` — `finame`, `qlp:saude`, `parametro:…`. */
  rubrica: string;
  alteracoes: number;
  justificadas: number;
  ultimaEm: string | null;
  ultimoAutor: string | null;
}

/** Uma barra de "Cobertura por módulo". */
export interface ModuloDoPainel {
  modulo: ChaveDeModulo;
  rotulo: string;
  descricao: string;
  /** A tela do módulo inteiro; `null` quando ele não tem uma. */
  rota: string | null;
  /** As rubricas do módulo neste recorte, da maior para a menor. */
  rubricas: string[];
  alteracoes: number;
  justificadas: number;
  pendentes: number;
  cobertura: number;
  /** Quantas rubricas deste módulo ainda têm pendência. */
  rubricasPendentes: number;
}

function recortar(
  rubricas: readonly CoberturaDeRubrica[],
  changeSetId: string | null,
  tipo: string | null,
): CoberturaDeRubrica[] {
  const alvo = tipo === null ? null : normalizarEquipamento(tipo);
  return rubricas.filter(
    (l) =>
      (changeSetId === null || l.changeSetId === changeSetId) &&
      (alvo === null || normalizarEquipamento(l.entityType) === alvo),
  );
}

/**
 * A cobertura somada por módulo — Custo Fixo, Custo Variável, QLP, e o que a
 * curadoria ainda não classificou.
 *
 * **Só os módulos que têm alteração no recorte.** É o oposto da regra das
 * barras por tipo de ativo, e de propósito: lá os tipos são a frota da
 * operação, e uma barra zerada afirma "nenhuma carreta está pendente"; aqui um
 * módulo sem alteração nenhuma não é uma afirmação sobre o trabalho — é o QLP
 * na aba do Cavalo, que não tem o que dizer ali. A soma dos módulos é sempre a
 * mesma soma do cartão do total, que é o que permite conferir a tela com ela
 * mesma.
 */
export function modulosDoPainel(
  rubricas: readonly CoberturaDeRubrica[] | null,
  changeSetId: string | null,
  tipo: string | null,
): ModuloDoPainel[] {
  if (!rubricas) return [];
  const linhas = recortar(rubricas, changeSetId, tipo);

  const totais = new Map<
    ChaveDeModulo,
    { alteracoes: number; justificadas: number; pendentes: Set<string> }
  >();
  for (const linha of linhas) {
    const atual =
      totais.get(linha.modulo) ??
      { alteracoes: 0, justificadas: 0, pendentes: new Set<string>() };
    atual.alteracoes += linha.alteracoes;
    atual.justificadas += linha.justificadas;
    /* A mesma rubrica em duas vigências é **uma** rubrica pendente: o gestor
       abre uma tela, não duas. */
    if (linha.alteracoes > linha.justificadas) atual.pendentes.add(linha.rubrica);
    totais.set(linha.modulo, atual);
  }

  return MODULOS_DE_JUSTIFICATIVA.filter((m) => totais.has(m.chave)).map((m) => {
    const t = totais.get(m.chave)!;
    return {
      modulo: m.chave,
      rotulo: m.rotulo,
      descricao: m.descricao,
      rota: m.rota,
      /* Os nomes que a tela escreve sob o do módulo — as rubricas **deste
         recorte**, e não uma lista fixa: escrita à mão, ela prometeria "Finame,
         IPVA, Seguro" numa unidade em que só o Finame mudou. */
      rubricas: rubricasDoPainel(linhas, changeSetId, tipo, m.chave).map((r) => r.rotulo),
      alteracoes: t.alteracoes,
      justificadas: t.justificadas,
      pendentes: t.alteracoes - t.justificadas,
      cobertura: t.alteracoes === 0 ? 0 : (t.justificadas / t.alteracoes) * 100,
      rubricasPendentes: t.pendentes.size,
    };
  });
}

/**
 * Uma linha de "Onde está a pendência" — a rubrica, e a tela em que ela se
 * justifica.
 */
export interface RubricaDoPainel {
  /** Única na tabela: a mesma rubrica em dois módulos são duas linhas. */
  chave: string;
  rubrica: string;
  modulo: ChaveDeModulo;
  moduloRotulo: string;
  /** Já escrito para a tela — inclusive o das rubricas do QLP. */
  rotulo: string;
  /** A tela onde se justifica; `null` quando quem justifica é a fila. */
  rota: string | null;
  alteracoes: number;
  justificadas: number;
  pendentes: number;
  cobertura: number;
  ultimaEm: string | null;
  ultimoAutor: string | null;
}

/**
 * As rubricas do recorte, da mais pendente para a menos.
 *
 * Ordenada por pendência, e não por nome: a tabela existe para dizer por onde
 * começar, e uma ordem alfabética faria o gestor procurar a linha que importa.
 * É a mesma escolha de `vigenciasDoPainel`.
 *
 * O nome da rubrica do QLP é escrito aqui, com o dicionário que a lateral e as
 * telas do quadro já usam (`escreverRubrica`): o pacote de comparação devolve a
 * chave crua de propósito — nomear `saude` de "Plano de saúde" é decisão de
 * apresentação, e é aqui que ela mora.
 */
export function rubricasDoPainel(
  rubricas: readonly CoberturaDeRubrica[] | null,
  changeSetId: string | null,
  tipo: string | null,
  modulo: ChaveDeModulo | null = null,
): RubricaDoPainel[] {
  if (!rubricas) return [];
  const linhas = recortar(rubricas, changeSetId, tipo).filter(
    (l) => modulo === null || l.modulo === modulo,
  );

  const porChave = new Map<string, RubricaDoPainel>();
  for (const linha of linhas) {
    const descricao = descreverRubrica(linha.rubrica, linha.modulo);
    const chave = `${linha.modulo}:${linha.rubrica}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, {
        chave,
        rubrica: linha.rubrica,
        modulo: linha.modulo,
        moduloRotulo: moduloDeJustificativa(linha.modulo).rotulo,
        rotulo: descricao.rubricaDoQlp
          ? escreverRubrica(descricao.rubricaDoQlp)
          : descricao.rotulo,
        rota: descricao.rota,
        alteracoes: linha.alteracoes,
        justificadas: linha.justificadas,
        pendentes: linha.alteracoes - linha.justificadas,
        cobertura: 0,
        ultimaEm: linha.ultimaEm,
        ultimoAutor: linha.ultimoAutor,
      });
      continue;
    }
    atual.alteracoes += linha.alteracoes;
    atual.justificadas += linha.justificadas;
    atual.pendentes = atual.alteracoes - atual.justificadas;
    /* A justificativa mais recente entre as vigências somadas — e o autor
       **dela**, e não o de uma vigência antiga que veio antes na lista. */
    if (linha.ultimaEm !== null && (atual.ultimaEm === null || linha.ultimaEm > atual.ultimaEm)) {
      atual.ultimaEm = linha.ultimaEm;
      atual.ultimoAutor = linha.ultimoAutor;
    }
  }

  return [...porChave.values()]
    .map((l) => ({
      ...l,
      pendentes: l.alteracoes - l.justificadas,
      cobertura: l.alteracoes === 0 ? 0 : (l.justificadas / l.alteracoes) * 100,
    }))
    .sort(
      (a, b) =>
        b.pendentes - a.pendentes ||
        b.alteracoes - a.alteracoes ||
        a.rotulo.localeCompare(b.rotulo, "pt-BR"),
    );
}

// ---------------------------------------------------------------------------
// A cobrança, em texto
// ---------------------------------------------------------------------------

/**
 * O que falta justificar, escrito para ser colado num chat.
 *
 * O Monitor responde a pergunta de quem cobra, e cobrar termina fora do
 * produto: numa mensagem para quem vai justificar. Até aqui esse último passo
 * era trabalho manual — ler a tabela, somar de cabeça, redigitar os números —,
 * e redigitar número é onde ele muda. Este texto é a mesma leitura da tela, em
 * palavras.
 *
 * **Ele não atribui nada a ninguém.** Não tem destinatário, não tem prazo e não
 * tem "responsável": diz o que falta, por módulo e por rubrica, e onde cada uma
 * se justifica. Quem manda escolhe para quem — que é a decisão que o produto
 * não tem como tomar, porque não existe dono de alteração aqui.
 *
 * **É o recorte que está na tela**, inclusive o filtro de módulo: o cabeçalho
 * nomeia a unidade, a vigência e o tipo de ativo, e o link no rodapé reabre
 * exatamente esta leitura. Um texto que somasse mais do que a tela mostra
 * faria quem recebe conferir um número que ninguém consegue reproduzir.
 *
 * Rubricas sem pendência ficam de fora — a cobrança é do que falta, e uma linha
 * com "0 pendentes" só empurra para baixo as que importam.
 */
export interface RecorteDaCobranca {
  /** A unidade aberta; `null` quando a leitura atravessa todas. */
  unidade: string | null;
  /** O nome da vigência escolhida; `null` quando são todas. */
  vigencia: string | null;
  /** O rótulo do tipo de ativo filtrado; `null` quando são todos. */
  tipo: string | null;
  /** O rótulo do módulo filtrado; `null` quando são todos. */
  modulo: string | null;
  /** O endereço desta leitura, para quem recebe abrir o mesmo recorte. */
  link?: string;
}

export function textoDaCobranca(
  recorte: RecorteDaCobranca,
  resumo: ResumoDoPainel,
  rubricas: readonly RubricaDoPainel[],
): string {
  const numero = (n: number) => n.toLocaleString("pt-BR");
  const porcento = (v: number) => `${formatNumber(v, v === 0 || v === 100 ? 0 : 2)}%`;

  const linhas: string[] = [];

  linhas.push(
    recorte.unidade
      ? `Justificativas pendentes — ${recorte.unidade}`
      : "Justificativas pendentes",
  );

  const recortes = [
    recorte.vigencia ?? "Todas as vigências",
    recorte.tipo ? `só ${recorte.tipo}` : null,
    recorte.modulo ? `só ${recorte.modulo}` : null,
  ].filter((r): r is string => r !== null);
  linhas.push(recortes.join(" · "));

  linhas.push("");
  linhas.push(
    `${numero(resumo.pendentes)} de ${numero(resumo.alteracoes)} alterações ainda sem justificativa — ${porcento(resumo.cobertura)} do que mudou já está explicado.`,
  );

  /* Por módulo, na ordem do catálogo, e dentro dele por pendência: é a mesma
     ordem da tela, porque é ela que diz por onde começar. */
  const comPendencia = rubricas.filter((r) => r.pendentes > 0);
  for (const modulo of MODULOS_DE_JUSTIFICATIVA) {
    const doModulo = comPendencia.filter((r) => r.modulo === modulo.chave);
    if (doModulo.length === 0) continue;

    const alteracoes = doModulo.reduce((s, r) => s + r.alteracoes, 0);
    const pendentes = doModulo.reduce((s, r) => s + r.pendentes, 0);
    const justificadas = alteracoes - pendentes;

    linhas.push("");
    linhas.push(
      `${modulo.rotulo.toUpperCase()} — ${numero(pendentes)} pendentes de ${numero(alteracoes)} (${porcento(
        alteracoes === 0 ? 0 : (justificadas / alteracoes) * 100,
      )} explicado)`,
    );
    for (const rubrica of doModulo) {
      /* Onde se justifica cada uma — é o que transforma a cobrança em
         instrução. Sem tela de rubrica, quem justifica é a fila. */
      const onde = rubrica.rota ? `justificar em ${rubrica.moduloRotulo}` : "justificar na fila";
      linhas.push(
        `- ${rubrica.rotulo}: ${numero(rubrica.pendentes)} pendentes de ${numero(
          rubrica.alteracoes,
        )} (${porcento(rubrica.cobertura)} explicado) — ${onde}`,
      );
    }
  }

  if (recorte.link) {
    linhas.push("");
    linhas.push(`Leitura completa: ${recorte.link}`);
  }

  return linhas.join("\n");
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
  interface RespostaDoPainel {
    cobertura: CoberturaDeJustificativas[];
    autores: AutorDeJustificativas[];
    rubricas: CoberturaDeRubrica[];
  }
  const consulta = useConsultaResiliente<RespostaDoPainel>({
    queryKey: ["justificativas", "painel", escopo ?? "todas"],
    endpoint: "/justificativas/painel",
    buscar: () => fetchJson<RespostaDoPainel>(endereco),
  });

  /* `null` enquanto não chegou — ver o cabeçalho do arquivo. */
  const cobertura = consulta.dados?.cobertura ?? null;
  const autores = consulta.dados?.autores ?? null;
  /*
    A resposta guardada de uma versão anterior do servidor não tem `rubricas`, e
    `?? null` é o que mantém a tela dizendo "ainda não chegou" em vez de
    "nenhuma rubrica" — a mesma régua dos outros dois.
  */
  const rubricas = consulta.dados?.rubricas ?? null;

  return { cobertura, autores, rubricas, consulta };
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

/**
 * A lista por alteração não é mais lida por tela nenhuma — ela é a exportação.
 *
 * O Monitor tinha uma tabela paginada de alterações com um botão `Justificar`
 * em cada linha, e um `useLinhasDoPainel` que a buscava. As duas coisas saíram
 * quando justificar passou a acontecer dentro de cada módulo (ver o cabeçalho
 * de `pages/monitor-de-justificativas.tsx`). A rota continua existindo e
 * `enderecoDasLinhas` continua montando o endereço dela: é o CSV que percorre
 * as páginas, e é nele que o detalhe por alteração mora agora.
 */
