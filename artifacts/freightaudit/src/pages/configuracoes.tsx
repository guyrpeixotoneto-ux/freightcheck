import { Link } from "wouter";
import { ArrowLeft, Settings } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { PainelDeUnidades } from "@/pages/unidades";
import { IndiceDeConfiguracoes } from "@/components/configuracoes/indice";
import { PainelDeUsuarios } from "@/components/configuracoes/usuarios";
import { PainelDoPerfil } from "@/components/configuracoes/perfil";
import { PainelDeSeguranca } from "@/components/configuracoes/seguranca";
import { PainelDePermissoes } from "@/components/configuracoes/permissoes";
import {
  PainelDeCargos,
  PainelDeDepartamentos,
  PainelDeNegocios,
} from "@/components/configuracoes/cadastro-da-casa";
import { SECOES_GERAIS } from "@/components/configuracoes/secoes";

/**
 * Configurações — a casa inteira, agora como índice.
 *
 * Eram duas abas numa tela só, Unidades e Usuários, e cabia. A casa cresceu
 * para oito seções, e uma barra de abas com oito botões obriga a ler tudo para
 * achar uma, estreitando cada aba a cada seção nova. O índice inverte isso: a
 * lista cresce para baixo, cada linha diz o que é e **o que já tem** antes de
 * ser aberta, e cada seção passa a ter endereço próprio — `/configuracoes/
 * usuarios` abre em Usuários, e não em "Configurações, segunda aba".
 *
 * `/unidades` continua sendo endereço válido — está em link compartilhado e no
 * "voltar para a casa" de `lib/ambiente-aberto.ts` — e abre a seção de
 * Unidades. Nenhum link antigo cai no vazio.
 *
 * Cargos, Negócio e Departamento eram três dessas seções e deixaram de ser: o
 * cadastro da casa nasceu (`components/configuracoes/cadastro-da-casa.tsx`), as
 * três saíram do catálogo de `pages/telas-em-preparo.ts` e ganharam caso aqui.
 * O que ainda não tem caso — Minha Empresa — continua vindo do catálogo e abre
 * a página que diz o que falta; o índice a lista marcada, ver
 * `components/configuracoes/secoes.ts`.
 *
 * Toda esta tela é um módulo só para efeito de permissão (`/configuracoes`):
 * `moduloDaLocalizacao` casa por prefixo, então as seções herdam a decisão
 * tomada sobre a casa, sem pedir oito decisões onde havia uma.
 */

type Secao =
  | "indice"
  | "unidades"
  | "usuarios"
  | "perfil"
  | "seguranca"
  | "permissoes"
  | "cargos"
  | "negocio"
  | "departamento";

const TITULO: Record<Exclude<Secao, "indice">, string> = {
  unidades: "Unidades",
  usuarios: "Usuários",
  perfil: "Meu Perfil",
  seguranca: "Segurança",
  permissoes: "Permissões",
  cargos: "Cargos",
  negocio: "Negócio",
  departamento: "Departamento",
};

export default function Configuracoes({ secao = "indice" }: { secao?: Secao }) {
  if (secao === "indice") {
    return (
      <Layout>
        <header className="border-b bg-card px-8 py-6">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary" />
            Configurações
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            A casa do produto: as unidades que existem, quem pode entrar e o que
            cada pessoa alcança. Todo acesso dado aqui fica no nome de quem o
            deu, e é esse nome que assina cada confirmação de curadoria e cada
            promoção de vigência feita pela pessoa.
          </p>
        </header>
        <IndiceDeConfiguracoes />
      </Layout>
    );
  }

  const endereco = `/configuracoes/${secao}`;
  const descricao =
    SECOES_GERAIS.find((s) => s.href === endereco)?.descricao ?? "";

  return (
    <Layout>
      {/*
        O caminho de volta é um link explícito, e não a seta do navegador: quem
        chega por endereço colado nunca esteve no índice, e sem esta linha
        descobriria as outras seis seções por acaso.
      */}
      <header className="border-b bg-card px-8 py-6">
        <Link
          href="~/configuracoes"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Configurações
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-1">
          {TITULO[secao]}
        </h1>
        {descricao && (
          <p className="text-muted-foreground mt-1 max-w-3xl">{descricao}</p>
        )}
      </header>

      <div className="p-8">
        {secao === "unidades" && <PainelDeUnidades />}
        {secao === "usuarios" && <PainelDeUsuarios />}
        {secao === "perfil" && <PainelDoPerfil />}
        {secao === "seguranca" && <PainelDeSeguranca />}
        {secao === "permissoes" && <PainelDePermissoes />}
        {/*
          As três seções que saíram do catálogo de telas em preparo quando o
          cadastro passou a existir. O menu não mudou uma vírgula: os itens já
          estavam lá, com o nome certo — o que mudou é que abrir um deles agora
          cadastra em vez de explicar o que falta.
        */}
        {secao === "cargos" && <PainelDeCargos />}
        {secao === "negocio" && <PainelDeNegocios />}
        {secao === "departamento" && <PainelDeDepartamentos />}
      </div>
    </Layout>
  );
}
