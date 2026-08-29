import { and, eq, inArray, isNull, sql, type AnyColumn } from "drizzle-orm";
import {
  appUserTable,
  canonizarNome,
  cargoTable,
  departamentoTable,
  fluxoEtapaItemTable,
  fluxoEtapaTable,
  type Database,
} from "@workspace/db";
import { RecusaDeFluxo } from "./validacao";

/**
 * A ARRUMAÇÃO DOS RESPONSÁVEIS QUE AINDA SÃO TEXTO.
 *
 * ---------------------------------------------------------------------------
 * O que ficou de fora da `0079`, e por quê
 * ---------------------------------------------------------------------------
 *
 * A `0079` deu ao responsável um vínculo com o cadastro da casa e deixou o
 * texto que já estava gravado exatamente onde estava — **sem backfill**, e por
 * uma razão que continua valendo: a canonização que decide se duas grafias são
 * a mesma coisa não expande abreviação (ver `canonizarNome`, em
 * `lib/db/src/cadastro.ts`), então `Fat.` não é automaticamente `Faturamento`.
 * Um `UPDATE` que adivinhasse isso teria escrito no banco um palpite que
 * ninguém reviu.
 *
 * O que faltava não era o palpite: era **a tela onde uma pessoa toma essa
 * decisão uma vez e ela vale para as trinta etapas que dizem a mesma coisa**.
 * Sem ela, arrumar um processo levantado ao longo de um ano é abrir etapa por
 * etapa — o custo que faz ninguém arrumar, e que faz o cadastro nunca ganhar.
 *
 * ---------------------------------------------------------------------------
 * As três decisões deste módulo
 * ---------------------------------------------------------------------------
 *
 * **A canonização mora num lugar só, e é TypeScript.** Nenhuma consulta aqui
 * canoniza em SQL. Agrupar por `lower(unaccent(...))` no banco seria uma segunda
 * implementação de `canonizarNome`, que concorda com a primeira no dia em que é
 * escrita e discorda no primeiro caractere que uma trate e a outra não — e a
 * divergência apareceria como duas linhas iguais na tela de arrumação, que é
 * justamente o defeito que se está arrumando. Por isso a leitura traz os textos
 * e agrupa em memória, e a escrita **resolve os `id`s em memória** antes de
 * mandar o `UPDATE`.
 *
 * **A sugestão é casamento exato, ou nenhuma.** `Faturamento` casa com o
 * departamento `FATURAMENTO`; `Fat.` não casa com nada e aparece sem sugestão,
 * para alguém escolher. Quando o mesmo texto casa com mais de um cadastro — um
 * cargo e um departamento com o mesmo nome —, a sugestão também é nenhuma: duas
 * respostas certas é uma pergunta para gente, não um empate a ser desfeito por
 * ordem de precedência escondida no código.
 *
 * **Aplicar nunca sobrescreve vínculo.** O `UPDATE` só alcança linha que ainda
 * está sem vínculo nenhum. É o que torna a operação repetível sem susto — rodar
 * duas vezes não desfaz o que alguém escolheu à mão no meio — e é o que impede
 * que uma tela de arrumação vire uma tela de sobrescrita em massa.
 *
 * O texto **não** é apagado. Ele continua sendo o que vale se o vínculo um dia
 * deixar de resolver, e continua sendo o que a leitura projeta por cima (ver
 * `projetarEtapa`, no repositório). Arrumar é acrescentar identidade, não
 * remover história.
 */

/**
 * Onde o texto está — e é isto que decide o que se pode escolher para ele.
 *
 * `AREA` e `RESPONSAVEL` são as duas colunas de `fluxo_etapa`; `ITEM` é cada
 * linha da lista de responsáveis da etapa. São escopos separados porque a
 * pergunta é outra em cada um: a área de uma etapa é um departamento, e o
 * responsável dela é uma função ou uma pessoa.
 */
