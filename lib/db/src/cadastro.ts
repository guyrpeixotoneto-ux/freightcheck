import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "./index";
import { cargoTable, departamentoTable, negocioTable } from "./schema/cadastro";
import { fluxoEtapaItemTable, fluxoEtapaTable } from "./schema/fluxo";

/**
 * O CADASTRO DA CASA — as regras de departamento, cargo e negócio.
 *
 * Ver `schema/cadastro.ts` para o porquê das três tabelas. Aqui ficam as
 * decisões que o banco não sabe tomar sozinho: o que conta como o mesmo nome,
 * o que se recusa e com que frase.
 *
 * **Uma função de canonização, e uma só.** É ela que decide se dois cadastros
 * são o mesmo, e é a mesma que a busca da tela usa para casar o que foi
 * digitado. Se um dia houver duas — uma no banco, outra na tela —, elas
 * divergem no primeiro caractere que uma trate e a outra não, e a divergência
 * aparece como um cargo duplicado que ninguém consegue explicar.
 *
 * **Recusa em vez de reaproveitar.** Cadastrar `analista adm` quando já existe
 * `Analista ADM` não devolve a linha existente em silêncio: devolve a recusa
 * com o nome da que já está lá. Reaproveitar faria a pessoa achar que criou o
 * cargo dela e sair da tela com outro — que é exatamente a confusão entre
 * grafias que estas tabelas existem para acabar.
 */

/* =========================================================================
 * A identidade de um nome
 * ====================================================================== */

/**
 * A forma canônica de um nome de cadastro: sem acento, sem caixa, sem espaço
 * dobrado.
 *
 * `  Analista   Administrativo ` e `ANALISTA ADMINISTRATIVO` viram o mesmo
 * `ANALISTA ADMINISTRATIVO`, e é por isso que o segundo não entra duas vezes.
 *
 * A decomposição `NFD` mais o corte dos diacríticos é o que faz `Logística` e
 * `Logistica` serem o mesmo cargo — e eles são, em toda planilha que este
 * produto já leu, onde o acento sobrevive ou não conforme quem digitou.
 *
 * O que ela **não** faz: não corrige plural, não expande abreviação e não
 * adivinha que `Aux.` é `Auxiliar`. Cada uma dessas seria uma inferência sobre
 * a intenção de quem digitou, e o produto inteiro recusa esse tipo de palpite;
 * quem tem duas grafias que a máquina não junta as junta à mão, vendo as duas.
 */
