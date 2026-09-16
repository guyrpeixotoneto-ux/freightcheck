import {
  ROTULO_DO_ESTADO,
  celulasDoCsv,
  COLUNAS_DO_CSV,
  type EstadoDaLinhaDeFiname,
  type LinhaDeFiname,
  type MedidaDaVariavel,
} from "@workspace/comparison/finame";
import type { RecorteDeTipo } from "@/components/comparacao/recorte-de-equipamento";
import { numeroParaCsv } from "@/lib/csv";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * A metade de tela da Auditoria de FINAME — apresentação, e só.
 *
 * A conta inteira mora em `@workspace/comparison/finame`, que o servidor também
 * importa: estado, diferença, variação, impacto e agregados saem de lá, e a
 * tela nunca refaz nenhum deles. O que este arquivo acrescenta é o que é
 * genuinamente de apresentação — como se **escreve** um número cuja unidade
 * muda de linha para linha, que cor cada estado recebe e como a tabela vira
 * arquivo.
 *
 * A separação não é gosto: enquanto a soma morava no JSX, o cartão somava a
 * página e a tabela somava o recorte, e os dois números apareciam lado a lado
 * na mesma tela discordando.
 */

/** O que a API de `/finame/comparacao` devolve. */
/**
 * Os três agregados que os cartões e os gráficos leem.
 *
 * Existe como tipo próprio porque agora vem **quatro vezes** na mesma resposta:
 * uma para a comparação inteira e uma por tipo de equipamento (`porTipo`), que
 * é o que as abas Cavalo e Carreta mostram. Escrito uma vez, ele garante que a
 * aba e o total tenham a mesma forma — e a mesma forma é o que permite a tela
 * trocar de recorte sem trocar de código.
 */
export interface AgregadosDeFiname {
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
      cobertasPorParcelas: number;
      /** Linhas fora do total por serem rubrica de outro módulo — base e tributos. */
      foraDaSoma: number;
    };
  };
  alteracoesPorVariavel: {
    variavel: string;
    rotulo: string;
    medida: MedidaDaVariavel;
    alteracoes: number;
  }[];
  distribuicaoPorEstado: {
    estado: EstadoDaLinhaDeFiname;
    rotulo: string;
    veiculos: number;
    fracao: number;
  }[];
}

export interface ComparacaoDeFiname extends AgregadosDeFiname {
  changeSetId: string;
  base: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  comparada: { id: string; sourceLabel: string | null; effectiveDate: string | null };
  /**
   * Os mesmos agregados, um por tipo — calculados no servidor.
   *
   * Não é a tela que os recompõe a partir de `linhas`: "veículos comparados"
   * sai do acervo (`frotaPorTipo`, em `query.ts`) e não da lista de alterações,
   * porque um veículo em que nada mudou não produz linha nenhuma. Uma aba que
   * contasse a lista diria zero comparados sobre uma frota inteira parada.
   */
  porTipo: Record<string, AgregadosDeFiname>;
  linhas: LinhaDeFiname[];
}

export interface TotaisDeFiname {
  totais: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    total: number;
    veiculos: number;
  }[];
}

/**
 * Um valor escrito na unidade da própria variável.
 *
 * Dinheiro sai com `R$`, percentual com `%`, prazo e carência em meses, ano
 * inteiro e data como a fonte a entregou. É a razão de `medida` viajar em cada
 * linha: uma tabela que formata tudo como dinheiro escreve "R$ 60,00" onde a
 * fonte disse "60 meses", e quem lê acredita.
 */
export function escreverValor(
  valor: string | null,
  medida: MedidaDaVariavel,
): string {
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
 * confundem, e "+310" não se confunde com nada. O percentual é escrito à parte
 * para que a diferença de uma taxa apareça em **pontos percentuais** — 0,5 p.p.
 * e +5,26% são as duas verdades da mesma linha, e só uma delas é a diferença.
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
    case "MESES":
      return `${sinal}${formatNumber(absoluto, 0)} ${absoluto === 1 ? "mês" : "meses"}`;
    default:
      return `${sinal}${formatNumber(absoluto, 0)}`;
  }
}

