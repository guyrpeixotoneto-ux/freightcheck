import type { Comparacao } from "@/lib/justificativas";

/**
 * O histórico de uma placa — a grade atributo × vigência da tela de detalhe
 * (`pages/justificativas-placa.tsx`).
 *
 * A tela antiga listava as alterações de **uma** vigência, uma embaixo da
 * outra, cada uma com o seu botão "Justificar". Respondia "o que mudou agora"
 * e nada mais: para saber se `manutencaoReaisKm` vinha subindo há três
 * competências ou se aquilo era a primeira vez, era preciso voltar, trocar a
 * vigência no seletor da lista, entrar na placa de novo, e guardar de cabeça o
 * que a tela anterior dizia. A grade responde a mesma pergunta olhando de
 * lado: cada linha é um atributo, cada coluna é uma vigência, e a célula é a
 * alteração que houve ali — pendente, justificada, ou nenhuma.
 *
 * A régua é a mesma do Radar de Alterações (`gestao-a-vista-radar.ts`), de
 * onde a janela por número de colunas foi herdada, com as duas recusas que
 * sustentam aquela grade e sustentam esta:
 *
 * 1. **Vazio não é zero.** Uma célula sem alteração (`"sem-alteracao"`) e uma
 *    coluna cuja leitura ainda não voltou (`"sem-leitura"`) são estados
 *    distintos, e nunca o mesmo desenho: uma coluna que ainda está carregando
 *    não pode afirmar "esta placa não mudou nesta vigência".
 * 2. **A cor é a régua.** Pendente e justificada se distinguem pela cor da
 *    célula antes de qualquer leitura de texto — é o que permite varrer a
 *    grade e ver onde falta trabalho sem ler atributo por atributo.
 *
 * Nada aqui lê a rede nem o React: a entrada é o que os endpoints já
 * devolvem (`/change-sets/:id/changes` e `/justificativas`), o que deixa cada
 * conta conferível ao lado do contrato que a alimenta.
 */

// ---------------------------------------------------------------------------
// A janela de vigências
// ---------------------------------------------------------------------------

/** Quantas vigências a grade mostra por padrão. */
export const VIGENCIAS_PADRAO = 6;

/** As janelas que o seletor oferece — as mesmas escalas do Radar. */
export const OPCOES_DE_JANELA = [3, 6, 12] as const;

/**
 * As vigências que viram coluna, da mais antiga à mais recente.
 *
 * `comparacoes` chega da mais recente para a mais antiga (é como
 * `/change-sets` responde), e `ate` é a vigência que a lista de Justificativas
 * escolheu — o `?changeSetId=` do endereço. A janela termina nela, e não na
 * mais recente do banco: quem entrou numa placa a partir de junho está
 * justificando junho, e uma grade que terminasse em agosto mostraria como
 * "última coluna" uma vigência que aquele gestor não pediu.
 *
 * Uma vigência `ate` que não está na lista (endereço velho, comparação
 * apagada) não vira janela vazia: a grade volta para as mais recentes, que é
 * o que a tela mostraria se o endereço não trouxesse nada.
 */
export function janelaDeVigencias(
  comparacoes: readonly Comparacao[],
  colunas: number,
  ate?: string | null,
): Comparacao[] {
  const inicio = ate ? comparacoes.findIndex((c) => c.id === ate) : -1;
  const desde = inicio >= 0 ? inicio : 0;
  return comparacoes.slice(desde, desde + Math.max(1, colunas)).reverse();
}

/** `?colunas=` — quantas vigências cabem na grade. Fora da lista, o padrão. */
export function lerJanela(valor: string | null): number {
  const numero = Number(valor);
  return OPCOES_DE_JANELA.includes(numero as (typeof OPCOES_DE_JANELA)[number])
    ? numero
    : VIGENCIAS_PADRAO;
}

// ---------------------------------------------------------------------------
// A grade
// ---------------------------------------------------------------------------

