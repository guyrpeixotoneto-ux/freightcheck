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
    expect(d.acao?.codigo).toBe("RESTABELECER_API");
    expect(d.acao?.quem).toBe("plataforma");
    // A frase precisa dizer como separar as duas causas, porque o navegador
    // escreve as duas como "Failed to fetch".
    expect(d.resumo).toMatch(/healthz/);
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
      { status: 502, corpoVazio: true },
      { status: 200, corpoVazio: true },
      { status: 404, corpoVazio: true },
      { status: 500, corpoNaoJson: "<html>" },
    ];

    const estados = casos.map((caso) => diagnosticarTransporte(caso).estado);
    expect(new Set(estados).size).toBe(5);

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
