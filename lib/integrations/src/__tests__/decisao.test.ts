import { describe, expect, it } from "vitest";
import { decidir, recusar, type ChaveGuardada } from "../decisao";
import { CATALOGO_DE_ESCOPOS, ESCOPOS, escoposConhecidos } from "../escopos";

const chaveViva: ChaveGuardada = {
  id: "11111111-1111-1111-1111-111111111111",
  integracaoId: "22222222-2222-2222-2222-222222222222",
  integracaoNome: "Freightech",
  prefixo: "fck_a1b2c3d4e5f6",
  escopos: ["importacoes:enviar"],
  revogadaEm: null,
  integracaoDesativadaEm: null,
};

describe("o portão", () => {
  it("deixa entrar a chave viva com o escopo pedido", () => {
    const d = decidir(chaveViva, "importacoes:enviar");
    expect(d.ok).toBe(true);
  });

  it("recusa por escopo com 403, e diz qual escopo falta", () => {
    const d = decidir(chaveViva, "importacoes:ler");
    expect(d).toMatchObject({ ok: false, motivo: "ESCOPO_INSUFICIENTE", status: 403 });
    if (!d.ok) expect(d.mensagem).toContain("importacoes:ler");
  });

  it("recusa chave revogada com 401", () => {
    const d = decidir({ ...chaveViva, revogadaEm: new Date() }, "importacoes:enviar");
    expect(d).toMatchObject({ ok: false, motivo: "CHAVE_REVOGADA", status: 401 });
  });

  /*
    A ordem das recusas é regra, e não detalhe: quem lê a resposta vai consertar
    o que ela nomear. Uma chave revogada dentro de uma integração desativada
    responde pela integração — trocar a chave não devolveria o acesso.
  */
  it("a integração desativada responde antes da chave revogada", () => {
    const d = decidir(
      { ...chaveViva, revogadaEm: new Date(), integracaoDesativadaEm: new Date() },
      "importacoes:enviar",
    );
    expect(d).toMatchObject({ ok: false, motivo: "INTEGRACAO_DESATIVADA" });
  });

  it("a rota sem escopo exigido só cobra que a chave esteja viva", () => {
    expect(decidir({ ...chaveViva, escopos: [] }, null).ok).toBe(true);
    expect(decidir({ ...chaveViva, escopos: [], revogadaEm: new Date() }, null).ok).toBe(
      false,
    );
  });
});

describe("as recusas de quem nem chegou ao banco", () => {
  it("chave ausente e malformada são 401 com frases diferentes", () => {
    const ausente = recusar("CHAVE_AUSENTE");
    const malformada = recusar("CHAVE_MALFORMADA");
    expect(ausente.ok).toBe(false);
    expect(malformada.ok).toBe(false);
    if (!ausente.ok && !malformada.ok) {
      expect(ausente.status).toBe(401);
      expect(malformada.status).toBe(401);
      expect(ausente.mensagem).not.toBe(malformada.mensagem);
    }
  });

  /*
    A frase da chave desconhecida não pode distinguir "não existe" de "está
    errada": é a única que fala com quem não apresentou credencial válida, e
    essa distinção é exatamente o que ajudaria quem estivesse adivinhando.
  */
  it("a chave desconhecida não diz se a chave existe", () => {
    const d = recusar("CHAVE_DESCONHECIDA");
    if (!d.ok) {
      expect(d.mensagem).not.toMatch(/não existe|inexistente|não encontrada/i);
    }
  });
});

describe("o catálogo de escopos", () => {
  it("descreve todos os escopos, e só os que existem", () => {
    expect(CATALOGO_DE_ESCOPOS.map((d) => d.escopo).sort()).toEqual([...ESCOPOS].sort());
  });

  /*
    A fronteira que este produto não abre mão: a aprovação de uma importação é
    de uma pessoa. Nenhum escopo promove.
  */
  it("nenhum escopo promove importação", () => {
    expect(ESCOPOS.some((e) => e.includes("promover"))).toBe(false);
    expect(
      CATALOGO_DE_ESCOPOS.some((d) => d.rotas.some((r) => r.includes("promote"))),
    ).toBe(false);
  });

  it("escopo desconhecido não concede nada, e não derruba a chave", () => {
    expect(escoposConhecidos(["importacoes:ler", "importacoes:voar"])).toEqual([
      "importacoes:ler",
    ]);
    expect(escoposConhecidos(null)).toEqual([]);
    expect(escoposConhecidos("importacoes:ler")).toEqual([]);
  });
});
