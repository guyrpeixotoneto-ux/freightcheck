/**
 * A identidade canônica de uma vigência, e as normalizações que a sustentam.
 *
 * Este módulo existe porque a identidade de negócio estava sendo *derivada do
 * acidente*: do rótulo como veio escrito, das abas que o arquivo por acaso
 * trazia, das células de escopo que por acaso estavam preenchidas. Três
 * arquivos descrevendo a mesma realidade produziam três identidades diferentes,
 * e as três coexistiam ativas.
 *
 * A regra aqui é uma só: **o que identifica um dado de negócio não pode
 * depender da forma como ele chegou**. Nome do arquivo, ordem das linhas, ordem
 * das abas, zeros à esquerda, máscara de CNPJ, hífen na placa e caixa alta ou
 * baixa são forma. A identidade é (sistema, família, canal, data, escopo).
 *
 * Tudo o que este módulo calcula tem um espelho em SQL — ver
 * `0015_canonical_identity.sql`. O espelho é que dá a garantia: o índice único
 * do Postgres é construído sobre uma coluna gerada pelo próprio banco, de modo
 * que um erro futuro neste TypeScript não consegue abrir a porta. O teste
 * `canonical-identity-sql.test.ts` prende os dois lados ao mesmo resultado.
 */
import { createHash } from "node:crypto";

/**
 * Os separadores das serializações canônicas.
 *
 * São caracteres de controle porque nenhum deles pode aparecer num componente
 * já normalizado — escopo e identificadores saem reduzidos a `[A-Z0-9 ]`, e o
 * texto de um fato vem de uma célula de planilha. Escrever com escape explícito
 * (`\u001f`) e não com o caractere literal é deliberado: literal, ele é
 * invisível no editor e um formatador ou um copiar-e-colar o remove sem que
 * ninguém veja — e o hash mudaria em silêncio, que é o pior defeito possível
 * num campo de identidade.
 *
 * Os mesmos bytes estão em `0015_canonical_identity.sql`, via `chr(31)` e
 * companhia, e um teste prende os dois lados ao mesmo resultado.
 */
/** US — entre os componentes de uma chave. */
const SEP_FIELD = "\u001f";
/** RS — entre o tipo e o código de uma entrada de escopo. */
const SEP_PAIR = "\u001e";
/** GS — entre entradas de escopo. */
const SEP_ENTRY = "\u001d";
/** FS — entre as linhas canônicas de fatos. */
const SEP_LINE = "\u001c";

/**
 * A família do dataset: o *contrato* da importação, não o que veio no arquivo.
 *
 * CAVALO e CARRETA são componentes de uma mesma família. Um arquivo só de
 * cavalos e um arquivo de cavalos+carretas descrevem a mesma remuneração da
 * mesma vigência — antes disto, viravam duas identidades ativas, e os cavalos
 * passavam a existir em duplicidade. A família é declarada por tipo de
 * equipamento e não conta quantas abas foram lidas.
 */
export const DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO = "REMUNERACAO_EQUIPAMENTO";

/**
 * O quadro de lotação de pessoal — administrativo e operacional, uma família.
 *
 * **Por que não a mesma família do equipamento.** A identidade da vigência é
 * (sistema, família, canal, data, escopo). Sem família própria, um arquivo de
 * QLP da mesma unidade, mesma data e mesmo canal teria a mesma identidade da
 * remuneração de equipamento — e entraria como *revisão* dela, superpondo uma
 * vigência que fala de caminhão com uma que fala de gente. A família existe
 * para essa distinção; usá-la é o que impede a confusão, não uma formalidade.
 *
 * **Por que uma só para os dois QLPs.** Pelo mesmo argumento que junta CAVALO e
 * CARRETA: os dois arquivos descrevem o mesmo quadro da mesma vigência, cada um
 * com uma parte da população. Em famílias separadas, cada um abriria a sua
 * vigência e nunca se reconheceriam como partes de um todo; na mesma, o segundo
 * entra como revisão que herda os fatos do primeiro — a máquina de fato herdado
 * (`0017`) foi escrita exatamente para o arquivo parcial.
 */
