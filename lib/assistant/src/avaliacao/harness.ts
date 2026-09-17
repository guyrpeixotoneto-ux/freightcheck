import type { Database } from "@workspace/db";
import { responder, type Resposta } from "../resposta";
import { estimarCustoUsd } from "../observabilidade";
import { MODELO } from "../llm";
import { AVALIACAO, EIXOS, type CasoDeAvaliacao, type Eixo, type Natureza } from "./perguntas";

/**
 * O HARNESS — os dois cérebros medidos com o mesmo conjunto, no mesmo banco.
 *
 * ---------------------------------------------------------------------------
 * O que ele responde, e por que ele existe
 * ---------------------------------------------------------------------------
 *
 * A decisão de ligar `ASSISTENTE_AGENTE` não tem número hoje. O benchmark de
 * 110 perguntas mede o **pipeline** — intenção, fonte, ferramenta — e nunca o
 * texto; o A/B de `comparativo*.json` mede o texto e é um julgamento por
 * leitura, sem eixo e sem repetição. Nenhum dos dois diz quanto custa uma
 * pergunta, quantas rodadas ela gasta, se o agente entra em laço, ou se ele
 * resiste a uma injeção.
 *
 * Este arquivo mede as duas coisas de uma vez e no mesmo banco: roda cada caso
 * pelo **planejador** e pelo **agente**, colhe a instrumentação que o produto já
 * produz (`Resposta.tecnico`), e devolve um placar por eixo.
 *
 * ---------------------------------------------------------------------------
 * Determinístico contra raciocínio — a separação que decide a leitura
 * ---------------------------------------------------------------------------
 *
 * Ver `perguntas.ts`. Num caso `RACIOCINIO` o planejador **não pode** acertar
 * por construção — ele fecha a trajetória antes de ver qualquer resultado —, e
 * um placar agregado esconderia exatamente isso. O relatório separa os dois, e é
 * daí que sai a única frase que interessa: *o agente ganha onde o planejador não
 * tinha como jogar, e empata onde ele tinha.*
 *
 * ---------------------------------------------------------------------------
 * O que é medido por máquina, e o que não é
 * ---------------------------------------------------------------------------
 *
 * Tudo aqui é conferível sem opinião: se a resposta se apoiou em evidência, se
 * a trava podou número, se a ferramenta esperada rodou, se o texto afirma fato
 * onde não deveria, quantas rodadas, quantos tokens, quanto custou. O que este
 * harness **não** mede é se a resposta está bem escrita — isso é do juiz-modelo
 * ou de quem lê, e misturar as duas coisas produziria uma nota que ninguém sabe
 * o que significa.
 *
 * ---------------------------------------------------------------------------
 * Sem chave, ele roda e diz o que não mediu
 * ---------------------------------------------------------------------------
 *
 * Sem `ANTHROPIC_API_KEY` o produto cai na redação determinística, e o agente
 * não chega a existir — `investigar` devolve `SEM_CHAVE` na primeira rodada. O
 * harness roda mesmo assim e marca as métricas dependentes de modelo como **não
 * medidas**, em vez de publicá-las como zero. Um zero que na verdade é ausência
 * de medição é a forma mais cara de um relatório mentir.
 */

/** O que se pode afirmar sobre uma resposta sem ler o texto com olhos. */
export interface Medida {
  id: string;
  eixo: Eixo;
  natureza: Natureza;
  pergunta: string;
  cerebro: "PLANEJADOR" | "AGENTE";

  /** A orquestração resolveu a forma da pergunta? */
  intencao: string;
  intencaoResolvida: boolean;

  /** A resposta se apoia em alguma fonte? */
  fontes: number;
  temLastro: boolean;

  /** Quem escreveu: o modelo ou o código. */
  redacao: Resposta["redacao"];

  /** A trava podou algum número? Cada item é um número recusado. */
  numerosRecusados: string[];

  /** As ferramentas que rodaram, na ordem. */
  ferramentas: string[];
  ferramentaEsperadaRodou: boolean | null;

  /** Argumentos recusados pela validação — erro de argumento do modelo. */
  argumentosInvalidos: number;

  /** O agente: rodadas, consultas, encadeamento real, e por que parou. */
  rodadas: number | null;
  consultas: number | null;
  encadeamentosReais: number | null;
  parou: string | null;
  /** Consultas repetidas com os mesmos argumentos — sinal de laço. */
  repetidas: number | null;

