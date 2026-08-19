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

const quadro = (nome: "REMUNERACAO" | "VARIAVEL" | "OUTROS_CUSTOS"): QuadroConferido => {
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
  it("transcreve os dezoito rótulos da planilha, na ordem em que ela os empilha", () => {
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
      a planilha escreve a parcela antes do desconto (203.800,00) e mostra os
      3.800,00 numa linha à parte. As duas leituras batem quando o desconto é
      somado de volta — e só quando.
    */
    const conjunto = linha("custo_fixo_padronizado").conjunto;
    expect(conjunto?.valor).toBe(203800);
    expect(conjunto?.linhas).toEqual([
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "custo_fixo_especiais",
      "custo_fixo_vans",
    ]);
  });

  it("não deixa resíduo: bruto menos descontos é exatamente o total do relatório", () => {
    const q = quadro("REMUNERACAO");
    expect(q.somado).toBe(200000);
    expect(q.residuo).toBe(0);
  });

  it("nomeia as duas linhas que continuam sem origem, e só essas duas", () => {
    expect(quadro("REMUNERACAO").semLastro).toEqual([
      "INDISPONIBILIDADE",
      "DESCONTO COMPLEMENTAR NEGATIVO",
    ]);
  });

  it("não deixa verba do quadro fora do painel", () => {
    expect(quadro("REMUNERACAO").verbasSemLinha).toEqual([]);
  });

  it("dá as cinco linhas de tipo de frota como conjunto, nunca rateadas", () => {
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

  it("põe a alíquota da devolução na linha `%`, e não a soma com dinheiro", () => {
    const l = linha("desconto_devolucao_percentual");
    expect(l.estado).toBe("APURADO");
    expect(l.percentual).toBe(true);
    expect(l.valor).toBe(1.5);
  });
});

describe("o quadro do variável", () => {
  it("fecha contra as verbas variáveis e complementares do bloco FRETE", () => {
    expect(quadro("VARIAVEL").total).toBe(125000);
  });

  it("deixa de resíduo exatamente a verba que o painel da planilha não nomeia", () => {
    const q = quadro("VARIAVEL");
    expect(q.somado).toBe(120000);
    expect(q.residuo).toBe(5000);
    expect(q.verbasSemLinha).toEqual([
      { vbz: 6, nome: "Rem. Variável Equipe Entrega", valor: 5000 },
    ]);
  });

  it("acusa que a devolução foi abatida aqui e saiu de uma verba do outro quadro", () => {
    const l = linha("desconto_devolucao");
    expect(l.valor).toBe(4875);
    expect(l.origemForaDoQuadro).toEqual(["VBZ 01"]);
  });

  it("mantém a indisponibilidade sem lastro nos dois quadros, pelo mesmo motivo", () => {
    for (const chave of ["indisponibilidade_fixo", "indisponibilidade_variavel"]) {
      const l = linha(chave);
      expect(l.estado, chave).toBe("SEM_LASTRO");
      expect(l.ausencia?.motivo, chave).toContain("INDISPONIBILIDADE");
    }
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
    const entrou = linha("outros_custos_parcela").procedencia?.entrou ?? [];
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
    expect(fixo?.residuo).toBe(0);
    /*
      A fixture magra não traz verba complementar no frete, e o quadro do
      variável fica com uma verba só. O painel continua inteiro — dezoito linhas
      —, e o que muda é o estado de cada uma.
    */
    expect(magro.quadros.flatMap((q) => q.linhas)).toHaveLength(18);

    for (const q of magro.quadros) {
      for (const l of q.linhas) {
        if (l.estado !== "SEM_LASTRO" || l.papel === "TOTAL" || l.papel === "TITULO") continue;
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
