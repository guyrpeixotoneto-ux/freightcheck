import {
  COLUNAS_DO_CSV_DE_QLP_COMPARADO,
  ROTULO_DO_ESTADO,
  celulasDoCsvDeQlpComparado,
  type AlteracoesDaVariavelDeQlp,
  type EstadoDaLinha,
  type FatiaDeEstadoDeQlp,
  type IdentificacaoDoCargo,
  type LinhaDeQlpComparado,
  type MedidaDaVariavel,
  type QuadroDeQlp,
  type ResumoDaComparacaoDeQlp,
} from "@workspace/comparison/qlp-comparacao";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";
import { separarRotulo, type RotuloDaEntidade } from "@/components/qlp/apresentacao";

/**
 * A metade de tela da Comparação do QLP — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/qlp-comparacao`, que o
 * servidor também importa: estado, diferença, variação, movimento do efetivo e
 * agregados saem de lá, e a tela nunca refaz nenhum deles. O que este arquivo
 * acrescenta é como cada número se escreve — e uma decisão que não é
 * formatação disfarçada: **quem ganha cor.** Ver {@link corDaDiferenca}.
 */

/** O que `/qlp/comparacao` devolve. */
export interface ComparacaoDeQlp {
  quadro: QuadroDeQlp;
  rubrica: string | null;
  rubricasDoQuadro: string[];
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  resumo: ResumoDaComparacaoDeQlp;
  alteracoesPorVariavel: AlteracoesDaVariavelDeQlp[];
  distribuicaoPorEstado: FatiaDeEstadoDeQlp[];
  /** A chave normalizada do cargo → a forma legível. Ver a rota. */
  rotulos: Record<string, string>;
  linhas: LinhaDeQlpComparado[];
}

/**
 * O cargo como se lê — unidade de um lado, cargo do outro, e cada campo que a
 * fonte grudou no nome (a classificação, e o que mais vier) na sua própria casa.
 *
 * O motor rotula a linha com a chave normalizada
 * (`07526557001505CARGOGERENTE…`); o dicionário de `rotulos` devolve a forma
 * como o arquivo a escreveu. Sem entrada no dicionário, a chave aparece como
 * está: menos bonita e igualmente verdadeira — inventar um nome seria pior.
 */
export function escreverCargo(
  chave: string | null,
  rotulos: Record<string, string>,
  /*
    O tipo da entidade, quando a linha o traz: é ele que diz de quantas colunas
    a identidade deste quadro é feita, e por isso o turno do QLP Operacional —
    a terceira delas — deixa de viajar dentro do nome do cargo.
  */
  entityType?: string | null,
): RotuloDaEntidade {
  const vazio = { classificacao: null, outros: [] };
  if (!chave) return { unidade: "", cargo: "—", ...vazio };
  const legivel = rotulos[chave];
  if (!legivel) return { unidade: "", cargo: chave, ...vazio };
  return separarRotulo(legivel, entityType);
}

/**
 * O cargo em campos, como o CSV o quer: uma coluna por fato. Os campos sem
 * coluna própria — `Quantidade: 10,0` e afins — entram junto da classificação,
 * com o rótulo deles: perder um fato para a planilha ficar bonita seria pior.
 */
export function identificacaoDoCargo(
  chave: string | null,
  rotulos: Record<string, string>,
  entityType?: string | null,
): IdentificacaoDoCargo {
  const { unidade, cargo, classificacao, outros } = escreverCargo(chave, rotulos, entityType);
  const complemento = [
    ...(classificacao ? [classificacao] : []),
    ...outros.map((c) => `${c.rotulo}: ${c.valor}`),
  ];
  return {
    unidade,
    cargo,
    classificacao: complemento.length > 0 ? complemento.join(" · ") : null,
  };
}

/**
 * O cargo numa linha só — para a busca, para o `aria-label` e para o título da
 * gaveta. Só onde o texto é **nome** os campos voltam a andar juntos: numa
 * tabela cada um tem a sua coluna, e é essa a regra ({@link separarRotulo}).
 */
