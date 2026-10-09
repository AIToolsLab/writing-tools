/**
 * @OnlyCurrentDoc
 *
 * The above comment directs Apps Script to limit the scope of file
 * access for this add-on. It specifies that this add-on will only
 * attempt to read or modify the files in which the add-on is used,
 * and not all of the user's files. The authorization request message
 * presented to users will reflect this limited scope.
 */
 
/**
 * Thoughtful AI Tools - Google Docs Add-on
 *
 * This Apps Script bridges the sidebar UI (HTML/JS/React) and the Google Docs
 * document (via DocumentApp), providing document operations only. The React app
 * talks to the Python backend directly; Apps Script does not proxy backend calls.
 */

// =============================================================================
// Add-on Entry Points
// =============================================================================

/**
 * Creates the add-on menu when the document is opened.
 */
function onOpen(e) {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('Open Thoughtful AI Tools', 'showSidebar')
    .addToUi();
}

/**
 * Runs when the add-on is installed.
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * Homepage trigger for Google Workspace Add-ons.
 */
function onHomepage(e) {
  return createHomepageCard();
}

/**
 * Called when file scope is granted.
 */
function onFileScopeGranted(e) {
  return createHomepageCard();
}

/**
 * Creates the homepage card for the add-on.
 */
function createHomepageCard() {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Thoughtful AI Tools'))
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextParagraph()
            .setText('Click the button below to open Thoughtful AI Tools in a sidebar for the full experience.')
        )
        .addWidget(
          CardService.newTextButton()
            .setText('Open Sidebar')
            .setOnClickAction(
              CardService.newAction().setFunctionName('showSidebar')
            )
        )
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(
          CardService.newTextButton()
            .setText('Visit thoughtful-ai.com')
            .setOpenLink(
              CardService.newOpenLink().setUrl('https://thoughtful-ai.com/')
            )
        )
        .addWidget(
          CardService.newTextParagraph()
            .setText(
              'Built by the Thoughtful AI Lab at Calvin University. This material ' +
              'is based upon work supported by the U.S. National Science Foundation ' +
              'under Grant No. <a href="https://www.nsf.gov/awardsearch/show-award/?AWD_ID=2246145">2246145</a>. ' +
              'Any opinions, findings, and conclusions or recommendations expressed ' +
              'are those of the authors and do not necessarily reflect the views of ' +
              'the National Science Foundation.'
            )
        )
    )
    .build();
  return card;
}

/**
 * Shows the sidebar with the Thoughtful AI Tools UI.
 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('sidebar')
    .setTitle('Thoughtful AI Tools')
    .setWidth(400);
  DocumentApp.getUi().showSidebar(html);
}

// =============================================================================
// Document Operations (called from sidebar via google.script.run)
// =============================================================================

// =============================================================================
// Markdown serialization
// =============================================================================
//
// The document is serialized to Markdown rather than bare text because its only
// consumer is an LLM prompt, and Markdown is the notation those models are most
// fluent in. Bare text threw away everything the writer had marked: a heading
// arrived as an ordinary sentence, and a bulleted list arrived as prose — Docs
// renders bullets and numbers from list formatting, so the glyphs are not
// characters and `getText()` never returns them.
//
// Where Docs is richer than Markdown we flatten to the nearest Markdown form
// rather than inventing notation, because a fabricated convention is one more
// thing for the model to misread:
//
//   - Title and Heading 1 both become `#`. A document using both loses that
//     distinction; Markdown's top level is the document title and the overlap
//     is rare enough not to justify a private convention.
//   - Subtitle becomes a plain paragraph. It is not an outline level in Docs
//     (it doesn't appear in the document outline), so giving it a `#` would
//     claim a section boundary that isn't there.
//   - Hollow and square bullets become `-`, like round ones. Ordered glyphs
//     (numbers, latin, roman) all become `N.` and are numbered sequentially.
//
// Tables and images are still skipped entirely — see `serializeBody`.

/** One nesting level of list indentation. */
const LIST_INDENT = '    ';

/**
 * The Markdown prefix for a paragraph's named style, `''` for body text.
 *
 * @param {ParagraphHeading} heading - The value of `Paragraph.getHeading()`
 * @returns {string} A Markdown ATX heading prefix, or '' for an ordinary paragraph
 */
