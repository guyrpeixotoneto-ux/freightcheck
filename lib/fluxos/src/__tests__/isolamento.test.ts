import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  appUserTable,
  cargoTable,
  departamentoTable,
  fluxoConexaoTable,
  fluxoEtapaItemTable,
  fluxoEtapaTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  acrescentarRoteiro,
  arquivarFluxo,
  atualizarConexao,
  atualizarEtapa,
  atualizarFluxo,
  criarConexao,
  criarEtapa,
  criarFluxo,
  duplicarFluxo,
  excluirConexao,
  excluirEtapa,
  importarFluxo,
  lerFluxo,
  lerFluxoPorSlug,
  ligarSubfluxo,
  listarFluxos,
  organizarFluxo,
  reposicionarEtapas,
  substituirAcoes,
  substituirIndicadores,
  substituirItens,
  ConexaoDuplicada,
  EmpresaDesconhecida,
  EtapaNaoEncontrada,
  FluxoNaoEncontrado,
  SlugJaUsado,
} from "../repositorio";
import { RecusaDeFluxo } from "../validacao";
import { CTE_ATE_RECEBIMENTO, NF_ATE_PAGAMENTO, OPERACAO_EMPURRADA } from "../exemplos";
import { interpretarRoteiro } from "../roteiro";
import { modeloPorSlug, modelosJaMapeados, semearModelos } from "../semear";

