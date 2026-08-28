import { describe, expect, it } from "vitest";
import {
  MODULOS,
  chaveDoModulo,
  filtrarGrupos,
  modulosPorGrupo,
  moduloDaLocalizacao,
  nivelDe,
  type Nivel,
} from "@/lib/permissoes";
import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";

/**
 * A permissão que a interface aplica — e o que ela promete não fazer.
 *
 * O caso que abre a lista é o mais importante e o mais fácil de perder num
 * refactor: **o vazio concede**. Uma conta sem decisão nenhuma vê o menu
 * inteiro, porque é o que toda conta via antes de existir permissão; inverter
 * isso "para ficar mais seguro" esvaziaria a lateral de todo mundo no dia do
 * deploy — e a API continuaria aceitando escrita, porque lá o padrão é o mesmo.
 */

const VAZIO: Record<string, Nivel> = {};

describe("o padrão, que é conceder", () => {
  it("sem decisão, todo módulo é de edição", () => {
    expect(nivelDe(VAZIO, "/curadoria")).toBe("EDITAR");
    expect(nivelDe(VAZIO, "/qualquer-coisa-que-nao-existe")).toBe("EDITAR");
  });

  it("o menu inteiro sobrevive a um mapa vazio", () => {
    const grupos = navGroupsAuditoria("auditoria");
    const filtrados = filtrarGrupos(grupos, VAZIO);
    expect(filtrados.map((g) => g.titulo)).toEqual(grupos.map((g) => g.titulo));
  });
});

describe("a chave do módulo é o endereço sem a base do ambiente", () => {
  it("as quatro auditorias e os três fechamentos falam do mesmo módulo", () => {
    expect(chaveDoModulo("/auditoria-rota/curadoria")).toBe("/curadoria");
    expect(chaveDoModulo("/curadoria")).toBe("/curadoria");
    expect(chaveDoModulo("~/configuracoes")).toBe("/configuracoes");
  });

  it("uma decisão vale nas quatro auditorias, e não em uma só", () => {
    const so = { "/curadoria": "SEM_ACESSO" } as Record<string, Nivel>;
    expect(nivelDe(so, "/auditoria-rota/curadoria")).toBe("SEM_ACESSO");
    expect(nivelDe(so, "/auditoria-as/curadoria")).toBe("SEM_ACESSO");
  });
});

describe("o endereço aberto e o módulo dono dele", () => {
  it("a tela de dentro pertence ao módulo de fora", () => {
    expect(moduloDaLocalizacao("/composicao/ABC1234")?.chave).toBe("/composicao");
    expect(moduloDaLocalizacao("/fluxos/7")?.chave).toBe("/fluxos");
  });

  it("o prefixo mais longo ganha — /dre não engole /dre-veiculo", () => {
    expect(moduloDaLocalizacao("/dre-veiculo")?.chave).toBe("/dre-veiculo");
    expect(moduloDaLocalizacao("/dre")?.chave).toBe("/dre");
  });

  it("o que não é módulo devolve null, e não um bloqueio", () => {
    expect(moduloDaLocalizacao("/login")).toBeNull();
    expect(moduloDaLocalizacao("/nao-existe")).toBeNull();
  });

  it("a query não muda o dono do endereço", () => {
    expect(moduloDaLocalizacao("/parametros?scopeHash=abc")?.chave).toBe("/parametros");
  });
});

describe("esconder é do menu, e some a seção que ficou vazia", () => {
  it("o item bloqueado sai da lista", () => {
    const grupos = filtrarGrupos(navGroupsAuditoria("auditoria"), {
      "/curadoria": "SEM_ACESSO",
    });
    const hrefs = grupos.flatMap((g) => g.itens.map((i) => i.href));
    expect(hrefs).not.toContain("/curadoria");
    expect(hrefs).toContain("/categorias");
  });

  it("somente leitura continua no menu — a tela abre, a escrita é que não", () => {
    const grupos = filtrarGrupos(navGroupsAuditoria("auditoria"), {
      "/curadoria": "VISUALIZAR",
    });
    expect(grupos.flatMap((g) => g.itens.map((i) => i.href))).toContain("/curadoria");
  });

  it("seção sem nenhum item sobrando não aparece com o título vazio", () => {
    const grupos = filtrarGrupos(
      [{ titulo: "Compras", itens: [{ href: "/remunerado" }] }],
      { "/remunerado": "SEM_ACESSO" },
    );
    expect(grupos).toEqual([]);
  });
});

describe("o catálogo é o menu, e não uma segunda lista", () => {
  it("todo item do menu da Auditoria tem módulo", () => {
    const doMenu = navGroupsAuditoria("auditoria").flatMap((g) =>
      g.itens.map((i) => chaveDoModulo(i.href)),
    );
    const catalogo = new Set(MODULOS.map((m) => m.chave));
    expect(doMenu.filter((chave) => !catalogo.has(chave))).toEqual([]);
  });

  it("nenhum módulo aparece duas vezes, mesmo estando em dois menus", () => {
    const chaves = MODULOS.map((m) => m.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("os grupos da tela preservam a ordem e o total do catálogo", () => {
    const agrupados = modulosPorGrupo();
    expect(agrupados.flatMap((s) => s.itens)).toEqual(MODULOS);
  });
});
