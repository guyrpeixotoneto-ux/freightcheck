import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  codigoDoPostgres,
  aplicarConfirmacoesCanonicas,
  garantirSemanticaInicial,
  garantirClasseDeCustoPadrao,
  garantirTaxonomiaCanonica,
  attributeAliasTable,
  attributeTable,
  columnMappingTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importDecisionTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  scopeTable,
  sentinelRuleTable,
  snapshotAttributeTable,
  snapshotEntityTypeTable,
  snapshotMergeTable,
  snapshotScopeTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
  validationIssueTable,
} from "@workspace/db";
import {
  columnLetter,
  deriveEntityType,
  foldText,
  readCell,
  readWorkbook,
  sheetRange,
  slugifyColumn,
  type SheetPlan,
} from "./workbook";
import {
  classifyEntityType,
  conferirDeclaracao,
  novasIdentidades,
  type IdentityDecision,
  type KnownEntityType,
} from "./identity";
import { parseVigenciaLabel } from "./vigencia";
import {
  canonicalPayloadHash,
  canonicalScopeOf,
  canonicalSnapshotKey,
  datasetFamilyOfSet,
  missingRequiredScopeTypes,
  normalizeChannel,
  normalizeDocumento,
  normalizeIdentifier,
  type CanonicalFact,
  type ScopeEntry,
} from "./canonical-identity";
import { typeCell, type SentinelRule, type SourceCell } from "./values";
import {
  COLUNA_DE_VIGENCIA,
  COLUNAS_IDENTIFICADORAS,
  SEPARADOR_LEGIVEL,
  identidadeNoCabecalho,
  tipoDeImportacao,
  type ColunaIdentificadora,
  type DefinicaoDeTipo,
} from "./tipos";
import {
  impedePromocao,
  isolaAChave,
  type ApresentacaoDeApontamento,
  type CampoDeRegistro,
  type OndeDoApontamento,
} from "./apontamentos";

/**
 * F1 — ingestion.
 *
 * The pipeline is deliberately five explicit steps rather than one call:
 * receive, capture RAW, stage, preview, promote. A human decision sits
 * between preview and promote, and promote is the only step that touches the
 * canonical layer — inside a single transaction.
 */

/**
 * As colunas que viram estrutura em vez de fato.
 *
 * A vigência é de todo tipo; a identidade é **do** tipo — placa no cavalo e na
 * carreta, `chaveTrecho` no trecho, unidade + cargo (+ turno) no quadro de
 * pessoal —, e por isso ela vem de `tipos.ts`, onde mora junto do tipo a que
 * pertence. Ver a nota do grão em `workbook.ts` para o que a regra antiga
 * custava.
 *
 * **Uma coluna de escopo identifica sem deixar de ser fato.** `Unidade - CNPJ`
 * é metade da chave do QLP e é de onde `resolveScopes` tira a unidade da
 * vigência — e ele lê escopo dos fatos. Tirá-la dos fatos faria a promoção
 * recusar, por unidade ausente, um arquivo em que a unidade está escrita em
 * toda linha.
 */
const GRAIN_COLUMNS = {
  vigencia: COLUNA_DE_VIGENCIA,
} as const;

/** As colunas que, ao virar chave, deixam de ser fato. Ver acima. */
const SO_CHAVE_FOLDED = new Set(
  COLUNAS_IDENTIFICADORAS.filter((c) => c.tambemEhFato !== true).map((c) => c.folded),
);

/**
 * A chave de uma linha, a partir dos valores das colunas de identidade.
 *
 * As partes entram normalizadas e emendadas sem separador, porque `entity_key`
 * precisa sobreviver a `freightcheck_norm_identificador` sem mudar: a
 * normalização já rodou uma vez sobre a base inteira (`0015`), e uma chave que
 * mudasse ao ser normalizada de novo fundiria entidades hoje distintas. O CNPJ
 * entra com 14 dígitos fixos, o que mantém a emenda legível pela posição.
 *
 * A forma legível vai para `entity_key_raw`, e de lá para
 * `entity_identifier.identifier_value_raw` — que existe exatamente para isto:
 * "o identificador como veio escrito. Evidência, não identidade."
 */
function chaveDaLinha(
  partes: { coluna: ColunaIdentificadora; valor: string }[],
): { chave: string; legivel: string } {
  return {
    chave: partes
      .map(({ coluna, valor }) =>
        coluna.normalizacao === "DOCUMENTO"
          ? normalizeDocumento(valor)
          : normalizeIdentifier(valor),
      )
      .join(""),
    legivel: partes.map((p) => p.valor).join(SEPARADOR_LEGIVEL),
  };
}

/** Organisational scope carried by every source row. */
const SCOPE_COLUMNS: Record<string, { scopeType: string; nameColumn?: string }> =
  {
    "unidade - cnpj": { scopeType: "UNIDADE", nameColumn: "unidade - nome" },
    "operador - cnpj": { scopeType: "OPERADOR", nameColumn: "operador - nome" },
    "unidade - regional": { scopeType: "REGIONAL" },
  };

/**
 * Values that look like "not applicable" but have no confirmed rule yet.
 * Their only effect is a warning: blanking them without confirmation would
 * quietly change every average computed downstream.
 */
const SUSPECTED_SENTINELS = ["-1"];

/**
 * O motivo que fica gravado quando a pré-visualização recusa a promoção.
 *
 * Era uma frase fixa, escrita para o único impedimento que existia na época: a
 * mesma entidade duas vezes na mesma vigência com valores diferentes. Com a
 * conferência do tipo declarado passaram a ser dois, e repetir a frase da
 * duplicidade em cima de uma divergência de tipo mandaria corrigir o que não
 * está errado — daí cada impedimento escrever o seu, a partir do próprio
 * problema (`sample` é a mensagem que a staging gravou).
 *
 * A duplicidade saiu daqui depois: ela não impede mais promover, retira a
 * chave e deixa o arquivo entrar. O que sobrou são os dois impedimentos de
 * tipo — e a frase fixa, se voltasse, seria de novo a frase errada, agora
 * mandando corrigir uma duplicidade que já foi tratada sozinha.
 */
function motivoDoImpedimento(
  impeditivas: { code: string; count: number; sample: string }[],
): string {
  const frases = impeditivas.map((issue) => {
    if (issue.code === "ABA_REBAIXADA_COM_TIPO_DECLARADO") {
      return (
        `${issue.sample} Nada desta importação foi aproveitado como fato. A causa ` +
        `mais comum é a origem ter renomeado uma coluna estrutural (Vigência, ou as ` +
        `colunas de identidade). Confira o arquivo contra o export anterior antes de reenviar.`
      );
    }
    if (issue.code === "TIPO_DIVERGE_DA_DECLARACAO") {
      return (
        `${issue.sample} Nada foi importado: envie o arquivo pela aba do tipo certo, ` +
        `ou confira se este é mesmo o arquivo que você queria enviar.`
      );
    }
    return issue.sample;
  });
  return frases.join(" ");
}

/**
 * O valor de uma linha staged, como a planilha o escreveria.
 *
 * A recusa por conflito diz que duas linhas discordam, e dizer **em quê**
 * exige mostrar os dois valores lado a lado. O staged guarda o valor tipado em
 * quatro colunas; aqui ele volta a ser uma palavra só, legível na frase.
 */
function valorStaged(row: Record<string, unknown>): string {
  if (row.isNull === true) return "vazio";
  if (row.valueNumeric != null) {
    const s = String(row.valueNumeric);
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  }
  if (row.valueText != null) return `"${row.valueText}"`;
  if (row.valueBoolean != null) return row.valueBoolean === true ? "verdadeiro" : "falso";
  if (row.valueDate != null) return String(row.valueDate);
  return "vazio";
}

/** "12", "12 e 87", "12, 87 e 90" — a enumeração como se escreve. */
function listarComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Onde as linhas repetidas estão, dito como quem abre a planilha procura:
 * "nas linhas 12 e 87 da aba \"Planilha1\"". Agrupado por aba porque a colisão
 * pode atravessar abas — e aí dizer só os números mandaria abrir a errada.
 */
function nomearOrigens(origens: { aba: string; linha: number }[]): string {
  const porAba = new Map<string, number[]>();
  for (const origem of origens) {
    const linhas = porAba.get(origem.aba) ?? [];
    if (!linhas.includes(origem.linha)) linhas.push(origem.linha);
    porAba.set(origem.aba, linhas);
  }
  return [...porAba.entries()]
    .map(([aba, linhas]) =>
      linhas.length === 1
        ? `na linha ${linhas[0]} da aba "${aba}"`
        : `nas linhas ${listarComE(linhas.map(String))} da aba "${aba}"`,
    )
    .join(" e ");
}

/** As mesmas origens, agrupadas por aba, na forma que a seção "Onde" desenha. */
function ondeDasOrigens(
  origens: { aba: string; linha: number }[],
): OndeDoApontamento[] {
  const porAba = new Map<string, number[]>();
  for (const origem of origens) {
    const linhas = porAba.get(origem.aba) ?? [];
    if (!linhas.includes(origem.linha)) linhas.push(origem.linha);
    porAba.set(origem.aba, linhas);
  }
  return [...porAba.entries()].map(([aba, linhas]) => ({ aba, linhas }));
}

/**
 * Os campos que identificam o registro, com os nomes que a planilha usa.
 *
 * A forma legível da chave ("07.526.557/0015-05 · CONFERENTE") já é melhor que
 * a normalizada, mas ainda obriga quem lê a saber o que cada pedaço é. As
 * colunas de identidade do tipo sabem: elas têm `sourceName` — "Unidade -
 * CNPJ", "Cargo" — e vêm na mesma ordem em que a chave foi emendada. Quando o
 * tipo não está na lista (um equipamento novo) ou a chave veio de outra versão
 * com outro número de partes, a chave legível inteira fica sob um rótulo só,
 * que ainda é honesto: é o registro, sem nome de campo.
 */
function registroDoTipo(entityType: string, legivel: string): CampoDeRegistro[] {
  const partes = legivel.split(SEPARADOR_LEGIVEL);
  const identidade = tipoDeImportacao(entityType)?.identidade ?? [];
  if (identidade.length > 0 && identidade.length === partes.length) {
    return identidade.map((coluna, i) => ({
      campo: coluna.sourceName,
      valor: partes[i],
    }));
  }
  return [{ campo: "Registro", valor: legivel }];
}

/** Como cada tipo interno de valor se chama numa frase. */
const NOME_DO_TIPO_DE_VALOR: Record<string, string> = {
  NUMERIC: "número",
  TEXT: "texto",
  DATE: "data",
  BOOLEAN: "sim/não",
};

/**
 * As seções fixas de cada aviso de célula.
 *
 * `values.ts` escreve a frase (o resumo) porque é lá que o caso é entendido;
 * título, correção e motivo não variam por célula e por isso moram aqui, onde
 * a frase vira apontamento. Sem isto, o grupo destes avisos aparecia na tela
 * com o código cru como título — exatamente o jargão que a leitura principal
 * não pode ter.
 */
const AVISO_DE_CELULA: Record<
  string,
  { titulo: string; comoCorrigir?: string; porQueImporta: string }
> = {
  ERROR_CELL: {
    titulo: "Uma célula não pôde ser lida",
    comoCorrigir:
      "Abra a célula indicada e corrija o valor — o erro (#REF!, #DIV/0!…) está " +
      "na própria planilha. Enquanto isso, o valor conta como vazio.",
    porQueImporta:
      "Um erro de célula não é um valor: entrar como zero inventaria dado; " +
      "entrar como vazio, marcado, mantém a conta honesta.",
  },
  DATE_WITH_TIME_COMPONENT: {
    titulo: "Uma data veio com horário",
    comoCorrigir:
      "Nada a corrigir se o horário é intencional. Se a coluna devia ter só " +
      "datas, ajuste o formato das células na origem.",
    porQueImporta: "Cortar o horário perderia informação que a coluna carrega.",
  },
  AMBIGUOUS_DATE_SERIAL: {
    titulo: "Um número parece ser uma data",
    comoCorrigir:
      "Se a coluna é de datas, formate as células como data na planilha e envie " +
      "de novo. Se é número mesmo, nada a fazer — a curadoria decide.",
    porQueImporta:
      "Converter por palpite trocaria um número real por uma data inventada.",
  },
  SUSPECTED_SENTINEL: {
    titulo: 'Um valor pode significar "não se aplica"',
    comoCorrigir:
      'Se o valor marca mesmo "não se aplica", confirme a regra na curadoria; ' +
      "se é um valor real, nada a fazer.",
    porQueImporta:
      "Tratar o valor como ausência sem regra confirmada mudaria médias e " +
      "totais em silêncio.",
  },
};

/** Postgres caps a statement at 65535 bound parameters. */
const INSERT_CHUNK = 1_000;

async function insertChunked<T extends Record<string, unknown>>(
  db: Database,
  table: Parameters<Database["insert"]>[0],
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db
      .insert(table)
      .values(rows.slice(i, i + INSERT_CHUNK) as never)
      .execute();
  }
}

async function insertChunkedReturning<
  T extends Record<string, unknown>,
  R extends Record<string, unknown>,
