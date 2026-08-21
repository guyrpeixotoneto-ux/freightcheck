/**
 * O eixo do transporte: a requisição chegou, e o que voltou era nosso?
 *
 * Estas frases viviam soltas dentro de `readJson`, em `throw new Error(...)` —
 * a mesma classe de defeito que, no eixo do banco, produziu dois avisos
 * contraditórios na mesma tela. Sem tipo e sem dono, não havia como testá-las
 * nem como impedir que a próxima divergisse.
 *
 * Toda resposta aqui precisa dizer que nada se perdeu: quem acabou de subir um
 * arquivo pergunta isso antes de qualquer outra coisa, e o silêncio faz alguém
 * reenviar por medo — que é como um upload vira dois.
 */
import { describe, expect, it } from "vitest";
import {
  ErroDeTransporte,
  diagnosticarTransporte,
  type TransporteObservado,
} from "@/lib/transporte";

describe("diagnosticarTransporte", () => {
  it("SEM_RESPOSTA: fetch rejeitou, não houve resposta para diagnosticar", () => {
    const d = diagnosticarTransporte({ naoCompletou: true });

    expect(d.estado).toBe("SEM_RESPOSTA");
    /*
      A ação é de quem está na tela — e isto **mudou de propósito**.

      Era `plataforma`, e a frase mandava abrir DevTools → Network ou rodar a
      sonda. Duas coisas erradas de uma vez: transferia o diagnóstico para quem
      só queria a lista, e admitia que o produto depende de alguém abrir o
      console para funcionar. Ele não depende — a chamada é repetida cinco vezes
      ao longo de 13,2s e a tela oferece o botão. Os instrumentos de investigação
      continuam nomeados, na `evidencia`, que é a letra miúda de engenharia.
    */
    expect(d.acao?.quem).toBe("operador");
    expect(d.acao?.texto).not.toMatch(/DevTools/);
    expect(d.acao?.comando).toBeUndefined();
    // A evidência precisa ensinar a separar as causas, porque o navegador
    // escreve todas como "Failed to fetch".
    expect(d.evidencia).toMatch(/ERR_CONNECTION_REFUSED/);
    expect(d.evidencia).toMatch(/CORS/);
    expect(d.evidencia).toMatch(/sonda-cold-start/);
  });

  /**
   * O aviso não pode afirmar o que o navegador não observou.
   *
   * Este era o defeito da mensagem, e ele tem nome: o texto dizia que o processo
   * "API Server" fora do ar estava **descartado** ("responderia 502 e apareceria
   * aqui como outro aviso") e que sobravam **exatamente três** causas. Nenhuma
   * das duas é observável de dentro do navegador — e neste produto a primeira
   * era falsa por construção, porque a `queryFn` compartilhada da casca traduzia
   * todo `!response.ok` em lista vazia, então um 502 nunca chegaria a virar
   * aviso nenhum. Ver `lib/contextos.ts`.
   *
   * A asserção é negativa de propósito, como a de `RESTABELECER_API` abaixo: o
   * que não pode voltar é a **afirmação**, e ela voltaria em qualquer nova
   * redação que se sentisse à vontade para concluir.
   */
  it("SEM_RESPOSTA não descarta causa nenhuma nem promete uma lista fechada", () => {
    const d = diagnosticarTransporte({ naoCompletou: true });
    const tudo = [d.resumo, d.evidencia, d.acao?.texto].filter(Boolean).join(" ");

    expect(tudo).not.toMatch(/descarta/i);
    expect(tudo).not.toMatch(/sobram/i);
    expect(tudo).not.toMatch(/três causas/i);
    // E precisa separar o que se sabe do que se supõe, em vez de misturar.
    expect(d.resumo).toMatch(/o que se sabe/i);
  });

  /**
   * A frase do navegador é a única pista de primeira mão que existe, e ela se
   * perdia: o `TypeError` subia cru e era reclassificado por `instanceof` lá na
   * frente, sem a mensagem. Agora `requisitar` (em `lib/api.ts`) a traz junto.
   */
  it("SEM_RESPOSTA carrega a frase que o navegador escreveu", () => {
    const d = diagnosticarTransporte({ naoCompletou: true, motivo: "Failed to fetch" });

    expect(d.evidencia).toMatch(/Failed to fetch/);
  });

  /**
   * Cancelamento não é queda.
   *
   * Uma navegação que desmonta a tela cancela a chamada em voo. Classificar isso
   * como falha de rede acusaria a plataforma por um clique — e faria a política
   * de repetição insistir numa chamada cujo resultado ninguém quer mais.
   */
  it("REQUISICAO_CANCELADA: fomos nós que interrompemos, e não há o que fazer", () => {
    const d = diagnosticarTransporte({ cancelada: true });

    expect(d.estado).toBe("REQUISICAO_CANCELADA");
    expect(d.acao).toBeNull();
    expect(d.risco.emRisco).toBe(false);
  });

  /**
   * A regressão que esta suíte não pegava, e que custou a pergunta "por que
   * esse erro continua dando?".
   *
   * `SEM_RESPOSTA` recomendava `RESTABELECER_API` como todos os outros estados.
   * Numa passagem anterior o `resumo` foi reescrito para admitir que podia não
   * ser a API, e a **ação continuou mandando conferir a API** — o teste de cima
   * prendia justamente o código errado, então a correção pela metade passou
   * verde. Aqui a asserção é negativa de propósito: o que não pode voltar é a
   * recomendação, não o texto.
   *
   * E a razão de fundo é observável: com o processo fora do ar quem responde é a
   * camada anterior, com 5xx de corpo vazio, e isso é `API_AUSENTE`. Chegar em
   * `SEM_RESPOSTA` é chegar no estado em que a API derrubada é a hipótese menos
   * compatível com o que se observou.
   */
  it("SEM_RESPOSTA não manda conferir o processo da API — quem faz isso é API_AUSENTE", () => {
    const semResposta = diagnosticarTransporte({ naoCompletou: true });
    const apiAusente = diagnosticarTransporte({ status: 502, corpoVazio: true });

    expect(semResposta.acao?.codigo).toBe("IDENTIFICAR_QUEDA");
    expect(semResposta.acao?.codigo).not.toBe("RESTABELECER_API");
    expect(semResposta.acao?.texto).not.toMatch(/API Server/);

    // O estado que de fato observou a ausência continua mandando o que sempre
    // mandou — a correção não pode ter apagado o caso legítimo.
    expect(apiAusente.acao?.codigo).toBe("RESTABELECER_API");
    expect(apiAusente.acao?.texto).toMatch(/API Server/);
  });

  /**
   * Os dois estados nascem de fatos diferentes, e a diferença é medida.
   *
   * Com a API fora do ar o proxy do Vite responde `HTTP/1.1 500`,
   * `Content-Type: text/plain`, zero bytes; o roteador do Replit responde 502
   * igualmente vazio. Corpo vazio com 5xx é `API_AUSENTE`. `SEM_RESPOSTA` só
   * acontece quando não veio status nenhum — e por isso não carrega `status`.
   */
  it("SEM_RESPOSTA não tem status; API_AUSENTE tem", () => {
    expect(diagnosticarTransporte({ naoCompletou: true }).status).toBeUndefined();
    expect(diagnosticarTransporte({ status: 502, corpoVazio: true }).status).toBe(502);
    expect(diagnosticarTransporte({ status: 500, corpoVazio: true }).status).toBe(500);
  });

  /**
   * Um 5xx de corpo vazio nunca é nosso: toda resposta desta API é JSON, mesmo
   * quando é erro. Dizer "o servidor respondeu" a respeito de um servidor que
   * não chegou a ser consultado mandou uma tela ser reescrita duas vezes atrás
   * de um defeito que estava no ambiente.
   */
  it("API_AUSENTE: 5xx sem corpo é o roteador, não a API", () => {
    const d = diagnosticarTransporte({ status: 502, corpoVazio: true });

    expect(d.estado).toBe("API_AUSENTE");
    expect(d.acao?.codigo).toBe("RESTABELECER_API");
    expect(d.evidencia).toMatch(/502/);
    // Reenviar não muda nada, e a frase precisa dizer isso.
    expect(d.acao?.texto).toMatch(/reenviar/i);
  });

  it("RESPOSTA_INCOMPLETA: 2xx sem corpo é conexão cortada, não erro do pedido", () => {
    const d = diagnosticarTransporte({ status: 200, corpoVazio: true });

    expect(d.estado).toBe("RESPOSTA_INCOMPLETA");
    expect(d.resumo).toMatch(/interrompida/);
  });

  it("ERRO_SEM_CORPO: 4xx sem corpo não acusa a plataforma", () => {
    const d = diagnosticarTransporte({ status: 404, corpoVazio: true });

    expect(d.estado).toBe("ERRO_SEM_CORPO");
    // Não é indisponibilidade: mandar conferir o processo aqui apontaria para
    // o lugar errado.
    expect(d.acao).toBeNull();
  });

  it("RESPOSTA_ESTRANHA: corpo que não é JSON leva um trecho como evidência", () => {
    const d = diagnosticarTransporte({
      status: 200,
      corpoNaoJson: "<!doctype html><title>504 Gateway Timeout</title>",
    });

    expect(d.estado).toBe("RESPOSTA_ESTRANHA");
    expect(d.evidencia).toMatch(/504 Gateway Timeout/);
  });

  it("o trecho do corpo estranho é cortado — não se despeja uma página inteira", () => {
    const d = diagnosticarTransporte({
      status: 500,
      corpoNaoJson: "x".repeat(5000),
    });

    expect(d.evidencia!.length).toBeLessThan(260);
  });

  /**
   * A pergunta que quem subiu um arquivo faz primeiro. Em todo caso deste
   * módulo a resposta é a mesma, e precisa estar escrita em todos.
   */
  it("nenhum caso põe dado em risco, e todos dizem isso", () => {
    const casos: TransporteObservado[] = [
      { naoCompletou: true },
      { cancelada: true },
      { status: 502, corpoVazio: true },
      { status: 200, corpoVazio: true },
      { status: 404, corpoVazio: true },
      { status: 500, corpoNaoJson: "<html>" },
    ];

    const estados = casos.map((caso) => diagnosticarTransporte(caso).estado);
    expect(new Set(estados).size).toBe(6);

    for (const caso of casos) {
      const d = diagnosticarTransporte(caso);
      expect(d.risco.emRisco).toBe(false);
      expect(d.risco.texto).toMatch(/nada se perdeu/i);
      expect(d.resumo.length).toBeGreaterThan(0);
    }
  });

  /**
   * Nenhum destes diagnósticos pode recomendar coisa de banco: eles descrevem
   * uma camada em que o banco nem chegou a ser consultado.
   */
  it("nenhum caso do transporte recomenda migrations", () => {
    const casos: TransporteObservado[] = [
      { naoCompletou: true },
      { cancelada: true },
      { status: 502, corpoVazio: true },
      { status: 200, corpoVazio: true },
      { status: 404, corpoVazio: true },
      { status: 500, corpoNaoJson: "<html>" },
      {},
    ];

    for (const caso of casos) {
      const d = diagnosticarTransporte(caso);
      const tudo = [
        d.resumo,
        d.risco.texto,
        d.acao?.texto,
        d.acao?.comando,
        d.evidencia,
      ]
        .filter(Boolean)
        .join(" ");
      expect(tudo).not.toMatch(/migrate|migration/i);
    }
  });

  it("sem observação nenhuma, não responde 'está tudo bem'", () => {
    // Chamar assim é defeito de quem chamou. Um estado saudável esconderia-o.
    const d = diagnosticarTransporte({});
    expect(d.estado).toBe("RESPOSTA_ESTRANHA");
  });
});

describe("ErroDeTransporte", () => {
  it("é Error, carrega o diagnóstico, e a mensagem é o resumo", () => {
    const diagnostico = diagnosticarTransporte({
      status: 502,
      corpoVazio: true,
    });
    const erro = new ErroDeTransporte(diagnostico);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.diagnostico.estado).toBe("API_AUSENTE");
    expect(erro.message).toBe(diagnostico.resumo);
    // Não é `TypeError`: a checagem de falha de rede não pode capturá-lo.
    expect(erro).not.toBeInstanceOf(TypeError);
  });
});