/**
 * O período do financiamento, escrito — `60` vira `60 meses`.
 *
 * A mesma régua de {@link escreverValor} para a medida `MESES`, e não uma
 * segunda: a coluna "Período FINAME" e a linha "Prazo" mostram o mesmo campo do
 * mesmo veículo, e escrevê-lo de dois jeitos na mesma tela seria convidar a
 * dúvida sobre se são o mesmo número.
 */
export function escreverPeriodo(periodo: string | null): string {
  return escreverValor(periodo, "MESES");
}

/**
 * A data de cadastro, escrita — `2019-05-10` vira `10/05/2019`.
 *
 * A fonte entrega a data em ISO, e a planilha do cliente a lê em dia/mês/ano.
 * Uma data que não chega em ISO sai como veio: inventar um formato sobre um
 * texto que não se entendeu seria trocar um dado bruto legível por um palpite.
 */
export function escreverDataDeCadastro(data: string | null): string {
  if (data === null || data === "") return "—";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : data;
}

/** A variação em pontos percentuais. Nula quando a base é zero. */
export function escreverVariacao(variacao: number | null): string {
  if (variacao === null) return "—";
  const sinal = variacao > 0 ? "+" : variacao < 0 ? "−" : "";
  return `${sinal}${formatNumber(Math.abs(variacao), 2)}%`;
}

/**
 * A cor de um número que subiu ou desceu — e para que lado ela aponta.
 *
 * O FINAME desta tela é **parcela remunerada na tabela de frete**, não a conta
 * que a transportadora paga ao banco. Uma parcela que cai para R$ 0,00 não é
 * economia: é a rubrica deixando de ser paga, e quem opera perdeu dinheiro.
 * Então **descer é vermelho e subir é verde**, a mesma régua do lucro fixo e do
 * IPVA — as três rubricas são remuneração, e a cor é a do bolso de quem lê.
 *
 * Mas prazo, ano e data não têm lado bom, e pintá-los de verde e vermelho
 * afirmaria um juízo que esta tela não tem como sustentar. Então a cor só
 * aparece em dinheiro; o resto fica na tinta normal, e o sinal diz tudo o que há
 * para dizer.
 */
export function corDaDiferenca(
  diferenca: number | null,
  medida: MedidaDaVariavel,
): string {
  if (diferenca === null || diferenca === 0 || medida !== "DINHEIRO") return "";
  return diferenca > 0 ? "text-success" : "text-destructive";
}

/** O selo de cada estado. Cor **e** texto — nunca só a cor. */
export const SELO_DO_ESTADO: Record<EstadoDaLinhaDeFiname, string> = {
  SEM_ALTERACAO: "bg-muted text-muted-foreground",
  ALTERADO: "bg-warning/15 text-warning-foreground border border-warning/40",
  NOVO_NA_VIGENCIA: "bg-brand/10 text-brand border border-brand/25",
  AUSENTE_NA_COMPARADA: "bg-destructive/10 text-destructive border border-destructive/25",
  DADO_INCOMPLETO: "bg-muted text-muted-foreground border border-dashed border-border",
  CONFLITO: "bg-destructive/10 text-destructive border border-destructive/40",
};

export { ROTULO_DO_ESTADO };

/** Os estados que a fileira de abas oferece, na ordem em que a tela os lê. */
export const ABAS_DE_ESTADO: { chave: "TODAS" | EstadoDaLinhaDeFiname; rotulo: string }[] = [
  { chave: "TODAS", rotulo: "Todas as alterações" },
  { chave: "ALTERADO", rotulo: "Alterados" },
  { chave: "NOVO_NA_VIGENCIA", rotulo: "Novos" },
  { chave: "AUSENTE_NA_COMPARADA", rotulo: "Ausentes" },
  { chave: "DADO_INCOMPLETO", rotulo: "Dado incompleto" },
  { chave: "CONFLITO", rotulo: "Conflito" },
  { chave: "SEM_ALTERACAO", rotulo: "Sem alteração" },
];

export interface FiltrosDeFiname {
  busca: string;
  tipo: string;
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeFiname;
}

export const FILTROS_VAZIOS: FiltrosDeFiname = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas e o CSV.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" e a tabela que
 * mostra 9 linhas é o defeito que aparece quando o filtro é reescrito no lugar
 * de ser reutilizado.
 */
