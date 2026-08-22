import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { normalizeDocumento } from "@workspace/ingest";

/**
 * A IDENTIDADE ESCRITA DO LADO DE REMUNERAÇÃO — a outra metade da associação.
 *
 * **O defeito que este arquivo fecha, e ele derrubava o devido inteiro.** A
 * identidade canônica era escrita em `fechamento_competencia.unidade_id` por
 * todo caminho em que ela passa a ser conhecida — abrir competência, cadastrar
 * a unidade, associar à mão (`identidade-da-competencia.ts`) — e em
 * `remuneracao_unidade.unidade_id` por **um** só: o `INSERT` de
 * `registrarUnidade`. Não havia rota, função nem tela que a escrevesse num
 * cadastro já existente.
 *
 * A assimetria não era inócua, porque `resolverUnidade` (em
 * `cadastro-da-remuneracao.ts`) recusa o casamento textual assim que a
 * competência tem identidade — e recusa com razão: era ele que fazia o contrato
 * de uma unidade responder pelo fechamento de outra. O resultado é que associar
 * a unidade **derrubava** um cadastro que estava respondendo:
 *
 *     antes de associar   → RESPONDEU (casou EXATO)      → comparado existe
 *     depois de associar  → UNIDADE_SEM_CADASTRO         → comparado é null
 *
 * O mesmo cadastro, as mesmas linhas digitadas, as duas quinzenas. E sem saída
 * pelo produto: o conserto que a tela oferecia — *"associe o cadastro à mesma
 * unidade"* — não existia como ato, e `excluirUnidadeRegistrada` recusa apagar
 * uma unidade com planilha, de modo que "recadastrar já associado" custava
 * apagar e redigitar a aba inteira.
 *
 * **Por que mora na borda, e não em `@workspace/remuneracao`.** É a mesma razão
 * de `cadastro-da-remuneracao.ts`, ao lado: as faixas de casamento são as dele —
 * exato, aparado, documento —, e a regra que **escreve** a identidade tem de ser
 * a mesma que a **lê**. Postas em pacotes diferentes, elas divergiriam no dia
 * em que uma das duas mudasse, e a divergência apareceria como esta mesma tela
 * vazia. Além disso `normalizeDocumento` é de `@workspace/ingest`, que
 * `@workspace/remuneracao` só conhece como dependência de teste.
 *
 * **O que ela nunca faz.** Não sobrescreve identidade já escrita — a leitura
 * filtra `unidade_id IS NULL` e o `UPDATE` repete a guarda, de modo que rodar
 * duas vezes não reescreve nada. Não adivinha por nome: dois CDDs podem
 * chamar-se igual, e é a única coisa que esta cadeia inteira se recusa a fazer.
 * E não escolhe diante de conflito — ver {@link ConciliacaoDoCadastro.ambiguas}.
 */

/** Um cadastro de Remuneração sem identidade, como a conciliação o vê. */
export interface CadastroSemIdentidade {
  scopeHash: string;
  /** `null` é a série sem canal — a coluna guarda `''`. */
  canal: string | null;
  codigo: string;
  nome: string;
}

/** A unidade canônica, como ela entra no relatório. */
export interface UnidadeCandidata {
  id: string;
  nome: string;
  cnpj: string;
}

/**
 * Como a identidade foi sabida — as duas únicas formas aceitas.
 *
 * `CODIGO_AFIRMADO` é uma pessoa dizendo "esta grafia é desta unidade"; é o
 * mesmo ato que `conciliarIdentidadeDasCompetencias` já propagava do outro
 * lado. `DOCUMENTO` é aritmética: os dígitos do código do cadastro são o CNPJ
 * canônico de uma unidade, e `unidade.cnpj` tem índice único — não há duas.
 */
export type ComoSoube = "CODIGO_AFIRMADO" | "DOCUMENTO";

/**
 * O que uma passada fez — e o que ela deliberadamente não fez.
 *
 * `ambiguas` não é falha: é a situação em que os dois sinais determinísticos
 * discordam — a pessoa afirma que a grafia é da unidade A e os dígitos do mesmo
 * código são o CNPJ da unidade B. Escolher um deles em silêncio poria o
 * contrato de uma unidade a responder pelo fechamento de outra, que é
 * exatamente o que a recusa de `resolverUnidade` existe para impedir. Listar é
 * o que permite a uma pessoa decidir.
 *
 * O cadastro que não casa por nenhuma das duas faixas simplesmente não entra em
 * lista nenhuma: não é pendência, é o estado normal de quem cadastrou pelo nome
 * e ainda não tem CNPJ. Ele continua sendo alcançável pelo texto enquanto a
 * competência dele não tiver identidade, e passa a ser conciliável no dia em
 * que alguém afirmar a grafia ou informar o código.
 */
export interface ConciliacaoDoCadastro {
  associadas: (CadastroSemIdentidade & { unidade: UnidadeCandidata; como: ComoSoube })[];
  ambiguas: (CadastroSemIdentidade & { candidatas: UnidadeCandidata[] })[];
}

const VAZIA: ConciliacaoDoCadastro = { associadas: [], ambiguas: [] };

