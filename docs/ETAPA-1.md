# Etapa 1 — topologia, e Etapa 1a — compressão e cache

**Data:** 18/09/2026 · **Estado:** 1a **provada localmente, aguardando uma
autorização**; Etapa 1 **instrumentada, aguardando execução no Replit**.

> Nada foi aplicado ao produto. `git diff -- artifacts lib` continua vazio.

---

## Etapa 1 — topologia: a pergunta ainda não está respondida

A Fase 0 mediu **123,4 ms por consulta** no ambiente publicado. Eu escrevi, na
consolidação, que isso era "o RTT entre aplicação e banco". **Isso era uma
inferência, não uma medição**, e ela tem pelo menos quatro causas possíveis que
pedem correções completamente diferentes:

| | Causa | Correção |
|---|---|---|
| **A** | **Geografia** — app e banco em regiões distantes | aproximar as regiões |
| **B** | **Conexão por consulta** — o pool não reaproveita, cada consulta paga TCP+TLS | arrumar o pool |
| **C** | **Proxy no meio** — o endpoint *pooled* do Neon acrescenta um salto | trocar o endpoint |
| **D** | **Compute suspenso** — o Neon dorme por ociosidade | desligar a suspensão |

120 ms é exatamente a ordem de grandeza de São Paulo ↔ Virgínia, o que torna a
hipótese A plausível — mas plausível não é medido, e as outras três não custam
região nenhuma para resolver.

**O que separa as quatro é medir o TCP puro.** Um handshake TCP é uma ida e
volta e nada mais. Se ele der ~120 ms, é A, e nenhuma otimização de consulta
resolve. Se der ~5 ms com a consulta em 123 ms, é B ou C, e **mudar de região
não resolveria nada** — e a alternativa à 1b muda de figura.

### O instrumento

`scripts/diagnostico/topologia-app-banco.mjs`. Somente leitura: abre conexões e,
se houver `psql`, roda `SELECT 1`. Nunca imprime usuário, senha ou a URL — só o
host, a porta e a região que o nome do host do Neon revela.

**Rode no Shell do Replit**, que é onde a distância do lado da aplicação se mede:

```bash
cd ~/workspace
git fetch --depth 1 origin claude/confident-fermi-dvk0jl
rm -rf /tmp/fase0 && mkdir -p /tmp/fase0
git archive FETCH_HEAD scripts/diagnostico | tar -x -C /tmp/fase0

node /tmp/fase0/scripts/diagnostico/topologia-app-banco.mjs
```

Ele responde, de uma vez: região do Neon (pelo nome do host), se o endpoint é o
*pooled*, TCP p50/p95, TCP+TLS, `SELECT 1`, e o veredito entre A, B/C e misto.

### O que ele **não** responde, e como obter

| | Como obter |
|---|---|
| **Região da aplicação publicada** | painel do Replit → Deployments → a região aparece nas configurações do deployment. Não é exposta por HTTP nem por variável de ambiente |
| **Se dá para aproximar** | Neon permite escolher região **na criação do projeto**; mover exige criar um projeto novo na região certa e migrar o dado. O Replit Autoscale expõe a região do deployment nas configurações. Qual dos dois é mais barato de mover depende de qual está fora do lugar — e é o script acima que diz isso |
| **Impacto esperado da mudança** | direto do número: com 48 consultas em `/api/dre/fleet`, ir de 123 ms para 2 ms leva a rota de **5,9 s para ~0,15 s**. É o maior ganho isolado de toda a auditoria, e beneficia **todas** as rotas, não só a autenticação |

**É por isso que esta etapa vem antes da 1b.** Se a causa for A, aproximar as
regiões vale mais do que as três correções de backend somadas — e a 1b, que
tira 2 das 3 consultas de pedágio, passa a valer 2 × 2 ms em vez de 2 × 123 ms.

---

## Etapa 1a — compressão e cache: medido, e com um defeito que o teste pegou

### O antes e o depois, medidos

Mesmo bundle, mesmo navegador, mesmos perfis de rede. "Antes" é um servidor que
imita o host publicado (sem compressão, `cache-control: private`); "depois" é a
proposta (Brotli + `immutable`).

| Rede | Antes — tela utilizável | Depois | Ganho |
|---|--:|--:|--:|
| localhost | 773 ms | 744 ms | −29 ms |
| 20 Mb/s | 2.365 ms | **1.097 ms** | **−54%** |
| 4G (9 Mb/s) | 4.601 ms | **1.735 ms** | **−62%** |
| 3G (1,6 Mb/s) | 22.015 ms | **6.273 ms** | **−72%** |

| | Antes | Depois |
|---|--:|--:|
| JavaScript na rede | 3.776 KB | **828 KB** (Brotli, **4,6×**) |
| Total de assets na 1ª visita | 4.116.929 B | **913.536 B** |
| FCP em 4G | 4.012 ms | **1.136 ms** |

Brotli rende mais que gzip: 847 KB contra 1.026 KB — **17% a menos**.

### Revisita

O teste ingênuo dá empate: nas duas versões a 2ª visita transfere 0 bytes,
porque o Chromium aplica cache heurístico a partir do `Last-Modified`. O empate
some no caso que importa — **logo depois de uma publicação**, quando o
`Last-Modified` é recente e a heurística não vale nada:

| | 2ª visita | 3ª visita |
|---|---|---|
| Antes (`private`, sem `max-age`) | `304, 200, 304` · 3 requisições | `304, 304, 200` · 3 requisições |
| Depois (`immutable`) | **0 requisições de rede** | **0 requisições de rede** |

