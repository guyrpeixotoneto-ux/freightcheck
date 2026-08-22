import { describe, expect, it } from "vitest";

import { conferirDePara } from "../de-para";
import { lerPagamento } from "../leitores/pagamento";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { comReferencia, resumoComReferencia, type NumerosDaReferencia } from "../painel-referencia";
import { montarResumo, type QuinzenaApurada, type ResumoDoMes } from "../resumo";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * A COLUNA QUE NÃO PODE TOCAR NA CONTA.
 *
 * Esta suíte tem um teste que vale por todos os outros — o primeiro. Ele monta o
 * resumo, enxerta a referência, troca a referência por outra completamente
 * diferente, remove a referência, e prova que `devido`, `demonstrado`,
 * `diferenca`, `conjunto`, `memoria` e `falta` são **idênticos** nas quatro
 * leituras. Não "parecidos", não "dentro da tolerância": idênticos, por
 * comparação estrutural profunda.
 *
 * É a tradução em teste do critério que sustenta o desenho inteiro: a planilha
 * é régua, e uma régua que mude o que ela mede não é régua.
 */

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

const mapa = (q: 1 | 2) =>
  montarMapaDaQuinzena({
    quinzena: q,
    parametros: PARAMETROS,
    variavel: { frotaFixa: 100, agregado: 50, recargaENoturna: 0, vans: 0 },
    bases: {
      devolucao: 13328.3,
      disponibilidade: { fonte: "PLANILHA", valor: 11649.87 },
      complementarNegativo: 0,
      outrosCustos: { fonte: "PLANILHA", valor: 0 },
      indisponibilidade: { fonte: "PLANILHA", valor: 0 },
    },
  });

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
    calculados: [{ canal: "ROTA", mapa: mapa(n) }],
    cadastroUsado: { cadastroId: "cad-1", vigenteDe: "2026-07-01" },
  };
}

const resumo = (): ResumoDoMes =>
  montarResumo({
    ano: 2026,
    mes: 7,
    unidade,
    transportadora,
    quinzenas: [quinzenaComTudo(1), quinzenaComTudo(2)],
  });

/** Uma referência qualquer — os valores não importam para o teste da trava. */
function referencia(base: number, versao = 1): NumerosDaReferencia {
  const chaves = [
    "rota_dvs",
    "custo_fixo_padronizado",
    "custo_fixo_inativos",
    "custo_vans_inativas",
    "indisponibilidade_fixo",
    "custo_fixo_especiais",
    "custo_fixo_vans",
    "desconto_devolucao_percentual",
    "desconto_disponibilidade",
    "desconto_complementar_negativo",
    "custo_variavel_frota_fixa",
    "custo_variavel_agregado",
    "indisponibilidade_variavel",
    "outros_custos",
    "total_remuneracao_rota",
    "total_remuneracao_rota_variavel",
    "total_outros_custos",
    "total_geral_unidade",
  ];
  const numeros: NumerosDaReferencia["numeros"] = {};
  const celulas: NumerosDaReferencia["celulas"] = {};
  chaves.forEach((chave, i) => {
    numeros[chave] = { primeira: base + i, segunda: base + i + 1000 };
    celulas[chave] = { primeira: `AI${7 + i}`, segunda: `AJ${7 + i}` };
  });
  return {
    procedencia: {
      id: `ref-${versao}`,
      versao,
      nomeDoArquivo: `planilha-v${versao}.xlsb`,
      sha256: `sha${versao}`.padEnd(64, "0"),
      anexadaPor: "usuario-1",
      anexadaEm: "2026-08-01T12:00:00.000Z",
    },
    numeros,
    celulas,
  };
}

/** Só o que o cálculo produziu — o que tem de ser idêntico em toda leitura. */
function oQueOCalculoProduziu(r: ResumoDoMes) {
  return r.canais.map((canal) => ({
    canal: canal.canal,
    blocos: canal.blocos,
    emitido: canal.emitido,
    conferido: canal.conferido,
    semFonte: canal.semFonte,
    painel: canal.painel,
    quadros:
      canal.comparado?.quadros.map((q) => ({
        quadro: q.quadro,
        devido: q.devido,
        demonstrado: q.demonstrado,
        diferenca: q.diferenca,
        conjuntos: q.conjuntos,
        linhas: q.linhas.map((l) => ({
          chave: l.chave,
          rotulo: l.rotulo,
          papel: l.papel,
          devido: l.devido,
          demonstrado: l.demonstrado,
          diferenca: l.diferenca,
          conjunto: l.conjunto,
          memoria: l.memoria,
          falta: l.falta,
        })),
      })) ?? null,
    cadastro: canal.comparado?.cadastro ?? null,
    pendencias: canal.comparado?.pendencias ?? null,
    inconsistencias: canal.comparado?.inconsistencias ?? null,
  }));
}

