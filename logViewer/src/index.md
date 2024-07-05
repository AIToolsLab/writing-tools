---
toc: false
---

<div class="hero">
  <h1>LogViewer</h1>
</div>

```js
Inputs.table(desiredEntries)
```

```js
const availableUsernames = Array.from(new Set(entries.map(x => x.username))).sort();
```

```js
const selectedUsernames = view(Inputs.checkbox(availableUsernames, {label: "Usernames", value: []}));
```

```js
const desiredEntries = entries.filter(x => selectedUsernames.includes(x.username));
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

</style>
