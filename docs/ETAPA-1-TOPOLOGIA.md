# Etapa 1 — topologia: respondida

**Data:** 18/09/2026 · **Medido** do Shell do Replit contra o Neon de produção.

---

## 1. A resposta

```
host            ep-rough-art-aci1nmr1.sa-east-1.aws.neon.tech
região          sa-east-1 (aws)            ← São Paulo
endpoint        direto (não é o pooled)

TCP (1 ida e volta)   p50 144,3 ms · p95 151,6 ms · min 142,0 ms
TCP+TLS (3-4 idas)    p50 444,5 ms
psql SELECT 1         p50 1.038,4 ms
```

**É CAUSA A — geografia.** O banco está em São Paulo e a aplicação não está.
144 ms de ida e volta é a distância, e nada além dela: o p95 fica a 7 ms do p50,
que é o retrato de um caminho de rede estável e longo, não de um servidor
ocupado.

## 2. As outras três causas, descartadas por aritmética

| | Hipótese | Veredito |
|---|---|---|
| **B** | O pool não reaproveita conexão | **Descartada.** Se cada consulta abrisse conexão, pagaria TCP+TLS = **444 ms**. O custo medido por consulta é **123 ms** — menos que um TCP puro daqui. O pool está reaproveitando |
| **C** | O endpoint *pooled* acrescenta um salto | **Descartada.** O host não tem `-pooler`: é o endpoint direto |
| **D** | O compute do Neon suspende por ociosidade | **Descartada.** 40 amostras de `/api/build` com p50 426,4 e p95 435,3 ms — 9 ms de dispersão. Um compute acordando apareceria como um outlier de segundos, e não há nenhum |

Vale notar que **o número do deployment (123 ms por consulta) é menor que o do
workspace (144 ms)**. Os dois são da mesma ordem e a diferença é de caminho de
rede — mas quem responde pela experiência do usuário é o do deployment, e é ele
que entra nas contas abaixo.

## 3. O que aproximar app e banco vale

Consultas por rota: as que o modelo da Fase 0 estimou e que bateram com o log do
Postgres. Base de rede (~56 ms) preservada — ela é o caminho até o app, e não
muda. Alvo conservador de 2 ms por consulta na mesma região.

| Rota | Consultas | Hoje (medido) | Com app e banco juntos | Fator |
|---|--:|--:|--:|--:|
| `/api/build` (só o pedágio) | 3 | **426 ms** | 62 ms | 7× |
| `/api/contexts` | 5 | **675 ms** | 66 ms | 10× |
| `/api/curation/summary` | 5 | **675 ms** | 66 ms | 10× |
| `/api/auth/session` | 10 | **1,3 s** | 76 ms | 17× |
| `/api/composition/fleet` | 12 | **1,6 s** | 80 ms | 20× |
| `/api/changes/grouped` | 19 | **2,4 s** | 94 ms | 26× |
| `/api/changes/families` | 20 | **2,6 s** | 96 ms | 26× |
| `/api/curation/queue` | 33 | **4,1 s** | 122 ms | 33× |
| `/api/dre/fleet` | 48 | **6,0 s** | 152 ms | **39×** |

Em tela: `/dre` sai de ~7,3 s para **~0,2 s**.

**Nenhuma correção de código chega perto disso**, e é por isso que valia medir
antes de escrever qualquer linha.

## 4. O que isso faz com a 1b

| | Ganho da 1b (tirar 2 das 3 consultas de pedágio) |
|---|--:|
| Hoje | **247 ms** por requisição |
| Depois de aproximar | **4 ms** por requisição |

A 1b era o 2º item do plano justamente porque o RTT era alto. **Com app e banco
juntos ela deixa de valer a pena** — não pelo mérito, que continua o mesmo, mas
porque passa a economizar 4 ms às custas de mexer em caminho de ACL, que é o
lugar mais delicado do servidor.

**Recomendo suspender a 1b** até a aproximação acontecer, e então remedir. Se
depois disso ela ainda aparecer, faz-se; se não aparecer, economiza-se um risco
de segurança por 4 ms.

## 5. Como aproximar — duas opções, e a segunda é bem melhor

### Opção 1 — mover o banco para a região da aplicação

O Neon **não muda a região de um projeto**: é preciso criar um projeto novo na
região certa e migrar. Isso significa dump, restore, troca da connection string
e uma janela de indisponibilidade. Risco real, e o dado é o ativo do produto.

E tem um efeito colateral: o banco fica longe de quem opera, o que só não
importa porque **ninguém fala com o banco pela internet** — quem fala é a
aplicação.

### Opção 2 — mover a aplicação para `sa-east-1` ⭐

Se o Replit permitir escolher a região do Deployment, esta é estritamente
melhor:

- **sem migração de dado**, sem janela, sem troca de credencial;
- resolve o mesmo problema de RTT;
- e ainda **encurta o caminho até quem usa**: os usuários são brasileiros, e hoje
  a base de rede até o app é de ~56 ms.

**É o que eu conferiria primeiro.** No painel do Replit → Deployments →
configurações, procurar por região. Se existir `sa-east-1` (ou São Paulo), é uma
mudança de configuração contra uma migração de banco.

### O que precisa ser conferido antes de decidir

| | Onde |
|---|---|
| A região atual do Deployment | painel do Replit → Deployments |
| Se a região do Deployment é escolhível | mesmo painel |
| Se o plano do Neon permite criar projeto em outra região | painel do Neon |
| Qual o tamanho do banco hoje, para dimensionar a migração | `scripts/diagnostico/tamanho-do-banco.sh` |

## 6. Plano revisado

| | Item | Estado |
|--:|---|---|
| **0** | **Aproximar app e banco** | **novo, e é o maior ganho de toda a auditoria** — 7× a 39× por rota |
| 1 | **1a** — compressão e cache | provada; aguarda a autorização sobre `artifacts/` |
| — | ~~1b — pedágio 3→1~~ | **suspensa**: passa a valer 4 ms depois do item 0 |
| 3 | A1/A2 — esqueleto deixa de ser mudo | continua valendo: 13,2 s de silêncio é do cliente, não do RTT |
| 4 | C1 — `staleTime` | continua valendo, e fica **mais** barato de justificar depois do item 0 |
| 5 | D3/D4 — round trips das rotas caras | **cai muito**: 48 consultas a 2 ms são 96 ms. Vira otimização, não correção |
| 10 | D2 — a consulta de 592 ms | sobe de novo: a 2 ms por consulta, 592 ms de SQL puro passa a ser o maior item de uma rota |

**O item 0 reordena o plano inteiro pela segunda vez** — e nos dois casos quem
reordenou foi a medição, não a opinião.

---

## 7. O que peço agora

1. **Conferir a região do Deployment** e se ela é escolhível. É a pergunta que
   decide entre mover a aplicação (barato) e migrar o banco (caro).
2. **Confirmar se a 1b fica suspensa.** Eu recomendo que sim.
3. **A 1a segue de pé e independente** — ela é sobre bytes, não sobre o banco, e
   o ganho dela (−62% em 4G) não muda com a aproximação.

Nada foi implementado. `git diff -- artifacts lib` continua vazio.
