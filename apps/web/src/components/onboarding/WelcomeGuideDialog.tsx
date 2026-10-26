import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import {
  ArrowUpIcon,
  BookOpenIcon,
  ChevronRightIcon,
  type LucideIcon,
  MessageCircleIcon,
  MessageCircleQuestionIcon,
  QuoteIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useClientSettings } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { environmentPresentations } from "~/state/presentation";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { T3Wordmark } from "../T3Wordmark";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Kbd } from "../ui/kbd";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup, WizardSteps } from "../ui/wizard";

export const WELCOME_GUIDE_SEEN_STORAGE_KEY = "t3learn:welcome-guide-seen:v1";
const WelcomeGuideSeenSchema = Schema.NullOr(Schema.String);

const STEPS = ["Welcome", "Highlight", "Ask", "Done", "Map"];

const useWelcomeGuideRequest = create<{ requested: boolean }>(() => ({ requested: false }));

/** Opens the side-chat guide, whether or not this device has seen it. */
export function openWelcomeGuide() {
  useWelcomeGuideRequest.setState({ requested: true });
}

// The host sits at the app root, so it reads one boolean instead of every environment's config.
const sideChatsAvailableAtom = Atom.make((get) => {
  for (const config of get(environmentPresentations.serverConfigsAtom).values()) {
    if (config.environment.capabilities.sideChats === true) return true;
  }
  return false;
}).pipe(Atom.withLabel("web-welcome-guide-side-chats-available"));

export function WelcomeGuideHost({ hostedStatic }: { readonly hostedStatic: boolean }) {
  const requested = useWelcomeGuideRequest((state) => state.requested);
  const [seenAt, setSeenAt] = useLocalStorage(
    WELCOME_GUIDE_SEEN_STORAGE_KEY,
    null,
    WelcomeGuideSeenSchema,
  );
  // Hosted static never records onboarding, and has no setup wizard to wait for.
  const setupDone = useClientSettings((settings) => settings.onboardingCompletedAt !== null);
  const sideChatsAvailable = useAtomValue(sideChatsAvailableAtom);
  // Keeps a dismissal for the session even when storage refuses the write.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") return;
    return onMenuAction((action) => {
      if (action === "open-welcome-guide") openWelcomeGuide();
    });
  }, []);

  const autoOpen =
    seenAt === null && !dismissed && (hostedStatic || setupDone) && sideChatsAvailable;
  if (!requested && !autoOpen) return null;

  const close = () => {
    useWelcomeGuideRequest.setState({ requested: false });
    setDismissed(true);
    setSeenAt((current) => current ?? new Date().toISOString());
  };
  return <WelcomeGuideDialog onClose={close} />;
}

function WelcomeGuideDialog({ onClose }: { readonly onClose: () => void }) {
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const askShortcut = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "sideChat.askSelection",
  );
  const last = step === STEPS.length - 1;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <WizardPopup size="wide" initialFocus={nextRef}>
        <WizardHeader
          title="Welcome guide"
          identity={
            <div className="flex items-baseline gap-1.5" role="img" aria-label="T3 Learn">
              <T3Wordmark className="h-4 w-auto shrink-0" aria-hidden />
              <span className="text-2xl font-medium tracking-tight text-muted-foreground">
                Learn
              </span>
            </div>
          }
        >
          <WizardSteps
            label="Guide progress"
            steps={STEPS}
            currentStep={step}
            onStepChange={setStep}
          />
        </WizardHeader>
        <WizardPanel>
          <GuideStep step={step} askShortcut={askShortcut} />
        </WizardPanel>
        <WizardFooter
          // Always a node, so the buttons on the right keep their place, and focus, on the last step.
          leading={
            last ? (
              <span />
            ) : (
              <Button variant="ghost" onClick={onClose}>
                Skip
              </Button>
            )
          }
        >
          {step > 0 ? (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : null}
          <Button ref={nextRef} onClick={last ? onClose : () => setStep(step + 1)}>
            {last ? "Start learning" : "Next"}
          </Button>
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}