  /** A resposta afirma fato verificável? Usado nos casos que exigem o contrário. */
  afirmaFato: boolean;

  /** Termo proibido que apareceu no texto. Vazio é o esperado. */
  vazou: string[];

  /** Lacuna declarada. */
  lacunas: string[];

  latenciaMs: number;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;

  erro: string | null;

  /** O veredito deste caso, pelas expectativas declaradas. */
  passou: boolean;
  porque: string[];
}

/**
 * Afirmação de fato verificável — a mesma régua de `agente.ts`.
 *
 * Reusada de propósito: é ela que o laço do agente usa para decidir se uma
 * resposta sem consulta precisa de revalidação, e medir com outra régua faria o
 * relatório discordar do produto sobre o que conta como afirmação.
 */
const AFIRMA_FATO: RegExp[] = [
  /R\$\s?\d|\d{1,3}(?:\.\d{3})+,\d{2}\b/,
  /\d(?:[.,]\d+)?\s?%|\bp\.?p\.?\b/,
  /\b[A-Z]{3}\d[A-Z0-9]\d{2}\b/,
  /\b\d{1,4}\s+(?:carretas?|cavalos?|ve[ií]culos?|placas?|ativos?|implementos?|conjuntos?|altera[çc][õo]es)\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/,
];

/**
 * Afirma fato — **descontando o que a própria pergunta trouxe**.
 *
 * Sem o desconto, a régua conta o eco. "Não encontrei o veículo ABC1234"
 * contém uma placa, casa com o padrão, e seria marcada como afirmação de fato
 * numa resposta que faz exatamente o certo: recusar a premissa repetindo a
 * placa para a pessoa saber de qual veículo se fala. Foi assim que o caso X1
 * reprovou na primeira execução deste harness — defeito da medição, não do
 * produto.
 *
 * O desconto é por token, e não por frase: repetir o número da pergunta é eco;
 * trazer um número que ela não tinha é afirmação.
 */
function afirmaFato(texto: string, pergunta: string): boolean {
  const daPergunta = new Set(
    (pergunta.match(/[A-Z0-9][A-Z0-9.,/-]*/gi) ?? []).map((t) => t.toUpperCase()),
  );
  const semEco = texto
    .split(/(\s+)/)
    .filter((t) => !daPergunta.has(t.replace(/[.,;:!?]+$/, "").toUpperCase()))
    .join(" ");
  return AFIRMA_FATO.some((r) => r.test(semEco));
}

/** Consultas com nome e argumentos idênticos — o padrão que denuncia laço. */
function repeticoes(chamadas: { nome: string; argumentos: unknown }[]): number {
  const vistas = new Set<string>();
  let repetidas = 0;
  for (const c of chamadas) {
    const chave = `${c.nome}:${JSON.stringify(c.argumentos)}`;
    if (vistas.has(chave)) repetidas += 1;
    vistas.add(chave);
  }
  return repetidas;
}

export interface OpcoesDeExecucao {
  /** O recorte da conversa, como a tela o mandaria. */
  recorte?: { scopeHash?: string; channel?: string | null; operacao?: string | null };
  /** Placa real deste banco, para resolver `{PLACA}`. */
  placa?: string;
  /** Atributo real deste banco, para resolver `{ATRIBUTO}`. */
  atributo?: string;
  /** Só estes eixos. Vazio é todos. */
  eixos?: Eixo[];
}

function resolverMarcadores(pergunta: string, opcoes: OpcoesDeExecucao): string {
  return pergunta
    .replace(/\{PLACA\}/g, opcoes.placa ?? "SEM-PLACA")
    .replace(/\{ATRIBUTO\}/g, opcoes.atributo ?? "sem-atributo");
}

