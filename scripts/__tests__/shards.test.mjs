import { describe, expect, it } from "vitest";
import {
  conferirCobertura,
  filtrosDoShard,
  SHARDS,
  SHARDS_COM_SEED,
} from "../ci/shards.mjs";

/**
 * A divisão em shards é obrigação de cobertura, não de arrumação.
 *
 * O CI roda a bateria em jobs paralelos, um por shard. Um pacote com testes que
 * não esteja em nenhum shard simplesmente **não roda** — e o efeito não é uma
 * lacuna visível, é o conjunto de checks ficando verde sem ele. É a mesma
 * classe de defeito que fez este repositório passar meses com 420 testes
 * pulados e ninguém saber.
 *
 * Por isso a conferência mora aqui, e não num passo de lint que se pode
 * esquecer de chamar: ela roda com a suíte, no shard `unit`, e reprova quem
 * criar um pacote com testes sem dizer onde ele roda.
 */
describe("a divisão em shards cobre a bateria inteira", () => {
  it("todo pacote com script `test` está em algum shard", () => {
    const { semShard, noDisco } = conferirCobertura();
    expect(
      semShard,
      `estes pacotes têm testes e nenhum job do CI os roda — o verde ficaria ` +
        `mentindo. Declare-os em scripts/ci/shards.mjs. ` +
        `(${noDisco.length} pacotes com teste no disco)`,
    ).toEqual([]);
  });

  it("nenhum pacote está em dois shards", () => {
    const { duplicados } = conferirCobertura();
    expect(
      duplicados,
      "rodariam duas vezes, dobrando o custo sem cobrir nada a mais",
    ).toEqual([]);
  });

  it("nenhum shard aponta para pacote que não existe mais", () => {
    const { inexistentes } = conferirCobertura();
    expect(
      inexistentes,
      "um shard que aponta para o vazio falha o job inteiro na hora do filtro",
    ).toEqual([]);
  });

  it("o shard que precisa do banco semeado está declarado como tal", () => {
    /*
      As suítes do assistente leem `ASSISTANT_EVAL_DATABASE_URL` e se marcam
      como puladas sem ela. Se o job delas deixar de semear, elas não falham:
      ficam verdes sem ter rodado. A declaração aqui é o que o workflow lê para
      decidir quem paga o seed, e este teste é o que impede alguém de tirar o
      assistente da lista por engano.
    */
    expect([...SHARDS_COM_SEED]).toContain("assistente");
    expect(SHARDS.assistente).toContain("@workspace/assistant");
  });

  it("os filtros do pnpm saem no formato que o workflow usa", () => {
    expect(filtrosDoShard("ingest")).toBe(
      "--filter @workspace/ingest --filter @workspace/db",
    );
    expect(() => filtrosDoShard("nao-existe")).toThrow(/não existe/);
  });
});
