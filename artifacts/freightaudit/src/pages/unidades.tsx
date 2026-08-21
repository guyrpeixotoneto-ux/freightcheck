import { Link } from "wouter";
import { ArrowRight, Building2, WifiOff } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useContextos, type Contexto } from "@/lib/contextos";

/**
 * Unidades — as seleções que existem, com o que cada uma já entregou.
 *
 * Esta tela não é um cadastro, e a diferença importa: **unidade aqui é unidade
 * que entregou vigência.** A lista sai de `/contexts`, que agrupa os snapshots
 * vivos por `scope_hash` e canal; uma unidade que exista no mundo e nunca tenha
 * mandado planilha não aparece, porque sobre ela este produto não tem nada a
 * dizer — e listá-la faria a tela prometer um histórico vazio.
 *
 * Cada linha é a chave que o resto do produto usa para filtrar: unidade +
 * canal. É por isso que a mesma unidade pode aparecer duas vezes, uma por
 * canal — são séries separadas, comparadas separadamente, e juntá-las na tela
 * sugeriria um total que o motor recusa a calcular.
 */

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `2026-08-01` → `agosto/2026`. Sem `Date`, para o fuso não recuar o mês. */
function periodo(data: string): string {
  const [ano, mes] = data.split("-");
  const indice = Number(mes) - 1;
  return indice >= 0 && indice < 12 ? `${MESES[indice]}/${ano}` : data;
}

function unidadeDe(contexto: Contexto): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

function enderecoDe(contexto: Contexto): string {
  const query = new URLSearchParams({ scopeHash: contexto.scopeHash });
  if (contexto.channel !== null) query.set("canal", contexto.channel);
  return `/parametros?${query}`;
}

export default function Unidades() {
  /*
    A consulta vem de `lib/contextos.ts`, e não escrita aqui — foi escrevê-la
    aqui que produziu o defeito.

    Esta tela declarava `queryKey: ["contexts"]` com a sua própria `queryFn`. A
    barra lateral, que o `Layout` monta em volta, declarava a **mesma chave** com
    outra `queryFn` e `retry: false`. No React Query há uma `Query` por chave,
    com uma `queryFn` e uma política só: quem dispara a busca dita as duas. E
    quem dispara é a lateral, porque efeitos do React correm de dentro para fora.

    O que se via nesta tela era o efeito disso, e nada disto é hipótese — está
    medido em `lib/__tests__/contextos.test.ts` e reproduzido no navegador:

      · a `queryFn` desta página **nunca rodava**;
      · a da lateral traduzia todo `!response.ok` em `[]`, então 502 (API fora
        do ar) e 401 (sessão expirada) chegavam aqui como "nenhuma vigência
        importada ainda" — o oposto do que houve;
      · `retry: false` vencia, então as cinco tentativas de `resiliencia.ts`
        nunca rodavam e uma falha de rede pintava o painel na primeira;
      · e como todo status virava dado, o único erro que sobrava era o `fetch`
        rejeitando — o que fazia o aviso dizer *sempre* "a requisição não
        completou", não por diagnóstico, mas por eliminação silenciosa.
  */
  const consulta = useContextos();
  const contextos = consulta.dados ?? [];

  const unidades = new Set(contextos.map((c) => c.scopeHash)).size;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          Unidades
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          As unidades e canais que já entregaram vigência. É esta a seleção que o
          menu mostra no topo e que Parâmetros usa para filtrar — abrir uma linha
          aqui é abrir os parâmetros daquela seleção.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {/*
          O painel só quando **não há lista para mostrar**.

          `indisponivel` é `erro && nunca houve resposta` (`resiliencia.ts`), e é
          a diferença entre informar e destruir informação: uma lista carregada
          às 14h02 continua sendo a lista às 14h05, e trocá-la por um painel
          amarelo porque um refetch de fundo não completou apaga o que estava
          certo. Antes, qualquer falha — inclusive a que passaria sozinha —
          substituía a tela.
        */}
        {consulta.indisponivel && (
          <ApiErrorNotice
            error={consulta.erro}
            what="A lista de unidades não pôde ser carregada."
            onTentarDeNovo={consulta.tentarDeNovo}
            tentando={consulta.atualizando}
          />
        )}

        {/*
          A falha que não substitui a tela: há lista, e a atualização não veio.

          A hora é o que faz a tira ser honesta — "de 14h02" é verificável, "pode
          estar desatualizado" é desculpa.
        */}
        {consulta.avisarSobreDadoGuardado && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              A atualização da lista não completou. O que está em tela é de{" "}
              {new Date(consulta.respondidoEm ?? 0).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              , e continua válido.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={consulta.atualizando}
              onClick={consulta.tentarDeNovo}
            >
              {consulta.atualizando ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            {/*
              Sem resposta não há contagem — e "0 unidades" é uma contagem.

              Era a última mentira que sobrava nesta tela: o painel de falha
              aparecia com "0 unidades · 0 seleções" logo abaixo, e o número
              afirma sobre o acervo o mesmo que a frase de lista vazia afirmava.
              Zero é um fato quando o servidor respondeu zero.
            */}
            <CardTitle className="text-base">
              {consulta.houveResposta ? (
                <>
                  {unidades} {unidades === 1 ? "unidade" : "unidades"} ·{" "}
                  {contextos.length}{" "}
                  {contextos.length === 1 ? "seleção" : "seleções"} (unidade + canal)
                </>
              ) : (
                "Unidades e seleções (unidade + canal)"
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {consulta.carregando && (
              <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
            )}

            {/*
              "Nenhuma vigência importada" é uma **afirmação sobre o acervo**, e
              por isso só pode ser escrita quando o servidor de fato respondeu.
              `houveResposta` é a autoridade — não `contextos.length === 0`, que
              vale igual para a lista vazia e para a lista que nunca chegou. Era
              exatamente essa confusão que fazia a API fora do ar aparecer aqui
              como um convite a importar a primeira planilha.
            */}
            {consulta.houveResposta && contextos.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                Nenhuma vigência importada ainda. A primeira planilha enviada em{" "}
                <Link href="/importacoes" className="text-primary hover:underline">
                  Importações
                </Link>{" "}
                cria a primeira unidade desta lista.
              </p>
            )}

            {contextos.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Unidade</th>
                    <th className="text-left px-4 py-2 font-medium">Canal</th>
                    <th className="text-left px-4 py-2 font-medium">Regional e operador</th>
                    <th className="text-left px-4 py-2 font-medium">Vigência mais recente</th>
                    <th className="text-right px-4 py-2 font-medium">No histórico</th>
                    <th className="text-right px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {contextos.map((contexto) => {
                    const outros = contexto.scopes.filter(
                      (s) => s.scopeType === "REGIONAL" || s.scopeType === "OPERADOR",
                    );
                    return (
                      <tr
                        key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                        className="border-b last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-2.5 font-semibold">{unidadeDe(contexto)}</td>
                        <td className="px-4 py-2.5">
                          {contexto.channel ?? (
                            <span className="text-muted-foreground text-xs">
                              sem canal no rótulo
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {outros.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              não informados na fonte
                            </span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {outros.map((escopo) => (
                                <Badge
                                  key={`${escopo.scopeType}|${escopo.code}`}
                                  variant="outline"
                                  className="font-normal"
                                >
                                  {escopo.name ?? escopo.code}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{periodo(contexto.latestPeriod)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {contexto.periods}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={enderecoDe(contexto)}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            abrir parâmetros
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
