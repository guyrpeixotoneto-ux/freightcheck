#!/usr/bin/env node
/**
 * A rodada do PR 7, inteira, num comando.
 *
 *     DATABASE_URL=… ANTHROPIC_API_KEY=… node scripts/pr7.mjs
 *
 * **Por que um script e não sete comandos.** A sequência tem uma ordem que
 * importa e um passo que só faz sentido se o anterior passou: medir o
 * planejador, medir o agente, comparar, e — só se o portão aprovar — rodar a
 * exploratória. Executada à mão, a parte fácil de errar é rodar o `depois` sem
 * `ASSISTENTE_AGENTE=1` e comparar o planejador com ele mesmo, que produz um
 * relatório verossímil e sem valor. Aqui a variável é posta por processo, e a
 * comparação recusa duas rodadas do mesmo caminho.
 *
 * **Ele não vira a chave.** O último passo escreve o veredito e para. Ligar
 * `ASSISTENTE_AGENTE=1` em produção continua sendo um ato humano, feito depois
 * de ler o relatório — e é o único ato desta migração que muda o que o usuário
 * vê.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * A chave que importa é a do **processo da API**, não a do shell.
 *
 * As duas podem divergir, e no Replit divergem com facilidade: o Secret é
 * injetado no processo do servidor, e um `export` feito no Shell vale só para
 * o shell. Um script que confira apenas o próprio ambiente diria "tudo certo" e
 * mediria um agente que a aplicação não consegue usar — ou o contrário,
 * recusaria rodar num ambiente em que a API está perfeitamente configurada.
 *
 * `GET /api/assistant/capabilities` é a resposta da própria API sobre si mesma.
 * Ela é opcional de propósito: nem toda rodada tem servidor de pé, e a bateria
 * não precisa dele — mas quando ele existe, é ele quem tem a palavra.
 */
