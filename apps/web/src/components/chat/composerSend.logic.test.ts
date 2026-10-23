import {
  EnvironmentId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { describe, expect, it } from "vite-plus/test";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { threadContextRecord, threadContextReference } from "../../lib/composerContextRecords";
import {
  approvalRedirectNotice,
  loadBalancingSendWarning,
  multipleModelSendBlock,
  planSideChatSend,
  referencedThreadContexts,
} from "./composerSend.logic";
import { getComposerPromptLengthValidationMessage } from "./composerSubmission";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const localThread = threadContextRecord(scopeThreadRef(local, ThreadId.make("a")), "Local");
const remoteThread = threadContextRecord(scopeThreadRef(remote, ThreadId.make("b")), "Remote");

describe("referencedThreadContexts", () => {
  it("keeps only the attached threads the prompt still links", () => {
    const prompt = `see ${formatInlineContextReference(threadContextReference(remoteThread))}`;
    expect(
      referencedThreadContexts({ prompt, threadContexts: [localThread, remoteThread] }),
    ).toEqual([remoteThread]);
  });
});

describe("loadBalancingSendWarning", () => {
  it("asks the user to wait while resource checks run", () => {
    expect(
      loadBalancingSendWarning({
        pending: true,
        threadContexts: [localThread, remoteThread],
        candidateEnvironmentIds: [],
      }).title,
    ).toBe("Checking machine resources");
  });

  it("blames the attached threads when no machine can read all of them", () => {
    expect(
      loadBalancingSendWarning({
        pending: false,
        threadContexts: [localThread, remoteThread],
        candidateEnvironmentIds: [local, remote],
      }).description,
    ).toMatch(/No machine can read every attached thread/);
  });

  it("blames resources when one machine can read every attached thread", () => {
    expect(
      loadBalancingSendWarning({
        pending: false,
        threadContexts: [localThread],
        candidateEnvironmentIds: [remote, local],
      }).description,
    ).toMatch(/No eligible machine has available resources/);
  });
});

describe("multipleModelSendBlock", () => {
  const ready = {
    selectionCount: 2,
    serverSupportsWorktreeBootstrap: true,
    isLocalDraftThread: true,
    isGitRepo: true,
    branch: "main",
  };

  it("lets a new Git draft with a branch and models start", () => {
    expect(multipleModelSendBlock(ready)).toBeNull();
  });

  it("asks for a server update before checking the draft", () => {
    expect(
      multipleModelSendBlock({
        ...ready,
        serverSupportsWorktreeBootstrap: false,
        isGitRepo: false,
      }),
    ).toBe("server-outdated");
  });

  it.each([
    { isLocalDraftThread: false },
    { isGitRepo: false },
    { branch: null },
    { selectionCount: 0 },
  ])("needs a new Git thread with a branch and models (%o)", (override) => {
    expect(multipleModelSendBlock({ ...ready, ...override })).toBe("needs-new-git-thread");
  });
});

describe("approvalRedirectNotice", () => {
  const settled = {
    draftChanged: false,
    declined: true,
    approvalResponding: false,
    approvalArrived: false,
  };

  it("says the decline went through when the draft changed after it", () => {
    expect(approvalRedirectNotice({ ...settled, draftChanged: true })).toBe(
      "Approval declined. Your message changed, so it wasn't sent.",
    );
    expect(approvalRedirectNotice({ ...settled, draftChanged: true, declined: false })).toBe(
      "Your message changed, so it wasn't sent.",
    );
  });

  it("explains an approval already being answered", () => {
    expect(
      approvalRedirectNotice({ ...settled, declined: false, approvalResponding: true }),
    ).toMatch(/already being answered/);
  });

  it("explains an approval that arrived during the decline", () => {
    expect(approvalRedirectNotice({ ...settled, approvalArrived: true })).toMatch(
      /Another approval arrived/,
    );
  });

  it("stays quiet when the decline failed or the user left the thread", () => {
    expect(approvalRedirectNotice({ ...settled, declined: false })).toBeNull();
    expect(approvalRedirectNotice(settled)).toBeNull();
  });
});

describe("planSideChatSend", () => {
  const providerEntry = {
    driverKind: ProviderDriverKind.make("codex"),
    enabled: true,
    isAvailable: true,
    models: [],
  };
  const ready = {
    canOperate: true,
    sendInFlight: false,
    shellReady: true,
    answeringPendingUserInput: false,
    providerEntry,
    model: "gpt-5.4",
    runActive: false,
    prompt: "  What is a Box?\n",
  };

  it("sends the trimmed prompt as the side chat's message", () => {
    expect(planSideChatSend(ready)).toEqual({
      _tag: "Ready",
      outgoingText: "What is a Box?",
      message: { text: "What is a Box?" },
    });
  });

  it.each([
    ["the environment can't be operated", { canOperate: false }, "no-operate-scope"],
    ["a send is already in flight", { sendInFlight: true }, "in-flight"],
    ["the side chat is still starting", { shellReady: false }, "starting"],
    ["the provider is unknown", { providerEntry: undefined }, "provider-unavailable"],
    [
      "the provider is disabled",
      { providerEntry: { ...providerEntry, enabled: false } },
      "provider-unavailable",
    ],
    [
      "the provider is unavailable",
      { providerEntry: { ...providerEntry, isAvailable: false } },
      "provider-unavailable",
    ],
    ["the side chat is still answering", { runActive: true }, "run-active"],
    ["the prompt is blank", { prompt: " \n " }, "empty"],
  ] as const)("blocks when %s", (_case, override, reason) => {
    expect(planSideChatSend({ ...ready, ...override })).toEqual({ _tag: "Blocked", reason });
  });

  it("reports the earliest failing check", () => {
    const everyCheckFails = {
      ...ready,
      canOperate: false,
      sendInFlight: true,
      shellReady: false,
      providerEntry: undefined,
      runActive: true,
      prompt: "",
    };
    const reasons = [
      everyCheckFails,
      { ...everyCheckFails, canOperate: true },
      { ...everyCheckFails, canOperate: true, sendInFlight: false },
      { ...everyCheckFails, canOperate: true, sendInFlight: false, shellReady: true },
      {
        ...everyCheckFails,
        canOperate: true,
        sendInFlight: false,
        shellReady: true,
        providerEntry,
      },
    ].map((input) => {
      const plan = planSideChatSend(input);
      return plan._tag === "Blocked" ? plan.reason : plan._tag;
    });
    expect(reasons).toEqual([
      "no-operate-scope",
      "in-flight",
      "starting",
      "provider-unavailable",
      "run-active",
    ]);
  });

  it("answers a pending question even while the side chat's run is active", () => {
    expect(
      planSideChatSend({ ...ready, answeringPendingUserInput: true, runActive: true }),
    ).toEqual({ _tag: "AnswerPendingInput" });
  });

  it("refuses a prompt over the provider's input limit", () => {
    const prompt = "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1);
    expect(planSideChatSend({ ...ready, prompt })).toEqual({
      _tag: "Invalid",
      message: getComposerPromptLengthValidationMessage(prompt),
    });
  });
});
