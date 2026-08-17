/**
 * O escopo de frota — a língua das telas Cavalo 360°, Carreta 360° e Trecho 360°.
 *
 * As três fazem as mesmas quatro perguntas de Alterações sobre uma população
 * menor: os cavalos, as carretas, os trechos, ou um só deles. Este arquivo é o
 * vocabulário disso do lado da tela, e o par de `lib/comparison/src/escopo.ts`
 * do lado do servidor — os dois carregam a mesma distinção, que é a que mantém
 * estas telas honestas:
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
 *   o assunto da tela, e quem quiser sair dele troca de tela ou limpa o ativo
 *   no seletor do cabeçalho, que é onde ele mora;
 * - o tipo **não** é escolhível dentro da tela. Cavalo 360° é do cavalo por
 *   definição — o menu tem uma entrada para cada —, e um seletor de tipo aqui
 *   dentro faria a mesma pergunta que o menu já respondeu, com o risco de as
 *   duas respostas discordarem.
 *
 * Nada aqui lê a rede nem o React: strings entrando e strings saindo, o que
 * deixa a regra testável sem montar tela nenhuma — a mesma escolha de
 * `recorte.ts`.
 */

import { paramsDoRecorte, type Recorte } from "@/lib/recorte";

// ---------------------------------------------------------------------------
// O assunto da tela
// ---------------------------------------------------------------------------

/**
 * Os tipos que têm tela 360°.
 *
 * A lista é explícita, e não `string`, porque cada um tem uma rota própria no
 * menu: um quarto tipo vindo do Freightech aparece nas outras telas sozinho —
 * `entity.entity_type` é texto livre no banco de propósito —, mas ganhar uma
 * tela 360° é uma decisão de produto, com entrada de menu e nome, e não algo
 * que deva acontecer porque um arquivo mudou.
 *
 * **`TRECHO` não é equipamento, e está aqui de propósito.** Cavalo e carreta
 * são metal; o trecho é a perna da rota — origem, destino, quilometragem — e é
 * por ele que passa o lado *variável* da remuneração, o que o cadastro do
 * Freightech chama de Trecho e a classificação do time chama de VARIÁVEL
 * (`trechoEmpurrada`, `kmIda`, `kmVolta`, pedágio, tempo interno de origem e
 * destino). O que o põe nesta lista não é a natureza dele: são as quatro
 * perguntas. "O que a planilha mexeu", "o que pedimos por chamado", "quanto
 * custou em cada quinzena" e "o que propor ao cliente" são as mesmas quatro
 * sobre um trecho, e uma segunda tela para fazê-las de novo garantiria apenas
 * que um dia elas fossem respondidas de dois jeitos.
 */
export type Equipamento = "CAVALO" | "CARRETA" | "TRECHO";

export const EQUIPAMENTOS: Equipamento[] = ["CAVALO", "CARRETA", "TRECHO"];

export const equipamentoValido = (valor: string | null): valor is Equipamento =>
  valor !== null && (EQUIPAMENTOS as string[]).includes(valor);

/** O vocabulário de um tipo — o que a tela precisa para escrever as frases. */
export interface PalavrasDoTipo {
  titulo: string;
  singular: string;
  plural: string;
  /** `ele` | `ela` */
  pronome: string;
  /** `este` | `esta` */
  este: string;
  /** `o` | `a` — o artigo, para "d**o**s cavalos" e "d**a**s carretas". */
  artigo: string;
  /**
   * Como se chama, na tela, a chave do segundo nível.
   *
   * O cavalo e a carreta se escolhem pela placa; o trecho, não — ele é uma
   * origem e um destino, e um campo rotulado "Placa" numa tela de trechos pede
   * um dado que não existe. O rótulo é do tipo; o parâmetro do endereço
   * continua sendo `?placa=` para os três, e a razão está em {@link lerPlaca}.
   */
  identificador: string;
  /** Onde se procura o ativo — o placeholder do campo de busca da grade. */
  buscaPor: string;
  /**
   * Como a remuneração deste tipo se mede, na frase da grade.
   *
   * Cavalo e carreta recebem um valor **por mês**: o custo fixo é do calendário,
   * e é isso que a Composição apura. O trecho é pago **por viagem** — é a perna
   * rodada que dispara o pagamento, não o mês que passou. Escrever "quanto ele
   * custa por mês" sobre uma grade de trechos seria dar periodicidade mensal a
   * um número que não a tem, que é o erro que
   * `change_set.calculated_impact_by_periodicity` existe para não repetir.
   */
  precoNaGrade: string;
  href: string;
}

