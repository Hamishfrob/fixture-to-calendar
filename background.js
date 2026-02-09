// Register context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'fixture-to-calendar',
    title: 'Convert to Calendar Events',
    contexts: ['selection']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'fixture-to-calendar') return;

  const selectedText = info.selectionText;
  if (!selectedText || selectedText.trim().length === 0) return;

  // Get API key from storage
  const { apiKey, defaultDuration } = await chrome.storage.local.get(['apiKey', 'defaultDuration']);

  if (!apiKey) {
    // Open settings page if no API key is set
    chrome.runtime.openOptionsPage();
    return;
  }

  // Store the selected text and show a "parsing" state
  await chrome.storage.local.set({
    parsingState: 'loading',
    selectedText: selectedText,
    parsedEvents: null,
    parseError: null
  });

  // Open the popup window
  const popupWindow = await chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 520,
    height: 600
  });

  // Call Claude API to parse the text
  try {
    const events = await parseWithClaude(selectedText, apiKey, defaultDuration || 120);
    await chrome.storage.local.set({
      parsingState: 'done',
      parsedEvents: events,
      parseError: null
    });
  } catch (error) {
    await chrome.storage.local.set({
      parsingState: 'error',
      parseError: error.message,
      parsedEvents: null
    });
  }
});

async function parseWithClaude(text, apiKey, defaultDuration) {
  const currentYear = new Date().getFullYear();

  const prompt = `You are a date/event parser. Extract calendar events from the following text.

Rules:
- Use UK date format (DD/MM/YYYY)
- If no year is specified, assume ${currentYear} (or ${currentYear + 1} if the date has clearly passed)
- If no end time is given, set the end time to ${defaultDuration} minutes after the start time
- If no specific time is given, use 15:00 as a default start time
- Extract: event title, date, start time, end time, and location (if mentioned)
- Return ONLY a valid JSON array, no other text

Return format:
[
  {
    "title": "Event name",
    "date": "DD/MM/YYYY",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "location": "Venue name or empty string"
  }
]

Text to parse:
${text}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your key in the extension settings.');
    }
    if (response.status === 429) {
      throw new Error('Rate limited. Please wait a moment and try again.');
    }
    throw new Error(`API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Extract JSON from the response (handle cases where Claude wraps it in markdown)
  let jsonStr = content;
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  const events = JSON.parse(jsonStr);

  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('No events found in the selected text. Try selecting text that contains dates.');
  }

  return events;
}
