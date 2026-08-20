# Agent Game Runtime API 与协议规范

> 规范版本：v0.3 Draft
> 规范状态：Proposed
> 兼容基线：agent/v0.2-runtime-expansion
> 最近核验：2026-08-19

## 0. 文档定位

本文定义 Runtime、Plugin、Agent、CIF、Persistence 和 Frontend 之间的公共边界。它是 v0.3 的目标规范，不表示当前代码已经实现全部接口。

状态标记：

| 标记 | 含义 |
| --- | --- |
| Current | 当前 v0.2 代码已经实现的兼容边界 |
| Target | v0.3 计划冻结的公共边界 |
| Future | v0.4 以后预留，不得作为 v0.3 依赖 |

本文不定义 Fate 设定、角色内容、具体战斗公式、具体数据库、具体 LLM Provider 或 UI 框架。

## 1. 规范关键词

- MUST：协议兼容必须满足；
- MUST NOT：明确禁止；
- SHOULD：默认应满足，例外需要说明；
- MAY：可选能力；
- system-only：只允许系统插件或组合根取得的能力。

## 2. 公共协议总流

    RawPlayerInput
          |
          v
    PlayerAction
          |
          v
    Runtime admission
          |------------------> Observation
          |                         |
          |                         v
          |                    AgentProvider
          |                         |
          |<------------------ AgentAction
          |
          v
    Command / Domain Request
          |
          v
    Validation and Settlement
          |
          v
    PendingTurnCommit
          |
          v
    GameEvent[]
          |-- Persistence
          |-- Projection
          |-- Durable Jobs
          +-- Subscribers

Action 和 AgentAction 表示意图；Command 表示规范化执行请求；GameEvent 表示已提交事实。

## 3. 通用序列化规则

### 3.1 数据格式

- 公共协议 MUST 可安全地转换为 JSON；
- MUST NOT 包含函数、class instance、Cordis Context、数据库连接或平台句柄；
- 字段使用 camelCase；稳定 ID 和枚举使用不依赖显示文案的 machine value；
- 未识别的可选字段 SHOULD 被忽略并记录诊断；
- 必填字段缺失或类型错误 MUST 被拒绝；
- 对象不得以循环引用作为公共状态。

### 3.2 基础 ID

Target：

    declare const stringIdBrand: unique symbol;
    type BrandedString<Name extends string> = string & { readonly [stringIdBrand]: Name };

    export type SessionId = BrandedString<"SessionId">;
    export type EntityId = BrandedString<"EntityId">;
    export type ActionId = BrandedString<"ActionId">;
    export type AgentActionId = BrandedString<"AgentActionId">;
    export type ObservationId = BrandedString<"ObservationId">;
    export type CommandId = BrandedString<"CommandId">;
    export type EventId = BrandedString<"EventId">;
    export type JobId = BrandedString<"JobId">;
    export type PluginId = BrandedString<"PluginId">;
    export type CapabilityId = BrandedString<"CapabilityId">;

所有 ID MUST 在约定作用域内唯一、可序列化且不得暴露数据库自增主键。UUIDv7、UUID 或 ULID 均可作为实现。

Current：v0.2 的对应字段仍是 string。v0.3 品牌类型不得改变 JSON 表示。

### 3.3 Revision 与 Sequence

    declare const numericValueBrand: unique symbol;
    type BrandedNumber<Name extends string> = number & { readonly [numericValueBrand]: Name };

    export type StateRevision = BrandedNumber<"StateRevision">;
    export type EventSequence = BrandedNumber<"EventSequence">;

- StateRevision MUST 随已提交状态单调递增；
- EventSequence MUST 在单个 Session 内单调递增；
- 失败或回滚的事务 MUST NOT 占用可见 revision 或发布事件。

## 4. 时间模型

Current：

    export interface GameMoment {
      timelineId: string;
      tick: number;
      calendar?: Record<string, string | number | boolean>;
    }

createdAt 表示系统时间；moment 表示游戏世界时间。Runtime MUST NOT 使用 createdAt 替代 GameMoment 进行世界因果判断。

