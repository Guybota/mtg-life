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

- **Menu inicial**: escolhe o modo — Commander Padrão (2–8 jogadores, 40 vidas, commander damage), Duelo 1v1, Livre (escolhes nº de jogadores e vida inicial, com a opção de ligar/desligar commander damage), Battle Royale (6 jogadores, regras completas que pediste), ou Equipas.
- **Escolher commander**: em cada jogador, toca na miniatura para pesquisar o commander na Scryfall (é necessária ligação à internet só para esta pesquisa/imagens). A arte da carta fica automaticamente como fundo do jogador. Se não tiveres internet no momento, há sempre a opção "Imagem manual" para colar uma URL de imagem, ou "Sem imagem". Quem não escolher nenhum commander recebe uma cor de fundo sorteada em vez do cinzento padrão — nunca repetida entre os jogadores que também estejam sem imagem, no mesmo jogo.
- **Tabuleiro de vida**: toca no lado direito de um jogador para somar vida, no lado esquerdo para subtrair. Mantém premido para repetir rapidamente. Os jogadores "de cima" aparecem rodados 180° para facilitar o jogo em mesa (passa-e-joga).
- **Commander damage**: cada jogador tem pequenos ícones dos oponentes — toca num para abrir o contador de dano de commander desse oponente especificamente (chega aos 21 = eliminado automaticamente).
- **Commander Parceiro (Partner)**: no setup (ou a meio do jogo, no ✏️) cada jogador pode escolher um segundo commander parceiro, além do principal. Quando um oponente tem parceiro, aparecem dois ícones de dano separados para ele (um por cada commander, cada um mata aos 21 independentemente) — o ícone do parceiro tem borda roxa para se distinguir. O fundo do painel do jogador também fica dividido a meio, uma metade com a arte de cada commander.
- **Manter jogador eliminado no jogo**: se uma carta em jogo evita a eliminação a 0 vidas ou 21+ de commander damage (ex: Platinum Angel, Worship), toca no carimbo vermelho "ELIMINADO" do jogador para o manteres no jogo — passa a mostrar um carimbo dourado "🛡️ PROTEGIDO" em vez de eliminado, e continua a jogar normalmente. Assim que essa carta sair do campo, toca no carimbo "PROTEGIDO" para voltares a eliminá-lo.
- **Battle Royale**: mapa de zonas A–F (zona inicial de cada jogador sorteada aleatoriamente), contador de rondas com fecho automático de zona a cada 3ª ronda da mesa, botão de evento aleatório (dado), fluxo de eliminação com atribuição de recompensas (loot), fases Final Circle e Final Duel, e ecrã de campeão no final com estatísticas. Toca no ℹ️ no topo para reveres as regras a qualquer momento.
- **Passar turno**: no Commander/Duelo/Livre e em Equipas, o botão de passar turno aparece mesmo por baixo do contador de vida de quem tem a vez (em vez de ficar sempre fixo no fundo do ecrã) — toca nele para tocar o som de aviso e passar a vez a quem joga a seguir (salta automaticamente quem já foi eliminado). No Battle Royale mantém-se o botão "➡️ Próximo turno" na barra inferior. Vês sempre de quem é a vez e há dois relógios ao vivo: duração do turno atual e duração total do jogo.
- **Zonas de +/- vida mais visíveis**: cada lado do contador de vida mostra agora o próprio símbolo ("−" à esquerda, "+" à direita) com um leve tom vermelho/verde a esbater para o centro, para se perceber logo qual é o lado de somar e qual é o de subtrair — sem teres de decorar. O badge de Commander Tax também ficou maior, mais fácil de acertar com o dedo.
- **Ecrã inteiro no contador de vida**: no Commander/Duelo/Livre e em Equipas há um botão ⛶ ao lado do botão de reiniciar (↺), no canto superior direito, que esconde a barra de topo e a barra de baixo, deixando só os contadores de vida a ocupar o ecrã todo. Como a barra de topo fica escondida, aparece um botão flutuante 🗗 num canto do ecrã só para poderes sair do ecrã inteiro.
- **Reiniciar jogo**: o botão ↺ no topo repõe as vidas iniciais de todos, limpa o commander damage e o commander tax, e reinicia também os relógios de turno/jogo, a ronda e o histórico de alterações de vida — fica tudo como um jogo novo, sem teres de sair e voltar a criar um.
- **Trocar posições dos jogadores/equipas**: o botão 🔀 na barra inferior (Commander/Duelo/Livre, Battle Royale e Equipas) abre uma lista onde podes mover cada jogador/equipa para cima ou para baixo, mudando a ordem em que aparecem no tabuleiro — isto só troca os lugares à mesa, não afeta a ordem dos turnos.
- **Histórico de alterações de vida**: toca no botão 📜 (Commander/Duelo/Livre, Battle Royale ou Equipas) para veres, numa timeline, todas as alterações de vida do jogo atual, agrupadas por turno e por quem estava a jogar nessa altura. Mostra cada alteração separadamente (ex: -3, depois +5, depois -1), nunca só a diferença total — toques feitos a menos de 2 segundos uns dos outros juntam-se numa só linha (o mesmo critério usado no indicador "+3"/"-2" que aparece por cima da vida).
- **Terminar jogo e estatísticas**: no Commander/Duelo/Livre há um botão "🏁 Terminar" que pergunta quem venceu e mostra logo a seguir um ecrã com a duração total do jogo e quanto tempo cada jogador demorou nos seus turnos (com médias e % do jogo). No Battle Royale este ecrã aparece automaticamente quando sai um campeão.
- **Perfis de commander**: ao escolher o commander de um jogador (no setup ou a meio do jogo, no ✏️), podes ligar um "perfil" a esse jogador — cria um novo ou escolhe um já existente. Ao criar um perfil, o nome que tinhas posto no jogador nessa altura também fica guardado; ao carregar um perfil já existente, tanto a imagem do commander como esse nome ficam logo aplicados ao jogador. Sempre que um jogo termina, as estatísticas desse jogador (vitórias, tempo médio por turno e por jogo, tempo total jogado) ficam guardadas no perfil. Acede a "👤 Perfis guardados" no menu principal para veres as stats agregadas de cada commander ou apagares perfis antigos.
- **Exportar/Importar perfis**: no ecrã "👤 Perfis", o botão "⬇️ Exportar" transfere um ficheiro `.json` com todos os teus perfis (e respetivas stats/histórico) — guarda-o onde quiseres, é a tua cópia de segurança. O botão "⬆️ Importar" lê um desses ficheiros (deste ou doutro aparelho/browser) e acrescenta esses perfis aos que já tens; nunca substitui nem apaga perfis existentes, mesmo que importes o mesmo ficheiro mais do que uma vez.
- **Artes alternativas**: nos resultados da pesquisa de commander, toca no botão 🎨 ao lado de uma carta para veres todas as edições/impressões dela na Scryfall (cada uma com a sua arte, artista e coleção) e escolheres a versão que preferires como fundo do jogador.
- **Histórico de jogos por perfil**: em cada perfil, toca em "📜" para abrires a lista de todos os jogos registados (data/hora, vitória ou derrota, modo, duração do jogo e dos teus turnos). Podes apagar jogos individuais do histórico (🗑️ em cada linha) — as stats agregadas do perfil são recalculadas automaticamente.
- **Quem começa**: assim que carregas em "Começar Jogo" (Commander/Duelo/Livre ou Battle Royale), aparece um ecrã para escolheres quem joga primeiro — ou tocas diretamente no nome de um jogador, ou carregas em "🎲 Rolar dados por todos" para cada jogador tirar 1d6; quem tirar mais alto começa (em caso de empate, só os empatados voltam a rolar até haver um vencedor único). Os relógios de turno/jogo só começam a contar a partir daqui.
- **Commander Tax**: cada jogador tem um badge no cabeçalho (ex: "+0") que mostra quanto custa a mais recastar o commander da zona de comando. Toca nele para abrir o contador e ires somando +{2} de cada vez que o conjurares (com uma linha separada para o commander parceiro, se tiver).
- **Contador de ronda**: ao lado dos relógios de turno/jogo aparece agora também o número da ronda atual, tanto no Commander/Duelo/Livre como no Battle Royale — só sobe quando a vez volta a dar a quem jogou primeiro (não a cada turno individual).
- **Ecrã sempre ligado**: enquanto estás no tabuleiro de jogo (Commander/Duelo/Livre ou Battle Royale), o ecrã do telemóvel/tablet não bloqueia sozinho — volta ao normal assim que sais para o menu (funciona em browsers/contextos que suportem a Wake Lock API; em ligação por `file://` sem HTTPS pode não estar disponível, mas isso não afeta o resto da app).
- **Indicador de vida ao somar/retirar**: em vez de aparecer "-1"/"+1" no sítio exato onde tocas de cada vez, agora o total vai-se acumulando (ex: três toques seguidos em "+" mostram "+3") num indicador fixo por cima do número de vida — só desaparece e reinicia a contagem 2 segundos depois do último toque.
- **Nº de jogadores com botões -/+**: no setup do Commander Padrão/Livre (quando o modo permite escolher quantos jogadores), a caixa de "Jogadores" tem agora botões "−" e "+" ao lado do número, além de poderes continuar a escrever o número diretamente.
- **Modo Equipas**: escolhe o nº de equipas (2–4) e de jogadores por equipa (1–4) no setup — cada equipa tem o seu nome (editável) e cada jogador continua a escolher o seu commander (+ parceiro opcional) e a ter o seu badge de Commander Tax. O fundo do painel da equipa fica dividido em fatias iguais, uma por jogador da equipa, cada uma com a arte do commander desse jogador (ou uma cor sorteada só para ele, se ainda não tiver escolhido nenhum). A vida é partilhada por toda a equipa (estilo Two-Headed Giant): só há um total de vida por equipa. O turno é da EQUIPA inteira, não de um jogador individual — todos os jogadores da mesma equipa jogam ao mesmo tempo (ficam todos destacados como "em jogo" na lista da equipa), e "Passar turno" avança para a equipa seguinte (Equipa 1 → Equipa 2 → Equipa 3 → Equipa 1...). Uma equipa é eliminada quando a vida partilhada chega a 0 (ou toca no carimbo "ELIMINADA" para reverter/confirmar manualmente); ao terminar o jogo escolhes que equipa venceu, e as estatísticas ficam registadas nos perfis de todos os jogadores dessa equipa.
- **Pausar o cronómetro**: no Commander/Duelo/Livre, Battle Royale e Equipas há agora um botão ⏸️ ao lado de "Passar turno"/"Próximo turno" que pausa os relógios de turno e de jogo (aparece um aviso "⏸️ PAUSADO" e o botão de passar turno fica desativado enquanto estiver em pausa). Toca em ▶️ para retomar — o tempo que esteve em pausa não conta para nenhum dos relógios.
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