function headingPrefix(heading) {
  const headings = DocumentApp.ParagraphHeading;
  switch (heading) {
    case headings.TITLE:
    case headings.HEADING1:
      return '# ';
    case headings.HEADING2:
      return '## ';
    case headings.HEADING3:
      return '### ';
    case headings.HEADING4:
      return '#### ';
    case headings.HEADING5:
      return '##### ';
    case headings.HEADING6:
      return '###### ';
    default:
      // NORMAL, SUBTITLE, and anything a future Docs version adds.
      return '';
  }
}

/**
 * Whether a list glyph is a counter (1., a., i.) rather than a bullet.
 *
 * @param {GlyphType} glyph - The value of `ListItem.getGlyphType()`
 * @returns {boolean} True for ordered glyphs
 */
function isOrderedGlyph(glyph) {
  const glyphs = DocumentApp.GlyphType;
  return (
    glyph === glyphs.NUMBER ||
    glyph === glyphs.LATIN_UPPER ||
    glyph === glyphs.LATIN_LOWER ||
    glyph === glyphs.ROMAN_UPPER ||
    glyph === glyphs.ROMAN_LOWER
  );
}

/**
 * The Markdown prefix for one list item: indentation plus its marker.
 *
 * Ordered items are numbered rather than all emitted as `1.`, which Markdown
 * would also accept. The numbers are what make an item referenceable — a writer
 * asking about "the third step" and a model answering about it need the same
 * label — and they cost only the counter bookkeeping here.
 *
 * @param {ListItem} item - The list item to label
 * @param {Object} counters - Per-list counters, carried across calls and mutated
 * @returns {string} Indentation followed by `- ` or `N. `
 */
function listItemPrefix(item, counters) {
  const level = item.getNestingLevel();
  let indent = '';
  for (let i = 0; i < level; i++) indent += LIST_INDENT;

  if (!isOrderedGlyph(item.getGlyphType())) {
    return indent + '- ';
  }

  // Numbering is per list and per depth: `getListId()` is shared by every item
  // Docs considers one list, and returning to a shallower level restarts the
  // deeper ones, exactly as the editor renders them.
  const listId = item.getListId();
  let counts = counters[listId];
  if (!counts) {
    counts = [];
    counters[listId] = counts;
  }
  counts.length = level + 1;
  counts[level] = (counts[level] || 0) + 1;
  return indent + counts[level] + '. ';
}

/**
 * Serializes a body (or tab body) to Markdown, along with an index recording
 * where each top-level child's own text landed in the output.
 *
 * The index is what lets `getDocContext` place the cursor exactly. The previous
 * implementation searched the flattened text for the selected string, which
 * mislocated repeated phrases and failed outright once prefixes existed — the
 * selected text of a heading does not contain the `## ` we inserted in front of
 * it. Positions are now derived from the element the cursor is actually in.
 *
 * Tables and images are skipped, as they were before Markdown: their text never
 * reached the model, and turning them into Markdown tables is its own change.
 *
 * @param {Body} body - The body element to serialize
 * @returns {{markdown: string, blocks: Array<?{start: number, prefixLength: number, textLength: number}>}}
 *   `blocks` is indexed by body child index; entries are null for skipped children.
 */
function serializeBody(body) {
  const blocks = [];
  const counters = {};
  const numChildren = body.getNumChildren();

  let markdown = '';
  let previousWasListItem = false;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const type = child.getType();

    let prefix = '';
    let text = '';
    let isListItem = false;

    if (type === DocumentApp.ElementType.LIST_ITEM) {
      const item = child.asListItem();
      prefix = listItemPrefix(item, counters);
      text = item.getText();
      isListItem = true;
    } else if (type === DocumentApp.ElementType.PARAGRAPH) {
      const paragraph = child.asParagraph();
      prefix = headingPrefix(paragraph.getHeading());
      text = paragraph.getText();
    } else {
      // Tables, images, page breaks, anything unsupported.
      blocks.push(null);
      continue;
    }

    // An empty paragraph is spacing the writer inserted, not content. Emitting
    // it would add a second blank line on top of the one that already separates
    // blocks, so record its position (the cursor can sit in one) and emit
    // nothing.
    if (text === '' && !isListItem) {
      blocks.push({ start: markdown.length, prefixLength: 0, textLength: 0 });
      continue;
    }

    if (markdown !== '') {
      // Consecutive list items are one list, so a single newline. Everything
      // else needs the blank line that separates Markdown blocks.
      markdown += previousWasListItem && isListItem ? '\n' : '\n\n';
    }

    const start = markdown.length;
    markdown += prefix + text;
    blocks.push({
      start: start,
      prefixLength: prefix.length,
      textLength: text.length
    });
    previousWasListItem = isListItem;
  }

  return { markdown: markdown, blocks: blocks };
}

