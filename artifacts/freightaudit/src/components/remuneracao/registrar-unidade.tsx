import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, X } from "lucide-react";
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
import { registrarUnidade } from "@/lib/remuneracao";

/**
 * REGISTRAR UMA UNIDADE QUE AINDA NÃO IMPORTOU NADA.
 *
 * **A parede que este botão derruba.** Unidade, neste produto, sempre nasceu de
 * um export: a lista mostra quem entregou vigência, e quem nunca entregou não
 * tinha linha para clicar. Na Auditoria isso está certo — lá a pergunta é o que
 * os arquivos sustentam. No Fechamento é uma parede: a quinzena é de várias
 * unidades, a aba de Excel costuma chegar antes do arquivo, e a unidade que só
 * tem aba não tinha onde ser digitada.
 *
 * **O que ele cria é identidade, e não número.** Nome, código, tipo de operação
 * e a quinzena em que se começa a preencher. Os números continuam entrando pelo
 * formulário da planilha, marcados como informados, com autor e data — e
 * continuam sem apagar medição nenhuma, porque numa unidade destas o acervo
 * ainda não mede nada.
 *
 * **Por que o código é obrigatório, e por que ele é o campo delicado.** É dele
 * que sai o identificador da unidade, somado com a mesma regra da importação.
 * Registrada com o código que o export também carrega, a unidade digitada
 * recebe o **mesmo** identificador que o import produzirá: no dia em que o
 * arquivo chegar, ele cai na unidade que já estava lá, com a planilha no lugar
 * certo, e ninguém precisa juntar duas linhas.
 *
 * E é por isso que a tela pede o código **como ele está no export**, com
 * máscara se lá houver máscara. O identificador da importação é somado sobre o
 * texto da célula, não sobre o CNPJ canônico; limpar a pontuação aqui pareceria
 * mais caprichado e produziria o identificador de um código que o arquivo não
 * tem — as duas unidades nunca se encontrariam. A exigência é real e a tela a
 * diz por extenso, porque quem digita não tem como adivinhá-la.
 */
export function BotaoDeRegistroDeUnidade() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Cadastrar unidade
      </Button>

      {aberto && <PainelDeRegistro aoFechar={() => setAberto(false)} />}
    </>
  );
}

/** As quinzenas que o seletor oferece, do mês corrente para trás e um à frente. */
function quinzenasOferecidas(hoje: Date): { valor: string; rotulo: string }[] {
  const opcoes: { valor: string; rotulo: string }[] = [];
  const base = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));

  /*
    De doze meses atrás até o mês seguinte. O passado existe porque a planilha
    que se está transcrevendo costuma ser de uma quinzena já fechada; o futuro,
    um mês só, porque quem cadastra a unidade em geral já tem a aba da quinzena
    que vem — e mais do que isso viraria uma lista que ninguém lê até o fim.
  */
  for (let desloca = -12; desloca <= 1; desloca += 1) {
    const mes = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + desloca, 1));
    const ano = mes.getUTCFullYear();
    const mm = String(mes.getUTCMonth() + 1).padStart(2, "0");
    const nome = mes.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    opcoes.push({ valor: `${ano}-${mm}-01`, rotulo: `1ª quinzena de ${nome}` });
    opcoes.push({ valor: `${ano}-${mm}-16`, rotulo: `2ª quinzena de ${nome}` });
  }
  return opcoes.reverse();
}

function PainelDeRegistro({ aoFechar }: { aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  const [canal, setCanal] = useState("EMPURRADA");
  const [vigencia, setVigencia] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const [opcoes] = useState(() => quinzenasOferecidas(new Date()));

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const registrar = useMutation({
    mutationFn: () =>
      registrarUnidade({
        nome,
        codigo,
        canal: canal.trim() === "" ? null : canal,
        vigencia,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoFechar();
    },
    onError: (err: unknown) => setErro(textoDoErro(err)),
  });

  const faltaCampo = nome.trim() === "" || codigo.trim() === "" || vigencia === "";

  /*
    Portal, pela razão do painel de cadastro da planilha: este botão vive no
    cabeçalho de uma tela cheia de tabela, e `white-space`/`text-align` são
    herdadas — desenhado no lugar, o formulário herdaria o alinhamento de
    qualquer célula que viesse a hospedá-lo.
  */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={aoFechar} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cadastrar uma unidade"
        className="relative z-50 w-full max-w-2xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              Cadastrar uma unidade
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5">
              Para a unidade cuja aba de Excel já chegou e cujo export ainda não. Ela passa a
              aparecer na lista e a ter planilha — <strong>sem lastro do acervo</strong>, que é
              o que a lista vai dizer, até o arquivo chegar.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={aoFechar} aria-label="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <label htmlFor="unidade-nome" className={ROTULO}>
              Nome da unidade
            </label>
            <Input
              autoFocus
              id="unidade-nome"
              value={nome}
              placeholder="CAMAÇARI"
              onChange={(e) => setNome(e.target.value)}
              className="uppercase"
            />
            <p className={AJUDA}>É o que a lista mostra, e o que quem opera procura.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="unidade-codigo" className={ROTULO}>
              Código da unidade
            </label>
            <Input
              id="unidade-codigo"
              value={codigo}
              placeholder="12.345.678/0001-99"
              onChange={(e) => setCodigo(e.target.value)}
            />
            {/*
              Este parágrafo é a parte da tela que não pode ser cortada por
              concisão: sem ele, quem digita não tem como saber que a forma
              importa, e a consequência de errá-la só aparece meses depois.
            */}
            <p className={AJUDA}>
              O mesmo código da coluna <strong>Unidade - CNPJ</strong> do export, escrito{" "}
              <strong>exatamente como está lá</strong> — com pontuação, se lá houver. É por ele
              que o arquivo, quando chegar, entra nesta unidade em vez de abrir uma segunda ao
              lado dela.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="unidade-canal" className={ROTULO}>
                Tipo da operação
              </label>
              <Input
                id="unidade-canal"
                value={canal}
                placeholder="EMPURRADA"
                onChange={(e) => setCanal(e.target.value)}
                className="uppercase"
              />
              <p className={AJUDA}>
                A planilha é de um tipo de operação. A mesma unidade pode ter uma aba para
                EMPURRADA e outra para ROTA — cadastre a segunda quando ela existir.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="unidade-vigencia" className={ROTULO}>
                Quinzena que você vai preencher
              </label>
              <Select value={vigencia} onValueChange={setVigencia}>
                <SelectTrigger id="unidade-vigencia">
                  <SelectValue placeholder="Escolha a quinzena" />
                </SelectTrigger>
                <SelectContent>
                  {opcoes.map((o) => (
                    <SelectItem key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className={AJUDA}>
                Sem acervo, é a única vigência que a unidade tem — as outras aparecem à medida
                que você salvar planilha nelas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={() => registrar.mutate()} disabled={faltaCampo || registrar.isPending}>
            {registrar.isPending ? "Cadastrando…" : "Cadastrar unidade"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const ROTULO = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const AJUDA = "text-xs text-muted-foreground";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível cadastrar a unidade.";
}
