import { deriveEntityType } from "./workbook";
import {
  SLUGS_DE_GRAO,
  tipoDeImportacao,
  type ColunaIdentificadora,
  type DefinicaoDeTipo,
} from "./tipos";

/**
 * Que equipamento é esta aba — decidido pelo que ela **traz**, não pelo nome.
 *
 * A regra anterior lia o nome da aba: `Modelo_Carreta` virava MODELOCARRETA, e
 * a correção foi ensinar o leitor a descartar as palavras que descrevem o
 * documento (modelo, base, dados…). Isso resolveu os nomes que já tinham
 * aparecido e não resolve o problema: a lista de palavras persegue a
 * criatividade de quem nomeia arquivo, e perde sempre. Medido no próprio
 * export, com a regra corrigida:
 *
 *   Modelo_Carreta     -> CARRETA            (acerta)
 *   m.carreta          -> MCARRETA           (identidade paralela nova)
 *   carreta_2026       -> CARRETA2026        (idem)
 *   Carreta Camaçari   -> CARRETACAMACARI    (idem)
 *   Planilha1          -> PLANILHA1          (idem)
 *
 * O conteúdo, ao contrário, separa os dois equipamentos com folga: das colunas
 * de fato, 63 são de carreta e 75 de cavalo, com 38 em comum — uma aba de
 * carreta cobre 100% do dicionário de carreta e 60% do de cavalo. Não é uma
 * medida apertada: é a diferença entre um e sessenta por cento.
 *
 * Então a identidade passa a vir da **sobreposição de colunas com o dicionário
 * que já existe**, e o nome vira desempate — nunca criador de tipo em silêncio.
 *
 * **O ponto que mais importa não é a troca de heurística.** Trocar "adivinhar
 * pelo nome" por "adivinhar pelo conteúdo" só melhoraria a taxa de acerto. O
 * que fecha o buraco é o terceiro caminho: quando não há evidência — nenhum
 * tipo conhecido bate, e o nome produziria um equipamento que o dicionário não
 * conhece — a decisão **não é tomada aqui**. Ela vira uma pendência que a
 * pré-visualização mostra e a promoção exige confirmada.
 */

/** Um tipo que o dicionário já conhece, com as colunas dele por slug. */
export interface KnownEntityType {
  entityType: string;
  /** Slugs das colunas (o que vem depois do ponto em `carreta.chassi`). */
  columns: Set<string>;
}

/**
 * De onde veio a identidade da aba.
 *
 * `DECLARADO` é a mais forte das três, e a única que não é dedução: quem
 * enviou o arquivo escolheu a aba da tela, e disse o tipo antes de o leitor
 * abrir a planilha. Ela só se aplica depois de conferida contra o conteúdo —
 * ver {@link conferirDeclaracao}. Uma declaração aceita sem conferência seria
 * pior do que dedução nenhuma: transformaria um clique na aba errada em fato.
 */
export type IdentitySource = "DECLARADO" | "DICIONARIO" | "NOME";

export interface IdentityDecision {
  entityType: string;
  source: IdentitySource;
  /**
   * Se aceitar esta decisão cria um equipamento que o dicionário não conhece.
   *
   * É a pergunta que separa "a carreta de sempre, com a aba nomeada de outro
   * jeito" de "um equipamento novo, ou um layout que mudou demais". A primeira
   * segue sozinha; a segunda espera um humano.
   */
  isNew: boolean;
  reason: string;
  /** As notas de cada tipo conhecido, da maior para a menor. Auditável. */
  scores: { entityType: string; score: number; matched: number; of: number }[];
}

/**
 * Quanto da aba precisa bater com um tipo para ele ser reconhecido, e quanta
 * vantagem ele precisa ter sobre o segundo colocado.
 *
 * Os dois números saem do próprio export e têm margem larga: carreta contra o
 * dicionário de carreta dá 1,00 e contra o de cavalo dá 0,60. Só o limiar não
 * bastaria — 0,60 passaria por um limiar frouxo —, e por isso a distância
 * entre o primeiro e o segundo é condição separada. Uma planilha que fique no
 * meio do caminho entre dois equipamentos não é decidida no chute: cai na
 * pendência, que é o lugar certo para ela.
 */
export const LIMIAR_RECONHECIMENTO = 0.75;
export const MARGEM_MINIMA = 0.2;

/**
 * As colunas de grão não entram na conta.
 *
 * A vigência e o identificador da linha são a chave, não a descrição. Contá-los
 * aproximaria todos os tipos entre si sem informar nada, e é justamente a
 * distância entre eles que decide.
 *
 * A lista era `["vigencia", "placa"]`, escrita aqui. Ela passou a sair de
 * `tipos.ts` quando o trecho entrou: `chaveTrecho` é chave do mesmo jeito que a
 * placa, e uma segunda lista de colunas de grão a teria pontuado como se fosse
 * descrição de equipamento — dando ao trecho uma coluna a mais de vantagem
 * sobre si mesmo, que é ruído medido como sinal.
 */
