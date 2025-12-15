export {};

declare global {
  interface Window {
    __GEMINI_ENHANCER_ACTIVE__?: boolean;
  }

  // Firefox-style WebExtensions API - compatible subset with Chrome API
  const browser: typeof chrome | undefined;

  /** Storage data interface for Chrome storage API */
  interface StorageData {
    followUpEnabled?: boolean;
    slashCommandsEnabled?: boolean;
    slashCommands?: Record<string, string>;
    wideMode?: boolean;
    wideModeWidth?: number;
  }

  /** Message types from popup */
  interface UpdateWideModeMessage {
    type: 'UPDATE_WIDE_MODE';
    enabled: boolean;
    width: number;
  }

  interface UpdateFollowUpMessage {
    type: 'UPDATE_FOLLOW_UP';
    enabled: boolean;
  }

  interface UpdateSlashCommandsMessage {
    type: 'UPDATE_SLASH_COMMANDS';
    enabled: boolean;
  }

  type PopupMessage = UpdateWideModeMessage | UpdateFollowUpMessage | UpdateSlashCommandsMessage;
}