/** The Markdown rendering of a body, without the position index. */
function bodyToMarkdown(body) {
  return serializeBody(body).markdown;
}

/**
 * Finds which top-level body child contains an element, walking up from
 * wherever the cursor or range actually points (usually a Text run inside a
 * paragraph).
 *
 * @param {Body} body - The body to index into
 * @param {Element} element - Any element beneath it
 * @returns {?number} The body child index, or null if the element isn't under it
 */
function topLevelChildIndex(body, element) {
  let current = element;

  // Bounded because a malformed parent chain must not hang the 6-minute
  // execution budget; real documents nest a handful of levels at most.
  for (let depth = 0; current && depth < 64; depth++) {
    let parent;
    try {
      parent = current.getParent();
    } catch (e) {
      return null;
    }
    if (!parent) return null;

    if (parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
      try {
        return body.getChildIndex(current);
      } catch (e) {
        return null;
      }
    }
    current = parent;
  }

  return null;
}

/**
 * Maps a position inside a document element to an offset in the serialized
 * Markdown.
 *
 * @param {Body} body - The serialized body
 * @param {Object} serialized - The result of `serializeBody`
 * @param {Element} element - The element the position is in
 * @param {number} offsetInText - Offset within that element's text
 * @returns {?number} An offset into `serialized.markdown`, or null if unmappable
 */
function markdownOffset(body, serialized, element, offsetInText) {
  const index = topLevelChildIndex(body, element);
  if (index === null) return null;

  const block = serialized.blocks[index];
  if (!block) return null;

  const clamped = Math.max(0, Math.min(offsetInText, block.textLength));
  return block.start + block.prefixLength + clamped;
}

/**
 * Maps one end of a selection to an offset in the serialized Markdown.
 *
 * A wholly-selected element starts at its Markdown prefix rather than after it,
 * so selecting a heading yields `## Heading` — the prefix is part of that span
 * of the document, and including it keeps
 * `beforeCursor + selectedText + afterCursor` equal to the full Markdown.
 *
 * @param {Body} body - The serialized body
 * @param {Object} serialized - The result of `serializeBody`
 * @param {RangeElement} rangeElement - One element of the selection
 * @param {boolean} isEnd - True for the trailing edge of the selection
 * @returns {?number} An offset into `serialized.markdown`, or null if unmappable
 */
function selectionEdgeOffset(body, serialized, rangeElement, isEnd) {
  const element = rangeElement.getElement();
  const index = topLevelChildIndex(body, element);
  if (index === null) return null;

  const block = serialized.blocks[index];
  if (!block) return null;

  if (rangeElement.isPartial()) {
    const offset = isEnd
      ? rangeElement.getEndOffsetInclusive() + 1
      : rangeElement.getStartOffset();
    const clamped = Math.max(0, Math.min(offset, block.textLength));
    return block.start + block.prefixLength + clamped;
  }

  return isEnd
    ? block.start + block.prefixLength + block.textLength
    : block.start;
}

/**
 * Gets the document context: Markdown before the cursor, the selected Markdown,
 * and the Markdown after it. This mirrors the DocContext interface from the
 * frontend, and the three pieces always concatenate back to the whole document.
 *
 * @returns {Object} DocContext object with beforeCursor, selectedText, afterCursor
 */
