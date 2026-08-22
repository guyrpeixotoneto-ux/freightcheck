import { describe, expect, it } from "vitest";

import {
  GRUPOS_DA_PLANILHA,
  LINHAS_DA_PLANILHA,
  conferirDePara,
  linhaDaPlanilha,
  type LinhaConferida,
  type QuadroConferido,
} from "../de-para";
import { lerPagamento, vbzsCitadasNoRotulo } from "../leitores/pagamento";
import { fixturePagamento, fixturePagamentoDoPainel } from "./fixtures";

const painel = () => conferirDePara(lerPagamento(fixturePagamentoDoPainel()));

const quadro = (
  nome: "REMUNERACAO" | "VARIAVEL" | "OUTROS_CUSTOS" | "EQUIPE_DE_ENTREGA",
): QuadroConferido => {
  const achado = painel().quadros.find((q) => q.quadro === nome);
  if (!achado) throw new Error(`quadro ${nome} não montado`);
  return achado;
};

const linha = (chave: string): LinhaConferida => {
  const achada = painel()
    .quadros.flatMap((q) => q.linhas)
    .find((l) => l.chave === chave);
  if (!achada) throw new Error(`linha ${chave} não conferida`);
  return achada;
};

describe("o catálogo do painel", () => {
  it("transcreve os vinte rótulos da planilha, na ordem em que ela os empilha", () => {
    expect(LINHAS_DA_PLANILHA.map((l) => l.rotulo)).toEqual([
      "TOTAL REMUNERAÇÃO ROTA DVS",
      "CUSTO FIXO PADRONIZADO",
      "CUSTO FIXO INATIVOS",
      "CUSTO VANS INATIVAS",
      "INDISPONIBILIDADE",
      "CUSTO FIXO - ESPECIAIS",
      "CUSTO FIXO - VANS",
      "DESCONTO DE DEVOLUÇÃO %",
      "DESCONTO DE DISPONIBILIDADE",
      "DESCONTO COMPLEMENTAR NEGATIVO",
      "TOTAL REMUNERAÇÃO ROTA",
      "CUSTO VARIÁVEL (FROTA FIXA)",
      "CUSTO VARIÁVEL (AGREGADO)",
      "DESCONTO DE DEVOLUÇÃO",
      "INDISPONIBILIDADE",
      "TOTAL REMUNERAÇÃO ROTA",
      "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS",
      "TOTAL OUTROS CUSTOS",
      "REM. VARIÁVEL - EQUIPE DE ENTREGA",
      "TOTAL REM. VARIÁVEL - EQUIPE DE ENTREGA",
    ]);
  });

  it("escreve os mesmos vinte rótulos como se escreve, para a tela mostrar", () => {
    /*
      A caixa alta da planilha é formatação de célula, não sentido — e vinte
      linhas gritando de uma vez é o que a tela não pode repetir. As duas
      grafias vivem lado a lado porque nenhuma deriva da outra: `toLowerCase`
      estragaria `DVS`, que é sigla, e `toUpperCase` perderia os travessões.
    */
    expect(LINHAS_DA_PLANILHA.map((l) => l.nome)).toEqual([
      "Total remuneração rota DVS",
      "Custo fixo padronizado",
      "Custo fixo inativos",
      "Custo vans inativas",
      "Indisponibilidade",
      "Custo fixo — especiais",
      "Custo fixo — vans",
      "Desconto de devolução %",
      "Desconto de disponibilidade",
      "Desconto complementar negativo",
      "Total remuneração rota",
      "Custo variável (frota fixa)",
      "Custo variável (agregado)",
      "Desconto de devolução",
      "Indisponibilidade",
      "Total remuneração rota",
      "Total remuneração rota outros custos",
      "Total outros custos",
      "Remuneração variável — equipe de entrega",
      "Total remuneração variável — equipe de entrega",
    ]);
  });

  it("classifica o quadro do fixo como a aritmética da planilha exige, e não como o rótulo sugere", () => {
    /*
      Esta é a conta que decidiu três classificações, feita sobre o painel real
      (CDD 443 · transportadora 036, agosto/2026), nas duas quinzenas:

        1ª: 313.318,87 + 731.502,84 + 9.017,30 + 13.088,62 + 0 + 5.938,28
            + 42.745,64                                    = 1.115.611,55
            − 18.199,19 (devolução %) − 15.907,37 (disponibilidade)
                                                           = 1.081.504,98  ✓
        2ª: 327.503,60 + 739.274,00 + 23.834,82 + 13.103,05 + 0 + 5.944,83
            + 42.792,77                                    = 1.152.453,07
            − 21.548,23 − 125.271,68 − 14.050,54           =   991.582,62  ✓

      As duas fecham no `TOTAL REMUNERAÇÃO ROTA` que a própria planilha escreve.
      Tirar `DVS` das parcelas, ou tirar a linha `%` dos descontos, quebra as
      duas — e é por isso que o teste é sobre quem é parcela e quem é desconto,
      e não sobre os números, que são de um mês só.
    */
    const doQuadro = (papel: string) =>
      LINHAS_DA_PLANILHA.filter((l) => l.quadro === "REMUNERACAO" && l.papel === papel).map(
        (l) => l.chave,
      );

    expect(doQuadro("PARCELA")).toEqual([
      "rota_dvs",
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "indisponibilidade_fixo",
      "custo_fixo_especiais",
      "custo_fixo_vans",
    ]);
    expect(doQuadro("DESCONTO")).toEqual([
      "desconto_devolucao_percentual",
      "desconto_disponibilidade",
      "desconto_complementar_negativo",
    ]);
  });

  it("dá a cada linha uma chave única e uma justificativa escrita", () => {
    const chaves = LINHAS_DA_PLANILHA.map((l) => l.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const l of LINHAS_DA_PLANILHA) {
      expect(l.porque.length, `${l.rotulo} sem porquê`).toBeGreaterThan(40);
    }
  });

  it("escreve motivo e destrava em toda linha sem origem — nenhuma some calada", () => {
    for (const l of LINHAS_DA_PLANILHA) {
      if (l.origem.tipo !== "SEM_ORIGEM") continue;
      expect(l.origem.motivo.length, `${l.rotulo} sem motivo`).toBeGreaterThan(40);
      expect(l.origem.destrava.length, `${l.rotulo} sem destrava`).toBeGreaterThan(20);
    }
  });

  it("só aponta para grupos que existem, e todo grupo aponta de volta", () => {
    for (const l of LINHAS_DA_PLANILHA) {
      const origem = l.origem;
      if (origem.tipo !== "EM_GRUPO") continue;
      const grupo = GRUPOS_DA_PLANILHA.find((g) => g.chave === origem.grupo);
      expect(grupo, `${l.rotulo} aponta para ${origem.grupo}, que não existe`).toBeDefined();
    }
    for (const g of GRUPOS_DA_PLANILHA) {
      for (const chave of g.linhas) {
        const l = linhaDaPlanilha(chave);
        expect(l, `${g.chave} cita ${chave}, que não existe`).toBeDefined();
        expect(l?.origem).toEqual({ tipo: "EM_GRUPO", grupo: g.chave });
      }
    }
    const emGrupo = LINHAS_DA_PLANILHA.filter((l) => l.origem.tipo === "EM_GRUPO");
    const citadas = GRUPOS_DA_PLANILHA.flatMap((g) => g.linhas);
    expect(emGrupo.map((l) => l.chave).sort()).toEqual([...citadas].sort());
  });

  it("mantém as linhas de um grupo dentro de um quadro só", () => {
    for (const g of GRUPOS_DA_PLANILHA) {
      const quadros = new Set(g.linhas.map((c) => linhaDaPlanilha(c)?.quadro));
      expect(quadros.size, `${g.chave} atravessa quadros`).toBe(1);
    }
  });
});

