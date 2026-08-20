import { centavos } from "./dominio";

/**
 * O MOTOR DA PLANILHA — o `Mapa Rota` sem planilha.
 *
 * O `RESUMO GERAL` da `.xlsb` não lê nenhuma das linhas dele de um relatório.
 * Ele **calcula**: cada célula da aba aponta para uma linha do `Mapa Rota`, e
 * cada linha do `Mapa Rota` é uma fórmula sobre a aba `Cadastro` — a frota
 * contratada, a tarifa por veículo, as alíquotas do estado e do município — ou
 * sobre o diário operacional. Este módulo é essa aba, escrita como código.
 *
 * **Por que isso importa, e por que o painel vinha vazio.** O de-para que
 * existia antes traduzia as mesmas dezoito linhas a partir do 03.08.20, e por
 * isso o painel inteiro dependia de um relatório que a planilha nunca abre —
 * não há aba `03.08.20` na pasta. Sem ele importado, o painel não tinha o que
 * mostrar; com ele, mostraria um rateio que o demonstrativo não faz. As duas
 * leituras convivem: esta diz **quanto é devido** pelo contrato, e a do
 * de-para diz **quanto foi demonstrado**. É a diferença entre elas que se
 * discute na mesa, e ela só existe quando as duas são calculadas de fontes
 * diferentes.
 *
 * **A regra herdada do pacote: nenhuma linha inventa a sua origem.** Cada linha
 * devolvida diz de que parâmetro e de que documento ela saiu. Um parâmetro que
 * não veio fica `null` — nunca zero —, porque uma frota inativa que custou zero
 * e uma frota inativa cujo cadastro não chegou são afirmações diferentes.
 *
 * **Onde a planilha se contradiz, isto não a imita.** Três fórmulas dela estão
 * quebradas por exclusão de linha e sobrevivem em valor de cache
 * (`TOTAL OUTROS CUSTOS`, e o `Custo Variável (Recarga e Noturna)` diário), e
 * uma lê a fatia ISS de uma célula do próprio mapa em vez do cadastro
 * (`AJ133`, que é a origem inteira dos R$ 128,05 de diferença na 2ª quinzena).
 * Aqui a regra é uma só nas duas quinzenas; `docs/MAPA-ROTA.md` registra cada
 * divergência com o número que ela produz, para que a conferência contra o
 * `.xlsb` saiba de antemão onde vai discordar e por quê.
 */

/** As alíquotas do estado e do município, como o cadastro as guarda. */
export interface AliquotasDoCadastro {
  pis: number;
  cofins: number;
  icms: number;
  iss: number;
}

/**
 * Os parâmetros de uma quinzena — a aba `Cadastro`, coluna C ou F.
 *
 * **Por que os valores são mensais e as linhas quinzenais.** O contrato fixa o
 * valor do mês; a planilha divide por dois em cada linha (`/2` aparece nas
 * cinco). Guardar o mensal e dividir aqui mantém o cadastro igual ao contrato
 * — que é o documento que alguém confere quando o número surpreende.
 */
export interface ParametrosDoCadastro {
  aliquotas: AliquotasDoCadastro;
  /**
   * A fatia dos documentos emitidos dentro do município (NF-ISS).
   *
   * É o que decide, em cada linha, quanto do bruto é calculado pela alíquota do
   * ISS e quanto pela do ICMS. A planilha a traz digitada no cadastro **e**
   * calculada do diário; as duas divergem, e é essa divergência que produz os
   * R$ 128,05 da 2ª quinzena.
   */
  parcelaDentroDoMunicipio: number;

  /* --- a frota contratada ------------------------------------------------ */
  frotaFixaAtiva: number;
  frotaFixaInativa: number;

  /* --- o valor de um veículo ativo, por mês, sem imposto ----------------- */
  remuneracaoFixaDaFrotaAtiva: number;
  remuneracaoDaEquipeDeEntrega: number;
  remuneracaoDoQlpAdministrativo: number;
  remuneracaoDeOutrasDespesas: number;

  /* --- o veículo inativo -------------------------------------------------- */
  remuneracaoDaFrotaInativa: number;

  /* --- as vans ------------------------------------------------------------ */
  vansAtivas: number;
  custoFixoDaVan: number;
  custoDaEquipeDeEntregaDaVan: number;
  vansInativas: number;
  remuneracaoDasVansInativas: number;

