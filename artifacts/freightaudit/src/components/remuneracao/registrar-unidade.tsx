import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { TIPOS_DE_OPERACAO } from "@/lib/fechamento";
import { MES_LONGO, mesPorExtenso, periodoDaQuinzena } from "@/lib/fechamento-gerencial";
import { anoAceito } from "@/lib/fechamento-tela";
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
 * **Os mesmos campos de Realizar Fechamento, na mesma ordem.** Quem cadastra a
 * unidade é quem abre o fechamento dela, no mesmo dia e às vezes na mesma hora,
 * e até aqui os dois formulários pediam a mesma quinzena de dois jeitos —
 * `Ano`, `Mês` e `Quinzena` num, uma lista de "1ª quinzena de agosto de 2026"
 * no outro — e o mesmo tipo de operação de dois jeitos: lista fechada num,
 * campo livre no outro. O campo livre era o mais caro dos dois: a unidade é o
 * par `(escopo, canal)`, e um `Empurrada` digitado com minúscula não encontra o
 * `EMPURRADA` que o arquivo traz — a importação nasceria numa segunda linha ao
 * lado desta, que é o defeito exato que este caminho existe para evitar. As
 * duas telas passam a pedir pelo mesmo vocabulário, com as mesmas listas.
 *
 * **O código não é obrigatório, e é o campo que mais vale a pena preencher.**
 * É dele que sai o identificador da unidade, somado com a mesma regra da
 * importação. Registrada com o código que o export também carrega, a unidade
 * digitada recebe o **mesmo** identificador que o import produzirá: no dia em
 * que o arquivo chegar, ele cai na unidade que já estava lá, com a planilha no
 * lugar certo, e ninguém precisa juntar duas linhas.
 *
 * Sem código, o identificador sai do nome, e a unidade funciona igual em tudo
 * o mais — aparece na lista, tem planilha, tem vigência. O que ela perde é esse
 * encontro: o export abre a unidade dele ao lado desta. **Exigir o código era
 * pior**, porque mandava quem tem a aba de Excel na mão procurar o CNPJ num
 * arquivo que ainda não chegou para poder digitar a planilha que já chegou — a
 * mesma parede que este botão derruba, um passo adiante. Então a tela pede, diz
 * o que se ganha, diz o que se perde, e deixa passar.
 *
 * A frase embaixo do campo **muda com o campo**, e não é enfeite: as duas
 * consequências são opostas, e uma explicação fixa estaria errada em metade dos
 * cadastros. Quem digita o código vê a promessa do reencontro; quem o deixa em
 * branco vê o preço, antes de clicar.
 *
 * E é por isso que a tela pede o código **como ele está no export**, com
 * máscara se lá houver máscara. O identificador da importação é somado sobre o
 * texto da célula, não sobre o CNPJ canônico; limpar a pontuação aqui pareceria
 * mais caprichado e produziria o identificador de um código que o arquivo não
 * tem — as duas unidades nunca se encontrariam. A exigência é real, e a tela a
 * diz por extenso, porque quem digita não tem como adivinhá-la.
 *
 * É também a razão de o nome e o código serem **dois campos**, onde Realizar
 * Fechamento tem um só. Lá a unidade se digita como `443 — CDD Belém`, e o
 * leitor daquele campo parte o texto no primeiro travessão, hífen ou barra —
 * inequívoco sobre um código de CDD, que é numérico. O código daqui é o CNPJ
 * como o export o escreve, e `12.345.678/0001-99` traz uma barra e um hífen
 * dentro de si: no formato de lá, ele viraria o código `12.345.678` e o nome
 * `0001-99 — CDD Belém`. Seria um identificador errado, gravado sem erro
 * nenhum em tela, descoberto no dia em que o arquivo chegasse e abrisse a
 * segunda unidade.
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

