# FreightCheck — Panorama Executivo, o quinto módulo da Visão executiva

> **Status: implementado**, pelo **caminho B** do §3.1 e com o nome *Panorama
> Executivo*. O que este documento propunha está de pé em `/panorama`; os quatro
> módulos consolidados continuam nos endereços deles, e a raiz não mudou.
> Nenhum schema tocado, nenhuma migration, nenhum endpoint criado, nenhum número
> de apuração alterado.
>
> **Onde mora o que.** A aritmética dos sete andares em `lib/panorama.ts`
> (testada em `lib/__tests__/panorama.test.ts`); os andares que não tinham
> componente em `components/panorama/`; a tela em `pages/panorama.tsx` (montada
> de ponta a ponta em `lib/__tests__/panorama.pagina.test.tsx`). Os andares 3, 4
> e a faixa de confiança reusam, sem cópia, os componentes que o Impacto Apurado
> já tinha.
>
> **Duas coisas saíram diferentes do que este documento propôs**, e as duas estão
> anotadas no código onde acontecem:
>
> 1. **O controle de população do andar 4 virou um link para a Linha do Tempo**,
>    e não uma pastilha dentro do cartão. Trocar o tipo troca a *população* de
>    todo número: com "Carreta" ligado ali, o andar 4 falaria de carretas
>    enquanto os outros seis continuariam falando da frota inteira, na mesma tela
>    e sem nada acusando a divergência — a classe exata de defeito que o módulo
>    existe para desfazer. A Linha do Tempo pode fazê-lo porque lá o tipo é aba
>    **de página**, e a tela inteira troca junto.
> 2. **A fase 1 (extrair blocos de `dashboard.tsx` e `inicio.tsx`) não foi
>    feita.** O invariante que importa — *uma aritmética só* — está garantido sem
>    ela: todo número do Panorama sai de função que já existia. O que sobra é
>    duplicação de *apresentação* (uma grade de cinco tiles), que é barata e
>    reversível; a extração cirúrgica de um arquivo de 2.756 linhas é onde mora o
>    risco de regressão, e ela fica para o caminho C, quando deixará de ser
>    extração e passará a ser remoção.
>
> **Pergunta que originou o documento:** *"Impacto Líquido, Impacto Apurado,
> Resumo executivo e Linha do Tempo dizem a mesma coisa de formas diferentes.
> Concorda? Queria um quinto módulo com tudo o que esses quatro têm, mas de
> forma gerencial, executiva e completa."*
>
> **Base empírica:** leitura do código atual do branch, em
> `artifacts/freightaudit/src`. Toda contagem citada aqui foi medida nos
> arquivos, não estimada:
> `pages/dashboard.tsx` (2.312 linhas), `pages/impacto-apurado.tsx` (577),
> `pages/inicio.tsx` (2.756), `pages/linha-do-tempo.tsx` (628) — 6.273 linhas de
> tela; mais `lib/visao-geral.ts` (1.845), `lib/impacto-apurado.ts` (808),
> `lib/serie-de-impacto.ts` (211) e `lib/cockpit.ts` (162) — 3.026 linhas de
> aritmética compartilhada.

---

## 1. Sim, concordo — e o código já dizia isso antes de mim

A pergunta não é uma impressão de quem olha o menu. Ela está escrita, por
extenso, nos comentários das próprias telas.

`pages/impacto-apurado.tsx`, na primeira linha da documentação do módulo:

> *"Os dois leem exatamente a mesma resposta do servidor, sob a mesma chave de
> cache. São dois módulos vizinhos justamente por isso: **não são dois acervos,
> são duas alturas de leitura do mesmo**."*

`components/layout/nav-auditoria.ts`, sobre a fusão que criou a seção:

> *"A divisão não era de assunto, era de história: os dois módulos de vigilância
> nasceram depois das telas executivas e ganharam cartão próprio ao lado delas.
> **Quem chega, porém, lê tudo isto na mesma sentada.**"*

Ou seja: **a seção já sabe que é um assunto só.** Os quatro módulos não são
quatro perguntas — são quatro formatos, cada um herdado de um momento diferente
da história do produto. Nenhum deles foi desenhado contra os outros três.

### 1.1 A prova material: mesma fonte, mesma conta, mesma chave

