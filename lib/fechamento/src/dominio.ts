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
 * As sete fontes que um fechamento consome.
 *
 * Os nomes são os do processo, não os dos arquivos: quem opera chama o
 * relatório pelo número da rotina (`03.08.15`), mas o número é do Promax e
 * pode mudar de versão. O que não muda é o papel de cada um na conta.
 *
 * São sete no catálogo e nem sempre sete na quinzena: a primeira espera cinco,
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
  /**
   * 03.08.18 **FF** — a frota de caminhões contratada × realizada.
   *
   * Origem dos descontos no fixo da frota fixa. Ver
   * {@link FROTA_DA_FONTE} para por que o 03.08.18 são **duas** fontes e não
   * uma com duas abas.
   */
  | "DISPONIBILIDADE_FF"
  /** 03.08.18 **Vans** — a frota dedicada, o outro arquivo do mesmo relatório. */
  | "DISPONIBILIDADE_VAN"
  /**
   * 03.08.12.09 — requisições de despesa aprovadas. Origem do complementar.
   *
   * Esperado na 2ª quinzena e **admitido na 1ª**: a requisição aprovada entre
   * os dias 1 e 15 sai no 03.08.12.09 daquela quinzena, e sem ele o
   * complementar dela não teria de onde nascer.
   */
  | "REQUISICOES"
  /** 03.02.59.02 — a conciliação do Promax. O fecho do mês, e por isso só na 2ª quinzena. */
  | "CONCILIACAO"
  /**
   * 01.22.02.00 — a frota do Promax marcada como **ativa**, na quinzena.
   *
   * **Não é fonte financeira.** Ao contrário das sete acima, ela não forma
   * devido, não demonstra pagamento e não entra em cálculo nenhum de
   * remuneração — é conferência operacional: o que o Promax diz que está em
   * operação, contra o que o cadastro do contrato (`frotaFixaAtiva`,
   * `frotaFixaInativa`, e as Vans quando existirem) diz que deveria estar. Ver
   * {@link ladoDaFonte} e `frota-promax-comparacao.ts`.
   *
   * **Quinzenal, como as outras fontes financeiras — não mensal.** Chega a
   * cada quinzena, no mesmo padrão de `CTE`/`PAGAMENTO`. Ver
   * `FONTES_DA_QUINZENA` e `FONTES_OPCIONAIS_DA_QUINZENA`.
   *
   * TODO(Rebeca): confirmar se é obrigatória em toda quinzena ou apenas
   * admitida quando chega. Hoje está tratada como opcional nas duas quinzenas
   * (ver `FONTES_OPCIONAIS_DA_QUINZENA`), na ausência de instrução explícita —
   * ajustar para obrigatória, se for o caso, é só tirá-la dali.
   *
   * TODO(Rebeca): confirmar o layout real do relatório. O leitor
   * (`leitores/frota-promax.ts`) e o mapeamento de colunas
   * (`leitores/mapeamento-frota-promax.ts`) foram escritos sobre um layout
   * plausível, não sobre uma amostra real.
   */
  | "FROTA_PROMAX_ATIVA"
  /**
   * 01.22.08.00 — a frota do Promax marcada como **inativa**, na quinzena.
   *
   * O par de {@link FROTA_PROMAX_ATIVA}. Mesma natureza operacional, mesma
   * periodicidade quinzenal, mesma pendência de layout real e de
   * obrigatoriedade.
   *
   * TODO(Rebeca): confirmar se, no Promax, a frota fixa e as Vans vêm
   * discriminadas em arquivos separados — o que forçaria evoluir de duas para
   * quatro fontes, no mesmo espírito de {@link FROTA_DA_FONTE}. Hoje as duas
   * frotas entram misturadas no mesmo arquivo/fonte, por decisão deliberada de
   * não antecipar essa discriminação sem a amostra real.
   */
  | "FROTA_PROMAX_INATIVA";

export const TIPOS_DE_FONTE: TipoDeFonte[] = [
  "OPERACAO",
  "CTE",
  "PAGAMENTO",
  "DISPONIBILIDADE_FF",
  "DISPONIBILIDADE_VAN",
  "REQUISICOES",
  "CONCILIACAO",
  "FROTA_PROMAX_ATIVA",
  "FROTA_PROMAX_INATIVA",
];

/** As duas fontes da frota Promax — o recorte que os módulos de frota usam. */
export const TIPOS_DE_FROTA_PROMAX: readonly TipoDeFonte[] = [
  "FROTA_PROMAX_ATIVA",
  "FROTA_PROMAX_INATIVA",
];

