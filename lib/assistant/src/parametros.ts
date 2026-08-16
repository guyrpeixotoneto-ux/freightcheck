/**
 * CORPUS B — o dicionário de parâmetros, e a ponte entre o que se pergunta e o
 * que existe no banco.
 *
 * Quem opera diz "combustível". O banco tem `cavalo.combustivel_consumo_neg`,
 * `cavalo.combustivel_capacidade` e mais cinco. Este módulo faz essa travessia,
 * e a faz **com evidência**: toda escolha carrega por que aquele atributo foi
 * escolhido, e uma escolha de baixa confiança não vira resposta — vira
 * pergunta de volta.
 *
 * **A escada de resolução, na ordem.** Correspondência exata do código; alias
 * de origem (`attribute_alias`, o nome da coluna como a planilha a escreveu);
 * nome humano do dicionário de rótulos; nome do parâmetro no agrupamento de
 * famílias; e por fim busca textual sobre todos esses campos normalizados. A
 * ordem importa: um acerto exato nunca é desempatado por um acerto textual, e é
 * isso que impede "IPVA" de virar "IPVA licenciamento mensal" só porque o
 * segundo tem mais palavras em comum com a frase.
 *
 * **Não há embedding, e é uma decisão medida.** A Fase 7 confronta esta escada
 * com as perguntas reais; se ela não bastar, o passo seguinte é `pgvector`. Até
 * lá, uma resolução que se explica em cinco linhas de log vale mais que uma que
 * acerta um pouco mais e não se explica.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { attributeLabel, placementOf } from "@workspace/comparison";
import { normalizar, termos } from "./normalizar";

export interface Parametro {
  /** `cavalo.combustivel_consumo_neg` */
  codigo: string;
  /** O nome humano — de `labels.ts` quando conhecido, derivado quando não. */
  rotulo: string;
  /** O cabeçalho como a planilha o escreve: `combustivelConsumoNeg`. */
  nomeDeOrigem: string;
  /** CAVALO ou CARRETA. */
  equipamento: string;
  unidade: string | null;
  periodicidade: string | null;
  agregacao: string | null;
  /** CONFIRMED | PRESUMED | UNKNOWN — decide se a variação pode virar dinheiro. */
  semantica: string;
  monetario: boolean | null;
  /**
   * Para que lado o dinheiro anda quando este número anda, do ponto de vista da
   * transportadora — `HIGHER_IS_BETTER`, `HIGHER_IS_WORSE`, `NEUTRAL`,
   * `DEPENDS_ON_FORMULA`, ou `null` quando ninguém curou.
   *
   * `null` não é `NEUTRAL`: o primeiro é ausência de curadoria, o segundo é uma
   * afirmação. Quem raciocina sobre isto precisa distinguir os dois, e é por
   * isso que a coluna nasceu anulável em vez de com default.
   */
  direcaoEconomica: string | null;
  /** A direção em uma frase, escrita por quem cura. */
  efeitoEconomico: string | null;
  /** O que a coluna significa, quando a curadoria escreveu. */
  definicao: string | null;
  /** A gaveta em que ele aparece na tela de Parâmetros. */
  parametro: string;
  familia: string;
  /** Os nomes de coluna que a fonte já usou para este atributo. */
  aliases: string[];
  /** Tudo por que ele pode ser procurado, normalizado. */
  termos: string[];
}

// ── Carga ───────────────────────────────────────────────────────────────────

interface LinhaCrua extends Record<string, unknown> {
  code: string;
  source_name: string;
  display_name: string | null;
  entity_type: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  semantics_status: string;
  is_monetary: boolean | null;
  economic_direction: string | null;
  economic_effect: string | null;
  definition: string | null;
  aliases: string[] | null;
}

