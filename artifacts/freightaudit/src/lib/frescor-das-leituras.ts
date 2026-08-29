import { keepPreviousData } from "@tanstack/react-query";

/**
 * Quanto tempo uma leitura da Auditoria continua valendo — e por que este
 * arquivo existe em vez de um número solto em cada tela.
 *
 * O padrão do React Query é `staleTime: 0`: **toda montagem refaz a chamada**.
 * Medido em `docs/AUDITORIA-ZERO-LOADING.md` (§7, causa 3), isso custava, por
 * revisita, uma requisição e uma varredura inteira do banco — 128.717 linhas
 * para voltar ao Painel de Unidades, 240.480 para voltar ao Acompanhamento —
 * sobre um conteúdo que não tinha mudado.
 *
 * ---------------------------------------------------------------------------
 * A classificação, e por que ela tem uma classe só
 * ---------------------------------------------------------------------------
 *
 * Um `staleTime` não é uma preferência de performance: é uma afirmação sobre
 * **com que frequência o dado muda**. Escrever um valor global sobre leituras
 * de naturezas diferentes seria afirmar a mesma coisa sobre dados diferentes,
 * e uma delas estaria errada.
 *
 * As leituras que esta constante governa são todas de uma natureza só:
 *
 * > **Apuração fechada.** A comparação entre duas vigências já importadas. Ela
 * > não muda com o tempo — muda quando *alguém faz alguma coisa*: uma
 * > importação nova, uma importação excluída, uma importação ocultada, ou uma
 * > semântica confirmada na Curadoria.
 *
 * Nenhum desses quatro é um evento do relógio, e é por isso que os quatro
 * **invalidam a chave** em vez de esperar o `staleTime` expirar:
 *
 * | Evento | Onde | O que invalida |
 * |---|---|---|
 * | Importação promovida | `pages/importacoes.tsx` | `invalidateQueries()` — tudo |
 * | Importação excluída | `pages/importacoes.tsx` | `invalidateQueries()` — tudo |
 * | Importação ocultada/reexibida | `pages/importacoes.tsx` | `invalidateQueries()` — tudo |
 * | Versão restaurada | `pages/versoes.tsx` | `invalidateQueries()` — tudo |
 * | Semântica confirmada | `pages/curadoria.tsx`, `pages/categorias.tsx` | `invalidarApuracao` (abaixo) |
 *
 * **O minuto não é o prazo de validade do dado — é o teto do atraso de quem
 * não fez a mudança.** Quem importa, oculta ou cura vê o efeito na hora, pela
 * invalidação. Quem está noutra aba, ou é outra pessoa, vê em até um minuto.
 * Foi por isso que o valor não subiu para cinco: uma auditoria é feita a duas
 * mãos — quem importa e quem confere raramente são a mesma pessoa —, e um
 * minuto é o maior atraso que ainda é invisível numa conversa.
 *
 * O minuto também não é novo: é o mesmo que `pages/linha-do-tempo.tsx`,
 * `pages/inicio.tsx` e `lib/families-overview.ts` já declaravam, pelo mesmo
 * motivo e com a mesma frase ("uma importação nova invalida a chave, não o
 * relógio"). Este arquivo não introduz uma política — dá nome à que já existia
 * em 17 lugares e a estende às leituras que tinham ficado de fora.
 *
 * ---------------------------------------------------------------------------
 * O que deliberadamente NÃO entrou
 * ---------------------------------------------------------------------------
 *
 * - **`/contexts`, `/imports`, `/change-sets`, `/curation/summary`** — já
 *   declaram o próprio `staleTime` (30–60 s) na casca. Não são apuração: são o
 *   acervo, e quem os lê é o menu.
 * - **`/balance`** (`pages/inicio.tsx`) — já declara 60 s. Não foi tocado.
 * - **`/dre/*`, `/frota/*`, `/coverage`** — são apuração fechada pela mesma
 *   régua e ganhariam com a mesma constante, mas estão fora do recorte desta
 *   rodada (Fase 1 da auditoria) e mudar o que não foi medido não é economia,
 *   é aposta.
 * - **Sondagens** (`refetchInterval` da Gestão à Vista, do cartão de importação
 *   e da aba de Chamados) — `refetchInterval` é independente de `staleTime` e
 *   continua disparando no relógio dele. Nada aqui as alcança.
 */
export const APURACAO_FECHADA = 60_000;

