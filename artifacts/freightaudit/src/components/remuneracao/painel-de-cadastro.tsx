import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { PencilLine, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";
import { lerCadastro, type SituacaoDaUnidade } from "@/lib/remuneracao";
import { CadastrarAPlanilha } from "./cadastrar-planilha";

/**
 * O CADASTRO DA PLANILHA SEM SAIR DA LISTA — o botão e o painel que ele abre.
 *
 * A tela de Remuneração é uma lista de unidades, e o formulário morava a um
 * clique dela, numa aba dentro do cadastro de cada unidade. No primeiro uso a
 * consequência apareceu inteira: a coluna dizia "nada informado", quem lia isso
 * não tinha o que clicar, e a unidade em questão estava **sem lastro nenhum** —
 * o caso em que a planilha informada não é complemento, é a única forma de o
 * cadastro ter número. A lista mandava procurar um arquivo e calava a saída que
 * existia.
 *
 * Aqui o botão está na linha e o formulário abre por cima da lista. A aba
 * dentro do cadastro continua existindo, e continua sendo o lugar de quem vai
 * passar meia hora conferindo: ela tem endereço próprio, o histórico do
 * navegador funciona, e as outras duas vistas ficam ao lado. O painel é para o
 * outro gesto — abrir, digitar o que a aba de Excel diz, fechar.
 *
 * **As duas escolhas que o painel faz antes do formulário.**
 *
 * *O canal* — `EMPURRADA`, `ROTA` — porque a planilha é de um deles, e não da
 * unidade inteira. A lista oferece os canais que já existem (no acervo ou em
 * alguma planilha) e deixa digitar um novo, que é o mesmo gesto do campo de
 * unidade em Realizar Fechamento: o vocabulário é da operação, e um select
 * fechado obrigaria o cadastro a estar completo antes de alguém precisar dele.
 * O canal digitado passa a existir assim que a primeira célula é salva.
 *
 * *A vigência*, porque a planilha é de uma quinzena. As oferecidas são as que a
 * unidade entregou — inclusive para um canal que ela ainda não entregou, e é a
 * resposta certa: a quinzena é do calendário do cliente, não da série.
 */
export function BotaoDeCadastroDaPlanilha({
  unidade,
  canaisConhecidos,
}: {
  unidade: SituacaoDaUnidade;
  /** Os canais que existem em qualquer unidade — o que o seletor oferece. */
  canaisConhecidos: string[];
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button
        size="sm"
        variant={unidade.cadastro.informadas === 0 ? "outline" : "ghost"}
        onClick={() => setAberto(true)}
        className="whitespace-nowrap"
      >
        <PencilLine className="w-3.5 h-3.5 mr-1.5" />
        {unidade.cadastro.informadas === 0 ? "Cadastrar planilha" : "Editar planilha"}
      </Button>

      {aberto && (
        <PainelDeCadastro
          unidade={unidade}
          canaisConhecidos={canaisConhecidos}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

/** O rótulo da unidade sem o canal — "CAMAÇARI" de "CAMAÇARI · EMPURRADA". */
function nomeDaUnidade(unidade: SituacaoDaUnidade): string {
  return unidade.unidade ?? unidade.label.split(" · ")[0] ?? unidade.label;
}

const SEM_CANAL = "__sem_canal__";
const OUTRO = "__outro__";

function PainelDeCadastro({
  unidade,
  canaisConhecidos,
  aoFechar,
}: {
  unidade: SituacaoDaUnidade;
  canaisConhecidos: string[];
  aoFechar: () => void;
}) {
  const [canal, setCanal] = useState<string | null>(unidade.channel);
  const [digitando, setDigitando] = useState(false);
  const [rascunhoDoCanal, setRascunhoDoCanal] = useState("");
  const [vigencia, setVigencia] = useState(unidade.effectiveDate);

  /*
    Esc fecha. O painel cobre a tela inteira e o formulário dentro dele é longo;
    sem tecla, a única saída é rolar até achar o X. O `Dialog` compartilhado não
    tem isso e não vou mudá-lo aqui — as outras cinco telas que o usam são
    caixas curtas, onde a falta não pesa do mesmo jeito.
  */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const cadastro = useQuery({
    queryKey: ["remuneracao", "cadastro", unidade.scopeHash, canal, vigencia],
    queryFn: () =>
      lerCadastro({
        scopeHash: unidade.scopeHash,
        canal,
        period: vigencia,
        /*
          O canal pode ser um que ninguém entregou ainda — é justamente para ele
          que este painel existe. Sem esta bandeira o servidor responderia 404 e
          o formulário nunca apareceria para ser preenchido.
        */
        canalNovo: true,
      }),
  });

  const opcoes = [...new Set([...canaisConhecidos, ...(unidade.channel ? [unidade.channel] : [])])]
    .filter((c) => c !== "")
    .sort();

  function escolher(valor: string) {
    if (valor === OUTRO) {
      setDigitando(true);
      setRascunhoDoCanal("");
      return;
    }
    setDigitando(false);
    setCanal(valor === SEM_CANAL ? null : valor);
  }

  /** O canal digitado, normalizado como o acervo o escreve: em caixa alta. */
  function usarODigitado() {
    const texto = rascunhoDoCanal.trim().toUpperCase();
    if (texto === "") return;
    setCanal(texto);
    setDigitando(false);
  }

  /*
    O painel é levado para o `body`, e não desenhado onde o botão está.

    O botão vive numa célula da lista de unidades, e aquela célula é
    `text-right whitespace-nowrap` — ela alinha e não deixa quebrar a contagem
    que mora nela. `white-space` e `text-align` são herdadas, e `position:
    fixed` muda o posicionamento, não a herança: desenhado ali dentro, o painel
    inteiro herdava as duas. O efeito era o texto de ajuda de cada campo virar
    uma linha só, transbordar a coluna e se sobrepor ao do campo vizinho — e
    `max-w-2xl` não segurava nada, porque sob `nowrap` o limite continua sendo
    a largura da caixa enquanto o texto passa por fora dela.

    Um `whitespace-normal text-left` aqui consertaria estas duas propriedades e
    deixaria a próxima passar. O portal corta a classe inteira do problema:
    fora da tabela, o painel não herda nada da célula que abriu. É o que o
    `Dialog` do Radix faz pelo mesmo motivo — e o `Dialog` compartilhado deste
    repositório, que também desenha no lugar, tem a mesma exposição; não o
    mexo aqui porque as telas que o usam são caixas curtas fora de tabela.
  */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={aoFechar}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cadastrar a planilha de ${nomeDaUnidade(unidade)}`}
        className="relative z-50 w-full max-w-5xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 px-6 py-4 backdrop-blur rounded-t-xl">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <PencilLine className="w-4 h-4" />
              Cadastrar a planilha — {nomeDaUnidade(unidade)}
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl">
              O que você digitar aqui é o que a <strong>aba de Excel</strong> diz, e não medida do
              acervo: cada linha volta ao cadastro marcada como informada, com o seu nome e a
              data. Onde o acervo também responde, o número dele continua sendo o do cadastro e
              o seu aparece ao lado.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={aoFechar} aria-label="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-b px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="canal-da-planilha"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Tipo da operação
              </label>

              {digitando ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    id="canal-da-planilha"
                    value={rascunhoDoCanal}
                    placeholder="ROTA"
                    onChange={(e) => setRascunhoDoCanal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") usarODigitado();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setDigitando(false);
                      }
                    }}
                    className="uppercase"
                  />
                  <Button
                    variant="outline"
                    onClick={usarODigitado}
                    disabled={rascunhoDoCanal.trim() === ""}
                  >
                    Usar
                  </Button>
                </div>
              ) : (
                <Select value={canal ?? SEM_CANAL} onValueChange={escolher}>
                  <SelectTrigger id="canal-da-planilha">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoes.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    {unidade.channel === null && (
                      <SelectItem value={SEM_CANAL}>sem canal</SelectItem>
                    )}
                    <SelectItem value={OUTRO}>
                      <span className="inline-flex items-center gap-1.5">
                        <Plus className="w-3 h-3" />
                        outro tipo…
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}

              <p className="text-xs text-muted-foreground">
                A planilha é de um tipo de operação, e não da unidade inteira: a mesma
                {" "}{nomeDaUnidade(unidade)} tem uma aba para EMPURRADA e outra para ROTA. A
                lista traz os tipos que já existem; um tipo novo passa a existir quando a
                primeira linha dele for salva.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="vigencia-da-planilha"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Vigência que você preenche
              </label>
              <Select value={vigencia} onValueChange={setVigencia}>
                <SelectTrigger id="vigencia-da-planilha">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(cadastro.data?.vigencias ?? []).map((v) => (
                    <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
                      {v.periodLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                As vigências são as que esta unidade entregou — inclusive para um tipo que ela
                ainda não entregou, porque a quinzena é do calendário, não da série.
              </p>
            </div>
          </div>
        </div>

        <div className={cn("px-6 py-5", cadastro.isLoading && "opacity-60")}>
          {cadastro.isLoading && (
            <p className="text-sm text-muted-foreground">Montando o cadastro…</p>
          )}

          {cadastro.isError && (
            <Alert variant="destructive">
              <AlertDescription>{textoDoErro(cadastro.error)}</AlertDescription>
            </Alert>
          )}

          {cadastro.data && (
            /*
              A `key` carrega unidade, canal e vigência: o formulário guarda o
              que foi digitado em estado local, e trocar o tipo de operação sem
              remontá-lo deixaria o rascunho de EMPURRADA dentro de ROTA — que o
              botão de salvar gravaria no lugar errado.
            */
            <CadastrarAPlanilha
              key={`${unidade.scopeHash}|${canal ?? ""}|${cadastro.data.effectiveDate}`}
              dados={cadastro.data}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível abrir o cadastro.";
}
