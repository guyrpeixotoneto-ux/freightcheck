import type { Database } from "@workspace/db";
import {
  getPanoramaDeAlteracoes,
  equipmentLabel,
  medirAlteracoesDoAtivo,
  type ContextInfo,
  type ParametroAlterado,
  type RequestedContext,
} from "@workspace/comparison";
import { comportamentoDe } from "@workspace/knowledge";
import {
  avaliarParametro,
  ordenarPorPrioridade,
  type Recomendacao,
  type SituacaoDaRecomendacao,
} from "./recomendacao";
import { medirTransicoes } from "./transicoes";

/**
 * A aba Cliente — **o subconjunto do Impacto que merece uma conversa**.
 *
 * A cadeia inteira em uma linha: `Impacto identifica → semântica interpreta →
 * Cliente recomenda`. Este motor é o terceiro elo e não refaz nenhum dos dois
 * primeiros. O universo vem de `getPanoramaDeAlteracoes` — com as exclusões de
 * parcela e de conjunto já aplicadas, para que o mesmo real não seja levado
 * duas vezes à mesa —, a leitura econômica vem de `@workspace/knowledge`, e o
 * que este arquivo faz é juntar os dois e contar.
 *
 * **Nada aqui soma dinheiro por conta própria.** O impacto de cada linha é o
 * `variacao.preco` que o panorama apurou sob o portão de semântica, e a
 * projeção mensal/anual passa inteira por `convertPeriodicity`. Um total novo
 * calculado aqui seria uma segunda verdade financeira esperando para divergir
 * da primeira — é a regra que `coverage` e `dre` já respeitam do outro lado do
 * produto.
 *
 * **Os totais separam mensal de anual e nunca os somam.** R$ 731 mil por ano de
 * IPVA e R$ 52 mil por mês de FINAME não cabem no mesmo número, e juntá-los
 * seria o erro que este produto existe para pegar.
 *
 * **Os dois recortes desta leitura não são a mesma coisa.** O equipamento
 * escolhe de que população se fala; a placa escolhe apenas *quais parâmetros são
 * assunto* — os que se moveram naquele ativo —, e deixa intactos o alcance, o
 * impacto e a evidência de cada um, que continuam sendo os da frota. É o que
 * permite a uma tela `Cavalo 360° · QYP3G72` listar só o que mexeu naquele
 * cavalo sem transformar "caiu em 41 veículos" em "caiu em 1" — ver
 * {@link medirAlteracoesDoAtivo}.
 */

/** Um total por periodicidade — a única forma honesta de somar aqui. */
export interface TotalPorPeriodicidade {
  periodicity: string | null;
  /** Tudo que se moveu e tem leitura econômica, em módulo. */
  identificado: number;
  /** Só o que está em PROPOR_AJUSTE, em módulo. */
  recuperavel: number;
  /** Só o que está em INVESTIGAR, em módulo. */
  emInvestigacao: number;
}

export interface TotaisDoCliente {
  porPeriodicidade: TotalPorPeriodicidade[];
  propor: number;
  investigar: number;
  naoPropor: number;
  naoCalculavel: number;
  /** Linhas econômicas analisadas — o denominador de tudo acima. */
  analisadas: number;
  /** Ativos distintos alcançados pela maior recomendação de cada situação. */
  veiculosAlcancados: number;
  /**
   * Quanto do dinheiro que se moveu tem leitura econômica declarada, em
   * porcento. Zero denominador devolve `null`, e não 100%: "não havia nada a
   * explicar" e "explicamos tudo" não são a mesma frase.
   */
  percentualExplicado: number | null;
}