>(
  db: Database,
  table: Parameters<Database["insert"]>[0],
  rows: T[],
  returning: R,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const batch = await db
      .insert(table)
      .values(rows.slice(i, i + INSERT_CHUNK) as never)
      .returning(returning as never);
    out.push(...(batch as Record<string, unknown>[]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 1 — receive
// ---------------------------------------------------------------------------

export interface ReceiveResult {
  sourceFileId: string;
  importRunId: string;
  /** True when these exact bytes were already received before. */
  isDuplicate: boolean;
  contentSha256: string;
}

export interface ReceiveOptions {
  filePath: string;
  filename?: string;
  receivedBy?: string;
  /**
   * O tipo que quem envia declarou — a aba da tela em que ele escolheu enviar.
   *
   * Opcional, e o que ele muda é a *conferência*, não a dedução: a staging
   * continua classificando cada aba pelo conteúdo dela, e compara as duas
   * respostas. Ausente, tudo se passa como antes. Ver {@link conferirDeclaracao}.
   */
  declaredType?: string | null;
}

/**
 * A declaração conferida antes de qualquer coisa acontecer.
 *
 * Duas recusas, e as duas antes de gravar. A primeira é um código que não é
 * tipo nenhum — cliente desatualizado, endereço montado à mão. A segunda é um
 * tipo que a lista nomeia e cujo grão ainda não foi declarado: nenhum está
 * assim hoje, e a recusa existe para que o dia em que um estiver não seja
 * descoberto por um arquivo que entrou, foi aprovado e não produziu fato
 * nenhum — que foi exatamente o que aconteceu com a primeira planilha de
 * trecho, com zero erro e zero aviso.
 */
export function exigirTipoDeclarado(declaredType: string): DefinicaoDeTipo {
  const tipo = tipoDeImportacao(declaredType);
  if (tipo === null) {
    throw new Error(
      `"${declaredType}" não é um tipo de importação conhecido. Escolha uma das abas da tela de Importações.`,
    );
  }
  if (tipo.identidade.length === 0) {
    throw new Error(
      `${tipo.rotulo} ainda não pode ser importado: o pipeline não sabe o que identifica uma linha desse tipo, ` +
        `e sem isso o arquivo entraria sem produzir fato nenhum.`,
    );
  }
  return tipo;
}

/**
 * Register a file and open a processing attempt.
 *
 * SHA-256 is the first line of idempotency defence; the snapshot business key
 * (see {@link promote}) is the second, and catches the case where the same
 * vigência arrives inside a differently-encoded file.
 *
 * O reenvio idêntico é **sempre** recusado aqui, e não há parâmetro que o
 * libere. Reler um arquivo que já entrou é uma decisão de outra natureza — não
 * "recebi de novo", e sim "o leitor mudou" — e ela tem porta própria, com
 * motivo obrigatório e procedência gravada: {@link reprocessImportRun}. Um
 * booleano nesta função faria as duas caberem na mesma chamada, e a diferença
 * entre elas sumiria do histórico exatamente quando ele mais é lido.
 */
export async function receiveFile(
  db: Database,
  options: ReceiveOptions,
): Promise<ReceiveResult> {
  // Antes de ler os bytes: um tipo recusado não deve deixar rastro de arquivo.
  const declarado =
    options.declaredType == null || options.declaredType.trim() === ""
      ? null
      : exigirTipoDeclarado(options.declaredType);

  const bytes = readFileSync(options.filePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = options.filename ?? options.filePath.split("/").pop()!;

  // Tentar gravar primeiro, e deduzir a duplicata de *não ter gravado*.
  //
  // Antes eram um SELECT e um INSERT separados, sem transação. Dois envios
  // simultâneos do mesmo arquivo liam "não existe" os dois, os dois inseriam, e
  // o perdedor recebia 23505 do índice único — que ninguém tratava, e virava
  // 500. O banco nunca duplicou a linha; o que estava errado era a resposta.
  //
  // `ON CONFLICT DO NOTHING` faz o próprio banco decidir quem ganha, num
  // comando só: quem gravou recebe a linha de volta, quem não gravou recebe
  // nada e relê. Não há janela entre verificar e gravar, porque não há
  // verificação.
  const [created] = await db
    .insert(sourceFileTable)
    .values({
      filename,
      contentSha256,
      byteSize: statSync(options.filePath).size,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      storagePath: options.filePath,
      receivedBy: options.receivedBy ?? null,
    })
    .onConflictDoNothing({ target: sourceFileTable.contentSha256 })
    .returning();

  let sourceFileId: string;
  let isDuplicate: boolean;

  if (created) {
    sourceFileId = created.id;
    isDuplicate = false;
  } else {
    const [existing] = await db
      .select()
      .from(sourceFileTable)
      .where(eq(sourceFileTable.contentSha256, contentSha256));
    if (!existing) {
      // Não gravou e não encontra: o conflito foi com outra coisa que não o
      // sha, e engolir isso como "duplicata" esconderia um defeito real.
      throw new Error(
        `Não foi possível registrar o arquivo ${filename} (sha256 ${contentSha256.slice(0, 16)}…): a gravação foi recusada e nenhum registro anterior com esse conteúdo existe.`,
      );
    }
    sourceFileId = existing.id;
    isDuplicate = true;
  }

  // The attempt is recorded either way: a refused duplicate is an event worth
  // keeping, not a silent no-op.
  const [run] = await db
    .insert(importRunTable)
    .values({
      sourceFileId,
      status: isDuplicate ? "SKIPPED_DUPLICATE" : "PENDING",
      triggeredBy: options.receivedBy ?? null,
      failureReason: isDuplicate
        ? // Este texto vai direto para a tela de Importações, então é escrito
          // para quem opera, não para quem depura. O sha abreviado é o mesmo
          // que o card exibe, para o operador conseguir casar os dois.
          //
          // Ele diz o que **não** aconteceu — nenhuma célula foi lida — porque
          // o cartão ao lado mostra seis contadores zerados, e zero ao lado de
          // "arquivo já recebido" já foi lido como "o leitor não entendeu meu
          // arquivo". Não entendeu não: não abriu. A saída, quando o arquivo
          // precisa mesmo ser relido, é {@link reprocessImportRun}.
          `Este arquivo já havia sido recebido (sha256 ${contentSha256.slice(0, 16)}…). ` +
          `Nada foi lido desta vez: nenhuma aba, nenhuma célula e nenhum fato — o conteúdo é ` +
          `idêntico, byte a byte, ao de uma importação anterior, e a leitura nem chegou a começar. ` +
          `Se o leitor mudou desde aquela importação, use Reprocessar em vez de reenviar.`
        : null,
      finishedAt: isDuplicate ? new Date() : null,
      declaredType: declarado?.code ?? null,
    })
    .returning();

  await db.insert(importDecisionTable).values({
    importRunId: run.id,
    decisao: isDuplicate ? "DUPLICATA_DE_ARQUIVO" : "RECEBIDO",
    motivo: isDuplicate
      ? `Arquivo idêntico, byte a byte, a um já recebido (sha256 ${contentSha256.slice(0, 16)}…). O arquivo não foi aberto.`
      : `Arquivo recebido e registrado (sha256 ${contentSha256.slice(0, 16)}…).`,
    filename,
    contentSha256,
  });

  return { sourceFileId, importRunId: run.id, isDuplicate, contentSha256 };
}

// ---------------------------------------------------------------------------
// Step 1b — reprocessar um arquivo que já entrou
// ---------------------------------------------------------------------------

/**
 * Os estados em que um run ainda não terminou de ser decidido.
 *
 * É a mesma lista do índice parcial `import_run_leitura_aberta_uq` — e ela
 * está escrita duas vezes de propósito, aqui e na migration, pelo mesmo motivo
 * que `tipos.ts` explica: o banco não importa TypeScript. O que impede as duas
 * de discordarem não é a boa intenção, é `reprocessamento.test.ts`, que compara
 * esta lista com a definição real do índice no `pg_catalog`.
 */
export const ESTADOS_POR_DECIDIR = [
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
] as const;

/** Recusa de um pedido de reprocessamento. A frase é para quem opera. */
export class ReprocessamentoRecusado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReprocessamentoRecusado";
  }
}

export interface ReprocessOptions {
  /** Quem pediu — vai para `triggered_by` do run novo. */
  requestedBy?: string | null;
  /** Por que se está relendo. Obrigatório; ver {@link MOTIVO_MINIMO}. */
  reason: string;
  /**
   * O tipo declarado da releitura.
   *
   * Omitido, herda o do run relido — reprocessar por causa de uma correção no
   * leitor não deve exigir redeclarar o que já estava declarado. Informado,
   * **substitui**, e é essa a porta do caso que originou tudo isto: o arquivo
   * de QLP que entrou sem declaração nenhuma, quando a tela ainda não tinha a
   * aba, e cuja releitura precisa dizer o que ele é.
   *
   * `null` explícito relê sem declaração, deixando a dedução do conteúdo
   * decidir sozinha — o comportamento anterior à declaração.
   */
  declaredType?: string | null;
}

export interface ReprocessResult {
  /** O run novo, em PENDING, esperando `captureRaw`. */
  importRunId: string;
  /**
   * O run que ele relê — a leitura mais recente deste arquivo que abriu o
   * arquivo, que nem sempre é o run pelo qual o pedido chegou.
   */
  reprocessOfRunId: string;
  sourceFileId: string;
  contentSha256: string;
  filename: string;
  declaredType: string | null;
}

/** Um motivo tem de ser uma frase, não um espaço em branco para pular a porta. */
export const MOTIVO_MINIMO = 12;

/**
 * Reler um arquivo já recebido, porque o leitor mudou desde a primeira vez.
 *
 * ---------------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------------
 * O SHA-256 responde *este arquivo já entrou?* antes de abrir o arquivo, e é
 * ele que impede o reenvio acidental virar dado em dobro. O que ele não
 * distingue é a pergunta que só aparece com o tempo: **o leitor mudou desde
 * então?** Para o Postgres as duas situações são a mesma linha em
 * `source_file`, e a resposta era a mesma recusa.
 *
 * Aconteceu com o QLP. Uma planilha de quadro de pessoal entrou quando o
 * pipeline ainda exigia `vigencia` + `placa` para uma aba virar fonte de fatos.
 * Sem placa, a aba caiu como PIVOT: células gravadas, zero fato, zero erro,
 * zero aviso — o arquivo entrou mudo. Dias depois o leitor aprendeu o grão do
 * QLP (`tipos.ts`), e aí o mesmo arquivo, reenviado, batia no SHA-256. A defesa
 * contra o reenvio acidental tinha virado tranca contra a releitura legítima, e
 * a única saída era excluir o histórico e reenviar — apagar a evidência de que
 * o arquivo chegou no dia em que chegou, para poder lê-lo de novo.
 *
 * ---------------------------------------------------------------------------
 * O que um reprocessamento é, e o que ele não é
 * ---------------------------------------------------------------------------
 * É um `import_run` **novo** sobre o **mesmo** `source_file`. Não é um run
 * reaberto, não é um UPDATE, não é uma exclusão seguida de reenvio:
 *
 * - o **recebimento original continua intacto** — mesmo id, mesmos contadores,
 *   mesmas células RAW, mesmas vigências, mesmo `received_at`;
 * - o **arquivo não é duplicado** — um `source_file`, um sha, um arquivo em
 *   disco, quantas leituras forem precisas. Este é o motivo de a função receber
 *   um run e não um caminho: o byte já está guardado, e reenviá-lo abriria
 *   espaço para relerem outra coisa sob o mesmo nome;
 * - o run novo **diz de quem é releitura e por quê** (`reprocess_of_run_id`,
 *   `reprocess_reason`), e as duas colunas viajam juntas por CHECK do banco.
 *
 * ---------------------------------------------------------------------------
 * O que ele deliberadamente não faz: publicar
 * ---------------------------------------------------------------------------
 * Ele para em PENDING e entrega o id. A esteira é a mesma de sempre —
 * `captureRaw` → `stage` → `preview` —, e ela termina em PREVIEWED. Promover
 * continua sendo {@link promote}, chamado por quem decide, depois de ler o
 * resumo. Reprocessar não pode publicar sozinho justamente porque ele existe
 * para o caso em que ninguém sabe ainda o que a nova leitura vai produzir.
 *
 * ---------------------------------------------------------------------------
 * O `:id` identifica o arquivo, não o alvo da releitura
 * ---------------------------------------------------------------------------
 * O pedido chega pelo run que estava na tela — e o mais provável de estar na
 * tela é a tentativa recusada, porque é nela que a pergunta nasce. O alvo é
 * calculado a partir daí: a leitura mais recente **daquele conteúdo** que de
 * fato abriu o arquivo. A corrente que sai disso é linear e legível
 * (recebimento → 1ª releitura → 2ª releitura), e nenhuma linha do banco afirma
 * que releu um run que não leu nada.
 *
 * ---------------------------------------------------------------------------
 * As três recusas
 * ---------------------------------------------------------------------------
 * 1. **Sem motivo.** Contornar a defesa contra dado em dobro não pode ser um
 *    clique a mais. A frase obrigatória é a fricção e é a auditoria.
 * 2. **Sem arquivo em disco.** Reler o que não está guardado seria inventar.
 * 3. **Com uma leitura já aberta.** No máximo um run por decidir por arquivo, e
 *    quem decide isso é o índice parcial `import_run_leitura_aberta_uq`, não um
 *    SELECT antes do INSERT — dois cliques no mesmo botão leem "não há nenhuma"
 *    os dois. A consulta daqui existe só para a recusa sair em português; a
 *    corrida perdida volta como 23505 e é traduzida na mesma frase.
 */
export async function reprocessImportRun(
  db: Database,
  /** Qualquer run do arquivo a reler — inclusive uma tentativa recusada. */
  importRunId: string,
  options: ReprocessOptions,
): Promise<ReprocessResult> {
  const motivo = (options.reason ?? "").trim();
  if (motivo.length < MOTIVO_MINIMO) {
    throw new ReprocessamentoRecusado(
      `Reprocessar exige o motivo da releitura, com pelo menos ${MOTIVO_MINIMO} caracteres — ` +
        `o que mudou desde a primeira leitura deste arquivo. Ele fica no histórico da importação, ` +
        `e é o que explica, daqui a meses, por que o mesmo arquivo foi lido duas vezes.`,
    );
  }

  const [pedido] = await db
    .select({
      id: importRunTable.id,
      sourceFileId: importRunTable.sourceFileId,
    })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));

  if (!pedido) {
    throw new ReprocessamentoRecusado(
      "Esta importação não existe — não há o que reler.",
    );
  }

  /*
    Quem é relido não é necessariamente o cartão de onde se clicou.

    O pedido chega pelo run que o operador tinha na tela, e o cartão mais
    provável de estar na tela é justamente o pior candidato a ser o alvo: a
    **tentativa recusada**, que é onde a frase "este arquivo já havia sido
    recebido" aparece e onde a pergunta "e agora?" nasce. Gravar
    `reprocess_of_run_id` apontando para ela seria escrever no banco que esta
    releitura relê um run que não leu nada — e a coluna diz, com todas as
    letras, *o run que este aqui releu*.

    Então o `:id` identifica o **arquivo**, e o alvo é calculado: a leitura mais
    recente daquele conteúdo que de fato abriu o arquivo. Isso dá uma corrente
    em vez de um leque — recebimento → 1ª releitura → 2ª releitura —, que é como
    a história se lê, e faz a recusa de exclusão (`planImportDeletion`) proteger
    o run que importa em vez de uma tentativa que não produziu nada.
  */
  const [anterior] = await db
    .select({
      id: importRunTable.id,
      sourceFileId: importRunTable.sourceFileId,
      declaredType: importRunTable.declaredType,
      startedAt: importRunTable.startedAt,
    })
    .from(importRunTable)
    .where(
      and(
        eq(importRunTable.sourceFileId, pedido.sourceFileId),
        ne(importRunTable.status, "SKIPPED_DUPLICATE"),
      ),
    )
    .orderBy(desc(importRunTable.startedAt))
    .limit(1);

  // Só sobra tentativa recusada: o arquivo entrou uma vez, aquele run foi
  // excluído, e o que restou é o registro de que alguém tentou reenviá-lo. Não
  // há leitura para reler, e a saída honesta é reenviar o arquivo.
  if (!anterior) {
    throw new ReprocessamentoRecusado(
      "Não há nenhuma leitura deste arquivo para reler — o histórico dele só tem tentativas " +
        "recusadas por duplicata, que não chegaram a abrir o arquivo. Envie o arquivo de novo " +
        "pela aba do tipo certo.",
    );
  }

  const [arquivo] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.id, anterior.sourceFileId));

  // O original é preservado byte a byte justamente para isto. Quando ele não
  // está lá, a resposta honesta é que o arquivo precisa ser reenviado — e não
  // uma releitura de um caminho que não abre.
  if (!arquivo || !existsSync(arquivo.storagePath)) {
    throw new ReprocessamentoRecusado(
      `O arquivo original de "${arquivo?.filename ?? "esta importação"}" não está mais guardado, ` +
        `e sem ele não há o que reler. Envie o arquivo de novo pela aba do tipo certo.`,
    );
  }

  /*
    A declaração da releitura.

    Herdar por omissão é o que faz o caso comum — "o leitor corrigiu as datas,
    releia" — não pedir que ninguém redigite o que já estava certo. Trocar por
    pedido explícito é o caso do QLP, em que a primeira leitura não tinha
    declaração nenhuma porque a aba ainda não existia.

    `exigirTipoDeclarado` é o mesmo guarda do envio: um tipo que a lista não
    conhece, ou que o pipeline ainda não sabe identificar, é recusado aqui —
    antes de abrir run — em vez de virar um arquivo que entra e não produz fato.
  */
  const declaracaoPedida =
    options.declaredType === undefined ? anterior.declaredType : options.declaredType;
  const declarado =
    declaracaoPedida === null || declaracaoPedida.trim() === ""
      ? null
      : exigirTipoDeclarado(declaracaoPedida);

  const abertos = await db
    .select({ id: importRunTable.id, status: importRunTable.status })
    .from(importRunTable)
    .where(
      and(
        eq(importRunTable.sourceFileId, anterior.sourceFileId),
        inArray(importRunTable.status, [...ESTADOS_POR_DECIDIR]),
      ),
    );

  if (abertos.length > 0) {
    throw new ReprocessamentoRecusado(recusaDeLeituraAberta(arquivo.filename));
  }

  let run: { id: string };
  try {
    [run] = await db
      .insert(importRunTable)
      .values({
        sourceFileId: anterior.sourceFileId,
        status: "PENDING",
        triggeredBy: options.requestedBy ?? null,
        declaredType: declarado?.code ?? null,
        reprocessOfRunId: anterior.id,
        reprocessReason: motivo,
      })
      .returning({ id: importRunTable.id });
  } catch (err) {
    // A corrida perdida. O índice parcial recusou o segundo INSERT, e o
    // operador que clicou duas vezes lê a mesma frase de quem chegou atrasado
    // — e não um 23505 com nome de índice dentro.
    if (codigoDoPostgres(err) === "23505") {
      throw new ReprocessamentoRecusado(recusaDeLeituraAberta(arquivo.filename));
    }
    throw err;
  }

  await db.insert(importDecisionTable).values({
    importRunId: run.id,
    decisao: "REPROCESSAMENTO",
    motivo:
      `Releitura do arquivo já recebido (sha256 ${arquivo.contentSha256.slice(0, 16)}…), ` +
      `pedida sobre a importação de ${anterior.startedAt.toISOString().slice(0, 10)}. ` +
      `Motivo declarado: ${motivo}`,
    filename: arquivo.filename,
    contentSha256: arquivo.contentSha256,
    detalhe: {
      reprocessOfRunId: anterior.id,
      declaredTypeAnterior: anterior.declaredType,
      declaredType: declarado?.code ?? null,
      motivo,
    },
  });

  return {
    importRunId: run.id,
    reprocessOfRunId: anterior.id,
    sourceFileId: anterior.sourceFileId,
    contentSha256: arquivo.contentSha256,
    filename: arquivo.filename,
    declaredType: declarado?.code ?? null,
  };
}

function recusaDeLeituraAberta(filename: string): string {
  return (
    `Já existe uma leitura em andamento de "${filename}" — ela precisa terminar, e ser aprovada ou ` +
    `excluída, antes de outra começar. Duas leituras simultâneas do mesmo arquivo disputariam a mesma ` +
    `vigência, e a segunda só descobriria isso depois de ler o arquivo inteiro.`
  );
}

// ---------------------------------------------------------------------------
// Step 2 — capture RAW
// ---------------------------------------------------------------------------

export interface CaptureRawResult {
  sheets: number;
  rows: number;
  cells: number;
  plans: SheetPlan[];
}

/**
 * Copy the workbook into the RAW layer, cell by cell.
 *
 * Pivot sheets are captured too — they are part of the evidence — but their
 * `role` keeps them out of the fact stream. For source sheets every column in
 * the header range is materialised even when the row has no cell there, so
 * that "the column exists and this asset has no value" (VALUE_MISSING) stays
 * distinguishable from "the column was never in the layout" and remains
 * traceable to a real coordinate.
 */
export async function captureRaw(
  db: Database,
  importRunId: string,
): Promise<CaptureRawResult> {
  const run = await requireRun(db, importRunId, ["PENDING"]);
  const [file] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.id, run.sourceFileId));

  await db
    .update(importRunTable)
    .set({ status: "READING" })
    .where(eq(importRunTable.id, importRunId));

  const { sheets: plans, workbook } = readWorkbook(file.storagePath);

  let totalRows = 0;
  let totalCells = 0;

  for (const plan of plans) {
    const [sheetRow] = await db
      .insert(rawSheetTable)
      .values({
        importRunId,
        sheetName: plan.name,
        sheetIndex: plan.index,
        rowCount: plan.rowCount,
        columnCount: plan.columnCount,
        role: plan.role,
        roleReason: plan.roleReason,
        headerRowIndex: plan.headerRowIndex,
      })
      .returning();

    const sheet = workbook.Sheets[plan.name];
    const range = sheetRange(sheet);
    if (!range) continue;

    const rowsToInsert: { rawSheetId: string; rowIndex: number; isHeader: boolean }[] =
      [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      rowsToInsert.push({
        rawSheetId: sheetRow.id,
        rowIndex: r + 1,
        isHeader: plan.role === "SOURCE" && r === range.s.r,
      });
    }

    const insertedRows = (await insertChunkedReturning(
      db,
      rawRowTable,
      rowsToInsert,
      { id: rawRowTable.id, rowIndex: rawRowTable.rowIndex },
    )) as { id: number; rowIndex: number }[];
    const rowIdByIndex = new Map(insertedRows.map((r) => [r.rowIndex, r.id]));
    totalRows += insertedRows.length;

    const cells: {
      rawRowId: number;
      columnIndex: number;
      columnLetter: string;
      columnHeader: string | null;
      rawValue: string | null;
      sourceType: string;
      formattedText: string | null;
    }[] = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const rawRowId = rowIdByIndex.get(r + 1)!;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = readCell(sheet, r, c);
        const header = plan.headers[c - range.s.c] ?? null;
        // Pivot sheets: keep only cells that actually exist.
        if (cell.type === "z" && plan.role !== "SOURCE") continue;
        cells.push({
          rawRowId,
          columnIndex: c,
          columnLetter: columnLetter(c),
          columnHeader: header,
          rawValue:
            cell.value === undefined || cell.value === null
              ? null
              : cell.value instanceof Date
                ? cell.value.toISOString()
                : String(cell.value),
          sourceType: cell.type,
          formattedText: cell.formatted ?? null,
        });
      }
    }

    await insertChunked(db, rawCellTable, cells);
    totalCells += cells.length;
  }

  await db
    .update(importRunTable)
    .set({
      rawSheetCount: plans.length,
      rawRowCount: totalRows,
      rawCellCount: totalCells,
    })
    .where(eq(importRunTable.id, importRunId));

  return { sheets: plans.length, rows: totalRows, cells: totalCells, plans };
}

