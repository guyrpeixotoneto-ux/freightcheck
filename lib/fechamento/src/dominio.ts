/**
 * O vocabulário do fechamento de remuneração.
 *
 * Este arquivo existe porque as cinco fontes do fechamento dizem as mesmas
 * coisas com palavras diferentes: o canal é `Rota`/`AS` no 2Art, `Rota`/`AS`
 * no CSV de requisições, e vira seção de relatório (`RESUMO CT-e ROTA`) no
 * TXT do Promax; a frota é `Padrao`/`Spot`/`Fixo`/`Espec.` no 2Art e `FF`/`Van`
 * na disponibilidade. Traduzir cada uma na porta de entrada é o que permite
 * somar as cinco na mesma conta sem que a origem contamine a apuração.
 *
 * A regra que rege o módulo inteiro: **nada é inferido**. Um canal que não
 * reconhecemos não vira "Rota por padrão" — vira recusa com o texto original
 * dentro, porque um fechamento que adivinha é pior do que um que não fecha.
 */

/**
 * O canal de distribuição, o primeiro eixo de agregação de tudo.
 *
 * `ROTA` é a distribuição urbana diária; `AS` é a área de serviço, que atende
 * o interior. Toda fonte separa as duas, toda verba pertence a uma delas, e a
 * conciliação do Promax vem literalmente em duas seções — uma por canal.
 */
export type Canal = "ROTA" | "AS";

/**
 * O tipo de frota, o segundo eixo.
 *
 * `PADRAO` é a frota fixa contratada; `SPOT` é o veículo avulso acionado no
 * dia; `FIXO` é a van dedicada; `ESPECIAL` cobre o que o 2Art marca `Espec.`.
 * A distinção importa porque a remuneração de cada uma nasce de uma regra
 * diferente — e porque as abas diárias da planilha que este módulo substitui
 * abrem exatamente em `TOTAL PADRAO` e `TOTAL SPOT`.
 */
export type Frota = "PADRAO" | "SPOT" | "FIXO" | "ESPECIAL";

/** O tipo de frota na ótica da disponibilidade: caminhão (FF) ou van. */
export type TipoDeFrotaContratada = "FF" | "VAN";

/**
 * As seis fontes que um fechamento consome.
 *
 * Os nomes são os do processo, não os dos arquivos: quem opera chama o
 * relatório pelo número da rotina (`03.08.15`), mas o número é do Promax e
 * pode mudar de versão. O que não muda é o papel de cada um na conta.
 *
 * São seis no catálogo e nem sempre seis na quinzena: a primeira espera quatro,
 * admite o 03.08.12.09 quando ele existe, e não tem a conciliação — ver
 * `FONTES_DA_QUINZENA` e `FONTES_OPCIONAIS_DA_QUINZENA`.
 */
export type TipoDeFonte =
  /** 2Art — o diário operacional, uma linha por viagem. Origem do variável. */
  | "OPERACAO"
  /** 03.08.15 — os CT-es emitidos por verba. O extrato fiscal. */
  | "CTE"
  /** 03.08.20 — o demonstrativo de pagamento. A única fonte que abre o fixo. */
  | "PAGAMENTO"
  /** 03.08.18 — frota contratada × realizada. Origem dos descontos no fixo. */
  | "DISPONIBILIDADE"
  /**
   * 03.08.12.09 — requisições de despesa aprovadas. Origem do complementar.
   *
   * Esperado na 2ª quinzena e **admitido na 1ª**: a requisição aprovada entre
   * os dias 1 e 15 sai no 03.08.12.09 daquela quinzena, e sem ele o
   * complementar dela não teria de onde nascer.
   */
  | "REQUISICOES"
  /** 03.02.59.02 — a conciliação do Promax. O fecho do mês, e por isso só na 2ª quinzena. */
  | "CONCILIACAO";

export const TIPOS_DE_FONTE: TipoDeFonte[] = [
  "OPERACAO",
  "CTE",
  "PAGAMENTO",
  "DISPONIBILIDADE",
  "REQUISICOES",
  "CONCILIACAO",
];

