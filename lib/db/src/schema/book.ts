import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { bookEntryKind } from "./enums";

/**
 * BOOK DO OPERADOR — o que diz a regra, escrito ou anexado.
 *
 * O export do Freightec traz o cadastro remunerado da frota e nenhuma regra
 * (docs/ARQUITETURA.md §2). O Book do Operador é o outro lado, e esta tabela é
 * onde ele entra: uma entrada por bloco, de um de dois tipos.
 *
 * **Dois tipos, uma tabela, uma linha do tempo.** `DOCUMENTO` é o arquivo — o
 * contrato assinado, o manual em PDF, a planilha de apoio. `TEXTO` é a regra
 * escrita direto no sistema, que é o que serve quando ela cabe em três
 * parágrafos e não existe arquivo nenhum para anexar. Os dois compartilham a
 * mesma numeração de revisão por bloco, de propósito: a história real de um
 * bloco costuma alternar entre eles — alguém escreve a regra enquanto o
 * contrato não chega, e depois anexa o contrato —, e duas linhas do tempo
 * separadas obrigariam quem lê a reconstruir a ordem de cabeça.
 *
 * **Por que os bytes moram no Postgres, e não em disco.** `source_file` guarda
 * um `storage_path` e o arquivo fica no disco — o que serve lá, porque depois
 * da captura a evidência real está em `raw_cell`, célula por célula, e o
 * arquivo pode sumir sem levar nada junto. Aqui é o contrário: a entrada *é* o
 * conteúdo, não há cópia derivada dela em lugar nenhum, e o disco desta
 * plataforma é efêmero — um deploy novo apagaria o único exemplar. No banco,
 * ela entra no mesmo backup de todo o resto.
 *
 * **Nada é apagado, nada é sobrescrito.** Enviar de novo cria a revisão
 * seguinte; a anterior continua aqui, legível e baixável. É a mesma regra que
 * vale para RAW e para a curadoria — "nunca descarte silenciosamente" vale
 * também para o que nós mesmos substituímos. Quem auditar uma remuneração de
 * seis meses atrás precisa da regra que valia naquele dia.
 */

/**
 * `bytea`, que o drizzle não traz pronto.
 *
 * O tipo do lado do TypeScript é `Buffer` porque é o que o `pg` entrega e o
 * que a rota de download precisa devolver; converter para outra coisa no meio
 * do caminho só criaria uma chance de corromper o arquivo.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const bookEntryTable = pgTable(
  "book_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * O bloco a que esta entrada pertence: `"Categoria::Título"`, montado por
     * `chaveDoBloco` na interface.
     *
     * É texto e não uma chave estrangeira porque os blocos são transcrição da
     * tela do Freightech e vivem num arquivo da interface, não numa tabela.
     * Transformá-los em linhas obrigaria uma migration toda vez que o
     * Freightech renomeasse um bloco — e ainda deixaria as entradas órfãs
     * quando isso acontecesse. Assim, o pior caso de um rename é uma entrada
     * que continua guardada, com a categoria e o título que tinha no dia do
     * envio gravados ao lado, esperando ser reapontada.
     */
    blockKey: text("block_key").notNull(),
    /** A categoria do bloco no dia do envio. Preservada mesmo se lá mudar. */
    blockCategory: text("block_category").notNull(),
    /** O título do bloco no dia do envio. Idem. */
    blockTitle: text("block_title").notNull(),
    /** DOCUMENTO (arquivo anexado) ou TEXTO (regra escrita no sistema). */
    kind: bookEntryKind("kind").notNull(),
    /**
     * 1 para a primeira entrada do bloco, e sobe a cada substituição.
     *
     * O maior número é a entrada vigente. Não existe coluna "é a atual":
     * seriam duas verdades sobre o mesmo fato, e a segunda é a que sai de
     * sincronia.
     */
    revision: integer("revision").notNull(),

    /*
      Daqui para baixo, o que só um dos tipos preenche.

      As colunas são anuláveis porque nenhum dos dois tipos usa as do outro, e
      a alternativa — duas tabelas — custaria a linha do tempo única que é a
      razão de os dois morarem juntos. Qual coluna vale em qual tipo está
      garantido por CHECK no banco, na migration `0008_book_entries`, e não
      apenas pela boa vontade de quem escreve INSERT.
    */

    /** DOCUMENTO: o nome do arquivo como veio, sem caminho. */
    filename: text("filename"),
    /** DOCUMENTO: o arquivo. */
    content: bytea("content"),
    /** TEXTO: a regra, em markdown, como foi escrita. */
    bodyText: text("body_text"),

    /**
     * O tipo do conteúdo — `application/pdf` para um anexo, `text/markdown`
     * para o texto.
     *
     * Vale para os dois porque a pergunta "o que é isto" tem resposta nos dois
     * casos, e tê-la numa coluna só evita que a rota de download precise saber
     * de qual tipo ela veio para montar o cabeçalho.
     */
    mimeType: text("mime_type").notNull(),
    /**
     * O tamanho em bytes: do arquivo, ou do texto codificado em UTF-8.
     *
     * A unidade é a mesma nos dois casos de propósito — "12 KB" quer dizer a
     * mesma coisa na tela, e uma contagem de caracteres ao lado de uma
     * contagem de bytes seria comparada como se fossem a mesma medida.
     */
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /**
     * SHA-256 dos bytes exatos — do arquivo, ou do texto em UTF-8.
     *
     * É o que diz se um reenvio é mesmo uma mudança. Sem ele, salvar duas
     * vezes sem editar nada criaria uma revisão idêntica, e o histórico
     * passaria a sugerir que a regra mudou num dia em que ela não mudou.
     */
    contentSha256: text("content_sha256").notNull(),

    /** O que quem enviou quis registrar sobre esta versão. Opcional. */
    note: text("note"),
    /** Quem enviou. Nunca nulo — entrada sem autor não é auditável. */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /*
      Duas revisões com o mesmo número no mesmo bloco seriam duas respostas para
      "qual é a entrada vigente". O índice único é o que impede dois envios
      simultâneos de produzirem isso: o segundo falha e é reenviado, em vez de
      os dois entrarem e um sumir da tela.
    */
    uniqueIndex("book_entry_block_revision_uq").on(t.blockKey, t.revision),
    index("book_entry_block_idx").on(t.blockKey),
    index("book_entry_created_idx").on(t.createdAt),
  ],
);