// ---------------------------------------------------------------------------
// Step 3 — stage
// ---------------------------------------------------------------------------

export interface StageResult {
  stagedFacts: number;
  errors: number;
  warnings: number;
  rowsRejected: number;
  /**
   * Quantas chaves ficaram de fora por conflito entre linhas repetidas.
   *
   * Não é uma fatia de `stagedFacts`: é o que **não** está lá. Uma vigência com
   * este número maior que zero está incompleta, e quem a lê precisa saber
   * disso antes de somar qualquer coisa.
   */
  chavesEmQuarentena: number;
  snapshotLabels: string[];
  /** Como a identidade de cada aba foi decidida, e com que evidência. */
  identities: SheetIdentity[];
}

export interface SheetIdentity {
  sheetName: string;
  decision: IdentityDecision;
}

/**
 * O dicionário como o classificador precisa dele: um tipo, as colunas dele.
 *
 * `carreta.chassi` vira `CARRETA` + `chassi`. Só o sufixo entra na comparação,
 * porque é ele que descreve o equipamento; o prefixo *é* a identidade e usá-lo
 * na conta seria pressupor a resposta.
 */
export async function tiposConhecidos(db: Database): Promise<KnownEntityType[]> {
  const linhas = await db
    .select({ entityType: attributeTable.entityType, code: attributeTable.code })
    .from(attributeTable);

  const porTipo = new Map<string, Set<string>>();
  for (const linha of linhas) {
    const ponto = linha.code.indexOf(".");
    const slug = ponto >= 0 ? linha.code.slice(ponto + 1) : linha.code;
    const bucket = porTipo.get(linha.entityType) ?? new Set<string>();
    bucket.add(slug);
    porTipo.set(linha.entityType, bucket);
  }

  return [...porTipo.entries()]
    .map(([entityType, columns]) => ({ entityType, columns }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType));
}

interface PendingIssue {
  importRunId: string;
  rawSheetId?: string;
  rawRowId?: number;
  rawCellId?: number;
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  detail?: unknown;
}

/**
 * Type and validate every source cell, keyed by the source's own vocabulary.
 *
 * Nothing is dropped quietly: an unreadable value becomes a typed null with a
 * reason plus a validation issue, and a row missing its grain keys is rejected
 * loudly.
 */