/**
 * O mínimo de que a grade precisa de uma alteração — o subconjunto de
 * `ChangeRow` que a célula desenha. Tipo próprio, e não `ChangeRow`, porque a
 * régua não deve depender de trinta campos que ela não lê.
 */
export interface AlteracaoDaPlaca {
  id: number;
  attributeCode: string | null;
  attributeName: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  /** `CALCULATED` quando a comparação conseguiu precificar a alteração. */
  impactConfidence: string;
  impactAmount: number | null;
  impactPeriodicity: string | null;
}

/** Uma coluna da grade: a vigência, o que mudou nela, e o que já foi explicado. */
export interface VigenciaDaGrade<T extends AlteracaoDaPlaca = AlteracaoDaPlaca> {
  changeSetId: string;
  rotulo: string;
  alteracoes: readonly T[];
  /** Os `changeId` que já têm justificativa gravada nesta vigência. */
  justificadas: ReadonlySet<number>;
  /** A leitura desta coluna ainda não voltou — ela não afirma "nada mudou". */
  carregando: boolean;
}

export type EstadoDaCelula =
  /** A leitura da coluna ainda não voltou. */
  | "sem-leitura"
  /** Houve leitura e este atributo não mudou nesta vigência. */
  | "sem-alteracao"
  /** Mudou e ninguém explicou por quê. */
  | "pendente"
  /** Mudou e tem justificativa gravada — todas as alterações da célula. */
  | "justificada"
  /** Mais de uma alteração na célula, e só parte delas explicada. */
  | "parcial";

export interface CelulaDaPlaca<T extends AlteracaoDaPlaca = AlteracaoDaPlaca> {
  changeSetId: string;
  rotulo: string;
  estado: EstadoDaCelula;
  /**
   * As alterações daquele atributo naquela vigência. Quase sempre uma — mas
   * a comparação pode trazer mais de uma linha para o mesmo atributo, e
   * escolher uma delas para desenhar esconderia as outras do gestor.
   */
  alteracoes: T[];
  /**
   * As alterações da célula que ainda não têm justificativa — a lista, e não
   * a contagem, porque é ela que o botão "justificar as pendentes" manda: numa
   * célula parcialmente explicada, reenviar tudo gravaria justificativa nova
   * sobre o que já estava resolvido.
   */
  pendentes: T[];
}

export interface LinhaDaPlaca<T extends AlteracaoDaPlaca = AlteracaoDaPlaca> {
  attributeCode: string;
  attributeName: string;
  celulas: CelulaDaPlaca<T>[];
  totalDeAlteracoes: number;
  pendentes: number;
}

/** A chave que junta as células de uma linha — o código, e o nome quando não há código. */
function chaveDoAtributo(alteracao: AlteracaoDaPlaca): string {
  return alteracao.attributeCode ?? alteracao.attributeName ?? "—";
}

/**
 * A grade: uma linha por atributo que mexeu na janela, uma célula por vigência.
 *
 * A ordem das linhas responde à pergunta da tela — "o que mudou por último" —
 * e não à ordem alfabética: primeiro o atributo cuja alteração mais recente é
 * mais nova, depois o que tem mais pendências, e o nome só desempata. Quem
 * abre a placa por causa da fila de justificativas quer as linhas de trabalho
 * no topo; quem abre para conferir histórico lê a mesma grade da esquerda
 * para a direita.
 *
 * Atributo que só mudou fora da janela não vira linha vazia: ele não está na
 * grade porque a janela não o alcança, e uma linha inteira em branco diria
 * "este atributo está parado", que é outra afirmação.
 */
