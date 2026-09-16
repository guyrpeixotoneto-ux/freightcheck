import { useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { HardHat } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { AuditoriaDoQuadro } from "@/components/qlp-auditoria/auditoria";
import { ComparacaoDoQuadro } from "@/components/qlp-comparacao/comparacao";
import { SeletorDeQuadro } from "@/components/qlp/seletor-de-quadro";
import { GRAO_DO_QUADRO } from "@workspace/comparison/qlp";
import { cn } from "@/lib/utils";

/**
 * QLP OPERACIONAL — o quadro de pessoal da operação, conferido contra si mesmo.
 *
 * ---------------------------------------------------------------------------
 * O grão não é placa nem trecho: é cargo
 * ---------------------------------------------------------------------------
 * As quatro auditorias de custo fixo são por ativo e as duas de custo variável
 * são por percurso. Esta é por **cargo e turno**: uma linha é um cargo da
 * operação numa unidade, num turno — e, como diz o dicionário do quadro
 * administrativo sobre a tabela irmã, *cada linha é um cargo, não uma pessoa*.
 * Quem diz quantas pessoas há é a coluna de quantidade.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela responde, e o que ela recusa
 * ---------------------------------------------------------------------------
 * O verbete desta rota pedia o quadro por cargo e turno, com piso, adicional
 * noturno, benefícios, encargos e a quantidade por caminhão. Todas essas colunas
 * estão declaradas no dicionário da tabela de equipe — **o que não chegou é o
 * arquivo**. Enquanto ele não chega, a tela diz isso, em vez de mostrar um
 * quadro vazio que pareceria uma operação sem gente.
 *
 * O que ela faz quando o arquivo chegar é o que nenhuma soma faria: **conferir a
 * cadeia dos subtotais**. Nove colunas desta tabela são subtotais das outras, e
 * o dicionário avisa que somá-las junto das parcelas dobra a folha. A cadeia que
 * ele descreve — piso e adicionais no salário fixo, contracheque com encargos na
 * remuneração fixa, esta com benefícios e EPI no total — está lá como
 * **proposta, não medida**. Esta tela é o instrumento que a confirma ou a
 * derruba contra dado real.
 *
 * E mostra a leitura que o dicionário pede em voz alta: o **abono acordado
 * contra o aplicado**, que é o que explica remuneração caindo sem ninguém ter
 * mexido em salário — regra, e não erro, mas invisível sem as duas colunas lado
 * a lado.
 *
 * ---------------------------------------------------------------------------
 * Por que ela não compara vigências
 * ---------------------------------------------------------------------------
 * Porque a comparação é do motor canônico, e as vigências de QLP são snapshots
 * como quaisquer outros: Comparar Vigências já as compara. O que não tinha tela
 * é a conferência **dentro** de uma vigência, e é ela que mora aqui.
 *
 * ---------------------------------------------------------------------------
 * As duas abas, e por que a comparação é uma delas
 * ---------------------------------------------------------------------------
 * A Auditoria confere **dentro** de uma vigência; a Comparação confere **entre
 * duas**, cargo a cargo, no mesmo recorte de rubrica que FINAME, IPVA e Lucro
 * Fixo usam por placa. São perguntas diferentes sobre o mesmo quadro, e as duas
 * moram aqui porque o quadro é um só: mandar quem compara o operacional para
 * outra tela faria o mesmo cargo ser lido em dois endereços.
 *
 * **Nenhuma conta mora neste arquivo.** Tudo vem de `@workspace/comparison/qlp`
 * e de `@workspace/comparison/qlp-comparacao`, que o servidor importa do mesmo
 * jeito — e as duas abas são os mesmos componentes que o QLP Administrativo
 * usa nas abas dele.
 */

type Aba = "auditoria" | "comparacao";
const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "auditoria", rotulo: "Auditoria" },
  { id: "comparacao", rotulo: "Comparação" },
];
export default function QlpOperacional() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const pedida = params.get("aba") ?? "";
  const aba: Aba = ABAS.some((a) => a.id === pedida) ? (pedida as Aba) : "auditoria";

  /** O contexto da tela: vigência, unidade e canal, como as demais rotas de QLP o leem. */
  const comum = useMemo(() => {
    const atual = new URLSearchParams(search);
    const q = new URLSearchParams();
    for (const chave of ["period", "scopeHash", "canal", "base", "comparada"]) {
      const valor = atual.get(chave);
      if (valor !== null) q.set(chave, valor);
    }
    return q;
  }, [search]);

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            QLP Operacional
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              Auditoria do quadro · {GRAO_DO_QUADRO.OPERACIONAL}
            </span>
          </span>
        }
        icone={HardHat}
        descricao="O quadro de pessoal da operação conferido contra as contas que ele mesmo declara — a cadeia dos subtotais da folha, cargo a cargo."
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        {/*
          O seletor de população vem **antes** das abas de leitura, e a ordem é a
          da pergunta: primeiro de quem é o quadro, depois o que se lê nele. Ver
          `components/qlp/seletor-de-quadro.tsx` — a lateral tem um item só, e a
          troca de quadro mora aqui.
        */}
        <SeletorDeQuadro quadro="OPERACIONAL" />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b" role="tablist">
          {ABAS.map((item) => {
            const q = new URLSearchParams(search);
            q.set("aba", item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === aba}
                onClick={() => navigate(`/qlp-operacional?${q.toString()}`)}
                className={cn(
                  "border-b-2 py-2 text-sm font-semibold",
                  item.id === aba
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.rotulo}
              </button>
            );
          })}
        </div>

        {aba === "auditoria" && (
          <AuditoriaDoQuadro
            quadro="OPERACIONAL"
            query={comum}
            rotuloDaVigencia={comum.get("period") ?? undefined}
          />
        )}
        {aba === "comparacao" && <ComparacaoDoQuadro quadro="OPERACIONAL" query={comum} />}
      </div>
    </Layout>
  );
}