export const DATASET_FAMILY_QUADRO_DE_PESSOAL = "QUADRO_DE_PESSOAL";

const FAMILY_BY_ENTITY_TYPE: Record<string, string> = {
  CAVALO: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  CARRETA: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
  QLP_ADMINISTRATIVO: DATASET_FAMILY_QUADRO_DE_PESSOAL,
  QLP_OPERACIONAL: DATASET_FAMILY_QUADRO_DE_PESSOAL,
};

/**
 * A família a que um tipo de equipamento pertence.
 *
 * Um tipo ainda não mapeado cai na família de remuneração de equipamento. O
 * padrão é deliberadamente *inclusivo*: um equipamento novo (um DOLLY, digamos)
 * tem de entrar como componente da vigência que já existe, e não abrir uma
 * segunda identidade ativa para a mesma data — que é exatamente a falha que
 * este módulo fecha.
 *
 * O espelho em SQL (`freightcheck_dataset_family`, na `0015`) devolve a família
 * de equipamento para qualquer entrada, e continua assim de propósito: ele
 * serve ao *backfill* daquela migration, sobre uma base que só tinha
 * equipamento. Quem decide daqui para frente é esta função — a coluna
 * `snapshot.dataset_family` é escrita por ela, e a chave canônica gerada pelo
 * banco lê a coluna, não a função.
 */
export function datasetFamilyFor(entityType: string): string {
  return (
    FAMILY_BY_ENTITY_TYPE[entityType.trim().toUpperCase()] ??
    DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO
  );
}

/** A família de um conjunto de tipos. Erro se o run misturar famílias. */
export function datasetFamilyOfSet(entityTypes: readonly string[]): string {
  const families = [...new Set(entityTypes.map(datasetFamilyFor))].sort();
  if (families.length === 0) return DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO;
  if (families.length > 1) {
    throw new Error(
      `Uma mesma vigência não pode misturar famílias de dataset: ${families.join(", ")}.`,
    );
  }
  return families[0];
}

// ---------------------------------------------------------------------------
// Normalizações de texto
// ---------------------------------------------------------------------------

/**
 * Acentos fora, para que "Camaçari" e "CAMACARI" sejam o mesmo código.
 *
 * NFD separa a letra do diacrítico; a faixa ̀-ͯ é o diacrítico.
 */
function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Um identificador técnico reduzido ao que ele de fato identifica.
 *
 * `ABC-1D23`, `abc1d23` e ` ABC 1D23 ` são a mesma placa. O valor como veio
 * escrito continua guardado à parte, em `staged_fact.entity_key_raw` e no RAW —
 * normalizar a identidade não é apagar a evidência.
 */
export function normalizeIdentifier(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return stripAccents(String(raw))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Placa: mesma regra dos demais identificadores técnicos. */
export const normalizePlaca = normalizeIdentifier;

/** Chassi: idem. */
export const normalizeChassi = normalizeIdentifier;

/**
 * CNPJ/CPF reduzido a dígitos, com os zeros à esquerda de volta.
 *
 * O Excel entrega CNPJ ora como texto mascarado (`12.345.678/0001-90`), ora
 * como número — e como número ele perde o zero da frente, virando 13 dígitos.
 * Os dois são a mesma empresa e não podem produzir escopos diferentes. O
 * preenchimento só acontece nas faixas que correspondem a um documento
 * plausível; qualquer outro comprimento fica como está, porque inventar dígito
 * é pior do que não reconhecer.
 */
export function normalizeDocumento(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits === "") return "";
  if (digits.length >= 12 && digits.length <= 14) return digits.padStart(14, "0");
  if (digits.length >= 9 && digits.length <= 11) return digits.padStart(11, "0");
  return digits;
}