Target 保持当前字段语义。calendar 是世界或内容包拥有的显示数据，Kernel 不负责推导具体历法。

## 5. PlayerAction Protocol

### 5.1 语义

PlayerAction 表示玩家希望尝试什么，不表示行为已经发生。

    PlayerAction != GameEvent

### 5.2 Current v0.2

    export interface PlayerAction {
      id: string;
      sessionId: string;
      actorId: string;
      type: "dialogue" | "action" | "combat";
      content?: string;
      targetIds?: string[];
      parameters?: Record<string, unknown>;
    }

v0.2 的三个顶层 lane MUST 在迁移期间保持兼容。

### 5.3 Target v0.3

    export interface PlayerAction {
      id: ActionId;
      sessionId: SessionId;
      actorId: EntityId;
      type: string;
      content?: string;
      targetIds?: EntityId[];
      parameters?: Record<string, unknown>;
      metadata?: {
        source?: "web" | "unity" | "godot" | "cli" | "api";
        locale?: string;
        clientRequestId?: string;
      };
    }

新 action type SHOULD 使用命名空间，例如：

- interaction.dialogue；
- world.move；
- world.observe；
- world.inspect；
- combat.action；
- story.choice。

迁移期可由兼容 adapter 将 dialogue、action、combat 映射到 namespaced command。不得在一次变更中直接删除 v0.2 lane。

### 5.4 RawPlayerInput

Current：

    export interface RawPlayerInput {
      id: string;
      sessionId: string;
      actorId: string;
      content: string;
      targetIds?: string[];
      mode: "dialogue" | "action" | "combat" | "auto";
      parameters?: Record<string, unknown>;
    }

auto MUST 经过 Interpreter。模糊输入 MUST 返回需要解释或拒绝，不得静默当作公开对话。

Target 可增加 metadata，但不得让解释模型拥有事实写权。

### 5.5 幂等

- actionId 是幂等键；
- Runtime MUST 同时校验请求指纹；
- 同一 actionId 和相同指纹 MUST 重放既有 ActionResult；
- 同一 actionId 和不同指纹 MUST 拒绝；
- 处理中重复请求 SHOULD 复用同一 in-flight 结果。

## 6. Validation 与 Error Protocol

Target：

    export type ErrorCode =
      | "action.invalid"
      | "action.id_conflict"
      | "state.revision_conflict"
      | "capability.not_found"
      | "capability.version_mismatch"
      | "plugin.dependency_cycle"
      | "plugin.permission_denied"
      | "agent.provider_not_found"
      | "persistence.commit_failed";

    export interface ValidationIssue {
      code: ErrorCode;
      field?: string;
      details?: Record<string, unknown>;
    }

    export type ValidationResult =
      | { ok: true }
      | { ok: false; issues: ValidationIssue[] };

稳定错误码 SHOULD 使用命名空间：

- action.invalid；
- action.id_conflict；
- state.revision_conflict；
- capability.not_found；
- capability.version_mismatch；
- plugin.dependency_cycle；
- plugin.permission_denied；
- agent.provider_not_found；
- persistence.commit_failed。

调用方 MUST 仅按 `code` 分支。面向玩家的文案由 API 或 UI 层生成，不属于 Validation Protocol。

message 是面向人类的诊断，不得作为程序分支的唯一依据。

## 7. Observation Protocol

### 7.1 语义

Observation 是 Runtime 授权给某一个 Agent 的局部视图。它 MUST 经过 visibility、permission、perspective 和 context selection 过滤，MUST NOT 等于完整 GameState。

### 7.2 Current v0.2

    export interface Observation {
      id: string;
      sessionId: string;
      recipientId: string;
      triggerActionId: string;
      scene: { id: string; visibleEntityIds: string[] };
      incomingAction: Pick<PlayerAction, "actorId" | "type" | "content" | "parameters">;
      selfState: CharacterState;
      constraints: string[];
    }

