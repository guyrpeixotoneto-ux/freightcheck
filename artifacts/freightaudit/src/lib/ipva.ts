import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_VEREDITO,
  celulasDoCsvDeIpva,
  COLUNAS_DO_CSV_DE_IPVA,
  FILTROS_DE_IPVA_VAZIOS,
  filtrarLinhasDeIpva,
  temValorNegativoDeIpva,
  type FiltrosDeIpva,
  type AliquotaDaVigencia,
  type EstadoDaLinhaDeIpva,
  type LinhaDeIpva,
  type MedidaDaVariavel,
  type VereditoDaAliquota,
} from "@workspace/comparison/ipva";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de IPVA — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/ipva`, que o servidor também
 * importa: estado, diferença, variação, impacto, alíquota implícita e agregados
 * saem de lá, e a tela nunca refaz nenhum deles. O que este arquivo acrescenta é
 * o que é genuinamente de apresentação — como se **escreve** um número cuja
 * unidade muda de linha para linha, que cor cada estado recebe e como a tabela
 * vira arquivo.
 *
 * A separação não é gosto: é a mesma de `lib/finame.ts`, e nasceu do defeito que
 * ela evita — enquanto a soma morava no JSX, o cartão somava a página e a tabela
 * somava o recorte, e os dois números apareciam lado a lado na mesma tela
 * discordando.
 */

/** O que a API de `/ipva/comparacao` devolve. */
/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Tipo próprio porque agora vem quatro vezes na mesma resposta: uma para a
 * comparação inteira e uma por tipo de equipamento (`porTipo`), que é o que as
 * abas Cavalo e Carreta mostram. A mesma forma nos dois é o que permite a tela
 * trocar de recorte sem trocar de código.
 */
export interface AgregadosDeIpva {
  resumo: {
    veiculosComparados: number;
    semAlteracao: number;
    veiculosComAlteracao: number;
    novosNaVigencia: number;
    ausentesNaComparada: number;
    variaveisAlteradas: number;
    veiculosComDadoIncompleto: number;
    veiculosComConflito: number;
    impacto: {
      porPeriodicidade: Record<string, number>;
      naoCalculavel: number;
      foraDaSoma: number;
      valoresNegativos: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeIpva;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

export interface ComparacaoDeIpva extends AgregadosDeIpva {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * Não é a tela que os recompõe a partir de `linhas`: "veículos comparados"
   * sai do acervo (`frotaPorTipo`, em `query.ts`) e não da lista de alterações,
   * porque um veículo em que nada mudou não produz linha nenhuma.
   */
  porTipo: Record<string, AgregadosDeIpva>;
  linhas: LinhaDeIpva[];
}

/** O que a API de `/ipva/totais` devolve: as duas séries da mesma leitura. */
export interface TotaisDeIpva {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
    negativos: number;
  }[];
  aliquotas: AliquotaDaVigencia[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Dinheiro sai com `R$`, percentual com `%`, ano inteiro e data como a fonte a
 * entregou. É a razão de `medida` viajar em cada linha: uma tabela que formata
 * tudo como dinheiro escreve "R$ 2.021,00" onde a fonte disse "2021", e quem lê
 * acredita.
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
    case "ANO":
      return formatNumber(numero, 0);
    case "DATA":
      return valor;
    default:
      return valor;
  }
}

/**
 * A diferença, com sinal explícito e na unidade certa.
 *
 * O sinal vem escrito mesmo quando é positivo: numa coluna em que metade das
 * linhas sobe e metade desce, "310" e "−310" a três linhas de distância se
 * confundem, e "+310" não se confunde com nada.
 */
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
    default:
      return `${sinal}${formatNumber(absoluto, 0)}`;
  }
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/**
 * A alíquota implícita escrita — sempre com três casas.
 *
 * Três, e não duas, porque é a terceira que carrega o achado: "1,00%" e "1,000%"
 * parecem o mesmo número, e só o segundo deixa ver que **todas** as placas
 * caíram no mesmo valor. Foi o desvio zero na terceira casa que mostrou que ali
 * havia fórmula, e não dado.
 *
 * E é por isso que ela não usa `formatNumber`: aquele corta o zero à direita — a
 * alíquota de 1,000% sairia dele como "1%", que é exatamente a escrita que
 * esconde a evidência. Aqui as três casas são obrigatórias, e um número que
 * termina em zero termina em zero na tela.
 */
export function escreverAliquota(percentual: number | null): string {
  if (percentual === null) return "—";
  const escrito = percentual.toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  return `${escrito}%`;
}

/**
 * A cor de um número que subiu ou desceu — e para que lado ela aponta.
 *
 * O IPVA desta tela é **rubrica remunerada na tabela de frete**, não o carnê que
 * a transportadora paga ao estado. Um IPVA que cai para R$ 0,00 não é economia:
 * é a rubrica deixando de ser paga, e quem opera perdeu dinheiro. Então
 * **descer é vermelho e subir é verde**, a mesma régua do FINAME e do lucro fixo
 * — as três rubricas são remuneração, e a cor é a do bolso de quem lê.
 *
 * Mas ano e data não têm lado bom, e pintá-los de verde e vermelho afirmaria um
 * juízo que esta tela não tem como sustentar. Então a cor só aparece em
 * dinheiro; o resto fica na tinta normal, e o sinal diz tudo o que há para
 * dizer.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeIpva, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

/**
 * O selo do veredito da alíquota.
 *
 * `FORMULA_UNICA` recebe a cor de aviso, e não a de sucesso, ainda que desvio
 * zero pareça o retrato de um dado impecável. É o contrário: um percentual único
 * aplicado a toda a frota quer dizer que ninguém calculou placa a placa, e a
 * queda que vier junto com ele é troca de critério, não economia.
 *
 * `VALOR_FIXO` fica em tinta neutra, e não em aviso, porque é o único dos quatro
 * que pode ser simplesmente **o que a rubrica é**: na carreta, o licenciamento é
 * uma taxa fixa de R$ 140–152, e semirreboque é isento de IPVA na maior parte
 * dos estados. Pintá-lo de laranja acusaria todo mês uma coisa que está certa.
 */
export const SELO_DO_VEREDITO: Record<VereditoDaAliquota, string> = {
  FORMULA_UNICA: "bg-warning/15 text-warning-foreground border border-warning/40",
  VALOR_FIXO: "bg-muted text-foreground border border-border",
  POR_VEICULO: "bg-brand/10 text-brand border border-brand/25",
  BASE_INSUFICIENTE: "bg-muted text-muted-foreground border border-dashed border-border",
};

export { ROTULO_DO_ESTADO, ROTULO_DO_VEREDITO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDeIpva; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

/**
 * Os filtros, o recorte e o teste do negativo — **do núcleo**.
 *
 * Os três nasceram aqui, e era o lugar certo enquanto o recorte só produzia
 * uma tabela. Deixou de ser quando a justificativa em lote passou a poder
 * dizer "todos os resultados deste filtro": ali o cliente manda o filtro, e
 * quem reabre o universo para gravar é o servidor — que não importa a tela.
 *
 * Então eles moram em `@workspace/comparison/ipva`, com as contas, e esta
 * linha é o que resta do que este arquivo tinha. Os nomes de fora continuam os
 * mesmos de propósito: a tela chama `filtrar`, e nenhuma delas precisou mudar.
 */
export {
  FILTROS_DE_IPVA_VAZIOS as FILTROS_VAZIOS,
  filtrarLinhasDeIpva as filtrar,
  temValorNegativoDeIpva as temValorNegativo,
  type FiltrosDeIpva,
};

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeIpva[],
  filtros: FiltrosDeIpva,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrarLinhasDeIpva(linhas, {
      ...filtros,
      estado: aba.chave,
    }).length;
  }
  contagem.TODAS = filtrarLinhasDeIpva(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsvDeIpva`), e aqui só se converte número
 * em texto do Excel brasileiro. Duas regras separadas porque são dois assuntos:
 * o que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeIpva[],
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
    [...COLUNAS_DO_CSV_DE_IPVA],
    ...linhas.map((l) =>
      celulasDoCsvDeIpva(
        l,
        l.id === null ? null : (justificadaPor?.get(l.id)?.texto ?? null),
      ).map((celula) => {
        if (celula === null || celula === undefined) return "";
        if (typeof celula === "number") return numeroParaCsv(celula);
        return celula;
      }),
    ),
  ];
}

/**
 * O impacto por periodicidade, escrito.
 *
 * Nunca um total único: o IPVA do cavalo é anual — 1% da nota ao ano; mensal
 * daria 12% a.a., que não existe — e há outra periodicidade no mesmo recorte.
 * Quando não há nada precificável, a frase é "sem impacto precificável", que é
 * diferente de "R$ 0,00".
 */
export function escreverImpacto(
  porPeriodicidade: Record<string, number>,
): { rotulo: string; valor: string; bruto: number }[] {
  return Object.entries(porPeriodicidade)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodicidade, valor]) => ({
      rotulo: periodicidade.toLowerCase(),
      valor: `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${formatBrl(Math.abs(valor))}`,
      bruto: valor,
    }));
}
