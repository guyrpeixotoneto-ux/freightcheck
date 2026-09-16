import { useMemo } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { Layers } from "lucide-react";
import { moduloDoQlp } from "@workspace/comparison/qlp-comparacao";
import { ROTULO_DO_QUADRO } from "@workspace/comparison/qlp";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { ComparacaoDoQuadro } from "@/components/qlp-comparacao/comparacao";
import {
  ROTULO_DA_RUBRICA,
  escreverRubrica,
  porQueOModuloNaoExiste,
  type QuadroDeQlp,
} from "@/lib/qlp-comparacao";
import { cn } from "@/lib/utils";

/**
 * UM MÓDULO DO QLP — a mesma rubrica lida nos dois quadros.
 *
 * ---------------------------------------------------------------------------
 * Por que uma tela por assunto, e não uma por quadro
 * ---------------------------------------------------------------------------
 * As telas de QLP Operacional e Administrativo são por **quadro**: cada uma
 * mostra o quadro inteiro de uma população. A pergunta que elas não respondem é
 * a do assunto: *o que mudou no vale-transporte*, olhando as duas populações
 * juntas. Num quadro de 41 cargos e 21 colunas, cinquenta alterações numa
 * quinzena escondem as duas que são de transporte.
 *
 * Esta tela é esse recorte, e as duas abas dela são as duas populações — o
 * mesmo desenho das abas Cavalo e Carreta das auditorias de equipamento, com o
 * ativo trocado pela altura do quadro.
 *
 * ---------------------------------------------------------------------------
 * Os módulos saem do catálogo, e é isso que os mantém verdadeiros
 * ---------------------------------------------------------------------------
 * Nem o menu nem esta tela têm uma lista escrita à mão do que existe: quem
 * responde é `modulosDoQlp()`, derivado das rubricas do catálogo
 * (`@workspace/comparison/qlp`). Hoje **salário**, **encargos** e
 * **vale-transporte** acendem nos dois quadros, e **plano de saúde**,
 * **refeição** e **seguro de vida** só no operacional — porque o export
 * administrativo traz benefício numa coluna só e o operacional o decompõe em
 * nove. No dia em que a Ambev mandar o administrativo decomposto, a aba acende
 * sozinha, sem ninguém vir aqui.
 *
 * E a aba que o quadro não sustenta **aparece assim mesmo**, com o motivo por
 * extenso: escondê-la faria a ausência parecer escolha da tela, e abri-la vazia
 * faria parecer que nada mudou. Ver `porQueOModuloNaoExiste`.
 */
