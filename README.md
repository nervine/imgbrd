# imgbrd

Eigener Booru-Browser mit endlosem Scroll, Tag-Suche, Score-Filter, Zufallssortierung und gespeicherten Tag-Sammlungen.

Eingebaute Boards: guro.booru.org, gelbooru.com, booru.eu, rule34.xxx, xbooru.com, allgirl.booru.org, zoo.booru.org. Weitere Boards lassen sich in der Oberfläche hinzufügen.

## Start

`imgbrd.exe` im Projektordner doppelklicken. Es öffnet sich kein Fenster. In der Symbolleiste neben der Uhr liegt ein gelbes **ib**-Symbol. Rechtsklick darauf bietet **Im Browser öffnen** und **Beenden**. Ein Doppelklick öffnet die Seite.

Die Seite ist dann auf http://localhost:4178 und im lokalen Netz zum Beispiel auf http://10.0.0.2:4178 erreichbar.

Nach Änderungen an der Oberfläche einmal neu bauen:

```bash
npm install
npm run exe
```

Entwicklung mit automatischem Neuladen: `npm run dev`, dann http://localhost:5173. `npm start` startet nur den Server, ohne Symbol in der Symbolleiste.

## API-Keys

rule34.xxx und gelbooru.com geben Posts nur noch mit einem kostenlosen Schlüssel aus dem eigenen Account heraus. Den Key und die User-ID trägst du im Bereich Zugang ein. Sie bleiben im Browser. Der Export schreibt sie mit in die JSON-Datei.

- rule34: https://rule34.xxx/index.php?page=account&s=options
- gelbooru: https://gelbooru.com/index.php?page=account&s=options

## Hinweise zu den Boards

- Gelbooru 0.2 (rule34, gelbooru, xbooru) sortiert serverseitig nach Neueste, Score und Zufall.
- booru.eu (Shimmie) sortiert nach Score. Zufall wählt zufällige Ergebnisseiten, weil `order:random` dort nichts findet.
- Die älteren booru.org-Seiten können Score nur innerhalb einer geladenen Seite sortieren und haben keine echte Zufallssuche. Zufall springt dort auf zufällige Seiten.

Eigene Boards erwarten eine öffentliche http(s)-Adresse und einen der Typen Gelbooru 0.2, Gelbooru 0.1, Shimmie oder Danbooru. Wenn der API-Host vom Seiten-Host abweicht, trägst du ihn extra ein, so wie `https://api.rule34.xxx` bei rule34.

Tag-Sammlungen, eigene Boards und die gespeicherten API-Keys lassen sich als JSON exportieren. Die Datei enthält die Zugangsdaten.