export type EscopoDoTexto = "AREA" | "RESPONSAVEL" | "ITEM";

export type TipoDeVinculo = "DEPARTAMENTO" | "CARGO" | "PESSOA";

export interface SugestaoDeVinculo {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
}

/** Um texto que ainda não virou cadastro, com o tamanho do que ele responde. */
export interface ResponsavelEmTexto {
  escopo: EscopoDoTexto;
  /** A identidade do agrupamento — `canonizarNome` do que está gravado. */
  textoCanonico: string;
  /**
   * As grafias encontradas, como foram digitadas, em ordem alfabética.
   *
   * São elas que provam o problema para quem está na tela: ver
   * `["FATURAMENTO", "Faturamento"]` numa linha só é ver as duas raias que o
   * fluxograma desenhava.
   */
  grafias: string[];
  /** Quantas linhas dizem isto — o tamanho do estrago, e do conserto. */
  ocorrencias: number;
  /** O casamento exato com o cadastro, quando existe **um**. */
  sugestao: SugestaoDeVinculo | null;
}

/** O que vai ser escolhido para um texto. Exatamente um dos três. */
export interface EscolhaDaArrumacao {
  escopo: EscopoDoTexto;
  textoCanonico: string;
  departamentoId?: string | null;
  cargoId?: string | null;
  pessoaId?: string | null;
}

/**
 * O que cada escopo aceita.
 *
 * A área de uma etapa é o departamento, e só ele: oferecer um cargo ali faria
 * a raia do fluxograma passar a agrupar por função, que é outra leitura. O
 * responsável da etapa é a função ou a pessoa — nunca o departamento, que já
 * tem o seu próprio campo ao lado e apareceria duas vezes no cartão. O item da
 * lista aceita os três, porque é lá que uma etapa com duas áreas envolvidas diz
 * que são duas.
 */
const ACEITOS: Record<EscopoDoTexto, TipoDeVinculo[]> = {
  AREA: ["DEPARTAMENTO"],
  RESPONSAVEL: ["CARGO", "PESSOA"],
  ITEM: ["DEPARTAMENTO", "CARGO", "PESSOA"],
};

interface LinhaDeTexto {
  id: string;
  texto: string | null;
}