  /* --- noturna e marketing, que a planilha chama de "especiais" ---------- */
  rotasNoturnas: number;
  custoDaNoturnaSemImposto: number;
  custoDeMarketingSemImposto: number;
}

/**
 * O que os documentos da quinzena sustentam — nada disto sai do cadastro.
 *
 * Os três descontos chegam **sem imposto**, que é como a planilha os acumula na
 * última coluna de dia da quinzena, e é aqui que eles são levados ao bruto.
 */
export interface BasesDaQuinzena {
  /** A devolução acumulada, sem imposto. `null` quando o documento não veio. */
  devolucao: number | null;
  /** A disponibilidade acumulada, sem imposto (03.08.18). */
  disponibilidade: number | null;
  /** O complementar negativo — o único que a planilha não bruta. */
  complementarNegativo: number | null;
  /** O total de outros custos da quinzena (03.08.12.09). */
  outrosCustos: number | null;
  /** A indisponibilidade do diário operacional. */
  indisponibilidade: number | null;
}

/**
 * O custo variável da quinzena, somado do diário operacional.
 *
 * Vem à parte de {@link BasesDaQuinzena} porque as quatro parcelas são o único
 * lugar do resumo em que o número é a operação e não o contrato — e porque a
 * frota fixa não é a soma do que se faturou, e sim o valor padrão do veículo
 * vezes os mapas fechados. Ver {@link somarVariavel}.
 */
export interface VariavelDaQuinzena {
  frotaFixa: number | null;
  agregado: number | null;
  recargaENoturna: number | null;
  vans: number | null;
}

/* ---------------------------------------------------------------------------
   A aritmética do imposto
   ------------------------------------------------------------------------ */

/**
 * O divisor de dentro e o de fora do município.
 *
 * `1 − (PIS + COFINS + ISS)` e `1 − (PIS + COFINS + ICMS)`. A planilha os
 * escreve em `Cadastro!C53` e `C54` e os repete dentro de cada fórmula; aqui
 * eles têm nome porque é deles que sai tudo o mais.
 */
export function divisoresDe(a: AliquotasDoCadastro): { dentro: number; fora: number } {
  return {
    dentro: 1 - (a.pis + a.cofins + a.iss),
    fora: 1 - (a.pis + a.cofins + a.icms),
  };
}

/**
 * O fator que leva um valor sem imposto ao bruto — o mesmo em toda linha fixa.
 *
 * É a média dos dois grossups, pesada pela fatia de documentos emitidos dentro
 * e fora do município. **É este número — e não um fator digitado — que a
 * planilha aplica**: para a 2ª quinzena de julho/2026 ele vale exatamente
 * 1,366960, que é o valor que o produto vinha registrando como "um fator de
 * conversão que não sai de arquivo nenhum". Sai: das quatro alíquotas e da
 * fatia de emissão, todas no cadastro.
 */
export function fatorDeImposto(
  aliquotas: AliquotasDoCadastro,
  parcelaDentroDoMunicipio: number,
): number {
  const { dentro, fora } = divisoresDe(aliquotas);
  const parcelaFora = 1 - parcelaDentroDoMunicipio;
  return parcelaDentroDoMunicipio / dentro + parcelaFora / fora;
}

/** Um valor sem imposto levado ao bruto, pelo fator acima. */
function bruto(valor: number, p: ParametrosDoCadastro): number {
  return valor * fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio);
}

/** Metade do mês — o que toda linha fixa faz antes de qualquer outra coisa. */
function porQuinzena(mensal: number): number {
  return mensal / 2;
}

/* ---------------------------------------------------------------------------
   As linhas
   ------------------------------------------------------------------------ */

