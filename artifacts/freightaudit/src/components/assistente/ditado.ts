import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Falar a pergunta em vez de digitá-la.
 *
 * **O reconhecimento é do navegador, e nada sai daqui para este produto.** O
 * Chrome e o Edge expõem `SpeechRecognition`, que grava o microfone e devolve
 * texto; o áudio vai para o serviço de reconhecimento do próprio navegador e
 * volta transcrito. O FreightCheck recebe **texto** — o mesmo texto que a
 * pessoa digitaria — e não guarda, não sobe e nem sequer chega a ver o áudio.
 * Por isso não há rota nova, nem upload, nem permissão de servidor: o botão de
 * microfone escreve no campo, e o campo continua sendo o único caminho até a
 * pergunta.
 *
 * **O botão não aparece onde a coisa não existe.** O Firefox não implementa a
 * API, e o Safari a implementa com o prefixo `webkit`. Um microfone que não
 * grava é pior do que microfone nenhum: quem clica não descobre que o navegador
 * é o problema, descobre que "o Assistente está quebrado". `ditadoDisponivel()`
 * decide isso antes de a tela desenhar o botão.
 *
 * **A permissão é do navegador e é dele que vem a recusa.** Negar o microfone
 * devolve `not-allowed`, e a tela precisa dizer isso com todas as letras: é a
 * única falha aqui que se conserta fora do produto, na barra de endereço.
 */

/*
  Os tipos da Web Speech API não estão no `lib.dom` que este projeto usa, e o
  `webkitSpeechRecognition` do Safari não está em nenhum. São declarados aqui
  com o mínimo que a tela consome — declarar mais seria inventar contrato para
  campos que ninguém lê.
*/
interface ResultadoDeFala {
  0: { transcript: string };
}

interface EventoDeFala {
  results: { length: number; [i: number]: ResultadoDeFala };
}

interface EventoDeErroDeFala {
  error: string;
}

interface Reconhecedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: EventoDeFala) => void) | null;
  onerror: ((e: EventoDeErroDeFala) => void) | null;
  onend: (() => void) | null;
}

type FabricaDeReconhecedor = new () => Reconhecedor;

/*
  Lido de `globalThis`, e não de `window`: no navegador os dois são o mesmo
  objeto, e fora dele — num teste, numa renderização sem DOM — `window` nem
  existe, o que faria a simples leitura lançar antes de haver o que responder.
*/
function fabrica(): FabricaDeReconhecedor | null {
  const janela = globalThis as unknown as Record<string, FabricaDeReconhecedor | undefined>;
  return janela.SpeechRecognition ?? janela.webkitSpeechRecognition ?? null;
}

/** Se este navegador transcreve fala. Decide se o microfone é desenhado. */
export function ditadoDisponivel(): boolean {
  return fabrica() !== null;
}

/**
 * O texto que já estava no campo, mais o que foi dito.
 *
 * Ditar não apaga o que a pessoa digitou antes de clicar no microfone: a fala
 * **continua** a frase. O espaço entra só quando falta um — sem isto, ditar
 * depois de um rascunho cola as duas palavras, e ditar sobre um campo vazio
 * começa a pergunta com um espaço à toa.
 */
export function juntarDitado(base: string, falado: string): string {
  const dito = falado.trim();
  if (!dito) return base;
  if (!base) return dito;
  return /\s$/.test(base) ? base + dito : `${base} ${dito}`;
}

/** Por que o ditado parou, quando ele não parou porque alguém mandou. */
const MOTIVOS: Record<string, string> = {
  "not-allowed": "O navegador bloqueou o microfone. Libere o acesso na barra de endereço.",
  "service-not-allowed":
    "O navegador bloqueou o microfone. Libere o acesso na barra de endereço.",
  "audio-capture": "Nenhum microfone foi encontrado neste computador.",
  network: "O reconhecimento de fala não conseguiu falar com o serviço do navegador.",
  "no-speech": "Não ouvi nada. Tente de novo mais perto do microfone.",
};

export interface Ditado {
  disponivel: boolean;
  ouvindo: boolean;
  erro: string | null;
  alternar: () => void;
  /** Fecha o microfone e esquece o rascunho — ver `encerrar`. */
  encerrar: () => void;
}

/**
 * O microfone do composer, com o texto indo para o campo enquanto se fala.
 *
 * **O rascunho de referência é o do instante em que o microfone abriu.** A cada
 * resultado a API devolve a frase inteira reconhecida até ali — inclusive a
 * parte que ainda pode mudar. Reescrever `base + transcrição` a cada evento faz
 * a correção do reconhecedor aparecer no campo; concatenar cada pedaço faria a
 * frase duplicar assim que ele mudasse de ideia.
 */
export function useDitado({
  valor,
  aoTexto,
}: {
  valor: string;
  aoTexto: (texto: string) => void;
}): Ditado {
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const reconhecedor = useRef<Reconhecedor | null>(null);
  const base = useRef("");
  /*
    O valor atual do campo por referência, e não por dependência: os callbacks
    do reconhecedor são registrados uma vez, quando ele começa, e uma
    dependência aqui os deixaria presos ao rascunho daquele instante.
  */
  const atual = useRef(valor);
  atual.current = valor;

  const aoTextoRef = useRef(aoTexto);
  aoTextoRef.current = aoTexto;

  useEffect(() => {
    // Sair da tela com o microfone aberto o deixaria gravando; `abort` é
    // imediato e não dispara `onend` com o efeito já desmontado.
    return () => reconhecedor.current?.abort();
  }, []);

  /*
    Enviar com o microfone aberto.

    `stop()` é uma parada gentil: o reconhecedor ainda entrega o que tinha, e
    esse resultado traz a frase **inteira** do começo da fala. Como enviar
    esvazia o campo, esse último evento reescreveria a pergunta que acabou de
    ser enviada — foi o que se via: a frase reaparecia sozinha no composer.
    Aqui a parada é `abort()`, que descarta o pendente, e os callbacks são
    desligados antes para que nem um evento já na fila volte a escrever.
  */
  const encerrar = useCallback(() => {
    const r = reconhecedor.current;
    if (!r) return;
    reconhecedor.current = null;
    base.current = "";
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    r.abort();
    setOuvindo(false);
  }, []);

  const alternar = useCallback(() => {
    if (reconhecedor.current) {
      reconhecedor.current.stop();
      return;
    }

    const Fabrica = fabrica();
    if (!Fabrica) return;

    const r = new Fabrica();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    base.current = atual.current;

    /*
      A frase é remontada do começo a cada evento, e não acumulada pedaço a
      pedaço. Em `continuous`, o reconhecedor volta atrás: um trecho ainda não
      final pode ser reescrito no evento seguinte, e somar os pedaços deixaria
      as duas versões no campo. Reler `results` inteiro é a transcrição de
      agora, que é a única que interessa.
    */
    r.onresult = (e) => {
      let falado = "";
      for (let i = 0; i < e.results.length; i += 1) {
        falado += e.results[i][0].transcript;
      }
      aoTextoRef.current(juntarDitado(base.current, falado));
    };
    r.onerror = (e) => {
      setErro(MOTIVOS[e.error] ?? "O reconhecimento de fala falhou.");
    };
    r.onend = () => {
      reconhecedor.current = null;
      setOuvindo(false);
    };

    setErro(null);
    reconhecedor.current = r;
    setOuvindo(true);
    r.start();
  }, []);

  return { disponivel: ditadoDisponivel(), ouvindo, erro, alternar, encerrar };
}