/**
 * De que frota contratada cada casinha do 03.08.18 responde.
 *
 * **O 03.08.18 são dois arquivos, e por isso são duas fontes.** Os dois medem a
 * mesma coisa — frota contratada contra a que rodou, e o desconto que a
 * diferença gera —, mas um é da frota de caminhões e o outro é das vans, saem
 * do Promax em exportações separadas, e chegam em horas diferentes pelas mãos
 * de pessoas diferentes. Enquanto os dois disputavam uma casinha só, o segundo
 * a chegar despromovia o primeiro: a competência ficava com meio 03.08.18 e
 * nada na tela dizia qual metade tinha sumido.
 *
 * Duas casinhas resolvem isso pela raiz — cada frota tem a sua vigência, o seu
 * documento e o seu histórico —, e o preço é uma pergunta a mais na porta de
 * entrada: **de que frota é este arquivo?** Quem responde é a casinha em que
 * ele foi enviado, e a leitura só admite as linhas daquela frota (ver
 * `leitores/disponibilidade`). O arquivo que traz as duas abas é o mesmo nas
 * duas casinhas: cada uma lê a sua e ignora a outra.
 *
 * O mapa é `Partial` porque as outras cinco fontes não têm frota: elas falam da
 * quinzena inteira. Ver {@link frotaDaFonte}, que é como se pergunta.
 */
export const FROTA_DA_FONTE: Partial<Record<TipoDeFonte, TipoDeFrotaContratada>> = {
  DISPONIBILIDADE_FF: "FF",
  DISPONIBILIDADE_VAN: "VAN",
};

/** A frota que esta fonte recorta, ou `null` quando ela não recorta nenhuma. */
export function frotaDaFonte(tipo: TipoDeFonte): TipoDeFrotaContratada | null {
  return FROTA_DA_FONTE[tipo] ?? null;
}

/**
 * De qual situação (ativa/inativa) cada casinha da frota Promax responde —
 * o mesmo desenho de {@link FROTA_DA_FONTE}, para o par 01.22.02.00/01.22.08.00.
 */
export const SITUACAO_DA_FROTA_PROMAX: Partial<Record<TipoDeFonte, "ATIVA" | "INATIVA">> = {
  FROTA_PROMAX_ATIVA: "ATIVA",
  FROTA_PROMAX_INATIVA: "INATIVA",
};

/** A situação (ativa/inativa) que esta fonte recorta, ou `null` quando não se aplica. */
export function situacaoDaFrotaPromax(tipo: TipoDeFonte): "ATIVA" | "INATIVA" | null {
  return SITUACAO_DA_FROTA_PROMAX[tipo] ?? null;
}

/**
 * Quais das sete fontes cada quinzena **espera**.
 *
 * **A primeira quinzena fecha com cinco relatórios; a segunda, com os sete.**
 * A conciliação do Promax (03.02.59.02) é o fecho do mês e chega com o
 * fechamento da segunda quinzena: na primeira ela não existe. As requisições
 * (03.08.12.09) também não são esperadas ali, mas por outro motivo, e é por
 * isso que elas moram na lista de baixo em vez de nesta. A frota Promax
 * (`FROTA_PROMAX_ATIVA`/`FROTA_PROMAX_INATIVA`) também mora na lista de baixo,
 * pelo mesmo motivo das requisições — não porque seja mensal (é quinzenal,
 * como as outras fontes financeiras), mas porque ainda não há confirmação de
 * que seja obrigatória em toda quinzena. Ver o TODO em `TipoDeFonte`.
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
  1: ["OPERACAO", "CTE", "PAGAMENTO", "DISPONIBILIDADE_FF", "DISPONIBILIDADE_VAN"],
  /*
    A frota Promax é quinzenal, não mensal — mas fica de fora da lista de
    "esperada" pelo mesmo motivo do 03.08.12.09: hoje ela é opcional em toda
    quinzena (ver `FONTES_OPCIONAIS_DA_QUINZENA` e o TODO em `TipoDeFonte`), e
    "opcional" e "esperada" são a mesma fonte só quando ela é obrigatória.
  */
  2: TIPOS_DE_FONTE.filter((t) => !TIPOS_DE_FROTA_PROMAX.includes(t)),
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
 *
 * **A frota Promax entra aqui pelo mesmo motivo, nas duas quinzenas.** Ela é
 * quinzenal — chega a cada quinzena, como CT-e ou pagamento — mas não há hoje
 * instrução confirmada de que seja obrigatória em toda quinzena. Até essa
 * confirmação (TODO(Rebeca), ver `TipoDeFonte`), ela entra como opcional nas
 * duas: se a Rebeca confirmar a obrigatoriedade, o ajuste é remover as duas
 * fontes daqui e somá-las à lista de cima.
 */