export async function stage(
  db: Database,
  importRunId: string,
): Promise<StageResult> {
  await requireRun(db, importRunId, ["READING"]);

  const sentinelRules: SentinelRule[] = (
    await db.select().from(sentinelRuleTable)
  ).map((r) => ({
    attributeCode: r.attributeCode,
    rawValue: r.rawValue,
    nullReason: r.nullReason,
  }));

  const sheets = await db
    .select()
    .from(rawSheetTable)
    .where(
      and(
        eq(rawSheetTable.importRunId, importRunId),
        eq(rawSheetTable.role, "SOURCE"),
      ),
    );

  /*
    O tipo que quem enviou declarou, quando declarou.

    Lido uma vez para a importação inteira, como o dicionário: a declaração é
    do arquivo, e vale igual para todas as abas dele.
  */
  const [runDeclarado] = await db
    .select({ declaredType: importRunTable.declaredType })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  const declarado = tipoDeImportacao(runDeclarado?.declaredType ?? null);

  /*
    O nome curado de cada atributo, quando a curadoria já deu um.

    As mensagens preferem o `display_name` ("O que cada atributo mede", dado na
    curadoria) ao cabeçalho cru, porque é o nome que a pessoa reconhece — e
    mantêm o cabeçalho entre parênteses quando os dois diferem, porque é o
    cabeçalho que diz **onde corrigir** no arquivo. Ver `nomeDoAtributo`.
  */
  const nomesCurados = new Map<string, string>(
    (
      await db
        .select({
          code: attributeTable.code,
          displayName: attributeTable.displayName,
        })
        .from(attributeTable)
    )
      .filter((a) => a.displayName !== null && a.displayName.trim() !== "")
      .map((a) => [a.code, a.displayName as string]),
  );

  const knownAliases = await db.select().from(attributeAliasTable);
  const aliasKey = (sourceName: string, sheetName: string) =>
    `${sheetName} ${sourceName}`;
  const aliasIndex = new Map(
    knownAliases.map((a) => [aliasKey(a.sourceName, a.sourceSheet), a]),
  );

  /*
    O dicionário que já existe, para a identidade sair do conteúdo da aba.

    Lido uma vez para a importação inteira: são dezenas de linhas, e a decisão
    de cada aba precisa da mesma foto — duas abas do mesmo arquivo não podem
    ser classificadas contra dicionários diferentes.
  */
  const conhecidos = await tiposConhecidos(db);

  const issues: PendingIssue[] = [];
  const stagedRows: Record<string, unknown>[] = [];
  /*
    De onde cada fato staged veio — a aba e a linha da planilha.

    A recusa por duplicidade precisa mandar quem opera para um lugar que
    existe no arquivo dele, e "a chave X colidiu" não é um lugar: "as linhas
    12 e 87 da aba Planilha1" é. `staged_fact` até aponta a célula via
    `raw_cell_id`, mas na hora de escrever a mensagem o que se tem na mão é a
    linha staged, e refazer o caminho até o RAW custaria uma consulta por
    conflito. O mapa vive só nesta passagem e nunca é gravado.
  */
  const origemDoStaged = new WeakMap<
    Record<string, unknown>,
    { aba: string; linha: number }
  >();
  /*
    O cabeçalho original de cada atributo, para as mensagens falarem a língua
    da planilha. `attribute.code` é interno ("qlp_administrativo.id"); o que a
    pessoa reconhece é o cabeçalho que ela mesma escreveu ("ID"). O mapa é da
    importação inteira porque apontamentos como o de tipo misto são computados
    depois do laço de abas, quando a coluna já ficou para trás.
  */
  const nomeDaColuna = new Map<string, string>();
  /*
    O nome de um atributo como uma frase o mostra: o curado quando existe, o
    cabeçalho quando não — e os dois quando diferem, porque um diz **o que é**
    e o outro diz **onde corrigir**. O código interno só aparece quando não há
    nem um nem outro, o que é o caso de um atributo que nunca teve célula
    nesta importação.
  */
  const nomeDoAtributo = (code: string): string => {
    const cabecalho = nomeDaColuna.get(code);
    const curado = nomesCurados.get(code);
    if (curado && cabecalho && curado !== cabecalho) {
      return `${curado} (coluna "${cabecalho}")`;
    }
    return curado ?? cabecalho ?? code;
  };
  const labels = new Set<string>();
  const identidades: SheetIdentity[] = [];
  let rowsRejected = 0;

  /*
    Com tipo declarado, aba rebaixada é ERRO impeditivo — não rodapé.

    O rebaixamento a PIVOT/UNKNOWN acontece quando o cabeçalho perdeu a coluna
    de Vigência ou as colunas de identidade — que é exatamente o que a origem
    renomear uma coluna estrutural produz. Sem esta guarda, o cenário nº 1 do
    produto terminava assim: todas as abas rebaixadas em silêncio, zero fatos,
    importação "verde", e o balanço de massa fechando porque PIVOT é DESCARTE.
    Quem declara o tipo está afirmando "este arquivo é o export deste
    equipamento" — uma aba com linhas que não entra como fonte contradiz a
    declaração, e a contradição precisa parar a importação com o motivo à vista.
  */
  if (declarado !== null) {
    const rebaixadas = await db
      .select()
      .from(rawSheetTable)
      .where(
        and(
          eq(rawSheetTable.importRunId, importRunId),
          sql`${rawSheetTable.role} <> 'SOURCE'`,
        ),
      );
    for (const aba of rebaixadas) {
      if ((aba.rowCount ?? 0) === 0) continue;
      issues.push({
        importRunId,
        rawSheetId: aba.id,
        severity: "ERROR",
        code: "ABA_REBAIXADA_COM_TIPO_DECLARADO",
        message:
          `A aba "${aba.sheetName}" tem ${aba.rowCount} linha(s) e não foi aceita ` +
          `como fonte de um envio declarado como ${declarado.code}: ${aba.roleReason}`,
        detail: { role: aba.role, roleReason: aba.roleReason, declarado: declarado.code },
      });
    }
  }

  for (const sheet of sheets) {
    const rows = await db
      .select()
      .from(rawRowTable)
      .where(eq(rawRowTable.rawSheetId, sheet.id))
      .orderBy(rawRowTable.rowIndex);
    if (rows.length === 0) continue;

    const rowIds = rows.map((r) => r.id);
    const cells: (typeof rawCellTable.$inferSelect)[] = [];
    for (let i = 0; i < rowIds.length; i += 500) {
      const chunk = await db
        .select()
        .from(rawCellTable)
        .where(inArray(rawCellTable.rawRowId, rowIds.slice(i, i + 500)));
      cells.push(...chunk);
    }

    const cellsByRow = new Map<number, Map<number, typeof rawCellTable.$inferSelect>>();
    for (const cell of cells) {
      let bucket = cellsByRow.get(cell.rawRowId);
      if (!bucket) {
        bucket = new Map();
        cellsByRow.set(cell.rawRowId, bucket);
      }
      bucket.set(cell.columnIndex, cell);
    }

    const headerRow = rows.find((r) => r.isHeader);
    if (!headerRow) continue;
    const headerCells = cellsByRow.get(headerRow.id) ?? new Map();

    /*
      Que equipamento é esta aba — decidido pelas colunas dela.

      A decisão desceu para depois da leitura do cabeçalho de propósito: antes
      ela era a primeira linha do laço, tomada com o nome da aba na mão e mais
      nada, e é exatamente essa ordem que fazia `Modelo_Carreta` virar um
      equipamento novo. O nome continua servindo, mas de desempate — e quando
      nem ele tem respaldo no dicionário, a decisão fica pendente em vez de
      criar identidade em silêncio. Ver `identity.ts`.
    */
    const slugsDaAba = [...headerCells.values()]
      .map((cell) => (cell.rawValue ?? "").trim())
      .filter((header) => header !== "")
      .map((header) => slugifyColumn(header));

    const deduzida = classifyEntityType(sheet.sheetName, slugsDaAba, conhecidos);

    /*
      A declaração, conferida contra o que a aba traz.

      Sem declaração, a decisão é a dedução de sempre. Com ela, a conferência é
      quem responde — e ela nunca troca o tipo em silêncio: ou a declaração se
      sustenta e vira a identidade, ou a divergência vira um ERRO impeditivo e
      a aba continua descrita pelo que ela de fato é, para a pré-visualização
      poder mostrar o arquivo que chegou.
    */
    const cabecalhoFolded = [...headerCells.values()]
      .map((cell) => (cell.rawValue ?? "").trim())
      .filter((header) => header !== "")
      .map((header) => foldText(header));
    const conferida =
      declarado === null
        ? null
        : conferirDeclaracao(declarado, deduzida, cabecalhoFolded, sheet.sheetName);

    const decisao = conferida?.decision ?? deduzida;
    const entityType = conferida?.entityType ?? deduzida.entityType;
    identidades.push({ sheetName: sheet.sheetName, decision: decisao });

    if (conferida?.divergencia) {
      const apresentacao: ApresentacaoDeApontamento = {
        titulo: "O arquivo não parece ser do tipo escolhido no envio",
        resumo: conferida.divergencia,
        onde: [{ aba: sheet.sheetName }],
        comoCorrigir:
          "Envie o arquivo pela aba do tipo certo — ou confira se este é mesmo " +
          "o arquivo que você queria enviar. Nada foi importado.",
        porQueImporta:
          "Importar um arquivo como se fosse de outro tipo misturaria colunas e " +
          "registros de naturezas diferentes, e o erro só apareceria depois, nos números.",
      };
      issues.push({
        importRunId,
        rawSheetId: sheet.id,
        severity: "ERROR",
        code: "TIPO_DIVERGE_DA_DECLARACAO",
        message: conferida.divergencia,
        detail: {
          declarado: declarado?.code,
          conteudo: deduzida.entityType,
          identidadeDaAba:
            identidadeNoCabecalho(cabecalhoFolded)?.map((c) => c.sourceName) ?? null,
          scores: deduzida.scores.slice(0, 4),
          apresentacao,
        },
      });
    }

    const rotuloDoTipo = tipoDeImportacao(entityType)?.rotulo ?? entityType;
    issues.push({
      importRunId,
      rawSheetId: sheet.id,
      severity: decisao.isNew ? "WARNING" : "INFO",
      code: decisao.isNew
        ? "NEW_EQUIPMENT_IDENTITY"
        : decisao.source === "DECLARADO"
          ? "IDENTITY_FROM_DECLARATION"
          : decisao.source === "DICIONARIO"
            ? "IDENTITY_FROM_COLUMNS"
            : "IDENTITY_FROM_SHEET_NAME",
      message: `Aba "${sheet.sheetName}" tratada como ${rotuloDoTipo}. ${decisao.reason}`,
      detail: {
        entityType,
        source: decisao.source,
        isNew: decisao.isNew,
        scores: decisao.scores.slice(0, 4),
        apresentacao: {
          titulo: decisao.isNew
            ? "Um tipo de equipamento novo apareceu neste arquivo"
            : `A aba foi reconhecida como ${rotuloDoTipo}`,
          resumo: decisao.reason,
          onde: [{ aba: sheet.sheetName }],
          ...(decisao.isNew
            ? {
                comoCorrigir:
                  "Se o tipo é mesmo novo, confirme-o na pré-visualização para a " +
                  "importação seguir. Se não é, confira o nome da aba e as colunas — " +
                  "algo impediu o reconhecimento.",
                porQueImporta:
                  "Um tipo criado por engano viraria uma categoria paralela no " +
                  "dicionário, e os valores dele ficariam fora das comparações do tipo certo.",
              }
            : {
                porQueImporta:
                  "É esse reconhecimento que decide com que dicionário as colunas " +
                  "desta aba são lidas e comparadas.",
              }),
        } satisfies ApresentacaoDeApontamento,
      },
    });

    // --- column mapping -----------------------------------------------------
    const columns: {
      columnIndex: number;
      header: string;
      folded: string;
      attributeCode: string;
      role: "GRAIN" | "FACT";
    }[] = [];
    const slugSeen = new Map<string, string>();
    const mappingRows: Record<string, unknown>[] = [];

    for (const [columnIndex, cell] of headerCells) {
      const header = (cell.rawValue ?? "").trim();
      if (header === "") continue;
      const folded = foldText(header);
      const slug = slugifyColumn(header);
      const attributeCode = `${entityType.toLowerCase()}.${slug}`;
      nomeDaColuna.set(attributeCode, header);

      const isGrain =
        folded === GRAIN_COLUMNS.vigencia || SO_CHAVE_FOLDED.has(folded);

      const previousHeader = slugSeen.get(slug);
      if (previousHeader !== undefined) {
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawCellId: cell.id,
          severity: "ERROR",
          code: "AMBIGUOUS_COLUMN_SLUG",
          message:
            `As colunas "${previousHeader}" e "${header}" da aba "${sheet.sheetName}" ` +
            `viram o mesmo nome depois de normalizadas, e juntá-las misturaria dados ` +
            `diferentes; a segunda foi recusada.`,
          detail: {
            slug,
            headers: [previousHeader, header],
            apresentacao: {
              titulo: "Duas colunas têm nomes que se confundem",
              resumo:
                `Na aba "${sheet.sheetName}", as colunas "${previousHeader}" e "${header}" ` +
                `são a mesma quando maiúsculas, acentos e espaços deixam de contar. ` +
                `A coluna "${header}" foi recusada; o resto da aba continuou.`,
              onde: [{ aba: sheet.sheetName, coluna: header }],
              comoCorrigir:
                "Renomeie uma das duas colunas na planilha, de modo que os nomes não " +
                "se confundam, e envie o arquivo de novo.",
              porQueImporta:
                "Se as duas entrassem como a mesma coluna, os valores de uma " +
                "sobrescreveriam os da outra sem aviso.",
            } satisfies ApresentacaoDeApontamento,
          },
        });
        mappingRows.push({
          importRunId,
          rawSheetId: sheet.id,
          columnIndex,
          columnHeader: header,
          status: "AMBIGUOUS",
          note: `Collides with column "${previousHeader}".`,
        });
        continue;
      }
      slugSeen.set(slug, header);

      if (isGrain) {
        mappingRows.push({
          importRunId,
          rawSheetId: sheet.id,
          columnIndex,
          columnHeader: header,
          status: "IGNORED",
          note:
            folded === GRAIN_COLUMNS.vigencia
              ? "Coluna de grão: vira a vigência (source_label + effective_date), não um fato."
              : `Coluna de grão: vira o identificador da linha (${header}), não um fato.`,
        });
        columns.push({ columnIndex, header, folded, attributeCode, role: "GRAIN" });
        continue;
      }

      const alias = aliasIndex.get(aliasKey(header, sheet.sheetName));
      mappingRows.push({
        importRunId,
        rawSheetId: sheet.id,
        columnIndex,
        columnHeader: header,
        targetAttributeId: alias?.attributeId ?? null,
        status: alias ? "MAPPED" : "NEW",
        note: alias
          ? null
          : "First time this column is seen; a new attribute will be created with semantics UNKNOWN.",
      });
      if (!alias) {
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawCellId: cell.id,
          severity: "INFO",
          code: "NEW_ATTRIBUTE",
          message:
            `A coluna "${header}" da aba "${sheet.sheetName}" apareceu pela ` +
            `primeira vez; passa a ser acompanhada a partir desta importação.`,
          detail: {
            attributeCode,
            apresentacao: {
              titulo: "Uma coluna nova passou a ser acompanhada",
              resumo:
                `A coluna "${header}" da aba "${sheet.sheetName}" apareceu pela ` +
                `primeira vez. Os valores dela entraram normalmente.`,
              onde: [{ aba: sheet.sheetName, coluna: header }],
              porQueImporta:
                "Colunas novas entram sem classificação até a curadoria dizer o que " +
                "medem — até lá os valores ficam guardados, mas fora dos cálculos " +
                "que dependem de classificação.",
            } satisfies ApresentacaoDeApontamento,
          },
        });
      }
      columns.push({ columnIndex, header, folded, attributeCode, role: "FACT" });
    }

    await insertChunked(db, columnMappingTable, mappingRows as never[]);

    const vigenciaColumn = columns.find((c) => c.folded === GRAIN_COLUMNS.vigencia);
    /*
      Quais colunas identificam a linha desta aba.

      Não é sempre a placa, e nem sempre é uma só: o trecho se identifica por
      `chaveTrecho`, e o quadro de pessoal por unidade + cargo (+ turno). A
      identidade usada é a **do tipo declarado**, quando há um — a conferência
      acima já provou que as colunas dele estão no cabeçalho —, e a que o
      cabeçalho sustenta quando não há.

      `workbook.ts` já garantiu que existe alguma: uma aba sem identidade não
      teria virado SOURCE. O `continue` fica de guarda para o caso de RAW ter
      sido capturado por uma versão anterior do leitor.
    */
    const identidadeDaAba =
      (conferida?.divergencia == null ? declarado?.identidade : null) ??
      identidadeNoCabecalho(cabecalhoFolded) ??
      [];
    const colunasDaChave = identidadeDaAba
      .map((coluna) => ({
        coluna,
        columnIndex: [...headerCells.entries()].find(
          ([, cell]) => foldText((cell.rawValue ?? "").trim()) === coluna.folded,
        )?.[0],
      }))
      .filter(
        (c): c is { coluna: ColunaIdentificadora; columnIndex: number } =>
          c.columnIndex !== undefined,
      );
    if (!vigenciaColumn || colunasDaChave.length !== identidadeDaAba.length) continue;
    if (colunasDaChave.length === 0) continue;

    // --- rows ---------------------------------------------------------------
    for (const row of rows) {
      if (row.isHeader) continue;
      const bucket = cellsByRow.get(row.id);
      if (!bucket) continue;

      const rawLabel = (bucket.get(vigenciaColumn.columnIndex)?.rawValue ?? "").trim();
      const partesDaChave = colunasDaChave.map(({ coluna, columnIndex }) => ({
        coluna,
        valor: (bucket.get(columnIndex)?.rawValue ?? "").trim(),
      }));

      // A completely blank row is structural padding, not a rejection.
      const hasAnyValue = [...bucket.values()].some(
        (c) => c.rawValue !== null && c.rawValue.trim() !== "",
      );
      if (!hasAnyValue) continue;

      // Uma placa que só tem pontuação (`---`) não identifica veículo nenhum:
      // ela normaliza para vazio, e vazio não é chave. Recusar aqui é o mesmo
      // tratamento que a placa em branco já recebia.
      /*
        Toda parte da chave precisa de valor.

        Numa chave composta a exigência vale peça a peça, e não sobre o
        resultado: uma linha de QLP sem CNPJ e outra sem cargo produziriam
        chaves diferentes entre si e ambas erradas, e as duas emendariam com
        linhas legítimas. Recusar a linha nomeando a coluna vazia é a mesma
        regra que a placa em branco sempre teve.
      */
      const vazias = partesDaChave.filter(
        ({ coluna, valor }) =>
          valor === "" ||
          (coluna.normalizacao === "DOCUMENTO"
            ? normalizeDocumento(valor)
            : normalizeIdentifier(valor)) === "",
      );
      const { chave: chaveDaEntidade, legivel } = chaveDaLinha(partesDaChave);

      if (rawLabel === "" || vazias.length > 0) {
        rowsRejected++;
        const faltando =
          rawLabel === ""
            ? "Vigencia"
            : vazias.map(({ coluna }) => coluna.sourceName).join(" e ");
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawRowId: row.id,
          severity: "ERROR",
          code: "ROW_MISSING_GRAIN_KEY",
          message: `A linha ${row.rowIndex} de "${sheet.sheetName}" está sem ${faltando}; recusada.`,
          detail: {
            vigencia: rawLabel,
            identidade: colunasDaChave.map(({ coluna }) => coluna.sourceName),
            faltando,
            apresentacao: {
              titulo: "Uma linha veio sem a informação que a identifica",
              resumo:
                `A linha ${row.rowIndex} da aba "${sheet.sheetName}" está sem ` +
                `${faltando}. Só essa linha foi recusada; o resto do arquivo continuou.`,
              onde: [{ aba: sheet.sheetName, linhas: [row.rowIndex] }],
              comoCorrigir:
                `Preencha ${faltando} nessa linha e envie o arquivo de novo — ou ` +
                `apague a linha, se ela não devia estar ali.`,
              porQueImporta:
                "Sem essa informação não há como saber de que registro a linha " +
                "fala, e um valor sem dono entraria nos cálculos sem poder ser conferido.",
            } satisfies ApresentacaoDeApontamento,
          },
        });
        continue;
      }

      const vigencia = parseVigenciaLabel(rawLabel);
      if (!vigencia.effectiveDate) {
        rowsRejected++;
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawRowId: row.id,
          severity: "ERROR",
          code: "UNPARSEABLE_VIGENCIA_LABEL",
          message:
            `A linha ${row.rowIndex} da aba "${sheet.sheetName}" traz a vigência ` +
            `"${rawLabel}", de onde não dá para tirar uma data; a linha foi ` +
            `recusada em vez de adivinhada.`,
          detail: {
            label: rawLabel,
            failureCode: vigencia.failureCode,
            apresentacao: {
              titulo: "Não conseguimos entender a vigência de uma linha",
              resumo:
                `A linha ${row.rowIndex} da aba "${sheet.sheetName}" traz ` +
                `"${rawLabel}" na coluna Vigencia, e desse texto não dá para tirar ` +
                `uma data. Só essa linha foi recusada; o resto do arquivo continuou.`,
              onde: [{ aba: sheet.sheetName, linhas: [row.rowIndex] }],
              registro: [{ campo: "Vigencia", valor: rawLabel }],
              comoCorrigir:
                "Escreva a vigência dessa linha como nas demais linhas do arquivo " +
                "(por exemplo, EMPURRADA_1_8_2026) e envie o arquivo de novo.",
              porQueImporta:
                "A vigência diz quando o valor passou a valer. Adivinhar uma data " +
                "colocaria o dado no período errado da auditoria.",
            } satisfies ApresentacaoDeApontamento,
          },
        });
        continue;
      }

      labels.add(vigencia.label);

      for (const column of columns) {
        if (column.role !== "FACT") continue;
        const cell = bucket.get(column.columnIndex);
        const source: SourceCell = cell
          ? {
              type: cell.sourceType as SourceCell["type"],
              value: decodeRawValue(cell.sourceType, cell.rawValue),
              formatted: cell.formattedText ?? undefined,
            }
          : { type: "z", value: undefined };

        const typed = typeCell(source, {
          attributeCode: column.attributeCode,
          columnHeader: column.header,
          sentinelRules,
          suspectedSentinelValues: SUSPECTED_SENTINELS,
        });

        for (const warning of typed.warnings) {
          const aviso = AVISO_DE_CELULA[warning.code];
          issues.push({
            importRunId,
            rawSheetId: sheet.id,
            rawRowId: row.id,
            rawCellId: cell?.id,
            severity: "WARNING",
            code: warning.code,
            message: warning.message,
            detail: {
              attributeCode: column.attributeCode,
              ...(aviso
                ? {
                    apresentacao: {
                      titulo: aviso.titulo,
                      resumo: warning.message,
                      onde: [
                        {
                          aba: sheet.sheetName,
                          linhas: [row.rowIndex],
                          coluna: column.header,
                        },
                      ],
                      ...(aviso.comoCorrigir
                        ? { comoCorrigir: aviso.comoCorrigir }
                        : {}),
                      porQueImporta: aviso.porQueImporta,
                    } satisfies ApresentacaoDeApontamento,
                  }
                : {}),
            },
          });
        }

        if (!cell) {
          // Cannot stage a fact without a cell to point at. Should not happen
          // for source sheets (every coordinate is materialised) — if it does,
          // it is a reader bug and must be visible.
          issues.push({
            importRunId,
            rawSheetId: sheet.id,
            rawRowId: row.id,
            severity: "ERROR",
            code: "MISSING_RAW_CELL",
            message:
              `A leitura não capturou a célula da coluna "${column.header}" na ` +
              `linha ${row.rowIndex} — falha nossa, não do arquivo; esse valor não entrou.`,
            detail: {
              apresentacao: {
                titulo: "Falha na leitura de uma célula",
                resumo:
                  `A leitura interna não capturou a célula da coluna ` +
                  `"${column.header}" na linha ${row.rowIndex}. Esse valor não ` +
                  `entrou; o resto do arquivo continuou.`,
                onde: [{ aba: sheet.sheetName, linhas: [row.rowIndex], coluna: column.header }],
                comoCorrigir:
                  "Envie o arquivo de novo. Se o erro repetir, é um defeito do " +
                  "FreightCheck, não da sua planilha — reporte-o.",
                porQueImporta:
                  "Um valor que a leitura perdeu precisa aparecer como perdido, " +
                  "não sumir em silêncio.",
              } satisfies ApresentacaoDeApontamento,
            },
          });
          continue;
        }

        const staged: Record<string, unknown> = {
          importRunId,
          rawCellId: cell.id,
          snapshotLabel: vigencia.label,
          entityKey: chaveDaEntidade,
          entityKeyRaw: legivel,
          entityType,
          attributeCode: column.attributeCode,
          valueNumeric: typed.valueNumeric,
          valueText: typed.valueText,
          valueBoolean: typed.valueBoolean,
          valueDate: typed.valueDate,
          valueHash: typed.valueHash,
          isNull: typed.isNull,
          nullReason: typed.nullReason,
          status: typed.warnings.length > 0 ? "WARNING" : "VALID",
        };
        stagedRows.push(staged);
        origemDoStaged.set(staged, { aba: sheet.sheetName, linha: row.rowIndex });
      }
    }
  }

  // One column, more than one type across the run. The source is internally
  // inconsistent about what the column holds, which is a curation task rather
  // than something the reader may quietly normalise away.
  const typesByAttribute = new Map<string, Set<string>>();
  for (const row of stagedRows) {
    if (row.isNull) continue;
    const code = row.attributeCode as string;
    let bucket = typesByAttribute.get(code);
    if (!bucket) {
      bucket = new Set();
      typesByAttribute.set(code, bucket);
    }
    if (row.valueNumeric !== null) bucket.add("NUMERIC");
    else if (row.valueBoolean !== null) bucket.add("BOOLEAN");
    else if (row.valueDate !== null) bucket.add("DATE");
    else if (row.valueText !== null) bucket.add("TEXT");
  }
  for (const [code, types] of typesByAttribute) {
    if (types.size <= 1) continue;
    const nome = nomeDoAtributo(code);
    const tiposLegiveis = [...types]
      .sort()
      .map((t) => NOME_DO_TIPO_DE_VALOR[t] ?? t.toLowerCase());
    issues.push({
      importRunId,
      severity: "WARNING",
      code: "MIXED_TYPE_COLUMN",
      message:
        `A coluna "${nome}" traz ${listarComE(tiposLegiveis)} no mesmo arquivo; ` +
        `cada valor foi guardado como veio, até a curadoria decidir o tipo.`,
      detail: {
        attributeCode: code,
        types: [...types].sort(),
        apresentacao: {
          titulo: "Uma coluna mistura tipos de valor",
          resumo:
            `A coluna "${nome}" traz ${listarComE(tiposLegiveis)} no mesmo ` +
            `arquivo. Nada foi recusado: cada valor foi guardado como veio.`,
          comoCorrigir:
            `Confira na planilha se a coluna "${nome}" não mistura, por engano, ` +
            "número com texto — um \"N/A\" no meio de valores, por exemplo. Se a " +
            "mistura for legítima, a curadoria decide como tratá-la.",
          porQueImporta:
            "Somar ou comparar uma coluna que mistura tipos produziria resultados " +
            "errados sem avisar.",
        } satisfies ApresentacaoDeApontamento,
      },
    });
  }

  // ---------------------------------------------------------------------
  // A mesma entidade duas vezes dentro da mesma importação
  // ---------------------------------------------------------------------
  // Depois de normalizar a placa, `ABC-1D23` e `ABC1D23` são a mesma linha
  // lógica — e a planilha pode trazer as duas. O índice único da staging as
  // recusaria com um 23505 cru, que chegava à tela como erro técnico.
  //
  // Aqui a decisão é explícita e não é "a primeira" nem "a última": se as duas
  // ocorrências **concordam** depois de normalizadas, elas são consolidadas
  // numa só e isso vira registro de auditoria; se **discordam**, é conflito de
  // dado, e o import não pode escolher em silêncio qual valor vale.
  const porGrao = new Map<string, Record<string, unknown>[]>();
  for (const row of stagedRows) {
    const grao = [
      row.snapshotLabel,
      row.entityType,
      row.entityKey,
      row.attributeCode,
    ].join("\u001f");
    const bucket = porGrao.get(grao);
    if (bucket) bucket.push(row);
    else porGrao.set(grao, [row]);
  }

  const consolidados: Record<string, unknown>[] = [];
  /*
    Os conflitos, com a evidência inteira: por chave, cada campo que discorda
    guarda as suas ocorrências staged — é delas que a mensagem tira a forma
    legível da chave, as linhas da planilha e os dois valores em desacordo.
    Um `Set` de códigos de atributo dizia **onde** havia conflito e não **o
    quê**, e a recusa chegava à tela mandando corrigir sem mostrar a diferença.
  */
  const conflitos = new Map<
    string,
    { legivel: string; porAtributo: Map<string, Record<string, unknown>[]> }
  >();
  /*
    As duplicidades que **concordam**, por chave.

    Era um número só — "N valores apareceram mais de uma vez" —, sem dizer de
    que chave nem em que campo. Para quem está medindo se um grão separa as
    linhas da origem, esse número é a evidência principal e vinha ilegível: duas
    linhas caindo na mesma chave é o sintoma de um grão grosso demais, e ele
    aparece **antes** de haver conflito, justamente enquanto as duas concordam.

    Agrupado por chave, cada colisão vira um apontamento que nomeia a vigência,
    o tipo, a chave e os campos envolvidos — a mesma forma da recusa por
    conflito, para as duas se lerem juntas.
  */
  const consolidacoesPorChave = new Map<
    string,
    {
      legivel: string;
      atributos: Set<string>;
      linhas: number;
      origens: { aba: string; linha: number }[];
    }
  >();
  /*
    Por que a classificação vem antes de qualquer escolha entrar na staging.

    O laço escolhia e empurrava no mesmo passo — `consolidados.push` acontecia
    grão a grão, antes de se saber se **a chave** tinha conflito em algum outro
    atributo. Enquanto o conflito segurava o arquivo inteiro isso não fazia
    diferença: nada era promovido de qualquer jeito. Com a quarentena por chave
    faz toda: um cargo que discorda no salário teria as outras 34 colunas já
    empurradas quando o conflito aparecesse, e entraria na vigência como um
    registro que nenhuma linha da planilha afirma.

    Então primeiro se classifica tudo — quem é único, quem repete concordando,
    quem repete discordando —, e só depois se decide o que entra. `Map` preserva
    a ordem de inserção, de modo que a staging recebe os mesmos fatos na mesma
    ordem de antes; o que mudou é quais.
  */
  const escolhidoPorGrao = new Map<string, Record<string, unknown>>();
  for (const [grao, ocorrencias] of porGrao) {
    escolhidoPorGrao.set(grao, ocorrencias[0]);
    if (ocorrencias.length === 1) continue;
    const valores = new Set(
      ocorrencias.map((o) =>
        canonicalPayloadHash([
          {
            entityType: o.entityType as string,
            entityKey: o.entityKey as string,
            attributeCode: o.attributeCode as string,
            valueNumeric: o.valueNumeric as string | null,
            valueText: o.valueText as string | null,
            valueBoolean: o.valueBoolean as boolean | null,
            valueDate: o.valueDate as string | null,
            isNull: o.isNull as boolean | null,
          },
        ]),
      ),
    );
    const [label, entityType, entityKey, attributeCode] = grao.split("\u001f");
    if (valores.size === 1) {
      const chave = [label, entityType, entityKey].join("\u001f");
      const registro = consolidacoesPorChave.get(chave) ?? {
        legivel: (ocorrencias[0].entityKeyRaw as string) || entityKey,
        atributos: new Set<string>(),
        linhas: 0,
        origens: [] as { aba: string; linha: number }[],
      };
      registro.atributos.add(attributeCode);
      // O maior número de ocorrências de um mesmo atributo é quantas linhas da
      // origem caíram nesta chave: somar por atributo contaria a mesma linha
      // uma vez por coluna.
      registro.linhas = Math.max(registro.linhas, ocorrencias.length);
      for (const ocorrencia of ocorrencias) {
        const origem = origemDoStaged.get(ocorrencia);
        if (
          origem &&
          !registro.origens.some((o) => o.aba === origem.aba && o.linha === origem.linha)
        ) {
          registro.origens.push(origem);
        }
      }
      consolidacoesPorChave.set(chave, registro);
      continue;
    }
    const chave = [label, entityType, entityKey].join("\u001f");
    let conflito = conflitos.get(chave);
    if (!conflito) {
      conflito = {
        legivel: (ocorrencias[0].entityKeyRaw as string) || entityKey,
        porAtributo: new Map(),
      };
      conflitos.set(chave, conflito);
    }
    conflito.porAtributo.set(attributeCode, ocorrencias);
  }

  /*
    A quarentena, e o que ela deixa passar.

    A chave em conflito sai **inteira**, e não só nos atributos que discordam.
    Duas linhas para o mesmo cargo são duas afirmações concorrentes sobre ele;
    ficar com os 33 campos em que elas concordam e descartar os 2 em que
    discordam montaria um registro que nenhuma das duas linhas faz — e a
    ausência dos 2 se leria, lá na frente, como "o export não trouxe essa
    coluna", que é outra afirmação, e falsa.

    Fora da quarentena, tudo entra. É a diferença que o arquivo do QLP tornou
    visível: 8 chaves em conflito não são motivo para 11.760 fatos ficarem de
    fora, desde que as 8 fiquem — e desde que a tela diga quais são.
  */
  for (const [grao, escolhido] of escolhidoPorGrao) {
    const [label, entityType, entityKey] = grao.split("\u001f");
    if (conflitos.has([label, entityType, entityKey].join("\u001f"))) continue;
    consolidados.push(escolhido);
  }

  for (const [chave, { legivel, atributos, linhas, origens }] of consolidacoesPorChave) {
    /*
      Uma chave em quarentena não foi consolidada — ela não entrou.

      As duas coisas acontecem juntas o tempo todo, e é o caso **comum**: um
      cargo com 35 colunas repetido em duas linhas que só discordam no salário
      cai aqui por 34 atributos e no conflito por 1. Emitir os dois apontamentos
      faria a mesma importação dizer "consolidadas numa ocorrência; nada foi
      descartado" e "este registro ficou de fora" sobre o mesmo registro — e a
      primeira frase seria falsa.

      Quem manda é o conflito: o que decide o destino da chave é o atributo que
      discorda, não os que concordam.
    */
    if (conflitos.has(chave)) continue;
    const [label, entityType, entityKey] = chave.split("\u001f");
    const rotulo = tipoDeImportacao(entityType)?.rotulo ?? entityType;
    const campos = [...atributos].sort();
    const onde = origens.length > 0 ? ` — ${nomearOrigens(origens)} —` : "";
    issues.push({
      importRunId,
      severity: "INFO",
      code: "ENTIDADE_DUPLICADA_CONSOLIDADA",
      message:
        `${rotulo} "${legivel}" aparece em ${linhas} linhas da vigência ${label}${onde}, e elas dizem o mesmo em ` +
        `${campos.length} ${campos.length === 1 ? "campo" : "campos"}; consolidadas numa ocorrência. ` +
        `Nada foi descartado: as linhas continuam inteiras no RAW, e é lá que elas podem ser conferidas uma a uma.`,
      detail: {
        vigencia: label,
        tipo: rotulo,
        chave: legivel,
        entityType,
        entityKey,
        linhas,
        origem: origens.map((o) => `aba "${o.aba}", linha ${o.linha}`),
        // Os campos inteiros, e não uma amostra: é esta lista que diz **o
        // que** as duas linhas tinham em comum, e ela é o material da medição
        // de grão. Truncá-la aqui seria esconder metade da evidência.
        atributos: campos,
        apresentacao: {
          titulo: "Linhas repetidas concordavam e foram consolidadas",
          resumo:
            `O mesmo registro aparece em ${linhas} linhas da vigência ${label}, ` +
            `com valores iguais. Entrou uma ocorrência só; nada foi descartado.`,
          onde: ondeDasOrigens(origens),
          registro: registroDoTipo(entityType, legivel),
          comoCorrigir:
            "Nada precisa ser corrigido agora. Se a repetição não era esperada, " +
            "vale conferir a origem — linhas repetidas costumam ser o primeiro " +
            "sinal de um registro que a planilha não separa direito.",
          porQueImporta:
            "Todas as linhas seguem guardadas como chegaram e podem ser " +
            "conferidas uma a uma; a consolidação só evita contar o mesmo valor duas vezes.",
        } satisfies ApresentacaoDeApontamento,
      },
    });
  }

  for (const [chave, conflito] of conflitos) {
    const [label, entityType, entityKey] = chave.split("\u001f");
    const rotulo = tipoDeImportacao(entityType)?.rotulo ?? entityType;
    const campos = [...conflito.porAtributo.keys()].sort();

    // As linhas da planilha envolvidas no conflito, sem repetição — a união
    // entre os campos, porque as mesmas linhas discordam em vários deles.
    const origens: { aba: string; linha: number }[] = [];
    for (const ocorrencias of conflito.porAtributo.values()) {
      for (const ocorrencia of ocorrencias) {
        const origem = origemDoStaged.get(ocorrencia);
        if (
          origem &&
          !origens.some((o) => o.aba === origem.aba && o.linha === origem.linha)
        ) {
          origens.push(origem);
        }
      }
    }
    origens.sort((a, b) =>
      a.aba === b.aba ? a.linha - b.linha : a.aba.localeCompare(b.aba),
    );

    /*
      A frase mostra a divergência, e não só onde ela está.

      Dizia "com valores diferentes em qlp_administrativo.id" — o código do
      campo, a chave normalizada emendada e nada dos valores. Quem lia sabia
      que havia conflito e não sabia qual era, nem em que linha da planilha
      olhar. Agora a recusa traz a chave como está escrita no arquivo, as
      linhas que colidiram e os dois valores em desacordo — o suficiente para
      corrigir sem investigar. O corte em poucos campos evita uma frase de
      página inteira quando a linha inteira discorda; a lista completa segue
      em `detail.atributos`.
    */
    /*
      As diferenças inteiras, estruturadas: a coluna pelo cabeçalho que a
      planilha usa, e cada valor com a linha de onde veio. É esta lista que a
      tela desenha como tabela — a frase abaixo mostra só as primeiras para
      não virar um parágrafo de página quando a linha inteira discorda.
    */
    const diferencas = campos.map((campo) => ({
      campo: nomeDoAtributo(campo),
      versoes: conflito.porAtributo.get(campo)!.map((ocorrencia) => {
        const origem = origemDoStaged.get(ocorrencia);
        return {
          ...(origem ? { aba: origem.aba, linha: origem.linha } : {}),
          valor: valorStaged(ocorrencia),
        };
      }),
    }));

    const MOSTRAR = 3;
    const naFrase = diferencas.slice(0, MOSTRAR).map((diferenca) => {
      const versoes = diferenca.versoes.map((versao) =>
        versao.linha !== undefined
          ? `a linha ${versao.linha} traz ${versao.valor}`
          : `uma linha traz ${versao.valor}`,
      );
      return `${diferenca.campo} (${listarComE(versoes)})`;
    });
    const cortados = campos.length - MOSTRAR;
    const maisCampos =
      cortados > 0
        ? `; e mais ${cortados} ${cortados === 1 ? "campo divergente, listado" : "campos divergentes, listados"} no detalhe`
        : "";

    const apresentacao: ApresentacaoDeApontamento = {
      titulo:
        origens.length === 2
          ? "Encontramos duas linhas para o mesmo registro com informações diferentes"
          : "Encontramos linhas repetidas para o mesmo registro com informações diferentes",
      resumo:
        `Este registro ficou de fora da vigência ${label}: ele aparece ` +
        `${origens.length > 1 ? `${origens.length} vezes` : "mais de uma vez"}, ` +
        `com dados que não batem entre si. O resto do arquivo foi importado ` +
        `normalmente.`,
      onde: ondeDasOrigens(origens),
      registro: registroDoTipo(entityType, conflito.legivel),
      diferencas,
      comoCorrigir:
        "Verifique qual linha está correta. Se as linhas falam do mesmo registro, " +
        "mantenha apenas a correta — ou deixe os valores iguais — e importe novamente: " +
        "o registro entra na vigência e sai desta lista. Se são registros diferentes, " +
        "confira as colunas que os identificam: algo as está fazendo parecer o mesmo.",
      porQueImporta:
        "O FreightCheck não escolhe em silêncio entre dois valores conflitantes — a " +
        "escolha errada entraria no histórico e nos cálculos da auditoria como se " +
        "fosse o dado verdadeiro. Por isso ele não escolhe: deixa o registro de fora, " +
        "com a evidência aqui, e a vigência segue marcada como incompleta enquanto " +
        "ele estiver faltando.",
    };

    issues.push({
      importRunId,
      severity: "ERROR",
      code: "ENTIDADE_DUPLICADA_CONFLITANTE",
      message:
        `${rotulo} "${conflito.legivel}" aparece mais de uma vez na vigência ${label}` +
        (origens.length > 0 ? ` — ${nomearOrigens(origens)} —` : "") +
        ` com valores diferentes: ${naFrase.join("; ")}${maisCampos}. ` +
        `Linhas repetidas para a mesma chave, discordando entre si, não têm resposta certa, ` +
        `e a importação não escolhe uma em silêncio: este registro ficou de fora da vigência, ` +
        `e o resto do arquivo entrou. ` +
        `Corrija a planilha de origem — deixe uma linha só por chave, ou os mesmos valores nas repetidas — ` +
        `e importe de novo para que ele entre.`,
      detail: {
        vigencia: label,
        tipo: rotulo,
        chave: conflito.legivel,
        entityType,
        entityKey,
        linhas: origens.map((o) => `aba "${o.aba}", linha ${o.linha}`),
        atributos: campos,
        apresentacao,
      },
    });
  }

  await insertChunked(db, stagedFactTable, consolidados as never[]);
  await insertChunked(
    db,
    validationIssueTable,
    issues.map((i) => ({
      importRunId: i.importRunId,
      rawSheetId: i.rawSheetId ?? null,
      rawRowId: i.rawRowId ?? null,
      rawCellId: i.rawCellId ?? null,
      severity: i.severity,
      code: i.code,
      message: i.message,
      detail: i.detail ?? null,
    })) as never[],
  );

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;

  await db
    .update(importRunTable)
    .set({
      status: "STAGED",
      stagedFactCount: consolidados.length,
      errorCount: errors,
      warningCount: warnings,
    })
    .where(eq(importRunTable.id, importRunId));

  return {
    stagedFacts: consolidados.length,
    errors,
    warnings,
    rowsRejected,
    chavesEmQuarentena: conflitos.size,
    snapshotLabels: [...labels].sort(),
    identities: identidades,
  };
}