describe("a VBZ que o rótulo do desconto nomeia", () => {
  it("lê o código quando o relatório o escreve", () => {
    expect(
      vbzsCitadasNoRotulo(
        "Desconto FF - Custo Fixo (Desconto Liquido ja subtraido da VBZ 01 - Frota Fixa Ativa)",
        "ROTA",
      ),
    ).toEqual([1]);
  });

  it("resolve pelo nome, no canal certo, quando o relatório não escreve o código", () => {
    const rotulo = "*Desconto Liquido Devolucao ja subtraido da VBZ Frota Fixa Ativa";
    expect(vbzsCitadasNoRotulo(rotulo, "ROTA")).toEqual([1]);
    /* O AS tem uma verba com o mesmo nome — e ela é a 20, não a 1. */
    expect(vbzsCitadasNoRotulo(rotulo, "AS")).toEqual([20]);
  });

  it("devolve vazio quando o relatório não nomeia nenhuma — e não chuta", () => {
    expect(
      vbzsCitadasNoRotulo(
        "Desconto Frete mínimo (Desconto Líquido já subtraído das VBZs de custo Fixo coluna ICMS)",
        "ROTA",
      ),
    ).toEqual([]);
  });

  it("anexa ao desconto de devolução a linha de origem que vem embaixo dele", () => {
    const pagamento = lerPagamento(fixturePagamentoDoPainel());
    const devolucao = pagamento.descontos.find((d) => d.tipo === "DEVOLUCAO");
    expect(devolucao?.rotulo).toContain("ja subtraido da VBZ Frota Fixa Ativa");
    expect(devolucao?.vbzDeOrigem).toEqual([1]);
    expect(devolucao?.percentual).toBe(1.5);
    expect(devolucao?.base).toBe(325000);
  });
});

