import { useLocation, useRouter } from "wouter";

import { ambienteDe, BASES_DE_AUDITORIA, type Ambiente } from "@/lib/ambiente";

/**
 * O ambiente aberto, lido do endereço **inteiro**.
 *
 * `lib/ambiente.ts` continua sendo função pura sobre a localização; este
 * arquivo é o mesmo cálculo com o `useLocation` já embutido, como
 * `lib/base-do-fechamento.ts` faz do lado do Fechamento. O que ele acrescenta é
 * a única sutileza que as auditorias prefixadas trouxeram, e ela merece estar
 * escrita:
 *
 * **Dentro de uma auditoria prefixada, `useLocation()` não devolve o endereço
 * inteiro.** As quatro auditorias são o mesmo código montado sob quatro bases
 * (`App.tsx`), e o wouter faz isso com um roteador aninhado: dentro dele, a
 * localização vem **relativa** — quem está em `/auditoria-rota/alteracoes` lê
 * `/alteracoes`. É exatamente o que faz as telas continuarem escrevendo
 * `/alteracoes` sem saber em qual ambiente estão, e é o que impede um `href`
 * literal de jogar quem está no Rota de volta na Empurrada no primeiro clique.
 *
 * O preço é que `ambienteDe(useLocation()[0])` responderia "Empurrada" nos
 * quatro. Quem pergunta o ambiente — a lateral, o topo, a barra do celular —
 * precisa do endereço com a base, e é isso que este hook devolve: a base do
 * roteador aberto, mais a localização dentro dele.
 */
export function useLocalizacaoDoAmbiente(): string {
  const { base } = useRouter();
  const [location] = useLocation();
  /*
    A base do roteador aninhado vem com a base da aplicação na frente quando o
    produto é servido sob um subcaminho (`import.meta.env.BASE_URL`, ver o
    `<Router>` de `App.tsx`). O endereço do ambiente é o que vem depois dela —
    `ambienteDe` fala a língua das rotas, e não a do servidor.
  */
  const daAplicacao = import.meta.env.BASE_URL.replace(/\/$/, "");
  const doAmbiente = base.startsWith(daAplicacao) ? base.slice(daAplicacao.length) : base;
  return `${doAmbiente}${location === "/" ? "" : location}`;
}

/** O ambiente aberto — o atalho que a casca usa. */
export function useAmbiente(): Ambiente {
  return ambienteDe(useLocalizacaoDoAmbiente());
}

/**
 * A base da auditoria aberta, para quem precisa escrever um endereço absoluto.
 *
 * É pouca gente, e por bom motivo: dentro do ambiente ninguém precisa da base —
 * o roteador aninhado a aplica. Quem precisa é quem **sai** dele, e esses usam o
 * `~` do wouter (ver `nav-administracao.ts` e o seletor de ambiente do topo).
 */
export function useBaseDaAuditoria(): string {
  const id = useAmbiente();
  return id in BASES_DE_AUDITORIA
    ? BASES_DE_AUDITORIA[id as keyof typeof BASES_DE_AUDITORIA]
    : BASES_DE_AUDITORIA.auditoria;
}
