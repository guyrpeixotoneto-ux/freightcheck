import { MES_CURTO } from "@/lib/calendario";

/**
 * ATIVOS E PARADOS — os tipos da resposta e as funções puras que a tela usa.
 *
 * **A tela não conta nada.** Ativos, parados, total, percentual e variação
 * chegam prontos do servidor, apurados por `contarFrotaPorQuinzena`
 * (`@workspace/fechamento`). O que mora aqui é apresentação — rótulo do eixo,
 * sinal da variação, e a frase da cobertura —, e mora num arquivo próprio
 * porque é o que se pode testar sem montar componente.
 *
 * ---------------------------------------------------------------------------
 * `null` não é zero, e a tela precisa dizer isso em cada lugar
 * ---------------------------------------------------------------------------
 *
 * Uma contagem é `null` quando o relatório daquela situação não chegou na
 * quinzena. Se a tela renderizasse `0`, o gráfico desenharia uma queda a pique e
 * o cartão anunciaria uma frota que ninguém parou — o defeito exato que a
 * leitura do servidor se dá ao trabalho de evitar. Por isso:
 *
 * - o gráfico recebe `null` e **não desenha a barra** daquela situação;
 * - o número vira `—`, e não `0`;
 * - a variação some, em vez de virar `-40`;
 * - e a quinzena carrega o aviso de qual relatório faltou, com as unidades.
 */

/** As duas situações que o Promax declara. */
export type SituacaoDaFrota = "ATIVA" | "INATIVA";

export interface CoberturaDaQuinzena {
  unidades: string[];
  comFrotaAtiva: string[];
  comFrotaInativa: string[];
}

export interface VariacaoDaQuinzena {
  contra: string;
  ativos: number | null;
  parados: number | null;
  total: number | null;
  pontosDeParado: number | null;
}

export interface QuinzenaDaFrota {
  competencia: string;
  ano: number;
  mes: number;
  quinzena: 1 | 2;
  inicio: string;
  fim: string;
  ativos: number | null;
  parados: number | null;
  total: number | null;
  percentualParado: number | null;
  emAmbasAsSituacoes: number;
  cobertura: CoberturaDaQuinzena;
  variacao: VariacaoDaQuinzena | null;
}

export interface UnidadeComFrota {
  codigo: string;
  nome: string | null;
  quinzenas: number;
}

/**
 * O que o servidor achou quando a tela mandou o escopo da lateral.
 *
 * `null` quando ninguém mandou escopo — a leitura de todas as unidades. Os dois
 * estados de recusa não são falha de rede nem tela vazia: são o cadastro
 * dizendo que não sabe de qual unidade esta tela seria, e cada um tem um
 * conserto diferente. Ver `unidade-do-escopo.ts`, no api-server.
 */
export type EscopoDaSerie =
  | { scopeHash: string; tipo: "RESOLVIDO"; unidadeId: string; nome: string }
  /**
   * `unidadeCadastrada` separa os dois consertos que sobraram, e eles são telas
   * diferentes — ver `unidade-do-escopo.ts`, no api-server.
   */
  | { scopeHash: string; tipo: "SEM_CADASTRO"; unidadeCadastrada: boolean }
  | { scopeHash: string; tipo: "AMBIGUO"; nomes: string[] };

export interface SerieDeAtivosEParados {
  recorte: {
    tipoDeOperacao: string | null;
    unidadeCodigo: string | null;
    limite: number;
  };
  escopo: EscopoDaSerie | null;
  unidades: UnidadeComFrota[];
  quinzenas: QuinzenaDaFrota[];
}

/**
 * A frase da recusa de escopo — o problema e o conserto, numa tela só.
 *
 * Mora aqui, e não no JSX, pela razão de sempre neste arquivo: é o que se testa
 * sem montar componente. E é texto que precisa ser conferido, porque ele manda
 * alguém fazer alguma coisa — a mesma exigência que `cadastro-porta.ts` faz dos
 * diagnósticos dele.
 */
