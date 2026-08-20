import { describe, expect, it } from "vitest";
import {
  abaValida,
  lerFiltros,
  lerRecorte,
  linkDaPosicao,
  linkDaVisaoGeral,
  linkDeAlteracoes,
  nomeDaUnidade,
  paramsDeAlteracoes,
  paramsDoRecorte,
  temRecorte,
  RECORTE_VAZIO,
  type Recorte,
} from "../recorte";

/**
 * O contrato entre a Visão geral e as Alterações.
 *
 * O defeito que estes testes existem para impedir não é um link quebrado — um
 * 404 se vê. É o **link que funciona e responde por outra coisa**: quem estava
 * lendo julho de CAMAÇARI clica em "244 alterações sem preço", cai numa lista de
 * agosto com 1.100 linhas, e as duas telas do mesmo produto passam a dizer
 * números diferentes sobre "a mesma" vigência sem que nada na tela explique a
 * diferença. Isso não aparece em revisão de tela nenhuma: aparece numa reunião,
 * meses depois, como perda de confiança nas duas.
 *
 * Daí as três regras que cada caso abaixo cobre:
 *
 * 1. **O recorte atravessa** — unidade, canal e vigência vão junto com o clique.
 * 2. **Cada aba só recebe o que honra** — a vigência não vale na aba Impacto, e
 *    nada vale na de Chamados; o que a aba não aplica não fica escrito no
 *    endereço parecendo aplicado.
 * 3. **Ler e escrever são a mesma gramática** — o que a Visão geral escreve é
 *    exatamente o que as Alterações leem de volta.
 */

const recorte = (patch: Partial<Recorte> = {}): Recorte => ({
  ...RECORTE_VAZIO,
  ...patch,
});

const query = (link: string) => new URLSearchParams(link.split("?")[1] ?? "");

describe("o recorte que atravessa o clique", () => {
  it("lê unidade, canal e vigência do endereço", () => {
    expect(lerRecorte("period=2026-08-01&scopeHash=abc&canal=EMPURRADA")).toEqual({
      period: "2026-08-01",
      scopeHash: "abc",
      canal: "EMPURRADA",
    });
  });

  it("distingue canal ausente de canal vazio", () => {
    // `canal=` vazio é uma partição real da base — "as vigências sem canal
    // legível no rótulo" —, e não a ausência de escolha. Confundir os dois faria
    // a tela responder pela unidade inteira achando que respondia por uma fatia.
    expect(lerRecorte("scopeHash=abc").canal).toBeNull();
    expect(lerRecorte("scopeHash=abc&canal=").canal).toBe("");
  });

  it("não trata vigência vazia como vigência", () => {
    expect(lerRecorte("period=").period).toBeNull();
  });

  it("leva o canal vazio adiante, que é o que o servidor espera", () => {
    const params = paramsDoRecorte(recorte({ scopeHash: "abc", canal: "" }));
    expect(params.get("canal")).toBe("");
    expect(params.toString()).toBe("scopeHash=abc&canal=");
  });

  it("sabe quando não há recorte para anunciar", () => {
    expect(temRecorte(RECORTE_VAZIO)).toBe(false);
    expect(temRecorte(recorte({ period: "2026-08-01" }))).toBe(true);
    expect(temRecorte(recorte({ canal: "" }))).toBe(true);
  });
});