/** `combustivelConsumoNeg` → "combustivel consumo neg" */
function separarCamelCase(texto: string): string {
  return texto
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function montarTermos(p: Omit<Parametro, "termos">): string[] {
  const cru = [
    p.codigo,
    p.codigo.split(".").slice(1).join("."),
    separarCamelCase(p.nomeDeOrigem),
    p.rotulo,
    p.parametro,
    p.familia,
    ...p.aliases.map(separarCamelCase),
  ];

  const saida = new Set<string>();
  for (const item of cru) {
    if (!item) continue;
    const inteiro = normalizar(item).replace(/[._-]+/g, " ").trim();
    if (inteiro) saida.add(inteiro);
    for (const palavra of termos(item.replace(/[._-]+/g, " "))) saida.add(palavra);
  }
  return [...saida];
}

let cache: { em: number; parametros: Parametro[] } | null = null;

/**
 * Sessenta segundos de cache.
 *
 * O dicionário só muda quando uma planilha é promovida ou uma semântica é
 * confirmada — eventos raros e humanos. Reler 138 linhas a cada pergunta é
 * desperdício; um minuto de defasagem depois de uma confirmação é invisível
 * para quem conversa. O valor é curto de propósito: nenhum caminho do produto
 * precisa invalidar este cache à mão, e um cache que precisa de invalidação
 * explícita é um cache que um dia serve dado velho.
 */
const VALIDADE_MS = 60_000;

export async function carregarDicionario(db: Database): Promise<Parametro[]> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.parametros;

  const { rows } = await db.execute<LinhaCrua>(sql`
    SELECT a.code,
           a.source_name,
           a.display_name,
           a.entity_type,
           a.unit,
           a.periodicity,
           a.aggregation,
           a.semantics_status::text AS semantics_status,
           a.is_monetary,
           a.economic_direction,
           a.economic_effect,
           a.definition,
           coalesce(
             array_agg(DISTINCT al.source_name) FILTER (WHERE al.source_name IS NOT NULL),
             '{}'
           ) AS aliases
      FROM attribute a
      LEFT JOIN attribute_alias al ON al.attribute_id = a.id
     GROUP BY a.id
     ORDER BY a.code
  `);

  const parametros = rows.map((linha) => {
    const colocacao = placementOf(linha.code);
    const base: Omit<Parametro, "termos"> = {
      codigo: linha.code,
      rotulo: attributeLabel(linha.code, linha.source_name, linha.display_name),
      nomeDeOrigem: linha.display_name ?? linha.source_name,
      equipamento: linha.entity_type,
      unidade: linha.unit,
      periodicidade: linha.periodicity,
      agregacao: linha.aggregation,
      semantica: linha.semantics_status,
      monetario: linha.is_monetary,
      direcaoEconomica: linha.economic_direction,
      efeitoEconomico: linha.economic_effect,
      definicao: linha.definition,
      parametro: colocacao.parameter,
      familia: colocacao.familyName,
      aliases: (linha.aliases ?? []).filter((a) => a && a !== linha.source_name),
    };
    return { ...base, termos: montarTermos(base) };
  });

  cache = { em: Date.now(), parametros };
  return parametros;
}

/** Só para os testes: força a próxima carga a ir ao banco. */
export function limparCacheDoDicionario(): void {
  cache = null;
}

// ── Resolução ───────────────────────────────────────────────────────────────

/**
 * O que se resolve é a **gaveta**, não a coluna.
 *
 * Foi o primeiro desenho deste módulo, e estava errado: ele tentava eleger um
 * atributo, e então "combustível" ficava ambíguo entre sete colunas e "IPVA"
 * entre três. Isso não é ambiguidade — é a granularidade errada. Quem digita
 * "combustível" está falando da gaveta que a tela de Parâmetros chama de
 * Combustível, exatamente como o produto já a agrupa em `families.ts`.
 *
 * Ambiguidade de verdade é quando o termo casa **gavetas diferentes**. Aí sim o
 * assistente pergunta, porque escolher daria uma resposta coerente sobre outro
 * assunto.
 *
 * Carreta e cavalo dentro da mesma gaveta também não são ambiguidade: são as
 * duas séries independentes que este produto sempre manteve separadas. A gaveta
 * diz em quais equipamentos ela existe, e quem consome decide se precisa de um
 * ou dos dois.
 */
export type ComoAchou =
  | "CODIGO_EXATO"
  | "ALIAS"
  | "ROTULO"
  | "NOME_DA_GAVETA"
  | "TEXTUAL";

