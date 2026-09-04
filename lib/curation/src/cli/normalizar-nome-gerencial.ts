/**
 * O preflight e a normalização do Nome Gerencial, pela linha de comando.
 *
 *   DATABASE_URL=... pnpm run normalizar:nome-gerencial
 *   DATABASE_URL=... pnpm run normalizar:nome-gerencial -- --aplicar "voce@exemplo.com"
 *   DATABASE_URL=... pnpm run normalizar:nome-gerencial -- --desfazer
 *
 * Sem argumento, ele **não escreve nada**: mede o banco e imprime os números
 * que decidem se a normalização é segura ali. É de propósito que o modo padrão
 * seja o inofensivo — quem digita o comando sem ler a documentação recebe uma
 * medição, não uma alteração.
 *
 * Ver `nome-gerencial.ts` para o porquê de isto ser uma rotina e não uma
 * migration.
 */
import { createDb } from "@workspace/db";
import {
  desfazerNormalizacaoDoNomeGerencial,
  normalizarNomeGerencial,
  preflightNomeGerencial,
} from "../nome-gerencial";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Informe o banco: DATABASE_URL=... pnpm run normalizar:nome-gerencial");
  process.exit(1);
}

const argv = process.argv.slice(2);
const aplicar = argv.indexOf("--aplicar");
const desfazer = argv.includes("--desfazer");
const incluirAnteriores = argv.includes("--incluir-anteriores-ao-log");

const { db, pool } = createDb(url);

const data = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 19) : "—");

try {
  if (desfazer) {
    const r = await desfazerNormalizacaoDoNomeGerencial(db);
    console.log(`Restaurados ${r.restaurados} nomes gerenciais a partir do registro.`);
    if (r.semAtributo > 0) {
      console.log(
        `${r.semAtributo} linha(s) do registro apontam para atributos que já não existem — nada a restaurar nelas.`,
      );
    }
  } else if (aplicar !== -1) {
    const actor = argv[aplicar + 1];
    if (!actor || actor.startsWith("--")) {
      console.error('Informe o responsável: --aplicar "voce@exemplo.com"');
      process.exit(1);
    }
    const antes = await preflightNomeGerencial(db);
    console.log(
      `Vai normalizar ${incluirAnteriores ? antes.seriamNormalizadosIncluindoAnteriores : antes.seriamNormalizados} coluna(s).`,
    );
    const r = await normalizarNomeGerencial(db, {
      actor,
      incluirAnterioresAoLog: incluirAnteriores,
    });
    console.log(`Normalizados: ${r.normalizados}`);
    console.log("Para desfazer: --desfazer (restaura exatamente estas linhas).");
  } else {
    const p = await preflightNomeGerencial(db);
    console.log("PREFLIGHT — nada foi escrito.\n");
    console.log(`Total de atributos ........................ ${p.totalDeAtributos}`);
    console.log(`Com display_name = source_name ............ ${p.iguaisAoNomeDeOrigem}`);
    console.log(`  ...com evento de display_name (humano) .. ${p.comEventoDeNomeGerencial}`);
    console.log(`  ...com qualquer curadoria humana ........ ${p.comQualquerCuradoria}`);
    console.log(`  ...anteriores ao 1º evento de curadoria . ${p.anterioresAoPrimeiroEvento}`);
    console.log(`\nSeriam normalizados (conservador) ......... ${p.seriamNormalizados}`);
    console.log(`Seriam normalizados (incluindo anteriores) . ${p.seriamNormalizadosIncluindoAnteriores}`);
    console.log(`Já normalizados por execução anterior ..... ${p.jaNormalizados}`);
    console.log(`\n1º evento de curadoria .................... ${data(p.primeiroEventoDeCuradoria)}`);
    console.log(`Atributo mais antigo ...................... ${data(p.primeiroAtributo)}`);
    const bloco = (titulo: string, fatias: { chave: string; seriamNormalizados: number }[]) => {
      console.log(`\n${titulo}`);
      if (fatias.length === 0) console.log("  (nenhuma)");
      for (const f of fatias.slice(0, 20)) {
        console.log(`  ${f.chave.padEnd(40)} ${f.seriamNormalizados}`);
      }
    };
    bloco("Por tipo de equipamento:", p.porTipoDeEquipamento);
    bloco("Por mês de criação do atributo:", p.porMesDeCriacao);
    bloco("Por importação que viu a coluna primeiro:", p.porImportacao);
  }
} finally {
  await pool.end();
}
