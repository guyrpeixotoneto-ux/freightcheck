/**
 * O escopo de frota — a língua das telas 360°.
 *
 * Elas fazem as mesmas quatro perguntas de Alterações sobre uma população
 * menor: os cavalos, as carretas, os trechos — ou os caminhões, as carrocerias
 * e as empilhadeiras, conforme a operação que a auditoria aberta audita —, ou um
 * só deles. Este arquivo é o
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

import { tipoDeImportacao } from "@workspace/ingest/tipos";

import { ehAuditoria, type Ambiente, type AmbienteDeAuditoria } from "@/lib/ambiente";
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
 *
 * **Esta é a lista das telas 360°, e só dela.** Ela não é a lista do que o
 * produto importa: essa é `TIPOS_DE_IMPORTACAO`, em `@workspace/ingest/tipos`,
 * e tem cinco — os três daqui mais `QLP_ADMINISTRATIVO` e `QLP_OPERACIONAL`.
 * As duas respondem perguntas diferentes: aqui é "que tipos têm tela própria
 * no menu", lá é "que tipos entram por importação". A Curadoria fala do que
 * foi importado, e por isso as abas dela saem de lá — o quadro de pessoal tem
 * coluna para curar como o cavalo tem, sem ter tela 360° nenhuma. O que ela
 * acrescenta continua sendo dela: a ordem das abas, a contagem por fila, e a
 * decisão de mostrar a aba vazia em vez de escondê-la.
 *
 * **A lista cresceu com as auditorias, e não com o produto.** Cavalo, carreta e
 * trecho são o que a **empurrada** rodava; a rota e o AS rodam com caminhão e
 * carroceria, e o apoio, com empilhadeira. São nomes de operação, não sinônimos:
 * quem confere o AS procura "Caminhão" no menu e não reconhece "Cavalo" como a
 * mesma coisa. Qual dos seis cada ambiente mostra é
 * {@link EQUIPAMENTOS_DO_AMBIENTE}, logo abaixo — esta lista é o conjunto de
 * todos, que é o que `equipamentoValido` precisa saber para aceitar um endereço.
 */
export type Equipamento =
  | "CAVALO"
  | "CARRETA"
  | "TRECHO"
  | "CAMINHAO"
  | "CARROCERIA"
  | "EMPILHADEIRA";

export const EQUIPAMENTOS: Equipamento[] = [
  "CAVALO",
  "CARRETA",
  "TRECHO",
  "CAMINHAO",
  "CARROCERIA",
  "EMPILHADEIRA",
];

export const equipamentoValido = (valor: string | null): valor is Equipamento =>
  valor !== null && (EQUIPAMENTOS as string[]).includes(valor);

/**
 * Que ativos cada auditoria mostra — o vocabulário da operação, num lugar só.
 *
 * As quatro auditorias são o mesmo processo sobre operações diferentes
 * (`lib/ambiente.ts`), e o que as separa na lateral é isto: a **empurrada** roda
 * com cavalo, carreta e trecho; a **rota** e o **AS** rodam com caminhão e
 * carroceria; o **apoio** roda com empilhadeira, que não puxa nada — por isso a
 * lista dele tem um item só.
 *
 * **O trecho é da empurrada.** Ele é o lado variável da remuneração — a perna
 * de rota, com origem, destino e quilometragem —, e quem o traz é o export da
 * empurrada: é lá que ele é importado, e é só lá que ele tem população. Um
 * "Trecho 360°" no menu da Rota ou do AS seria uma tela que nunca terá linha, e
 * o mesmo vale para o **Radar de Trechos**, que é a camada gerencial acima
 * dela. Este mapa e `TIPOS_DO_AMBIENTE` (`lib/importacoes.ts`) respondem
 * perguntas diferentes — "que ativos a operação mostra" e "que arquivos ela
 * recebe" —, e sobre o trecho eles precisam concordar: uma tela de um tipo que
 * o ambiente não importa é uma promessa que a importação não pode cumprir.
 *
 * **Não é tradução.** "Caminhão" não é como o Rota chama o cavalo: é outro
 * ativo, com outro `entity_type`, e as telas de lá pedem à API justamente esse
 * tipo. Os três entraram em `TIPOS_DE_IMPORTACAO` (`@workspace/ingest/tipos`)
 * para que a importação possa **receber** o export de cada operação — foi uma
 * decisão explícita, e aditiva: `entity_type` é texto livre no banco, então não
 * houve migration, e nada do que já entrava mudou.
 *
 * Enquanto o export de uma operação não trouxer o ativo dela, a tela 360°
 * correspondente diz que aquele tipo não existe neste contexto — que é o que
 * `pages/frota-360.tsx` já faz, e é a resposta honesta: melhor uma tela que diz
 * "não há caminhão importado" do que uma que mostra cavalos com o rótulo
 * trocado.
 *
 * O mapa vive aqui, e não em `lib/ambiente.ts`, porque é vocabulário de frota —
 * e é daqui que o menu (`components/layout/nav-auditoria.ts`), as abas do Plano
 * de Ação e o rodapé de "ver as outras telas" o leem, para que os três nunca
 * discordem sobre o que a operação tem.
 */