/**
 * Quais das seis fontes cada quinzena **espera**.
 *
 * **A primeira quinzena fecha com quatro relatórios; a segunda, com os seis.**
 * A conciliação do Promax (03.02.59.02) é o fecho do mês e chega com o
 * fechamento da segunda quinzena: na primeira ela não existe. As requisições
 * (03.08.12.09) também não são esperadas ali, mas por outro motivo, e é por
 * isso que elas moram na lista de baixo em vez de nesta.
 *
 * A distinção importa porque `fontesAusentes` é lido pela tela: sem ela, toda
 * primeira quinzena do ano nasceria com pendências que ninguém pode resolver,
 * e "falta importar" — que é trabalho de alguém — passaria a se confundir com
 * "não há o que importar", que não é. O catálogo por quinzena é o que mantém a
 * lista da tela igual à pilha de arquivos que a Ambev entregou.
 *
 * O que a lista **não** faz é recusar: uma fonte que chegue fora da quinzena
 * dela é lida, apurada e mostrada como qualquer outra. A lista diz o que se
 * espera, não o que se admite — a mesma regra que rege o módulo inteiro, de que
 * a conta roda com o que houver.
 */
export const FONTES_DA_QUINZENA: Record<1 | 2, TipoDeFonte[]> = {
  1: ["OPERACAO", "CTE", "PAGAMENTO", "DISPONIBILIDADE"],
  2: [...TIPOS_DE_FONTE],
};

/**
 * As fontes que a quinzena **admite sem esperar** — a lista do "pode existir".
 *
 * **O 03.08.12.09 pode existir na primeira quinzena.** A requisição de despesa
 * aprovada entre os dias 1 e 15 sai no relatório daquela quinzena, e quando ela
 * existe é dali que nasce o complementar do período. O que não dá para afirmar
 * é o contrário: uma quinzena sem requisição aprovada nenhuma não gera arquivo,
 * e cobrar o 03.08.12.09 de toda primeira quinzena do ano seria pedir um
 * relatório que não existe.
 *
 * Entre as duas afirmações — "é obrigatório" e "não existe" — a segunda foi a
 * que tirou o relatório da tela: sem casinha para enviar, o 03.08.12.09 da
 * primeira quinzena só entrava por outra competência ou não entrava, e o
 * complementar do período ficava de fora da conta em silêncio. Esta lista é a
 * terceira resposta, que é a certa: **a casinha existe, e a falta dela não é
 * pendência.**
 *
 * Duas consequências, e as duas são o ponto:
 *
 * - `fontesAusentes` continua nomeando só o que a quinzena espera, então o
 *   opcional que não veio não vira cobrança (ver `apurar`).
 * - a tela oferece o envio mesmo assim, e o denominador de "3 de 4 relatórios"
 *   continua sendo o das esperadas — o opcional entra na fração quando chega,
 *   pelas duas pontas, como qualquer arquivo enviado fora da quinzena dele.
 */
export const FONTES_OPCIONAIS_DA_QUINZENA: Record<1 | 2, TipoDeFonte[]> = {
  1: ["REQUISICOES"],
  2: [],
};

function quinzenasEm(porQuinzena: Record<1 | 2, TipoDeFonte[]>): Record<TipoDeFonte, (1 | 2)[]> {
  return Object.fromEntries(
    TIPOS_DE_FONTE.map((tipo) => [
      tipo,
      ([1, 2] as const).filter((quinzena) => porQuinzena[quinzena].includes(tipo)),
    ]),
  ) as Record<TipoDeFonte, (1 | 2)[]>;
}

/**
 * O inverso: em que quinzenas cada fonte é esperada.
 *
 * É esta forma que o catálogo da API carrega, porque a tela pergunta pela
 * fonte ("o 03.02.59.02 entra nesta quinzena?") e não pela quinzena. Derivada
 * de `FONTES_DA_QUINZENA` de propósito: duas listas escritas à mão divergiriam
 * no dia em que uma sétima fonte aparecesse.
 */
export const QUINZENAS_DA_FONTE: Record<TipoDeFonte, (1 | 2)[]> = quinzenasEm(FONTES_DA_QUINZENA);