### 7.3 Target v0.3

    export interface Observation {
      id: ObservationId;
      sessionId: SessionId;
      recipientId: EntityId;
      triggerActionId?: ActionId;
      scene: SceneObservation;
      incomingAction?: VisibleIncomingAction;
      selfState?: AgentVisibleSelfState;
      participants?: VisibleEntity[];
      constraints: ObservationConstraints;
      contextRefs?: ContextReference[];
      moment?: GameMoment;
    }

    export interface SceneObservation {
      locationId?: EntityId;
      description?: string;
      visibleEntityIds?: EntityId[];
      visibleObjectIds?: EntityId[];
      tags?: string[];
    }

    export interface ObservationConstraints {
      allowedActionTypes?: string[];
      forbiddenActionTypes?: string[];
      maxTargets?: number;
      toolPolicy?: string[];
      domain?: string;
    }

    export interface ContextReference {
      type:
        | "identity"
        | "memory"
        | "knowledge"
        | "belief"
        | "relationship"
        | "lore";
      id: string;
      summary?: string;
    }

ContextReference MAY 用于 lazy retrieval，但 Provider 仍只能取得被授权引用。

## 8. AgentAction Protocol

### 8.1 Current v0.2

    export interface AgentAction {
      id: string;
      sessionId: string;
      actorId: string;
      observationId: string;
      utterance?: string;
      requests: ActionRequest[];
    }

    export interface ActionRequest {
      type: "move";
      actorId: string;
      destination: string;
    }

### 8.2 Target v0.3

    export interface AgentAction {
      id: AgentActionId;
      sessionId: SessionId;
      actorId: EntityId;
      observationId: ObservationId;
      utterance?: AgentUtterance;
      requests?: ActionRequest[];
      metadata?: AgentActionMetadata;
    }

    export interface AgentUtterance {
      text: string;
      emotion?: string;
      expression?: string;
      voiceStyle?: string;
      targetIds?: EntityId[];
    }

    export interface ActionRequest {
      type: string;
      actorId: EntityId;
      targetIds?: EntityId[];
      parameters?: Record<string, unknown>;
      capabilityHint?: CapabilityId;
    }

AgentAction MUST NOT 直接修改 HP、位置、金钱、关系、章节或其他世界状态。utterance 的情绪和表现字段是短生命周期表现意图，不自动成为客观事件。

## 9. Command Protocol

Command 是 v0.3 新增的规范化内部协议。它把外部意图与领域执行分开。

    export interface CommandEnvelope<T = unknown> {
      id: CommandId;
      sessionId: SessionId;
      type: string;
      actorId?: EntityId;
      payload: T;
      causation: {
        playerActionId?: ActionId;
        agentActionId?: AgentActionId;
        sourceEventId?: EventId;
      };
      correlationId: string;
    }

    export interface CommandResult {
      accepted: boolean;
      events?: ProposedEvent[];
      mutations?: StateMutationProposal[];
      jobs?: ProposedJob[];
      rejection?: CommandRejection;
    }

Domain Capability MAY 计算候选事件、mutation 或 Job，但 MUST NOT 自行分配最终 sequence、stateRevision 或发布已提交事件。

Current：CommandGateway 已是 API 和功能插件面向权威层的第一道边界，但方法仍按领域展开。v0.3 应在不破坏现有入口的前提下增加通用 execute(command) 路径。

### 9.1 Story Command Schemas

`story.enter`、`story.evaluate` 与 `story.progress` 分别使用最小的章节进入、评估和节点进度 payload。它们都是可序列化的 command schema；未注册相应 capability 时必须返回 `story.capability_unavailable`，不得隐式调用现有 Runtime 或写入章节状态。

Current：`feature.story-chapters` 提供 `story.enter`，`feature.story-summon` 提供 `story.progress`。两者均经 capability-aware dispatcher 路由至 handler；`story.evaluate` 在评估迁移完成前不注册，因而稳定拒绝。

`story.appearance` 是 feature-owned controller capability，不接受 PlayerAction。它先依据已发布初始化和当前可用性生成候选，并在引入前重新验证；Runtime 只提交已通过该策略的引入操作，不读取 CIF 发布态。

