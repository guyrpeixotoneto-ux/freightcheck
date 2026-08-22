import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { fechamentoCompetenciaTable, lerCnpj, unidadeTable, type Database } from "@workspace/db";

/**
 * A IDENTIDADE DE UMA COMPETÊNCIA — quando ela pode ser afirmada sozinha.
 *
 * **O defeito que este arquivo desfaz.** `unidade_id` só era escrito no momento
 * em que alguém *escolhia* a unidade na tela de abrir competência. Toda
 * competência aberta antes daquele seletor existir — e toda competência aberta
 * pelo caminho legado, que continua aceito — nascia com `unidade_id` nulo, e
 * **nada, em ponto nenhum do produto, voltava para preenchê-lo.** Cadastrar a
 * unidade canônica depois não as alcançava; cadastrar a aba de Remuneração
 * daquela unidade não as alcançava; associar a competência da 1ª quinzena não
 * alcançava a 2ª. A única saída era um botão que só aparecia numa tela que, com
 * metade do mês respondido, não aparecia.
 *
 * O caso real: julho/2026 do CDD Belém, as duas quinzenas abertas com o texto
 * `CDD Belém` no lugar do código, a 1ª associada à mão e a 2ª não. As duas
 * pediam o mesmo cadastro, da mesma unidade, e só uma o alcançava.
 *
 * **A regra: identidade se propaga, nunca se adivinha.** Duas afirmações
 * bastam, e nenhuma delas é semelhança de nome:
 *
 * - {@link porCnpjNoCodigo} — o texto da competência **é** um CNPJ válido, e há
 *   unidade canônica com ele. Não há o que interpretar: o documento é a
 *   identidade, e `unidade.cnpj` é único;
 * - {@link porDecisaoJaTomada} — outra competência com **exatamente o mesmo
 *   texto** já foi associada por uma pessoa. A identidade daquela é a desta:
 *   quem disse "este `CDD Belém` é esta unidade" disse sobre o texto, e o texto
 *   é o mesmo. Não é inferência sobre o nome — é a mesma chave respondida.
 *
 * **O que continua recusado.** Nome parecido, nome igual, prefixo, duas
 * unidades candidatas, e o texto sem CNPJ que ninguém nunca associou. Nesses
 * casos a resposta é `AMBIGUA` ou `DESCONHECIDA`, a competência fica sem
 * identidade — que é a resposta honesta — e a tela oferece a associação
 * manual, com o CNPJ ao lado de cada candidata. Dois CDDs podem chamar-se
 * igual, e é por isso que o nome nunca decide.
 *
 * **A competência encerrada não é tocada.** Não porque escrever uma coluna nula
 * seja perigoso, mas porque o efeito não é: com a unidade associada o Resumo
 * acha o contrato e recalcula o devido, e uma quinzena congelada que muda de
 * número é o que o encerramento existe para impedir. Ela sai da conciliação
 * listada — ver {@link Conciliacao} —, para a tela poder dizer que o conserto
 * dela é reabrir com motivo.
 */

/** Uma unidade canônica, como a conciliação a nomeia. */
export interface UnidadeCandidata {
  id: string;
  nome: string;
  /** Os catorze dígitos, sem máscara. */
  cnpj: string;
}

/** Por que a identidade pôde ser afirmada — o que a tela mostra e o log guarda. */
export type ComoSoube =
  /** O texto da competência é um CNPJ, e há unidade canônica com ele. */
  | "CNPJ_NO_CODIGO"
  /** Outra competência com o mesmo texto já foi associada por alguém. */
  | "DECISAO_JA_TOMADA"
  /** Quem chamou afirmou que este texto é desta unidade — ver `codigos`. */
  | "CODIGO_AFIRMADO";

export type IdentidadeDaCompetencia =
  | { tipo: "INEQUIVOCA"; unidade: UnidadeCandidata; como: ComoSoube }
  /**
   * Há mais de uma resposta, e escolher uma seria inventar identidade.
   *
   * Acontece quando duas competências com o mesmo texto foram associadas a
   * unidades diferentes — o que é um erro de alguém, e um que só uma pessoa
   * pode desfazer. Associar em silêncio poria o contrato de uma unidade a
   * responder pelo fechamento de outra.
   */
  | { tipo: "AMBIGUA"; candidatas: UnidadeCandidata[] }
  /** Ninguém nunca disse qual unidade é esta, e o texto não a diz. */
  | { tipo: "DESCONHECIDA" };