export default function QlpModulo() {
  const { modulo: chave = "" } = useParams<{ modulo: string }>();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const modulo = useMemo(() => moduloDoQlp(chave), [chave]);

  /** O contexto da tela — o mesmo recorte que as outras rotas de QLP leem. */
  const comum = useMemo(() => {
    const q = new URLSearchParams();
    for (const nome of ["period", "scopeHash", "canal", "base", "comparada"]) {
      const valor = params.get(nome);
      if (valor) q.set(nome, valor);
    }
    return q;
  }, [search]);

  const rotulo = escreverRubrica(chave || null);

  if (!modulo) {
    return (
      <Layout>
        <CabecalhoDePagina
          titulo="Módulo do QLP"
          icone={Layers}
          descricao="A comparação do quadro de pessoal, recortada por assunto."
        />
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-10 sm:px-8">
          <EstadoVazio
            icone={Layers}
            titulo={`O QLP não tem o módulo "${chave}"`}
            descricao={
              "Os módulos saem das rubricas do catálogo dos dois quadros, e nenhuma delas " +
              "tem esse nome. Escolha um dos módulos da seção QLP, na lateral."
            }
          />
        </div>
      </Layout>
    );
  }

  /*
    A aba aberta é a que o endereço pede — **mesmo a que não tem coluna**.

    Sem quadro no endereço, abre a primeira que o módulo sustenta: mandar quem
    clicou em "Plano de saúde" direto para a aba vazia seria abrir a tela na
    única metade que não tem o que mostrar. Mas quando a pessoa **clica** na aba
    sem coluna, ela quer saber por que ela está lá — e devolvê-la à outra aba em
    silêncio é a tela recusando a pergunta em vez de responder.
  */
  const pedida = (params.get("quadro") ?? "").toUpperCase();
  const ehQuadro = pedida === "ADMINISTRATIVO" || pedida === "OPERACIONAL";
  const aberta: QuadroDeQlp = ehQuadro
    ? (pedida as QuadroDeQlp)
    : (modulo.quadros[0] as QuadroDeQlp);

  /*
    As duas abas sempre aparecem — a que o módulo não sustenta diz por quê —,
    mas **a que tem coluna vem primeiro**.

    A barra era fixa em Operacional, Administrativo, e num módulo que só existe
    no administrativo — frota leve, telefonia, uniformes, benefício — isso abria
    a tela com "Operacional (sem coluna)" na posição de entrada e a aba viva
    grifada atrás dela. Quem chegava lia a primeira palavra e via um quadro que
    não é o do módulo: a tela parecia abrir no operacional e mostrar o
    administrativo. O mesmo desencontro nos módulos dos dois quadros, onde a
    aberta (`quadros[0]`, o administrativo) também não era a primeira.

    A ordem passa a sair do próprio módulo: os quadros que ele sustenta, na
    ordem do catálogo, e depois o que ele não sustenta. Assim a aba que abre é
    sempre a primeira, e a "(sem coluna)" fica onde ela é — o rodapé da
    pergunta, e não a porta de entrada.
  */
  const abas: QuadroDeQlp[] = [
    ...(modulo.quadros as QuadroDeQlp[]),
    ...(["ADMINISTRATIVO", "OPERACIONAL"] as QuadroDeQlp[]).filter(
      (q) => !modulo.quadros.includes(q),
    ),
  ];

  return (
    <Layout>
      <CabecalhoDePagina
        titulo={
          <span className="flex flex-wrap items-center gap-2.5">
            {rotulo}
            <span className="rounded-full border border-brand/25 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
              QLP · {modulo.quadros.length === 2 ? "os dois quadros" : ROTULO_DO_QUADRO[modulo.quadros[0]]}
            </span>
          </span>
        }
        icone={Layers}
        descricao={`O que mudou em ${rotulo.toLowerCase()} entre duas vigências, cargo a cargo.`}
      />

      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-10 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b" role="tablist">
          {abas.map((quadro) => {
            const temColuna = modulo.quadros.includes(quadro);
            const q = new URLSearchParams(search);
            q.set("quadro", quadro);
            return (
              <button
                key={quadro}
                type="button"
                role="tab"
                aria-selected={quadro === aberta}
                onClick={() => navigate(`/qlp/${chave}?${q.toString()}`)}
                className={cn(
                  "border-b-2 py-2 text-sm font-semibold",
                  quadro === aberta
                    ? "border-brand text-brand"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {ROTULO_DO_QUADRO[quadro].replace("QLP ", "")}
                {!temColuna && (
                  <span className="ml-1.5 text-[0.7rem] font-normal text-muted-foreground">
                    (sem coluna)
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {modulo.quadros.includes(aberta) ? (
          <ComparacaoDoQuadro quadro={aberta} query={comum} rubrica={chave} />
        ) : (
          <EstadoVazio
            icone={Layers}
            titulo={`O ${ROTULO_DO_QUADRO[aberta]} não tem a coluna de ${rotulo.toLowerCase()}`}
            descricao={porQueOModuloNaoExiste(rotulo, aberta)}
          />
        )}
      </div>
    </Layout>
  );
}

/** O rótulo de um módulo, para quem monta o menu. */
export function rotuloDoModulo(chave: string): string {
  return ROTULO_DA_RUBRICA[chave] ?? chave.replace(/_/g, " ");
}
