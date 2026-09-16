/**
 * A AUDITORIA DE TMA — o tempo de porta, por local e por trecho.
 *
 * ---------------------------------------------------------------------------
 * Dois grãos, e é preciso dizer por que são dois
 * ---------------------------------------------------------------------------
 * As duas colunas de TMA — `tempoInternoOrigem` e `tempoInternoDestino` — já
 * aparecem na Auditoria de Velocidade Média, como duas das três parcelas de
 * tempo parado do ciclo. Lá o TMA é **parcela de outra conta**; aqui ele é a
 * conta, e isso muda o que se pergunta dele.
 *
 * **Por local** — é o que o verbete desta rota pede com todas as letras: *"o
 * tempo médio de atendimento **por unidade**"*. TMA é uma propriedade do lugar —
 * a doca, a portaria, a fila daquele CDD —, e a tabela de frete o declara por
 * trecho. A mesma origem aparece em dezenas de trechos, e é preciso virar a
 * tabela do avesso para perguntar o óbvio:
 *
 * > **O mesmo local está declarado com o mesmo tempo de porta em todos os
 * > trechos que passam por ele?**
 *
 * Nenhuma tela por trecho enxerga isso. Cada linha é internamente coerente — o
 * ciclo fecha, a velocidade fecha —, e ainda assim duas linhas podem declarar a
 * mesma doca com 90 e 150 minutos. Ou o modelo distingue trechos por uma razão
 * que ninguém escreveu, ou alguém parametrizou de dois jeitos.
 *
 * **Por trecho** — porque quem negocia um contrato negocia trechos, e a pergunta
 * *"quanto deste ciclo é porta?"* é do percurso. Ela compara trechos entre si, e
 * é dela que sai a fila de quem tem espera demais no ciclo. O que este grão
 * produz e a tela de Velocidade Média não tem: **as duas portas somadas** como o
 * tempo de porta do ciclo, a folga entre o pago e o praticado por trecho, e o
 * peso disso no ciclo inteiro.
 *
 * Os dois grãos saem da **mesma leitura**, a mesma linha de trecho lida uma vez.
 * É isso que garante que eles nunca discordem: o tempo de porta de um local é a
 * média dos mesmos números que aparecem no grão de trecho.
 *
 * ---------------------------------------------------------------------------
 * As duas portas não são a mesma operação
 * ---------------------------------------------------------------------------
 * O dicionário da tabela de frete define as duas, e as definições não se
 * encontram:
 *
 * - **TMA de origem** — *"da chegada à saída carregado"*;
 * - **TMA de destino** — *"da chegada à liberação, incluindo fila e descarga"*.
 *
 * Carregar não é descarregar. Um mesmo CDD é origem de uns trechos e destino de
 * outros, e a tela guarda as duas leituras **separadas** para ele: a média de um
 * local nunca junta as duas, porque isso daria o tempo de uma operação que não
 * existe. A única soma entre elas está no grão de trecho, e ali ela descreve
 * algo real — é o mesmo caminhão, no mesmo ciclo, parado nas duas pontas.
 *
 * Esta é a segunda coisa que o verbete pedia — *"a regra do que conta como
 * atendimento"* —, e ela está escrita.
 *
 * ---------------------------------------------------------------------------
 * O que continua faltando, e é a primeira linha do verbete
 * ---------------------------------------------------------------------------
 * *"O registro de cada atendimento com começo e fim: média de tempo sem os dois
 * carimbos é média de nada."* Continua exato. Este acervo tem o TMA
 * **parametrizado** — o tempo que o modelo de remuneração reconhece para aquela
 * porta —, e não o medido. A tela não afirma quanto um caminhão esperou; afirma
 * quanto o contrato reconhece que ele espera, e diz a diferença por extenso.
 *
 * É uma pergunta menor? Não: é o número que **remunera**. Um TMA parametrizado
 * acima do praticado é tempo pago que não acontece, e abaixo é operação
 * absorvendo espera que ninguém reconhece. As duas conversas existem hoje, com o
 * dado que já chegou.
 */

import { estadoDaAlteracao, type AlteracaoDoMotor, type MedidaDaVariavel } from "./recorte-de-rubrica";

export type { MedidaDaVariavel };

