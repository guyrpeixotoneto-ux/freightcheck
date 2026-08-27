import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ListaEditavel } from "@/components/fluxos/lista-editavel";
import { escritas, fraseDoErro, type Catalogo, type Etapa } from "@/lib/fluxos";

/**
 * O EDITOR DA ETAPA — três abas, e por que não são dez campos numa página só.
 *
 * O que uma etapa guarda é muito: identidade, texto livre, cinco listas de
 * material, indicadores e ações. Tudo isso numa única coluna produz um
 * formulário de rolagem infinita em que ninguém acha nada; num assistente de
 * vários passos, produz cliques para editar uma palavra.
 *
 * As três abas separam pelo que a pessoa veio fazer:
 *
 * - **Etapa** — quem é, quem faz, o que acontece, o que manda. É a aba que abre.
 * - **Detalhes** — as cinco listas: sistemas, documentos, responsáveis, falhas,
 *   gargalos. São todas a mesma forma, e por isso a mesma `ListaEditavel`.
 * - **Consultas** — indicadores e as ações que navegam no FreightCheck.
 *
 * ---------------------------------------------------------------------------
 * A gravação: uma chamada de identidade, e uma por lista tocada
 * ---------------------------------------------------------------------------
 *
 * O contrato do servidor é explícito por lista (ver `routes/fluxos.ts`), e o
 * editor respeita isso salvando **só o que mudou**: quem só corrigiu o nome não
 * regrava sete listas. As listas são enviadas inteiras — é o contrato de
 * substituição —, e a ordem de envio é a ordem em que estão na tela, que é o que
 * faz arrastar não ser necessário para reordenar: remover e adicionar de novo
 * basta.
 *
 * Se uma das chamadas falhar, a frase do servidor aparece no rodapé e o diálogo
 * **não fecha** — o que estava digitado continua lá. Fechar em cima de um erro
 * perderia o trabalho e deixaria a etapa meio gravada sem que ninguém soubesse.
 */

interface LinhaDeItem extends Record<string, unknown> {
  nome: string;
  descricao: string;
  link: string;
  obrigatorio: boolean;
}

interface LinhaDeIndicador extends Record<string, unknown> {
  nome: string;
  descricao: string;
  unidade: string;
  sentido: string;
  origem: string;
}

interface LinhaDeAcao extends Record<string, unknown> {
  titulo: string;
  descricao: string;
  rota: string;
}

function linhasDaEspecie(etapa: Etapa | null, especie: string): LinhaDeItem[] {
  return (etapa?.itens ?? [])
    .filter((i) => i.especie === especie)
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => ({
      nome: i.nome,
      descricao: i.descricao ?? "",
      link: i.link ?? "",
      obrigatorio: i.obrigatorio === true,
    }));
}