export interface Alvo {
  /** A gaveta: "Combustível", "IPVA e licenciamento", "Financiamento". */
  parametro: string;
  familia: string;
  /** Os atributos dela que casaram o termo. */
  atributos: Parametro[];
  /** CAVALO, CARRETA, ou os dois. */
  equipamentos: string[];
  confianca: number;
  como: ComoAchou;
  /** Por que esta gaveta foi escolhida — vai junto na resposta. */
  evidencia: string;
}

export interface Resolucao {
  termo: string;
  /** As gavetas que casaram, da mais provável para a menos. */
  alvos: Alvo[];
  escolhido: Alvo | null;
  /** Duas gavetas diferentes empatadas: o assistente pergunta. */
  ambiguo: boolean;
}

const CONFIANCA_MINIMA = 0.45;
const MARGEM = 0.15;

const PESOS: Record<ComoAchou, number> = {
  CODIGO_EXATO: 1,
  ALIAS: 0.95,
  ROTULO: 0.9,
  NOME_DA_GAVETA: 0.8,
  TEXTUAL: 0.5,
};

/**
 * Palavras que aparecem no nome de muitas gavetas e não distinguem nenhuma.
 *
 * Sem esta lista, "qual o valor do IPVA?" casaria toda gaveta cujo nome contém
 * "valor" com a mesma força de IPVA, e a desambiguação viraria moeda ao alto.
 */
const PALAVRAS_FRACAS = new Set([
  "valor", "valores", "custo", "custos", "total", "geral", "outros", "outras",
  "novo", "nova", "ciclo", "fixo", "fixa", "simulado", "previsto", "aplicado",
  "mensal", "anual", "modelo",
]);

/**
 * O quanto o nome desta gaveta aparece na pergunta.
 *
 * Devolve a palavra mais distintiva encontrada e a **fração** do nome que a
 * pergunta cobre. A fração é o que separa "Manutenção cavalo" de "Manutenção
 * BID" quando alguém digita os dois termos: as duas casam "manutenção", e só
 * uma casa o nome inteiro. Sem ela as duas empatavam, e a gaveta que a pessoa
 * escreveu por extenso virava pergunta de desambiguação.
 */
function nomeDaGavetaNaPergunta(
  gaveta: string,
  palavras: string[],
): { palavra: string; cobertura: number } | null {
  const doNome = termos(gaveta).filter((p) => !PALAVRAS_FRACAS.has(p));
  if (doNome.length === 0) return null;

  let melhor: string | null = null;
  let casadas = 0;
  for (const p of doNome) {
    if (!palavras.some((q) => q === p || q.startsWith(p) || p.startsWith(q))) continue;
    casadas += 1;
    if (!melhor || p.length > melhor.length) melhor = p;
  }
  return melhor ? { palavra: melhor, cobertura: casadas / doNome.length } : null;
}

/**
 * Do que se digita à gaveta que existe no banco.
 *
 * Devolve todas as gavetas candidatas, mesmo havendo vencedora: quem responde
 * precisa poder dizer "há sete atributos de combustível, e nenhum é preço".
 * Uma resolução que devolve só a vencedora esconde justamente o que torna a
 * resposta auditável.
 */
