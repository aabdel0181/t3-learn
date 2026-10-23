import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as TextGeneration from "./TextGeneration.ts";

it.effect("writes side-chat text from an empty temp directory that is removed afterwards", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const observed = yield* Deferred.make<{ cwd: string; entries: ReadonlyArray<string> }>();
    const layerTextGeneration = Layer.mock(TextGeneration.TextGeneration)({
      generateSideChatText: (input) =>
        fs.readDirectory(input.cwd).pipe(
          Effect.orDie,
          Effect.tap((entries) => Deferred.succeed(observed, { cwd: input.cwd, entries })),
          Effect.as({ text: "ok" }),
        ),
    });

    const result = yield* TextGeneration.generateIsolatedSideChatText({
      kind: "opening_summary",
      prompt: "What the side chat covers.",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" },
    }).pipe(Effect.provide(layerTextGeneration));

    const { cwd, entries } = yield* Deferred.await(observed);
    assert.deepStrictEqual(result, { text: "ok" });
    assert.include(cwd, "t3code-side-chat-");
    assert.deepStrictEqual(entries, []);
    assert.isFalse(yield* fs.exists(cwd));
  }).pipe(Effect.provide(NodeServices.layer)),
);
