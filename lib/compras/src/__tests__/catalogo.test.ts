import { describe, expect, it } from "vitest";
import { mappedAttributeCodes, placementOf } from "@workspace/comparison";
import {
  BALCAO_SEM_DADO,
  CATALOGO,
  produtoDaRubrica,
  produtoDe,
  produtosDoBalcao,
  ROTULO_DA_RESSALVA,
  ROTULO_DO_BALCAO,
  type Balcao,
} from "../catalogo";
import { papelDaColuna, ROTULO_DO_PAPEL } from "../qlp";

/**
 * O catálogo, contra o mapa de famílias que ele referencia.
 *
 * Este arquivo existe por causa de uma classe de defeito que não faz barulho:
 * uma rubrica escrita com um acento a menos não quebra nada — produz um produto
 * que nunca encontra coluna, e a tela mostra "Pneus" vazio para sempre, o que é
 * indistinguível de "a fonte não trouxe pneu nesta vigência". A prova de baixo
 * cruza cada rubrica declarada contra as que `placementOf` de fato produz.
 */

/** Todas as rubricas que o mapa de famílias produz, de todos os códigos que ele conhece. */
const RUBRICAS_REAIS = new Set(
  mappedAttributeCodes().map((code) => placementOf(code).parameter),
);

describe("o catálogo aponta para rubricas que existem", () => {
  it("toda rubrica declarada é uma rubrica do mapa de famílias", () => {
    const inexistentes = CATALOGO.flatMap((produto) =>
      produto.parametros
        .filter((rubrica) => !RUBRICAS_REAIS.has(rubrica))
        .map((rubrica) => `${produto.chave} → "${rubrica}"`),
    );
    expect(inexistentes).toEqual([]);
  });

  it("nenhuma rubrica pertence a dois produtos", () => {
    const vistas = new Map<string, string>();
    const repetidas: string[] = [];
    for (const produto of CATALOGO) {
      for (const rubrica of produto.parametros) {
        const dona = vistas.get(rubrica);
        if (dona) repetidas.push(`"${rubrica}": ${dona} e ${produto.chave}`);
        else vistas.set(rubrica, produto.chave);
      }
    }
    expect(repetidas).toEqual([]);
  });

  it("as chaves são únicas — é por elas que a URL e a API se entendem", () => {
    const chaves = CATALOGO.map((p) => p.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("produtoDe encontra pela chave, e devolve undefined para o que não existe", () => {
    expect(produtoDe("pneu")?.rotulo).toBe("Pneus");
    expect(produtoDe("uniformes")?.balcao).toBe("QLP_ADMINISTRATIVO");
    expect(produtoDe("nao-existe")).toBeUndefined();
  });

  it("produtoDaRubrica resolve o caminho inverso, e null é resposta", () => {
    expect(produtoDaRubrica("Pneu")?.chave).toBe("pneu");
    expect(produtoDaRubrica("Uniformes")?.chave).toBe("uniformes");
    /*
      "Região" é rubrica real do modelo e não corresponde a nada que se compre.
      A leitura da frota conta rubricas assim em `foraDoCatalogo` em vez de as
      perder — o que se prova aqui é que o catálogo não as reclama para si.
    */
    expect(produtoDaRubrica("Região")).toBeNull();
  });
});

describe("o que cada entrada promete", () => {
  it("toda ressalva tem motivo, texto e evidência", () => {
    for (const produto of CATALOGO) {
      if (!produto.ressalva) continue;
      expect(ROTULO_DA_RESSALVA[produto.ressalva.motivo]).toBeTruthy();
      expect(produto.ressalva.texto.length).toBeGreaterThan(40);
      /*
        A evidência é o que separa uma advertência de um palpite com cara de
        regra. Exigir que ela cite um arquivo do repositório é o mínimo
        verificável: quem revisar o catálogo daqui a um ano tem onde conferir.
      */
      expect(produto.ressalva.evidencia).toMatch(/docs\/|lib\//);
    }
  });

  it("todo produto diz o que se compra, e todo balcão tem rótulo", () => {
    for (const produto of CATALOGO) {
      expect(produto.compra.length).toBeGreaterThan(10);
      expect(ROTULO_DO_BALCAO[produto.balcao]).toBeTruthy();
    }
  });

  it("os dois balcões que abrem têm produtos, e o operacional não", () => {
    expect(produtosDoBalcao("FROTA").length).toBeGreaterThan(0);
    expect(produtosDoBalcao("QLP_ADMINISTRATIVO").length).toBeGreaterThan(0);
    expect(produtosDoBalcao("QLP_OPERACIONAL")).toEqual([]);
  });

  it("o balcão sem dado diz o que falta e para onde ir hoje", () => {
    expect(BALCAO_SEM_DADO.balcao).toBe<Balcao>("QLP_OPERACIONAL");
    expect(BALCAO_SEM_DADO.falta.length).toBeGreaterThan(40);
    expect(BALCAO_SEM_DADO.hoje.length).toBeGreaterThan(20);
  });

  /**
   * A ressalva do pneu é a razão de ser deste módulo, e por isso tem prova
   * própria: as duas colunas de pneu vêm zeradas na série inteira, e uma tela
   * que escrevesse "R$ 0,00" ao lado de *Pneus* faria quem confere um pedido
   * concluir que a Ambev não remunera pneu.
   */
  it("o pneu avisa que a coluna é zerada antes de mostrar qualquer número", () => {
    const pneu = produtoDe("pneu")!;
    expect(pneu.ressalva?.motivo).toBe("COLUNA_ZERADA_NA_SERIE");
    expect(pneu.ressalva?.evidencia).toContain("558");
    expect(pneu.ressalva?.evidencia).toContain("657");
  });
});

describe("os papéis do QLP", () => {
  /**
   * Todo produto do balcão administrativo tem de ter pelo menos uma coluna com
   * papel declarado — senão ele nunca renderiza uma linha, e a tela mostra um
   * cartão permanentemente vazio sem que nada reprove.
   *
   * A lista de códigos vem do mapa de famílias, que é a mesma fonte que a
   * leitura usa em produção.
   */
  it("todo produto administrativo tem coluna com papel declarado", () => {
    const semPapel = produtosDoBalcao("QLP_ADMINISTRATIVO").filter((produto) => {
      const rubricas = new Set(produto.parametros);
      return !mappedAttributeCodes().some(
        (code) => rubricas.has(placementOf(code).parameter) && papelDaColuna(code) !== null,
      );
    });
    expect(semPapel.map((p) => p.chave)).toEqual([]);
  });

  it("toda coluna com papel declarado pertence a um produto do catálogo", () => {
    const orfas = mappedAttributeCodes()
      .filter((code) => papelDaColuna(code) !== null)
      .filter((code) => produtoDaRubrica(placementOf(code).parameter) === null);
    expect(orfas).toEqual([]);
  });

  it("os três papéis têm rótulo", () => {
    expect(ROTULO_DO_PAPEL.UNITARIO).toBe("Valor unitário");
    expect(ROTULO_DO_PAPEL.QUANTIDADE).toBe("Quantidade remunerada");
    expect(ROTULO_DO_PAPEL.DESPESA).toBe("Despesa");
  });
});