/** O tipo de entidade de onde o TMA é lido. O grão da tela é outro. */
export const TIPO_DA_FONTE_DO_TMA = "TRECHO";

// ---------------------------------------------------------------------------
// As duas portas
// ---------------------------------------------------------------------------

/**
 * A porta a que um TMA pertence.
 *
 * Não é um detalhe de rótulo: são duas operações diferentes no mesmo local, com
 * definições diferentes no dicionário, e a tela nunca as soma nem as compara
 * entre si.
 */
export type PortaDoTma = "ORIGEM" | "DESTINO";

export const ROTULO_DA_PORTA: Record<PortaDoTma, string> = {
  ORIGEM: "Carregamento (origem)",
  DESTINO: "Descarga (destino)",
};

export const DEFINICAO_DA_PORTA: Record<PortaDoTma, string> = {
  ORIGEM:
    "Da chegada à saída carregado — é o tempo de carregar, como o dicionário da tabela " +
    "de frete o define.",
  DESTINO:
    "Da chegada à liberação, incluindo fila e descarga — é o tempo de entregar, e não o " +
    "mesmo tempo da origem medido do outro lado.",
};

/** Os códigos que a leitura de um trecho precisa, com o que cada um é. */
export const CODIGOS_DO_TMA = {
  origem: "trecho.origem",
  destino: "trecho.destino",
  tmaOrigem: "trecho.tempo_interno_origem",
  tmaDestino: "trecho.tempo_interno_destino",
  tmaOrigemLucro: "trecho.tempo_interno_origem_lucro",
  tmaDestinoLucro: "trecho.tempo_interno_destino_lucro",
  ciclo: "trecho.carga_horaria_por_trajeto_minuto",
} as const;

/** Todos eles, para a leitura de `getEntityTable`. */
export const CODIGOS_LIDOS_DO_TMA: string[] = [...new Set(Object.values(CODIGOS_DO_TMA))].sort();

/**
 * Por que a linha do menu desta rubrica não tem dinheiro — e não tem `R$ 0,00`.
 *
 * O que o acervo declara aqui são **minutos**, e virar minuto em real depende
 * da jornada e de quantas viagens a operação rodou — a conta que a Auditoria de
 * Velocidade Média já se recusa a fazer, pela mesma razão, e que este acervo não
 * sustenta. Um `R$ 0,00` ao lado de cada vigência afirmaria que o dinheiro não
 * se moveu numa comparação que nunca olhou para ele; a frase diz que ninguém
 * olhou. É o mesmo campo `semImpacto` do QLP, pela mesma regra.
 */
export const SEM_IMPACTO_DE_TMA =
  "O tempo de porta chega em minutos, e transformá-lo em dinheiro depende da " +
  "jornada e de quantas viagens a operação rodou — conta que este acervo não " +
  "sustenta. Esta comparação conta o que se moveu nas colunas de porta de cada " +
  "trecho, e não soma reais.";

/**
 * Quantas colunas de porta se moveram entre as duas pontas — a contagem, só.
 *
 * É o número que a linha do menu do seletor escreve, e ele é de **coluna de
 * trecho**: o grão do change set, que é onde o motor pareia. A tela agrega esses
 * mesmos números por local e por trecho, e por isso não publica esta contagem em
 * cartão nenhum — o que o menu promete aqui é "há movimento nas colunas que esta
 * tela lê entre estas duas vigências", que é a pergunta que decide a escolha.
 *
 * Só `ALTERADO` conta, como nas outras rubricas: entidade que entrou ou saiu é
 * outra notícia, e incomparável é a ausência da notícia.
 */
export function variaveisAlteradasDeTma(alteracoes: readonly AlteracaoDoMotor[]): number {
  const codigos = new Set(CODIGOS_LIDOS_DO_TMA);
  return alteracoes.filter(
    (a) =>
      a.attributeCode !== null &&
      codigos.has(a.attributeCode) &&
      estadoDaAlteracao(a) === "ALTERADO",
  ).length;
}

// ---------------------------------------------------------------------------
// A leitura de um trecho
// ---------------------------------------------------------------------------