/**
 * Como cada tipo se chama e onde mora a tela dele.
 *
 * `pronome`, `este` e `artigo` existem porque o português não deixa a frase ser
 * neutra: "cada carreta da operação: quanto **ele** custa" é o que sai de um
 * texto montado no masculino e reaproveitado. O gênero é dado do tipo, e mora
 * aqui junto com o nome — não numa condicional espalhada por cada frase. Cada
 * ternário `entityType === "CAVALO" ? … : …` numa tela é uma frase que fica
 * errada no dia em que existe um terceiro tipo, e o terceiro tipo é este.
 */
export const TELA_DO_EQUIPAMENTO: Record<Equipamento, PalavrasDoTipo> = {
  CAVALO: {
    titulo: "Cavalo 360°",
    singular: "cavalo",
    plural: "cavalos",
    pronome: "ele",
    este: "este",
    artigo: "o",
    identificador: "Placa",
    buscaPor: "Placa ou chassi",
    precoNaGrade: "quanto ele custa por mês",
    href: "/cavalo-360",
  },
  CARRETA: {
    titulo: "Carreta 360°",
    singular: "carreta",
    plural: "carretas",
    pronome: "ela",
    este: "esta",
    artigo: "a",
    identificador: "Placa",
    buscaPor: "Placa ou chassi",
    precoNaGrade: "quanto ela custa por mês",
    href: "/carreta-360",
  },
  TRECHO: {
    titulo: "Trecho 360°",
    singular: "trecho",
    plural: "trechos",
    pronome: "ele",
    este: "este",
    artigo: "o",
    identificador: "Trecho",
    // Sem chassi: um trecho não tem número de série. Oferecer o campo com o
    // nome do que ele não tem convida a procurar pelo que nunca vai achar.
    buscaPor: "Trecho",
    precoNaGrade: "quanto ele paga por viagem",
    href: "/trecho-360",
  },
};

/**
 * O vocabulário de um `entity_type` qualquer, inclusive um que não tem tela.
 *
 * As abas de Alterações recebem o tipo como texto livre — é o que a API
 * devolve, e o banco guarda `entity_type` sem enumeração de propósito. Elas
 * precisam escrever "nestes cavalos" e "nestas carretas" sem um ternário que
 * fique errado no dia em que chega um `DOLLY`, e o que sobra para o
 * desconhecido é o neutro: **ativo**, no masculino, que é a palavra que este
 * produto já usa quando não sabe de que ativo se fala.
 */
const NEUTRO: PalavrasDoTipo = {
  titulo: "Ativo",
  singular: "ativo",
  plural: "ativos",
  pronome: "ele",
  este: "este",
  artigo: "o",
  identificador: "Identificador",
  buscaPor: "Identificador",
  precoNaGrade: "quanto ele custa por mês",
  href: "/",
};

export function palavrasDoTipo(entityType: string | null): PalavrasDoTipo {
  if (entityType !== null && equipamentoValido(entityType)) {
    return TELA_DO_EQUIPAMENTO[entityType];
  }
  return NEUTRO;
}

/**
 * `CAVALO` → `Cavalos`. O plural em maiúscula, para os botões e as pílulas.
 *
 * Um tipo desconhecido volta **como veio**, e não como "Ativos": numa fileira
 * de pílulas que já tem Cavalos e Carretas, a terceira dizendo "Ativos" some
 * dentro das outras duas, enquanto `DOLLY` diz exatamente o que é. O neutro
 * serve à frase corrida, onde o tipo já foi nomeado antes; aqui o rótulo **é**
 * a única nomeação.
 */
