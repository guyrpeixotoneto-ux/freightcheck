import { describe, expect, it } from "vitest";
import {
  conferir,
  conferirCelula,
  LinhaDaPlanilhaInvalida,
  type PlanilhaDeclarada,
  type ValorDeclarado,
} from "../informado";
import { montarCadastro, type LinhaApurada, type MaterialDoCadastro } from "../montagem";
import type { TrechoDaVigencia } from "../medicao";

/**
 * A planilha informada, e a promessa que ela não pode quebrar.
 *
 * A promessa é a do módulo inteiro, aplicada à metade nova: **um número
 * digitado nunca vira um número medido.** Estes casos são a prova de que a
 * fronteira aguenta os quatro jeitos de atravessá-la por acidente — o declarado
 * sobrescrevendo o apurado, o total somando os dois sem dizer, o resumo de
 * impostos derivando de digitado e se chamando apurado, e a lista de unidades
 * contando planilha como lastro do acervo.
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

/** A mesma vigência de `montagem.test.ts`: 56 ativos, 8 parados, dois trechos. */
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

const QUEM = { autor: "Guy", informadoEm: "2026-08-20T12:00:00.000Z", observacao: null };

/** A planilha, escrita como o dicionário que a montagem espera. */
function planilha(valores: Record<string, number>): PlanilhaDeclarada {
  return new Map<string, ValorDeclarado>(
    Object.entries(valores).map(([chave, valor]) => [chave, { valor, ...QUEM }]),
  );
}

function linha(material: MaterialDoCadastro, chave: string): LinhaApurada {
  const encontrada = montarCadastro(material)
    .blocos.flatMap((b) => b.linhas)
    .find((l) => l.chave === chave);
  expect(encontrada, chave).toBeDefined();
  return encontrada!;
}

