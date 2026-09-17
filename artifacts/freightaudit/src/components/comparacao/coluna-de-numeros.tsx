import { Skeleton } from "@/components/ui/skeleton";
import { numerosDaLinha, type CandidatosDoPar } from "@/lib/candidatos";
import { cn } from "@/lib/utils";
import type { LeituraDoValor } from "@/lib/candidatos";

/**
 * A cor de cada leitura — e ela sai da **mesma** leitura que escolheu o sinal.
 *
 * Era o defeito que havia antes de `numerosDaLinha` publicar `leitura`: a cor
 * lia o sinal aqui, o texto o escrevia lá, e bastaria uma das duas mudar para a
 * linha escrever `−` em verde.
 *
 * Zero não é positivo nem negativo: a linha zerada fica na cor do texto
 * secundário, e o verde/vermelho continua reservado a quem tem direção.
 */
const COR_DA_LEITURA: Record<LeituraDoValor, string> = {
  NEUTRO: "text-muted-foreground",
  GANHO: "text-emerald-700",
  PERDA: "text-destructive",
};

/**
 * O QUE UM PAR PRODUZ, ESCRITO NO CANTO DIREITO DA LINHA DO MENU.
 *
 * ---------------------------------------------------------------------------
 * Por que isto saiu de dentro do `SeletorDoPar`
 * ---------------------------------------------------------------------------
 * Porque agora são **dois** os menus que a escrevem: o seletor de par das
 * dezesseis auditorias, onde ela nasceu, e o seletor mestre de Alterações por
 * Módulo, que oferece datas em vez de vigências. As duas colunas dizem a mesma
 * coisa com as mesmas réguas — o sinal que vira cor, o esqueleto que não vira
 * número, o zero que se escreve por extenso —, e essas réguas são justamente o
 * que menos pode existir em duas versões: bastaria uma delas mudar para o mesmo
 * acervo sair verde num menu e vermelho no outro.
 *
 * A decisão de **quando** perguntar continua sendo de quem chama. Este
 * componente não busca nada: ele desenha o que chegou.
 */
export function ColunaDeNumeros({
  numeros,
  faltam,
}: {
  /** Os números desta linha — `null` é *ainda não sei*, e nunca *zero*. */
  numeros: CandidatosDoPar["candidatos"][number]["numeros"];
  /**
   * Ainda vem número — e é isto, não "há requisição no ar", que o esqueleto diz.
   *
   * A diferença aparece entre duas rodadas: a resposta chegou com pendentes, a
   * seguinte ainda não partiu, e por um instante o carregamento é falso com
   * metade das linhas sem número. Amarrado só a ele, o esqueleto sumia e
   * voltava a cada rodada, e a lista piscava enquanto se preenchia.
   */
  faltam: boolean;
}) {
  const n = numerosDaLinha(numeros);
  if (!n) return faltam ? <Skeleton className="h-3 w-24 rounded" /> : null;

  return (
    <span className="flex flex-col items-end text-xs leading-tight">
      {n.valores.map((valor) => {
        const dinheiro = (
          <span
            key={`${valor.rotulo ?? ""}${valor.texto}`}
            className={cn("font-semibold tabular-nums", COR_DA_LEITURA[valor.leitura])}
          >
            {valor.texto}
          </span>
        );
        /*
          Sem régua a escrever, o valor é o próprio filho — e não um valor
          embrulhado.

          O embrulho custava o que nenhum `span` extra costuma custar: quem lê a
          linha de fora — a tela, um teste, um leitor de tela — encontrava
          primeiro um invólucro sem cor com o mesmo texto do valor. As
          dezesseis telas de rubrica têm uma régua só e não escrevem rótulo
          nenhum; é justo que o desenho delas continue sendo exatamente o de
          antes.
        */
        if (!valor.rotulo) return dinheiro;
        return (
          <span key={`${valor.rotulo}${valor.texto}`} className="flex items-baseline gap-1.5">
            {/*
              A régua, quando a linha tem mais de uma — e sem cor, de propósito.

              Verde e vermelho são a direção do dinheiro; "Custo fixo" não tem
              direção. Pintá-lo junto faria a palavra parecer parte do número, e
              é o contrário: ela existe para dizer que o número ao lado **não
              soma** com o de baixo.
            */}
            <span className="text-[0.65rem] font-normal text-muted-foreground">
              {valor.rotulo}
            </span>
            {dinheiro}
          </span>
        );
      })}
      {/*
        O movimento da alíquota, quando o recorte o audita.

        Fica entre o dinheiro e a contagem porque é isso que ele é: uma segunda
        grandeza do mesmo par, e não um detalhe da contagem. Nos Impostos ele é
        a grandeza que manda — ali o `R$ 0,00` de cima é estrutural (o montante
        de ICMS nunca foi preenchido no acervo) e seria a única coisa escrita em
        toda linha do menu.

        Sem cor, e de propósito: verde e vermelho são a direção do dinheiro. Uma
        alíquota que sobe não é perda nem ganho enquanto o regime tributário do
        ativo não estiver no acervo — ver `percentuaisDaLinha`.
      */}
      {n.percentuais.map((texto) => (
        <span key={texto} className="tabular-nums text-muted-foreground">
          {texto}
        </span>
      ))}
      <span className="text-muted-foreground">{n.alteracoes}</span>
    </span>
  );
}