export function pluralEmMaiuscula(entityType: string | null): string {
  if (entityType !== null && !equipamentoValido(entityType)) return entityType;
  const plural = palavrasDoTipo(entityType).plural;
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/*
  A concordância, e por que ela é código e não texto solto.

  `todos os ${plural}` estava escrito à mão no seletor, e sobre a carreta ele
  dizia "todos os carretas" — o mesmo defeito que fez `pronome` e `este`
  existirem, numa parte da frase em que ninguém tinha olhado. Um terceiro tipo
  não cria esse erro; ele só o torna impossível de continuar ignorando, porque
  passa a haver três frases erradas em vez de uma.
*/

/** `os cavalos` · `as carretas` · `os trechos`. */
export function pluralComArtigo(tipo: PalavrasDoTipo): string {
  return `${tipo.artigo}s ${tipo.plural}`;
}

/** `aos cavalos` · `às carretas` — a crase é o que um `a + os` genérico erra. */
export function aoPlural(tipo: PalavrasDoTipo): string {
  return tipo.artigo === "a" ? `às ${tipo.plural}` : `aos ${tipo.plural}`;
}

/** `todos os cavalos` · `todas as carretas` · `todos os trechos`. */
export function todosOsPlural(tipo: PalavrasDoTipo): string {
  return `tod${tipo.artigo}s ${pluralComArtigo(tipo)}`;
}

/**
 * As outras telas 360°, a um clique — na ordem em que o menu as lista.
 *
 * O conjunto é que é remunerado, e quem está conferindo um cavalo costuma
 * querer a carreta em seguida; quem confere os dois costuma querer saber o que
 * mudou no trecho que eles rodam. Era um ternário entre dois enquanto eram
 * dois, e um ternário é exatamente o que não sobrevive ao terceiro.
 */
export function outrasTelas(equipamento: Equipamento): Equipamento[] {
  return EQUIPAMENTOS.filter((outro) => outro !== equipamento);
}

// ---------------------------------------------------------------------------
// O escopo
// ---------------------------------------------------------------------------

/**
 * De que ativos a tela fala.
 *
 * `placa` como `string | null`, e o `null` quer dizer a população inteira
 * daquele tipo — não "nada escolhido". A tela abre na frota, e ela é uma
 * resposta, não a ausência de uma.
 */
export interface EscopoDeFrota {
  entityType: Equipamento;
  placa: string | null;
}

/**
 * O ativo que está escrito num endereço. Vazio não é ativo.
 *
 * **O campo continua se chamando `placa` para os três tipos, e isso é decisão,
 * não descuido.** Do lado de dentro ele nunca foi "a placa": é a *chave de
 * grão* da linha — a coluna que o `pipeline` promove a `entity_identifier` e
 * que a comparação denormaliza em `change.entity_label`, para qualquer tipo de
 * aba. Renomeá-lo aqui mudaria o parâmetro de consulta das quatro abas, o
 * `plate` de `lib/comparison/src/escopo.ts` e todo link já mandado por e-mail,
 * em troca de nada — o que precisa mudar de nome é o **rótulo**, e esse é
 * `PalavrasDoTipo.identificador`, escolhido por tipo.
 */
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
 * Em que nível a tela está — e cada um promete uma coisa diferente.
 *
 * `grade` é a frota como cards, um por ativo, e é a porta do módulo. `ativo` é
 * um cavalo. `frota` são as quatro leituras sobre todos eles, que é a pergunta
 * de quem confere o mês fechado e não a de quem chega.
 */
export type NivelDaTela = "grade" | "ativo" | "frota";

/**
 * Como a tela se apresenta em uma frase — o subtítulo do cabeçalho.
 *
 * Muda com o nível porque a promessa muda com ele: a grade mostra a situação de
 * cada ativo, a leitura de frota responde "o que mudou nos cavalos", e o ativo
 * responde "o que aconteceu com este cavalo". Dizer uma dessas frases mostrando
 * outra é o começo de toda leitura errada desta tela — e a mais cara é a do
 * meio, porque um número de frota lido como se fosse de um ativo é um número
 * que parece pequeno e vai para uma reunião.
 */
export function frasesDoEscopo(
  escopo: EscopoDeFrota,
  nivel: NivelDaTela = escopo.placa === null ? "grade" : "ativo",
): { titulo: string; subtitulo: string } {
  const tela = TELA_DO_EQUIPAMENTO[escopo.entityType];

  if (escopo.placa !== null || nivel === "ativo") {
    return {
      titulo: escopo.placa === null ? tela.titulo : `${tela.titulo} · ${escopo.placa}`,
      subtitulo:
        `Tudo o que a base sabe sobre ${tela.este} ${tela.singular}: o que a ` +
        `planilha mexeu, o que pedimos por chamado, e quanto ${tela.pronome} ` +
        `custou em cada quinzena.`,
    };
  }

  if (nivel === "frota") {
    return {
      titulo: `${tela.titulo} · todos`,
      subtitulo:
        `Tudo o que mudou para os ${tela.plural}, pelos quatro caminhos por ` +
        `onde a mudança chega. Os números de uma aba nunca somam com os da ` +
        `outra — volte aos cards para descer a um ativo só.`,
    };
  }

  return {
    titulo: tela.titulo,
    subtitulo:
      `A situação de cada ${tela.singular} da operação: ${tela.precoNaGrade}, ` +
      `o que mudou ${tela.pronome === "ele" ? "nele" : "nela"} na vigência e o ` +
      `que pedimos por chamado. Clique num card para ver a remuneração inteira ` +
      `d${tela.artigo} ${tela.singular}.`,
  };
}
