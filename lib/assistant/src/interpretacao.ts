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

import { normalizar, termos } from "./normalizar";

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
  "VALOR",
  "EVOLUCAO",
  "COMPARACAO",
  "MOVIMENTO",
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
  /** O termo que nomeia a gaveta — cru, para o resolvedor. */
  termoDoParametro: string | null;
  periodo: PeriodoPedido | null;
  /** Quando a pergunta delimita um intervalo: "desde dezembro", "de julho a agosto". */
  intervalo: { de: PeriodoPedido; ate: PeriodoPedido | null } | null;
  equipamento: "CAVALO" | "CARRETA" | null;
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

function lerEquipamento(frase: string): "CAVALO" | "CARRETA" | null {
  if (/\bcavalo|caminh(a|ã)o|trator\b/.test(frase)) return "CAVALO";
  if (/\bcarreta|implemento|reboque\b/.test(frase)) return "CARRETA";
  return null;
}

/**
 * Palavras que nomeiam a operação e nunca o parâmetro.
 *
 * Sem esta poda, "quanto mudou o IPVA" ofereceria "quanto mudou ipva" ao
 * resolvedor, e a busca textual do resolvedor casaria qualquer coluna cujo
 * nome contivesse "mudou" — que não existe, mas o mesmo vale para "valor",
 * "total" e "impacto", que existem em dezenas.
 */
const PALAVRAS_DE_OPERACAO = new Set([
  "quanto", "quantos", "quantas", "qual", "quais", "como", "onde", "quando",
  "mudou", "mudaram", "mudanca", "mudancas", "alterou", "alteracao", "alteracoes",
  "funciona", "calculado", "calcula", "composto", "composicao", "significa",
  "evolucao", "evoluiu", "variou", "variacao", "subiu", "caiu", "aumentou",
  "diminuiu", "compare", "comparar", "comparacao", "versus", "contra",
  "impacto", "impactos", "perdemos", "perda", "perdas", "ganhamos", "ganho",
  "ganhos", "piorou", "melhorou", "prejudicou", "afetados", "afetado",
  "veiculo", "veiculos", "placa", "placas", "frota", "vigencia", "vigencias",
  "parametro", "parametros", "book", "operador", "diz", "fala", "sobre",
  "desde", "entre", "ate", "periodo", "mes", "meses", "ano", "temos", "existe",
  "existem", "disponivel", "precificar", "precificado", "semantica",
  "confirmada", "confirmado", "numero", "valor", "valores", "dado", "dados",
  "freightcheck", "sistema", "produto", "sofreram", "sofreu", "contribuiram",
  "importante", "importantes", "principal", "principais", "estranha", "estranho",
  "dinheiro", "reais", "foram", "foi", "veio", "esse", "essa", "isso", "esta",
  "impactado", "impactados", "impactada", "impactadas", "afetada", "afetadas",
  "suficiente", "importado", "importados", "importadas", "calcular", "calculo",
  "dois", "duas", "ambos", "ambas",
  "aconteceu", "acontece", "aconteceram", "houve", "ocorreu", "ocorreram",
  "rolou", "entrou", "saiu", "resumo", "panorama", "situacao",
  "bloco", "blocos", "regra", "regras", "cobre", "cobertura", "cobertos",
  /*
    Palavras que a pergunta usa para se referir **à resposta anterior**, e nunca
    para nomear um parâmetro.

    "Me mostre a fonte" oferecia "fonte" ao resolvedor, que não achava gaveta
    nenhuma com esse nome e declarava que o FreightCheck não conhece "fonte" —
    quando a pergunta era sobre a fonte do que acabara de ser dito. O mesmo com
    "isso está previsto no Book?", que virava uma busca por um parâmetro
    chamado "previsto".
  */
  /*
    Como se pede um documento, e nunca como se chama um.

    "Você não consegue ler o que tem no documento QLP ADM?" deixava para o
    resolvedor a frase inteira — "consegue ler documento qlp adm" —, e com ela
    a busca textual do Book (que procura o termo dentro do texto das regras)
    não achava nada e o casamento por título dependia de sorte. O nome do bloco
    é o que sobra depois de tirar o pedido: `qlp adm`.
  */
  "documento", "documentos", "anexo", "anexos", "anexado", "anexada",
  "arquivo", "arquivos", "conteudo", "ler", "leia", "leu", "abrir", "abre",
  "abra", "consegue", "conseguiu", "transcreve", "transcrever", "pdf",
  "fonte", "fontes", "origem", "procedencia", "previsto", "prevista",
  "previstos", "previstas", "citado", "citada", "acima", "disse", "falou",
  // "Me mostre a fonte" oferecia "mostre" ao resolvedor — e um termo residual
  // qualquer basta para a frase parecer ter assunto próprio e não herdar nada.
  "mostre", "mostrem", "exiba", "exibir", "liste", "listar", "traga", "trazer",
  "anterior", "anteriores", "seguinte", "proxima", "proximo", "passada", "passado",
  "ultima", "ultimo", "atual", "corrente", "primeira", "primeiro", "remuneracao",
  ...Object.keys(MESES),
]);