| | Impacto Líquido | Impacto Apurado | Resumo executivo | Linha do Tempo |
|---|---|---|---|---|
| Endereço | `/dashboard` | `/impacto-apurado` | `/resumo-executivo` | `/linha-do-tempo` |
| Fonte principal | `/changes/families` | `/changes/families` | `/changes/families` | `/changes/families` |
| Soma de unidades | `/changes/families/overview` | `/changes/families/overview` | `/changes/families/overview` | `/changes/families/overview` |
| Série por vigência | `/changes/range` | `/changes/range` | `/changes/range` | `/changes/range` |
| Recorte na URL | `period` · `scopeHash` · `canal` | idem | idem | idem |
| Modo "Visão Geral" | `?visaoGeral=1` | idem | idem | idem |
| Aritmética | `lib/visao-geral.ts` | `lib/impacto-apurado.ts` (projeção de `sides`) | `lib/visao-geral.ts` | `lib/visao-geral.ts` |

**Não há um endpoint que uma delas leia e as outras não**, com duas exceções
menores: o Resumo executivo lê também `/balance` e `/imports` (a qualidade da
apuração), e todas as quatro chegam ao mesmo `ExecutiveSummary`.

Medida de sobreposição de dependências entre as quatro telas (imports `@/…`
compartilhados):

```
Impacto Líquido ∩ Impacto Apurado    = 17
Impacto Líquido ∩ Resumo executivo   = 17
Impacto Líquido ∩ Linha do Tempo     = 14
Impacto Apurado ∩ Resumo executivo   = 13
Resumo executivo ∩ Linha do Tempo    = 14
Impacto Apurado ∩ Linha do Tempo     = 10
```

Cada tela importa entre 21 e 28 módulos. **A metade de cada uma é a outra.**

### 1.2 O que cada uma publica hoje, lado a lado

| Bloco | Impacto Líquido | Impacto Apurado | Resumo executivo | Linha do Tempo |
|---|:--:|:--:|:--:|:--:|
| Impacto líquido da vigência | ✅ cartão em destaque | ✅ manchete | ✅ cartão | ✅ placar do topo |
| Ganhos / perdas separados | ✅ dois cartões | ✅ na ponte | ✅ dentro do drill | ✅ na linha |
| Alterações detectadas | ✅ faixa fina | ✅ faixa de cobertura | ✅ cartão | ✅ por vigência |
| Veículos afetados | ✅ movimentação | — | ✅ cartão | ✅ por vigência |
| Sem impacto calculável | ✅ anel | ✅ faixa | ✅ cartão | — |
| Cobertura | ✅ *financeira* | ✅ *financeira* | ✅ *auditada* | — |
| Gráfico de impacto por vigência | ✅ | ✅ *(evolução)* | ✅ | ✅ |
| Ranking de parâmetros/famílias | ✅ maiores impactos | ✅ principais mudanças | ✅ maiores impactos | — |
| Fila do que fazer agora | ✅ principais alterações | ✅ onde agir agora | ✅ o que merece atenção | — |
| Ranking de unidades (Visão Geral) | ✅ unidades em atenção | — | ✅ unidades em destaque | ✅ unidade a unidade |
| Gaveta de detalhe (família/impacto) | ✅ | ✅ | ✅ | — |

**Três blocos aparecem nas quatro telas. Cinco aparecem em três delas.**

### 1.3 Onde a redundância deixou de ser desperdício e virou risco

Há um caso em que a duplicação não custa só código — custa confiança:

- O **Impacto Líquido** publica um cartão chamado **"Cobertura financeira"** com
  um anel: `alterações precificadas ÷ alterações detectadas`
  (`coberturaApurada`, em `lib/impacto-apurado.ts`).
- O **Resumo executivo** publica uma rosca chamada **"Cobertura auditada"**:
  `células alcançadas ÷ células importadas` (`cobertura`, em
  `lib/visao-geral.ts`).

São **populações diferentes** — uma conta linhas de alteração, a outra conta
células de planilha. Ambas saem em percentual, ambas desenham um anel, ambas
pegam a cor da mesma régua (`qualidadeDaCobertura`). Quem abre as duas telas na
mesma vigência vê **"Cobertura 87%"** numa e **"Cobertura 94%"** na outra, do
mesmo recorte, e não tem como saber que falam de coisas diferentes sem parar
para ler o tooltip.

Cada tela está certa isoladamente. **A seção, lida inteira, está confusa** — e
esse é exatamente o defeito que um módulo consolidado corrige por construção.