/** Um cadastro, do jeito que esta arrumação precisa dele. */
interface CadastroCanonico {
  tipo: TipoDeVinculo;
  id: string;
  nome: string;
  canonico: string;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * As três consultas do que ainda é texto — sem vínculo, e com texto não vazio.
 *
 * **Fluxo arquivado entra.** A tentação é filtrá-lo, porque é processo que a
 * empresa desligou; mas arrumação é sobre identidade, não sobre operação, e um
 * arquivado que voltar traria a grafia velha de volta com ele — para uma tela
 * que já teria dito que não havia mais nada a arrumar.
 */
async function textosSemVinculo(
  db: Database,
  empresaId: string,
): Promise<Record<EscopoDoTexto, LinhaDeTexto[]>> {
  /* Texto em branco não é responsável a arrumar — é etapa que não disse nada. */
  const naoVazio = (coluna: AnyColumn) =>
    sql`length(btrim(coalesce(${coluna}, ''))) > 0`;

  const [areas, responsaveis, itens] = await Promise.all([
    db
      .select({ id: fluxoEtapaTable.id, texto: fluxoEtapaTable.area })
      .from(fluxoEtapaTable)
      .where(
        and(
          eq(fluxoEtapaTable.empresaId, empresaId),
          isNull(fluxoEtapaTable.departamentoId),
          naoVazio(fluxoEtapaTable.area),
        ),
      ),
    db
      .select({ id: fluxoEtapaTable.id, texto: fluxoEtapaTable.responsavel })
      .from(fluxoEtapaTable)
      .where(
        and(
          eq(fluxoEtapaTable.empresaId, empresaId),
          isNull(fluxoEtapaTable.cargoId),
          isNull(fluxoEtapaTable.pessoaId),
          naoVazio(fluxoEtapaTable.responsavel),
        ),
      ),
    db
      .select({ id: fluxoEtapaItemTable.id, texto: fluxoEtapaItemTable.nome })
      .from(fluxoEtapaItemTable)
      .where(
        and(
          eq(fluxoEtapaItemTable.empresaId, empresaId),
          eq(fluxoEtapaItemTable.especie, "RESPONSAVEL"),
          isNull(fluxoEtapaItemTable.departamentoId),
          isNull(fluxoEtapaItemTable.cargoId),
          isNull(fluxoEtapaItemTable.pessoaId),
        ),
      ),
  ]);

  return { AREA: areas, RESPONSAVEL: responsaveis, ITEM: itens };
}

/** O cadastro inteiro, canonizado uma vez — é contra ele que a sugestão casa. */
async function cadastroCanonico(db: Database): Promise<CadastroCanonico[]> {
  const [departamentos, cargos, pessoas] = await Promise.all([
    db.select({ id: departamentoTable.id, nome: departamentoTable.nome }).from(departamentoTable),
    db.select({ id: cargoTable.id, nome: cargoTable.nome }).from(cargoTable),
    /*
      Conta arquivada fica de fora da sugestão pela mesma razão que fica de fora
      do seletor: arquivar diz "esta pessoa não está mais na lista de quem
      trabalha aqui", e sugeri-la como responsável de um processo vivo desfaria
      esse gesto — ainda por cima em lote, que é o pior lugar para desfazê-lo.
    */
    db
      .select({ id: appUserTable.id, nome: appUserTable.name })
      .from(appUserTable)
      .where(isNull(appUserTable.archivedAt)),
  ]);

  const como = (tipo: TipoDeVinculo, linhas: { id: string; nome: string }[]) =>
    linhas.map((l) => ({ tipo, id: l.id, nome: l.nome, canonico: canonizarNome(l.nome) }));

  return [
    ...como("DEPARTAMENTO", departamentos),
    ...como("CARGO", cargos),
    ...como("PESSOA", pessoas),
  ];
}

/**
 * O casamento exato — ou nenhum, quando não há um só.
 *
 * Zero casamentos é o caso de `Fat.`, e a resposta certa é não sugerir nada:
 * expandir abreviação é o palpite que este produto recusa em todo lugar. Mais
 * de um casamento é um departamento e um cargo com o mesmo nome, e a resposta
 * certa também é não sugerir: escolher por precedência escondida faria a tela
 * afirmar, sem dizer, algo que ela não sabe.
 */
function sugerir(
  escopo: EscopoDoTexto,
  textoCanonico: string,
  cadastro: CadastroCanonico[],
): SugestaoDeVinculo | null {
  const aceitos = ACEITOS[escopo];
  const casam = cadastro.filter(
    (c) => c.canonico === textoCanonico && aceitos.includes(c.tipo),
  );
  if (casam.length !== 1) return null;
  const [unico] = casam;
  return { tipo: unico.tipo, id: unico.id, nome: unico.nome };
}

/**
 * Tudo o que ainda é texto nesta empresa, agrupado pela identidade do nome.
 *
 * A ordem é a do tamanho: o que aparece em mais etapas primeiro, porque é a
 * decisão que arruma mais de uma vez. Empate desempata por texto, para a lista
 * não dançar entre duas leituras.
 */
export async function listarResponsaveisEmTexto(
  db: Database,
  empresaId: string,
): Promise<ResponsavelEmTexto[]> {
  const [porEscopo, cadastro] = await Promise.all([
    textosSemVinculo(db, empresaId),
    cadastroCanonico(db),
  ]);

  const achados: ResponsavelEmTexto[] = [];

  for (const escopo of ["AREA", "RESPONSAVEL", "ITEM"] as const) {
    const grupos = new Map<string, { grafias: Set<string>; ocorrencias: number }>();
    for (const linha of porEscopo[escopo]) {
      const texto = (linha.texto ?? "").trim();
      const canonico = canonizarNome(texto);
      if (canonico === "") continue;
      const grupo = grupos.get(canonico) ?? { grafias: new Set<string>(), ocorrencias: 0 };
      grupo.grafias.add(texto);
      grupo.ocorrencias += 1;
      grupos.set(canonico, grupo);
    }
    for (const [textoCanonico, grupo] of grupos) {
      achados.push({
        escopo,
        textoCanonico,
        grafias: [...grupo.grafias].sort((a, b) => a.localeCompare(b, "pt-BR")),
        ocorrencias: grupo.ocorrencias,
        sugestao: sugerir(escopo, textoCanonico, cadastro),
      });
    }
  }

  return achados.sort(
    (a, b) =>
      b.ocorrencias - a.ocorrencias ||
      a.textoCanonico.localeCompare(b.textoCanonico, "pt-BR") ||
      a.escopo.localeCompare(b.escopo),
  );
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** O vínculo escolhido, conferido: exatamente um, e permitido neste escopo. */
function lerEscolha(escolha: EscolhaDaArrumacao): { tipo: TipoDeVinculo; id: string } {
  const informados = (
    [
      ["DEPARTAMENTO", escolha.departamentoId],
      ["CARGO", escolha.cargoId],
      ["PESSOA", escolha.pessoaId],
    ] as const
  ).filter(([, id]) => typeof id === "string" && id !== "");

  if (informados.length === 0) {
    throw new RecusaDeFluxo(
      "ARRUMACAO_SEM_ESCOLHA",
      "Escolha um departamento, um cargo ou uma pessoa para este texto.",
    );
  }
  if (informados.length > 1) {
    throw new RecusaDeFluxo(
      "ARRUMACAO_AMBIGUA",
      "Escolha um só: departamento, cargo ou pessoa. Dois vínculos para o mesmo texto seriam duas respostas para a mesma pergunta.",
    );
  }

  const [[tipo, id]] = informados;
  if (!ACEITOS[escolha.escopo].includes(tipo)) {
    throw new RecusaDeFluxo(
      "ARRUMACAO_ESCOPO_INVALIDO",
      escolha.escopo === "AREA"
        ? "A área de uma etapa é um departamento — cargo e pessoa entram no responsável."
        : "O responsável de uma etapa é um cargo ou uma pessoa — o departamento é a área, ao lado.",
    );
  }
  return { tipo, id: id as string };
}

/** O cadastro escolhido existe? A recusa vem com frase, e não do driver. */
async function exigirCadastro(
  db: Database,
  tipo: TipoDeVinculo,
  id: string,
): Promise<CadastroCanonico> {
  const achado = (await cadastroCanonico(db)).find((c) => c.tipo === tipo && c.id === id);
  if (!achado) {
    throw new RecusaDeFluxo(
      "VINCULO_DESCONHECIDO",
      "O cadastro escolhido não está mais disponível. Recarregue a tela e escolha de novo.",
    );
  }
  return achado;
}

/**
 * Liga um texto ao cadastro em todas as linhas que o dizem — de uma vez.
 *
 * Os `id`s são resolvidos aqui, em memória, e não num `where` que canonize em
 * SQL: é a mesma decisão explicada no topo do arquivo, e é ela que garante que
 * o agrupamento que a pessoa viu na tela é exatamente o conjunto que vai ser
 * alterado.
 *
 * O `where` do `UPDATE` repete a condição de "ainda sem vínculo" mesmo já tendo
 * filtrado por ela na leitura. Não é redundância inútil: entre uma coisa e a
 * outra alguém pode ter escolhido o vínculo daquela etapa à mão, e a arrumação
 * em lote não pode passar por cima de uma escolha individual mais recente.
 *
 * Devolve quantas linhas foram alteradas — que é o que a tela mostra, e o que
 * torna "não mudou nada" uma resposta visível em vez de um silêncio.
 */
export async function aplicarArrumacao(
  db: Database,
  empresaId: string,
  bruta: unknown,
): Promise<{ alteradas: number; nome: string }> {
  const escolha = validarEscolha(bruta);
  const { tipo, id } = lerEscolha(escolha);
  const cadastro = await exigirCadastro(db, tipo, id);

  const porEscopo = await textosSemVinculo(db, empresaId);
  const alvos = porEscopo[escolha.escopo]
    .filter((linha) => canonizarNome((linha.texto ?? "").trim()) === escolha.textoCanonico)
    .map((linha) => linha.id);

  if (alvos.length === 0) return { alteradas: 0, nome: cadastro.nome };

  const coluna =
    tipo === "DEPARTAMENTO" ? "departamentoId" : tipo === "CARGO" ? "cargoId" : "pessoaId";

  if (escolha.escopo === "ITEM") {
    const alteradas = await db
      .update(fluxoEtapaItemTable)
      .set({ [coluna]: id })
      .where(
        and(
          inArray(fluxoEtapaItemTable.id, alvos),
          eq(fluxoEtapaItemTable.empresaId, empresaId),
          isNull(fluxoEtapaItemTable.departamentoId),
          isNull(fluxoEtapaItemTable.cargoId),
          isNull(fluxoEtapaItemTable.pessoaId),
        ),
      )
      .returning({ id: fluxoEtapaItemTable.id });
    return { alteradas: alteradas.length, nome: cadastro.nome };
  }

  const aindaSemVinculo =
    escolha.escopo === "AREA"
      ? isNull(fluxoEtapaTable.departamentoId)
      : and(isNull(fluxoEtapaTable.cargoId), isNull(fluxoEtapaTable.pessoaId));

  const alteradas = await db
    .update(fluxoEtapaTable)
    .set({ [coluna]: id, atualizadoEm: new Date() })
    .where(
      and(
        inArray(fluxoEtapaTable.id, alvos),
        eq(fluxoEtapaTable.empresaId, empresaId),
        aindaSemVinculo,
      ),
    )
    .returning({ id: fluxoEtapaTable.id });

  return { alteradas: alteradas.length, nome: cadastro.nome };
}

/**
 * A porta de entrada — o corpo cru virando uma escolha, ou uma recusa com nome.
 *
 * O `textoCanonico` é canonizado de novo aqui, e não aceito como veio: o
 * cliente manda o que a leitura devolveu, mas quem decide o que é a identidade
 * de um nome é `canonizarNome` — e um cliente que mandasse `Faturamento ` com
 * um espaço a mais não deve alcançar zero linhas em silêncio.
 */
export function validarEscolha(bruta: unknown): EscolhaDaArrumacao {
  const corpo = (bruta ?? {}) as Record<string, unknown>;
  const escopo = corpo.escopo;
  if (escopo !== "AREA" && escopo !== "RESPONSAVEL" && escopo !== "ITEM") {
    throw new RecusaDeFluxo(
      "ARRUMACAO_ESCOPO_INVALIDO",
      `Escopo desconhecido: ${String(escopo)}.`,
    );
  }

  const texto = typeof corpo.textoCanonico === "string" ? corpo.textoCanonico : "";
  const textoCanonico = canonizarNome(texto);
  if (textoCanonico === "") {
    throw new RecusaDeFluxo(
      "ARRUMACAO_SEM_TEXTO",
      "Diga qual texto está sendo arrumado.",
    );
  }

  const id = (valor: unknown) => (typeof valor === "string" && valor !== "" ? valor : null);
  return {
    escopo,
    textoCanonico,
    departamentoId: id(corpo.departamentoId),
    cargoId: id(corpo.cargoId),
    pessoaId: id(corpo.pessoaId),
  };
}