describe("o quadro do fixo", () => {
  it("fecha contra o 03.08.20 — o total é a soma das verbas fixas do bloco FRETE", () => {
    expect(quadro("REMUNERACAO").total).toBe(200000);
  });

  it("soma os descontos de volta para chegar à parcela bruta que a planilha escreve", () => {
    /*
      O termo que faltava. O relatório traz as verbas já líquidas (200.000,00);
      a planilha escreve a parcela antes dos descontos que este quadro abate
      — 3.800,00 de disponibilidade e 4.875,00 de devolução — e mostra cada um
      numa linha à parte. As duas leituras batem quando os dois são somados de
      volta, e só quando.
    */
    const conjunto = linha("custo_fixo_padronizado").conjunto;
    expect(conjunto?.valor).toBe(208675);
    expect(conjunto?.linhas).toEqual([
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "custo_fixo_especiais",
      "custo_fixo_vans",
    ]);
  });

  it("deixa de resíduo o desconto que o relatório não atribui a verba nenhuma", () => {
    /*
      Bruto menos descontos daria o total do relatório se todo desconto tivesse
      de onde voltar. O frete mínimo não tem: o rótulo dele diz "das VBZs de
      custo Fixo coluna ICMS" e não nomeia nenhuma, e o conjunto só soma de
      volta o que o relatório atribui. Ele é abatido e não é somado, e a
      diferença de R$ 700,00 fica no resíduo, que é onde ela pode ser vista.
    */
    const q = quadro("REMUNERACAO");
    expect(q.somado).toBe(199300);
    expect(q.total).toBe(200000);
    expect(q.residuo).toBe(700);
  });

  it("nomeia as duas linhas que continuam sem origem, e só essas duas", () => {
    /*
      Pelo nome que a tela mostra: o resíduo é lido por gente, não por grep.

      `DVS` entrou nesta lista quando saiu do conjunto do fixo — ver o motivo
      escrito na origem dela. Ela tem devido e não tem demonstrado, que é um
      estado legítimo e diferente de não ter nenhum dos dois. O desconto
      complementar negativo saiu dela na mesma leva, ao ser identificado com o
      frete mínimo do relatório.
    */
    expect(quadro("REMUNERACAO").semLastro).toEqual([
      "Total remuneração rota DVS",
      "Indisponibilidade",
    ]);
  });

  it("não deixa verba do quadro fora do painel", () => {
    expect(quadro("REMUNERACAO").verbasSemLinha).toEqual([]);
  });

  it("dá as cinco linhas do fixo como conjunto, nunca rateadas", () => {
    for (const chave of [
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "custo_fixo_especiais",
      "custo_fixo_vans",
    ]) {
      const l = linha(chave);
      expect(l.estado, chave).toBe("EM_CONJUNTO");
      expect(l.valor, chave).toBeNull();
    }
  });

  it("soma os quatro descontos de disponibilidade na linha que a planilha lhes dá", () => {
    const l = linha("desconto_disponibilidade");
    expect(l.estado).toBe("APURADO");
    expect(l.valor).toBe(3800);
    expect(l.procedencia?.registros).toBe(4);
    /* Todos saíram de verbas deste quadro: nada a reportar. */
    expect(l.origemForaDoQuadro).toEqual([]);
  });

  it("põe dinheiro na linha `%`, que é o que a planilha escreve nela", () => {
    /*
      O `%` do rótulo é do critério, não da unidade: a célula traz o valor da
      devolução — o mesmo do quadro de baixo —, e é ele que fecha este quadro.
      A alíquota não some: viaja na procedência, que é onde ela explica o número
      sem se somar a ele.
    */
    const l = linha("desconto_devolucao_percentual");
    expect(l.estado).toBe("APURADO");
    expect(l.papel).toBe("DESCONTO");
    expect(l.valor).toBe(4875);
    expect(l.valor).toBe(linha("desconto_devolucao").valor);
    expect(l.procedencia?.entrou).toContain("% Dev. Resp. Transportadora: 1.5");
  });
});