/**
 * Um código de escopo, normalizado conforme o tipo.
 *
 * UNIDADE e OPERADOR chegam como CNPJ e são tratados como documento. REGIONAL é
 * um nome livre: caixa, acentos, pontuação e espaço repetido saem, o resto
 * fica.
 */
export function normalizeScopeCode(
  scopeType: string,
  raw: string | null | undefined,
): string {
  const type = scopeType.trim().toUpperCase();
  if (type === "UNIDADE" || type === "OPERADOR") return normalizeDocumento(raw);
  if (raw === null || raw === undefined) return "";
  return stripAccents(String(raw))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * O canal da vigência, em forma canônica.
 *
 * O canal faz parte da identidade: EMPURRADA e ROTA na mesma data são duas
 * realidades de negócio, e fundi-las seria tão errado quanto duplicá-las. Vem
 * do rótulo porque é lá que a origem o declara — ver `vigencia.ts`.
 */
export function normalizeChannel(channel: string | null | undefined): string {
  if (channel === null || channel === undefined) return "";
  return stripAccents(String(channel))
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ---------------------------------------------------------------------------
// Escopo canônico
// ---------------------------------------------------------------------------

export interface ScopeEntry {
  scopeType: string;
  code: string;
}

/**
 * Os tipos de escopo sem os quais uma vigência não tem identidade.
 *
 * Faltando UNIDADE não se sabe *de quem* é a remuneração, e duas vigências de
 * unidades diferentes passariam a ter a mesma chave. O pipeline recusa a
 * promoção nesse caso (VALIDATION_ERROR) em vez de promover algo que não sabe
 * identificar — ver `promote`.
 */
export const REQUIRED_SCOPE_TYPES = ["UNIDADE"] as const;

/**
 * O escopo em forma canônica: normalizado, sem vazios, sem repetição, ordenado.
 *
 * A ordem é fixada aqui porque o hash é calculado sobre a serialização: sem
 * ordenar, o mesmo escopo lido em outra ordem de linhas daria outro hash — e
 * outra identidade.
 */
export function canonicalScopeOf(entries: readonly ScopeEntry[]): ScopeEntry[] {
  const byKey = new Map<string, ScopeEntry>();
  for (const entry of entries) {
    const scopeType = entry.scopeType.trim().toUpperCase();
    const code = normalizeScopeCode(scopeType, entry.code);
    if (scopeType === "" || code === "") continue;
    byKey.set(`${scopeType}${SEP_PAIR}${code}`, { scopeType, code });
  }
  // Ordem por unidade de código, e não `localeCompare`: o espelho SQL ordena
  // com `COLLATE "C"`, que é ordem de byte. Uma colação linguística
  // (pt-BR, en) põe "CAMACARI" e "CAMAÇARI" em ordens diferentes das do byte, e
  // o hash dos dois lados deixaria de bater — em produção, não no teste.
  return [...byKey.values()].sort((a, b) => {
    if (a.scopeType !== b.scopeType) return a.scopeType < b.scopeType ? -1 : 1;
    if (a.code === b.code) return 0;
    return a.code < b.code ? -1 : 1;
  });
}

/**
 * O escopo canônico como `jsonb`, que é a forma **guardada**.
 *
 * Serve à auditoria e à consulta ("quais vigências têm este CNPJ no escopo?").
 * Não é o que entra no hash: ver `serializeCanonicalScope`.
 */
export function canonicalScopeJson(
  scope: readonly ScopeEntry[],
): { scopeType: string; code: string }[] {
  return scope.map((s) => ({ scopeType: s.scopeType, code: s.code }));
}

/**
 * A serialização estável do escopo canônico — a forma que entra no hash.
 *
 * Não é JSON de propósito. O hash tem de ser calculado *identicamente* pelo
 * TypeScript e pelo Postgres, e a representação textual de `jsonb` é do
 * servidor: espaço depois da vírgula, ordem das chaves e escape de unicode são
 * decisões dele, que mudam entre versões. Um separador de controle não tem
 * nenhuma dessas ambiguidades e se reproduz com um `string_agg` de três linhas.
 *
 * US/RS não podem ocorrer nos componentes: `scopeType` e `code` já saíram de
 * `normalizeScopeCode` reduzidos a `[A-Z0-9 ]`.
 */
export function serializeCanonicalScope(scope: readonly ScopeEntry[]): string {
  return scope
    .map((s) => `${s.scopeType}${SEP_PAIR}${s.code}`)
    .join(SEP_ENTRY);
}

/** Os tipos obrigatórios que faltam num escopo já canonizado. */
export function missingRequiredScopeTypes(
  scope: readonly ScopeEntry[],
): string[] {
  const present = new Set(scope.map((s) => s.scopeType));
  return REQUIRED_SCOPE_TYPES.filter((t) => !present.has(t));
}

// ---------------------------------------------------------------------------
// A chave canônica
// ---------------------------------------------------------------------------

export interface CanonicalSnapshotIdentity {
  sourceSystem: string;
  datasetFamily: string;
  channel: string;
  /** `YYYY-MM-DD`, já derivada e validada. */
  effectiveDate: string;
  scope: readonly ScopeEntry[];
}

/**
 * A chave canônica de uma vigência.
 *
 * Não entra aqui: nome do arquivo, sha do arquivo, rótulo literal, número de
 * abas, quantidade de linhas. Entra só o que descreve a realidade de negócio.
 *
 * O separador é US (`\u001f`) porque não pode ocorrer em nenhum dos componentes —
 * com `|`, um código de regional contendo `|` poderia empurrar bytes de um
 * campo para o outro e fazer duas identidades diferentes colidirem.
 */
export function canonicalSnapshotKey(
  identity: CanonicalSnapshotIdentity,
): string {
  const scope = canonicalScopeOf(identity.scope);
  const canonical = [
    identity.sourceSystem.trim().toUpperCase(),
    identity.datasetFamily.trim().toUpperCase(),
    normalizeChannel(identity.channel),
    identity.effectiveDate,
    serializeCanonicalScope(scope),
  ].join(SEP_FIELD);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// O hash canônico do conteúdo
// ---------------------------------------------------------------------------

/**
 * Um fato reduzido ao que ele afirma, sem nada de como ele chegou.
 *
 * `rawCellId`, número da linha, nome da aba e ordem de leitura ficam de fora de
 * propósito: dois XLSX diferentes que digam os mesmos fatos têm de dar o mesmo
 * hash. É o que permite reconhecer "o arquivo é outro, mas o dado é o mesmo" e
 * não abrir uma revisão vazia.
 */
export interface CanonicalFact {
  entityType: string;
  entityKey: string;
  attributeCode: string;
  valueNumeric?: string | number | null;
  valueText?: string | null;
  valueBoolean?: boolean | null;
  valueDate?: string | null;
  isNull?: boolean | null;
}

/**
 * Atributos cujo **valor** é uma identidade, e não um número de negócio.
 *
 * O hash de conteúdo compara o que o dado afirma, e um CNPJ afirma a mesma
 * empresa esteja ele mascarado ou não; uma placa afirma o mesmo veículo com ou
 * sem hífen. Sem isto, reenviar a mesma vigência com o CNPJ escrito de outro
 * jeito não seria reconhecido como dado igual — seria tratado como correção, e
 * abriria uma revisão que não corrige nada.
 *
 * O sufixo é o código do atributo sem o prefixo do equipamento:
 * `cavalo.unidade_cnpj` -> `unidade_cnpj`. É a mesma chave que o escopo usa em
 * `SCOPE_COLUMNS`, e as duas listas descrevem as mesmas colunas.
 */
const VALOR_E_IDENTIDADE: Record<string, (v: string | null | undefined) => string> = {
  unidade_cnpj: normalizeDocumento,
  operador_cnpj: normalizeDocumento,
  unidade_regional: (v) => normalizeScopeCode("REGIONAL", v),
  chassi: normalizeIdentifier,
  placa: normalizeIdentifier,
  placa_carreta: normalizeIdentifier,
};

/** O token único do nulo — um só, para que null e "" não se confundam. */
const NULL_TOKEN = "\u0000NULL";

/**
 * Um número em forma canônica.
 *
 * `1.50`, `1.5` e `1.500` são o mesmo número e não podem gerar hashes
 * diferentes. Zeros à direita saem, o sinal de zero negativo some, e o que não
 * é numérico volta como texto normalizado — porque errar para "não reconheci" é
 * melhor do que errar para "são iguais".
 */
export function normalizeNumber(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return NULL_TOKEN;
  const text = String(value).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
    return normalizeText(text);
  }
  const asNumber = Number(text);
  if (!Number.isFinite(asNumber)) return normalizeText(text);
  if (asNumber === 0) return "0";
  // `toFixed(12)` fixa a precisão antes de cortar os zeros, de modo que a
  // representação não dependa de o valor ter chegado como texto ou como número.
  let out = asNumber.toFixed(12);
  out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out === "-0" ? "0" : out;
}

/** Texto em forma canônica: sem acento fora do lugar, sem espaço sobrando. */
export function normalizeText(value: string | null | undefined): string {
  if (value === null || value === undefined) return NULL_TOKEN;
  const out = String(value).normalize("NFC").replace(/\s+/g, " ").trim();
  return out === "" ? NULL_TOKEN : out;
}

/** Data em forma canônica: `YYYY-MM-DD`, sem hora e sem fuso. */
export function normalizeDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return NULL_TOKEN;
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : normalizeText(text);
}

/** Booleano em forma canônica. */
export function normalizeBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return NULL_TOKEN;
  return value ? "true" : "false";
}

