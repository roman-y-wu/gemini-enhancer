/**
 * Gemini Enhancer - Content Script
 *
 * A Chrome extension that enhances Gemini with:
 * - Follow-up toolbar for quick actions on selected text
 * - Slash commands for custom prompts
 * - Wide mode for expanded conversation width
 */

// Wrap in an IIFE to avoid polluting the global scope (content scripts are not ES modules)
(() => {

console.log('Gemini Enhancer content script loaded.');

// ============================================================================
// DUPLICATE INJECTION PREVENTION
// ============================================================================

const __geminiEnhancerAlreadyActive = window.__GEMINI_ENHANCER_ACTIVE__;
window.__GEMINI_ENHANCER_ACTIVE__ = true;

if (__geminiEnhancerAlreadyActive) {
    console.log('Gemini Enhancer already active — skipping init.');
    throw new Error('[Gemini Enhancer] Already initialized - safe to ignore this error');
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface FeatureState {
    followUpEnabled: boolean;
    slashCommandsEnabled: boolean;
    wideModeEnabled: boolean;
}

interface FollowUpState {
    button: HTMLElement | null;
    selectedText: string;
    stabilityTimeout: ReturnType<typeof setTimeout> | null;
    isHoveringButton: boolean;
    selectionTimeout: ReturnType<typeof setTimeout> | null;
}

interface SlashCommandsState {
    commands: Record<string, string>;
    autocomplete: HTMLElement | null;
    lastInputBox: HTMLElement | null;
    isActive: boolean;
}

interface UIState {
    actionBar: HTMLElement | null;
    activeFeature: string | null;
}

interface ObserversState {
    mutation: MutationObserver | null;
    input: Set<HTMLElement>;
    resize: ResizeObserver | null;
}

interface EnhancerStateData {
    features: FeatureState;
    followUp: FollowUpState;
    slashCommands: SlashCommandsState;
    ui: UIState;
    observers: ObserversState;
}

interface ToolbarAction {
    id: string;
    label: string;
    icon: string;
    prompt: string;
}

interface SelectionRect {
    top: number;
    left: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/** Input element type that can be a textarea, input, or contenteditable element */
type InputElement = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/** Browser API for cross-browser compatibility (Chrome/Safari) */
const browserAPI: typeof chrome = typeof browser !== 'undefined' ? browser : chrome;

/** Default width for wide mode */
const DEFAULT_WIDE_MODE_WIDTH = 1000;

/** Debounce delay for text selection (ms) */
const SELECTION_DEBOUNCE_MS = 50;

/** Animation duration for UI transitions (ms) */
const ANIMATION_DURATION_MS = 150;

/** Selectors for Gemini's AI response containers */
const AI_RESPONSE_SELECTORS = [
    'model-response',
    'message-content',
    '[data-message-author-role="model"]',
    '[data-content-origin="model"]',
    '.response-container',
    '.model-response-text',
    '.markdown-content',
    '.response-content',
    'message-content[class*="model"]',
    '.conversation-turn [data-message-author-role="model"]',
    '[class*="response"]',
    '[class*="answer"]',
    '[class*="model"]',
    '[class*="assistant"]'
];

/** Selectors for Gemini's input box */
const INPUT_BOX_SELECTORS = [
    '#prompt-textarea',
    'textarea[aria-label*="Prompt" i]',
    'textarea[aria-label*="Message" i]',
    'textarea[placeholder*="Message" i]',
    'textarea[data-testid*="chat-input" i]',
    'div[role="textbox"][aria-label*="Send a message" i]',
    'div[role="textbox"][aria-label*="Prompt" i]',
    '.input-box[contenteditable="true"]'
];

/** SVG icons for the toolbar */
const TOOLBAR_ICONS = {
    ask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    explain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    examples: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
};

/** Toolbar action definitions */
const TOOLBAR_ACTIONS: ToolbarAction[] = [
    { id: 'askAbout', label: 'Ask', icon: TOOLBAR_ICONS.ask, prompt: '```\n{text}\n```' },
    { id: 'explainFurther', label: 'Explain', icon: TOOLBAR_ICONS.explain, prompt: '```\n{text}\n```\nExplain this section to me in more detail' },
    { id: 'giveExamples', label: 'Examples', icon: TOOLBAR_ICONS.examples, prompt: '```\n{text}\n```\nCan you give me some examples related to the above section.' }
];

/** Default slash commands */
const DEFAULT_SLASH_COMMANDS: Record<string, string> = {
    'translate': 'Translate the following text to English: {text}',
    'explain': 'Explain this concept in simple terms: {text}',
    'improve': 'Improve the writing and clarity of this text: {text}',
    'summarize': 'Provide a concise summary of: {text}',
    'code': 'Explain how this code works: {text}',
    'debug': 'Help me debug this code and find potential issues: {text}',
    'review': 'Review this text for grammar, style, and clarity: {text}',
    'creative': 'Use this as inspiration for a creative story or idea: {text}'
};

// ============================================================================
// GLOBAL STATE VARIABLES
// ============================================================================

let slashCommands: Record<string, string> = {};
let commandAutocomplete: HTMLElement | null = null;
let lastInputBox: HTMLElement | null = null;
let selectionTimeout: ReturnType<typeof setTimeout> | null = null;
let isRepositionScheduled = false;

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Centralized state management system for the enhancer
 */
class EnhancerState {
    state: EnhancerStateData;
    cleanup: Set<() => void>;
    eventBus: EventTarget;
    initialized: boolean;

    constructor() {
        this.state = {
            features: {
                followUpEnabled: true,
                slashCommandsEnabled: true,
                wideModeEnabled: false
            },
            followUp: {
                button: null,
                selectedText: '',
                stabilityTimeout: null,
                isHoveringButton: false,
                selectionTimeout: null
            },
            slashCommands: {
                commands: {},
                autocomplete: null,
                lastInputBox: null,
                isActive: false
            },
            ui: {
                actionBar: null,
                activeFeature: null
            },
            observers: {
                mutation: null,
                input: new Set(),
                resize: null
            }
        };

        this.cleanup = new Set();
        this.eventBus = new EventTarget();
        this.initialized = false;
    }

    /** Get a value from state using dot notation path */
    get<T = unknown>(path: string): T {
        return path.split('.').reduce<unknown>((obj, key) => {
            if (obj && typeof obj === 'object' && key in obj) {
                return (obj as Record<string, unknown>)[key];
            }
            return undefined;
        }, this.state as unknown) as T;
    }

    /** Set a value in state using dot notation path */
    set(path: string, value: unknown): void {
        const keys = path.split('.');
        const lastKey = keys.pop()!;
        const target = keys.reduce<Record<string, unknown>>((obj, key) => {
            if (!(key in obj)) {
                obj[key] = {};
            }
            return obj[key] as Record<string, unknown>;
        }, this.state as unknown as Record<string, unknown>);
        const oldValue = target[lastKey];
        target[lastKey] = value;

        this.eventBus.dispatchEvent(new CustomEvent('stateChange', {
            detail: { path, value, oldValue }
        }));
    }

    /** Subscribe to an event */
    on(event: string, callback: EventListener): void {
        this.eventBus.addEventListener(event, callback);
    }

    /** Emit a custom event */
    emit(event: string, data: Record<string, unknown>): void {
        this.eventBus.dispatchEvent(new CustomEvent(event, { detail: data }));
    }

    /** Register a cleanup function */
    addCleanup(cleanupFn: () => void): void {
        this.cleanup.add(cleanupFn);
    }

    /** Clean up all resources */
    destroy(): void {
            this.cleanup.forEach(fn => {
            try { fn(); } catch (e) { console.warn('Cleanup function failed:', e); }
            });
            this.cleanup.clear();
        this.initialized = false;
        console.log('Gemini Enhancer state cleaned up');
    }
}

/**
 * Event coordination system for managing feature priorities and UI conflicts
 */
class EventCoordinator {
    activeFeatures: Set<string>;
    featurePriority: Record<string, number>;

    constructor() {
        this.activeFeatures = new Set();
        this.featurePriority = {
            'follow-up': 3,
            'slash-commands': 2,
            'auto-save': 1
        };
    }

    /** Activate a feature */
    activateFeature(featureName: string, data: Record<string, unknown> = {}): void {
        this.activeFeatures.add(featureName);
        enhancerState.set('ui.activeFeature', featureName);
        enhancerState.emit('featureActivated', { feature: featureName, data });
    }

    /** Deactivate a feature */
    deactivateFeature(featureName: string): void {
        this.activeFeatures.delete(featureName);
        if (enhancerState.get<string | null>('ui.activeFeature') === featureName) {
            enhancerState.set('ui.activeFeature', null);
        }
        enhancerState.emit('featureDeactivated', { feature: featureName });
    }

    /** Check if a feature can be activated based on priority */
    canActivateFeature(featureName: string): boolean {
        const currentFeature = enhancerState.get<string | null>('ui.activeFeature');
        if (!currentFeature) return true;

        const currentPriority = this.featurePriority[currentFeature] || 0;
        const newPriority = this.featurePriority[featureName] || 0;

        return newPriority >= currentPriority;
    }
}

// Initialize global instances
const enhancerState = new EnhancerState();
const eventCoordinator = new EventCoordinator();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Show a toast notification
 */
function showToast(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    try {
        const existing = document.querySelector('.ge-toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = `ge-toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
        el.textContent = message;
        document.body.appendChild(el);
        
        setTimeout(() => {
            el.style.animation = 'ge-toast-out 0.2s ease forwards';
            setTimeout(() => el.remove(), 200);
        }, 2500);
    } catch {
        console.log('[Gemini Enhancer]', type, message);
    }
}

/**
 * Check if current path should be excluded from the extension
 */
function isExcludedPath(): boolean {
    const pathname = window.location.pathname;
    return pathname === '/scheduled' || pathname === '/apps';
}

/**
 * Get a bounding rectangle for the current selection
 */
function getSelectionBoundingRect(range: Range | null): SelectionRect | DOMRect | null {
    try {
        if (!range) return null;
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) return rect;

        const rects = Array.from(range.getClientRects?.() || []) as DOMRect[];
        const visible = rects.filter(r => r.width > 0 && r.height > 0);
        if (visible.length === 0) return null;

        const top = Math.min(...visible.map(r => r.top));
        const left = Math.min(...visible.map(r => r.left));
        const right = Math.max(...visible.map(r => r.right));
        const bottom = Math.max(...visible.map(r => r.bottom));

        return { top, left, right, bottom, width: right - left, height: bottom - top };
    } catch {
        return null;
    }
}

/**
 * Check if the current selection is within an AI response area
 */
function isSelectionFromAIResponse(selection: Selection | null): boolean {
    if (!selection || selection.rangeCount === 0) return false;

    const selectedText = selection.toString().trim();

    // Length validation (CJK-friendly)
    const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(selectedText);
    if ((hasCJK ? selectedText.length < 1 : selectedText.length < 2) || selectedText.length > 2000) {
        return false;
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    let element = (container.nodeType === Node.TEXT_NODE ? container.parentElement : container) as HTMLElement;

    // Check if selection is within input/editable areas (block these)
    let currentElement: HTMLElement | null = element;
    while (currentElement && currentElement !== document.body) {
        const tagName = currentElement.tagName?.toLowerCase();
        const isEditable = currentElement.contentEditable === 'true' || currentElement.contentEditable === '';
        const role = currentElement.getAttribute('role');

        if (tagName === 'textarea' || tagName === 'input' || isEditable || 
            role === 'textbox' || role === 'searchbox') {
            return false;
        }
        currentElement = currentElement.parentElement;
    }

    // Check if selection is within AI response area
    let isInAIResponse = false;
    
    // Method 1: Check using selectors
    for (const selector of AI_RESPONSE_SELECTORS) {
        try {
            if (element?.closest(selector)) {
                isInAIResponse = true;
                break;
            }
        } catch { /* Invalid selector */ }
    }

    // Method 2: Check class names and data attributes
    if (!isInAIResponse) {
        let checkElement: HTMLElement | null = element;
        while (checkElement && checkElement !== document.body) {
            const className = checkElement.className || '';
            const classList = typeof className === 'string' ? className.toLowerCase() : '';
            const dataAttrs = Array.from(checkElement.attributes || [])
                .filter((attr: Attr) => attr.name.startsWith('data-'))
                .map((attr: Attr) => `${attr.name}=${attr.value}`)
                .join(' ')
                .toLowerCase();

            if (classList.includes('response') || classList.includes('model') ||
                classList.includes('answer') || classList.includes('assistant') ||
                classList.includes('message-content') || classList.includes('markdown') ||
                dataAttrs.includes('model') || dataAttrs.includes('assistant') ||
                dataAttrs.includes('response')) {
                isInAIResponse = true;
                break;
            }
            checkElement = checkElement.parentElement;
        }
    }

    if (!isInAIResponse) return false;

    // Validate selection rectangle
    const selectionRect = getSelectionBoundingRect(range);
    if (!selectionRect || selectionRect.width === 0 || selectionRect.height === 0) {
        return false;
    }

    // Validate text content
    const hasAlphaNum = /[\p{L}\p{N}]/u.test(selectedText);
    const onlyPunctOrSymbols = /^[\p{P}\p{S}\s]+$/u.test(selectedText);
    const notSingleCharRepeat = !/^(.)\1*$/.test(selectedText.trim());

    return hasAlphaNum && !onlyPunctOrSymbols && notSingleCharRepeat;
}

/**
 * Find the Gemini input box
 */
function findGeminiInputBox(): Element | null {
    for (const selector of INPUT_BOX_SELECTORS) {
        const elem = document.querySelector(selector);
        if (elem && (elem as HTMLElement).offsetParent !== null && 
            (elem as HTMLElement).offsetHeight > 0 && (elem as HTMLElement).offsetWidth > 0) {
            const rect = (elem as HTMLElement).getBoundingClientRect();
            if (rect.top > window.innerHeight / 2) {
                return elem;
            }
        }
    }
    return null;
}

/**
 * Check if an element is a chat input box
 */
function isChatInputBox(element: EventTarget | null): element is InputElement {
    if (!element || !(element instanceof Element)) return false;

    const hostname = window.location.hostname;
    if (hostname.includes('gemini.google.com')) {
        const geminiSelectors = [
            '#prompt-textarea',
            'textarea[aria-label*="Message" i]',
            'textarea[aria-label*="Prompt" i]',
            'textarea[placeholder*="Message" i]',
            'textarea[data-testid*="chat-input" i]',
            'div[role="textbox"][aria-label*="Send a message" i]',
            'div[role="textbox"][aria-label*="Prompt" i]'
        ].join(',');
        return element.matches?.(geminiSelectors) ||
               !!element.closest?.(geminiSelectors);
    }

    const fallbackSelectors = 'div[contenteditable="true"], textarea, input[type="text"]';
    return element.matches?.(fallbackSelectors) || !!element.closest?.(fallbackSelectors);
}

/**
 * Get text content from an input element
 */
function getInputText(element: InputElement): string {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
        return (element as HTMLTextAreaElement | HTMLInputElement).value || '';
    } else if (element.hasAttribute?.('contenteditable')) {
        return (element as HTMLElement).innerText || element.textContent || '';
    }
    return '';
}

/**
 * Get cursor position in an input element
 */
function getCursorPosition(element: InputElement): number {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
        return (element as HTMLTextAreaElement | HTMLInputElement).selectionStart || 0;
    } else if (element.hasAttribute?.('contenteditable')) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            try {
                const range = sel.getRangeAt(0);
                const preCaretRange = range.cloneRange();
                preCaretRange.selectNodeContents(element);
                preCaretRange.setEnd(range.startContainer, range.startOffset);
                return preCaretRange.toString().length;
            } catch { return 0; }
        }
    }
    return 0;
}

/**
 * Set text content of an input element
 */
function setInputText(element: InputElement, text: string): void {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
        (element as HTMLTextAreaElement | HTMLInputElement).value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (element.hasAttribute?.('contenteditable')) {
        const htmlElement = element as HTMLElement;
        
        // Focus the element first
        htmlElement.focus();
        
        // Select all existing content
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(htmlElement);
        selection?.removeAllRanges();
        selection?.addRange(range);
        
        // Use execCommand to insert text (works better with contenteditable)
        // This properly handles the undo stack and framework bindings
        const success = document.execCommand('insertText', false, text);
        
        if (!success) {
            // Fallback: use textContent (simpler than innerHTML manipulation)
            htmlElement.textContent = text;
        }
        
        // Dispatch input event for any framework listeners
        element.dispatchEvent(new InputEvent('input', { 
            bubbles: true, 
            cancelable: true,
            inputType: 'insertText',
            data: text
        }));
    }
}

/**
 * Set cursor position in an input element
 */
function setCursorPosition(element: InputElement, position: number): void {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'input') {
        (element as HTMLTextAreaElement | HTMLInputElement).setSelectionRange(position, position);
    } else if (element.hasAttribute?.('contenteditable')) {
        const range = document.createRange();
        const sel = window.getSelection();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

        let currentPos = 0;
        let textNode = walker.nextNode();

        while (textNode && currentPos + (textNode.textContent?.length || 0) < position) {
            currentPos += textNode.textContent?.length || 0;
            textNode = walker.nextNode();
        }

        if (textNode) {
            range.setStart(textNode, position - currentPos);
            range.setEnd(textNode, position - currentPos);
            sel?.removeAllRanges();
            sel?.addRange(range);
        } else {
            range.selectNodeContents(element);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }
}

/**
 * Get caret coordinates in a textarea or contenteditable element
 */
function getCaretCoordinates(element: InputElement, caretPos: number): { left: number; top: number; bottom: number } | null {
    if (!element) return null;

    const rect = element.getBoundingClientRect();
    let left = rect.left, top = rect.top, bottom = rect.bottom;
    const tagName = element.tagName?.toLowerCase();

    // For textarea/input
    if (tagName === 'textarea' || tagName === 'input') {
        const inputEl = element as HTMLTextAreaElement | HTMLInputElement;
        const mirror = document.createElement('div');
        const computed = getComputedStyle(element);

        const styleProps = [
            'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
            'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
            'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent',
            'letterSpacing', 'wordSpacing'
        ] as const;

        styleProps.forEach(prop => {
            const cssPropertyName = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
            const value = computed.getPropertyValue(cssPropertyName);
            if (value) {
                mirror.style.setProperty(cssPropertyName, value);
            }
        });

        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.whiteSpace = 'pre-wrap';
        mirror.style.wordWrap = 'break-word';
        mirror.style.left = '-9999px';
        mirror.style.top = '0px';
        mirror.textContent = inputEl.value.substring(0, caretPos ?? inputEl.selectionStart);

        const marker = document.createElement('span');
        marker.textContent = '\u200b';
        mirror.appendChild(marker);
        document.body.appendChild(mirror);

        const markerRect = marker.getBoundingClientRect();
        const mirrorRect = mirror.getBoundingClientRect();

        left = mirrorRect.left + markerRect.left - mirrorRect.left - element.scrollLeft + window.scrollX;
        top = mirrorRect.top + markerRect.top - mirrorRect.top - element.scrollTop + window.scrollY;
        bottom = top + markerRect.height;

        document.body.removeChild(mirror);
        return { left, top, bottom };
    }

    // For contenteditable
    if (element.hasAttribute?.('contenteditable')) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0).cloneRange();
            const rects = range.getClientRects();
            if (rects.length > 0) {
                const r = rects[0];
                return { left: r.left + window.scrollX, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
            }
        }
    }

    return { left, top, bottom };
}