/** O que sobra da frase depois de tirar operação, meses e ruído. */
function extrairTermoDoParametro(pergunta: string): string | null {
  const palavras = termos(pergunta).filter((p) => !PALAVRAS_DE_OPERACAO.has(p));
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

interface Padrao {
  intencao: Intencao;
  /** Regex sobre a frase normalizada. */
  quando: RegExp;
  porque: string;
}

/**
 * Do mais específico para o mais geral. O primeiro que casar vence.
 *
 * Cada linha existe por uma pergunta real da bateria da Fase 7, e a ordem entre
 * elas foi calibrada por ela. Mudar a ordem sem rodar as evals é mudar em qual
 * fonte o produto vai procurar.
 */
const PADROES: Padrao[] = [
  // ---- procedência: precisa vir antes de tudo, porque "por que" é curto -----
  {
    intencao: "PROCEDENCIA",
    quando: /\b(de onde ve(io|m)|qual a (fonte|origem|procedencia)|onde (esta|ta) escrito|me mostre? a fonte|como voce sabe)\b/,
    porque: "pede a origem de uma afirmação",
  },

  // ---- semântica pendente ---------------------------------------------------
  {
    intencao: "SEM_PRECO",
    quando: /\b(nao (tem|temos|foi|conseguimos|da para) (preco|precificar|calcular|valorar))\b|\bsem (preco|valoracao|semantica)\b|\bsemantica (nao|ainda nao) confirmada\b|\bnao (apuravel|calculavel|precificad\w*)/,
    porque: "pede o que não pôde ser precificado",
  },

  /*
    ---- governança do dado ---------------------------------------------------

    Estas quatro respondem "de onde este número veio e o que ficou de fora",
    não "quanto ele é". Vêm cedo porque nomeiam a coisa explicitamente
    (curadoria, importação, balanço, célula) e a palavra não aparece por acaso
    numa pergunta de remuneração.

    A que exige mais cuidado é CELULAS: "procure" e "onde aparece" são verbos
    que quem opera usa também para pedir um parâmetro. Por isso o padrão exige
    a palavra que diz **onde** procurar — planilha, célula, arquivo, aba —, e
    sem ela a pergunta segue o caminho de sempre.
  */
  {
    intencao: "BALANCO",
    quando: /\bbalanco( de massa)?\b|\bcelulas (lidas|importadas|viraram)\b|\bnao promoveu\b|\bpor que .{0,20}(nao )?promov\w*/,
    porque: "pergunta o que entrou e o que virou fato",
  },
  {
    intencao: "IMPORTACOES",
    quando: /\bimportac(ao|oes)\b|\bqual (foi )?(o|a) (ultimo|ultima) (import|arquivo|planilha)\w*\b|\bquando (o |a )?(arquivo|planilha|export)\b|\barquivos? (importad|enviad)\w*\b/,
    porque: "pergunta o histórico de importação",
  },
  {
    intencao: "CELULAS",
    quando: /\b(procur\w+|busc\w+|onde (esta|aparece)|em que|qual)\b.{0,40}\b(celula|celulas|planilha|planilhas|aba|abas|arquivo importado)\b/,
    porque: "pede uma busca nas células importadas",
  },

  // ---- panorama -------------------------------------------------------------
  {
    intencao: "PANORAMA",
    quando: /\b(o que (temos|ja foi) importad\w*|quantas vigencias|quantos (ativos|veiculos|caminhoes|placas|atributos|parametros)|panorama|situacao (do|da) (banco|base)|o que (tem|existe) (no|na) (banco|base))/,
    porque: "pede o estado geral do que foi importado",
  },

  // ---- disponibilidade: "temos X?" antes de "qual o valor de X?" ------------
  {
    intencao: "DISPONIBILIDADE",
    quando: /\b(temos|existe|existem|ha|tem)\b.*\b(parametro|coluna|dado|informacao|preco|valor)\b|\b(temos|existe|existem)\s+\w+/,
    porque: "pergunta se o dado existe no produto",
  },

  /*
    ---- Book -----------------------------------------------------------------

    "Documento" e "anexo" entram aqui porque no vocabulário deste produto eles
    só existem no Book: é lá que a regra é anexada como arquivo. Quem escreve
    "você não consegue ler o que tem no documento QLP ADM?" está pedindo o Book
    com todas as letras, e essa frase não casava padrão nenhum — caía em
    DESCONHECIDA e recebia de volta o índice, sem o arquivo que ela nomeia.

    O arquivo **importado** continua sendo outra coisa: IMPORTACOES e CELULAS
    vêm antes e ficam com "arquivo importado", "planilha" e "célula", que é o
    vocabulário do export e não o do contrato.
  */
  {
    intencao: "BOOK",
    quando:
      /\bbook\b|\bregra (do|de|da)\b|\bcontrato\b|\bmanual\b|\b(documento|documentos|anexo|anexos|anexad\w*)\b/,
    porque: "cita o Book do Operador, a regra ou o documento anexado",
  },

  // ---- comparação: dois meses, ou verbo comparar ----------------------------
  {
    intencao: "COMPARACAO",
    quando: /\bcompar(e|ar|ando|acao)\b|\bversus\b|\bvs\b|\b\w+\s+(x|contra)\s+\w+\b|\bdiferenca entre\b/,
    porque: "pede confronto entre dois recortes",
  },

  // ---- evolução: intervalo explícito ---------------------------------------
  {
    intencao: "EVOLUCAO",
    quando: /\bdesde\b|\bao longo\b|\bevolu(cao|iu|ir)\b|\bhistorico\b|\bserie\b|\bde \w+ (a|ate|para) \w+\b|\bnos ultimos\b/,
    porque: "delimita um intervalo de vigências",
  },

  // ---- rankings -------------------------------------------------------------
  {
    intencao: "RANKING_PERDA",
    quando: /\b(perdemos|perda|perdas|prejudic\w*|piorou|pior|caiu mais|reduziu|queda)\b/,
    porque: "pede o que reduziu a remuneração",
  },
  {
    intencao: "RANKING_GANHO",
    quando: /\b(ganhamos|ganho|ganhos|melhorou|melhor|subiu mais|aumentou mais|maior alta)\b/,
    porque: "pede o que aumentou a remuneração",
  },

  // ---- veículos -------------------------------------------------------------
  {
    intencao: "VEICULOS",
    quando: /\b(veiculo|veiculos|placa|placas|caminhoes|ativos)\b.*\b(afetad\w*|impactad\w*|sofrer\w*|mudar\w*|contribu\w*|mais)\b|\bquais (veiculos|placas)\b/,
    porque: "pede a lista de ativos afetados",
  },

  // ---- conceitual -----------------------------------------------------------
  {
    intencao: "CONCEITUAL",
    quando: /\b(o que (e|sao|significa)|que e|como funciona|como e (calculad\w*|compost\w*|apurad\w*|feito)|como [\w\s]{0,20}?(calcula|apura|acumula|monta|deriva)\w*|do que (e|se) comp\w*|explique|explica|defini(cao|r)|para que serve|qual a (formula|regra|logica))\b/,
    porque: "pede definição ou funcionamento",
  },

  /*
    Curadoria vem **depois** de CONCEITUAL, pela mesma razão de composição.

    "Para que serve a curadoria?" é uma pergunta sobre o conceito, e o corpus a
    responde — foi a suíte de interpretação que pegou isto: com o padrão antes,
    toda pergunta sobre o que a curadoria é abria uma consulta de estado. O que
    separa as duas é o verbo conceitual, e CONCEITUAL já o reconhece.
  */
  {
    intencao: "CURADORIA",
    quando: /\bcuradoria\b|\bfalta(m)? confirmar\b|\b(quantos|quais) atributos?\b.*\bsem(antica)?\b|\bnao (foram )?classificad\w*\b/,
    porque: "pergunta o estado da curadoria",
  },

  /*
    Composição vem **depois** de CONCEITUAL de propósito.

    "O que é composição?" é uma pergunta sobre o conceito, e o corpus responde.
    "Composição da frota" é a tela. O que separa as duas é o verbo conceitual,
    e CONCEITUAL já o reconhece — inverter a ordem faria toda pergunta sobre o
    conceito abrir uma consulta de frota.
  */
  {
    intencao: "COMPOSICAO",
    quando: /\bcomposicao\b|\bcomo se comp(oe|õe)\b|\bficha (do|da) (cavalo|carreta|equipamento|veiculo)\b|\bvisao (de|da) frota\b/,
    porque: "pede a composição da remuneração",
  },

  // ---- catálogo de contexto -------------------------------------------------
  {
    intencao: "CATALOGO_DE_CONTEXTO",
    quando: /\bquais (vigencias|unidades|canais|contextos|operacoes)\b|\bque vigencias\b|\blista de vigencias\b/,
    porque: "pede que recortes existem",
  },

  // ---- movimento da vigência ------------------------------------------------
  {
    intencao: "MOVIMENTO",
    quando: /\b(o que (mudou|alterou|aconteceu|houve|ocorreu|entrou|saiu|rolou)|mudancas|alteracoes|resumo)\b/,
    porque: "pede o movimento de uma vigência",
  },

  /*
    "Qual foi o impacto?" não casava padrão nenhum e caía em DESCONHECIDA — sem
    consulta, respondida por um artigo sobre cobertura da apuração. É uma
    pergunta de dado, e no meio de uma conversa é a mais natural que existe:
    depois de "o que mudou", perguntar quanto aquilo custou.
  */
  {
    intencao: "MOVIMENTO",
    quando: /\b(qual (foi |e |era )?o impacto|quanto (isso |isto )?(custou|impactou|pesou)|que impacto)\b/,
    porque: "pede o impacto do que está em discussão",
  },

  // ---- valor -----------------------------------------------------------------
  {
    intencao: "VALOR",
    quando: /\b(quanto (esta|e|foi|ficou)|qual o valor|valor (do|da|de)|quanto (custa|vale))\b/,
    porque: "pede o valor corrente de um parâmetro",
  },

  // ---- evolução, forma fraca: "quanto mudou X" sem intervalo ----------------
  {
    intencao: "EVOLUCAO",
    quando: /\bquanto (mudou|variou|subiu|caiu|aumentou|diminuiu)\b/,
    porque: "pede a variação de um parâmetro",
  },
];

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
        termoDoParametro: null,
        periodo: null,
        intervalo: null,
        equipamento: null,
      },
    };
  }

  let intencao: Intencao = "DESCONHECIDA";
  let porque = "nenhum padrão casou";

  for (const padrao of PADROES) {
    if (padrao.quando.test(frase)) {
      intencao = padrao.intencao;
      porque = padrao.porque;
      break;
    }
  }

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

  const termoDoParametro = extrairTermoDoParametro(pergunta);

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
    const curto = termos(pergunta).length <= 2;
    intencao = curto ? "PROCEDENCIA" : "CONCEITUAL";
    porque = curto
      ? "pede a explicação da resposta anterior"
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
    (Boolean(termoDoParametro) || Boolean(intervalo?.ate) || meses.length >= 2);
  const continuacao = ehContinuacao(pergunta) && !temPedidoProprio;

  return {
    intencao,
    continuacao,
    porque,
    entidades: {
      termoDoParametro,
      periodo,
      intervalo,
      equipamento: lerEquipamento(frase),
    },
  };
}

/** "agosto" + 2026 → "2026-08-01"; sem ano, o chamador resolve contra o banco. */
export function mesParaNumero(mes: string): number | null {
  return MESES[normalizar(mes)] ?? null;
}

/** 8 → "agosto" */
export function numeroParaMes(numero: number): string | null {
  return MES_POR_NUMERO[numero] ?? null;
}
