import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashScopeSet } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { sql } from "drizzle-orm";
import {
  CodigoRecusado,
  descritorDeEscopo,
  identificadorDaUnidade,
  informarCodigoDaUnidade,
  normalizarCodigo,
  registrarUnidade,
  unidadesRegistradas,
  unidadesRegistradasDoEscopo,
  UnidadeInvalida,
  UnidadeJaRegistrada,
  UnidadeNaoRegistrada,
  vigenciasDaUnidade,
} from "../unidade";

/**
 * A unidade registrada à mão — e a única promessa dela que vale dinheiro.
 *
 * Registrar uma unidade é barato de escrever e caro de errar: o erro não
 * aparece no dia em que se registra, e sim meses depois, quando o export chega.
 * Se o identificador não for **o mesmo** que a importação calcula, o arquivo
 * abre uma segunda unidade ao lado da primeira, a planilha digitada fica
 * pendurada na que ninguém mais olha, e o conserto é manual, por quem não
 * escreveu nenhuma das duas.
 *
 * É por isso que o primeiro bloco daqui compara o hash contra o
 * `hashScopeSet` de verdade, importado de `@workspace/ingest` — e não contra
 * uma constante copiada. Uma constante passaria a valer sozinha no dia em que
 * a importação mudasse a regra, que é exatamente o dia em que este teste
 * precisa falhar.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("remuneracao_unidade");
}, 300_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
}, 60_000);

beforeEach(async () => {
  await ctx.db.execute(sql`TRUNCATE remuneracao_unidade`);
  await ctx.db.execute(sql`TRUNCATE remuneracao_planilha`);
});

const AUTOR = { id: null, nome: "Guy" };

async function registrar(over: Partial<Parameters<typeof registrarUnidade>[1]> = {}) {
  const codigo = normalizarCodigo(String(over.codigo ?? "12345678000199"));
  return registrarUnidade(ctx.db, {
    scopeHash: hashScopeSet([descritorDeEscopo("UNIDADE", codigo)]),
    scopeType: "UNIDADE",
    codigo,
    nome: "CAMAÇARI",
    canal: "EMPURRADA",
    vigenciaInicial: "2026-08-01",
    autor: AUTOR,
    ...over,
  });
}

describe("o identificador é o mesmo que a importação calcularia", () => {
  it("soma o hash sobre o descritor `TIPO:código`, como `resolveScopes`", async () => {
    const u = await registrar({ codigo: "12345678000199" });

    // A forma do descritor é a que o pipeline monta antes de somar; se ela
    // mudar de um lado só, é aqui que se descobre.
    expect(u.scopeHash).toBe(hashScopeSet(["UNIDADE:12345678000199"]));
  });

  it("o código viaja como foi digitado — a máscara não é limpa", () => {
    /*
      A tentação é normalizar para `12345678000199`. O `scope_hash` da
      importação é somado sobre o código **como veio na célula**, com `trim` e
      nada mais: limpar a máscara aqui produziria o hash de um código que o
      arquivo não tem, e as duas unidades nunca se encontrariam — o defeito que
      este caminho existe para evitar, cometido pelo lado de dentro.
    */
    expect(normalizarCodigo("  12.345.678/0001-99 ")).toBe("12.345.678/0001-99");
    expect(hashScopeSet([descritorDeEscopo("UNIDADE", "12.345.678/0001-99")])).not.toBe(
      hashScopeSet([descritorDeEscopo("UNIDADE", "12345678000199")]),
    );
  });

  it("dois registros do mesmo código, em canais diferentes, dividem o escopo", async () => {
    // É a mesma unidade rodando duas operações — o par (escopo, canal) é que
    // as separa, exatamente como no acervo.
    const a = await registrar({ canal: "EMPURRADA" });
    const b = await registrar({ canal: "ROTA" });

    expect(a.scopeHash).toBe(b.scopeHash);
    expect(a.canal).toBe("EMPURRADA");
    expect(b.canal).toBe("ROTA");
  });
});

/**
 * Sobre qual texto o hash é somado — e o que muda quando não há código.
 *
 * A função é pura e mora no domínio porque a borda não pode escolher: se a rota
 * decidisse isso por conta, uma segunda borda (um import em lote, uma migração)
 * escolheria diferente, e duas unidades com o mesmo nome e sem código teriam
 * identificadores distintos sem que nada avisasse.
 */
