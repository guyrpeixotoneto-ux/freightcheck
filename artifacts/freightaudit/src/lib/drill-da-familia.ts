import type {
  ChangeGroup,
  ExecutiveSummary,
  FamiliesView,
  GroupVehicle,
} from "@/components/inicio/types";
import type { Lado } from "@/lib/visao-geral";

/**
 * O caminho que faltava depois do parâmetro: **em que unidade**, e **em que
 * placa**.
 *
 * A gaveta da família já dizia "Financiamento: −R$ 76.318/mês, 21 alterações
 * em 19 veículos" e parava aí. Quem lê em Visão Geral está olhando a soma de
 * todas as unidades, e as duas perguntas seguintes são sempre as mesmas — *de
 * qual unidade veio essa perda?* e *em qual caminhão, de quanto para quanto?*.
 * Sem elas, a única saída era trocar de tela, reencontrar a unidade, reabrir a
 * mesma família e torcer para o número bater.
 *
 * Este módulo é a conta dos dois degraus, e nada além dela — a tela que os
 * desenha está em `components/inicio/drill-do-parametro.tsx`.
 *
 * **A disciplina é a mesma da gaveta acima**: cada degrau fecha exatamente com
 * o número que ele abriu, e quando não fecha ele **diz** quanto sobrou em vez
 * de deixar quem soma na mão descobrir sozinho. Por isso as duas funções
 * devolvem `resto` ao lado do total: nenhuma delas tem licença para publicar a
 * própria soma no lugar do número que a linha de cima afirma.
 *
 * **E a partição é a mesma do servidor.** O lado de um parâmetro
 * (`ImpactSide`) é somado linha a linha em `families-view.ts` com quatro
 * filtros: impacto apurado (`CALCULATED`), fora da dupla contagem
 * (`foraDoTotal === null`), na periodicidade do lado, e com sinal. `porPlaca`
 * repete esses mesmos quatro — não uma aproximação deles —, que é o que
 * permite a soma das placas fechar com o número do parâmetro daquela unidade.
 */

// ---------------------------------------------------------------------------
// Degrau 1 — por unidade
// ---------------------------------------------------------------------------

/**
 * Uma unidade que pode ser aberta por dentro de um parâmetro.
 *
 * A forma é a mesma nas duas leituras do Dashboard, de propósito: em Visão
 * Geral cada `OverviewUnitIncluded` vira uma destas; dentro de uma unidade a
 * lista tem um item só, montado sobre a própria vigência aberta. O clique faz
 * a mesma coisa nos dois lugares, e a tela não precisa saber de qual delas
 * veio.
 */
export interface UnidadeDoDrill {
  /** O código da unidade — `scopeHash` quando ela não tem escopo `UNIDADE`. */
  chave: string;
  label: string;
  /**
   * Os contextos desta unidade nesta competência — mais de um quando ela tem
   * canais separados.
   *
   * Viajam porque o degrau seguinte (as placas) só existe **dentro de um
   * contexto**: a lista de veículos de um grupo pedida sem `scopeHash` cai em
   * `contexts[0]` e devolve placas de outra unidade, com o sinal trocado. Ver
   * `paramsDosVeiculosDoGrupo` em `lib/recorte.ts`, que é quem monta esse
   * endereço para o produto inteiro.
   */
  contexts: { scopeHash: string; channel: string | null }[];
  /** O resumo executivo **desta unidade sozinha** — de onde sai o número dela. */
  summary: ExecutiveSummary;
}

export interface LinhaDeUnidade {
  chave: string;
  label: string;
  contexts: { scopeHash: string; channel: string | null }[];
  /** O que este parâmetro fez **neste lado** nesta unidade. */
  amount: number;
  changes: number;
  vehicles: number;
  /** Do maior da lista: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
}

export interface AberturaPorUnidade {
  linhas: LinhaDeUnidade[];
  /** A soma das unidades. */
  total: number;
  /** O número que a linha de cima afirma — o do parâmetro na gaveta. */
  esperado: number;
  /**
   * O que a soma das unidades não explica.
   *
   * Zero é o caso normal: a Visão Geral soma unidade a unidade, então a soma
   * das parcelas *é* o total. Fica exposto porque uma unidade excluída da
   * consolidação (ver `unitsExcluded`) ou uma resposta de cache mais velha
   * fariam os dois divergirem — e um degrau que esconde a diferença entre a
   * sua conta e o número que ele explica é pior do que não ter degrau.
   */
  resto: number;
}

