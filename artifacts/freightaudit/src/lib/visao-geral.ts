import type { BalancoResumo } from "@/components/balanco/tipos";
import type {
  ChangeGroup,
  ExecutiveSummary,
  FamiliesView,
  GroupedView,
} from "@/components/inicio/types";
import { juntarPrioridades } from "@/lib/cockpit";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  linkDeAlteracoes,
  RECORTE_VAZIO,
  type FiltrosDeLinha,
  type Recorte,
} from "@/lib/recorte";

/**
 * A aritmética da Visão geral, fora do JSX.
 *
 * Esta tela é a única do produto que responde antes de perguntar: quem abre não
 * escolheu nada ainda, e mesmo assim recebe cinco números grandes. Isso a torna
 * a tela onde um número errado custa mais caro — ele será lido primeiro, por
 * quem tem menos contexto, e repetido numa reunião antes de alguém abrir o
 * detalhe.
 *
 * Daí duas decisões que valem para tudo o que está aqui:
 *
 * 1. **Toda função devolve `null` quando o dado não existe**, e nunca zero. Um
 *    "0%" de cobertura num banco sem importação nenhuma é a descrição de uma
 *    conferência catastrófica; a verdade é que conferência nenhuma aconteceu, e
 *    o cartão que recebe `null` some em vez de mentir.
 * 2. **Periodicidade nunca soma.** R$/mês e R$/ano saem em linhas próprias, e
 *    o ranking de impacto acontece *dentro* de uma periodicidade — nunca entre
 *    elas. É a mesma recusa do Acompanhamento e dos Parâmetros; se ela cair
 *    aqui, cai no lugar mais visível do produto.
 * 3. **Número que se abre leva o recorte junto.** Cada endereço que sai daqui
 *    carrega a unidade e a vigência que produziram o número, e o filtro que
 *    reproduz exatamente a população contada. Um "244 alterações sem preço" que
 *    abrisse uma lista de 1.100 na vigência errada não seria um atalho: seria
 *    uma contradição entre duas telas do mesmo produto, e quem visse as duas não
 *    teria como saber qual acreditar. A gramática desses endereços mora em
 *    `lib/recorte.ts`; o que cada número tem a dizer nela, aqui.
 *
 * Nada neste arquivo lê a rede. As entradas são exatamente os JSON que as rotas
 * devolvem, o que deixa cada conta legível ao lado do contrato que a alimenta.
 */

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

export interface Impacto {
  /** `null` quando a fonte não declarou periodicidade — o sufixo some, o valor fica. */
  periodicity: string | null;
  amount: number;
}

/**
 * O impacto da vigência, por periodicidade, o maior em módulo primeiro.
 *
 * A ordem é por módulo e não por sinal: o que decide a atenção de quem lê é o
 * tamanho do número, e uma vigência pode muito bem ter o maior movimento a
 * favor.
 */