describe("o identificador quando o código não vem", () => {
  it("com código, é o código — a máscara e tudo", () => {
    expect(identificadorDaUnidade({ codigo: " 12.345.678/0001-99 ", nome: "CAMAÇARI" })).toBe(
      "12.345.678/0001-99",
    );
  });

  it("sem código, é o nome normalizado", () => {
    expect(identificadorDaUnidade({ codigo: "   ", nome: " camaçari " })).toBe("CAMAÇARI");
  });

  it("nomes diferentes dão identificadores diferentes — nenhum `UNIDADE:` compartilhado", () => {
    const camacari = identificadorDaUnidade({ codigo: "", nome: "CAMAÇARI" });
    const belem = identificadorDaUnidade({ codigo: "", nome: "BELÉM" });

    expect(camacari).not.toBe(belem);
    expect(camacari).not.toBe("");
  });

  it("o hash do nome não é o hash do código — é este o preço, e ele é afirmado", () => {
    /*
      A unidade registrada sem código não recebe o export quando ele chegar: o
      arquivo abre a unidade dele ao lado desta. A tela diz isso embaixo do
      campo, e esta afirmação é o que impede a frase de virar mentira em
      silêncio no dia em que alguém "melhorar" a regra.
    */
    const porNome = descritorDeEscopo("UNIDADE", identificadorDaUnidade({
      codigo: "",
      nome: "CAMAÇARI",
    }));
    const porCodigo = descritorDeEscopo("UNIDADE", identificadorDaUnidade({
      codigo: "12345678000199",
      nome: "CAMAÇARI",
    }));

    expect(hashScopeSet([porNome])).not.toBe(hashScopeSet([porCodigo]));
  });
});

describe("o que a escrita recusa", () => {
  it("recusa o mesmo par (escopo, canal) duas vezes", async () => {
    await registrar();
    await expect(registrar()).rejects.toBeInstanceOf(UnidadeJaRegistrada);
  });

  it("a recusa manda para onde a unidade está, em vez de só dizer não", async () => {
    await registrar();
    await expect(registrar()).rejects.toThrow(/lista de unidades/);
  });

  it("recusa a unidade sem nome", async () => {
    await expect(registrar({ nome: "   " })).rejects.toBeInstanceOf(UnidadeInvalida);
  });
});

/**
 * Informar o código depois — o movimento, e o que ele recusa.
 *
 * O ato move **duas** tabelas na mesma transação, e é aí que ele pode falhar de
 * um jeito que ninguém vê: uma unidade que reaparece no lugar certo e vazia,
 * com o que alguém digitou pendurado num escopo que nenhuma tela mostra mais.
 * Os casos abaixo contam células, e não linhas de unidade, porque é a planilha
 * que se perde em silêncio.
 */