function GuideStep({
  step,
  askShortcut,
}: {
  readonly step: number;
  readonly askShortcut: string | null;
}) {
  switch (step) {
    case 0:
      return (
        <StepBody illustration={<LessonMock />} title="Welcome to T3 Learn">
          Every chat is a lesson. When a reply uses something you don&apos;t know yet, you can dig
          into it on the side while the lesson stays on track.
        </StepBody>
      );
    case 1:
      return (
        <StepBody
          illustration={<SelectionMock askShortcut={askShortcut} />}
          title="Highlight what you don't get"
        >
          Select any words in a reply, then choose Ask in side chat
          {askShortcut === null ? null : (
            <>
              {" "}
              or press <Kbd>{askShortcut}</Kbd>
            </>
          )}
          .
        </StepBody>
      );
    case 2:
      return (
        <StepBody illustration={<SidePanelMock />} title="Ask your own question">
          A side chat opens next to the lesson. It already knows what you highlighted and what the
          lesson is about. Ask anything, and highlight inside it to go deeper.
        </StepBody>
      );
    case 3:
      return (
        <StepBody illustration={<NoteMock />} title="Press Done when it clicks">
          The AI writes a short note about where you got stuck. It goes with your next lesson
          message so the lesson can adjust, and the side chat itself stays out of the lesson.
        </StepBody>
      );
    default:
      return (
        <StepBody
          illustration={<MapMock />}
          title="See it all on the Map"
          footnote="You can open this guide again from Settings."
        >
          The Map shows every side chat in a lesson. Click one to pick it back up, or move around
          with the arrow keys.
        </StepBody>
      );
  }
}

function StepBody({
  illustration,
  title,
  footnote,
  children,
}: {
  readonly illustration: ReactNode;
  readonly title: string;
  readonly footnote?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {illustration}
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
        {footnote ? <p className="pt-1 text-xs text-muted-foreground">{footnote}</p> : null}
      </div>
    </div>
  );
}

// Static pictures of the real UI, one fixed height so the panel holds still between steps.
function Illustration({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-44 flex-col justify-center gap-2.5 overflow-hidden rounded-lg border bg-muted/40 p-4 text-xs text-foreground select-none"
    >
      {children}
    </div>
  );
}

function UserBubble() {
  return (
    <div className="max-w-4/5 self-end rounded-xl border bg-card px-3 py-1.5">
      How do noise-cancelling headphones work?
    </div>
  );
}

function ReplyText({ highlight }: { readonly highlight: ReactNode }) {
  return (
    <p className="min-w-0 flex-1 leading-relaxed">
      A mic on each ear cup hears the noise outside, and the speaker plays the same wave flipped
      over. The two cancel out through {highlight}, so you hear far less.
    </p>
  );
}

function LessonMock() {
  return (
    <Illustration label="A lesson reply with an asked phrase underlined and a side chat tag beside it">
      <UserBubble />
      <div className="flex items-end gap-2">
        <ReplyText
          highlight={
            <span className="rounded-sm bg-primary/10 underline decoration-primary/70 decoration-dotted decoration-2 underline-offset-2">
              destructive interference
            </span>
          }
        />
        <span className="mb-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary bg-background text-primary">
          <MessageCircleIcon className="size-2.5" />
        </span>
      </div>
    </Illustration>
  );
}

function SelectionMock({ askShortcut }: { readonly askShortcut: string | null }) {
  return (
    <Illustration label="Selected words in a reply with Cite and Ask in side chat buttons above them">
      <div className="flex items-center gap-1 self-center">
        <span className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 font-medium shadow-xs">
          <QuoteIcon className="size-3.5 text-muted-foreground" />
          Cite
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 font-medium shadow-xs">
          <MessageCircleQuestionIcon className="size-3.5 text-muted-foreground" />
          Ask in side chat
          {askShortcut === null ? null : <Kbd>{askShortcut}</Kbd>}
        </span>
      </div>
      <ReplyText
        highlight={
          <span className="rounded-sm bg-primary/25 ring-1 ring-primary/40">
            destructive interference
          </span>
        }
      />
    </Illustration>
  );
}

