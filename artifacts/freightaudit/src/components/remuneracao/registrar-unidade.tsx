import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
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
import {
  listarUnidadesCanonicas,
  TIPOS_DE_OPERACAO,
  type UnidadeCanonica,
} from "@/lib/fechamento";
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
 * **O que ele cria é identidade, e não número.** A unidade canônica, o código,
 * o tipo de operação e a quinzena em que se começa a preencher. Os números
 * continuam entrando pelo formulário da planilha, marcados como informados, com
 * autor e data — e continuam sem apagar medição nenhuma, porque numa unidade
 * destas o acervo ainda não mede nada.
 *
 * **Quem responde "qual unidade é esta" é o cadastro, e só ele.** Havia aqui um
 * campo `Unidade (CDD)` de texto livre, ao lado do seletor de unidade canônica,
 * e os dois respondiam à mesma pergunta: o nome ia para o pedido digitado como
 * estivesse, e a linha escolhida ia junto, livres para discordar. Nada em tela
 * dizia qual valia — e o que valia dependia do campo: o `unidade_id` saía da
 * linha, o `scope_hash` saía do texto. Cadastrar `CAMAÇARI` tendo escolhido
 * `CDD CAMACARI — 07.526.557/0015-05` gravava uma unidade cujo nome não é o
 * nome dela em lugar nenhum do produto.
 *
 * O campo saiu, e o seletor passou a ser obrigatório. **O nome deixou de ser
 * digitável neste produto** — ele nasce uma vez em Administração → Unidades,
 * junto do CNPJ que é a identidade, e daí em diante é lido. É a mesma decisão
 * que Realizar Fechamento já tinha tomado do seu lado, e é ela que faz
 * `Fechamento.unidade_id === Remuneração.unidade_id` deixar de ser coincidência
 * de texto.
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
 * É também a razão de o código ser **um campo à parte**, e não algo que se
 * derive do CNPJ do cadastro. Ele nasce preenchido com o CNPJ da unidade
 * escolhida — que é o que o export costuma trazer — e continua editável, porque
 * quem manda na grafia é o arquivo: `12.345.678/0001-99` e `12345678000199` são
 * o mesmo CNPJ e dois `scope_hash` diferentes, e só quem abriu o export sabe
 * qual dos dois está lá.
 *
 * **As duas telas agora pedem a mesma coisa, com os mesmos rótulos.** A unidade
 * sai da mesma lista canônica nas duas, e o exemplo do código é um CNPJ nas
 * duas — era `443` de um lado e o CNPJ do outro, duas telas pedindo
 * identificadores diferentes sob o mesmo nome, sendo que é por esse
 * identificador que uma encontra a outra.
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
  const [codigo, setCodigo] = useState("");
  /*
    A unidade canônica escolhida — a mesma tabela que o Fechamento seleciona,
    e agora **a única resposta** para "qual unidade é esta".

    É o que faz `Fechamento.unidade_id === Remuneração.unidade_id` deixar de
    ser coincidência de texto: os dois lados apontam para a mesma linha. O
    código continua no campo abaixo porque serve a outra coisa — o
    `scope_hash`, que é somado sobre o código como o export o escreve e é o que
    faz o arquivo cair nesta unidade quando chegar.
  */
  const [canonica, setCanonica] = useState<UnidadeCanonica | null>(null);
  const unidadesCanonicas = useQuery({
    queryKey: ["unidades", "canonicas"],
    queryFn: listarUnidadesCanonicas,
    select: (todas: UnidadeCanonica[]) => todas.filter((u) => u.id !== null),
  });
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
        unidadeId: canonica?.id ?? undefined,
        /*
          O nome vai como está no cadastro canônico — não é mais digitado aqui.
          O servidor continua exigindo-o (é dele que sai o identificador quando
          não há código), e é por isso que ele viaja: o que mudou é de onde ele
          vem.
        */
        nome: canonica?.nome ?? "",
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
  /*
    A unidade canônica passa a ser obrigatória, no lugar do nome digitado. É a
    mesma exigência de Realizar Fechamento, e pela mesma razão: quem escolhe
    uma unidade escolhe uma identidade, e é ela que faz a planilha desta tela
    encontrar a competência do outro lado.
  */
  const faltaCampo = canonica === null || tipoDeOperacao === "" || !anoValido;

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
            <div className="space-y-1.5 sm:col-span-2">
              {/*
                A mesma tabela que o Fechamento seleciona — é isto que faz os
                dois lados apontarem para a **mesma** unidade em vez de casarem
                por texto. É obrigatória: era o campo `Unidade (CDD)`, logo
                abaixo, que tornava a escolha dispensável, e enquanto ele
                existiu o cadastro tinha duas respostas para "qual unidade é
                esta" — a linha escolhida e o texto digitado, livres para
                discordar.
              */}
              <Label htmlFor="unidade-canonica">Unidade canônica</Label>
              <ComboboxCriavel<UnidadeCanonica>
                id="unidade-canonica"
                itens={unidadesCanonicas.data ?? []}
                valor={canonica}
                aoEscolher={(u) => {
                  setCanonica(u);
                  /*
                    O código vem preenchido com o CNPJ do cadastro, e continua
                    editável: o `scope_hash` é somado sobre o texto **como o
                    export o escreve**, e é o export que decide se há máscara.
                    Só preenche quando está vazio — sobrescrever apagaria a
                    grafia que alguém foi conferir no arquivo.
                  */
                  if (codigo.trim() === "") setCodigo(u.cnpjFormatado);
                }}
                rotuloDe={(u) => `${u.nome} — ${u.cnpjFormatado}`}
                chaveDe={(u) => u.id ?? u.cnpj}
                placeholder="Escolha a unidade cadastrada em Administração → Unidades"
                atalhoDeCadastro={{
                  rotulo: "Cadastrar unidade em Administração → Unidades",
                  para: "/unidades",
                }}
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
            O nome vem do cadastro da unidade — é o que a lista mostra, e não se
            redigita aqui.{" "}
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