## 10. GameEvent Protocol

### 10.1 Current v0.2

    export interface GameEvent {
      id: string;
      sessionId: string;
      createdAt: string;
      sequence: number;
      type: EventType;
      payload: Record<string, unknown>;
      causation: {
        playerActionId?: string;
        systemActionId?: string;
        agentActionId?: string;
      };
      stateRevision: number;
      moment?: GameMoment;
    }

### 10.2 Target v0.3

    export interface GameEvent<T = unknown> {
      id: EventId;
      sessionId: SessionId;
      type: string;
      schemaVersion: number;
      sequence: EventSequence;
      stateRevision: StateRevision;
      createdAt: string;
      moment?: GameMoment;
      source: {
        pluginId?: PluginId;
        capabilityId?: CapabilityId;
        system?: string;
      };
      causation: {
        playerActionId?: ActionId;
        agentActionId?: AgentActionId;
        commandId?: CommandId;
        sourceEventId?: EventId;
      };
      correlationId: string;
      payload: T;
      metadata?: Record<string, unknown>;
    }

已提交 Event SHOULD 视为不可变。更正采用新事件或新的投影规则，不得静默改写历史。

### 10.3 Event 命名空间

新事件 SHOULD 使用 domain.entity.event：

- interaction.player.spoke；
- world.character.moved；
- world.time.advanced；
- combat.battle.started；
- story.chapter.entered；
- memory.episode.created。

世界专属事件使用世界命名空间，例如 typemoon.servant.summoned。Kernel 自有事件必须保持极少，且不得把 Battle 或 Chapter 重新定义成 core 语义。

### 10.4 Event Schema Registry

Target：

    export interface EventSchemaRegistry {
      register(definition: EventSchemaDefinition): void;
      validate(
        type: string,
        schemaVersion: number,
        payload: unknown
      ): ValidationResult;
      get(
        type: string,
        schemaVersion?: number
      ): EventSchemaDefinition | undefined;
    }

事件 owner 负责 schema 和升级器；Runtime 负责提交前调用校验。

## 11. Capability ABI v2

### 11.1 Current v1

Current CapabilityId 是 string。ProvidedCapability 包含 id、serviceKey 和可选 public/system scope；requirement 只保存 capability ID。

### 11.2 Target Definition

    export interface CapabilityDefinition {
      id: CapabilityId;
      version: string;
      scope: "public" | "system";
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }

    export interface CapabilityRequirement {
      id: CapabilityId;
      version?: string;
      optional?: boolean;
    }

    export interface CapabilityProvider<T = unknown> {
      definition: CapabilityDefinition;
      implementation: T;
    }

    export interface CapabilityRegistry {
      register(pluginId: PluginId, capability: CapabilityProvider): void;
      unregister(pluginId: PluginId, capabilityId: CapabilityId): void;
      resolve<T>(requirement: CapabilityRequirement): T;
      has(requirement: CapabilityRequirement): boolean;
      list(): readonly CapabilityDescriptor[];
    }

Registry MUST 检查重复 provider、缺失 requirement、版本不兼容和 scope 越权。

### 11.3 命名

Capability 使用 domain.feature：

- world.state；
- world.eventHistory；
- world.jobs；
- world.navigation；
- world.commandGateway；
- agent.execute；
- character.context；
- character.memory；
- interaction.plan；
- interaction.execute；
- interaction.commandHandler；
- combat.resolve；
- story.enter；
- story.evaluate；
- story.progress；
- story.appearance；
- presentation.project。

system.turnCommitter 等 system-only 能力不得被 feature plugin 请求。

## 12. Plugin Manifest v2

### 12.1 Current v1

当前 manifest 已包含 id、version、configVersion、requires、provides、ownsEvents 和 ownsJobs。

### 12.2 Target v2

    export interface GamePluginManifest {
      id: PluginId;
      version: string;
      apiVersion: string;
      configVersion: number;
      type: "system" | "feature" | "world" | "adapter" | "provider";
      description?: string;
      author?: string;
      requires?: CapabilityRequirement[];
      provides?: CapabilityDefinition[];
      ownsEvents?: EventOwnership[];
      ownsJobs?: string[];
      permissions?: PluginPermission[];
      entry?: string;
    }

