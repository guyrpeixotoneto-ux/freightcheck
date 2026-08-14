import { deriveEntityType } from "./workbook";

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

export type IdentitySource = "DICIONARIO" | "NOME";

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
 * `vigência` e `placa` existem em toda aba de todo equipamento — são a chave,
 * não a descrição. Contá-las aproximaria todos os tipos entre si sem informar
 * nada, e é justamente a distância entre eles que decide.
 */
export const COLUNAS_DE_GRAO = new Set(["vigencia", "placa"]);

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
