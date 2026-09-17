/**
 * Shared types for Snowball Control Host & Device communication
 */

export interface MachineInfo {
  id: string;
  name: string;
  isOnline: boolean;
}

export interface HarnessInfo {
  id: "codex" | "antigravity" | "opencode";
  name: string;
  isEnabled: boolean;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  createdAt: number;
  preview: string;
}

export interface TurnBlock {
  role: "user" | "assistant" | "system" | "thought";
  text: string;
}

export interface TurnInfo {
  id: string;
  index: number;
  blocks: TurnBlock[];
}

export interface QuestionOption {
  id: string;
  label: string; // Spans up to 5 keys
  isSelected: boolean;
}

export interface QuestionCard {
  id: string;
  prompt: string;
  isMultiSelect: boolean;
  options: QuestionOption[];
  hasOther: boolean;
  isPermission: boolean;
}

export type ViewMode = 
  | "session"    // Default session surface (conversation reader + action keys)
  | "editor"     // Active editing choice picker on Row 3 (Project/Session/Model/Effort/Access)
  | "workspace"  // Fullscreen modal: 15-item file/directory grid
  | "settings"   // Fullscreen modal: Settings categories and toggles
  | "question"   // Spanning question rows + fixed action bar
  | "changes";   // Split diff modal: Col 0 changed files list, (2,2)-(5,4) 12-key diff text view

export type ActiveEditorField = "none" | "harness" | "machine" | "project" | "session" | "model" | "effort" | "access";

export interface KeyVisual {
  keyId: number; // K1..K20 (1-indexed)
  labelTop: string;
  labelMain: string;
  labelSub?: string;
  isFilled: boolean;      // Committed value highlight
  isEditing: boolean;     // Amber border + "Editing" tag (Revision 5)
  isFocused: boolean;     // Cursor focus
  isDisabled?: boolean;
  items?: string[];       // Multi-item list for Pattern 3 or Multi-line text for Lines mode
  itemColors?: number[];  // Syntax colors for lines mode
  activeItem?: number;
  scrollTotal?: number;
  isLinesMode?: boolean;  // Enables dense multi-line rendering on key
}

export interface V2DeviceState {
  viewMode: ViewMode;
  activeEditor: ActiveEditorField;
  
  // Context values
  machine: string;
  harness: string;
  project: string;
  session: string;
  
  // Configuration values
  model: string;
  effort: string;
  access: string;
  
  // Audio state
  volume: number; // 0..100
  isMuted: boolean;
  isSpeaking: boolean;
  
  // Reader state
  topTitle: string;
  topSubtitle: string;
  topBodyLines: string[];
  topScrollLine: number;
  topTotalLines: number;

  // Active question if any
  question?: QuestionCard;

  // 20 Key visuals
  keys: KeyVisual[];
}
