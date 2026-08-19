import assert from "node:assert/strict";
import test from "node:test";
import { Service, type Context, type Plugin } from "@deepseek-ai/cordis";
import { bootstrap } from "./bootstrap.js";
import { CordisPlatformAdapter, type CordisGamePluginDefinition } from "./cordis-platform.js";
import { CompositionValidationError, type GameComposition, validateComposition } from "./contracts.js";

function plugin(id: string, implementation: Plugin, options: Partial<CordisGamePluginDefinition["manifest"]> = {}): CordisGamePluginDefinition {
  return {
    implementation,
    manifest: { id, version: "1.0.0", configVersion: 1, ...options },
  };
}

test("Cordis platform mounts declared capabilities and disposes registered effects", async () => {
  let disposed = false;
  const greeter = plugin("test.greeter", (ctx: Context) => {
    class GreeterService extends Service {
      public greet(): string { return "hello"; }
    }
    new GreeterService(ctx, "greeter");
    ctx.effect(() => {
      return () => {
        disposed = true;
      };
    });
  }, { provides: [{ id: "test.greeter", serviceKey: "greeter" }] });
  let consumerSawGreeter = false;
  const consumer = plugin("test.consumer", {
    inject: ["greeter"],
    apply(ctx: Context) {
      consumerSawGreeter = typeof (ctx as unknown as Record<string, unknown>).greeter === "object";
    },
  }, { requires: ["test.greeter"] });
  const composition: GameComposition = { profileId: "test", plugins: [{ plugin: greeter }, { plugin: consumer }] };

  const running = await bootstrap(new CordisPlatformAdapter(), composition);
  assert.equal(consumerSawGreeter, true);
  assert.equal(running.get<{ greet(): string }>("test.greeter").greet(), "hello");
  await running.dispose();
  assert.equal(disposed, true);
  assert.throws(() => running.get("test.greeter"), /disposed/);
});

test("composition validation rejects missing requirements and conflicting providers before mounting", () => {
  const noProvider: GameComposition = {
    profileId: "invalid", plugins: [{ plugin: plugin("test.consumer", () => undefined, { requires: ["world.missing"] }) }],
  };
  assert.throws(() => validateComposition(noProvider), CompositionValidationError);

  const collision: GameComposition = {
    profileId: "invalid",
    plugins: [
      { plugin: plugin("test.one", () => undefined, { provides: [{ id: "world.state", serviceKey: "one" }] }) },
      { plugin: plugin("test.two", () => undefined, { provides: [{ id: "world.state", serviceKey: "two" }] }) },
    ],
  };
  assert.throws(() => validateComposition(collision), /provided by both/);

  const cycle: GameComposition = {
    profileId: "invalid",
    plugins: [
      { plugin: plugin("test.one", () => undefined, { requires: ["test.two"], provides: [{ id: "test.one", serviceKey: "one" }] }) },
      { plugin: plugin("test.two", () => undefined, { requires: ["test.one"], provides: [{ id: "test.two", serviceKey: "two" }] }) },
    ],
  };
  assert.throws(() => validateComposition(cycle), /Circular plugin dependency/);
});

test("plugin manager enables and removes a plugin without disturbing its provider", async () => {
  let consumerDisposed = false;
  const provider = plugin("test.provider", (ctx: Context) => {
    class ProviderService extends Service { public value(): string { return "ready"; } }
    new ProviderService(ctx, "provider");
  }, { provides: [{ id: "test.provider", serviceKey: "provider" }] });
  const consumer = plugin("test.consumer", (ctx: Context) => {
    ctx.effect(() => () => { consumerDisposed = true; });
  }, { requires: ["test.provider"] });

  const manager = await new CordisPlatformAdapter().createManager({
    profileId: "manager-test",
    plugins: [{ plugin: provider }, { plugin: consumer, disabled: true }],
  });

  assert.deepEqual(manager.list().map(({ id, enabled }) => ({ id, enabled })), [
    { id: "test.provider", enabled: true }, { id: "test.consumer", enabled: false },
  ]);
  await manager.enable("test.consumer");
  assert.equal(manager.get<{ value(): string }>("test.provider").value(), "ready");
  await manager.disable("test.consumer");
  assert.equal(consumerDisposed, true);
  assert.equal(manager.get<{ value(): string }>("test.provider").value(), "ready");
  await manager.unregister("test.consumer");
  assert.deepEqual(manager.list().map((item) => item.id), ["test.provider"]);
  await manager.dispose();
});

test("plugin manager refuses to remove a provider used by an active plugin", async () => {
  const provider = plugin("test.provider", (ctx: Context) => {
    class ProviderService extends Service { public ready(): boolean { return true; } }
    new ProviderService(ctx, "provider");
  }, { provides: [{ id: "test.provider", serviceKey: "provider" }] });
  const consumer = plugin("test.consumer", () => undefined, { requires: ["test.provider"] });
  const manager = await new CordisPlatformAdapter().createManager({ profileId: "dependency-test", plugins: [{ plugin: consumer }, { plugin: provider }] });

  await assert.rejects(() => manager.disable("test.provider"), /required by active plugins: test.consumer/);
  await manager.disable("test.consumer");
  await manager.disable("test.provider");
  assert.throws(() => manager.get("test.provider"), /not provided by an active plugin/);
  await manager.dispose();
});