São ~3 × 56 ms de ida e volta por navegação, só para o servidor dizer "não
mudou", em toda navegação nas primeiras horas após cada publicação.

### O defeito que o teste de publicação pegou

O pedido dizia: *"Confirme que uma nova versão não ficou presa em cache."* Rodei
o teste — publicar um bundle com hash novo e reabrir — e ele **falhou**:

```
  antes da publicação, a tela carregou: /assets/index-BdnUKe7y.js
  publicado: index-BdnUKe7y.js → index-NOVOHASH9.js
  depois da publicação, a tela carregou: /assets/index-BdnUKe7y.js
  ✗ PRESO no cache: a tela continua na versão velha
```

**E não era o cache do navegador: era o meu.** O servidor guardava o corpo
comprimido numa tabela indexada só pelo caminho do arquivo. O `index.html` é o
único arquivo cujo nome **não** muda entre versões — então ele continuava sendo
servido da memória do processo depois de reescrito, e o `no-cache` que eu tinha
posto nele não adiantava nada, porque o conteúdo velho vinha do servidor.

Corrigido incluindo `mtime` e tamanho na chave. Reteste:

```
  depois da publicação, a tela carregou: /assets/index-NOVOHASH9.js
  ✓ a versão nova foi pega — o index.html não ficou preso
```

Se eu tivesse aceitado "o header apareceu, está pronto", este defeito iria ao ar
e prenderia toda publicação seguinte até alguém limpar o cache.

### A política, e por que ela tem duas regras

| Arquivo | `cache-control` | Porquê |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | o nome carrega o hash do conteúdo: nunca muda de conteúdo |
| `index.html` | `no-cache` | não é versionado, e é ele que aponta para o bundle novo. `no-cache` não é "não guarde", é "revalide antes de usar" — é o que impede a publicação nova de ficar presa |

`vary: accept-encoding` sai junto, senão um intermediário pode entregar o corpo
comprimido a quem pediu texto puro. Não comprime `woff2`, `png` nem `webp`:
gastar CPU para crescer o corpo.

---

## A autorização que preciso

**Não existe caminho para comprimir sem mudar quem serve os bytes.** Medi as
alternativas:

| Alternativa | Veredito |
|---|---|
| Configurar compressão no `serve = "static"` do Replit | **Não sei se existe.** Não há chave dessas em nenhum `artifact.toml` do repositório, e não consigo consultar a documentação do Replit desta sessão (a política de rede recusa). **Se existir, é a opção mais limpa e eu prefiro ela** |
| Pré-comprimir no build e servir `.br`/`.gz` | **Descartada por medição.** O host não negocia: ofereci gzip, br e zstd, e ele devolveu o arquivo cru nos três |
| Trocar `serve = "static"` por um servidor mínimo com compressão | **Funciona, e está provado acima** |

A terceira exige **duas linhas** em `artifacts/freightaudit/.replit-artifact/artifact.toml`:

```diff
 [services.production]
 build = [ "pnpm", "--filter", "@workspace/freightaudit", "run", "build" ]
-serve = "static"
-publicDir = "artifacts/freightaudit/dist/public"
+run = "node artifacts/freightaudit/servir.mjs"
+
+[services.production.run.env]
+PUBLIC_DIR = "artifacts/freightaudit/dist/public"
```

mais o arquivo novo `artifacts/freightaudit/servir.mjs` — que está em
[`docs/propostas/servir-estatico.mjs`](propostas/servir-estatico.mjs), pronto e
já exercitado pelos testes acima.

**Isso toca `artifacts/`, e você pediu explicitamente que eu não tocasse.** A
restrição veio da minha própria proposta, quando eu ainda achava que 1a seria só
configuração de host — e a medição mostrou que não é. Então eu paro aqui e
pergunto, em vez de decidir sozinho.

Três saídas, e a primeira é a que eu recomendaria tentar antes:

1. **Conferir no painel do Replit** se `serve = "static"` tem opção de
   compressão ou de cabeçalhos. Se tiver, eu uso e não toco em `artifacts/`.
2. **Autorizar as duas linhas** do `artifact.toml` e o arquivo novo.
3. **Servir a interface pelo próprio `api-server`**, que já tem `compression()`.
   Mexe mais, e no mesmo diretório — não vejo vantagem sobre a 2.

### Riscos da opção 2

| Risco | Mitigação |
|---|---|
| O `rewrite` da SPA deixa de ser do host | o servidor faz o mesmo: o que não existe cai no `index.html` |
| Travessia de caminho | recusa o que resolve fora da raiz — está no código |
| Consumo de CPU comprimindo | comprime uma vez por arquivo e guarda; Brotli em qualidade 5, não 11 |
| O processo cai e a web some | o `serve = "static"` não tinha processo para cair. É o custo real da opção, e é o motivo de eu preferir a 1 |
| Publicação presa | **era o defeito acima**; corrigido e testado |

---

## Estado

| | |
|---|---|
| Etapa 1 (topologia) | instrumento pronto; **falta rodar no Shell do Replit** |
| Etapa 1a | **provada localmente**; falta a autorização sobre `artifacts/` e a medição no ar |
| Etapa 1b | **não iniciada**, e por desenho: espera o veredito da topologia |
| `staleTime`, C4, esqueleto, rotas de 33/48 consultas | não tocados |
