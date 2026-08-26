import { describe, expect, it } from "vitest";
import { CATALOGO_DECLARADO } from "../catalogo-declarado";
import {
  aplicarDirecaoEconomicaTrecho,
  DIRECAO_ECONOMICA_TRECHO,
  type DirecaoEconomicaTrechoEntrada,
} from "../direcao-economica-trecho";

/**
 * A rodada de curadoria de TRECHO conferida contra o dicionário declarado.
 *
 * O risco real desta lista não é a regra — é o **código digitado errado**.
 * `aplicarDirecaoEconomicaTrecho` coleta as falhas *de atributo* em vez de
 * parar na primeira (para não deixar a curadoria pela metade em silêncio), e o
 * preço disso é que um `trecho.frete_liquidoo` sumiria dentro do resumo sem que
 * ninguém olhasse. Aqui cada código é conferido contra `CATALOGO_DECLARADO`,
 * que é a mesma fonte de onde a importação deriva os atributos.
 *
 * Falha *do banco* é o caso oposto e está no fim deste arquivo: ela vale para
 * as 110 linhas, então insistir só produz 110 cópias do mesmo erro.
 *
 * Sem banco de propósito: o export real da Ambev commitado como fixture só
 * traz CAVALO e CARRETA, então um teste de integração aqui provaria apenas
 * que o fixture não tem trecho — não que a lista está certa.
 */

const DECLARADOS_DE_TRECHO = CATALOGO_DECLARADO.filter((a) => a.entityType === "TRECHO");
const CODIGOS_DECLARADOS = new Set(DECLARADOS_DE_TRECHO.map((a) => a.code));

it("o dicionário declara atributos de TRECHO — a régua deste arquivo existe", () => {
  expect(DECLARADOS_DE_TRECHO.length).toBeGreaterThan(0);
});

it("a lista não repete nenhum atributo", () => {
  const codes = DIRECAO_ECONOMICA_TRECHO.map((e) => e.code);
  expect(new Set(codes).size).toBe(codes.length);
});

it("todo atributo listado começa com 'trecho.'", () => {
  for (const entrada of DIRECAO_ECONOMICA_TRECHO) {
    expect(entrada.code.startsWith("trecho.")).toBe(true);
  }
});

/*
  O teste que pega o erro de digitação. Um código que não existe no dicionário
  nunca vai ser encontrado no banco, e a curadoria dele seria uma linha de
  falha no resumo do script — silenciosa para quem não lê a saída inteira.
*/
it("todo código curado existe no dicionário declarado", () => {
  const desconhecidos = DIRECAO_ECONOMICA_TRECHO.filter((e) => !CODIGOS_DECLARADOS.has(e.code));
  expect(desconhecidos.map((e) => e.code)).toEqual([]);
});

it("os quatro valores do vocabulário são os únicos usados", () => {
  const usados = new Set(DIRECAO_ECONOMICA_TRECHO.map((e) => e.direcao));
  for (const direcao of usados) {
    expect(["HIGHER_IS_BETTER", "HIGHER_IS_WORSE", "NEUTRAL", "DEPENDS_ON_FORMULA"]).toContain(
      direcao,
    );
  }
});

it("toda entrada tem o efeito escrito — a direção sem o porquê não é curadoria", () => {
  for (const entrada of DIRECAO_ECONOMICA_TRECHO) {
    expect(entrada.efeito.trim().length).toBeGreaterThan(0);
  }
});

describe("as decisões que sustentam o veredito do Radar", () => {
  const porCode = new Map<string, DirecaoEconomicaTrechoEntrada>(
    DIRECAO_ECONOMICA_TRECHO.map((e) => [e.code, e]),
  );

  it("frete líquido é maior-é-melhor — é a receita do trecho", () => {
    expect(porCode.get("trecho.frete_liquido")?.direcao).toBe("HIGHER_IS_BETTER");
  });

  it("pedágio é maior-é-pior — é custo pago pela transportadora", () => {
    expect(porCode.get("trecho.frete_reais_km_pedagio")?.direcao).toBe("HIGHER_IS_WORSE");
    expect(porCode.get("trecho.pedagio")?.direcao).toBe("HIGHER_IS_WORSE");
  });

  it("a chave do trecho é neutra — cadastro não move veredito", () => {
    expect(porCode.get("trecho.chave_trecho")?.direcao).toBe("NEUTRAL");
  });

  /*
    O caso que prova que a seção da DRE não basta: `diesel_consumo_km_l` está
    declarado em "(−) Custo variável / Combustível", e mesmo assim subir é
    **bom** — mais km por litro é menos custo. Classificá-lo por atalho a
    partir da seção inverteria o sinal dele no Radar.
  */
  it("km/l não é classificado por atalho da seção de custo", () => {
    expect(porCode.get("trecho.diesel_consumo_km_l")?.direcao).toBe("DEPENDS_ON_FORMULA");
  });

  it("a cobertura é parcial e sabida — nem todo atributo declarado foi curado", () => {
    expect(DIRECAO_ECONOMICA_TRECHO.length).toBeLessThanOrEqual(DECLARADOS_DE_TRECHO.length);
  });
});