describe("cada aba recebe só o que sabe honrar", () => {
  it("a Planilha recebe vigência, unidade e filtro", () => {
    const link = linkDeAlteracoes({
      recorte: recorte({ period: "2026-08-01", scopeHash: "abc", canal: "EMPURRADA" }),
      filtros: { impactConfidence: "NOT_CALCULABLE" },
    });
    expect(query(link).get("period")).toBe("2026-08-01");
    expect(query(link).get("scopeHash")).toBe("abc");
    expect(query(link).get("canal")).toBe("EMPURRADA");
    expect(query(link).get("impactConfidence")).toBe("NOT_CALCULABLE");
  });

  it("a Planilha é o padrão, e não se escreve", () => {
    // Um `?aba=planilha` em todo link do produto é ruído que não muda nada.
    expect(query(linkDeAlteracoes()).has("aba")).toBe(false);
    expect(linkDeAlteracoes()).toBe("/alteracoes");
  });

  it("o Impacto recebe a unidade, nunca a vigência", () => {
    // A matriz põe todas as quinzenas lado a lado. Recortá-la na vigência aberta
    // deixaria uma coluna só — e o endereço afirmaria um filtro que a tela não
    // aplica.
    const link = linkDeAlteracoes({
      aba: "impacto",
      recorte: recorte({ period: "2026-08-01", scopeHash: "abc" }),
    });
    expect(query(link).get("aba")).toBe("impacto");
    expect(query(link).get("scopeHash")).toBe("abc");
    expect(query(link).has("period")).toBe(false);
  });

  it("o Impacto não recebe filtro nenhum — nem o parâmetro", () => {
    /*
      Abrir a matriz já num parâmetro afirmaria que foi aquele o assunto da
      quinzena, que é a porta fechada em 16/08/2026; e mandar o parâmetro para a
      Planilha trocaria uma contagem de nove vigências por uma de uma só. O que
      sustenta o número do panorama é a matriz, e clicar na linha já leva até
      ela.
    */
    const link = linkDeAlteracoes({
      aba: "impacto",
      recorte: recorte({ scopeHash: "abc" }),
      filtros: {
        attributeCode: "cavalo.finame",
        entityType: "CAVALO",
        impactConfidence: "CALCULATED",
      },
    });
    expect(query(link).get("scopeHash")).toBe("abc");
    expect(query(link).has("attributeCode")).toBe(false);
    expect(query(link).has("entityType")).toBe(false);
    expect(query(link).has("impactConfidence")).toBe(false);
  });

  it("Cliente recebe o mesmo que o Impacto", () => {
    // Ela lê a série inteira e mostra o subconjunto acionável do que o Impacto
    // apurou: unidade é o assunto, vigência única estreitaria a leitura, e
    // filtro de linha é vocabulário de outra aba.
    const link = linkDeAlteracoes({
      aba: "cliente",
      recorte: recorte({ period: "2026-08-01", scopeHash: "abc", canal: "" }),
      filtros: { impactConfidence: "NOT_CALCULABLE" },
    });
    expect(query(link).get("aba")).toBe("cliente");
    expect(query(link).get("scopeHash")).toBe("abc");
    expect(query(link).get("canal")).toBe("");
    expect(query(link).has("period")).toBe(false);
    expect(query(link).has("impactConfidence")).toBe(false);
  });

  it("Chamados não recebe recorte nenhum", () => {
    // O export de chamados é uma população própria: não é recortado por unidade
    // nem por vigência em lugar nenhum do produto, e fingir que é seria pior do
    // que não filtrar.
    const link = linkDeAlteracoes({
      aba: "chamados",
      recorte: recorte({ period: "2026-08-01", scopeHash: "abc", canal: "EMPURRADA" }),
      filtros: { impactConfidence: "NOT_CALCULABLE" },
    });
    expect(link).toBe("/alteracoes?aba=chamados");
  });

  it("a série só existe na Planilha", () => {
    expect(query(linkDeAlteracoes({ serie: "CAVALO" })).get("serie")).toBe("CAVALO");
    expect(query(linkDeAlteracoes({ aba: "impacto", serie: "CAVALO" })).has("serie")).toBe(
      false,
    );
  });

  it("filtro vazio não vira filtro", () => {
    const link = linkDeAlteracoes({ filtros: { attributeCode: "", search: "" } });
    expect(link).toBe("/alteracoes");
  });
});

describe("trocar de aba passa o endereço pelo mesmo crivo", () => {
  it("larga o que a aba de destino não aplica", () => {
    const atual = "period=2026-08-01&scopeHash=abc&impactConfidence=NOT_CALCULABLE";
    const params = paramsDeAlteracoes({
      aba: "impacto",
      recorte: lerRecorte(atual),
      filtros: lerFiltros(atual),
    });
    expect(params.get("scopeHash")).toBe("abc");
    expect(params.has("period")).toBe(false);
    expect(params.has("impactConfidence")).toBe(false);
  });

  it("devolve o recorte inteiro quando a volta é para a Planilha", () => {
    const atual = "aba=impacto&scopeHash=abc&attributeCode=cavalo.finame";
    const params = paramsDeAlteracoes({
      aba: "planilha",
      recorte: lerRecorte(atual),
      filtros: lerFiltros(atual),
    });
    expect(params.get("scopeHash")).toBe("abc");
    expect(params.get("attributeCode")).toBe("cavalo.finame");
  });
});