function SideChatPath() {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <span className="shrink-0 px-1 text-muted-foreground">Lesson</span>
      <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate px-1 font-medium">destructive interference</span>
    </div>
  );
}

function SidePanelMock() {
  return (
    <Illustration label="A side chat open next to the lesson, waiting for your question">
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex w-1/4 flex-col justify-center gap-2" aria-hidden>
          <span className="h-1.5 w-full rounded-full bg-muted-foreground/20" />
          <span className="h-1.5 w-4/5 rounded-full bg-muted-foreground/20" />
          <span className="h-1.5 w-full rounded-full bg-muted-foreground/20" />
          <span className="h-1.5 w-3/5 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
          <div className="flex items-center border-b px-1.5 py-1.5">
            <SideChatPath />
          </div>
          <p className="flex flex-1 items-center justify-center px-3 text-center text-muted-foreground">
            What do you want to know about “destructive interference”?
          </p>
          <div className="m-2 flex items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-2">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Ask your own question…
            </span>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowUpIcon className="size-3" />
            </span>
          </div>
        </div>
      </div>
    </Illustration>
  );
}

function NoteMock() {
  return (
    <Illustration label="A finished side chat's note waiting to go with the next lesson message">
      <div className="overflow-hidden rounded-md border bg-card">
        <div className="flex items-center gap-1 border-b px-1.5 py-1">
          <SideChatPath />
          <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 font-medium">
            Done
          </span>
        </div>
        <p className="px-3 py-2 leading-relaxed text-muted-foreground">
          Goes with your next lesson message: The learner didn&apos;t know what destructive
          interference is; explain it before building on it.
        </p>
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        Side-chat notes included
        <span className="h-px flex-1 bg-border" />
      </div>
    </Illustration>
  );
}

type MapNodeStatus = "lesson" | "open" | "done";

function MapNode({
  label,
  status,
  current = false,
}: {
  readonly label: string;
  readonly status: MapNodeStatus;
  readonly current?: boolean;
}) {
  const Icon: LucideIcon = status === "lesson" ? BookOpenIcon : MessageCircleIcon;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-1.5 py-1",
        current && "border-primary ring-1 ring-primary",
        status === "lesson" && "shrink-0 font-semibold",
      )}
    >
      <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "absolute -right-1 -bottom-1 size-2 rounded-full border-2 border-card",
            status === "open"
              ? "bg-info"
              : status === "done"
                ? "bg-success"
                : "bg-muted-foreground/45",
          )}
        />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Children joined to their parent by a bracket: a stub into each child, a spine between them. */
function MapBranch({ node, children }: { readonly node: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center">
      {node}
      <span className="h-px w-3 shrink-0 bg-muted-foreground/40" />
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}

function MapChild({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative flex min-w-0 items-center py-1 pl-3 before:absolute before:top-1/2 before:left-0 before:h-px before:w-3 before:bg-muted-foreground/40 after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-muted-foreground/40 first:after:top-1/2 last:after:bottom-1/2">
      {children}
    </div>
  );
}

function MapMock() {
  return (
    <Illustration label="The Map: the lesson with its side chats branching to the right">
      <MapBranch node={<MapNode label="Lesson" status="lesson" />}>
        <MapChild>
          <MapBranch node={<MapNode label="destructive interference" status="done" current />}>
            <MapChild>
              <MapNode label="phase" status="done" />
            </MapChild>
            <MapChild>
              <MapNode label="wavelength" status="open" />
            </MapChild>
          </MapBranch>
        </MapChild>
        <MapChild>
          <MapNode label="feedforward mic" status="done" />
        </MapChild>
      </MapBranch>
    </Illustration>
  );
}