describe("informar o código depois", () => {
  const POR_NOME = hashScopeSet([descritorDeEscopo("UNIDADE", "CAMAÇARI")]);
  const POR_CODIGO = hashScopeSet([descritorDeEscopo("UNIDADE", "12345678000199")]);

  const informar = (codigo = "12345678000199") =>
    informarCodigoDaUnidade(ctx.db, {
      escopoAtual: POR_NOME,
      escopoNovo: hashScopeSet([descritorDeEscopo("UNIDADE", codigo)]),
      codigo,
    });

  const celula = (escopo: string, canal: string, vigencia: string, chave: string) =>
    ctx.db.execute(sql`
      INSERT INTO remuneracao_planilha (scope_hash, canal, effective_date, chave, valor)
      VALUES (${escopo}, ${canal}, ${vigencia}, ${chave}, '1')
    `);

  const quantasCelulas = async (escopo: string) => {
    const { rows } = await ctx.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM remuneracao_planilha WHERE scope_hash = ${escopo}`,
    );
    return rows[0]!.total;
  };

  it("move a unidade e grava o código", async () => {
    await registrar({ codigo: "", scopeHash: POR_NOME });

    const [movida] = await informar();

    expect(movida!.scopeHash).toBe(POR_CODIGO);
    expect(movida!.codigo).toBe("12345678000199");
    expect(await unidadesRegistradasDoEscopo(ctx.db, POR_NOME)).toHaveLength(0);
  });

  it("leva a planilha digitada junto — sem isso a unidade reaparece vazia", async () => {
    await registrar({ codigo: "", scopeHash: POR_NOME });
    await celula(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_pis");
    await celula(POR_NOME, "EMPURRADA", "2026-08-16", "aliquota_pis");

    await informar();

    expect(await quantasCelulas(POR_NOME)).toBe(0);
    expect(await quantasCelulas(POR_CODIGO)).toBe(2);
  });

  it("move os dois tipos de operação — o código é da unidade, não da operação", async () => {
    await registrar({ codigo: "", scopeHash: POR_NOME, canal: "EMPURRADA" });
    await registrar({ codigo: "", scopeHash: POR_NOME, canal: "ROTA" });

    const movidas = await informar();

    expect(movidas).toHaveLength(2);
    expect(movidas.every((u) => u.scopeHash === POR_CODIGO)).toBe(true);
  });

  it("recusa o escopo que não é de unidade cadastrada à mão", async () => {
    await expect(informar()).rejects.toBeInstanceOf(UnidadeNaoRegistrada);
  });

  it("recusa trocar um código que já vale", async () => {
    await registrar({ codigo: "99999999000199", scopeHash: POR_NOME });

    await expect(informar()).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it("recusa o destino que já é de outra unidade cadastrada à mão", async () => {
    await registrar({ codigo: "", scopeHash: POR_NOME });
    await registrar({ codigo: "12345678000199", scopeHash: POR_CODIGO, nome: "OUTRA" });

    await expect(informar()).rejects.toBeInstanceOf(CodigoRecusado);
  });

  it("recusa quando as duas planilhas têm a mesma célula, e não move nada", async () => {
    await registrar({ codigo: "", scopeHash: POR_NOME });
    await celula(POR_NOME, "EMPURRADA", "2026-08-01", "aliquota_pis");
    await celula(POR_NOME, "EMPURRADA", "2026-08-16", "aliquota_cofins");
    await celula(POR_CODIGO, "EMPURRADA", "2026-08-01", "aliquota_pis");

    await expect(informar()).rejects.toBeInstanceOf(CodigoRecusado);

    /*
      A afirmação que vale dinheiro: uma recusa não pode deixar a unidade
      metade aqui e metade lá. As duas células da origem continuam onde
      estavam, e a linha de unidade também.
    */
    expect(await quantasCelulas(POR_NOME)).toBe(2);
    expect(await unidadesRegistradasDoEscopo(ctx.db, POR_NOME)).toHaveLength(1);
  });
});

describe("o que a leitura devolve", () => {
  it("normaliza o nome e o canal, para a mesma unidade não virar duas na lista", async () => {
    await registrar({ nome: " camaçari ", canal: " empurrada " });
    const [u] = await unidadesRegistradas(ctx.db);

    expect(u!.nome).toBe("CAMAÇARI");
    expect(u!.canal).toBe("EMPURRADA");
  });

  it("a série sem canal volta como `null`, e não como a string vazia da coluna", async () => {
    /*
      A coluna guarda `''` porque dois `NULL` não colidem num índice único no
      Postgres. Quem lê trabalha com `null`, que é o que `chaveDoAlvo` e o resto
      do módulo esperam — a tradução tem de acontecer na borda da leitura.
    */
    await registrar({ canal: null });
    const [u] = await unidadesRegistradas(ctx.db);

    expect(u!.canal).toBeNull();
  });

  it("guarda quem registrou — a única procedência que a unidade tem sem acervo", async () => {
    await registrar();
    const [u] = await unidadesRegistradas(ctx.db);

    expect(u!.autorNome).toBe("Guy");
    expect(u!.criadaEm).not.toBe("");
  });
});

describe("as vigências que a unidade oferece", () => {
  it("a inicial sozinha, quando nada foi salvo ainda", () => {
    // Sem isto o seletor do formulário abriria vazio, e a tela inteira ficaria
    // inalcançável para a unidade que este caminho existe para atender.
    expect(vigenciasDaUnidade("2026-08-01", [])).toEqual(["2026-08-01"]);
  });

  it("junta a inicial com as da planilha, sem repetir e em ordem", () => {
    expect(vigenciasDaUnidade("2026-08-01", ["2026-08-16", "2026-08-01"])).toEqual([
      "2026-08-01",
      "2026-08-16",
    ]);
  });

  it("mantém a inicial mesmo quando a planilha só tem quinzenas posteriores", () => {
    // A inicial é declaração de quem registrou, e não derivada do que foi
    // salvo: sumir com ela apagaria a quinzena que alguém disse ser a primeira.
    expect(vigenciasDaUnidade("2026-07-01", ["2026-08-01"])).toEqual([
      "2026-07-01",
      "2026-08-01",
    ]);
  });
});
