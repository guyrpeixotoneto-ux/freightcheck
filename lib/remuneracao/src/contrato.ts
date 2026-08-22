import { linhaDoCadastro } from "./catalogo";
import { quinzenaDe } from "./vigencia";

/**
 * O CONTRATO — a planilha digitada virando os parâmetros que o motor consome.
 *
 * Este arquivo é a metade da costura que faltava. `@workspace/fechamento`
 * calcula o `RESUMO GERAL` inteiro a partir de uma estrutura de parâmetros
 * (`ParametrosDoCadastro`, em `mapa-rota.ts`), e `cadastro-porta.ts` declara a
 * pergunta — *quais eram os parâmetros deste trio neste período?* Quem
 * responde é o cadastro, e o cadastro é este módulo. O que estava faltando não
 * era conta nem dado: era a tradução entre as trinta chaves da aba de Excel e
 * os dezessete campos que a conta pede.
 *
 * **Por que a tradução mora aqui e não lá.** A fronteira do pacote é a de
 * sempre (ver `index.ts`): a Auditoria não importa o Fechamento. Por isso
 * {@link ParametrosDoContrato} é escrito aqui inteiro, e não importado —
 * ele é o **mesmo formato** de `ParametrosDoCadastro`, e a compatibilidade
 * entre os dois é verificada onde eles se encontram, que é a borda que compõe
 * as duas metades. Um campo que mude de um lado e não do outro para o build da
 * borda, que é exatamente onde se quer ser avisado.
 *
 * **A regra do pacote continua valendo: nada aqui completa o que não foi
 * digitado.** Falta uma alíquota, falta o contrato — e
 * {@link contratoDaPlanilha} devolve a lista das chaves que faltam, com o
 * rótulo que a pessoa vê na tela, em vez de um objeto com zeros no lugar.
 * Um cadastro meio preenchido produziria um "devido" que ninguém contratou, e
 * a diferença contra o demonstrativo passaria a medir a nossa omissão.
 *
 * As duas únicas exceções estão em {@link OPCIONAIS}, e elas são da própria
 * aba, não uma conveniência nossa.
 */

/** As quatro alíquotas, já em fração — `0,1784` para 17,84 %. */
export interface AliquotasDoContrato {
  pis: number;
  cofins: number;
  icms: number;
  iss: number;
}

/**
 * Os dezessete parâmetros de uma quinzena.
 *
 * Mesmo formato de `ParametrosDoCadastro` (`@workspace/fechamento/mapa-rota`),
 * e é de propósito: a borda passa este objeto direto, e o compilador confere lá
 * que os dois não se separaram.
 *
 * **Os valores de dinheiro são mensais**, como o contrato os fixa; quem divide
 * por dois é o motor, em cada linha. **Os percentuais são frações**, e não
 * pontos — a aba guarda `5,90` para cinco vírgula nove por cento (ver
 * `conferirCelula` em `informado.ts`), e a conversão acontece uma vez, aqui.
 */
export interface ParametrosDoContrato {
  aliquotas: AliquotasDoContrato;
  /** A fatia dos documentos emitidos dentro do município (NF-ISS), em fração. */
  parcelaDentroDoMunicipio: number;

  frotaFixaAtiva: number;
  frotaFixaInativa: number;

  remuneracaoFixaDaFrotaAtiva: number;
  remuneracaoDaEquipeDeEntrega: number;
  remuneracaoDoQlpAdministrativo: number;
  remuneracaoDeOutrasDespesas: number;

  remuneracaoDaFrotaInativa: number;

  vansAtivas: number;
  custoFixoDaVan: number;
  custoDaEquipeDeEntregaDaVan: number;
  vansInativas: number;
  remuneracaoDasVansInativas: number;

  rotasNoturnas: number;
  custoDaNoturnaSemImposto: number;
  custoDeMarketingSemImposto: number;
}