// ============================================================================
// STORAGE & INITIALIZATION
// ============================================================================

/**
 * Load feature states from storage
 */
async function loadFeatureStates(): Promise<void> {
    try {
        const result = await browserAPI.storage.sync.get(['followUpEnabled', 'slashCommandsEnabled']);
        
        enhancerState.set('features.followUpEnabled', result.followUpEnabled !== false);
        enhancerState.set('features.slashCommandsEnabled', result.slashCommandsEnabled !== false);
        
        console.log('Feature states loaded');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Extension context invalidated')) {
            console.error('Error loading feature states:', error);
        }
    }
}

/**
 * Load slash commands from storage
 */
async function loadSlashCommands(): Promise<void> {
    try {
        const result = await browserAPI.storage.sync.get(['slashCommands']);
        slashCommands = result.slashCommands || {};

        if (Object.keys(slashCommands).length === 0) {
            await browserAPI.storage.sync.set({ slashCommands: DEFAULT_SLASH_COMMANDS });
            slashCommands = DEFAULT_SLASH_COMMANDS;
            console.log('Initialized with default slash commands');
        }

        enhancerState.set('slashCommands.commands', slashCommands);
        console.log('Loaded slash commands:', Object.keys(slashCommands).length);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (!errorMessage.includes('Extension context invalidated')) {
            console.error('Error loading slash commands:', error);
        }
    }
}