/** Um trecho lido de uma das duas vigências — a fonte, não o grão. */
export interface ValorDeTma {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  /** A chave do trecho, como o acervo a guarda. */
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  /** Em minutos, o que a operação pratica. */
  tmaOrigem: number | null;
  tmaDestino: number | null;
  /** Em minutos, o que a remuneração paga. */
  tmaOrigemLucro: number | null;
  tmaDestinoLucro: number | null;
  /** O ciclo inteiro, em minutos — o denominador do peso da porta. */
  ciclo: number | null;
}

// ---------------------------------------------------------------------------
// O local — o grão desta tela
// ---------------------------------------------------------------------------

/**
 * O que a leitura de um local revelou sobre o tempo de porta dele.
 *
 * `VARIA_POR_TRECHO` é o achado que só este grão enxerga: o mesmo local
 * declarado com tempos diferentes conforme o trecho que passa por ele. Ou o
 * modelo distingue trechos por uma razão que ninguém escreveu, ou alguém
 * parametrizou de dois jeitos — e as duas são perguntas.
 *
 * `UM_TRECHO_SO` não é falha: é um local por onde passa um trecho só, e dizer
 * que o TMA dele "é único" seria afirmar sobre uma linha uma concordância que
 * não foi testada.
 */
export type VereditoDoLocal =
  | "TMA_UNICO"
  | "VARIA_POR_TRECHO"
  | "UM_TRECHO_SO"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_LOCAL: Record<VereditoDoLocal, string> = {
  TMA_UNICO: "Mesmo tempo em todos os trechos",
  VARIA_POR_TRECHO: "Tempo varia conforme o trecho",
  UM_TRECHO_SO: "Um trecho só",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/**
 * Um minuto de folga entre o maior e o menor TMA de um local.
 *
 * A fonte declara tempo em minutos, e dois trechos que dizem 90 e 90,5 minutos
 * para a mesma doca estão dizendo a mesma coisa com arredondamentos diferentes.
 * Um minuto é a menor unidade em que a diferença significa alguma coisa — e está
 * muito abaixo do que interessa: uma doca declarada com 90 e 150 minutos erra
 * por uma hora, não por um minuto.
 */
export const TOLERANCIA_DO_TMA_EM_MINUTOS = 1;

/** O tempo de porta de um local, numa ponta, numa das duas portas. */
export interface LocalDeTma {
  ponta: "BASE" | "COMPARADA";
  local: string;
  porta: PortaDoTma;
  /** Quantos trechos passam por esta porta deste local. */
  trechos: number;
  /** Em minutos — o que a operação pratica. */
  minimo: number | null;
  medio: number | null;
  maximo: number | null;
  /** A amplitude: `maximo − minimo`, em minutos. É o tamanho da discordância. */
  amplitude: number | null;
  /** O desvio-padrão populacional, em minutos. */
  desvio: number | null;
  /** Em minutos — o que a remuneração paga, quando o trecho declara as duas. */
  pagoMedio: number | null;
  /** `pago − praticado`, em minutos. Positiva = paga-se mais espera do que se pratica. */
  folgaMedia: number | null;
  /** Quantos trechos deste local têm folga diferente de zero. */
  trechosComFolga: number;
  /**
   * Que fração do ciclo se passa nesta porta. `0.13` para 13%.
   *
   * É a média das frações por trecho, e não a razão das médias: um trecho de
   * ciclo curto com muita espera e outro de ciclo longo com pouca não se
   * resumem pela divisão dos dois totais.
   */
  pesoNoCiclo: number | null;
  veredito: VereditoDoLocal;
}

/** A média simples de uma lista, ou `null` quando ela está vazia. */
function media(xs: readonly number[], casas = 2): number | null {
  if (xs.length === 0) return null;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(casas));
}

interface Acumulado {
  praticados: number[];
  pagos: number[];
  folgas: number[];
  pesos: number[];
  comFolga: number;
}

function vazio(): Acumulado {
  return { praticados: [], pagos: [], folgas: [], pesos: [], comFolga: 0 };
}

