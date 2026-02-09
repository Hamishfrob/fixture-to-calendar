const apiKeyInput = document.getElementById('apiKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const defaultDurationInput = document.getElementById('defaultDuration');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// Load saved settings
chrome.storage.local.get(['apiKey', 'defaultDuration'], (result) => {
  if (result.apiKey) {
    apiKeyInput.value = result.apiKey;
  }
  if (result.defaultDuration) {
    defaultDurationInput.value = result.defaultDuration;
  }
});

// Toggle API key visibility
toggleKeyBtn.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleKeyBtn.textContent = 'Hide';
  } else {
    apiKeyInput.type = 'password';
    toggleKeyBtn.textContent = 'Show';
  }
});

// Save settings
saveBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const defaultDuration = parseInt(defaultDurationInput.value, 10);

  if (!apiKey) {
    showStatus('Please enter an API key.', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-ant-')) {
    showStatus('API key should start with "sk-ant-". Please check your key.', 'error');
    return;
  }

  if (defaultDuration < 15 || defaultDuration > 480) {
    showStatus('Duration must be between 15 and 480 minutes.', 'error');
    return;
  }

  chrome.storage.local.set({ apiKey, defaultDuration }, () => {
    showStatus('Settings saved!', 'success');
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
  if (type === 'success') {
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 3000);
  }
}