const arredondar = (valor: number) => Number(valor.toFixed(2));

/**
 * Em que unidades este parâmetro se mexeu, deste lado, nesta periodicidade.
 *
 * Lê `summary.sides` de cada unidade — a mesma estrutura, com os mesmos
 * filtros, que produziu o número somado lá em cima. Não pede nada ao servidor:
 * a Visão Geral já traz o resumo de cada unidade dentro da resposta que
 * desenhou o pódio, e um segundo pedido seria uma segunda vigência possível.
 *
 * Unidade sem este parâmetro **deste lado** fica de fora da lista, e não entra
 * com R$ 0: zero apurado e ausência não são a mesma coisa em lugar nenhum
 * deste produto.
 */
export function unidadesDoParametro(
  unidades: UnidadeDoDrill[],
  {
    parameterKey,
    periodicity,
    lado,
    esperado,
  }: { parameterKey: string; periodicity: string; lado: Lado; esperado: number },
): AberturaPorUnidade {
  const cruas = unidades.flatMap((unidade) => {
    const side = unidade.summary.sides.find((s) => s.periodicity === periodicity);
    const contribuicao = (lado === "ganhos" ? side?.gains : side?.losses)?.parameters.find(
      (p) => p.key === parameterKey,
    );
    if (!contribuicao) return [];
    return [
      {
        chave: unidade.chave,
        label: unidade.label,
        contexts: unidade.contexts,
        amount: contribuicao.amount,
        changes: contribuicao.changes,
        vehicles: contribuicao.vehicles,
      },
    ];
  });

  const teto = cruas.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);
  const total = arredondar(cruas.reduce((soma, l) => soma + l.amount, 0));

  return {
    linhas: cruas
      .map((l) => ({ ...l, proporcao: teto === 0 ? 0 : Math.abs(l.amount) / teto }))
      .sort(
        (a, b) =>
          Math.abs(b.amount) - Math.abs(a.amount) ||
          a.label.localeCompare(b.label, "pt-BR"),
      ),
    total,
    esperado,
    resto: arredondar(esperado - total),
  };
}

// ---------------------------------------------------------------------------
// Degrau 2 — por placa, antes e depois
// ---------------------------------------------------------------------------

/**
 * Os grupos de um parâmetro que compõem **esta** periodicidade.
 *
 * Mesmo filtro de `detalheDoImpacto`: um grupo tem uma periodicidade só, e um
 * grupo sem valor apurado não tem placa a somar. É por estes grupos que as
 * placas são pedidas, uma leitura de veículos por grupo — o mesmo nível 2 que o
 * Acompanhamento já abre, pelo mesmo endereço e com o mesmo contexto (ver
 * `paramsDosVeiculosDoGrupo`).
 */
export function gruposDoParametro(
  view: Pick<FamiliesView, "families"> | null | undefined,
  parameterKey: string,
  periodicity: string,
): ChangeGroup[] {
  const parametro = view?.families
    .flatMap((f) => f.parameters)
    .find((p) => p.key === parameterKey);
  if (!parametro) return [];
  return parametro.groups.filter(
    (g) => g.impact.periodicity === periodicity && g.impact.amount !== null,
  );
}

export interface LinhaDePlaca {
  changeId: number;
  plate: string;
  /** O que mudou nesta placa: o título do grupo (atributo × equipamento). */
  titulo: string;
  /** BRL | PERCENT | KM_L | … — a coluna formata por isto, nunca por palpite. */
  unit: string | null;
  /** As duas pontas cruas — a tela formata pelo `unit`, nunca por palpite. */
  numericAntes: number | null;
  numericDepois: number | null;
  /** O texto como veio da planilha, para o que não tem número. */
  textoAntes: string | null;
  textoDepois: string | null;
  deltaPercent: number | null;
  amount: number;
  /** Do maior da lista: 0 a 1. */
  proporcao: number;
}

