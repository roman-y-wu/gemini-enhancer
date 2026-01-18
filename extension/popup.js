// Popup script for managing slash commands

// Wrap in an IIFE to avoid polluting the global scope (popup scripts are not ES modules)
(() => {

// Safari compatibility: Use browser API if available, fallback to chrome
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', async function () {
    const commandsList = document.getElementById('commandsList');
    const addCommandBtn = document.getElementById('addCommand');
    const triggerInput = document.getElementById('commandTrigger');
    const promptInput = document.getElementById('commandPrompt');
    const exportBtn = document.getElementById('exportCommands');
    const importBtn = document.getElementById('importCommands');
    const importFile = document.getElementById('importFile');

    // Track editing state
    let editingKey = null;


    // Load and display existing commands
    await loadCommands();

    // Add new command
    addCommandBtn.addEventListener('click', addOrUpdateCommand);

    // Enable adding command with Enter key
    triggerInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addOrUpdateCommand();
    });

    promptInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && e.ctrlKey) addOrUpdateCommand();
    });

    // Export/import
    exportBtn.addEventListener('click', async () => {
        try {
            const result = await browserAPI.storage.sync.get(['slashCommands']);
            const commands = result.slashCommands || {};
            const json = JSON.stringify(commands, null, 2);
            await navigator.clipboard.writeText(json);
            showNotification('Copied commands JSON to clipboard', 'success');
        } catch (err) {
            console.error('Export failed:', err);
            showNotification('Export failed', 'error');
        }
    });
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
            const result = await browserAPI.storage.sync.get(['slashCommands']);
            const existing = result.slashCommands || {};
            const merged = { ...existing, ...parsed };
            await browserAPI.storage.sync.set({ slashCommands: merged });
            showNotification('Imported commands', 'success');
            await loadCommands();
        } catch (err) {
            console.error('Import failed:', err);
            showNotification('Import failed', 'error');
        } finally {
            importFile.value = '';
        }
    });


    async function loadCommands() {
        try {
            const result = await browserAPI.storage.sync.get(['slashCommands']);
            const commands = result.slashCommands || {};

            displayCommands(commands);
        } catch (error) {
            console.error('Error loading commands:', error);
        }
    }

    function displayCommands(commands) {
        const commandsArray = Object.entries(commands);

        if (commandsArray.length === 0) {
            commandsList.innerHTML = '<div class="empty-state">No commands yet. Add one below!</div>';
            return;
        }

        commandsList.innerHTML = commandsArray.map(([trigger, prompt]) => `
            <div class="command-item" data-trigger="${trigger}">
                <span class="command-badge">/${trigger}</span>
                <span class="command-text">${prompt}</span>
                <div class="command-actions">
                    <button class="action-btn" data-edit="${trigger}" title="Edit">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="action-btn danger" data-trigger="${trigger}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `).join('');

        // Add event listeners
        commandsList.querySelectorAll('.action-btn').forEach((btn) => {
            if (btn.dataset.trigger) {
                btn.addEventListener('click', () => deleteCommand(btn.dataset.trigger));
            }
            if (btn.dataset.edit) {
                btn.addEventListener('click', () => startEditCommand(btn.dataset.edit));
            }
        });
    }

    async function addOrUpdateCommand() {
        const trigger = triggerInput.value.trim().toLowerCase();
        const prompt = promptInput.value.trim();

        if (!trigger || !prompt) {
            showNotification('Please fill in both fields', 'error');
            return;
        }

        // Validate trigger (alphanumeric only)
        if (!/^[a-z0-9]+$/.test(trigger)) {
            showNotification('Command must contain only letters and numbers', 'error');
            return;
        }

        try {
            const result = await browserAPI.storage.sync.get(['slashCommands']);
            const commands = result.slashCommands || {};

            let isUpdate = false;
            if (editingKey && editingKey !== trigger) {
                // Renaming: remove old key
                delete commands[editingKey];
                isUpdate = true;
            }
            if (commands[trigger]) isUpdate = true;
            commands[trigger] = prompt;

            await browserAPI.storage.sync.set({ slashCommands: commands });

            // Clear inputs
            triggerInput.value = '';
            promptInput.value = '';
            editingKey = null;
            addCommandBtn.textContent = 'Add Command';

            // Show success message
            showNotification(isUpdate ? `Updated /${trigger}` : `Added /${trigger}`, 'success');

            // Reload display
            await loadCommands();

        } catch (error) {
            console.error('Error saving command:', error);
            showNotification('Error saving command. Please try again.', 'error');
        }
    }

    function startEditCommand(trigger) {
        // Prefill form and switch button label
        triggerInput.value = trigger;
        triggerInput.focus();
        browserAPI.storage.sync.get(['slashCommands']).then((result) => {
            const commands = result.slashCommands || {};
            promptInput.value = commands[trigger] || '';
        });
        editingKey = trigger;
        addCommandBtn.textContent = 'Save Changes';
    }

    async function deleteCommand(trigger) {
        if (!confirm(`Delete command /${trigger}?`)) {
            return;
        }

        try {
            const result = await browserAPI.storage.sync.get(['slashCommands']);
            const commands = result.slashCommands || {};

            delete commands[trigger];

            await browserAPI.storage.sync.set({ slashCommands: commands });

            // Show success message
            showNotification(`Deleted /${trigger}`, 'success');

            // Reload display
            await loadCommands();

        } catch (error) {
            console.error('Error deleting command:', error);
            showNotification('Error deleting command. Please try again.', 'error');
        }
    }

    function showNotification(message, type = 'info') {
        // Remove any existing notification
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create notification element (uses styles from popup.html)
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 2.5 seconds
        setTimeout(() => {
            notification.style.animation = 'toast-out 0.2s ease forwards';
            setTimeout(() => notification.remove(), 200);
        }, 2500);
    }

    // Feature Toggle Elements
    const followUpToggle = document.getElementById('followUpToggle');
    const slashCommandsToggle = document.getElementById('slashCommandsToggle');
    const wideModeToggle = document.getElementById('wideModeToggle');
    const widthControl = document.getElementById('widthControl');
    const widthSlider = document.getElementById('widthSlider');
    const widthValue = document.getElementById('widthValue');

    // Load all saved settings
    browserAPI.storage.sync.get(['followUpEnabled', 'slashCommandsEnabled', 'wideMode', 'wideModeWidth'], (result) => {
        // Follow-up buttons (default: enabled)
        const followUpEnabled = result.followUpEnabled !== false;
        if (followUpToggle) followUpToggle.checked = followUpEnabled;

        // Slash commands (default: enabled)
        const slashCommandsEnabled = result.slashCommandsEnabled !== false;
        if (slashCommandsToggle) slashCommandsToggle.checked = slashCommandsEnabled;

        // Wide mode
        const wideEnabled = result.wideMode || false;
        const width = result.wideModeWidth || 1000;

        if (wideModeToggle) wideModeToggle.checked = wideEnabled;
        if (widthSlider) widthSlider.value = width.toString();
        if (widthValue) widthValue.textContent = `${width}px`;

        if (wideEnabled && widthControl) {
            widthControl.classList.add('show');
        }
    });

    // Follow-up Buttons Toggle
    if (followUpToggle) {
        followUpToggle.addEventListener('change', () => {
            const isEnabled = followUpToggle.checked;
            browserAPI.storage.sync.set({ followUpEnabled: isEnabled });

            // Send message to active tab
            sendMessageToActiveTab({
                type: 'UPDATE_FOLLOW_UP',
                enabled: isEnabled
            });

            showNotification(isEnabled ? 'Follow-up buttons enabled' : 'Follow-up buttons disabled', 'success');
        });
    }

    // Slash Commands Toggle
    if (slashCommandsToggle) {
        slashCommandsToggle.addEventListener('change', () => {
            const isEnabled = slashCommandsToggle.checked;
            browserAPI.storage.sync.set({ slashCommandsEnabled: isEnabled });

            // Send message to active tab
            sendMessageToActiveTab({
                type: 'UPDATE_SLASH_COMMANDS',
                enabled: isEnabled
            });

            showNotification(isEnabled ? 'Slash commands enabled' : 'Slash commands disabled', 'success');
        });
    }

    // Toggle Wide Mode
    if (wideModeToggle) {
        wideModeToggle.addEventListener('change', () => {
            const isEnabled = wideModeToggle.checked;
            if (widthControl) {
                if (isEnabled) {
                    widthControl.classList.add('show');
                } else {
                    widthControl.classList.remove('show');
                }
            }

            browserAPI.storage.sync.set({ wideMode: isEnabled });

            // Send message to active tab
            sendMessageToActiveTab({
                type: 'UPDATE_WIDE_MODE',
                enabled: isEnabled,
                width: parseInt(widthSlider.value)
            });
        });
    }

    // Adjust Width
    if (widthSlider) {
        widthSlider.addEventListener('input', () => {
            const width = parseInt(widthSlider.value);
            if (widthValue) widthValue.textContent = `${width}px`;

            // Debounce storage save, but send immediate message for preview
            browserAPI.storage.sync.set({ wideModeWidth: width });

            sendMessageToActiveTab({
                type: 'UPDATE_WIDE_MODE',
                enabled: wideModeToggle.checked,
                width: width
            });
        });
    }

    function sendMessageToActiveTab(message) {
        browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                browserAPI.tabs.sendMessage(tabs[0].id, message).catch(() => {
                    // Ignore errors if content script isn't ready
                });
            }
        });
    }
});

})();