export function recusaDoEscopo(
  escopo: EscopoDaSerie | null,
  unidade: string | null,
): { problema: string; conserto: string } | null {
  if (escopo === null || escopo.tipo === "RESOLVIDO") return null;
  const nome = unidade ?? "esta unidade";

  if (escopo.tipo === "AMBIGUO") {
    return {
      problema:
        `Mais de uma unidade cadastrada responde por ${nome}: ` +
        `${escopo.nomes.join(", ")}. A série não é desenhada porque não se sabe ` +
        "de qual delas ela seria.",
      conserto:
        "Dois cadastros de Remuneração do mesmo escopo foram associados a " +
        "unidades diferentes. Abra Remuneração → Unidades e deixe uma só " +
        "associação de pé.",
    };
  }

  /*
    A unidade que ninguém cadastrou ainda — e é o caso comum quando o acervo
    chegou antes do cadastro.

    **Esta frase já mandou refazer um vínculo que a importação devia ter
    criado**, e essa era a parte errada dela: ela pedia um cadastro de
    Remuneração para consertar o que a própria importação sabia. Hoje a
    importação liga o escopo à unidade cadastrada sozinha — pelo CNPJ que o
    arquivo traz, ou pela unidade aberta quando alguém enviou. O que ela não faz
    é inventar o cadastro: uma unidade canônica é ato de gente, e derivá-la de um
    arquivo é o desenho que este produto desfez de propósito (ver o schema de
    `unidade`).

    Então a frase diz o que de fato falta — o cadastro —, e diz também que
    ninguém vai precisar reimportar nada: cadastrar a unidade alcança, na mesma
    passada, os escopos já importados e as competências já abertas.
  */
  if (!escopo.unidadeCadastrada) {
    return {
      problema:
        `${nome} ainda não existe como unidade cadastrada, e o Fechamento endereça ` +
        "a frota pela unidade — não pelo nome que a planilha traz. O acervo está " +
        "importado; o que falta é o cadastro para ele apontar.",
      conserto:
        "Cadastre a unidade em Administração → Unidades, com o CNPJ. O acervo que já " +
        "foi importado é alcançado na mesma hora — não é preciso reimportar nada —, e " +
        "as importações seguintes já entram associadas. Enquanto isso, a soma de todas " +
        "as unidades continua disponível na Visão Geral.",
    };
  }

  /*
    Há cadastro, e este escopo ficou de fora dele: o código que o arquivo traz
    não carrega CNPJ nenhum — `443`, `CDD Belém` — e o envio não declarou
    unidade. É o único caso em que a associação manual continua sendo o caminho,
    e é o que ela sempre deveria ter sido: a exceção, não a regra.
  */
  return {
    problema:
      `${nome} não está associada a nenhuma unidade cadastrada, e o código que o ` +
      "arquivo traz para ela não carrega CNPJ — não há documento de onde a " +
      "importação pudesse tirar a identidade sozinha.",
    conserto:
      "Associe este escopo à unidade cadastrada em Remuneração → Unidades, ou reenvie " +
      "o arquivo de dentro desta unidade na lateral — o envio declara de quem ele é, e " +
      "a importação grava o vínculo. Enquanto isso, a soma de todas as unidades " +
      "continua disponível na Visão Geral.",
  };
}

/** As janelas que a tela oferece, em quinzenas. Seis é o trimestre. */
export const JANELAS = [6, 12, 24] as const;
export type JanelaDeQuinzenas = (typeof JANELAS)[number];

/**
 * O rótulo curto do eixo: `jul/26 · 2ªq`.
 *
 * Curto porque são até vinte e quatro colunas, e o mês vem 1-indexado do banco
 * enquanto `MES_CURTO` é 0-indexado — o `- 1` é o mesmo de `frotas.tsx`, e está
 * escrito numa função com teste pela mesma razão que lá: dentro do JSX ele já
 * foi esquecido uma vez.
 */
export function rotuloCurto(q: {
  mes: number;
  ano: number;
  quinzena: number;
}): string {
  return `${MES_CURTO[q.mes - 1]}/${String(q.ano).slice(2)} · ${q.quinzena}ªq`;
}

/** O rótulo por extenso, para a tabela e para o texto: `julho/2026, 2ª quinzena`. */
export function rotuloLongo(q: {
  mes: number;
  ano: number;
  quinzena: number;
}): string {
  return `${MES_CURTO[q.mes - 1]}/${q.ano}, ${q.quinzena}ª quinzena`;
}

/**
 * O rótulo por extenso de uma **chave** de competência — `2026-07-Q1`.
 *
 * `rotuloLongo`, acima, parte de ano/mês/quinzena já separados, e é o que a
 * série traz em toda quinzena. A variação não: ela nomeia com que competência
 * comparou (`variacao.contra`) e o que ela carrega é a chave crua, que é a
 * identidade da competência no produto inteiro — e era ela que a manchete
 * imprimia, "variação contra 2026-07-Q1" debaixo de uma tabela que escreve
 * `jul/2026, 1ª quinzena` na linha de baixo.
 *
 * **Uma chave que não se lê volta como está**, e é a única saída honesta: o mês
 * fora de 1..12, o texto em outro formato, a chave vazia. Inventar um mês a
 * partir de um `NaN` escreveria `undefined/2026` na tela — pior do que a chave
 * crua, que ao menos é verdadeira e endereça a competência.
 */
