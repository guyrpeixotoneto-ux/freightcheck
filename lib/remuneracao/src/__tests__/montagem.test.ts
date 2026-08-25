import { describe, expect, it } from "vitest";
import { BLOCOS_DO_CADASTRO, LINHAS_DO_CADASTRO } from "../catalogo";
import { montarCadastro, type LinhaApurada, type MaterialDoCadastro } from "../montagem";
import type { TrechoDaVigencia } from "../medicao";

/**
 * A montagem do cadastro — e, sobretudo, a promessa que ela faz.
 *
 * A promessa é uma só e está no primeiro caso: **nenhuma linha sai daqui sem
 * estado**. Ou tem número e diz de onde ele veio, ou não tem e diz o que falta.
 * Uma linha em branco e silenciosa é o defeito que este módulo inteiro existe
 * para não cometer — é ela que faz quem confere concluir que o valor é zero.
 */

const trecho = (t: Partial<TrechoDaVigencia>): TrechoDaVigencia => ({
  tributo: null,
  percentualDeclarado: null,
  freteCtrc: null,
  imposto: null,
  pisCofins: null,
  previsaoViagens: null,
  ...t,
});

/** Uma vigência que entregou o bastante para o cadastro medir o que sabe medir. */
const VIGENCIA_COMPLETA: MaterialDoCadastro = {
  cavalos: [
    ...Array.from({ length: 56 }, (_, i) => ({ entityId: `ativo-${i}`, ativo: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ entityId: `inativo-${i}`, ativo: false })),
  ],
  trechos: [
    trecho({
      tributo: "ISS",
      freteCtrc: 1000,
      imposto: 59,
      pisCofins: 92.5,
      previsaoViagens: 2,
      percentualDeclarado: 5.9,
    }),
    trecho({
      tributo: "ICMS",
      freteCtrc: 10_000,
      imposto: 1784,
      pisCofins: 925,
      previsaoViagens: 62,
      percentualDeclarado: 17.84,
    }),
  ],
  trechosEntregues: true,
};

const VIGENCIA_VAZIA: MaterialDoCadastro = {
  cavalos: [],
  trechos: [],
  trechosEntregues: false,
};

function linha(material: MaterialDoCadastro, chave: string): LinhaApurada {
  const encontrada = montarCadastro(material)
    .blocos.flatMap((b) => b.linhas)
    .find((l) => l.chave === chave);
  if (!encontrada) throw new Error(`Linha desconhecida no catálogo: ${chave}`);
  return encontrada;
}