export const EQUIPAMENTOS_DO_AMBIENTE: Record<AmbienteDeAuditoria, Equipamento[]> = {
  auditoria: ["CAVALO", "CARRETA", "TRECHO"],
  "auditoria-rota": ["CAMINHAO", "CARROCERIA"],
  "auditoria-as": ["CAMINHAO", "CARROCERIA"],
  /*
    O apoio não tem carreta nem trecho: a empilhadeira trabalha dentro do pátio,
    não puxa implemento e não roda perna de rota.
  */
  "auditoria-apoio": ["EMPILHADEIRA"],
};

/** Os ativos da auditoria aberta — o atalho de quem já tem o ambiente. */
export function equipamentosDoAmbiente(ambiente: Ambiente): Equipamento[] {
  return ehAuditoria(ambiente)
    ? EQUIPAMENTOS_DO_AMBIENTE[ambiente]
    : EQUIPAMENTOS_DO_AMBIENTE.auditoria;
}

/** Se a auditoria aberta trabalha com trecho — o que só a empurrada faz. */
export function temTrecho(ambiente: Ambiente): boolean {
  return equipamentosDoAmbiente(ambiente).includes("TRECHO");
}

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
   * `change_set.impacto_oficial_by_periodicity` existe para não repetir.
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
  CAMINHAO: {
    /*
      O acento vive no texto, e nunca na chave nem no endereço: `CAMINHAO` é o
      `entity_type` como o banco o guarda, `/caminhao-360` é o endereço, e
      "Caminhão" é o que a pessoa lê. Misturar os três é o jeito mais fácil de
      um link colado num e-mail deixar de abrir.
    */
    titulo: "Caminhão 360°",
    singular: "caminhão",
    plural: "caminhões",
    pronome: "ele",
    este: "este",
    artigo: "o",
    identificador: "Placa",
    buscaPor: "Placa ou chassi",
    precoNaGrade: "quanto ele custa por mês",
    href: "/caminhao-360",
  },
  CARROCERIA: {
    titulo: "Carroceria 360°",
    singular: "carroceria",
    plural: "carrocerias",
    pronome: "ela",
    este: "esta",
    artigo: "a",
    identificador: "Placa",
    buscaPor: "Placa ou chassi",
    precoNaGrade: "quanto ela custa por mês",
    href: "/carroceria-360",
  },
  EMPILHADEIRA: {
    titulo: "Empilhadeira 360°",
    singular: "empilhadeira",
    plural: "empilhadeiras",
    pronome: "ela",
    este: "esta",
    artigo: "a",
    /*
      A empilhadeira não tem placa: ela é identificada pelo número de série ou
      pelo patrimônio. Pedir "Placa" numa tela de apoio é pedir um dado que a
      operação não tem — a mesma razão de o trecho não pedir chassi.
    */
    identificador: "Identificador",
    buscaPor: "Identificador ou chassi",
    precoNaGrade: "quanto ela custa por mês",
    href: "/empilhadeira-360",
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

/*
  Os rótulos — e a regra que os três compartilham.

  Três perguntas em cadeia, nesta ordem, e cada degrau existe porque o de baixo
  erraria o caso do de cima:

  1. **É um dos três tipos com tela 360°?** Então o nome sai de
     `TELA_DO_EQUIPAMENTO`, que é onde o produto guarda como fala deles;
  2. **É um tipo que a importação conhece?** Então o nome sai de
     `TIPOS_DE_IMPORTACAO` — `QLP_ADMINISTRATIVO` vira `QLP Administrativo`,
     que é como a aba de Importações já o escreve. Uma aba de curadoria dizendo
     `QLP_ADMINISTRATIVO` em caixa alta é o nome do banco vazando para a tela,
     e ele grita ao lado de `Cavalo` e `Carreta`;
  3. **Nenhum dos dois?** Então **volta como veio**, e não como "Ativo": numa
     fileira de abas que já tem Cavalo e Carreta, a terceira dizendo "Ativo"
     some dentro das outras duas, enquanto `FROTA_PROPRIA` diz exatamente o que
     é — e é o nome que a pessoa vai reconhecer da aba da planilha que
     importou. Inventar capitalização para o desconhecido erraria em toda
     sigla, que é justamente o que o degrau 2 evita no caso conhecido.

  O neutro de `palavrasDoTipo` serve à frase corrida, onde o tipo já foi nomeado
  antes; aqui o rótulo **é** a única nomeação, e por isso a regra é outra.
*/
const emMaiuscula = (palavra: string): string =>
  palavra.charAt(0).toUpperCase() + palavra.slice(1);

/** O nome escrito pela importação, quando ela conhece o tipo. */
const rotuloImportado = (entityType: string): string | null =>
  tipoDeImportacao(entityType)?.rotulo ?? null;

/**
 * `CAVALO` → `Cavalo`, `QLP_ADMINISTRATIVO` → `QLP Administrativo`. O nome do
 * tipo no singular, para títulos e abas.
 *
 * É o rótulo que a Curadoria põe nas abas da fila e no título da tela. Ele mora
 * aqui, e não lá, porque é o mesmo nome que estas telas usam: duas listas dos
 * mesmos tipos concordam no dia em que são escritas e discordam no dia do
 * seguinte.
 */
/**
 * "dos cavalos", "das carretas" — a preposição contraída com o artigo do tipo.
 *
 * Mora aqui, e não na tela, pelo mesmo motivo de {@link palavrasDoTipo}: é
 * vocabulário de frota, e uma tela que escrevesse "dos carretas" só seria
 * corrigida na tela em que alguém reparasse. `de` cobre "dos/das", `em` cobre
 * "nos/nas" — as duas que as frases do produto pedem.
 */
export function contracaoDoTipo(entityType: string | null, preposicao: "de" | "em"): string {
  const feminino = palavrasDoTipo(entityType).artigo === "a";
  if (preposicao === "de") return feminino ? "das" : "dos";
  return feminino ? "nas" : "nos";
}

export function rotuloDoTipo(entityType: string | null): string {
  if (entityType !== null && !equipamentoValido(entityType)) {
    return rotuloImportado(entityType) ?? entityType;
  }
  return emMaiuscula(palavrasDoTipo(entityType).singular);
}

/**
 * `CAVALO` → `Cavalos`. O plural em maiúscula, para os botões e as pílulas.
 *
 * O tipo importado que não é equipamento sai no singular de propósito: "QLP
 * Administrativo" é um quadro de lotação, não uma contagem de peças, e
 * "QLP Administrativos" seria inventar um plural que ninguém fala. O que
 * importa aqui é a pílula dizer o nome certo, e não a flexão.
 */
export function pluralEmMaiuscula(entityType: string | null): string {
  if (entityType !== null && !equipamentoValido(entityType)) {
    return rotuloImportado(entityType) ?? entityType;
  }
  return emMaiuscula(palavrasDoTipo(entityType).plural);
}

/**
 * O nome do tipo **dentro** de uma frase: "modelo de cavalo", "modelo de QLP
 * Administrativo".
 *
 * `rotuloDoTipo(...).toLowerCase()` era o que estava escrito na chamada, e ele
 * é certo para as três palavras comuns e errado para toda sigla — "modelo de
 * qlp administrativo" é o mesmo defeito da caixa alta, do outro lado. Só o que
 * é palavra comum desce de caixa; o resto entra na frase como se escreve.
 */
export function rotuloEmFrase(entityType: string | null): string {
  const rotulo = rotuloDoTipo(entityType);
  return equipamentoValido(entityType) ? rotulo.toLowerCase() : rotulo;
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
export function outrasTelas(
  equipamento: Equipamento,
  /*
    As outras telas **do mesmo ambiente**, e não as outras cinco: oferecer
    "ver carretas" dentro da Auditoria Apoio levaria a uma tela que o menu de lá
    não lista — e que fala de um ativo que aquela operação não tem. O padrão é a
    lista da Empurrada, que é o ambiente em que estas telas nasceram.
  */
  disponiveis: readonly Equipamento[] = EQUIPAMENTOS_DO_AMBIENTE.auditoria,
): Equipamento[] {
  return disponiveis.filter((outro) => outro !== equipamento);
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