type CadastroBruto = {
  id: string;
  scope_hash: string;
  canal: string;
  codigo: string;
  nome: string;
};

type UnidadeBruta = { id: string; nome: string; cnpj: string };

/**
 * Escreve a identidade nos cadastros de Remuneração que a têm e não a guardaram.
 *
 * **Idempotente por construção**, como a irmã dela do lado do Fechamento: só
 * toca em `unidade_id IS NULL`. Por isso pode ser chamada de todo lugar onde a
 * identidade passa a ser conhecida — cadastrar a unidade canônica, associar uma
 * competência à mão, e a partida do servidor — sem que a ordem entre esses atos
 * importe.
 *
 * **`codigos` é uma afirmação de quem chama, e não uma busca.** Quem associa uma
 * competência sabe que aquele texto é daquela unidade; passar a grafia junto é
 * dizer "esta grafia é desta unidade", e aí a conciliação não deduz nada — ela
 * propaga o que a pessoa acabou de afirmar. Sem afirmação, resta a faixa do
 * documento, que não depende de ninguém.
 */
export async function conciliarIdentidadeDoCadastro(
  db: Database,
  afirmacao?: {
    /** A unidade que quem chama acabou de tornar conhecida. */
    unidadeId: string;
    /** As grafias que quem chama afirma serem dela. */
    codigos: readonly string[];
  },
): Promise<ConciliacaoDoCadastro> {
  const { rows: pendentes } = await db.execute<CadastroBruto>(sql`
    SELECT u.id, u.scope_hash, u.canal, u.codigo, u.nome
      FROM remuneracao_unidade u
     WHERE u.unidade_id IS NULL
  `);
  if (pendentes.length === 0) return VAZIA;

  const { rows: unidades } = await db.execute<UnidadeBruta>(sql`
    SELECT u.id, u.nome, u.cnpj FROM unidade u
  `);
  if (unidades.length === 0) return VAZIA;

  /*
    O CNPJ canônico tem índice único (`unidade_cnpj_uq`) e a coluna é checada
    como catorze dígitos — o mapa não pode ter colisão, e é por isso que a faixa
    do documento é determinística sem precisar contar candidatas.
  */
  const porCnpj = new Map(unidades.map((u) => [u.cnpj, u]));

  /* A unidade afirmada, lida uma vez; as grafias dela são texto, não busca. */
  let afirmada: UnidadeCandidata | null = null;
  const grafias = new Set<string>();
  if (afirmacao) {
    afirmada = unidades.find((u) => u.id === afirmacao.unidadeId) ?? null;
    for (const codigo of afirmacao.codigos) {
      const texto = codigo.trim();
      if (texto !== "") grafias.add(texto);
    }
  }

  const resultado: ConciliacaoDoCadastro = { associadas: [], ambiguas: [] };

  for (const pendente of pendentes) {
    const onde: CadastroSemIdentidade = {
      scopeHash: pendente.scope_hash,
      canal: pendente.canal === "" ? null : pendente.canal,
      codigo: pendente.codigo,
      nome: pendente.nome,
    };

    /*
      As duas faixas, avaliadas em separado de propósito: é a discordância entre
      elas que precisa ser vista. `btrim` de um lado e `trim()` do outro é o
      `normalizarCodigo` do módulo de Remuneração — exato e aparado são a mesma
      faixa, porque o código canônico é, por definição dele, o digitado sem o
      espaço em volta.
    */
    const porAfirmacao = afirmada && grafias.has(pendente.codigo.trim()) ? afirmada : null;
    const documento = normalizeDocumento(pendente.codigo);
    const porDocumento = documento === "" ? null : (porCnpj.get(documento) ?? null);

    if (porAfirmacao && porDocumento && porAfirmacao.id !== porDocumento.id) {
      /*
        Os dois sinais discordam: alguém afirma que esta grafia é da unidade A e
        os dígitos dela são o CNPJ da unidade B. Nenhum dos dois é fraco o
        bastante para ser descartado, e escolher seria adivinhar — falha
        fechada, com as duas candidatas nomeadas para quem for decidir.
      */
      resultado.ambiguas.push({ ...onde, candidatas: [porAfirmacao, porDocumento] });
      continue;
    }

    const escolhida = porAfirmacao ?? porDocumento;
    if (!escolhida) continue;

    /*
      A guarda `unidade_id IS NULL` repetida no `UPDATE`: entre o `SELECT` acima
      e este comando outro caminho pode ter escrito a identidade, e sobrescrever
      o que ele decidiu seria esta conciliação passar por cima de uma afirmação
      mais forte do que a dela.
    */
    const { rowCount } = await db.execute(sql`
      UPDATE remuneracao_unidade
         SET unidade_id = ${escolhida.id}
       WHERE id = ${pendente.id}
         AND unidade_id IS NULL
    `);
    if (rowCount === 0) continue;

    resultado.associadas.push({
      ...onde,
      unidade: escolhida,
      como: porAfirmacao ? "CODIGO_AFIRMADO" : "DOCUMENTO",
    });
  }

  return resultado;
}
