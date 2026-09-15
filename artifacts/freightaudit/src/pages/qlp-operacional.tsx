import { useMemo } from "react";
import { useSearch } from "wouter";
import { HardHat } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { AuditoriaDoQuadro } from "@/components/qlp-auditoria/auditoria";
import { GRAO_DO_QUADRO } from "@workspace/comparison/qlp";

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
 * **Nenhuma conta mora neste arquivo.** Tudo vem de `@workspace/comparison/qlp`,
 * que o servidor importa do mesmo jeito — e a tela inteira é o mesmo componente
 * que o QLP Administrativo usa na aba de Auditoria.
 */
export default function QlpOperacional() {
  const search = useSearch();

  /** O contexto da tela: vigência, unidade e canal, como as demais rotas de QLP o leem. */
  const comum = useMemo(() => {
    const atual = new URLSearchParams(search);
    const q = new URLSearchParams();
    for (const chave of ["period", "scopeHash", "canal"]) {
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
        <AuditoriaDoQuadro
          quadro="OPERACIONAL"
          query={comum}
          rotuloDaVigencia={comum.get("period") ?? undefined}
        />
      </div>
    </Layout>
  );
}