export function canonizarNome(bruto: string): string {
  return (bruto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/* =========================================================================
 * As recusas
 * ====================================================================== */

/** O que se cadastra aqui — o texto entra nas mensagens de recusa. */
export type TipoDeCadastro = "departamento" | "cargo" | "negocio";

const ARTIGO: Record<TipoDeCadastro, string> = {
  departamento: "O departamento",
  cargo: "O cargo",
  negocio: "O negócio",
};

/** Sem nome não há cadastro: o nome é a coisa toda que se está criando. */
export class CadastroSemNome extends Error {
  constructor(readonly tipo: TipoDeCadastro) {
    super(
      `${ARTIGO[tipo]} precisa de um nome — é ele que a lista mostra, é por ele ` +
        "que se procura, e é ele que diz se dois cadastros são o mesmo.",
    );
    this.name = "CadastroSemNome";
  }
}

/** Já existe um cadastro com este nome, ainda que escrito de outro jeito. */
export class NomeJaCadastrado extends Error {
  constructor(
    readonly tipo: TipoDeCadastro,
    readonly nomeExistente: string,
  ) {
    super(
      `Já existe um cadastro com este nome: "${nomeExistente}". Duas grafias do ` +
        "mesmo nome seriam dois cadastros para o motor, que é o que este cadastro " +
        "existe para não ter. Edite o que já está lá se a grafia precisa mudar.",
    );
    this.name = "NomeJaCadastrado";
  }
}

/** O `id` informado não corresponde a nada cadastrado. */
export class CadastroNaoEncontrado extends Error {
  constructor(
    readonly tipo: TipoDeCadastro,
    readonly id: string,
  ) {
    super(`Nenhum ${tipo} cadastrado com o id ${id}.`);
    this.name = "CadastroNaoEncontrado";
  }
}

/** O departamento-pai apontado não existe. */
export class DepartamentoPaiInexistente extends Error {
  constructor(readonly paiId: string) {
    super(
      `O departamento superior informado (${paiId}) não está cadastrado. ` +
        "Cadastre-o antes, ou deixe este departamento na raiz.",
    );
    this.name = "DepartamentoPaiInexistente";
  }
}

/**
 * A hierarquia se fecharia num círculo.
 *
 * `Controladoria` dentro de `Administrativo` dentro de `Controladoria` não é
 * uma estrutura difícil de desenhar: é uma estrutura que não responde à
 * pergunta "quem responde por este gasto", porque a resposta se persegue para
 * sempre. O banco não vê o caminho inteiro sem uma recursiva em trigger, e a
 * recusa precisa chegar à tela como frase — então ela mora aqui.
 */
export class HierarquiaCircular extends Error {
  constructor(readonly nome: string) {
    super(
      `Isto poria "${nome}" dentro de si mesmo, por um caminho ou por outro. ` +
        "Uma hierarquia circular não responde a quem responde pelo gasto — a " +
        "resposta se persegue sem fim.",
    );
    this.name = "HierarquiaCircular";
  }
}

/** O cargo aponta para um departamento que não existe. */
export class DepartamentoInexistente extends Error {
  constructor(readonly departamentoId: string) {
    super(
      `O departamento informado (${departamentoId}) não está cadastrado. ` +
        "Cadastre-o em Configurações → Departamento, ou deixe o cargo sem lotação.",
    );
    this.name = "DepartamentoInexistente";
  }
}

/**
 * Há cadastro pendurado neste — apagar deixaria referência morta.
 *
 * É a recusa que o `RESTRICT` do banco produziria, dita antes dele e com o que
 * está pendurado nomeado: "não dá" não diz o que fazer, "três cargos estão
 * lotados aqui" diz.
 */
export class CadastroEmUso extends Error {
  constructor(
    readonly tipo: TipoDeCadastro,
    readonly porQuem: string,
  ) {
    super(
      `Este ${tipo} não pode ser excluído: ${porQuem}. Mova o que está ` +
        "pendurado nele antes — apagar deixaria referência para uma linha que " +
        "não existe mais.",
    );
    this.name = "CadastroEmUso";
  }
}

/* =========================================================================
 * Departamento
 * ====================================================================== */

/** Um departamento, como as telas o recebem. */
export interface Departamento {
  id: string;
  nome: string;
  /** O departamento acima deste. `null` na raiz. */
  paiId: string | null;
  criadoEm: string;
  criadoPor: string | null;
}

function comoDepartamento(linha: {
  id: string;
  nome: string;
  paiId: string | null;
  criadoEm: Date;
  criadoPor: string | null;
}): Departamento {
  return { ...linha, criadoEm: linha.criadoEm.toISOString() };
}

const COLUNAS_DO_DEPARTAMENTO = {
  id: departamentoTable.id,
  nome: departamentoTable.nome,
  paiId: departamentoTable.paiId,
  criadoEm: departamentoTable.criadoEm,
  criadoPor: departamentoTable.criadoPor,
};

/** Os departamentos cadastrados, em ordem de nome. */
export async function listarDepartamentos(db: Database): Promise<Departamento[]> {
  const linhas = await db
    .select(COLUNAS_DO_DEPARTAMENTO)
    .from(departamentoTable)
    .orderBy(asc(departamentoTable.nome));
  return linhas.map(comoDepartamento);
}

/** O departamento de um `id`. `null` quando ele não existe. */
export async function departamentoPorId(
  db: Database,
  id: string,
): Promise<Departamento | null> {
  const [linha] = await db
    .select(COLUNAS_DO_DEPARTAMENTO)
    .from(departamentoTable)
    .where(eq(departamentoTable.id, id))
    .limit(1);
  return linha ? comoDepartamento(linha) : null;
}

/**
 * O caminho até a raiz a partir de um departamento, ele incluído.
 *
 * É o que a checagem de ciclo consulta e é o que a tela usa para mostrar
 * `Administrativo › Controladoria`. Percorre com um teto de saltos porque um
 * ciclo já gravado — por um `UPDATE` direto no banco, por exemplo — não pode
 * travar a aplicação num laço infinito enquanto alguém o desfaz.
 */
async function caminhoAteRaiz(db: Database, id: string): Promise<string[]> {
  const caminho: string[] = [];
  let atual: string | null = id;
  for (let salto = 0; atual !== null && salto < 64; salto += 1) {
    caminho.push(atual);
    const pai: Departamento | null = await departamentoPorId(db, atual);
    atual = pai?.paiId ?? null;
    if (atual !== null && caminho.includes(atual)) break;
  }
  return caminho;
}

async function departamentoPorNomeCanonico(
  db: Database,
  canonico: string,
): Promise<Departamento | null> {
  const [linha] = await db
    .select(COLUNAS_DO_DEPARTAMENTO)
    .from(departamentoTable)
    .where(eq(departamentoTable.nomeCanonico, canonico))
    .limit(1);
  return linha ? comoDepartamento(linha) : null;
}

/**
 * Cadastra um departamento — o único caminho que cria um.
 *
 * Nenhuma importação cria departamento: o rateio administrativo chega
 * classificado pela planilha de origem, e transformar aquele texto em cadastro
 * faria o arquivo virar autoridade sobre a estrutura da empresa.
 */
export async function cadastrarDepartamento(
  db: Database,
  pedido: { nome: string; paiId?: string | null; criadoPor?: string | null },
): Promise<Departamento> {
  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("departamento");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("departamento");

  const jaExiste = await departamentoPorNomeCanonico(db, canonico);
  if (jaExiste) throw new NomeJaCadastrado("departamento", jaExiste.nome);

  const paiId = pedido.paiId ?? null;
  if (paiId !== null) {
    const pai = await departamentoPorId(db, paiId);
    if (pai === null) throw new DepartamentoPaiInexistente(paiId);
  }

  const [criado] = await db
    .insert(departamentoTable)
    .values({
      nome,
      nomeCanonico: canonico,
      paiId,
      criadoPor: pedido.criadoPor ?? null,
    })
    .returning(COLUNAS_DO_DEPARTAMENTO);
  return comoDepartamento(criado!);
}

/**
 * Edita o nome e o pai de um departamento.
 *
 * O `id` não muda, pela mesma razão da unidade canônica: é ele que os cargos
 * referenciam, e trocá-lo apagaria a identidade que o cadastro preserva. O que
 * muda é a grafia e o lugar na estrutura.
 */
export async function editarDepartamento(
  db: Database,
  id: string,
  pedido: { nome: string; paiId?: string | null },
): Promise<Departamento> {
  const existente = await departamentoPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("departamento", id);

  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("departamento");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("departamento");

  const deOutro = await departamentoPorNomeCanonico(db, canonico);
  if (deOutro && deOutro.id !== id) {
    throw new NomeJaCadastrado("departamento", deOutro.nome);
  }

  const paiId = pedido.paiId === undefined ? existente.paiId : pedido.paiId;
  if (paiId !== null) {
    if (paiId === id) throw new HierarquiaCircular(nome);
    const pai = await departamentoPorId(db, paiId);
    if (pai === null) throw new DepartamentoPaiInexistente(paiId);
    /* O pai não pode estar abaixo de quem se está editando — daria o círculo. */
    const acimaDoPai = await caminhoAteRaiz(db, paiId);
    if (acimaDoPai.includes(id)) throw new HierarquiaCircular(nome);
  }

  const [editado] = await db
    .update(departamentoTable)
    .set({ nome, nomeCanonico: canonico, paiId })
    .where(eq(departamentoTable.id, id))
    .returning(COLUNAS_DO_DEPARTAMENTO);
  return comoDepartamento(editado!);
}

/**
 * Exclui um departamento, e recusa quando há algo pendurado nele.
 *
 * Excluir é oferecido aqui — e não em Usuários, onde o histórico de quem
 * confirmou o quê depende da linha existir — porque um departamento cadastrado
 * por engano não assina nada: nenhuma confirmação de curadoria aponta para ele.
 * O que ele pode ter é filho e cargo, e é isso que a recusa abaixo protege.
 */
/**
 * Quantas etapas de processo apontam para este cadastro — no responsável da
 * etapa e na lista de responsáveis dela.
 *
 * Existe porque a exclusão de um cadastro passou a ter um segundo lugar onde
 * doer. Antes da `0079`, apagar `Faturamento` só podia derrubar cargos e
 * contas; hoje derruba também o mapa dos processos, onde o mesmo departamento
 * é o que a raia do fluxograma lê. Sem esta contagem quem apagasse receberia a
 * violação de chave estrangeira crua do Postgres — uma mensagem que nomeia a
 * constraint e não diz o que fazer.
 *
 * As duas tabelas contam juntas e o número sai somado, porque para quem está na
 * tela de Cadastro a distinção entre "o responsável da etapa" e "uma linha da
 * lista de responsáveis" não existe: o que existe é "sete etapas ainda apontam
 * para isto".
 */
async function etapasQueApontam(
  db: Database,
  coluna: "departamentoId" | "cargoId" | "pessoaId",
  id: string,
): Promise<number> {
  const [etapas, itens] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(fluxoEtapaTable)
      .where(eq(fluxoEtapaTable[coluna], id)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(fluxoEtapaItemTable)
      .where(eq(fluxoEtapaItemTable[coluna], id)),
  ]);
  return (etapas[0]?.total ?? 0) + (itens[0]?.total ?? 0);
}

/** A frase da recusa, com o número que faz quem lê saber o tamanho do estrago. */
function fraseDasEtapas(total: number): string {
  return `${total} etapa${total === 1 ? " de processo aponta" : "s de processo apontam"} para ele`;
}

export async function excluirDepartamento(db: Database, id: string): Promise<void> {
  const existente = await departamentoPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("departamento", id);

  const filhos = await db
    .select({ id: departamentoTable.id })
    .from(departamentoTable)
    .where(eq(departamentoTable.paiId, id));
  if (filhos.length > 0) {
    throw new CadastroEmUso(
      "departamento",
      `${filhos.length} departamento${filhos.length === 1 ? " está" : "s estão"} dentro dele`,
    );
  }

  const cargos = await db
    .select({ id: cargoTable.id })
    .from(cargoTable)
    .where(eq(cargoTable.departamentoId, id));
  if (cargos.length > 0) {
    throw new CadastroEmUso(
      "departamento",
      `${cargos.length} cargo${cargos.length === 1 ? " está lotado" : "s estão lotados"} nele`,
    );
  }

  const etapas = await etapasQueApontam(db, "departamentoId", id);
  if (etapas > 0) throw new CadastroEmUso("departamento", fraseDasEtapas(etapas));

  await db.delete(departamentoTable).where(eq(departamentoTable.id, id));
}

/* =========================================================================
 * Cargo
 * ====================================================================== */

/** Um cargo, como as telas o recebem. */
export interface Cargo {
  id: string;
  nome: string;
  /** Onde ele está lotado. `null` enquanto ninguém disse. */
  departamentoId: string | null;
  criadoEm: string;
  criadoPor: string | null;
}

const COLUNAS_DO_CARGO = {
  id: cargoTable.id,
  nome: cargoTable.nome,
  departamentoId: cargoTable.departamentoId,
  criadoEm: cargoTable.criadoEm,
  criadoPor: cargoTable.criadoPor,
};

function comoCargo(linha: {
  id: string;
  nome: string;
  departamentoId: string | null;
  criadoEm: Date;
  criadoPor: string | null;
}): Cargo {
  return { ...linha, criadoEm: linha.criadoEm.toISOString() };
}

/** Os cargos cadastrados, em ordem de nome. */
export async function listarCargos(db: Database): Promise<Cargo[]> {
  const linhas = await db
    .select(COLUNAS_DO_CARGO)
    .from(cargoTable)
    .orderBy(asc(cargoTable.nome));
  return linhas.map(comoCargo);
}

/** O cargo de um `id`. `null` quando ele não existe. */
export async function cargoPorId(db: Database, id: string): Promise<Cargo | null> {
  const [linha] = await db
    .select(COLUNAS_DO_CARGO)
    .from(cargoTable)
    .where(eq(cargoTable.id, id))
    .limit(1);
  return linha ? comoCargo(linha) : null;
}

async function cargoPorNomeCanonico(db: Database, canonico: string): Promise<Cargo | null> {
  const [linha] = await db
    .select(COLUNAS_DO_CARGO)
    .from(cargoTable)
    .where(eq(cargoTable.nomeCanonico, canonico))
    .limit(1);
  return linha ? comoCargo(linha) : null;
}

/** Cadastra um cargo. O departamento é opcional; o nome, não. */
export async function cadastrarCargo(
  db: Database,
  pedido: { nome: string; departamentoId?: string | null; criadoPor?: string | null },
): Promise<Cargo> {
  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("cargo");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("cargo");

  const jaExiste = await cargoPorNomeCanonico(db, canonico);
  if (jaExiste) throw new NomeJaCadastrado("cargo", jaExiste.nome);

  const departamentoId = pedido.departamentoId ?? null;
  if (departamentoId !== null) {
    const departamento = await departamentoPorId(db, departamentoId);
    if (departamento === null) throw new DepartamentoInexistente(departamentoId);
  }

  const [criado] = await db
    .insert(cargoTable)
    .values({
      nome,
      nomeCanonico: canonico,
      departamentoId,
      criadoPor: pedido.criadoPor ?? null,
    })
    .returning(COLUNAS_DO_CARGO);
  return comoCargo(criado!);
}

/** Edita nome e lotação de um cargo já cadastrado. */
export async function editarCargo(
  db: Database,
  id: string,
  pedido: { nome: string; departamentoId?: string | null },
): Promise<Cargo> {
  const existente = await cargoPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("cargo", id);

  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("cargo");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("cargo");

  const deOutro = await cargoPorNomeCanonico(db, canonico);
  if (deOutro && deOutro.id !== id) throw new NomeJaCadastrado("cargo", deOutro.nome);

  const departamentoId =
    pedido.departamentoId === undefined ? existente.departamentoId : pedido.departamentoId;
  if (departamentoId !== null) {
    const departamento = await departamentoPorId(db, departamentoId);
    if (departamento === null) throw new DepartamentoInexistente(departamentoId);
  }

  const [editado] = await db
    .update(cargoTable)
    .set({ nome, nomeCanonico: canonico, departamentoId })
    .where(eq(cargoTable.id, id))
    .returning(COLUNAS_DO_CARGO);
  return comoCargo(editado!);
}

/**
 * Exclui um cargo.
 *
 * Quem checa se há conta lotada nele é a rota — a tabela de contas mora em
 * `schema/auth.ts` e este módulo é do cadastro, não da autenticação. O
 * `RESTRICT` da chave estrangeira é a segunda linha de defesa: mesmo que a
 * checagem falhe, o banco não deixa a conta ficar apontando para uma linha
 * morta.
 */
export async function excluirCargo(db: Database, id: string): Promise<void> {
  const existente = await cargoPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("cargo", id);

  const etapas = await etapasQueApontam(db, "cargoId", id);
  if (etapas > 0) throw new CadastroEmUso("cargo", fraseDasEtapas(etapas));

  await db.delete(cargoTable).where(eq(cargoTable.id, id));
}

/* =========================================================================
 * Negócio
 * ====================================================================== */

/** Um negócio, como as telas o recebem. */
export interface Negocio {
  id: string;
  nome: string;
  criadoEm: string;
  criadoPor: string | null;
}

const COLUNAS_DO_NEGOCIO = {
  id: negocioTable.id,
  nome: negocioTable.nome,
  criadoEm: negocioTable.criadoEm,
  criadoPor: negocioTable.criadoPor,
};

function comoNegocio(linha: {
  id: string;
  nome: string;
  criadoEm: Date;
  criadoPor: string | null;
}): Negocio {
  return { ...linha, criadoEm: linha.criadoEm.toISOString() };
}

/** Os negócios cadastrados, em ordem de nome. */
export async function listarNegocios(db: Database): Promise<Negocio[]> {
  const linhas = await db
    .select(COLUNAS_DO_NEGOCIO)
    .from(negocioTable)
    .orderBy(asc(negocioTable.nome));
  return linhas.map(comoNegocio);
}

/** O negócio de um `id`. `null` quando ele não existe. */
export async function negocioPorId(db: Database, id: string): Promise<Negocio | null> {
  const [linha] = await db
    .select(COLUNAS_DO_NEGOCIO)
    .from(negocioTable)
    .where(eq(negocioTable.id, id))
    .limit(1);
  return linha ? comoNegocio(linha) : null;
}

async function negocioPorNomeCanonico(db: Database, canonico: string): Promise<Negocio | null> {
  const [linha] = await db
    .select(COLUNAS_DO_NEGOCIO)
    .from(negocioTable)
    .where(eq(negocioTable.nomeCanonico, canonico))
    .limit(1);
  return linha ? comoNegocio(linha) : null;
}

/** Cadastra um negócio. */
export async function cadastrarNegocio(
  db: Database,
  pedido: { nome: string; criadoPor?: string | null },
): Promise<Negocio> {
  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("negocio");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("negocio");

  const jaExiste = await negocioPorNomeCanonico(db, canonico);
  if (jaExiste) throw new NomeJaCadastrado("negocio", jaExiste.nome);

  const [criado] = await db
    .insert(negocioTable)
    .values({ nome, nomeCanonico: canonico, criadoPor: pedido.criadoPor ?? null })
    .returning(COLUNAS_DO_NEGOCIO);
  return comoNegocio(criado!);
}

/** Edita a grafia de um negócio já cadastrado. */
export async function editarNegocio(
  db: Database,
  id: string,
  pedido: { nome: string },
): Promise<Negocio> {
  const existente = await negocioPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("negocio", id);

  const nome = (pedido.nome ?? "").trim();
  if (nome === "") throw new CadastroSemNome("negocio");
  const canonico = canonizarNome(nome);
  if (canonico === "") throw new CadastroSemNome("negocio");

  const deOutro = await negocioPorNomeCanonico(db, canonico);
  if (deOutro && deOutro.id !== id) throw new NomeJaCadastrado("negocio", deOutro.nome);

  const [editado] = await db
    .update(negocioTable)
    .set({ nome, nomeCanonico: canonico })
    .where(eq(negocioTable.id, id))
    .returning(COLUNAS_DO_NEGOCIO);
  return comoNegocio(editado!);
}

/** Exclui um negócio. Nada o referencia hoje, e por isso não há recusa aqui. */
export async function excluirNegocio(db: Database, id: string): Promise<void> {
  const existente = await negocioPorId(db, id);
  if (existente === null) throw new CadastroNaoEncontrado("negocio", id);
  await db.delete(negocioTable).where(eq(negocioTable.id, id));
}