/**
 * O mesmo inverso para as opcionais: em que quinzenas cada fonte é admitida
 * sem ser cobrada.
 *
 * Vai no catálogo da API ao lado de `quinzenas`, e não misturada com ele: a
 * tela precisa das duas respostas separadas porque elas mandam em coisas
 * diferentes — uma diz se a casinha aparece, a outra se a ausência é pendência.
 * Somá-las num campo só faria o opcional que não chegou virar "falta importar".
 */
export const QUINZENAS_OPCIONAIS_DA_FONTE: Record<TipoDeFonte, (1 | 2)[]> = quinzenasEm(
  FONTES_OPCIONAIS_DA_QUINZENA,
);

/** A fonte é esperada nesta quinzena? */
export function fonteEsperadaNaQuinzena(quinzena: 1 | 2, tipo: TipoDeFonte): boolean {
  return FONTES_DA_QUINZENA[quinzena].includes(tipo);
}

/** A fonte é admitida nesta quinzena sem ser cobrada dela? */
export function fonteOpcionalNaQuinzena(quinzena: 1 | 2, tipo: TipoDeFonte): boolean {
  return FONTES_OPCIONAIS_DA_QUINZENA[quinzena].includes(tipo);
}

/**
 * Em que estado uma fonte está, para uma quinzena — a distinção que faltava.
 *
 * **Três estados e não dois, porque "não veio" tem dois significados opostos.**
 * O 03.02.59.02 não vir na 1ª quinzena não é pendência: ele não existe ali. O
 * 03.08.20 não vir é. Tratar os dois como "ausente" faria toda 1ª quinzena
 * nascer com pendências que ninguém pode resolver — e tratar os dois como
 * "tudo certo" faria um fechamento sem demonstrativo parecer conferível.
 */
export type EstadoDaFonte =
  /** Chegou. Vale igual para a esperada e para a que a quinzena só admite. */
  | "PRESENTE"
  /** A quinzena **espera** e não chegou. É a única que bloqueia a aferição. */
  | "AUSENTE"
  /** A quinzena não espera nem admite — ou admite e não cobra. Não é pendência. */
  | "NAO_APLICAVEL";

/** O estado de uma fonte numa quinzena, com o que a tela precisa para nomeá-la. */
export interface FonteDaQuinzena {
  tipo: TipoDeFonte;
  quinzena: 1 | 2;
  estado: EstadoDaFonte;
  /** A rotina como quem opera a chama — `2Art`, `03.08.20`. */
  rotina: string;
  /** A quinzena a admite sem cobrar? Verdadeiro só no 03.08.12.09 da 1ª. */
  opcional: boolean;
}

/**
 * O estado das seis fontes numa quinzena, dado o que chegou.
 *
 * **É a função que separa "não tenho dados" de "os dados não batem".** Ela não
 * decide nada de novo: aplica {@link FONTES_DA_QUINZENA} e
 * {@link FONTES_OPCIONAIS_DA_QUINZENA}, que são a regra do processo, e que já
 * regiam `fontesAusentes` na apuração. O que muda é passar a lê-la também do
 * lado da aferição, que até agora calculava percentual sobre um fechamento pela
 * metade sem saber que estava pela metade.
 *
 * `recebidas` em `null` é a **quinzena que nem foi aberta** — não há competência
 * e portanto não há documento nenhum. Tudo o que ela espera fica `AUSENTE`, que
 * é a verdade: o trabalho existe e não foi feito.
 */
