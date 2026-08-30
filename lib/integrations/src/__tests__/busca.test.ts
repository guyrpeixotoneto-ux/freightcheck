import { describe, expect, it } from "vitest";
import {
  INTERVALO_MINIMO_MINUTOS,
  conferirDadosDaBusca,
  conferirUrlDaBusca,
  ehEnderecoPrivado,
  hostProibido,
  proximaExecucao,
} from "../busca";
import { RecusaDeIntegracao } from "../recusas";
import { chaveMestraDe, cifrar, decifrar, CofreIndisponivel } from "../cofre";

/**
 * A busca ativa tem uma regra que não pode estar errada, e ela não é sobre
 * agenda: **este servidor não pode ser usado para alcançar o que só ele
 * alcança.** Uma URL escolhida por quem cadastra, buscada por um processo que
 * enxerga a rede interna, é o SSRF — e a primeira coisa que se tenta contra uma
 * tela como esta.
 *
 * O resto do arquivo é a agenda e o cofre. Nenhum deles abre conexão, e é por
 * isso que a suíte inteira roda em milissegundos.
 */

const validos = {
  nome: "Export diário",
  url: "https://api.fornecedor.com/exports/vigencia.xlsx",
  metodo: "GET",
  intervaloMinutos: 60,
};

describe("o endereço que a busca aceita", () => {
  it("aceita https para um host público", () => {
    expect(conferirUrlDaBusca("https://api.fornecedor.com/x.xlsx")).toBe(
      "https://api.fornecedor.com/x.xlsx",
    );
  });

  it.each([
    ["http, sem TLS", "http://api.fornecedor.com/x.xlsx"],
    ["um arquivo local", "file:///etc/passwd"],
    ["o protocolo de dados", "data:text/plain;base64,QQ=="],
    ["texto que não é endereço", "api.fornecedor.com"],
  ])("recusa %s", (_caso, url) => {
    expect(() => conferirUrlDaBusca(url)).toThrow(RecusaDeIntegracao);
  });

  it("recusa credencial embutida no endereço", () => {
    expect(() => conferirUrlDaBusca("https://usuario:senha@api.com/x.xlsx")).toThrow(
      /credencial tem campo próprio/i,
    );
  });

  it.each([
    "https://localhost/x.xlsx",
    "https://127.0.0.1/x.xlsx",
    "https://10.1.2.3/x.xlsx",
    "https://192.168.0.9/x.xlsx",
    "https://172.16.5.4/x.xlsx",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/x",
    "https://banco.internal/x.xlsx",
    "https://[::1]/x.xlsx",
  ])("recusa a rede interna: %s", (url) => {
    expect(() => conferirUrlDaBusca(url)).toThrow(/rede interna/i);
  });
});

