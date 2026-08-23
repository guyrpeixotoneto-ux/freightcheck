/**
 * O eixo "o quê" do lado da tela: ler o tipo do endereço, e decidir o que a
 * página faz com ele.
 *
 * A barra de Parâmetros passou a ter quatro campos — **Canal/Segmento,
 * Vigência, Unidade, Tipo** — e os três primeiros já eram pergunta ao servidor.
 * O quarto não é: ele recorta a resposta que já está na tela. O que ele **não**
 * pode ser é uma opinião do cliente sobre o que existe: quem diz o que cada
 * vigência tem é `view.composicao`, apurada no banco (`tipos-da-vigencia.ts`).
 *
 * As três funções aqui são as três decisões que a página toma com esse campo, e
 * moram fora do componente para poderem ser testadas sem montar React — a mesma
 * disciplina de `escopos.ts` e `importacoes.ts`.
 */

import {
  ehFiltroDeTipo,
  TIPOS_DE_ANALISE,
  TODOS_OS_TIPOS,
  type DefinicaoDeTipoDeAnalise,
  type FiltroDeTipo,
} from "@workspace/comparison/tipos";
import { ehEscopo, type EscopoCode } from "@/lib/escopos";
import type {
  ComposicaoDaVigencia,
  FamiliesView,
  TipoNaVigencia,
} from "@/components/inicio/types";

/**
 * O tipo escolhido, lido do endereço. `null` é **Todos**.
 *
 * Aceita o nome antigo do parâmetro (`escopo`) porque a grade de atributos usa
 * esse recorte desde antes de ele subir para a barra: um link guardado com
 * `?escopo=CAVALO` não pode abrir em "todos" só porque o campo mudou de nome.
 * Um valor adulterado cai em Todos em vez de quebrar a tela — a mesma doutrina
 * de `ehEscopo` e `ehOrdem`.
 */
export function tipoDoEndereco(params: URLSearchParams): EscopoCode | null {
  const valor = params.get("tipo") ?? params.get("escopo");
  return ehEscopo(valor) ? valor : null;
}

/** O valor que a barra mostra: `SEM_ESCOPO` é recorte da grade, não tipo do domínio. */
export function valorDoSeletor(escopo: EscopoCode | null): FiltroDeTipo {
  return ehFiltroDeTipo(escopo) ? escopo : TODOS_OS_TIPOS;
}

/**
 * O tipo escolhido que **não existe** na vigência aberta.
 *
 * `null` cobre os dois casos em que a página segue normal: nenhum tipo escolhido
 * (Todos), e um tipo que está lá. Quando ele não está, a página troca a grade
 * inteira por uma frase — porque os cartões, ali, contariam zero alteração de
 * uma coisa que não chegou, e "zero" e "não veio" pedem ações opostas. Foi
 * exatamente essa confusão que fez uma vigência só de trechos parecer uma
 * unidade sem frota.
 *
 * Uma resposta sem `composicao` devolve `null`: sem a apuração do servidor a
 * página não tem como afirmar ausência, e afirmar assim mesmo seria repetir o
 * erro pelo outro lado.
 */
export function tipoAusenteNaVigencia(
  view: FamiliesView | null,
  escopo: EscopoCode | null,
): TipoNaVigencia | null {
  if (!view || escopo === null) return null;
  return view.composicao?.tipos.find((t) => t.code === escopo && !t.presente) ?? null;
}

/**
 * Os tipos que a barra oferece como análise — os seis do catálogo, sem Trecho.
 *
 * Trecho continua correto no banco e continua lido junto com o equipamento
 * pela remuneração (`@workspace/remuneracao/leitura`); ele só deixa de ser uma
 * opção de análise **nesta tela**. A vigência que só tem trecho, além disso,
 * não navega mais até aqui — ela para de contar como vigência em
 * `listContexts`/`listPeriods` (`@workspace/comparison/series`,
 * `@workspace/comparison/consolidated`), pela mesma razão dita lá: trecho
 * sozinho é uma casca, não uma entrega própria. As duas coisas são
 * independentes por design — um dia em que Trecho voltar a ser uma pergunta
 * desta tela, é aqui que ele reaparece, sem mexer na navegação.
 */
export const TIPOS_NA_BARRA: DefinicaoDeTipoDeAnalise[] = TIPOS_DE_ANALISE.filter(
  (t) => t.code !== "TRECHO",
);

/**
 * A composição, sem a linha de Trecho — só para a barra e a faixa desta tela.
 *
 * Filtrar a resposta do servidor em vez de escrever uma segunda apuração é o
 * que impede as duas contagens — a do banco e a desta tela — de discordarem em
 * qualquer coisa além da presença do trecho. `vazia` é recalculada sobre o
 * conjunto filtrado: uma vigência cujo único tipo fosse trecho ficaria "vazia"
 * aqui mesmo que `composicao.vazia` do servidor dissesse que não.
 */
export function semTrechoNaBarra(
  composicao: ComposicaoDaVigencia | null | undefined,
): ComposicaoDaVigencia | null {
  if (!composicao) return null;
  const tipos = composicao.tipos.filter((t) => t.code !== "TRECHO");
  const presentes = tipos.filter((t) => t.presente);
  return { tipos, presentes, vazia: presentes.length === 0 };
}