/**
 * Como o **custo fixo padronizado** pesa os dois lados do imposto.
 *
 * Esta escolha é explícita porque a planilha não a faz igual nas duas quinzenas,
 * e porque decidir por ela em silêncio trocaria um erro visível por um
 * invisível. No `RESUMO GERAL` de julho/2026:
 *
 * ```
 * Mapa Rota!AI133 (1ª)  base × Cadastro!$C$49 ÷ dentro  +  base × Cadastro!$C$50 ÷ fora
 * Mapa Rota!AJ133 (2ª)  base × Cadastro!$F$49 ÷ dentro  +  base × Mapa Rota!AJ119 ÷ fora
 * ```
 *
 * A 1ª pesa os dois lados pelo cadastro, e `C49 + C50 = 1` por construção
 * (`C50 = 1 − C49`). A 2ª pesa o lado de dentro pelo cadastro e o de fora pelo
 * diário — **duas fontes independentes na mesma soma**. O defeito não é a fonte
 * escolhida, é a mistura: `F49 + AJ119 = 0,9998274`, e a fórmula desconta
 * silenciosamente 0,0173 % da base por os pesos não fecharem em 1.
 *
 * O efeito é de **R$ 128,05** no mês, atravessando o `TOTAL REMUNERAÇÃO ROTA` e
 * o `TOTAL GERAL UNIDADE`. Todas as demais linhas fixas, nas duas quinzenas,
 * pesam pelo cadastro.
 *
 * `CADASTRO` é a regra que este módulo **propõe**: uma fonte só, pesos que
 * somam 1, igual ao resto do quadro. `PLANILHA_LEGADA` **reproduz** o que a 2ª
 * quinzena faz hoje, para quem precisa bater linha a linha com o `.xlsb` antes
 * de mudar qualquer coisa. Nenhuma das duas é padrão escondido: a linha
 * devolvida diz em `memoria` qual foi usada e com que pesos.
 */
export type FatiaDoPadronizado =
  /** Pesa os dois lados pelo cadastro — a regra proposta. */
  | { fonte: "CADASTRO" }
  /**
   * Pesa o lado de dentro pelo cadastro e o de fora por este número, como
   * `Mapa Rota!AJ119`. Reproduz a 2ª quinzena da planilha, pesos frouxos
   * inclusive.
   */
  | { fonte: "PLANILHA_LEGADA"; foraDoMunicipio: number };

/** O papel da linha dentro do quadro — decide como ela soma. */
export type PapelNoMapa = "PARCELA" | "DESCONTO" | "TOTAL";

/**
 * Uma linha do `RESUMO GERAL`, com o número e a conta que o produziu.
 *
 * `memoria` não é enfeite: é o que permite a quem abre a tela discordar do
 * número sem abrir a planilha. Uma linha que só mostra o resultado obriga a
 * confiar; uma que mostra `56 veículos × R$ 9.566,45 × 1,365455` se confere.
 */
export interface LinhaDoMapa {
  chave: string;
  /** O rótulo literal da planilha, para conferir contra o arquivo. */
  rotulo: string;
  papel: PapelNoMapa;
  /** `null` quando falta parâmetro ou documento — nunca zero por ausência. */
  valor: number | null;
  /** A conta, em português, com os números que entraram nela. */
  memoria: string;
  /** O que falta, quando falta. `null` quando a linha tem número. */
  falta: string | null;
}

function linha(
  chave: string,
  rotulo: string,
  papel: PapelNoMapa,
  valor: number | null,
  memoria: string,
  falta: string | null = null,
): LinhaDoMapa {
  return { chave, rotulo, papel, valor: valor === null ? null : centavos(valor), memoria, falta };
}

/**
 * As cinco linhas de custo fixo — as que a planilha calcula só do cadastro.
 *
 * Nenhuma delas passa por relatório nenhum, e é por isso que elas sobrevivem à
 * ausência do 03.08.20: o que as sustenta é o contrato. O que o demonstrativo
 * faria é **conferi-las**, não produzi-las.
 */
