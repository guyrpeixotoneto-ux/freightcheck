/**
 * O AGRUPAMENTO POR VEÍCULO — uma linha por placa, em toda rubrica de custo fixo.
 *
 * ---------------------------------------------------------------------------
 * De onde isto veio, e por que não ficou no FINAME
 * ---------------------------------------------------------------------------
 * A tabela das auditorias de custo fixo nasceu **por variável**: uma linha para
 * cada par (veículo × variável). Com catorze variáveis de FINAME a mesma placa
 * aparecia catorze vezes, espalhada por três páginas, e perguntar "o que
 * aconteceu com a QYW6D15?" era caçar as linhas dela na lista. O FINAME
 * resolveu isso agrupando por placa — e IPVA, Lucro Fixo e Impostos ficaram com
 * o defeito que ele já não tinha.
 *
 * Copiar a função para as outras três seria criar quatro definições de "o
 * estado de uma placa" livres para divergir: bastava uma delas esquecer a
 * ordem de gravidade para a mesma frota aparecer com dois estados diferentes em
 * duas telas irmãs. `deduplicacao.ts` documenta no cabeçalho quanto custaram as
 * quatro respostas para "qual foi o impacto?" — este módulo existe para não
 * repetir o padrão com "o que mudou nesta placa?".
 *
 * ---------------------------------------------------------------------------
 * O que a função faz, e as três coisas que ela se recusa a fazer
 * ---------------------------------------------------------------------------
 * Ela junta as linhas por `(placa, tipo)`, conta o que se moveu, escolhe o
 * estado e ordena. Nada além disso.
 *
 * **Não recalcula.** Diferença, variação e estado saem das linhas que o motor
 * já produziu. Uma segunda régua aqui seria a quinta resposta do produto para a
 * mesma pergunta.
 *
 * **Não soma variáveis.** A coluna de dinheiro da placa é **uma** variável — a
 * que a rubrica declara em {@link OpcoesDoAgrupamento.destaque} —, e nunca a
 * soma das monetárias. No FINAME somar parcela, juros e amortização contaria o
 * mesmo dinheiro duas vezes, porque a parcela é a soma dos outros dois; no
 * Impostos, juntar ICMS com PIS/COFINS somaria dois tributos que não se somam.
 * A recusa é a mesma dos dois lados, e por isso mora aqui.
 *
 * **Não inventa o que não está no recorte.** A placa cuja linha de destaque não
 * veio — porque não se moveu, ou porque um filtro por variável a tirou — fica
 * com `destaque` nulo. Nulo aqui é "não está no recorte", nunca "não mudou" e
 * nunca R$ 0,00.
 *
 * ---------------------------------------------------------------------------
 * O que a linha-mãe mostra quando o destaque declarado não está lá
 * ---------------------------------------------------------------------------
 * `destaque` continua sendo a resposta sobre **a variável declarada**, e nada
 * mais. Mas escrever quatro travessões numa placa marcada "Alterado" — o que a
 * Manutenção fazia na RZN6A79, que moveu o R$/km do BID e não o R$/km resolvido
 * — é usar o símbolo de "não há valor aplicável" para dizer "o valor está na
 * linha de baixo". {@link DestaqueExibido} separa os dois: a declarada quando
 * ela existe, uma substituta **da mesma medida** quando é a única que se moveu,
 * uma contagem quando são várias, e nulo só quando não há nenhuma.
 *
 * A regra é por medida e por rubrica — `medidas` traz o catálogo, e dele saem a
 * unidade do destaque e a resposta a "esta rubrica tem dinheiro?" —, e não há
 * nenhum ramo que pergunte de que auditoria a linha veio.
 */

