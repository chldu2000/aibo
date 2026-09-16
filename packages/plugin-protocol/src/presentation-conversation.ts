type AgentName = 'codex' | 'pi';

type InteractionMode = 'ask' | 'plan' | 'edit';

type SessionAccessMode = 'read-only' | 'plan' | 'workspace-write' | 'ask-for-approval' | 'approve-for-me' | 'full-access';

type ApprovalPolicy = 'never' | 'untrusted' | 'on-request' | 'trusted';
type ApprovalReviewer = 'user' | 'auto-review' | 'none';

type FilesystemPolicy = 'read-only' | 'workspace-write' | 'danger-full-access';

type CommandPolicy = 'disabled' | 'approved' | 'trusted';

type NetworkPolicy = 'disabled' | 'agent-managed';

interface ExecutionProfile {
  schema: 'aibo.execution-profile/v1';
  interactionMode: InteractionMode;
  approvalPolicy: ApprovalPolicy;
  approvalReviewer: ApprovalReviewer;
  filesystemPolicy: FilesystemPolicy;
  commandPolicy: CommandPolicy;
  networkPolicy: NetworkPolicy;
  model?: string | null;
  reasoningEffort?: string | null;
}

interface ResolvedExecutionProfile {
  schema: 'aibo.execution-profile/v1';
  requested: ExecutionProfile;
  enforced: ExecutionProfile;
  unsupported: string[];
  adapterCapabilities: string[];
  nativeSandbox: boolean;
  resolvedAt: string;
}

interface SessionExecutionProfile extends ResolvedExecutionProfile {
  sessionId: string;
}

type SessionState =
  | 'created'
  | 'starting'
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'compacting'
  | 'interrupted'
  | 'failed'
  | 'closed';

interface Session {
  id: string;
  workspaceId: string;
  agent: string;
  label: string;
  state: SessionState;
  archived: boolean;
  externalSessionId: string | null;
  pluginInstallationId: string | null;
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
}

interface SessionModelOption {
  reference: string;
  label: string;
  provider: string | null;
  id: string;
  description: string | null;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  reasoningEfforts: SessionReasoningOption[];
  serviceTiers: SessionServiceTierOption[];
}

interface SessionReasoningOption {
  id: string;
  label: string;
  description: string | null;
}

interface SessionServiceTierOption {
  id: string;
  label: string;
  description: string | null;
}

interface SessionModelCatalog {
  current: SessionModelOption | null;
  models: SessionModelOption[];
  currentReasoningEffort: string | null;
  reasoningEfforts: SessionReasoningOption[];
  currentServiceTier: string | null;
}

interface AgentGoal {
  objective: string;
  status: 'active' | 'paused' | 'completed' | 'cleared' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'unknown';
  tokenBudget: number | null;
  tokensUsed: number | null;
  timeUsedSeconds?: number | null;
  updatedAt: string | null;
}

interface WorkspacePathSuggestion {
  path: string;
  isDirectory: boolean;
}

type AgentCommandCategory = 'agent' | 'skill' | 'extension';

type AgentCommandExecution = 'aibo' | 'adapter' | 'prompt';

interface AgentCommand {
  id?: string;
  name: string;
  aliases?: string[];
  description: string | null;
  source: 'extension' | 'prompt' | 'skill' | string;
  category?: AgentCommandCategory;
  execution?: AgentCommandExecution;
  agent?: AgentName | 'both';
  enabled?: boolean;
  argumentHint?: string;
  capability?: string;
}

interface ContextAttachment {
  schema: 'aibo.context-attachment/v1';
  id: string;
  workspaceId: string;
  sessionId: string;
  turnId: string | null;
  path: string;
  contentHash: string | null;
  size: number | null;
  mediaType: string;
  source: 'picker' | 'drop' | 'manual' | string;
  sendStrategy: 'reference' | 'inline' | string;
  inlineContext?: string | null;
  createdAt: string;
}