function getDocContext() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  const serialized = serializeBody(body);
  const markdown = serialized.markdown;

  const selection = doc.getSelection();
  const cursor = doc.getCursor();

  if (selection) {
    const elements = selection.getRangeElements();
    if (elements.length > 0) {
      const start = selectionEdgeOffset(body, serialized, elements[0], false);
      const end = selectionEdgeOffset(
        body,
        serialized,
        elements[elements.length - 1],
        true
      );

      if (start !== null && end !== null && end >= start) {
        return {
          beforeCursor: markdown.substring(0, start),
          selectedText: markdown.substring(start, end),
          afterCursor: markdown.substring(end)
        };
      }
    }
  } else if (cursor) {
    const position = markdownOffset(
      body,
      serialized,
      cursor.getElement(),
      cursor.getOffset()
    );
    if (position !== null) {
      return {
        beforeCursor: markdown.substring(0, position),
        selectedText: '',
        afterCursor: markdown.substring(position)
      };
    }
  }

  // No cursor, no selection, or a position we couldn't place: the whole
  // document is "before", which is what an append-at-the-end caller expects.
  return {
    beforeCursor: markdown,
    selectedText: '',
    afterCursor: ''
  };
}

/**
 * Escapes a literal string for findText, which takes a regular expression
 * rather than plain text. Without this, any quote containing punctuation the
 * regex engine claims — parentheses, `?`, `.`, `+`, `[`, `$` — either fails to
 * match or matches the wrong span.
 *
 * @param {string} text - Literal text to search for
 * @returns {string} The text as a pattern matching itself literally
 */
function escapeForFindText(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Selects a phrase in the document by searching for it.
 *
 * The phrase comes from the model quoting the writer's document, so it is often
 * slightly off at the edges — a word too many, punctuation the model
 * normalized. When the whole phrase isn't found we trim a word off each end and
 * search again, and that retrying happens *here* rather than in the sidebar:
 * every sidebar attempt is a google.script.run round-trip of roughly a second,
 * while the same loop inside one Apps Script call costs milliseconds per pass.
 * A quote that used to take several seconds of dead-feeling clicking now
 * resolves in a single call.
 *
 * @param {string} phrase - The text to find and select
 * @returns {boolean} True if the phrase (or a trimmed form of it) was selected
 */
function selectPhrase(phrase) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  let candidate = phrase;
  while (candidate.length > 0) {
    const searchResult = body.findText(escapeForFindText(candidate));

    if (searchResult) {
      const element = searchResult.getElement();
      const startOffset = searchResult.getStartOffset();
      const endOffset = searchResult.getEndOffsetInclusive();

      // Create a range for the found text
      const rangeBuilder = doc.newRange();
      rangeBuilder.addElement(element, startOffset, endOffset);

      // Set the selection
      doc.setSelection(rangeBuilder.build());
      return true;
    }

    // Drop the first and last word and try the narrower quote.
    const trimmed = candidate.split(' ').slice(1, -1).join(' ');
    if (trimmed === candidate) break; // Nothing left to trim.
    candidate = trimmed;
  }

  return false;
}

/**
 * Finds a phrase inside a specific tab and selects it. Selecting moves the
 * editor to that tab and highlights the text — all in the same window — which
 * a URL link can't do (the sidebar sandbox blocks top-frame navigation, and
 * Docs URLs can't deep-link to text).
 *
 * @param {string} tabId - The target tab's id (from getAllTabs)
 * @param {string} phrase - The text to find and select
 * @returns {boolean} True if found and selected, false otherwise
 */
function selectInTab(tabId, phrase, occurrenceIndex) {
  occurrenceIndex = occurrenceIndex || 0;
  const doc = DocumentApp.getActiveDocument();

  // Locate the requested tab object.
  let targetTab = null;
  try {
    const tabs = doc.getTabs();
    for (let i = 0; i < tabs.length; i++) {
      if (tabs[i].getId() === tabId) {
        targetTab = tabs[i];
        break;
      }
    }
  } catch (e) { /* Tabs API not supported */ }

  // Make the target tab active FIRST. setSelection only works within the active
  // tab, so switching here is what lets the highlight land in the right tab (and
  // moves the user there in the same window). setActiveTab takes the tab id.
  let switched = false;
  if (targetTab) {
    doc.setActiveTab(tabId);
    switched = true;
  }

  // Highlight the requested occurrence within that tab's body. findText treats
  // its argument as a regex, so escape the phrase to match it literally and keep
  // occurrence counting aligned with the frontend's plain-text search.
  const body = targetTab ? targetTab.asDocumentTab().getBody() : doc.getBody();
  const pattern = escapeForFindText(phrase);

  let match = body.findText(pattern);
  for (let n = 0; n < occurrenceIndex && match; n++) {
    match = body.findText(pattern, match);
  }

  let selected = false;
  if (match) {
    try {
      const range = doc.newRange()
        .addElement(
          match.getElement(),
          match.getStartOffset(),
          match.getEndOffsetInclusive(),
        )
        .build();
      doc.setSelection(range);
      selected = true;
    } catch (e) { /* cross-tab selection not permitted on this API version */ }
  }

  // True if we either switched tabs or highlighted — either is an in-window jump.
  return switched || selected;
}