/**
 * A linha canônica de um fato: identidade + valor, nada mais.
 *
 * A identidade da entidade entra *normalizada* — `ABC-1D23` e `abc1d23` são a
 * mesma entidade e têm de cair na mesma linha.
 */
function canonicalFactLine(fact: CanonicalFact): string {
  const identity = [
    fact.entityType.trim().toUpperCase(),
    normalizeIdentifier(fact.entityKey),
    fact.attributeCode.trim().toLowerCase(),
  ].join(SEP_FIELD);
  const sufixo = fact.attributeCode.trim().toLowerCase().split(".").slice(1).join(".");
  const comoIdentidade = VALOR_E_IDENTIDADE[sufixo];
  const value = fact.isNull
    ? NULL_TOKEN
    : comoIdentidade
      ? comoIdentidade(
          fact.valueText ??
            (fact.valueNumeric === null || fact.valueNumeric === undefined
              ? null
              : String(fact.valueNumeric)),
        ) || NULL_TOKEN
      : [
          normalizeNumber(fact.valueNumeric ?? null),
          normalizeText(fact.valueText ?? null),
          normalizeBoolean(fact.valueBoolean ?? null),
          normalizeDate(fact.valueDate ?? null),
        ].join(SEP_FIELD);
  return `${identity}${SEP_FIELD}${value}`;
}

/**
 * O hash canônico de um conjunto de fatos.
 *
 * Ordenar antes de somar é o que torna o hash independente da ordem das linhas
 * e das abas. Dois fatos que colapsem na mesma linha canônica contam uma vez só
 * — se eles *discordarem*, quem barra é a validação de staging, não este hash,
 * que não deve ter opinião sobre conflito.
 */
export function canonicalPayloadHash(facts: readonly CanonicalFact[]): string {
  const lines = [...new Set(facts.map(canonicalFactLine))].sort();
  const digest = createHash("sha256");
  for (const line of lines) {
    digest.update(line, "utf8");
    digest.update(SEP_LINE, "utf8");
  }
  return digest.digest("hex");
}
