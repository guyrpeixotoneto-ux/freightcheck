import { beforeAll, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { numerosSemLastro, type Dossie } from "../orquestrador";
import { executar, registroPadrao } from "../ferramentas/registro";
import { evidenciasDe } from "../ferramentas/registro";

/**
 * O dicionário de parâmetros dá lastro ao que ele mostra.
 *
 * **O buraco que isto fecha.** `parametros` devolvia `evidencias: []`. O modelo
 * recebia periodicidade, unidade, estado de curadoria e direção econômica — e
 * não podia afirmar nenhum deles, porque a trava confere cada afirmação contra
 * as evidências do turno e ali não havia nenhuma. A resposta certa a "o IPVA é
 * mensal ou anual?" era podada por não ter onde ser conferida, exatamente na
 * pergunta que esta ferramenta existe para responder. É a mesma classe de
 * defeito que `documentos` já teve, e que está contada no comentário dela.
 *
 * **O que estes casos fixam.** Que a consulta autoriza o que mostrou, que ela
 * não autoriza o que *não* mostrou, e que ela não inventou grandeza: semântica
 * é texto, não número, e só as duas contagens da busca entram em `numeros`.
 */

import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

/** Um dossiê com só o que estas chamadas autorizam — o que a trava lê. */
function dossieDe(evidencias: ReturnType<typeof evidenciasDe>): Dossie {
  return {
    evidencias,
    trechos: [],
    documentos: [],
    lacunas: [],
    anexos: [],
  } as unknown as Dossie;
}

rodar("o dicionário de parâmetros dá lastro", () => {
  let db: Database;
  const registro = registroPadrao();

  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("uma busca que acha devolve evidência citável", async () => {
    const chamada = await executar(registro, "parametros", { busca: "IPVA" }, { db, recorte: {} }, 1);

    expect(chamada.ok).toBe(true);
    expect(
      chamada.evidencias.length,
      "uma busca com resultado tem de autorizar alguma coisa — era aqui que vinha zero",
    ).toBeGreaterThan(0);

    const e = chamada.evidencias[0]!;
    expect(e.ferramenta).toBe("parametros");
    expect(e.fatos.length).toBeGreaterThan(0);
    /*
      Interno pela razão de `lidoNoCorpus`: isto sustenta afirmação e não vira
      frase sozinho numa redação determinística que percorre fatos.
    */
    expect(e.fatos.every((f) => f.interno)).toBe(true);
    /* E tem onde ser conferido por quem discordar. */
    expect(e.tela?.href).toBe("/parametros");
  });

  it("o que a consulta mostrou passa na trava; o que ela não mostrou, não", async () => {
    const chamada = await executar(registro, "parametros", { busca: "IPVA" }, { db, recorte: {} }, 1);
    const dossie = dossieDe(evidenciasDe([chamada]));

    const conteudo = chamada.conteudo as {
      encontrados: number;
      parametros: { nomeGerencial: string; periodicidade: string | null; semantica: string }[];
    };
    const primeiro = conteudo.parametros[0]!;

    /*
      A afirmação que o produto existe para poder fazer: a periodicidade e o
      estado de curadoria daquele parâmetro, ditos com lastro.
    */
    if (primeiro.periodicidade) {
      expect(
        numerosSemLastro(
          `${primeiro.nomeGerencial} é ${primeiro.periodicidade} e está ${primeiro.semantica}.`,
          dossie,
        ),
      ).toEqual([]);
    }

    /* A contagem da busca também — ela é grandeza apurada por esta consulta. */
    expect(
      numerosSemLastro(`Encontrei ${conteudo.encontrados} parâmetros.`, dossie),
    ).toEqual([]);

    /*
      E o contraste, que é o que prova que a trava não ficou frouxa: um valor em
      reais não veio de consulta nenhuma, e continua sem lastro.
    */
    expect(
      numerosSemLastro("O impacto foi de R$ 48.912,33.", dossie),
      "o dicionário não apura dinheiro — autorizar quantia aqui seria afrouxar a trava",
    ).not.toEqual([]);
  });

  it("uma busca sem resultado não autoriza nada", async () => {
    const chamada = await executar(
      registro,
      "parametros",
      /*
        Um termo que não casa com nada. "zzz-parametro-que-nao-existe" não
        serve: a extração de termos devolve ["zzz", "parametro"], e "parametro"
        casa com quase toda linha do dicionário — o caso passaria a medir o
        ranqueamento em vez do lastro.
      */
      { busca: "xyzabc" },
      { db, recorte: {} },
      1,
    );

    expect(chamada.ok).toBe(true);
    expect(
      chamada.evidencias,
      "uma consulta vazia que autorizasse algo seria pior do que uma que falha",
    ).toEqual([]);
  });

  it("a evidência não inventa grandeza: só as duas contagens da busca", async () => {
    const chamada = await executar(registro, "parametros", { busca: "FINAME" }, { db, recorte: {} }, 1);
    const e = chamada.evidencias[0]!;
    const conteudo = chamada.conteudo as { encontrados: number; mostrando: number };

    expect(e.numeros).toEqual([conteudo.encontrados, conteudo.mostrando]);
  });
});
