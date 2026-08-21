# Plugin Developer Quickstart

> 状态：SDK Alpha / 项目内开发预览
> 适用版本：Agent Game Runtime v0.3 开发线

本指南帮助新开发者在仓库内运行 SDK 示例，并完成一个只依赖公共 SDK 子路径的最小插件。当前包仍是 `private`，尚未发布到 npm；不要把本文的包名用法理解为已经可从公共 registry 安装。

## 1. 准备环境

建议使用 Node.js 24 与仓库锁定的 npm 依赖。在项目根目录执行命令。

Windows PowerShell：

```powershell
npm.cmd ci
npm.cmd run test:examples
```

macOS/Linux 可把 `npm.cmd` 替换为 `npm`：

```bash
npm ci
npm run test:examples
```

`test:examples` 会依次构建 Runtime SDK、独立编译 `examples`，再运行全部参考示例测试。当前应看到 11 条测试通过，且不需要启动 HTTP、SQLite、Cordis 或模型服务。

## 2. 认识示例目录

```text
examples/
├─ plugins/
│  ├─ simple-greeting/  # 最小 Command → ProposedEvent 闭环
│  └─ simple-combat/    # combat.resolve、局部 conformance 与 provider 替换
├─ providers/
│  └─ rule-agent/       # 无模型凭据的确定性 AgentProvider
└─ tsconfig.json        # 独立示例编译边界
```

对应源码：

- [simple-greeting](../../examples/plugins/simple-greeting/index.ts)
- [simple-combat](../../examples/plugins/simple-combat/index.ts)
- [combat provider conformance](../../examples/plugins/simple-combat/conformance.ts)
- [rule-agent](../../examples/providers/rule-agent/index.ts)

示例源码只能从 `agent-game-runtime/sdk` 导入项目契约。`examples/tsconfig.json` 使用独立 `rootDir`；若示例尝试通过相对路径导入 `src` 私有实现，编译应失败。

## 3. 分别运行三个示例

先执行一次 `npm.cmd run test:examples` 完成构建，然后可单独运行：

```powershell
node --test dist-examples/plugins/simple-greeting/index.test.js
node --test dist-examples/plugins/simple-combat/index.test.js
node --test dist-examples/providers/rule-agent/index.test.js
```

三个示例验证不同边界：

1. `simple-greeting`：声明 capability、event schema 和 plugin，并在 `createTestRuntime` 中完成一条命令到候选事件的闭环。
2. `simple-combat`：复用官方 `combat.resolve` schema，覆盖 command、delegate、quick-resolve，并证明替代 provider 可通过相同契约。
3. `rule-agent`：只读取 recipient-specific Observation，确定性生成 AgentAction，不读取模型配置或 API Key。

## 4. 创建第一个插件

在 `examples/plugins/echo/index.ts` 创建：

```ts
import {
  defineCapability,
  defineEventSchema,
  definePlugin,
} from "agent-game-runtime/sdk";
import type {
  CommandEnvelope,
  CommandResult,
  PluginRuntimeContext,
} from "agent-game-runtime/sdk";

interface EchoCapability {
  execute(command: CommandEnvelope<{ text: string }>): Promise<CommandResult>;
}

export const ECHO_CAPABILITY = defineCapability({
  id: "example.echo",
  version: "1.0.0",
  scope: "public",
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string", minLength: 1 } },
  },
});

export const ECHOED_EVENT = defineEventSchema({
  type: "example.echo.completed",
  schemaVersion: 1,
  payloadSchema: {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string", minLength: 1 } },
  },
});

export const echoPlugin = definePlugin({
  manifest: {
    id: "example.echo-plugin",
    version: "1.0.0",
    apiVersion: "0.3",
    configVersion: 1,
    type: "feature",
    provides: [ECHO_CAPABILITY],
    ownsEvents: [{ namespace: "example.echo", versions: [1] }],
  },
  setup(context: PluginRuntimeContext) {
    const implementation: EchoCapability = {
      async execute(command) {
        const text = command.payload.text.trim();
        if (command.type !== ECHO_CAPABILITY.id || text.length === 0) {
          return {
            accepted: false,
            rejection: { code: "echo.command_invalid" },
          };
        }
        return {
          accepted: true,
          events: [{
            type: ECHOED_EVENT.type,
            payload: { text },
          }],
        };
      },
    };
    context.capabilities.provide(ECHO_CAPABILITY, implementation);
  },
});
```

然后在 `examples/plugins/echo/index.test.ts` 创建：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestRuntime } from "agent-game-runtime/sdk";
import { ECHO_CAPABILITY, ECHOED_EVENT, echoPlugin } from "./index.js";

