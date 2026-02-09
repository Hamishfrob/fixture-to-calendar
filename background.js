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
    chrome.runtime.openOptionsPage();
    return;
  }

  // Extract full page text for additional context
  let pageContext = '';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText
    });
    if (results && results[0] && results[0].result) {
      pageContext = results[0].result;
      // Truncate to 8000 chars to keep API costs low
      if (pageContext.length > 8000) {
        pageContext = pageContext.substring(0, 8000);
      }
    }
  } catch (e) {
    // Silently fail — page context is an optional enhancement
    // This can fail on special pages like edge://, PDFs, etc.
    console.warn('Could not extract page context:', e.message);
  }

  // Store the selected text and show a "parsing" state
  await chrome.storage.local.set({
    parsingState: 'loading',
    selectedText: selectedText,
    parsedEvents: null,
    parseError: null
  });

  // Open the popup window
  await chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 520,
    height: 600
  });

  // Call Claude API to parse the text
  try {
    const events = await parseWithClaude(selectedText, apiKey, defaultDuration || 120, pageContext);
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

// Listen for messages from the popup (e.g. venue enrichment requests)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'enrichVenue') {
    chrome.storage.local.get(['apiKey'], async ({ apiKey }) => {
      if (!apiKey) {
        sendResponse({ success: false, error: 'No API key set. Please check extension settings.' });
        return;
      }
      try {
        const venueData = await enrichVenueWithClaude(message.event, apiKey);
        sendResponse({ success: true, venueData });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    });
    return true; // Keep message channel open for async response
  }
});

// ---- Claude API: Parse fixtures ----
async function parseWithClaude(text, apiKey, defaultDuration, pageContext) {
  const currentYear = new Date().getFullYear();

  let prompt = `You are a date/event parser. Extract calendar events from the following highlighted text.

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
]`;

  // Add page context if available
  if (pageContext && pageContext.trim().length > 0) {
    prompt += `

ADDITIONAL PAGE CONTEXT (use this to fill in missing details like times, venues, addresses, competition names, or event types that are NOT in the highlighted text):
---
${pageContext}
---
IMPORTANT: The highlighted text below is the PRIMARY source. Only use the page context above to supplement missing information like times, locations, or event descriptions.`;
  }

  prompt += `

Highlighted text to parse:
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

// ---- Claude API: Enrich venue details ----
async function enrichVenueWithClaude(event, apiKey) {
  const prompt = `You are a venue information assistant. Given the following event, provide details about the venue/location.

Event: ${event.title}
Location: ${event.location}
Date: ${event.date}

Provide the following information in JSON format:
{
  "fullAddress": "Full street address if known, or empty string",
  "description": "Brief description of what this venue is (e.g. 'Football stadium, home of Arsenal FC, capacity 60,704')",
  "transport": "Brief public transport or travel info if known, or empty string",
  "notes": "Any other useful info (e.g. nearby parking, gate opening times) or empty string"
}

If you don't have reliable information about this venue, return:
{"fullAddress": "", "description": "Venue details not available", "transport": "", "notes": ""}

Return ONLY valid JSON, no other text.`;

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
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch venue details. Please try again.');
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Extract JSON
  let jsonStr = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  return JSON.parse(jsonStr);
}
