/**
 * O que esta pergunta quer saber — antes de procurar onde.
 *
 * Este módulo é a correção do defeito estrutural do assistente anterior. Lá, o
 * pipeline perguntava *"que palavras a frase contém?"* e decidia onde buscar a
 * partir disso; nenhuma lista de substrings distingue "como funciona o IPVA" de
 * "quanto mudou o IPVA", e as duas caíam no mesmo lugar — o resumo da vigência
 * mais recente. Aqui a pergunta é outra: **"que tipo de resposta isto pede?"**,
 * e ela é feita antes de qualquer consulta.
 *
 * **Por que a classificação é determinística.** Poderia ser um modelo, e num
 * ambiente com chave seria tentador. Duas razões contra. A primeira é que a
 * escolha da fonte é a decisão mais consequente do assistente — errar aqui faz
 * uma resposta correta sobre o assunto errado —, e uma decisão dessas tem de
 * ser reproduzível e testável sem rede. A segunda é que ela precisa funcionar
 * sem chave, porque o produto funciona sem chave.
 *
 * O modelo entra depois, onde erra pouco e ajuda muito: redigindo sobre o que
 * as ferramentas devolveram.
 *
 * **A ordem dos padrões é a regra de desempate.** Do mais específico para o
 * mais geral, e o primeiro que casar vence. "Quanto mudou o IPVA desde
 * dezembro" casa EVOLUCAO antes de VALOR porque `desde` aparece antes na lista
 * — e é justamente essa precedência que a versão anterior não tinha.
 */

import { normalizar, termos, PALAVRAS_DE_PERGUNTA } from "./normalizar";
import { leituraProvisoria } from "./plano";

export type Intencao =
  /** "o que é X", "como funciona X", "como é calculado" */
  | "CONCEITUAL"
  /** "temos X?", "existe X no FreightCheck?" */
  | "DISPONIBILIDADE"
  /** "quanto está X em agosto", "qual o valor de X" */
  | "VALOR"
  /** "quanto mudou X desde dezembro", "evolução de X" */
  | "EVOLUCAO"
  /** "compare julho e agosto" */
  | "COMPARACAO"
  /** "o que mudou em agosto" */
  | "MOVIMENTO"
  /**
   * "tem algo fora do padrão?", "o que eu deveria investigar primeiro?"
   *
   * Não é o ranking, e a diferença é o que a torna necessária. O ranking ordena
   * por dinheiro; esta ordena por **criticidade** — abrangência na frota,
   * magnitude do movimento, se há valor apurado, se há troca de formato — e
   * devolve, para cada posição, os motivos que a colocaram ali. É a fila de
   * investigação que a tela de Alterações já mostrava e que o assistente não
   * alcançava.
   */
  | "ATENCAO"
  /** "onde perdemos mais", "qual parâmetro mais piorou" */
  | "RANKING_PERDA"
  /** "onde ganhamos mais" */
  | "RANKING_GANHO"
  /** "quais veículos foram mais impactados" */
  | "VEICULOS"
  /** "por quê?", "de onde veio esse número" */
  | "PROCEDENCIA"
  /** "o que não conseguimos precificar", "semântica não confirmada" */
  | "SEM_PRECO"
  /** "o que o Book diz sobre X" */
  | "BOOK"
  /** "o que temos importado", "quantas vigências" */
  | "PANORAMA"
  /** "que vigências existem", "quais unidades" */
  | "CATALOGO_DE_CONTEXTO"
  /** "o que falta na curadoria", "quantos atributos sem semântica" */
  | "CURADORIA"
  /** "quais importações", "quando o arquivo entrou" */
  | "IMPORTACOES"
  /** "balanço de massa", "por que não promoveu" */
  | "BALANCO"
  /** "onde aparece esta placa na planilha", "em que célula está X" */
  | "CELULAS"
  /** "composição da frota", "ficha do cavalo" */
  | "COMPOSICAO"
  /** "qual caminhão dá prejuízo", "quanto sobra", "EBITDA", "margem" */
  | "DRE"
  /** "ola", "bom dia", "tudo bem?", "obrigado" — conversa, não consulta */
  | "SAUDACAO"
  | "DESCONHECIDA";

