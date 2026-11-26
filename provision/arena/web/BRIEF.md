# brief

## the product
a live broadcast of ai models playing mindustry survival on tetrapod, one model at a time, plus standings and factorio server telemetry. people leave it open on a second monitor and glance over to see which model is playing, what wave it's on and what it's thinking.

## the feeling
punctual, mechanical, a bit of a spectacle. it should read like the big board in a station hall: you look up and know what is running, where it is and what is due next.

## direction
departure board: transit signage blended with native material.

- transit signage, because the product is a schedule. models rotate in a fixed order, waves arrive on a timer and each contender is a line with a stable colour.
- native material, because the game already has an art style. every icon in the chrome (items, blocks, units) is cut from the real v159.7 atlas, and the board's one accent is the game's own team yellow.

principles borrowed:
- nycta graphics standards manual: one measured system of black bands, white grotesk type and a coloured disc that means exactly one line. colour is reserved for identification.
- split-flap boards (solari): values are fixed-width cells and a change is a physical event, so a number flipping is the alert.
- mindustry itself: dark map, saturated sprites, deep rock that fades to black. the chrome stays quieter than the map.

## primary sources
- standardsmanual.com, nycta compact edition: black band nav with a thick coloured bar over the active item, hairline rules that divide sections, bold grotesk for names and mono for secondary facts. taken: the bar, the rules, the two-voice type.
- wikimedia commons, "split-flap displays" (fallblattanzeiger u-bahn münchen, bahnhof ansbach): white on black rows, fixed columns, a yellow line marker at the row start. taken: row grid, fixed cells, the flip.
- wikimedia commons, "signs in the new york city subway": discs with a letter, warm enamel black instead of blue-black. taken: the line disc and the warm black.
- mindustrygame.github.io screenshots: wall darkness, power lasers as thin warm lines, team yellow. taken: how the map should look, and the accent.
- the atlas contact sheet i cut from sprites.png: `-preview` turret composites, team `-cell` overlays, `scorch-*` decals. taken: everything drawn on the map.

## identity
- palette: warm enamel black surfaces (`#0d0c0a`, `#151411`, `#1e1c18`), rules `#322f29`, enamel white ink `#efe9dc` with two quieter steps. signal yellow `#ffd37f` (mindustry's sharded team colour) means the contender and whatever is live right now. hostile red `#f25555` (crux) means enemies, failed actions and a dying core, nothing else. each model owns one line colour that never changes.
- type: barlow condensed for display (wave numbers, tab names, headings), inter for reading (thoughts), commit mono for tickers, coordinates and counts. tickers are machine ids, so mono is their real voice.
- shape: square corners, 1px rules, a 3px bar for "active". line discs are the only circles. no shadows, blur or gradients in the chrome.
- texture: none in the chrome. the map carries all of it.
- motion: `flap` (300ms, stepped) for a board value that changed, `slide` (260ms, cubic-bezier(.2,.8,.2,1)) for rows entering the feed, and a critically damped camera, slow under the director and quick under the hand. reduced motion snaps all three.
- voice: discord (tetrastack `voices/discord.md`). it's shresht's own arena, so labels are lowercase and the little prose there is talks in first person.

## hierarchy
- mindustry live: the map first. then the board strip: exact model ticker, wave, time to next wave, hostiles, core. the thought feed is third. resources, minimap and camera controls sit on the map's edges and stay quiet.
- leaderboard: line disc and exact ticker, then best wave as the big number. averages, counts and accuracy recede. recent matches and the rotation follow.
- factorio: online or offline first, then playtime and players, then evolution and the rest.

## not parc
closest existing look is the old arena page, a generic dark devtool (blue graphite, pills, jetbrains mono everywhere).
- warm black sign bands divided by rules, where the old one had rounded cards and pills on blue graphite.
- colour only identifies: a line per model, yellow for live, red for hostile. the old one coloured things for decoration.
- icons are the game's own sprites and numbers flip like a board. nothing is a css dot.
