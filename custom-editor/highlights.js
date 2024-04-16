let doc = document.querySelector('.doc');
let canvas = doc.querySelector('canvas');
canvas.width = 2000;
canvas.height = 1000;
let ctx = canvas.getContext('2d');

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

doc.addEventListener('input', debounce(event => {
  updateHighlights();
}, 500));

async function getHighlights(text) {
  let url = new URL("https://tools.kenarnold.org/api/highlights");
  url.searchParams.append('doc', text);
  let result = await fetch(url);
  let resultJSON = await result.json();
  return resultJSON['highlights'];
}

async function updateHighlights() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const paragraphs = doc.querySelectorAll('p');
  let allHighlights = [];
  for (const node of paragraphs) {
    const textNode = node.firstChild;
    if (textNode) {
      let highlights = await getHighlights(textNode.textContent);
      allHighlights.push(...highlights);
    }
  }
  let maxTokenLoss = Math.max(...allHighlights.map(h => h.token_loss));
  let minTokenLoss = Math.min(...allHighlights.map(h => h.token_loss));
  for (const node of paragraphs) {
    const textNode = node.firstChild;
    if (textNode) {
      let highlights = await getHighlights(textNode.textContent);
      for (let i = 0; i < highlights.length; i++) {
        let {start, end, token, token_loss, most_likely_token} = highlights[i];

        // Skip the first token
        if (i === 0) {
          continue;
        }

        // Normalize token_loss to a value between 0 and 1
        let normalizedTokenLoss = (token_loss - minTokenLoss) / (maxTokenLoss - minTokenLoss);

        if (start > textNode.textContent.length || end > textNode.textContent.length) {
          continue;
        }

        const range = document.createRange();
        try {
          range.setStart(textNode, start);
          range.setEnd(textNode, end);
        } catch (error) {
          continue;
        }

        // Create a new span element for the highlight
        let span = document.createElement('span');
        span.textContent = token;

        // Adjust the color of the highlight based on the normalized token_loss
        span.style.backgroundColor = `rgba(255, 255, 0, ${normalizedTokenLoss})`;

        // Add an event listener to the span
        span.addEventListener('click', () => {
          // Update the content of the sidebar
          document.getElementById('sidebar').textContent = `Suggested alternative for '${token}': '${most_likely_token}'`;
        });

        // Replace the highlighted text with the span
        range.deleteContents();
        range.insertNode(span);

        const rects = range.getClientRects();
        const canvasRect = canvas.getBoundingClientRect();
        for (const rect of rects) {
          const highlightX = rect.x - canvasRect.x;
          const highlightY = rect.y - canvasRect.y;
          ctx.fillStyle = `rgba(255, 255, 0, ${normalizedTokenLoss})`;
          ctx.fillRect(highlightX, highlightY, rect.width, rect.height);
        }
      }
    }
  }
}

updateHighlights();
