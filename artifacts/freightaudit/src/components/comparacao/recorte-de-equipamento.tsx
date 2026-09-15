import { rotuloDaCobertura } from "@workspace/comparison/recorte-de-rubrica";
import { cn } from "@/lib/utils";

/** O recorte aberto: os dois tipos, ou os dois juntos. */
export type RecorteDeTipo = "TODOS" | "CAVALO" | "CARRETA";

export const RECORTES: readonly RecorteDeTipo[] = ["TODOS", "CAVALO", "CARRETA"];

/**
 * A SÉRIE QUE SE AUDITA — CAVALO, CARRETA, OU OS DOIS.
 *
 * ---------------------------------------------------------------------------
 * Por que ele subiu para o topo da tela
 * ---------------------------------------------------------------------------
 * Porque ele já existia e ninguém o achava. As quatro auditorias de grão
 * equipamento tinham um seletor "Tipo de equipamento" na fileira de filtros, ao
 * lado da busca e abaixo dos cartões — e o relato que originou esta peça foi
 * *"não seria melhor termos a aba Cavalo e a aba Carreta?"*, de quem estava com
 * a tela aberta e o seletor a um palmo do cursor. Um eixo de leitura escondido
 * entre refinamentos de tabela é um eixo que não se usa.
 *
 * E ele filtrava pouco: alcançava a tabela e a contagem das abas de estado, não
 * os cartões nem os gráficos, que vêm prontos do servidor. Quem achasse o
 * seletor lia a tabela de cavalo sob os cartões de cavalo **mais** carreta — o
 * número de um recorte sob o título de outro, que é o defeito que este produto
 * persegue em toda parte.
 *
 * ---------------------------------------------------------------------------
 * Por que ele fica acima do par de vigências
 * ---------------------------------------------------------------------------
 * Porque ele **manda** no par, e não o contrário: na aba Cavalo o seletor só
 * oferece vigências que têm cavalo, na de Carreta só as que têm carreta, e em
 * Cavalo + Carreta o acervo de equipamento inteiro. A ordem na tela é a ordem
 * da decisão — primeiro o que se audita, depois entre quais datas.
 *
 * É o mesmo padrão que Chamados já usa, onde a vigência é escolhida dentro da
 * aba (Cavalo, Carreta, Trecho). Aqui ele chegou depois, e pelo mesmo motivo:
 * um seletor que oferece a série errada só revela o erro depois do clique.
 *
 *
 * ---------------------------------------------------------------------------
 * Por que não é uma segunda fileira de abas
 * ---------------------------------------------------------------------------
 * Porque a tela já tem uma — Todas as alterações, Alterados, Novos, Ausentes,
 * Dado incompleto, Conflito, Sem alteração —, e ela é sobre a tabela. Duas
 * fileiras iguais empilhadas seriam duas perguntas disputando o mesmo gesto,
 * sem nada na forma dizendo qual manda em quê. Este controle é um segmento
 * fechado, acima dos cartões: a posição e o desenho dizem que ele governa a
 * tela inteira, e a fileira de abas continua governando a lista.
 */
export function RecorteDeEquipamento({
  valor,
  onValor,
  disponiveis,
  idPrefixo,
}: {
  valor: RecorteDeTipo;
  onValor: (v: RecorteDeTipo) => void;
  /**
   * Quais recortes a unidade aberta tem — o que decide se cada um é oferecido.
   *
   * Sai da **lista de vigências**, e não da comparação carregada. É o que
   * permite o controle viver acima do par: ele precisa estar em tela e correto
   * antes de existir comparação nenhuma, e a pergunta que ele responde — "esta
   * unidade tem carreta?" — já está respondida na cobertura das vigências.
   *
   * Uma aba clicável sobre uma unidade que não tem carreta leva a uma tela
   * vazia que não explica nada, que é a mesma falha que o seletor de vigências
   * tinha. Aqui o botão fica desabilitado e diz por quê: a ausência é a
   * notícia, e ela tem de estar escrita, não deduzida de uma tabela em branco.
   */
  disponiveis: Record<RecorteDeTipo, boolean>;
  idPrefixo: string;
}) {
  const rotulo = (r: RecorteDeTipo) =>
    r === "TODOS" ? "Cavalo + Carreta" : rotuloDaCobertura(r);

  return (
    <div
      role="tablist"
      aria-label="Recorte por equipamento"
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1"
    >
      {RECORTES.map((r) => {
        /* "Cavalo + Carreta" nunca desabilita: é a tela que já existia, e ela
           responde por qualquer acervo — inclusive o vazio, dizendo que está
           vazio. */
        const vazio = r !== "TODOS" && !disponiveis[r];
        return (
          <button
            key={r}
            id={`${idPrefixo}-recorte-${r.toLowerCase()}`}
            type="button"
            role="tab"
            aria-selected={valor === r}
            disabled={vazio}
            title={
              vazio
                ? `Nenhuma vigência desta unidade tem ${rotulo(r).toLowerCase()}. Importe o arquivo correspondente para auditá-lo aqui.`
                : undefined
            }
            onClick={() => onValor(r)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              valor === r
                ? "bg-background text-brand shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              vazio && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
          >
            {rotulo(r)}
          </button>
        );
      })}
    </div>
  );
}