export function cargoEmUmaLinha(
  chave: string | null,
  rotulos: Record<string, string>,
  entityType?: string | null,
): string {
  const { unidade, cargo, classificacao } = identificacaoDoCargo(chave, rotulos, entityType);
  return [...(unidade ? [unidade] : []), cargo, ...(classificacao ? [classificacao] : [])].join(
    " · ",
  );
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * `QUANTIDADE` e `FATOR` não são dinheiro, e escrevê-los como reais é o erro
 * que a tabela do QLP mais convida a cometer: quantidade, valor unitário e
 * despesa convivem na mesma linha do export.
 */
export function escreverValor(valor: string | null, medida: MedidaDaVariavel): string {
  if (valor === null || valor === "") return "—";
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return valor;
  switch (medida) {
    case "DINHEIRO":
      return formatBrl(numero);
    case "PERCENTUAL":
      return `${formatNumber(numero, 2)}%`;
    case "MESES":
      return `${formatNumber(numero, 0)} ${numero === 1 ? "mês" : "meses"}`;
    case "QUANTIDADE":
      return formatNumber(numero, Number.isInteger(numero) ? 0 : 2);
    case "FATOR":
      return formatNumber(numero, 2);
    default:
      return valor;
  }
}

/** A diferença, com sinal explícito e na unidade certa. */
export function escreverDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null) return "—";
  const sinal = diferenca > 0 ? "+" : diferenca < 0 ? "−" : "";
  const absoluto = Math.abs(diferenca);
  switch (medida) {
    case "DINHEIRO":
      return `${sinal}${formatBrl(absoluto)}`;
    case "PERCENTUAL":
      return `${sinal}${formatNumber(absoluto, 2)} p.p.`;
    case "QUANTIDADE":
      return `${sinal}${formatNumber(absoluto, Number.isInteger(absoluto) ? 0 : 2)}`;
    default:
      return `${sinal}${formatNumber(absoluto, 2)}`;
  }
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/**
 * A cor de um número que subiu ou desceu — e por que só o dinheiro a ganha.
 *
 * Em dinheiro vale a régua do produto inteiro: positivo é ganho e sai em verde,
 * negativo é perda e sai em vermelho, como no FINAME, no IPVA e no Monitor
 * Custo Fixo. Dar cor a uma linha não é somá-la — a direção de uma coluna não
 * depende da curadoria, e é o total que depende; ele continua não existindo
 * nesta tela.
 *
 * Houve aqui a régua inversa, pela leitura de que o quadro de pessoal é custo e
 * despesa que sobe é notícia ruim. Ela saiu junto com a mesma leitura no
 * Monitor e nas auditorias de Aluguel e de Impostos, que a citavam de volta.
 *
 * **Quantidade não ganha cor**, e é a diferença desta tela para as outras seis.
 * Um efetivo que sobe não é bom nem ruim: pode ser a unidade que contratou o
 * que faltava ou a que estourou o quadro de referência, e a tela não sabe qual.
 * Pintar de vermelho afirmaria a segunda leitura sem base nenhuma.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinha, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinha; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Cargos que entraram" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Cargos que saíram" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

/** O nome de uma rubrica na tela. Sem entrada, o próprio código, legível. */
export const ROTULO_DA_RUBRICA: Record<string, string> = {
  salario: "Salário",
  encargos: "Encargos e provisões",
  beneficio: "Benefícios",
  saude: "Plano de saúde",
  refeicao: "Refeição",
  transporte: "Vale-transporte",
  seguro: "Seguro de vida",
  outros_beneficios: "Diária e PLR",
  frota_leve: "Frota leve",
  telefonia: "Telefonia",
  uniformes: "Uniformes",
  benchmark: "Quadro de referência",
  abono: "Abono",
  subtotais: "Subtotais",
  variavel: "Remuneração variável",
  epi: "Uniforme e EPI",
  dimensionamento: "Dimensionamento",
  nao_identificado: "Sem rubrica declarada",
};

/**
 * A frase da aba que o quadro não sustenta — dita, e não escondida.
 *
 * Um módulo que existe num quadro e não no outro não é defeito da tela: é o que
 * o arquivo diz. O export administrativo traz benefício **numa coluna só**
 * (`Quantidade × Valor = Despesa Benefício`) e o operacional o decompõe em
 * nove, então plano de saúde e refeição existem lá e não existem aqui.
 *
 * Esconder a aba faria a ausência parecer uma escolha da tela; deixá-la abrir
 * vazia faria parecer "nada mudou". A terceira saída é a única verdadeira —
 * mostrar a aba e escrever por que ela não tem o que mostrar, com o pedido que
 * a faria existir.
 */