/** As intenções que se respondem sem tocar o banco. */
export const INTENCOES_CONCEITUAIS: ReadonlySet<Intencao> = new Set<Intencao>([
  "CONCEITUAL",
  "BOOK",
]);

/** As intenções que exigem um recorte `(unidade, canal)` para significar algo. */
export const INTENCOES_COM_RECORTE: ReadonlySet<Intencao> = new Set<Intencao>([
  // Composição descreve a frota de um recorte: sem unidade e canal, somar o
  // mensal de todas as operações produziria um total que ninguém opera.
  "COMPOSICAO",
  // A DRE, pelo mesmo motivo e com uma agravante: um resultado somado sobre
  // duas operações diferentes é um número que nenhum gestor tem como agir.
  "DRE",
  "VALOR",
  "EVOLUCAO",
  "COMPARACAO",
  "MOVIMENTO",
  "ATENCAO",
  "RANKING_PERDA",
  "RANKING_GANHO",
  "VEICULOS",
  "PROCEDENCIA",
  // O que não dá para precificar é uma propriedade de um recorte, não do
  // produto: a mesma coluna pode ter semântica confirmada numa unidade e
  // pendente noutra. Sem recorte, `semParaPrecificar` não roda — e foi
  // exatamente esse o defeito que a bateria pegou.
  "SEM_PRECO",
]);

/**
 * As intenções em que nomear um parâmetro faz sentido.
 *
 * "Quais parâmetros não têm preço?" fala de parâmetros no plural e não nomeia
 * nenhum; tentar resolver "preço" como gaveta produzia uma lacuna dizendo que
 * o FreightCheck não conhece "preço" — verdadeiro e completamente fora do
 * assunto. Fora desta lista, o que sobra da frase não é tratado como nome de
 * coisa.
 */
/**
 * As intenções cuja pergunta, sem assunto próprio, é sobre o assunto do fio.
 *
 * Esta é a correção do defeito que a sequência de aceite expôs. A herança
 * decidia pela **forma** da frase — curta, começando com "e", terminando em
 * "por quê" —, e então "Quanto mudou em agosto?" logo depois de uma resposta
 * sobre combustível não herdava nada: tem verbo, tem período, parece
 * autossuficiente. Só que não nomeia o quê, e num fio aberto o quê é o
 * combustível. A resposta vinha sobre o agregado da vigência: verdadeira, e
 * sobre outro assunto.
 *
 * A regra passa a ser sobre **conteúdo**: se a intenção é do tipo que fala de
 * um parâmetro e a frase não nomeia nenhum, o do estado vale.
 *
 * Ficam de fora as que são sobre o conjunto por definição. Um ranking pergunta
 * qual parâmetro se destaca — herdar um tornaria a pergunta sem sentido —, e
 * panorama, catálogo e disponibilidade descrevem o recorte, não uma gaveta.
 */
export const INTENCOES_QUE_HERDAM_ASSUNTO: ReadonlySet<Intencao> = new Set<Intencao>([
  /*
    Conceito e pergunta sem forma também herdam.

    "Como funciona?" e "e a frequência?" logo depois de uma explicação sobre o
    QLP ADM são sobre o QLP ADM — não sobre o conceito de funcionar. Ficaram de
    fora por engano: a lista nasceu das intenções de dado, e as de conteúdo
    (que são as que mais aparecem numa conversa sobre o Book) não estavam nela.
    Isto só é consultado quando a frase **não** nomeia assunto nenhum, então o
    risco de herdar o que não devia é o de uma frase vazia, que não tem outro
    assunto a que pertencer.
  */
  "CONCEITUAL",
  "DISPONIBILIDADE",
  "DESCONHECIDA",
  "VALOR",
  "EVOLUCAO",
  "COMPARACAO",
  "MOVIMENTO",
  "VEICULOS",
  "PROCEDENCIA",
  "BOOK",
]);

export const INTENCOES_COM_PARAMETRO: ReadonlySet<Intencao> = new Set<Intencao>([
  // Curadoria aceita um parâmetro para responder "por que ESTE está sem
  // semântica"; sem ele, responde o estado do conjunto.
  "CURADORIA",
  "CONCEITUAL",
  "DISPONIBILIDADE",
  "VALOR",
  "EVOLUCAO",
  "COMPARACAO",
  "MOVIMENTO",
  "VEICULOS",
  "PROCEDENCIA",
  "BOOK",
]);