describe("ler é o inverso de escrever", () => {
  it("os filtros que a Visão geral escreve são os que a Planilha lê", () => {
    const link = linkDeAlteracoes({
      recorte: recorte({ period: "2026-08-01" }),
      filtros: { entityType: "CAVALO", attributeCode: "cavalo.finame" },
    });
    expect(lerFiltros(query(link))).toEqual({
      entityType: "CAVALO",
      attributeCode: "cavalo.finame",
    });
    expect(lerRecorte(query(link)).period).toBe("2026-08-01");
  });

  it("o que não é filtro conhecido não vira filtro", () => {
    // `aba` e `serie` andam no mesmo endereço e não são recorte de linha; um
    // deles virando filtro mandaria `aba=impacto` ao servidor como se fosse uma
    // coluna a comparar.
    expect(lerFiltros("aba=impacto&serie=CAVALO&period=2026-08-01")).toEqual({});
  });
});

describe("o caminho de volta", () => {
  it("devolve a Visão geral do mesmo recorte", () => {
    expect(
      linkDaVisaoGeral(recorte({ period: "2026-08-01", scopeHash: "abc" })),
    ).toBe("/?period=2026-08-01&scopeHash=abc");
  });

  it("sem recorte, volta para a Visão geral e nada mais", () => {
    expect(linkDaVisaoGeral(RECORTE_VAZIO)).toBe("/");
  });
});

describe("o caminho para a posição", () => {
  it("leva a unidade e as duas pontas do intervalo", () => {
    expect(
      linkDaPosicao(recorte({ scopeHash: "abc", canal: "EMPURRADA" }), {
        de: "2026-01-02",
        ate: "2026-08-01",
      }),
    ).toBe("/posicao?scopeHash=abc&canal=EMPURRADA&de=2026-01-02&ate=2026-08-01");
  });

  it("não leva vigência — a posição é de um intervalo, não de um ponto", () => {
    /*
      `period` recortaria a leitura a uma vigência, que é o oposto do que esta
      tela mede. Deixá-lo passar faria o endereço prometer um filtro que a tela
      não aplica — a mesma recusa que `paramsDoRecorte` já faz pela aba Impacto.
    */
    const endereco = linkDaPosicao(
      recorte({ period: "2026-08-01", scopeHash: "abc" }),
      { de: "2026-01-02", ate: "2026-08-01" },
    );
    expect(endereco).not.toContain("period=");
    expect(endereco).toContain("scopeHash=abc");
  });

  it("sem as pontas, abre a posição no intervalo que o servidor escolher", () => {
    // Acontece quando a unidade tem uma vigência só: não há intervalo a nomear.
    expect(linkDaPosicao(recorte({ scopeHash: "abc" }), { de: null, ate: null })).toBe(
      "/posicao?scopeHash=abc",
    );
    expect(linkDaPosicao(RECORTE_VAZIO, { de: null, ate: null })).toBe("/posicao");
  });

  it("o canal vazio viaja, porque vazio é uma partição e não uma ausência", () => {
    expect(
      linkDaPosicao(recorte({ scopeHash: "abc", canal: "" }), {
        de: "2026-01-02",
        ate: "2026-08-01",
      }),
    ).toContain("canal=");
  });
});

describe("as duas telas nomeiam a unidade igual", () => {
  it("prefere o nome do escopo cadastrado", () => {
    expect(
      nomeDaUnidade({
        label: "CAMAÇARI · EMPURRADA",
        scopes: [{ scopeType: "UNIDADE", code: "CAM", name: "CAMAÇARI" }],
      }),
    ).toBe("CAMAÇARI");
  });

  it("cai no código, e depois no rótulo do servidor", () => {
    expect(
      nomeDaUnidade({
        label: "CAMAÇARI · EMPURRADA",
        scopes: [{ scopeType: "UNIDADE", code: "CAM", name: null }],
      }),
    ).toBe("CAM");
    expect(nomeDaUnidade({ label: "CAMAÇARI · EMPURRADA", scopes: [] })).toBe(
      "CAMAÇARI · EMPURRADA",
    );
  });
});

describe("a aba pedida no endereço", () => {
  it("aceita as quatro que existem, e só elas", () => {
    expect(abaValida("planilha")).toBe(true);
    expect(abaValida("chamados")).toBe(true);
    expect(abaValida("impacto")).toBe(true);
    expect(abaValida("cliente")).toBe(true);
    expect(abaValida("curadoria")).toBe(false);
    expect(abaValida(null)).toBe(false);
  });
});