/**
 * RAW stores every value as text. Rebuild the shape the reader saw so that
 * typing decisions are made once, in {@link typeCell}, rather than twice.
 */
function decodeRawValue(sourceType: string, rawValue: string | null): unknown {
  if (rawValue === null) return undefined;
  switch (sourceType) {
    case "n":
      return Number(rawValue);
    case "b":
      return rawValue === "true" || rawValue === "TRUE" || rawValue === "1";
    case "d": {
      const parsed = new Date(rawValue);
      return Number.isNaN(parsed.getTime()) ? rawValue : parsed;
    }
    default:
      return rawValue;
  }
}

/**
 * One derivation, not two.
 *
 * This used to be a second copy of the rule in `workbook.ts`, and the copies
 * drifted the moment the sheet naming changed: fixing one left staging still
 * producing MODELOCARRETA. A rule that decides an asset's identity gets to
 * live in exactly one place.
 */
function deriveEntityTypeFromSheet(sheetName: string): string {
  return deriveEntityType(sheetName).entityType;
}

// ---------------------------------------------------------------------------
// Step 4 — preview
// ---------------------------------------------------------------------------

export interface PreviewReport {
  importRunId: string;
  sourceFilename: string;
  contentSha256: string;
  sheets: {
    name: string;
    role: string;
    roleReason: string;
    rows: number;
    columns: number;
  }[];
  snapshots: {
    label: string;
    effectiveDate: string;
    entityTypes: string[];
    entityCount: number;
    factCount: number;
  }[];
  totals: {
    rawSheets: number;
    rawRows: number;
    rawCells: number;
    stagedFacts: number;
    entities: number;
    errors: number;
    warnings: number;
  };
  issuesByCode: { code: string; severity: string; count: number; sample: string }[];
  /**
   * Quantas chaves esta importação deixou de fora por conflito.
   *
   * Fica ao lado de `blockingErrors` e diz outra coisa: `blockingErrors` conta
   * o que impede aprovar o arquivo; este conta o que já se sabe que **não vai
   * entrar** se ele for aprovado. Zero é o caso comum; maior que zero, a
   * vigência nasce incompleta e a tela precisa dizê-lo antes da aprovação, não
   * depois.
   */
  chavesEmQuarentena: number;
  /** Nulls broken down by reason — absence is never collapsed into one bucket. */
  nullsByReason: { reason: string; count: number }[];
  /** True economic zeros, kept separate from every kind of absence. */
  zeroCount: number;
  /**
   * Quantos apontamentos impedem aprovar este arquivo.
   *
   * Só os que impedem — não todo ERRO. Uma linha sem placa é ERRO e não impede
   * nada; uma chave em conflito é ERRO, retira o registro e o arquivo segue
   * aprovável. Quem responde é `impedePromocao`, em `apontamentos.ts`.
   */
  blockingErrors: number;
  /**
   * Equipamentos que esta importação criaria e o dicionário não conhece.
   *
   * Vazio no caso comum. Preenchido, a promoção recusa até que estes nomes
   * sejam declarados — é a única coisa nesta tela que exige uma decisão, e não
   * apenas uma leitura.
   */
  pendingIdentities: string[];
}

/**
 * Build the report a human reads before anything reaches the canonical layer.
 * Promotion refuses to run until this step has produced a report.
 */
