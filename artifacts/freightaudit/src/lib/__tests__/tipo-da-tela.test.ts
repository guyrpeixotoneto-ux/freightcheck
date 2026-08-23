import { describe, expect, it } from "vitest";
import {
  tipoAusenteNaVigencia,
  tipoDoEndereco,
  valorDoSeletor,
} from "../tipo-da-tela";
import { escoposImportados } from "../escopos";
import type { FamiliesView, TipoNaVigencia } from "@/components/inicio/types";

/**
 * O que a tela de Parâmetros decide sozinha sobre o eixo "o quê".
 *
 * Três decisões, e as três podem errar em silêncio — que é o que as põe sob
 * teste:
 *
 * 1. **ler o tipo do endereço**, porque um link antigo que abrisse em "Todos"
 *    devolveria a pessoa ao estado de onde ela saiu sem dizer que devolveu;
 * 2. **decidir que um tipo está ausente**, porque é essa decisão que troca a
 *    grade por uma frase — e trocá-la à toa esconderia dado que existe;
 * 3. **dizer o que a vigência tem**, porque foi deduzir isso na tela, em vez de
 *    perguntar ao servidor, que fez uma vigência só de trechos parecer uma
 *    unidade sem frota.
 *
 * Nada aqui testa pixel.
 */

function tipo(patch: Partial<TipoNaVigencia>): TipoNaVigencia {
  return {
    code: "CAVALO",
    rotulo: "Cavalo",
    nome: "Cavalo",
    plural: "cavalos",
    grao: "uma linha por placa de cavalo mecânico",
    familia: "REMUNERACAO_EQUIPAMENTO",
    entidades: 0,
    presente: false,
    ultimaVigenciaComDado: null,
    ...patch,
  };
}

/** A vigência do relato: 3 trechos, nenhum equipamento, com endereço de volta. */
function vigenciaSoComTrecho(): FamiliesView {
  const cavalo = tipo({
    ultimaVigenciaComDado: { date: "2026-08-01", label: "01/08/2026", entidades: 62 },
  });
  const trecho = tipo({
    code: "TRECHO",
    rotulo: "Trecho",
    nome: "Trecho",
    plural: "trechos",
    entidades: 3,
    presente: true,
  });
  const qlp = tipo({
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP adm.",
    nome: "QLP administrativo",
    plural: "cargos",
    familia: "QUADRO_DE_PESSOAL",
  });

  return {
    periodLabel: "02/08/2026",
    composicao: {
      tipos: [cavalo, trecho, qlp],
      presentes: [trecho],
      vazia: false,
    },
  } as unknown as FamiliesView;
}

describe("o tipo lido do endereço", () => {
  it("lê o campo novo", () => {
    expect(tipoDoEndereco(new URLSearchParams("tipo=CARRETA"))).toBe("CARRETA");
  });

  /** Links guardados antes de o recorte subir para a barra continuam abrindo. */
  it("aceita o nome antigo do parâmetro", () => {
    expect(tipoDoEndereco(new URLSearchParams("escopo=CAVALO"))).toBe("CAVALO");
  });

  it("prefere o nome novo quando os dois vêm juntos", () => {
    expect(tipoDoEndereco(new URLSearchParams("tipo=TRECHO&escopo=CAVALO"))).toBe("TRECHO");
  });

  it("cai em Todos com endereço vazio ou adulterado", () => {
    expect(tipoDoEndereco(new URLSearchParams(""))).toBeNull();
    expect(tipoDoEndereco(new URLSearchParams("tipo=BICICLETA"))).toBeNull();
  });

  /**
   * `SEM_ESCOPO` é recorte da grade — o atributo que não caiu em nenhum dos seis
   * —, e não um tipo do domínio. A barra o mostra como "Todos" em vez de
   * oferecer uma opção que o servidor não sabe contar.
   */
  it("mostra SEM_ESCOPO como Todos na barra, sem perder o recorte da grade", () => {
    expect(tipoDoEndereco(new URLSearchParams("tipo=SEM_ESCOPO"))).toBe("SEM_ESCOPO");
    expect(valorDoSeletor("SEM_ESCOPO")).toBe("TODOS");
    expect(valorDoSeletor("CAVALO")).toBe("CAVALO");
    expect(valorDoSeletor(null)).toBe("TODOS");
  });
});

describe("o tipo ausente na vigência aberta", () => {
  /** O caso do relato: Cavalo escolhido numa vigência que só tem trecho. */
  it("nomeia o ausente e traz para onde ir", () => {
    const ausente = tipoAusenteNaVigencia(vigenciaSoComTrecho(), "CAVALO");

    expect(ausente?.nome).toBe("Cavalo");
    expect(ausente?.ultimaVigenciaComDado).toEqual({
      date: "2026-08-01",
      label: "01/08/2026",
      entidades: 62,
    });
  });

  it("não acusa ausência do que está presente", () => {
    expect(tipoAusenteNaVigencia(vigenciaSoComTrecho(), "TRECHO")).toBeNull();
  });

  it("não acusa ausência nenhuma em Todos", () => {
    expect(tipoAusenteNaVigencia(vigenciaSoComTrecho(), null)).toBeNull();
  });

  /** Ausente sem histórico é pedido de arquivo, e não convite a navegar. */
  it("distingue 'está noutra vigência' de 'nunca foi importado aqui'", () => {
    const qlp = tipoAusenteNaVigencia(vigenciaSoComTrecho(), "QLP_ADMINISTRATIVO");

    expect(qlp?.nome).toBe("QLP administrativo");
    expect(qlp?.ultimaVigenciaComDado).toBeNull();
    // A família viaja junto: é o que deixa a tela explicar que o quadro de
    // pessoal forma vigência própria em vez de sugerir arquivo perdido.
    expect(qlp?.familia).toBe("QUADRO_DE_PESSOAL");
  });

  /**
   * Sem a apuração do servidor a tela não afirma ausência.
   *
   * Afirmar assim mesmo seria repetir, pelo outro lado, o erro que este campo
   * veio corrigir: dizer que não há o que talvez haja.
   */
  it("não decide ausência sem composição na resposta", () => {
    const semComposicao = { periodLabel: "agosto/2026" } as unknown as FamiliesView;
    expect(tipoAusenteNaVigencia(semComposicao, "CAVALO")).toBeNull();
    expect(tipoAusenteNaVigencia(null, "CAVALO")).toBeNull();
  });
});

describe("o que a vigência tem, para a fileira de escopos", () => {
  /** A composição do servidor manda — inclusive sobre o conjunto. */
  it("lê os tipos presentes da resposta, e não das séries", () => {
    expect([...escoposImportados(vigenciaSoComTrecho())]).toEqual(["TRECHO"]);
  });

  /**
   * O recuo continua de pé para uma resposta sem `composicao`, e continua sendo
   * o que era: dedução pelas séries, com o conjunto inferido dos dois
   * equipamentos.
   */
  it("mantém a dedução antiga quando o servidor não mandou a composição", () => {
    const antigo = {
      series: [{ entityTypeSet: "CARRETA+CAVALO" }],
    } as unknown as FamiliesView;

    expect([...escoposImportados(antigo)].sort()).toEqual(["CARRETA", "CAVALO", "CONJUNTO"]);
  });
});