### 1.4 A contra-prova honesta: o que de fato é único

Concordar que "dizem a mesma coisa" não pode virar preguiça. Quatro blocos são
genuinamente exclusivos de uma tela cada, e um quinto módulo que os perdesse
seria uma regressão, não uma consolidação:

1. **A ponte por família** (`ponteDoImpacto`), só no Impacto Apurado — o
   *waterfall* que decompõe o líquido em degraus. Nenhuma outra tela explica *de
   onde vem* o número; elas só o listam.
2. **A aba por tipo de ativo** (Cavalo, Carreta, Trecho…), só na Linha do Tempo
   — trocar a **população**, e não filtrar a lista, com o recorte feito no
   servidor (`getRangeAnalysis`).
3. **A qualidade da apuração** (`/balance` + `/imports`), só no Resumo executivo
   — cobertura de células, integridade e última importação.
4. **A porta da Gestão à Vista** e o *sparkline* de ganhos/perdas, só no Impacto
   Líquido.

**Conclusão da seção 1:** os quatro módulos respondem a *uma* pergunta em quatro
formatos, e carregam entre si quatro pedaços insubstituíveis. Há material de
sobra para um módulo único — e há motivo de sobra para ele existir.

---

## 2. O que proponho: **Panorama Executivo**

> **Nome:** Panorama Executivo · **Endereço:** `/panorama` · **Posição na
> lateral:** o **primeiro** item da seção *Visão executiva*.
>
> *Alternativas de nome consideradas e descartadas:* "Painel Executivo" (a
> lateral já tem "Painel de Unidades" e "Painel de Justificativas" — um terceiro
> painel apaga a distinção), "Visão 360" (a Frota já usa "360°" para o ativo
> individual), "Cockpit" (é o nome interno da fila de prioridades,
> `lib/cockpit.ts`, e reusá-lo na tela criaria duas coisas com um nome).

### 2.1 A tese

O Panorama é **uma tela, uma narrativa, sete andares** — as sete perguntas que
uma diretoria faz sobre uma vigência, na ordem em que ela as faz, cada uma
respondida uma vez só e no lugar onde ela é feita.

Ele não é "os quatro módulos empilhados". Empilhar seria trocar quatro telas
redundantes por uma tela longa e redundante. Ele é a **fusão** delas: onde três
módulos hoje desenham a mesma coisa de três jeitos, o Panorama desenha **o
melhor dos três, uma vez**.

### 2.2 O princípio que atravessa a tela inteira

O mesmo que o Impacto Líquido já declara, e que passa a valer para os cinco
módulos:

> **Tudo aqui é medido, nada é previsto.** Não existe "projetado em 12 meses" em
> lugar nenhum. O que a tela não tem dado honesto para dizer, ela omite — nunca
> aproxima.

E três recusas herdadas do Resumo executivo, agora escritas num lugar só:

1. **Periodicidade nunca soma.** Uma linha por periodicidade, sempre.
2. **Cartão sem dado não aparece.** Nada mostra "0" para preencher lugar.
3. **Nenhuma comparação inventada.** "vs. vigência anterior" só existe quando há
   vigência anterior e ela foi de fato consultada.

### 2.3 A anatomia — sete andares

Cada andar traz, entre colchetes, **de onde vem** e **qual função já existente o
sustenta**. Não há uma linha de aritmética nova nesta proposta.

---

#### Andar 0 · A faixa de contexto *(fixa no topo ao rolar)*

De quem são estes números e de quando.

- Seletor de unidade / **Visão Geral** · seletor de vigência · canal
- Relógio de atualização (`dataUpdatedAt`, nunca `new Date()` fabricado)
- Botões: **Gestão à Vista** (telão) · **Exportar** (§3.3)

> **[origem]** cabeçalho já compartilhado pelas quatro:
> `SeletorDeUnidade`, `SeletorDeVigencia`, `MenuDaGestaoAVista`, `EmAtualizacao`.
> **Novidade:** ficar fixo ao rolar — numa tela de sete andares, saber de qual
> unidade se está lendo não pode depender de rolar de volta ao topo.

---

#### Andar 1 · **O veredito** — *"quanto custou esta vigência?"*

Um número em corpo grande, e só ele. Ao lado, em corpo pequeno: ganhos, perdas,
e a variação contra a vigência anterior. Imediatamente abaixo, a **faixa de
confiança**: *"Resultado parcial · 1.284 de 1.470 alterações (87%) possuem
impacto financeiro apurado."*