import {
  chaveDoVeiculo,
  GRAVIDADE,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";

/**
 * O mínimo que uma linha precisa ter para ser agrupada.
 *
 * É a interseção das quatro linhas de custo fixo — `LinhaDeFiname`,
 * `LinhaDeIpva`, `LinhaDeLucroFixo` e `LinhaDeImpostos` —, escrita como
 * estrutura e não como união: cada rubrica continua com os campos que só ela
 * tem (o tributo dos Impostos, o prazo do FINAME), e o agrupamento devolve a
 * linha inteira, do tipo que entrou.
 */
export interface LinhaAgrupavel {
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  /**
   * Como a tela nomeia esta variável — o que a linha-mãe escreve quando o
   * destaque exibido não é o declarado pela rubrica. Ausente, vale a chave.
   */
  rotuloDaVariavel?: string;
  /**
   * O aviso de que esta coluna não entra em soma nenhuma, quando ela existe.
   *
   * O agrupamento lê isto por uma razão só: uma coluna fora da soma **nunca**
   * representa a placa. `cavalo.valor_reajustado` é `manutencao_contrato` com
   * outro nome, e deixá-la assumir a linha-mãe escreveria o contrato como se
   * fosse um segundo número.
   */
  foraDaSoma?: string | null;
  medida: MedidaDaVariavel;
  /** O texto do valor na ponta "De". Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na ponta "Para". Nulo quando não há. */
  comparada: string | null;
  diferenca: number | null;
  variacao: number | null;
  estado: EstadoDaLinha;
}

/** A variável de dinheiro da placa, com as duas pontas já em número. */
export interface DestaqueDoVeiculo {
  base: number | null;
  comparada: number | null;
  diferenca: number | null;
  variacao: number | null;
}

/**
 * O que a linha-mãe da placa mostra nas quatro colunas de destaque.
 *
 * ---------------------------------------------------------------------------
 * Por que isto não é só `destaque`
 * ---------------------------------------------------------------------------
 * Porque `destaque` responde a uma pergunta só — "a variável que a rubrica
 * declarou está no recorte?" — e a linha-mãe precisa responder a outra: "o que
 * mudou nesta placa?". Na Manutenção as duas se separaram no dado real: a placa
 * RZN6A79 moveu o `R$/km do BID` e não moveu o `R$/km resolvido`, e a linha-mãe
 * escrevia quatro travessões sob o rótulo de uma placa alterada — o mesmo
 * símbolo com que ela diz "não há valor aplicável aqui".
 *
 * Os três casos são exaustivos, e nenhum deles inventa número:
 *
 * - `PRINCIPAL` — a variável declarada pela rubrica está no recorte. É ela que
 *   manda, mexida ou não: é o resumo que aquela auditoria escolheu para a placa.
 * - `SUBSTITUTO` — a declarada não está, e **uma só** variável da mesma medida
 *   se moveu. A linha-mãe mostra essa, dizendo qual é — sem o nome, o número
 *   seria lido como o da variável do cabeçalho.
 * - `MULTIPLOS` — a declarada não está e mais de uma da mesma medida se moveu.
 *   Escolher uma em silêncio seria eleger a representante da placa num critério
 *   que ninguém pediu; a linha-mãe diz quantas são e a expansão tem os números.
 *
 * Nada disso é de Manutenção: a regra é por **medida** — a do destaque da
 * rubrica — e vale igual nas oito auditorias que agrupam por veículo.
 */
export type DestaqueExibido =
  | {
      tipo: "PRINCIPAL" | "SUBSTITUTO";
      /** A chave da variável mostrada. */
      variavel: string;
      /** Como a tela a nomeia — o que a linha-mãe escreve no `SUBSTITUTO`. */
      rotulo: string;
      medida: MedidaDaVariavel;
      /**
       * O estado da linha mostrada.
       *
       * É o que separa "não mudou" de "não existe": uma variável presente e
       * parada é `SEM_ALTERACAO` com valores escritos, e não um travessão.
       */
      estado: EstadoDaLinha;
      valores: DestaqueDoVeiculo;
    }
  | {
      tipo: "MULTIPLOS";
      medida: MedidaDaVariavel;
      /** Os rótulos das variáveis alteradas, na ordem em que chegaram. */
      variaveis: readonly string[];
    };

/** Um veículo da tabela: a placa, o que ela moveu, e as linhas por baixo. */
export interface VeiculoDaRubrica<L extends LinhaAgrupavel> {
  entityLabel: string | null;
  entityType: string;
  /** Quantas variáveis se moveram nesta placa. */
  alteracoes: number;
  /** Quantas dessas são dinheiro — as demais são prazo, taxa, ano, data. */
  alteracoesEmDinheiro: number;
  /**
   * A variável de dinheiro que representa a placa — **uma**, e não a soma.
   *
   * Qual delas é escolha da rubrica: a parcela no FINAME, o IPVA anual no IPVA,
   * o lucro fixo próprio no Lucro Fixo, o PIS/COFINS nos Impostos. Nula quando
   * essa variável não está no recorte aberto.
   */
  destaque: DestaqueDoVeiculo | null;
  /**
   * O que as quatro colunas de destaque da linha-mãe escrevem — ver
   * {@link DestaqueExibido}. Nulo quando não há valor aplicável no recorte, e
   * é só nesse caso que a tela escreve travessão.
   */
  destaqueExibido: DestaqueExibido | null;
  /**
   * O estado da placa — o pior entre as linhas dela, pela mesma régua da rosca.
   *
   * Quem tem conflito aparece como conflito ainda que também tenha uma variável
   * alterada: um veículo tem um estado só, e é o mais grave. Sem essa regra a
   * mesma placa apareceria em duas leituras diferentes na mesma tela, e a soma
   * das fatias passaria do total de veículos.
   */
  estado: EstadoDaLinha;
  /** As linhas desta placa, na ordem do catálogo — o que a expansão mostra. */
  linhas: L[];
}

/** O que cada rubrica precisa dizer sobre si para ser agrupada. */
export interface OpcoesDoAgrupamento {
  /**
   * As chaves de variável na ordem em que a expansão as lê.
   *
   * É a do catálogo, e não a que o motor entrega. Na ordem do motor a parcela
   * FINAME caía no meio das duas parcelas que a compõem — "Amortização, Parcela
   * FINAME, Juros" —, e quem lê soma as três e chega ao dobro do que a placa
   * custa. O catálogo começa pelo total e segue pelo que o compõe, que é a
   * leitura que a tela quer.
   *
   * O que não estiver na lista vai para o fim, na ordem do motor.
   */
  ordemDasVariaveis: readonly string[];
  /** A chave da variável de dinheiro que representa a placa. */
  destaque: string;
  /**
   * A medida de cada variável do catálogo — `medidasDoCatalogo(TODAS)`.
   *
   * Duas perguntas da tela se respondem daqui, e nenhuma delas se responde
   * olhando o recorte: **em que unidade** o destaque da rubrica é medido (o
   * recorte pode não ter a linha dele), e **se esta rubrica tem dinheiro**
   * (a Manutenção não tem: R$/km, meses e percentual, e mais nada). Sem o
   * catálogo, a linha-mãe da Manutenção escrevia "1 (0 em R$)" em toda placa —
   * um complemento que só dizia que a rubrica inteira não é medida em reais.
   *
   * Ausente, o agrupamento assume o que assumia antes: destaque em dinheiro,
   * numa rubrica que tem dinheiro.
   */
  medidas?: Readonly<Record<string, MedidaDaVariavel>>;
  /**
   * As chaves que existem para dar contexto e não contam como alteração.
   *
   * No FINAME é `veiculo` — a entrada e a saída do ativo, que explica todas as
   * outras linhas da placa em vez de ser mais uma delas. Contá-la faria uma
   * placa que só entrou na frota aparecer com "1 alteração" sem nada ter mudado.
   */
  foraDaContagem?: readonly string[];
}

/** Uma variável de catálogo, reduzida ao que o agrupamento lê dela. */
export interface VariavelComMedida {
  chave: string;
  medida: MedidaDaVariavel;
}

/**
 * A medida de cada variável, tirada do catálogo da rubrica.
 *
 * Existe para que `medidas` nunca seja uma segunda lista escrita à mão: ela sai
 * do mesmo `TODAS` que já define a ordem da expansão, e uma variável que mude de
 * unidade muda nos dois lugares de uma vez.
 */
export const medidasDoCatalogo = (
  variaveis: readonly VariavelComMedida[],
): Readonly<Record<string, MedidaDaVariavel>> =>
  Object.fromEntries(variaveis.map((v) => [v.chave, v.medida]));

/**
 * Em que unidade o destaque desta rubrica é medido.
 *
 * Do catálogo, e não do recorte: a resposta tem de ser a mesma na placa cuja
 * linha de destaque veio e na placa cuja linha não veio — é justamente nesta
 * segunda que a tela precisa da unidade para procurar um substituto.
 */
export const medidaDoDestaque = (opcoes: OpcoesDoAgrupamento): MedidaDaVariavel =>
  opcoes.medidas?.[opcoes.destaque] ?? "DINHEIRO";

/**
 * Se esta rubrica tem alguma variável medida em reais.
 *
 * É o que autoriza a linha-mãe a escrever "(0 em R$)": numa rubrica em que
 * nenhuma variável é dinheiro, o complemento não distingue placa nenhuma de
 * placa nenhuma — ele é constante, e um número constante ao lado de uma
 * contagem é lido como se variasse.
 */
export const rubricaTemDinheiro = (opcoes: OpcoesDoAgrupamento): boolean =>
  opcoes.medidas === undefined
    ? true
    : Object.values(opcoes.medidas).includes("DINHEIRO");

const numeroDoTexto = (valor: string | null): number | null => {
  if (valor === null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

const valoresDaLinha = (l: LinhaAgrupavel): DestaqueDoVeiculo => ({
  base: numeroDoTexto(l.base),
  comparada: numeroDoTexto(l.comparada),
  diferenca: l.diferenca,
  variacao: l.variacao,
});

/**
 * Qual das quatro respostas a linha-mãe dá, e com que números.
 *
 * A ordem das perguntas é a regra inteira: a variável declarada manda sempre que
 * está no recorte; sem ela, uma alterada da mesma medida assume **se for a
 * única**; mais de uma, a placa diz quantas são; nenhuma, nulo — e nulo é a
 * única coisa que a tela escreve como travessão.
 */
const destaqueExibidoDe = <L extends LinhaAgrupavel>(
  rascunho: { linha: L | null; candidatas: L[] },
  medida: MedidaDaVariavel,
): DestaqueExibido | null => {
  const nome = (l: L): string => l.rotuloDaVariavel ?? l.variavel;

  if (rascunho.linha !== null) {
    const l = rascunho.linha;
    return {
      tipo: "PRINCIPAL",
      variavel: l.variavel,
      rotulo: nome(l),
      medida: l.medida,
      estado: l.estado,
      valores: valoresDaLinha(l),
    };
  }
  if (rascunho.candidatas.length === 1) {
    const l = rascunho.candidatas[0];
    return {
      tipo: "SUBSTITUTO",
      variavel: l.variavel,
      rotulo: nome(l),
      medida: l.medida,
      estado: l.estado,
      valores: valoresDaLinha(l),
    };
  }
  if (rascunho.candidatas.length > 1) {
    return {
      tipo: "MULTIPLOS",
      medida,
      variaveis: rascunho.candidatas.map(nome),
    };
  }
  return null;
};

/**
 * As linhas viradas uma linha por placa.
 *
 * Duas ordens, e nenhuma é a do motor: as linhas de dentro seguem o catálogo
 * (ver {@link OpcoesDoAgrupamento.ordemDasVariaveis}), e as placas seguem o
 * dinheiro — primeiro quem moveu mais destaque em valor absoluto, depois quem
 * moveu mais variáveis, e a placa desempata. Uma ordem alfabética poria a maior
 * queda do mês na página quatro.
 */
export function agruparVeiculos<L extends LinhaAgrupavel>(
  linhas: readonly L[],
  opcoes: OpcoesDoAgrupamento,
): VeiculoDaRubrica<L>[] {
  const ordem = new Map<string, number>(
    opcoes.ordemDasVariaveis.map((chave, indice) => [chave, indice]),
  );
  const ordemDa = (l: L): number => ordem.get(l.variavel) ?? opcoes.ordemDasVariaveis.length;
  const foraDaContagem = new Set(opcoes.foraDaContagem ?? []);
  const medida = medidaDoDestaque(opcoes);

  const veiculos = new Map<string, VeiculoDaRubrica<L>>();
  /*
    O que cada placa tem para a linha-mãe, além do que já vai no veículo: a
    linha da variável declarada (para saber se ela mudou, e não só se ela
    existe) e as candidatas a substituta. Fica fora do veículo porque é
    rascunho da conta, e não resposta: o que a tela lê é `destaqueExibido`.
  */
  const doDestaque = new Map<string, { linha: L | null; candidatas: L[] }>();

  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const veiculo =
      veiculos.get(chave) ??
      ({
        entityLabel: l.entityLabel,
        entityType: l.entityType,
        alteracoes: 0,
        alteracoesEmDinheiro: 0,
        destaque: null,
        destaqueExibido: null,
        estado: l.estado,
        linhas: [],
      } as VeiculoDaRubrica<L>);

    const rascunho = doDestaque.get(chave) ?? { linha: null, candidatas: [] };
    doDestaque.set(chave, rascunho);

    veiculo.linhas.push(l);

    if (!foraDaContagem.has(l.variavel) && l.estado === "ALTERADO") {
      veiculo.alteracoes++;
      if (l.medida === "DINHEIRO") veiculo.alteracoesEmDinheiro++;
    }
    if (l.variavel === opcoes.destaque) {
      veiculo.destaque = valoresDaLinha(l);
      rascunho.linha = l;
    } else if (
      /*
        Candidata a representar a placa: alterada, na unidade do destaque da
        rubrica, contável e dentro da soma. As três exclusões dizem a mesma
        coisa de três jeitos — o que não conta como alteração, o que está em
        outra unidade e o que é a mesma coluna com outro nome não podem virar
        o número que resume a placa.
      */
      l.estado === "ALTERADO" &&
      l.medida === medida &&
      !foraDaContagem.has(l.variavel) &&
      !l.foraDaSoma
    ) {
      rascunho.candidatas.push(l);
    }
    if (GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(veiculo.estado)) {
      veiculo.estado = l.estado;
    }

    veiculos.set(chave, veiculo);
  }

  /* Estável de propósito: duas linhas da mesma variável mantêm a ordem do
     motor, e só as variáveis diferentes se movem. */
  for (const [chave, veiculo] of veiculos) {
    veiculo.linhas.sort((a, b) => ordemDa(a) - ordemDa(b));
    veiculo.destaqueExibido = destaqueExibidoDe(
      doDestaque.get(chave) ?? { linha: null, candidatas: [] },
      medida,
    );
  }

  /*
    A ordem das placas continua sendo a do destaque **declarado**, e não a do que
    a linha-mãe mostra. É uma escolha, e ela tem razão: ordenar por `destaque`
    compara todas as placas pela mesma variável, e ordenar pelo exibido compararia
    a amortização de uma com a parcela de outra — duas coisas em reais, medidas em
    lugares diferentes do financiamento. Uma placa cuja substituta se moveu
    aparece com número escrito e ordenada como quem não moveu o destaque, que é o
    que de fato aconteceu com ela.
  */
  return [...veiculos.values()].sort((a, b) => {
    const deA = Math.abs(a.destaque?.diferenca ?? 0);
    const deB = Math.abs(b.destaque?.diferenca ?? 0);
    if (deA !== deB) return deB - deA;
    if (a.alteracoes !== b.alteracoes) return b.alteracoes - a.alteracoes;
    return (a.entityLabel ?? "").localeCompare(b.entityLabel ?? "");
  });
}

/**
 * Quantas placas um recorte de linhas tem — o número que as abas mostram.
 *
 * É o tamanho de {@link agruparVeiculos} sobre as mesmas linhas, sem montar os
 * veículos: a contagem não precisa do estado, da ordem nem do destaque, e
 * calcular tudo isso para depois ler só `.length` custaria as sete contagens
 * das abas a cada tecla da busca.
 *
 * Existe porque a aba e a tabela precisam contar **a mesma coisa**. Enquanto a
 * aba contava linhas e a tabela desenhava placas, "Alterados (22)" abria uma
 * tabela de dez veículos — e o cartão ao lado, que sempre contou veículos,
 * dizia 10 sob o mesmo rótulo. Duas respostas para "quantos alterados?" na
 * mesma tela, a um centímetro uma da outra.
 *
 * As abas podem somar mais do que "Todas", e é correto: uma placa com uma
 * variável alterada e outra em conflito é contada nas duas, porque ela aparece
 * nas duas quando se clica — e aparece uma vez só na tabela inteira, que é o
 * que "Todas" conta.
 */
export function contarVeiculos(linhas: readonly LinhaAgrupavel[]): number {
  const placas = new Set<string>();
  for (const l of linhas) placas.add(chaveDoVeiculo(l));
  return placas.size;
}

/**
 * O primeiro valor não nulo de um campo de contexto, entre as linhas da placa.
 *
 * O contexto é **do veículo**, mas chega repetido em cada linha dela — e nem
 * toda linha o declara. A primeira que declara manda; nenhuma que declara, o
 * campo fica nulo. Ausência aqui não vira zero nem string vazia, pela mesma
 * razão que em toda parte: um prazo que ninguém informou não é "0 meses".
 */
export function contextoDasLinhas<L, C>(
  linhas: readonly L[],
  ler: (linha: L) => C | null,
): C | null {
  for (const l of linhas) {
    const valor = ler(l);
    if (valor !== null && valor !== undefined) return valor;
  }
  return null;
}