// ============================================================================
// WIDE MODE
// ============================================================================

/**
 * Apply or remove wide mode styles
 */
function applyWideMode(enabled: boolean, width: number): void {
    const styleId = 'gemini-enhancer-wide-mode';
    let styleEl = document.getElementById(styleId);

    if (!enabled) {
        if (styleEl) styleEl.remove();
        return;
    }

    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }

    styleEl.textContent = `
        .conversation-container, 
        .input-area-container,
        main > div > div,
        [role="main"] > div > div,
        user-query,
        .user-query-bubble-with-background {
            max-width: ${width}px !important;
        }
        .input-area-container {
            max-width: ${width}px !important;
            width: 100% !important;
        }
    `;
}

// ============================================================================
// FOLLOW-UP TOOLBAR
// ============================================================================

/**
 * Create the follow-up toolbar for selected text
 */
function createFollowUpButton(text: string): void {
    if (!eventCoordinator.canActivateFeature('follow-up')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'followUpButtonContainer';
    toolbar.className = 'gemini-enhancer-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Follow-up actions');
    toolbar.dataset.originalText = text;

    enhancerState.set('followUp.button', toolbar);

    // Create action buttons
    TOOLBAR_ACTIONS.forEach(action => {
        const button = document.createElement('button');
        button.className = 'gemini-enhancer-toolbar-btn';
        button.innerHTML = `${action.icon}<span>${action.label}</span>`;
        button.setAttribute('aria-label', action.label);

        button.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            handleToolbarAction(action, text);
        };

        toolbar.appendChild(button);
    });

    // Add divider and copy button
    const divider = document.createElement('div');
    divider.className = 'gemini-enhancer-toolbar-divider';
    toolbar.appendChild(divider);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'gemini-enhancer-toolbar-btn';
    copyBtn.innerHTML = TOOLBAR_ICONS.copy;
    copyBtn.setAttribute('data-tooltip', 'Copy');
    copyBtn.setAttribute('aria-label', 'Copy to clipboard');
    copyBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.innerHTML = TOOLBAR_ICONS.check;
            copyBtn.style.color = '#34a853';
            setTimeout(() => removeFollowUpButton(), 600);
        });
    };
    toolbar.appendChild(copyBtn);

    // Position and add to DOM
    toolbar.style.position = 'absolute';
    toolbar.style.zIndex = '10001';
    document.body.appendChild(toolbar);

    positionToolbar(toolbar);

    // Add hover tracking
    toolbar.addEventListener('mouseenter', () => {
        enhancerState.set('followUp.isHoveringButton', true);
        const timeout = enhancerState.get<ReturnType<typeof setTimeout> | null>('followUp.stabilityTimeout');
        if (timeout) {
            clearTimeout(timeout);
            enhancerState.set('followUp.stabilityTimeout', null);
        }
    });

    toolbar.addEventListener('mouseleave', () => {
        enhancerState.set('followUp.isHoveringButton', false);
    });

    eventCoordinator.activateFeature('follow-up', { text });

    // Animate in
    requestAnimationFrame(() => {
        toolbar.classList.add('show');
    });

    // Setup scroll/resize listeners
    const reposition = () => {
        if (isRepositionScheduled) return;
        isRepositionScheduled = true;
        requestAnimationFrame(() => {
            isRepositionScheduled = false;
            updateButtonPosition();
        });
    };
    
    window.addEventListener('scroll', reposition, { passive: true });
    document.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    
    enhancerState.addCleanup(() => {
        window.removeEventListener('scroll', reposition);
        document.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
    });
}

