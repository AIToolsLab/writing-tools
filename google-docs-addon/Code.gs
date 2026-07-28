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

/**
 * Gets the document context: text before cursor, selected text, and text after cursor.
 * This mirrors the DocContext interface from the frontend.
 * 
 * @returns {Object} DocContext object with beforeCursor, selectedText, afterCursor
 */
function getDocContext() {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  
  // Extract only text content, ignoring images, tables, etc.
  const fullText = extractTextOnly(body);
  
  const selection = doc.getSelection();
  const cursor = doc.getCursor();
  
  let beforeCursor = '';
  let selectedText = '';
  let afterCursor = '';
  
  if (selection) {
    // There's a selection
    const elements = selection.getRangeElements();
    
    if (elements.length > 0) {
      // Get selected text
      const selectedParts = [];
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const text = element.getElement().asText();
        if (text) {
          if (element.isPartial()) {
            selectedParts.push(text.getText().substring(
              element.getStartOffset(),
              element.getEndOffsetInclusive() + 1
            ));
          } else {
            selectedParts.push(text.getText());
          }
        }
      }
      selectedText = selectedParts.join('');
      
      // Find the selection in the full text to determine before/after
      const selectionStart = fullText.indexOf(selectedText);
      if (selectionStart !== -1) {
        beforeCursor = fullText.substring(0, selectionStart);
        afterCursor = fullText.substring(selectionStart + selectedText.length);
      }
    }
  } else if (cursor) {
    // There's just a cursor, no selection
    const cursorElement = cursor.getElement();
    const cursorOffset = cursor.getOffset();
    
    // Get the text element containing the cursor
    const textElement = cursorElement.asText ? cursorElement.asText() : null;
    
    if (textElement) {
      // Find the position in the full document
      const textContent = textElement.getText();
      const textStart = fullText.indexOf(textContent);
      
      if (textStart !== -1) {
        const absolutePosition = textStart + cursorOffset;
        beforeCursor = fullText.substring(0, absolutePosition);
        afterCursor = fullText.substring(absolutePosition);
      }
    }
  } else {
    // No selection and no cursor - return full document as "before"
    beforeCursor = fullText;
  }
  
  return {
    beforeCursor: beforeCursor,
    selectedText: selectedText,
    afterCursor: afterCursor
  };
}

/**
 * Extracts only text content from a document element, ignoring images, tables, etc.
 * 
 * @param {Element} element - The document element to extract text from
 * @returns {string} Text content only
 */
function extractTextOnly(element) {
  let text = '';
  
  // Get child elements
  const numChildren = element.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = element.getChild(i);
    const elementType = child.getType();
    
    // Only process text-containing elements
    if (elementType === DocumentApp.ElementType.PARAGRAPH ||
        elementType === DocumentApp.ElementType.LIST_ITEM ||
        elementType === DocumentApp.ElementType.TEXT) {
      // Try to get text
      try {
        const childText = child.asText ? child.asText() : null;
        if (childText) {
          text += childText.getText();
        }
      } catch (e) {
        // Skip elements that can't be converted to text
        continue;
      }
    } else if (elementType === DocumentApp.ElementType.TABLE) {
      // Skip tables
      continue;
    } else if (elementType === DocumentApp.ElementType.INLINE_IMAGE || 
               elementType === DocumentApp.ElementType.IMAGE ||
               elementType === DocumentApp.ElementType.UNSUPPORTED) {
      // Skip images and unsupported elements
      continue;
    } else {
      // For other container types, recursively extract text
      try {
        text += extractTextOnly(child);
      } catch (e) {
        continue;
      }
    }
  }
  
  return text;
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
        text = extractTextOnly(tab.asDocumentTab().getBody());
      } catch (e) { /* skip */ }
      return { id: tab.getId(), title: tab.getTitle(), text: text };
    });
  } catch (e) {
    // Document has no tabs API support — return the body as a single tab
    return [{
      id: doc.getId(),
      title: 'Main',
      text: extractTextOnly(doc.getBody())
    }];
  }
}
