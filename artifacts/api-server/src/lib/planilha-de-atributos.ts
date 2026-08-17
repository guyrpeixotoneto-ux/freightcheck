import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import {
  COLUNAS_DO_MODELO,
  type LinhaDoModelo,
  type LinhaPreenchida,
} from "@workspace/curation";

/**
 * O modelo de atributos como arquivo do Excel — e a leitura dele de volta.
 *
 * A lógica de o que a planilha significa mora em `@workspace/curation`
 * (`planilha-de-atributos.ts`), e este arquivo é só a travessia para o formato:
 * escrever as abas, oferecer as listas, e ler as células que voltarem. A
 * divisão é a mesma da exportação de impacto — regra num pacote, `exceljs`
 * aqui.
 *
 * Três decisões do formato, e nenhuma delas é estética:
 *
 * **Uma aba por equipamento.** É o mesmo recorte das abas da Curadoria, e é
 * como o trabalho é feito: quem senta para descrever colunas senta para
 * descrever as de um equipamento. Numa aba só, com 121 linhas e uma coluna
 * "Equipamento", a primeira coisa que a pessoa faria seria filtrar.
 *
 * **Lista suspensa na categoria.** É o único campo que casa contra catálogo, e
 * texto livre nele vira célula recusada na volta — depois de a pessoa ter
 * preenchido cento e poucas linhas. A lista transforma um erro que só aparece
 * no fim num que não chega a acontecer.
 *
 * **A coluna `Atributo` sai travada.** Ela é metade da chave da volta (a outra
 * metade é a aba). A proteção é sem senha, de propósito: existe para impedir o
 * acidente — arrastar uma célula e deslocar a coluna inteira —, não para
 * impedir quem quiser mesmo editar.
 */

/** A aba escondida com os catálogos, de onde as listas suspensas leem. */
const ABA_DAS_LISTAS = "Listas";

const PREENCHIVEL = "FFFFF7E6";
const TRAVADA = "FFF2F4F7";
const CABECALHO = "FF1D3557";

export interface ModeloDeAtributos {
  linhas: LinhaDoModelo[];
  categorias: { code: string; caminho: string }[];
  /** Só para a aba de instruções: quem gerou e quando. */
  geradoPor: string;
  geradoEm: string;
}

