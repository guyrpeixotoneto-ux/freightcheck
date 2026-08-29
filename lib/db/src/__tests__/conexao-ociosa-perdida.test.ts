import { describe, expect, it, vi } from "vitest";
import { createDb } from "../index";

/**
 * Uma conexão ociosa perdida é um evento, e não a morte do processo.
 *
 * O `pg.Pool` é um `EventEmitter`, e `error` sem ouvinte nenhum não é evento
 * ignorado: é exceção não tratada, e o Node encerra. Quem mata conexão ociosa
 * por fora não é raro — reinício do banco, `pg_terminate_backend`, corte de
 * rede — e a própria suíte deste repositório faz isso ao derrubar os bancos
 * descartáveis. Era o que fazia o `vitest` do `api-server` falhar no
 * desligamento **depois** de os 917 testes passarem, com um `57P01` vindo do
 * parser do `pg` e nenhuma pista de origem.
 *
 * Nada aqui abre conexão: `new Pool` não conecta, e o que se prova é o
 * contrato do emissor — existe alguém ouvindo, e o que ele ouve vira log em vez
 * de exceção.
 */
describe("conexão ociosa perdida", () => {
  it("todo pool nasce com quem ouça o erro do cliente ocioso", () => {
    const { pool } = createDb("postgresql://ninguem@localhost:1/nada");
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    void pool.end().catch(() => {});
  });

  it("o erro vira uma linha de log, e não uma exceção", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = createDb("postgresql://ninguem@localhost:1/nada");

    const erro = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
    });
    expect(() => pool.emit("error", erro, {} as never)).not.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    const escrito = String(log.mock.calls[0]?.[0]);
    expect(escrito).toContain("57P01");
    expect(escrito).toContain("terminating connection due to administrator command");

    log.mockRestore();
    void pool.end().catch(() => {});
  });

  it("a mensagem não carrega o endereço do banco, que tem senha", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = createDb("postgresql://usuario:senha-secreta@localhost:1/nada");

    pool.emit("error", new Error("connection terminated unexpectedly"), {} as never);

    const escrito = String(log.mock.calls[0]?.[0]);
    expect(escrito).not.toContain("senha-secreta");
    expect(escrito).not.toContain("localhost");

    log.mockRestore();
    void pool.end().catch(() => {});
  });
});