describe("o que a tela manda, conferido antes de virar linha", () => {
  it("recusa uma chave que o catálogo não tem", () => {
    expect(() => conferirCelula({ chave: "custo_do_cafezinho", valor: 10 })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
  });

  /*
    O erro que este caso prende é o mais provável de todos, e o mais caro: a aba
    escreve `5,90%` e o dado por trás da célula é `0,059`. Aceitar a fração
    produziria um divisor de gross-up de 90,7% em vez de 84,85% — cerca de sete
    por cento a menos em cada documento emitido —, e nada na tela diria de onde
    veio.
  */
  it("recusa percentual em fração e percentual acima de cem", () => {
    expect(() => conferirCelula({ chave: "aliquota_iss", valor: 105 })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
    expect(() => conferirCelula({ chave: "aliquota_iss", valor: -1 })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
    // A fração em si é um percentual válido (0,059%), e passa: o que a recusa
    // alcança é o impossível, não o improvável. Quem confere vê 0,059% na tela.
    expect(conferirCelula({ chave: "aliquota_iss", valor: 0.059 }).valor).toBe(0.059);
  });

  it("recusa contagem quebrada e contagem negativa", () => {
    expect(() => conferirCelula({ chave: "frota_fixa_ativos", valor: 56.5 })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
    expect(() => conferirCelula({ chave: "frota_fixa_ativos", valor: -3 })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
  });

  /*
    Dinheiro negativo passa: um desconto lançado como parcela negativa é
    legítimo na aba, e recusá-lo obrigaria a inventar um sinal fora do produto.
  */
  it("aceita dinheiro negativo", () => {
    expect(conferirCelula({ chave: "ativo_outras_despesas", valor: -150.5 }).valor).toBe(-150.5);
  });

  /*
    O `null` é o desfazer, e precisa ser distinguível de "não é número". Um
    texto que não vira número recusa; um vazio apaga.
  */
  it("separa apagar de errar", () => {
    expect(conferirCelula({ chave: "van_custo_fixo", valor: null }).valor).toBeNull();
    expect(conferirCelula({ chave: "van_custo_fixo", valor: "" }).valor).toBeNull();
    expect(() => conferirCelula({ chave: "van_custo_fixo", valor: "mil reais" })).toThrow(
      LinhaDaPlanilhaInvalida,
    );
  });

  it("arredonda pelo que a linha mede", () => {
    expect(conferirCelula({ chave: "ativo_custo_variavel", valor: 5176.5349 }).valor).toBe(5176.53);
    expect(conferirCelula({ chave: "aliquota_icms", valor: 17.8412345 }).valor).toBe(17.8412);
  });
});

describe("a conferência entre o cadastro e a planilha", () => {
  it("chama de igual o que difere abaixo do último dígito", () => {
    expect(conferir(24_309.0, 24_309.004, "DINHEIRO").bate).toBe(true);
    expect(conferir(72.91, 72.9100004, "PERCENTUAL").bate).toBe(true);
  });

  /*
    Quantidade não tem tolerância: 56 cavalos e 57 cavalos são números
    diferentes, e é a única linha do cadastro em que a divergência se conta na
    mão.
  */
  it("não tolera nada em contagem", () => {
    expect(conferir(56, 57, "QUANTIDADE").bate).toBe(false);
    expect(conferir(56, 56, "QUANTIDADE").bate).toBe(true);
  });

  it("escreve a diferença do ponto de vista da planilha", () => {
    const c = conferir(1000, 1006, "DINHEIRO");
    expect(c.diferenca).toBe(6);
    expect(c.percentual).toBe(0.6);
    expect(c.bate).toBe(false);
  });

  it("não divide por zero", () => {
    expect(conferir(0, 10, "DINHEIRO").percentual).toBeNull();
  });
});

describe("o informado dentro do cadastro montado", () => {
  /*
    O caso central. A planilha de CAMAÇARI declara 56 cavalos ativos; o export
    da mesma vigência traz 56 nesta fixtura e 62 no acervo real. Onde o acervo
    responde, o **valor da linha continua sendo o medido** — o declarado vira
    conferência ao lado. Deixar o digitado ganhar apagaria a divergência, que é
    o achado.
  */
  it("não deixa o declarado sobrescrever o apurado", () => {
    const l = linha(
      { ...VIGENCIA_COMPLETA, declarados: planilha({ frota_fixa_ativos: 50 }) },
      "frota_fixa_ativos",
    );
    expect(l.estado).toBe("APURADO");
    expect(l.valor).toBe(56);
    expect(l.declarado?.valor).toBe(50);
    expect(l.conferencia).toEqual({
      cadastro: 56,
      planilha: 50,
      diferenca: -6,
      percentual: -10.71,
      bate: false,
    });
  });

  it("dá número, autor e data à linha que o acervo não sustenta", () => {
    const l = linha(
      { ...VIGENCIA_COMPLETA, declarados: planilha({ van_custo_fixo: 4693.85 }) },
      "van_custo_fixo",
    );
    expect(l.estado).toBe("INFORMADO");
    expect(l.valor).toBe(4693.85);
    expect(l.ausencia).toBeNull();
    expect(l.procedencia?.fonte).toBe("A planilha informada");
    expect(l.procedencia?.regra).toContain("Guy");
    expect(l.procedencia?.regra).toContain("Não é medida do acervo");
    // A procedência não nomeia coluna nenhuma do export: não há coluna.
    expect(l.procedencia?.colunas).toEqual([]);
  });

  /*
    A soma herda a natureza da parcela mais fraca. Um total sobre número
    digitado é número digitado, e chamá-lo de apurado seria a mistura que o
    estado existe para impedir — ainda mais nesta linha, que é a que vai para a
    conta da quinzena.
  */
  it("fecha o total com parcelas informadas, e o total herda o informado", () => {
    const l = linha(
      {
        ...VIGENCIA_COMPLETA,
        declarados: planilha({
          ativo_remuneracao_fixa_frota: 1424.91,
          ativo_remuneracao_fixa_equipe: 8919.38,
          ativo_custo_variavel: 5176.53,
          ativo_remuneracao_fixa_qlp: 4427.53,
          ativo_outras_despesas: 4361.07,
          ativo_lucro_operacional: 0,
        }),
      },
      "ativo_total_sem_imposto",
    );
    expect(l.estado).toBe("INFORMADO");
    expect(l.valor).toBe(24_309.42);
    expect(l.procedencia?.regra).toContain("6 delas vieram da planilha informada");
  });

  it("continua recusando o total quando falta parcela", () => {
    const l = linha(
      { ...VIGENCIA_COMPLETA, declarados: planilha({ ativo_remuneracao_fixa_frota: 1424.91 }) },
      "ativo_total_sem_imposto",
    );
    expect(l.estado).toBe("SEM_LASTRO");
    expect(l.valor).toBeNull();
    expect(l.ausencia?.motivo).toContain("5 das 6");
  });

  /*
    O total impresso na aba contra a soma das parcelas da mesma aba: a
    conferência que não envolve medida nenhuma, e que prova que a planilha foi
    transcrita certa.
  */
  it("confere o total declarado contra a soma das parcelas declaradas", () => {
    const l = linha(
      {
        ...VIGENCIA_COMPLETA,
        declarados: planilha({
          ativo_remuneracao_fixa_frota: 1424.91,
          ativo_remuneracao_fixa_equipe: 8919.38,
          ativo_custo_variavel: 5176.53,
          ativo_remuneracao_fixa_qlp: 4427.53,
          ativo_outras_despesas: 4361.07,
          ativo_lucro_operacional: 0,
          ativo_total_sem_imposto: 24_309.0,
        }),
      },
      "ativo_total_sem_imposto",
    );
    expect(l.valor).toBe(24_309.42);
    expect(l.conferencia?.planilha).toBe(24_309);
    expect(l.conferencia?.bate).toBe(false);
  });

  /*
    PIS e COFINS chegam somados do export, e o cadastro os mostra em par. Quem
    digita as duas metades da aba destrava as duas linhas — e o par medido
    continua ali, agora como conferência contra a soma delas. É exatamente a
    destrava que o catálogo já nomeava: "a alíquota de um dos dois informada no
    cadastro".
  */
  it("destrava PIS e COFINS separados, e confere a soma contra o par medido", () => {
    const material = {
      ...VIGENCIA_COMPLETA,
      declarados: planilha({ aliquota_pis: 0.65, aliquota_cofins: 8.6 }),
    };
    const pis = linha(material, "aliquota_pis");
    expect(pis.estado).toBe("INFORMADO");
    expect(pis.valor).toBe(0.65);
    // O par medido continua junto: é a segunda medida da mesma coisa.
    expect(pis.conjunto?.valor).toBe(9.25);
    expect(pis.conjunto?.conferencia).toEqual({
      cadastro: 9.25,
      planilha: 9.25,
      diferenca: 0,
      percentual: 0,
      bate: true,
    });
  });

  it("não confere o par com uma metade só declarada", () => {
    const pis = linha(
      { ...VIGENCIA_COMPLETA, declarados: planilha({ aliquota_pis: 0.65 }) },
      "aliquota_pis",
    );
    expect(pis.estado).toBe("INFORMADO");
    expect(pis.conjunto?.conferencia).toBeNull();
  });

  /*
    O resumo de impostos é aritmética sobre as alíquotas do próprio cadastro, e
    o cadastro passou a ter duas fontes de alíquota. Sobre uma vigência sem
    trecho nenhum, as quatro alíquotas digitadas produzem os dois percentuais —
    e os dois saem `INFORMADO`, porque é por eles que todo valor líquido vira
    valor de documento.
  */
  it("deriva o resumo de impostos das alíquotas informadas, sem chamá-lo de apurado", () => {
    const material = {
      ...VIGENCIA_VAZIA,
      declarados: planilha({
        aliquota_pis: 0.65,
        aliquota_cofins: 8.6,
        aliquota_icms: 17.84,
        aliquota_iss: 5.9,
      }),
    };
    const iss = linha(material, "resumo_iss");
    const ctrc = linha(material, "resumo_ctrc");

    expect(iss.estado).toBe("INFORMADO");
    expect(iss.valor).toBe(84.85);
    expect(iss.procedencia?.regra).toContain("da planilha informada");

    expect(ctrc.estado).toBe("INFORMADO");
    expect(ctrc.valor).toBe(72.91);
  });

  it("não fabrica o par de PIS + COFINS com uma metade só", () => {
    const l = linha(
      {
        ...VIGENCIA_VAZIA,
        declarados: planilha({ aliquota_pis: 0.65, aliquota_iss: 5.9 }),
      },
      "resumo_iss",
    );
    expect(l.estado).toBe("SEM_LASTRO");
    expect(l.ausencia?.motivo).toContain("PIS + COFINS");
  });

  it("conta o informado e a divergência separados do lastro do acervo", () => {
    const montado = montarCadastro({
      ...VIGENCIA_COMPLETA,
      declarados: planilha({ frota_fixa_ativos: 50, van_custo_fixo: 4693.85 }),
    });
    expect(montado.resumo.apuradas).toBe(9);
    expect(montado.resumo.informadas).toBe(1);
    expect(montado.resumo.conferidas).toBe(1);
    expect(montado.resumo.divergentes).toBe(1);
  });

  /*
    O par conta como **uma** conferência, e não como duas: as duas linhas
    carregam o mesmo conjunto, e contá-la por linha exageraria o placar
    exatamente na tela em que o produto pede confiança.
  */
  it("conta o par PIS + COFINS uma vez só no placar", () => {
    const montado = montarCadastro({
      ...VIGENCIA_COMPLETA,
      declarados: planilha({ aliquota_pis: 1.0, aliquota_cofins: 9.0 }),
    });
    expect(montado.resumo.conferidas).toBe(1);
    expect(montado.resumo.divergentes).toBe(1);
  });

  it("deixa o cadastro sem planilha exatamente como era", () => {
    const semPlanilha = montarCadastro(VIGENCIA_COMPLETA);
    const comMapaVazio = montarCadastro({ ...VIGENCIA_COMPLETA, declarados: new Map() });
    expect(comMapaVazio).toEqual(semPlanilha);
    expect(semPlanilha.blocos.flatMap((b) => b.linhas).every((l) => l.declarado === null)).toBe(
      true,
    );
  });
});