/**
 * A tabela de trechos virada do avesso: um local por linha, em cada porta.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que a inversão faz
 * ---------------------------------------------------------------------------
 * O acervo declara o tempo de porta **por trecho**, e o tempo de porta é uma
 * propriedade do **local**. Agrupar por origem e por destino é o que permite
 * perguntar se o mesmo lugar está declarado do mesmo jeito em todos os trechos
 * que passam por ele — e essa pergunta não existe no grão de origem.
 *
 * ---------------------------------------------------------------------------
 * As duas portas ficam separadas, sempre
 * ---------------------------------------------------------------------------
 * Um CDD é origem de uns trechos e destino de outros, e as duas leituras dele
 * são duas linhas. Carregar não é descarregar: o dicionário define as duas
 * operações com palavras diferentes, e juntá-las daria a média de uma operação
 * que não existe.
 *
 * ---------------------------------------------------------------------------
 * Ausência não vira zero
 * ---------------------------------------------------------------------------
 * Um trecho sem TMA declarado não entra na média daquele local — ele não é uma
 * espera de zero minuto. E um trecho sem nome de local não entra em local
 * nenhum: agrupá-lo sob "(sem nome)" criaria um lugar que não existe e
 * misturaria docas de unidades diferentes numa linha só.
 */
export function locaisDoTma(valores: readonly ValorDeTma[]): LocalDeTma[] {
  const acumulado = new Map<string, Acumulado>();

  const juntar = (
    ponta: "BASE" | "COMPARADA",
    local: string | null,
    porta: PortaDoTma,
    praticado: number | null,
    pago: number | null,
    ciclo: number | null,
  ): void => {
    if (local === null || local.trim() === "") return;
    if (praticado === null) return;

    const chave = `${ponta}${porta}${local.trim()}`;
    const atual = acumulado.get(chave) ?? vazio();
    atual.praticados.push(praticado);
    if (pago !== null) {
      atual.pagos.push(pago);
      const folga = pago - praticado;
      atual.folgas.push(folga);
      if (folga !== 0) atual.comFolga += 1;
    }
    if (ciclo !== null && ciclo > 0) atual.pesos.push(praticado / ciclo);
    acumulado.set(chave, atual);
  };

  for (const v of valores) {
    juntar(v.ponta, v.origem, "ORIGEM", v.tmaOrigem, v.tmaOrigemLucro, v.ciclo);
    juntar(v.ponta, v.destino, "DESTINO", v.tmaDestino, v.tmaDestinoLucro, v.ciclo);
  }

  return [...acumulado.entries()]
    .map(([chave, a]) => {
      const [ponta, porta, local] = chave.split("") as [
        "BASE" | "COMPARADA",
        PortaDoTma,
        string,
      ];
      const trechos = a.praticados.length;
      const minimo = Number(Math.min(...a.praticados).toFixed(2));
      const maximo = Number(Math.max(...a.praticados).toFixed(2));
      const amplitude = Number((maximo - minimo).toFixed(2));
      const m = media(a.praticados)!;
      const desvio = Number(
        Math.sqrt(a.praticados.reduce((acc, p) => acc + (p - m) ** 2, 0) / trechos).toFixed(2),
      );

      const veredito: VereditoDoLocal =
        trechos === 1
          ? "UM_TRECHO_SO"
          : amplitude <= TOLERANCIA_DO_TMA_EM_MINUTOS
            ? "TMA_UNICO"
            : "VARIA_POR_TRECHO";

      return {
        ponta,
        local,
        porta,
        trechos,
        minimo,
        medio: m,
        maximo,
        amplitude,
        desvio,
        pagoMedio: media(a.pagos),
        folgaMedia: media(a.folgas),
        trechosComFolga: a.comFolga,
        pesoNoCiclo: media(a.pesos, 4),
        veredito,
      };
    })
    .sort(
      (a, b) =>
        a.ponta.localeCompare(b.ponta) ||
        b.amplitude! - a.amplitude! ||
        a.local.localeCompare(b.local, "pt-BR") ||
        a.porta.localeCompare(b.porta),
    );
}

// ---------------------------------------------------------------------------
// A vigência
// ---------------------------------------------------------------------------