export const FONTES_OPCIONAIS_DA_QUINZENA: Record<1 | 2, TipoDeFonte[]> = {
  1: ["REQUISICOES", ...TIPOS_DE_FROTA_PROMAX],
  2: [...TIPOS_DE_FROTA_PROMAX],
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
 * O estado das sete fontes numa quinzena, dado o que chegou.
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

      **E as duas metades são cobradas separadas, nas duas quinzenas.** Aquele
      episódio é o retrato de por que: a `FF` e a `Van` do 03.08.18 são dois
      arquivos, com histórias próprias, e uma casinha só as fazia disputar a
      mesma vigência — a segunda a chegar apagava a primeira em silêncio. Cada
      frota tem a sua linha aqui, e a que faltar é nomeada pela frota que
      faltou (ver `FROTA_DA_FONTE`).
    */
    const estado: EstadoDaFonte = chegou.has(tipo)
      ? "PRESENTE"
      : esperada
        ? "AUSENTE"
        : "NAO_APLICAVEL";
    return { tipo, quinzena, estado, rotina: DESCRICAO_DA_FONTE[tipo].rotina, opcional };
  });
}

/**
 * De que lado da conferência uma fonte está.
 *
 * **A conferência do fechamento é entre dois lados que saem de arquivos
 * diferentes.** É isso que lhe dá força: o devido é formado pelo cadastro e
 * pelos relatórios da operação; o demonstrado é lido do 03.08.20. Dois
 * documentos que ninguém escreveu olhando o outro chegando ao mesmo centavo é
 * uma afirmação sobre a operação, e não sobre a leitura.
 */
export type LadoDaConferencia =
  /** Forma o **devido** — junto do contrato, que não é arquivo. */
  | "DEVIDO"
  /** É o **demonstrado**: o que a Ambev declara que vai pagar. */
  | "DEMONSTRADO"
  /** Não entra na comparação: o faturamento e o fecho da quinzena. */
  | "FATURAMENTO"
  /**
   * Conferência de frota — **não é financeira**, não entra em `DEVIDO` nem em
   * `DEMONSTRADO`, e não alimenta cálculo de remuneração nenhum.
   *
   * **Existe como categoria própria, e não como um `FATURAMENTO` a mais, de
   * propósito.** `FATURAMENTO` é "não entra na comparação entre devido e
   * demonstrado, mas ainda é dinheiro" (CT-e emitido, ajustes do fecho). A
   * frota Promax não é dinheiro nenhum: é contagem de veículo, ativo ou
   * inativo, contra o cadastro do contrato. Misturar as duas faria uma leitura
   * apressada de `FATURAMENTO` somar veículos a reais. Ver
   * `frota-promax-comparacao.ts`, que é onde essa conferência de fato roda —
   * fora do motor financeiro, num módulo que não é importado por ele.
   */
  | "CONFERENCIA_OPERACIONAL";

/* ---------------------------------------------------------------------------
   A classificação — declarada aqui, e não deduzida na tela
   ------------------------------------------------------------------------ */

/**
 * Os relatórios que, **com o cadastro**, formam o valor devido.
 *
 * Nenhum deles é o contrato, e nenhum deles produz número sozinho. O que cada
 * um traz:
 *
 * - `OPERACAO` (2Art) — a operação que alimenta a remuneração variável;
 * - `DISPONIBILIDADE_FF` e `DISPONIBILIDADE_VAN` (03.08.18) — o desconto de
 *   disponibilidade, num arquivo por frota;
 * - `REQUISICOES` (03.08.12.09) — outros custos e requisições de despesa.
 *
 * O cadastro entra por fora desta lista porque não chega por importação: ele
 * traz as regras, as tarifas e os parâmetros. Ver `LADOS_DA_CONFERENCIA`, que é
 * onde o grupo declara que depende dele.
 *
 * **É uma afirmação sobre a conta, e ela é conferível.** `matriz.ts` declara,
 * linha a linha do `RESUMO GERAL`, de que fonte operacional o devido daquela
 * linha sai — e `lados-da-conferencia.test.ts` confronta esta lista com aquela
 * declaração. Uma fonte que entrasse aqui sem alimentar linha nenhuma, ou que
 * passasse a alimentar sem entrar aqui, derruba o teste.
 */
