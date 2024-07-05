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
    submit: true
  });
  selector.querySelector('input').setAttribute("name", "username")

  // when the selector changes, update the selected username
  selector.addEventListener("input", () => {
    setSelectedUsername(selector.value);
  });
  view(selector);
}
```


```jsx
function Collapsible({text, maxWidth = 200}) {
  return <details class="collapsible" style={{maxWidth: `${maxWidth}px`}}>
    <summary>{text}</summary>
    {text}
  </details>;
}
```

```jsx
function secondsToHMS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  // Two digits for minutes and seconds
  const pad = (x) => x.toString().padStart(2, "0");
  
  return `${h}h${pad(m)}m${pad(s)}`;
}
```

```jsx
function EntriesTable({entries}) {
  // WARNING: Date objects make this silently fail!
  // so we convert to string

  // Add a "seconds since last" column and a "seconds since start" column
  let lastTimestamp = null;
  const annotatedEntries = entries.map(entry => {
    const newEntry = {...entry};
    if (lastTimestamp) {
      newEntry.secondsSinceLast = (entry.timestamp - lastTimestamp) / 1000;
      newEntry.secondsSinceStart = (entry.timestamp - entries[0].timestamp) / 1000;
    }
    lastTimestamp = entry.timestamp;
    return newEntry;
  });

  annotatedEntries.reverse();

  return <table>
    <thead>
      <th>Timestamp</th>
      <th>Interaction</th>
      <th>Prompt</th>
      <th>Result</th>
      <th>Completion</th>
    </thead>
    <tbody>
    {annotatedEntries.map(entry => <tr>
      <td>{secondsToHMS(entry.secondsSinceStart)}</td>
      <td>{entry.interaction}</td>
      <td><Collapsible text={entry.prompt} /></td>
      <td><Collapsible text={entry.result} /></td>
      <td><Collapsible text={entry.completion} /></td>
    </tr>)}
    </tbody>
  </table>;
}
```


```jsx
display(<EntriesTable entries={desiredEntries} />)
```


```js
const availableUsernames = Array.from(new Set(entries.map(x => x.username))).sort();
```

```js
const selectedUsername = Mutable('');
const setSelectedUsername = (value) => selectedUsername.value = value;
```

${desiredEntries.length} entries selected of ${entries.length} total entries.

Last entry: ${desiredEntries.length > 0 ? desiredEntries[desiredEntries.length - 1].timestamp : "No entries"}


```js
const desiredEntries = entries.filter(x => selectedUsername === x.username);
```


```js
const entries = Generators.queue(notify => {
  let logs = [];
  const source = new EventSource(`https://textfocals.com/api/logs?secret=${logSecret}`);
  source.onerror = e => {
  //  notify({"error": e});
  };
  source.onmessage = event => {
    const parsedUpdate = JSON.parse(event.data);
    if (parsedUpdate.error) {
      notify({"error": parsedUpdate.error});
    }
    const newLogs = parsedUpdate.map((log) => log.logs).flat().map(x => {
      x.timestamp = new Date(x.timestamp * 1000);
      x.isBackend = x.interaction.endsWith("_Backend")
      return x;
    });
    console.log(newLogs.length, "new entries")
    logs = [...logs, ...newLogs];
    notify(logs);
  };
  return () => source.close();
})
```

```js
const logSecret = view(Inputs.text({label: "Log Secret", value: localStorage.getItem("logSecret") || ""}));
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
}

</style>