/** O que uma ponta inteira revelou sobre o tempo de porta. */
export interface ResumoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Quantas portas de local a vigência declara — origens e destinos somados. */
  portas: number;
  /** Locais distintos, contados uma vez ainda que sejam origem e destino. */
  locais: number;
  comTmaUnico: number;
  comVariacao: number;
  comUmTrechoSo: number;
  /** O TMA médio de carregamento e de descarga, em minutos — nunca somados. */
  medioNaOrigem: number | null;
  medioNoDestino: number | null;
  /** A maior amplitude observada dentro de um mesmo local, em minutos. */
  maiorAmplitude: number | null;
  /** O local e a porta em que ela acontece. */
  ondeVariaMais: { local: string; porta: PortaDoTma } | null;
  /** A folga média entre o pago e o praticado, em minutos. */
  folgaMedia: number | null;
  /** Que fração do ciclo se passa parado em porta, somando as duas. */
  pesoDasPortasNoCiclo: number | null;
}

/**
 * O retrato de cada ponta — e as duas médias que ele nunca junta.
 *
 * `medioNaOrigem` e `medioNoDestino` são duas linhas, e não um "TMA médio". Um
 * número só exigiria somar o tempo de carregar com o de descarregar e dividir
 * por dois, o que descreveria uma operação que não acontece em lugar nenhum.
 *
 * `pesoDasPortasNoCiclo` é a exceção, e ela se justifica: ali as duas portas
 * somam porque o ciclo de fato passa pelas duas — é o mesmo caminhão, no mesmo
 * ciclo, parado nas duas pontas. É a leitura que a Auditoria de Velocidade Média
 * faz por trecho, repetida aqui como número único da vigência.
 */