export function rotuloDaChave(chave: string): string {
  const partes = /^(\d{4})-(\d{2})-Q([12])$/.exec(chave);
  if (!partes) return chave;
  const [, ano, mes, quinzena] = partes;
  const nome = MES_CURTO[Number(mes) - 1];
  if (!nome) return chave;
  return `${nome}/${ano}, ${quinzena}ª quinzena`;
}

/** O número, ou o travessão da ausência. Nunca um zero no lugar de "não sei". */
export function numeroOuTraco(valor: number | null): string {
  return valor === null ? "—" : valor.toLocaleString("pt-BR");
}

/** `12,5%`, ou travessão. */
export function percentual(valor: number | null): string {
  return valor === null
    ? "—"
    : `${(valor * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** `+3`, `-2`, `0` — com sinal, porque a leitura é de variação. */
export function comSinal(valor: number | null): string | null {
  if (valor === null) return null;
  return valor > 0
    ? `+${valor.toLocaleString("pt-BR")}`
    : valor.toLocaleString("pt-BR");
}

/**
 * O sentido de uma variação, para a cor.
 *
 * **Mais parados é atenção; mais ativos é normal — e nenhum dos dois é
 * "bom" ou "ruim" por si.** Uma frota que cresce ativa veículos, e uma operação
 * que encolheu de propósito para de usá-los. A cor aqui diz para onde o número
 * foi, e a tela não escreve juízo nenhum ao lado.
 */
export function sentido(
  valor: number | null,
): "subiu" | "desceu" | "igual" | "semDado" {
  if (valor === null) return "semDado";
  if (valor > 0) return "subiu";
  if (valor < 0) return "desceu";
  return "igual";
}

/** As unidades que abriram a quinzena e não mandaram o relatório da situação. */
export function unidadesSemRelatorio(
  quinzena: QuinzenaDaFrota,
  situacao: SituacaoDaFrota,
): string[] {
  const enviaram = new Set(
    situacao === "ATIVA"
      ? quinzena.cobertura.comFrotaAtiva
      : quinzena.cobertura.comFrotaInativa,
  );
  return quinzena.cobertura.unidades.filter((u) => !enviaram.has(u));
}

/**
 * A frase da cobertura de uma quinzena, ou `null` quando não há o que avisar.
 *
 * É o aviso que impede a leitura errada mais provável desta tela: a quinzena em
 * que uma unidade não mandou arquivo tem menos placas, e sem esta frase o
 * gráfico pareceria uma frota encolhendo.
 */
export function avisoDeCobertura(quinzena: QuinzenaDaFrota): string | null {
  const semAtiva = unidadesSemRelatorio(quinzena, "ATIVA");
  const semInativa = unidadesSemRelatorio(quinzena, "INATIVA");
  if (semAtiva.length === 0 && semInativa.length === 0) return null;

  const partes: string[] = [];
  if (semAtiva.length > 0) {
    partes.push(`a frota ativa de ${semAtiva.join(", ")}`);
  }
  if (semInativa.length > 0) {
    partes.push(`a frota parada de ${semInativa.join(", ")}`);
  }
  return `Nesta quinzena não chegou ${partes.join(" e ")}. O que falta não está contado — e não é zero.`;
}

/** A última quinzena que mediu alguma coisa — a manchete dos cartões. */
export function ultimaMedida(
  quinzenas: readonly QuinzenaDaFrota[],
): QuinzenaDaFrota | null {
  for (let i = quinzenas.length - 1; i >= 0; i -= 1) {
    const q = quinzenas[i]!;
    if (q.ativos !== null || q.parados !== null) return q;
  }
  return null;
}

/** Os pontos do gráfico, já com rótulo — a única transformação que a tela faz. */
export function pontosDoGrafico(
  quinzenas: readonly QuinzenaDaFrota[],
): {
  rotulo: string;
  competencia: string;
  ativos: number | null;
  parados: number | null;
}[] {
  return quinzenas.map((q) => ({
    rotulo: rotuloCurto(q),
    competencia: q.competencia,
    ativos: q.ativos,
    parados: q.parados,
  }));
}
