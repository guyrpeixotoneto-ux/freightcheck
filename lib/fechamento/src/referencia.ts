import * as XLSX from "xlsx";

/**
 * A PLANILHA COMO RÉGUA — o `RESUMO GERAL` lido para se conferir contra ele.
 *
 * Este módulo não calcula nada e não é insumo de nada. Ele abre a
 * `Fechamento_Remuneracao.xlsb` que a operação mantém, lê os números que o
 * `RESUMO GERAL` imprime e devolve cada um com o endereço da célula de onde
 * saiu. É o terceiro lado da comparação da tela: o **devido** sai do contrato,
 * o **demonstrado** sai do 03.08.20, e a **planilha** sai daqui.
 *
 * **Por que ele não reaproveita `extrairFechamento`.** Aquele extrator serve ao
 * arnês de prova, que roda o motor sobre os insumos *da própria planilha* — e
 * por isso precisa das 1.907 viagens, dos parâmetros e das bases. Aqui a
 * pergunta é outra: o que a planilha **publica**. Catorze números por quinzena,
 * e nada mais. Ler o arquivo inteiro para pegar catorze células custaria
 * segundos e traria para dentro desta porta uma superfície de falha que ela não
 * precisa ter.
 *
 * E há uma diferença de contrato que é a razão forte: `extrairFechamento` usa
 * um `numero()` que devolve **0** para célula ausente. Isso é aceitável lá,
 * onde a amostra é extraída uma vez por quem está conferindo com o Excel
 * aberto ao lado. É inaceitável aqui: um zero suposto viraria uma linha
 * "BATE" contra um devido que também é zero, ou uma diferença inventada contra
 * um que não é. Esta porta é **fail-closed** — ver {@link CelulaRecusada}.
 *
 * ---------------------------------------------------------------------------
 * A ausência de identidade, e o que se faz no lugar de fingi-la
 * ---------------------------------------------------------------------------
 *
 * O `.xlsb` **não declara** a que unidade, CNPJ ou mês pertence, em nada que se
 * leia dele: a aba `Cadastro` traz só números, e as abas de dia trazem viagens.
 * Este leitor, portanto, não valida nem poderia validar que o arquivo é do mês
 * a que alguém o anexou.
 *
 * O que ele faz no lugar é recusar o que não é uma planilha deste formato — aba
 * faltando, célula vazia, célula com erro do Excel, célula com texto onde tem de
 * haver número. Uma pasta de outro assunto não atravessa. Uma pasta do mesmo
 * formato e de outro mês atravessa, e é por isso que a associação fica
 * **declarada e auditável** (`sha256`, arquivo, quem, quando) em vez de
 * adivinhada. Um "confere se a frota bate" seria pior que nada: divergência de
 * cadastro é justamente o que se está conferindo, e não pode ser o critério que
 * valida o arquivo.
 */

/** A aba de onde saem os números publicados. */
export const ABA_DO_RESUMO = "Resumo Geral";

/**
 * A coluna em que o `RESUMO GERAL` empilha cada quinzena.
 *
 * **É daqui que sai a decisão de a referência ser mensal.** Um arquivo carrega
 * as duas quinzenas, lado a lado. Guardá-lo por competência obrigaria a subir o
 * mesmo `.xlsb` duas vezes e criaria duas verdades para o mesmo arquivo.
 */
export const COLUNA_DA_QUINZENA = { 1: "AI", 2: "AJ" } as const;

/**
 * A linha de cada número, por chave do motor.
 *
 * **A chave é a do motor, não o rótulo da planilha.** É o que permite pôr a
 * coluna da planilha ao lado do devido sem casar por texto — casar por rótulo
 * quebraria no dia em que alguém corrigisse um acento numa das duas pontas.
 *
 * As dez primeiras e as quatro do meio são as linhas dos quadros; as quatro
 * `total_*` são os totais que a planilha imprime. Elas entram porque a tela
 * mostra o total de cada quadro, e um total conferido só na soma das partes
 * esconderia um erro de fórmula no próprio total — que é exatamente o defeito
 * que a `AJ133` tem e que a reconciliação encontrou.
 */
export const LINHA_NO_RESUMO: Record<string, number> = {
  rota_dvs: 7,
  custo_fixo_padronizado: 8,
  custo_fixo_inativos: 9,
  custo_vans_inativas: 10,
  indisponibilidade_fixo: 11,
  custo_fixo_especiais: 12,
  custo_fixo_vans: 13,
  desconto_devolucao_percentual: 14,
  desconto_disponibilidade: 15,
  desconto_complementar_negativo: 16,
  total_remuneracao_rota: 17,
  custo_variavel_frota_fixa: 21,
  custo_variavel_agregado: 22,
  indisponibilidade_variavel: 24,
  total_remuneracao_rota_variavel: 25,
  outros_custos: 29,
  total_outros_custos: 30,
  total_geral_unidade: 36,
};

/** Um número publicado pela planilha, com o endereço de onde ele saiu. */
export interface NumeroDaPlanilha {
  /** A chave do motor — `rota_dvs`, `custo_fixo_padronizado`, … */
  chave: string;
  quinzena: 1 | 2;
  /** `AI7`. O endereço, para quem for conferir no arquivo. */
  celula: string;
  valor: number;
}