test("echo plugin proposes one event", async () => {
  const runtime = await createTestRuntime({
    plugins: [{ plugin: echoPlugin }],
  });
  try {
    const echo = runtime.getCapability<{
      execute(command: {
        id: string;
        sessionId: string;
        type: string;
        payload: { text: string };
        causation: {};
        correlationId: string;
      }): Promise<{ accepted: boolean; events?: Array<{ type: string; payload: unknown }> }>;
    }>(ECHO_CAPABILITY.id);

    const result = await echo.execute({
      id: "command-1",
      sessionId: "session-1",
      type: ECHO_CAPABILITY.id,
      payload: { text: "hello" },
      causation: {},
      correlationId: "correlation-1",
    });

    assert.equal(result.accepted, true);
    assert.equal(result.events?.[0]?.type, ECHOED_EVENT.type);
  } finally {
    await runtime.dispose();
  }
});
```

再次运行：

```powershell
npm.cmd run test:examples
```

新文件位于 `examples/plugins/**/*.ts`，会自动进入独立编译和示例测试。

## 5. 关键边界

### Plugin 与 capability

- manifest 的 `provides` 必须与 `context.capabilities.provide` 实际注册的 definition 一致。
- capability ID 使用 `domain.feature` 命名；版本与插件自身版本分离。
- feature plugin 只能请求 public capability，不能请求 system-only 写权。

### Event

`CommandResult.events` 中的是 `ProposedEvent`，不是已提交 `GameEvent`。插件不得填写 event ID、sequence 或 state revision，也不得绕过 Runtime 直接写 EventStore。Runtime/Kernel 负责 schema 校验、规则验证、原子提交和最终事件信封。

### Lifecycle

副作用应通过 `context.lifecycle.effect` 或兼容的 `context.effect` 注册，并返回 cleanup。`createTestRuntime` 会在失败和 dispose 时按逆序清理。

### AgentProvider

`defineAgentProvider` 只定义 provider，不注册它。当前 SDK Alpha 保留 v0.2-compatible `supports/run`、`AgentProviderObservation` 与 `AgentProviderAction`；不要把它写成尚未迁移完成的目标 v0.3 `canHandle` API。

AgentAction 是候选输出。参考 `rule-agent` 返回空 requests；任何移动或其他世界变化请求仍必须由 Runtime 权威校验。
### Conformance

`runPluginConformance` 返回逐项报告，覆盖 manifest JSON/结构、setup、调用方定义的 protocol probes、双重 dispose、cleanup/rollback 和关闭态。`runAgentProviderConformance` 覆盖 provider ID、binding match/reject、Action 与 Observation 关联、JSON 序列化及确定性。

领域行为通过 probe 断言，不由通用 runner 猜测。失败 probe 会被记录，但 runner 仍会执行 dispose 和 cleanup 验证。

```powershell
npm.cmd run test:conformance
```


## 6. 提交前检查

```powershell
npm.cmd run verify:release
```

该入口依次执行完整测试、module boundary 和 SDK conformance；CI 对每个 push、pull request 和手动候选验证执行同一命令。

检查清单：

- 生产源码只从 `agent-game-runtime/sdk` 导入公共 SDK；
- manifest ID、版本、capability 和 event ownership 完整；
- 非法输入返回稳定 rejection；
- 测试不启动 HTTP、SQLite、Cordis 或模型服务；
- cleanup、失败回滚和候选事件权威边界没有被绕过；
- 新增公共协议时同步更新 API 规范与路线图。

## 7. 常见问题

### 找不到 `agent-game-runtime/sdk`

先运行 `npm.cmd run build`。包的 self-reference 指向 `dist/sdk/index.js` 与声明文件；SDK 尚未发布到公共 registry。

### 示例构建找不到 Node 类型

使用 `npm.cmd ci` 安装锁定依赖，不要单独复制 `examples` 目录运行。`examples/tsconfig.json` 已显式加载 Node 类型。

### 为什么 `createTestRuntime` 不能提交世界事件

它是纯内存插件测试容器，不是生产 Kernel。它有意不创建 HTTP、Cordis、SQLite 或提交权威，防止单元测试把候选结果误当成持久化事实。

### 如何接入生产 Runtime

SDK Alpha 当前只承诺项目内受信任开发与测试边界。生产 Plugin Host、Cordis v1/v2 adapter、Runtime composition 和持久化装配仍由项目自身负责；待公共边界冻结并拆分独立包后，再提供项目外安装与部署流程。
