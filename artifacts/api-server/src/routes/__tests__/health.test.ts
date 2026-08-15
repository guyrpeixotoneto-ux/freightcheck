/**
 * O que `/api/healthz` precisa responder é uma pergunta operacional:
 * a DATABASE_URL chegou a *este* processo?
 *
 * Cada caso abaixo é um desfecho que já apareceu ou pode aparecer no
 * deployment, e cujo diagnóstico, sem isto, dependia de ler log de plataforma.
 *
 * Desde que a classificação saiu daqui para `diagnosticar`, estes casos passam
 * a exercitar o **transporte**: que o estado observado vira a resposta certa e
 * que nada sigiloso atravessa. Os cinco estados em si são exercitados na função
 * pura, em `lib/db/src/__tests__/diagnostico.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { EstadoObservado } from "@workspace/db/diagnostico";
import { describeDatabase } from "../health";

/** Um estado observado qualquer, com o que o caso precisa mudar por cima. */
const observando = (
  estado: Partial<EstadoObservado>,
): (() => Promise<EstadoObservado>) => {
  return async () => ({
    configurada: true,
    alcancavel: true,
    pendentes: [],
    aplicadas: 18,
    ...estado,
  });
};

describe("describeDatabase", () => {
  it("sem a variável, diz que o problema é a variável não ter chegado", async () => {
    const saude = await describeDatabase(
      observando({ configurada: false, alcancavel: false, aplicadas: 0 }),
    );

    expect(saude.configured).toBe(false);
    expect(saude.reachable).toBe(false);
    expect(saude.diagnostico.estado).toBe("INDISPONIVEL");
    // A distinção que importa: o banco pode estar vivo; o que falta é a
    // variável. Confundir os dois foi o que levou a quase criar outro banco.
    expect(saude.detail).toMatch(/o que falta é a variável chegar/i);
    expect(saude.diagnostico.acao?.codigo).toBe("CONFIGURAR_DATABASE_URL");
  });

  it("com a variável e o banco fora, separa 'chegou' de 'conectou'", async () => {
    const saude = await describeDatabase(
      observando({
        alcancavel: false,
        codigoDeConexao: "ECONNREFUSED",
        aplicadas: 0,
      }),
    );

    expect(saude.configured).toBe(true);
    expect(saude.reachable).toBe(false);
    expect(saude.code).toBe("ECONNREFUSED");
    expect(saude.diagnostico.estado).toBe("INDISPONIVEL");
  });

  it("credencial recusada e banco inexistente têm explicações próprias", async () => {
    const credencial = await describeDatabase(
      observando({ alcancavel: false, codigoDeConexao: "28P01", aplicadas: 0 }),
    );
    const inexistente = await describeDatabase(
      observando({ alcancavel: false, codigoDeConexao: "3D000", aplicadas: 0 }),
    );

    expect(credencial.detail).toMatch(/credenciais/i);
    expect(inexistente.detail).toMatch(/não existe/i);
  });

  it("conectado sem schema aponta as migrations, não a conexão", async () => {
    const saude = await describeDatabase(
      observando({ aplicadas: 0, pendentes: ["0000_freightcheck_foundation"] }),
    );

    expect(saude.reachable).toBe(true);
    expect(saude.migrated).toBe(false);
    expect(saude.detail).toMatch(/migration/i);
    expect(saude.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
  });

  it("conectado e migrado é o único estado em que tudo é verdadeiro", async () => {
    const saude = await describeDatabase(observando({}));

    expect(saude).toMatchObject({
      configured: true,
      reachable: true,
      migrated: true,
      upToDate: true,
    });
    expect(saude.code).toBeUndefined();
    expect(saude.diagnostico.estado).toBe("SAUDAVEL");
    expect(saude.diagnostico.acao).toBeNull();
  });

  /**
   * O estado que faltava, e que custou uma tarde: schema aplicado *quase*
   * inteiro. `migrated` olhava uma tabela da primeira migration e dizia "sim"
   * num banco a que faltavam as duas últimas — então a tela do Book do
   * Operador recebia 500 e o diagnóstico apontava para a tela.
   */
  it("com migrations faltando, nomeia quais e não se declara em dia", async () => {
    const saude = await describeDatabase(
      observando({
        aplicadas: 8,
        pendentes: ["0008_book_entries", "0009_entity_type_correction"],
      }),
    );

    expect(saude.migrated).toBe(true);
    expect(saude.upToDate).toBe(false);
    expect(saude.detail).toMatch(/0008_book_entries/);
    expect(saude.detail).toMatch(/0009_entity_type_correction/);
    expect(saude.migrations?.pending).toHaveLength(2);
    expect(saude.migrations?.expected).toBe(10);
  });

  it("diz onde a tentativa parou, com o SQLSTATE que o banco devolveu", async () => {
    const saude = await describeDatabase(
      observando({
        aplicadas: 9,
        pendentes: ["0009_entity_type_correction"],
        falha: { tag: "0009_entity_type_correction", code: "42501" },
      }),
    );

    expect(saude.diagnostico.estado).toBe("MIGRATION_FALHOU");
    expect(saude.diagnostico.evidencia).toMatch(
      /parou em 0009_entity_type_correction/,
    );
    expect(saude.diagnostico.evidencia).toMatch(/42501/);
    // A mensagem do driver nunca atravessa: ela carrega host e usuário, e este
    // endpoint é público. Só o código e o nome da migration.
    expect(JSON.stringify(saude)).not.toMatch(/permission denied/i);
  });

  it("nada pendente é o que faz o banco estar em dia", async () => {
    const saude = await describeDatabase(observando({ pendentes: [] }));

    expect(saude.upToDate).toBe(true);
    expect(saude.detail).toMatch(/todas as migrations deste build aplicadas/i);
    expect(saude.detail).toMatch(/Nenhuma ação é necessária/);
  });

  /**
   * O caso vivido, do lado do `/healthz`.
   *
   * O registro vazio com a fila parada na `0000` por duplicata só tem uma saída,
   * e a resposta não pode oferecer a outra em lugar nenhum do corpo.
   */
  it("registro perdido: manda adotar, e em canto nenhum manda rodar migrate", async () => {
    const saude = await describeDatabase(
      observando({
        aplicadas: 0,
        pendentes: ["0000_freightcheck_foundation", "0012_chamados"],
        falha: { tag: "0000_freightcheck_foundation", code: "42710" },
      }),
    );

    expect(saude.diagnostico.estado).toBe("REGISTRO_PERDIDO");
    expect(saude.diagnostico.acao?.comando).toBe(
      "pnpm --filter @workspace/db run migrate:adotar",
    );

    const corpoInteiro = JSON.stringify(saude);
    expect(corpoInteiro).not.toMatch(/run migrate`/);
    expect(corpoInteiro).not.toMatch(/suba o servidor/i);
  });

  it("nunca deixa a URL, o host ou o usuário vazarem na resposta", async () => {
    const saude = await describeDatabase(
      observando({
        alcancavel: false,
        codigoDeConexao: "ECONNREFUSED",
        aplicadas: 0,
      }),
    );

    const serializado = JSON.stringify(saude);
    for (const segredo of ["senha", "usuario", "db.interno.exemplo", "5432"]) {
      expect(serializado).not.toContain(segredo);
    }
  });
});
