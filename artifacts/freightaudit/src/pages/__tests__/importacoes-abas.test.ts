import { describe, expect, it } from "vitest";
import {
  acervoDaImportacao,
  tiposHerdados,
  tiposVindosDoArquivo,
  type TiposDaImportacao,
} from "../importacoes";
import {
  DATASET_FAMILY_FINANCIAMENTO_REAL,
  DATASET_FAMILY_QUADRO_DE_PESSOAL,
  DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
} from "@workspace/ingest/tipos";

/**
 * O contrato do recorte das abas: **a aba é do arquivo, não da vigência.**
 *
 * A herança é comportamento correto do pipeline — o arquivo de carreta que
 * regrava uma vigência preserva os cavalos que já estavam nela — e foi
 * exatamente por estar correta que ela enganava: lida como "tipos da
 * importação", punha o upload de carretas na aba Cavalo e etiquetava o cartão
 * com os dois equipamentos. Este arquivo fixa a separação: o recorte e a
 * etiqueta "Arquivo" leem só o que o upload trouxe (`tiposVindosDoArquivo`), e
 * a herança aparece nomeada como herança (`tiposHerdados`), dentro do cartão.
 *
 * Os casos são os do dado real: o export da Ambev chega em dois arquivos que
 * partilham as mesmas vigências, e os QLPs partilham as deles do mesmo jeito.
 */

const importacao = (patch: Partial<TiposDaImportacao>): TiposDaImportacao => ({
  declaredType: null,
  entityTypes: [],
  tiposDoArquivo: [],
  ...patch,
});

/** O recorte como a tela o faz: a aba mostra quem a inclui no arquivo. */
const abasDe = (run: TiposDaImportacao): string[] =>
  ["CAVALO", "CARRETA", "TRECHO", "QLP_ADMINISTRATIVO", "QLP_OPERACIONAL"].filter(
    (aba) => tiposVindosDoArquivo(run).includes(aba),
  );

describe("a aba é do arquivo, não da vigência resultante", () => {
  it("Cavalo+Carreta seguido de só Carreta: o segundo upload fica só em Carreta", () => {
    // O primeiro arquivo trouxe os dois; o segundo só carretas, e a vigência
    // resultante dele cobre os dois porque os cavalos vieram por herança.
    const primeiro = importacao({
      tiposDoArquivo: ["CARRETA", "CAVALO"],
      entityTypes: ["CARRETA", "CAVALO"],
    });
    const segundo = importacao({
      tiposDoArquivo: ["CARRETA"],
      entityTypes: ["CARRETA", "CAVALO"],
    });

    expect(abasDe(primeiro)).toEqual(["CAVALO", "CARRETA"]);
    expect(abasDe(segundo)).toEqual(["CARRETA"]);
    expect(tiposHerdados(segundo)).toEqual(["CAVALO"]);
  });

  it("o espelho: só Cavalo herdando carretas fica só em Cavalo", () => {
    const soCavalo = importacao({
      tiposDoArquivo: ["CAVALO"],
      entityTypes: ["CARRETA", "CAVALO"],
    });
    expect(abasDe(soCavalo)).toEqual(["CAVALO"]);
    expect(tiposHerdados(soCavalo)).toEqual(["CARRETA"]);
  });

  it("a declaração do envio manda sobre a leitura do conteúdo", () => {
    // Declarado é a evidência mais forte: a pessoa escolheu a aba e o servidor
    // conferiu. A herança continua sem contaminar o recorte.
    const declarado = importacao({
      declaredType: "CARRETA",
      tiposDoArquivo: ["CARRETA"],
      entityTypes: ["CARRETA", "CAVALO"],
    });
    expect(abasDe(declarado)).toEqual(["CARRETA"]);
    expect(tiposHerdados(declarado)).toEqual(["CAVALO"]);
  });

  it("os QLPs seguem a mesma regra que os equipamentos", () => {
    const administrativo = importacao({
      declaredType: "QLP_ADMINISTRATIVO",
      tiposDoArquivo: ["QLP_ADMINISTRATIVO"],
      entityTypes: ["QLP_ADMINISTRATIVO", "QLP_OPERACIONAL"],
    });
    expect(abasDe(administrativo)).toEqual(["QLP_ADMINISTRATIVO"]);
    expect(tiposHerdados(administrativo)).toEqual(["QLP_OPERACIONAL"]);
  });
});

describe("quando não dá para saber o que o arquivo trouxe", () => {
  it("sem declaração e sem fatos próprios, nenhuma aba de tipo a reivindica", () => {
    // A importação antiga fora do backfill, ou a que falhou antes de promover:
    // classificá-la por palpite seria dizer que ela trouxe o que ninguém
    // mediu. Ela permanece visível na aba Todas — o recorte nulo da tela.
    const semLeitura = importacao({ entityTypes: ["CAVALO"] });
    expect(abasDe(semLeitura)).toEqual([]);
    // E a herança não é apontada, porque não há arquivo de referência para
    // dizer o que é herdado — nome errado é pior que nome nenhum.
    expect(tiposHerdados(semLeitura)).toEqual([]);
  });

  it("a importação que não produziu nada não aparece em aba nenhuma", () => {
    expect(abasDe(importacao({}))).toEqual([]);
    expect(tiposHerdados(importacao({}))).toEqual([]);
  });
});

describe("o cartão continua contando a herança, mesmo fora do recorte", () => {
  it("sem herança, a segunda linha não tem o que dizer", () => {
    const simples = importacao({
      tiposDoArquivo: ["CAVALO"],
      entityTypes: ["CAVALO"],
    });
    expect(tiposHerdados(simples)).toEqual([]);
  });
});

/**
 * O outro recorte da tela — o de cima: **o acervo é da família declarada.**
 *
 * O tipo não responde a esta pergunta, e é por não responder que a família
 * passou a ser declarada: CAVALO existe no remunerado e no real, e as duas
 * vigências do mesmo veículo, na mesma data, precisam coexistir sem colidir.
 */
describe("o acervo é da família declarada, não do tipo", () => {
  it("a mesma placa de cavalo cai em acervos diferentes conforme a família", () => {
    const remunerado = { declaredFamily: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO };
    const real = { declaredFamily: DATASET_FAMILY_FINANCIAMENTO_REAL };
    expect(acervoDaImportacao(remunerado)).toBe("REMUNERADO");
    expect(acervoDaImportacao(real)).toBe("REAL");
  });

  it("o quadro de pessoal é remunerado, e não um acervo à parte", () => {
    // QLP tem família própria — ela separa a identidade da vigência —, mas não
    // é outra fileira: o que a Ambev paga por gente é remuneração igual.
    expect(
      acervoDaImportacao({ declaredFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL }),
    ).toBe("REMUNERADO");
  });

  it("sem declaração, é remunerado — porque era o único acervo que existia", () => {
    // Quase toda a base está assim, e não é palpite: quando essas importações
    // entraram não havia o que declarar.
    expect(acervoDaImportacao({ declaredFamily: null })).toBe("REMUNERADO");
  });
});