export function linhasDoCustoFixo(
  p: ParametrosDoCadastro,
  fatiaDoPadronizado: FatiaDoPadronizado = { fonte: "CADASTRO" },
): LinhaDoMapa[] {
  const fator = fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio);
  const f = fator.toFixed(6);

  /*
    O padronizado é a única linha que pode pesar diferente — ver
    {@link FatiaDoPadronizado}. As outras quatro pesam pelo cadastro sempre,
    porque é o que a planilha faz nas duas quinzenas.
  */
  const { dentro, fora } = divisoresDe(p.aliquotas);
  const pesoDentro = p.parcelaDentroDoMunicipio;
  const pesoFora =
    fatiaDoPadronizado.fonte === "PLANILHA_LEGADA"
      ? fatiaDoPadronizado.foraDoMunicipio
      : 1 - p.parcelaDentroDoMunicipio;
  const fatorDoPadrao = pesoDentro / dentro + pesoFora / fora;
  const origemDaFatia =
    fatiaDoPadronizado.fonte === "PLANILHA_LEGADA"
      ? `pesos ${pesoDentro.toFixed(6)} (cadastro) + ${pesoFora.toFixed(6)} (diário, Mapa Rota!AJ119) = ` +
        `${(pesoDentro + pesoFora).toFixed(7)} — reprodução da planilha`
      : `pesos ${pesoDentro.toFixed(6)} + ${pesoFora.toFixed(6)} = 1, os dois do cadastro`;

  /* O veículo ativo é a soma das quatro parcelas do cadastro, não uma delas. */
  const porVeiculo =
    p.remuneracaoFixaDaFrotaAtiva +
    p.remuneracaoDaEquipeDeEntrega +
    p.remuneracaoDoQlpAdministrativo +
    p.remuneracaoDeOutrasDespesas;
  const padronizado = porQuinzena(porVeiculo) * p.frotaFixaAtiva;

  const inativos = porQuinzena(p.remuneracaoDaFrotaInativa) * p.frotaFixaInativa;
  const vansInativas = porQuinzena(p.remuneracaoDasVansInativas) * p.vansInativas;
  const vansAtivas = (p.custoFixoDaVan + p.custoDaEquipeDeEntregaDaVan) * p.vansAtivas;

  /*
    Especiais é a única que bruta antes de partir pela metade, e a única em que
    a planilha multiplica pela fatia de dentro e pela de fora e soma as duas —
    o que dá exatamente ×1, já que as fatias somam 1. A redundância é dela;
    reproduzi-la aqui só acrescentaria uma multiplicação que não muda nada.
  */
  const noturna = porQuinzena(bruto(p.custoDaNoturnaSemImposto, p)) * p.rotasNoturnas;
  const marketing = porQuinzena(bruto(p.custoDeMarketingSemImposto, p));

  return [
    linha(
      "custo_fixo_padronizado",
      "CUSTO FIXO PADRONIZADO",
      "PARCELA",
      padronizado * fatorDoPadrao,
      `(${porVeiculo.toFixed(2)} ÷ 2) × ${p.frotaFixaAtiva} veículos ativos × ` +
        `${fatorDoPadrao.toFixed(6)} — ${origemDaFatia}`,
    ),
    linha(
      "custo_fixo_inativos",
      "CUSTO FIXO INATIVOS",
      "PARCELA",
      bruto(inativos, p),
      `(${p.remuneracaoDaFrotaInativa.toFixed(2)} ÷ 2) × ${p.frotaFixaInativa} veículos inativos × ${f}`,
    ),
    linha(
      "custo_vans_inativas",
      "CUSTO VANS INATIVAS",
      "PARCELA",
      bruto(vansInativas, p),
      `(${p.remuneracaoDasVansInativas.toFixed(2)} ÷ 2) × ${p.vansInativas} vans inativas × ${f}`,
    ),
    linha(
      "custo_fixo_especiais",
      "CUSTO FIXO - ESPECIAIS",
      "PARCELA",
      noturna + marketing,
      `noturna (${p.custoDaNoturnaSemImposto.toFixed(2)} × ${f} ÷ 2) × ${p.rotasNoturnas} rota(s)` +
        ` + marketing (${p.custoDeMarketingSemImposto.toFixed(2)} × ${f} ÷ 2)`,
    ),
    linha(
      "custo_fixo_vans",
      "CUSTO FIXO - VANS",
      "PARCELA",
      porQuinzena(bruto(vansAtivas, p)),
      `(${p.custoFixoDaVan.toFixed(2)} + ${p.custoDaEquipeDeEntregaDaVan.toFixed(2)}) × ${p.vansAtivas} vans × ${f} ÷ 2`,
    ),
  ];
}

/**
 * As três linhas de desconto — as únicas do quadro fixo que vêm de documento.
 *
 * Devolução e disponibilidade chegam sem imposto e sobem ao bruto pelo mesmo
 * fator das parcelas; o complementar negativo **não sobe**, e essa assimetria é
 * da planilha, não um esquecimento nosso: ele já vem no valor em que é
 * descontado. Os três entram negativos.
 */