describe("o cadastro montado", () => {
  it("devolve todas as linhas do catálogo, na ordem dos blocos", () => {
    const montado = montarCadastro(VIGENCIA_COMPLETA);
    const chaves = montado.blocos.flatMap((b) => b.linhas).map((l) => l.chave);

    expect(chaves).toEqual(LINHAS_DO_CADASTRO.map((l) => l.chave));
    expect(montado.blocos.map((b) => b.titulo)).toEqual(
      BLOCOS_DO_CADASTRO.map((b) => b.titulo),
    );
  });

  /*
    O caso central. Vale para as duas vigências — a que tem dado e a que não
    tem —, porque a promessa não pode depender de haver dado: é justamente
    quando não há que a tela precisa dizer alguma coisa.
  */
  it.each([
    ["uma vigência com dados", VIGENCIA_COMPLETA],
    ["uma vigência vazia", VIGENCIA_VAZIA],
  ])("nunca deixa uma linha muda, em %s", (_nome, material) => {
    for (const l of montarCadastro(material).blocos.flatMap((b) => b.linhas)) {
      if (l.estado === "APURADO") {
        expect(l.valor, l.chave).not.toBeNull();
        expect(l.procedencia?.regra, l.chave).toBeTruthy();
        expect(l.ausencia, l.chave).toBeNull();
      } else if (l.estado === "EM_CONJUNTO") {
        expect(l.valor, l.chave).toBeNull();
        expect(l.conjunto?.valor, l.chave).toBeTypeOf("number");
        expect(l.ausencia?.motivo, l.chave).toBeTruthy();
      } else {
        expect(l.valor, l.chave).toBeNull();
        expect(l.ausencia?.motivo, l.chave).toBeTruthy();
        expect(l.ausencia?.destrava, l.chave).toBeTruthy();
      }
    }
  });

  it("conta o resumo a partir das próprias linhas", () => {
    const { blocos, resumo } = montarCadastro(VIGENCIA_COMPLETA);
    const linhas = blocos.flatMap((b) => b.linhas);

    expect(resumo.linhas).toBe(linhas.length);
    expect(resumo.apuradas + resumo.emConjunto + resumo.semLastro).toBe(linhas.length);
    expect(resumo.apuradas).toBeGreaterThan(0);
  });

  /*
    O placar de hoje, preso aqui de propósito — e o número que se quer ver
    **subir**.

    Ele existe por dois motivos opostos, e os dois importam. Se cair sem que
    ninguém perceba, uma linha que tinha lastro passou a não ter, e a tela ficou
    mais vazia em silêncio. Se subir, alguém destravou uma linha — e o texto que
    a tela escreve ("onze das trinta") precisa acompanhar, senão a tela passa a
    se descrever errado. Nas duas direções, o caso obriga a mudança a ser
    deliberada.

    Onze de trinta é o cadastro sobre um acervo completo: as duas alíquotas
    medidas, o par PIS + COFINS, os três recortes de frota, as duas proporções
    de documento e as duas linhas do resumo de impostos.
  */
  it("apura onze das trinta e três linhas sobre um acervo completo", () => {
    expect(montarCadastro(VIGENCIA_COMPLETA).resumo).toEqual({
      linhas: 33,
      apuradas: 9,
      informadas: 0,
      emConjunto: 2,
      semLastro: 22,
      comLastro: 11,
      conferidas: 0,
      divergentes: 0,
      conferenciasComAcervo: 0,
      conferenciasInternas: 0,
      divergenciasComAcervo: 0,
      divergenciasInternas: 0,
    });
  });

  /*
    E, sem acervo nenhum, nenhuma linha é apurada — mas as trinta continuam lá.
    É a diferença entre uma tela vazia e uma tela que explica por que está
    vazia.
  */
  it("não apura nada sem acervo, e ainda assim entrega as trinta e três linhas", () => {
    expect(montarCadastro(VIGENCIA_VAZIA).resumo).toEqual({
      linhas: 33,
      apuradas: 0,
      informadas: 0,
      emConjunto: 0,
      semLastro: 33,
      comLastro: 0,
      conferidas: 0,
      divergentes: 0,
      conferenciasComAcervo: 0,
      conferenciasInternas: 0,
      divergenciasComAcervo: 0,
      divergenciasInternas: 0,
    });
  });
});

describe("as linhas que o acervo sustenta", () => {
  it("conta a frota exatamente como a planilha a declara", () => {
    expect(linha(VIGENCIA_COMPLETA, "frota_fixa_ativos").valor).toBe(56);
    expect(linha(VIGENCIA_COMPLETA, "frota_fixa_inativos").valor).toBe(8);
    expect(linha(VIGENCIA_COMPLETA, "frota_fixa_operacao").valor).toBe(64);
  });

  it("mede ICMS e ISS em pontos percentuais, com a procedência junto", () => {
    const icms = linha(VIGENCIA_COMPLETA, "aliquota_icms");
    expect(icms.estado).toBe("APURADO");
    expect(icms.valor).toBeCloseTo(17.84, 4);
    expect(icms.procedencia?.colunas).toContain("impostosIcmsIss");
    expect(icms.procedencia?.registros).toBe(1);

    expect(linha(VIGENCIA_COMPLETA, "aliquota_iss").valor).toBeCloseTo(5.9, 4);
  });

  /*
    PIS e COFINS são o motivo de `EM_CONJUNTO` existir. As duas linhas aparecem,
    nenhuma delas tem número próprio, e as duas apontam para o mesmo par medido
    — que é a leitura fiel do que o export entrega.
  */
  it("mostra PIS e COFINS como par, sem rachar o que o export não racha", () => {
    const pis = linha(VIGENCIA_COMPLETA, "aliquota_pis");
    const cofins = linha(VIGENCIA_COMPLETA, "aliquota_cofins");

    expect(pis.estado).toBe("EM_CONJUNTO");
    expect(cofins.estado).toBe("EM_CONJUNTO");
    expect(pis.valor).toBeNull();
    expect(pis.conjunto?.valor).toBeCloseTo(9.25, 4);
    expect(pis.conjunto?.linhas).toEqual(["aliquota_pis", "aliquota_cofins"]);
    expect(cofins.conjunto?.valor).toBe(pis.conjunto?.valor);
  });

  it("proporciona os documentos pelas viagens previstas", () => {
    const dentro = linha(VIGENCIA_COMPLETA, "rota_percentual_iss");
    const fora = linha(VIGENCIA_COMPLETA, "rota_percentual_ctrc");

    // 2 de 64 viagens previstas ficam dentro do município.
    expect(dentro.valor).toBeCloseTo(3.125, 4);
    expect(fora.valor).toBeCloseTo(96.875, 4);
    expect(dentro.valor! + fora.valor!).toBeCloseTo(100, 6);
  });

  it("fecha o resumo de impostos com as alíquotas que acabou de medir", () => {
    // 100 − 9,25 − 5,90 e 100 − 9,25 − 17,84.
    expect(linha(VIGENCIA_COMPLETA, "resumo_iss").valor).toBeCloseTo(84.85, 4);
    expect(linha(VIGENCIA_COMPLETA, "resumo_ctrc").valor).toBeCloseTo(72.91, 4);
  });
});