/**
 * O ISOLAMENTO ENTRE EMPRESAS — a bateria que não pode passar por engano.
 *
 * Duas empresas cadastradas, com fluxos, etapas e conexões próprias, e a
 * pergunta repetida em toda operação: **a empresa A alcança o que é da B?** A
 * resposta precisa ser não em leitura, em edição, em exclusão, em conexão e em
 * cada uma das listas de material da etapa. Uma única operação sem essa prova é
 * a operação que vaza.
 *
 * A afirmação é sempre a mesma forma: a empresa A faz a operação **com o id
 * real do registro da B** e recebe "não existe". Recusar com "não é seu" já
 * entregaria a informação de que existe.
 *
 * Precisa de um Postgres. Na máquina de quem desenvolve, pula; no CI não pula —
 * ver `lib/fechamento/src/__tests__/persistencia.test.ts`, onde a política está
 * escrita.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_fluxos_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

const AUTOR = { email: "guy@exemplo.com" };
const OUTRO = { email: "outra@exemplo.com" };

describe.skipIf(!temBanco)("Fluxos Operacionais sobre o banco", () => {
  let pool: pg.Pool;
  let db: Database;
  let empresaA: string;
  let empresaB: string;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;

    const [a] = await db
      .insert(unidadeTable)
      .values({ nome: "Transportes A", cnpj: "11111111000191" })
      .returning();
    const [b] = await db
      .insert(unidadeTable)
      .values({ nome: "Transportes B", cnpj: "22222222000172" })
      .returning();
    empresaA = a.id;
    empresaB = b.id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  // -------------------------------------------------------------------------
  // O ciclo básico
  // -------------------------------------------------------------------------

  describe("criar, ler, editar, arquivar", () => {
    it("um fluxo criado volta na lista da empresa dele, com as contagens", async () => {
      const fluxo = await criarFluxo(
        db,
        empresaA,
        { nome: "Fechamento de faturamento", categoria: "Faturamento" },
        AUTOR,
      );
      expect(fluxo.empresaId).toBe(empresaA);
      expect(fluxo.status).toBe("RASCUNHO");
      expect(fluxo.versao).toBe(1);
      expect(fluxo.criadoPor).toBe(AUTOR.email);

      const um = await criarEtapa(db, empresaA, fluxo.id, { nome: "Abrir competência", tipo: "INICIO" });
      const dois = await criarEtapa(db, empresaA, fluxo.id, { nome: "Conferir" });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: um.id,
        destinoEtapaId: dois.id,
      });

      const lista = await listarFluxos(db, empresaA);
      const linha = lista.find((f) => f.id === fluxo.id)!;
      expect(linha.etapas).toBe(2);
      expect(linha.conexoes).toBe(1);
    });

    it("as contagens não se multiplicam entre si — a armadilha do join em leque", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Leque", categoria: "Teste" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a" });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b" });
      const c = await criarEtapa(db, empresaA, fluxo.id, { nome: "c" });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: b.id, destinoEtapaId: c.id });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: c.id });

      const linha = (await listarFluxos(db, empresaA)).find((f) => f.id === fluxo.id)!;
      expect(linha.etapas).toBe(3);
      expect(linha.conexoes).toBe(3);
    });

    /*
      Sem o pai na linha, a listagem é plana: o detalhe de uma etapa aparece ao
      lado do processo do qual é um pedaço, e a tela não tem como saber que os
      dois são a mesma coisa vista de duas alturas.
    */
    it("a linha diz de qual etapa ela é o detalhe", async () => {
      const pai = await criarFluxo(db, empresaA, { nome: "Macro", categoria: "Teste" }, AUTOR);
      const etapa = await criarEtapa(db, empresaA, pai.id, { nome: "Origem da tarifa" });
      const detalhe = await criarFluxo(db, empresaA, { nome: "Detalhe", categoria: "Teste" }, AUTOR);
      await ligarSubfluxo(db, empresaA, pai.id, etapa.id, detalhe.id);

      const lista = await listarFluxos(db, empresaA);
      expect(lista.find((f) => f.id === pai.id)!.pai).toBeNull();
      expect(lista.find((f) => f.id === detalhe.id)!.pai).toEqual({
        fluxoId: pai.id,
        etapaId: etapa.id,
        etapaNome: "Origem da tarifa",
      });
    });

    it("o slug se repetindo na mesma empresa é recusado com frase própria", async () => {
      await criarFluxo(db, empresaA, { nome: "Cadastro de fornecedor", categoria: "Compras" }, AUTOR);
      await expect(
        criarFluxo(db, empresaA, { nome: "Cadastro de fornecedor", categoria: "Compras" }, AUTOR),
      ).rejects.toBeInstanceOf(SlugJaUsado);
    });

    it("o mesmo slug em OUTRA empresa é permitido — a unicidade é por empresa", async () => {
      const naB = await criarFluxo(
        db,
        empresaB,
        { nome: "Cadastro de fornecedor", categoria: "Compras" },
        AUTOR,
      );
      expect(naB.slug).toBe("cadastro-de-fornecedor");
      expect(naB.empresaId).toBe(empresaB);
    });

    it("editar carimba quem editou, sem apagar quem criou", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Auditoria", categoria: "Controle" }, AUTOR);
      const editado = await atualizarFluxo(
        db,
        empresaA,
        fluxo.id,
        { nome: "Auditoria operacional", categoria: "Controle", status: "ATIVO" },
        OUTRO,
      );
      expect(editado.nome).toBe("Auditoria operacional");
      expect(editado.status).toBe("ATIVO");
      expect(editado.criadoPor).toBe(AUTOR.email);
      expect(editado.atualizadoPor).toBe(OUTRO.email);
    });

    it("arquivar tira da lista padrão e mantém consultável", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Processo velho", categoria: "X" }, AUTOR);
      await arquivarFluxo(db, empresaA, fluxo.id, AUTOR);

      const padrao = await listarFluxos(db, empresaA);
      expect(padrao.map((f) => f.id)).not.toContain(fluxo.id);

      const comArquivados = await listarFluxos(db, empresaA, { incluirArquivados: true });
      expect(comArquivados.map((f) => f.id)).toContain(fluxo.id);

      expect((await lerFluxo(db, empresaA, fluxo.id))?.fluxo.status).toBe("ARQUIVADO");
    });

    it("uma empresa que não existe é recusada com a frase que manda para o cadastro", async () => {
      await expect(
        criarFluxo(
          db,
          "00000000-0000-0000-0000-000000000000",
          { nome: "X", categoria: "Y" },
          AUTOR,
        ),
      ).rejects.toBeInstanceOf(EmpresaDesconhecida);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-tenant
  // -------------------------------------------------------------------------

  describe("a empresa A não alcança o que é da B", () => {
    let daB: string;
    let etapaDaB: string;
    let outraEtapaDaB: string;
    let conexaoDaB: string;

    beforeAll(async () => {
      const fluxo = await importarFluxo(db, empresaB, NF_ATE_PAGAMENTO, AUTOR);
      daB = fluxo.id;
      const completo = (await lerFluxo(db, empresaB, daB))!;
      etapaDaB = completo.etapas[0].id;
      outraEtapaDaB = completo.etapas[1].id;
      conexaoDaB = completo.conexoes[0].id;
    });

    it("não vê na lista", async () => {
      const daA = await listarFluxos(db, empresaA, { incluirArquivados: true });
      expect(daA.map((f) => f.id)).not.toContain(daB);
    });

    it("não lê pelo id", async () => {
      expect(await lerFluxo(db, empresaA, daB)).toBeNull();
    });

    it("não lê pelo slug", async () => {
      expect(await lerFluxoPorSlug(db, empresaA, NF_ATE_PAGAMENTO.slug)).toBeNull();
    });

    it("não edita", async () => {
      await expect(
        atualizarFluxo(db, empresaA, daB, { nome: "Sequestrado", categoria: "X" }, AUTOR),
      ).rejects.toBeInstanceOf(FluxoNaoEncontrado);
    });

    it("não arquiva", async () => {
      await expect(arquivarFluxo(db, empresaA, daB, AUTOR)).rejects.toBeInstanceOf(
        FluxoNaoEncontrado,
      );
    });

    it("não duplica", async () => {
      await expect(duplicarFluxo(db, empresaA, daB, "Cópia", AUTOR)).rejects.toBeInstanceOf(
        FluxoNaoEncontrado,
      );
    });

    it("não cria etapa dentro do fluxo alheio", async () => {
      await expect(criarEtapa(db, empresaA, daB, { nome: "Invasora" })).rejects.toBeInstanceOf(
        FluxoNaoEncontrado,
      );
    });

    it("não edita etapa alheia", async () => {
      await expect(
        atualizarEtapa(db, empresaA, daB, etapaDaB, { nome: "Renomeada" }),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
    });

    it("não exclui etapa alheia", async () => {
      await expect(excluirEtapa(db, empresaA, daB, etapaDaB)).rejects.toBeInstanceOf(
        EtapaNaoEncontrada,
      );
    });

    it("não reposiciona etapa alheia", async () => {
      await expect(
        reposicionarEtapas(db, empresaA, daB, [{ etapaId: etapaDaB, posX: 9, posY: 9 }]),
      ).rejects.toBeInstanceOf(RecusaDeFluxo);
    });

    it("não conecta duas etapas alheias", async () => {
      await expect(
        criarConexao(db, empresaA, daB, {
          origemEtapaId: etapaDaB,
          destinoEtapaId: outraEtapaDaB,
        }),
      ).rejects.toBeInstanceOf(FluxoNaoEncontrado);
    });

    it("não conecta uma etapa PRÓPRIA a uma etapa alheia", async () => {
      const meu = await criarFluxo(db, empresaA, { nome: "Meu fluxo", categoria: "X" }, AUTOR);
      const minha = await criarEtapa(db, empresaA, meu.id, { nome: "Minha etapa" });
      await expect(
        criarConexao(db, empresaA, meu.id, {
          origemEtapaId: minha.id,
          destinoEtapaId: etapaDaB,
        }),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
    });

    it("não edita conexão alheia", async () => {
      await expect(
        atualizarConexao(db, empresaA, daB, conexaoDaB, {
          origemEtapaId: etapaDaB,
          destinoEtapaId: outraEtapaDaB,
        }),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
    });

    it("não exclui conexão alheia", async () => {
      await expect(excluirConexao(db, empresaA, daB, conexaoDaB)).rejects.toBeInstanceOf(
        RecusaDeFluxo,
      );
    });

    it("não substitui itens, indicadores nem ações de etapa alheia", async () => {
      await expect(
        substituirItens(db, empresaA, daB, etapaDaB, "FALHA", [{ nome: "x" }]),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
      await expect(
        substituirIndicadores(db, empresaA, daB, etapaDaB, [{ nome: "x" }]),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
      await expect(
        substituirAcoes(db, empresaA, daB, etapaDaB, [{ titulo: "x", rota: "/x" }]),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);
    });

    it("depois de todas as tentativas, o fluxo da B continua intacto", async () => {
      const completo = (await lerFluxo(db, empresaB, daB))!;
      expect(completo.fluxo.nome).toBe(NF_ATE_PAGAMENTO.nome);
      expect(completo.etapas).toHaveLength(NF_ATE_PAGAMENTO.etapas.length);
      expect(completo.conexoes).toHaveLength(NF_ATE_PAGAMENTO.conexoes.length);
    });

    it("nem por SQL: a chave composta recusa etapa de uma empresa em fluxo de outra", async () => {
      // A defesa de baixo, exercitada sem passar pelo repositório. Se algum dia
      // alguém escrever um caminho novo de gravação e esquecer o escopo, é este
      // erro que aparece — feio, e seguro.
      const meu = await criarFluxo(db, empresaA, { nome: "Alvo", categoria: "X" }, AUTOR);
      await expect(
        db.insert(fluxoEtapaTable).values({
          empresaId: empresaB,
          fluxoId: meu.id,
          nome: "Atravessada",
        }),
      ).rejects.toThrow();
    });

    it("nem por SQL: a conexão não liga etapas de fluxos diferentes", async () => {
      const meu = await criarFluxo(db, empresaA, { nome: "Alvo 2", categoria: "X" }, AUTOR);
      const minha = await criarEtapa(db, empresaA, meu.id, { nome: "Minha" });
      await expect(
        db.insert(fluxoConexaoTable).values({
          empresaId: empresaA,
          fluxoId: meu.id,
          origemEtapaId: minha.id,
          destinoEtapaId: etapaDaB,
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Constraints e cascatas
  // -------------------------------------------------------------------------

  describe("o que o banco garante sozinho", () => {
    it("a mesma seta não entra duas vezes", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Duplicata", categoria: "X" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a" });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b" });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id });
      await expect(
        criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id }),
      ).rejects.toBeInstanceOf(ConexaoDuplicada);
    });

    it("duas setas de tipos diferentes entre as mesmas etapas são permitidas", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Dois tipos", categoria: "X" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a", tipo: "DECISAO" });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b" });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: a.id,
        destinoEtapaId: b.id,
        tipo: "DECISAO_SIM",
      });
      const segunda = await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: a.id,
        destinoEtapaId: b.id,
        tipo: "DECISAO_NAO",
      });
      expect(segunda.tipo).toBe("DECISAO_NAO");
    });

    it("excluir uma etapa leva junto as setas que a tocam", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Cascata", categoria: "X" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a" });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b" });
      const c = await criarEtapa(db, empresaA, fluxo.id, { nome: "c" });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: b.id, destinoEtapaId: c.id });
      await substituirItens(db, empresaA, fluxo.id, b.id, "FALHA", [{ nome: "Some junto" }]);

      await excluirEtapa(db, empresaA, fluxo.id, b.id);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas.map((e) => e.id).sort()).toEqual([a.id, c.id].sort());
      expect(completo.conexoes).toHaveLength(0);

      const orfaos = await db
        .select()
        .from(fluxoEtapaItemTable)
        .where(eq(fluxoEtapaItemTable.etapaId, b.id));
      expect(orfaos).toHaveLength(0);
    });

    it("a empresa não pode ser apagada enquanto tiver fluxo — RESTRICT", async () => {
      await expect(
        db.delete(unidadeTable).where(eq(unidadeTable.id, empresaA)),
      ).rejects.toThrow();
    });

    it("o banco recusa nome em branco mesmo por SQL direto", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Check", categoria: "X" }, AUTOR);
      await expect(
        db
          .insert(fluxoEtapaTable)
          .values({ empresaId: empresaA, fluxoId: fluxo.id, nome: "   " }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // O material da etapa
  // -------------------------------------------------------------------------

  describe("itens, indicadores e ações", () => {
    let fluxoId: string;
    let etapaId: string;

    beforeAll(async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Material", categoria: "X" }, AUTOR);
      fluxoId = fluxo.id;
      etapaId = (await criarEtapa(db, empresaA, fluxoId, { nome: "Etapa" })).id;
    });

    it("substituir uma espécie não toca nas outras", async () => {
      await substituirItens(db, empresaA, fluxoId, etapaId, "SISTEMA", [
        { nome: "ERP" },
        { nome: "TMS" },
      ]);
      await substituirItens(db, empresaA, fluxoId, etapaId, "FALHA", [{ nome: "Rejeição" }]);
      await substituirItens(db, empresaA, fluxoId, etapaId, "SISTEMA", [{ nome: "Só o ERP" }]);

      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.itens.filter((i) => i.especie === "SISTEMA").map((i) => i.nome)).toEqual([
        "Só o ERP",
      ]);
      expect(etapa.itens.filter((i) => i.especie === "FALHA").map((i) => i.nome)).toEqual([
        "Rejeição",
      ]);
    });

    it("a ordem declarada é a ordem devolvida", async () => {
      await substituirItens(db, empresaA, fluxoId, etapaId, "DOCUMENTO", [
        { nome: "Terceiro", ordem: 2 },
        { nome: "Primeiro", ordem: 0 },
        { nome: "Segundo", ordem: 1 },
      ]);
      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.itens.filter((i) => i.especie === "DOCUMENTO").map((i) => i.nome)).toEqual([
        "Primeiro",
        "Segundo",
        "Terceiro",
      ]);
    });

    it("lista vazia limpa a espécie", async () => {
      await substituirItens(db, empresaA, fluxoId, etapaId, "GARGALO", [{ nome: "Manual" }]);
      await substituirItens(db, empresaA, fluxoId, etapaId, "GARGALO", []);
      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.itens.filter((i) => i.especie === "GARGALO")).toHaveLength(0);
    });

    it("uma ação inválida derruba o lote inteiro, sem gravar metade", async () => {
      await substituirAcoes(db, empresaA, fluxoId, etapaId, [
        { titulo: "Boa", rota: "/unidades" },
      ]);
      await expect(
        substituirAcoes(db, empresaA, fluxoId, etapaId, [
          { titulo: "Boa", rota: "/unidades" },
          { titulo: "Má", rota: "https://exemplo.com" },
        ]),
      ).rejects.toBeInstanceOf(RecusaDeFluxo);

      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.acoes.map((a) => a.titulo)).toEqual(["Boa"]);
    });

    it("os parâmetros de uma ação voltam como objeto", async () => {
      await substituirAcoes(db, empresaA, fluxoId, etapaId, [
        { titulo: "Rejeitados", rota: "/alteracoes", parametros: { status: "REJEITADO" } },
      ]);
      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.acoes[0].parametros).toEqual({ status: "REJEITADO" });
    });

    it("indicadores guardam unidade, sentido e origem futura", async () => {
      await substituirIndicadores(db, empresaA, fluxoId, etapaId, [
        {
          nome: "% autorizado sem rejeição",
          unidade: "%",
          sentido: "MAIOR_MELHOR",
          origem: "Autorizados na primeira transmissão sobre o total.",
        },
      ]);
      const etapa = (await lerFluxo(db, empresaA, fluxoId))!.etapas.find((e) => e.id === etapaId)!;
      expect(etapa.indicadores[0]).toMatchObject({
        unidade: "%",
        sentido: "MAIOR_MELHOR",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Reposicionar
  // -------------------------------------------------------------------------

  describe("o salvamento do arrastar", () => {
    it("grava o lote inteiro", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Arrastar", categoria: "X" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a" });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b" });
      const gravadas = await reposicionarEtapas(db, empresaA, fluxo.id, [
        { etapaId: a.id, posX: 100, posY: 200 },
        { etapaId: b.id, posX: -40, posY: 350 },
      ]);
      expect(gravadas).toBe(2);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas.find((e) => e.id === a.id)).toMatchObject({ posX: 100, posY: 200 });
      expect(completo.etapas.find((e) => e.id === b.id)).toMatchObject({ posX: -40, posY: 350 });
    });

    it("uma etapa de outro fluxo no lote recusa o lote todo — nada fica pela metade", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Lote", categoria: "X" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a" });
      const outro = await criarFluxo(db, empresaA, { nome: "Outro", categoria: "X" }, AUTOR);
      const alheia = await criarEtapa(db, empresaA, outro.id, { nome: "alheia" });

      await expect(
        reposicionarEtapas(db, empresaA, fluxo.id, [
          { etapaId: a.id, posX: 999, posY: 999 },
          { etapaId: alheia.id, posX: 1, posY: 1 },
        ]),
      ).rejects.toBeInstanceOf(EtapaNaoEncontrada);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas.find((e) => e.id === a.id)).toMatchObject({ posX: 0, posY: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Duplicar e semear
  // -------------------------------------------------------------------------

  describe("duplicar", () => {
    it("copia etapas, conexões e material, e nasce rascunho", async () => {
      const fluxo = await importarFluxo(db, empresaA, NF_ATE_PAGAMENTO, AUTOR);
      const copia = await duplicarFluxo(db, empresaA, fluxo.id, "NF até pagamento (cópia)", AUTOR);

      expect(copia.id).not.toBe(fluxo.id);
      expect(copia.status).toBe("RASCUNHO");

      const original = (await lerFluxo(db, empresaA, fluxo.id))!;
      const nova = (await lerFluxo(db, empresaA, copia.id))!;
      expect(nova.etapas).toHaveLength(original.etapas.length);
      expect(nova.conexoes).toHaveLength(original.conexoes.length);

      /* As conexões da cópia apontam para as etapas da cópia, nunca para as do original. */
      const idsDaCopia = new Set(nova.etapas.map((e) => e.id));
      for (const conexao of nova.conexoes) {
        expect(idsDaCopia.has(conexao.origemEtapaId)).toBe(true);
        expect(idsDaCopia.has(conexao.destinoEtapaId)).toBe(true);
      }
    });
  });

  describe("semear", () => {
    it("planta o fluxo do CTe com as dezesseis etapas pedidas e os retornos", async () => {
      const [fluxo] = await semearModelos(db, empresaB, AUTOR, [
        modeloPorSlug("cte-ate-recebimento")!,
      ]);
      const completo = (await lerFluxo(db, empresaB, fluxo.id))!;

      expect(completo.fluxo.nome).toBe("Emissão de CTe até Recebimento");
      expect(completo.etapas).toHaveLength(CTE_ATE_RECEBIMENTO.etapas.length);
      expect(completo.conexoes).toHaveLength(CTE_ATE_RECEBIMENTO.conexoes.length);

      /* O processo não é linear: existe retrabalho e existem decisões. */
      expect(completo.conexoes.some((c) => c.tipo === "RETRABALHO")).toBe(true);
      expect(completo.conexoes.some((c) => c.tipo === "DECISAO_NAO")).toBe(true);
      expect(completo.conexoes.some((c) => c.tipo === "EXCECAO")).toBe(true);

      /* E o material das etapas veio junto, que é o ponto do fluxo de exemplo. */
      const sefaz = completo.etapas.find((e) => e.nome === "Autorização SEFAZ")!;
      expect(sefaz.itens.filter((i) => i.especie === "FALHA").length).toBeGreaterThan(0);
      expect(sefaz.itens.filter((i) => i.especie === "SISTEMA").length).toBeGreaterThan(0);
      expect(sefaz.indicadores.length).toBeGreaterThan(0);
    });

    it("o fluxo semeado nasce DESENHADO — não empilhado na origem", async () => {
      /*
        A declaração não traz coordenada, e não deveria: pedir posição a quem
        levanta um processo é pedir a coisa errada. Sem o layout na importação,
        abrir o fluxo do CTe mostraria dezoito cartões um sobre o outro.
      */
      const completo = (await lerFluxoPorSlug(db, empresaB, "cte-ate-recebimento"))!;
      const naOrigem = completo.etapas.filter((e) => e.posX === 0 && e.posY === 0);
      expect(naOrigem).toHaveLength(1);
      expect(new Set(completo.etapas.map((e) => e.posY)).size).toBeGreaterThan(10);

      /* E os dois ramos da decisão saem lado a lado, na mesma faixa. */
      const sefaz = completo.etapas.find((e) => e.nome === "Autorização SEFAZ")!;
      const correcao = completo.etapas.find((e) => e.nome === "Correção e retransmissão")!;
      expect(sefaz.posY).toBe(correcao.posY);
      expect(sefaz.posX).toBe(-correcao.posX);
    });

    it("uma declaração COM posição é respeitada — é o caso do duplicar", async () => {
      const original = await importarFluxo(
        db,
        empresaA,
        {
          nome: "Com arranjo próprio",
          slug: "com-arranjo-proprio",
          categoria: "Teste",
          etapas: [
            { chave: "a", nome: "A", posX: 999, posY: 888 },
            { chave: "b", nome: "B", posX: 111, posY: 222 },
          ],
          conexoes: [{ de: "a", para: "b" }],
        },
        AUTOR,
      );
      const completo = (await lerFluxo(db, empresaA, original.id))!;
      expect(completo.etapas.find((e) => e.nome === "A")).toMatchObject({
        posX: 999,
        posY: 888,
      });
    });

    it("semear de novo não duplica e não desfaz edição", async () => {
      const antes = (await lerFluxoPorSlug(db, empresaB, "cte-ate-recebimento"))!;
      await atualizarEtapa(db, empresaB, antes.fluxo.id, antes.etapas[0].id, {
        nome: "Negociação (editada por gente)",
      });

      const [denovo] = await semearModelos(db, empresaB, AUTOR, [
        modeloPorSlug("cte-ate-recebimento")!,
      ]);
      expect(denovo.id).toBe(antes.fluxo.id);

      const depois = (await lerFluxo(db, empresaB, antes.fluxo.id))!;
      expect(depois.etapas).toHaveLength(antes.etapas.length);
      expect(depois.etapas.some((e) => e.nome === "Negociação (editada por gente)")).toBe(true);
    });

    it("a semeadura padrão planta o que a empresa já mapeou — e nenhum exemplo", () => {
      /*
        O que entra sozinho é o levantamento da própria empresa. Um exemplo
        entrando aqui seria o defeito que `exemplos/index.ts` descreve: cadastro
        de gente cheio de material de demonstração.
      */
      const slugs = modelosJaMapeados().map((m) => m.declarado.slug);
      expect(slugs).toContain("operacao-empurrada-faturamento-recebimento");
      expect(slugs).not.toContain("cte-ate-recebimento");
      expect(slugs).not.toContain("nf-ate-pagamento");
    });

    it("o mesmo modelo semeado em outra empresa é outro fluxo, e não o mesmo", async () => {
      const naA = await importarFluxo(db, empresaA, CTE_ATE_RECEBIMENTO, AUTOR);
      const naB = await lerFluxoPorSlug(db, empresaB, "cte-ate-recebimento");
      expect(naA.id).not.toBe(naB!.fluxo.id);
      expect(naA.empresaId).toBe(empresaA);
    });
  });

  // -------------------------------------------------------------------------
  // Roteiro e organização — os dois atalhos do desenho
  // -------------------------------------------------------------------------

  describe("acrescentar um roteiro a um fluxo que já existe", () => {
    it("as etapas entram ligadas, na ordem, depois das que já estavam", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Colagem", categoria: "Teste" }, AUTOR);
      const primeira = await criarEtapa(db, empresaA, fluxo.id, { nome: "Já existia", ordem: 0 });

      const roteiro = interpretarRoteiro("Segunda\nTerceira", { prefixoDaChave: "nova" });
      const resumo = await acrescentarRoteiro(
        db,
        empresaA,
        fluxo.id,
        {
          etapas: roteiro.etapas,
          conexoes: [
            { de: primeira.id, para: "nova-1" },
            ...roteiro.conexoes,
          ],
        },
        AUTOR,
      );

      expect(resumo).toEqual({ etapasCriadas: 2, conexoesCriadas: 2 });

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas.map((e) => e.nome)).toEqual(["Já existia", "Segunda", "Terceira"]);
      expect(completo.etapas.map((e) => e.ordem)).toEqual([0, 1, 2]);
      expect(completo.conexoes).toHaveLength(2);
      /* E o trecho novo nasce posicionado, não empilhado na origem. */
      expect(completo.etapas.filter((e) => e.posX === 0 && e.posY === 0)).toHaveLength(1);
    });

    it("uma ponta que não é etapa deste fluxo nem chave da declaração é recusada com nome", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Ponta solta", categoria: "Teste" }, AUTOR);
      const roteiro = interpretarRoteiro("Uma");
      await expect(
        acrescentarRoteiro(
          db,
          empresaA,
          fluxo.id,
          { etapas: roteiro.etapas, conexoes: [{ de: "inexistente", para: "linha-1" }] },
          AUTOR,
        ),
      ).rejects.toMatchObject({ codigo: "CONEXAO_ETAPA_DESCONHECIDA" });

      /* E nada foi gravado: a recusa acontece antes da transação. */
      expect((await lerFluxo(db, empresaA, fluxo.id))!.etapas).toHaveLength(0);
    });

    it("a empresa A não acrescenta etapas num fluxo da B", async () => {
      const daB = await criarFluxo(db, empresaB, { nome: "Só da B", categoria: "Teste" }, OUTRO);
      const roteiro = interpretarRoteiro("Invasora");
      await expect(
        acrescentarRoteiro(db, empresaA, daB.id, roteiro, AUTOR),
      ).rejects.toBeInstanceOf(FluxoNaoEncontrado);
      expect((await lerFluxo(db, empresaB, daB.id))!.etapas).toHaveLength(0);
    });

    it("uma etapa inválida derruba o lote inteiro — nada entra pela metade", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Lote do roteiro", categoria: "Teste" }, AUTOR);
      await expect(
        acrescentarRoteiro(
          db,
          empresaA,
          fluxo.id,
          { etapas: [{ chave: "a", nome: "Boa" }, { chave: "b", nome: "  " }], conexoes: [] },
          AUTOR,
        ),
      ).rejects.toBeInstanceOf(RecusaDeFluxo);
      expect((await lerFluxo(db, empresaA, fluxo.id))!.etapas).toHaveLength(0);
    });
  });

  describe("organizar", () => {
    it("posiciona quem está na origem e não desmancha quem foi arrastado", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Arrumar", categoria: "Teste" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a", ordem: 0 });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b", ordem: 1 });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id });
      await reposicionarEtapas(db, empresaA, fluxo.id, [
        { etapaId: a.id, posX: 900, posY: 900 },
      ]);

      await organizarFluxo(db, empresaA, fluxo.id);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      const depoisA = completo.etapas.find((e) => e.id === a.id)!;
      const depoisB = completo.etapas.find((e) => e.id === b.id)!;
      expect([depoisA.posX, depoisA.posY]).toEqual([900, 900]);
      expect(depoisB.posY).toBeGreaterThan(0);
    });

    it("refazerTudo desmancha o arranjo à mão — e só ele faz isso", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Refazer", categoria: "Teste" }, AUTOR);
      const a = await criarEtapa(db, empresaA, fluxo.id, { nome: "a", ordem: 0 });
      const b = await criarEtapa(db, empresaA, fluxo.id, { nome: "b", ordem: 1 });
      await criarConexao(db, empresaA, fluxo.id, { origemEtapaId: a.id, destinoEtapaId: b.id });
      await reposicionarEtapas(db, empresaA, fluxo.id, [
        { etapaId: a.id, posX: 900, posY: 900 },
        { etapaId: b.id, posX: 950, posY: 950 },
      ]);

      const { movidas } = await organizarFluxo(db, empresaA, fluxo.id, { refazerTudo: true });
      expect(movidas).toBe(2);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      const depoisA = completo.etapas.find((e) => e.id === a.id)!;
      expect([depoisA.posX, depoisA.posY]).toEqual([0, 0]);
    });

    it("a empresa A não organiza o fluxo da B", async () => {
      const daB = await criarFluxo(db, empresaB, { nome: "Arranjo da B", categoria: "Teste" }, OUTRO);
      await expect(organizarFluxo(db, empresaA, daB.id)).rejects.toBeInstanceOf(FluxoNaoEncontrado);
    });
  });

  describe("o macrofluxo da operação empurrada", () => {
    it("entra inteiro pelo mesmo caminho da seed, com o paralelo e o retrabalho", async () => {
      const fluxo = await importarFluxo(db, empresaA, OPERACAO_EMPURRADA, AUTOR);
      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;

      expect(completo.etapas).toHaveLength(OPERACAO_EMPURRADA.etapas.length);
      expect(completo.conexoes).toHaveLength(OPERACAO_EMPURRADA.conexoes.length);

      /* As duas integrações saem da mesma etapa — é o paralelo do quadro. */
      const integracoes = completo.etapas.find((e) => e.nome === "Integrações pós-emissão")!;
      const ramos = completo.conexoes.filter((c) => c.origemEtapaId === integracoes.id);
      expect(ramos).toHaveLength(2);

      /* E a volta das pendências continua sendo uma seta, não uma anotação. */
      expect(completo.conexoes.some((c) => c.tipo === "RETRABALHO")).toBe(true);

      /* Nasce desenhado, como todo fluxo importado. */
      expect(completo.etapas.filter((e) => e.posX === 0 && e.posY === 0).length).toBeLessThan(2);
    });
  });

  // -------------------------------------------------------------------------
  // O teste arquitetural
  // -------------------------------------------------------------------------

  describe("o motor é genérico", () => {
    it("um processo de outro domínio entra pelas MESMAS funções, sem tabela nova", async () => {
      /*
        A prova que o critério de aceite pede. Um fluxo inventado aqui — nem CTe
        nem NF —, montado pelas funções públicas do repositório, com decisão,
        exceção e retorno. Se alguma coisa deste módulo soubesse o que é um CTe,
        este teste não passaria.
      */
      const fluxo = await criarFluxo(
        db,
        empresaA,
        {
          nome: "Disponibilidade de frota",
          categoria: "Operações",
          objetivo: "Do apontamento de indisponibilidade à liberação do veículo.",
        },
        AUTOR,
      );
      const apontar = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Apontar indisponibilidade",
        tipo: "INICIO",
        ordem: 0,
      });
      const diagnosticar = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Diagnosticar",
        tipo: "VALIDACAO",
        ordem: 1,
      });
      const decidir = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Tem peça?",
        tipo: "DECISAO",
        ordem: 2,
      });
      const comprar = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Comprar peça",
        tipo: "PENDENCIA",
        ordem: 3,
      });
      const liberar = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Liberar veículo",
        tipo: "FIM",
        ordem: 4,
      });

      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: apontar.id,
        destinoEtapaId: diagnosticar.id,
      });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: diagnosticar.id,
        destinoEtapaId: decidir.id,
      });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: decidir.id,
        destinoEtapaId: liberar.id,
        tipo: "DECISAO_SIM",
        rotulo: "Sim",
      });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: decidir.id,
        destinoEtapaId: comprar.id,
        tipo: "DECISAO_NAO",
        rotulo: "Não",
      });
      await criarConexao(db, empresaA, fluxo.id, {
        origemEtapaId: comprar.id,
        destinoEtapaId: diagnosticar.id,
        tipo: "RETRABALHO",
        rotulo: "Peça chegou",
      });

      await substituirItens(db, empresaA, fluxo.id, diagnosticar.id, "SISTEMA", [
        { nome: "Sistema de manutenção" },
      ]);
      await substituirAcoes(db, empresaA, fluxo.id, liberar.id, [
        { titulo: "Ver frota", rota: "/frota-360" },
      ]);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas).toHaveLength(5);
      expect(completo.conexoes).toHaveLength(5);
      expect(completo.etapas.find((e) => e.id === liberar.id)!.acoes[0].rota).toBe("/frota-360");
    });
  });

  // -------------------------------------------------------------------------
  // O responsável como cadastro — a `0079`
  // -------------------------------------------------------------------------

  /**
   * A afirmação central da `0079`: **a identidade é o `id`, e o texto é
   * projeção**.
   *
   * Não basta gravar o vínculo; o que ele promete é que renomear o cadastro
   * renomeia em todo processo que o aponta, sem migração e sem reedição. É o
   * que estes casos provam — e o que falharia calado se alguém trocasse a
   * projeção da leitura por uma cópia do nome na hora da escrita.
   */
  describe("responsável escolhido do cadastro", () => {
    let departamento: string;
    let cargo: string;
    let pessoa: string;

    beforeAll(async () => {
      const [d] = await db
        .insert(departamentoTable)
        .values({ nome: "Faturamento", nomeCanonico: "FATURAMENTO" })
        .returning();
      const [c] = await db
        .insert(cargoTable)
        .values({ nome: "Analista Fiscal", nomeCanonico: "ANALISTA FISCAL", departamentoId: d.id })
        .returning();
      const [u] = await db
        .insert(appUserTable)
        .values({ email: "ana@exemplo.com", name: "Ana Souza", passwordHash: "x" })
        .returning();
      departamento = d.id;
      cargo = c.id;
      pessoa = u.id;
    });

    it("a etapa lê área e responsável do cadastro, e não do texto gravado", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Com cadastro", categoria: "Teste" }, AUTOR);
      const etapa = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Conferir CTe",
        /* O texto vai junto, e de propósito discorda do cadastro. */
        area: "FAT",
        responsavel: "quem sobrar",
        departamentoId: departamento,
        cargoId: cargo,
      });

      expect(etapa.area).toBe("Faturamento");
      expect(etapa.responsavel).toBe("Analista Fiscal");

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      const lida = completo.etapas.find((e) => e.id === etapa.id)!;
      expect(lida.area).toBe("Faturamento");
      expect(lida.responsavel).toBe("Analista Fiscal");
      expect(lida.departamentoId).toBe(departamento);
    });

    it("renomear o departamento renomeia a área em todo fluxo que o aponta", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Renomear", categoria: "Teste" }, AUTOR);
      const etapa = await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Emitir",
        departamentoId: departamento,
      });
      expect(etapa.area).toBe("Faturamento");

      await db
        .update(departamentoTable)
        .set({ nome: "Faturamento e Cobrança" })
        .where(eq(departamentoTable.id, departamento));

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      expect(completo.etapas.find((e) => e.id === etapa.id)!.area).toBe("Faturamento e Cobrança");

      await db
        .update(departamentoTable)
        .set({ nome: "Faturamento" })
        .where(eq(departamentoTable.id, departamento));
    });

    /*
      O item sem nome é o caso que a tela produz: quem escolhe "Faturamento" na
      lista de responsáveis não digita nada. Quem põe o nome é o servidor.
    */
    it("um responsável escolhido do cadastro vale sem nome digitado", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Sem nome", categoria: "Teste" }, AUTOR);
      const etapa = await criarEtapa(db, empresaA, fluxo.id, { nome: "Conferir" });
      await substituirItens(db, empresaA, fluxo.id, etapa.id, "RESPONSAVEL", [
        { departamentoId: departamento },
        { pessoaId: pessoa },
      ]);

      const completo = (await lerFluxo(db, empresaA, fluxo.id))!;
      const itens = completo.etapas.find((e) => e.id === etapa.id)!.itens;
      expect(itens.map((i) => i.nome)).toEqual(["Faturamento", "Ana Souza"]);
      expect(itens[0].departamentoId).toBe(departamento);
      expect(itens[1].pessoaId).toBe(pessoa);
    });

    it("sem nome e sem vínculo, o item continua sendo recusado", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Nem nome", categoria: "Teste" }, AUTOR);
      const etapa = await criarEtapa(db, empresaA, fluxo.id, { nome: "Conferir" });
      await expect(
        substituirItens(db, empresaA, fluxo.id, etapa.id, "RESPONSAVEL", [{ descricao: "só isto" }]),
      ).rejects.toBeInstanceOf(RecusaDeFluxo);
    });

    /*
      A chave estrangeira já barraria; o que este caso prova é que a recusa
      chega como frase do módulo, e não como violação de constraint do driver.
    */
    it("um cadastro que não existe é recusado com frase, não com erro de banco", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Fantasma", categoria: "Teste" }, AUTOR);
      await expect(
        criarEtapa(db, empresaA, fluxo.id, {
          nome: "Conferir",
          departamentoId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toBeInstanceOf(RecusaDeFluxo);
    });

    it("duplicar um fluxo leva os vínculos junto", async () => {
      const fluxo = await criarFluxo(db, empresaA, { nome: "Original", categoria: "Teste" }, AUTOR);
      await criarEtapa(db, empresaA, fluxo.id, {
        nome: "Conferir",
        departamentoId: departamento,
        cargoId: cargo,
      });

      const copia = await duplicarFluxo(db, empresaA, fluxo.id, "Cópia com cadastro", AUTOR);
      const completo = (await lerFluxo(db, empresaA, copia.id))!;
      expect(completo.etapas[0].departamentoId).toBe(departamento);
      expect(completo.etapas[0].area).toBe("Faturamento");
    });
  });
});
