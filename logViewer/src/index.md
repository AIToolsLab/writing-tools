---
toc: false
---

<div class="hero">
  <h1>Log Viewer</h1>
</div>

```js
{
  const selector = Inputs.text({
    label: "Username",
    datalist: availableUsernames,
    value: selectedUsername,
    submit: true,
  });
  selector.querySelector("input").setAttribute("name", "username");

  // when the selector changes, update the selected username
  selector.addEventListener("input", () => {
    setSelectedUsername(selector.value);
  });
  view(selector);
}
```

```jsx
function Collapsible({ text, maxWidth = 200 }) {
  return (
    <details
      class="collapsible"
      style={{ maxWidth: `${maxWidth}px` }}
      alt={text}
    >
      <summary>{text}</summary>
      {text}
    </details>
  );
}
```

```jsx
function secondsToHMS(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  // Two digits for minutes and seconds
  const pad = (x) => x.toString().padStart(2, "0");

  return `${pad(m)}m${pad(s)}`;
}
```

```jsx
function EntriesTable({ entries }) {
  // WARNING: Date objects make this silently fail!
  // so we convert to string

  // Add a "seconds since last" column and a "seconds since start" column
  let lastTimestamp = null;
  const annotatedEntries = entries.map((entry) => {
    const newEntry = { ...entry };
    if (lastTimestamp) {
      newEntry.secondsSinceLast = (entry.timestamp - lastTimestamp) / 1000;
    }
    newEntry.secondsSinceStart =
      (entry.timestamp - entries[0].timestamp) / 1000;
    lastTimestamp = entry.timestamp;
    return newEntry;
  });

  function getInteractionColor(interaction) {
    if (interaction.includes("Backend")) {
      return "#BBE9FF";
    } else if (interaction.includes("Frontend")) {
      return "#FFEADD";
    } else if (interaction.includes("Sensitivity")) {
      return "#FFFED3";
    } else {
      return "#FFFFFF";
    }
  }

  annotatedEntries.reverse();

  return (
    <table>
      <thead>
        <th>Timestamp</th>
        <th>Interaction</th>
        <th>Prompt</th>
        <th>Result</th>
        <th>Completion</th>
      </thead>
      <tbody>
        {annotatedEntries.map((entry) => (
          <tr>
            <td>{secondsToHMS(entry.secondsSinceStart)}</td>
            <td
              style={{
                backgroundColor: getInteractionColor(entry.interaction),
              }}
            >
              {entry.interaction}
            </td>
            <td>
              <Collapsible text={entry.prompt} />
            </td>
            <td>
              <Collapsible text={entry.result} />
            </td>
            <td>
              <Collapsible text={entry.completion} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

```jsx
display(<EntriesTable entries={desiredEntries} />);
```

```js
const includePlayground = view(
  Inputs.toggle({
    label: "Include Playground",
    value: false,
  })
)
```

```js
const availableUsernames = Array.from(
  new Set(entries.map((x) => x.username))
).sort();
```

```js
const selectedUsername = Mutable("");
const setSelectedUsername = (value) => (selectedUsername.value = value);
```

${desiredEntries.length} entries selected of ${entries.length} total entries.

Last entry: ${desiredEntries.length > 0 ? desiredEntries[desiredEntries.length - 1].timestamp : "No entries"}

```js
// Count number of each type of generationType
const generationTypeCounts = Object.entries(
  desiredEntries.reduce((acc, x) => {
    if (x.isBackend) {
      acc[x.generationType] = (acc[x.generationType] || 0) + 1;
    }
    return acc;
  }, {})
).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ generationType: k, count: v }));
```

```js
Plot.plot({
  marginLeft: 150,
  marks: [
    Plot.barX(generationTypeCounts, { y: "generationType", x: "count", inset: 0.5 }),
    Plot.text(generationTypeCounts, { text: "count", x: "count", y: "generationType", dx: 3, color: "black", textAnchor: "start" }),
    Plot.ruleY([0]),
  ],
})
```

```js
Plot.plot({
  marginLeft: 150,
  marks: [
    Plot.barX(desiredEntries, { y: "interaction", x: 1, inset: 0.5 }),
    Plot.ruleY([0]),
  ],
})
```

```js
const desiredEntries = entries.filter((x) => selectedUsername === x.username && (includePlayground || !x.isPlayground));
```

```js
const entries = Generators.queue((notify) => {
  let logs = [];
  const source = new EventSource(
    `https://textfocals.com/api/logs?secret=${logSecret}`
  );
  source.onerror = (e) => {
    //  notify({"error": e});
  };
  source.onmessage = (event) => {
    const parsedUpdate = JSON.parse(event.data);
    if (parsedUpdate.error) {
      notify({ error: parsedUpdate.error });
    }
    const newLogs = parsedUpdate
      .map((log) => log.logs)
      .flat()
      .map((x) => {
        x.timestamp = new Date(x.timestamp * 1000);
        x.isBackend = x.interaction.endsWith("_Backend");
        if (x.isBackend) {
          x.generationType = x.interaction.replace("_Backend", "");
        }
        x.isPlayground = ((x.prompt || "").trim().startsWith('From the Wikipedia page on Calvin University'));
        return x;
      });
    console.log(newLogs.length, "new entries");
    // Filter for any newLogs that are not already in logs.
    // 1. The EventSource auto-reconnects when the server reloads (and drops its old connections). So when the connection is re-established, we get a bunch of old logs again.
    // 2. We need to compare stringified timestamps because Date objects don't compare ===.
    logs = logs.concat(
      newLogs.filter(
        (x) =>
          !logs.some(
            (y) =>
              "" + x.timestamp === "" + y.timestamp &&
              x.interaction === y.interaction &&
              x.username === y.username
          )
      )
    );

    notify(logs);
  };
  return () => source.close();
});
```

```js
const logSecret = view(
  Inputs.text({
    label: "Log Secret",
    value: localStorage.getItem("logSecret") || "",
  })
);
```

```js
// Reactivity will just do the right thing here.
localStorage.setItem("logSecret", logSecret);
```

<style>

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: var(--sans-serif);
  margin: 4rem 0 8rem;
  text-wrap: balance;
  text-align: center;
}

.hero h1 {
  margin: 1rem 0;
  padding: 1rem 0;
  max-width: none;
  font-size: 14vw;
  font-weight: 900;
  line-height: 1;
  background: linear-gradient(30deg, var(--theme-foreground-focus), currentColor);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero h2 {
  margin: 0;
  max-width: 34em;
  font-size: 20px;
  font-style: initial;
  font-weight: 500;
  line-height: 1.5;
  color: var(--theme-foreground-muted);
}

@media (min-width: 640px) {
  .hero h1 {
    font-size: 90px;
  }
}

details.collapsible {
  white-space: pre-wrap;
}

details.collapsible summary {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  direction: rtl;
  color: #aaaaaa;
}

td {
  padding: 0.5em;
}

table {
  max-width: 100%;
  border-color: #dddddd;
}

details {
  cursor: pointer;
  position: relative;
}

details[alt]:hover::after {
  content: attr(alt);
  position: absolute;
  background: rgba(247, 247, 247, 1);
  font-weight: 300;
  color: #333333;
  padding: 0.5em;
  border-radius: 0.5em;
  z-index: 1000;
  left: 30%;
  width: 35em;
}

</style>