export interface PeriodoPedido {
  /** Mês por extenso, como foi escrito: "agosto". */
  mes?: string;
  ano?: number;
  /** "última", "anterior" — resolvidos contra as vigências do contexto. */
  relativo?: "ULTIMA" | "ANTERIOR" | "PRIMEIRA";
}

export interface Entidades {
  /**
   * O que a frase pode estar nomeando — **hipótese**, não afirmação.
   *
   * Chamava-se `termoDoParametro`, e o nome era a origem do defeito: quem lia
   * o campo tratava o resíduo da frase como um parâmetro já estabelecido. Aqui
   * ele é o que sempre foi de verdade — um palpite —, e quem decide se há
   * assunto é `reconhecerAssunto`, contra o vocabulário do produto.
   */
  assuntoCandidato: string | null;
  periodo: PeriodoPedido | null;
  /** Quando a pergunta delimita um intervalo: "desde dezembro", "de julho a agosto". */
  intervalo: { de: PeriodoPedido; ate: PeriodoPedido | null } | null;
  equipamento: "CAVALO" | "CARRETA" | null;
  /**
   * "Me mostre os 5 seguintes" — a continuação de uma lista já mostrada.
   *
   * É a única entidade aqui que não descreve **o que** se quer, e sim **onde
   * parar de repetir**. Sem ela, a frase cai no plano padrão e recebe o mesmo
   * agregado de sempre: a pessoa pede a página seguinte e recebe a primeira,
   * outra vez, sem nada dizendo que a lista não andou.
   *
   * `quantos` é `null` quando a pessoa não disse o número ("mostre mais") — aí
   * vale o tamanho da página anterior, que é a leitura que erra menos.
   */
  paginacao: { quantos: number | null } | null;
}

export interface Leitura {
  intencao: Intencao;
  entidades: Entidades;
  /** A frase depende da anterior para significar algo. */
  continuacao: boolean;
  /** O padrão que decidiu — vai para o painel técnico, não para a resposta. */
  porque: string;
}

// ── Vocabulário ─────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const MES_POR_NUMERO = Object.entries(MESES).reduce<Record<number, string>>(
  (acc, [nome, n]) => ((acc[n] = nome), acc),
  {},
);

/*
  O nome do mês tem de terminar onde ele termina.

  Sem o `\b` do fim, "onde tivemos **maio**r perda?" era lido como uma pergunta
  sobre maio: o ranking vinha da vigência errada, com números certos e um
  recorte que ninguém pediu. É a mesma família de defeito que fazia "previsão"
  recuperar um artigo sobre "revisão" — casar dentro de outra palavra.
*/
const FIM_DO_MES = "(?![a-z])";

/** "agosto/2026" → { mes: "agosto", ano: 2026 } */
function lerMes(frase: string): PeriodoPedido | null {
  for (const [nome] of Object.entries(MESES)) {
    const re = new RegExp(`\\b${nome}${FIM_DO_MES}(?:[\\s/de]+((?:19|20)\\d{2}))?`, "i");
    const achado = re.exec(frase);
    if (achado) {
      return { mes: nome, ...(achado[1] ? { ano: Number(achado[1]) } : {}) };
    }
  }
  return null;
}

/** Todos os meses citados, na ordem em que aparecem — para comparações. */
function lerMeses(frase: string): PeriodoPedido[] {
  const achados: { pos: number; periodo: PeriodoPedido }[] = [];
  for (const [nome] of Object.entries(MESES)) {
    const re = new RegExp(`\\b${nome}${FIM_DO_MES}(?:[\\s/de]+((?:19|20)\\d{2}))?`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(frase)) !== null) {
      achados.push({
        pos: m.index,
        periodo: { mes: nome, ...(m[1] ? { ano: Number(m[1]) } : {}) },
      });
    }
  }
  return achados.sort((a, b) => a.pos - b.pos).map((a) => a.periodo);
}

