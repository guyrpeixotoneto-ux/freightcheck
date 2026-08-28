import { Link } from "wouter";
import { GitBranch, Loader2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResumoDeSubfluxo } from "@/lib/fluxos";

/**
 * A MARCA DE SUBFLUXO — o canto do cartão que diz "isto tem um processo dentro".
 *
 * Uma etapa como "Emissão do documento (no Unidox)" é um passo aqui e oito
 * passos lá dentro. Este controle é o único lugar da tela onde esses dois
 * fatos se encontram, e por isso ele tem exatamente dois estados:
 *
 * - **Já detalhada** — um link para o fluxo do detalhe, com a contagem de
 *   etapas. A contagem é o que faz o link valer a pena: "abrir" sem saber se
 *   há oito passos ou zero é um clique no escuro.
 * - **Ainda não** — o botão que cria o detalhe já ligado, com o nome da etapa.
 *   Um clique, sem formulário: quem está lendo o processo e percebe que ali
 *   dentro mora outro não quer preencher nome, categoria e endereço antes de
 *   escrever o primeiro passo.
 *
 * **Não é um `<button>` dentro de outro.** O cartão da Jornada e o nó do canvas
 * já são clicáveis inteiros; esta marca é irmã deles no mesmo contêiner
 * posicionado, nunca filha. Aninhada, o HTML seria inválido e o clique no
 * detalhe abriria o painel da etapa junto — os dois destinos disputando o mesmo
 * gesto.
 *
 * Em modo de leitura o convite de criar some e o link permanece: só leitura
 * tira a escrita, não a navegação.
 */
export function MarcaDeSubfluxo({
  subfluxo,
  nomeDaEtapa,
  podeDetalhar,
  criando,
  aoDetalhar,
  className,
}: {
  /** O detalhe que já existe, ou `null` quando a etapa ainda não tem um. */
  subfluxo: ResumoDeSubfluxo | null;
  nomeDaEtapa: string;
  /** Falso em modo de leitura, ou quando a página não sabe criar detalhe. */
  podeDetalhar: boolean;
  criando?: boolean;
  aoDetalhar?: () => void;
  className?: string;
}) {
  if (subfluxo) {
    return (
      <Link
        href={`/fluxos/${subfluxo.id}`}
        /*
          O clique não pode subir: no canvas o cartão está dentro de um nó do
          React Flow, que trata `mousedown` como começo de arrasto — sem parar
          a propagação, abrir o detalhe move a etapa de lugar.
        */
        onClick={(evento) => evento.stopPropagation()}
        onMouseDown={(evento) => evento.stopPropagation()}
        title={`Abrir "${subfluxo.nome}" — o detalhe desta etapa`}
        aria-label={`Abrir o subfluxo "${subfluxo.nome}", com ${subfluxo.etapas} ${
          subfluxo.etapas === 1 ? "etapa" : "etapas"
        }`}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary transition-colors hover:bg-primary/20",
          className,
        )}
      >
        <Workflow className="h-3 w-3 shrink-0" />
        {/*
          Só o número: o `aria-label` acima já diz "8 etapas em Emissão do
          documento" por extenso, e um texto visível repetindo isso não caberia
          no canto de um cartão de 236px.
        */}
        <span className="tabular-nums">{subfluxo.etapas}</span>
      </Link>
    );
  }

  if (!podeDetalhar) return null;

  return (
    <button
      type="button"
      onClick={(evento) => {
        evento.stopPropagation();
        aoDetalhar?.();
      }}
      onMouseDown={(evento) => evento.stopPropagation()}
      disabled={criando}
      title={`Detalhar "${nomeDaEtapa}" num fluxo próprio`}
      aria-label={`Detalhar a etapa "${nomeDaEtapa}" num fluxo próprio`}
      className={cn(
        "inline-flex items-center rounded-md border border-transparent px-1.5 py-0.5 text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {criando ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <GitBranch className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