/**
 * Normalize text by collapsing multiple consecutive newlines and trimming whitespace
 */
function normalizeText(text: string): string {
    return text
        // Normalize line endings to \n
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove zero-width characters that might be copied from web content
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        // Collapse multiple spaces/tabs into single space
        .replace(/[ \t]+/g, ' ')
        // Remove spaces at the beginning and end of each line
        .replace(/^ +| +$/gm, '')
        // Collapse multiple consecutive newlines (including those with only whitespace) into single newlines
        .replace(/\n\s*\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        // Remove leading/trailing newlines specifically (trim only handles whitespace)
        .replace(/^\n+|\n+$/g, '')
        // Trim any remaining leading/trailing whitespace
        .trim();
}

/**
 * Handle toolbar action button click
 */
function handleToolbarAction(action: ToolbarAction, originalText: string): void {
    const currentSelection = window.getSelection();
    const currentText = currentSelection?.toString().trim();

    let textToUse = originalText;
    if (currentText && isSelectionFromAIResponse(currentSelection)) {
        textToUse = currentText;
    }

    // Normalize the text to remove extra newlines
    textToUse = normalizeText(textToUse);

    const promptText = action.prompt.replace('{text}', textToUse);

    setTimeout(() => {
        const inputBox = findGeminiInputBox() as InputElement | null;
        if (inputBox) {
            const isTextInput = inputBox instanceof HTMLTextAreaElement || inputBox instanceof HTMLInputElement;
            if (isTextInput) {
                const inputEl = inputBox as HTMLTextAreaElement | HTMLInputElement;
                if (typeof inputEl.setRangeText === 'function') {
                    const endPos = inputEl.value.length;
                    inputEl.setRangeText(promptText, 0, endPos, 'end');
                } else {
                    inputEl.value = promptText;
                    inputEl.setSelectionRange(promptText.length, promptText.length);
                }
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                setInputText(inputBox, promptText);
                // Keep the caret at the end before focus to avoid IME disruption.
                setCursorPosition(inputBox, promptText.length);
            }

            const focusTarget = inputBox as HTMLElement;
            if (typeof focusTarget.focus === 'function') {
                try {
                    focusTarget.focus({ preventScroll: true });
                } catch {
                    focusTarget.focus();
                }
            }

            enhancerState.emit('promptGenerated', { action: action.id, text: textToUse, prompt: promptText });
        }
        removeFollowUpButton();
    }, 80);
}

/**
 * Position the toolbar near the selection
 */
function positionToolbar(toolbar: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const rect = getSelectionBoundingRect(range);

        if (rect && rect.width > 0 && rect.height > 0) {
        const toolbarWidth = toolbar.offsetWidth || 280;
        const toolbarHeight = toolbar.offsetHeight || 40;
            const gap = 6;

            let buttonTop = rect.top - toolbarHeight - gap;
            let buttonLeft = rect.left + (rect.width / 2) - (toolbarWidth / 2);

            buttonLeft = Math.max(8, Math.min(buttonLeft, window.innerWidth - toolbarWidth - 8));

            if (buttonTop < 8) {
                buttonTop = rect.bottom + gap;
                if (buttonTop + toolbarHeight > window.innerHeight - 8) {
                    buttonTop = 8;
                }
            }

            const finalLeft = buttonLeft + window.scrollX;
            const finalTop = buttonTop + window.scrollY;

        toolbar.style.left = `${Math.max(0, finalLeft)}px`;
        toolbar.style.top = `${Math.max(0, finalTop)}px`;
    }
}

/**
 * Update the toolbar position based on current selection
 */
function updateButtonPosition(): void {
    const toolbar = enhancerState.get<HTMLElement | null>('followUp.button');
    if (!toolbar || !toolbar.parentNode) return;

    positionToolbar(toolbar);
}

/**
 * Remove the follow-up toolbar
 */
function removeFollowUpButton(): void {
    const toolbar = enhancerState.get<HTMLElement | null>('followUp.button');

    if (toolbar) {
        const stabilityTimeout = enhancerState.get<ReturnType<typeof setTimeout> | null>('followUp.stabilityTimeout');
        if (stabilityTimeout) {
            clearTimeout(stabilityTimeout);
            enhancerState.set('followUp.stabilityTimeout', null);
        }

        toolbar.style.pointerEvents = 'none';
        toolbar.classList.remove('show');
        toolbar.style.transition = 'opacity 0.15s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.15s cubic-bezier(0.4, 0.0, 0.2, 1)';
        toolbar.style.opacity = '0';
        toolbar.style.transform = 'translateY(8px) scale(0.9)';

        setTimeout(() => {
            const currentButton = enhancerState.get<HTMLElement | null>('followUp.button');
            if (currentButton) {
                currentButton.remove();
                enhancerState.set('followUp.button', null);
            }
        }, ANIMATION_DURATION_MS);

        eventCoordinator.deactivateFeature('follow-up');
    }

    enhancerState.set('followUp.selectedText', '');
    enhancerState.set('followUp.isHoveringButton', false);
}

// ============================================================================
// SLASH COMMANDS
// ============================================================================

/**
 * Show the slash command autocomplete dropdown
 */
function showCommandAutocomplete(inputElement: HTMLElement, partial: string, slashIndex: number): void {
    lastInputBox = inputElement;
    enhancerState.set('slashCommands.lastInputBox', inputElement);

    const matchingCommands = Object.keys(slashCommands).filter(cmd =>
        cmd.toLowerCase().startsWith(partial)
    );

    if (matchingCommands.length === 0) {
        hideCommandAutocomplete();
        return;
    }

    // Verify slash command still exists
    const currentText = getInputText(inputElement);
    const currentCursorPos = getCursorPosition(inputElement);
    const currentBeforeCursor = currentText.substring(0, currentCursorPos);
    if (!currentBeforeCursor.match(/\/(\w*)$/)) {
        hideCommandAutocomplete();
        return;
    }

    // Create dropdown if needed
    if (!commandAutocomplete) {
        commandAutocomplete = document.createElement('div');
        commandAutocomplete.id = 'slashCommandAutocomplete';
        commandAutocomplete.setAttribute('role', 'listbox');
        commandAutocomplete.setAttribute('aria-label', 'Slash command suggestions');
        commandAutocomplete.setAttribute('aria-expanded', 'false');
        commandAutocomplete.setAttribute('aria-live', 'polite');
        document.body.appendChild(commandAutocomplete);
        enhancerState.set('slashCommands.autocomplete', commandAutocomplete);
    }

    // Populate dropdown
    const selectedText = window.getSelection()?.toString().trim() || '[selected text]';
    
    commandAutocomplete.innerHTML = matchingCommands.map((cmd, index) => {
        const commandPrompt = slashCommands[cmd] || '';
        const fullPreview = commandPrompt.replace('{text}', selectedText);
        const truncatedPreview = fullPreview.length > 80 ? fullPreview.substring(0, 80) + '...' : fullPreview;
        const iconLetter = cmd[0]?.toUpperCase() || '•';
        
        return `
            <div id="ge-ac-item-${index}" class="autocomplete-item ${index === 0 ? 'selected' : ''}" 
                 role="option" aria-selected="${index === 0}" data-command="${cmd}">
                <div class="ac-row">
                    <div class="ac-icon">${iconLetter}</div>
                    <div class="ac-content">
                        <div class="ac-title">/${cmd}</div>
                        <div class="ac-sub">${truncatedPreview}</div>
        </div>
                </div>
        </div>
    `;
    }).join('');

    // Add event listeners
    commandAutocomplete.querySelectorAll('.autocomplete-item').forEach((item, index) => {
        const element = item as HTMLElement;
        
        element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectCommand(element.dataset.command!);
        }, { capture: true });

        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectCommand(element.dataset.command!);
        }, { capture: true });

        element.addEventListener('mouseenter', () => {
            const items = commandAutocomplete!.querySelectorAll('.autocomplete-item');
            updateSelection(items, index);
        });
    });

    // Position and show
    positionAutocomplete(inputElement);
    commandAutocomplete.style.display = 'block';
    commandAutocomplete.setAttribute('aria-expanded', 'true');
    
    setTimeout(() => {
        if (commandAutocomplete) {
            commandAutocomplete.style.opacity = '1';
            commandAutocomplete.style.transform = 'translateY(0) scale(1)';
        }
    }, 0);

    eventCoordinator.activateFeature('slash-commands', { partial, commands: matchingCommands });
}