describe("CRITÉRIO 1 — a planilha jamais participa do cálculo do devido", () => {
  /**
   * Anexar, trocar e remover, e o cálculo intacto nas quatro leituras.
   *
   * As duas referências são deliberadamente **absurdas** e diferentes entre si
   * (uma na casa dos milhares, outra dos milhões): se houvesse qualquer caminho
   * pelo qual o número da planilha alcançasse o devido, uma diferença dessa
   * ordem apareceria na primeira casa decimal. Números plausíveis poderiam
   * esconder uma contaminação por acaso.
   */
  it("anexar, trocar e remover a referência não altera um único valor calculado", () => {
    const semNada = resumo();
    const comUma = resumoComReferencia(resumo(), referencia(1_000, 1));
    const comOutra = resumoComReferencia(resumo(), referencia(9_000_000, 2));
    const removida = resumoComReferencia(resumo(), null);

    const referencial = oQueOCalculoProduziu(semNada);
    expect(oQueOCalculoProduziu(comUma), "anexar mudou o cálculo").toEqual(referencial);
    expect(oQueOCalculoProduziu(comOutra), "trocar mudou o cálculo").toEqual(referencial);
    expect(oQueOCalculoProduziu(removida), "remover mudou o cálculo").toEqual(referencial);
  });

  it("sem referência, devolve o mesmo objeto — não uma cópia que possa divergir", () => {
    const original = resumo();
    expect(resumoComReferencia(original, null)).toBe(original);

    const painel = original.canais.find((c) => c.canal === "ROTA")!.comparado!;
    expect(comReferencia(painel, null)).toBe(painel);
  });

  /**
   * A contraprova do teste acima: se ele passasse com a coluna vazia, não
   * provaria nada. Aqui se afirma que o enxerto **de fato** aconteceu.
   */
  it("e ainda assim a coluna da planilha foi preenchida — senão o teste acima é vazio", () => {
    const com = resumoComReferencia(resumo(), referencia(1_000));
    const linhas = com.canais.find((c) => c.canal === "ROTA")!.comparado!.quadros.flatMap((q) => q.linhas);
    const dvs = linhas.find((l) => l.chave === "rota_dvs")!;

    expect(dvs.planilha).not.toBeNull();
    expect(dvs.planilha!.primeira).toBe(1000);
    expect(dvs.diferencaDaPlanilha).not.toBeNull();
  });
});

describe("as quatro colunas ficam separadas e cada uma diz de onde veio", () => {
  const com = () => resumoComReferencia(resumo(), referencia(1_000));
  const linhasDe = (r: ResumoDoMes) =>
    r.canais.find((c) => c.canal === "ROTA")!.comparado!.quadros.flatMap((q) => q.linhas);

  it("a diferença da planilha é `devido − planilha`, no mesmo sinal da outra", () => {
    const dvs = linhasDe(com()).find((l) => l.chave === "rota_dvs")!;
    expect(dvs.diferencaDaPlanilha!.primeira).toBe(
      Number((dvs.devido.primeira! - dvs.planilha!.primeira!).toFixed(2)),
    );
  });

  it("cada linha carrega a célula de onde o número da planilha saiu", () => {
    const dvs = linhasDe(com()).find((l) => l.chave === "rota_dvs")!;
    expect(dvs.celulaDaPlanilha).toEqual({ primeira: "AI7", segunda: "AJ7" });
  });

  it("a causa conhecida entra como texto e não zera a diferença", () => {
    const dvs = linhasDe(com()).find((l) => l.chave === "rota_dvs")!;
    expect(dvs.causaConhecida).toMatch(/Recarga e Noturna|cache/);
    /* O número continua inteiro — a causa explica, não absorve. */
    expect(dvs.diferencaDaPlanilha!.primeira).not.toBe(0);
  });

  it("a linha sem causa investigada fica com `null` — é a que merece olhar", () => {
    const inativos = linhasDe(com()).find((l) => l.chave === "custo_fixo_inativos")!;
    expect(inativos.causaConhecida).toBeNull();
    expect(inativos.planilha).not.toBeNull();
  });

  it("a procedência viaja no painel, para a diferença ter fonte", () => {
    const painel = com().canais.find((c) => c.canal === "ROTA")!.comparado!;
    expect(painel.referencia).toEqual({
      id: "ref-1",
      versao: 1,
      nomeDoArquivo: "planilha-v1.xlsb",
      sha256: "sha1".padEnd(64, "0"),
      anexadaPor: "usuario-1",
      anexadaEm: "2026-08-01T12:00:00.000Z",
    });
  });

  /**
   * O total do quadro é **lido** da planilha, não somado das linhas dela.
   *
   * Somar esconderia o defeito que a reconciliação achou na `AJ133`: um total
   * cuja fórmula discorda das próprias parcelas. Lendo os dois, a discordância
   * aparece — que é o ponto de conferir em vez de reproduzir.
   */
  it("o total do quadro sai da célula do total, e não da soma das linhas", () => {
    const quadro = com()
      .canais.find((c) => c.canal === "ROTA")!
      .comparado!.quadros.find((q) => q.quadro === "REMUNERACAO")!;

    /* `total_remuneracao_rota` é o índice 14 do gerador — 1000 + 14. */
    expect(quadro.planilha!.primeira).toBe(1014);
    const somaDasLinhas = quadro.linhas.reduce((s, l) => s + (l.planilha?.primeira ?? 0), 0);
    expect(quadro.planilha!.primeira).not.toBe(somaDasLinhas);
  });
});

describe("uma referência mensal serve às duas quinzenas", () => {
  it("um arquivo só preenche as duas colunas — não há como uma sair de outro", () => {
    const dvs = resumoComReferencia(resumo(), referencia(1_000))
      .canais.find((c) => c.canal === "ROTA")!
      .comparado!.quadros.flatMap((q) => q.linhas)
      .find((l) => l.chave === "rota_dvs")!;

    expect(dvs.planilha!.primeira).toBe(1000);
    expect(dvs.planilha!.segunda).toBe(2000);
    expect(dvs.planilha!.total).toBe(3000);
  });
});