export function montarGradeDaPlaca<T extends AlteracaoDaPlaca>(
  vigencias: readonly VigenciaDaGrade<T>[],
): LinhaDaPlaca<T>[] {
  const nomes = new Map<string, string>();
  const porAtributo = new Map<string, Map<string, T[]>>();

  for (const vigencia of vigencias) {
    for (const alteracao of vigencia.alteracoes) {
      const chave = chaveDoAtributo(alteracao);
      if (!nomes.has(chave)) {
        nomes.set(chave, alteracao.attributeName ?? alteracao.attributeCode ?? "—");
      }
      const porVigencia = porAtributo.get(chave) ?? new Map<string, T[]>();
      const lista = porVigencia.get(vigencia.changeSetId) ?? [];
      lista.push(alteracao);
      porVigencia.set(vigencia.changeSetId, lista);
      porAtributo.set(chave, porVigencia);
    }
  }

  const linhas = [...porAtributo.entries()].map(([chave, porVigencia]) => {
    const celulas = vigencias.map((vigencia): CelulaDaPlaca<T> => {
      const alteracoes = porVigencia.get(vigencia.changeSetId) ?? [];
      if (alteracoes.length === 0) {
        return {
          changeSetId: vigencia.changeSetId,
          rotulo: vigencia.rotulo,
          estado: vigencia.carregando ? "sem-leitura" : "sem-alteracao",
          alteracoes: [],
          pendentes: [],
        };
      }
      const pendentes = alteracoes.filter((a) => !vigencia.justificadas.has(a.id));
      return {
        changeSetId: vigencia.changeSetId,
        rotulo: vigencia.rotulo,
        estado:
          pendentes.length === 0
            ? "justificada"
            : pendentes.length === alteracoes.length
              ? "pendente"
              : "parcial",
        alteracoes,
        pendentes,
      };
    });

    return {
      attributeCode: chave,
      attributeName: nomes.get(chave) ?? chave,
      celulas,
      totalDeAlteracoes: celulas.reduce((soma, c) => soma + c.alteracoes.length, 0),
      pendentes: celulas.reduce((soma, c) => soma + c.pendentes.length, 0),
    };
  });

  const ultimaMexida = (linha: LinhaDaPlaca<T>) =>
    linha.celulas.reduce((maior, celula, indice) => (celula.alteracoes.length > 0 ? indice : maior), -1);

  return linhas.sort(
    (a, b) =>
      ultimaMexida(b) - ultimaMexida(a) ||
      b.pendentes - a.pendentes ||
      b.totalDeAlteracoes - a.totalDeAlteracoes ||
      a.attributeName.localeCompare(b.attributeName, "pt-BR"),
  );
}

export interface ResumoDaPlaca {
  alteracoes: number;
  pendentes: number;
  justificadas: number;
  /** Atributos que mexeram na janela — o número de linhas da grade. */
  atributos: number;
  /** Vigências da janela em que a placa mexeu em alguma coisa. */
  vigenciasComAlteracao: number;
}

/** Os números do topo, somados da mesma grade que a tabela desenha. */
export function resumoDaPlaca(linhas: readonly LinhaDaPlaca[]): ResumoDaPlaca {
  const alteracoes = linhas.reduce((soma, l) => soma + l.totalDeAlteracoes, 0);
  const pendentes = linhas.reduce((soma, l) => soma + l.pendentes, 0);
  const colunas = linhas[0]?.celulas.length ?? 0;
  let vigenciasComAlteracao = 0;
  for (let i = 0; i < colunas; i += 1) {
    if (linhas.some((l) => l.celulas[i].alteracoes.length > 0)) vigenciasComAlteracao += 1;
  }
  return {
    alteracoes,
    pendentes,
    justificadas: alteracoes - pendentes,
    atributos: linhas.length,
    vigenciasComAlteracao,
  };
}

/** As alterações pendentes de uma coluna — o que o "justificar as pendentes" dela manda. */
export function pendentesDaVigencia<T extends AlteracaoDaPlaca>(
  linhas: readonly LinhaDaPlaca<T>[],
  changeSetId: string,
): T[] {
  const pendentes: T[] = [];
  for (const linha of linhas) {
    for (const celula of linha.celulas) {
      if (celula.changeSetId !== changeSetId) continue;
      for (const alteracao of celula.pendentes) pendentes.push(alteracao);
    }
  }
  return pendentes;
}