/**
 * Position the autocomplete dropdown
 */
function positionAutocomplete(inputElement: HTMLElement): void {
    if (!commandAutocomplete) return;
    
    const style = commandAutocomplete.style;
    const dropdownHeight = commandAutocomplete.offsetHeight || 280;
    const cursorPos = getCursorPosition(inputElement);
    const caretCoords = getCaretCoordinates(inputElement, cursorPos);

    if (caretCoords) {
        const targetTop = caretCoords.top - dropdownHeight - 8;
        style.left = `${caretCoords.left}px`;
        style.top = `${targetTop}px`;

        if (targetTop < window.scrollY + 20) {
            style.top = `${caretCoords.bottom + 2}px`;
        }

        const dropdownWidth = 420;
        if (caretCoords.left + dropdownWidth > window.innerWidth) {
            style.left = `${window.innerWidth - dropdownWidth - 10}px`;
        }

        style.width = `${dropdownWidth}px`;
        style.minWidth = '360px';
        style.maxWidth = '480px';
    } else {
        const rect = inputElement.getBoundingClientRect();
        style.left = `${window.scrollX + rect.left}px`;
        style.top = `${window.scrollY + rect.top - dropdownHeight - 8}px`;
        style.width = '420px';
    }
}

/**
 * Update selected item in autocomplete dropdown
 */