function lerRelativo(frase: string): PeriodoPedido | null {
  if (/\b(ultima|atual|corrente|mais recente)\b/.test(frase)) return { relativo: "ULTIMA" };
  if (/\b(anterior|passada|penultima)\b/.test(frase)) return { relativo: "ANTERIOR" };
  if (/\b(primeira|inicial)\b/.test(frase)) return { relativo: "PRIMEIRA" };
  return null;
}

/**
 * O pedido de "mais um pouco da mesma lista".
 *
 * Três formas, e as três são frases que só existem depois de uma lista: pedir
 * os *seguintes*, os *próximos*, ou simplesmente *mais*. Um número solto ("mais
 * 5") é o tamanho da próxima página; sem número, repete-se o tamanho anterior.
 *
 * A construção é estreita de propósito. `mais` sozinho aparece em meia língua
 * portuguesa — "o que mais mudou?", "quem foi mais afetado?" —, e por isso ele
 * só conta quando vem acompanhado de número ou das palavras que nomeiam uma
 * continuação. Um falso positivo aqui pagina uma lista que ninguém pediu.
 */

/**
 * A frase fala de um movimento — de algo que **mudou**?
 *
 * É o que decide se um "por que…" pede dado ou conceito. Só verbos e formas que
 * descrevem variação entram: `mudar` e `alterar` cobrem a família inteira por
 * prefixo, e os demais são as palavras com que se relata perda e ganho neste
 * produto. `diferente` entra porque "por que o valor está diferente?" é a mesma
 * pergunta dita sem verbo de movimento.
 *
 * Deliberadamente **fora**: `funciona`, `existe`, `significa`, `serve` — as
 * formas com que se pergunta por uma regra. Elas são o outro lado da fronteira,
 * e mantê-las fora é o que preserva o acerto original ("por que o impacto é
 * acumulado por periodicidade?" continua sendo conceito).
 */
const MOVIMENTO_NA_FRASE =
  /\b(mud(ou|aram|ando)|alter(ou|aram|ando)|ca(iu|iram)|subi(u|ram)|aument(ou|aram)|diminu(iu|iram)|redu(ziu|ziram)|cresc(eu|eram)|pior(ou|aram)|melhor(ou|aram)|perd(i|emos|eu)|ganh(ei|amos|ou)|zer(ou|aram)|diferente|divergent)/;

function lerPaginacao(frase: string): { quantos: number | null } | null {
  const comNumero = /\b(?:mais|proximos?|seguintes?|outros?)\s+(\d{1,3})\b/.exec(frase);
  if (comNumero) return { quantos: Number(comNumero[1]) };
  const numeroAntes = /\b(\d{1,3})\s+(?:seguintes?|proximos?)\b/.exec(frase);
  if (numeroAntes) return { quantos: Number(numeroAntes[1]) };
  if (/\b(?:os\s+)?(?:seguintes|proximos)\b/.test(frase)) return { quantos: null };
  if (/\bmostre?\s+mais\b|\bmais\s+alguns\b|\bcontinue\b/.test(frase)) return { quantos: null };
  return null;
}

function lerEquipamento(frase: string): "CAVALO" | "CARRETA" | null {
  if (/\bcavalo|caminh(a|ã)o|trator\b/.test(frase)) return "CAVALO";
  if (/\bcarreta|implemento|reboque\b/.test(frase)) return "CARRETA";
  return null;
}

/**
 * O candidato a assunto: o que sobra depois de tirar a forma da pergunta.
 *
 * É uma **hipótese**. Ela só vira assunto depois de `reconhecerAssunto` a
 * confrontar com o vocabulário real do produto — e o caso mais comum é ela não
 * virar, porque a maioria das perguntas de uma conversa não nomeia gaveta
 * nenhuma.
 */
function extrairAssuntoCandidato(pergunta: string): string | null {
  const palavras = termos(pergunta).filter((p) => !PALAVRAS_DE_PERGUNTA.has(p));
  return palavras.length > 0 ? palavras.join(" ") : null;
}

// ── Continuação ─────────────────────────────────────────────────────────────

/**
 * A frase só significa alguma coisa junto da anterior.
 *
 * Três formas, e nenhuma delas é uma frase decorada. "E julho?" é o padrão
 * *conector + complemento curto*; "Por quê?" é o padrão *pergunta sem objeto*;
 * "compare" sozinho é o padrão *verbo sem argumento*. O que os une é a
 * ausência de assunto próprio — e é isso que se detecta, não a frase em si.
 */