// ---------------------------------------------------------------------------
// A direção do dinheiro
// ---------------------------------------------------------------------------

export type DirecaoDoImpacto =
  /** Apurado e a favor — o produto pinta ganho de verde em toda parte. */
  | "favoravel"
  /** Apurado e contra. */
  | "desfavoravel"
  /** Apurado e não moveu dinheiro, ou moveu para os dois lados e não há direção única. */
  | "neutro"
  /** A comparação viu a alteração e não conseguiu precificá-la. */
  | "sem-apuracao";

export interface ImpactoDaCelula {
  direcao: DirecaoDoImpacto;
  /** A soma apurada, quando somar é legítimo. `null` quando não é. */
  amount: number | null;
  periodicity: string | null;
  /**
   * A célula tem impactos em periodicidades diferentes — R$/mês e R$/ano não
   * somam (a mesma recusa do Radar), então `amount` fica `null` e só a direção
   * sobrevive, e mesmo assim apenas quando todos os sinais concordam.
   */
  misturado: boolean;
  /** Quantas alterações da célula a comparação não conseguiu precificar. */
  semApuracao: number;
}

/**
 * O dinheiro por trás de uma célula, e para que lado ele foi.
 *
 * Verde é ganho e vermelho é perda no produto inteiro — Dashboard, Gestão à
 * Vista, Planilha de Alterações. A grade da placa nasceu usando verde para
 * "justificada", e as duas leituras se atropelavam na mesma célula: um
 * `5210,40 → 0` verde parecia dizer que zerar o lucro variável foi bom. Aqui a
 * cor volta a significar só uma coisa — a direção do dinheiro —, e o estado da
 * justificativa passa a ser dito por forma (ver `pages/justificativas-placa.
 * tsx`).
 *
 * Três recusas herdadas do resto da casa:
 *
 * 1. **Periodicidade não soma.** Duas alterações na mesma célula, uma mensal e
 *    outra anual, não viram um número só. Sobra a direção, e só quando os
 *    sinais concordam.
 * 2. **Sem preço não é zero.** Uma alteração que a comparação não conseguiu
 *    precificar sai como `"sem-apuracao"`, com a contagem à mão — nunca
 *    pintada como uma alteração que não custou nada.
 * 3. **Zero apurado é uma resposta.** `"neutro"` é a comparação dizendo que
 *    olhou e não achou dinheiro ali; é diferente de não ter olhado.
 */
export function impactoDaCelula(alteracoes: readonly AlteracaoDaPlaca[]): ImpactoDaCelula {
  const apuradas = alteracoes.filter(
    (a) => a.impactConfidence === "CALCULATED" && a.impactAmount !== null,
  );
  const semApuracao = alteracoes.length - apuradas.length;

  if (apuradas.length === 0) {
    return {
      direcao: "sem-apuracao",
      amount: null,
      periodicity: null,
      misturado: false,
      semApuracao,
    };
  }

  const periodicidades = new Set(apuradas.map((a) => a.impactPeriodicity));
  const sinais = new Set(apuradas.map((a) => Math.sign(a.impactAmount ?? 0)));

  if (periodicidades.size > 1) {
    const direcao: DirecaoDoImpacto =
      sinais.size === 1
        ? sinais.has(1)
          ? "favoravel"
          : sinais.has(-1)
            ? "desfavoravel"
            : "neutro"
        : "neutro";
    return { direcao, amount: null, periodicity: null, misturado: true, semApuracao };
  }

  const amount = apuradas.reduce((soma, a) => soma + (a.impactAmount ?? 0), 0);
  return {
    direcao: amount > 0 ? "favoravel" : amount < 0 ? "desfavoravel" : "neutro",
    amount,
    periodicity: apuradas[0].impactPeriodicity,
    misturado: false,
    semApuracao,
  };
}