export function filtrar(
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
): LinhaDeFiname[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/** Quantas linhas cada aba tem, contadas sobre o mesmo recorte da tabela. */
export function contagemPorAba(
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
): Record<string, number> {
  const contagem: Record<string, number> = { TODAS: 0 };
  for (const aba of ABAS_DE_ESTADO) {
    if (aba.chave === "TODAS") continue;
    contagem[aba.chave] = filtrar(linhas, { ...filtros, estado: aba.chave }).length;
  }
  contagem.TODAS = filtrar(linhas, { ...filtros, estado: "TODAS" }).length;
  return contagem;
}

/**
 * A tabela virando as linhas do CSV.
 *
 * As células saem do núcleo (`celulasDoCsv`), e aqui só se converte número em
 * texto do Excel brasileiro. Duas regras separadas porque são dois assuntos: o
 * que vai em cada coluna é do domínio, e a vírgula decimal é do Excel.
 */
export function linhasDoCsv(
  linhas: readonly LinhaDeFiname[],
  justificadaPor?: ReadonlyMap<number, { texto: string }>,
): string[][] {
  return [
    [...COLUNAS_DO_CSV],
    ...linhas.map((l) =>
      celulasDoCsv(
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
 * Nunca um total único: mensal e anual não se somam, e a tela repete essa
 * recusa mostrando um valor por periodicidade. Quando não há nenhum, a frase é
 * "sem impacto precificável" — que é diferente de "R$ 0,00".
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

// ---------------------------------------------------------------------------
// O par de vigências — qual unidade, e quais duas pontas
// ---------------------------------------------------------------------------
//
// As três funções deste bloco — `vigenciasDaUnidade`, `parDePartida` e
// `rotulosDasVigencias` — mudaram de endereço para
// `@workspace/comparison/recorte-de-rubrica` no dia em que a segunda tela de
// rubrica passou a escolher um par de vigências. Elas nunca souberam nada sobre
// financiamento: eram genéricas desde que nasceram, e morar no arquivo de uma
// rubrica só era o acidente de terem nascido junto com a primeira.
//
// O que elas resolvem é caro demais para existir em duas versões: sem o
// `scopeHash` no par, a tela abre **recusada** — este acervo tem seis vigências
// × cinco unidades com o mesmo rótulo e a mesma data, e o motor recusa comparar
// escopos diferentes. Uma cópia por rubrica levaria a segunda tela a repetir,
// inteiro, o defeito que a primeira já pagou para descobrir.

// ---------------------------------------------------------------------------
// O modo de leitura — comparação entre duas vigências, ou evolução no ano
// ---------------------------------------------------------------------------

/**
 * Os dois modos da Auditoria de FINAME.
 *
 * ---------------------------------------------------------------------------
 * Por que é um modo, e não uma segunda rota
 * ---------------------------------------------------------------------------
 * Porque a unidade, o canal, o `scopeHash`, o par de vigências e o recorte de
 * equipamento são da **tela**, e não de um dos dois modos. Numa rota separada,
 * cada ida e volta os perderia — e quem entrasse na Evolução vindo de Carreta
 * em julho→agosto voltaria para Cavalo + Carreta no par padrão, sem ter pedido
 * nenhuma das duas coisas.
 *
 * Com uma rota só e `?modo=`, não há nada a preservar: o endereço inteiro
 * continua ali, e o modo é mais uma chave dentro dele.
 */
export type ModoDeFiname = "comparacao" | "evolucao";

/**
 * O modo que veio do endereço — e a recusa de adivinhar.
 *
 * Endereço adulterado cai na comparação, que é a tela que sempre existiu. Mesma
 * doutrina de `ehTipoDaLinhaDoTempo`: nunca uma tela em branco, que quem lê
 * confundiria com "não há nada aqui".
 */
export function ehModoDeFiname(valor: string | null | undefined): valor is ModoDeFiname {
  return valor === "comparacao" || valor === "evolucao";
}

/**
 * O recorte de equipamento **da evolução** — chave própria, padrão próprio.
 *
 * Ele não herda o recorte da comparação de propósito. São duas perguntas
 * diferentes feitas em dois momentos diferentes, e herdar faria a Evolução
 * abrir em Carreta só porque a comparação estava em Carreta — sem que o
 * seletor de dentro tivesse sido tocado. A evolução abre em Cavalo + Carreta,
 * que é o acervo inteiro; quem quiser um lado, pede.
 */
export function ehRecorteDeTipo(valor: string | null | undefined): valor is RecorteDeTipo {
  return valor === "TODOS" || valor === "CAVALO" || valor === "CARRETA";
}

// ---------------------------------------------------------------------------
// O ano — um atalho para as pontas, e nunca um eixo próprio
// ---------------------------------------------------------------------------

/**
 * Os anos que o histórico tem, do mais recente para o mais antigo.
 *
 * Sai das vigências que existem, e nunca de um intervalo inventado: um seletor
 * que oferecesse 2024 sobre um acervo que começa em dezembro de 2025 levaria a
 * uma tela vazia que não explica nada — a mesma falha que o recorte de
 * equipamento corrigiu ao desabilitar a aba sem vigência.
 */
export function anosDasVigencias(datas: readonly string[]): string[] {
  const anos = new Set<string>();
  for (const d of datas) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) anos.add(d.slice(0, 4));
  }
  return [...anos].sort().reverse();
}

/**
 * O par de pontas que um ano pede ao motor.
 *
 * ---------------------------------------------------------------------------
 * Por que `de` é do ano **anterior**
 * ---------------------------------------------------------------------------
 * Porque a ponta inicial não entra na soma — ela é o ponto de partida
 * (`pontasDoIntervalo`, em `janela-de-comparacoes.ts`). Passar a primeira
 * vigência de 2026 como `de` jogaria fora a transição dezembro→janeiro, que é
 * uma alteração **de** 2026: a coluna de janeiro sumiria do ano que ela
 * pertence.
 *
 * Então `de` é a última vigência anterior ao ano, e `ate` é a última do ano. Sem
 * vigência anterior — o primeiro ano do acervo —, `de` é a mais antiga do
 * próprio ano, e a tela perde só a coluna que nenhuma comparação explica,
 * porque não existe comparação antes da primeira vigência.
 *
 * Devolve `null` quando o ano não tem vigência nenhuma: aí não há intervalo a
 * pedir, e quem chama não pergunta.
 */
export function pontasDoAno(
  ano: string,
  datas: readonly string[],
): { de: string; ate: string } | null {
  const ordenadas = [...datas].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const doAno = ordenadas.filter((d) => d.slice(0, 4) === ano);
  if (doAno.length === 0) return null;

  const anteriores = ordenadas.filter((d) => d < doAno[0]);
  return {
    de: anteriores.length > 0 ? anteriores[anteriores.length - 1] : doAno[0],
    ate: doAno[doAno.length - 1],
  };
}

/**
 * O endereço depois de uma troca — e o que ele **não** mexe.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é uma função, e não três linhas dentro da página
 * ---------------------------------------------------------------------------
 * Porque a promessa que ela cumpre é a mais fácil de quebrar sem ninguém notar:
 * entrar na Evolução e voltar tem de devolver a comparação exatamente como
 * estava — mesma unidade, mesmo canal, mesmo par de vigências, mesmo recorte de
 * equipamento. Nada disso é mencionado aqui: as chaves que não aparecem em
 * `mudancas` atravessam intocadas, e é justamente isso que o teste prende.
 *
 * `null` e string vazia apagam a chave, em vez de escreverem o vazio: um
 * `?modo=` pendurado no endereço seria um modo que o leitor descarta em
 * silêncio, e a tela anunciaria um estado que não existe.
 */
export function enderecoComTroca(
  atual: string | URLSearchParams,
  mudancas: Record<string, string | null>,
): string {
  const proxima = new URLSearchParams(
    typeof atual === "string" ? atual : atual.toString(),
  );
  for (const [chave, valor] of Object.entries(mudancas)) {
    if (valor === null || valor === "") proxima.delete(chave);
    else proxima.set(chave, valor);
  }
  const texto = proxima.toString();
  return texto ? `${ROTA_DO_FINAME}?${texto}` : ROTA_DO_FINAME;
}

/** A rota da Auditoria de FINAME — uma só, para os dois modos. */
export const ROTA_DO_FINAME = "/custo-fixo-finame";