/** O contrato de uma vigência: os parâmetros e a base do variável. */
export interface ContratoDaVigencia {
  parametros: ParametrosDoContrato;
  /**
   * `Custo Variável (para 25 viagens previstas)` mais o lucro previsto.
   *
   * É o que o motor divide por 25 para achar o valor de uma viagem. As duas
   * parcelas são somadas aqui porque é assim que a aba as usa — a linha do
   * lucro existe separada para ser conferida, não para ser aplicada sozinha.
   */
  custoVariavelPrevistoPor25Viagens: number;
}

/* ---------------------------------------------------------------------------
   O de-para das chaves
   ------------------------------------------------------------------------ */

/** Onde cada chave da aba pousa no contrato. */
type Destino =
  | { em: "aliquota"; campo: keyof AliquotasDoContrato }
  | { em: "parametro"; campo: Exclude<keyof ParametrosDoContrato, "aliquotas"> }
  | { em: "variavel" };

/**
 * A chave da aba, o campo do contrato e a escala entre os dois.
 *
 * As linhas do catálogo que **não** estão aqui não estão esquecidas: são as
 * calculadas (`frota_fixa_operacao`, `ativo_total_sem_imposto`,
 * `van_total_com_impostos`, `noturna_custo_com_impostos`,
 * `marketing_com_impostos`, `resumo_iss`, `resumo_ctrc`, `rota_percentual_ctrc`)
 * — cada uma é conta sobre as que estão, e o motor a refaz. Lê-las daqui
 * criaria uma segunda verdade sobre o mesmo número, e ela discordaria da
 * primeira no dia em que alguém digitasse o total sem refazer as parcelas.
 */
const DE_PARA: { chave: string; destino: Destino }[] = [
  { chave: "aliquota_pis", destino: { em: "aliquota", campo: "pis" } },
  { chave: "aliquota_cofins", destino: { em: "aliquota", campo: "cofins" } },
  { chave: "aliquota_icms", destino: { em: "aliquota", campo: "icms" } },
  { chave: "aliquota_iss", destino: { em: "aliquota", campo: "iss" } },
  { chave: "rota_percentual_iss", destino: { em: "parametro", campo: "parcelaDentroDoMunicipio" } },

  { chave: "frota_fixa_ativos", destino: { em: "parametro", campo: "frotaFixaAtiva" } },
  { chave: "frota_fixa_inativos", destino: { em: "parametro", campo: "frotaFixaInativa" } },

  {
    chave: "ativo_remuneracao_fixa_frota",
    destino: { em: "parametro", campo: "remuneracaoFixaDaFrotaAtiva" },
  },
  {
    chave: "ativo_remuneracao_fixa_equipe",
    destino: { em: "parametro", campo: "remuneracaoDaEquipeDeEntrega" },
  },
  {
    chave: "ativo_remuneracao_fixa_qlp",
    destino: { em: "parametro", campo: "remuneracaoDoQlpAdministrativo" },
  },
  {
    chave: "ativo_outras_despesas",
    destino: { em: "parametro", campo: "remuneracaoDeOutrasDespesas" },
  },

  {
    chave: "inativo_remuneracao_fixa",
    destino: { em: "parametro", campo: "remuneracaoDaFrotaInativa" },
  },

  { chave: "van_quantidade_ativas", destino: { em: "parametro", campo: "vansAtivas" } },
  { chave: "van_custo_fixo", destino: { em: "parametro", campo: "custoFixoDaVan" } },
  { chave: "van_custo_equipe", destino: { em: "parametro", campo: "custoDaEquipeDeEntregaDaVan" } },
  { chave: "van_quantidade_inativas", destino: { em: "parametro", campo: "vansInativas" } },
  {
    chave: "van_remuneracao_inativas",
    destino: { em: "parametro", campo: "remuneracaoDasVansInativas" },
  },

  { chave: "noturna_quantidade_rotas", destino: { em: "parametro", campo: "rotasNoturnas" } },
  {
    chave: "noturna_custo_sem_impostos",
    destino: { em: "parametro", campo: "custoDaNoturnaSemImposto" },
  },
  {
    chave: "marketing_sem_impostos",
    destino: { em: "parametro", campo: "custoDeMarketingSemImposto" },
  },

  { chave: "ativo_custo_variavel", destino: { em: "variavel" } },
  { chave: "ativo_lucro_operacional", destino: { em: "variavel" } },
];

