import { Router } from "express";
import { sql } from "drizzle-orm";
import {
  cadastrarUnidade,
  cnpjComMascara,
  CnpjInvalido,
  CnpjJaCadastrado,
  db,
  listarUnidadesCanonicas,
  UnidadeSemNome,
  type UnidadeCanonica,
} from "@workspace/db";
import { conciliarIdentidadeDasCompetencias } from "@workspace/fechamento";

/**
 * ADMINISTRAÇÃO → UNIDADES — o cadastro mestre, e o que ele **não** é.
 *
 * **A tela existia e não era cadastro.** Ela lia `/contexts`, que agrupa os
 * snapshots vivos por `(scope_hash, canal)`: unidade ali era *unidade que
 * entregou vigência*, e quem nunca mandou export não aparecia. Isso está certo
 * para a Auditoria — lá a pergunta é o que os arquivos sustentam — e é uma
 * parede para todo o resto, porque a unidade existe antes do primeiro arquivo.
 *
 * `/contexts` continua exatamente como estava: é o seletor de contexto de
 * Parâmetros, Comparar, Alterações e do Resumo executivo, e repropô-lo mudaria
 * as quatro telas junto. Esta rota é nova e responde outra pergunta.
 *
 * **Os três estados, e por que eles não podem ser dois.**
 *
 * - `CADASTRADA` — alguém a cadastrou, com CNPJ conferido, e nenhum arquivo dela
 *   chegou ainda. É o estado do dia em que a aba de Excel vem antes do export;
 * - `CADASTRADA_E_IMPORTADA` — cadastrada **e** com acervo, com os dois CNPJs
 *   coincidindo. É o estado normal de regime;
 * - `DETECTADA` — um snapshot declarou este CNPJ e ninguém a cadastrou. **Não é
 *   unidade canônica**, e é o ponto inteiro desta separação: um arquivo é
 *   evidência, não autoridade. Se aparecer num arquivo bastasse, a identidade
 *   do produto voltaria a ser derivada de importação, que é o desenho que esta
 *   mudança desfaz. A linha oferece "Cadastrar" com o CNPJ preenchido — a
 *   evidência é determinística e poupa a digitação —, e quem confirma é gente.
 *
 * Existe um quarto, e ele é o mais importante de ter nome: `CONFLITO`. Cadastro
 * e snapshot dizendo CNPJs diferentes para o que a tela junta. Nenhum lado
 * sobrescreve o outro; a tela mostra os dois e alguém decide.
 */

const router = Router();

/** Como uma unidade aparece na tela de Administração. */
interface LinhaDaAdministracao {
  /** `null` quando ela só foi detectada — ainda não há identidade canônica. */
  id: string | null;
  nome: string;
  cnpj: string;
  cnpjFormatado: string;
  estado: "CADASTRADA" | "CADASTRADA_E_IMPORTADA" | "DETECTADA";
  /** Quantas vigências o acervo tem dela. Zero é legítimo e comum. */
  vigencias: number;
}

/**
 * As unidades que o acervo **detectou** — CNPJ vindo de `canonical_scope`.
 *
 * A leitura é do escopo canônico e não de `scope.code`: aquele é o texto cru da
 * célula, e o mesmo CNPJ mascarado num arquivo e limpo em outro daria duas
 * unidades. `canonical_scope` já passou por `normalizeDocumento` e é protegido
 * por `check` no banco — é a única forma determinística que o acervo oferece, e
 * é por isso que ela é aceitável como evidência.
 *
 * Nada aqui converte `081-0443`, `443` ou nome nenhum: unidade cujo arquivo não
 * trouxe CNPJ simplesmente não é detectada, e é o certo.
 */
async function detectadasNoAcervo(): Promise<
  { cnpj: string; nome: string | null; vigencias: number }[]
