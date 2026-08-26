# 🔥 MTG Life Counter

Contador de vida para Magic: The Gathering — Commander padrão, Duelo 1v1, Livre e Battle Royale (regras homebrew de 6 jogadores incluídas).

## Como testar agora, no browser

Não precisas de instalar nada. Tens duas opções:

**Opção A — mais simples:** dá duplo-clique no ficheiro `index.html` e ele abre diretamente no teu browser (Chrome, Safari, Edge...).

**Opção B — recomendada** (ativa a pesquisa de commanders sem restrições de alguns browsers e prepara o modo offline):
1. Abre um terminal nesta pasta.
2. Corre: `python3 -m http.server 8000` (ou `npx serve .` se tiveres Node).
3. Abre `http://localhost:8000` no browser.

A app funciona em qualquer browser moderno (desktop ou telemóvel) e é responsiva — no telemóvel já se comporta como uma app.

## Como funciona

- **Menu inicial**: escolhe o modo — Commander Padrão (2–8 jogadores, 40 vidas, commander damage), Duelo 1v1, Livre (escolhes nº de jogadores e vida inicial, com a opção de ligar/desligar commander damage), ou Battle Royale (6 jogadores, regras completas que pediste).
- **Escolher commander**: em cada jogador, toca na miniatura para pesquisar o commander na Scryfall (é necessária ligação à internet só para esta pesquisa/imagens). A arte da carta fica automaticamente como fundo do jogador. Se não tiveres internet no momento, há sempre a opção "Imagem manual" para colar uma URL de imagem, ou "Sem imagem". Quem não escolher nenhum commander recebe uma cor de fundo sorteada em vez do cinzento padrão — nunca repetida entre os jogadores que também estejam sem imagem, no mesmo jogo.
- **Tabuleiro de vida**: toca no lado direito de um jogador para somar vida, no lado esquerdo para subtrair. Mantém premido para repetir rapidamente. Os jogadores "de cima" aparecem rodados 180° para facilitar o jogo em mesa (passa-e-joga).
- **Commander damage**: cada jogador tem pequenos ícones dos oponentes — toca num para abrir o contador de dano de commander desse oponente especificamente (chega aos 21 = eliminado automaticamente).
- **Commander Parceiro (Partner)**: no setup (ou a meio do jogo, no ✏️) cada jogador pode escolher um segundo commander parceiro, além do principal. Quando um oponente tem parceiro, aparecem dois ícones de dano separados para ele (um por cada commander, cada um mata aos 21 independentemente) — o ícone do parceiro tem borda roxa para se distinguir.
- **Manter jogador eliminado no jogo**: se uma carta em jogo evita a eliminação a 0 vidas ou 21+ de commander damage (ex: Platinum Angel, Worship), toca no carimbo vermelho "ELIMINADO" do jogador para o manteres no jogo — passa a mostrar um carimbo dourado "🛡️ PROTEGIDO" em vez de eliminado, e continua a jogar normalmente. Assim que essa carta sair do campo, toca no carimbo "PROTEGIDO" para voltares a eliminá-lo.
- **Battle Royale**: mapa de zonas A–F (zona inicial de cada jogador sorteada aleatoriamente), contador de rondas com fecho automático de zona a cada 3ª ronda da mesa, botão de evento aleatório (dado), fluxo de eliminação com atribuição de recompensas (loot), fases Final Circle e Final Duel, e ecrã de campeão no final com estatísticas. Toca no ℹ️ no topo para reveres as regras a qualquer momento.
- **Passar turno**: tanto no Commander/Duelo/Livre como no Battle Royale há um botão de passar turno — toca nele para tocar o som de aviso e passar a vez ao jogador seguinte (salta automaticamente quem já foi eliminado). Vês sempre de quem é a vez e há dois relógios ao vivo: duração do turno atual e duração total do jogo.
- **Terminar jogo e estatísticas**: no Commander/Duelo/Livre há um botão "🏁 Terminar" que pergunta quem venceu e mostra logo a seguir um ecrã com a duração total do jogo e quanto tempo cada jogador demorou nos seus turnos (com médias e % do jogo). No Battle Royale este ecrã aparece automaticamente quando sai um campeão.
- **Perfis de commander**: ao escolher o commander de um jogador (no setup ou a meio do jogo, no ✏️), podes ligar um "perfil" a esse jogador — cria um novo ou escolhe um já existente. Ao criar um perfil, o nome que tinhas posto no jogador nessa altura também fica guardado; ao carregar um perfil já existente, tanto a imagem do commander como esse nome ficam logo aplicados ao jogador. Sempre que um jogo termina, as estatísticas desse jogador (vitórias, tempo médio por turno e por jogo, tempo total jogado) ficam guardadas no perfil. Acede a "👤 Perfis guardados" no menu principal para veres as stats agregadas de cada commander ou apagares perfis antigos.
- **Artes alternativas**: nos resultados da pesquisa de commander, toca no botão 🎨 ao lado de uma carta para veres todas as edições/impressões dela na Scryfall (cada uma com a sua arte, artista e coleção) e escolheres a versão que preferires como fundo do jogador.
- **Histórico de jogos por perfil**: em cada perfil, toca em "📜" para abrires a lista de todos os jogos registados (data/hora, vitória ou derrota, modo, duração do jogo e dos teus turnos). Podes apagar jogos individuais do histórico (🗑️ em cada linha) — as stats agregadas do perfil são recalculadas automaticamente.
- **Quem começa**: assim que carregas em "Começar Jogo" (Commander/Duelo/Livre ou Battle Royale), aparece um ecrã para escolheres quem joga primeiro — ou tocas diretamente no nome de um jogador, ou carregas em "🎲 Rolar dados por todos" para cada jogador tirar 1d6; quem tirar mais alto começa (em caso de empate, só os empatados voltam a rolar até haver um vencedor único). Os relógios de turno/jogo só começam a contar a partir daqui.
- **Commander Tax**: cada jogador tem um badge no cabeçalho (ex: "+0") que mostra quanto custa a mais recastar o commander da zona de comando. Toca nele para abrir o contador e ires somando +{2} de cada vez que o conjurares (com uma linha separada para o commander parceiro, se tiver).
- **Contador de turno**: ao lado dos relógios de turno/jogo aparece agora também o número do turno atual, tanto no Commander/Duelo/Livre como no Battle Royale.
- **Ecrã sempre ligado**: enquanto estás no tabuleiro de jogo (Commander/Duelo/Livre ou Battle Royale), o ecrã do telemóvel/tablet não bloqueia sozinho — volta ao normal assim que sais para o menu (funciona em browsers/contextos que suportem a Wake Lock API; em ligação por `file://` sem HTTPS pode não estar disponível, mas isso não afeta o resto da app).
- **Indicador de vida ao somar/retirar**: em vez de aparecer "-1"/"+1" no sítio exato onde tocas de cada vez, agora o total vai-se acumulando (ex: três toques seguidos em "+" mostram "+3") num indicador fixo por cima do número de vida — só desaparece e reinicia a contagem 2 segundos depois do último toque.
- **Nº de jogadores com botões -/+**: no setup do Commander Padrão/Livre (quando o modo permite escolher quantos jogadores), a caixa de "Jogadores" tem agora botões "−" e "+" ao lado do número, além de poderes continuar a escrever o número diretamente.
- O jogo fica guardado automaticamente neste browser (mesmo que feches a página, ao voltar aparece "Continuar jogo em curso"); os perfis ficam guardados à parte, mesmo depois de terminares vários jogos.

## Para instalar como "app" no iPhone (mais tarde)

Isto é uma PWA (Progressive Web App): já tem tudo preparado (`manifest.json`, ícones, service worker) para quando quiseres. Quando decidires publicar isto online (por exemplo GitHub Pages, Netlify ou Vercel — todos têm planos gratuitos), basta:
1. Abrir o link no Safari do iPhone.
2. Tocar no botão de partilha (□ com seta para cima).
3. Escolher "Adicionar ao Ecrã Principal".

A app abre depois em ecrã inteiro, com o próprio ícone, como qualquer app instalada — sem precisar de App Store nem de conta de developer Apple. Quando quiseres avançar para isso, ajudo-te com o alojamento.

## Estrutura do projeto

```
index.html          — página principal
css/style.css        — estilos
js/scryfall.js        — integração com a Scryfall API (pesquisa de commanders)
js/profiles.js        — perfis de commander guardados (stats entre jogos)
js/state.js           — motor de estado do jogo (vida, dano, zonas, loot, turnos)
js/app.js             — interface e navegação entre ecrãs
assets/te_toca.mp3    — som tocado ao passar o turno
manifest.json + sw.js + icons/  — ficheiros da PWA (instalação como app)
```