/**
 * As duas chaves que podem faltar sem travar o contrato — e por que só elas.
 *
 * Na `.xlsb` de julho/2026 as duas estão **em branco**, e a planilha as trata
 * como zero nas fórmulas que as consomem: `Custo Fixo com impostos - Marketing`
 * imprime `0,00` e o `Custo Variável` do dia sai igual com e sem o lucro. Uma
 * célula que a própria aba deixa vazia e soma como zero não é ausência de
 * informação: é a informação de que aquela parcela não existe neste contrato.
 *
 * Nenhuma outra entra nesta lista. As dezenove restantes, em branco, mudam o
 * número — e um número que muda por falta de digitação é a única coisa que
 * este pacote nunca deixou passar.
 */
const OPCIONAIS = new Set(["marketing_sem_impostos", "ativo_lucro_operacional"]);

/** As chaves da aba que o contrato lê, na ordem do catálogo. */
export const CHAVES_DO_CONTRATO: string[] = DE_PARA.map((d) => d.chave);

/** As que travam o contrato quando faltam. */
export const CHAVES_OBRIGATORIAS: string[] = CHAVES_DO_CONTRATO.filter((c) => !OPCIONAIS.has(c));

/** As que faltam sem travar — entram como zero, e a tela diz a premissa. */
export const CHAVES_OPCIONAIS: string[] = [...OPCIONAIS];

/** O que falta, com o rótulo que a pessoa vê na tela de cadastro. */
export interface ChaveFaltante {
  chave: string;
  rotulo: string;
}

/** O resultado da tradução — contrato ou a lista do que impede. */
export interface ContratoLido {
  /** `null` quando falta alguma obrigatória. Nunca um objeto meio preenchido. */
  contrato: ContratoDaVigencia | null;
  /** As obrigatórias que não foram digitadas. Vazia quando há contrato. */
  faltam: ChaveFaltante[];
  /**
   * As de {@link OPCIONAIS} que não vieram e entraram como zero.
   *
   * Existe para ser dita, não para ser ignorada: quem vê um `CUSTO FIXO -
   * ESPECIAIS` sem a parcela de marketing tem direito de saber que ela não foi
   * digitada, em vez de deduzir que o contrato não a tem.
   */
  assumidasComoZero: ChaveFaltante[];
}

function rotuloDe(chave: string): string {
  return linhaDoCadastro(chave)?.rotulo ?? chave;
}

/**
 * A planilha digitada de uma vigência, traduzida em contrato.
 *
 * `valores` é o que a aba tem gravado — chave do catálogo para número, na
 * escala em que a tela o recebe: dinheiro em reais por mês, percentual em
 * **pontos**, quantidade inteira. É o formato que `lerPlanilha` devolve.
 */
