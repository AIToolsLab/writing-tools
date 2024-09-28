const doc = document.querySelector('.doc');
const canvas = doc.querySelector('canvas');
canvas.width = 2000;
canvas.height = 1000;
const ctx = canvas.getContext('2d');

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
  const url = new URL('https://tools.kenarnold.org/api/highlights');
  url.searchParams.append('doc', text);
  const result = await fetch(url);
  const resultJSON = await result.json();
  return resultJSON['highlights'];
}

async function updateHighlights() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const paragraphs = doc.querySelectorAll('p');
  const allHighlights = [];
  for (const node of paragraphs) {
    const textNode = node.firstChild;
    if (textNode) {
      const highlights = await getHighlights(textNode.textContent);
      allHighlights.push(...highlights);
    }
  }
  const maxTokenLoss = Math.max(...allHighlights.map(h => h.token_loss));
  const minTokenLoss = Math.min(...allHighlights.map(h => h.token_loss));
  for (const node of paragraphs) {
    const textNode = node.firstChild;
    if (textNode) {
      const highlights = await getHighlights(textNode.textContent);
      for (let i = 0; i < highlights.length; i++) {
        const { start, end, token, token_loss, most_likely_token } = highlights[i];

        // Skip the first token
        if (i === 0) {
          continue;
        }

        // Normalize token_loss to a value between 0 and 1
        const normalizedTokenLoss = (token_loss - minTokenLoss) / (maxTokenLoss - minTokenLoss);

        if (start > textNode.textContent.length || end > textNode.textContent.length) {
          continue;
        }

        const sel = window.getSelection();
        sel.setBaseAndExtent(textNode, start, textNode, end);
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        ctx.fillStyle = `rgba(255, 255, 0, ${normalizedTokenLoss})`;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

        // Draw the alternative words underneath the text
        ctx.fillStyle = 'black';
        ctx.font = '15px serif';
       if (most_likely_token !== token) {
        ctx.fillText(most_likely_token, rect.x, rect.y + rect.height + 5);

        sel.removeAllRanges();
      }
    }
  }
}
}

updateHighlights();