export function impactosDaVigencia(view: GroupedView): Impacto[] {
  return Object.entries(view.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** `- R$ 39.936/mês` — o valor com a periodicidade colada, como as outras telas escrevem. */
export function escreverImpacto(impacto: Impacto): string {
  return `${formatBrlShort(impacto.amount)}${periodicitySuffix(impacto.periodicity)}`;
}

/**
 * O mesmo valor, partido em dois — para quando o dinheiro é grande e a
 * periodicidade precisa ficar menor ao lado dele.
 *
 * A periodicidade nunca some nessa redução de corpo: é ela que diz se aquele
 * número acontece toda vez ou uma vez só, e um "R$ 39.936" sem o "/mês" é a
 * mesma frase com outro significado.
 */
export function partesDoImpacto(impacto: Impacto): { valor: string; sufixo: string } {
  return {
    valor: formatBrlShort(impacto.amount),
    sufixo: periodicitySuffix(impacto.periodicity),
  };
}

/**
 * A vigência imediatamente anterior à aberta — `null` quando ela é a primeira.
 *
 * Sai da lista de vigências que a própria resposta traz, e não de um segundo
 * pedido ao servidor: a comparação "vs vigência anterior" só existe quando há
 * anterior, e descobrir isso antes de perguntar evita um 404 que a tela teria
 * de esconder.
 */
export function vigenciaAnterior(
  view: GroupedView | null | undefined,
): { date: string; label: string } | null {
  if (!view) return null;
  const anteriores = view.periods
    .filter((p) => p.date < view.period)
    .sort((a, b) => a.date.localeCompare(b.date));
  return anteriores.length === 0 ? null : anteriores[anteriores.length - 1];
}

/**
 * Quanto um número cresceu em relação ao de antes, em porcento.
 *
 * `null` quando não há base: sem vigência anterior não há variação, e com
 * anterior igual a zero a divisão daria infinito — que na tela vira um "+∞%"
 * que ninguém sabe ler. Nos dois casos a linha some.
 */
export function variacao(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

/** `+23%` / `−12%`. Sem casas decimais: é comparação de grandeza, não medição. */
export function escreverVariacao(percentual: number): string {
  const sinal = percentual > 0 ? "+" : percentual < 0 ? "−" : "";
  return `${sinal}${Math.abs(percentual).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })}%`;
}

/** A parte de um todo, em porcento. `null` sem denominador — nunca 0%. */
export function participacao(parte: number, todo: number): number | null {
  if (todo <= 0) return null;
  return (parte / todo) * 100;
}

/** `32%` — arredondado ao inteiro, que é a precisão que uma proporção destas tem. */
export function escreverPercentual(percentual: number, casas = 0): string {
  return `${percentual.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })}%`;
}

/**
 * A frota que a vigência entregou.
 *
 * Sai do cockpit, e não de uma soma das séries feita aqui: o Acompanhamento lê
 * esse mesmo campo, e duas telas do mesmo produto dizendo frotas diferentes
 * para a mesma vigência é o defeito que custa a confiança nas duas.
 */
export function frotaTotal(view: GroupedView): number {
  return view.cockpit.kpis.fleet;
}

// ---------------------------------------------------------------------------
// Cobertura e integridade — o que vem do Balanço de Massa
// ---------------------------------------------------------------------------

export interface Cobertura {
  /** Quanto do que os arquivos trouxeram a auditoria de fato cobre. */
  percentual: number;
  celulas: number;
  foraDaAuditoria: number;
  importacoes: number;
}

/**
 * Cobertura auditada: **as células que o arquivo trouxe e a auditoria alcança**.
 *
 * A conta é `1 − (perda + resíduo) ÷ entrada`, e cada termo tem um motivo:
 *
 * - **Perda declarada** é o que o arquivo trazia e o sistema não aproveitou.
 *   Está declarada, mas continua sendo dado que a auditoria não enxerga — então
 *   não conta como coberto.
 * - **Resíduo** é massa que sumiu sem destino conhecido. Se o resíduo entrasse
 *   na cobertura, o defeito mais grave que este produto sabe encontrar seria o
 *   que mais aumentaria o número de qualidade.
 * - **Descarte declarado e outro papel** contam como cobertos: a célula saiu por
 *   regra escrita, ou virou cabeçalho, vigência e identidade do equipamento —
 *   ela foi usada, e nenhuma informação se perdeu no caminho.
 *
 * Não é percentual de dinheiro, e o rótulo da tela diz isso: é percentual de
 * célula de planilha. Chamar de "% do valor importado" seria dar a um número de
 * massa a autoridade de um número de remuneração.
 */
export function cobertura(balancos: BalancoResumo[] | null | undefined): Cobertura | null {
  if (!balancos || balancos.length === 0) return null;

  const celulas = balancos.reduce((total, b) => total + b.entrada, 0);
  if (celulas === 0) return null;

  const foraDaAuditoria = balancos.reduce(
    (total, b) => total + b.porNatureza.PERDA + b.porNatureza.RESIDUO,
    0,
  );

  return {
    percentual: ((celulas - foraDaAuditoria) / celulas) * 100,
    celulas,
    foraDaAuditoria,
    importacoes: balancos.length,
  };
}

export interface Integridade {
  ok: boolean;
  titulo: string;
  detalhe: string;
}

/**
 * A conservação da importação, reduzida a uma linha.
 *
 * Os três desfechos são os mesmos do Balanço de Massa, na mesma ordem de
 * gravidade: célula sem destino, importação que não fecha, e a conta fechada.
 * Reduzir os três a "ok / não ok" seria perder justamente a distinção entre
 * "sumiu massa" e "o que está gravado não é o que a importação disse ter
 * capturado" — que mandam procurar em lugares diferentes.
 */
export function integridade(balancos: BalancoResumo[] | null | undefined): Integridade | null {
  if (!balancos || balancos.length === 0) return null;

  const residuo = balancos.reduce((total, b) => total + b.residuo, 0);
  if (residuo > 0) {
    return {
      ok: false,
      titulo: "Massa sem destino",
      detalhe: `${inteiro(residuo)} ${residuo === 1 ? "célula" : "células"} sem destino`,
    };
  }

  const naoFecham = balancos.filter((b) => !b.fecha).length;
  if (naoFecham > 0) {
    return {
      ok: false,
      titulo: "Importação não fecha",
      detalhe: `${inteiro(naoFecham)} ${
        naoFecham === 1 ? "importação não fecha" : "importações não fecham"
      }`,
    };
  }

  return {
    ok: true,
    titulo: "Integridade dos dados",
    detalhe: "Nenhuma célula sem destino",
  };
}

// ---------------------------------------------------------------------------
// A última importação
// ---------------------------------------------------------------------------

/** O que a Visão geral lê de `GET /imports`. O resto da linha é da tela de Importações. */
export interface ExecucaoDeImportacao {
  importRunId: string;
  status: string;
  filename: string;
  receivedAt: string;
}

export interface UltimaImportacao {
  quando: Date;
  /** `há 2h` — a distância até agora, escrita como se fala. */
  relativo: string;
  /** `10:42` — a hora do relógio, que é o que se procura ao conferir um envio. */
  hora: string;
  filename: string;
  status: string;
}

/**
 * A importação mais recente que chegou ao canônico.
 *
 * Só entram execuções promovidas. Um arquivo recebido às 10h e recusada a
 * promoção às 10h02 não é "a última importação" de nada — nenhum número desta
 * tela veio dele —, e anunciá-lo faria a pessoa concluir que os dados já
 * incluem o que ela acabou de mandar.
 */
export function ultimaImportacao(
  execucoes: ExecucaoDeImportacao[] | null | undefined,
  agora: Date = new Date(),
): UltimaImportacao | null {
  const promovidas = (execucoes ?? []).filter((e) => e.status === "PROMOTED");
  if (promovidas.length === 0) return null;

  const ultima = promovidas.reduce((maior, atual) =>
    atual.receivedAt > maior.receivedAt ? atual : maior,
  );
  const quando = new Date(ultima.receivedAt);
  if (Number.isNaN(quando.getTime())) return null;

  return {
    quando,
    relativo: tempoRelativo(quando, agora),
    hora: quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    filename: ultima.filename,
    status: ultima.status,
  };
}

/**
 * Quanto tempo faz, em português de conversa.
 *
 * Passa de uma semana e vira data: "há 43 dias" obriga quem lê a fazer a conta
 * de volta para saber de que mês se trata, que é justamente a pergunta.
 */
export function tempoRelativo(quando: Date, agora: Date = new Date()): string {
  const minutos = Math.floor((agora.getTime() - quando.getTime()) / 60_000);
  if (minutos < 0) return "agora há pouco";
  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias <= 7) return `há ${dias} dias`;
  return `em ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
}

// ---------------------------------------------------------------------------
// Maiores impactos
// ---------------------------------------------------------------------------

export interface LinhaDeImpacto {
  key: string;
  name: string;
  familyName: string;
  amount: number;
  /** Do maior do ranking: 0 a 1. É o comprimento da barra, e nada mais. */
  proporcao: number;
}

export interface RankingDeImpacto {
  periodicity: string;
  linhas: LinhaDeImpacto[];
  /** As periodicidades que ficaram de fora, e que a tela precisa nomear. */
  outras: string[];
}

/**
 * Os parâmetros que mais mexeram na remuneração — **dentro de uma
 * periodicidade só**.
 *
 * Uma barra ao lado da outra é uma afirmação de comparabilidade. Enfileirar
 * "−R$ 18.420/mês" e "+R$ 5.240/ano" na mesma escala diria que o segundo é
 * pequeno perto do primeiro, quando a verdade é que os dois não se comparam sem
 * uma conversão que este produto se recusa a fazer no escuro.
 *
 * Então o ranking escolhe a periodicidade que contém o maior movimento da
 * vigência, ordena dentro dela, e devolve em `outras` o nome das que ficaram de
 * fora — para que a tela diga que elas existem em vez de deixá-las sumir.
 */
export function maioresImpactos(
  summary: ExecutiveSummary | null | undefined,
  limite = 3,
): RankingDeImpacto | null {
  const parametros = summary?.topParameters ?? [];
  if (parametros.length === 0) return null;

  const porPeriodicidade = new Map<string, number>();
  for (const parametro of parametros) {
    for (const [periodicidade, valor] of Object.entries(parametro.byPeriodicity)) {
      const maior = porPeriodicidade.get(periodicidade) ?? 0;
      porPeriodicidade.set(periodicidade, Math.max(maior, Math.abs(valor)));
    }
  }
  if (porPeriodicidade.size === 0) return null;

  const [dominante] = [...porPeriodicidade.entries()].sort((a, b) => b[1] - a[1])[0];
  const teto = porPeriodicidade.get(dominante) ?? 0;
  if (teto === 0) return null;

  const linhas = parametros
    .filter((p) => p.byPeriodicity[dominante] !== undefined)
    .map((p) => ({
      key: p.key,
      name: p.name,
      familyName: p.familyName,
      amount: p.byPeriodicity[dominante],
      proporcao: Math.abs(p.byPeriodicity[dominante]) / teto,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, limite);

  return {
    periodicity: dominante,
    linhas,
    outras: [...porPeriodicidade.keys()].filter((p) => p !== dominante),
  };
}

// ---------------------------------------------------------------------------
// Maior abrangência
// ---------------------------------------------------------------------------

export interface LinhaDeAbrangencia {
  key: string;
  name: string;
  equipment: string;
  /** Ativos distintos deste equipamento com esta alteração. */
  vehicles: number;
  /** A frota do equipamento a que o parâmetro pertence. */
  fleet: number;
  /** `vehicles / fleet` em pontos percentuais; `null` sem frota conhecida. */
  percent: number | null;
  href: string;
}

/**
 * Os parâmetros que alcançaram mais ativos — **e isto não é um ranking de
 * dinheiro**.
 *
 * Existe porque o pódio de impacto some inteiro quando nenhuma coluna tem
 * semântica confirmada, e some justamente nas vigências em que há mais o que
 * olhar: 20 parâmetros mexidos, 62 cavalos tocados, e um painel vazio no lugar
 * mais nobre da tela. O vazio era honesto — sem preço não há ranking de preço —
 * e ainda assim deixava a pessoa sem a única ordenação que aquele dado
 * sustenta.
 *
 * **O que ele não faz é virar substituto silencioso.** Abrangência e impacto
 * respondem perguntas diferentes: "em quantos ativos isto aconteceu" não é "o
 * que isto custou", e um parâmetro que mudou em toda a frota pode valer zero.
 * Por isso esta lista sai com nome próprio e título próprio na tela — nunca
 * debaixo de "Maiores impactos", que é onde ela seria lida como dinheiro por
 * quem passa o olho. A troca de título é a peça que impede a leitura errada; a
 * função só entrega o dado.
 *
 * A régua é a proporção da frota, e não a contagem: 15 de 15 carretas é
 * alcance total, e 15 de 62 cavalos é um quarto. Ordenar por contagem crua
 * poria o segundo na frente do primeiro em toda vigência com frotas de tamanhos
 * diferentes.
 */
export function maiorAbrangencia(
  view: GroupedView,
  limite = 3,
  recorte: Recorte = RECORTE_VAZIO,
): LinhaDeAbrangencia[] {
  const daVigencia: Recorte = { ...recorte, period: view.period };
  return [...view.groups]
    .map((grupo) => ({
      key: grupo.key,
      name: tituloCurto(grupo),
      equipment: grupo.equipment,
      vehicles: grupo.vehicles,
      fleet: grupo.fleet,
      percent: participacao(grupo.vehicles, grupo.fleet),
      href: linkDaAlteracao(grupo, daVigencia),
    }))
    .sort((a, b) => {
      const alcance = (b.percent ?? -1) - (a.percent ?? -1);
      if (alcance !== 0) return alcance;
      return b.vehicles - a.vehicles;
    })
    .slice(0, limite);
}

// ---------------------------------------------------------------------------
// Parâmetros mais alterados
// ---------------------------------------------------------------------------

export interface LinhaDeParametro {
  chave: string;
  tipo: TipoDeLinha;
  titulo: string;
  equipamento: string;
  /** Linhas de alteração no ponto — a régua que ordena esta lista. */
  alteracoes: number;
  /** Ativos distintos tocados. Nunca somado com o de outro ponto. */
  veiculos: number;
  href: string;
}

/**
 * Os pontos da remuneração que mais mudaram, por **número de alterações**.
 *
 * O painel da direita mostrava a fila do cockpit — criticidade, depois
 * abrangência, depois magnitude — sob o título "Alterações em destaque", e
 * trazia à direita a contagem de *ativos*. Quem lia procurava "o que mudou
 * mais" e recebia uma ordem que nenhuma das colunas visíveis explicava: o
 * primeiro item podia ter menos alterações que o terceiro, e a razão morava num
 * cálculo de criticidade que a tela não mostrava.
 *
 * Aqui a ordem é a coluna: mais alterações primeiro, e as duas grandezas ficam
 * lado a lado, porque elas não são a mesma e a diferença entre elas é
 * informação. **62 alterações em 62 ativos** é uma coluna que mexeu uma vez em
 * toda a frota; **62 alterações em 3 ativos** é um punhado de ativos com muita
 * coisa mexida — e são investigações diferentes.
 *
 * Empate desce para os ativos e depois para o nome, porque a ordem tem de ser
 * estável entre dois carregamentos da mesma vigência: uma lista que se
 * reorganiza sozinha ao atualizar a página faz quem lê duvidar do dado antes de
 * duvidar da ordenação.
 */
export function parametrosMaisAlterados(
  view: GroupedView,
  limite = 4,
  recorte: Recorte = RECORTE_VAZIO,
): LinhaDeParametro[] {
  const daVigencia: Recorte = { ...recorte, period: view.period };
  return [...view.groups]
    .sort((a, b) => {
      if (b.changes !== a.changes) return b.changes - a.changes;
      if (b.vehicles !== a.vehicles) return b.vehicles - a.vehicles;
      return a.title.localeCompare(b.title, "pt-BR");
    })
    .slice(0, limite)
    .map((grupo) => ({
      chave: grupo.key,
      tipo: tipoDaLinha(grupo),
      titulo: tituloCurto(grupo),
      equipamento: grupo.equipment,
      alteracoes: grupo.changes,
      veiculos: grupo.vehicles,
      href: linkDaAlteracao(grupo, daVigencia),
    }));
}

/**
 * O nome do ponto, sem o veredito na frente.
 *
 * `tituloDaLinha` escreve "Mudança sem preço — combustivelConsumoNeg — Cavalo",
 * que é a frase certa num painel onde a coluna da direita é o tamanho do fato.
 * Nestas duas listas o veredito já está dito noutro lugar — no ícone, no
 * equipamento em coluna própria — e repeti-lo empurraria o nome do parâmetro
 * para fora da largura disponível, que é o único texto pelo qual alguém procura
 * a linha.
 */
function tituloCurto(grupo: ChangeGroup): string {
  return grupo.title;
}

// ---------------------------------------------------------------------------
// O que merece sua atenção
// ---------------------------------------------------------------------------

export type Tom = "grave" | "atencao" | "ok";

export interface PontoDeAtencao {
  chave: string;
  tom: Tom;
  titulo: string;
  detalhe: string;
  /** A segunda linha, quando há um número para pôr nela. */
  valor: string | null;
  href: string;
}

/**
 * Os quatro pontos do topo da tela.
 *
 * A régua é sempre a mesma: **o ponto existe porque o dado existe**, e o tom
 * sai do dado — não de uma lista fixa de "coisas ruins". Uma vigência em que
 * nada travou mostra o quarto ponto em verde dizendo isso; uma vigência sem
 * impacto apurável não mostra o primeiro ponto de forma alguma, porque não há
 * maior impacto quando não há impacto.
 *
 * Cada ponto leva a uma tela que responde a ele. Um alerta que não abre nada é
 * um alerta que a pessoa aprende a ignorar.
 */
export function pontosDeAtencao(
  view: FamiliesView,
  ranking: RankingDeImpacto | null,
  integridadeDosDados: Integridade | null,
  recorte: Recorte = RECORTE_VAZIO,
): PontoDeAtencao[] {
  const pontos: PontoDeAtencao[] = [];
  const daVigencia: Recorte = { ...recorte, period: view.period };

  const negativos = (ranking?.linhas ?? []).filter((l) => l.amount < 0);
  const maior = negativos[0] ?? ranking?.linhas[0];
  if (maior && ranking) {
    pontos.push({
      chave: "maior-impacto",
      tom: maior.amount < 0 ? "grave" : "ok",
      titulo: maior.amount < 0 ? "Maior impacto negativo" : "Maior impacto",
      detalhe: maior.name,
      valor: escreverImpacto({ periodicity: ranking.periodicity, amount: maior.amount }),
      href: `/parametros?period=${view.period}`,
    });
  }

  /*
    "Sem preço" leva às alterações, e não mais à Curadoria.

    O ponto conta **alterações** — "244 alterações requerem análise" —, e um
    número de alterações que abre uma tela de atributos obriga quem clicou a
    refazer sozinho a ligação entre as duas contagens. As 244 estão listadas em
    Alterações, filtradas por este mesmo `NOT_CALCULABLE`, e a Curadoria continua
    a um clique de lá: é ela que aparece dentro do painel "sem preço", que é
    onde a pergunta seguinte — *como isto ganha preço?* — de fato nasce.
  */
  const semPreco = view.impact.notCalculable;
  pontos.push({
    chave: "sem-preco",
    tom: semPreco > 0 ? "atencao" : "ok",
    titulo: semPreco > 0 ? "Mudanças sem preço" : "Toda mudança tem preço",
    detalhe:
      semPreco > 0
        ? `${inteiro(semPreco)} ${semPreco === 1 ? "alteração requer" : "alterações requerem"} análise`
        : "Nenhuma alteração ficou sem valor apurado",
    valor: null,
    href:
      semPreco > 0
        ? linkDeAlteracoes({
            recorte: daVigencia,
            filtros: { impactConfidence: "NOT_CALCULABLE" },
          })
        : "/curadoria",
  });

  const equipamento = equipamentoMaisTocado(view);
  if (equipamento) {
    pontos.push({
      chave: "equipamento",
      tom: "atencao",
      titulo: equipamento.nome,
      detalhe: `${inteiro(equipamento.mudancas)} ${
        equipamento.mudancas === 1 ? "mudança detectada" : "mudanças detectadas"
      }`,
      valor: null,
      /*
        `entityType` e não a pastilha de série: a pastilha troca a comparação
        por "a mais recente do cavalo", que pode ser outro mês. Este ponto fala
        das mudanças **desta** vigência, e é dentro dela que o equipamento
        precisa recortar.
      */
      href: linkDeAlteracoes({
        recorte: daVigencia,
        filtros: equipamento.entityType ? { entityType: equipamento.entityType } : {},
      }),
    });
  }

  if (integridadeDosDados) {
    pontos.push({
      chave: "integridade",
      tom: integridadeDosDados.ok ? "ok" : "grave",
      titulo: integridadeDosDados.titulo,
      detalhe: integridadeDosDados.detalhe,
      valor: null,
      href: "/balanco-massa",
    });
  }

  return pontos;
}

/**
 * O equipamento com mais mudanças na vigência.
 *
 * A contagem vem pronta do cockpit — `panorama.byEquipment` —, e não de uma
 * soma dos grupos feita aqui. A diferença não é de esforço: somar `vehicles`
 * conta ativos, e o que a frase promete são **mudanças**, que é outro número
 * sempre que um ativo muda em dois parâmetros. O painel do Acompanhamento lê
 * exatamente este campo, e as duas telas precisam dizer o mesmo.
 */
export function equipamentoMaisTocado(
  view: GroupedView,
): { nome: string; entityType: string | null; mudancas: number } | null {
  const baldes = view.cockpit.panorama.byEquipment.filter((b) => b.changes > 0);
  if (baldes.length === 0) return null;

  const maior = [...baldes].sort(
    (a, b) => b.changes - a.changes || a.equipment.localeCompare(b.equipment, "pt-BR"),
  )[0];
  // `entityType` sai junto com o nome porque é ele que viaja no link: "Cavalo" é
  // como se lê, `CAVALO` é como o servidor filtra, e traduzir um no outro na
  // tela seria uma terceira tabela de nomes para manter igual às outras duas.
  return {
    nome: maior.equipment,
    entityType: maior.entityType,
    mudancas: maior.changes,
  };
}

// ---------------------------------------------------------------------------
// A lista de alterações
// ---------------------------------------------------------------------------

export type TipoDeLinha = "queda" | "alta" | "sem-preco" | "neutro";

export interface LinhaDeAlteracao {
  chave: string;
  tipo: TipoDeLinha;
  titulo: string;
  detalhe: string;
  direita: string;
  /**
   * A lista de Alterações recortada nesta linha — a vigência, o parâmetro e o
   * equipamento de que ela fala.
   *
   * Existe porque um item de destaque que não abre nada é um beco: a tela diz
   * "combustivelConsumoBenchmark mudou em 10 ativos" e deixa quem quer ver os 10
   * refazer o filtro à mão do outro lado. Sai daqui, e não do JSX, para que o
   * endereço seja testável — `recorte.ts` guarda a gramática; este arquivo diz o
   * que cada linha tem a dizer nela.
   */
  href: string;
}

/**
 * As alterações da vigência, as mais relevantes primeiro.
 *
 * A ordem é **a fila de prioridade do cockpit**, a mesma que o Acompanhamento
 * abre: a criticidade e o lugar de cada item são calculados em
 * `lib/comparison/src/cockpit.ts` e testados lá contra o export real. Reordenar
 * aqui por conta própria faria o primeiro item desta tela discordar do primeiro
 * item da tela seguinte, e não há resposta boa para quem perguntasse qual das
 * duas está certa.
 *
 * Sem coluna de relógio, e é decisão de verdade e não de espaço: as alterações
 * desta vigência foram todas apuradas na mesma comparação, no mesmo instante.
 * Uma lista com quatro horários diferentes ao lado — "hoje, 10:32", "hoje,
 * 09:58" — inventaria uma cronologia que o dado não tem. O que existe de
 * verdadeiro para pôr à direita é o tamanho do fato: em quantos ativos ele
 * aconteceu.
 */
export function ultimasAlteracoes(
  view: GroupedView,
  limite = 4,
  recorte: Recorte = RECORTE_VAZIO,
): LinhaDeAlteracao[] {
  const fila = juntarPrioridades(view);
  /*
    A fila vazia com grupos na mão não deveria acontecer — as duas listas nascem
    da mesma resposta. Se acontecer, o painel mostra os grupos na ordem que
    vieram em vez de ficar vazio: perder a ordem é menos grave do que sumir com
    as alterações da vigência.
  */
  const grupos = fila.length > 0 ? fila.map((entrada) => entrada.group) : view.groups;
  const daVigencia: Recorte = { ...recorte, period: view.period };

  return grupos.slice(0, limite).map((grupo) => ({
    chave: grupo.key,
    tipo: tipoDaLinha(grupo),
    titulo: tituloDaLinha(grupo),
    detalhe: detalheDaLinha(grupo),
    direita: `${inteiro(grupo.vehicles)} ${grupo.vehicles === 1 ? "ativo" : "ativos"}`,
    href: linkDaAlteracao(grupo, daVigencia),
  }));
}

/**
 * O endereço das linhas de um grupo.
 *
 * O recorte é o mais estreito que o grupo sustenta, e nem um passo além. Grupo
 * sem `attributeCode` — um ativo que entrou, uma coluna que sumiu — não vira um
 * `attributeCode=null` na URL: ele leva à vigência inteira, e a lista ordenada
 * por materialidade põe o assunto por perto. Um filtro inventado devolveria zero
 * linhas, e zero linhas depois de um clique se lê como defeito da tela.
 */
function linkDaAlteracao(grupo: ChangeGroup, recorte: Recorte): string {
  const filtros: FiltrosDeLinha = {};
  if (grupo.attributeCode) filtros.attributeCode = grupo.attributeCode;
  if (grupo.entityType) filtros.entityType = grupo.entityType;
  return linkDeAlteracoes({ recorte, filtros });
}

function tipoDaLinha(grupo: ChangeGroup): TipoDeLinha {
  /*
    Troca de formato pura não é queda, alta nem "mudança sem preço" — é neutra,
    e precisa vir antes das outras regras: como o motor não apura valor para uma
    coluna de data, ela cairia em "sem-preco" e o painel anunciaria uma mudança
    que não existe.
  */
  if (grupo.formatOnly) return "neutro";
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return grupo.impact.amount < 0 ? "queda" : "alta";
  }
  return grupo.impact.reason !== null || grupo.inconclusiveReason !== null
    ? "sem-preco"
    : "neutro";
}

function tituloDaLinha(grupo: ChangeGroup): string {
  const onde = `${grupo.title} — ${grupo.equipment}`;
  if (grupo.formatOnly) return `Formato do arquivo mudou — ${onde}`;
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return `Valor ${grupo.impact.amount < 0 ? "reduzido" : "aumentado"} em ${onde}`;
  }
  if (tipoDaLinha(grupo) === "sem-preco") return `Mudança sem preço — ${onde}`;
  return onde;
}

function detalheDaLinha(grupo: ChangeGroup): string {
  if (grupo.formatOnly) {
    return "a coluna mudou de forma; o valor dos dois lados é o mesmo";
  }
  if (grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null) {
    return escreverImpacto({
      periodicity: grupo.impact.periodicity,
      amount: grupo.impact.amount,
    });
  }
  return grupo.impact.reason ?? grupo.inconclusiveReason ?? grupo.badgeLabel;
}

// ---------------------------------------------------------------------------
// Qualidade da auditoria
// ---------------------------------------------------------------------------

/**
 * O adjetivo da cobertura.
 *
 * Os cortes estão escritos aqui, num lugar só, porque um adjetivo é a coisa
 * mais fácil de mentir numa tela: "Excelente" a 60% seria um elogio que o dado
 * não sustenta, e ninguém conferiria. A palavra vem sempre acompanhada do
 * número, e nunca no lugar dele.
 */
export function qualidadeDaCobertura(percentual: number): { palavra: string; tom: Tom } {
  if (percentual >= 99) return { palavra: "Excelente", tom: "ok" };
  if (percentual >= 95) return { palavra: "Alta", tom: "ok" };
  if (percentual >= 85) return { palavra: "Parcial", tom: "atencao" };
  return { palavra: "Baixa", tom: "grave" };
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