export function contratoDaPlanilha(valores: ReadonlyMap<string, number>): ContratoLido {
  const faltam: ChaveFaltante[] = [];
  const assumidasComoZero: ChaveFaltante[] = [];

  for (const chave of CHAVES_DO_CONTRATO) {
    if (valores.has(chave)) continue;
    const falta = { chave, rotulo: rotuloDe(chave) };
    if (OPCIONAIS.has(chave)) assumidasComoZero.push(falta);
    else faltam.push(falta);
  }
  if (faltam.length > 0) return { contrato: null, faltam, assumidasComoZero };

  /*
    O percentual vem em pontos da tela e a conta o quer em fração. A conversão
    é uma linha e acontece uma vez — espalhá-la pelo motor daria dezessete
    lugares onde alguém pode esquecer o `/100`, e o erro de cem vezes num
    imposto não se vê a olho nu no meio de um milhão de reais.
  */
  const emFracao = (chave: string) => (valores.get(chave) ?? 0) / 100;

  const parametros = {
    aliquotas: {
      pis: emFracao("aliquota_pis"),
      cofins: emFracao("aliquota_cofins"),
      icms: emFracao("aliquota_icms"),
      iss: emFracao("aliquota_iss"),
    },
    parcelaDentroDoMunicipio: emFracao("rota_percentual_iss"),
  } as ParametrosDoContrato;

  for (const { chave, destino } of DE_PARA) {
    if (destino.em !== "parametro") continue;
    if (destino.campo === "parcelaDentroDoMunicipio") continue;
    parametros[destino.campo] = valores.get(chave) ?? 0;
  }

  const custoVariavelPrevistoPor25Viagens = DE_PARA.filter((d) => d.destino.em === "variavel")
    .map((d) => valores.get(d.chave) ?? 0)
    .reduce((soma, n) => soma + n, 0);

  return {
    contrato: { parametros, custoVariavelPrevistoPor25Viagens },
    faltam: [],
    assumidasComoZero,
  };
}

/* ---------------------------------------------------------------------------
   Qual planilha responde por uma quinzena
   ------------------------------------------------------------------------ */

/** A vigência escolhida, e se ela é da própria quinzena ou da irmã. */
export interface VigenciaQueResponde {
  /** A `effectiveDate` da planilha que responde. */
  vigenteDe: string;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Qual planilha responde pela quinzena que começa em `inicioDaQuinzena`.
 *
 * **A regra, na ordem:**
 *
 * 1. A planilha da **própria quinzena**, se houver. Duas na mesma metade do mês
 *    — o que a régua de `vigencia.ts` já trata como caso legítimo — resolvem-se
 *    pela mais recente, que é a correção mais nova.
 * 2. Nada. `null` é resposta legítima, e é o estado de toda quinzena antes de
 *    alguém digitar a aba dela.
 *
 * **Cada quinzena responde pela própria aba, e não existe herança.** Isto já foi
 * diferente: a aba de uma metade respondia pela outra quando esta não tinha a
 * sua, e a ideia era servir quem opera com um contrato só no mês. O que ela
 * servia era outra coisa. Os parâmetros mudam entre as metades — em julho/2026,
 * seis deles mudam, entre eles a remuneração fixa da frota ativa (1.424,91 →
 * 1.038,03) e a da frota inativa (1.650,97 → 4.359,09) —, e a herança pagava a
 * segunda quinzena com o contrato da primeira **sem dizer**. Numa competência
 * conferida isso deu R$ 14.817,52 de diferença numa linha só, num número que a
 * tela apresentava como qualquer outro.
 *
 * A escolha aqui não é entre um número e outro: é entre um número errado e uma
 * pendência. Sem a aba da quinzena não se sabe o que foi contratado nela, e
 * `null` é a única resposta que não inventa. Quem tem o mesmo contrato nas duas
 * metades digita as duas abas — é um ato a mais, e ele deixa escrito que as
 * duas foram conferidas.
 *
 * **O mês continua sendo o limite.** Julho não responde por agosto pela razão
 * que `copiarPlanilha` já registra: uma vigência que herdasse a anterior em
 * silêncio responderia igual para sempre, inclusive depois de a operação mudar.
 * Agora o limite é mais estreito — a quinzena —, pelo mesmo motivo.
 */
export function vigenciaQueResponde(
  inicioDaQuinzena: string,
  comPlanilha: readonly string[],
): VigenciaQueResponde | null {
  if (!DATA.test(inicioDaQuinzena)) return null;

  const mes = inicioDaQuinzena.slice(0, 7);
  const quinzena = quinzenaDe(inicioDaQuinzena);
  const daQuinzena = comPlanilha
    .filter((d) => DATA.test(d) && d.slice(0, 7) === mes && quinzenaDe(d) === quinzena)
    .sort((a, b) => b.localeCompare(a));

  return daQuinzena[0] ? { vigenteDe: daQuinzena[0] } : null;
}