function updateSelection(items: NodeListOf<Element>, selectedIndex: number): void {
    items.forEach((item, index) => {
        const isSelected = index === selectedIndex;
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        if (isSelected && item.id && commandAutocomplete) {
            commandAutocomplete.setAttribute('aria-activedescendant', item.id);
        }
    });
}

/**
 * Select a slash command
 */
function selectCommand(commandName: string): void {
    if (!lastInputBox || !slashCommands[commandName]) {
        hideCommandAutocomplete();
        return;
    }

    const text = getInputText(lastInputBox);
    const cursorPos = getCursorPosition(lastInputBox);
    const beforeCursor = text.substring(0, cursorPos);
    const slashMatch = beforeCursor.match(/\/(\w*)$/);

    if (slashMatch) {
        const commandPrompt = slashCommands[commandName];
        const selectedText = window.getSelection()?.toString().trim() || '';
        const finalPrompt = commandPrompt.replace(/\{text\}/g, selectedText);
        const newText = text.substring(0, slashMatch.index) + finalPrompt + text.substring(cursorPos);

        setInputText(lastInputBox, newText);
        setCursorPosition(lastInputBox, slashMatch.index! + finalPrompt.length);
    }

    hideCommandAutocomplete();
}

/**
 * Hide the autocomplete dropdown
 */
function hideCommandAutocomplete(): void {
    if (commandAutocomplete) {
        eventCoordinator.deactivateFeature('slash-commands');

        commandAutocomplete.style.opacity = '0';
        commandAutocomplete.style.transform = 'translateY(8px) scale(0.95)';
        
        setTimeout(() => {
            if (commandAutocomplete) {
                commandAutocomplete.style.display = 'none';
                commandAutocomplete.innerHTML = '';
                commandAutocomplete.setAttribute('aria-expanded', 'false');
                commandAutocomplete.setAttribute('aria-activedescendant', '');
            }
        }, ANIMATION_DURATION_MS);
    }
}