export function resumoPorVigencia(locais: readonly LocalDeTma[]): ResumoDaVigencia[] {
  const porPonta = new Map<"BASE" | "COMPARADA", LocalDeTma[]>();
  for (const l of locais) {
    porPonta.set(l.ponta, [...(porPonta.get(l.ponta) ?? []), l]);
  }

  return [...porPonta.entries()]
    .map(([ponta, doLado]) => {
      const origens = doLado.filter((l) => l.porta === "ORIGEM");
      const destinos = doLado.filter((l) => l.porta === "DESTINO");
      const comAmplitude = doLado.filter((l) => l.amplitude !== null);
      const maior = comAmplitude.reduce<LocalDeTma | null>(
        (melhor, l) => (melhor === null || l.amplitude! > melhor.amplitude! ? l : melhor),
        null,
      );
      const folgas = doLado
        .map((l) => l.folgaMedia)
        .filter((f): f is number => f !== null);
      const pesos = doLado.map((l) => l.pesoNoCiclo).filter((p): p is number => p !== null);

      return {
        ponta,
        portas: doLado.length,
        locais: new Set(doLado.map((l) => l.local)).size,
        comTmaUnico: doLado.filter((l) => l.veredito === "TMA_UNICO").length,
        comVariacao: doLado.filter((l) => l.veredito === "VARIA_POR_TRECHO").length,
        comUmTrechoSo: doLado.filter((l) => l.veredito === "UM_TRECHO_SO").length,
        medioNaOrigem: media(origens.map((l) => l.medio!).filter((m) => m !== null)),
        medioNoDestino: media(destinos.map((l) => l.medio!).filter((m) => m !== null)),
        maiorAmplitude: maior?.amplitude ?? null,
        ondeVariaMais: maior ? { local: maior.local, porta: maior.porta } : null,
        folgaMedia: media(folgas),
        /* A soma das duas portas: o ciclo passa pelas duas, e este é o único
           lugar em que juntá-las descreve algo que acontece. */
        pesoDasPortasNoCiclo:
          pesos.length === 0 ? null : Number((pesos.reduce((a, b) => a + b, 0) / pesos.length * 2).toFixed(4)),
      };
    })
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

/** Um local nas duas pontas, lado a lado. */
export interface EvolucaoDoLocal {
  local: string;
  porta: PortaDoTma;
  /** Em minutos, na vigência base. */
  base: number | null;
  /** Em minutos, na vigência comparada. */
  comparada: number | null;
  /** `comparada − base`, em minutos. */
  diferenca: number | null;
  /** Trechos que sustentam cada ponta. */
  trechosNaBase: number;
  trechosNaComparada: number;
}

/**
 * O mesmo local nas duas vigências — e por que isto não passa pelo motor.
 *
 * O motor de comparação pareia **entidades**, e um local não é uma entidade do
 * acervo: ele é um nome que aparece em duas colunas de trecho. O que existe aqui
 * é o agregado de cada ponta posto lado a lado, exatamente como
 * `totaisDeIpvaPorVigencia` e `precoPorKmPorVigencia` já fazem — uma leitura das
 * duas vigências, e não uma comparação linha a linha.
 *
 * A diferença importa e está dita na tela: o que mudou **em cada trecho** é do
 * motor, e continua em Alterações e na Auditoria de Velocidade Média. O que esta
 * função mostra é se o tempo de porta de um lugar subiu ou desceu no conjunto.
 *
 * Um local presente numa ponta só aparece com a outra em `null` — nunca em zero,
 * que seria uma doca que passou a atender instantaneamente.
 */
export function evolucaoDosLocais(locais: readonly LocalDeTma[]): EvolucaoDoLocal[] {
  const porChave = new Map<string, EvolucaoDoLocal>();

  for (const l of locais) {
    const chave = `${l.porta}${l.local}`;
    const atual =
      porChave.get(chave) ??
      ({
        local: l.local,
        porta: l.porta,
        base: null,
        comparada: null,
        diferenca: null,
        trechosNaBase: 0,
        trechosNaComparada: 0,
      } as EvolucaoDoLocal);

    if (l.ponta === "BASE") {
      atual.base = l.medio;
      atual.trechosNaBase = l.trechos;
    } else {
      atual.comparada = l.medio;
      atual.trechosNaComparada = l.trechos;
    }
    porChave.set(chave, atual);
  }

  return [...porChave.values()]
    .map((e) => ({
      ...e,
      diferenca:
        e.base === null || e.comparada === null
          ? null
          : Number((e.comparada - e.base).toFixed(2)),
    }))
    .sort((a, b) => {
      const da = a.diferenca === null ? -1 : Math.abs(a.diferenca);
      const db = b.diferenca === null ? -1 : Math.abs(b.diferenca);
      return db - da || a.local.localeCompare(b.local, "pt-BR");
    });
}

// ---------------------------------------------------------------------------
// O trecho — o outro grão, e a outra pergunta
// ---------------------------------------------------------------------------

/**
 * O que a folga de um trecho revelou.
 *
 * `PAGA_MAIS` quer dizer que a remuneração reconhece mais tempo de porta do que
 * a operação declara praticar, e `PAGA_MENOS`, o contrário. Nenhum dos dois é um
 * erro: o primeiro pode ser folga negociada, o segundo pode ser espera que a
 * operação absorve. A tela mostra os dois lados e o tamanho.
 */
export type VereditoDaFolga = "PAGA_MAIS" | "PAGA_MENOS" | "IGUAL" | "SEM_COMPARACAO";

export const ROTULO_DA_FOLGA: Record<VereditoDaFolga, string> = {
  PAGA_MAIS: "Paga mais porta do que pratica",
  PAGA_MENOS: "Paga menos porta do que pratica",
  IGUAL: "Paga o que pratica",
  SEM_COMPARACAO: "Sem as duas versões",
};

/** O tempo de porta de um trecho, numa ponta. */
export interface TrechoDeTma {
  ponta: "BASE" | "COMPARADA";
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  /** Em minutos, o que a operação pratica em cada ponta do percurso. */
  tmaOrigem: number | null;
  tmaDestino: number | null;
  /**
   * As duas somadas — o tempo que o ciclo passa parado em porta.
   *
   * É a **única** soma que esta tela faz entre as duas portas, e ela se justifica
   * porque aqui elas de fato se somam: é o mesmo caminhão, no mesmo ciclo, parado
   * nas duas pontas. Fora daqui — na média de um local, por exemplo — somá-las
   * descreveria uma operação que não acontece.
   *
   * Nula quando falta qualquer das duas: meia soma não é um tempo de porta menor,
   * é um tempo de porta que não se sabe.
   */
  tempoDePorta: number | null;
  /** O mesmo tempo na régua que remunera. */
  pagoDePorta: number | null;
  /** `pago − praticado`, em minutos. */
  folga: number | null;
  ciclo: number | null;
  /** Que fração do ciclo é tempo de porta. `0.28` para 28%. */
  pesoNoCiclo: number | null;
  veredito: VereditoDaFolga;
}

/** A soma de dois tempos em que um nulo contamina o total — ausência não é zero. */
function somaDasPortas(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Number((a + b).toFixed(2));
}

/**
 * O tempo de porta de cada trecho — o segundo grão desta tela.
 *
 * ---------------------------------------------------------------------------
 * Por que os dois grãos, e não um
 * ---------------------------------------------------------------------------
 * O verbete desta rota pede o TMA **por unidade**, e é o grão de local que
 * responde a isso — e que enxerga o mesmo lugar declarado de dois jeitos. Mas
 * quem negocia um contrato negocia **trechos**, e a pergunta "quanto deste ciclo
 * é porta?" é do trecho: ela compara percursos entre si, e é dela que sai a fila
 * de quem tem espera demais no ciclo.
 *
 * Os dois grãos saem da **mesma leitura** — a mesma linha de trecho, lida uma
 * vez —, e é isso que garante que eles nunca discordem: o tempo de porta de um
 * local é a média dos mesmos números que aparecem aqui.
 *
 * ---------------------------------------------------------------------------
 * O que este grão não repete
 * ---------------------------------------------------------------------------
 * A Auditoria de Velocidade Média já mostra `tempoInternoOrigem` e
 * `tempoInternoDestino` como duas linhas entre muitas, dentro do ciclo. O que
 * ela não mostra é o que esta função produz: **as duas somadas** como o tempo de
 * porta do ciclo, a folga entre o pago e o praticado por trecho, e o peso disso
 * no ciclo inteiro. Lá o TMA é parcela de outra conta; aqui ele é a conta.
 */
export function trechosDoTma(valores: readonly ValorDeTma[]): TrechoDeTma[] {
  return valores
    .map((v) => {
      const tempoDePorta = somaDasPortas(v.tmaOrigem, v.tmaDestino);
      const pagoDePorta = somaDasPortas(v.tmaOrigemLucro, v.tmaDestinoLucro);
      const folga =
        tempoDePorta === null || pagoDePorta === null
          ? null
          : Number((pagoDePorta - tempoDePorta).toFixed(2));

      return {
        ponta: v.ponta,
        entityLabel: v.entityLabel,
        origem: v.origem,
        destino: v.destino,
        tmaOrigem: v.tmaOrigem,
        tmaDestino: v.tmaDestino,
        tempoDePorta,
        pagoDePorta,
        folga,
        ciclo: v.ciclo,
        pesoNoCiclo:
          tempoDePorta === null || v.ciclo === null || v.ciclo <= 0
            ? null
            : Number((tempoDePorta / v.ciclo).toFixed(4)),
        veredito:
          folga === null
            ? ("SEM_COMPARACAO" as VereditoDaFolga)
            : folga > 0
              ? ("PAGA_MAIS" as VereditoDaFolga)
              : folga < 0
                ? ("PAGA_MENOS" as VereditoDaFolga)
                : ("IGUAL" as VereditoDaFolga),
      };
    })
    .sort(
      (a, b) =>
        a.ponta.localeCompare(b.ponta) ||
        (b.pesoNoCiclo ?? -1) - (a.pesoNoCiclo ?? -1) ||
        (a.entityLabel ?? "").localeCompare(b.entityLabel ?? ""),
    );
}

/** Um trecho nas duas pontas, lado a lado. */
export interface EvolucaoDoTrecho {
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  /** O tempo de porta em cada ponta, em minutos. */
  base: number | null;
  comparada: number | null;
  /** `comparada − base`, em minutos. */
  diferenca: number | null;
}

/**
 * O mesmo trecho nas duas vigências — o tempo de porta, lado a lado.
 *
 * Diferente do que o motor faz, e a distinção está dita na tela: o motor compara
 * **cada coluna** de cada trecho, e isso continua em Alterações e na Auditoria de
 * Velocidade Média. O que esta função põe lado a lado é a **soma das duas
 * portas**, que é uma grandeza derivada e não existe como coluna — logo, não
 * existe como linha de change set.
 *
 * Um trecho presente numa ponta só aparece com a outra em `null`, nunca em zero.
 */
export function evolucaoDosTrechos(trechos: readonly TrechoDeTma[]): EvolucaoDoTrecho[] {
  const porChave = new Map<string, EvolucaoDoTrecho>();

  for (const t of trechos) {
    const chave = t.entityLabel ?? "";
    const atual =
      porChave.get(chave) ??
      ({
        entityLabel: t.entityLabel,
        origem: t.origem,
        destino: t.destino,
        base: null,
        comparada: null,
        diferenca: null,
      } as EvolucaoDoTrecho);

    if (t.ponta === "BASE") atual.base = t.tempoDePorta;
    else atual.comparada = t.tempoDePorta;
    /* O nome do percurso vem da ponta que o trouxer — a comparada manda, porque
       é a vigência que está valendo. */
    atual.origem = t.origem ?? atual.origem;
    atual.destino = t.destino ?? atual.destino;
    porChave.set(chave, atual);
  }

  return [...porChave.values()]
    .map((e) => ({
      ...e,
      diferenca:
        e.base === null || e.comparada === null
          ? null
          : Number((e.comparada - e.base).toFixed(2)),
    }))
    .sort((a, b) => {
      const da = a.diferenca === null ? -1 : Math.abs(a.diferenca);
      const db = b.diferenca === null ? -1 : Math.abs(b.diferenca);
      return db - da || (a.entityLabel ?? "").localeCompare(b.entityLabel ?? "");
    });
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_TMA = [
  "Local",
  "Porta",
  "Vigência",
  "Trechos",
  "Mínimo (min)",
  "Médio (min)",
  "Máximo (min)",
  "Amplitude (min)",
  "Pago médio (min)",
  "Folga média (min)",
  "Peso no ciclo (%)",
  "Leitura",
] as const;

/**
 * Um local como as doze células do CSV.
 *
 * Os tempos saem em **minutos**, e não em horas e minutos: "1h 30min" é uma
 * string para a planilha, e 90 é um número que ela soma, ordena e usa em
 * fórmula. A tela escreve para o olho; o arquivo escreve para a próxima conta.
 *
 * A coluna "Porta" não é decoração: sem ela, o mesmo CDD aparece duas vezes no
 * arquivo com números diferentes, e quem abrir vai achar que é duplicidade —
 * quando são as duas operações que ele de fato tem.
 */
export function celulasDoCsvDeTma(l: LocalDeTma): (string | number | null)[] {
  return [
    l.local,
    ROTULO_DA_PORTA[l.porta],
    l.ponta === "BASE" ? "Base" : "Comparada",
    l.trechos,
    l.minimo,
    l.medio,
    l.maximo,
    l.amplitude,
    l.pagoMedio,
    l.folgaMedia,
    l.pesoNoCiclo === null ? null : Number((l.pesoNoCiclo * 100).toFixed(2)),
    ROTULO_DO_VEREDITO_DO_LOCAL[l.veredito],
  ];
}


/** O cabeçalho do CSV por trecho — o outro grão, o outro arquivo. */
export const COLUNAS_DO_CSV_DE_TRECHO = [
  "Trecho",
  "Origem",
  "Destino",
  "Vigência",
  "TMA origem (min)",
  "TMA destino (min)",
  "Tempo de porta (min)",
  "Pago de porta (min)",
  "Folga (min)",
  "Ciclo (min)",
  "Peso no ciclo (%)",
  "Leitura",
] as const;

/**
 * Um trecho como as doze células do CSV.
 *
 * Os tempos saem em minutos, pela mesma razão do arquivo por local: a planilha
 * soma número, e não "1h 30min".
 */
export function celulasDoCsvDeTrecho(t: TrechoDeTma): (string | number | null)[] {
  return [
    t.entityLabel,
    t.origem,
    t.destino,
    t.ponta === "BASE" ? "Base" : "Comparada",
    t.tmaOrigem,
    t.tmaDestino,
    t.tempoDePorta,
    t.pagoDePorta,
    t.folga,
    t.ciclo,
    t.pesoNoCiclo === null ? null : Number((t.pesoNoCiclo * 100).toFixed(2)),
    ROTULO_DA_FOLGA[t.veredito],
  ];
}