/**
 * A frase se refere a algo dito antes, sem nomeá-lo.
 *
 * "Isso está previsto no Book?" — o "isso" é a resposta anterior. Sem detectar
 * o pronome, a frase parece autossuficiente (tem verbo, tem objeto, tem ponto
 * de interrogação) e o assistente ia procurar no Book um parâmetro chamado
 * "previsto". Um pronome anafórico é a declaração explícita de que o assunto
 * está na conversa, não na frase.
 */
export function temPronomeAnaforico(pergunta: string): boolean {
  return /\b(isso|isto|aquilo|disso|disto|nisso|desse|dessa|deste|desta|dele|dela|esse|essa|este|esta)\b/.test(
    normalizar(pergunta),
  );
}

export function ehContinuacao(pergunta: string): boolean {
  const frase = normalizar(pergunta).trim().replace(/[?!.]+$/, "");
  const significativas = termos(pergunta);

  // "por quê?", "por que?", "porque"
  if (/^(por que|porque|por qu)\b/.test(frase) && significativas.length <= 2) return true;

  // "e julho?", "e em julho", "e a carreta?", "e agora?"
  if (/^e\b/.test(frase) && significativas.length <= 3) return true;

  // "compare", "compare os dois", "e daí", "e então"
  if (significativas.length <= 3 && /\b(compare|comparar|os dois|as duas|idem|tambem)\b/.test(frase)) {
    return true;
  }

  // "e o mês anterior?", "na vigência anterior?"
  if (significativas.length <= 4 && /\b(anterior|passada|seguinte|proxima)\b/.test(frase)) {
    return true;
  }

  return false;
}

// ── Saudação ────────────────────────────────────────────────────────────────

/**
 * As formas de dizer olá, obrigado e tchau.
 *
 * A lista é curta de propósito: ela não precisa cobrir o português social
 * inteiro, só o que se digita antes de começar a trabalhar. Uma saudação não
 * reconhecida cai em DESCONHECIDA, que é o comportamento de hoje — o custo de
 * errar por omissão é uma resposta sem graça, e o de errar por excesso é uma
 * pergunta de verdade tratada como conversa fiada.
 */
const SAUDACOES =
  /\b(ola|oi+|opa|e ai|salve|bom dia|boa tarde|boa noite|bom fim de semana|tudo (bem|certo|bom|tranquilo)|como vai|como (voce |vc )?esta|beleza|blz|hey|hi|hello|obrigad[oa]|agradec\w*|valeu|vlw|tchau|falou|ate (logo|mais|breve)|bom trabalho)\b/g;

/**
 * Palavras que acompanham a saudação sem lhe acrescentar pedido.
 *
 * "Bom dia, assistente" e "oi, tudo bem por aí?" continuam sendo só um bom dia.
 */
const RUIDO_SOCIAL = /\b(por favor|obrigado|voce|vc|ai|por ai|entao|assistente|bot|ia|amigo|pessoal|gente|time|entao|ne|hein|so isso|nada)\b/g;

/**
 * A frase inteira é conversa, e não pergunta.
 *
 * Repare que a checagem é sobre **o que sobra**, não sobre o que casa. Um
 * "bom dia" no começo de uma pergunta de verdade — "bom dia, qual o valor do
 * IPVA?" — deixa "qual o valor do ipva" para trás, e aí não é saudação: é uma
 * pergunta educada, e responder a ela com uma apresentação seria ignorar o que
 * foi perguntado. Só quando não sobra nada além de pontuação é que a frase não
 * pede consulta nenhuma.
 */