export const FONTES_QUE_FORMAM_O_DEVIDO: readonly TipoDeFonte[] = [
  "OPERACAO",
  "DISPONIBILIDADE_FF",
  "DISPONIBILIDADE_VAN",
  "REQUISICOES",
];

/**
 * A fonte que demonstra o pagamento — uma só, e é o 03.08.20.
 *
 * **Ser uma só é o que sustenta a conferência.** O devido é confrontado contra
 * ela; se um segundo documento entrasse deste lado, ou se ela passasse a ser
 * também a origem do devido, a comparação começaria a concordar consigo mesma —
 * que é exatamente o estado de que este módulo saiu, quando o painel era uma
 * releitura do próprio demonstrativo.
 *
 * Duas linhas do resumo têm o devido lido dela (o desconto de devolução e o
 * complementar negativo), e isso é sabido e medido: são as parcelas de classe
 * `MESMA_FONTE`, que entram na precisão e **não** entram no lastro. Ver
 * `ClasseDeLastro`, em `afericao.ts`.
 */
export const FONTE_QUE_DEMONSTRA_O_PAGAMENTO: TipoDeFonte = "PAGAMENTO";

/**
 * As fontes de faturamento e fechamento — as que **não** entram na comparação.
 *
 * - `CTE` (03.08.15) — o que foi faturado, verba a verba;
 * - `CONCILIACAO` (03.02.59.02) — os ajustes e o fecho que atravessam a quinzena.
 *
 * **Não é sobra de classificação.** Nenhuma das duas aparece como fonte
 * operacional de linha nenhuma do `RESUMO GERAL`: elas não formam devido e não
 * demonstram pagamento. O 03.08.15 responde por um terceiro eixo — o emitido em
 * CT-e, com linha própria no fecho — e o 03.02.59.02 traz dois ajustes
 * nominais. Forçá-las para um dos lados diria que alimentam um confronto do
 * qual não participam.
 */
export const FONTES_DE_FATURAMENTO: readonly TipoDeFonte[] = ["CTE", "CONCILIACAO"];

/**
 * As fontes de conferência operacional — a frota Promax, e só ela hoje.
 *
 * **Esta lista é o que impede a frota de cair em `DEVIDO`/`DEMONSTRADO` por
 * omissão.** `ladoDaFonte` é `if`/`else` encadeado sobre listas fechadas; sem
 * uma entrada própria para a frota, ela cairia no último `else` — que hoje é
 * `FATURAMENTO` — e uma fonte de veículos passaria a ser lida como dinheiro de
 * faturamento. Ver `dominio-frota-promax.test.ts`, que confere isto, e
 * `contaminacao.test.ts`, que confere que nenhuma rotina financeira do módulo
 * trata estas duas fontes como `DEVIDO` ou `DEMONSTRADO`.
 */
export const FONTES_DE_CONFERENCIA_OPERACIONAL: readonly TipoDeFonte[] = [...TIPOS_DE_FROTA_PROMAX];

/**
 * De que lado uma fonte está — **derivado** das três listas acima.
 *
 * É função e não campo de propósito. Enquanto `lado` era um campo escrito à mão
 * ao lado de cada fonte, ele podia divergir da lista sem nada acusar — duas
 * declarações da mesma coisa, e a que a tela lia não era a que os testes
 * prendiam. Derivando, a divergência deixa de ser possível.
 */
export function ladoDaFonte(tipo: TipoDeFonte): LadoDaConferencia {
  if (tipo === FONTE_QUE_DEMONSTRA_O_PAGAMENTO) return "DEMONSTRADO";
  if (FONTES_QUE_FORMAM_O_DEVIDO.includes(tipo)) return "DEVIDO";
  if (FONTES_DE_CONFERENCIA_OPERACIONAL.includes(tipo)) return "CONFERENCIA_OPERACIONAL";
  return "FATURAMENTO";
}

/**
 * Os três lados, na ordem em que a tela os empilha, com o texto que os explica.
 *
 * **O contrato aparece no primeiro, e ele não é arquivo.** É a razão de esta
 * lista existir: uma competência com os três relatórios do devido importados e
 * sem a aba do cadastro digitada não produz devido nenhum, e a tela de
 * importação não tinha onde dizer isso — mostrava três vistos verdes e um
 * painel vazio noutra tela. Ver `precisaDeContrato`.
 */
