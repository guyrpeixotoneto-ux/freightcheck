import type { RecorteDeTipo } from "@/components/comparacao/recorte-de-equipamento";

/**
 * OS DOIS MODOS DE UMA AUDITORIA DE CUSTO FIXO — e o ano como atalho.
 *
 * ---------------------------------------------------------------------------
 * De onde isto veio
 * ---------------------------------------------------------------------------
 * Nasceu em `lib/finame.ts`, quando a Auditoria de FINAME ganhou a aba
 * Evolução. Nada aqui é de financiamento: são modos, anos e endereços, e as
 * outras três rubricas de custo fixo — IPVA, Lucro Fixo e Impostos — precisavam
 * das mesmas quatro funções exatamente como a primeira as usa. O `lib/finame.ts`
 * continua exportando os mesmos nomes, já amarrados à rota dele, e quem
 * importava de lá não mudou uma linha.
 *
 * ---------------------------------------------------------------------------
 * Por que é um modo, e não uma segunda rota
 * ---------------------------------------------------------------------------
 * Porque a unidade, o canal, o `scopeHash`, o par de vigências e o recorte de
 * equipamento são da **tela**, e não de um dos dois modos. Numa rota separada,
 * cada ida e volta os perderia — e quem entrasse na Evolução vindo de Carreta em
 * julho→agosto voltaria para Cavalo + Carreta no par padrão, sem ter pedido
 * nenhuma das duas coisas.
 *
 * Com uma rota só e `?modo=`, não há nada a preservar: o endereço inteiro
 * continua ali, e o modo é mais uma chave dentro dele.
 */
export type ModoDaAuditoria = "comparacao" | "evolucao";

/**
 * O modo que veio do endereço — e a recusa de adivinhar.
 *
 * Endereço adulterado cai na comparação, que é a tela que sempre existiu. Mesma
 * doutrina de `ehTipoDaLinhaDoTempo`: nunca uma tela em branco, que quem lê
 * confundiria com "não há nada aqui".
 */
export function ehModoDaAuditoria(
  valor: string | null | undefined,
): valor is ModoDaAuditoria {
  return valor === "comparacao" || valor === "evolucao";
}

/**
 * O recorte de equipamento **da evolução** — chave própria, padrão próprio.
 *
 * Ele não herda o recorte da comparação de propósito. São duas perguntas
 * diferentes feitas em dois momentos diferentes, e herdar faria a Evolução abrir
 * em Carreta só porque a comparação estava em Carreta — sem que o seletor de
 * dentro tivesse sido tocado. A evolução abre em Cavalo + Carreta, que é o
 * acervo inteiro; quem quiser um lado, pede.
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
 * uma alteração **de** 2026: a coluna de janeiro sumiria do ano a que ela
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
export function trocarNoEndereco(
  rota: string,
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
  return texto ? `${rota}?${texto}` : rota;
}

/** A mesma troca, já amarrada à rota de uma auditoria. */
export function trocaNaRota(rota: string) {
  return (atual: string | URLSearchParams, mudancas: Record<string, string | null>) =>
    trocarNoEndereco(rota, atual, mudancas);
}