/** O que a planilha publica, já lido e conferido. */
export interface ReferenciaDaPlanilha {
  numeros: NumeroDaPlanilha[];
}

/** A pasta não tem a aba do resumo — não é uma planilha deste formato. */
export class AbaDoResumoNaoEncontrada extends Error {
  constructor(readonly abasEncontradas: string[]) {
    super(
      `A planilha não tem a aba "${ABA_DO_RESUMO}". ` +
        `Abas encontradas: ${abasEncontradas.length > 0 ? abasEncontradas.join(", ") : "nenhuma"}.`,
    );
    this.name = "AbaDoResumoNaoEncontrada";
  }
}

/**
 * Uma célula não trouxe número — e o arquivo inteiro é recusado por causa dela.
 *
 * **Recusar o arquivo inteiro, e não pular a linha.** Uma referência com uma
 * linha faltando faria a tela mostrar traço numa linha e número nas outras, e
 * quem lesse não teria como distinguir "a planilha não publica esta linha" de
 * "esta célula está quebrada". As duas pedem coisas opostas de quem opera.
 *
 * **Zero é número e passa.** `INDISPONIBILIDADE` vale 0,00 nas duas quinzenas de
 * julho/2026 e `DESCONTO COMPLEMENTAR NEGATIVO` vale 0,00 na 1ª — são zeros que
 * a planilha afirma. O que não passa é a **ausência** e o **erro**: célula
 * vazia, `#REF!`, `#N/A`, `#VALUE!`, texto, booleano. Converter qualquer um
 * deles em 0 é precisamente o defeito que esta classe existe para impedir.
 */
export class CelulaRecusada extends Error {
  constructor(
    readonly chave: string,
    readonly quinzena: 1 | 2,
    readonly celula: string,
    readonly motivo: string,
  ) {
    super(
      `A célula ${celula} (${chave}, ${quinzena}ª quinzena) não trouxe número: ${motivo}. ` +
        `Confira a planilha e anexe de novo — nenhum valor foi suposto.`,
    );
    this.name = "CelulaRecusada";
  }
}

/**
 * O que há numa célula, decidido antes de virar número.
 *
 * Escrito como função à parte e não em linha porque a lista de casos **é** o
 * contrato desta porta: cada `return` aqui é uma forma de o arquivo estar
 * errado que alguém já viu, e acrescentar um caso é uma decisão que se lê no
 * diff.
 */
function motivoDaRecusa(celula: XLSX.CellObject | undefined): string | null {
  if (celula === undefined) return "a célula está vazia";
  if (celula.t === "e") return `a célula tem um erro do Excel (${celula.w ?? "#ERRO"})`;
  if (celula.t === "b") return "a célula tem um booleano";
  if (celula.t === "s") return `a célula tem texto (${JSON.stringify(String(celula.v ?? ""))})`;
  if (celula.t === "d") return "a célula tem uma data";
  if (celula.t === "z") return "a célula está em branco";
  if (celula.t !== "n") return `a célula tem um tipo inesperado (${String(celula.t)})`;
  if (typeof celula.v !== "number" || !Number.isFinite(celula.v)) {
    return "a célula tem um número que não é finito";
  }
  return null;
}

/**
 * Lê o `RESUMO GERAL` da planilha. Recusa em vez de supor. Ver {@link CelulaRecusada}.
 *
 * **Por que a leitura acontece no anexo e não na tela.** Esta função pode
 * lançar, e lançar tem de acontecer na frente de quem escolheu o arquivo e pode
 * trocá-lo — não na abertura do Resumo, semanas depois, para alguém que só
 * queria conferir. É por isso que os números vão para
 * `fechamento_referencia_linha` e a tela lê de lá: o que está na tabela já
 * passou por esta porta.
 */
export function lerReferenciaDaPlanilha(bytes: Buffer): ReferenciaDaPlanilha {
  const pasta = XLSX.read(bytes, { type: "buffer", sheets: [ABA_DO_RESUMO] });
  const aba = pasta.Sheets[ABA_DO_RESUMO];
  if (!aba) throw new AbaDoResumoNaoEncontrada(pasta.SheetNames ?? []);

  const numeros: NumeroDaPlanilha[] = [];
  for (const quinzena of [1, 2] as const) {
    const coluna = COLUNA_DA_QUINZENA[quinzena];
    for (const [chave, linha] of Object.entries(LINHA_NO_RESUMO)) {
      const endereco = `${coluna}${linha}`;
      const celula = aba[endereco] as XLSX.CellObject | undefined;
      const motivo = motivoDaRecusa(celula);
      if (motivo !== null) throw new CelulaRecusada(chave, quinzena, endereco, motivo);
      /*
        Arredondado a centavo na entrada, e não na comparação: a planilha guarda
        dez casas em células intermediárias, e comparar o que ela **publica**
        contra o que o motor **paga** tem de ser a centavo dos dois lados. O
        arredondamento aqui é o mesmo `Math.round` de `centavos`, escrito à mão
        para este módulo não depender do domínio do cálculo — ver a nota de
        contaminação no topo.
      */
      numeros.push({
        chave,
        quinzena,
        celula: endereco,
        valor: Math.round((celula!.v as number) * 100) / 100,
      });
    }
  }
  return { numeros };
}