export const COLUNAS_DE_GRAO = new Set(SLUGS_DE_GRAO);

function pontuar(
  colunasDaAba: Set<string>,
  conhecidos: KnownEntityType[],
): IdentityDecision["scores"] {
  return conhecidos
    .map((tipo) => {
      let matched = 0;
      for (const coluna of colunasDaAba) if (tipo.columns.has(coluna)) matched++;
      return {
        entityType: tipo.entityType,
        matched,
        of: colunasDaAba.size,
        score: colunasDaAba.size === 0 ? 0 : matched / colunasDaAba.size,
      };
    })
    .sort((a, b) => b.score - a.score || a.entityType.localeCompare(b.entityType));
}

export function classifyEntityType(
  sheetName: string,
  /** Slugs das colunas da aba, grão incluído — a filtragem é feita aqui. */
  columnSlugs: Iterable<string>,
  conhecidos: KnownEntityType[],
): IdentityDecision {
  const colunas = new Set<string>();
  for (const slug of columnSlugs) if (!COLUNAS_DE_GRAO.has(slug)) colunas.add(slug);

  const scores = pontuar(colunas, conhecidos);
  const [primeiro, segundo] = scores;
  const margem = primeiro ? primeiro.score - (segundo?.score ?? 0) : 0;
  const doNome = deriveEntityType(sheetName).entityType;
  const conhecidosPorNome = new Set(conhecidos.map((c) => c.entityType));

  if (primeiro && primeiro.score >= LIMIAR_RECONHECIMENTO && margem >= MARGEM_MINIMA) {
    const porcento = (n: number) => `${Math.round(n * 100)}%`;
    return {
      entityType: primeiro.entityType,
      source: "DICIONARIO",
      isNew: false,
      reason:
        `${primeiro.matched} das ${primeiro.of} colunas desta aba são de ` +
        `${primeiro.entityType} (${porcento(primeiro.score)})` +
        (segundo
          ? `, contra ${porcento(segundo.score)} de ${segundo.entityType}`
          : ", único equipamento conhecido") +
        `. O nome da aba ("${sheetName}") não foi usado.`,
      scores,
    };
  }

  const motivoDaFalta =
    conhecidos.length === 0
      ? "o dicionário ainda não conhece nenhum equipamento"
      : primeiro && primeiro.score < LIMIAR_RECONHECIMENTO
        ? `o melhor palpite do dicionário é ${primeiro.entityType} com ` +
          `${Math.round(primeiro.score * 100)}%, abaixo dos ` +
          `${Math.round(LIMIAR_RECONHECIMENTO * 100)}% exigidos`
        : `${primeiro?.entityType} e ${segundo?.entityType} ficaram perto demais ` +
          `um do outro (${Math.round(margem * 100)} pontos de diferença, mínimo ` +
          `${Math.round(MARGEM_MINIMA * 100)})`;

  return {
    entityType: doNome,
    source: "NOME",
    isNew: !conhecidosPorNome.has(doNome),
    reason:
      `Identidade tirada do nome da aba ("${sheetName}") porque ${motivoDaFalta}.` +
      (conhecidosPorNome.has(doNome)
        ? ` O tipo ${doNome} já existe no dicionário.`
        : ` Isso criaria o equipamento ${doNome}, que não existe no dicionário.`),
    scores,
  };
}

/**
 * Os tipos que uma importação criaria e o dicionário não conhece.
 *
 * A pergunta que a promoção faz antes de escrever qualquer coisa. Separada da
 * classificação de propósito: a classificação olha uma aba, esta olha o que a
 * importação inteira produziu — inclusive quando duas abas concordam em criar
 * o mesmo equipamento novo.
 */
export function novasIdentidades(
  tiposDaImportacao: Iterable<string>,
  conhecidos: Iterable<string>,
): string[] {
  const sabidos = new Set(conhecidos);
  return [...new Set([...tiposDaImportacao].filter((t) => !sabidos.has(t)))].sort();
}