function nomeDaAba(entityType: string): string {
  // O Excel recusa aba com mais de 31 caracteres e alguns símbolos. Nenhum tipo
  // de equipamento chega perto disso, mas o corte evita que um tipo estranho
  // vindo do nome de uma aba de planilha derrube a exportação inteira.
  const limpo = entityType.replace(/[\\/*?:[\]]/g, " ").trim();
  const legivel = limpo.charAt(0) + limpo.slice(1).toLowerCase();
  return legivel.slice(0, 31) || "Sem tipo";
}

export async function montarModeloDeAtributos(
  modelo: ModeloDeAtributos,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FreightCheck";

  instrucoes(workbook, modelo);

  const listas = workbook.addWorksheet(ABA_DAS_LISTAS);
  listas.state = "veryHidden";
  listas.getCell("A1").value = "Categorias";
  modelo.categorias.forEach((c, i) => {
    listas.getCell(`A${i + 2}`).value = c.caminho;
  });

  const porEquipamento = new Map<string, LinhaDoModelo[]>();
  for (const linha of modelo.linhas) {
    const atual = porEquipamento.get(linha.entityType) ?? [];
    atual.push(linha);
    porEquipamento.set(linha.entityType, atual);
  }

  for (const [entityType, linhas] of [...porEquipamento].sort(([a], [b]) =>
    a.localeCompare(b, "pt-BR"),
  )) {
    const aba = workbook.addWorksheet(nomeDaAba(entityType), {
      views: [{ state: "frozen", ySplit: 1, xSplit: 1 }],
    });

    aba.columns = COLUNAS_DO_MODELO.map((coluna) => ({
      header: coluna.rotulo,
      key: coluna.chave,
      width: coluna.largura,
    }));

    const cabecalho = aba.getRow(1);
    cabecalho.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cabecalho.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CABECALHO } };
    cabecalho.alignment = { vertical: "middle", wrapText: true };
    cabecalho.height = 28;
    COLUNAS_DO_MODELO.forEach((coluna, indice) => {
      // A ajuda de cada coluna vira comentário do cabeçalho: é onde alguém que
      // recebeu o arquivo por e-mail vai procurar o que a coluna quer.
      cabecalho.getCell(indice + 1).note = coluna.ajuda;
    });

    for (const linha of linhas) {
      const row = aba.addRow(linha);
      COLUNAS_DO_MODELO.forEach((coluna, indice) => {
        const celula = row.getCell(indice + 1);
        celula.alignment = { vertical: "top", wrapText: coluna.largura > 30 };
        celula.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: coluna.preenchivel ? PREENCHIVEL : TRAVADA },
        };
        celula.protection = { locked: !coluna.preenchivel };
      });
    }

    const ultima = aba.rowCount;
    const colunaDe = (chave: string) =>
      COLUNAS_DO_MODELO.findIndex((c) => c.chave === chave) + 1;
    const letra = (indice: number) => aba.getColumn(indice).letter;

    if (ultima > 1) {
      aba.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: ultima, column: COLUNAS_DO_MODELO.length },
      };

      /*
        A validação é `allowBlank` e **não** bloqueia o que for digitado por
        fora: `showErrorMessage` avisa, e a conferência do servidor é quem
        decide. Travar a célula faria a planilha recusar uma categoria que
        alguém acabou de cadastrar na tela — o arquivo é de ontem, o catálogo é
        de hoje.
      */
      for (let linha = 2; linha <= ultima; linha++) {
        aba.getCell(`${letra(colunaDe("categoria"))}${linha}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`=${ABA_DAS_LISTAS}!$A$2:$A$${modelo.categorias.length + 1}`],
          showErrorMessage: true,
          errorTitle: "Fora do catálogo",
          error:
            "Escolha um item da lista. Para usar uma categoria nova, cadastre-a na tela de Curadoria primeiro.",
        };
      }
    }

    // Sem senha: ver o comentário do topo. `selectLockedCells` continua ligado
    // para que dê para copiar o nome de uma coluna.
    await aba.protect("", {
      selectLockedCells: true,
      selectUnlockedCells: true,
      autoFilter: true,
      formatColumns: true,
    });
  }

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

/**
 * A aba que explica o que este arquivo é.
 *
 * Ela existe por causa do caminho que o arquivo faz: sai daqui, vai por e-mail,
 * volta três dias depois preenchido por alguém que nunca abriu a tela. As duas
 * frases que essa pessoa precisa ler são "célula em branco não apaga nada" e
 * "isto não confirma nada" — a segunda porque preencher a Categoria DRE
 * **parece** decidir onde o número entra na conta, e não decide: até alguém
 * confirmar na tela, a coluna continua fora de todo cálculo financeiro.
 */
function instrucoes(workbook: ExcelJS.Workbook, modelo: ModeloDeAtributos): void {
  const aba = workbook.addWorksheet("Instruções");
  aba.getColumn(1).width = 110;

  const titulo = aba.addRow(["Curadoria de atributos — planilha de preenchimento"]);
  titulo.font = { bold: true, size: 14 };
  aba.addRow([]);

  const paragrafos = [
    `Gerado por ${modelo.geradoPor} em ${modelo.geradoEm}.`,
    "",
    "Uma aba por equipamento. Cada linha é uma coluna importada do Freightec, e as células em amarelo são as que você preenche.",
    "",
    "1. Célula em branco não apaga nada. O que você deixar vazio fica como está no sistema — só o que for escrito é gravado. Para limpar um campo, use a tela de Curadoria.",
    "2. Não edite a coluna Atributo, e não mude a linha de aba: é o par aba + atributo que devolve o preenchimento ao lugar certo. O mesmo nome de coluna pode existir em dois equipamentos — são atributos separados, com valores próprios.",
    "3. Isto não confirma nada. Nem mesmo a Categoria DRE: ela entra como proposta, aparece pronta na tela, e o atributo continua fora dos cálculos financeiros até alguém confirmar com justificativa assinada.",
    "4. Categoria DRE tem lista suspensa. Se faltar um item, cadastre-o na tela de Curadoria antes de reenviar. Escrever só a classe (\"Cadastral\", \"Custo Fixo\") não classifica: a prévia devolve as opções daquele galho.",
    "5. Só aparece aqui o que virou atributo na importação. Colunas de chave — vigência e placa — identificam a linha em vez de medir algo, e por isso não têm o que descrever.",
    "",
    "Para aplicar: Curadoria › Planilha de atributos › Enviar preenchida. O sistema mostra o que vai mudar antes de gravar.",
  ];
  for (const texto of paragrafos) {
    const linha = aba.addRow([texto]);
    linha.alignment = { wrapText: true, vertical: "top" };
  }
}

// ---------------------------------------------------------------------------
// A volta
// ---------------------------------------------------------------------------

export type LeituraDoModelo =
  | { ok: true; linhas: LinhaPreenchida[] }
  | { ok: false; erro: string };

/** O rótulo de uma coluna, reduzido ao que o casamento precisa. */
function dobrar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ler a planilha preenchida.
 *
 * Pelo `xlsx` (SheetJS), e não pelo `exceljs` que escreveu: é o leitor que o
 * resto do produto usa para receber planilha, e ele engole os arquivos que o
 * Google Sheets e o LibreOffice produzem quando alguém abre o modelo lá e
 * salva de volta.
 *
 * O casamento das colunas é pelo **rótulo do cabeçalho**, e não pela posição:
 * uma planilha que passou por três pessoas tem coluna escondida, movida e
 * duplicada, e ler a quarta célula da linha seria ler o que calhar de estar lá.
 * Aba sem a coluna "Atributo" é ignorada em silêncio — é a aba de instruções, e
 * reclamar dela seria reclamar do arquivo certo.
 */
export function lerModeloDeAtributos(bytes: Buffer): LeituraDoModelo {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "buffer" });
  } catch {
    return {
      ok: false,
      erro:
        "Não consegui abrir este arquivo como planilha do Excel. Reenvie o modelo baixado daqui, em .xlsx.",
    };
  }

  const rotulos = new Map(
    COLUNAS_DO_MODELO.map((coluna) => [dobrar(coluna.rotulo), coluna.chave]),
  );

  const linhas: LinhaPreenchida[] = [];
  let achouAlgumaAba = false;

  for (const nome of workbook.SheetNames) {
    const sheet = workbook.Sheets[nome];
    if (!sheet) continue;
    const grade = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      raw: false,
      defval: "",
    });
    if (grade.length < 2) continue;

    const cabecalho = (grade[0] ?? []).map((celula) => dobrar(String(celula ?? "")));
    const posicao = new Map<string, number>();
    cabecalho.forEach((rotulo, indice) => {
      const chave = rotulos.get(rotulo);
      if (chave && !posicao.has(chave)) posicao.set(chave, indice);
    });
    if (!posicao.has("atributo")) continue;
    achouAlgumaAba = true;

    for (let i = 1; i < grade.length; i++) {
      const celulas = grade[i] ?? [];
      const ler = (chave: string): string | undefined => {
        const indice = posicao.get(chave);
        if (indice === undefined) return undefined;
        const valor = celulas[indice];
        return valor === undefined || valor === null ? undefined : String(valor);
      };

      const atributo = (ler("atributo") ?? "").trim();
      const preenchidos = ["displayName", "definition", "categoria"]
        .map(ler)
        .filter((v) => (v ?? "").trim() !== "");
      // Linha sem atributo e sem preenchimento nenhum é a linha em branco que
      // todo arquivo tem no fim. Sem atributo mas com texto é erro de quem
      // preencheu, e a conferência precisa vê-la para poder dizer isso.
      if (atributo === "" && preenchidos.length === 0) continue;

      linhas.push({
        aba: nome,
        // +1 porque o Excel conta a partir de 1 e a primeira linha é o cabeçalho.
        linha: i + 1,
        atributo,
        displayName: ler("displayName"),
        definition: ler("definition"),
        categoria: ler("categoria"),
      });
    }
  }

  if (!achouAlgumaAba) {
    return {
      ok: false,
      erro:
        'Nenhuma aba deste arquivo tem a coluna "Atributo". Reenvie o modelo baixado em Curadoria › Planilha de atributos, mantendo a linha de cabeçalho.',
    };
  }

  return { ok: true, linhas };
}