export function porQueOModuloNaoExiste(
  rotuloDoModulo: string,
  quadro: QuadroDeQlp,
): string {
  if (quadro === "ADMINISTRATIVO") {
    return (
      `O export do QLP Administrativo não decompõe esta rubrica: ele traz benefício ` +
      `numa coluna só — Quantidade Benefício × Valor Benefício = Despesa Benefício —, ` +
      `e ${rotuloDoModulo.toLowerCase()} está dentro dela sem separação. Para esta aba ` +
      `existir, o arquivo precisa vir decomposto como o do operacional já vem. ` +
      `Enquanto isso, a comparação de benefícios do administrativo está no módulo ` +
      `Benefícios.`
    );
  }
  return (
    `O export do QLP Operacional não traz coluna desta rubrica. Ela existe no quadro ` +
    `administrativo, e a comparação dela está na aba ao lado.`
  );
}

export function escreverRubrica(rubrica: string | null): string {
  if (!rubrica) return "—";
  return ROTULO_DA_RUBRICA[rubrica] ?? rubrica.replace(/_/g, " ");
}

export interface FiltrosDeComparacaoDeQlp {
  busca: string;
  variavel: string;
  estado: "TODAS" | EstadoDaLinha;
}

export const FILTROS_VAZIOS: FiltrosDeComparacaoDeQlp = {
  busca: "",
  variavel: "TODAS",
  estado: "TODAS",
};

/** O recorte da tabela — texto, variável e estado, nesta ordem. */
export function filtrar(
  linhas: LinhaDeQlpComparado[],
  filtros: FiltrosDeComparacaoDeQlp,
  rotulos: Record<string, string>,
): LinhaDeQlpComparado[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (busca === "") return true;
    const cargo = cargoEmUmaLinha(l.entityLabel, rotulos, l.entityType).toLowerCase();
    return (
      cargo.includes(busca) || l.rotuloDaVariavel.toLowerCase().includes(busca)
    );
  });
}

/** Quantas linhas caem em cada aba de estado, para os números dos rótulos. */
export function contagemPorEstado(
  linhas: LinhaDeQlpComparado[],
  filtros: FiltrosDeComparacaoDeQlp,
  rotulos: Record<string, string>,
): Record<string, number> {
  const semEstado = filtrar(linhas, { ...filtros, estado: "TODAS" }, rotulos);
  const contagem: Record<string, number> = { TODAS: semEstado.length };
  for (const linha of semEstado) {
    contagem[linha.estado] = (contagem[linha.estado] ?? 0) + 1;
  }
  return contagem;
}

/**
 * O CSV do que está à vista — cabeçalho e linhas.
 *
 * Números saem com vírgula decimal (`numeroParaCsv`) e ausência sai **vazia**,
 * nunca como zero: uma célula vazia numa planilha é ausência, e um zero é um
 * valor. É a mesma regra das outras seis exportações.
 */
export function linhasDoCsv(
  linhas: LinhaDeQlpComparado[],
  rotulos: Record<string, string>,
  /*
     O que o gestor escreveu sobre cada alteração, por `change.id` — a mesma
     leitura que a coluna da tabela usa. Opcional porque ela pode não ter
     voltado: um CSV com a coluna em branco continua sendo o arquivo da
     comparação, e recusá-lo por causa do comentário seria trocar o dado pela
     nota sobre o dado.
  */
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV_DE_QLP_COMPARADO],
    ...linhas.map((l) =>
      celulasDoCsvDeQlpComparado(
        l,
        identificacaoDoCargo(l.entityLabel, rotulos, l.entityType),
        ROTULO_DO_ESTADO[l.estado],
        l.id === null ? null : (justificadaPor?.get(l.id)?.texto ?? null),
      ).map((celula) =>
        celula === null ? "" : typeof celula === "number" ? numeroParaCsv(celula) : celula,
      ),
    ),
  ];
}

export { ROTULO_DO_ESTADO };
export type { LinhaDeQlpComparado, EstadoDaLinha, QuadroDeQlp };