async function capabilities() {
  const candidatos = [
    process.env.FREIGHTCHECK_URL,
    "http://127.0.0.1:8080",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:3000",
  ].filter(Boolean);

  for (const base of candidatos) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/assistant/capabilities`, {
        signal: AbortSignal.timeout(4000),
        ...(process.env.COOKIE_DE_SESSAO ? { headers: { cookie: process.env.COOKIE_DE_SESSAO } } : {}),
      });
      if (res.status === 401) return { base, status: 401 };
      if (!res.ok) continue;
      const corpo = await res.json();
      return { base, status: res.status, ia: corpo.ia === true, modelo: corpo.modelo ?? null };
    } catch {
      /* servidor ausente neste candidato: tenta o próximo */
    }
  }
  return null;
}

/**
 * O destino é absoluto, e essa é a única forma de ele funcionar.
 *
 * `pnpm --filter` roda o comando **no diretório do pacote** — `lib/assistant`,
 * e não na raiz. Um caminho relativo é criado aqui e interpretado lá: a pasta
 * nasce em `~/workspace/relatorios-pr7`, o CLI tenta escrever em
 * `~/workspace/lib/assistant/relatorios-pr7`, e o que se vê é um `ENOENT` num
 * script que acabou de criar a pasta com sucesso.
 *
 * Resolver aqui, uma vez, é melhor do que ensinar cada CLI a criar o pai do
 * arquivo que lhe pediram: o dono da decisão de onde os relatórios moram é
 * quem orquestra a rodada.
 */
const PASTA = path.resolve(process.env.PR7_SAIDA ?? "relatorios-pr7");
const filtro = ["--filter", "@workspace/assistant"];

async function conferirAmbiente() {
  const faltando = [];
  if (!process.env.DATABASE_URL && !process.env.ASSISTANT_EVAL_DATABASE_URL) {
    faltando.push(
      "DATABASE_URL — o banco com as planilhas importadas (o mesmo que a aplicação usa)",
    );
  }
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    faltando.push(
      "ANTHROPIC_API_KEY — sem ela o agente não roda, e a comparação mede o " +
        "planejador contra ele mesmo",
    );
  }
  /*
    O veredito da API vem antes do veredito do shell, quando existe. Uma API que
    responde `ia: true` prova o que interessa; um shell sem a variável, ao lado
    dela, é só um shell sem a variável.
  */
  const cap = await capabilities();
  if (cap) {
    if (cap.status === 401) {
      console.log(`\n  · API em ${cap.base} respondeu 401 — sessão exigida.`);
      console.log("    Passe COOKIE_DE_SESSAO=… (cookie `freightcheck_session` do navegador)");
      console.log("    para que este script possa conferir `capabilities`.\n");
    } else {
      console.log(`\n  · API em ${cap.base}: ia=${cap.ia}${cap.modelo ? ` · ${cap.modelo}` : ""}`);
      if (cap.ia === false) {
        console.error(
          "\n  O processo da API NÃO enxerga a chave, ainda que este shell a tenha.\n" +
            "  No Replit, o Secret precisa estar no ambiente do serviço, e o serviço\n" +
            "  precisa ter sido reiniciado depois de o Secret ser criado.\n",
        );
        process.exit(1);
      }
      /*
        API com chave e shell sem ela: a bateria roda neste processo, então é a
        variável **daqui** que ela usa. Dizer isso evita a confusão mais cara —
        um relatório inteiro de "planejador vs planejador" gerado num ambiente
        em que a aplicação estava certa o tempo todo.
      */
      if (cap.ia === true && faltando.some((f) => f.startsWith("ANTHROPIC_API_KEY"))) {
        console.error(
          "\n  A API tem a chave; este shell não. A bateria roda **neste** processo,\n" +
            "  então ela precisa da variável aqui também. No Replit:\n\n" +
            "      export ANTHROPIC_API_KEY=\"$ANTHROPIC_API_KEY\"\n\n" +
            "  ou rode a partir do mesmo ambiente que injeta os Secrets.\n",
        );
        process.exit(1);
      }
    }
  }

  if (faltando.length === 0) return;

  console.error("\nEsta rodada não pode acontecer neste ambiente. Falta:\n");
  for (const f of faltando) console.error(`  · ${f}`);
  console.error(
    "\nA rodada precisa acontecer onde a chave já existe — no Replit, ela está nos\n" +
      "Secrets e é injetada no processo do servidor. Pelo Shell de lá, as variáveis\n" +
      "já estão no ambiente e este script roda direto.\n",
  );
  process.exit(1);
}

function passo(titulo, script, args, env = {}) {
  console.log(`\n\x1b[1m▸ ${titulo}\x1b[0m`);
  try {
    execFileSync("pnpm", [...filtro, "run", script, "--", ...args], {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    return 0;
  } catch (erro) {
    return erro.status ?? 1;
  }
}

/**
 * Um passo que falha aborta a rodada — e nunca vira veredito.
 *
 * A primeira versão deste script ignorava o desfecho dos passos de medição e
 * só olhava o do portão. Numa rodada real isso produziu o pior resultado
 * possível: as três medições quebraram por schema desatualizado, o `comparar`
 * não achou os arquivos, saiu com código 2, e o script imprimiu **"O portão
 * reprovou — não vire a chave"**. Um veredito sobre uma rodada que não
 * aconteceu, escrito com a mesma confiança de um veredito de verdade.
 *
 * "Não medi" e "medi e reprovou" pedem ações opostas — a primeira é consertar o
 * ambiente, a segunda é consertar o agente — e é exatamente a distinção que
 * este produto inteiro existe para não borrar.
 */
function exigir(titulo, script, args, env = {}) {
  const codigo = passo(titulo, script, args, env);
  if (codigo === 0) return;
  console.error(
    `\n\x1b[31m✗ "${titulo}" falhou (código ${codigo}).\x1b[0m\n\n` +
      "  A rodada parou aqui e **nenhum veredito foi emitido** — não medir não é\n" +
      "  o mesmo que medir e reprovar. Olhe o erro acima: quando ele é de coluna\n" +
      "  inexistente, a fila de migrations do banco está atrás do código, e o\n" +
      "  conserto é `pnpm --filter @workspace/db run migrate`.\n",
  );
  process.exit(2);
}

await conferirAmbiente();

/*
  A pasta começa vazia, e isso não é higiene — é correção.

  Sem apagar, os arquivos de uma rodada anterior convivem com os desta, e
  distingui-los depende de alguém olhar o horário de modificação. Aconteceu:
  uma rodada quebrada deixou `comparacao.md` e `depois.json` para trás, a
  rodada seguinte reescreveu só o `antes.json` antes de ainda estar no passo 2,
  e o `cat comparacao.md` devolveu um veredito de duas horas antes — com a
  aparência exata de um veredito recém-produzido.

  Um relatório que sobrevive à rodada que o gerou é pior do que relatório
  nenhum: ele responde com confiança sobre uma medição que não existe mais.
*/
if (existsSync(PASTA)) rmSync(PASTA, { recursive: true, force: true });
mkdirSync(PASTA, { recursive: true });

/*
  As duas medições. A segunda com a variável ligada **só para este processo
  filho** — o que garante que a primeira mediu o planejador de verdade, e não um
  ambiente já contaminado por uma tentativa anterior.
*/
exigir("1/4 · baseline do planejador", "desfecho", [`--saida=${PASTA}/antes`], {
  ASSISTENTE_AGENTE: "",
});
exigir("2/4 · rodada do agente", "desfecho", [`--saida=${PASTA}/depois`], {
  ASSISTENTE_AGENTE: "1",
});
exigir("3/4 · trajetória do agente", "trajetoria", [`--saida=${PASTA}/trajetoria.md`], {
  ASSISTENTE_AGENTE: "1",
});

const veredito = passo("4/4 · o portão", "comparar", [
  `${PASTA}/antes.json`,
  `${PASTA}/depois.json`,
  `--saida=${PASTA}/comparacao.md`,
]);

/*
  A exploratória só roda se o portão aprovar, e a ordem é a razão.

  Ela mede como o agente conversa, e essa pergunta só faz sentido depois de "ele
  pode substituir o outro?". Rodá-la sobre um agente que regrediu produziria sete
  turnos de leitura agradável sobre algo que não vai entrar — e é assim que uma
  decisão ruim ganha material de apoio.
*/
/*
  ---- a bateria funda de investigação ---------------------------------------

  Ela roda **independentemente do veredito**, e a razão é que ela responde outra
  pergunta. O portão pergunta "o agente pode substituir o planejador?"; esta
  pergunta "quanta profundidade cada um alcança?" — e a resposta interessa
  inclusive (e principalmente) quando o portão reprova, porque é ela que diz se
  a regressão foi de profundidade ou de outra coisa.

  A régua é a de `encadeamento.ts`, a mesma dos dois lados: uma consulta só
  conta como encadeada quando um argumento dela não existia antes de outra
  voltar. É o que impede a leitura preguiçosa "o agente fez mais consultas, logo
  investigou mais".
*/
passo("extra · investigação funda (planejador × agente)", "investigacao", [
  `${PASTA}/investigacao.json`,
], { ASSISTENTE_AGENTE: "1" });

if (veredito === 0) {
  passo("extra · bateria exploratória (uma conversa)", "exploratoria", [
    `--saida=${PASTA}/exploratoria`,
  ], { ASSISTENTE_AGENTE: "1" });
}

console.log(`\n\x1b[1mRelatórios em ${PASTA}/\x1b[0m`);
console.log("  antes.md · depois.md · trajetoria.md · comparacao.md · investigacao.json" + (veredito === 0 ? " · exploratoria.md" : ""));
console.log(
  veredito === 0
    ? "\n\x1b[32mO portão aprovou.\x1b[0m Leia comparacao.md e exploratoria.md antes de ligar\n" +
        "ASSISTENTE_AGENTE=1 em produção. A virada é uma variável; a volta também.\n"
    : "\n\x1b[31mO portão reprovou.\x1b[0m comparacao.md nomeia cada regressão com a pergunta,\n" +
        "as falhas e as consultas que o agente fez. Não vire a chave.\n",
);
process.exit(veredito);