export function EditorDaEtapa({
  aberto,
  etapa,
  fluxoId,
  empresaId,
  catalogo,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  /** `null` cria uma etapa nova; preenchido, edita a existente. */
  etapa: Etapa | null;
  fluxoId: string;
  empresaId: string | null;
  catalogo: Catalogo | undefined;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const especies = catalogo?.especiesDeItem ?? [];

  const [nome, setNome] = useState(etapa?.nome ?? "");
  const [tipo, setTipo] = useState(etapa?.tipo ?? "PROCESSO");
  const [status, setStatus] = useState(etapa?.status ?? "ATIVO");
  const [area, setArea] = useState(etapa?.area ?? "");
  const [responsavel, setResponsavel] = useState(etapa?.responsavel ?? "");
  const [sistemaPrincipal, setSistemaPrincipal] = useState(etapa?.sistemaPrincipal ?? "");
  const [descricao, setDescricao] = useState(etapa?.descricao ?? "");
  const [objetivo, setObjetivo] = useState(etapa?.objetivo ?? "");
  const [regras, setRegras] = useState(etapa?.regras ?? "");
  const [observacoes, setObservacoes] = useState(etapa?.observacoes ?? "");
  const [chave, setChave] = useState(etapa?.chaveMonitoramento ?? "");

  const [porEspecie, setPorEspecie] = useState<Record<string, LinhaDeItem[]>>(() =>
    Object.fromEntries(especies.map((e) => [e.valor, linhasDaEspecie(etapa, e.valor)])),
  );
  const [indicadores, setIndicadores] = useState<LinhaDeIndicador[]>(
    () =>
      (etapa?.indicadores ?? []).map((i) => ({
        nome: i.nome,
        descricao: i.descricao ?? "",
        unidade: i.unidade ?? "",
        sentido: i.sentido,
        origem: i.origem ?? "",
      })),
  );
  const [acoes, setAcoes] = useState<LinhaDeAcao[]>(() =>
    (etapa?.acoes ?? []).map((a) => ({
      titulo: a.titulo,
      descricao: a.descricao ?? "",
      rota: a.rota,
    })),
  );

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        nome,
        tipo,
        status,
        area,
        responsavel,
        sistemaPrincipal,
        descricao,
        objetivo,
        regras,
        observacoes,
        chaveMonitoramento: chave,
        /* A posição é preservada: quem edita o texto não move o cartão. */
        ...(etapa ? { ordem: etapa.ordem, posX: etapa.posX, posY: etapa.posY } : {}),
      };

      const gravada = etapa
        ? await escritas.atualizarEtapa(empresaId, fluxoId, etapa.id, corpo)
        : await escritas.criarEtapa(empresaId, fluxoId, corpo);

      /*
        As listas vão **em série**, e não em paralelo. Em paralelo, o servidor
        recusaria uma delas e as outras entrariam mesmo assim — e a etapa
        ficaria com metade do que a pessoa digitou, sem que a mensagem de erro
        dissesse qual metade. Em série, a primeira recusa para tudo o que vem
        depois, e o que já entrou é sempre um prefixo do que estava na tela.
      */
      for (const especie of especies) {
        const linhas = porEspecie[especie.valor] ?? [];
        await escritas.salvarItens(
          empresaId,
          fluxoId,
          gravada.id,
          especie.valor,
          linhas
            .filter((l) => l.nome.trim() !== "")
            .map((l, ordem) => ({
              nome: l.nome,
              descricao: l.descricao,
              ordem,
              ...(especie.usaLink ? { link: l.link } : {}),
              ...(especie.usaObrigatorio ? { obrigatorio: l.obrigatorio } : {}),
            })),
        );
      }

      await escritas.salvarIndicadores(
        empresaId,
        fluxoId,
        gravada.id,
        indicadores
          .filter((i) => i.nome.trim() !== "")
          .map((i, ordem) => ({ ...i, ordem })),
      );

      await escritas.salvarAcoes(
        empresaId,
        fluxoId,
        gravada.id,
        acoes.filter((a) => a.titulo.trim() !== "").map((a, ordem) => ({ ...a, ordem })),
      );
    },
    onSuccess: () => {
      aoSalvar();
      aoFechar();
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{etapa ? "Editar etapa" : "Nova etapa"}</DialogTitle>
          <DialogDescription>
            O cartão do fluxograma mostra nome, tipo e responsável. Todo o resto aparece no painel
            lateral quando alguém clica na etapa.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="etapa">
          <TabsList>
            <TabsTrigger value="etapa">Etapa</TabsTrigger>
            <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
            <TabsTrigger value="consultas">Consultas</TabsTrigger>
          </TabsList>

          <TabsContent value="etapa" className="space-y-4 pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="etapa-nome">Nome da etapa</Label>
                <Input
                  id="etapa-nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Autorização SEFAZ"
                />
              </div>

              <div>
                <Label htmlFor="etapa-tipo">Tipo</Label>
                <Select value={tipo} onValueChange={setTipo}>
                  <SelectTrigger id="etapa-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalogo?.tiposDeEtapa ?? []).map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>
                        {t.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="etapa-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as Etapa["status"])}>
                  <SelectTrigger id="etapa-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(catalogo?.statusDaEtapa ?? []).map((s) => (
                      <SelectItem key={s.valor} value={s.valor}>
                        {s.rotulo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="etapa-area">Área</Label>
                <Input
                  id="etapa-area"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="Faturamento"
                />
              </div>

              <div>
                <Label htmlFor="etapa-responsavel">Responsável</Label>
                <Input
                  id="etapa-responsavel"
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                  placeholder="Analista de faturamento"
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-sistema">Sistema principal</Label>
                <Input
                  id="etapa-sistema"
                  value={sistemaPrincipal}
                  onChange={(e) => setSistemaPrincipal(e.target.value)}
                  placeholder="ERP"
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-descricao">O que acontece aqui</Label>
                <Textarea
                  id="etapa-descricao"
                  rows={3}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-objetivo">Objetivo da etapa</Label>
                <Textarea
                  id="etapa-objetivo"
                  rows={2}
                  value={objetivo}
                  onChange={(e) => setObjetivo(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-regras">Regras de negócio</Label>
                <Textarea
                  id="etapa-regras"
                  rows={3}
                  value={regras}
                  onChange={(e) => setRegras(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="etapa-observacoes">Observações</Label>
                <Textarea
                  id="etapa-observacoes"
                  rows={2}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="detalhes" className="space-y-6 pt-4">
            {especies.map((especie) => (
              <ListaEditavel<LinhaDeItem>
                key={especie.valor}
                titulo={especie.titulo}
                descricao={especie.descricao}
                itens={porEspecie[especie.valor] ?? []}
                aoMudar={(linhas) =>
                  setPorEspecie((atual) => ({ ...atual, [especie.valor]: linhas }))
                }
                linhaNova={() => ({ nome: "", descricao: "", link: "", obrigatorio: false })}
                rotuloDeAdicionar={`Adicionar ${especie.rotulo.toLowerCase()}`}
                colunas={[
                  { campo: "nome", rotulo: "Nome", peso: 2 },
                  { campo: "descricao", rotulo: "Descrição", peso: 3 },
                  ...(especie.usaLink
                    ? [
                        {
                          campo: "link" as const,
                          rotulo: "Link",
                          peso: 2,
                          placeholder: "https://",
                        },
                      ]
                    : []),
                  ...(especie.usaObrigatorio
                    ? [
                        {
                          campo: "obrigatorio" as const,
                          rotulo: "Obrigatório",
                          tipo: "booleano" as const,
                        },
                      ]
                    : []),
                ]}
              />
            ))}
          </TabsContent>

          <TabsContent value="consultas" className="space-y-6 pt-4">
            <ListaEditavel<LinhaDeIndicador>
              titulo="Indicadores"
              descricao="Cadastrados agora, calculados quando o Modo Monitoramento existir."
              itens={indicadores}
              aoMudar={setIndicadores}
              linhaNova={() => ({
                nome: "",
                descricao: "",
                unidade: "",
                sentido: "NEUTRO",
                origem: "",
              })}
              rotuloDeAdicionar="Adicionar indicador"
              colunas={[
                { campo: "nome", rotulo: "Nome", peso: 3 },
                { campo: "unidade", rotulo: "Unidade", peso: 1, placeholder: "%" },
                {
                  campo: "sentido",
                  rotulo: "Sentido",
                  tipo: "escolha",
                  opcoes: (catalogo?.sentidosDoIndicador ?? []).map((s) => ({
                    valor: s.valor,
                    rotulo: s.rotulo,
                  })),
                },
                { campo: "origem", rotulo: "Fonte prevista", peso: 3 },
              ]}
            />

            <ListaEditavel<LinhaDeAcao>
              titulo="Consultar no FreightCheck"
              descricao="Botões que levam a uma tela deste produto. A rota é um caminho interno, como /alteracoes."
              itens={acoes}
              aoMudar={setAcoes}
              linhaNova={() => ({ titulo: "", descricao: "", rota: "" })}
              rotuloDeAdicionar="Adicionar consulta"
              colunas={[
                { campo: "titulo", rotulo: "Título", peso: 2 },
                { campo: "rota", rotulo: "Rota", peso: 2, placeholder: "/alteracoes" },
                { campo: "descricao", rotulo: "Descrição", peso: 3 },
              ]}
            />

            <div>
              <Label htmlFor="etapa-chave">Chave de monitoramento</Label>
              <Input
                id="etapa-chave"
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="cte.autorizacao_sefaz"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Opcional. Um nome estável pelo qual o Modo Monitoramento vai poder ligar dados
                reais a esta etapa. Hoje nada o lê.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {salvar.isError && (
          <Alert variant="destructive">
            <AlertDescription>{fraseDoErro(salvar.error)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || nome.trim() === ""}
          >
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {etapa ? "Salvar etapa" : "Criar etapa"}
          </Button>
        </DialogFooter>
    </Dialog>
  );
}