interface UserInputOption {
  label: string;
  description: string | null;
}

interface UserInputQuestion {
  id: string;
  header: string | null;
  question: string;
  options: UserInputOption[];
  isOther: boolean;
}

interface UserInputRequest {
  requestId: string;
  sessionId: string;
  turnId: string | null;
  questions: UserInputQuestion[];
  isBlocking: boolean;
}

interface AgentQueueSnapshot {
  sessionId: string;
  steering: string[];
  followUp: string[];
  updatedAt: string;
}

interface PiSessionTreeNode {
  id: string;
  parentId: string | null;
  type: string;
  timestamp: string;
  role?: string;
  summary?: string;
  label?: string;
  children: PiSessionTreeNode[];
}

interface PiSessionTreeSnapshot {
  sessionId: string;
  externalSessionId: string | null;
  leafId: string | null;
  tree: PiSessionTreeNode[];
}

/** Complete host conversation data, independent of framework and native APIs. */
export type PresentationConversation = {
  workspace: { id: string; label: string; path: string; trust: string } | null;
  session: Session | null;
  goal: AgentGoal | null;
  goalBusy?: boolean;
  thread: { id: string; turnCount: number | null } | null;
  timeline: { id: string; turnId: string | null; role: string; toolName: string | null; entryType: string | null; content: string; status: string }[];
  timelineVisibleCount: number;
  /** Group ordinary system events; summaries and reasoning always remain separate. */
  groupSystemItems?: boolean;
  usage: {
    input: number | null;
    output: number | null;
    total: number | null;
    contextUsed: number | null;
    contextLimit: number | null;
    contextEstimated: boolean;
    plan?: string | null;
    limits?: { id: string; label: string | null; usedPercent: number; windowMinutes: number | null; resetsAt: number | null }[];
    credits?: { balance: string | null; unlimited: boolean } | null;
  } | null;
  retryPrompt: string | null;
  retryReason: string | null;
  userInputRequests: UserInputRequest[];
  answerDrafts: Record<string, string>;
  queue: AgentQueueSnapshot | null;
  activityLabel: string | null;
  compacting: boolean;
  running: boolean;
  archiving: boolean;
  busy: boolean;
  attachments: ContextAttachment[];
  executionProfile: SessionExecutionProfile | null;
  modelConfiguration: { currentReasoningEffort: string | null; selectedReasoningEffort: string | null; defaultAction: 'preserve' | 'reset' };
  modelCatalog: SessionModelCatalog | null;
  modelCatalogLoading: boolean;
  modelOverride: string | null;
  workspacePathSuggestions: WorkspacePathSuggestion[];
  sessionSuggestions?: Session[];
  agentCommands: AgentCommand[];
  agentCommandsLoading: boolean;
  draft: string;
  draftFailed: boolean;
  tree: PiSessionTreeSnapshot | null;
  treeOpen: boolean;
  treeNavigationStatus: string | null;
};

export type PresentationConversationOperation = 'copyCode' | 'openLink' | 'draft' | 'send' | 'stop' | 'retry' | 'queueSteer' | 'queueFollowUp' | 'clearQueue' | 'clearGoal' | 'pauseGoal' | 'resumeGoal'
  | 'addAttachments' | 'addDirectory' | 'removeAttachment' | 'selectPath' | 'selectSessionReference' | 'selectCommand'
  | 'openSubagent' | 'loadOlder' | 'fork' | 'loadModels' | 'selectModel' | 'selectServiceTier' | 'selectAccess' | 'compact'
  | 'answer' | 'chooseAnswer' | 'submitAnswers' | 'cancelAnswers'
  | 'openTree' | 'closeTree' | 'refreshTree' | 'selectTreeNode';

export type PresentationConversationAction = {
  token: string;
  operation: PresentationConversationOperation;
  event: 'click' | 'input';
  /** Fixed semantic arguments chosen by the host, not parameters supplied by package code. */
  args: readonly (string | null)[];
};
