import { describe, expect, it } from "vitest";

import { escopoDaCobertura, paramsDaCobertura } from "../cobertura";
import type { Contexto } from "../contextos";

/**
 * De quem é a Cobertura de dados — a contradição que este arquivo prende.
 *
 * O sintoma, medido na tela: a caixa "Unidade atual" da lateral escrevia
 * PERNAMBUCO e a matriz ao lado listava CAMAÇARI, CDD CEBRASA, EQUATORIAL,
 * MANAUS e PERNAMBUCO, com 89,7% de cobertura e 3.201 lacunas do acervo
 * inteiro. `/coverage` ia sem `escopo`, e a tela não tinha como saber disso.
 *
 * O que roda aqui é o contrato do recorte, e nada de pixel:
 *
 * 1. sem `scopeHash` no endereço, a tela mede a unidade que a lateral nomeia —
 *    é o caminho de quem chega pelo menu, e era o caminho da contradição;
 * 2. `visaoGeral=1` mede todas, e só ele;
 * 3. o canal viaja quando existe e some quando não existe, como em `enderecoDe`;
 * 4. enquanto `/contexts` não responde, a medição espera em vez de mostrar o
 *    acervo e se corrigir depois.
 */

const contexto = (
  nome: string,
  hash: string,
  canal: string | null,
): Contexto => ({
  scopeHash: hash,
  channel: canal,
  label: `${nome} · ${canal ?? ""}`,
  scopes: [{ scopeType: "UNIDADE", code: nome.slice(0, 3), name: nome }],
  latestPeriod: "2026-08-01",
  periods: 6,
  periodosDisponiveis: ["2026-08-01"],
});

const PERNAMBUCO = contexto("PERNAMBUCO", "hash-pe", "EMPURRADA");
const CAMACARI = contexto("CAMAÇARI", "hash-cam", "EMPURRADA");
const CONTEXTOS = [PERNAMBUCO, CAMACARI];

const FILTROS = { vigencias: 6, criticidade: "TODAS", equipamento: "TODOS" };

const escopo = (search: string, contextos = CONTEXTOS, carregando = false) =>
  escopoDaCobertura({ contextos, carregando, pathname: "/dados", search });

const consulta = (search: string, filtros = FILTROS) =>
  Object.fromEntries(paramsDaCobertura(escopo(search), filtros));

describe("de quem é a medição", () => {
  /* O requisito 1 — o defeito inteiro, no caminho em que ele aparecia. */
  it("mede a unidade da lateral quando o endereço não pede nenhuma", () => {
    expect(escopo("").contexto).toBe(PERNAMBUCO);
    expect(consulta("")).toEqual({
      vigencias: "6",
      escopo: "hash-pe",
      canal: "EMPURRADA",
    });
  });

  it("mede a unidade que o endereço pede", () => {
    expect(consulta("?scopeHash=hash-cam").escopo).toBe("hash-cam");
  });

  /*
    Um `scopeHash` que não existe mais — link velho, unidade sem vigência na
    janela — cai na unidade que a lateral nomeia, e não no acervo inteiro: as
    duas caixas continuam dizendo a mesma coisa.
  */
  it("cai na unidade da lateral quando o endereço pede uma que não existe", () => {
    expect(consulta("?scopeHash=hash-que-nao-existe").escopo).toBe("hash-pe");
  });

  /* O requisito 2: a soma é pedida por escrito, e é a única sem `escopo`. */
  it("não manda escopo nenhum na visão geral", () => {
    const query = consulta("?visaoGeral=1");
    expect(query.escopo).toBeUndefined();
    expect(query.canal).toBeUndefined();
    expect(escopo("?visaoGeral=1").visaoGeral).toBe(true);
  });

  /* O requisito 3, pela ponta que dói: canal vazio é filtro que o servidor
     descarta em silêncio — a chave some em vez de ir vazia. */
  it("omite o canal quando o contexto não tem um", () => {
    const semCanal = [contexto("MANAUS", "hash-man", null)];
    const query = Object.fromEntries(
      paramsDaCobertura(
        escopoDaCobertura({
          contextos: semCanal,
          carregando: false,
          pathname: "/dados",
          search: "",
        }),
        FILTROS,
      ),
    );
    expect(query.escopo).toBe("hash-man");
    expect("canal" in query).toBe(false);
  });

  /* O requisito 4. Sem isto a tela mostraria o acervo por um instante. */
  it("espera enquanto não sabe de quem é a tela", () => {
    expect(escopo("", [], true).indefinido).toBe(true);
    /* Com a unidade escrita no endereço não há o que esperar. */
    expect(escopo("?scopeHash=hash-cam", [], true).indefinido).toBe(false);
    /* Lista vazia ou `/contexts` fora do ar: mede sem recorte e sem nomear. */
    expect(escopo("", [], false).indefinido).toBe(false);
    expect(escopo("", [], false).contexto).toBeUndefined();
  });
});

describe("os filtros da tela", () => {
  it("continuam viajando ao lado do recorte", () => {
    expect(
      consulta("?scopeHash=hash-cam", {
        vigencias: 12,
        criticidade: "CRITICO",
        equipamento: "CARRETA",
      }),
    ).toEqual({
      vigencias: "12",
      criticidade: "CRITICO",
      equipamento: "CARRETA",
      escopo: "hash-cam",
      canal: "EMPURRADA",
    });
  });
});
