import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { ChatWindow } from "@/components/chatbot/chat-window";
import { Sparkles, Brain, FileText, BarChart3, Workflow } from "lucide-react";
import { useChatbotStore } from "@/store/chatbot-store";

export const Route = createFileRoute("/ai-assistant")({
  head: () => ({
    meta: [
      { title: "AI Assistant · RIMS" },
      {
        name: "description",
        content: "AI workspace for analytics, recommendations, and natural-language control.",
      },
    ],
  }),
  component: AssistantPage,
});

const capabilities = [
  { Icon: BarChart3, title: "Analytics", desc: "Query KPIs, trends, and anomalies." },
  { Icon: Brain, title: "Explainable AI", desc: "Understand every model decision." },
  { Icon: Sparkles, title: "Recommendations", desc: "Actionable suggestions across the network." },
  { Icon: FileText, title: "Reports", desc: "Generate executive briefings on demand." },
  { Icon: Workflow, title: "Dashboard control", desc: "Drive the platform with natural language." },
];

function AssistantPage() {
  const send = useChatbotStore((s) => s.send);
  const prompts = [
    "Generate this week's executive briefing.",
    "Why did ACME-2241's risk score spike?",
    "Compare forecast accuracy by region, last quarter.",
    "List critical-stock SKUs with reorder quantities.",
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI Workspace"
        title="Supply Chain Copilot"
        description="Analytics, explanations, and recommendations via natural language."
      />

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Capabilities
            </p>
            <div className="mt-3 space-y-3">
              {capabilities.map((c) => (
                <div key={c.title} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <c.Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-border bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Suggested prompts
            </p>
            <div className="mt-3 space-y-2">
              {prompts.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="w-full rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-left text-xs text-foreground transition hover:border-primary/40 hover:bg-primary-soft"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="h-[calc(100vh-220px)] min-h-[560px]">
          <ChatWindow embedded />
        </div>
      </div>
    </div>
  );
}
