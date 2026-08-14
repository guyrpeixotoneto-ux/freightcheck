/**
 * O que `/api/healthz` precisa responder é uma pergunta operacional:
 * a DATABASE_URL chegou a *este* processo?
 *
 * Cada caso abaixo é um desfecho que já apareceu ou pode aparecer no
 * deployment, e cujo diagnóstico, sem isto, dependia de ler log de plataforma.
 */
import { describe, expect, it } from "vitest";
import { describeDatabase } from "../health";

const semSchema = async () => ({ migrated: false });
const comSchema = async () => ({ migrated: true });

/**
 * Uma URL qualquer, sempre passada de propósito: o padrão do parâmetro lê
 * `process.env`, e um teste que depende do ambiente de quem o roda passa ou
 * falha por motivo errado.
 */
const URL = "postgres://alguem@algum-host:5432/algum-banco";

function falhaCom(code: string, message = "erro"): () => Promise<never> {
  return async () => {
    throw Object.assign(new Error(message), { code });
  };
}

describe("describeDatabase", () => {
  it("sem a variável, diz que o problema é a variável não ter chegado", async () => {
    const saude = await describeDatabase(comSchema, undefined);

    expect(saude.configured).toBe(false);
    expect(saude.reachable).toBe(false);
    // A distinção que importa: o banco pode estar vivo; o que falta é a
    // variável. Confundir os dois foi o que levou a quase criar outro banco.
    expect(saude.detail).toMatch(/o que falta é a variável chegar/i);
  });

  it("com a variável e o banco fora, separa 'chegou' de 'conectou'", async () => {
    const saude = await describeDatabase(falhaCom("ECONNREFUSED"), URL);

    expect(saude.configured).toBe(true);
    expect(saude.reachable).toBe(false);
    expect(saude.code).toBe("ECONNREFUSED");
  });

  it("credencial recusada e banco inexistente têm explicações próprias", async () => {
    expect((await describeDatabase(falhaCom("28P01"), URL)).detail).toMatch(
      /credenciais/i,
    );
    expect((await describeDatabase(falhaCom("3D000"), URL)).detail).toMatch(
      /não existe/i,
    );
  });

  it("conectado sem schema aponta as migrations, não a conexão", async () => {
    const saude = await describeDatabase(semSchema, URL);

    expect(saude.reachable).toBe(true);
    expect(saude.migrated).toBe(false);
    expect(saude.detail).toMatch(/migrations/i);
  });

  it("conectado e migrado é o único estado em que tudo é verdadeiro", async () => {
    const saude = await describeDatabase(comSchema, URL);

    expect(saude).toMatchObject({
      configured: true,
      reachable: true,
      migrated: true,
    });
    expect(saude.code).toBeUndefined();
  });

  /**
   * O estado que faltava, e que custou uma tarde: schema aplicado *quase*
   * inteiro. `migrated` olhava uma tabela da primeira migration e dizia "sim"
   * num banco a que faltavam as duas últimas — então a tela do Book do
   * Operador recebia 500 e o diagnóstico apontava para a tela.
   */
  it("com migrations faltando, nomeia quais e não se declara em dia", async () => {
    const saude = await describeDatabase(
      async () => ({
        migrated: true,
        migrations: {
          expected: 10,
          applied: 8,
          pending: ["0008_book_entries", "0009_entity_type_correction"],
        },
      }),
      URL,
    );

    expect(saude.migrated).toBe(true);
    expect(saude.upToDate).toBe(false);
    expect(saude.detail).toMatch(/0008_book_entries/);
    expect(saude.detail).toMatch(/0009_entity_type_correction/);
    expect(saude.migrations?.pending).toHaveLength(2);
  });

  it("diz onde a tentativa parou, com o SQLSTATE que o banco devolveu", async () => {
    const saude = await describeDatabase(
      async () => ({
        migrated: true,
        migrations: {
          expected: 10,
          applied: 9,
          pending: ["0009_entity_type_correction"],
          failure: { tag: "0009_entity_type_correction", code: "42501" },
        },
      }),
      URL,
    );

    expect(saude.detail).toMatch(/parou em 0009_entity_type_correction/);
    expect(saude.detail).toMatch(/42501/);
    // A mensagem do driver nunca atravessa: ela carrega host e usuário, e este
    // endpoint é público. Só o código e o nome da migration.
    expect(JSON.stringify(saude)).not.toMatch(/permission denied/i);
  });

  it("nada pendente é o que faz o banco estar em dia", async () => {
    const saude = await describeDatabase(
      async () => ({
        migrated: true,
        migrations: { expected: 10, applied: 10, pending: [] },
      }),
      URL,
    );

    expect(saude.upToDate).toBe(true);
    expect(saude.detail).toMatch(/schema aplicado/);
  });

  it("nunca deixa a URL, o host ou o usuário vazarem na resposta", async () => {
    const url = "postgres://usuario:senha@db.interno.exemplo:5432/producao";
    const saude = await describeDatabase(
      // Mensagens de driver carregam a URL inteira; esta rota é pública.
      falhaCom("ECONNREFUSED", `connect ECONNREFUSED ${url}`),
      url,
    );

    const serializado = JSON.stringify(saude);
    for (const segredo of ["senha", "usuario", "db.interno.exemplo", "5432"]) {
      expect(serializado).not.toContain(segredo);
    }
  });
});
