import type { RequestHandler } from "express";

/**
 * O teto de perguntas do Assistente — a única rota do produto que custa dinheiro
 * por chamada.
 *
 * **Por que só aqui.** Nenhuma outra rota deste servidor tem custo marginal:
 * uma consulta a mais é uma consulta a mais no Postgres ao lado. `/assistant/ask`
 * é diferente — cada chamada vira uma ida ao modelo, e a medição da auditoria de
 * 17/09/2026 pôs número nisso: ~US$ 0,03 a US$ 0,08 por pergunta no caminho do
 * planejador, e um teto de US$ 2,40 por pergunta no caminho do agente, que é o
 * limite de 400.000 tokens de entrada acumulados (`lib/assistant/src/agente.ts`).
 * Sem teto, uma sessão autenticada num laço é uma fatura, e nada no produto
 * reclamaria antes dela chegar.
 *
 * **O que isto não é.** Não é defesa contra abuso anônimo — a rota já exige
 * sessão, e quem chega aqui é uma conta da casa. É um **freio por conta**, do
 * tipo que evita o laço acidental (um script de teste, uma tela em retry, um
 * `for` colado no terminal) e limita o estrago do proposital. A defesa contra
 * quem não deveria estar perguntando é o portão de permissão, que roda antes.
 *
 * **Em memória, por processo, e é escolha.** É a mesma decisão — e a mesma
 * justificativa — do contador de senha errada em `routes/auth.ts`: o produto
 * roda um processo, contar no banco só mudaria alguma coisa com vários, e uma
 * escrita por pergunta para vigiar uma leitura é o tipo de custo que não se
 * paga. Se um dia houver mais de um processo, este é o arquivo a trocar, e a
 * troca é de dentro: quem chama não muda.
 *
 * **Duas contas, porque são dois jeitos de gastar.** A janela limita o
 * **volume** (muitas perguntas ao longo de minutos); as simultâneas limitam a
 * **largura** (muitas perguntas ao mesmo tempo, que é o laço acidental). Um
 * limite só deixaria passar exatamente o outro caso.
 *
 * O 429 diz quanto falta esperar, em `Retry-After` e no corpo: um limite que não
 * diz quando solta manda a pessoa tentar de novo em intervalos aleatórios, que é
 * a forma mais cara de ela descobrir sozinha.
 */

/** Quantas perguntas uma conta faz na janela. */
const TETO_NA_JANELA = numeroDoAmbiente("ASSISTENTE_TETO_POR_JANELA", 30);

/** O tamanho da janela, em milissegundos. */
const JANELA_MS = numeroDoAmbiente("ASSISTENTE_JANELA_MS", 5 * 60 * 1000);

/**
 * Quantas perguntas da mesma conta podem estar em voo.
 *
 * Duas, e não uma: a tela abre uma pergunta por vez, mas um recarregamento no
 * meio de uma resposta longa deixa a anterior ainda correndo por alguns
 * segundos, e recusar a próxima seria transformar um F5 em erro.
 */
const TETO_SIMULTANEO = numeroDoAmbiente("ASSISTENTE_SIMULTANEAS", 2);

function numeroDoAmbiente(nome: string, padrao: number): number {
  const bruto = Number(process.env[nome]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : padrao;
}

interface Uso {
  /** Os instantes das perguntas dentro da janela, do mais antigo ao mais novo. */
  instantes: number[];
  emVoo: number;
}

const porConta = new Map<string, Uso>();

/**
 * Limpa o que envelheceu, e devolve o uso da conta.
 *
 * A poda acontece na leitura, e não num temporizador: um `setInterval` num
 * servidor que roda por semanas é uma referência que segura o processo vivo
 * para varrer um mapa que quase sempre está vazio. Aqui o custo é pago por quem
 * pergunta, e é proporcional ao que aquela conta perguntou.
 */
function usoDe(conta: string, agora: number): Uso {
  const uso = porConta.get(conta) ?? { instantes: [], emVoo: 0 };
  uso.instantes = uso.instantes.filter((t) => agora - t < JANELA_MS);
  porConta.set(conta, uso);
  return uso;
}

/** Só para os testes: esquece tudo o que foi contado. */
export function esquecerOsTetos(): void {
  porConta.clear();
}

/**
 * O freio, montado na rota de perguntar.
 *
 * Ele solta a vaga no fim da resposta — `res.on("close")` e não `"finish"`,
 * porque a resposta em fluxo (SSE) só termina quando a conexão fecha, e contar
 * pelo `finish` deixaria a vaga presa até o timeout de quem desistiu no meio.
 */
export const tetoDoAssistente: RequestHandler = (req, res, next) => {
  const conta = req.user?.id;
  /*
    Sem sessão não há conta a limitar, e não há o que proteger: a rota exige
    sessão antes disto, e um pedido que chegasse aqui sem ela já teria sido
    recusado com 401.
  */
  if (!conta) {
    next();
    return;
  }

  const agora = Date.now();
  const uso = usoDe(conta, agora);

  if (uso.emVoo >= TETO_SIMULTANEO) {
    res.status(429).json({
      error:
        "Você já tem uma pergunta sendo respondida. Espere a resposta chegar antes de enviar outra.",
      code: "ASSISTENTE_EM_VOO",
    });
    return;
  }

  if (uso.instantes.length >= TETO_NA_JANELA) {
    const maisAntiga = uso.instantes[0]!;
    const faltamMs = JANELA_MS - (agora - maisAntiga);
    const faltamS = Math.max(1, Math.ceil(faltamMs / 1000));
    res.setHeader("Retry-After", String(faltamS));
    res.status(429).json({
      error:
        `Você fez ${TETO_NA_JANELA} perguntas nos últimos ${Math.round(JANELA_MS / 60000)} ` +
        `minutos, que é o limite. Tente de novo em ${faltamS} segundo(s).`,
      code: "ASSISTENTE_TETO",
      retryAfterSegundos: faltamS,
    });
    return;
  }

  uso.instantes.push(agora);
  uso.emVoo += 1;

  let soltou = false;
  const soltar = () => {
    if (soltou) return;
    soltou = true;
    const atual = porConta.get(conta);
    if (atual) atual.emVoo = Math.max(0, atual.emVoo - 1);
  };
  res.on("close", soltar);
  res.on("finish", soltar);

  next();
};
