/**
 * O escopo de frota — a língua das telas Cavalo 360° e Carreta 360°.
 *
 * As duas fazem as mesmas quatro perguntas de Alterações sobre uma população
 * menor: os cavalos, as carretas, ou um ativo só. Este arquivo é o vocabulário
 * disso do lado da tela, e o par de `lib/comparison/src/escopo.ts` do lado do
 * servidor — os dois carregam a mesma distinção, que é a que mantém estas telas
 * honestas:
 *
 * **Escopo não é filtro.** O filtro estreita *a lista* dentro de uma população
 * anunciada — é o que o painel de filtros escreve, com o × que desfaz cada um.
 * O escopo troca *a população*, e por isso ele alcança também os cartões, os
 * painéis e os totais. Uma tela chamada "Cavalo 360°" com o cartão da frota
 * inteira em cima de uma lista de cavalos seria a mentira mais visível que este
 * produto pode contar, e é ela que a separação impede.
 *
 * Daí duas consequências que valem estar escritas:
 *
 * - o escopo **não** aparece no painel de filtros. Ele não é desfazível ali: é
 *   o assunto da tela, e quem quiser sair dele troca de tela ou limpa a placa
 *   no seletor do cabeçalho, que é onde ele mora;
 * - o equipamento **não** é escolhível dentro da tela. Cavalo 360° é do cavalo
 *   por definição — o menu tem uma entrada para cada —, e um seletor de
 *   equipamento aqui dentro faria a mesma pergunta que o menu já respondeu, com
 *   o risco de as duas respostas discordarem.
 *
 * Nada aqui lê a rede nem o React: strings entrando e strings saindo, o que
 * deixa a regra testável sem montar tela nenhuma — a mesma escolha de
 * `recorte.ts`.
 */

import { paramsDoRecorte, type Recorte } from "@/lib/recorte";

// ---------------------------------------------------------------------------
// O equipamento
// ---------------------------------------------------------------------------

/**
 * Os equipamentos que têm tela 360°.
 *
 * A lista é explícita, e não `string`, porque cada um tem uma rota própria no
 * menu: um terceiro tipo de equipamento vindo do Freightech aparece nas outras
 * telas sozinho — `entity.entity_type` é texto livre no banco de propósito —,
 * mas ganhar uma tela 360° é uma decisão de produto, com entrada de menu e
 * nome, e não algo que deva acontecer porque um arquivo mudou.
 */
export type Equipamento = "CAVALO" | "CARRETA";

export const EQUIPAMENTOS: Equipamento[] = ["CAVALO", "CARRETA"];

export const equipamentoValido = (valor: string | null): valor is Equipamento =>
  valor !== null && (EQUIPAMENTOS as string[]).includes(valor);

/** Como cada equipamento se chama e onde mora a tela dele. */
export const TELA_DO_EQUIPAMENTO: Record<
  Equipamento,
  { titulo: string; singular: string; plural: string; href: string }
> = {
  CAVALO: {
    titulo: "Cavalo 360°",
    singular: "cavalo",
    plural: "cavalos",
    href: "/cavalo-360",
  },
  CARRETA: {
    titulo: "Carreta 360°",
    singular: "carreta",
    plural: "carretas",
    href: "/carreta-360",
  },
};

// ---------------------------------------------------------------------------
// O escopo
// ---------------------------------------------------------------------------

/**
 * De que ativos a tela fala.
 *
 * `placa` como `string | null`, e o `null` quer dizer a frota daquele
 * equipamento — não "nada escolhido". A tela abre na frota, e ela é uma
 * resposta, não a ausência de uma.
 */
export interface EscopoDeFrota {
  entityType: Equipamento;
  placa: string | null;
}

/** A placa que está escrita num endereço. Vazia não é placa. */
export function lerPlaca(search: string | URLSearchParams): string | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("placa") || null;
}

/**
 * O escopo como a API o recebe.
 *
 * `escopo=1` acompanha os parâmetros nas rotas de Alterações, e não é ruído: lá
 * `entityType` **já era** filtro de linha — a Visão geral manda esse parâmetro
 * desde que existe —, e o mesmo nome passa a querer dizer duas coisas. A chave
 * é o que separa "recorte a lista por cavalo" de "esta tela inteira é do
 * cavalo, recontem tudo". Sem ela, um link antigo da Visão geral mudaria de
 * significado no dia em que estas telas nascessem.
 */
export function paramsDoEscopo(escopo: EscopoDeFrota): URLSearchParams {
  const params = new URLSearchParams();
  params.set("escopo", "1");
  params.set("entityType", escopo.entityType);
  if (escopo.placa !== null) params.set("placa", escopo.placa);
  return params;
}

/**
 * O escopo e o recorte na mesma consulta.
 *
 * As telas 360° herdam o recorte de unidade e canal como as Alterações o herdam
 * — é a mesma base, e trocar de unidade não pode deixar de valer só porque a
 * pergunta agora é por equipamento. `comPeriodo` segue a regra de lá: só a
 * Planilha responde por uma vigência; Impacto e Cliente leem a série inteira.
 */
export function paramsDaTela(
  escopo: EscopoDeFrota,
  recorte: Recorte,
  { comPeriodo = true }: { comPeriodo?: boolean } = {},
): URLSearchParams {
  const params = paramsDoEscopo(escopo);
  for (const [chave, valor] of paramsDoRecorte(recorte, { comPeriodo })) {
    params.set(chave, valor);
  }
  return params;
}

/**
 * O endereço de uma tela 360°, com a placa quando há uma.
 *
 * A placa viaja no endereço — ao contrário do De/Até, que fica em estado — pela
 * mesma razão que a aba viaja em Alterações: ela **é** o assunto. "Manda o link
 * do QYW2D78" precisa abrir no QYW2D78, e o botão de voltar precisa significar
 * "a placa anterior" para quem estava comparando duas.
 */
export function linkDaFrota(
  entityType: Equipamento,
  { placa = null, aba = null }: { placa?: string | null; aba?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (aba !== null && aba !== "planilha") params.set("aba", aba);
  if (placa !== null) params.set("placa", placa);
  const consulta = params.toString();
  const href = TELA_DO_EQUIPAMENTO[entityType].href;
  return consulta ? `${href}?${consulta}` : href;
}

/**
 * Como a tela se apresenta em uma frase — o subtítulo do cabeçalho.
 *
 * Muda com a placa porque a promessa muda com ela: na frota, a tela responde
 * "tudo o que mudou nos cavalos"; num ativo, "tudo o que aconteceu com este
 * cavalo". Dizer a primeira frase mostrando a segunda é o começo de toda
 * leitura errada desta tela.
 */
export function frasesDoEscopo(escopo: EscopoDeFrota): {
  titulo: string;
  subtitulo: string;
} {
  const tela = TELA_DO_EQUIPAMENTO[escopo.entityType];
  if (escopo.placa === null) {
    return {
      titulo: tela.titulo,
      subtitulo:
        `Tudo o que mudou para os ${tela.plural}, pelos quatro caminhos por ` +
        `onde a mudança chega. Os números de uma aba nunca somam com os da ` +
        `outra — escolha uma placa para descer a um ativo só.`,
    };
  }
  return {
    titulo: `${tela.titulo} · ${escopo.placa}`,
    subtitulo:
      `Tudo o que a base sabe sobre este ${tela.singular}: o que a planilha ` +
      `mexeu, o que pedimos por chamado, e quanto ele custou em cada quinzena.`,
  };
}