export interface RecomendacoesAoCliente {
  context: ContextInfo;
  /** As vigências lidas, da mais antiga à mais recente. */
  periods: { effectiveDate: string; sourceLabel: string; entityTypes: string[] }[];
  /** Os equipamentos que este contexto entregou — os botões da tela. */
  entityTypes: string[];
  /** O equipamento em foco, ou `null` quando a leitura é da frota inteira. */
  entityType: string | null;
  equipment: string | null;
  /**
   * A placa que estreitou a lista, ou `null` quando a pauta é do equipamento
   * inteiro — inclusive quando veio uma placa que este recorte não tem.
   *
   * Volta nomeada porque a diferença muda o que a tela pode afirmar: "estes são
   * os parâmetros que mudaram no QYP3G72" e "esta é a pauta dos cavalos" são
   * duas frases, e mostrar a segunda com a cara da primeira é o erro que a tela
   * 360° existe para não cometer.
   */
  placa: string | null;
  recomendacoes: Recomendacao[];
  totais: TotaisDoCliente;
  /**
   * As colunas de conjunto, que ficam fora da conta porque já contêm o outro
   * equipamento. Vêm nomeadas em vez de sumirem: quem procura o `custoFixo` da
   * carreta precisa achar a razão de ele não estar na lista.
   */
  foraDaConta: { code: string; title: string; porque: string }[];
}