/**
 * A declaração conferida contra o que a aba traz.
 *
 * Declarar não é decidir. Quem envia sabe o que está enviando, e a aba da tela
 * é onde ele diz — mas um clique na aba errada não pode virar identidade. Então
 * a declaração é conferida por dois caminhos independentes, nesta ordem:
 *
 * 1. **O grão.** Cada tipo se identifica por uma coluna (`tipos.ts`), e ela ou
 *    está no cabeçalho ou não está. É a conferência que separa o trecho dos
 *    equipamentos com certeza, sem depender de dicionário nenhum — e é a única
 *    que funciona no primeiro arquivo de um tipo, que é justamente o caso em
 *    que a dedução por conteúdo não tem o que consultar.
 * 2. **O dicionário.** Cavalo e carreta se identificam os dois por placa, e o
 *    grão não os separa. O que os separa são as colunas: quando a pontuação
 *    reconhece um tipo com folga (`DICIONARIO`) e ele não é o declarado, quem
 *    está errado é a declaração, e a conta que prova isso já está escrita em
 *    `decisao.reason`.
 *
 * O que a conferência **não** faz é escolher em silêncio. Divergindo, ela não
 * troca o tipo nem descarta a aba: ela devolve a frase da divergência, que vira
 * um ERRO impeditivo. Nada é promovido, e quem enviou lê o que aconteceu.
 */
export interface DeclaracaoConferida {
  /** Com que tipo a aba será tratada na staging. */
  entityType: string;
  /** A decisão a registrar — a declaração vira a fonte quando ela se sustenta. */
  decision: IdentityDecision;
  /** A frase da divergência, ou `null` quando declaração e conteúdo concordam. */
  divergencia: string | null;
}

export function conferirDeclaracao(
  declarado: DefinicaoDeTipo,
  decisao: IdentityDecision,
  /** O identificador encontrado no cabeçalho da aba, na forma de `foldText`. */
  identificadorDaAba: ColunaIdentificadora | null,
  sheetName: string,
): DeclaracaoConferida {
  const esperado = declarado.identificador;

  if (esperado === null) {
    // Um tipo sem grão declarado não deveria ter chegado até aqui — a recusa
    // acontece no recebimento. Se chegou, o silêncio é o pior desfecho.
    return {
      entityType: decisao.entityType,
      decision: decisao,
      divergencia:
        `A importação foi declarada como ${declarado.rotulo}, e o pipeline ainda ` +
        `não sabe o que identifica uma linha desse tipo.`,
    };
  }

  if (identificadorDaAba === null || identificadorDaAba.folded !== esperado.folded) {
    return {
      entityType: decisao.entityType,
      decision: decisao,
      divergencia:
        `Você escolheu ${declarado.rotulo}, que se identifica pela coluna ` +
        `"${esperado.sourceName}". A aba "${sheetName}" ` +
        (identificadorDaAba === null
          ? "não traz essa coluna."
          : `se identifica por "${identificadorDaAba.sourceName}", que é de outro tipo.`),
    };
  }

  /*
    A segunda conferência só se aplica quando o grão não separou os dois.

    O dicionário pontua por sobreposição de colunas, e uma aba de trecho pode
    parecer uma carreta: escopo, unidade, operador e custo se escrevem igual nos
    dois. O que não se escreve igual é a chave — e ela já foi conferida acima.
    Quando o tipo que o dicionário aponta se identifica por **outra** coluna, é
    o dicionário que está enganado, não a declaração, e sobrepor-se a ele aqui
    seria trocar a evidência forte pela fraca.

    Um tipo que `tipos.ts` não conhece (um DOLLY que a fonte invente) não tem
    identificador declarado, e por isso não recebe essa dispensa: aí a
    sobreposição de colunas é a única evidência que existe, e ela vale.
  */
  const graoDoDeduzido = tipoDeImportacao(decisao.entityType)?.identificador;
  const graoJaSeparou =
    graoDoDeduzido !== undefined &&
    graoDoDeduzido !== null &&
    graoDoDeduzido.folded !== esperado.folded;

  if (
    decisao.source === "DICIONARIO" &&
    decisao.entityType !== declarado.code &&
    !graoJaSeparou
  ) {
    return {
      entityType: decisao.entityType,
      decision: decisao,
      divergencia:
        `Você escolheu ${declarado.rotulo} e a aba "${sheetName}" é de ` +
        `${decisao.entityType}. ${decisao.reason}`,
    };
  }

  return {
    entityType: declarado.code,
    decision: {
      ...decisao,
      entityType: declarado.code,
      source: "DECLARADO",
      // Declarado no envio é declarado: exigir a confirmação de identidade nova
      // depois seria fazer a mesma pergunta à mesma pessoa em duas telas.
      isNew: false,
      reason:
        `Tipo declarado no envio: ${declarado.rotulo}. A aba traz a coluna ` +
        `"${esperado.sourceName}", que é o grão deste tipo` +
        (decisao.source === "DICIONARIO"
          ? `, e o dicionário concorda — ${decisao.reason}`
          : `. ${decisao.reason}`),
    },
    divergencia: null,
  };
}