export function fontesDaQuinzena(
  quinzena: 1 | 2,
  recebidas: readonly TipoDeFonte[] | null,
): FonteDaQuinzena[] {
  const chegou = new Set(recebidas ?? []);
  return TIPOS_DE_FONTE.map((tipo) => {
    const opcional = fonteOpcionalNaQuinzena(quinzena, tipo);
    const esperada = fonteEsperadaNaQuinzena(quinzena, tipo);
    /*
      Presente é presente, mesmo fora da quinzena dela: a conta usa o que houver
      (ver a nota de `FONTES_DA_QUINZENA`), e um arquivo que chegou não pode
      aparecer como falta só por ter chegado cedo.

      **Toda fonte é da quinzena, inclusive o 03.08.18.** Por uma versão ele foi
      tratado como mensal — dado por presente quando chegasse em qualquer das
      duas competências —, e a razão era um arquivo enganoso: o 03.08.18 de uma
      unidade chegou com a aba `FF` cortada em 15/07 e a aba `Van` com o mês
      inteiro, e daí se leu que as duas abas tinham periodicidades diferentes.
      O arquivo era o mensal com a `FF` podada à mão: mesmo `CreatedDate` do
      outro, subconjunto perfeito dele, autofilter só na aba mexida e salvo
      dezesseis dias depois por outra pessoa. A exceção escondia falta real, e
      saiu. O que resolve a sobreposição é o corte por período na leitura, não
      afrouxar o que se cobra.
    */
    const estado: EstadoDaFonte = chegou.has(tipo)
      ? "PRESENTE"
      : esperada
        ? "AUSENTE"
        : "NAO_APLICAVEL";
    return { tipo, quinzena, estado, rotina: DESCRICAO_DA_FONTE[tipo].rotina, opcional };
  });
}

/** Como cada fonte se chama na tela, e o que ela responde. */
export const DESCRICAO_DA_FONTE: Record<TipoDeFonte, { rotina: string; nome: string; papel: string }> = {
  OPERACAO: {
    rotina: "2Art",
    nome: "Relatório operacional",
    papel: "Uma linha por viagem: é daqui que sai o frete variável da quinzena.",
  },
  CTE: {
    rotina: "03.08.15",
    nome: "CT-es por verba",
    papel: "Tudo que foi faturado, verba a verba — o que a Ambev diz ter emitido.",
  },
  PAGAMENTO: {
    rotina: "03.08.20",
    nome: "Demonstrativo de pagamento",
    papel:
      "O que a Ambev diz que vai pagar, verba a verba — a única fonte que abre a parcela fixa.",
  },
  DISPONIBILIDADE: {
    rotina: "03.08.18",
    nome: "Disponibilidade de frota",
    papel: "Frota contratada contra a realizada: é daqui que saem os descontos no fixo.",
  },
  REQUISICOES: {
    rotina: "03.08.12.09",
    nome: "Requisições de despesa",
    papel: "As despesas extras aprovadas — o complementar que não nasce do cálculo automático.",
  },
  CONCILIACAO: {
    rotina: "03.02.59.02",
    nome: "Conciliação CT-e × SRTrans",
    papel: "O fecho: emitido contra calculado, com os saldos que atravessam a quinzena.",
  },
};

/**
 * Em que formatos cada fonte chega — e, portanto, quais o produto aceita.
 *
 * **A lista é do que se sabe ler, não do que se sabe abrir.** Nenhuma das seis
 * fontes tem um formato só: o mesmo relatório sai do Promax em `.xlsx` quando
 * alguém o exporta pela tela e em `.csv` quando o exporta pela fila, e chega em
 * `.txt` quando o caminho passou por um sistema que renomeia. Recusar por
 * extensão o arquivo que o leitor lê perfeitamente é fazer quem opera converter
 * arquivo à mão antes de trabalhar — e conversão à mão é onde a coluna trocada
 * entra na conta.
 *
 * **As duas fontes de largura fixa não aceitam planilha, e isso é deliberado.**
 * O 03.08.20 e o 03.02.59.02 são relatórios alinhados por espaço, e o
 * 03.02.59.02 é aquele em que a *coluna do número é o dado*. Colado numa
 * planilha, o valor vira célula numérica e perde a forma em que o relatório o
 * escreveu — o que produziria não um erro, mas uma verba lida a menos, em
 * silêncio. Aceitá-los só em texto é aceitar o que se consegue sustentar.
 *
 * A extensão continua sendo conferida na porta porque ela é o primeiro sinal de
 * que alguém trocou a aba de envio; o que ela **não** faz mais é escolher o
 * leitor. Quem decide como ler é o conteúdo do arquivo (ver `leitores/formato`).
 */