export async function preview(
  db: Database,
  importRunId: string,
): Promise<PreviewReport> {
  const run = await requireRun(db, importRunId, ["STAGED", "PREVIEWED"]);
  const [file] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.id, run.sourceFileId));

  const sheets = await db
    .select()
    .from(rawSheetTable)
    .where(eq(rawSheetTable.importRunId, importRunId))
    .orderBy(rawSheetTable.sheetIndex);

  const perLabel = await db
    .select({
      label: stagedFactTable.snapshotLabel,
      entityType: stagedFactTable.entityType,
      entities: sql<number>`count(distinct ${stagedFactTable.entityKey})`.mapWith(Number),
      facts: sql<number>`count(*)`.mapWith(Number),
    })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId))
    .groupBy(stagedFactTable.snapshotLabel, stagedFactTable.entityType);

  const snapshotMap = new Map<
    string,
    { entityTypes: Set<string>; entityCount: number; factCount: number }
  >();
  for (const row of perLabel) {
    let entry = snapshotMap.get(row.label);
    if (!entry) {
      entry = { entityTypes: new Set(), entityCount: 0, factCount: 0 };
      snapshotMap.set(row.label, entry);
    }
    entry.entityTypes.add(row.entityType);
    entry.entityCount += row.entities;
    entry.factCount += row.facts;
  }

  const snapshots = [...snapshotMap.entries()]
    .map(([label, v]) => ({
      label,
      effectiveDate: parseVigenciaLabel(label).effectiveDate ?? "",
      entityTypes: [...v.entityTypes].sort(),
      entityCount: v.entityCount,
      factCount: v.factCount,
    }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const issueRows = await db
    .select({
      code: validationIssueTable.code,
      severity: validationIssueTable.severity,
      count: sql<number>`count(*)`.mapWith(Number),
      sample: sql<string>`min(${validationIssueTable.message})`,
    })
    .from(validationIssueTable)
    .where(eq(validationIssueTable.importRunId, importRunId))
    .groupBy(validationIssueTable.code, validationIssueTable.severity);

  const nullRows = await db
    .select({
      reason: stagedFactTable.nullReason,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(stagedFactTable)
    .where(
      and(
        eq(stagedFactTable.importRunId, importRunId),
        eq(stagedFactTable.isNull, true),
      ),
    )
    .groupBy(stagedFactTable.nullReason);

  const [zeroRow] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(stagedFactTable)
    .where(
      and(
        eq(stagedFactTable.importRunId, importRunId),
        eq(stagedFactTable.isNull, false),
        eq(stagedFactTable.valueNumeric, "0"),
      ),
    );

  const [entityRow] = await db
    .select({
      count: sql<number>`count(distinct (${stagedFactTable.entityType} || ':' || ${stagedFactTable.entityKey}))`.mapWith(
        Number,
      ),
    })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId));

  /*
    Nem todo ERRO impede promover, e as consequências são três, não duas.

    Linha sem chave é linha recusada, e o resto do arquivo continua válido — foi
    sempre assim. A mesma entidade duas vezes com valores que discordam retira
    **a chave** e deixa o arquivo entrar: escolher um dos dois em silêncio seria
    inventar o número, e segurar o arquivo inteiro por causa dela custava onze
    mil fatos bons por oito ruins (ver a quarentena, em `stage`).

    O que impede promover é o arquivo que não é o que disse ser — o tipo
    declarado no envio discordando do que a aba traz. Aceitar seria gravar como
    cavalo o que é carreta porque alguém clicou na aba errada, e aí não há chave
    a isolar: é o arquivo todo que está sob a etiqueta errada.

    **`blockingErrors` é esta mesma conta, e não outra.** Ele contava todo ERRO,
    e enquanto o conflito de chave segurava o arquivo a conta batia por
    acidente: os erros que existiam ou bloqueavam, ou vinham junto de um que
    bloqueava. Com a quarentena o acidente acabou — um arquivo com 8 conflitos e
    mais nada é perfeitamente aprovável, e um campo chamado `blockingErrors`
    devolvendo 8 faria toda leitura dele concluir o contrário do que é verdade.
    Duas perguntas iguais respondidas por dois cálculos é como uma tela passa a
    discordar do pipeline — e foi o que aconteceu enquanto este cálculo morava
    só aqui: a tela continuou perguntando `errors > 0`, e o mesmo arquivo que
    este trecho considera aprovável chegava com o botão desabilitado. Hoje o
    cálculo é um só de verdade: `impedePromocao` responde aqui, na leitura de
    estado do run e no botão, e é lá que ele muda.
  */
  const impeditivas = issueRows.filter(impedePromocao);
  const impeditivos = impeditivas.reduce((sum, i) => sum + i.count, 0);
  const blockingErrors = impeditivos;

  /*
    As chaves que a quarentena reteve — contadas aqui porque é aqui que se
    decide o que dizer sobre um arquivo que não trouxe fato nenhum.
  */
  const emQuarentena = issueRows
    .filter(isolaAChave)
    .reduce((soma, i) => soma + i.count, 0);

  /*
    Zero fatos é impedimento por si — mesmo sem nenhum apontamento.

    Um arquivo em que nada virou fato não tem o que aprovar: deixá-lo chegar a
    PREVIEWED (e a PROMOTED, vazio) fabricava a importação "verde" que não
    trouxe nada — o falso verde clássico. O motivo diz onde olhar.

    E "onde olhar" depende de por que ficou vazio. Com a quarentena por chave
    existe um segundo caminho para o zero: o arquivo foi lido, reconhecido e
    tipado, e **todas** as suas chaves conflitaram. Mandar conferir os papéis
    das abas nesse caso mandaria procurar um defeito que não existe — as abas
    foram aceitas; o que não fecha são as linhas.
  */
  const totalDeFatos = snapshots.reduce((soma, s) => soma + s.factCount, 0);
  const vazio = totalDeFatos === 0;

  if (run.status === "STAGED") {
    await db
      .update(importRunTable)
      .set(
        impeditivos > 0 || vazio
          ? {
              status: "VALIDATION_ERROR",
              finishedAt: new Date(),
              failureReason:
                impeditivos > 0
                  ? motivoDoImpedimento(impeditivas)
                  : emQuarentena > 0
                    ? `Todos os registros deste arquivo ficaram em quarentena: ` +
                      `${emQuarentena === 1 ? "a única chave" : `as ${emQuarentena} chaves`} que ele traz ` +
                      `${emQuarentena === 1 ? "aparece" : "aparecem"} mais de uma vez na mesma vigência com valores ` +
                      `que discordam, e não sobrou nada para importar. Os apontamentos nomeiam ` +
                      `${emQuarentena === 1 ? "o conflito" : "cada conflito"} — a chave, as linhas da planilha e os ` +
                      `valores em desacordo. Corrija a origem e importe de novo.`
                    : "Nenhuma célula deste arquivo virou fato: nenhuma aba foi aceita " +
                      "como fonte. Confira os papéis das abas nesta importação — a causa " +
                      "mais comum é a origem ter renomeado uma coluna estrutural " +
                      "(Vigência, ou as colunas de identidade).",
            }
          : { status: "PREVIEWED" },
      )
      .where(eq(importRunTable.id, importRunId));
  }

  return {
    importRunId,
    sourceFilename: file.filename,
    contentSha256: file.contentSha256,
    sheets: sheets.map((s) => ({
      name: s.sheetName,
      role: s.role,
      roleReason: s.roleReason,
      rows: s.rowCount,
      columns: s.columnCount,
    })),
    snapshots,
    totals: {
      rawSheets: run.rawSheetCount,
      rawRows: run.rawRowCount,
      rawCells: run.rawCellCount,
      stagedFacts: run.stagedFactCount,
      entities: entityRow?.count ?? 0,
      errors: run.errorCount,
      warnings: run.warningCount,
    },
    issuesByCode: issueRows
      .map((i) => ({
        code: i.code,
        severity: i.severity,
        count: i.count,
        sample: i.sample,
      }))
      .sort((a, b) => b.count - a.count),
    nullsByReason: nullRows
      .map((n) => ({ reason: n.reason ?? "(unset)", count: n.count }))
      .sort((a, b) => b.count - a.count),
    zeroCount: zeroRow?.count ?? 0,
    blockingErrors,
    chavesEmQuarentena: emQuarentena,
    pendingIdentities: await identidadesPendentes(db, importRunId),
  };
}

// ---------------------------------------------------------------------------
// Step 5 — promote
// ---------------------------------------------------------------------------

export interface PromoteOptions {
  /**
   * FAIL          — refuse when the business key already exists (default).
   * NEW_REVISION  — supersede the live snapshot and write revision N+1.
   */
  onExistingSnapshot?: "FAIL" | "NEW_REVISION";
  promotedBy?: string;
  /**
   * Os equipamentos novos que quem promove **declara** estar criando.
   *
   * Uma identidade nova é o começo de uma frota paralela: foi assim que 80
   * carretas passaram a existir duas vezes, com dados certos e identidade
   * errada, sem que nada falhasse. Criar equipamento continua permitido — a
   * Ambev pode passar a entregar bitrem amanhã —, mas deixa de ser efeito
   * colateral de um nome de aba e passa a ser declaração de quem promove.
   *
   * A exigência só vale quando o dicionário já conhece algum equipamento: num
   * banco virgem não existe identidade paralela possível, e travar a primeira
   * importação de todas seria travar o produto na partida. Aí a decisão vai
   * como aviso para a pré-visualização, que é lida antes de promover.
   */
  confirmNewEntityTypes?: string[];
}

export interface PromoteResult {
  snapshotIds: string[];
  snapshots: {
    id: string;
    label: string;
    effectiveDate: string;
    revision: number;
    entityCount: number;
    factCount: number;
  }[];
  entitiesCreated: number;
  attributesCreated: number;
  factsInserted: number;
  /**
   * A árvore da taxonomia depois desta promoção.
   *
   * `nosCriados` é zero em toda importação a partir da segunda — a estrutura é
   * garantida, não recriada —, e é isso que a idempotência significa aqui.
   */
  taxonomia: { nosCriados: number; nosExistentes: number };
  /**
   * O que o registro canônico de semânticas deixou aplicado nesta promoção.
   *
   * Sai na resposta da promoção porque uma aplicação silenciosa é
   * indistinguível de nenhuma aplicação — foi assim que a ausência dela passou
   * despercebida até a frota inteira aparecer sem remuneração apurada. Quem
   * promove recebe quantas colunas entraram confirmadas e, nomeadamente, o que
   * **não** entrou: o que diverge de uma confirmação humana e o que o tipo de
   * dado deste arquivo contradiz. Ver `aplicarConfirmacoesCanonicas`.
   */
  semanticasConfirmadas: {
    aplicadas: number;
    jaConfirmadas: number;
    divergentes: string[];
    incoerentes: string[];
  };
}

/**
 * Os equipamentos que esta importação criaria e o dicionário não conhece.
 *
 * Lido da staging, e não das abas: duas abas podem concordar em criar o mesmo
 * equipamento novo, e o que importa é o conjunto que vai ser escrito.
 *
 * **O tipo declarado no envio não é pendência.** A confirmação existe para que
 * criar equipamento deixe de ser efeito colateral de um nome de aba e passe a
 * ser declaração de quem promove — e quem escolheu a aba Trecho para enviar o
 * arquivo já fez essa declaração, antes de o leitor abrir a planilha. Cobrá-la
 * de novo na promoção seria fazer a mesma pergunta à mesma pessoa em duas
 * telas, e a segunda com menos contexto que a primeira. O que sustenta isso é a
 * conferência: uma declaração que divergisse do conteúdo não teria chegado até
 * aqui — ela vira ERRO impeditivo na pré-visualização.
 */
export async function identidadesPendentes(
  db: Database,
  importRunId: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ entity_type: string }>(sql`
    SELECT DISTINCT entity_type FROM staged_fact WHERE import_run_id = ${importRunId}::uuid
  `);
  const conhecidos = await tiposConhecidos(db);
  // Banco virgem: não há identidade paralela possível, e a primeira
  // importação de todas não pode depender de uma declaração que ninguém
  // teria como fazer. O aviso da staging continua na pré-visualização.
  if (conhecidos.length === 0) return [];

  const [run] = await db
    .select({ declaredType: importRunTable.declaredType })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  const declarado = tipoDeImportacao(run?.declaredType ?? null);

  return novasIdentidades(
    rows.map((r) => r.entity_type),
    conhecidos.map((c) => c.entityType),
  ).filter((tipo) => tipo !== declarado?.code);
}

/** A recusa, escrita para quem opera — e com a saída no próprio texto. */
async function recusarIdentidadeNaoDeclarada(
  db: Database,
  importRunId: string,
  confirmados: string[] | undefined,
): Promise<void> {
  const pendentes = await identidadesPendentes(db, importRunId);
  const declarados = new Set(confirmados ?? []);
  const faltando = pendentes.filter((t) => !declarados.has(t));
  if (faltando.length === 0) return;

  throw new Error(
    `Esta importação criaria ${faltando.length === 1 ? "um equipamento que o dicionário não conhece" : "equipamentos que o dicionário não conhece"}: ` +
      `${faltando.join(", ")}. Um equipamento novo é o começo de uma frota paralela — ` +
      `foi assim que a mesma carreta passou a existir duas vezes — então ele precisa ser ` +
      `declarado por quem promove, e não sair de um nome de aba. ` +
      `Se for equipamento novo mesmo, confirme ${faltando.join(", ")} na pré-visualização. ` +
      `Se for um equipamento que já existe com a aba nomeada de outro jeito, o lugar de ` +
      `olhar é a lista de colunas: ela não bateu com nenhum tipo conhecido.`,
  );
}

/**
 * A recusa de uma promoção, dita de um jeito que a tela consegue repetir.
 *
 * O pipeline recusava com `new Error(...)`, e a API traduzia pelo texto. Com
 * uma decisão nomeada, a tela sabe *qual* recusa foi sem ler a frase, e a
 * mesma decisão vai para `import_decision` — que é onde alguém procura, meses
 * depois, por que aquele arquivo não entrou.
 */
export class PromocaoRecusada extends Error {
  constructor(
    message: string,
    readonly decisao: string,
    /**
     * O estado em que o run fica.
     *
     * VALIDATION_ERROR quando o dado não fecha e reenviar é o caminho.
     * PREVIEWED quando a recusa é uma pergunta a quem opera — "já existe uma
     * versão ativa; quer registrar uma correção?" —, porque aí o run tem de
     * continuar aprovável.
     */
    readonly runStatus: "VALIDATION_ERROR" | "PREVIEWED",
    readonly detalhe: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PromocaoRecusada";
  }
}

/** Um fato canônico de um snapshot já gravado, na forma que o hash consome. */
async function fatosCanonicosDoSnapshot(
  tx: Database,
  snapshotId: string,
): Promise<(CanonicalFact & { entityId: string })[]> {
  const rows = await tx
    .select({
      entityId: factTable.entityId,
      entityType: entityTable.entityType,
      entityKey: entityIdentifierTable.identifierValue,
      attributeCode: attributeTable.code,
      valueNumeric: factTable.valueNumeric,
      valueText: factTable.valueText,
      valueBoolean: factTable.valueBoolean,
      valueDate: factTable.valueDate,
      isNull: factTable.isNull,
    })
    .from(factTable)
    .innerJoin(entityTable, eq(entityTable.id, factTable.entityId))
    .innerJoin(attributeTable, eq(attributeTable.id, factTable.attributeId))
    .leftJoin(
      entityIdentifierTable,
      and(
        eq(entityIdentifierTable.entityId, factTable.entityId),
        eq(entityIdentifierTable.identifierType, "PLACA"),
        eq(entityIdentifierTable.isCurrent, true),
      ),
    )
    .where(eq(factTable.snapshotId, snapshotId));

  return rows.map((r) => ({
    entityId: r.entityId,
    entityType: r.entityType,
    entityKey: r.entityKey ?? "",
    attributeCode: r.attributeCode,
    valueNumeric: r.valueNumeric,
    valueText: r.valueText,
    valueBoolean: r.valueBoolean,
    valueDate: r.valueDate,
    isNull: r.isNull,
  }));
}

/** Uma linha de auditoria da decisão tomada. */
async function registrarDecisao(
  db: Database,
  valores: typeof importDecisionTable.$inferInsert,
): Promise<void> {
  await db.insert(importDecisionTable).values(valores);
}

/**
 * Reler e travar o run dentro da transação.
 *
 * O `requireRun` antigo lia o estado **fora** da transação e o usava como
 * verdade lá dentro. Entre a leitura e o `UPDATE ... PROMOTING` havia uma
 * janela em que uma segunda promoção do mesmo run lia PREVIEWED também — e com
 * `NEW_REVISION` as duas gravavam, produzindo uma correção fantasma com os
 * mesmos fatos. `FOR UPDATE` fecha a janela: a segunda espera a primeira
 * terminar e então lê o estado que a primeira deixou.
 */
async function lockRun(
  tx: Database,
  importRunId: string,
  allowed: string[],
): Promise<typeof importRunTable.$inferSelect> {
  const { rows } = (await tx.execute(
    sql`SELECT * FROM ${importRunTable} WHERE ${importRunTable.id} = ${importRunId} FOR UPDATE`,
  )) as unknown as { rows: Record<string, unknown>[] };
  const row = rows[0];
  if (!row) throw new Error(`Import run ${importRunId} not found.`);
  const status = String(row.status);
  if (!allowed.includes(status)) {
    throw new Error(
      `Import run ${importRunId} is ${status}; this step requires ${allowed.join(" or ")}.`,
    );
  }
  return {
    ...(row as unknown as typeof importRunTable.$inferSelect),
    sourceFileId: String(row.source_file_id),
    status: status as typeof importRunTable.$inferSelect["status"],
  };
}

/**
 * Promover um run já conferido para a camada canônica, numa transação só.
 *
 * Tudo o que decide acontece aqui dentro, nesta ordem: travar o run, reler o
 * estado dele, resolver a identidade canônica de cada vigência, travar essa
 * identidade, olhar o que já está ativo, decidir, gravar. Nada é lido fora e
 * usado como verdade lá dentro.
 *
 * O que cada decisão significa:
 *
 *  - **Não existe vigência ativa** → revisão 1, com os fatos do arquivo.
 *  - **Existe e o dado normalizado é o mesmo** → `SKIPPED_DUPLICATE_DATA`.
 *    Nenhuma revisão é aberta: uma revisão que não muda nada é ruído de
 *    auditoria. É o que reconhece o mesmo XLSX reexportado com outros bytes.
 *  - **Existe e o arquivo traz componentes que ela não tem** (o cavalo depois
 *    da carreta) → revisão nova que **funde** os dois. É o fluxo normal de duas
 *    entregas, e é o que impede que a segunda entrega abra uma segunda vigência
 *    ativa.
 *  - **Existe e o arquivo reescreve componentes que ela já tem** → é correção,
 *    e correção é declarada: sem `NEW_REVISION` a promoção é recusada com
 *    `VIGENCIA_ATIVA_EXISTENTE` e o run continua aprovável.
 *
 * Em todos os casos, ao final existe **uma** vigência ativa para a identidade —
 * e o índice único do banco garante isso mesmo que este código erre.
 */