/**
 * A rodada diante de um banco que recusa — travado contra 26/08/2026.
 *
 * Naquele dia a função tentou os 110 atributos contra um banco que já havia
 * recusado a **primeira** consulta inteira, e devolveu 110 cópias do envelope
 * do drizzle sem a causa. Duas garantias, e as duas são condição para a saída
 * voltar a ser legível: parar na primeira falha estrutural, e não parar por
 * uma falha que é só daquele atributo.
 */
describe("uma falha do banco não vira 110 falhas", () => {
  /** Um `db` que recusa toda consulta como o Postgres recusaria. */
  function bancoQueRecusa(causa: Error) {
    let tentativas = 0;
    const envelope = new Error('Failed query: select "id", "code" from "attribute" …');
    envelope.cause = causa;
    return {
      contar: () => tentativas,
      db: {
        select: () => {
          tentativas++;
          throw envelope;
        },
      } as never,
    };
  }

  /** Um `db` que responde, mas sem nenhum atributo — o caso "não encontrado". */
  function bancoVazio() {
    let tentativas = 0;
    return {
      contar: () => tentativas,
      db: {
        select: () => {
          tentativas++;
          return { from: () => ({ where: () => Promise.resolve([]) }) };
        },
      } as never,
    };
  }

  it("coluna ausente para a rodada na primeira tentativa", async () => {
    const banco = bancoQueRecusa(
      Object.assign(new Error('column "change_rule" does not exist'), { code: "42703" }),
    );

    const resumo = await aplicarDirecaoEconomicaTrecho(banco.db, "guyrpeixoto.neto@gmail.com");

    expect(banco.contar()).toBe(1);
    expect(resumo.interrompidaPor?.falha.sqlstate).toBe("42703");
    expect(resumo.interrompidaPor?.falha.classe).toBe("SCHEMA_ATRASADO");
    expect(resumo.naoTentadas).toBe(DIRECAO_ECONOMICA_TRECHO.length - 1);
    expect(resumo.falhas).toEqual([]);
    expect(resumo.gravadas).toBe(0);
  });

  it("conexão recusada também para na primeira, e não vira schema atrasado", async () => {
    const banco = bancoQueRecusa(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:59999"), {
        code: "ECONNREFUSED",
      }),
    );

    const resumo = await aplicarDirecaoEconomicaTrecho(banco.db, "guyrpeixoto.neto@gmail.com");

    expect(banco.contar()).toBe(1);
    expect(resumo.interrompidaPor?.falha.classe).toBe("CONEXAO");
    expect(resumo.interrompidaPor?.falha.codigoDeRede).toBe("ECONNREFUSED");
  });

  /*
    O outro lado, e é o que impede a correção de virar o defeito oposto: um
    atributo que não existe no banco fala de uma linha só. Parar nele deixaria
    a curadoria pela metade por causa de um código obsoleto no dicionário.
  */
  it("atributo inexistente não interrompe — as 110 são tentadas", async () => {
    const banco = bancoVazio();

    const resumo = await aplicarDirecaoEconomicaTrecho(banco.db, "guyrpeixoto.neto@gmail.com");

    expect(banco.contar()).toBe(DIRECAO_ECONOMICA_TRECHO.length);
    expect(resumo.interrompidaPor).toBeUndefined();
    expect(resumo.naoTentadas).toBe(0);
    expect(resumo.falhas).toHaveLength(DIRECAO_ECONOMICA_TRECHO.length);
    expect(resumo.falhas[0]!.erro).toContain("não encontrado");
  });

  /*
    A falha guardada é a do Postgres, não a do envelope. Este é o teste que
    quebra se alguém voltar a gravar `err.message`.
  */
  it("guarda a mensagem do Postgres, nunca o SQL do envelope", async () => {
    const banco = bancoQueRecusa(
      Object.assign(new Error('column "change_rule" does not exist'), { code: "42703" }),
    );

    const resumo = await aplicarDirecaoEconomicaTrecho(banco.db, "guyrpeixoto.neto@gmail.com");

    expect(resumo.interrompidaPor?.falha.mensagem).toBe('column "change_rule" does not exist');
    expect(resumo.interrompidaPor?.falha.mensagem).not.toContain("Failed query");
  });
});

/**
 * O ator chega até o `curation_event`, e `--` não é ator.
 *
 * `definirDirecaoEconomica` já recusa responsável vazio; o que faltava era
 * recusar um responsável que *parece* preenchido. A recusa acontece antes de
 * qualquer escrita — por isso é conferida aqui e não só no CLI.
 */
describe("a rodada exige um responsável de verdade", () => {
  it("recusa antes de tocar no banco quando o ator é vazio", async () => {
    let tentativas = 0;
    const db = {
      select: () => {
        tentativas++;
        return { from: () => ({ where: () => Promise.resolve([]) }) };
      },
    } as never;

    const resumo = await aplicarDirecaoEconomicaTrecho(db, "   ");

    expect(tentativas).toBe(0);
    expect(resumo.gravadas).toBe(0);
    expect(resumo.falhas.length).toBeGreaterThan(0);
  });
});