export interface OpcoesDoCliente {
  /**
   * Unidade, canal e o recorte de vigências — os mesmos de Impacto, e pela
   * mesma autoridade. A janela viaja dentro do contexto resolvido e chega às
   * consultas por `contextFilter`; nada aqui a reconstrói.
   */
  context?: RequestedContext;
  /** Recorta por equipamento, como a aba Impacto. */
  entityType?: string;
  /**
   * A placa da tela 360°, quando ela desceu a um ativo.
   *
   * Estreita **quais** parâmetros entram na lista — os que se moveram naquele
   * ativo —, e nada além disso: o alcance, o impacto e a evidência de cada item
   * continuam sendo os da frota, porque é a abrangência que sustenta o pedido.
   * Ver {@link medirAlteracoesDoAtivo}, onde a separação está argumentada.
   */
  placa?: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * As recomendações do contexto.
 *
 * Devolve `null` quando não há vigência nenhuma — a rota traduz em 404 e a tela
 * mostra o convite a importar, em vez de uma lista vazia que se pareceria com
 * "não há nada a discutir com o cliente".
 */
export async function getRecomendacoesAoCliente(
  db: Database,
  options: OpcoesDoCliente = {},
): Promise<RecomendacoesAoCliente | null> {
  const panorama = await getPanoramaDeAlteracoes(db, { context: options.context });
  if (!panorama) return null;

  const porCodigo = new Map(panorama.parametros.map((p) => [p.code, p]));
  const entityTypes = [
    ...new Set(panorama.periods.flatMap((p) => p.entityTypes)),
  ].sort();

  /*
    O recorte por equipamento é filtro da lista já pronta, e não uma segunda
    leitura: refazer o panorama por equipamento traria de volta as parcelas cujo
    total está no outro equipamento, e a carreta passaria a listar o cavalo
    inteiro. É a mesma decisão que o corte por classe de custo tomou lá.
  */
  const foco =
    options.entityType && entityTypes.includes(options.entityType)
      ? options.entityType
      : null;

  /*
    O recorte por ativo, que é de outra natureza: ele não troca a leitura de
    nenhum item, só decide quais itens são assunto desta tela. Uma placa que
    este recorte não tem devolve `placa: null` e a pauta segue a do equipamento
    — a mesma recusa a transformar escolha inválida em erro que o `entityType`
    pratica logo acima, e a resposta diz qual dos dois casos é.
  */
  const ativo =
    options.placa === undefined || options.placa.trim() === ""
      ? null
      : await medirAlteracoesDoAtivo(db, panorama.context, options.placa);
  const noAtivo = (code: string) =>
    ativo === null || ativo.placa === null || ativo.codigos.has(code);

  const linhas: ParametroAlterado[] = panorama.maisAlterados
    .map((code) => porCodigo.get(code))
    .filter((p): p is ParametroAlterado => p !== undefined)
    .filter((p) => foco === null || p.entityType === foco)
    .filter((p) => noAtivo(p.code));

  const transicoes = await medirTransicoes(
    db,
    panorama.context,
    linhas.map((p) => p.code),
  );

  const recomendacoes = ordenarPorPrioridade(
    linhas.map((parametro) =>
      avaliarParametro({
        parametro,
        comportamento: comportamentoDe(parametro.code),
        transicoes: transicoes.get(parametro.code) ?? null,
      }),
    ),
  );

  const foraDaConta = panorama.visaoDeConjunto
    .map((code) => porCodigo.get(code))
    .filter((p): p is ParametroAlterado => p !== undefined)
    .filter((p) => foco === null || p.entityType === foco)
    .filter((p) => noAtivo(p.code))
    .map((p) => ({
      code: p.code,
      title: p.title,
      porque:
        p.contem !== null
          ? `Já contém ${p.contem}: levar esta linha e a do outro equipamento ` +
            `seria discutir o mesmo dinheiro duas vezes.`
          : "Coluna de conjunto — o valor cobre cavalo e carreta juntos.",
    }));

  return {
    context: panorama.context,
    periods: panorama.periods,
    entityTypes,
    entityType: foco,
    equipment: foco === null ? null : equipmentLabel(foco),
    placa: ativo?.placa ?? null,
    recomendacoes,
    totais: totalizar(recomendacoes),
    foraDaConta,
  };
}

/**
 * Os números do topo.
 *
 * Três decisões que valem ser ditas: o dinheiro é somado **em módulo**, porque
 * a pergunta do topo é "quanto está em jogo" e uma perda de R$ 50 mil com um
 * ganho de R$ 50 mil não é zero em jogo; as periodicidades **nunca** se somam;
 * e `percentualExplicado` compara o dinheiro com leitura econômica contra o
 * dinheiro apurado — é a métrica que diz se a aba está respondendo à pergunta
 * ou apenas listando o que sabe responder.
 */
export function totalizar(recs: Recomendacao[]): TotaisDoCliente {
  const conta = (s: SituacaoDaRecomendacao) =>
    recs.filter((r) => r.situacao === s).length;

  const periodicidades = [
    ...new Set(recs.filter((r) => r.impacto !== null).map((r) => r.impacto!.periodicidade)),
  ];
  const ORDEM = ["MENSAL", "ANUAL", "PONTUAL"];
  const ordem = (p: string | null) => {
    const i = ORDEM.indexOf(p ?? "");
    return i === -1 ? ORDEM.length : i;
  };

  const somaDe = (
    filtro: (r: Recomendacao) => boolean,
    periodicity: string | null,
  ) =>
    round2(
      recs
        .filter(
          (r) =>
            r.impacto !== null &&
            r.impacto.periodicidade === periodicity &&
            filtro(r),
        )
        .reduce((s, r) => s + Math.abs(r.impacto!.valor), 0),
    );

  const porPeriodicidade = periodicidades
    .sort((a, b) => ordem(a) - ordem(b))
    .map((periodicity) => ({
      periodicity,
      identificado: somaDe(() => true, periodicity),
      recuperavel: somaDe((r) => r.situacao === "PROPOR_AJUSTE", periodicity),
      emInvestigacao: somaDe((r) => r.situacao === "INVESTIGAR", periodicity),
    }));

  const comImpacto = recs.filter((r) => r.impacto !== null);
  const totalApurado = comImpacto.reduce((s, r) => s + Math.abs(r.impacto!.valor), 0);
  const comLeitura = comImpacto
    .filter((r) => r.sentido !== null)
    .reduce((s, r) => s + Math.abs(r.impacto!.valor), 0);

  return {
    porPeriodicidade,
    propor: conta("PROPOR_AJUSTE"),
    investigar: conta("INVESTIGAR"),
    naoPropor: conta("NAO_PROPOR"),
    naoCalculavel: conta("NAO_CALCULAVEL"),
    analisadas: recs.length,
    veiculosAlcancados: Math.max(
      0,
      ...recs
        .filter((r) => r.situacao === "PROPOR_AJUSTE" || r.situacao === "INVESTIGAR")
        .map((r) => r.veiculosAfetados),
    ),
    percentualExplicado:
      totalApurado === 0 ? null : Math.round((comLeitura / totalApurado) * 1000) / 10,
  };
}