/**
 * Inserts text at the current cursor position.
 * 
 * @param {string} text - The text to insert
 * @returns {boolean} True if successful, false otherwise
 */
function insertTextAtCursor(text) {
  const doc = DocumentApp.getActiveDocument();
  const cursor = doc.getCursor();
  
  if (cursor) {
    cursor.insertText(text);
    return true;
  }
  
  return false;
}

/**
 * Replaces the current selection with new text.
 * 
 * @param {string} newText - The text to replace the selection with
 * @returns {boolean} True if successful, false otherwise
 */
function replaceSelection(newText) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  
  if (selection) {
    const elements = selection.getRangeElements();
    
    // For simplicity, we'll replace the first element's text
    // A more robust implementation would handle multi-element selections
    if (elements.length > 0) {
      const firstElement = elements[0];
      const text = firstElement.getElement().asText();
      
      if (text) {
        if (firstElement.isPartial()) {
          text.deleteText(firstElement.getStartOffset(), firstElement.getEndOffsetInclusive());
          text.insertText(firstElement.getStartOffset(), newText);
        } else {
          text.setText(newText);
        }
        return true;
      }
    }
  }
  
  return false;
}

// =============================================================================
// User Properties (for storing user preferences/tokens)
// =============================================================================

/**
 * Stores a user property.
 */
function setUserProperty(key, value) {
  PropertiesService.getUserProperties().setProperty(key, value);
}

/**
 * Gets a user property.
 */
function getUserProperty(key) {
  return PropertiesService.getUserProperties().getProperty(key);
}

/**
 * Deletes a user property.
 */
function deleteUserProperty(key) {
  PropertiesService.getUserProperties().deleteProperty(key);
}

// =============================================================================
// Document Properties (for settings that belong to the document, not the user)
// =============================================================================
//
// User properties above are per-user and follow the person across every
// document. Document properties are the opposite: scoped to this document and
// shared by everyone who opens it, which is what settings like the writer's
// to-do (audience / guardrails / comments) need — they describe the document,
// so they must travel with it rather than with whoever typed them.

/**
 * Stores a document property.
 */
function setDocumentProperty(key, value) {
  PropertiesService.getDocumentProperties().setProperty(key, value);
}

/**
 * Gets a document property. Returns null if it was never set.
 */
function getDocumentProperty(key) {
  return PropertiesService.getDocumentProperties().getProperty(key);
}

/**
 * Deletes a document property.
 */
function deleteDocumentProperty(key) {
  PropertiesService.getDocumentProperties().deleteProperty(key);
}

/**
 * Gets the current user's email (for identification).
 */
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * Gets the document ID of the active document.
 *
 * @returns {string} The document ID
 */
function getDocumentId() {
  return DocumentApp.getActiveDocument().getId();
}

/**
 * Gets the title of the active document. The sidebar uses this to decide
 * whether to load the dev bundle (title contains a dev marker) or production.
 *
 * @returns {string} The document title
 */
function getDocumentName() {
  return DocumentApp.getActiveDocument().getName();
}

/**
 * Gets all tabs in the active document with their text content.
 * Falls back to a single entry representing the whole document if the
 * Tabs API is unavailable (older documents / Apps Script environments).
 *
 * @returns {Array<{id: string, title: string, text: string}>}
 */
function getAllTabs() {
  var doc = DocumentApp.getActiveDocument();
  try {
    var tabs = doc.getTabs();
    return tabs.map(function(tab) {
      var text = '';
      try {
        text = bodyToMarkdown(tab.asDocumentTab().getBody());
      } catch (e) { /* skip */ }
      return { id: tab.getId(), title: tab.getTitle(), text: text };
    });
  } catch (e) {
    // Document has no tabs API support — return the body as a single tab
    return [{
      id: doc.getId(),
      title: 'Main',
      text: bodyToMarkdown(doc.getBody())
    }];
  }
}