describe("o quadro do variável", () => {
  it("fecha contra as verbas variáveis e complementares do bloco FRETE", () => {
    expect(quadro("VARIAVEL").total).toBe(125000);
  });

  it("não soma de volta desconto que não saiu das verbas dele", () => {
    /*
      O conjunto do variável é **líquido de nada**: os R$ 120.000,00 são a soma
      crua da VBZ 05 com a VBZ 07. O relatório diz, na linha de cada desconto, de
      qual verba ele foi subtraído — devolução da VBZ 01, disponibilidade das
      VBZ 01, 02 e 03 —, e nenhuma delas é daqui.

      A planilha repete as duas linhas neste quadro e as abate do total dele; o
      relatório não. É essa discordância, e não uma verba perdida, que responde
      pela maior parte do resíduo — e ela é da planilha, cujo quadro do variável
      é informativo e não entra no total geral que ela imprime.
    */
    const q = quadro("VARIAVEL");
    expect(linha("custo_variavel_frota_fixa").conjunto?.valor).toBe(120000);
    expect(q.somado).toBe(111325);
    expect(q.total).toBe(125000);
    /* 5.000 da verba sem linha + 8.675 dos dois descontos que a planilha repete. */
    expect(q.residuo).toBe(13675);
    expect(q.verbasSemLinha).toEqual([
      { vbz: 6, nome: "Rem. Variável Equipe Entrega", valor: 5000 },
    ]);
  });

  it("acusa que a devolução foi abatida aqui e saiu de uma verba do outro quadro", () => {
    const l = linha("desconto_devolucao");
    expect(l.valor).toBe(4875);
    expect(l.origemForaDoQuadro).toEqual(["VBZ 01"]);
  });

  it("lê a indisponibilidade do variável como o desconto de disponibilidade", () => {
    /*
      Nome de parcela, sinal de desconto: a planilha escreve aqui, ao centavo, o
      que `DESCONTO DE DISPONIBILIDADE` abate no quadro de cima. A homônima do
      fixo continua sem lastro — aquela célula vem vazia, e vazia não decide
      sinal nenhum.
    */
    const variavel = linha("indisponibilidade_variavel");
    expect(variavel.estado).toBe("APURADO");
    expect(variavel.papel).toBe("DESCONTO");
    expect(variavel.valor).toBe(linha("desconto_disponibilidade").valor);

    const fixo = linha("indisponibilidade_fixo");
    expect(fixo.estado).toBe("SEM_LASTRO");
    expect(fixo.ausencia?.motivo).toContain("INDISPONIBILIDADE");
  });
});