export function linhasDeDesconto(
  p: ParametrosDoCadastro,
  bases: BasesDaQuinzena,
): LinhaDoMapa[] {
  const fator = fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio);
  const f = fator.toFixed(6);
  const brutado = (base: number | null) => (base === null ? null : -bruto(base, p));

  return [
    linha(
      "desconto_devolucao_percentual",
      "DESCONTO DE DEVOLUÇÃO %",
      "DESCONTO",
      brutado(bases.devolucao),
      bases.devolucao === null
        ? "sem base de devolução na quinzena"
        : `${bases.devolucao.toFixed(2)} sem imposto × ${f}, negativo`,
      bases.devolucao === null ? "a devolução acumulada da quinzena" : null,
    ),
    linha(
      "desconto_disponibilidade",
      "DESCONTO DE DISPONIBILIDADE",
      "DESCONTO",
      brutado(bases.disponibilidade),
      bases.disponibilidade === null
        ? "sem base de disponibilidade na quinzena"
        : `${bases.disponibilidade.toFixed(2)} sem imposto × ${f}, negativo`,
      bases.disponibilidade === null ? "o 03.08.18 da quinzena" : null,
    ),
    linha(
      "desconto_complementar_negativo",
      "DESCONTO COMPLEMENTAR NEGATIVO",
      "DESCONTO",
      bases.complementarNegativo === null ? null : -bases.complementarNegativo,
      bases.complementarNegativo === null
        ? "sem complementar negativo na quinzena"
        : `${bases.complementarNegativo.toFixed(2)}, negativo e sem bruto — a planilha não o bruta`,
      bases.complementarNegativo === null ? "o complementar negativo da quinzena" : null,
    ),
  ];
}

/* ---------------------------------------------------------------------------
   O lado variável — o único que sai da operação
   ------------------------------------------------------------------------ */

/** Uma viagem do diário operacional, no mínimo que o mapa precisa dela. */
export interface ViagemDoMapa {
  /** `Padrao`, `Spot`, `Fixo` (que é a van) — a coluna FROTA do 2Art. */
  frota: string;
  /** `Roteriz`, `Recarga`, `Noturna` — a coluna CARGA ATUAL. */
  cargaAtual: string;
  /** `NF-ISS` ou `CTRC-ICMS` — decide de que lado a viagem pesa no split. */
  tipoDeImposto: string;
  /** O frete com imposto — a coluna VALOR FATURADO. */
  valorFaturado: number;
}

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/** A viagem é de frota fixa padrão — nem recarga, nem noturna, nem agregado. */
function ehFrotaFixa(v: ViagemDoMapa): boolean {
  const carga = semAcento(v.cargaAtual);
  return semAcento(v.frota) === "padrao" && carga !== "recarga" && carga !== "noturna";
}

/** A viagem é recarga ou noturna — frota padrão numa carga que não é rota. */
function ehRecargaOuNoturna(v: ViagemDoMapa): boolean {
  const carga = semAcento(v.cargaAtual);
  return semAcento(v.frota) === "padrao" && (carga === "recarga" || carga === "noturna");
}

/**
 * As quatro parcelas do custo variável, somadas do diário.
 *
 * **A frota fixa não é a soma do que se faturou.** É o valor padrão de um
 * veículo — `(custo variável previsto ÷ 25 viagens)`, brutado pela fatia de
 * emissão **do próprio dia** — vezes os mapas que fecharam naquele dia. É por
 * isso que ela é calculada dia a dia e não de uma vez: o split muda todo dia, e
 * aplicar o split do mês a cada dia dá outro número. As outras três são somas
 * diretas do faturado, cada uma do seu tipo de frota.
 */
