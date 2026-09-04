import { describe, expect, it } from "vitest";
import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";
import { BASES_DE_AUDITORIA, type AmbienteDeAuditoria } from "@/lib/ambiente";
import { MODULOS, chaveDoModulo, filtrarGrupos, type Nivel } from "@/lib/permissoes";

/**
 * A reprodução dos dois defeitos que devolveram o menu inteiro a quem o tinha
 * desligado. Este arquivo nasceu **vermelho**, contra o código que tinha o
 * defeito, e é o que separa "consertado" de "parece consertado".
 *
 * O terceiro defeito da mesma família — o ciclo do bridge apagando a decisão da
 * casa — não cabe aqui porque não é lógica de menu: ele é medido contra
 * PostgreSQL de verdade, em `lib/db/src/__tests__/modulos-universais-bridge.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Defeito 1 — a seção não era um conceito, era um atalho
 * ---------------------------------------------------------------------------
 * "Desligar a seção" gravava as chaves dos módulos que existiam **naquele
 * instante**, e nada mais. A seção some da lateral enquanto todos os itens
 * dela estão fora (`filtrarGrupos` derruba o grupo que fica vazio) — e volta
 * inteira no dia em que um módulo novo entra nela, porque chave sem linha é
 * chave ligada.
 *
 * Não é hipótese: entre 31/08 e 03/09/2026 entraram `/monitoramento-de-chamados`,
 * `/conciliacao-de-chamados` e o Panorama Executivo, exatamente nas duas seções
 * que voltaram ao menu de quem as tinha desligado.
 *
 * ---------------------------------------------------------------------------
 * Defeito 2 — o catálogo era o menu de uma auditoria só
 * ---------------------------------------------------------------------------
 * `MODULOS` era montado a partir de `navGroupsAuditoria("auditoria")` — a
 * Empurrada. As telas 360° que só existem nas outras três (Caminhão, Carroceria,
 * Empilhadeira) apareciam na lateral e **não** apareciam em Módulos Universais
 * nem em Permissões: um item de menu que nenhuma das três camadas de acesso
 * conseguia alcançar.
 */

const SEM_ACESSO: Nivel = "SEM_ACESSO";

describe("defeito 1 — a seção desligada não segurava o módulo que nascia depois", () => {
  /*
    O menu de amanhã: a mesma seção da captura, com um item que ainda não
    existia quando a casa a desligou. É um literal, e não `navGroupsAuditoria`,
    de propósito — o defeito é sobre o item que **ainda não está** no arquivo do
    menu, e um teste que lesse o menu de hoje envelheceria junto com ele.
  */
  const menuComModuloNovo = [
    {
      id: "chamados-ambev",
      titulo: "Chamados Ambev",
      itens: [
        { href: "/monitoramento-de-chamados", label: "Monitoramento" },
        { href: "/justificativas", label: "Justificativas" },
        { href: "/chamados-de-amanha", label: "O módulo que nasce depois" },
      ],
    },
  ];

  it("a decisão sobre a seção vale para o módulo que ainda não existia", () => {
    const permissoes: Record<string, Nivel> = { "#chamados-ambev": SEM_ACESSO };

    expect(filtrarGrupos(menuComModuloNovo, permissoes)).toEqual([]);
  });

  it("a seção desligada vence o módulo ligado por baixo", () => {
    /*
      A precedência que o produto promete: seção desligada é seção desligada, e
      nenhuma decisão de módulo a devolve. Sem isto, "desligar a seção" seria
      só uma forma rápida de escrever N decisões — que é o que ela era.
    */
    const permissoes: Record<string, Nivel> = {
      "#chamados-ambev": SEM_ACESSO,
      "/justificativas": "EDITAR",
    };

    expect(filtrarGrupos(menuComModuloNovo, permissoes)).toEqual([]);
  });
});

describe("defeito 2 — o catálogo governava só a Empurrada", () => {
  it("todo item de menu das quatro auditorias tem chave no catálogo", () => {
    const catalogo = new Set(MODULOS.map((m) => m.chave));
    const orfaos: string[] = [];

    const auditorias = Object.keys(BASES_DE_AUDITORIA) as AmbienteDeAuditoria[];
    for (const ambiente of auditorias) {
      for (const grupo of navGroupsAuditoria(ambiente)) {
        for (const item of grupo.itens) {
          const chave = chaveDoModulo(item.href);
          if (!catalogo.has(chave)) orfaos.push(`${ambiente} · ${item.label} (${chave})`);
        }
      }
    }

    expect(orfaos).toEqual([]);
  });

  it("as telas 360° das outras três auditorias são governáveis", () => {
    const catalogo = new Set(MODULOS.map((m) => m.chave));

    expect(catalogo.has("/caminhao-360")).toBe(true);
    expect(catalogo.has("/carroceria-360")).toBe(true);
    expect(catalogo.has("/empilhadeira-360")).toBe(true);
  });
});
