/**
 * O Radar de Alterações — a leitura mínima que a grade precisa, e só ela.
 *
 * O Radar desenha unidade × vigência: por célula, quantas alterações houve,
 * quanto de impacto foi apurado naquela periodicidade, e quantas ficaram sem
 * apuração. Ele lia isso de `/changes/range`, que responde a análise **inteira**
 * do intervalo. Medido no seed do produto, com as comparações calculadas:
 *
 *   resposta de /changes/range .... 517.238 B
 *     entries[] ................... 538.276 B (com o `group` inteiro em cada)
 *     byParameter[] ...............  13.474 B
 *     movements[] .................   6.386 B  ← o que a grade usa
 *     gaps[] ......................       2 B  ← o que a grade usa
 *
 * A grade consumia 1,2% do que recebia, uma vez por unidade — 2,5 MB para
 * desenhar 45 células. E não era só tráfego: montar `entries` custa uma
 * consulta de frota por comparação × equipamento e um `buildGroup` por balde,
 * trabalho que a grade nunca olha.
 *
 * Este módulo não filtra a resposta grande: ele **não a produz**. Parte da
 * mesma `baseDoIntervalo` de `getRangeAnalysis` — mesmo contexto, mesmas
 * comparações, mesmo índice de composição — e chama o mesmo
 * `montarMovimentosEGaps`. Os números da grade são, por construção e não por
 * coincidência, os mesmos que a Linha do Tempo mostra para o mesmo intervalo.
 *
 * A gaveta de uma célula (`getRadarDaCelula`) é o outro lado da mesma decisão:
 * ela existe porque, tirando `entries` da grade, o detalhe passou a ser
 * carregado sob demanda — e quando é, também vem projetado no que a tela lê,
 * sem o `group` que responde por quase todo o peso de uma entrada.
 */
import type { Database } from "@workspace/db";
import {
  baseDoIntervalo,
  montarMovimentosEGaps,
  type RangeGap,
  type RangeMovement,
} from "./families-view";
import { buildGroup, groupKey } from "./grouped";
import { placementOf } from "./families";
import type { ContextInfo, RequestedContext } from "./series";

/**
 * A leitura de uma unidade para a grade do Radar.
 *
 * Deliberadamente sem `context`, sem `periods`, sem `totals`: a tela já sabe
 * de que contexto pediu, e as vigências da janela ela própria calculou
 * (`janelaDoRadar`). Devolver de volta o que o chamador mandou é o tipo de
 * gordura que passa despercebida até alguém multiplicá-la por unidade.
 */
export interface RadarDaUnidade {
  from: string;
  to: string;
  movements: RangeMovement[];
  gaps: RangeGap[];
}

export async function getRadarDaUnidade(
  db: Database,
  from?: string,
  to?: string,
  requestedContext?: RequestedContext,
  contextosCarregados?: ContextInfo[],
): Promise<RadarDaUnidade | null> {
  const base = await baseDoIntervalo(db, from, to, requestedContext, contextosCarregados);
  if (!base) return null;

  const { movements, gaps } = montarMovimentosEGaps(base, base.todasAsLinhas);
  return { from: base.inicio, to: base.fim, movements, gaps };
}

/**
 * Um atributo dentro de uma célula, projetado no que a gaveta desenha.
 *
 * `RangeEntry` carrega o `GroupView` inteiro (`group`), que é a lista de
 * veículos, os valores antes e depois, a proveniência — tudo o que a Planilha
 * de alterações mostra e que a gaveta do Radar não abre. São sete campos aqui
 * contra um objeto de alguns kB lá.
 */
export interface EntradaDaCelula {
  period: string;
  parameterKey: string;
  parameterName: string;
  family: string;
  attributeCode: string | null;
  /** `null` quando a comparação viu a mudança e não conseguiu precificá-la. */
  amount: number | null;
  periodicity: string | null;
}

/**
 * Os atributos de **uma** vigência de **uma** unidade.
 *
 * O recorte por vigência é feito aqui, e não na tela, pela mesma razão que o
 * módulo inteiro existe: a alternativa era mandar as oito vigências para
 * desenhar uma. `atributosDaCelula` (na tela) continua agrupando por parâmetro
 * e separando os três lados — a regra de leitura não mudou de lugar, só parou
 * de receber o que não usa.
 */
export async function getRadarDaCelula(
  db: Database,
  period: string,
  from?: string,
  to?: string,
  requestedContext?: RequestedContext,
  contextosCarregados?: ContextInfo[],
): Promise<EntradaDaCelula[] | null> {
  const base = await baseDoIntervalo(db, from, to, requestedContext, contextosCarregados);
  if (!base) return null;

  /*
    Os baldes são os mesmos de `getRangeAnalysis`: uma entrada por
    (vigência, grupo), e **não** uma por linha de mudança.

    A distinção decide um número que a gaveta imprime. `atributosDaCelula`, na
    tela, conta `alteracoes += 1` por entrada recebida — com entradas por grupo
    ela conta grupos, que é o que a coluna sempre mostrou. Trocar por linha
    infla a contagem de uma célula de dez veículos com o mesmo padrão de 1 para
    10, e a gaveta deixaria de fechar com a célula que foi clicada.

    Só as vigências pedidas entram no balde: o intervalo inteiro continua sendo
    lido (é dele que sai `base.dedup`, e recortar antes de deduplicar mudaria o
    dinheiro), mas só a vigência da célula é agrupada e devolvida.
  */
  const baldes = new Map<string, typeof base.todasAsLinhas>();
  for (const row of base.todasAsLinhas) {
    if (base.periodoDoSet.get(row.change_set_id) !== period) continue;
    const chave = groupKey(row);
    const balde = baldes.get(chave);
    if (balde) balde.push(row);
    else baldes.set(chave, [row]);
  }

  return [...baldes.values()].map((linhas) => {
    /*
      `buildGroup` é a régua de verdade, chamada como ela é — reescrever aqui a
      soma do impacto seria a quarta redação de uma regra que este repositório
      já consolidou uma vez (ver o comentário do bloco de impacto em
      `grouped.ts`).

      O mapa de frota vai vazio, e isso é seguro **e** limitado: `fleet` é o
      único campo que ele alimenta, ele cai em `vehicles` quando o mapa não
      responde, e esta projeção não devolve `fleet` — a gaveta do Radar não
      mostra cobertura. `impact.amount` e `impact.periodicity`, que são o que
      sai daqui, não olham a frota em nenhum ramo.
    */
    const grupo = buildGroup(linhas, new Map(), base.dedup);
    const placement = placementOf(grupo.attributeCode);
    return {
      period,
      parameterKey: placement.parameterKey,
      parameterName: placement.parameterKey.split("|").slice(1).join("|"),
      family: placement.family,
      attributeCode: grupo.attributeCode,
      amount: grupo.impact.amount,
      periodicity: grupo.impact.periodicity,
    };
  });
}
