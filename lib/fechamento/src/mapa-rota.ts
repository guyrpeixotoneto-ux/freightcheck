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
  /**
   * O total de outros custos da quinzena, com a origem que o sustenta.
   *
   * `null` quando o 03.08.12.09 não foi importado. Ver
   * {@link BaseDeOutrosCustos}.
   */
  outrosCustos: BaseDeOutrosCustos | null;
  /**
   * A indisponibilidade, com a origem que a sustenta.
   *
   * `null` quando o diário da quinzena não chegou — e `null` é o certo ali:
   * zero diria "nenhuma viagem rodou por indisponibilidade", que é uma
   * afirmação sobre a operação, e não sobre o arquivo que falta.
   */
  indisponibilidade: BaseDeIndisponibilidade | null;
}

/**
 * O que o 03.08.12.09 sustenta no quadro de outros custos.
 *
 * **A segunda linha que estava permanentemente sem devido, e a fonte que a
 * fecha.** `docs/MAPA-ROTA.md` rastreia `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS`
 * até `Outros Custos!F4`, e a origem declarada ali é o **03.08.12.09** — as
 * requisições de despesa aprovadas. A prova é aritmética e está na amostra de
 * julho/2026: a 2ª quinzena traz `Outros Custos!G4 = 358.530,22`, e a tabela
 * "De onde vem o dinheiro do mês" do mesmo documento atribui exatamente
 * R$ 358.530,22 ao 03.08.12.09. Mesmo número, mesma quinzena, duas leituras
 * independentes.
 *
 * **Só o que paga entra.** O filtro é `STATUS_QUE_PAGA` — o mesmo que a
 * apuração aplica desde sempre (`apuracao.ts`), e não uma regra nova inventada
 * aqui. Uma requisição pendente ou reprovada é despesa que existe e ainda não é
 * dinheiro; somá-la faria o devido cobrar o que ninguém aprovou.
 *
 * **`recebidas` existe para o zero ser conferível.** Uma quinzena em que
 * chegaram quarenta requisições e nenhuma foi aprovada vale zero — e é um zero
 * muito diferente do de uma quinzena sem requisição nenhuma. O primeiro manda
 * cobrar aprovação; o segundo, importar o arquivo.
 */
export interface OutrosCustosDoRelatorio {
  /** A soma do valor sem imposto das requisições aprovadas do canal. */
  valor: number;
  /** Quantas entraram na soma. */
  aprovadas: number;
  /** Quantas o arquivo trouxe para este canal, aprovadas ou não. */
  recebidas: number;
}

/**
 * De onde saíram os outros custos que entraram no mapa.
 *
 * Mesma disciplina de {@link BaseDeIndisponibilidade}: `REQUISICOES` é a regra
 * do produto, `PLANILHA` é a célula da `.xlsb` que a reconciliação compara.
 */
export type BaseDeOutrosCustos =
  | { fonte: "REQUISICOES"; medida: OutrosCustosDoRelatorio }
  | { fonte: "PLANILHA"; valor: number };

/** O número que entra na conta, seja qual for a fonte. */
export function valorDeOutrosCustos(b: BaseDeOutrosCustos): number {
  return b.fonte === "REQUISICOES" ? b.medida.valor : b.valor;
}

/** A frase que a tela mostra: o número e o que foi contado para chegar nele. */
export function memoriaDeOutrosCustos(b: BaseDeOutrosCustos): string {
  if (b.fonte === "PLANILHA") {
    return "`Outros Custos!F4`, como a planilha legada o traz — para reconciliação";
  }
  const { aprovadas, recebidas } = b.medida;
  if (recebidas === 0) {
    return (
      "o 03.08.12.09 da quinzena chegou e não traz requisição deste canal — " +
      "zero medido, não zero por ausência de arquivo"
    );
  }
  if (aprovadas === 0) {
    return (
      `nenhuma das ${recebidas} requisições do 03.08.12.09 deste canal está aprovada — ` +
      "zero medido, não zero por ausência de arquivo"
    );
  }
  return (
    `a soma sem imposto de ${aprovadas} de ${recebidas} requisições do 03.08.12.09 ` +
    "deste canal, só as aprovadas"
  );
}

/**
 * De onde saiu a indisponibilidade que entrou no mapa.
 *
 * Duas fontes legítimas, e a tela precisa saber qual foi. `DIARIO` é a regra do
 * produto: o 2Art somado por {@link somarIndisponibilidade}. `PLANILHA` existe
 * para a reconciliação, que lê `Mapa Rota!132` da `.xlsb` para comparar o motor
 * contra ela — e ali o número é da planilha, não nosso. Sem a distinção, a
 * memória de cálculo diria "somado do diário" sobre um número copiado de uma
 * célula, que é exatamente o tipo de procedência falsa que este módulo recusa.
 */
