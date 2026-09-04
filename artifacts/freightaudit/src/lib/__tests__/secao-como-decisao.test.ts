import { describe, expect, it } from "vitest";
import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";
import { navGroupsFechamento } from "@/components/layout/nav-fechamento";
import { GRUPO_ADMINISTRACAO } from "@/components/layout/nav-administracao";
import { SECAO_DO_MODULO_GOVERNADO } from "@workspace/acesso";
import {
  BASES_DE_AUDITORIA,
  BASES_DE_FECHAMENTO,
  descricaoDoAmbiente,
  type AmbienteDeAuditoria,
  type AmbienteDeFechamento,
} from "@/lib/ambiente";
import {
  MODULOS,
  chaveDaSecao,
  chaveDoModulo,
  filtrarGrupos,
  modulosPorGrupo,
  nivelDe,
  secaoDoModulo,
  type Nivel,
} from "@/lib/permissoes";

/**
 * A seção como decisão, e o catálogo como contrato.
 *
 * Duas invariantes, e as duas nasceram de defeito observado — não de desenho no
 * papel:
 *
 * 1. **Seção desligada vence módulo ligado, hoje e amanhã.** A seção sumia da
 *    lateral por consequência (todos os itens caíam, o grupo ficava vazio) e
 *    voltava inteira no dia em que um módulo novo entrava nela. Agora ela é
 *    chave própria, e o módulo novo nasce dentro da decisão.
 * 2. **Se aparece no menu, é governável.** O catálogo era montado de uma
 *    auditoria só, e as telas 360° das outras três ficavam de fora de Módulos
 *    Universais e de Permissões — itens de menu que nenhuma camada de acesso
 *    alcançava.
 */

const SEM_ACESSO: Nivel = "SEM_ACESSO";
const EDITAR: Nivel = "EDITAR";

const AUDITORIAS = Object.keys(BASES_DE_AUDITORIA) as AmbienteDeAuditoria[];
const FECHAMENTOS = Object.keys(BASES_DE_FECHAMENTO) as AmbienteDeFechamento[];

/** Todas as laterais que o produto desenha, como ele as desenha. */
function todasAsLaterais() {
  return [
    ...AUDITORIAS.map((a) => ({ ambiente: a, grupos: navGroupsAuditoria(a) })),
    ...FECHAMENTOS.map((f) => ({
      ambiente: f,
      grupos: navGroupsFechamento(
        BASES_DE_FECHAMENTO[f],
        descricaoDoAmbiente(f).nome,
      ),
    })),
  ];
}