/**
 * O texto da competência é um CNPJ de unidade cadastrada?
 *
 * `lerCnpj` **recusa** o que não identifica — CPF, tamanho errado, dígito
 * verificador que não fecha —, e é essa recusa que separa esta faixa de
 * `normalizeDocumento`: aqui não se procura "o que parece documento", procura-se
 * um CNPJ. `CDD Belém` não passa por ela, e é o certo.
 */
async function porCnpjNoCodigo(
  db: Database,
  unidadeCodigo: string,
): Promise<UnidadeCandidata | null> {
  const { canonico } = lerCnpj(unidadeCodigo);
  if (canonico === null) return null;

  const [achada] = await db
    .select({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
    .from(unidadeTable)
    .where(eq(unidadeTable.cnpj, canonico))
    .limit(1);
  return achada ?? null;
}

/**
 * Alguém já respondeu por este mesmo texto noutra competência?
 *
 * O casamento é por texto **idêntico**, sem o espaço em volta — e é de propósito
 * que ele não vá além disso. `trim()` é a mesma normalização que
 * `normalizarCodigo` aplica no cadastro, e a única que o próprio módulo declara
 * segura ("o código canônico é o digitado sem o espaço em volta"). Qualquer
 * frouxidão a mais — caixa, acento, prefixo — deixaria de propagar uma decisão
 * e passaria a inferir uma, que é a fronteira que este arquivo inteiro guarda.
 *
 * Duas respostas diferentes para o mesmo texto não escolhem nenhuma.
 */
async function porDecisaoJaTomada(
  db: Database,
  unidadeCodigo: string,
  exceto: string | null,
): Promise<IdentidadeDaCompetencia> {
  const texto = unidadeCodigo.trim();
  if (texto === "") return { tipo: "DESCONHECIDA" };

  const irmas = await db
    .selectDistinct({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
    .from(fechamentoCompetenciaTable)
    .innerJoin(unidadeTable, eq(unidadeTable.id, fechamentoCompetenciaTable.unidadeId))
    .where(
      and(
        sql`btrim(${fechamentoCompetenciaTable.unidadeCodigo}) = ${texto}`,
        exceto ? ne(fechamentoCompetenciaTable.id, exceto) : undefined,
      ),
    );

  if (irmas.length === 0) return { tipo: "DESCONHECIDA" };
  if (irmas.length > 1) return { tipo: "AMBIGUA", candidatas: irmas };
  return { tipo: "INEQUIVOCA", unidade: irmas[0]!, como: "DECISAO_JA_TOMADA" };
}

/**
 * Qual unidade canônica esta competência é — quando dá para afirmar sozinho.
 *
 * A ordem é a da força da afirmação: o documento no próprio texto ganha da
 * decisão tomada noutra linha, porque não depende de ninguém ter acertado antes.
 */
export async function identidadeDaCompetencia(
  db: Database,
  entrada: {
    unidadeCodigo: string;
    /** A própria competência, quando ela já existe — não é irmã de si mesma. */
    competenciaId?: string | null;
  },
): Promise<IdentidadeDaCompetencia> {
  const porCnpj = await porCnpjNoCodigo(db, entrada.unidadeCodigo);
  if (porCnpj) return { tipo: "INEQUIVOCA", unidade: porCnpj, como: "CNPJ_NO_CODIGO" };

  return porDecisaoJaTomada(db, entrada.unidadeCodigo, entrada.competenciaId ?? null);
}

/** Uma competência que a conciliação encontrou sem identidade. */
export interface CompetenciaConciliada {
  competenciaId: string;
  chave: string;
  unidadeCodigo: string;
}

/**
 * O que uma passada de conciliação fez — e o que ela deliberadamente não fez.
 *
 * As três listas são o relatório que a tela e o teste leem. `ambiguas` e
 * `encerradas` não são falhas: são as duas situações em que a máquina para e
 * uma pessoa decide, e escondê-las faria a conciliação parecer completa quando
 * ela deixou trabalho para trás.
 */
export interface Conciliacao {
  associadas: (CompetenciaConciliada & { unidade: UnidadeCandidata; como: ComoSoube })[];
  ambiguas: (CompetenciaConciliada & { candidatas: UnidadeCandidata[] })[];
  /** Resolvíveis, e congeladas: o conserto delas é reabrir com motivo. */
  encerradas: (CompetenciaConciliada & { unidade: UnidadeCandidata })[];
}

const VAZIA: Conciliacao = { associadas: [], ambiguas: [], encerradas: [] };

/**
 * Escreve a identidade nas competências que a têm e não a guardaram.
 *
 * **Idempotente por construção.** Só toca em `unidade_id IS NULL`: rodar de
 * novo não reescreve nada, e rodar em banco já conciliado devolve as três
 * listas vazias. É por isso que ela pode ser chamada de todo lugar onde a
 * identidade passa a ser conhecida — abrir competência, cadastrar a unidade
 * canônica, associar uma competência à mão, registrar o cadastro de Remuneração
 * daquela unidade — sem que a ordem entre esses atos importe.
 *
 * **`codigos` é uma afirmação de quem chama, e não uma busca.** Quem cadastra a
 * unidade em Remuneração sabe que aquele código é daquela unidade; quem associa
 * uma competência sabe que aquele texto é dela. Passar os dois juntos é dizer
 * "estas grafias são desta unidade" — e aí a conciliação não precisa deduzir
 * nada: ela propaga o que a pessoa acabou de afirmar.
 */
export async function conciliarIdentidadeDasCompetencias(
  db: Database,
  afirmacao?: {
    /** A unidade que quem chama acabou de tornar conhecida. */
    unidadeId: string;
    /** As grafias que quem chama afirma serem dela. */
    codigos: readonly string[];
  },
): Promise<Conciliacao> {
  const pendentes = await db
    .select({
      id: fechamentoCompetenciaTable.id,
      chave: fechamentoCompetenciaTable.chave,
      unidadeCodigo: fechamentoCompetenciaTable.unidadeCodigo,
      estado: fechamentoCompetenciaTable.estado,
    })
    .from(fechamentoCompetenciaTable)
    .where(isNull(fechamentoCompetenciaTable.unidadeId));

  if (pendentes.length === 0) return VAZIA;

  /* A unidade afirmada, lida uma vez — as grafias dela são texto, não busca. */
  let afirmada: UnidadeCandidata | null = null;
  const grafias = new Set<string>();
  if (afirmacao) {
    const [canonica] = await db
      .select({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
      .from(unidadeTable)
      .where(eq(unidadeTable.id, afirmacao.unidadeId))
      .limit(1);
    afirmada = canonica ?? null;
    for (const codigo of afirmacao.codigos) {
      const texto = codigo.trim();
      if (texto !== "") grafias.add(texto);
    }
  }

  const resultado: Conciliacao = { associadas: [], ambiguas: [], encerradas: [] };

  for (const pendente of pendentes) {
    const onde = {
      competenciaId: pendente.id,
      chave: pendente.chave,
      unidadeCodigo: pendente.unidadeCodigo,
    };

    const identidade: IdentidadeDaCompetencia =
      afirmada && grafias.has(pendente.unidadeCodigo.trim())
        ? { tipo: "INEQUIVOCA", unidade: afirmada, como: "CODIGO_AFIRMADO" }
        : await identidadeDaCompetencia(db, {
            unidadeCodigo: pendente.unidadeCodigo,
            competenciaId: pendente.id,
          });

    if (identidade.tipo === "AMBIGUA") {
      resultado.ambiguas.push({ ...onde, candidatas: identidade.candidatas });
      continue;
    }
    if (identidade.tipo === "DESCONHECIDA") continue;

    /*
      A congelada é resolvível e fica de fora. É a regra de
      `associarUnidadeDaCompetencia`, e repeti-la aqui em vez de chamá-la é o
      que permite listar a competência em vez de interromper a passada inteira
      por causa dela.
    */
    if (pendente.estado === "ENCERRADA") {
      resultado.encerradas.push({ ...onde, unidade: identidade.unidade });
      continue;
    }

    await db
      .update(fechamentoCompetenciaTable)
      .set({ unidadeId: identidade.unidade.id })
      .where(
        and(
          eq(fechamentoCompetenciaTable.id, pendente.id),
          /* A guarda que faz a escrita idempotente sob concorrência. */
          isNull(fechamentoCompetenciaTable.unidadeId),
        ),
      );

    resultado.associadas.push({ ...onde, unidade: identidade.unidade, como: identidade.como });
  }

  return resultado;
}