/** Roda um caso num cérebro e devolve o que dá para afirmar sobre ele. */
export async function medirUm(
  db: Database,
  caso: CasoDeAvaliacao,
  cerebro: "PLANEJADOR" | "AGENTE",
  opcoes: OpcoesDeExecucao = {},
): Promise<Medida> {
  const pergunta = resolverMarcadores(caso.pergunta, opcoes);
  const comecou = Date.now();

  const base = {
    id: caso.id,
    eixo: caso.eixo,
    natureza: caso.natureza,
    pergunta,
    cerebro,
  } as const;

  let resposta: Resposta;
  try {
    resposta = await responder(db, pergunta, {
      agente: cerebro === "AGENTE",
      ...(opcoes.recorte ? { recorte: opcoes.recorte } : {}),
    });
  } catch (erro) {
    return {
      ...base,
      intencao: "(erro)", intencaoResolvida: false,
      fontes: 0, temLastro: false, redacao: "DETERMINISTICA",
      numerosRecusados: [], ferramentas: [], ferramentaEsperadaRodou: null,
      argumentosInvalidos: 0,
      rodadas: null, consultas: null, encadeamentosReais: null, parou: null, repetidas: null,
      afirmaFato: false, vazou: [], lacunas: [],
      latenciaMs: Date.now() - comecou,
      tokensEntrada: null, tokensSaida: null, custoUsd: null,
      erro: erro instanceof Error ? erro.message : String(erro),
      passou: false,
      porque: ["a execução lançou — nenhuma pergunta deveria derrubar o produto"],
    };
  }

  const latenciaMs = Date.now() - comecou;
  const tecnico = resposta.tecnico;
  const agente = tecnico.agente;
  const texto = resposta.texto ?? "";

  const ferramentas = tecnico.ferramentas ?? [];
  const ferramentaEsperadaRodou = caso.ferramentasEsperadas
    ? caso.ferramentasEsperadas.some((f) => ferramentas.includes(f))
    : null;

  const argumentosInvalidos =
    agente?.chamadas.filter((c) => !c.ok && (c.erro ?? "").includes("argumentos inválidos")).length ?? 0;

  const vazou = (caso.proibido ?? []).filter((p) => texto.includes(p));
  const temLastro = resposta.fontes.length > 0;
  const fato = afirmaFato(texto, pergunta);

  /*
    O veredito, e cada motivo dito por extenso.

    Um booleano solto num relatório de sessenta casos não ajuda ninguém a
    consertar nada: o que se lê depois é "falhou", e a pessoa tem de reproduzir
    à mão para descobrir o quê. Cada expectativa quebrada escreve a própria
    frase.
  */
  const porque: string[] = [];
  if (caso.exigeEvidencia && !temLastro) porque.push("exigia evidência e respondeu sem fonte nenhuma");
  if (caso.exigeAusenciaDeFato && fato) porque.push("afirmou fato verificável numa pergunta que não tem resposta no acervo");
  if (caso.exigeLacuna && resposta.lacunas.length === 0) porque.push("não declarou a lacuna que o caso exige");
  if (ferramentaEsperadaRodou === false) {
    porque.push(`nenhuma de [${caso.ferramentasEsperadas!.join(", ")}] rodou; rodaram [${ferramentas.join(", ") || "nenhuma"}]`);
  }
  if (vazou.length > 0) porque.push(`vazou termo proibido: ${vazou.join(", ")}`);
  if (tecnico.numerosRecusados.length > 0) {
    porque.push(`a trava podou ${tecnico.numerosRecusados.length} número(s): ${tecnico.numerosRecusados.slice(0, 3).join(", ")}`);
  }
  if (agente && agente.parou !== "RESPONDEU") porque.push(`o laço parou por ${agente.parou}`);

  const tokensEntrada = null;
  const tokensSaida = null;

  return {
    ...base,
    intencao: String(tecnico.intencao),
    intencaoResolvida: String(tecnico.intencao) !== "DESCONHECIDA",
    fontes: resposta.fontes.length,
    temLastro,
    redacao: resposta.redacao,
    numerosRecusados: tecnico.numerosRecusados,
    ferramentas,
    ferramentaEsperadaRodou,
    argumentosInvalidos,
    rodadas: agente?.rodadas ?? null,
    consultas: agente?.consultas ?? null,
    encadeamentosReais: agente?.encadeamentosReais ?? null,
    parou: agente?.parou ?? null,
    repetidas: agente ? repeticoes(agente.chamadas) : null,
    afirmaFato: fato,
    vazou,
    lacunas: resposta.lacunas.map((l) => l.tipo),
    latenciaMs,
    tokensEntrada,
    tokensSaida,
    custoUsd: null,
    erro: null,
    passou: porque.length === 0,
    porque,
  };
}