/**
 * Scroll autocomplete item into view if needed
 */
function scrollIntoViewIfNeeded(element: Element | null): void {
    if (!element || !commandAutocomplete) return;

    const container = commandAutocomplete;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    if (elementRect.top < containerRect.top || elementRect.bottom > containerRect.bottom) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle text selection events
 */
function handleTextSelection(event: Event): void {
    if (!enhancerState.get<boolean>('features.followUpEnabled') || isExcludedPath()) {
        const existing = enhancerState.get<HTMLElement | null>('followUp.button');
        if (existing) removeFollowUpButton();
        return;
    }

    if (selectionTimeout) clearTimeout(selectionTimeout);

    selectionTimeout = setTimeout(() => {
        try {
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim() || '';
            const toolbar = enhancerState.get<HTMLElement | null>('followUp.button');

            // Ignore clicks on the toolbar itself
            if (toolbar && event.target instanceof Node && (toolbar.contains(event.target) || toolbar === event.target)) {
                return;
            }

            const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(selectedText);
            const meetsMinLen = selectedText && (hasCJK ? selectedText.length >= 1 : selectedText.length >= 2);

            if (meetsMinLen && selection) {
                if (!isSelectionFromAIResponse(selection)) {
                    if (toolbar) removeFollowUpButton();
                    return;
                }

                if (toolbar && toolbar.parentNode) {
                    enhancerState.set('followUp.selectedText', selectedText);
                    updateButtonPosition();
                    return;
                }

                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const rect = getSelectionBoundingRect(range);

                    if (rect && rect.width > 0 && rect.height > 0 && rect.top > -50 && rect.left > -50) {
                        enhancerState.set('followUp.selectedText', selectedText);
                        createFollowUpButton(selectedText);
                    }
                }
            } else {
                if (toolbar && toolbar.parentNode && !enhancerState.get<boolean>('followUp.isHoveringButton')) {
                    removeFollowUpButton();
                }
            }
        } catch (error) {
            console.error('Error in handleTextSelection:', error);
        }
    }, SELECTION_DEBOUNCE_MS);
}

/**
 * Handle mouse down events
 */
function handleMouseDown(event: MouseEvent): void {
    const toolbar = enhancerState.get<HTMLElement | null>('followUp.button');

    if (toolbar?.contains(event.target as Node)) return;

    if (toolbar) {
        const buttonRect = toolbar.getBoundingClientRect();
        const distance = Math.sqrt(
            Math.pow(event.clientX - (buttonRect.left + buttonRect.width / 2), 2) +
            Math.pow(event.clientY - (buttonRect.top + buttonRect.height / 2), 2)
        );

        if (distance > 100) {
            const stabilityTimeout = enhancerState.get<ReturnType<typeof setTimeout> | null>('followUp.stabilityTimeout');
            if (stabilityTimeout) {
                clearTimeout(stabilityTimeout);
                enhancerState.set('followUp.stabilityTimeout', null);
            }
            removeFollowUpButton();
            enhancerState.set('followUp.selectedText', '');
        }
    }
}

/**
 * Handle selection change events
 */
function handleSelectionChange(): void {
    const syntheticEvent = new CustomEvent('selectionchange');
    handleTextSelection(syntheticEvent);
}

/**
 * Handle keyboard selection (Shift+arrows, etc.)
 */
function handleKeyboardSelection(event: KeyboardEvent): void {
    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'a'];
    const modifierKeys = event.shiftKey || event.ctrlKey || event.metaKey;

    if (selectionKeys.includes(event.key) && modifierKeys) {
        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim() || '';
            const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(selectedText);

            if (selectedText && (hasCJK ? selectedText.length >= 1 : selectedText.length >= 2)) {
                const syntheticEvent = new CustomEvent('keyboardselection');
                handleTextSelection(syntheticEvent);
            }
        }, 20);
    }
}

/**
 * Handle scroll events to keep toolbar in sync
 */
function handleAnyScroll(): void {
    const btn = enhancerState.get<HTMLElement | null>('followUp.button');
    if (!btn || isRepositionScheduled) return;

    isRepositionScheduled = true;
    requestAnimationFrame(() => {
        isRepositionScheduled = false;
        updateButtonPosition();
    });
}

/**
 * Handle input changes for slash commands
 */
function handleInputChange(event: Event): void {
    const target = event.target as HTMLElement;

    if (!enhancerState.get<boolean>('features.slashCommandsEnabled')) {
        if (commandAutocomplete?.style.display !== 'none') {
            hideCommandAutocomplete();
        }
        return;
    }

    if (isChatInputBox(target)) {
        lastInputBox = target;
        enhancerState.set('slashCommands.lastInputBox', target);
        
        const text = getInputText(target);
        const cursorPos = getCursorPosition(target);
        const beforeCursor = text.substring(0, cursorPos);
        const slashMatch = beforeCursor.match(/\/(\w*)$/);

        if (slashMatch) {
            showCommandAutocomplete(target, slashMatch[1].toLowerCase(), slashMatch.index!);
        } else {
            hideCommandAutocomplete();
        }
    } else if (commandAutocomplete?.style.display !== 'none') {
            hideCommandAutocomplete();
    }
}

/**
 * Handle keydown events
 */
function handleKeyDown(event: KeyboardEvent): void {
    if (commandAutocomplete && commandAutocomplete.style.display !== 'none') {
        const items = commandAutocomplete.querySelectorAll('.autocomplete-item');
        let selectedIndex = Array.from(items).findIndex(item => item.classList.contains('selected'));

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                event.stopPropagation();
                selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                updateSelection(items, selectedIndex);
                scrollIntoViewIfNeeded(items[selectedIndex]);
                break;

            case 'ArrowUp':
                event.preventDefault();
                event.stopPropagation();
                selectedIndex = Math.max(selectedIndex - 1, 0);
                updateSelection(items, selectedIndex);
                scrollIntoViewIfNeeded(items[selectedIndex]);
                break;

            case 'Enter':
            case 'Tab':
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (selectedIndex >= 0 && items[selectedIndex]) {
                    selectCommand((items[selectedIndex] as HTMLElement).dataset.command!);
                }
                return;

            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                hideCommandAutocomplete();
                break;
        }
    }
}