describe("o quadro de outros custos", () => {
  it("é a correspondência direta: o bloco de mesmo nome do relatório", () => {
    const q = quadro("OUTROS_CUSTOS");
    expect(q.total).toBe(15000);
    expect(q.somado).toBe(15000);
    expect(q.residuo).toBe(0);
    expect(q.semLastro).toEqual([]);
    expect(q.verbasSemLinha).toEqual([]);
  });

  it("leva a VBZ que aparece nos dois blocos pela seção, não pela natureza", () => {
    /*
      A 07 (Freteiro) está no frete e em outros custos. É a seção do relatório
      que decide de qual quadro ela é em cada aparição — somá-la pela natureza
      a poria duas vezes no variável.
    */
    const entrou = linha("outros_custos").procedencia?.entrou ?? [];
    expect(entrou).toEqual(["VBZ 7 — Freteiro", "VBZ 9 — Outras Despesas"]);
  });
});

describe("o painel inteiro", () => {
  it("os três quadros somam o `Total Remuneração` que o relatório fecha", () => {
    const p = painel();
    expect(p.totalDoRelatorio).toBe(340000);
    expect(p.totalDosQuadros).toBe(340000);
    expect(p.diferenca).toBe(0);
  });

  it("lê a coluna sem imposto por padrão, que é a moeda dos descontos", () => {
    expect(painel().coluna).toBe("semImposto");
  });

  it("aceita outra coluna sem mudar a estrutura do painel", () => {
    const porCte = conferirDePara(lerPagamento(fixturePagamentoDoPainel()), {
      coluna: "ctrcIcms",
    });
    expect(porCte.coluna).toBe("ctrcIcms");
    expect(porCte.quadros.map((q) => q.quadro)).toEqual(painel().quadros.map((q) => q.quadro));
  });
});

describe("o 03.08.20 que não cobre o painel", () => {
  it("diz o que falta em vez de devolver zero", () => {
    /*
      A fixture magra tem uma verba fixa, uma variável e uma de outros custos, e
      nenhuma verba complementar no frete. O de-para roda assim mesmo: o que tem
      fonte aparece, o que não tem diz por quê — que é a regra do pacote inteiro.
    */
    const magro = conferirDePara(lerPagamento(fixturePagamento()));
    const fixo = magro.quadros.find((q) => q.quadro === "REMUNERACAO");
    expect(fixo?.total).toBe(1600);
    /*
      O resíduo de R$ 250,00 são dois descontos que o conjunto não tem de onde
      somar de volta: R$ 200,00 que o relatório declara ter subtraído da VBZ 02
      num arquivo que não traz VBZ 02 nenhuma, e R$ 50,00 de frete mínimo, cujo
      rótulo não nomeia verba nenhuma. Os dois são abatidos pelas linhas da
      planilha e nenhum é somado de volta: a diferença fica no resíduo, que é
      onde ela pode ser vista.
    */
    expect(fixo?.residuo).toBe(250);
    /*
      A fixture magra não traz verba complementar no frete, e o quadro do
      variável fica com uma verba só. O painel continua inteiro — vinte linhas
      —, e o que muda é o estado de cada uma.
    */
    expect(magro.quadros.flatMap((q) => q.linhas)).toHaveLength(20);

    for (const q of magro.quadros) {
      for (const l of q.linhas) {
        if (l.estado !== "SEM_LASTRO" || l.papel === "TOTAL") continue;
        expect(l.ausencia?.motivo, l.rotulo).toBeTruthy();
        expect(l.ausencia?.destrava, l.rotulo).toBeTruthy();
      }
    }
  });

  it("não inventa quadro para o canal que o arquivo não trouxe", () => {
    const soAs = conferirDePara(lerPagamento(fixturePagamentoDoPainel()), { canal: "AS" });
    expect(soAs.quadros.every((q) => q.total === null)).toBe(true);
    expect(soAs.quadros.every((q) => q.residuo === null)).toBe(true);
    expect(soAs.totalDoRelatorio).toBeNull();
    expect(soAs.totalDosQuadros).toBeNull();
    expect(soAs.diferenca).toBeNull();
  });
});