export function somarVariavel(
  porDia: { viagens: ViagemDoMapa[] }[],
  p: ParametrosDoCadastro,
  custoVariavelPrevistoPor25Viagens: number,
): VariavelDaQuinzena {
  const { dentro, fora } = divisoresDe(p.aliquotas);
  const valorMedioDoVeiculo = custoVariavelPrevistoPor25Viagens / 25;

  let frotaFixa = 0;
  let agregado = 0;
  let recargaENoturna = 0;
  let vans = 0;

  for (const dia of porDia) {
    let mapas = 0;
    let comIss = 0;
    let comIcms = 0;

    for (const v of dia.viagens) {
      const frota = semAcento(v.frota);
      if (ehFrotaFixa(v)) {
        mapas += 1;
        if (semAcento(v.tipoDeImposto).startsWith("nf-iss")) comIss += 1;
        else if (semAcento(v.tipoDeImposto).startsWith("ctrc-icms")) comIcms += 1;
      } else if (ehRecargaOuNoturna(v)) {
        recargaENoturna += v.valorFaturado;
      } else if (frota === "spot") {
        agregado += v.valorFaturado;
      } else if (frota === "fixo") {
        /* `Fixo` é como o 2Art nomeia a van — o rótulo é dele, não nosso. */
        vans += v.valorFaturado;
      }
    }

    /* O split é do dia, e um dia sem viagem de frota fixa não contribui. */
    const emitidos = comIss + comIcms;
    if (emitidos === 0 || mapas === 0) continue;
    const parcelaDentro = comIss / emitidos;
    const parcelaFora = comIcms / emitidos;
    frotaFixa +=
      (valorMedioDoVeiculo / dentro) * parcelaDentro * mapas +
      (valorMedioDoVeiculo / fora) * parcelaFora * mapas;
  }

  return {
    frotaFixa: centavos(frotaFixa),
    agregado: centavos(agregado),
    recargaENoturna: centavos(recargaENoturna),
    vans: centavos(vans),
  };
}

/* ---------------------------------------------------------------------------
   Os três quadros do RESUMO GERAL
   ------------------------------------------------------------------------ */

export interface QuadroDoMapa {
  quadro: "REMUNERACAO" | "VARIAVEL" | "OUTROS_CUSTOS";
  titulo: string;
  linhas: LinhaDoMapa[];
  /** A soma das parcelas menos os descontos. `null` se faltar qualquer uma. */
  total: number | null;
}

export interface MapaDaQuinzena {
  quinzena: 1 | 2;
  quadros: QuadroDoMapa[];
  /** `REMUNERACAO + OUTROS_CUSTOS` — o `TOTAL GERAL UNIDADE` da planilha. */
  totalGeral: number | null;
  /** O que falta para o mapa fechar inteiro, linha a linha. */
  pendencias: string[];
}

/**
 * Soma um quadro com o sinal de cada papel.
 *
 * Uma linha sem número derruba o total para `null` em vez de somar zero: um
 * quadro a que falta o 03.08.18 não vale a soma das outras linhas, vale
 * "ainda não dá para dizer". É a mesma regra do `resumo.ts` e pelo mesmo
 * motivo — meio dado com cara de dado inteiro é o erro caro.
 */
function somarQuadro(linhas: LinhaDoMapa[]): number | null {
  let total = 0;
  for (const l of linhas) {
    if (l.papel === "TOTAL") continue;
    if (l.valor === null) return null;
    total += l.valor;
  }
  return centavos(total);
}

/**
 * O mapa de uma quinzena — as dezesseis linhas com o número de cada uma.
 *
 * A ordem é a da planilha, porque quem confere abre as duas lado a lado. O
 * `TOTAL REMUNERAÇÃO ROTA DVS` abre o primeiro quadro e é o custo variável
 * inteiro: a planilha o traz de `Mapa Rota!131`, que é a linha rotulada
 * `Custo Variável =>` — as quatro parcelas do quadro de baixo mais a recarga,
 * a noturna e as vans. A sigla continua sendo da Ambev e não é expandida aqui;
 * o que deixou de ser desconhecido é **o número**, que é uma soma nomeada.
 */