describe("as linhas que o acervo não sustenta", () => {
  it("recusa o total enquanto qualquer parcela estiver sem lastro", () => {
    const total = linha(VIGENCIA_COMPLETA, "ativo_total_sem_imposto");

    expect(total.estado).toBe("SEM_LASTRO");
    expect(total.valor).toBeNull();
    // O motivo nomeia as parcelas que faltam, para que a lacuna seja acionável.
    expect(total.ausencia?.motivo).toContain("Remuneração Fixa - Frota Fixa Ativa");
  });

  it("distingue a série não entregue da série entregue sem as colunas", () => {
    const semSerie = linha(VIGENCIA_VAZIA, "aliquota_icms");
    const comSerieSemColunas = linha(
      { cavalos: [], trechos: [trecho({ tributo: "ICMS" })], trechosEntregues: true },
      "aliquota_icms",
    );

    expect(semSerie.ausencia?.motivo).toContain("não entregou trechos");
    expect(comSerieSemColunas.ausencia?.motivo).toContain("entregou a série de trechos");
  });

  it("não conta frota quando nenhum cavalo respondeu se está ativo", () => {
    const semColuna = linha(
      { cavalos: [{ entityId: "a", ativo: null }], trechos: [], trechosEntregues: false },
      "frota_fixa_ativos",
    );

    expect(semColuna.estado).toBe("SEM_LASTRO");
    expect(semColuna.ausencia?.motivo).toContain("ativo");
  });

  it("registra na regra quantos veículos não responderam", () => {
    const comOmissos = linha(
      {
        cavalos: [
          { entityId: "a", ativo: true },
          { entityId: "b", ativo: null },
        ],
        trechos: [],
        trechosEntregues: false,
      },
      "frota_fixa_operacao",
    );

    expect(comOmissos.valor).toBe(1);
    expect(comOmissos.procedencia?.regra).toContain("não foram contados como inativos");
  });

  it("recusa o resumo de impostos quando falta a alíquota que ele usa", () => {
    const semAliquotas = linha(VIGENCIA_VAZIA, "resumo_ctrc");

    expect(semAliquotas.estado).toBe("SEM_LASTRO");
    expect(semAliquotas.ausencia?.motivo).toContain("PIS + COFINS");
  });
});

describe("o catálogo", () => {
  it("não repete chave", () => {
    const chaves = LINHAS_DO_CADASTRO.map((l) => l.chave);
    expect(chaves).toHaveLength(new Set(chaves).size);
  });

  /*
    Uma soma que aponte para uma chave inexistente não quebra typecheck — as
    parcelas são texto — e produziria um total silenciosamente menor. Este caso
    é a única defesa contra isso.
  */
  it("só soma parcelas que existem", () => {
    const chaves = new Set(LINHAS_DO_CADASTRO.map((l) => l.chave));
    for (const l of LINHAS_DO_CADASTRO) {
      if (l.origem.tipo !== "SOMA_DE_LINHAS") continue;
      for (const parcela of l.origem.parcelas) {
        expect(chaves.has(parcela), `${l.chave} soma ${parcela}`).toBe(true);
      }
    }
  });

  it("escreve motivo e destrava em toda linha sem origem", () => {
    for (const l of LINHAS_DO_CADASTRO) {
      if (l.origem.tipo !== "SEM_ORIGEM") continue;
      expect(l.origem.motivo.length, l.chave).toBeGreaterThan(40);
      expect(l.origem.destrava.length, l.chave).toBeGreaterThan(20);
    }
  });
});