describe("a seção desligada esconde o que está dentro dela", () => {
  const CHAMADOS = navGroupsAuditoria("auditoria").filter(
    (g) => g.id === "chamados-ambev",
  );

  it("seção desligada + módulo existente → o módulo some", () => {
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("chamados-ambev")]: SEM_ACESSO,
    };

    expect(nivelDe(permissoes, "/justificativas")).toBe("SEM_ACESSO");
    expect(nivelDe(permissoes, "/monitoramento-de-chamados")).toBe("SEM_ACESSO");
    expect(filtrarGrupos(CHAMADOS, permissoes)).toEqual([]);
  });

  it("seção desligada + módulo criado depois → o módulo continua escondido", () => {
    /*
      O módulo de amanhã não tem linha no banco, e chave sem linha é chave
      ligada — é o silêncio que concede em toda esta camada, e é ele que
      devolvia a seção ao menu. A decisão sobre a seção é o que atravessa o
      tempo: quem não existe ainda já está dentro dela.
    */
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("chamados-ambev")]: SEM_ACESSO,
    };
    const comNovo = [
      {
        ...CHAMADOS[0],
        itens: [
          ...CHAMADOS[0].itens,
          { href: "/chamados-de-amanha", label: "Módulo que nasce depois", icon: CHAMADOS[0].icon },
        ],
      },
    ];

    expect(filtrarGrupos(comNovo, permissoes)).toEqual([]);
  });

  it("seção desligada vence o módulo explicitamente ligado por baixo", () => {
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("chamados-ambev")]: SEM_ACESSO,
      "/justificativas": EDITAR,
    };

    expect(nivelDe(permissoes, "/justificativas")).toBe("SEM_ACESSO");
  });

  it("para devolver um módulo ao menu, a seção precisa estar ligada primeiro", () => {
    const soComOModulo: Record<string, Nivel> = {
      [chaveDaSecao("chamados-ambev")]: SEM_ACESSO,
      "/justificativas": EDITAR,
    };
    expect(filtrarGrupos(CHAMADOS, soComOModulo)).toEqual([]);

    /* Ligar a seção é apagar a linha dela — e aí o módulo volta a decidir. */
    const comASecaoDeVolta: Record<string, Nivel> = { "/justificativas": EDITAR };
    const grupos = filtrarGrupos(CHAMADOS, comASecaoDeVolta);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].itens.map((i) => i.href)).toContain("/justificativas");
  });

  it("seção ligada + módulo desligado → some só aquele módulo", () => {
    const permissoes: Record<string, Nivel> = { "/justificativas": SEM_ACESSO };

    const grupos = filtrarGrupos(CHAMADOS, permissoes);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].itens.map((i) => i.href)).not.toContain("/justificativas");
    expect(grupos[0].itens.map((i) => i.href)).toContain("/monitoramento-de-chamados");
    expect(nivelDe(permissoes, "/monitoramento-de-chamados")).toBe("EDITAR");
  });

  it("a seção de um ambiente não desliga a seção homônima de outro", () => {
    /*
      "Frota" é o título de uma seção da Auditoria e de outra do Fechamento, e
      elas não são a mesma: uma leva à placa, a outra ao custo da competência.
      Os ids são distintos justamente para o título não decidir por elas.
    */
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("frota")]: SEM_ACESSO,
    };

    const daAuditoria = navGroupsAuditoria("auditoria").filter((g) => g.id === "frota");
    const doFechamento = navGroupsFechamento(
      BASES_DE_FECHAMENTO["fechamento-rota"],
      "Fechamento Rota",
    ).filter((g) => g.id === "fechamento-frota");

    expect(filtrarGrupos(daAuditoria, permissoes)).toEqual([]);
    expect(filtrarGrupos(doFechamento, permissoes)).toHaveLength(1);
  });

  it("a decisão sobre a seção vale nas quatro auditorias, e não em uma só", () => {
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("frota")]: SEM_ACESSO,
    };

    for (const ambiente of AUDITORIAS) {
      const titulos = filtrarGrupos(navGroupsAuditoria(ambiente), permissoes).map(
        (g) => g.id,
      );
      expect(titulos, `Frota sobrou em ${ambiente}`).not.toContain("frota");
    }
  });

  it("a primeira seção do Fechamento responde pela mesma chave nos quatro ambientes", () => {
    /*
      O título dela é o nome do ambiente — "Fechamento Rota", "Fechamento AS" —,
      e é por isso que a chave não sai do título: são quatro rótulos para uma
      seção só.
    */
    const permissoes: Record<string, Nivel> = {
      [chaveDaSecao("fechamento")]: SEM_ACESSO,
    };

    for (const f of FECHAMENTOS) {
      const grupos = navGroupsFechamento(
        BASES_DE_FECHAMENTO[f],
        descricaoDoAmbiente(f).nome,
      );
      expect(filtrarGrupos(grupos, permissoes).map((g) => g.id)).not.toContain(
        "fechamento",
      );
    }
  });
});