describe("os endereços que a segunda camada precisa reconhecer", () => {
  /*
    Esta é a conferência que roda **depois** do DNS, na hora de buscar. Um nome
    público que resolve para 127.0.0.1 passa pela primeira camada e morre aqui.
  */
  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("%s é privado", (ip) => {
    expect(ehEnderecoPrivado(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "2606:4700::1111"])(
    "%s é público",
    (ip) => {
      expect(ehEnderecoPrivado(ip)).toBe(false);
    },
  );

  it("o sufixo .internal e o .localhost também são recusados por nome", () => {
    expect(hostProibido("banco.internal")).toBe(true);
    expect(hostProibido("app.localhost")).toBe(true);
    expect(hostProibido("api.fornecedor.com")).toBe(false);
  });
});

describe("os dados de uma busca", () => {
  it("aceita o mínimo e devolve o que vai para o banco", () => {
    const d = conferirDadosDaBusca(validos);
    expect(d.metodo).toBe("GET");
    expect(d.forma).toBe("NENHUMA");
    expect(d.cabecalhos).toEqual({});
    expect(d.intervaloMinutos).toBe(60);
  });

  it("recusa intervalo abaixo do piso, e diz por quê", () => {
    expect(() =>
      conferirDadosDaBusca({ ...validos, intervaloMinutos: INTERVALO_MINIMO_MINUTOS - 1 }),
    ).toThrow(/intervalo mínimo/i);
  });

  /*
    A recusa do `authorization` escrito à mão é de segurança, e não de estilo:
    ali ele iria para o banco em claro, ao lado do campo que existe para
    guardá-lo cifrado — duas portas para a mesma coisa, e a insegura seria a
    mais fácil.
  */
  it("recusa credencial escrita como cabeçalho solto", () => {
    expect(() =>
      conferirDadosDaBusca({
        ...validos,
        cabecalhos: { Authorization: "Bearer abc" },
      }),
    ).toThrow(/campo de credencial/i);
  });

  it("exige o segredo quando a forma o pressupõe, e o recusa quando não", () => {
    expect(() => conferirDadosDaBusca({ ...validos, forma: "BEARER" })).toThrow(
      /precisa do segredo/i,
    );
    expect(() =>
      conferirDadosDaBusca({ ...validos, forma: "NENHUMA", credencial: "abc" }),
    ).toThrow(/Escolha como ele viaja/i);
  });

  it("a forma CABECALHO precisa dizer qual cabeçalho", () => {
    expect(() =>
      conferirDadosDaBusca({ ...validos, forma: "CABECALHO", credencial: "abc" }),
    ).toThrow(/em que cabeçalho/i);
    const d = conferirDadosDaBusca({
      ...validos,
      forma: "CABECALHO",
      credencial: "abc",
      cabecalhoDaCredencial: "X-Api-Key",
    });
    expect(d.cabecalhoDaCredencial).toBe("x-api-key");
  });

  it("corpo só no POST", () => {
    expect(() => conferirDadosDaBusca({ ...validos, corpo: "{}" })).toThrow(/só o post/i);
    expect(
      conferirDadosDaBusca({ ...validos, metodo: "POST", corpo: "{}" }).corpo,
    ).toBe("{}");
  });
});

describe("a agenda", () => {
  /*
    Conta de agora, e não do horário previsto: contando do previsto, uma busca
    parada seis horas acordaria disparando as vinte e quatro execuções que
    "deveria" ter feito, todas trazendo o mesmo arquivo.
  */
  it("marca a próxima a partir de agora", () => {
    const agora = new Date("2026-08-30T12:00:00.000Z");
    expect(proximaExecucao(agora, 60).toISOString()).toBe("2026-08-30T13:00:00.000Z");
  });
});

describe("o cofre", () => {
  const chave = chaveMestraDe("a".repeat(64));

  it("devolve exatamente o que guardou", () => {
    const guardado = cifrar("segredo-do-fornecedor", chave);
    expect(guardado).not.toContain("segredo-do-fornecedor");
    expect(decifrar(guardado, chave)).toBe("segredo-do-fornecedor");
  });

  it("cifra o mesmo segredo diferente a cada vez", () => {
    expect(cifrar("igual", chave)).not.toBe(cifrar("igual", chave));
  });

  /*
    É o que GCM entrega e CBC não entregaria: um byte trocado no banco faz a
    leitura **falhar**, em vez de devolver lixo que seria enviado como
    credencial para um servidor de fora.
  */
  it("recusa conteúdo alterado", () => {
    const guardado = cifrar("segredo", chave);
    const mexido = guardado.slice(0, -2) + (guardado.endsWith("aa") ? "bb" : "aa");
    expect(() => decifrar(mexido, chave)).toThrow(CofreIndisponivel);
  });

  it("recusa a chave mestra de outro ambiente", () => {
    const outra = chaveMestraDe("b".repeat(64));
    expect(() => decifrar(cifrar("segredo", chave), outra)).toThrow(CofreIndisponivel);
  });

  it("sem chave mestra, o cofre não finge existir", () => {
    expect(() => chaveMestraDe(undefined)).toThrow(/chave mestra/i);
    expect(() => chaveMestraDe("senha-curta")).toThrow(/32 bytes/);
  });
});