export type BaseDeIndisponibilidade =
  | { fonte: "DIARIO"; medida: IndisponibilidadeDoDiario }
  | { fonte: "PLANILHA"; valor: number };

/** O número que entra na conta, seja qual for a fonte. */
export function valorDaIndisponibilidade(b: BaseDeIndisponibilidade): number {
  return b.fonte === "DIARIO" ? b.medida.valor : b.valor;
}

/** A frase que a tela mostra: o número e o que foi contado para chegar nele. */
export function memoriaDaIndisponibilidade(b: BaseDeIndisponibilidade): string {
  if (b.fonte === "PLANILHA") {
    return "`Mapa Rota!132`, como a planilha legada o traz — para reconciliação";
  }
  const { comMarca, viagens, tipos } = b.medida;
  if (comMarca === 0) {
    return (
      `nenhuma das ${viagens} viagens de Rota do diário traz marca de indisponibilidade ` +
      "(`TipoIndisp` do 2Art) — zero medido, não zero por ausência de arquivo"
    );
  }
  return (
    `o faturado de ${comMarca} de ${viagens} viagens de Rota com marca de ` +
    `indisponibilidade no 2Art (${tipos.join(", ")})`
  );
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
  /**
   * As caixas de **Rota** que a viagem carregou — a coluna `CxRota` do 2Art.
   *
   * É o que separa a viagem deste mapa da viagem que rodou AS. `null` quando o
   * diário não trouxe a coluna: ver {@link ehDaRota}.
   */
  caixasDeRota: number | null;
  /**
   * O motivo da indisponibilidade, como o 2Art o classifica — `TipoIndisp`.
   *
   * Vazio é a viagem normal: rodou com o veículo dela. Preenchido é a viagem
   * que rodou **porque** um veículo contratado não pôde rodar, e é a soma do
   * faturado dessas que a linha `INDISPONIBILIDADE` do quadro fixo escreve —
   * ver {@link somarIndisponibilidade}.
   *
   * É texto e não booleano porque o motivo é o que a tela mostra ao lado do
   * número: "R$ 12.400,00 em 8 viagens, 6 por `Manutenção` e 2 por `Sinistro`"
   * é conferível contra o 2Art aberto ao lado; "R$ 12.400,00" não é.
   */
  tipoDeIndisponibilidade: string;
}

const semAcento = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/**
 * A viagem carregou caixa de Rota — e por isso pertence a este mapa.
 *
 * **É o corte que faltava, e ele é do canal, não do tipo de frota.** O 2Art
 * traz numa lista só as viagens da Rota e as do AS, e a coluna que as separa é
 * `CxRota`: a viagem de AS vem com `CxRota = 0` e `CxAS > 0`. Sem este filtro o
 * `Mapa Rota` somava as duas, e o efeito não era pequeno — em julho/2026 o
 * `Custo Variável (Extra e Spot)` saía R$ 38.473,58 acima do que a planilha
 * fecha na 1ª quinzena, e R$ 47.098,45 acima na 2ª. Com o filtro, as duas
 * quinzenas batem ao centavo.
 *
 * Conferido linha a linha contra as abas diárias da `.xlsb`: das dezoito
 * viagens que a planilha descartou no mês inteiro, as dezesseis de frota padrão
 * têm `CxRota = 0` e `CxAS > 0`. Nenhuma exceção.
 *
 * **`null` conta como da Rota, e é a escolha certa.** Um diário antigo, sem a
 * coluna, não deve perder todas as viagens de uma vez — isso trocaria um erro
 * de mais por um erro de tudo. O que a coluna ausente custa é a separação, e
 * ela aparece como divergência contra o demonstrativo, que é onde se vê.
 */