apiVersion 表示插件协议版本，MUST 与插件自身 version 分离。

    export interface EventOwnership {
      namespace: string;
      versions?: number[];
    }

    export type PluginPermission =
      | "world.read"
      | "character.read"
      | "events.read"
      | "jobs.enqueue"
      | "model.invoke"
      | "network.access"
      | "filesystem.access";

权限枚举是 v0.3 最小模型。它不等于操作系统级沙箱；不受信任插件隔离属于 Future。

## 13. Plugin Context 与生命周期

公共 Plugin API MUST NOT 暴露 Cordis Context。

    export interface PluginSetupContext {
      capabilities: CapabilityClient;
      events: PluginEventClient;
      jobs?: JobClient;
      config: unknown;
      lifecycle: PluginLifecycleContext;
      logger: PluginLogger;
    }

    export interface GamePluginDefinition {
      manifest: GamePluginManifest;
      setup(context: PluginSetupContext): void | Promise<void>;
    }

目标生命周期：

    discover
      -> validate
      -> load
      -> setup
      -> start
      -> running
      -> stop
      -> dispose

Current PluginManager 的 register、enable、disable、unregister 和 list 行为继续保留。禁用 provider 时，若仍有启用中的 dependent，MUST 拒绝。

## 14. Plugin Host

PluginManager 管理已加载 definition；PluginHost 负责发现和加载 package。二者 MUST 分离。

    export interface PluginHost {
      discover(source: PluginSource): Promise<PluginPackageDescriptor[]>;
      load(
        descriptor: PluginPackageDescriptor
      ): Promise<GamePluginDefinition>;
    }

    export type PluginSource = {
      type: "local";
      path: string;
    };

v0.3 只要求受信任本地路径。npm、registry、GitHub 和远程服务属于 Future。

## 15. Agent Provider API

    export interface AgentProvider {
      id: string;
      canHandle(
        input: AgentBindingQuery
      ): boolean | Promise<boolean>;
      run(observation: Observation): Promise<AgentAction>;
    }

    export interface AgentBindingQuery {
      sessionId: SessionId;
      entityId: EntityId;
      agentProfile?: string;
      tags?: string[];
    }

    export interface AgentRegistry {
      register(provider: AgentProvider): void;
      unregister(providerId: string): void;
      resolve(
        query: AgentBindingQuery
      ): Promise<AgentProvider>;
    }

Current AgentRunner 和 CombinedTurnRunner 继续作为兼容 adapter。v0.3 至少应提供 PiAgentProvider 和 RuleBasedAgentProvider，以证明 Runtime 不绑定 LLM。

## 16. Model 与 Tool API

Agent 与模型供应商分离：

    export interface ModelProvider {
      generate(
        request: ModelGenerationRequest
      ): Promise<ModelGenerationResult>;
    }

    export interface AgentTool {
      name: string;
      description: string;
      inputSchema: unknown;
      execute(
        input: unknown,
        context: ToolExecutionContext
      ): Promise<unknown>;
    }

Tool MUST 经过 Agent Tool Policy。能够调用工具不等于拥有 world admin 或数据库写权。

Current PiAgentRunner 只开放受控 submit_game_action 路径；v0.3 抽象不得削弱该安全边界。

## 17. Character / CIF Capability

### 17.1 Character Context

    export interface CharacterContextProvider {
      build(
        request: CharacterContextRequest
      ): Promise<CharacterContext>;
    }

    export interface CharacterContextRequest {
      sessionId: SessionId;
      characterId: EntityId;
      participantIds?: EntityId[];
      sceneTags?: string[];
      memoryQuery?: string;
      budget?: ContextBudget;
    }

    export interface ContextBudget {
      maxMemoryItems?: number;
      maxEvidenceItems?: number;
      maxRelationshipItems?: number;
      maxEstimatedTokens?: number;
    }