export function ehSaudacao(pergunta: string): boolean {
  const frase = normalizar(pergunta).trim();
  if (!frase) return false;
  if (!frase.match(SAUDACOES)) return false;
  const resto = frase.replace(SAUDACOES, " ").replace(RUIDO_SOCIAL, " ");
  return /^[\s,.!?;:'"()\-—…]*$/.test(resto);
}

// ── Classificação ───────────────────────────────────────────────────────────

/*
  ---- os padrões saíram daqui --------------------------------------------

  Eles moram em `plano.ts`, como detectores de necessidade. A lista que existia
  aqui era ordenada e exclusiva — o primeiro padrão que casasse vencia, e os
  outros nem rodavam —, e era isso que fazia "teve alteração de pneu e existe
  regra no Book?" escolher uma das duas perguntas e ignorar a outra.

  O que `interpretar` ainda precisa é de uma leitura **provisória**: ela decide
  o que a frase herda da conversa e se o resíduo pode ser um assunto, e as duas
  decisões acontecem antes de o plano existir. Ela vem de `leituraProvisoria`,
  que usa exatamente os mesmos detectores — uma lista só, para que nunca haja
  duas opiniões sobre onde procurar.
*/

/**
 * Lê a pergunta: o que ela quer, e sobre o quê.
 *
 * Não consulta nada. Recebe uma frase e devolve um plano de leitura — que é o
 * que permite testar a interpretação sem banco, sem rede e sem modelo.
 */
export function interpretar(pergunta: string): Leitura {
  const frase = normalizar(pergunta).trim();

  /*
    A saudação sai antes de qualquer padrão, e sem entidade nenhuma.

    Ela não é uma consulta que falhou — é uma frase que não pediu consulta. Sem
    esta saída, "ola" percorria os padrões, não casava nenhum, virava
    DESCONHECIDA e chegava ao fim da orquestração sem evidência e sem trecho,
    onde a única conclusão possível era a lacuna "não encontrei nada sobre isto"
    — verdadeira, e a pior primeira impressão que este produto podia dar a quem
    abriu a tela para dizer bom dia.

    Também não é continuação: quem cumprimenta no meio de uma conversa não está
    voltando ao assunto anterior, e herdar parâmetro ou período aqui só sujaria
    o painel técnico com uma herança que ninguém usa.
  */
  if (ehSaudacao(pergunta)) {
    return {
      intencao: "SAUDACAO",
      continuacao: false,
      porque: "é conversa, não consulta",
      entidades: {
        assuntoCandidato: null,
        periodo: null,
        intervalo: null,
        equipamento: null,
        paginacao: null,
      },
    };
  }

  const provisoria = leituraProvisoria(pergunta);
  let intencao: Intencao = provisoria.intencao;
  let porque = provisoria.porque;

  const meses = lerMeses(frase);
  const relativo = lerRelativo(frase);

  let periodo: PeriodoPedido | null = null;
  let intervalo: Entidades["intervalo"] = null;

  if (/\bdesde\b/.test(frase) && meses.length >= 1) {
    intervalo = { de: meses[0], ate: meses[1] ?? null };
  } else if (meses.length >= 2) {
    intervalo = { de: meses[0], ate: meses[1] };
    if (intencao === "DESCONHECIDA") intencao = "COMPARACAO";
  } else if (meses.length === 1) {
    periodo = meses[0];
  } else if (relativo) {
    periodo = relativo;
  }

  // Comparação sem os dois meses continua sendo comparação: o segundo termo
  // virá do estado da conversa. Quem completa é `conversa.ts`.
  if (intencao === "COMPARACAO" && !intervalo && meses.length === 1) {
    intervalo = { de: meses[0], ate: null };
  }

  const assuntoCandidato = extrairAssuntoCandidato(pergunta);

  /*
    "Por quê?" pergunta duas coisas diferentes conforme traga ou não um objeto.

    Sozinho — "por quê?", "por que isso?" — pede a explicação do que acabou de
    ser dito: é procedência, e a resposta tem de descer até a linha que mudou.
    Com objeto próprio — "por que o impacto é acumulado por periodicidade?" —
    pede a razão de uma regra do produto, que está escrita no conhecimento e
    não no banco. A versão anterior mandava as duas para procedência, e a
    segunda ia consultar o resumo de uma vigência para explicar um princípio de
    arquitetura.
  */
  if (intencao === "DESCONHECIDA" && /^(por que|porque|por qu)\b/.test(frase)) {
    /*
      **A fronteira estava no comprimento da frase, e ela é sobre o assunto.**

      A regra anterior era: até duas palavras, procedência; acima disso,
      conceito. Ela acertava os dois exemplos que a motivaram — "por quê?" e
      "por que o impacto é acumulado por periodicidade?" — e errava a pergunta
      mais valiosa deste produto. "Por que a remuneração caiu este mês?" tem
      quatro palavras de conteúdo, virava CONCEITUAL, e CONCEITUAL é o único
      ramo do plano que **não consulta dado nenhum**: a pergunta central de uma
      aplicação de auditoria era respondida com um parágrafo de conceito e zero
      números. Medido: a classificação trocava só por acrescentar "este mês".

      O que separa as duas de verdade não é o tamanho — é do que a frase fala.
      Uma pergunta sobre **movimento** ("caiu", "mudou", "subiu", "está
      diferente") pede a causa de um número, e a causa de um número está no
      banco. Uma pergunta sobre **regra do produto** pede o conhecimento escrito.
      A lista abaixo é de verbos e formas de movimento, e ela é curta de
      propósito: na dúvida, o desfecho certo é consultar e mostrar a origem, não
      explicar um princípio de arquitetura a quem perguntou de dinheiro.
    */
    const curto = termos(pergunta).length <= 2;
    const sobreMovimento = MOVIMENTO_NA_FRASE.test(frase);
    intencao = curto || sobreMovimento ? "PROCEDENCIA" : "CONCEITUAL";
    porque = curto
      ? "pede a explicação da resposta anterior"
      : sobreMovimento
        ? "pede a causa de um movimento — e a causa de um número está no dado"
        : "pede a razão de uma regra do produto";
  }

  /*
    Uma frase com pergunta própria não é continuação, ainda que a forma pareça.

    "Compare julho com agosto" tem o verbo curto e casaria o padrão de
    continuação, mas diz o que quer e sobre o quê — não precisa herdar nada. Sem
    esta trava, ela herdaria o período da pergunta anterior por cima dos meses
    que ela mesma declara, e a resposta descreveria outro intervalo.

    O que separa as duas não é ter assunto — é ter **pedido**. "E o pneu?"
    nomeia um assunto e não diz o que quer saber dele; quem responde só sabe
    porque a pergunta anterior disse. A primeira versão media assunto, e então
    trocar de parâmetro no meio da conversa fazia o assistente perder o fio:
    "E o pneu?" não casava padrão nenhum, virava DESCONHECIDA e não herdava
    nada, porque a palavra "pneu" já bastava para ela parecer autossuficiente.
  */
  const temPedidoProprio =
    intencao !== "DESCONHECIDA" &&
    (Boolean(assuntoCandidato) || Boolean(intervalo?.ate) || meses.length >= 2);
  const continuacao = ehContinuacao(pergunta) && !temPedidoProprio;

  return {
    intencao,
    continuacao,
    porque,
    entidades: {
      assuntoCandidato,
      periodo,
      intervalo,
      equipamento: lerEquipamento(frase),
      paginacao: lerPaginacao(frase),
    },
  };
}

/**
 * A pergunta é sobre a estrutura do sistema, e não sobre o negócio?
 *
 * Existe para decidir uma coisa só: se o vocabulário de sistema — nome de
 * coluna, código de atributo, nome do parâmetro interno — entra no material que
 * o modelo recebe. Quem pergunta "como funciona o preço do combustível?" não
 * quer saber que a coluna se chama `Precoanp`, e o modelo repetia esse nome
 * porque ele estava no dossiê. Quem pergunta "qual coluna do export alimenta
 * isso?" quer exatamente o nome, e escondê-lo seria responder pela metade.
 */
export function perguntaTecnica(pergunta: string): boolean {
  return /\b(coluna|colunas|campo|campos|atributo|atributos|codigo|codigos|export|planilha|aba|celula|celulas|schema|tabela do banco|nome tecnico)\b/.test(
    normalizar(pergunta),
  );
}

/** "agosto" + 2026 → "2026-08-01"; sem ano, o chamador resolve contra o banco. */
export function mesParaNumero(mes: string): number | null {
  return MESES[normalizar(mes)] ?? null;
}

/** 8 → "agosto" */
export function numeroParaMes(numero: number): string | null {
  return MES_POR_NUMERO[numero] ?? null;
}