export const LADOS_DA_CONFERENCIA: {
  lado: LadoDaConferencia;
  titulo: string;
  explica: string;
  /** O grupo depende também do contrato, que não chega por importação. */
  precisaDeContrato: boolean;
}[] = [
  {
    lado: "DEVIDO",
    titulo: "O que forma o valor devido",
    explica:
      "Nenhum destes é o contrato, e nenhum produz número sozinho — juntos é que formam o " +
      "devido. O cadastro traz as regras, as tarifas e os parâmetros; o 2Art traz a operação " +
      "que alimenta a remuneração variável; o 03.08.18 traz o desconto de disponibilidade, " +
      "num arquivo por frota — a FF e as vans descontam coisas diferentes e chegam separadas; " +
      "o 03.08.12.09, outros custos e requisições de despesa.",
    precisaDeContrato: true,
  },
  {
    lado: "DEMONSTRADO",
    titulo: "O que a Ambev demonstrou pagar",
    explica:
      "O outro lado da conferência, num arquivo só: é contra ele que o devido é confrontado. " +
      "Vir de fonte independente é o que faz baterem significar alguma coisa.",
    precisaDeContrato: false,
  },
  {
    lado: "FATURAMENTO",
    titulo: "Faturamento e fechamento",
    explica:
      "Não entram na comparação entre o devido e o demonstrado: o 03.08.15 é o que foi " +
      "faturado em CT-e e o 03.02.59.02 traz os ajustes e o fecho que atravessam a quinzena.",
    precisaDeContrato: false,
  },
  {
    lado: "CONFERENCIA_OPERACIONAL",
    titulo: "Frota — conferência operacional",
    explica:
      "Não é dinheiro, e não entra em cálculo de remuneração nenhum: é o que o Promax diz " +
      "que está ativo ou inativo na frota, comparado contra o que o cadastro do contrato " +
      "declara. O sistema não decide qual número está certo — só aponta a diferença.",
    precisaDeContrato: true,
  },
];

/**
 * Como cada fonte se chama na tela e o que ela responde.
 *
 * **O lado da conferência não mora aqui** — ele é derivado por `ladoDaFonte`,
 * das três listas acima. Enquanto era um campo escrito ao lado de cada fonte,
 * havia duas declarações da mesma coisa e nada impedia que divergissem.
 */
export const DESCRICAO_DA_FONTE: Record<
  TipoDeFonte,
  { rotina: string; nome: string; papel: string }
> = {
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
  DISPONIBILIDADE_FF: {
    rotina: "03.08.18 FF",
    nome: "Disponibilidade da frota fixa",
    papel:
      "Caminhão contratado contra o que rodou: é daqui que saem os descontos no fixo da FF.",
  },
  DISPONIBILIDADE_VAN: {
    rotina: "03.08.18 Vans",
    nome: "Disponibilidade das vans",
    papel:
      "A mesma medida para a frota dedicada: van contratada contra a que rodou, e o desconto dela.",
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
  FROTA_PROMAX_ATIVA: {
    rotina: "01.22.02.00",
    nome: "Frota Promax — ativa",
    papel:
      "Os veículos que o Promax marca como ativos na quinzena — conferência operacional contra o " +
      "cadastro do contrato, não financeira.",
  },
  FROTA_PROMAX_INATIVA: {
    rotina: "01.22.08.00",
    nome: "Frota Promax — inativa",
    papel:
      "Os veículos que o Promax marca como inativos na quinzena — o par de FROTA_PROMAX_ATIVA.",
  },
};

/**
 * Em que formatos cada fonte chega — e, portanto, quais o produto aceita.
 *
 * **A lista é do que se sabe ler, não do que se sabe abrir.** Nenhuma das sete
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
  DISPONIBILIDADE_FF: [".xlsx", ".xls", ".csv", ".txt"],
  DISPONIBILIDADE_VAN: [".xlsx", ".xls", ".csv", ".txt"],
  REQUISICOES: [".csv", ".txt", ".xlsx", ".xls"],
  CONCILIACAO: [".txt", ".csv"],
  /*
   * TODO(Rebeca): confirmar o formato real de exportação do 01.22.02.00 e do
   * 01.22.08.00. A lista aceita o que o Promax costuma exportar nos outros
   * relatórios; quem decide qual leitor abrir é sempre o conteúdo dos bytes
   * (ver `leitores/formato.ts`), nunca a extensão.
   */
  FROTA_PROMAX_ATIVA: [".xlsx", ".xls", ".csv", ".txt"],
  FROTA_PROMAX_INATIVA: [".xlsx", ".xls", ".csv", ".txt"],
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