export function montarMapaDaQuinzena(entrada: {
  quinzena: 1 | 2;
  parametros: ParametrosDoCadastro;
  variavel: VariavelDaQuinzena;
  bases: BasesDaQuinzena;
  /**
   * De onde o custo fixo padronizado tira a fatia de emissão.
   *
   * O padrão é o cadastro — a regra que este módulo propõe. Quem está
   * conferindo contra o `.xlsb` passa `DIARIO` na 2ª quinzena para reproduzir
   * `Mapa Rota!AJ119`. Ver {@link FatiaDoPadronizado}.
   */
  fatiaDoPadronizado?: FatiaDoPadronizado;
}): MapaDaQuinzena {
  const { parametros: p, variavel, bases } = entrada;
  const fatiaDoPadronizado = entrada.fatiaDoPadronizado ?? { fonte: "CADASTRO" };

  /* Uma parcela ausente apaga a soma: quatro parcelas menos uma não é o DVS. */
  const somaDoVariavel = (partes: (number | null)[]): number | null => {
    let total = 0;
    for (const parte of partes) {
      if (parte === null) return null;
      total += parte;
    }
    return centavos(total);
  };

  const custoVariavelInteiro = somaDoVariavel([
    variavel.frotaFixa,
    variavel.agregado,
    variavel.recargaENoturna,
    variavel.vans,
  ]);

  const descontos = linhasDeDesconto(p, bases);

  /*
    Indexado por chave, e não consumido por posição: a ordem da planilha
    intercala `INDISPONIBILIDADE` no meio das cinco linhas fixas, e fatiar o
    array por índice faria uma linha nova em `linhasDoCustoFixo` reordenar o
    quadro em silêncio.
  */
  const fixo = Object.fromEntries(
    linhasDoCustoFixo(p, fatiaDoPadronizado).map((l) => [l.chave, l]),
  ) as Record<string, LinhaDoMapa>;

  /* --- Quadro 1: a remuneração da rota ---------------------------------- */
  const remuneracao: LinhaDoMapa[] = [
    linha(
      "rota_dvs",
      "TOTAL REMUNERAÇÃO ROTA DVS",
      "PARCELA",
      custoVariavelInteiro,
      "o custo variável inteiro: frota fixa + agregado + recarga/noturna + vans",
      custoVariavelInteiro === null ? "o diário operacional da quinzena" : null,
    ),
    fixo.custo_fixo_padronizado,
    fixo.custo_fixo_inativos,
    fixo.custo_vans_inativas,
    linha(
      "indisponibilidade_fixo",
      "INDISPONIBILIDADE",
      "PARCELA",
      bases.indisponibilidade,
      bases.indisponibilidade === null
        ? "sem indisponibilidade lançada na quinzena"
        : "a indisponibilidade do diário operacional",
      bases.indisponibilidade === null ? "a indisponibilidade do diário" : null,
    ),
    fixo.custo_fixo_especiais,
    fixo.custo_fixo_vans,
    ...descontos,
  ];

  /* --- Quadro 2: o variável aberto -------------------------------------- */
  const variaveis: LinhaDoMapa[] = [
    linha(
      "custo_variavel_frota_fixa",
      "CUSTO VARIÁVEL (FROTA FIXA)",
      "PARCELA",
      variavel.frotaFixa,
      "valor padrão do veículo brutado pelo split do dia × mapas fechados no dia",
      variavel.frotaFixa === null ? "o diário operacional da quinzena" : null,
    ),
    linha(
      "custo_variavel_agregado",
      "CUSTO VARIÁVEL (AGREGADO)",
      "PARCELA",
      variavel.agregado,
      "a soma do faturado das viagens de frota Spot",
      variavel.agregado === null ? "o diário operacional da quinzena" : null,
    ),
    /* As mesmas duas linhas do quadro de cima — a planilha as repete aqui. */
    descontos[0]!,
    { ...descontos[1]!, chave: "indisponibilidade_variavel", rotulo: "INDISPONIBILIDADE" },
  ];

  /* --- Quadro 3: outros custos ------------------------------------------ */
  const outros: LinhaDoMapa[] = [
    linha(
      "outros_custos",
      "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS",
      "PARCELA",
      bases.outrosCustos,
      bases.outrosCustos === null
        ? "sem outros custos na quinzena"
        : "o total de outros custos da quinzena",
      bases.outrosCustos === null ? "as requisições de despesa (03.08.12.09)" : null,
    ),
  ];

  const quadros: QuadroDoMapa[] = [
    {
      quadro: "REMUNERACAO",
      titulo: "Rota — a remuneração da frota contratada",
      linhas: remuneracao,
      total: somarQuadro(remuneracao),
    },
    {
      quadro: "VARIAVEL",
      titulo: "Rota — o variável aberto",
      linhas: variaveis,
      total: somarQuadro(variaveis),
    },
    {
      quadro: "OUTROS_CUSTOS",
      titulo: "Outros custos",
      linhas: outros,
      total: somarQuadro(outros),
    },
  ];

  const remuneracaoTotal = quadros[0]!.total;
  const outrosTotal = quadros[2]!.total;

  return {
    quinzena: entrada.quinzena,
    quadros,
    totalGeral:
      remuneracaoTotal === null || outrosTotal === null
        ? null
        : centavos(remuneracaoTotal + outrosTotal),
    pendencias: [
      ...new Set(
        quadros
          .flatMap((q) => q.linhas)
          .map((l) => l.falta)
          .filter((f): f is string => f !== null),
      ),
    ],
  };
}