> **[origem]** a manchete do **Impacto Apurado** (`situacaoDaApuracao`,
> `mancheteApurada`) + a variação do **Resumo executivo** (`variacao`,
> `vigenciaAnterior`) + a faixa de cobertura (`coberturaDaVigencia`,
> `frasesDaCobertura`).
> **Por que a confiança vem no andar 1 e não no rodapé:** um resultado com 7% de
> cobertura e um com 99% são duas conversas diferentes, e a diferença não pode
> ficar num anel discreto três telas abaixo.

---

#### Andar 2 · **O placar** — *"e os outros números?"*

Cinco cartões da mesma régua, clicáveis, cada um abrindo a gaveta de detalhe que
já existe:

`Impacto líquido` · `Alterações detectadas` · `Veículos afetados` ·
`Sem impacto calculável` · `Cobertura da apuração`

> **[origem]** os cinco cartões do **Resumo executivo** — que já são o
> superconjunto dos quatro do Impacto Líquido. Os *sparklines* de ganhos e
> perdas do Impacto Líquido entram nos cartões correspondentes.
> **A correção do §1.3 acontece aqui:** existe **uma** cobertura no placar — a
> **cobertura da apuração** (alterações precificadas ÷ detectadas), que é a que
> qualifica o número do andar 1. A **cobertura auditada** (células de planilha)
> não some: ela desce para o andar 7, onde é o que sempre foi — uma medida de
> *procedência do dado*, não de *resultado financeiro*. Duas coberturas com o
> mesmo peso visual na mesma tela é o defeito que estamos consertando; separá-las
> por assunto é o conserto.

---

#### Andar 3 · **A composição** — *"de onde vem esse número?"*

Duas colunas lado a lado, lendo o mesmo `ExecutiveSummary.sides`:

- **Esquerda (2/3):** a **ponte por família** — o *waterfall* que sai do zero,
  soma os degraus e fecha no líquido do andar 1. Cada degrau abre a gaveta da
  família.
- **Direita (1/3):** **os dois lados** — ganhos e perdas por parâmetro, com o
  filtro `todos · ganhos · perdas`, ordenado por peso.

> **[origem]** `ponteDoImpacto` + `PonteDoImpactoGrafico` e `mudancasRelevantes`
> + `PrincipaisMudancas`, ambos do **Impacto Apurado**; funde com "Maiores
> impactos" do **Impacto Líquido** e do **Resumo executivo**, que são a mesma
> lista com outro rótulo (`maiores Impactos`, `impactoPorFamilia`).
> **Por que a ponte fica com a coluna larga:** ela é a única figura do produto
> que *explica* o líquido em vez de listá-lo, e é o bloco de maior valor
> executivo dos quatro módulos.

---

#### Andar 4 · **A trajetória** — *"estamos melhorando ou piorando?"*

O gráfico de impacto por vigência, com dois controles no próprio cartão:

- **Janela:** 6 · 12 · todo o histórico
- **População:** Geral · Cavalo · Carreta · Trecho *(os equipamentos do ambiente
  aberto — Caminhão/Carroceria no Rota e no AS, Empilhadeira no Apoio)*

Abaixo do gráfico, a **tabela do histórico**: uma linha por vigência com
impacto, alterações, veículos tocados e o link que abre as alterações daquela
vigência. Clicar numa barra do gráfico troca a vigência aberta da tela inteira,
com botão de voltar.

> **[origem]** `GraficoDeImpacto` + `useSerieDeImpacto` (nas quatro telas) +
> `LinhaDoTempoDeAlteracoes` e as abas por tipo da **Linha do Tempo**
> (`equipamentosDoAmbiente`, `ehTipoDaLinhaDoTempo`).
> **A mudança de altitude:** na Linha do Tempo o tipo é uma **aba de página** —
> escolher "Carreta" troca a tela inteira. Aqui ele é um **controle do cartão**:
> a trajetória é um andar entre sete, e não pode sequestrar a leitura dos outros
> seis. O eixo por placa continua sendo tela própria (`/evolucao-por-placa`),
> alcançável por um link daqui: são centenas de séries, e não cabem num andar.

---

#### Andar 5 · **O mapa** — *"onde isso aconteceu?"*

O conteúdo deste andar depende do recorte, e é a única parte da tela que muda de
forma entre as duas leituras:

- **Em Visão Geral:** o ranking de unidades por impacto, com as em atenção no
  topo; cada linha abre aquela unidade no próprio Panorama.
- **Dentro de uma unidade:** a movimentação da frota (entraram / saíram /
  ativos) e os equipamentos mais tocados na vigência.

> **[origem]** `unidadesPorImpacto` e "Unidades em atenção" do **Impacto
> Líquido**, "Unidades em destaque" do **Resumo executivo**, `frotaTotal` e
> `equipamentoMaisTocado` de `lib/visao-geral.ts`.
> **Por que é o único andar que muda:** a soma de unidades não tem uma frota a
> movimentar, e uma unidade não tem um ranking de unidades. Fingir simetria aqui
> produziria um cartão vazio numa das duas leituras — e cartão sem dado não
> aparece.

---

#### Andar 6 · **A fila** — *"o que eu faço agora?"*

Uma lista só, ordenada por consequência. Cada linha diz o que aconteceu, quanto
custa, quantos veículos toca, e traz o botão que abre a tela onde o trabalho é
feito (Alterações, Curadoria, Parâmetros, Justificativas).

> **[origem]** a fusão de **três listas que hoje são a mesma coisa em três
> telas**: "Onde agir agora" (`ondeAgirAgora`, Impacto Apurado), "O que merece
> sua atenção" (`pontosDeAtencao`, Resumo executivo) e "Principais alterações"
> (`juntarPrioridades`, Impacto Líquido).
> **Este é o maior ganho da consolidação.** Hoje as três listas leem a mesma
> `FamiliesView` e ordenam por critérios ligeiramente diferentes — quem lê os
> três módulos recebe três respostas para "por onde começo", sem nenhuma pista
> de qual delas seguir. Uma fila, um critério, um lugar.

---

#### Andar 7 · **A procedência** — *"posso confiar nisto?"*

O último andar, e deliberadamente o último: quem abre a tela vem ver dinheiro, e
a qualidade do dado nunca deve competir com o financeiro pelo primeiro olhar.

- **Cobertura auditada** — células alcançadas ÷ células importadas, com o rótulo
  por extenso ("das células importadas", nunca "% do valor")
- **Integridade** do acervo · **última importação** (hora e há quanto tempo)
- A frase de rastreabilidade e o link para o Rastreio de Dados

> **[origem]** o cartão "Qualidade da auditoria" e o rodapé "Dados rastreáveis
> até a origem" do **Resumo executivo** (`cobertura`, `integridade`,
> `ultimaImportacao`, sobre `/balance` e `/imports`).
> **Por que sobe do Resumo executivo sem mudar nada:** é o único bloco dos quatro
> módulos que lê fontes fora de `/changes`, e é o único que responde por *como
> sabemos*, e não por *quanto foi*.

---

### 2.4 O que o Panorama **não** faz

Uma proposta que só acrescenta não é uma proposta, é uma lista de desejos. O que
fica de fora, e por quê:

| Não faz | Por quê |
|---|---|
| Não apura dinheiro | Zero endpoints novos, zero somas novas. Toda conta é uma projeção de `ExecutiveSummary` por função que já existe e já é testada fora do JSX. Se o Panorama publicasse um líquido diferente do Impacto Apurado, seria a quinta verdade sobre o mesmo dado — exatamente o defeito que ele existe para curar. |
| Não projeta, não anualiza | Multiplicar uma competência por doze é chamar uma medida de outra coisa. |
| Não soma periodicidades | Uma linha por periodicidade. A regra do produto inteiro. |
| Não traz a árvore de parâmetros | Continua em `/parametros`. Um drill-down de três níveis dentro de uma tela de sete andares é uma tela dentro da outra. |
| Não traz a evolução por placa | Continua em `/evolucao-por-placa`, com link daqui. Centenas de séries não cabem num andar. |
| Não substitui a Visão Gerencial | `/visao-gerencial` responde pelo **ano inteiro, unidade a unidade, e pelo que ninguém comparou**. O Panorama responde por **uma vigência**. São eixos diferentes, e o Panorama linka para lá. |
| Não abre a Gestão à Vista embutida | O telão é outro formato de consumo (autoplay, sem interação). Continua sendo destino, não andar. |

### 2.5 Como fica a leitura, de cima a baixo

