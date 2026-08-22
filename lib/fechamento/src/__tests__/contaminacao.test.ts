import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { conferirDePara } from "../de-para";
import { lerPagamento } from "../leitores/pagamento";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { comReferencia, type NumerosDaReferencia } from "../painel-referencia";
import { montarResumo, type QuinzenaApurada } from "../resumo";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * A VARREDURA — por onde a régua **poderia** alcançar a conta, e não alcança.
 *
 * Esta suíte não confirma o desenho: procura buracos nele. Cada teste é um
 * caminho de contaminação concreto que alguém poderia abrir sem perceber, preso
 * de forma a falhar no dia em que abrir.
 *
 * Os três caminhos que existem, e que são cobertos aqui:
 *
 * 1. **import** — um módulo do cálculo passa a importar a referência. É o mais
 *    provável e o mais silencioso: um `import` novo não muda nenhum número
 *    hoje, e deixa a planilha ao alcance da mão de quem mexer amanhã.
 * 2. **tabela** — o cálculo passa a `SELECT` de `fechamento_referencia*`.
 * 3. **aliasing** — o enxerto é feito com spread, que é **raso**: `{...linha}`
 *    copia `devido` por referência. Se o enxerto mutasse o que copiou, mudaria
 *    o objeto original sem trocar nenhum import.
 *
 * O quarto caminho — passar o número da planilha como parâmetro para
 * `montarMapaDaQuinzena`, `basesDaQuinzena` ou `somarVariavel` — não precisa de
 * teste: as assinaturas não têm por onde recebê-lo, e o compilador é quem
 * recusa.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const fonte = (arquivo: string) => readFileSync(path.join(AQUI, "..", arquivo), "utf8");

/**
 * Os módulos por onde o dinheiro passa.
 *
 * Do diário ao resumo: se a planilha entrar em qualquer um deles, ela passa a
 * poder mudar o que se cobra. `resumo.ts` está na lista mesmo declarando os
 * tipos das colunas novas — declarar o tipo é uma coisa, importar o módulo que
 * sabe preenchê-lo é outra, e é a segunda que abre o caminho.
 */
const MODULOS_DO_CALCULO = [
  "mapa-rota.ts",
  "persistencia.ts",
  "resumo.ts",
  "apuracao.ts",
  "de-para.ts",
  "dominio.ts",
  "inconsistencias.ts",
  "cadastro-porta.ts",
  "reconciliacao.ts",
];

/** Um `import ... from "x"` de verdade — não a palavra dentro de um comentário. */
function importaDe(codigo: string, modulo: string): boolean {
  const semComentarios = codigo
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return new RegExp(`from\\s+["'][^"']*${modulo}["']`).test(semComentarios);
}

describe("CAMINHO 1 — nenhum módulo do cálculo importa a régua", () => {
  for (const modulo of MODULOS_DO_CALCULO) {
    it(`${modulo} não importa referencia, painel-referencia nem referencia-persistencia`, () => {
      const codigo = fonte(modulo);
      expect(importaDe(codigo, "referencia"), `${modulo} passou a importar a régua`).toBe(false);
      expect(importaDe(codigo, "painel-referencia")).toBe(false);
      expect(importaDe(codigo, "referencia-persistencia")).toBe(false);
    });
  }

  /**
   * A direção contrária **é** permitida e precisa continuar sendo: o enxerto
   * importa os tipos de `resumo.ts` e o dicionário de causas de
   * `reconciliacao.ts`. O que este teste prende é que a seta aponta para um
   * lado só — se apontasse para os dois, haveria ciclo e o argumento cairia.
   */
  it("a régua importa o cálculo, e não o contrário — a seta tem um sentido só", () => {
    const enxerto = fonte("painel-referencia.ts");
    expect(importaDe(enxerto, "resumo")).toBe(true);
    expect(importaDe(enxerto, "reconciliacao")).toBe(true);
    expect(importaDe(fonte("resumo.ts"), "painel-referencia")).toBe(false);
    expect(importaDe(fonte("reconciliacao.ts"), "painel-referencia")).toBe(false);
  });
});

describe("CAMINHO 2 — nenhum módulo do cálculo toca nas tabelas da referência", () => {
  for (const modulo of MODULOS_DO_CALCULO) {
    it(`${modulo} não menciona fechamento_referencia`, () => {
      const codigo = fonte(modulo)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(codigo).not.toMatch(/fechamentoReferencia/);
      expect(codigo).not.toMatch(/fechamento_referencia/);
    });
  }
});

/* --- CAMINHO 3: o spread é raso, e o enxerto não pode mutar o que copiou --- */

const unidade = { codigo: "443", nome: "CDD FICTICIO" };
const transportadora = { codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" };

const PARAMETROS: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0316,
  frotaFixaAtiva: 56,
  frotaFixaInativa: 8,
  remuneracaoFixaDaFrotaAtiva: 1424.91,
  remuneracaoDaEquipeDeEntrega: 8919.38,
  remuneracaoDoQlpAdministrativo: 4427.53,
  remuneracaoDeOutrasDespesas: 4361.07,
  remuneracaoDaFrotaInativa: 1650.97,
  vansAtivas: 7,
  custoFixoDaVan: 4693.85,
  custoDaEquipeDeEntregaDaVan: 4250.45,
  vansInativas: 6,
  remuneracaoDasVansInativas: 3195.18,
  rotasNoturnas: 1,
  custoDaNoturnaSemImposto: 8697.88,
  custoDeMarketingSemImposto: 0,
};