### 17.2 Identity 与 Memory

    export interface CharacterIdentityProvider {
      getIdentity(
        sessionId: SessionId,
        characterId: EntityId,
        request?: IdentityRequest
      ): Promise<CharacterIdentityContext>;
    }

    export interface CharacterMemoryProvider {
      recall(
        query: MemoryRecallRequest
      ): Promise<MemoryRecallResult>;
    }

读取能力不得暴露 SqliteCifRepository。写入候选必须经过证据校验、草案、审核或 Runtime 事件规则，不允许任意 append 成为 live CIF。

### 17.3 Epistemic 与 Interpretive

    export interface EpistemicState {
      subject: string;
      proposition: string;
      confidence: number;
      status: "known" | "believed" | "suspected" | "unknown";
      evidenceIds?: string[];
    }

EpistemicProvider 和 InterpretiveModelProvider 分别负责“角色知道什么”和“角色如何理解”。它们不得代替客观 EventStore。

## 18. Persistence API

公共 persistence port MUST NOT 暴露 SQL、SQLite connection 或 repository 具体类。

    export interface EventStore<TEvent = unknown> {
      append(
        sessionId: SessionId,
        events: readonly TEvent[]
      ): Promise<void>;
      list(query: EventQuery): Promise<TEvent[]>;
      getByIds(
        sessionId: SessionId,
        eventIds: readonly EventId[]
      ): Promise<TEvent[]>;
    }

    export interface SnapshotStore<TState = unknown> {
      load(
        sessionId: SessionId
      ): Promise<StateSnapshot<TState> | undefined>;
      save(snapshot: StateSnapshot<TState>): Promise<void>;
    }

    export interface StateSnapshot<TState = unknown> {
      sessionId: SessionId;
      revision: StateRevision;
      lastEventSequence: EventSequence;
      schemaVersion: number;
      state: TState;
      createdAt: string;
    }

    export interface JobClaim {
      sessionId: SessionId;
      workerId: string;
      kind?: string;
      now: string;
      leaseExpiresBefore: string;
    }

    export interface JobStore<TJob = unknown> {
      enqueue(job: TJob): Promise<void>;
      claim(claim: JobClaim): Promise<TJob | undefined>;
      complete(jobId: JobId, workerId: string, completedAt: string): Promise<void>;
      retry(jobId: JobId, workerId: string, error: string, availableAt: string): Promise<void>;
      defer(jobId: JobId, workerId: string, availableAt: string): Promise<void>;
    }

    export interface MigrationRecord {
      id: string;
      checksum: string;
      appliedAt: string;
    }

    export interface MigrationStore {
      listApplied(): Promise<MigrationRecord[]>;
      recordApplied(migration: MigrationRecord): Promise<void>;
    }

    // Before E01-07, TEvent stays generic. It becomes GameEvent at the
    // implementation boundary after the v0.3 event envelope is available.

TurnCommitter 是 system-only：

    export interface TurnCommitter {
      commit(turn: PendingTurnCommit): Promise<void> | void;
    }

一次 commit MUST 原子包含适用的 next state、events、action receipt、CIF evidence、projection effects 和 durable jobs。

Current PendingTurnCommit 的 actionId、requestFingerprint、worldState、events、recipients、private note 和 commit effects 在 v0.3 迁移期间必须保持语义兼容。

## 19. Durable Job API

Target 在 current 字段基础上增加插件来源版本：

    export interface DurableJob<T = unknown> {
      id: JobId;
      sessionId: SessionId;
      kind: string;
      payload: T;
      status: "pending" | "processing" | "completed" | "dead";
      attempts: number;
      maxAttempts: number;
      dedupeKey: string;
      availableAt: string;
      leasedAt?: string;
      leaseOwner?: string;
      completedAt?: string;
      error?: string;
      createdAt: string;
      ownerPlugin?: PluginId;
      ownerVersion?: string;
      payloadVersion?: number;
    }

Queue MUST 支持 enqueue、claim、complete、retry 和 defer。claim MUST 使用租约；进程退出后过期租约必须可恢复。Manifest 的 ownsJobs MUST 与注册的 Handler 对应。