/**
 * O que fica em tela **enquanto** a leitura nova não chega.
 *
 * `placeholderData: keepPreviousData` é a diferença entre "a tela troca de
 * recorte" e "a tela pisca". Sem ele, mudar de unidade ou de competência muda a
 * `queryKey`, e uma chave sem cache tem `data === undefined` — o React Query
 * entra em `pending`, a tela cai no ramo do loader e **o conteúdo anterior é
 * apagado**. Medido: o conteúdo some 16 ms depois do clique e volta 147–212 ms
 * depois (`docs/AUDITORIA-ZERO-LOADING.md`, §7, causa 2).
 *
 * Com ele, a leitura anterior continua em tela, `status` vira `success` e
 * `isPlaceholderData` fica `true` — e é esse sinalizador, não um `isFetching`
 * genérico, que diz "o que você está vendo ainda é o recorte anterior".
 *
 * ---------------------------------------------------------------------------
 * As duas coisas que ele **não** faz, e que são o que o torna seguro
 * ---------------------------------------------------------------------------
 *
 * 1. **Não atravessa chaves de escopos diferentes como resultado.** O
 *    placeholder é sempre da chave anterior *do mesmo observador*, nunca de
 *    outra tela, e some no instante em que a resposta da chave nova chega. O
 *    resultado final de uma unidade nunca é o dado de outra: a `queryKey`
 *    carrega `scopeHash`, `canal` e `period`, e é ela a identidade da consulta.
 * 2. **Não sobrevive ao erro.** O placeholder só vale com status `pending`;
 *    quando a chamada falha, o status vira `error` e `data` volta a
 *    `undefined` na chave nova. Dado velho nunca é apresentado como se fosse a
 *    resposta atual de um pedido que falhou — o comportamento está provado em
 *    `__tests__/frescor-das-leituras.test.tsx`.
 *
 * A contrapartida — e é uma de verdade — é que, durante esses 150–200 ms, a
 * lateral já nomeia a unidade nova enquanto o corpo ainda mostra a anterior.
 * É por isso que quem usa esta constante **precisa** mostrar
 * `<EmAtualizacao>` (`components/ui/em-atualizacao.tsx`) enquanto
 * `isPlaceholderData` for verdadeiro. Manter o conteúdo sem dizer que ele é o
 * anterior seria trocar uma tela em branco por uma afirmação falsa, e a
 * segunda é pior.
 */
export const MANTER_ENQUANTO_CARREGA = keepPreviousData;

/**
 * As opções de uma leitura de apuração fechada, juntas.
 *
 * As duas só cumprem a promessa em conjunto: `staleTime` sem
 * `placeholderData` deixa a revisita instantânea e a **troca** de recorte
 * piscando; `placeholderData` sem `staleTime` cobre a troca e continua
 * refazendo a chamada inteira a cada volta. Sair de um lugar só é o que impede
 * uma tela de receber metade.
 */
export const LEITURA_DE_APURACAO = {
  staleTime: APURACAO_FECHADA,
  placeholderData: MANTER_ENQUANTO_CARREGA,
} as const;

/**
 * As chaves que uma mudança de semântica invalida.
 *
 * Confirmar um significado na Curadoria muda a periodicidade e a
 * monetizabilidade de um atributo — ou seja, muda **o impacto apurado**, que é
 * o número que o Dashboard, o Resumo executivo, o Acompanhamento, a Composição
 * e os Parâmetros mostram. Até esta rodada as mutações da Curadoria
 * invalidavam só `["curation"]`, e o resto se corrigia por acidente: com
 * `staleTime: 0`, a próxima montagem de cada tela refazia a chamada de
 * qualquer jeito.
 *
 * Com `APURACAO_FECHADA` esse acidente deixa de acontecer, e a invalidação que
 * era desnecessária passa a ser obrigatória. É a contrapartida explícita do
 * cache: **nenhum `staleTime` entra sem a invalidação que o sustenta.**
 *
 * A lista é de prefixos de chave, e o React Query casa por prefixo — 
 * `["families"]` alcança `["families", "dashboard", …]`, `["families",
 * "overview", …]` e `["families", "visao-geral", …]` de uma vez.
 */
export const CHAVES_DA_APURACAO = [
  ["families"],
  ["grouped"],
  ["composition"],
  ["changes-range"],
  ["linha-do-tempo-overview"],
  ["gerencial"],
] as const;

/** Invalida tudo o que uma mudança de apuração torna obsoleto. */
export async function invalidarApuracao(cliente: {
  invalidateQueries: (filtros: { queryKey: readonly unknown[] }) => Promise<void>;
}): Promise<void> {
  await Promise.all(
    CHAVES_DA_APURACAO.map((queryKey) => cliente.invalidateQueries({ queryKey })),
  );
}