/**
 * Handle keyup events
 */
function handleKeyUp(event: KeyboardEvent): void {
    const target = event.target;
    if (target && isChatInputBox(target)) {
        const inputTarget = target as InputElement;
        setTimeout(() => {
            const text = getInputText(inputTarget);
            const cursorPos = getCursorPosition(inputTarget);
            const beforeCursor = text.substring(0, cursorPos);

            if (!beforeCursor.match(/\/(\w*)$/) && commandAutocomplete && commandAutocomplete.style.display !== 'none') {
                hideCommandAutocomplete();
            }
        }, 0);
    }
}

/**
 * Handle focus out events
 */
function handleFocusOut(event: FocusEvent): void {
    if (commandAutocomplete && commandAutocomplete.style.display !== 'none') {
        if (!event.relatedTarget || !commandAutocomplete.contains(event.relatedTarget as Node)) {
            setTimeout(() => {
                if (commandAutocomplete && commandAutocomplete.style.display !== 'none') {
                    hideCommandAutocomplete();
                }
            }, 200);
        }
    }
}

/**
 * Handle document click events
 */
function handleDocumentClick(event: MouseEvent): void {
    if (commandAutocomplete && commandAutocomplete.style.display !== 'none') {
        if (commandAutocomplete.contains(event.target as Node)) return;
        if (!isChatInputBox(event.target)) {
            hideCommandAutocomplete();
        }
    }
}

/**
 * Handle form submit events (placeholder)
 */
function handleFormSubmit(_event: Event): void {
    // Placeholder for potential future form submit handling
}

// ============================================================================
// EVENT LISTENER SETUP
// ============================================================================

/**
 * Initialize all event listeners
 */
function initializeEventListeners(): void {
    const events: Array<{ type: string; handler: EventListener; options?: AddEventListenerOptions | boolean }> = [
        { type: 'mouseup', handler: handleTextSelection as EventListener, options: { passive: true } },
        { type: 'mousedown', handler: handleMouseDown as EventListener, options: { passive: true } },
        { type: 'selectionchange', handler: handleSelectionChange as EventListener, options: { passive: true } },
        { type: 'touchend', handler: handleTextSelection as EventListener, options: { passive: true } },
        { type: 'keyup', handler: handleKeyboardSelection as EventListener, options: { passive: true } },
        { type: 'keyup', handler: handleKeyUp as EventListener, options: { capture: true, passive: true } },
        { type: 'scroll', handler: handleAnyScroll as EventListener, options: { capture: true, passive: true } },
        { type: 'wheel', handler: handleAnyScroll as EventListener, options: { capture: true, passive: true } },
        { type: 'touchmove', handler: handleAnyScroll as EventListener, options: { capture: true, passive: true } },
        { type: 'input', handler: handleInputChange as EventListener, options: { capture: true, passive: true } },
        { type: 'keydown', handler: handleKeyDown as EventListener, options: { capture: true, passive: false } },
        { type: 'click', handler: handleDocumentClick as EventListener, options: { capture: true, passive: true } },
        { type: 'submit', handler: handleFormSubmit as EventListener, options: { capture: true, passive: true } },
        { type: 'focusout', handler: handleFocusOut as EventListener, options: { passive: true } }
    ];

    events.forEach(({ type, handler, options }) => {
        document.addEventListener(type, handler, options);
        enhancerState.addCleanup(() => document.removeEventListener(type, handler, options));
    });

    // Viewport change handlers
    const onViewportChange = () => {
        try {
            if (commandAutocomplete?.style.display === 'block' && enhancerState.get<HTMLElement | null>('slashCommands.lastInputBox')) {
                positionAutocomplete(enhancerState.get<HTMLElement>('slashCommands.lastInputBox'));
            }
            updateButtonPosition();
        } catch { /* noop */ }
    };

    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, { passive: true } as AddEventListenerOptions);
    
    enhancerState.addCleanup(() => {
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange);
    });

    console.log('Event listeners initialized');
}

// ============================================================================
// MESSAGE HANDLERS
// ============================================================================

/**
 * Handle messages from the popup
 */
browserAPI.runtime.onMessage.addListener((message: PopupMessage) => {
    if (message.type === 'UPDATE_WIDE_MODE') {
        applyWideMode(message.enabled, message.width);
    }

    if (message.type === 'UPDATE_FOLLOW_UP') {
        enhancerState.set('features.followUpEnabled', message.enabled);
        if (!message.enabled) removeFollowUpButton();
    }

    if (message.type === 'UPDATE_SLASH_COMMANDS') {
        enhancerState.set('features.slashCommandsEnabled', message.enabled);
        if (!message.enabled) hideCommandAutocomplete();
    }
});

/**
 * Handle storage changes
 */
browserAPI.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, namespace: string) => {
    if (namespace === 'sync') {
        if (changes.slashCommands) {
            slashCommands = (changes.slashCommands.newValue as Record<string, string>) || {};
        }

        if (changes.followUpEnabled !== undefined) {
            const enabled = changes.followUpEnabled.newValue !== false;
            enhancerState.set('features.followUpEnabled', enabled);
            if (!enabled) removeFollowUpButton();
        }

        if (changes.slashCommandsEnabled !== undefined) {
            const enabled = changes.slashCommandsEnabled.newValue !== false;
            enhancerState.set('features.slashCommandsEnabled', enabled);
            if (!enabled) hideCommandAutocomplete();
        }
    }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load initial state
loadFeatureStates();
loadSlashCommands();

// Initialize wide mode
browserAPI.storage.sync.get(['wideMode', 'wideModeWidth'], (result: StorageData) => {
    if (result.wideMode) {
        applyWideMode(true, result.wideModeWidth || DEFAULT_WIDE_MODE_WIDTH);
    }
});

// Initialize event listeners
initializeEventListeners();

console.log('Gemini Enhancer initialized successfully');

})();
