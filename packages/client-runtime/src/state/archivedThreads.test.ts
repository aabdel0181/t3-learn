import {
  EnvironmentId,
  type OrchestrationV2ArchivedShellSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createArchivedThreadSnapshotsAtomFamily,
  listedArchivedThreads,
  makeArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";

it("does not expose an archived snapshot failure message", () => {
  const environmentId = EnvironmentId.make("env-sensitive");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationV2ArchivedShellSnapshot, Error>(
          Cause.fail(new Error("credential=secret-value")),
        ),
      ),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  expect(registry.get(snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
    snapshots: [],
    error: "Failed to load archived threads.",
    isLoading: false,
  });

  registry.dispose();
});

it("lists a side chat only when its parent is not archived with it", () => {
  const lesson = { id: ThreadId.make("lesson") };
  const sideChatOf = (id: string, parentThreadId: ThreadId) => ({
    id: ThreadId.make(id),
    sideChat: { anchor: { threadId: parentThreadId } },
  });
  const space = sideChatOf("space", lesson.id);
  const box = sideChatOf("box", space.id);
  const archivedAlone = sideChatOf("reward", ThreadId.make("live-lesson"));

  expect(listedArchivedThreads([lesson, space, box, archivedAlone])).toEqual([
    lesson,
    archivedAlone,
  ]);
  expect(listedArchivedThreads([space, box])).toEqual([space]);
});
