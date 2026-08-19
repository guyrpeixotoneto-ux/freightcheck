import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowRight, CalendarDays, Plus } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
import {
  abrirCompetencia,
  listarCompetencias,
  listarPartes,
  NOME_DO_ESTADO,
  type Parte,
} from "@/lib/fechamento";
import { apresentar } from "@/lib/apresentar-erro";

/**
 * O erro, na frase que a apresentação escolheu.
 *
 * `apresentar` decide entre a orientação tipada e a mensagem crua — a regra de
 * "uma orientação só" mora lá, e repeti-la aqui abriria uma segunda opinião
 * sobre o mesmo erro.
 */
function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

/**
 * O texto digitado, lido como `código — nome`.
 *
 * O separador aceita travessão, hífen ou barra porque quem digita não sabe qual
 * escolhemos, e as três formas são inequívocas: o código de um CDD e o de uma
 * transportadora são numéricos, então o que vem antes do separador é o código e
 * o que vem depois é o nome. Sem separador, o texto inteiro vira código — é o
 * caso de quem digita só `443`, e o nome fica em branco até alguém escrevê-lo.
 */
function cadastrar(texto: string): Parte {
  const partido = /^\s*([^—\-/]+?)\s*[—\-/]\s*(.+?)\s*$/.exec(texto);
  if (partido) return { codigo: partido[1], nome: partido[2], competencias: 0 };
  return { codigo: texto.trim(), nome: null, competencias: 0 };
}

const rotuloDaParte = (p: Parte) => (p.nome ? `${p.codigo} — ${p.nome}` : p.codigo);

const detalheDaParte = (p: Parte) =>
  p.competencias === 0
    ? "nova — vai ser cadastrada ao abrir a competência"
    : `${p.competencias} competência${p.competencias === 1 ? "" : "s"}`;

const previaDaParte = (texto: string) => {
  const parte = cadastrar(texto);
  return parte.nome
    ? `Código ${parte.codigo}, nome “${parte.nome}”.`
    : `Código ${parte.codigo}, sem nome — escreva “${parte.codigo} — Nome” para nomeá-la.`;
};

/**
 * Competências — os períodos que o fechamento fecha.
 *
 * A tela é uma lista e um formulário, e o formulário é curto de propósito: uma
 * competência é (unidade, transportadora, quinzena), e nada mais. Tudo o que a
 * define depois — quanto vale, o que falta — vem dos arquivos que a Ambev
 * exporta, não de campo digitado.
 *
 * Abrir a mesma competência duas vezes devolve a que já existe, e o botão
 * simplesmente navega para ela. É o gesto de quem volta no dia seguinte, e
 * tratá-lo como erro ("esta competência já existe") ensinaria a pessoa a temer
 * um botão que não faz mal nenhum.
 */
export default function Competencias() {
  const [, navegar] = useLocation();
  const cliente = useQueryClient();
  const hoje = new Date();

  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1));
  const [quinzena, setQuinzena] = useState(hoje.getDate() <= 15 ? "1" : "2");
  const [unidade, setUnidade] = useState<Parte | null>(null);
  const [transportadora, setTransportadora] = useState<Parte | null>(null);

  const competencias = useQuery({
    queryKey: ["fechamento", "competencias"],
    queryFn: listarCompetencias,
  });
  const partes = useQuery({ queryKey: ["fechamento", "partes"], queryFn: listarPartes });

  const abrir = useMutation({
    mutationFn: () =>
      abrirCompetencia({
        ano: Number(ano),
        mes: Number(mes),
        quinzena: Number(quinzena) as 1 | 2,
        unidade: { codigo: unidade!.codigo, nome: unidade!.nome ?? undefined },
        transportadora: {
          codigo: transportadora!.codigo,
          nome: transportadora!.nome ?? undefined,
        },
      }),
    onSuccess: (criada) => {
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "partes"] });
      navegar(`/fechamento/competencias/${criada.id}`);
    },
  });

  const podeAbrir = unidade !== null && transportadora !== null;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Competências</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Cada competência é uma quinzena de um CDD com uma transportadora — o
          período que se apura, se confere e se fecha.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-4xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Abrir competência
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ano">Ano</Label>
                <Input id="ano" value={ano} onChange={(e) => setAno(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mes">Mês</Label>
                <Input id="mes" value={mes} onChange={(e) => setMes(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quinzena">Quinzena</Label>
                <Select value={quinzena} onValueChange={setQuinzena}>
                  <SelectTrigger id="quinzena">
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
                <Label htmlFor="unidade">Unidade (CDD)</Label>
                <ComboboxCriavel<Parte>
                  id="unidade"
                  itens={partes.data?.unidades ?? []}
                  valor={unidade}
                  aoEscolher={setUnidade}
                  aoCriar={(texto) => Promise.resolve(cadastrar(texto))}
                  rotuloDe={rotuloDaParte}
                  detalheDe={detalheDaParte}
                  chaveDe={(p) => p.codigo}
                  placeholder="Escolha ou digite o código e o nome"
                  rotuloDeCriacao={(texto) => `Usar “${texto}”`}
                  previaDe={previaDaParte}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transportadora">Transportadora</Label>
                <ComboboxCriavel<Parte>
                  id="transportadora"
                  itens={partes.data?.transportadoras ?? []}
                  valor={transportadora}
                  aoEscolher={setTransportadora}
                  aoCriar={(texto) => Promise.resolve(cadastrar(texto))}
                  rotuloDe={rotuloDaParte}
                  detalheDe={detalheDaParte}
                  chaveDe={(p) => p.codigo}
                  placeholder="Escolha ou digite o código e o nome"
                  rotuloDeCriacao={(texto) => `Usar “${texto}”`}
                  previaDe={previaDaParte}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              As duas listas são as unidades e transportadoras que já apareceram
              em alguma competência — não há cadastro à parte. Para uma nova,
              digite <code className="font-mono">código — nome</code> (por
              exemplo <code className="font-mono">443 — CDD Belém</code>) e
              escolha “Usar”.
            </p>

            {abrir.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(abrir.error)}</AlertDescription>
              </Alert>
            )}

            <Button onClick={() => abrir.mutate()} disabled={!podeAbrir || abrir.isPending}>
              {abrir.isPending ? "Abrindo…" : "Abrir competência"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Competências abertas</CardTitle>
          </CardHeader>
          <CardContent>
            {competencias.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}
            {competencias.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(competencias.error)}</AlertDescription>
              </Alert>
            )}
            {competencias.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma ainda. Abra a primeira acima e envie os cinco relatórios da quinzena.
              </p>
            )}
            <ul className="divide-y">
              {competencias.data?.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/fechamento/competencias/${c.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-muted/50 -mx-2 px-2 rounded"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>
                          {c.inicio.split("-").reverse().join("/")} a {c.fim.split("-").reverse().join("/")}
                        </span>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                          {NOME_DO_ESTADO[c.estado]}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {c.unidade.nome ?? c.unidade.codigo} · {c.transportadora.nome ?? c.transportadora.codigo}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
