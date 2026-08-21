import { migrarComReparo } from "./fila";
import { diagnosticar } from "./diagnostico";

/**
 * Aplicar as migrations pela linha de comando.
 *
 * Arquivo separado de propósito: enquanto isto vivia dentro de `migrate.ts`, o
 * bundle do api-server carregava junto um CLI que se achava executado
 * diretamente e derrubava o servidor. Um módulo que só é importado por quem
 * quer a função, e um módulo que só roda quando alguém o executa.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL must be set to run migrations.");
  process.exit(1);
}

/**
 * `--adotar-existentes` — a saída para o registro de migrations perdido.
 *
 * Um banco que tem o schema e não tem o registro trava a fila na 0000: ela
 * esbarra num tipo que já existe, para ali, e nenhuma migration nova entra
 * nunca mais. Com esta bandeira, toda migration cujos objetos já estão no
 * banco é registrada sem rodar, e a fila segue para as que faltam de verdade.
 *
 * É bandeira, e não comportamento padrão, porque a evidência que a sustenta —
 * o schema estar como a migration o deixaria — não prova que um backfill
 * rodou. Declarar isso é ato de quem conhece o banco; a partida do servidor
 * não pode decidir por ninguém. As adotadas que mexem em dados saem nomeadas
 * no fim, para conferência à mão.
 */
const adoptExisting = process.argv.includes("--adotar-existentes");

migrarComReparo(url, undefined, { adoptExisting })
  .then(({ report, reparo }) => {
    /*
      O reparo vem antes de tudo o que a fila fez, e em tom de alarme: ele só
      existe quando algo de fora da fila derrubou objeto de migration
      registrada. A estrutura voltou; o conteúdo dela, não.
    */
    if (reparo && reparo.aplicados.length > 0) {
      console.warn(
        `A fila parou porque faltava estrutura de migration já registrada. ` +
          `Reposto antes de seguir: ${reparo.aplicados.map((a) => a.alvo).join(", ")}.`,
      );
      console.warn(
        `Isso é rastro de remoção por fora da fila (tipicamente o Provision do ` +
          `Publishing). O que voltou foi a estrutura — as linhas que essas ` +
          `tabelas tinham não voltam por aqui. Confira o backup antes de dar o ` +
          `banco por bom.\n`,
      );
    }
    if (reparo && reparo.semComando.length > 0) {
      console.error(
        `Sem comando levantável para: ${reparo.semComando.join(", ")}.`,
      );
    }
    if (reparo && reparo.falhas.length > 0) {
      console.error(
        `O banco recusou a reposição de: ` +
          `${reparo.falhas.map((f) => `${f.alvo}${f.code ? ` (${f.code})` : ""}`).join(", ")}.`,
      );
    }

    /*
      O que entrou sai nomeado, e não como "Migrations applied.". Agora que cada
      migration é uma transação sua, "deu certo" e "deu certo até a 0007" são
      desfechos diferentes, e quem roda isto precisa distinguir os dois sem ir
      ao banco conferir.
    */
    if (report.adopted.length > 0) {
      console.log(
        `Adotadas sem rodar (o banco já as tinha): ${report.adopted.join(", ")}.`,
      );
      if (report.adoptedWithData.length > 0) {
        console.warn(
          `\nAtenção: ${report.adoptedWithData.join(", ")} também mexem em dados, ` +
            `e o schema não diz se essa parte rodou. Confira à mão o efeito delas.`,
        );
      }
    }

    if (report.applied.length > 0) {
      console.log(`Migrations aplicadas: ${report.applied.join(", ")}.`);
    } else if (!report.failure && report.adopted.length === 0) {
      console.log(
        `Nada a aplicar: as ${report.alreadyApplied.length} migrations já estavam no banco.`,
      );
    }

    if (report.failure) {
      console.error(
        `\nParou em ${report.failure.tag}` +
          (report.failure.code ? ` (SQLSTATE ${report.failure.code})` : "") +
          `: ${report.failure.message}`,
      );
      if (report.pending.length > 1) {
        console.error(
          `Não foram tentadas: ${report.pending.slice(1).join(", ")}.`,
        );
      }
      /*
        A dica sai de `diagnosticar`, e não de uma conferência escrita aqui.
        Enquanto esta linha tinha a sua própria versão da assinatura do registro
        perdido, existiam duas no repositório — esta e a do `/api/healthz` —,
        com critérios que já divergiam num detalhe. Duas respostas possíveis
        para a mesma pergunta é exatamente o que produziu, na interface, um
        aviso mandando adotar e outro mandando reiniciar.
      */
      const diagnostico = diagnosticar({
        configurada: true,
        alcancavel: true,
        pendentes: report.pending,
        aplicadas:
          report.alreadyApplied.length +
          report.applied.length +
          report.adopted.length,
        falha: {
          tag: report.failure.tag,
          ...(report.failure.code ? { code: report.failure.code } : {}),
        },
      });

      if (diagnostico.estado === "REGISTRO_PERDIDO") {
        console.error(`\n${diagnostico.resumo} ${diagnostico.risco.texto}`);
        console.error(
          `\n${diagnostico.acao?.texto} Aqui, é rodar de novo com --adotar-existentes.`,
        );
      }
      process.exit(1);
    }

    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