describe("o catálogo cobre tudo o que o menu mostra", () => {
  it("nenhuma rota visível no menu fica fora do catálogo governável", () => {
    const catalogo = new Set(MODULOS.map((m) => m.chave));
    const orfaos: string[] = [];

    for (const { ambiente, grupos } of todasAsLaterais()) {
      for (const grupo of grupos) {
        for (const item of grupo.itens) {
          const chave = chaveDoModulo(item.href);
          if (!catalogo.has(chave)) orfaos.push(`${ambiente} · ${item.label} (${chave})`);
        }
      }
    }
    for (const item of GRUPO_ADMINISTRACAO.itens) {
      const chave = chaveDoModulo(item.href);
      if (!catalogo.has(chave)) orfaos.push(`Administração · ${item.label} (${chave})`);
    }

    expect(orfaos).toEqual([]);
  });

  it("nenhuma seção visível no menu fica fora do catálogo governável", () => {
    const secoes = new Set(modulosPorGrupo().map((s) => s.secao));
    const orfas: string[] = [];

    for (const { ambiente, grupos } of todasAsLaterais()) {
      for (const grupo of grupos) {
        if (!secoes.has(grupo.id)) orfas.push(`${ambiente} · ${grupo.titulo} (${grupo.id})`);
      }
    }

    expect(orfas).toEqual([]);
  });

  it("os módulos das quatro auditorias obedecem ao mesmo catálogo", () => {
    /*
      Módulo é o endereço sem a base do ambiente: `/alteracoes` é uma chave só
      nas quatro. O que muda entre elas é a Frota, e mesmo ali as telas são
      chaves próprias — `/caminhao-360` não é `/cavalo-360` com outro nome.
    */
    const porAmbiente = AUDITORIAS.map((a) =>
      navGroupsAuditoria(a).flatMap((g) => g.itens.map((i) => chaveDoModulo(i.href))),
    );

    const comuns = porAmbiente[0].filter((c) =>
      porAmbiente.every((lista) => lista.includes(c)),
    );
    expect(comuns).toContain("/alteracoes");

    for (const chave of comuns) {
      const doCatalogo = MODULOS.filter((m) => m.chave === chave);
      expect(doCatalogo, `${chave} deveria ser uma entrada só`).toHaveLength(1);
    }

    /* E as três telas que só existem fora da Empurrada estão governadas. */
    for (const chave of ["/caminhao-360", "/carroceria-360", "/empilhadeira-360"]) {
      expect(secaoDoModulo(chave), `${chave} sem seção`).toBe("frota");
    }
  });

  it("nenhum módulo aparece duas vezes, mesmo estando em oito laterais", () => {
    const chaves = MODULOS.map((m) => m.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("todo módulo do catálogo declara a seção em que vive", () => {
    const semSecao = MODULOS.filter((m) => !m.secao || m.secao.trim() === "");
    expect(semSecao).toEqual([]);
  });
});

describe("o servidor e o menu concordam sobre a seção de cada módulo", () => {
  /*
    `SECAO_DO_MODULO_GOVERNADO` é a única tabela que o servidor não tem como
    derivar sozinho: o portão de escrita precisa saber de que seção é o módulo
    dono de um prefixo de API, e o servidor não importa a tela. Esta prova mora
    aqui, e não lá, porque é aqui que o menu está — é ela que transforma
    "escrito nos dois lados" em "escrito uma vez e conferido".
  */
  it("todo módulo governado pelo portão existe no menu, na seção que ele declara", () => {
    const divergencias: string[] = [];

    for (const [chave, secao] of Object.entries(SECAO_DO_MODULO_GOVERNADO)) {
      const real = secaoDoModulo(chave);
      if (real === null) {
        divergencias.push(`${chave} não existe no menu`);
      } else if (real !== secao) {
        divergencias.push(`${chave}: servidor diz "${secao}", menu diz "${real}"`);
      }
    }

    expect(divergencias).toEqual([]);
  });
});

describe("cada seção aparece uma vez, e inteira", () => {
  /*
    O catálogo passou a varrer as oito laterais, e os módulos de uma seção
    deixaram de nascer vizinhos: `/caminhao-360` entra quando a varredura chega
    na Rota, muito depois de a Frota da Empurrada ter sido escrita. Um
    agrupamento por trecho contíguo partia a Frota em duas — duas linhas com o
    mesmo título na tela, e duas chaves de React iguais.
  */
  it("nenhuma seção é listada duas vezes", () => {
    const chaves = modulosPorGrupo().map((s) => `${s.ambiente}|${s.secao}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("a Frota da Auditoria traz os ativos das quatro operações num bloco só", () => {
    const frota = modulosPorGrupo().filter(
      (s) => s.secao === "frota" && s.ambiente === "Auditoria",
    );
    expect(frota).toHaveLength(1);

    const chaves = frota[0].itens.map((m) => m.chave);
    for (const esperada of [
      "/cavalo-360",
      "/carreta-360",
      "/caminhao-360",
      "/carroceria-360",
      "/empilhadeira-360",
    ]) {
      expect(chaves, `${esperada} fora do bloco da Frota`).toContain(esperada);
    }
  });

  it("o catálogo agrupado tem exatamente os módulos do catálogo", () => {
    const agrupados = modulosPorGrupo().flatMap((s) => s.itens.map((m) => m.chave));
    expect(agrupados.sort()).toEqual(MODULOS.map((m) => m.chave).sort());
  });
});