function quinzenaComTudo(n: 1 | 2): QuinzenaApurada {
  const conferido = conferirDePara(lerPagamento(fixturePagamentoDoPainel()));
  return {
    quinzena: n,
    competenciaId: `id-${n}`,
    chave: `2026-07-Q${n}`,
    estado: "APURADA",
    verbas: [
      { vbz: 1, canal: "ROTA", nome: "Frota Fixa Ativa", natureza: "FIXO", emitido: 100 * n, esperado: 100 * n },
    ],
    demonstrativo: [{ canal: "ROTA", total: conferido.totalDoRelatorio! }],
    descontos: [{ canal: "ROTA", tipo: "FRETE_MINIMO", valor: 10 * n }],
    paineis: [conferido],
    calculados: [
      {
        canal: "ROTA",
        mapa: montarMapaDaQuinzena({
          quinzena: n,
          parametros: PARAMETROS,
          variavel: { frotaFixa: 100, agregado: 50, recargaENoturna: 0, vans: 0 },
          bases: {
            devolucao: 13328.3,
            disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
            complementarNegativo: 0,
            outrosCustos: { fonte: "PLANILHA", valor: 0 },
            indisponibilidade: { fonte: "PLANILHA", valor: 0 },
          },
        }),
      },
    ],
    cadastroUsado: { cadastroId: "cad-1", vigenteDe: "2026-07-01" },
  };
}

function referencia(): NumerosDaReferencia {
  const numeros: NumerosDaReferencia["numeros"] = {};
  const celulas: NumerosDaReferencia["celulas"] = {};
  for (const chave of ["rota_dvs", "custo_fixo_padronizado", "total_remuneracao_rota"]) {
    numeros[chave] = { primeira: 7_777_777, segunda: 8_888_888 };
    celulas[chave] = { primeira: "AI7", segunda: "AJ7" };
  }
  return {
    procedencia: {
      id: "ref-1",
      versao: 1,
      nomeDoArquivo: "p.xlsb",
      sha256: "a".repeat(64),
      anexadaPor: null,
      anexadaEm: "2026-08-01T12:00:00.000Z",
    },
    numeros,
    celulas,
  };
}

describe("CAMINHO 3 — o enxerto não muta o painel que recebeu", () => {
  const painelOriginal = () =>
    montarResumo({
      ano: 2026,
      mes: 7,
      unidade,
      transportadora,
      quinzenas: [quinzenaComTudo(1), quinzenaComTudo(2)],
    }).canais.find((c) => c.canal === "ROTA")!.comparado!;

  it("o painel de entrada continua sem coluna de planilha depois do enxerto", () => {
    const antes = painelOriginal();
    const retrato = JSON.parse(JSON.stringify(antes));

    comReferencia(antes, referencia());

    expect(JSON.parse(JSON.stringify(antes)), "o enxerto mutou a entrada").toEqual(retrato);
    expect(antes.referencia).toBeNull();
    expect(antes.quadros[0]!.linhas[0]!.planilha).toBeNull();
  });

  /**
   * O ponto exato em que o spread raso poderia doer: `devido` no painel de saída
   * **é** o mesmo objeto do de entrada. Isso é aceitável enquanto ninguém
   * escrever nele — e este teste é o que descobre se alguém escrever.
   */
  it("o `devido` de saída tem o mesmo conteúdo do de entrada, valor a valor", () => {
    const antes = painelOriginal();
    const depois = comReferencia(antes, referencia());

    for (const [i, quadro] of depois.quadros.entries()) {
      for (const [j, linha] of quadro.linhas.entries()) {
        const daEntrada = antes.quadros[i]!.linhas[j]!;
        expect(linha.devido, `${linha.chave}.devido mudou`).toEqual(daEntrada.devido);
        expect(linha.demonstrado, `${linha.chave}.demonstrado mudou`).toEqual(daEntrada.demonstrado);
        expect(linha.diferenca, `${linha.chave}.diferenca mudou`).toEqual(daEntrada.diferenca);
      }
      expect(quadro.devido).toEqual(antes.quadros[i]!.devido);
      expect(quadro.diferenca).toEqual(antes.quadros[i]!.diferenca);
    }
  });

  /**
   * As inconsistências são **derivadas das linhas** e calculadas antes do
   * enxerto. Se um dia passarem a ser recalculadas depois, a diferença contra a
   * planilha entraria na lista — e a lista deixaria de falar só do que as duas
   * fontes internas não conciliam.
   */
  it("as inconsistências não mudam, e não ganham item por causa da planilha", () => {
    const antes = painelOriginal();
    const depois = comReferencia(antes, referencia());
    expect(depois.inconsistencias).toEqual(antes.inconsistencias);
    expect(JSON.stringify(depois.inconsistencias)).not.toMatch(/7777777|8888888/);
  });

  /**
   * Uma referência com números absurdos e uma linha que ela **não** publica: a
   * linha não publicada tem de sair com `planilha: null`, e não com o número de
   * outra linha nem com zero.
   */
  it("linha que a planilha não publica sai vazia, e não pega o número da vizinha", () => {
    const depois = comReferencia(painelOriginal(), referencia());
    const linhas = depois.quadros.flatMap((q) => q.linhas);

    const publicada = linhas.find((l) => l.chave === "rota_dvs")!;
    expect(publicada.planilha!.primeira).toBe(7_777_777);

    const naoPublicada = linhas.find((l) => l.chave === "custo_fixo_inativos")!;
    expect(naoPublicada.planilha).toBeNull();
    expect(naoPublicada.diferencaDaPlanilha).toBeNull();
  });
});
