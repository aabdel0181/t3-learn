import { assert, describe, it } from "@effect/vitest";
import { SIDE_CHAT_WAIT_CAP_MS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { awaitWithinSideChatWaitCap } from "./sideChatOpening.ts";

describe("awaitWithinSideChatWaitCap", () => {
  it.effect("stops waiting for a side-chat opening at SIDE_CHAT_WAIT_CAP_MS", () =>
    Effect.gen(function* () {
      const waiter = yield* awaitWithinSideChatWaitCap(Effect.never).pipe(Effect.forkChild);
      yield* TestClock.adjust(SIDE_CHAT_WAIT_CAP_MS - 1);
      assert.isUndefined(waiter.pollUnsafe());

      yield* TestClock.adjust(1);
      assert.isFalse(yield* Fiber.join(waiter));
    }),
  );

  it.effect("stops waiting as soon as the opening settles", () =>
    Effect.gen(function* () {
      const settled = yield* Deferred.make<void>();
      const waiter = yield* awaitWithinSideChatWaitCap(Deferred.await(settled)).pipe(
        Effect.forkChild,
      );
      yield* Deferred.succeed(settled, undefined);
      assert.isTrue(yield* Fiber.join(waiter));
    }),
  );
});