> {
  const { rows } = await db.execute<{ cnpj: string; nome: string | null; vigencias: number }>(sql`
    SELECT escopo->>'code'                              AS cnpj,
           max(sc.name)                                 AS nome,
           count(DISTINCT s.effective_date)::int        AS vigencias
      FROM snapshot s
      CROSS JOIN LATERAL jsonb_array_elements(s.canonical_scope) AS escopo
      LEFT JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      LEFT JOIN scope sc          ON sc.id = ss.scope_id
                                 AND sc.scope_type = 'UNIDADE'
     WHERE s.status <> 'SUPERSEDED'
       AND escopo->>'scopeType' = 'UNIDADE'
       AND escopo->>'code' ~ '^[0-9]{14}$'
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((l) => ({ ...l, vigencias: Number(l.vigencias) }));
}

/**
 * A união: o cadastro mestre mais o que o acervo detectou.
 *
 * **Existência da unidade e existência de dados são conceitos diferentes**, e a
 * coluna `vigencias` é onde a diferença aparece. Uma unidade cadastrada com zero
 * vigências não está incompleta — ela existe e ainda não importou nada.
 */
router.get("/unidades/canonicas", async (_req, res): Promise<void> => {
  const [cadastradas, detectadas] = await Promise.all([
    listarUnidadesCanonicas(db),
    detectadasNoAcervo(),
  ]);

  const porCnpj = new Map(detectadas.map((d) => [d.cnpj, d]));
  const linhas: LinhaDaAdministracao[] = cadastradas.map((u: UnidadeCanonica) => {
    const noAcervo = porCnpj.get(u.cnpj);
    porCnpj.delete(u.cnpj);
    return {
      id: u.id,
      nome: u.nome,
      cnpj: u.cnpj,
      cnpjFormatado: cnpjComMascara(u.cnpj),
      estado: noAcervo ? "CADASTRADA_E_IMPORTADA" : "CADASTRADA",
      vigencias: noAcervo?.vigencias ?? 0,
    };
  });

  /* O que sobrou do acervo é detectado e não cadastrado — o convite ao cadastro. */
  for (const d of porCnpj.values()) {
    linhas.push({
      id: null,
      nome: d.nome ?? "",
      cnpj: d.cnpj,
      cnpjFormatado: cnpjComMascara(d.cnpj),
      estado: "DETECTADA",
      vigencias: d.vigencias,
    });
  }

  linhas.sort((a, b) => (a.nome || a.cnpj).localeCompare(b.nome || b.cnpj, "pt-BR"));
  res.json(linhas);
});

/**
 * Cadastra uma unidade canônica — o único caminho que cria identidade.
 *
 * Serve os dois fluxos com o mesmo corpo: o cadastro do zero e a confirmação de
 * uma unidade detectada, que chega aqui com o CNPJ que o acervo declarou. São o
 * mesmo ato — alguém afirma que esta unidade existe —, e por isso não são duas
 * rotas: a segunda só poupa digitação.
 */
router.post("/unidades/canonicas", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const nome = typeof corpo.nome === "string" ? corpo.nome : "";
  const cnpj = typeof corpo.cnpj === "string" ? corpo.cnpj : "";

  try {
    const criada = await cadastrarUnidade(db, { nome, cnpj });
    /*
      Cadastrar a unidade é um dos momentos em que a identidade passa a ser
      conhecida — e, até aqui, o único que não escrevia nada no Fechamento. A
      competência aberta com o CNPJ desta unidade no campo de código ficava sem
      `unidade_id` para sempre, esperando um clique manual que ninguém sabia
      que existia. A conciliação é idempotente e não adivinha: associa a que
      **é** esta unidade e lista as demais. Ver `identidade-da-competencia.ts`.
    */
    const conciliacao = await conciliarIdentidadeDasCompetencias(db);
    res.status(201).json({ ...criada, conciliacao });
  } catch (erro) {
    if (erro instanceof CnpjJaCadastrado) {
      res.status(409).json({ error: erro.message, codigo: "CNPJ_JA_CADASTRADO" });
      return;
    }
    if (erro instanceof CnpjInvalido) {
      res.status(400).json({ error: erro.message, codigo: `CNPJ_${erro.recusa}` });
      return;
    }
    if (erro instanceof UnidadeSemNome) {
      res.status(400).json({ error: erro.message, codigo: "UNIDADE_SEM_NOME" });
      return;
    }
    throw erro;
  }
});

export default router;