export async function promote(
  db: Database,
  importRunId: string,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const mode = options.onExistingSnapshot ?? "FAIL";
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;

      // 1. travar e reler o run — dentro da transação, nunca fora
      const run = await lockRun(tx, importRunId, ["PREVIEWED"]);
      await recusarIdentidadeNaoDeclarada(tx, importRunId, options.confirmNewEntityTypes);

      await tx
        .update(importRunTable)
        .set({ status: "PROMOTING" })
        .where(eq(importRunTable.id, importRunId));

      const [file] = await tx
        .select()
        .from(sourceFileTable)
        .where(eq(sourceFileTable.id, run.sourceFileId));

      const staged = await tx
        .select()
        .from(stagedFactTable)
        .where(eq(stagedFactTable.importRunId, importRunId));

      /*
        Defesa em profundidade: a pré-visualização já recusa o run vazio, mas
        um run PREVIEWED de antes desta guarda — ou qualquer caminho futuro
        que a contorne — não pode terminar "PROMOTED" sem um fato sequer. Uma
        promoção vazia é o falso verde perfeito: sucesso, zero conteúdo.
      */
      if (staged.length === 0) {
        throw new PromocaoRecusada(
          "Nada a promover: nenhuma célula deste arquivo virou fato. Confira os " +
            "papéis das abas nesta importação — a causa mais comum é a origem ter " +
            "renomeado uma coluna estrutural (Vigência, ou as colunas de identidade).",
          "PROMOCAO_VAZIA_RECUSADA",
          "VALIDATION_ERROR",
        );
      }

      const byLabel = new Map<string, typeof staged>();
      for (const fact of staged) {
        const bucket = byLabel.get(fact.snapshotLabel);
        if (bucket) bucket.push(fact);
        else byLabel.set(fact.snapshotLabel, [fact]);
      }

      const labels = [...byLabel.keys()].sort((a, b) => {
        const da = parseVigenciaLabel(a).effectiveDate ?? "";
        const db_ = parseVigenciaLabel(b).effectiveDate ?? "";
        return da.localeCompare(db_);
      });

      const dataTypeByCode = resolveDataTypes(staged);

      const attributeCache = new Map<string, string>();
      const entityCache = new Map<string, string>();
      const scopeCache = new Map<string, string>();
      let attributesCreated = 0;
      let entitiesCreated = 0;
      let factsInserted = 0;
      const result: PromoteResult["snapshots"] = [];
      const duplicadasPorDados: string[] = [];

      const groups: { label: string; facts: typeof staged }[] = [];
      for (const label of labels) {
        for (const facts of groupFactsByEntityScope(byLabel.get(label)!)) {
          groups.push({ label, facts });
        }
      }

      for (const { label, facts } of groups) {
        const vigencia = parseVigenciaLabel(label);
        const effectiveDate = vigencia.effectiveDate!;
        const entityTypes = [...new Set(facts.map((f) => f.entityType))].sort();
        const datasetFamily = datasetFamilyOfSet(entityTypes);
        // O conjunto de tipos da vigência gravada. Começa sendo o que o arquivo
        // trouxe e cresce com o que for herdado da revisão anterior — uma
        // revisão que carrega as carretas junto precisa *dizer* que cobre
        // carretas, ou as telas que listam as séries a partir daqui perdem uma
        // delas enquanto os fatos dela estão presentes.
        let tiposDaVigencia = entityTypes;
        const canal = normalizeChannel(vigencia.channel ?? label);

        // --- escopo -------------------------------------------------------
        const scopeIds = await resolveScopes(tx, facts, scopeCache);
        const scopeHash = hashScopeSet(scopeIds.descriptors);
        const canonicalScope = canonicalScopeOf(scopeIds.entries);

        const faltando = missingRequiredScopeTypes(canonicalScope);
        if (faltando.length > 0) {
          throw new PromocaoRecusada(
            `A vigência ${label} não declara ${faltando.join(", ")}, que é o que identifica de quem é a remuneração. ` +
              `Sem esse componente, duas unidades diferentes teriam a mesma identidade. Corrija a origem e envie o arquivo de novo.`,
            "ESCOPO_OBRIGATORIO_AUSENTE",
            "VALIDATION_ERROR",
            { label, faltando, escopoEncontrado: canonicalScope },
          );
        }

        const canonicalKey = canonicalSnapshotKey({
          sourceSystem: "FREIGHTEC",
          datasetFamily,
          channel: canal,
          effectiveDate,
          scope: canonicalScope,
        });

        // 2. travar a identidade de negócio.
        //
        // Advisory lock de transação, e não um mutex em memória: há mais de uma
        // instância do servidor, e um mutex por processo não vê a outra. Duas
        // promoções da mesma vigência serializam aqui; a segunda só olha o que
        // está ativo depois que a primeira comitou.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalKey}, 0))`,
        );

        // 3. o que já está ativo para esta identidade
        const [live] = await tx
          .select()
          .from(snapshotTable)
          .where(
            and(
              eq(snapshotTable.canonicalSnapshotKey, canonicalKey),
              sql`${snapshotTable.status} <> 'SUPERSEDED'`,
            ),
          );

        const incomingFacts: CanonicalFact[] = facts.map((f) => ({
          entityType: f.entityType,
          entityKey: f.entityKey,
          attributeCode: f.attributeCode,
          valueNumeric: f.valueNumeric,
          valueText: f.valueText,
          valueBoolean: f.valueBoolean,
          valueDate: f.valueDate,
          isNull: f.isNull,
        }));

        let revision = 1;
        let supersedes: string | null = null;
        let herdarDe: string | null = null;

        if (live) {
          const liveFacts = await fatosCanonicosDoSnapshot(tx, live.id);
          const tiposVivos = new Set(liveFacts.map((f) => f.entityType));
          const tiposEntrando = new Set(entityTypes);
          const preservados = liveFacts.filter((f) => !tiposEntrando.has(f.entityType));

          // O conteúdo que existiria depois de gravar: o que chega, mais o que
          // a vigência ativa já tinha e este arquivo não toca.
          const payloadResultante = canonicalPayloadHash([...incomingFacts, ...preservados]);
          const payloadVivo = canonicalPayloadHash(liveFacts);

          if (payloadResultante === payloadVivo) {
            duplicadasPorDados.push(label);
            await registrarDecisao(tx, {
              importRunId,
              decisao: "DUPLICATA_DE_DADOS",
              motivo:
                `O arquivo é diferente, mas os dados normalizados da vigência ${label} são iguais aos que já estão ativos ` +
                `(revisão ${live.revision}). Nenhuma revisão foi aberta e nada foi duplicado.`,
              filename: file?.filename ?? null,
              contentSha256: file?.contentSha256 ?? null,
              canonicalPayloadHash: payloadResultante,
              canonicalSnapshotKey: canonicalKey,
              sourceLabel: label,
              effectiveDate,
              canal,
              datasetFamily,
              canonicalScope,
              snapshotId: live.id,
              revisionEncontrada: live.revision,
            });
            continue;
          }

          const sobrepostos = [...tiposEntrando].filter((t) => tiposVivos.has(t));
          if (sobrepostos.length > 0 && mode !== "NEW_REVISION") {
            throw new PromocaoRecusada(
              `Já existe uma versão ativa da vigência ${label} para este escopo (revisão ${live.revision}), ` +
                `e este arquivo reescreve ${sobrepostos.join(", ")}. Para substituir os dados, registre uma correção.`,
              "VIGENCIA_ATIVA_EXISTENTE",
              "PREVIEWED",
              {
                label,
                revisionAtiva: live.revision,
                snapshotAtivo: live.id,
                tiposSobrepostos: sobrepostos,
              },
            );
          }

          revision = live.revision + 1;
          supersedes = live.id;
          herdarDe = live.id;
          tiposDaVigencia = [
            ...new Set([...entityTypes, ...preservados.map((f) => f.entityType)]),
          ].sort();

          // A anterior sai de cena **antes** de a nova entrar.
          //
          // O índice único que garante "uma ativa por identidade" é parcial —
          // `WHERE status <> 'SUPERSEDED'` — e DRAFT não é SUPERSEDED. Inserir
          // a revisão nova enquanto a anterior ainda está ativa esbarra no
          // próprio índice que protege a invariante. Aqui não há janela: as
          // duas escritas estão na mesma transação, e a identidade está travada
          // pelo advisory lock desde antes da leitura.
          await tx
            .update(snapshotTable)
            .set({ status: "SUPERSEDED" })
            .where(eq(snapshotTable.id, live.id));
        }

        const [snapshot] = await tx
          .insert(snapshotTable)
          .values({
            sourceFileId: run.sourceFileId,
            importRunId,
            sourceSystem: "FREIGHTEC",
            sourceLabel: label,
            effectiveDate,
            scopeHash,
            entityTypeSet: tiposDaVigencia.join("+"),
            datasetFamily,
            canal,
            canonicalScope,
            revision,
            supersedesSnapshotId: supersedes,
            status: "DRAFT",
          })
          .returning();

        if (scopeIds.ids.length > 0) {
          await tx
            .insert(snapshotScopeTable)
            .values(scopeIds.ids.map((scopeId) => ({ snapshotId: snapshot.id, scopeId })));
        }

        // --- atributos ----------------------------------------------------
        for (const code of new Set(facts.map((f) => f.attributeCode))) {
          if (attributeCache.has(code)) continue;
          const sample = facts.find((f) => f.attributeCode === code)!;
          const existing = await tx
            .select()
            .from(attributeTable)
            .where(eq(attributeTable.code, code));
          if (existing.length > 0) {
            attributeCache.set(code, existing[0].id);
            continue;
          }
          const sourceName = await sourceNameFor(tx, sample.rawCellId);
          const [created] = await tx
            .insert(attributeTable)
            .values({
              code,
              sourceName,
              displayName: sourceName,
              entityType: sample.entityType,
              dataType: dataTypeByCode.get(code) ?? "UNKNOWN",
              semanticsStatus: "UNKNOWN",
              firstSeenImportRunId: importRunId,
            })
            .returning();
          attributeCache.set(code, created.id);
          attributesCreated++;

          const sheetName = await sheetNameFor(tx, sample.rawCellId);
          await tx
            .insert(attributeAliasTable)
            .values({
              attributeId: created.id,
              sourceName,
              sourceSheet: sheetName,
              matchConfidence: "1.0000",
              firstSeenImportRunId: importRunId,
            })
            .onConflictDoNothing();
        }

        // --- entidades ------------------------------------------------------
        const entityKeys = new Map<string, { entityType: string; entityKey: string }>();
        for (const fact of facts) {
          entityKeys.set(`${fact.entityType}:${fact.entityKey}`, {
            entityType: fact.entityType,
            entityKey: fact.entityKey,
          });
        }

        for (const [cacheKey, info] of entityKeys) {
          if (entityCache.has(cacheKey)) continue;
          const [existing] = await tx
            .select({ entityId: entityIdentifierTable.entityId })
            .from(entityIdentifierTable)
            .where(
              and(
                eq(entityIdentifierTable.identifierType, "PLACA"),
                eq(entityIdentifierTable.identifierValue, info.entityKey),
                eq(entityIdentifierTable.isCurrent, true),
              ),
            );
          if (existing) {
            entityCache.set(cacheKey, existing.entityId);
            continue;
          }
          const [entity] = await tx
            .insert(entityTable)
            .values({
              entityType: info.entityType,
              firstSeenImportRunId: importRunId,
            })
            .returning();
          await tx.insert(entityIdentifierTable).values({
            entityId: entity.id,
            identifierType: "PLACA",
            identifierValue: info.entityKey,
            identifierValueRaw:
              facts.find(
                (f) => f.entityType === info.entityType && f.entityKey === info.entityKey,
              )?.entityKeyRaw ?? info.entityKey,
            effectiveFrom: effectiveDate,
            isCurrent: true,
            sourceImportRunId: importRunId,
          });
          entityCache.set(cacheKey, entity.id);
          entitiesCreated++;
        }

        await recordChassisIdentifiers(tx, facts, entityCache, effectiveDate, importRunId);

        // --- fatos ------------------------------------------------------------
        const factRows = facts.map((f) => ({
          snapshotId: snapshot.id,
          entityId: entityCache.get(`${f.entityType}:${f.entityKey}`)!,
          attributeId: attributeCache.get(f.attributeCode)!,
          valueNumeric: f.valueNumeric,
          valueText: f.valueText,
          valueBoolean: f.valueBoolean,
          valueDate: f.valueDate,
          valueHash: f.valueHash,
          isNull: f.isNull,
          nullReason: f.nullReason,
          rawCellId: f.rawCellId,
        }));
        await insertChunked(tx, factTable, factRows as never[]);
        factsInserted += factRows.length;

        // Os componentes que a revisão anterior tinha e este arquivo não toca
        // vêm junto. Sem isto, uma correção só de cavalos apagaria as carretas
        // da vigência — que é o preço que se pagaria por ter uma identidade só.
        let herdados = 0;
        if (herdarDe) {
          const tiposEntrando = entityTypes;
          const { rowCount } = (await tx.execute(sql`
            INSERT INTO ${factTable} (
              snapshot_id, entity_id, attribute_id, value_numeric, value_text,
              value_boolean, value_date, value_hash, is_null, null_reason, raw_cell_id,
              inherited_from_snapshot_id
            )
            SELECT ${snapshot.id}::uuid, f.entity_id, f.attribute_id, f.value_numeric, f.value_text,
                   f.value_boolean, f.value_date, f.value_hash, f.is_null, f.null_reason, f.raw_cell_id,
                   ${herdarDe}::uuid
              FROM ${factTable} f
              JOIN ${entityTable} e ON e.id = f.entity_id
             WHERE f.snapshot_id = ${herdarDe}::uuid
               AND e.entity_type <> ALL(${sql.raw(`ARRAY[${tiposEntrando.map((t) => `'${t.replace(/'/g, "''")}'`).join(",") || "NULL"}]::text[]`)})
          `)) as unknown as { rowCount: number };
          herdados = rowCount ?? 0;
          factsInserted += herdados;
        }

        // --- layout -----------------------------------------------------------
        const perAttribute = new Map<
          string,
          { valueCount: number; nullCount: number; rawCellId: number }
        >();
        for (const f of facts) {
          let entry = perAttribute.get(f.attributeCode);
          if (!entry) {
            entry = { valueCount: 0, nullCount: 0, rawCellId: f.rawCellId };
            perAttribute.set(f.attributeCode, entry);
          }
          if (f.isNull) entry.nullCount++;
          else entry.valueCount++;
        }
        const layoutRows = [];
        for (const [code, stats] of perAttribute) {
          const location = await cellLocation(tx, stats.rawCellId);
          layoutRows.push({
            snapshotId: snapshot.id,
            attributeId: attributeCache.get(code)!,
            sourceSheet: location.sheetName,
            columnIndex: location.columnIndex,
            presentInLayout: true,
            valueCount: stats.valueCount,
            nullCount: stats.nullCount,
          });
        }
        await insertChunked(tx, snapshotAttributeTable, layoutRows as never[]);

        // O layout dos componentes herdados vem **depois** do layout do arquivo:
        // o `NOT IN` só consegue excluir o que já está gravado, e invertendo a
        // ordem as duas inserções disputam o mesmo (snapshot, atributo).
        if (herdarDe) {
          await tx.execute(sql`
            INSERT INTO ${snapshotAttributeTable} (
              snapshot_id, attribute_id, source_sheet, column_index,
              present_in_layout, value_count, null_count
            )
            SELECT ${snapshot.id}::uuid, sa.attribute_id, sa.source_sheet, sa.column_index,
                   sa.present_in_layout, sa.value_count, sa.null_count
              FROM ${snapshotAttributeTable} sa
             WHERE sa.snapshot_id = ${herdarDe}::uuid
               AND sa.attribute_id NOT IN (
                 SELECT attribute_id FROM ${snapshotAttributeTable} WHERE snapshot_id = ${snapshot.id}::uuid
               )
          `);
        }

        // --- cobertura --------------------------------------------------------
        /*
          O agregado por equipamento, contado agora e não em leitura.

          É o denominador da matriz de Cobertura de dados: quantos cavalos e
          quantas carretas esta vigência tem, e quantos fatos de cada um vieram
          com valor, vieram vazios e vieram herdados. Perguntar isso depois
          custaria `count(DISTINCT entity_id)` sobre a fact table — 208 ms com
          124 mil fatos, medido no export real, sobre a tabela que é justamente
          a que cresce para milhões.

          Aqui é barato porque os fatos acabaram de ser escritos e a transação
          ainda os tem à mão, e é exato porque conta os fatos em vez de inferir
          a densidade do arquivo. Fica antes do `CLOSED` de propósito: depois
          dele o gatilho `fact_immutable` congela o que esta contagem lê.
        */
        await tx.execute(sql`
          INSERT INTO ${snapshotEntityTypeTable} (
            snapshot_id, entity_type, entity_count, attribute_count,
            fact_count, value_count, null_count, inherited_fact_count
          )
          SELECT ${snapshot.id}::uuid,
                 e.entity_type,
                 count(DISTINCT f.entity_id)::int,
                 count(DISTINCT f.attribute_id)::int,
                 count(*)::int,
                 count(*) FILTER (WHERE NOT f.is_null)::int,
                 count(*) FILTER (WHERE f.is_null)::int,
                 count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL)::int
            FROM ${factTable} f
            JOIN ${entityTable} e ON e.id = f.entity_id
           WHERE f.snapshot_id = ${snapshot.id}::uuid
           GROUP BY e.entity_type
              ON CONFLICT (snapshot_id, entity_type) DO NOTHING
        `);

        // --- fechar -----------------------------------------------------------
        const [contagem] = await tx
          .select({
            entidades: sql<number>`count(distinct ${factTable.entityId})`.mapWith(Number),
            fatos: sql<number>`count(*)`.mapWith(Number),
          })
          .from(factTable)
          .where(eq(factTable.snapshotId, snapshot.id));

        const payloadFinal = canonicalPayloadHash(
          await fatosCanonicosDoSnapshot(tx, snapshot.id),
        );

        await tx
          .update(snapshotTable)
          .set({
            status: "CLOSED",
            closedAt: new Date(),
            entityCount: contagem.entidades,
            factCount: contagem.fatos,
            canonicalPayloadHash: payloadFinal,
          })
          .where(eq(snapshotTable.id, snapshot.id));

        if (supersedes) {
          await tx.insert(snapshotMergeTable).values({
            snapshotId: snapshot.id,
            mergedFrom: [supersedes],
            revisoesOriginais: [revision - 1],
            canonicalSnapshotKey: canonicalKey,
            motivo:
              herdados > 0
                ? `Revisão ${revision} da vigência ${label}: o arquivo trouxe ${entityTypes.join("+")} e ${herdados} fatos dos componentes não tocados foram herdados da revisão ${revision - 1}.`
                : `Revisão ${revision} da vigência ${label}, substituindo a revisão ${revision - 1}.`,
          });
        }

        await registrarDecisao(tx, {
          importRunId,
          decisao: supersedes ? "REVISAO_CRIADA" : "PROMOVIDO",
          motivo: supersedes
            ? `Vigência ${label} gravada como revisão ${revision}; a revisão ${revision - 1} passou a SUPERSEDED.`
            : `Vigência ${label} gravada como revisão 1.`,
          filename: file?.filename ?? null,
          contentSha256: file?.contentSha256 ?? null,
          canonicalPayloadHash: payloadFinal,
          canonicalSnapshotKey: canonicalKey,
          sourceLabel: label,
          effectiveDate,
          canal,
          datasetFamily,
          canonicalScope,
          snapshotId: snapshot.id,
          revisionEncontrada: supersedes ? revision - 1 : null,
          revisionCriada: revision,
          detalhe: {
            entityTypeSet: tiposDaVigencia.join("+"),
            tiposDoArquivo: entityTypes,
            fatosHerdados: herdados,
          },
        });

        result.push({
          id: snapshot.id,
          label,
          effectiveDate,
          revision,
          entityCount: contagem.entidades,
          factCount: contagem.fatos,
        });
      }

      /*
        A versão 1 nasce junto do atributo, na mesma transação que o criou.

        Antes disto a semântica versionada de um atributo só existia se alguém
        rodasse `backfillSemantics` — um lote da curadoria que o `dev-seed` e os
        testes chamam, e que nenhum caminho de produção chama nunca. Medido num
        banco com o export real promovido: 138 atributos, 138 sem versão. A
        importação criava metade da verdade e a outra metade ficava esperando
        uma mão que não vinha.

        Aqui, e não junto do `INSERT` de cada atributo, por causa da data: a
        versão inicial cobre a série inteira, e o início da série só está
        completo depois que todas as vigências deste run entraram. Uma chamada
        por promoção também normaliza o começo quando o arquivo é retroativo.

        Não inventa semântica nenhuma: a versão copia o atributo, que acabou de
        nascer `UNKNOWN` e com tudo nulo. Ver `garantirSemanticaInicial`.
      */
      await garantirSemanticaInicial(tx as unknown as Database);

      /*
        A árvore da taxonomia, antes das confirmações — e a ordem é a correção.

        Os 22 nós são estrutura obrigatória: são os mesmos em toda base, e sem
        eles nada tem onde ser classificado. A confirmação canônica que vem
        logo abaixo **vincula** o atributo ao nó (`cf_financiamento`,
        `cf_depreciacao`…), e vincular exige que o nó já exista. Semear depois
        deixaria os 17 atributos do registro confirmados e sem nó, esperando
        uma segunda passada — que é exatamente o que se via no `dev-seed`, onde
        a árvore chega depois e as confirmações precisam ser reaplicadas.

        Medido em 17/08/2026, num banco vazio, importando pela mesma rota que a
        tela chama: zero nós depois da promoção. O único caminho de produção que
        semeava a árvore era um segundo handler de `POST /imports/:id/promote`,
        em `overview.ts`, que o Express nunca alcançava — `importsRouter` é
        montado antes e serve a rota. Aquele handler foi removido junto desta
        correção: um caminho aparente é pior que caminho nenhum, porque quem o
        lê conclui que a curadoria é atualizada a cada promoção.

        `runProposalPass` continua **fora**, e isto é fronteira, não esquecimento:
        propor semântica é inferência do motor, e a promoção só garante o que é
        verdade estrutural do produto.
      */
      const taxonomia = await garantirTaxonomiaCanonica(
        tx as unknown as Database,
        options.promotedBy ?? "import:promocao",
      );

      /*
        E o significado que já é conhecido, na mesma transação.

        A versão 1 nasce aqui desde a correção acima — e nascia dizendo "não
        sei" sobre colunas cujo significado já estava decidido e escrito. O
        registro de `CONFIRMED_SEMANTICS` existe desde 10/08/2026, com a
        medição de cada entrada ao lado; o que não existia era um caminho de
        produção que o aplicasse. Ele era chamado pelo `dev-seed`, pelo
        `curate-report` e pelos testes — nenhum dos três é por onde um arquivo
        da Ambev entra. Medido contra o export de agosto/2026: 62 cavalos com o
        FINAME no banco e 62 cards lendo "não apurado", porque o portão do
        motor exige semântica CONFIRMADA e ninguém a havia carimbado.

        Aqui, e não numa rota nem num script, pelo mesmo argumento que trouxe
        `garantirSemanticaInicial`: promover é o único ponto por onde todo
        arquivo passa. Aplicar depois, fora da transação, deixaria uma janela em
        que a frota inteira lê "não apurado" — e uma falha no meio deixaria a
        base com metade da verdade, que é o estado que este bloco existe para
        não produzir.

        Isto **não decide semântica nenhuma**: replica decisões que uma pessoa
        já tomou, e recusa-se a tocar em atributo que alguém confirmou de outro
        jeito. O que ela deixa de fora volta no resultado, nomeado.
      */
      const confirmacoes = await aplicarConfirmacoesCanonicas(
        tx as unknown as Database,
      );

      /*
        E a classe de custo dos que acabaram de ser classificados.

        Terceira garantia estrutural, na mesma transação e pelo mesmo motivo das
        duas de cima: um atributo confirmado sem classe de custo some das telas
        de custo fixo e variável e da DRE sem uma linha de erro. A passada de
        propostas não o alcança — ela só olha o que **não** está confirmado —, e
        `cavalo.ipva_licenciamento` nasce confirmado pelas confirmações
        canônicas.

        Preenche só o que está vazio: quem decidiu a classe tem valor gravado.
      */
      await garantirClasseDeCustoPadrao(tx as unknown as Database);

      // Um run em que **toda** vigência já existia idêntica não é uma promoção
      // vazia: é uma duplicata de dados, e o estado diz isso.
      const nadaEntrou = result.length === 0 && duplicadasPorDados.length > 0;
      await tx
        .update(importRunTable)
        .set({
          status: nadaEntrou ? "SKIPPED_DUPLICATE_DATA" : "PROMOTED",
          finishedAt: new Date(),
          snapshotCount: result.length,
          failureReason: nadaEntrou
            ? `O arquivo é diferente, mas os dados normalizados já estavam registrados (${duplicadasPorDados.join(", ")}). Nada foi duplicado.`
            : null,
        })
        .where(eq(importRunTable.id, importRunId));

      return {
        snapshotIds: result.map((s) => s.id),
        snapshots: result,
        entitiesCreated,
        attributesCreated,
        factsInserted,
        taxonomia: {
          nosCriados: taxonomia.created,
          nosExistentes: taxonomia.existing,
        },
        semanticasConfirmadas: {
          aplicadas: confirmacoes.applied.length,
          jaConfirmadas: confirmacoes.unchanged.length,
          divergentes: confirmacoes.divergentes,
          incoerentes: confirmacoes.incoerentes,
        },
      };
    });
  } catch (err) {
    // A transação voltou atrás — inclusive o estado do run. A decisão que
    // explica a recusa é gravada aqui fora, senão a recusa some junto e o
    // operador fica com uma tela que não diz nada.
    if (err instanceof PromocaoRecusada) {
      await db
        .update(importRunTable)
        .set({
          status: err.runStatus,
          failureReason: err.message,
          finishedAt: err.runStatus === "VALIDATION_ERROR" ? new Date() : null,
        })
        .where(eq(importRunTable.id, importRunId));
      await registrarDecisao(db, {
        importRunId,
        decisao: err.decisao,
        motivo: err.message,
        sourceLabel: (err.detalhe.label as string) ?? null,
        snapshotId: (err.detalhe.snapshotAtivo as string) ?? null,
        revisionEncontrada: (err.detalhe.revisionAtiva as number) ?? null,
        detalhe: err.detalhe,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// failure
// ---------------------------------------------------------------------------

/**
 * Close a run that could not be read.
 *
 * A run left in READING or STAGED after the process gave up is worse than a
 * failed one: the screen keeps polling it forever, and the person waits for
 * something that is not coming. The reason travels to the card, so it is
 * stored as it will be read.
 */
export async function markRunFailed(
  db: Database,
  importRunId: string,
  reason: string,
): Promise<void> {
  await db
    .update(importRunTable)
    .set({ status: "FAILED", failureReason: reason, finishedAt: new Date() })
    .where(eq(importRunTable.id, importRunId));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function requireRun(
  db: Database,
  importRunId: string,
  allowed: string[],
): Promise<typeof importRunTable.$inferSelect> {
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  if (!run) throw new Error(`Import run ${importRunId} not found.`);
  if (!allowed.includes(run.status)) {
    throw new Error(
      `Import run ${importRunId} is ${run.status}; this step requires ${allowed.join(" or ")}.`,
    );
  }
  return run;
}

/**
 * Resolve each attribute's data type from *every* staged value in the run,
 * not just the first vigência.
 *
 * The real export needs this: `dataFimContrato` arrives date-formatted for 496
 * cavalos rows and as a bare serial for 62 others, in the same column of the
 * same sheet. Judging from one snapshot would label the attribute TEXT and
 * hide the inconsistency; judging from all of them reports MIXED, which is the
 * truth and a curation task.
 */
function resolveDataTypes(
  facts: {
    attributeCode: string;
    valueNumeric: string | null;
    valueText: string | null;
    valueBoolean: boolean | null;
    valueDate: string | null;
    isNull: boolean;
  }[],
): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.isNull) continue;
    let bucket = seen.get(f.attributeCode);
    if (!bucket) {
      bucket = new Set();
      seen.set(f.attributeCode, bucket);
    }
    if (f.valueNumeric !== null) bucket.add("NUMERIC");
    else if (f.valueBoolean !== null) bucket.add("BOOLEAN");
    else if (f.valueDate !== null) bucket.add("DATE");
    else if (f.valueText !== null) bucket.add("TEXT");
  }
  const resolved = new Map<string, string>();
  for (const [code, types] of seen) {
    resolved.set(code, types.size === 1 ? [...types][0] : "MIXED");
  }
  return resolved;
}

async function sourceNameFor(tx: Database, rawCellId: number): Promise<string> {
  const [cell] = await tx
    .select({ header: rawCellTable.columnHeader })
    .from(rawCellTable)
    .where(eq(rawCellTable.id, rawCellId));
  return cell?.header ?? "(unknown)";
}

async function sheetNameFor(tx: Database, rawCellId: number): Promise<string> {
  const [row] = await tx
    .select({ sheetName: rawSheetTable.sheetName })
    .from(rawCellTable)
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(rawCellTable.id, rawCellId));
  return row?.sheetName ?? "(unknown)";
}

async function cellLocation(
  tx: Database,
  rawCellId: number,
): Promise<{ sheetName: string; columnIndex: number }> {
  const [row] = await tx
    .select({
      sheetName: rawSheetTable.sheetName,
      columnIndex: rawCellTable.columnIndex,
    })
    .from(rawCellTable)
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(rawCellTable.id, rawCellId));
  return {
    sheetName: row?.sheetName ?? "(unknown)",
    columnIndex: row?.columnIndex ?? -1,
  };
}