```
┌────────────────────────────────────────────────────────────────┐
│ 0  PERNAMBUCO · ago/2026 · EMPURRADA        ⟳ 14:22   [telão] │ ← fixa
├────────────────────────────────────────────────────────────────┤
│ 1  − R$ 47,3 mil /mês        ganhos +R$ 12,1k · perdas R$ 59,4k│
│    vs. jul/2026: −18%                                          │
│    ▸ Resultado parcial · 1.284 de 1.470 alterações (87%)       │
├────────────────────────────────────────────────────────────────┤
│ 2  [líquido] [alterações] [veículos] [sem preço] [cobertura]   │
├────────────────────────────────────────────────────────────────┤
│ 3  ┌── ponte por família (waterfall) ──┐ ┌ ganhos│perdas ─────┐│
│    │  0 ─┬─ AQUISIÇÃO ─┬─ PNEUS ─┬ ... │ │ · parâmetro    R$ ││
│    └────────────────────────────────────┘ └───────────────────┘│
├────────────────────────────────────────────────────────────────┤
│ 4  ┌ 6│12│tudo ─── Geral│Cavalo│Carreta│Trecho ───────────────┐│
│    │  ▁▃▅▂▇▄  impacto por vigência                            ││
│    │  jul/26  −R$ 57,9k · 1.203 alt. · 88 veíc. →             ││
│    └───────────────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────────┤
│ 5  frota: +3 entraram · −1 saiu · 144 ativos                   │
│    (em Visão Geral: ranking de unidades por impacto)           │
├────────────────────────────────────────────────────────────────┤
│ 6  O QUE FAZER AGORA                                           │
│    1. 186 alterações sem preço travadas por semântica → Curadoria│
│    2. IPVA caiu em 41 carretas (−R$ 8,2k/mês)      → Alterações │
├────────────────────────────────────────────────────────────────┤
│ 7  cobertura auditada 94% das células · íntegro · 06:12 hoje   │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. Consequências, e as decisões que são suas

### 3.1 O que fazer com os quatro módulos existentes — **a decisão que importa**

Um quinto módulo que contém os quatro **torna os quatro redundantes**. Ignorar
isso seria entregar cinco telas onde havia quatro redundantes, o que é pior.
Três caminhos, e minha recomendação:

**(A) O Panorama entra e os quatro ficam.** É o que o pedido diz literalmente. A
seção passa a ter 5 módulos de leitura + 5 de aprofundamento. *Custo:* a
confusão do §1.3 continua existindo, agora com uma tela a mais para não bater.
Não recomendo.

**(B) ▸ O Panorama entra como porta, e os quatro viram aprofundamentos.
— recomendado.** O Panorama passa a ser o primeiro item da seção *Visão
executiva*. Impacto Líquido, Impacto Apurado, Resumo executivo e Linha do Tempo
continuam existindo, com os endereços intactos (nenhum link colado em e-mail
morre), mas descem na lateral e ganham a função que já exercem de fato — a
exploração detalhada de um andar. Os andares 3, 4, 6 e 7 do Panorama linkam para
eles. *Ganho:* uma leitura executiva inequívoca, sem quebrar nada, sem apagar
trabalho. *Custo:* a lateral fica com um item a mais até a decisão (C).

**A raiz fica como está, e isso é deliberado.** Hoje `destinoDaRaiz`
(`lib/ambiente.ts`) manda `/` sem consulta para a Visão Gerencial e `/` **com**
recorte para o Resumo executivo — e é essa segunda regra que mantém vivo todo
link antigo colado em e-mail. Apontar a raiz para o Panorama é uma decisão
separada desta, e que só faz sentido depois de (C): enquanto o Resumo executivo
existir, ele é o destino que aqueles links pediram.

**(C) O Panorama entra e os quatro são aposentados.** Os endereços antigos
redirecionam para `/panorama` com o mesmo recorte na consulta. *Ganho:* −6.273
linhas de tela, uma verdade só. *Custo:* irreversível em uma sessão, e sem
medida de uso não sabemos qual dos quatro alguém abre todo dia. **Faria isso
depois de (B), com dado de uso na mão — nunca antes.**

**Recomendo (B) agora, com (C) como destino declarado.** É o mesmo caminho que a
seção já percorreu uma vez, quando "Dashboard" e "Visão executiva" viraram uma —
e que o comentário de `nav-auditoria.ts` registra.

### 3.2 Custo de implementação

Nenhum endpoint novo. Nenhuma migration. Nenhuma regra de negócio nova. O
trabalho é de **composição e de arrumação**:

| Fase | O que entra | Tamanho |
|---|---|---|
| **1** | Extrair para `components/panorama/` os blocos que hoje moram dentro de `dashboard.tsx` e `inicio.tsx` (Indicadores, MovimentacaoDaFrota, QualidadeDaAuditoria, MaioresImpactos) — os do Impacto Apurado e da Linha do Tempo **já são componentes próprios** | médio, mecânico, sem mudança de comportamento |
| **2** | `lib/panorama.ts`: uma função que monta os sete andares a partir de uma `FamiliesView` \| `FamiliesOverview`, testada fora do JSX como `lib/impacto-apurado.ts` já é | pequeno |
| **3** | `pages/panorama.tsx` + rota + item da lateral + `PANORAMA` em `lib/ambiente.ts` | médio |
| **4** | Fila unificada do andar 6: um critério de ordenação a partir dos três de hoje | pequeno, mas é **onde há decisão de produto** — as três listas hoje ordenam diferente |
| **5** | Reordenar a lateral conforme (B) | trivial |

O custo de abertura é o mesmo do Impacto Apurado hoje: **zero requisições novas**
quando se chega de qualquer módulo vizinho — a vigência e a série já estão em
cache sob as mesmas chaves (`lib/leitura-da-vigencia.ts`). Vindo de fora, são as
mesmas leituras que qualquer um dos quatro já faz, mais `/balance` e `/imports`
do andar 7 (que o Resumo executivo já faz, e que podem sair depois do conteúdo
principal, como a série geral já sai).

### 3.3 Duas coisas que nenhum dos quatro tem, e que um módulo executivo deveria ter

Fora do escopo mínimo, mas é onde "executivo e completo" passa a significar algo
que hoje não existe:

1. **Exportar o Panorama** — um PDF/XLSX de uma página com os sete andares do
   recorte aberto, para ir por e-mail a quem não abre o produto. A infraestrutura
   existe (`lib/csv.ts`, `xlsx`). Hoje, levar a leitura executiva para fora do
   FreightCheck é *print de tela*.
2. **A frase de abertura** — uma linha em português que diz o que a vigência foi,
   gerada das mesmas funções, sem modelo de linguagem e sem número inventado:
   *"Agosto custou R$ 47,3 mil a menos que julho, concentrado em Aquisição
   (−R$ 31,2k) e Pneus (−R$ 9,4k); 87% das alterações já têm preço."* É o que
   uma diretoria lê e repassa.

Nenhuma das duas é pré-requisito. Ambas são a diferença entre "uma tela que
consolida quatro" e "a tela que a diretoria abre".

---

## 4. Riscos

| Risco | Mitigação |
|---|---|
| **A tela fica longa demais** e ninguém rola até o andar 6, que é o acionável | A ordem é a da pergunta, não a do volume: andares 1 e 2 cabem na primeira dobra. Se a fila do andar 6 se provar o que mais se usa, ela sobe — mas isso é medida, não palpite. |
| **Um quinto número diferente dos outros quatro** | Zero aritmética nova. Todo valor sai de função já existente e já testada. Um teste que compare o líquido publicado pelo Panorama e pelo Impacto Apurado sobre a mesma `FamiliesView` fecha essa porta. |
| **Fundir as três filas do andar 6 perde um critério útil** | É a única decisão de produto real da proposta. Merece uma passada com quem usa as três hoje, antes da fase 4. |
| **A Visão Geral vira uma tela pela metade** | Já é assim nas quatro, e cada diferença tem motivo escrito. O andar 5 é o único que troca de forma, e o §2.3 diz por quê. |

---

## 5. O que preciso decidido antes de escrever código

1. **Caminho (A), (B) ou (C)** do §3.1 — recomendo **(B)**.
2. **O nome**: *Panorama Executivo* ou outro.
3. **A ordem dos andares 5 e 6** — a fila acionável antes ou depois do mapa. Meu
   palpite é que quem responde pelo conjunto quer o mapa antes; quem executa quer
   a fila antes. Como a lateral serve os dois, deixei a fila depois — mas quem
   usa decide melhor que eu.
4. **Se o export (§3.3) entra no escopo** ou fica para depois.
5. **Se a raiz muda de destino** — recomendo que não, agora; ver o fim do §3.1.