function ehDaRota(v: ViagemDoMapa): boolean {
  return v.caixasDeRota === null || v.caixasDeRota > 0;
}

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
 *
 * **Sem diário, as quatro são `null` — e a distinção é a mesma que
 * {@link BasesDaQuinzena} já fazia para a indisponibilidade.** Somar sobre lista
 * vazia dá zero em qualquer aritmética, e zero aqui é uma afirmação sobre a
 * operação: *a frota não rodou nada nesta quinzena*. Uma competência cujo 2Art
 * não chegou tem exatamente a mesma lista vazia de uma em que ninguém rodou, e
 * as duas pedem coisas opostas de quem opera — uma pede o arquivo, a outra pede
 * conferir por que não houve viagem. `null` diz o que é verdade, e
 * `montarMapaDaQuinzena` apaga a linha e nomeia o arquivo que falta.
 *
 * O corte é `porDia.length`, e não a contagem de viagens: `[{ viagens: [] }]` é
 * um diário que existe e trouxe um dia sem viagem de Rota, e aí zero é **zero
 * medido**. É o mesmo corte de `basesDaQuinzena`, pelo mesmo motivo, sobre a
 * mesma lista.
 */
export function somarVariavel(
  porDia: { viagens: ViagemDoMapa[] }[],
  p: ParametrosDoCadastro,
  custoVariavelPrevistoPor25Viagens: number,
): VariavelDaQuinzena {
  /* Diário ausente não soma zero: não soma. Ver o bloco acima. */
  if (porDia.length === 0) {
    return { frotaFixa: null, agregado: null, recargaENoturna: null, vans: null };
  }

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
      /* A viagem de AS está na mesma lista e não é deste mapa — ver `ehDaRota`. */
      if (!ehDaRota(v)) continue;
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

/**
 * A indisponibilidade da quinzena, somada do diário — e o que a sustenta.
 *
 * **A linha que estava sem lastro desde sempre, e por que ela tem lastro
 * agora.** O painel do 03.08.20 mostra `INDISPONIBILIDADE` como *sem lastro*, e
 * está certo: o demonstrativo traz um bloco `DESCONTO DISPONIBILIDADE` só, ele
 * já está declarado na linha de desconto, e a célula do quadro fixo está vazia
 * nas duas quinzenas conferidas. Nada nele sustenta esta linha, e o painel
 * demonstrado continua dizendo isso.
 *
 * O **devido** não sai do demonstrativo — sai do contrato e do diário. E o
 * diário sustenta esta linha: `docs/MAPA-ROTA.md` rastreia `INDISPONIBILIDADE`
 * até `Mapa Rota!132`, que soma a coluna `BP` das abas diárias — *o faturado
 * das viagens com tipo de indisponibilidade*. A coluna existe no 2Art
 * (`TipoIndisp`), o leitor já a traz (`DetalheDaViagem.tipoDeIndisponibilidade`)
 * e o banco já a guarda. O que faltava era ligá-la.
 *
 * **Não é o desconto de disponibilidade, e a confusão tem nome.** São duas
 * coisas com nomes quase iguais em quadros diferentes:
 *
 * - esta — `indisponibilidade_fixo`, **parcela** do quadro da remuneração, que
 *   sai do **2Art** e soma o frete das viagens que rodaram no lugar de um
 *   veículo indisponível. É dinheiro que a transportadora **recebe**;
 * - `desconto_disponibilidade` (e a homônima `indisponibilidade_variavel`),
 *   **desconto**, que sai do bloco `DESCONTO DISPONIBILIDADE` do **03.08.20** e
 *   entra negativo. É dinheiro que a transportadora **perde** por não ter
 *   deixado a frota disponível.
 *
 * Fontes diferentes, sinais opostos, quadros diferentes. Somá-las — ou deixar
 * uma preencher a outra — trocaria um recebimento por um abatimento no meio do
 * quadro que fecha o mês.
 *
 * **Zero é resposta, e vem dito.** Uma quinzena com viagens e nenhuma marca de
 * indisponibilidade vale zero de verdade — é o que a planilha de julho/2026
 * escreve nas duas quinzenas. O que este retorno acrescenta é o **denominador**:
 * `viagens` diz sobre quantas se procurou, e `tipos` diz o que se achou. Um zero
 * sobre 302 viagens é uma afirmação que o 2Art aberto ao lado derruba num
 * filtro; um zero sozinho não é conferível por ninguém.
 */
export interface IndisponibilidadeDoDiario {
  /** O faturado somado das viagens de Rota com marca de indisponibilidade. */
  valor: number;
  /** Quantas viagens de Rota o diário trouxe — o denominador da frase. */
  viagens: number;
  /** Quantas delas têm marca. Zero com `viagens > 0` é zero de verdade. */
  comMarca: number;
  /** Os motivos encontrados, sem repetição e em ordem — o que a tela mostra. */
  tipos: string[];
}

/**
 * Soma a indisponibilidade do diário. Ver {@link IndisponibilidadeDoDiario}.
 *
 * O corte é o mesmo de `somarVariavel` — só viagem de Rota entra (`ehDaRota`) —,
 * porque a linha é do painel da Rota e o 2Art traz Rota e AS na mesma lista.
 */
export function somarIndisponibilidade(
  porDia: { viagens: ViagemDoMapa[] }[],
): IndisponibilidadeDoDiario {
  let valor = 0;
  let viagens = 0;
  let comMarca = 0;
  const tipos = new Set<string>();

  for (const dia of porDia) {
    for (const v of dia.viagens) {
      if (!ehDaRota(v)) continue;
      viagens += 1;
      const tipo = v.tipoDeIndisponibilidade.trim();
      if (tipo === "") continue;
      comMarca += 1;
      tipos.add(tipo);
      valor += v.valorFaturado;
    }
  }

  return { valor: centavos(valor), viagens, comMarca, tipos: [...tipos].sort() };
}

/* ---------------------------------------------------------------------------
   Os quatro quadros do RESUMO GERAL
   ------------------------------------------------------------------------ */

/**
 * Os quadros em que o `RESUMO GERAL` empilha a Rota.
 *
 * São **quatro**, e não três. O quarto — `EQUIPE_DE_ENTREGA` — estava fora do
 * motor porque está vazio no fechamento conferido, e ficar de fora escondia
 * duas coisas: que o total geral da planilha o soma (`AI36 = AI17+AI30+AI34`) e
 * que o conceito existe do lado emitido (a VBZ 06 sai em CT-e). Ver
 * {@link quadroDaEquipeDeEntrega}.
 */
export type QuadroDoResumo =
  | "REMUNERACAO"
  | "VARIAVEL"
  | "OUTROS_CUSTOS"
  | "EQUIPE_DE_ENTREGA";

export interface QuadroDoMapa {
  quadro: QuadroDoResumo;
  titulo: string;
  /**
   * Como a planilha nomeia a linha de total deste quadro.
   *
   * Vem do domínio e não da tela porque é vocabulário da planilha — a mesma
   * razão de `titulo` estar aqui. `null` no quadro que não tem linha de total
   * no resumo.
   */
  rotuloDoTotal: string | null;
  linhas: LinhaDoMapa[];
  /** A soma das parcelas menos os descontos. `null` se faltar qualquer uma. */
  total: number | null;
  /**
   * Por que o quadro não tem linha nenhuma. `null` no quadro que tem.
   *
   * Um quadro vazio e um quadro sem fonte são coisas diferentes, e sem este
   * campo os dois chegam à tela como o mesmo espaço em branco. Ver
   * {@link quadroDaEquipeDeEntrega}.
   */
  reservado: string | null;
}

/**
 * Os quadros que o `TOTAL GERAL UNIDADE` soma — e o que fica de fora.
 *
 * A planilha soma `AI17 + AI30 + AI34`: remuneração, outros custos e equipe de
 * entrega. O quadro do **variável** não entra, e não entra porque é uma
 * decomposição: ele abre por dentro o `TOTAL REMUNERAÇÃO ROTA DVS`, que já está
 * somado no primeiro quadro. Somá-lo contaria o variável duas vezes.
 */
export const QUADROS_DO_TOTAL_GERAL: QuadroDoResumo[] = [
  "REMUNERACAO",
  "OUTROS_CUSTOS",
  "EQUIPE_DE_ENTREGA",
];

export interface MapaDaQuinzena {
  quinzena: 1 | 2;
  quadros: QuadroDoMapa[];
  /**
   * `REMUNERACAO + OUTROS_CUSTOS + EQUIPE_DE_ENTREGA` — o `TOTAL GERAL
   * UNIDADE` da planilha, com os mesmos três quadros que ela soma.
   */
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
 * O QUARTO QUADRO — `REMUNERAÇÃO VARIÁVEL - EQUIPE DE ENTREGA`, reservado e vazio.
 *
 * **O que a planilha tem ali, lido célula a célula.** As linhas 32 e 33 do
 * `RESUMO GERAL` trazem o título do quadro e os três cabeçalhos de coluna. A
 * linha 34 é a linha de dados, e `AI34` e `AJ34` **não existem** — não é célula
 * com zero, não é célula com fórmula: não há célula. A única que existe é
 * `AK34 = SUM(AI34+AJ34)`, que soma dois vazios e imprime zero. O quadro é um
 * lugar guardado, e nada foi calculado nele no fechamento conferido.
 *
 * **Por que ele entra no motor mesmo vazio.** Porque o total geral o soma:
 * `AI36 = SUM(AI17+AI30+AI34)`. Enquanto o motor somava dois quadros e a
 * planilha somava três, os dois chegavam ao mesmo número **por acaso** — o
 * acaso de a terceira parcela estar vazia. No mês em que ela não estiver, o
 * total do motor ficaria menor sem que nada acusasse. Agora o quadro existe,
 * entra na soma e é ele que passa a ter de ganhar linha.
 *
 * **E o conceito não é hipotético.** A VBZ 06 — `Rota - Rem. Variável Equipe
 * Entrega` — é emitida: o 03.08.15 do fechamento conferido traz
 * R$ 244.753,67 dela na 2ª quinzena, e a `Abertura` a lista no CT-e 2047848.
 * Ou seja: a transportadora fatura a remuneração variável da equipe, e o
 * `RESUMO GERAL` não calcula devido nenhum para ela. Essa assimetria é achado,
 * não erro nosso — e é justamente o tipo de coisa que some quando o quadro não
 * existe na estrutura.
 *
 * **Nenhuma linha é inventada aqui.** Escrever uma parcela com a VBZ 06 do
 * emitido seria pôr o demonstrado dentro do devido — a contaminação que este
 * pacote inteiro recusa. O quadro entra sem linha, com o motivo escrito, e
 * soma zero porque **não tem parcela**, e não porque alguém mediu zero.
 */
export function quadroDaEquipeDeEntrega(): QuadroDoMapa {
  return {
    quadro: "EQUIPE_DE_ENTREGA",
    titulo: "Remuneração variável — equipe de entrega",
    /* A planilha não escreve linha de total neste quadro — ver a nota acima. */
    rotuloDoTotal: null,
    linhas: [],
    /* Soma vazia é zero legítimo: não há parcela a faltar. Ver a nota acima. */
    total: 0,
    reservado:
      "A planilha reserva este quadro e não escreve linha nenhuma nele: `AI34` e `AJ34` " +
      "não existem como célula, e o total geral dela soma esse vazio. O conceito existe do " +
      "lado emitido — a VBZ 06 sai em CT-e —, e nenhuma regra o converte em devido. " +
      "Enquanto não houver essa regra, o quadro entra na estrutura e soma zero por não ter " +
      "parcela, nunca por ter medido zero.",
  };
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
      bases.indisponibilidade === null ? null : valorDaIndisponibilidade(bases.indisponibilidade),
      bases.indisponibilidade === null
        ? "sem diário na quinzena — a indisponibilidade sai dele"
        : memoriaDaIndisponibilidade(bases.indisponibilidade),
      bases.indisponibilidade === null ? "o diário operacional da quinzena" : null,
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
      bases.outrosCustos === null ? null : valorDeOutrosCustos(bases.outrosCustos),
      bases.outrosCustos === null
        ? "sem 03.08.12.09 na quinzena — os outros custos saem dele"
        : memoriaDeOutrosCustos(bases.outrosCustos),
      bases.outrosCustos === null ? "as requisições de despesa (03.08.12.09)" : null,
    ),
  ];

  const quadros: QuadroDoMapa[] = [
    {
      quadro: "REMUNERACAO",
      titulo: "Rota — a remuneração da frota contratada",
      rotuloDoTotal: "Total remuneração rota",
      linhas: remuneracao,
      total: somarQuadro(remuneracao),
      reservado: null,
    },
    {
      quadro: "VARIAVEL",
      titulo: "Rota — o variável aberto",
      rotuloDoTotal: "Total remuneração rota",
      linhas: variaveis,
      total: somarQuadro(variaveis),
      reservado: null,
    },
    {
      quadro: "OUTROS_CUSTOS",
      titulo: "Outros custos",
      rotuloDoTotal: "Total outros custos",
      linhas: outros,
      total: somarQuadro(outros),
      reservado: null,
    },
    quadroDaEquipeDeEntrega(),
  ];

  /*
    O total geral soma os mesmos quadros que a planilha soma — e a lista de
    quais são está declarada, não escrita por índice. Somar `quadros[0]` e
    `quadros[2]` fazia a conta depender da ordem do array: acrescentar um quadro
    no meio mudaria o total em silêncio, que é exatamente o que aconteceria
    agora com o quarto entrando.
  */
  const doTotalGeral = quadros.filter((q) => QUADROS_DO_TOTAL_GERAL.includes(q.quadro));
  const totalGeral = doTotalGeral.some((q) => q.total === null)
    ? null
    : centavos(doTotalGeral.reduce((soma, q) => soma + (q.total ?? 0), 0));

  return {
    quinzena: entrada.quinzena,
    quadros,
    totalGeral,
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