export const FORMATOS_DA_FONTE: Record<TipoDeFonte, string[]> = {
  OPERACAO: [".xlsx", ".xls", ".csv", ".txt"],
  CTE: [".xlsx", ".xls", ".csv", ".txt"],
  PAGAMENTO: [".txt", ".csv"],
  DISPONIBILIDADE: [".xlsx", ".xls", ".csv", ".txt"],
  REQUISICOES: [".csv", ".txt", ".xlsx", ".xls"],
  CONCILIACAO: [".txt", ".csv"],
};

/**
 * Uma leitura que não pôde ser feita, com o texto original preservado.
 *
 * O módulo devolve recusas em vez de lançar exceção porque um arquivo com uma
 * linha ilegível entre vinte e três mil ainda é um arquivo útil: a apuração
 * roda com o que foi lido e a tela mostra, nominalmente, o que ficou de fora.
 * O que nunca acontece é a linha ilegível virar zero silencioso.
 */
export interface Recusa {
  /** Onde: a linha física do arquivo, 1-based, como o Excel a numera. */
  linha: number;
  /** O que não deu para ler, em uma frase que quem opera entende. */
  motivo: string;
  /** O texto original, para que a decisão possa ser revista sem reabrir o arquivo. */
  original: string;
}

/** O resultado de ler uma fonte: o que entrou, e o que foi recusado. */
export interface Leitura<T> {
  linhas: T[];
  recusas: Recusa[];
}

const CANAIS: Record<string, Canal> = {
  rota: "ROTA",
  as: "AS",
};

/**
 * Traduz o canal como a fonte o escreve.
 *
 * Devolve `null` em vez de um palpite: quem chama decide se a linha vira
 * recusa (quase sempre) ou se o canal vem de outro lugar.
 */
export function lerCanal(bruto: unknown): Canal | null {
  if (typeof bruto !== "string") return null;
  return CANAIS[bruto.trim().toLowerCase()] ?? null;
}

const FROTAS: Record<string, Frota> = {
  padrao: "PADRAO",
  padrão: "PADRAO",
  spot: "SPOT",
  fixo: "FIXO",
  "espec.": "ESPECIAL",
  espec: "ESPECIAL",
  especial: "ESPECIAL",
};

/** Traduz o tipo de frota como o 2Art o escreve. `null` quando não reconhece. */
export function lerFrota(bruto: unknown): Frota | null {
  if (typeof bruto !== "string") return null;
  return FROTAS[bruto.trim().toLowerCase()] ?? null;
}

/**
 * Lê um número como as fontes brasileiras o escrevem.
 *
 * O CSV do SRTrans escreve `7.049,93` — ponto de milhar, vírgula decimal — e
 * as planilhas entregam número nativo. As duas formas passam por aqui, e
 * qualquer outra coisa devolve `null`, nunca `0`: a diferença entre "não paga
 * nada" e "não consegui ler" é o tipo de erro que custa dinheiro no
 * fechamento.
 */
export function lerNumero(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (texto === "") return null;
  // `1.234,56` (pt-BR) vira `1234.56`; `1234.56` (já normalizado) passa direto.
  const normalizado = /,/.test(texto)
    ? texto.replace(/\./g, "").replace(",", ".")
    : texto;
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Arredonda para centavos — a moeda do fechamento não tem casa decimal escondida.
 *
 * O `+ 0` no fim não é enfeite: sem ele, um valor negativo que arredonda para
 * nada vira `-0`, que imprime `-R$ 0,00` numa tabela de conferência e faz
 * `toBe(0)` falhar num teste. Zero negativo é um artefato de ponto flutuante,
 * nunca uma afirmação sobre dinheiro.
 */
export function centavos(valor: number): number {
  return Math.round(valor * 100) / 100 + 0;
}

/**
 * Um valor em reais, escrito como quem lê espera ver.
 *
 * `328169.46` no meio de uma frase em português é o tipo de detalhe que faz
 * quem lê desconfiar do resto. Fica aqui, e não em cada módulo, porque três
 * lugares já a escreviam — o título de uma divergência, a memória de cálculo e
 * o levantamento de inconsistências — e três cópias acabariam divergindo no
 * dia em que uma delas mudasse de casas.
 */
export function emReais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