export async function resolverParametro(
  db: Database,
  termo: string,
  opcoes: { equipamento?: string } = {},
): Promise<Resolucao> {
  const dicionario = await carregarDicionario(db);
  const alvo = normalizar(termo).trim();
  const palavras = termos(termo);

  if (!alvo || palavras.length === 0) {
    return { termo, alvos: [], escolhido: null, ambiguo: false };
  }

  interface Acerto {
    atributo: Parametro;
    como: ComoAchou;
    base: number;
    evidencia: string;
  }

  const acertos: Acerto[] = [];

  for (const p of dicionario) {
    if (opcoes.equipamento && p.equipamento !== opcoes.equipamento) continue;

    let melhor: Acerto | null = null;
    const registrar = (como: ComoAchou, base: number, evidencia: string) => {
      const peso = PESOS[como] * base;
      if (!melhor || peso > PESOS[melhor.como] * melhor.base) {
        melhor = { atributo: p, como, base, evidencia };
      }
    };

    const semPrefixo = normalizar(p.codigo).split(".").slice(1).join(".");
    if (normalizar(p.codigo) === alvo || semPrefixo === alvo) {
      registrar("CODIGO_EXATO", 1, `o código da coluna é exatamente "${termo}"`);
    }
    if (
      normalizar(p.nomeDeOrigem) === alvo ||
      normalizar(separarCamelCase(p.nomeDeOrigem)) === alvo ||
      p.aliases.some((a) => normalizar(a) === alvo || normalizar(separarCamelCase(a)) === alvo)
    ) {
      registrar("ALIAS", 1, `"${termo}" é o cabeçalho desta coluna na planilha`);
    }
    if (normalizar(p.rotulo) === alvo) {
      registrar("ROTULO", 1, `"${termo}" é o nome desta coluna na tela`);
    }

    /*
      O termo é o nome da gaveta, escrito inteiro.

      Vale tanto quanto o rótulo de uma coluna: quem digita "manutenção cavalo"
      não está sendo aproximado, está copiando o que a tela de Parâmetros
      mostra. Sem esta regra, o nome completo pontuava igual a qualquer gaveta
      que compartilhasse uma palavra com ele, e a resposta virava pergunta.
    */
    if (normalizar(p.parametro) === alvo) {
      registrar("ROTULO", 1, `"${termo}" é o nome desta gaveta na tela de Parâmetros`);
    }

    const noNome = nomeDaGavetaNaPergunta(p.parametro, palavras);
    if (noNome) {
      // Palavra longa é palavra específica: "combustivel" identifica; "pneu"
      // também, mas com menos margem. Abaixo de cinco letras a chance de
      // colisão com outro assunto cresce, e a confiança acompanha.
      const porTamanho = noNome.palavra.length >= 5 ? 1 : 0.8;
      // A cobertura desempata sem dominar: um nome coberto pela metade continua
      // candidato — "IPVA" tem de achar "IPVA e licenciamento" —, só perde para
      // quem foi escrito por inteiro.
      const base = porTamanho * (0.6 + 0.4 * noNome.cobertura);
      registrar(
        "NOME_DA_GAVETA",
        base,
        `"${noNome.palavra}" é o nome da gaveta "${p.parametro}" na tela de Parâmetros`,
      );
    }

    if (!melhor) {
      const casadas = palavras.filter((palavra) =>
        p.termos.some((t) => t === palavra || t.includes(palavra)),
      );
      if (casadas.length > 0) {
        registrar(
          "TEXTUAL",
          casadas.length / palavras.length,
          `"${casadas.join('", "')}" aparece no nome ou no código desta coluna`,
        );
      }
    }

    if (melhor) acertos.push(melhor);
  }

  // ---- agrupar por gaveta ---------------------------------------------------
  const porGaveta = new Map<string, Acerto[]>();
  for (const acerto of acertos) {
    const chave = acerto.atributo.parametro;
    const lista = porGaveta.get(chave) ?? [];
    lista.push(acerto);
    porGaveta.set(chave, lista);
  }

  const alvos: Alvo[] = [];
  for (const [gaveta, lista] of porGaveta) {
    const melhor = lista.reduce((a, b) =>
      PESOS[b.como] * b.base > PESOS[a.como] * a.base ? b : a,
    );
    alvos.push({
      parametro: gaveta,
      familia: melhor.atributo.familia,
      atributos: lista.map((a) => a.atributo).sort((a, b) => a.codigo.localeCompare(b.codigo)),
      equipamentos: [...new Set(lista.map((a) => a.atributo.equipamento))].sort(),
      confianca: Number((PESOS[melhor.como] * melhor.base).toFixed(3)),
      como: melhor.como,
      evidencia: melhor.evidencia,
    });
  }

  alvos.sort((a, b) => b.confianca - a.confianca || b.atributos.length - a.atributos.length);

  const primeiro = alvos[0];
  const segundo = alvos[1];

  if (!primeiro || primeiro.confianca < CONFIANCA_MINIMA) {
    return { termo, alvos, escolhido: null, ambiguo: false };
  }

  const ambiguo = Boolean(segundo && primeiro.confianca - segundo.confianca < MARGEM);

  return { termo, alvos, escolhido: ambiguo ? null : primeiro, ambiguo };
}