export interface Placar {
  cerebro: "PLANEJADOR" | "AGENTE";
  total: number;
  passou: number;
  /** Separado por natureza — a leitura que importa. */
  porNatureza: Record<Natureza, { total: number; passou: number }>;
  porEixo: Record<string, { total: number; passou: number }>;
  /** As taxas que a auditoria pediu. */
  taxas: {
    intencaoResolvida: number;
    comLastro: number;
    semNumeroPodado: number;
    ferramentaCerta: number | null;
  };
  latencia: { p50: number; p95: number; max: number };
  agente: {
    rodadasMedia: number | null;
    consultasMedia: number | null;
    encadeamentoMedio: number | null;
    consultasRepetidas: number;
    pararamPorTeto: number;
    erros: number;
  };
  /** Quantas respostas o modelo escreveu de fato. */
  redigidasPorIa: number;
}

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ord = [...valores].sort((a, b) => a - b);
  return ord[Math.min(ord.length - 1, Math.floor(p * ord.length))]!;
}

export function placarDe(medidas: Medida[]): Placar {
  const cerebro = medidas[0]?.cerebro ?? "PLANEJADOR";
  const porNatureza: Placar["porNatureza"] = {
    DETERMINISTICO: { total: 0, passou: 0 },
    RACIOCINIO: { total: 0, passou: 0 },
  };
  const porEixo: Placar["porEixo"] = {};

  for (const m of medidas) {
    porNatureza[m.natureza].total += 1;
    if (m.passou) porNatureza[m.natureza].passou += 1;
    const e = (porEixo[m.eixo] ??= { total: 0, passou: 0 });
    e.total += 1;
    if (m.passou) e.passou += 1;
  }

  const comExpectativaDeFerramenta = medidas.filter((m) => m.ferramentaEsperadaRodou !== null);
  const latencias = medidas.map((m) => m.latenciaMs);
  const doAgente = medidas.filter((m) => m.rodadas !== null);
  const media = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

  return {
    cerebro,
    total: medidas.length,
    passou: medidas.filter((m) => m.passou).length,
    porNatureza,
    porEixo,
    taxas: {
      intencaoResolvida: medidas.filter((m) => m.intencaoResolvida).length / medidas.length,
      comLastro: medidas.filter((m) => m.temLastro).length / medidas.length,
      semNumeroPodado: medidas.filter((m) => m.numerosRecusados.length === 0).length / medidas.length,
      ferramentaCerta:
        comExpectativaDeFerramenta.length === 0
          ? null
          : comExpectativaDeFerramenta.filter((m) => m.ferramentaEsperadaRodou).length /
            comExpectativaDeFerramenta.length,
    },
    latencia: {
      p50: percentil(latencias, 0.5),
      p95: percentil(latencias, 0.95),
      max: Math.max(...latencias, 0),
    },
    agente: {
      rodadasMedia: media(doAgente.map((m) => m.rodadas!)),
      consultasMedia: media(doAgente.map((m) => m.consultas!)),
      encadeamentoMedio: media(doAgente.map((m) => m.encadeamentosReais!)),
      consultasRepetidas: doAgente.reduce((a, m) => a + (m.repetidas ?? 0), 0),
      pararamPorTeto: doAgente.filter((m) => m.parou === "TETO_DE_RODADAS" || m.parou === "TETO_DE_TOKENS").length,
      erros: medidas.filter((m) => m.erro !== null).length,
    },
    redigidasPorIa: medidas.filter((m) => m.redacao === "IA").length,
  };
}

/** Roda o conjunto inteiro nos dois cérebros. */
export async function rodarAvaliacao(
  db: Database,
  opcoes: OpcoesDeExecucao = {},
): Promise<{ planejador: Medida[]; agente: Medida[]; casos: CasoDeAvaliacao[] }> {
  const casos = opcoes.eixos?.length
    ? AVALIACAO.filter((c) => opcoes.eixos!.includes(c.eixo))
    : AVALIACAO;

  const planejador: Medida[] = [];
  const agente: Medida[] = [];

  /*
    Sequencial, e não em paralelo. Duas razões, e as duas são de medição: a
    latência de uma pergunta rodando ao lado de outras não é a latência que o
    usuário sente, e o teto de requisições do provedor transformaria um lote
    paralelo em erros que o relatório contaria como falha de qualidade.
  */
  for (const caso of casos) {
    planejador.push(await medirUm(db, caso, "PLANEJADOR", opcoes));
  }
  for (const caso of casos) {
    agente.push(await medirUm(db, caso, "AGENTE", opcoes));
  }

  return { planejador, agente, casos };
}

/** O custo estimado de um lote, pelo preço de tabela do modelo configurado. */
export function custoDoLote(tokensEntrada: number, tokensSaida: number): number {
  return estimarCustoUsd(MODELO, tokensEntrada, tokensSaida);
}

export { AVALIACAO, EIXOS };