function PainelDeRegistro({ aoFechar }: { aoFechar: () => void }) {
  const queryClient = useQueryClient();
  const hoje = new Date();

  /*
    A quinzena, nos três campos de Realizar Fechamento e com os mesmos padrões:
    o ano e o mês de hoje, e a quinzena em que hoje cai. Vinha vazia antes, o
    que era defensável quando a lista misturava mês e quinzena numa opção só —
    escolher por alguém entre 28 linhas é escolher errado. Com os três campos
    separados o padrão volta a ser o certo: quem cadastra a unidade está quase
    sempre na quinzena corrente, e quem não está troca um seletor.
  */
  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1));
  const [quinzena, setQuinzena] = useState(hoje.getDate() <= 15 ? "1" : "2");
  const [nome, setNome] = useState("");
  const [codigo, setCodigo] = useState("");
  /*
    O tipo nasce vazio, como o de Realizar Fechamento e pela mesma razão: ele
    entra na identidade da unidade — o par `(escopo, canal)` —, e um padrão
    escolheria em silêncio de qual operação é a planilha que alguém veio
    transcrever. O `EMPURRADA` que este campo trazia pronto era isso: a maioria
    dos casos preenchida de véspera, e a minoria gravada errada sem que nada em
    tela tivesse perguntado.
  */
  const [tipoDeOperacao, setTipoDeOperacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

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
        canal: tipoDeOperacao,
        /*
          A vigência é o primeiro dia da quinzena — dia 1 ou dia 16 —, e quem a
          soma é o calendário do produto, o mesmo que o Fechamento usa para
          nomear o período. Montá-la à mão aqui seria uma segunda aritmética de
          quinzena, e o dia em que as duas discordassem a planilha digitada
          apareceria numa vigência que o arquivo não tem.
        */
        vigencia: periodoDaQuinzena(Number(ano), Number(mes), Number(quinzena) as 1 | 2).inicio,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoFechar();
    },
    onError: (err: unknown) => setErro(textoDoErro(err)),
  });

  const anoValido = anoAceito(ano);
  const temCodigo = codigo.trim() !== "";
  const faltaCampo = nome.trim() === "" || tipoDeOperacao === "" || !anoValido;

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
        /*
          `max-w-3xl`, e não o `2xl` de antes: a trinca da quinzena é a mesma de
          Realizar Fechamento, e naquela largura a terceira coluna cortava
          "2ª — dia 16 ao fim do mês" no meio da palavra. Um rótulo mais curto
          resolveria a largura e desfaria o que esta mudança faz — as duas telas
          nomeando a mesma quinzena com as mesmas palavras.
        */
        className="relative z-50 w-full max-w-3xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
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

          {/*
            A mesma trinca de Realizar Fechamento, na mesma ordem e com os
            mesmos rótulos: ano digitado, mês e quinzena escolhidos. O que o
            servidor recebe continua sendo uma data — `2026-08-16` —, e é o
            calendário que a soma.
          */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="unidade-ano">Ano</Label>
              <Input
                autoFocus
                id="unidade-ano"
                value={ano}
                onChange={(e) => setAno(e.target.value)}
                inputMode="numeric"
              />
              {!anoValido && <p className="text-xs text-amber-700">O ano vai de 2000 a 2100.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade-mes">Mês</Label>
              <Select value={mes} onValueChange={setMes}>
                <SelectTrigger id="unidade-mes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MES_LONGO.map((_, indice) => (
                    <SelectItem key={indice} value={String(indice + 1)}>
                      {mesPorExtenso(indice + 1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade-quinzena">Quinzena</Label>
              <Select value={quinzena} onValueChange={setQuinzena}>
                <SelectTrigger id="unidade-quinzena">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1ª — dias 1 a 15</SelectItem>
                  <SelectItem value="2">2ª — dia 16 ao fim do mês</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="unidade-nome">Unidade (CDD)</Label>
              <Input
                id="unidade-nome"
                value={nome}
                placeholder="CAMAÇARI"
                onChange={(e) => setNome(e.target.value)}
                className="uppercase"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unidade-codigo">
                Código da unidade{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="unidade-codigo"
                value={codigo}
                placeholder="12.345.678/0001-99"
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="unidade-tipo">Tipo</Label>
              {/*
                A mesma lista fechada de Realizar Fechamento, e pela mesma
                razão, agravada: lá o tipo é um eixo da chave do fechamento, e
                aqui é metade da identidade da unidade. O campo livre que ficava
                neste lugar aceitava `Empurrada`, e `Empurrada` não é o
                `EMPURRADA` que o arquivo traz — a unidade digitada e a
                importada ficariam lado a lado na lista, cada uma com metade do
                cadastro, sem nada em tela dizendo que são a mesma.
              */}
              <Select value={tipoDeOperacao} onValueChange={setTipoDeOperacao}>
                <SelectTrigger id="unidade-tipo">
                  <SelectValue placeholder="Escolha o tipo da operação" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DE_OPERACAO.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className={AJUDA}>
                {TIPOS_DE_OPERACAO.find((t) => t.valor === tipoDeOperacao)?.explicacao ??
                  "EMPURRADA e ROTA são fechamentos separados na mesma quinzena."}
              </p>
            </div>
          </div>

          {/*
            Este parágrafo é a parte da tela que não pode ser cortada por
            concisão: sem ele, quem digita não tem como saber que a forma do
            código importa, e a consequência de errá-la só aparece meses depois.
            Fica embaixo da grade, e não espremido dentro da coluna do campo,
            pela mesma escolha de Realizar Fechamento — lá é a explicação do
            `código — nome` que ocupa a largura inteira.

            Ele muda com o campo porque as duas consequências são opostas. Um
            texto único teria de escolher entre prometer o reencontro a quem não
            vai tê-lo e avisar do preço a quem já pagou para não pagá-lo — e nos
            dois casos estaria errado em metade dos cadastros.
          */}
          <p className={AJUDA}>
            O nome é o que a lista mostra, e o que quem opera procura.{" "}
            {temCodigo ? (
              <>
                O código é o mesmo da coluna <strong>Unidade - CNPJ</strong> do export,
                escrito <strong>exatamente como está lá</strong> — com pontuação, se lá
                houver. É por ele que o arquivo, quando chegar,{" "}
                <strong>entra nesta unidade</strong> em vez de abrir uma segunda ao lado
                dela.
              </>
            ) : (
              <>
                <strong>Sem o código, a unidade fica por conta própria</strong>: ela aparece
                na lista e tem planilha, mas o export, quando chegar, abre a unidade dele ao
                lado desta — juntar as duas é trabalho manual. Preencher o código da coluna{" "}
                <strong>Unidade - CNPJ</strong>, exatamente como está lá, é o que faz o
                arquivo cair aqui dentro. Se você não o tem agora, siga: a planilha não
                espera pelo arquivo.
              </>
            )}{" "}
            A quinzena é a única vigência que a unidade tem enquanto não há acervo: as outras
            aparecem à medida que você salvar planilha nelas.
          </p>
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

const AJUDA = "text-xs text-muted-foreground";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível cadastrar a unidade.";
}