export interface AberturaPorPlaca {
  linhas: LinhaDePlaca[];
  total: number;
  esperado: number;
  resto: number;
  /**
   * Linhas dos mesmos grupos que **não** entram neste número, e por quê.
   *
   * Nada some: uma alteração sem preço apurado, uma que já está contada nas
   * parcelas de outra, e uma que andou para o outro lado continuam existindo
   * dentro do parâmetro — só não compõem o número deste lado. Ditas pelo nome
   * e contadas, porque a alternativa é alguém abrir a tabela do grupo, contar
   * mais linhas do que aqui, e não ter como saber qual das duas acreditar.
   */
  foraDesteLado: { outroLado: number; semPreco: number; jaContadas: number };
}

/**
 * Uma linha por placa e atributo, com o antes e o depois de cada uma.
 *
 * Uma linha por **alteração**, e não por placa: o mesmo caminhão pode ter dois
 * atributos do mesmo parâmetro mexendo na mesma vigência (juros e amortização
 * são os dois "Financiamento"), e somá-los numa linha só apagaria justamente o
 * "de quanto para quanto" que este degrau existe para mostrar. A placa se
 * repete, e a coluna do lado diz o que mudou nela.
 *
 * O valor exibido de cada lado é o **texto original da planilha** quando não há
 * número — nada é convertido nem estimado aqui, exatamente como na tabela de
 * veículos do Acompanhamento.
 */
export function porPlaca(
  entradas: { grupo: ChangeGroup; veiculos: GroupVehicle[] }[],
  {
    periodicity,
    lado,
    esperado,
  }: { periodicity: string; lado: Lado; esperado: number },
): AberturaPorPlaca {
  const fora = { outroLado: 0, semPreco: 0, jaContadas: 0 };
  const cruas: Omit<LinhaDePlaca, "proporcao">[] = [];

  for (const { grupo, veiculos } of entradas) {
    for (const veiculo of veiculos) {
      // Fora da dupla contagem antes de tudo: uma linha já contada nas
      // parcelas não é "sem preço" nem "do outro lado" — ela tem valor e um
      // lugar, e o lugar não é este.
      if (veiculo.foraDoTotal !== null) {
        fora.jaContadas++;
        continue;
      }
      if (veiculo.impactConfidence !== "CALCULATED" || veiculo.impactAmount === null) {
        fora.semPreco++;
        continue;
      }
      if (veiculo.impactPeriodicity !== periodicity) continue;
      const amount = veiculo.impactAmount;
      // Zero não é lado nenhum — a mesma regra da varredura do servidor.
      if (amount === 0) continue;
      const doLado = amount > 0 ? "ganhos" : "perdas";
      if (doLado !== lado) {
        fora.outroLado++;
        continue;
      }
      cruas.push({
        changeId: veiculo.changeId,
        plate: veiculo.plate ?? "(sem placa)",
        titulo: grupo.title,
        unit: grupo.unit,
        numericAntes: veiculo.numericBefore,
        numericDepois: veiculo.numericAfter,
        textoAntes: veiculo.valueBefore,
        textoDepois: veiculo.valueAfter,
        deltaPercent: veiculo.deltaPercent,
        amount,
      });
    }
  }

  const teto = cruas.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);
  const total = arredondar(cruas.reduce((soma, l) => soma + l.amount, 0));

  return {
    linhas: cruas
      .map((l) => ({ ...l, proporcao: teto === 0 ? 0 : Math.abs(l.amount) / teto }))
      .sort(
        (a, b) =>
          Math.abs(b.amount) - Math.abs(a.amount) || a.plate.localeCompare(b.plate, "pt-BR"),
      ),
    total,
    esperado,
    resto: arredondar(esperado - total),
    foraDesteLado: fora,
  };
}
