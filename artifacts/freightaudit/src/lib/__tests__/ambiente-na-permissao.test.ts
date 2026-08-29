import { describe, expect, it } from "vitest";

import { comAmbiente } from "@/lib/api";
import { AMBIENTES } from "@/lib/ambiente";
import {
  acessoDaLocalizacao,
  ambientesPermitidos,
  chaveDoAmbiente,
  maisRestritivo,
  nivelDoAmbiente,
  type Nivel,
} from "@/lib/permissoes";

/**
 * O ambiente de trabalho como permissão — o eixo que o módulo não sabia dizer.
 *
 * O que este arquivo prende, e por que cada uma importa:
 *
 * 1. **O vazio concede, aqui também.** É a mesma regra do eixo dos módulos, e
 *    perdê-la neste teria o mesmo custo: no dia do deploy, ninguém entraria em
 *    ambiente nenhum.
 * 2. **A composição é o mais restritivo.** Se fosse o mais permissivo, qualquer
 *    módulo em padrão — que é o estado normal de toda conta — desfaria a
 *    decisão tomada sobre o ambiente inteiro.
 * 3. **A Administração fica fora do eixo.** Contas, unidades e o cadastro da
 *    casa valem para o produto inteiro e vivem fora dos prefixos; aplicar o
 *    ambiente ali tiraria a tela de trocar a própria senha de quem trabalha só
 *    no Fechamento.
 * 4. **O carimbo vai em toda chamada**, porque é dele que o portão do servidor
 *    depende para saber de onde a escrita saiu.
 */

const VAZIO: Record<string, Nivel> = {};

describe("o padrão do ambiente, que é conceder", () => {
  it("sem decisão, todo ambiente é de edição", () => {
    for (const ambiente of AMBIENTES) {
      expect(nivelDoAmbiente(VAZIO, ambiente.id)).toBe("EDITAR");
    }
  });

  it("o seletor lista os oito para quem não teve decisão nenhuma", () => {
    expect(ambientesPermitidos(VAZIO)).toHaveLength(AMBIENTES.length);
  });

  it("some do seletor só o que foi bloqueado", () => {
    const permissoes = {
      [chaveDoAmbiente("fechamento-as")]: "SEM_ACESSO" as Nivel,
      [chaveDoAmbiente("auditoria-rota")]: "VISUALIZAR" as Nivel,
    };
    const ids = ambientesPermitidos(permissoes).map((a) => a.id);
    expect(ids).not.toContain("fechamento-as");
    /* Somente leitura continua sendo um ambiente que se abre — e se lê. */
    expect(ids).toContain("auditoria-rota");
  });
});

describe("a composição dos dois eixos", () => {
  it("o mais restritivo vence, nos dois sentidos", () => {
    expect(maisRestritivo("EDITAR", "VISUALIZAR")).toBe("VISUALIZAR");
    expect(maisRestritivo("VISUALIZAR", "EDITAR")).toBe("VISUALIZAR");
    expect(maisRestritivo("VISUALIZAR", "SEM_ACESSO")).toBe("SEM_ACESSO");
    expect(maisRestritivo("EDITAR", "EDITAR")).toBe("EDITAR");
  });

  it("ambiente bloqueado fecha a tela mesmo com o módulo liberado", () => {
    const permissoes = { [chaveDoAmbiente("fechamento-as")]: "SEM_ACESSO" as Nivel };
    const acesso = acessoDaLocalizacao(permissoes, "/fechamento-as/competencias");
    expect(acesso.ambiente).toBe("fechamento-as");
    expect(acesso.doModulo).toBe("EDITAR");
    expect(acesso.nivel).toBe("SEM_ACESSO");
  });

  it("ambiente em somente leitura rebaixa um módulo de edição", () => {
    const permissoes = { [chaveDoAmbiente("auditoria-rota")]: "VISUALIZAR" as Nivel };
    expect(acessoDaLocalizacao(permissoes, "/auditoria-rota/curadoria").nivel).toBe(
      "VISUALIZAR",
    );
  });

  it("bloquear um ambiente não mexe nos outros", () => {
    const permissoes = { [chaveDoAmbiente("auditoria-rota")]: "SEM_ACESSO" as Nivel };
    expect(acessoDaLocalizacao(permissoes, "/curadoria").nivel).toBe("EDITAR");
    expect(acessoDaLocalizacao(permissoes, "/fechamento/competencias").nivel).toBe(
      "EDITAR",
    );
  });

  it("módulo bloqueado continua bloqueado com o ambiente liberado", () => {
    const permissoes = { "/curadoria": "SEM_ACESSO" as Nivel };
    expect(acessoDaLocalizacao(permissoes, "/auditoria-rota/curadoria").nivel).toBe(
      "SEM_ACESSO",
    );
  });
});

describe("a Administração fica fora do eixo do ambiente", () => {
  it("bloquear a Auditoria Empurrada não fecha Configurações", () => {
    const permissoes = { [chaveDoAmbiente("auditoria")]: "SEM_ACESSO" as Nivel };
    const acesso = acessoDaLocalizacao(permissoes, "/configuracoes");
    expect(acesso.ambiente).toBeNull();
    expect(acesso.nivel).toBe("EDITAR");
  });

  it("mas fecha as telas da própria Empurrada", () => {
    const permissoes = { [chaveDoAmbiente("auditoria")]: "SEM_ACESSO" as Nivel };
    expect(acessoDaLocalizacao(permissoes, "/alteracoes").nivel).toBe("SEM_ACESSO");
  });
});

describe("o carimbo do ambiente na chamada", () => {
  it("vai nos oito, inclusive na Empurrada que mora na raiz", () => {
    expect(comAmbiente("/changes", "/alteracoes")).toBe("/changes?ambiente=auditoria");
    expect(comAmbiente("/changes", "/auditoria-as/alteracoes")).toBe(
      "/changes?ambiente=auditoria-as",
    );
    expect(comAmbiente("/fechamento/competencias", "/fechamento")).toBe(
      "/fechamento/competencias?ambiente=fechamento-rota",
    );
    expect(comAmbiente("/fechamento/apuracoes", "/fechamento-apoio/apuracoes")).toBe(
      "/fechamento/apuracoes?ambiente=fechamento-apoio",
    );
  });

  it("preserva a consulta que a chamada já trazia", () => {
    expect(comAmbiente("/changes?period=2026-08-01", "/auditoria-rota/alteracoes")).toBe(
      "/changes?period=2026-08-01&ambiente=auditoria-rota",
    );
  });

  it("nunca sobrescreve um ambiente que quem chamou declarou", () => {
    expect(comAmbiente("/x?ambiente=fechamento-as", "/alteracoes")).toBe(
      "/x?ambiente=fechamento-as",
    );
  });
});