/**
 * Um arquivo pode trazer mais de uma unidade sob a mesma vigência — um export
 * consolidado, e não um por unidade. `promote` costumava tratar cada rótulo de
 * vigência como uma identidade só, então essas linhas caíam todas num único
 * snapshot cujo escopo era a união de todas as unidades encontradas, e a tela
 * que lê `canonicalScope[0]` mostrava só a primeira (por ordem de byte) — as
 * outras existiam nos fatos, mas não em lugar nenhum que alguém abrisse.
 *
 * Aqui as linhas de um mesmo rótulo são separadas pelo escopo que cada uma
 * declara para si (mesma leitura de `SCOPE_COLUMNS` que `resolveScopes` faz,
 * mas por entidade em vez de para o lote inteiro), e cada grupo vira depois um
 * snapshot próprio — exatamente como se tivesse chegado em arquivos
 * separados. Um arquivo de unidade única, sem essa ambiguidade, produz um
 * grupo só e nada muda para ele.
 */
function groupFactsByEntityScope<T extends { entityType: string; entityKey: string; attributeCode: string; valueText: string | null; valueNumeric: string | null }>(
  facts: T[],
): T[][] {
  const scopeKeyByEntity = new Map<string, string[]>();
  for (const [foldedHeader, config] of Object.entries(SCOPE_COLUMNS)) {
    const slug = slugifyColumn(foldedHeader);
    for (const fact of facts) {
      const suffix = fact.attributeCode.split(".").slice(1).join(".");
      if (suffix !== slug) continue;
      const code = (fact.valueText ?? fact.valueNumeric ?? "").trim();
      if (code === "") continue;
      const entityFullKey = `${fact.entityType}:${fact.entityKey}`;
      const pieces = scopeKeyByEntity.get(entityFullKey) ?? [];
      const piece = `${config.scopeType}:${code}`;
      if (!pieces.includes(piece)) pieces.push(piece);
      scopeKeyByEntity.set(entityFullKey, pieces);
    }
  }

  const groups = new Map<string, T[]>();
  for (const fact of facts) {
    const entityFullKey = `${fact.entityType}:${fact.entityKey}`;
    const scopeKey = (scopeKeyByEntity.get(entityFullKey) ?? []).sort().join("|");
    const bucket = groups.get(scopeKey);
    if (bucket) bucket.push(fact);
    else groups.set(scopeKey, [fact]);
  }
  return [...groups.values()];
}

async function resolveScopes(
  tx: Database,
  facts: (typeof stagedFactTable.$inferSelect)[],
  cache: Map<string, string>,
): Promise<{ ids: string[]; descriptors: string[]; entries: ScopeEntry[] }> {
  const wanted = new Map<string, { scopeType: string; code: string; name: string | null }>();

  for (const [foldedHeader, config] of Object.entries(SCOPE_COLUMNS)) {
    const slug = slugifyColumn(foldedHeader);
    const nameSlug = config.nameColumn ? slugifyColumn(config.nameColumn) : null;
    for (const fact of facts) {
      const suffix = fact.attributeCode.split(".").slice(1).join(".");
      if (suffix !== slug) continue;
      const code = (fact.valueText ?? fact.valueNumeric ?? "").trim();
      if (code === "") continue;
      const name =
        nameSlug === null
          ? null
          : (facts.find(
              (f) =>
                f.entityKey === fact.entityKey &&
                f.entityType === fact.entityType &&
                f.attributeCode.split(".").slice(1).join(".") === nameSlug,
            )?.valueText ?? null);
      wanted.set(`${config.scopeType}:${code}`, {
        scopeType: config.scopeType,
        code,
        name,
      });
    }
  }

  const ids: string[] = [];
  const descriptors: string[] = [];
  // As entradas saem daqui **antes** de virar hash: a identidade canônica
  // normaliza cada código (CNPJ sem máscara, com o zero da frente de volta), e
  // `descriptors` guarda o código como veio, que é o que `scope_hash` sempre
  // usou e o que os snapshots antigos têm gravado.
  const entries: ScopeEntry[] = [];
  for (const [key, info] of [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    descriptors.push(key);
    entries.push({ scopeType: info.scopeType, code: info.code });
    const cached = cache.get(key);
    if (cached) {
      ids.push(cached);
      continue;
    }
    const [existing] = await tx
      .select()
      .from(scopeTable)
      .where(
        and(eq(scopeTable.scopeType, info.scopeType), eq(scopeTable.code, info.code)),
      );
    if (existing) {
      cache.set(key, existing.id);
      ids.push(existing.id);
      continue;
    }
    const [created] = await tx
      .insert(scopeTable)
      .values({ scopeType: info.scopeType, code: info.code, name: info.name })
      .returning();
    cache.set(key, created.id);
    ids.push(created.id);
  }

  return { ids, descriptors, entries };
}

/**
 * Deterministic fingerprint of a snapshot's scope set. Part of the business
 * key, so a Camaçari export can never collide with a Recife one.
 */
export function hashScopeSet(descriptors: string[]): string {
  const canonical = [...descriptors].sort().join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Attach CHASSI as a second identifier of the same permanent entity.
 *
 * A chassis already current for a *different* entity is a real-world data
 * problem: it is reported and skipped rather than silently overwriting either
 * side of the conflict.
 */
async function recordChassisIdentifiers(
  tx: Database,
  facts: (typeof stagedFactTable.$inferSelect)[],
  entityCache: Map<string, string>,
  effectiveDate: string,
  importRunId: string,
): Promise<void> {
  const chassisByEntity = new Map<string, { chassis: string; legivel: string }>();
  for (const fact of facts) {
    const suffix = fact.attributeCode.split(".").slice(1).join(".");
    if (suffix !== "chassi" || fact.isNull) continue;
    const value = (fact.valueText ?? "").trim();
    if (value === "") continue;
    chassisByEntity.set(`${fact.entityType}:${fact.entityKey}`, {
      chassis: value,
      legivel: fact.entityKeyRaw ?? fact.entityKey,
    });
  }

  for (const [cacheKey, { chassis, legivel }] of chassisByEntity) {
    const entityId = entityCache.get(cacheKey);
    if (!entityId) continue;
    const [entityType] = cacheKey.split(":");
    const [existing] = await tx
      .select()
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "CHASSI"),
          eq(entityIdentifierTable.identifierValue, chassis),
          eq(entityIdentifierTable.isCurrent, true),
        ),
      );
    if (existing) {
      if (existing.entityId !== entityId) {
        const rotulo = tipoDeImportacao(entityType)?.rotulo ?? entityType;
        await tx.insert(validationIssueTable).values({
          importRunId,
          severity: "ERROR",
          code: "ENTITY_IDENTIFIER_CONFLICT",
          message:
            `O chassi ${chassis} já pertence, hoje, a outro veículo no sistema; ` +
            `ele não foi vinculado a ${rotulo} "${legivel}". Os valores da linha ` +
            `entraram normalmente.`,
          detail: {
            chassis,
            existingEntityId: existing.entityId,
            entityId,
            apresentacao: {
              titulo: "Um chassi do arquivo já pertence a outro veículo",
              resumo:
                `O chassi ${chassis} já está, hoje, vinculado a outro veículo no ` +
                `sistema. Ele não foi vinculado a ${rotulo} "${legivel}"; os ` +
                `valores da linha entraram normalmente.`,
              registro: [
                ...registroDoTipo(entityType, legivel),
                { campo: "chassi", valor: chassis },
              ],
              comoCorrigir:
                "Confira na planilha se o chassi está na linha do veículo certo. " +
                "Se o chassi mudou mesmo de veículo, trate a troca com a curadoria " +
                "— ela é registrada com histórico, não por importação.",
              porQueImporta:
                "Dois veículos com o mesmo chassi corromperiam o histórico dos " +
                "dois; o vínculo existente fica de pé até alguém decidir.",
            } satisfies ApresentacaoDeApontamento,
          },
        });
      }
      continue;
    }
    await tx.insert(entityIdentifierTable).values({
      entityId,
      identifierType: "CHASSI",
      identifierValue: chassis,
      effectiveFrom: effectiveDate,
      isCurrent: true,
      sourceImportRunId: importRunId,
    });
  }
}