## 20. Projection 与 Narrative API

### 20.1 PlayerVisibleState

前端 MUST 接收过滤后的 PlayerVisibleState，不得读取原始 GameState 或数据库记录。

Current 投影包含 sessionId、revision、当前地点、可见出口、可见对象、同场角色和可见战斗摘要。

未来添加地图、档案和角色面板时，MUST 继续遵守玩家可见性边界。

### 20.2 NarrativeBeat

    export interface NarrativeBeat {
      id: string;
      sourceEventIds: string[];
      stateRevision: number;
      blocks: NarrativeBlock[];
    }

NarrativeBeat MUST 只从已提交事件确定性生成；它是可回放表现计划，不拥有世界写权。不存在立绘或语音 provider 时，文本回退 MUST 保持可玩。

## 21. Correlation 与 Trace

Target correlationId 必须贯穿：

    PlayerAction
      -> Observation
      -> AgentAction
      -> Command
      -> GameEvent
      -> DurableJob

Trace MAY 记录 ID、Provider、ContextReference、耗时、错误和工具调用摘要，MUST NOT 记录隐藏 Chain-of-Thought 或未授权角色私密上下文。

## 22. 版本与兼容策略

### 22.1 Expand

增加 v0.3 类型、registry 和 adapter，同时保留 v0.2 入口。

### 22.2 Migrate

调用方优先使用 v0.3；兼容层负责旧 action lane、EventType、AgentRunner 和 Plugin v1 manifest。

### 22.3 Contract

仅在所有生产调用、存档读取和测试完成迁移后，才允许移除旧入口。移除前必须提供迁移说明和兼容性测试。

事件默认采用 read-old / upgrade-in-memory / project-current，不在 v0.3 中批量静默重写历史事件。

## 23. 当前 Capability 清单

2026-08-19 已在代码中出现的主要能力：

| Capability | Scope / Provider |
| --- | --- |
| world.state | system.world-state |
| world.eventHistory | system.persistence |
| system.turnCommitter | system-only / system.persistence |
| world.jobs | system.durable-jobs |
| world.eventTasks | system.durable-jobs |
| world.map | system.world-map |
| world.navigation | system.world-navigation |
| world.commandGateway | system.command-authority |
| world.sceneLifecycle | feature.scene-lifecycle |
| world.interactionCoordinator | feature.interaction-coordinator |
| interaction.plan | feature.interaction-coordinator |
| interaction.execute | feature.interaction-coordinator |
| interaction.commandHandler | feature.interaction-coordinator |
| world.storyChapters | feature.story-chapters |
| world.storySummon | feature.story-summon |
| world.simulation | feature.world-simulation |
| world.memoryConsolidation | feature.memory-consolidation |
| world.cifPatterns | feature.cif-patterns |
| world.memoryEvolutionPolicy | feature.memory-evolution-policy |
| world.cifPublication | feature.cif-publication |

该表是 Current inventory，不等同于 v0.3 冻结后的最终命名。

## 24. v0.3 一致性要求

实现声称符合 v0.3 时，至少必须证明：

- 公共对象 JSON round-trip；
- v0.2 输入和存档兼容读取；
- action idempotency 和请求指纹冲突；
- event schema validation；
- missing、duplicate、cycle、version mismatch 和 scope violation；
- provider disable 和 effect cleanup；
- commit failure rollback；
- durable job dedupe、lease 和 restart recovery；
- Observation 与 PlayerVisibleState 不泄露隐藏状态；
- Pi Agent 和 Rule Agent 替换；
- plugin swap、event replay 和 module boundary tests。

## 25. 相关文档

- [架构总览](../architecture/overview.md)
- [开发路线与任务拆解](../development/DEVELOPMENT_ROADMAP_AND_TASK_BREAKDOWN.md)
- [核心数据契约 v0.2](../contracts.md)
- [插件协议 V1](../plugin-protocol-v1.md)
- [持久化基础](../persistence-foundation.md)
- [前端协议](../frontend-protocol.md)
